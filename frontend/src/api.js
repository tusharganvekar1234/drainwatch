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

export async function getWeather() {
  const response = await fetch(`${API_BASE}/api/weather`);

  if (!response.ok) {
    throw new Error(`Weather API failed: ${response.status}`);
  }

  return response.json();
}