/* Mosaik – Orte */
"use strict";

/* ================= Orte (Standort beim Öffnen) ================= */
// Gespeichert in state.places: { "2026-10-16": [{ c: "Wedel", t: "08:12" }, { c: "Hamburg", t: "12:40" }] }
// Aufeinanderfolgende gleiche Orte werden zusammengefasst. Koordinaten werden nicht gespeichert.
const PLACE_MIN_GAP = 20 * 60 * 1000; // höchstens alle 20 Minuten abfragen
const P = () => { if (!state.places || typeof state.places !== "object") state.places = {}; return state.places; };
const placesOn = (d) => (P()[d] || []).map((x) => x.c);
const placeCities = (d) => Array.from(new Set(placesOn(d))); // ohne Wiederholungen

function addPlace(date, city, time) {
  const list = P()[date] || (P()[date] = []);
  const last = list[list.length - 1];
  if (last && last.c === city) return false;
  list.push({ c: city, t: time });
  return true;
}

// Ortsname über Koordinaten: kostenloser Dienst, Koordinaten auf ca. 1 km gerundet, Ergebnis wird zwischengespeichert
const GEO_CACHE_KEY = "mosaik.geocache";
async function cityFor(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}"); } catch (e) { /* leer */ }
  if (cache[key]) return cache[key];
  // 1. BigDataCloud, 2. OpenStreetMap (Nominatim) als Ersatz
  let city = "", why = "";
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&localityLanguage=de`);
    if (!res.ok) throw new Error(`BigDataCloud ${res.status}`);
    const j = await res.json();
    city = (j.city || j.locality || "").trim();
  } catch (e) { why = e.message || "BigDataCloud"; }
  if (!city) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=de&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`);
      if (!res.ok) throw new Error(`OpenStreetMap ${res.status}`);
      const a = (await res.json()).address || {};
      city = (a.city || a.town || a.village || a.municipality || a.county || "").trim();
    } catch (e) { why += (why ? ", " : "") + (e.message || "OpenStreetMap"); }
  }
  if (!city) { const err = new Error("Ortsname nicht abrufbar" + (why ? ` (${why})` : "")); err.geo = true; throw err; }
  cache[key] = city;
  const keys = Object.keys(cache);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((k) => delete cache[k]);
  try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* egal */ }
  return city;
}

let placeBusy = false;
async function capturePlace(manual) {
  if (!settings.places || !settings.places.on || !("geolocation" in navigator)) return;
  if (placeBusy) return;
  if (!manual && settings.places.last && Date.now() - settings.places.last < PLACE_MIN_GAP) return;
  // Ohne dauerhafte Erlaubnis fragt iOS jedes Mal nach → automatisch höchstens einmal am Tag nachfragen
  if (!manual) {
    let state = "unknown";
    try { if (navigator.permissions) state = (await navigator.permissions.query({ name: "geolocation" })).state; } catch (e) { /* nicht unterstützt */ }
    if (state === "denied") return;
    if (state !== "granted") {
      if (settings.places.askedDay === todayIso()) return;
      settings.places.askedDay = todayIso(); saveSettings();
    }
  }
  placeBusy = true;
  try {
    const get = (high) => new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: high, timeout: high ? 30000 : 15000, maximumAge: manual ? 0 : 10 * 60 * 1000 }));
    // grob zuerst (schnell, sparsam); klappt das nicht, einmal mit GPS
    let pos;
    try { pos = await get(false); } catch (e) { if (e && e.code === 1) throw e; pos = await get(true); }
    const city = await cityFor(pos.coords.latitude, pos.coords.longitude);
    const now = new Date();
    if (!WL()[iso(now)]) { WL()[iso(now)] = [+pos.coords.latitude.toFixed(2), +pos.coords.longitude.toFixed(2)]; save(); }
    settings.places.loc = [+pos.coords.latitude.toFixed(2), +pos.coords.longitude.toFixed(2)];
    settings.places.last = now.getTime(); settings.places.err = ""; saveSettings();
    const changed = addPlace(iso(now), city, `${pad(now.getHours())}:${pad(now.getMinutes())}`);
    if (changed) { save(); if (tab === "day" && !quiz && current === iso(now)) renderDay(); }
    if (manual) toast(`Ort: ${city}`);
  } catch (e) {
    const msg = e && e.code === 1 ? "Standort nicht erlaubt. iPhone-Einstellungen → Datenschutz & Sicherheit → Ortungsdienste → Safari-Websites → „Beim Verwenden“."
      : e && e.code === 2 ? "Standort gerade nicht verfügbar (kein GPS/WLAN-Signal?)."
      : e && e.code === 3 ? "Standort hat zu lange gedauert."
      : e && e.geo ? e.message + "."
      : "Ort konnte nicht ermittelt werden" + (e && e.message ? ` (${e.message})` : "") + ".";
    settings.places.err = `${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}: ${msg}`; saveSettings();
    if (manual) { toast(msg.length > 60 ? msg.slice(0, 58) + "…" : msg); if (tab === "data") renderData(); }
  } finally { placeBusy = false; }
  syncWeather(false);
  refreshNowWeather();
}

