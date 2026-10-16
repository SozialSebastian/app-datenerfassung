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
for (const q of state.questions) {
  if (!q.format && q.healthKey === "schlaf") { q.format = "duration"; if (q.unit === "Stunden") q.unit = ""; }
  if (!q.format && q.healthKey === "schlafenszeit") q.format = "clock";
}
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

// Alle Fragen in Anzeigereihenfolge: Folgefragen stehen direkt hinter ihrer Ausgangsfrage
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
  state.questions.filter((q) => !q.cond || !ids.has(q.cond.qid)).forEach((q) => visit(q, 0));
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

// Health-Felder werden automatisch gefüllt und nicht abgefragt
const isHealthQ = (q) => q.source === "health";
const askQuestions = (date) => visibleQuestions(date).filter((q) => !isHealthQ(q));
const healthQuestions = () => ordered().map((o) => o.q).filter((q) => isHealthQ(q) && !q.archived);

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
  if (q.type === "scale") return `Skala ${q.min}–${q.max}`;
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
    if (q.format === "clock" && h < 12) h += 24; // nach Mitternacht → 24+ (für Durchschnitt und Grafik)
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
    let btns = "";
    for (let i = q.min; i <= q.max; i++) btns += `<button class="chip" data-val="${i}" aria-pressed="${val === i}">${i}</button>`;
    let s = `<div class="scale">${btns}</div>`;
    if (q.minLabel || q.maxLabel) s += `<div class="scale-labels"><span>${esc(q.minLabel)}</span><span>${esc(q.maxLabel)}</span></div>`;
    return s;
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
