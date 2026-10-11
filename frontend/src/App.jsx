import { useEffect, useMemo, useRef, useState } from "react";
import {
  CloudRain,
  MapPin,
  ShieldAlert,
  Activity,
  Clock,
  Droplets,
  ArrowUpRight,
  ArrowRight,
  CheckCircle2,
  Check,
  Waves,
  ChevronRight,
  Zap,
} from "lucide-react";
import "./App.css";
import { calculateRisk, checkBackend, getWeather } from "./api";

/* ---------- Static configuration ---------- */

const DEFAULT_RAINFALL_MM = 45; // fallback sent to the API when no forecast is loaded
const DEMO_RAINFALL_MM = 61; // demo scenario shown before any data is fetched
const PREP_HOURS = 4; // illustrative planning window

// Single source of truth for sites: used for the demo display AND the API request.
// `map` positions are for the illustrative schematic only, not real coordinates.
const SITES = [
  {
    id: "D1",
    name: "Hostel Gate",
    type: "Critical access route",
    demoRisk: 87,
    demoRainfall: "Heavy",
    drain: "Poor",
    elevation: "Low",
    map: { x: 28, y: 44 },
    inputs: {
      elevation_vulnerability: 0.9,
      impervious_fraction: 0.85,
      drain_condition: "poor",
      historical_incidents: 8,
    },
  },
  {
    id: "D2",
    name: "Academic Block Road",
    type: "Pedestrian access",
    demoRisk: 72,
    demoRainfall: "Heavy",
    drain: "Limited",
    elevation: "Low",
    map: { x: 62, y: 62 },
    inputs: {
      elevation_vulnerability: 0.7,
      impervious_fraction: 0.8,
      drain_condition: "fair",
      historical_incidents: 5,
    },
  },
  {
    id: "D3",
    name: "Main Parking",
    type: "Vehicle access",
    demoRisk: 48,
    demoRainfall: "Moderate",
    drain: "Fair",
    elevation: "Medium",
    map: { x: 74, y: 28 },
    inputs: {
      elevation_vulnerability: 0.4,
      impervious_fraction: 0.6,
      drain_condition: "fair",
      historical_incidents: 2,
    },
  },
];

const ACTIONS = [
  { id: "D4", name: "Clear Drain D4", time: 25, reduction: 24 },
  { id: "D7", name: "Clear Drain D7", time: 20, reduction: 16 },
  { id: "P1", name: "Deploy portable pump", time: 30, reduction: 22 },
];

const NAV_ITEMS = [
  { id: "command-center", label: "Command Center", Icon: Activity },
  { id: "risk-hotspots", label: "Risk Hotspots", Icon: MapPin },
  { id: "intervention-lab", label: "Intervention Lab", Icon: Zap },
  { id: "action-plans", label: "Action Plans", Icon: CheckCircle2 },
];

/* ---------- Helpers ---------- */

function severityOf(score) {
  if (score >= 75) return { key: "high", label: "High", bars: 3 };
  if (score >= 50) return { key: "moderate", label: "Moderate", bars: 2 };
  return { key: "watch", label: "Watch", bars: 1 };
}

function rainfallLabel(mm) {
  if (mm >= 40) return "Heavy";
  if (mm >= 15) return "Moderate";
  return "Light";
}

function formatMm(mm) {
  const value = Number(mm);
  return Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, "") : "—";
}

function firstActionFor(siteId) {
  if (siteId === "D1") return "Inspect and clear Drain D4";
  if (siteId === "D2") return "Inspect roadside drainage";
  return "Check drain inlets before rain";
}

/* ---------- Small presentational components ---------- */

function SourceTag({ kind, children }) {
  return <span className={`tag tag-${kind}`}>{children}</span>;
}

function SeverityMeter({ score }) {
  const sev = severityOf(score);
  return (
    <span
      className={`severity sev-${sev.key}`}
      role="img"
      aria-label={`Severity: ${sev.label}`}
    >
      <span className="severity-bars" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <i key={n} className={n <= sev.bars ? "on" : ""} />
        ))}
      </span>
      <span className="severity-text" aria-hidden="true">
        {sev.label}
      </span>
    </span>
  );
}