// Aktuelles Wetter am letzten Standort (für die Anzeige auf „Tag“, 30 Min. zwischengespeichert)
const WCODE = [
  [[0], "☀️", "Sonnig"], [[1], "🌤️", "Überwiegend sonnig"], [[2], "⛅", "Teils bewölkt"], [[3], "☁️", "Bewölkt"],
  [[45, 48], "🌫️", "Nebel"], [[51, 53, 55, 56, 57], "🌦️", "Nieselregen"], [[61, 63, 65, 66, 67, 80, 81, 82], "🌧️", "Regen"],
  [[71, 73, 75, 77, 85, 86], "🌨️", "Schnee"], [[95, 96, 99], "⛈️", "Gewitter"]
];
const wcode = (c, day) => { const m = WCODE.find(([cs]) => cs.includes(c)) || [[], "🌡️", ""]; return { icon: !day && c <= 2 ? "🌙" : m[1], text: m[2] }; };
let nowWeather = null, nowWeatherBusy = false;
async function refreshNowWeather() {
  const loc = settings.places && settings.places.on && settings.places.loc;
  if (!loc || nowWeatherBusy) return;
  if (nowWeather && nowWeather.key === loc.join(",") && Date.now() - nowWeather.at < 30 * 60e3) return;
  nowWeatherBusy = true;
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc[0]}&longitude=${loc[1]}&current=temperature_2m,weather_code,is_day&timezone=Europe%2FBerlin`);
    if (!res.ok) throw new Error();
    const c = (await res.json()).current;
    nowWeather = { key: loc.join(","), at: Date.now(), temp: Math.round(c.temperature_2m), ...wcode(c.weather_code, c.is_day) };
    if (tab === "day" && !quiz && current === todayIso()) { const el = $("#placeedit"); if (el) el.outerHTML = placeLine(current); $("#placeedit")?.addEventListener("click", () => openPlaces(current)); }
  } catch (e) { /* ohne Wetter weiter */ } finally { nowWeatherBusy = false; }
}

// Zeile unter dem Datum auf „Tag“
function placeLine(date) {
  const list = P()[date] || [];
  // ohne erfassten Ort nichts anzeigen (heute höchstens das aktuelle Wetter)
  if (!list.length && !(date === todayIso() && nowWeather)) return "";
  // heute: aktuelles Wetter; frühere Tage: Höchsttemperatur des Tages
  let wx = "";
  if (date === todayIso() && nowWeather) wx = `<span class="pwx" title="${esc(nowWeather.text)}">${nowWeather.icon} ${nowWeather.temp} °C</span>`;
  else if (date !== todayIso() && state.weather && state.weather[date]) {
    const w = state.weather[date];
    wx = `<span class="pwx" title="Höchsttemperatur">${w.r >= 1 ? "🌧️" : w.s >= 6 ? "☀️" : "⛅"} max ${Math.round(w.t)} °C</span>`;
  }
  return `<button class="placeline" id="placeedit" aria-label="Orte des Tages bearbeiten">
    ${list.length ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>` : ""}
    ${list.length ? `<span>${list.map((x) => esc(x.c)).join(" → ")}</span>` : ""}${list.length ? wx : wx.replace('class="pwx"', 'class="pwx solo"')}
  </button>`;
}

