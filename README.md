# DRAINWATCH 🌧️

### Pre-Rain Intelligence & Intervention Planning

DRAINWATCH is a prototype decision-support system designed to help campus and residential facility teams identify potential waterlogging hotspots and plan preventive actions before rainfall arrives.

Instead of showing weather data alone, DRAINWATCH combines rainfall forecasts with site-level assumptions to generate transparent risk screening scores, rank locations, and support pre-rain intervention planning.

## 🚨 Problem Statement

Heavy rainfall can disrupt campus access routes, pedestrian movement, and parking areas. Facility teams need a practical way to prioritize inspections and prepare resources before rainfall occurs.

DRAINWATCH explores how weather data and transparent scoring can support earlier, more informed intervention planning.

## 💡 Key Features

- **Weather integration:** Retrieves a six-hour precipitation forecast from Open-Meteo.
- **Risk screening:** Calculates a transparent score using rainfall, terrain vulnerability, impervious surface, drainage condition, and historical incidents.
- **Hotspot prioritization:** Ranks illustrative sites using backend-calculated scores.
- **Risk-driver explanations:** Displays the main factors contributing to each screening score.
- **Intervention assessment:** Estimates hypothetical score changes from specified drainage-condition improvements.
- **Resource planning:** Lets users select tasks and set a preparation time window.
- **Action checklists:** Generates a task list with completion tracking.
- **Interactive dashboard:** Provides a command center, hotspot view, intervention lab, and action-plan section.

## 🧠 How It Works

1. Retrieve the latest available precipitation forecast.
2. Combine rainfall input with the supplied characteristics of each site.
3. Calculate a transparent screening score through the FastAPI backend.
4. Rank the locations and inspect their main risk drivers.
5. Review the suggested intervention and hypothetical drainage scenario.
6. Generate a preparation checklist for human review.

## 🏗️ Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite, JavaScript |
| Backend | Python, FastAPI |
| API server | Uvicorn |
| Weather data | Open-Meteo |
| UI icons | Lucide React |

## 📁 Project Structure

```text
drainwatch/
├── main.py
├── requirements.txt
├── README.md
├── .gitignore
└── frontend/
    ├── src/
    ├── public/
    ├── package.json
    └── index.html
```

## ⚙️ Run Locally

### Prerequisites

- Python 3.13 or a compatible Python version
- Node.js and npm

### 1. Clone the repository

```bash
git clone https://github.com/tusharganvekar1234/drainwatch.git
cd drainwatch
```

### 2. Set up the Python backend

Create and activate a virtual environment.

**Windows PowerShell:**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Start the backend:

```powershell
uvicorn main:app --reload
```

The API should be available at:

- API: http://127.0.0.1:8000
- Interactive API documentation: http://127.0.0.1:8000/docs

### 3. Set up the frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, normally:

http://localhost:5173/

Keep both terminals running while using the application.

## 📊 Risk Scoring

The backend uses a transparent, weighted screening model based on:

- Forecast rainfall
- Terrain vulnerability
- Impervious surface fraction
- Drainage condition
- Historical incidents

The score is bounded between 0 and 100. The model is intended to support screening and prioritization, not to predict an exact flood probability.

## ⚠️ Limitations and Responsible Use

- The current site records are illustrative demo inputs, not verified measurements of actual campus locations.
- The schematic map is illustrative and does not represent surveyed geographic coordinates.
- Weather forecast precipitation is not the same as measured drain water depth or site-specific flood depth.
- Screening scores are not calibrated probabilities of flooding.
- Intervention score changes are hypothetical model outputs, not validated real-world reductions.
- The task planner is a planning aid; it does not yet provide a validated optimal allocation of workers and resources.
- Verify local conditions and use qualified personnel before making real-world safety decisions.

## 🔭 Future Improvements

- Support verified site data and geographic coordinates.
- Incorporate measured drainage capacity, blockage status, and water-level sensors.
- Improve site-specific rainfall exposure and time-based forecasts.
- Add a validated resource-allocation optimizer.
- Persist intervention plans and completion status.
- Deploy the frontend and API with appropriate security and cost controls.
- Evaluate model performance against observed waterlogging incidents.

## 👨‍💻 Project

**DRAINWATCH — Pre-Rain Intelligence & Intervention Planning**

GitHub: https://github.com/tusharganvekar1234/drainwatch

*Built as a prototype for preventive environmental decision support.*