function SectionHead({ number, eyebrow, title, description, tag }) {
  return (
    <header className="section-head">
      <div>
        <div className="eyebrow">
          <span className="eyebrow-num">{number}</span> {eyebrow}
        </div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {tag}
    </header>
  );
}

function MetricCard({ label, Icon, value, unit, tag, foot }) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={18} aria-hidden="true" />
      </div>
      <div className="metric-value">
        {value} <small>{unit}</small>
      </div>
      <div className="metric-foot">{foot}</div>
      {tag}
    </article>
  );
}

/* ---------- App ---------- */

function App() {
  // Backend / API state
  const [backendStatus, setBackendStatus] = useState("Checking");
  const [apiError, setApiError] = useState("");
  const [apiSites, setApiSites] = useState([]);
  const [analysisRainfall, setAnalysisRainfall] = useState(null); // { mm, source }
  const [loadingRisk, setLoadingRisk] = useState(false);

  // Weather state
  const [weather, setWeather] = useState(null);
  const [weatherError, setWeatherError] = useState("");
  const [loadingWeather, setLoadingWeather] = useState(false);

  // Dashboard / intervention state
  const [selectedId, setSelectedId] = useState(SITES[0].id);
  const [workers, setWorkers] = useState(2);
  const [minutes, setMinutes] = useState(90);
  const [selectedActions, setSelectedActions] = useState(["D4"]);
  const [showPlan, setShowPlan] = useState(false);
  const [completed, setCompleted] = useState([]);

  // Navigation state
  const [activeSection, setActiveSection] = useState("command-center");
  const [pendingScroll, setPendingScroll] = useState(null);
  const scrollLockUntil = useRef(0);

  /* ----- Effects ----- */

  // One-time backend health check (uses checkBackend from ./api).
  useEffect(() => {
    let cancelled = false;
    checkBackend()
      .then(() => {
        if (!cancelled) setBackendStatus("Online");
      })
      .catch(() => {
        if (!cancelled) setBackendStatus("Offline");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Scroll after React has rendered (so the plan content exists first).
  useEffect(() => {
    if (!pendingScroll) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(pendingScroll)?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    setPendingScroll(null);
  }, [pendingScroll]);

  // Highlight the nav item for the section currently in view.
  useEffect(() => {
    const elements = NAV_ITEMS.map((item) =>
      document.getElementById(item.id)
    ).filter(Boolean);

    let observer;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (Date.now() < scrollLockUntil.current) return; // ignore during click-scroll
          entries.forEach((entry) => {
            if (entry.isIntersecting) setActiveSection(entry.target.id);
          });
        },
        { rootMargin: "-20% 0px -65% 0px" }
      );
      elements.forEach((el) => observer.observe(el));
    }

    // The last section can be too short to reach the observer band at page end.
    const onScroll = () => {
      if (Date.now() < scrollLockUntil.current) return;
      const atBottom =
        window.innerHeight + window.scrollY >= document.body.scrollHeight - 4;
      if (atBottom) setActiveSection(NAV_ITEMS[NAV_ITEMS.length - 1].id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  /* ----- Derived data ----- */

  const hasApiResults = apiSites.length > 0;

  const locations = useMemo(() => {
    const apiById = new Map(apiSites.map((site) => [site.id, site]));
    const rainfallText = analysisRainfall
      ? rainfallLabel(analysisRainfall.mm)
      : null;

    return SITES.map((site) => {
      const apiSite = apiById.get(site.id);
      const risk = apiSite ? Math.round(apiSite.risk_score) : site.demoRisk;
      const severity = severityOf(risk);
      return {
        id: site.id,
        name: site.name,
        type: site.type,
        risk,
        severity,
        level: apiSite?.risk_level
          ? String(apiSite.risk_level)
          : `${severity.label} risk`,
        rainfall: apiSite && rainfallText ? rainfallText : site.demoRainfall,
        drain: site.drain,
        elevation: site.elevation,
        map: site.map,
        drivers: apiSite?.top_risk_drivers
          ? apiSite.top_risk_drivers.map((driver) => driver.factor)
          : [],
        fromApi: Boolean(apiSite),
      };
    }).sort((a, b) => b.risk - a.risk);
  }, [apiSites, analysisRainfall]);

  const selected = locations.find((loc) => loc.id === selectedId) || locations[0];
  const topLocation = locations[0];

  const chosenActions = ACTIONS.filter((action) =>
    selectedActions.includes(action.id)
  );
  const totalTime = chosenActions.reduce((sum, action) => sum + action.time, 0);
  const estimatedReduction = chosenActions.reduce(
    (sum, action) => sum + action.reduction,
    0
  );
  const simulatedRisk = Math.max(
    0,
    selected.risk - Math.min(estimatedReduction, selected.risk)
  );
  const appliedReduction = selected.risk - simulatedRisk;
  const exceedsTime = totalTime > minutes;
  const timeFill = Math.min(100, Math.round((totalTime / minutes) * 100));

  let running = 0;
  const planItems = chosenActions.map((action, index) => {
    running += action.time;
    return { ...action, step: index + 1, running };
  });
  const doneCount = planItems.filter((item) => completed.includes(item.id)).length;

  // Rainfall: API analysis > live forecast > demo scenario
  const forecastMm = weather ? weather.next_6_hours_precipitation_mm : null;
  let rainMetric;
  if (analysisRainfall) {
    const stale =
      forecastMm !== null && Number(forecastMm) !== Number(analysisRainfall.mm);
    const fromForecast = analysisRainfall.source === "forecast";
    rainMetric = {
      mm: analysisRainfall.mm,
      tagKind: fromForecast ? "live" : "fallback",
      tagText: fromForecast ? "Live forecast" : `Fallback ${DEFAULT_RAINFALL_MM} mm`,
      foot:
        (fromForecast
          ? "Forecast used in risk calculation"
          : "Fallback assumption used in risk calculation") +
        (stale ? " · forecast changed, recalculate" : ""),
    };
  } else if (forecastMm !== null) {
    rainMetric = {
      mm: forecastMm,
      tagKind: "live",
      tagText: "Live forecast",
      foot: "Risk not yet calculated with this forecast",
    };
  } else {
    rainMetric = {
      mm: DEMO_RAINFALL_MM,
      tagKind: "demo",
      tagText: "Demo value",
      foot: "Fetch the weather forecast for live data",
    };
  }

  const scoreTag = hasApiResults ? (
    <SourceTag kind="api">API screening score</SourceTag>
  ) : (
    <SourceTag kind="demo">Demo value</SourceTag>
  );

  /* ----- Handlers ----- */

  const handleNavClick = (id) => {
    scrollLockUntil.current = Date.now() + 900;
    setActiveSection(id);
    if (id === "action-plans") setShowPlan(true); // generate a plan first if none exists
    setPendingScroll(id);
  };

  const toggleAction = (id) => {
    setSelectedActions((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
    setShowPlan(false);
    setCompleted([]);
  };

  const selectLocation = (id) => {
    setSelectedId(id);
    setShowPlan(false);
    setCompleted([]);
  };

  const toggleDone = (id) => {
    setCompleted((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  const generatePlan = () => {
    setShowPlan(true);
    setCompleted([]);
    setPendingScroll("action-plans");
  };

  async function recheckBackend() {
    setBackendStatus("Checking");
    try {
      await checkBackend();
      setBackendStatus("Online");
    } catch {
      setBackendStatus("Offline");
    }
  }

  async function loadWeather() {
    setLoadingWeather(true);
    setWeatherError("");

    try {
      const result = await getWeather();
      setWeather(result);
    } catch (error) {
      setWeatherError(error.message || "Unable to load weather.");
    } finally {
      setLoadingWeather(false);
    }
  }

  const loadRiskScores = async () => {
    setLoadingRisk(true);
    setApiError("");

    const forecast = weather?.next_6_hours_precipitation_mm;
    const hasForecast = typeof forecast === "number" && Number.isFinite(forecast);
    const rainfallMm = hasForecast ? forecast : DEFAULT_RAINFALL_MM;

    try {
      const result = await calculateRisk(
        SITES.map((site) => ({
          id: site.id,
          name: site.name,
          rainfall_mm: rainfallMm,
          ...site.inputs,
        }))
      );

      if (!result || !Array.isArray(result.sites)) {
        throw new Error("Backend returned an unexpected response.");
      }

      setApiSites(result.sites);
      setAnalysisRainfall({
        mm: rainfallMm,
        source: hasForecast ? "forecast" : "fallback",
      });
      setBackendStatus("Online");
      setShowPlan(false);
      setCompleted([]);
    } catch (error) {
      setBackendStatus("Offline");
      setApiError(error.message || "Unable to reach the backend.");
    } finally {
      setLoadingRisk(false);
    }
  };

  /* ----- Render ----- */

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Waves size={22} />
          </div>
          <div>
            <h1 className="brand-name">DRAINWATCH</h1>
            <span className="brand-tag">Pre-rain intelligence</span>
          </div>
        </div>

        <nav className="nav" aria-label="Sections">
          <div className="nav-label">Workspace</div>
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-item ${activeSection === id ? "active" : ""}`}
              aria-current={activeSection === id ? "true" : undefined}
              onClick={() => handleNavClick(id)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="pulse-dot" aria-hidden="true" />
          <div>
            <strong>Prototype environment</strong>
            <span>Decision support, not a flood forecast</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <span className="crumb">Environmental Intelligence / Overview</span>
          <SourceTag kind={hasApiResults ? "api" : "demo"}>
            {hasApiResults ? "API scores loaded" : "Demo mode"}
          </SourceTag>
        </div>

        {/* ===== 01 COMMAND CENTER ===== */}
        <section className="section" id="command-center">
          <div className="briefing">
            <div className="briefing-copy">
              <div className="eyebrow">
                <span className="eyebrow-num">01</span> Command Center
              </div>
              <h2>Pre-rain briefing</h2>
              <p className="lede">
                Understand local waterlogging risk, then decide what to do before
                rainfall arrives.
              </p>

              <dl className="facts">
                <div>
                  <dt>Rain input</dt>
                  <dd>
                    {formatMm(rainMetric.mm)} mm{" "}
                    <SourceTag kind={rainMetric.tagKind}>{rainMetric.tagText}</SourceTag>
                  </dd>
                </div>
                <div>
                  <dt>Top hotspot</dt>
                  <dd>
                    {topLocation.name} · {topLocation.risk}/100 {scoreTag}
                  </dd>
                </div>
                <div>
                  <dt>Preparation window</dt>
                  <dd>
                    {PREP_HOURS} hours <SourceTag kind="illustrative">Illustrative</SourceTag>
                  </dd>
                </div>
              </dl>
            </div>

            <div className="next-action">
              <div className="next-action-label">Recommended next action</div>
              <h3>{firstActionFor(topLocation.id)}</h3>
              <p>
                {topLocation.name} ranks highest ({topLocation.risk}/100,{" "}
                {topLocation.severity.label.toLowerCase()} severity).{" "}
                {hasApiResults
                  ? "Based on backend screening scores."
                  : "Based on demo values until risk is calculated."}{" "}
                Confirm conditions on site before acting.
              </p>
              <div className="next-action-buttons">
                {hasApiResults ? (
                  <button
                    type="button"
                    className="btn btn-lime"
                    onClick={() => handleNavClick("intervention-lab")}
                  >
                    Plan this in the Intervention Lab <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-lime"
                    onClick={loadRiskScores}
                    disabled={loadingRisk}
                  >
                    {loadingRisk ? "Calculating…" : "Calculate risk scores"}
                    {!loadingRisk && <ArrowRight size={16} aria-hidden="true" />}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-outline-light"
                  onClick={() => handleNavClick("risk-hotspots")}
                >
                  Review hotspots
                </button>
              </div>
            </div>
          </div>

          <div className="data-grid">
            <article className="card weather-card" aria-live="polite">
              <div className="card-head">
                <div>
                  <h3>Live weather forecast</h3>
                  <p>Bengaluru · Open-Meteo</p>
                </div>
                <button
                  type="button"
                  className="btn btn-dark"
                  onClick={loadWeather}
                  disabled={loadingWeather}
                >
                  {loadingWeather
                    ? "Loading…"
                    : weather
                    ? "Refresh weather"
                    : "Fetch weather"}
                </button>
              </div>

              {loadingWeather && (
                <p className="state-note">Fetching the six-hour forecast…</p>
              )}

              {weatherError && (
                <p className="alert alert-error" role="alert">
                  <strong>Weather unavailable.</strong> {weatherError}
                </p>
              )}

              {weather && !loadingWeather && (
                <div className="weather-result">
                  <div className="weather-number">
                    {formatMm(weather.next_6_hours_precipitation_mm)}
                    <small>mm</small>
                  </div>
                  <div className="weather-meta">
                    <SourceTag kind="live">Live forecast</SourceTag>
                    <p>Forecast precipitation · next 6 hours</p>
                    <p>Forecast starts: {weather.forecast_start}</p>
                    <p>Source: {weather.provider}</p>
                  </div>
                </div>
              )}

              {!weather && !loadingWeather && !weatherError && (
                <p className="state-note">
                  No forecast loaded yet. Until you fetch one, the dashboard shows a
                  demo rainfall value.
                </p>
              )}
            </article>

            <article className="card risk-card">
              <div className="card-head">
                <div>
                  <h3>Risk calculation</h3>
                  <p>
                    Backend:{" "}
                    <span className={`status status-${backendStatus.toLowerCase()}`}>
                      {backendStatus}
                    </span>
                    {backendStatus === "Offline" && (
                      <button type="button" className="link-button" onClick={recheckBackend}>
                        Check again
                      </button>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-dark"
                  onClick={loadRiskScores}
                  disabled={loadingRisk}
                >
                  {loadingRisk
                    ? "Calculating…"
                    : hasApiResults
                    ? "Recalculate risk"
                    : "Calculate risk using API"}
                </button>
              </div>

              <p className="state-note">
                {weather
                  ? "Uses the fetched six-hour forecast as the rainfall input."
                  : `No forecast loaded — will use the ${DEFAULT_RAINFALL_MM} mm fallback assumption.`}
              </p>

              {apiError && (
                <p className="alert alert-error" role="alert">
                  <strong>Calculation failed.</strong> {apiError}
                </p>
              )}

              {hasApiResults && (
                <ul className="api-results" aria-label="Calculated API results">
                  {apiSites.map((site) => (
                    <li key={site.id}>
                      <div className="api-results-top">
                        <strong>{site.name}</strong>
                        <span>
                          {site.risk_score}/100 · {site.risk_level}
                        </span>
                      </div>
                      <small>
                        Main factors:{" "}
                        {(site.top_risk_drivers || [])
                          .map((factor) => factor.factor)
                          .join(", ") || "—"}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          <div className="metrics">
            <MetricCard
              label="Rain in next 6 hours"
              Icon={CloudRain}
              value={formatMm(rainMetric.mm)}
              unit="mm"
              foot={`${rainfallLabel(Number(rainMetric.mm))} rainfall · ${rainMetric.foot}`}
              tag={<SourceTag kind={rainMetric.tagKind}>{rainMetric.tagText}</SourceTag>}
            />
            <MetricCard
              label="Priority hotspots"
              Icon={ShieldAlert}
              value={String(locations.length).padStart(2, "0")}
              unit="zones"
              foot={`Ranked by ${hasApiResults ? "API screening score" : "demo risk score"}`}
              tag={scoreTag}
            />
            <MetricCard
              label="Highest risk score"
              Icon={Activity}
              value={topLocation.risk}
              unit="/100"
              foot={`${topLocation.name} · ${topLocation.level}`}
              tag={scoreTag}
            />
            <MetricCard
              label="Time to prepare"
              Icon={Clock}
              value={String(PREP_HOURS).padStart(2, "0")}
              unit="hours"
              foot="Planning window used for this prototype"
              tag={<SourceTag kind="illustrative">Illustrative</SourceTag>}
            />
          </div>
        </section>

        {/* ===== 02 RISK HOTSPOTS ===== */}
        <section className="section" id="risk-hotspots">
          <SectionHead
            number="02"
            eyebrow="Risk Hotspots"
            title="Where waterlogging is most likely to disrupt access"
            description="Select a location to inspect its score, drivers and suggested first action."
            tag={
              <SourceTag kind={hasApiResults ? "api" : "demo"}>
                {hasApiResults ? "API results" : "Demo data"}
              </SourceTag>
            }
          />

          <div className="hotspots-layout">
            <div className="hotspots-left">
              <ol className="hotspot-list">
                {locations.map((location, index) => {
                  const isSelected = selected.id === location.id;
                  return (
                    <li key={location.id}>
                      <button
                        type="button"
                        className={`hotspot sev-${location.severity.key} ${
                          isSelected ? "is-selected" : ""
                        }`}
                        aria-pressed={isSelected}
                        onClick={() => selectLocation(location.id)}
                      >
                        <span className="hotspot-rank" aria-hidden="true">
                          {index + 1}
                        </span>
                        <span className="hotspot-main">
                          <strong>{location.name}</strong>
                          <small>{location.type}</small>
                          <SeverityMeter score={location.risk} />
                        </span>
                        <span className="hotspot-score">
                          {location.risk}
                          <small>/100</small>
                        </span>
                        <ChevronRight size={18} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ol>

              <figure className="concept-map">
                <div className="map-canvas">
                  <div className="map-grid" aria-hidden="true" />
                  <div className="map-road road-one" aria-hidden="true" />
                  <div className="map-road road-two" aria-hidden="true" />
                  <div className="map-road road-three" aria-hidden="true" />
                  {locations.map((location) => {
                    const isSelected = selected.id === location.id;
                    return (
                      <button
                        key={location.id}
                        type="button"
                        className={`map-pin sev-${location.severity.key} ${
                          isSelected ? "is-selected" : ""
                        }`}
                        style={{
                          "--x": `${location.map.x}%`,
                          "--y": `${location.map.y}%`,
                        }}
                        aria-pressed={isSelected}
                        aria-label={`${location.name}, score ${location.risk} of 100, ${location.severity.label} severity`}
                        onClick={() => selectLocation(location.id)}
                      >
                        <span className="pin-shape" aria-hidden="true">
                          {location.risk}
                        </span>
                        <span className="pin-label" aria-hidden="true">
                          {location.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <figcaption>
                  <strong>Illustrative schematic — not a geographic map.</strong>{" "}
                  Pin positions are for orientation only. Pin shape and number show
                  severity: diamond = high, circle = moderate, square = watch.
                </figcaption>
              </figure>
            </div>

            <article className="card detail-card">
              <div className="card-head">
                <div>
                  <h3>{selected.name}</h3>
                  <p>{selected.type}</p>
                </div>
                <span className={`level-chip sev-${selected.severity.key}`}>
                  {selected.level}
                </span>
              </div>

              <div className="score-block">
                <div className="score-big">
                  {selected.risk}
                  <small>/100</small>
                </div>
                <div className="score-caption">
                  {selected.fromApi
                    ? "Screening risk score (API) — not a calibrated flood probability"
                    : "Illustrative risk score (demo data)"}
                </div>
                <div
                  className={`bar sev-${selected.severity.key}`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={selected.risk}
                  aria-label="Risk score"
                >
                  <span style={{ width: `${selected.risk}%` }} />
                </div>
                <SeverityMeter score={selected.risk} />
              </div>

              <ul className="factors">
                <li>
                  <span>
                    <CloudRain size={16} aria-hidden="true" /> Rainfall exposure
                  </span>
                  <strong>{selected.rainfall}</strong>
                </li>
                <li>
                  <span>
                    <Waves size={16} aria-hidden="true" /> Drain condition
                  </span>
                  <strong>{selected.drain}</strong>
                </li>
                <li>
                  <span>
                    <ArrowUpRight size={16} aria-hidden="true" /> Terrain elevation
                  </span>
                  <strong>{selected.elevation}</strong>
                </li>
              </ul>

              <div className="drivers">
                <div className="drivers-label">Main risk drivers</div>
                {selected.drivers.length > 0 ? (
                  <ul className="driver-chips">
                    {selected.drivers.map((driver) => (
                      <li key={driver}>{driver}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Calculate risk using the API to see the main drivers.</p>
                )}
              </div>

              <div className="suggestion">
                <div className="suggestion-icon" aria-hidden="true">
                  <Droplets size={20} />
                </div>
                <div>
                  <span>Suggested first action</span>
                  <strong>{firstActionFor(selected.id)}</strong>
                  <small>Confirm conditions on site before acting.</small>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-dark btn-block"
                onClick={() => handleNavClick("intervention-lab")}
              >
                Explore options in the Intervention Lab{" "}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </article>
          </div>

          <p className="fineprint">
            {hasApiResults
              ? "Transparent screening scores from the backend — not calibrated flood probabilities. Site inputs are illustrative."
              : "Demo data shown until you calculate risk — illustrative locations and scores, not verified flood predictions."}
          </p>
        </section>

        {/* ===== 03 INTERVENTION LAB ===== */}
        <section className="section" id="intervention-lab">
          <SectionHead
            number="03"
            eyebrow="Intervention Lab · What if?"
            title={`Explore actions for ${selected.name}`}
            description="Pick actions and resources to see an illustrative change in score. Reductions are assumptions, not validated results."
            tag={<SourceTag kind="illustrative">Illustrative assumptions</SourceTag>}
          />

          <div className="lab">
            <div className="lab-col">
              <h3 className="lab-title">1 · Choose actions</h3>
              <div className="action-list">
                {ACTIONS.map((action) => {
                  const on = selectedActions.includes(action.id);
                  return (
                    <label
                      key={action.id}
                      className={`action-card ${on ? "is-on" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleAction(action.id)}
                      />
                      <span className="check-box" aria-hidden="true">
                        {on && <Check size={14} strokeWidth={3} />}
                      </span>
                      <span className="action-copy">
                        <strong>{action.name}</strong>
                        <small>
                          <Clock size={13} aria-hidden="true" /> {action.time} min
                        </small>
                      </span>
                      <span className="action-impact">
                        −{action.reduction}
                        <small>illustrative</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="lab-col">
              <h3 className="lab-title">2 · Set resources</h3>
              <div className="card resource-card">
                <div className="slider">
                  <label htmlFor="workers-range">
                    <span>Workers</span>
                    <output htmlFor="workers-range">{workers}</output>
                  </label>
                  <input
                    id="workers-range"
                    type="range"
                    min="1"
                    max="8"
                    value={workers}
                    onChange={(e) => setWorkers(Number(e.target.value))}
                  />
                </div>
                <div className="slider">
                  <label htmlFor="minutes-range">
                    <span>Available time</span>
                    <output htmlFor="minutes-range">{minutes} min</output>
                  </label>
                  <input
                    id="minutes-range"
                    type="range"
                    min="30"
                    max="240"
                    step="15"
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </div>

                <div className={`time-check ${exceedsTime ? "is-over" : ""}`} role="status">
                  <div className="time-check-top">
                    <span>
                      <Clock size={14} aria-hidden="true" /> {totalTime} of {minutes} min
                    </span>
                    <strong>
                      {exceedsTime
                        ? `Over by ${totalTime - minutes} min`
                        : "Fits time window"}
                    </strong>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${timeFill}%` }} />
                  </div>
                  {exceedsTime && (
                    <p>Remove a task or increase the available time.</p>
                  )}
                </div>

                <p className="fineprint">
                  Task times are summed sequentially. The worker count is recorded in
                  the plan but does not change this estimate.
                </p>
              </div>
            </div>

            <div className="lab-col">
              <h3 className="lab-title">3 · See the estimate</h3>
              <div className="result-card">
                <div className="result-tag">Simulated risk · illustrative</div>

                <div className="compare">
                  <div className="compare-row">
                    <span>Before</span>
                    <strong>{selected.risk}</strong>
                    <div className="bar bar-before">
                      <span style={{ width: `${selected.risk}%` }} />
                    </div>
                  </div>
                  <div className="compare-arrow" aria-hidden="true">
                    <ArrowRight size={18} />
                  </div>
                  <div className="compare-row">
                    <span>After</span>
                    <strong>{simulatedRisk}</strong>
                    <div className="bar bar-after">
                      <span style={{ width: `${simulatedRisk}%` }} />
                    </div>
                  </div>
                </div>

                <dl className="result-summary">
                  <div>
                    <dt>Actions</dt>
                    <dd>{chosenActions.length}</dd>
                  </div>
                  <div>
                    <dt>Time needed</dt>
                    <dd>{totalTime} min</dd>
                  </div>
                  <div>
                    <dt>Score change</dt>
                    <dd>−{appliedReduction} pts</dd>
                  </div>
                </dl>

                <p className="result-note">
                  Reductions are illustrative assumptions, not measured real-world
                  results.
                </p>

                <button
                  type="button"
                  className="btn btn-lime btn-block btn-large"
                  onClick={generatePlan}
                  disabled={selectedActions.length === 0}
                >
                  <Zap size={18} aria-hidden="true" /> Generate action plan
                </button>
                {selectedActions.length === 0 && (
                  <p className="result-warning" role="alert">
                    Select at least one action to generate a plan.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ===== 04 ACTION PLANS ===== */}
        <section className="section" id="action-plans">
          <SectionHead
            number="04"
            eyebrow="Action Plans"
            title={`Pre-rain checklist for ${selected.name}`}
            description="A planning aid built from your Intervention Lab selection. Confirm each task and its timing locally."
            tag={<SourceTag kind="illustrative">Planning aid</SourceTag>}
          />

          {showPlan ? (
            <div className="plan">
              <div className="plan-summary">
                <div>
                  <span>Location</span>
                  <strong>{selected.name}</strong>
                  <small>
                    {selected.risk}/100 · {selected.level}
                  </small>
                </div>
                <div>
                  <span>Total time</span>
                  <strong>{totalTime} min</strong>
                  <small>of {minutes} min available</small>
                </div>
                <div>
                  <span>Crew</span>
                  <strong>
                    {workers} {workers === 1 ? "worker" : "workers"}
                  </strong>
                  <small>recorded, not used in estimate</small>
                </div>
                <div className={exceedsTime ? "is-over" : "is-fit"}>
                  <span>Time window</span>
                  <strong>{exceedsTime ? "Exceeds window" : "Fits window"}</strong>
                  <small>
                    {exceedsTime
                      ? `Over by ${totalTime - minutes} min`
                      : `${minutes - totalTime} min spare`}
                  </small>
                </div>
              </div>

              {planItems.length === 0 ? (
                <p className="alert alert-warn" role="alert">
                  No actions selected. Choose at least one action in the Intervention
                  Lab.
                </p>
              ) : (
                <>
                  <div className="progress" aria-live="polite">
                    <span>
                      {doneCount} of {planItems.length} tasks done
                    </span>
                    <div className="bar">
                      <span
                        style={{ width: `${(doneCount / planItems.length) * 100}%` }}
                      />
                    </div>
                  </div>

                  <ol className="checklist">
                    {planItems.map((item) => {
                      const done = completed.includes(item.id);
                      return (
                        <li key={item.id} className={done ? "is-done" : ""}>
                          <label>
                            <input
                              type="checkbox"
                              checked={done}
                              onChange={() => toggleDone(item.id)}
                            />
                            <span className="check-box" aria-hidden="true">
                              {done && <Check size={14} strokeWidth={3} />}
                            </span>
                            <span className="step-num" aria-hidden="true">
                              {item.step}
                            </span>
                            <span className="step-copy">
                              <strong>{item.name}</strong>
                              <small>
                                {selected.name} · running total {item.running} min
                              </small>
                            </span>
                            <span className="step-meta">
                              <span>{item.time} min</span>
                              <small>−{item.reduction} pts (illustrative)</small>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}

              {exceedsTime && planItems.length > 0 && (
                <p className="alert alert-warn" role="alert">
                  Reduce the selected tasks or increase the available time to fit the
                  window.
                </p>
              )}

              <p className="fineprint">
                Risk reductions shown are illustrative assumptions. This prototype
                does not verify drainage conditions or guarantee actual risk
                reduction.
              </p>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">
                <CheckCircle2 size={26} />
              </div>
              <div>
                <h3>No plan generated yet</h3>
                <p>
                  Choose actions in the Intervention Lab and generate a plan. It
                  will appear here as a checklist you can tick off.
                </p>
                <div className="empty-actions">
                  <button
                    type="button"
                    className="btn btn-dark"
                    onClick={generatePlan}
                    disabled={selectedActions.length === 0}
                  >
                    Generate plan from current selection
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => handleNavClick("intervention-lab")}
                  >
                    Go to the Intervention Lab
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <footer className="footer">
          <span>DRAINWATCH · Environmental decision support</span>
          <span>Prototype · Verify data before real-world use</span>
        </footer>
      </main>
    </div>
  );
}

export default App;