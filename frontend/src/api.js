const API_BASE = "https://drainwatch-hqt4.onrender.com";

export async function calculateRisk(sites) {
  const response = await fetch(`${API_BASE}/api/risk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sites }),
  });

  if (!response.ok) {
    throw new Error(`Risk API failed: ${response.status}`);
  }

  return response.json();
}

export async function checkBackend() {
  const response = await fetch(`${API_BASE}/health`);

  if (!response.ok) {
    throw new Error("DRAINWATCH backend is unavailable.");
  }

  return response.json();
}


export async function getWeather(latitude, longitude) {
  const lat = latitude ?? 12.9716;
  const lon = longitude ?? 77.5946;

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "precipitation",
    forecast_days: "2",
    timezone: "auto",
  });

  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params}`
  );

  if (!response.ok) {
    throw new Error(
      `Live weather is temporarily unavailable (${response.status}). Please retry shortly.`
    );
  }

  const data = await response.json();
  const times = data.hourly?.time ?? [];
  const rainfall = data.hourly?.precipitation ?? [];

  if (!times.length || !rainfall.length) {
    throw new Error("Weather forecast data is unavailable.");
  }

  const now = Date.now();
  let start = times.findIndex((time) => {
    const forecastTime = new Date(time).getTime();
    return forecastTime >= now;
  });

  if (start < 0) start = 0;

  const nextSix = rainfall.slice(start, start + 6);

  return {
    provider: "Open-Meteo",
    latitude: lat,
    longitude: lon,
    timezone: data.timezone ?? "Asia/Kolkata",
    forecast_start: times[start],
    hours_included: nextSix.length,
    next_6_hours_precipitation_mm: Number(
      nextSix.reduce((sum, value) => sum + (value ?? 0), 0).toFixed(1)
    ),
    hourly_forecast: nextSix.map((value, index) => ({
      time: times[start + index],
      precipitation_mm: value,
    })),
    units: "mm",
    fetched_at: new Date().toISOString(),
  };
}
