import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Literal

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


logger = logging.getLogger("drainwatch")
logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="DRAINWATCH API",
    description="Explainable pre-rain waterlogging decision support",
    version="0.3.0",
)

# Keep local development working. Add production frontend URLs through
# DRAINWATCH_CORS_ORIGINS when deploying.
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "DRAINWATCH_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Keep these thresholds consistent with the frontend.
HIGH_RISK_THRESHOLD = 70
MODERATE_RISK_THRESHOLD = 40
LOW_RAINFALL_THRESHOLD_MM = 2.5

DRAIN_PENALTY = {
    "good": 0.0,
    "fair": 12.0,
    "poor": 25.0,
}

# These are hypothetical condition improvements for decision support,
# not measured or guaranteed real-world intervention effects.
DRAIN_IMPROVEMENTS = {
    "poor": "fair",
    "fair": "good",
    "good": None,
}

# ---- Weather provider settings ----
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_TIMEOUT = (5, 8)  # (connect seconds, read seconds)
WEATHER_MAX_ATTEMPTS = 3
WEATHER_RETRY_STATUS = {429, 500, 502, 503, 504}
WEATHER_CACHE_SECONDS = 600  # reuse a real provider response for 10 minutes
WEATHER_USER_AGENT = "DRAINWATCH/0.3 (hackathon project)"

# Cache of real Open-Meteo responses: key -> (monotonic time, data, fetched_at)
_weather_cache: dict = {}


class Site(BaseModel):
    id: str
    name: str
    rainfall_mm: float = Field(ge=0, le=500)
    elevation_vulnerability: float = Field(ge=0, le=1)
    impervious_fraction: float = Field(ge=0, le=1)
    drain_condition: Literal["good", "fair", "poor"]
    historical_incidents: int = Field(ge=0, le=1000)


class RiskRequest(BaseModel):
    sites: list[Site]


def risk_level(score: int) -> str:
    if score >= HIGH_RISK_THRESHOLD:
        return "HIGH"
    if score >= MODERATE_RISK_THRESHOLD:
        return "MODERATE"
    return "LOW"


def raw_risk_components(site: Site) -> dict:
    return {
        "rainfall": min(site.rainfall_mm / 60.0, 1.0) * 35,
        "terrain": site.elevation_vulnerability * 20,
        "surface": site.impervious_fraction * 15,
        "drainage": DRAIN_PENALTY[site.drain_condition],
        "history": min(site.historical_incidents / 10.0, 1.0) * 10,
    }


