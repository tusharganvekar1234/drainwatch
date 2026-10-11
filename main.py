
import os
from datetime import datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


app = FastAPI(
    title="DRAINWATCH API",
    description="Explainable pre-rain waterlogging decision support",
    version="0.2.0",
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


@app.get("/api/weather")
def get_weather(
    latitude: float = Query(12.9716, ge=-90, le=90),
    longitude: float = Query(77.5946, ge=-180, le=180),
):
    """Fetch the next six hours of forecast precipitation."""
    try:
        response = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": latitude,
                "longitude": longitude,
                "hourly": "precipitation",
                "forecast_days": 2,
                "timezone": "auto",
            },
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()

        times = data["hourly"]["time"]
        precipitation = data["hourly"]["precipitation"]
        timezone_name = data.get("timezone", "Asia/Kolkata")

        now = datetime.now(ZoneInfo(timezone_name))
        current_hour = now.strftime("%Y-%m-%dT%H:00")

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
            "note": (
                "Forecast precipitation is weather-model output, not a "
                "measurement of water depth at a drain."
            ),
        }

    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail="Weather provider request failed. Please retry.",
        ) from exc
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not process the weather forecast. Please retry.",
        ) from exc
