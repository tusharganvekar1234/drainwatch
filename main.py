import requests
from fastapi import HTTPException, Query
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="DRAINWATCH API",
    description="Explainable pre-rain waterlogging decision support",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


DRAIN_PENALTY = {"good": 0.0, "fair": 12.0, "poor": 25.0}


def calculate_risk(site: Site) -> dict:
    # Transparent screening score, not a calibrated flood probability.
    rainfall = min(site.rainfall_mm / 60.0, 1.0) * 35
    terrain = site.elevation_vulnerability * 20
    surface = site.impervious_fraction * 15
    drainage = DRAIN_PENALTY[site.drain_condition]
    history = min(site.historical_incidents / 10.0, 1.0) * 10

    score = round(min(100, rainfall + terrain + surface + drainage + history))

    factors = [
        ("Heavy rainfall", rainfall),
        ("Terrain vulnerability", terrain),
        ("Impervious surface", surface),
        ("Drainage condition", drainage),
        ("Historical incidents", history),
    ]
    factors.sort(key=lambda item: item[1], reverse=True)

    return {
        "id": site.id,
        "name": site.name,
        "risk_score": score,
        "risk_level": (
            "HIGH" if score >= 70 else
            "MODERATE" if score >= 40 else
            "LOW"
        ),
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
    """Fetch an hourly precipitation forecast for a location."""
    try:
        response = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": latitude,
                "longitude": longitude,
                "hourly": "precipitation",
                "forecast_days": 2,
                "timezone": "Asia/Kolkata",
            },
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()

        times = data["hourly"]["time"]
        precipitation = data["hourly"]["precipitation"]

        # Sum the next six forecast hours from the current local hour.
        from datetime import datetime
        from zoneinfo import ZoneInfo

        now = datetime.now(ZoneInfo("Asia/Kolkata"))
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
            "timezone": data.get("timezone", "Asia/Kolkata"),
            "forecast_start": times[start_index],
            "hours_included": len(next_six),
            "next_6_hours_precipitation_mm": rainfall_mm,
            "hourly_forecast": [
                {"time": times[i], "precipitation_mm": precipitation[i]}
                for i in range(start_index, start_index + len(next_six))
            ],
            "units": "mm",
            "note": (
                "Forecast precipitation is weather-model output, "
                "not a measurement of water depth at a drain."
            ),
        }

    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Weather provider request failed: {exc}",
        ) from exc
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not process the weather forecast: {exc}",
        ) from exc
