/* Mosaik – Wetter */
"use strict";

/* ================= Wetter (nur für Zusammenhänge) ================= */
// state.wloc[date] = [lat, lon] (auf ca. 1 km gerundet, erster Standort des Tages)
// state.weather[date] = { t: Höchsttemperatur °C, r: Niederschlag mm, s: Sonnenstunden }
const W = () => { if (!state.weather || typeof state.weather !== "object") state.weather = {}; return state.weather; };
const WL = () => { if (!state.wloc || typeof state.wloc !== "object") state.wloc = {}; return state.wloc; };
const WDAILY = "temperature_2m_max,precipitation_sum,sunshine_duration";

// Wetter als „Fragen“ für die Zusammenhänge – nur als Faktor, nie als eigener Trend
const WEATHER_QS = [
  { id: "__w_t", k: "t", text: "Höchsttemperatur", type: "number", unit: "°C", weather: true, lead: "Je wärmer es ist" },
  { id: "__w_s", k: "s", text: "Sonnenstunden", type: "number", unit: "h", weather: true, lead: "Je mehr die Sonne scheint" },
  { id: "__w_r", k: "r", text: "Regenmenge", type: "number", unit: "mm", weather: true, lead: "Je mehr es regnet" }
];
const RAIN_Q = { id: "__w_rain", text: "Regen", type: "choice", options: ["Ja", "Nein"], weather: true };
const weatherOn = () => settings.places && settings.places.on && Object.keys(W()).length > 0; // Wetter läuft automatisch mit „Orte“
function weatherAns(d, q) {
  const w = W()[d];
  if (!w) return undefined;
  if (q.id === "__w_rain") return typeof w.r === "number" ? (w.r >= 1 ? "Ja" : "Nein") : undefined;
  const v = w[q.k];
  return typeof v === "number" ? v : undefined;
}

function storeDaily(j) {
  const d = j && j.daily;
  if (!d || !Array.isArray(d.time)) return 0;
  let n = 0;
  d.time.forEach((day, i) => {
    const t = d.temperature_2m_max[i], r = d.precipitation_sum[i], s = d.sunshine_duration[i];
    if (t === null || t === undefined) return; // noch keine Daten
    W()[day] = { t: Math.round(t * 10) / 10, r: Math.round((r || 0) * 10) / 10, s: Math.round(((s || 0) / 3600) * 10) / 10 };
    n++;
  });
  return n;
}

let weatherBusy = false;
// Fehlende abgeschlossene Tage mit bekanntem Standort nachladen (max. 1× pro Stunde)
async function syncWeather(force) {
  if (!settings.places || !settings.places.on || weatherBusy) return;
  if (!force && settings.weather.last && Date.now() - settings.weather.last < 3600e3) return;
  weatherBusy = true;
  try {
    const t = todayIso(), from = addDays(t, -30);
    const missing = Object.keys(WL()).filter((d) => d < t && d >= from && !W()[d]);
    const byLoc = {};
    missing.forEach((d) => { const k = WL()[d].join(","); (byLoc[k] = byLoc[k] || []).push(d); });
    let n = 0;
    for (const [k, ds] of Object.entries(byLoc)) {
      const [lat, lon] = k.split(",");
      const start = ds.sort()[0];
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${WDAILY}&timezone=Europe%2FBerlin&start_date=${start}&end_date=${addDays(t, -1)}`);
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const j = await res.json();
      // nur die Tage übernehmen, an denen man an diesem Ort war
      const keep = new Set(ds);
      const tmp = {};
      j.daily.time.forEach((day, i) => { if (keep.has(day)) tmp[day] = i; });
      storeDaily({ daily: { time: Object.keys(tmp), temperature_2m_max: Object.values(tmp).map((i) => j.daily.temperature_2m_max[i]), precipitation_sum: Object.values(tmp).map((i) => j.daily.precipitation_sum[i]), sunshine_duration: Object.values(tmp).map((i) => j.daily.sunshine_duration[i]) } });
      n += ds.length;
    }
    settings.weather.last = Date.now(); settings.weather.err = ""; saveSettings();
    if (n) save();
  } catch (e) {
    settings.weather.err = e.message || "Wetter nicht abrufbar"; saveSettings();
  } finally { weatherBusy = false; }
}
