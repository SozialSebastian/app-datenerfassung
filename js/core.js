/* Mosaik – Grundlagen: Speicher, Hilfsfunktionen, Navigation, Antwort-Eingaben */
"use strict";

/* ================= Speicher ================= */
const KEY = "taeglich.v1";
const empty = () => ({ version: 1, questions: [], answers: {}, lastBackup: null });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const s = JSON.parse(raw);
    return { ...empty(), ...s };
  } catch (e) {
    console.error(e);
    return empty();
  }
}
let state = load();
// Health-Zeitfelder richtig formatieren (auch bei schon vorhandenen Fragen)
// Themen für bestehende Fragen einmalig vorschlagen (änderbar im Fragen-Editor)
for (const q of state.questions) if (!q.theme && !q.cond) q.theme = guessTheme(q);
for (const q of state.questions) {
  if (!q.format && q.healthKey === "schlaf") { q.format = "duration"; if (q.unit === "Stunden") q.unit = ""; }
  // Skala: früher nur Text links/rechts → jetzt Beschreibung je Zahl
  if (q.type === "scale" && !q.labels && (q.minLabel || q.maxLabel)) { q.labels = {}; if (q.minLabel) q.labels[q.min] = q.minLabel; if (q.maxLabel) q.labels[q.max] = q.maxLabel; }
  if (q.healthKey === "schlafenszeit" && q.text === "Schlafenszeit") q.text = "Einschlafzeit"; // eindeutiger als „Schlafenszeit“
  if (!q.format && (q.healthKey === "schlafenszeit" || q.healthKey === "aufwachzeit")) q.format = "clock";
}
// Beschreibung einer Skalen-Zahl (z. B. 3 → „gut“), sonst ""
const scaleLabel = (q, s) => String(((q.labels || {})[s]) ?? (s === q.min ? q.minLabel : s === q.max ? q.maxLabel : "") ?? "").trim();
const hasScaleLabels = (q) => { for (let i = q.min; i <= q.max; i++) if (scaleLabel(q, i)) return true; return false; };
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}
// Browser bitten, die Daten nicht automatisch zu löschen
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ================= Hilfsfunktionen ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); };
const todayIso = () => iso(new Date());
const WD = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MON = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const longDate = (s) => { const d = parseIso(s); return `${d.getDate()}. ${MON[d.getMonth()]}`; };
const mondayOf = (s) => { const d = parseIso(s); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return iso(d); };

const parseNum = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const fmtNum = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