def calculate_risk(site: Site) -> dict:
    """Calculate a transparent screening score, not flood probability."""
    components = raw_risk_components(site)
    score = round(max(0, min(100, sum(components.values()))))

    labels = {
        "rainfall": "Heavy rainfall",
        "terrain": "Terrain vulnerability",
        "surface": "Impervious surface",
        "drainage": "Drainage condition",
        "history": "Historical incidents",
    }

    factors = sorted(
        (
            (labels[key], value)
            for key, value in components.items()
        ),
        key=lambda item: item[1],
        reverse=True,
    )

    result = {
        "id": site.id,
        "name": site.name,
        "risk_score": score,
        "risk_level": risk_level(score),
        "top_risk_drivers": [
            {"factor": name, "contribution": round(value, 1)}
            for name, value in factors[:3]
            if value > 0
        ],
        "input_summary": {
            "rainfall_mm": site.rainfall_mm,
            "elevation_vulnerability": site.elevation_vulnerability,
            "impervious_fraction": site.impervious_fraction,
            "drain_condition": site.drain_condition,
            "historical_incidents": site.historical_incidents,
        },
        "model_type": "transparent_screening_score",
        "is_calibrated_probability": False,
    }

    # Recommendations depend on the rainfall value supplied for this site.
    if site.rainfall_mm < LOW_RAINFALL_THRESHOLD_MM:
        result["recommended_action"] = {
            "type": "routine_check",
            "title": "Routine drainage checks",
            "reason": (
                "The supplied next-six-hour rainfall forecast is below "
                f"{LOW_RAINFALL_THRESHOLD_MM} mm. Continue routine checks "
                "and reassess when the forecast changes."
            ),
        }
    elif site.drain_condition == "poor":
        result["recommended_action"] = {
            "type": "inspect_and_clear",
            "title": "Inspect and clear the drainage system",
            "reason": (
                "Rainfall is forecast and the supplied drain condition "
                "is poor. Verify the site condition before assigning work."
            ),
        }
    elif site.drain_condition == "fair":
        result["recommended_action"] = {
            "type": "inspect_drain",
            "title": "Inspect the drainage system",
            "reason": (
                "Rainfall is forecast and the supplied drain condition "
                "is fair. Check for obstruction and confirm readiness."
            ),
        }
    else:
        result["recommended_action"] = {
            "type": "verify_and_monitor",
            "title": "Verify drainage readiness and monitor",
            "reason": (
                "Rainfall is forecast, but the supplied drain condition "
                "is good. Verify the inspection record and monitor updates."
            ),
        }

    # Estimate score change by rerunning the same model with a hypothetical
    # one-step drainage-condition improvement.
    improved_condition = DRAIN_IMPROVEMENTS[site.drain_condition]

    if improved_condition is None:
        result["intervention_assessment"] = {
            "available": False,
            "message": (
                "Drain condition is already marked good. No further "
                "drain-condition improvement is modelled."
            ),
        }
    else:
        improved_site = site.model_copy(
            update={"drain_condition": improved_condition}
        )
        improved_score = calculate_score_only(improved_site)

        result["intervention_assessment"] = {
            "available": True,
            "action": "Verify and improve drainage condition",
            "current_condition": site.drain_condition,
            "assumed_condition_after": improved_condition,
            "current_screening_score": score,
            "assumed_screening_score_after": improved_score,
            "modelled_score_change": score - improved_score,
            "is_guaranteed_real_world_reduction": False,
            "note": (
                "Hypothetical screening-score change from changing the "
                "drain-condition input only. Actual impact must be verified."
            ),
        }

    return result


def calculate_score_only(site: Site) -> int:
    components = raw_risk_components(site)
    return round(max(0, min(100, sum(components.values()))))


@app.get("/")
def root():
    return {
        "name": "DRAINWATCH API",
        "status": "online",
        "message": "Pre-rain decision support API is running.",
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/api/risk")
def risk(request: RiskRequest):
    results = [calculate_risk(site) for site in request.sites]
    results.sort(key=lambda item: item["risk_score"], reverse=True)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(results),
        "sites": results,
        "disclaimer": (
            "Screening scores use supplied assumptions. They are not "
            "verified flood probabilities or guarantees of intervention impact."
        ),
    }


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------

def weather_error(
    reason: str,
    message: str,
    upstream_status: int | None = None,
) -> HTTPException:
    """Build a 502 error that tells the frontend exactly what went wrong."""
    return HTTPException(
        status_code=502,
        detail={
            "reason": reason,
            "message": message,
            "upstream_status": upstream_status,
        },
    )