// Orte eines Tages ansehen, löschen, von Hand ergänzen
function openPlaces(date) {
  const dlg = $("#sheet");
  const draw = () => {
    const list = P()[date] || [];
    const known = Array.from(new Set(Object.values(P()).flat().map((x) => x.c))).filter((c) => !list.length || list[list.length - 1].c !== c).slice(0, 8);
    dlg.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><span></span><h2>Orte · ${longDate(date)}</h2><button type="button" class="linkbtn" id="pdone">Fertig</button></div>
      <section class="sq">
        ${list.length ? `<ul class="plist">${list.map((x, i) => `<li><span class="pt muted">${esc(x.t || "")}</span><span class="pc">${esc(x.c)}</span><button type="button" class="iconbtn" data-pdel="${i}" aria-label="Entfernen">✕</button></li>`).join("")}</ul>`
          : `<p class="muted small" style="margin:0">Für diesen Tag ist noch kein Ort gespeichert.</p>`}
      </section>
      <section class="sq">
        <strong>Ort hinzufügen</strong>
        ${known.length ? `<div class="chips" style="margin-top:10px">${known.map((c) => `<button type="button" class="chip" data-padd="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
        <div class="gline"><input id="pnew" class="flabel" placeholder="z. B. Hamburg" autocomplete="off"><button type="button" class="btn" id="paddbtn">Hinzufügen</button></div>
        ${date === todayIso() && settings.places && settings.places.on ? `<button type="button" class="btn ghost block" id="pnow" style="margin-top:12px">Aktuellen Standort jetzt erfassen</button>` : ""}
      </section>
    </div>`;
    $("#pdone", dlg).addEventListener("click", () => dlg.close());
    const add = (c) => {
      c = c.trim(); if (!c) return;
      const now = new Date();
      addPlace(date, c, date === todayIso() ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : "");
      save(); draw(); render();
    };
    dlg.querySelectorAll("[data-pdel]").forEach((b) => b.addEventListener("click", () => {
      const l = P()[date]; l.splice(+b.dataset.pdel, 1); if (!l.length) delete P()[date];
      save(); draw(); render();
    }));
    dlg.querySelectorAll("[data-padd]").forEach((b) => b.addEventListener("click", () => add(b.dataset.padd)));
    $("#paddbtn", dlg).addEventListener("click", () => add($("#pnew", dlg).value));
    $("#pnew", dlg).addEventListener("keydown", (e) => { if (e.key === "Enter") add(e.target.value); });
    $("#pnow", dlg)?.addEventListener("click", async () => { await capturePlace(true); draw(); });
  };
  draw();
  dlg.showModal();
  document.activeElement?.blur();
}

// Analyse: Orte im Zeitraum – jeder Ort zählt pro Tag höchstens einmal
const PLACE_PREVIEW = 6;
let showAllPlaces = false;
function placesPanel(days) {
  const counts = {};
  let withPlace = 0;
  for (const d of days) {
    const cs = placeCities(d);
    if (cs.length) withPlace++;
    cs.forEach((c) => (counts[c] = (counts[c] || 0) + 1));
  }
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"));
  if (!rows.length) {
    return `<section class="panel"><h2 class="atitle">Orte</h2><p class="muted small" style="margin:0">${settings.places && settings.places.on ? "Im gewählten Zeitraum wurde noch kein Ort erfasst." : "Noch keine Orte. Einschalten unter Einstellungen → Orte."}</p></section>`;
  }
  const shown = showAllPlaces ? rows : rows.slice(0, PLACE_PREVIEW);
  return `<section class="panel acard places">
    <h2 class="atitle">Orte</h2>
    <p class="hero"><span class="big">${rows.length}</span><span class="muted">${rows.length === 1 ? "Ort" : "verschiedene Orte"}</span></p>
    <div class="bars">${shown.map(([c, n]) => `<div class="barrow static">
      <span class="bl">${esc(c)}</span>
      <span class="bt"><span style="width:${(n / withPlace) * 100}%"></span></span>
      <span class="bv">${n} von ${withPlace}</span>
    </div>`).join("")}</div>
    ${rows.length > PLACE_PREVIEW ? `<button class="btn ghost block" id="pmore" style="margin-top:10px">${showAllPlaces ? "Weniger anzeigen" : `Alle Orte anzeigen (${rows.length - PLACE_PREVIEW} weitere)`}</button>` : ""}
  </section>`;
}

// Für Trends: Orte wie eine Auswahlfrage behandeln („an Tagen in Hamburg“)
function placeGroupings(days) {
  const counts = {};
  let withPlace = 0;
  for (const d of days) { const cs = placeCities(d); if (cs.length) withPlace++; cs.forEach((c) => (counts[c] = (counts[c] || 0) + 1)); }
  const PQ = { id: "__place", text: "Ort", type: "choice", options: Object.keys(counts) };
  return Object.entries(counts)
    .filter(([, n]) => n >= MIN_GROUP && withPlace - n >= MIN_GROUP) // nur Orte, die nicht an (fast) allen Tagen vorkommen
    .map(([c]) => ({ q: PQ, opt: c, label: `Aufenthalt in „${esc(c)}“` }));
}

// Wochenbericht: Orte der Woche
function weekPlaces(mon) {
  const counts = {};
  for (let i = 0; i < 7; i++) placeCities(addDays(mon, i)).forEach((c) => (counts[c] = (counts[c] || 0) + 1));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