const isAnswered = (v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
const qById = (id) => state.questions.find((q) => q.id === id);
const childrenOf = (id) => state.questions.filter((q) => q.cond && q.cond.qid === id);

/* ---------- Themen ---------- */
const THEMES = [
  { k: "sport", l: "Sport", i: "🏃" },
  { k: "health", l: "Gesundheit", i: "❤️" },
  { k: "food", l: "Ernährung", i: "🍽️" },
  { k: "mood", l: "Wohlbefinden", i: "🙂" },
  { k: "work", l: "Arbeit & Uni", i: "💼" },
  { k: "social", l: "Soziales", i: "👥" },
  { k: "other", l: "Sonstiges", i: "📦" }
];
const THEME_IDX = Object.fromEntries(THEMES.map((t, i) => [t.k, i]));
const themeById = (k) => THEMES[THEME_IDX[k] ?? THEME_IDX.other];
// Vorschlag anhand von Health-Kürzel und Fragetext
function guessTheme(q) {
  const hk = q.healthKey || "";
  if (/^(schritte|distanz|training|kalorien|aktivkalorien|stockwerke|stehen)$/.test(hk)) return "sport";
  if (hk) return /achtsamkeit/.test(hk) ? "mood" : "health";
  if (q.friends) return "social";
  const t = (q.text || "").toLowerCase();
  const has = (re) => re.test(t);
  if (has(/boulder|kletter|paddel|volleyball|sport|lauf|jogg|rad ?fahr|schwimm|training|fitness|gym|yoga|tango|tanz|wander|fußball|tennis|workout/)) return "sport";
  if (has(/schlaf|krank|puls|gewicht|medikament|kopfschmerz|arzt|gesund/)) return "health";
  if (has(/alkohol|süß|essen|gegessen|kaffee|wasser|vegetar|vegan|gekocht|snack|zucker|bier|wein|fleisch|getrunken/)) return "food";
  if (has(/laune|stimmung|geht'?s|gefühl|stress|energie|zufrieden|glück|motivation|meditat|müde/)) return "mood";
  if (has(/arbeit|uni\b|uni |lern|vorlesung|büro|tutor|klausur|studium|home ?office|hwwi/)) return "work";
  if (has(/mit wem|freund|getroffen|treffen|familie|date|telefon|partner|besuch/)) return "social";
  return "other";
}
// Thema einer Frage; Folgefragen erben das Thema ihrer Ausgangsfrage
function themeOf(q, guard = 0) {
  if (q.theme && THEME_IDX[q.theme] !== undefined && !q.cond) return q.theme;
  if (q.cond && guard < 20) { const p = qById(q.cond.qid); if (p) return themeOf(p, guard + 1); }
  return q.theme && THEME_IDX[q.theme] !== undefined ? q.theme : guessTheme(q);
}

// Alle Fragen in Anzeigereihenfolge: nach Thema, innerhalb in eigener Reihenfolge; Folgefragen direkt hinter ihrer Ausgangsfrage
function ordered() {
  const ids = new Set(state.questions.map((q) => q.id));
  const out = [];
  const seen = new Set();
  const visit = (q, depth) => {
    if (seen.has(q.id)) return;
    seen.add(q.id);
    out.push({ q, depth });
    childrenOf(q.id).forEach((c) => visit(c, depth + 1));
  };
  const roots = state.questions.filter((q) => !q.cond || !ids.has(q.cond.qid));
  roots.map((q, i) => ({ q, i, t: THEME_IDX[themeOf(q)] })).sort((a, b) => a.t - b.t || a.i - b.i).forEach((x) => visit(x.q, 0));
  state.questions.forEach((q) => visit(q, 0)); // Sicherheitsnetz
  return out;
}

// Ist die Bedingung einer Folgefrage an diesem Tag erfüllt?
function condMet(q, a, guard = 0) {
  if (!q.cond) return true;
  const p = qById(q.cond.qid);
  if (!p || p.archived || guard > 20) return false;
  if (!condMet(p, a, guard + 1)) return false;
  const v = a[p.id];
  if (!isAnswered(v)) return false;
  const vals = (Array.isArray(v) ? v : [v]).map(String);
  return vals.some((x) => q.cond.values.includes(x));
}

const visibleQuestions = (date) => {
  const a = state.answers[date] || {};
  return ordered().map((o) => o.q).filter((q) => !q.archived && condMet(q, a));
};

// Health- und Schach-Felder werden automatisch gefüllt und nicht abgefragt (vollständig ist erst der Vortag)
const isHealthQ = (q) => q.source === "health" || q.source === "chess";
// Werte, die im Lauf des Tages noch wachsen (Schritte, Partien …) – heute erst morgen zählen.
// Schlaf gehört zum Tag des Aufwachens und ist morgens schon vollständig.
const NIGHT_KEYS = ["schlaf", "schlafenszeit", "aufwachzeit"];
const todayOpen = (q) => isHealthQ(q) && !NIGHT_KEYS.includes(q.healthKey);
const askQuestions = (date) => visibleQuestions(date).filter((q) => !isHealthQ(q));
const healthQuestions = () => ordered().map((o) => o.q).filter((q) => q.source === "health" && !q.archived);

function setAnswer(date, qid, value) {
  if (!state.answers[date]) state.answers[date] = {};
  const a = state.answers[date];
  if (isAnswered(value)) a[qid] = value;
  else delete a[qid];
  // Antworten von Folgefragen entfernen, deren Bedingung nicht mehr erfüllt ist
  let changed = true;
  while (changed) {
    changed = false;
    for (const q of state.questions) {
      if (q.cond && a[q.id] !== undefined && !condMet(q, a)) { delete a[q.id]; changed = true; }
    }
  }
  if (Object.keys(a).length === 0) delete state.answers[date];
  save();
  if (typeof reportStatus === "function" && date === todayIso()) reportStatus();
}

function dayProgress(date) {
  const qs = askQuestions(date);
  if (!qs.length) return 0;
  const a = state.answers[date] || {};
  return qs.filter((q) => isAnswered(a[q.id])).length / qs.length;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

const typeLabel = { choice: "Auswahl", scale: "Skala", number: "Zahl" };
// Welche Richtung ist gut? "high" | "low" | null (neutral). Health-Felder haben sinnvolle Vorgaben.
function betterDir(q) {
  if (q.better === "high" || q.better === "low") return q.better;
  if (q.better === "none") return null;
  return { schritte: "high", schlaf: "high", schlafenszeit: "low" }[q.healthKey] || null;
}
function describe(q) {
  if (q.type === "choice") return q.options.join(" / ") + (q.multi ? " (mehrere)" : "");
  if (q.type === "scale") return `Skala ${q.min}–${q.max}${hasScaleLabels(q) ? ` (${[q.min, q.max].map((s) => scaleLabel(q, s)).filter(Boolean).join(" … ")})` : ""}`;
  return `Zahl${q.unit ? " in " + q.unit : ""}`;
}
function condText(q) {
  if (!q.cond) return "";
  const p = qById(q.cond.qid);
  return p ? `wenn „${p.text}“ = ${q.cond.values.join(" oder ")}` : "";
}
const fmtVal = (v) => (Array.isArray(v) ? v.join(", ") : typeof v === "number" ? fmtNum(v) : v);
// Zeitwerte werden als Stunden gespeichert: Dauer 7,3833 = 7 h 23 min; Uhrzeit 23,5 = 23:30, 24,75 = 00:45
const fmtDur = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
const fmtClock = (h) => { let m = Math.round(h * 60) % 1440; if (m < 0) m += 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
// Wert einer Frage lesbar machen (mit Einheit)
function fmtQ(q, v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && q.format === "duration") return fmtDur(v);
  if (typeof v === "number" && q.format === "clock") return fmtClock(v);
  return fmtVal(v) + (q.unit && typeof v === "number" ? " " + q.unit : "");
}
// Eingabe zurückverwandeln: „7:23“, „7 h 23“, „7,4“ bzw. „23:10“, „0:40“
function parseQ(q, text) {
  const t = String(text || "").trim();
  if (t === "") return null;
  if (q.format === "duration" || q.format === "clock") {
    const m = t.match(/^(\d{1,2})\s*(?:[:.h]|\s)\s*(\d{1,2})(?:\s*min)?$/i);
    let h = m ? Number(m[1]) + Number(m[2]) / 60 : parseNum(t);
    if (Number.isNaN(h)) return NaN;
    if (q.format === "clock" && h < 12 && q.healthKey !== "aufwachzeit") h += 24; // abends: nach Mitternacht → 24+ (für Durchschnitt und Grafik); Aufwachzeit bleibt morgens
    return Math.round(h * 10000) / 10000;
  }
  return parseNum(t);
}

/* ================= Navigation ================= */
let tab = "day";
let current = todayIso();
let quiz = null; // { date, idx } während einer Abfrage

document.querySelectorAll(".tabbar button").forEach((b) =>
  b.addEventListener("click", () => { quiz = null; tab = b.dataset.tab; render(); window.scrollTo(0, 0); })
);

function render() {
  document.body.classList.toggle("in-quiz", !!quiz);
  document.body.dataset.tab = quiz ? "quiz" : tab; // nur für die Desktop-Ansicht (Spalten je Bereich)
  document.querySelectorAll(".tabbar button").forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (quiz) renderQuiz();
  else if (tab === "day") renderDay();
  else if (tab === "friends") renderFriends();
  else if (tab === "analysis") renderAnalysis();
  else renderData();
}

/* ================= Antwort-Eingaben (Tag und Abfrage) ================= */
function answerInput(q, val) {
  if (q.type === "choice") {
    const sel = (o) => (q.multi ? Array.isArray(val) && val.includes(o) : val === o);
    return `<div class="chips">${q.options.map((o) =>
      `<button class="chip" data-val="${esc(o)}" aria-pressed="${sel(o)}">${esc(o)}</button>`).join("")}</div>
      ${q.multi ? `<p class="q-hint">Mehrere möglich</p>` : ""}`;
  }
  if (q.type === "scale") {
    // mit Beschreibungen: bis 6 Stufen Text unter der Zahl, sonst untereinander („7 · gut“)
    const lab = hasScaleLabels(q), rows = lab && q.max - q.min > 5;
    let btns = "";
    for (let i = q.min; i <= q.max; i++) {
      const l = scaleLabel(q, i);
      btns += `<button class="chip" data-val="${i}" aria-pressed="${val === i}"><span class="sn">${i}</span>${lab ? `<span class="sl">${esc(l)}</span>` : ""}</button>`;
    }
    return `<div class="scale${lab ? " labeled" : ""}${rows ? " rows" : ""}">${btns}</div>`;
  }
  return `<div class="numrow">
      <input type="text" inputmode="${q.format ? "text" : "decimal"}" autocomplete="off" value="${esc(q.format ? fmtQ(q, val) : fmtNum(val))}" aria-label="${esc(q.text)}" placeholder="${q.format === "clock" ? "23:30" : q.format === "duration" ? "7:30" : "–"}">
      ${q.unit && !q.format ? `<span class="unit">${esc(q.unit)}</span>` : ""}
      ${isAnswered(val) ? `<button class="clear" data-clear>Leeren</button>` : ""}
    </div>`;
}

// after(kind): "pick" = Einzelauswahl getippt, "input" = Zahl geändert (ohne Neuzeichnen,
// sonst geht der nächste Tipp verloren), "enter" = Zahl mit Eingabetaste bestätigt, "edit" = sonstiges
function wireInput(root, q, date, after) {
  const cur = () => (state.answers[date] || {})[q.id];

  root.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    const c = cur();
    if (q.type === "choice" && q.multi) {
      const arr = Array.isArray(c) ? [...c] : [];
      const i = arr.indexOf(b.dataset.val);
      if (i >= 0) arr.splice(i, 1); else arr.push(b.dataset.val);
      const order = q.options.filter((o) => arr.includes(o)); // Reihenfolge wie Antwortliste
      setAnswer(date, q.id, order);
      after("edit");
      return;
    }
    const v = q.type === "scale" ? Number(b.dataset.val) : b.dataset.val;
    if (c === v) { setAnswer(date, q.id, null); after("edit"); } // erneutes Tippen hebt Auswahl auf
    else { setAnswer(date, q.id, v); after("pick"); }
  }));

  const inp = root.querySelector("input");
  if (inp) {
    const commit = () => {
      const n = q.format ? parseQ(q, inp.value) : parseNum(inp.value);
      if (Number.isNaN(n)) { toast(q.format ? "Bitte so eingeben: 7:30" : "Bitte eine Zahl eingeben, z. B. 7,5"); inp.value = q.format ? fmtQ(q, cur()) : fmtNum(cur()); return false; }
      if (q.format && n !== null) inp.value = fmtQ(q, n);
      if (n === (cur() ?? null)) return true;
      setAnswer(date, q.id, n);
      return true;
    };
    inp.addEventListener("change", () => { if (commit()) after("input"); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (commit()) after("enter"); } });
    root._commit = commit;
  }
  root.querySelector("[data-clear]")?.addEventListener("click", () => { setAnswer(date, q.id, null); after("edit"); });
}