def fetch_open_meteo(latitude: float, longitude: float):
    """Return (raw_provider_data, was_cached, fetched_at_iso).

    Only real Open-Meteo responses are ever returned or cached.
    On failure this raises an HTTPException with a specific reason.
    """
    cache_key = (round(latitude, 2), round(longitude, 2))
    cached = _weather_cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < WEATHER_CACHE_SECONDS:
        return cached[1], True, cached[2]

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "precipitation",
        "forecast_days": 2,
        "timezone": "auto",
    }
    headers = {
        "User-Agent": WEATHER_USER_AGENT,
        "Accept": "application/json",
    }

    reason = "unknown"
    message = "The weather service could not be reached."
    upstream_status = None

    for attempt in range(1, WEATHER_MAX_ATTEMPTS + 1):
        try:
            response = requests.get(
                OPEN_METEO_URL,
                params=params,
                headers=headers,
                timeout=WEATHER_TIMEOUT,
            )
        except requests.Timeout as exc:
            reason = "timeout"
            message = "The weather service took too long to respond."
            upstream_status = None
            logger.warning(
                "Open-Meteo timeout (attempt %s/%s): %s",
                attempt, WEATHER_MAX_ATTEMPTS, exc,
            )
        except requests.ConnectionError as exc:
            reason = "connection_error"
            message = "The server could not connect to the weather service."
            upstream_status = None
            logger.warning(
                "Open-Meteo connection error (attempt %s/%s): %s",
                attempt, WEATHER_MAX_ATTEMPTS, exc,
            )
        except requests.RequestException as exc:
            reason = "request_error"
            message = "The weather request failed."
            upstream_status = None
            logger.warning(
                "Open-Meteo request error (attempt %s/%s): %s",
                attempt, WEATHER_MAX_ATTEMPTS, exc,
            )
        else:
            if response.status_code == 200:
                try:
                    data = response.json()
                except ValueError as exc:
                    logger.error("Open-Meteo returned invalid JSON: %s", exc)
                    raise weather_error(
                        "invalid_response",
                        "The weather service returned unreadable data. "
                        "Please retry shortly.",
                        200,
                    ) from exc

                if not isinstance(data, dict) or "hourly" not in data:
                    logger.error("Open-Meteo response missing 'hourly'.")
                    raise weather_error(
                        "invalid_response",
                        "The weather service returned an unexpected format. "
                        "Please retry shortly.",
                        200,
                    )

                fetched_at = datetime.now(timezone.utc).isoformat()
                if len(_weather_cache) > 50:
                    _weather_cache.clear()
                _weather_cache[cache_key] = (
                    time.monotonic(), data, fetched_at
                )
                return data, False, fetched_at

            upstream_status = response.status_code
            logger.warning(
                "Open-Meteo HTTP %s (attempt %s/%s): %s",
                response.status_code, attempt, WEATHER_MAX_ATTEMPTS,
                response.text[:300],
            )
            if response.status_code == 429:
                reason = "rate_limited"
                message = (
                    "The weather service is limiting requests right now."
                )
            elif response.status_code >= 500:
                reason = "provider_error"
                message = "The weather service is having problems."
            else:
                # 400-level errors other than 429 will not fix themselves.
                reason = "provider_rejected_request"
                message = "The weather service rejected the request."
                break

            if response.status_code not in WEATHER_RETRY_STATUS:
                break

        if attempt < WEATHER_MAX_ATTEMPTS:
            time.sleep(attempt)  # wait 1s, then 2s

    raise weather_error(
        reason,
        f"{message} Please retry shortly.",
        upstream_status,
    )


@app.get("/api/weather")
def get_weather(
    latitude: float = Query(12.9716, ge=-90, le=90),
    longitude: float = Query(77.5946, ge=-180, le=180),
):
    """Fetch the next six hours of forecast precipitation."""
    data, was_cached, fetched_at = fetch_open_meteo(latitude, longitude)

    try:
        times = data["hourly"]["time"]
        precipitation = data["hourly"]["precipitation"]
        if len(times) != len(precipitation):
            raise ValueError("Hourly arrays have different lengths.")

        timezone_name = data.get("timezone", "Asia/Kolkata")
        offset_seconds = int(data["utc_offset_seconds"])

        # Local time at the forecast location, without needing tzdata.
        local_now = datetime.now(timezone.utc) + timedelta(
            seconds=offset_seconds
        )
        current_hour = local_now.strftime("%Y-%m-%dT%H:00")

        start_index = next(
            (i for i, value in enumerate(times) if value >= current_hour),
            None,
        )
        if start_index is None:
            raise ValueError("No upcoming hourly forecast was returned.")

        next_six = precipitation[start_index:start_index + 6]
        rainfall_mm = round(sum(value or 0 for value in next_six), 1)

        return {
            "provider": "Open-Meteo",
            "latitude": latitude,
            "longitude": longitude,
            "timezone": timezone_name,
            "forecast_start": times[start_index],
            "hours_included": len(next_six),
            "next_6_hours_precipitation_mm": rainfall_mm,
            "hourly_forecast": [
                {
                    "time": times[i],
                    "precipitation_mm": precipitation[i],
                }
                for i in range(start_index, start_index + len(next_six))
            ],
            "units": "mm",
            "fetched_at": fetched_at,
            "served_from_cache": was_cached,
            "note": (
                "Forecast precipitation is weather-model output, not a "
                "measurement of water depth at a drain."
            ),
        }

    except (KeyError, ValueError, TypeError) as exc:
        logger.exception("Could not process Open-Meteo data: %s", exc)
        raise weather_error(
            "invalid_response",
            "Could not process the weather forecast. Please retry shortly.",
        ) from exc