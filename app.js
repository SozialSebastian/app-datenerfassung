/* Mosaik – tägliche Fragen erfassen, lokal speichern, als Excel exportieren. */
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

/* ================= Tag ================= */
function renderDay() {
  const view = $("#view");
  const t = todayIso();
  const d = parseIso(current);
  const isToday = current === t;
  const label = isToday ? "Heute" : current === addDays(t, -1) ? "Gestern" : WD[d.getDay()];

  const mon = mondayOf(current);
  let week = `<button class="nav" data-week="-7" aria-label="Vorherige Woche">‹</button>`;
  for (let i = 0; i < 7; i++) {
    const ds = addDays(mon, i);
    const p = dayProgress(ds);
    const dd = parseIso(ds);
    const cls = ["day", ds === t ? "is-today" : "", ds > t ? "future" : ""].join(" ");
    week += `<button class="${cls}" data-date="${ds}" ${ds === current ? 'aria-current="date"' : ""} aria-label="${WD[dd.getDay()]}, ${longDate(ds)}, ${Math.round(p * 100)} % beantwortet">
      <span>${WD_SHORT[dd.getDay()]}</span>
      <span class="hold ${p === 0 ? "empty" : ""}" style="--p:${p}"></span>
      <span class="num">${dd.getDate()}</span>
    </button>`;
  }
  week += `<button class="nav" data-week="7" aria-label="Nächste Woche">›</button>`;

  const qs = askQuestions(current);
  const a = state.answers[current] || {};
  const done = qs.filter((q) => isAnswered(a[q.id])).length;
  const hq = healthQuestions();
  const healthHtml = hq.length ? `<section class="q healthcard">
      <p class="q-title">Apple Health</p>
      ${hq.map((q) => `<label class="hrow" data-hq="${q.id}"><span>${esc(q.text)}</span><span class="hval"><input type="text" inputmode="${q.format ? "text" : "decimal"}" autocomplete="off" value="${esc(q.format ? fmtQ(q, a[q.id]) : fmtNum(a[q.id]))}" placeholder="${q.format === "clock" ? "hh:mm" : q.format === "duration" ? "h:mm" : "–"}" aria-label="${esc(q.text)}" class="${q.format ? "wide" : ""}">${q.unit && !q.format ? `<span class="unit">${esc(q.unit)}</span>` : ""}</span></label>`).join("")}
    </section>` : "";

  let body;
  if (!qs.length && hq.length) {
    body = healthHtml + `<p class="muted small">Leg unter Einstellungen → Fragen deine erste Frage an.</p>`;
  } else if (!qs.length) {
    body = `<div class="empty-state">
      <h2>Noch keine Fragen</h2>
      <p class="muted">Leg deine erste Frage an, zum Beispiel „Heute bouldern?“ mit den Antworten Ja und Nein.</p>
      <button class="btn" id="firstq">Frage anlegen</button>
    </div>`;
  } else {
    const startLabel = done === 0 ? "Abfrage starten" : done < qs.length ? "Abfrage fortsetzen" : "Abfrage nochmal durchgehen";
    body = `<button class="btn block ${done < qs.length ? "hold-btn" : "ghost"}" id="startquiz">${startLabel}</button>
      <p class="progress">${done} von ${qs.length} beantwortet</p>`;
    body += healthHtml;
    body += qs.map((q) => {
      const val = a[q.id];
      return `<section class="q ${isAnswered(val) ? "done" : ""} ${q.cond ? "child" : ""}" data-qid="${q.id}">
        <p class="q-title">${esc(q.text)}</p>
        ${answerInput(q, val)}
      </section>`;
    }).join("");
  }

  view.innerHTML = `
    <div class="dayhead">
      <div>
        <div class="weekday">${esc(label)}</div>
        <h1>${longDate(current)}</h1>
      </div>
      <div class="headbtns">
        ${isToday ? "" : `<button class="todaybtn" id="gotoday">Zu heute</button>`}
        <button class="gear" id="goalsbtn" aria-label="Ziele festlegen">${GEAR}</button>
      </div>
    </div>
    ${placeLine(current)}
    <div class="week">${week}</div>
    ${body}`;

  view.querySelectorAll("[data-week]").forEach((b) => b.addEventListener("click", () => { current = addDays(current, +b.dataset.week); renderDay(); }));
  view.querySelectorAll("[data-date]").forEach((b) => b.addEventListener("click", () => { current = b.dataset.date; renderDay(); }));
  $("#gotoday")?.addEventListener("click", () => { current = todayIso(); renderDay(); });
  $("#firstq")?.addEventListener("click", () => openEditor(null));
  $("#goalsbtn").addEventListener("click", openGoals);
  $("#placeedit")?.addEventListener("click", () => openPlaces(current));
  view.querySelectorAll("[data-hq]").forEach((row) => {
    const inp = row.querySelector("input");
    inp.addEventListener("change", () => {
      const hqq = qById(row.dataset.hq);
      const n = parseQ(hqq, inp.value);
      if (Number.isNaN(n)) { toast(hqq.format ? "Bitte so eingeben: 7:23" : "Bitte eine Zahl eingeben"); inp.value = hqq.format ? fmtQ(hqq, (state.answers[current] || {})[row.dataset.hq]) : fmtNum((state.answers[current] || {})[row.dataset.hq]); return; }
      setAnswer(current, row.dataset.hq, n);
      if (hqq.format) inp.value = fmtQ(hqq, n);
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  });
  $("#startquiz")?.addEventListener("click", () => startQuiz(current));

  view.querySelectorAll(".q[data-qid]").forEach((card) => wireInput(card, qById(card.dataset.qid), current, (kind) => {
    if (kind !== "input") return renderDay();
    // Zahlen können keine Folgefragen auslösen → nur Markierung und Zähler aktualisieren
    const aa = state.answers[current] || {};
    card.classList.toggle("done", isAnswered(aa[card.dataset.qid]));
    const vq = askQuestions(current);
    $(".progress").textContent = `${vq.filter((x) => isAnswered(aa[x.id])).length} von ${vq.length} beantwortet`;
  }));
}

/* ================= Abfrage: eine Frage nach der anderen ================= */
function startQuiz(date) {
  if (date === todayIso()) capturePlace(false);
  const qs = askQuestions(date);
  const a = state.answers[date] || {};
  const first = qs.findIndex((q) => !isAnswered(a[q.id]));
  quiz = { date, idx: first < 0 ? 0 : first };
  render();
  window.scrollTo(0, 0);
}

function renderQuiz() {
  const view = $("#view");
  const { date } = quiz;
  const qs = askQuestions(date); // wird nach jeder Antwort neu berechnet → Folgefragen erscheinen
  const a = state.answers[date] || {};

  if (quiz.idx >= qs.length) {
    const open = qs.filter((q) => !isAnswered(a[q.id]));
    view.innerHTML = `<div class="quiz">
      <div class="quiz-top"><span class="muted">${longDate(date)}</span><button class="linkbtn" id="qclose">Schließen</button></div>
      <div class="quiz-done">
        <div class="hold big" style="--p:${dayProgress(date)}"></div>
        <h1>${open.length ? "Fast geschafft" : "Fertig"}</h1>
        <p class="muted">${open.length ? `${open.length} Frage${open.length > 1 ? "n" : ""} übersprungen.` : `Alle ${qs.length} Fragen für den ${longDate(date)} beantwortet.`}</p>
        <ul class="summary">${qs.map((q) => `<li><span>${esc(q.text)}</span><strong>${isAnswered(a[q.id]) ? esc(fmtQ(q, a[q.id])) : "–"}</strong></li>`).join("")}</ul>
        <div class="stack">
          ${open.length ? `<button class="btn hold-btn" id="qopen">Übersprungene beantworten</button>` : ""}
          <button class="btn ${open.length ? "ghost" : ""}" id="qfinish">Zur Tagesübersicht</button>
        </div>
      </div>
    </div>`;
    $("#qclose").addEventListener("click", endQuiz);
    $("#qfinish").addEventListener("click", endQuiz);
    $("#qopen")?.addEventListener("click", () => { quiz.idx = qs.findIndex((q) => !isAnswered(a[q.id])); renderQuiz(); });
    return;
  }

  const q = qs[quiz.idx];
  const val = a[q.id];
  const needsNext = q.type === "number" || (q.type === "choice" && q.multi);
  view.innerHTML = `<div class="quiz">
    <div class="quiz-top">
      <span class="muted">${longDate(date)} · Frage ${quiz.idx + 1} von ${qs.length}</span>
      <button class="linkbtn" id="qclose">Beenden</button>
    </div>
    <div class="bar"><span style="width:${(quiz.idx / qs.length) * 100}%"></span></div>
    <section class="quiz-q" data-qid="${q.id}">
      ${q.cond ? `<p class="q-hint">Weil du „${esc(fmtVal(a[q.cond.qid]))}“ geantwortet hast</p>` : ""}
      <h1 class="quiz-title">${esc(q.text)}</h1>
      ${answerInput(q, val)}
    </section>
    <div class="quiz-nav">
      <button class="btn ghost" id="qback" ${quiz.idx === 0 ? "disabled" : ""}>Zurück</button>
      <button class="btn ${needsNext || isAnswered(val) ? "" : "ghost"}" id="qnext">${isAnswered(val) || needsNext ? "Weiter" : "Überspringen"}</button>
    </div>
  </div>`;

  const sec = view.querySelector(".quiz-q");
  const next = () => { quiz.idx++; renderQuiz(); window.scrollTo(0, 0); };
  wireInput(sec, q, date, (kind) => {
    if (kind === "pick" || kind === "enter") { renderQuiz(); setTimeout(next, 220); } // kurz Auswahl zeigen, dann weiter
    else if (kind !== "input") renderQuiz();
  });
  $("#qclose").addEventListener("click", endQuiz);
  $("#qback").addEventListener("click", () => { quiz.idx = Math.max(0, quiz.idx - 1); renderQuiz(); });
  $("#qnext").addEventListener("click", () => {
    if (sec._commit && sec._commit() === false) return;
    next();
  });
  if (q.type === "number" && !isAnswered(val)) setTimeout(() => sec.querySelector("input")?.focus(), 50);
}

function endQuiz() {
  current = quiz.date;
  quiz = null;
  tab = "day";
  render();
  window.scrollTo(0, 0);
}

/* ================= Analyse ================= */
const PREF_KEY = "taeglich.prefs";
let prefs = { range: "30", q: {}, focus: {} };
try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); prefs = { ...prefs, ...p, q: p.q || {}, focus: p.focus || {} }; } catch (e) { /* egal */ }
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* egal */ } };

// Einstellungen pro Frage, mit sinnvollen Vorgaben
const qset = (q) => ({ chart: "bars", unit: "pct", trend: q.type !== "choice", hidden: false, ...(prefs.q[q.id] || {}) });
const setQ = (qid, patch) => { prefs.q[qid] = { ...(prefs.q[qid] || {}), ...patch }; savePrefs(); };

const RANGES = [["7", "7 Tage"], ["30", "30 Tage"], ["ytd", "Seit 1.1."], ["365", "12 Mon."], ["all", "Alles"]];
const SERIES = 8; // Farben für Kuchendiagramme, weitere Antworten → „Weitere“
const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString("de-DE");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const shortDate = (s) => { const d = parseIso(s); return `${WD_SHORT[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };
const MON_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function rangeDays(range = prefs.range) {
  const t = todayIso();
  let start;
  if (range === "all") {
    const first = Object.keys(state.answers).sort()[0];
    start = first && first < t ? first : t;
  } else if (range === "ytd") start = t.slice(0, 4) + "-01-01"; // seit Jahresbeginn
  else start = addDays(t, -(Number(range) - 1));
  const out = [];
  for (let d = start; d <= t; d = addDays(d, 1)) out.push(d);
  return out;
}

const GEAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

function analysisQuestions(days) {
  return ordered().map((o) => o.q).filter((q) => !q.archived || days.some((d) => isAnswered((state.answers[d] || {})[q.id])));
}

function renderAnalysis() {
  const view = $("#view");
  const days = rangeDays();
  const all = analysisQuestions(days);
  const qs = all.filter((q) => !qset(q).hidden);
  const tracked = days.filter((d) => state.answers[d]).length;
  const hiddenN = all.length - qs.length;

  view.innerHTML = `
    <div class="dayhead">
      <h1>Analyse</h1>
      ${all.length ? `<button class="gear" id="asettings" aria-label="Darstellung einstellen">${GEAR}</button>` : ""}
    </div>
    <div class="seg seg4" role="group" aria-label="Zeitraum">
      ${RANGES.map(([k, l]) => `<button data-range="${k}" aria-pressed="${prefs.range === k}">${l}</button>`).join("")}
    </div>
    <p class="muted small" style="margin:0 0 16px">${tracked} von ${days.length} Tagen erfasst · ${shortDate(days[0])} – ${shortDate(days[days.length - 1])}${hiddenN ? ` · ${hiddenN} Frage${hiddenN > 1 ? "n" : ""} ausgeblendet` : ""}</p>
    ${all.length && prefs.trends !== false ? trendsPanel(days) : ""}
    ${all.length && prefs.goals !== false ? goalsPanel() : ""}
    ${qs.length ? qs.map((q) => analysisCard(q, days)).join("") : `<p class="muted">${all.length ? "Alle Fragen sind über das Zahnrad ausgeblendet." : "Noch keine Fragen angelegt."}</p>`}`;

  $("#asettings")?.addEventListener("click", openAnalysisSettings);
  $("#gmore")?.addEventListener("click", () => { showAllGoals = !showAllGoals; renderAnalysis(); });
  $("#tmore")?.addEventListener("click", () => { showAllTrends = !showAllTrends; renderAnalysis(); });
  view.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => { prefs.range = b.dataset.range; savePrefs(); renderAnalysis(); }));
  view.querySelectorAll("[data-focus]").forEach((b) => b.addEventListener("click", () => {
    prefs.focus[b.dataset.qid] = b.dataset.focus; savePrefs(); renderAnalysis();
  }));

  // Antippen im Verlauf zeigt den Wert darunter
  view.querySelectorAll(".acard").forEach((card) => {
    const cap = card.querySelector(".acap");
    const q = qById(card.dataset.qid);
    const svg = card.querySelector("svg.line");
    if (svg) {
      const pts = JSON.parse(svg.dataset.pts);
      const mark = svg.querySelector(".hover");
      const pick = (ev) => {
        const r = svg.getBoundingClientRect();
        const x = ((ev.clientX - r.left) / r.width) * 300;
        let best = pts[0];
        for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
        mark.setAttribute("cx", best.x); mark.setAttribute("cy", best.y); mark.style.display = "";
        const v = (state.answers[best.d] || {})[q.id];
        cap.textContent = `${shortDate(best.d)}: ${fmtQ(q, v)}`;
      };
      svg.addEventListener("pointerdown", pick);
      svg.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "mouse") pick(e); });
    }
    card.querySelectorAll(".col[data-cap]").forEach((c) => c.addEventListener("click", () => {
      card.querySelectorAll(".col.sel").forEach((x) => x.classList.remove("sel"));
      c.classList.add("sel");
      cap.textContent = c.dataset.cap;
    }));
  });
}

// Häufigkeiten je Antwort (Auswahl) bzw. je Stufe (Skala)
function distribution(q, vals) {
  if (q.type === "scale") {
    return Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map((s) => ({
      key: String(s),
      label: `${s}${s === q.min && q.minLabel ? " · " + q.minLabel : ""}${s === q.max && q.maxLabel ? " · " + q.maxLabel : ""}`,
      c: vals.filter((x) => x.v === s).length
    }));
  }
  const keys = [...q.options];
  // ältere Antworttexte (z. B. nach Umbenennen) trotzdem zählen
  vals.forEach((x) => (Array.isArray(x.v) ? x.v : [x.v]).forEach((v) => { if (!keys.includes(v)) keys.push(v); }));
  return keys.map((k) => ({ key: k, label: k, c: vals.filter((x) => (Array.isArray(x.v) ? x.v.includes(k) : x.v === k)).length }));
}

function analysisCard(q, days) {
  const set = qset(q);
  const vals = days.map((d) => ({ d, v: (state.answers[d] || {})[q.id] })).filter((x) => isAnswered(x.v));
  const n = vals.length;
  let body = "";
  const title = `<h2 class="atitle">${q.cond ? "↳ " : ""}${esc(q.text)}</h2>`;

  // Kompakt: nur „an X von Y Tagen“
  if (q.type === "choice" && set.chart === "count") {
    const key = q.options.includes(set.countKey) ? set.countKey : q.options[0];
    const c = vals.filter((x) => (Array.isArray(x.v) ? x.v.includes(key) : x.v === key)).length;
    return `<section class="panel acard compact" data-qid="${q.id}">
      <div class="crow">${title}<p class="cnum"><strong>${c}</strong> von ${days.length} Tagen${key !== "Ja" ? ` <span class="muted">„${esc(key)}“</span>` : ""}</p></div>
      ${set.trend ? columnChart(q, days, key, "abs") : ""}
      <p class="acap small" aria-live="polite"></p>
    </section>`;
  }

  if (!n) {
    body = `<p class="muted small">Im gewählten Zeitraum noch keine Antworten.</p>`;
  } else if (q.type === "choice" || q.type === "scale") {
    const dist = distribution(q, vals);
    const fmtC = (c, base) => (set.unit === "pct" ? `${pct(c, base)} %` : `${c}×`);
    let focusKey = null;
    let hero = "";
    if (q.type === "scale") {
      const avg = vals.reduce((s, x) => s + x.v, 0) / n;
      hero = `<p class="hero"><span class="big">Ø ${fmt1(avg)}</span><span class="muted">auf der Skala ${q.min}–${q.max}</span></p>`;
    } else {
      focusKey = dist.some((x) => x.key === prefs.focus[q.id]) ? prefs.focus[q.id] : dist[0].key;
    }

    if (set.chart === "pie") {
      // Kuchen: Anteile an allen Nennungen (bei Mehrfachauswahl ≠ Anteil der Tage)
      let slices = dist.filter((x) => x.c > 0);
      if (slices.length > SERIES) {
        const rest = slices.slice(SERIES - 1);
        slices = slices.slice(0, SERIES - 1).concat([{ key: "__rest", label: "Weitere", c: rest.reduce((s, x) => s + x.c, 0), rest: true }]);
      }
      const total = slices.reduce((s, x) => s + x.c, 0);
      const colorIdx = (k) => dist.findIndex((x) => x.key === k); // Farbe hängt an der Antwort, nicht am Rang
      const center = q.type === "choice" ? (() => { const f = dist.find((x) => x.key === focusKey); return { v: fmtC(f.c, q.multi ? total : n), l: f.label }; })() : { v: String(n), l: "Tage" };
      body = `${hero}
        <div class="pie-wrap">
          ${donut(slices.map((s) => ({ ...s, color: s.rest ? "var(--ink-2)" : `var(--s${(colorIdx(s.key) % SERIES) + 1})` })), total, center, focusKey)}
          <div class="pie-legend">${dist.map((x) => {
            const color = x.c && slices.some((s) => s.key === x.key) ? `var(--s${(colorIdx(x.key) % SERIES) + 1})` : "var(--ink-2)";
            const tag = q.type === "choice" ? `button data-qid="${q.id}" data-focus="${esc(x.key)}" aria-pressed="${x.key === focusKey}"` : "div";
            return `<${tag} class="lrow"><span class="sw" style="background:${color}"></span><span class="ll">${esc(x.label)}</span><span class="lv">${fmtC(x.c, q.multi ? total : n)}</span></${tag.split(" ")[0]}>`;
          }).join("")}</div>
        </div>
        ${q.multi ? `<p class="muted small">Kuchen bei Mehrfachauswahl: Anteil an allen ${total} Nennungen.</p>` : ""}`;
    } else {
      const max = Math.max(...dist.map((x) => x.c), 1);
      body = `${hero}
        <div class="bars">${dist.map((x) => {
          const tag = q.type === "choice" ? `button data-qid="${q.id}" data-focus="${esc(x.key)}" aria-pressed="${x.key === focusKey}"` : `div`;
          return `<${tag} class="barrow ${q.type === "scale" ? "static" : ""}">
            <span class="bl">${esc(x.label)}</span>
            <span class="bt"><span style="width:${set.unit === "pct" ? pct(x.c, n) : (x.c / max) * 100}%"></span></span>
            <span class="bv">${fmtC(x.c, n)}</span>
          </${tag.split(" ")[0]}>`;
        }).join("")}</div>
        ${q.multi && set.unit === "pct" ? `<p class="muted small">Mehrfachauswahl: Prozent = Anteil der Tage, die Summe kann über 100 % liegen.</p>` : ""}`;
    }

    if (set.trend) {
      body += q.type === "scale" ? (n >= 2 ? lineChart(q, days, vals, vals.reduce((s, x) => s + x.v, 0) / n) : "")
        : columnChart(q, days, focusKey, set.unit);
    }
  } else {
    const nums = vals.map((x) => x.v);
    const avg = nums.reduce((s, x) => s + x, 0) / n;
    if (q.format) {
      // Dauer bzw. Uhrzeit: Durchschnitt, Spanne und Streuung (Standardabweichung) in Minuten
      const sdMin = n > 1 ? Math.round(Math.sqrt(nums.reduce((s, x) => s + (x - avg) ** 2, 0) / (n - 1)) * 60) : 0;
      const lo = q.format === "clock" ? "früheste" : "kürzeste", hi = q.format === "clock" ? "späteste" : "längste";
      body = `
      <p class="hero"><span class="big">Ø ${fmtQ(q, avg)}</span>${q.format === "clock" ? `<span class="muted">Uhr</span>` : ""}</p>
      <p class="stats small"><span>${lo} ${fmtQ(q, Math.min(...nums))}</span><span>${hi} ${fmtQ(q, Math.max(...nums))}</span><span>Streuung ± ${sdMin} min</span></p>
      ${set.trend && n >= 2 ? lineChart(q, days, vals, avg) : ""}`;
    } else body = `
      <p class="hero"><span class="big">Ø ${fmt1(avg)}</span><span class="muted">${q.unit ? esc(q.unit) : ""}</span></p>
      <p class="stats small"><span>Min ${fmt1(Math.min(...nums))}</span><span>Max ${fmt1(Math.max(...nums))}</span><span>Summe ${fmt1(nums.reduce((s, x) => s + x, 0))}</span></p>
      ${set.trend && n >= 2 ? lineChart(q, days, vals, avg) : ""}`;
  }

  return `<section class="panel acard" data-qid="${q.id}">
    ${title}
    ${body}
    <p class="acap small" aria-live="polite"></p>
  </section>`;
}

// Ring mit 2px Lücke zwischen den Stücken; ausgewählte Antwort etwas dicker
function donut(slices, total, center, focusKey) {
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const gap = slices.length > 1 ? 2 : 0;
  const arcs = slices.map((s) => {
    const len = (s.c / total) * C;
    const a = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${s.color}" stroke-width="${s.key === focusKey ? 22 : 18}"
      stroke-dasharray="${Math.max(len - gap, 0.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(s.label)}: ${s.c}</title></circle>`;
    off += len;
    return a;
  }).join("");
  return `<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="Kuchendiagramm">
    ${arcs}
    <text x="70" y="70" class="dv" text-anchor="middle">${esc(center.v)}</text>
    <text x="70" y="88" class="dl" text-anchor="middle">${esc(center.l.length > 14 ? center.l.slice(0, 13) + "…" : center.l)}</text>
  </svg>`;
}

// Säulen über die Zeit: wie oft die gewählte Antwort vorkam (pro Tag, Woche oder Monat)
function columnChart(q, days, focusKey, unit) {
  const span = days.length;
  const mode = span <= 14 ? "day" : span <= 92 ? "week" : "month";
  const buckets = [];
  const keyOf = (d) => (mode === "day" ? d : mode === "week" ? mondayOf(d) : d.slice(0, 7));
  for (const d of days) {
    const k = keyOf(d);
    let b = buckets[buckets.length - 1];
    if (!b || b.k !== k) { b = { k, first: d, n: 0, hit: 0 }; buckets.push(b); }
    const v = (state.answers[d] || {})[q.id];
    if (isAnswered(v)) { b.n++; if (Array.isArray(v) ? v.includes(focusKey) : v === focusKey) b.hit++; }
  }
  const val = (b) => (unit === "pct" ? (b.n ? (b.hit / b.n) * 100 : 0) : b.hit);
  const max = unit === "pct" ? 100 : Math.max(1, ...buckets.map(val));
  const lab = (b) => {
    const d = parseIso(b.first);
    return mode === "day" ? WD_SHORT[d.getDay()] : mode === "week" ? `${parseIso(b.k).getDate()}.${parseIso(b.k).getMonth() + 1}.` : MON_SHORT[d.getMonth()];
  };
  const name = mode === "day" ? "Tag" : mode === "week" ? "Woche ab" : "";
  const every = Math.ceil(buckets.length / 7); // nicht jede Beschriftung, sonst zu eng
  return `<div class="cols-head small muted">„${esc(focusKey)}“ pro ${mode === "day" ? "Tag" : mode === "week" ? "Woche" : "Monat"}</div>
    <div class="cols" style="grid-template-columns:repeat(${buckets.length}, 1fr)">
      ${buckets.map((b, i) => `<button class="col" data-cap="${esc(`${name ? name + " " : ""}${lab(b)}: ${unit === "pct" ? Math.round(val(b)) + " %" : b.hit + "×"} „${focusKey}“ (${b.n} Tag${b.n === 1 ? "" : "e"} beantwortet)`)}">
        <span class="cbar"><span style="height:${(val(b) / max) * 100}%"></span></span>
        <span class="clab">${i % every === 0 ? lab(b) : ""}</span>
      </button>`).join("")}
    </div>`;
}

// Verlauf über die Zeit, gestrichelt der Durchschnitt
function lineChart(q, days, vals, avg) {
  const W = 300, H = 110, P = 8;
  const nums = vals.map((x) => x.v);
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (q.type === "scale") { lo = q.min; hi = q.max; }
  if (hi === lo) { hi += 1; lo -= 1; }
  const xi = (d) => (days.length === 1 ? W / 2 : P + (days.indexOf(d) / (days.length - 1)) * (W - 2 * P));
  const yi = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const pts = vals.map((x) => ({ d: x.d, x: +xi(x.d).toFixed(1), y: +yi(x.v).toFixed(1) }));
  let path = "";
  pts.forEach((p, i) => {
    const gap = i === 0 || days.indexOf(p.d) - days.indexOf(pts[i - 1].d) > 1; // Lücke bei fehlenden Tagen
    path += `${gap ? "M" : "L"}${p.x},${p.y}`;
  });
  const dots = pts.length <= 40 ? pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" class="dot"/>`).join("") : "";
  return `<div class="chart">
    <div class="yax small muted"><span>${q.format ? fmtQ(q, hi) : fmt1(hi)}</span><span>${q.format ? fmtQ(q, lo) : fmt1(lo)}</span></div>
    <svg class="line" viewBox="0 0 ${W} ${H}" data-pts='${JSON.stringify(pts)}' role="img" aria-label="Verlauf von ${esc(q.text)}">
      <line x1="0" x2="${W}" y1="${yi(avg)}" y2="${yi(avg)}" class="avg"/>
      <path d="${path}" class="ln"/>
      ${dots}
      <circle class="hover" r="5" style="display:none"/>
    </svg>
  </div>
  <p class="legend small"><span class="ln-key"></span>Werte <span class="avg-key"></span>Durchschnitt · antippen für Details</p>`;
}

// Zahnrad: Darstellung pro Frage einstellen
function openAnalysisSettings() {
  const dlg = $("#sheet");
  const qs = analysisQuestions(rangeDays());
  const seg = (q, field, opts, cur) => `<div class="seg seg-${opts.length}" role="group">${opts.map(([v, l]) =>
    `<button type="button" data-q="${q.id}" data-f="${field}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join("")}</div>`;
  const draw = () => {
    const keep = dlg.querySelector(".sheet-inner")?.scrollTop || 0;
    dlg.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head">
        <span></span>
        <h2>Darstellung</h2>
        <button type="button" class="linkbtn" id="adone">Fertig</button>
      </div>
      <section class="sq">
        <div class="sq-head"><strong>Trends</strong>
          <label class="switch"><input type="checkbox" data-f="trends" ${prefs.trends !== false ? "checked" : ""}><span>Anzeigen</span></label>
        </div>
        <p class="muted small" style="margin:6px 0 0">Serien und auffällige Zusammenhänge oben in der Analyse.</p>
      </section>
      <section class="sq">
        <div class="sq-head"><strong>Ziele</strong>
          <label class="switch"><input type="checkbox" data-f="goals" ${prefs.goals !== false ? "checked" : ""}><span>Anzeigen</span></label>
        </div>
        <p class="muted small" style="margin:6px 0 0">Stand deiner Ziele. Festlegen unter „Tag“ über das Zahnrad.</p>
      </section>
      ${qs.map((q) => {
        const s = qset(q);
        const dist = q.type === "choice" || q.type === "scale";
        return `<section class="sq ${s.hidden ? "off" : ""}">
          <div class="sq-head">
            <strong>${q.cond ? "↳ " : ""}${esc(q.text)}</strong>
            <label class="switch"><input type="checkbox" data-q="${q.id}" data-f="show" ${s.hidden ? "" : "checked"}><span>Anzeigen</span></label>
          </div>
          ${s.hidden ? "" : `
          ${dist ? `<div class="sq-row"><span>Diagramm</span>${seg(q, "chart", q.type === "choice" ? [["bars", "Balken"], ["pie", "Kuchen"], ["count", "Kompakt"]] : [["bars", "Balken"], ["pie", "Kuchen"]], s.chart)}</div>
          ${q.type === "choice" && s.chart === "count"
            ? `<div class="sq-row"><span>Zählt</span><select data-q="${q.id}" data-f="countKey">${q.options.map((o) => `<option ${o === (q.options.includes(s.countKey) ? s.countKey : q.options[0]) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
               <p class="muted small" style="margin:6px 0 0">Zeigt nur: an wie vielen Tagen im Zeitraum diese Antwort kam.</p>`
            : `<div class="sq-row"><span>Werte</span>${seg(q, "unit", [["pct", "%"], ["abs", "Anzahl"]], s.unit)}</div>`}` : ""}
          <label class="switch row"><input type="checkbox" data-q="${q.id}" data-f="trend" ${s.trend ? "checked" : ""}><span>Verlauf über die Zeit</span></label>`}
        </section>`;
      }).join("")}
    </div>`;
    dlg.querySelector(".sheet-inner").scrollTop = keep;
    $("#adone", dlg).addEventListener("click", () => dlg.close());
    dlg.querySelectorAll("button[data-f]").forEach((b) => b.addEventListener("click", () => { setQ(b.dataset.q, { [b.dataset.f]: b.dataset.v }); draw(); renderAnalysis(); }));
    dlg.querySelectorAll("input[data-f]").forEach((i) => i.addEventListener("change", () => {
      if (i.dataset.f === "trends") { prefs.trends = i.checked; savePrefs(); }
      else if (i.dataset.f === "goals") { prefs.goals = i.checked; savePrefs(); }
      else if (i.dataset.f === "show") setQ(i.dataset.q, { hidden: !i.checked });
      else setQ(i.dataset.q, { trend: i.checked });
      draw(); renderAnalysis();
    }));
    dlg.querySelectorAll("select[data-f]").forEach((sel) => sel.addEventListener("change", () => { setQ(sel.dataset.q, { countKey: sel.value }); renderAnalysis(); }));
  };
  draw();
  dlg.showModal();
  document.activeElement?.blur(); // sonst zeigt iOS einen Rahmen um „Fertig“
}

/* ================= Trends: Serien und Zusammenhänge ================= */
const MIN_GROUP = 4;   // mindestens so viele Tage je Gruppe
const MIN_D = 0.5;     // ab mittlerem Effekt (Cohen's d) gilt ein Unterschied als auffällig
const MIN_R = 0.4;     // ab dieser Korrelation gilt ein Zusammenhang als auffällig
const MIN_PAIRS = 8;

const ansOn = (d, q) => (q.id === "__place" ? (placeCities(d).length ? placeCities(d) : undefined) : (state.answers[d] || {})[q.id]);
const has = (v, opt) => (Array.isArray(v) ? v.includes(opt) : v === opt);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(a.length - 1, 1)); };
const qName = (q) => `„${esc(q.text.replace(/\?$/, ""))}“`;

// Serien: aktuelle Ja-Serie, Rekord und auffällige Pausen (unabhängig vom Zeitraum)
function streakInsights() {
  const out = [];
  const t = todayIso();
  const first = Object.keys(state.answers).sort()[0];
  if (!first) return out;
  for (const q of state.questions) {
    if (q.archived || q.type !== "choice" || q.multi || !q.options.includes("Ja")) continue;
    // aktuelle Serie: heute noch offen → ab gestern zählen
    let d = isAnswered(ansOn(t, q)) ? t : addDays(t, -1);
    let cur = 0;
    while (d >= first && ansOn(d, q) === "Ja") { cur++; d = addDays(d, -1); }
    // Rekord
    let best = 0, run = 0;
    for (let x = first; x <= t; x = addDays(x, 1)) { run = ansOn(x, q) === "Ja" ? run + 1 : 0; best = Math.max(best, run); }
    if (cur >= 3) {
      out.push({ score: 10 + cur, html: `<strong>${cur} Tage in Folge</strong> ${qName(q)} mit Ja${best > cur ? ` · Rekord ${best}` : best === cur && cur > 3 ? " · neuer Rekord" : ""}` });
      continue;
    }
    // Pause: lange kein Ja, obwohl es sonst regelmäßig vorkommt
    let last = null, yes = 0, answered = 0;
    for (let x = first; x <= t; x = addDays(x, 1)) {
      const v = ansOn(x, q);
      if (isAnswered(v)) answered++;
      if (v === "Ja") { yes++; last = x; }
    }
    if (last && answered >= 14 && yes / answered >= 1 / 7) {
      const gap = Math.round((parseIso(t) - parseIso(last)) / 864e5);
      const usual = answered / yes; // durchschnittlich alle … Tage
      if (gap >= 7 && gap >= 2 * usual) out.push({ score: 5 + gap / 7, html: `<strong>Seit ${gap} Tagen</strong> kein Ja bei ${qName(q)} · sonst etwa alle ${Math.round(usual)} Tage` });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// Gruppen für Vergleiche: Ja/Nein-Fragen → Ja; sonst je Antwortmöglichkeit
function groupings(qs) {
  const g = [];
  for (const q of qs) {
    if (q.type !== "choice") continue;
    if (q.options.includes("Ja")) g.push({ q, opt: "Ja", label: `${qName(q)} = Ja` });
    else if (q.options.length <= 6) q.options.forEach((o) => g.push({ q, opt: o, label: `${qName(q)} = „${esc(o)}“` }));
  }
  return g;
}

function relationInsights(days) {
  const qs = state.questions.filter((q) => !q.archived || days.some((d) => isAnswered(ansOn(d, q))));
  const nums = qs.filter((q) => q.type === "number" || q.type === "scale");
  const found = [];

  // Mittelwertvergleich: Zahl/Skala an Tagen mit vs. ohne eine bestimmte Antwort (gleicher Tag und Tag danach)
  for (const g of [...groupings(qs), ...placeGroupings(days)]) {
    for (const b of nums) {
      if (b.cond && b.cond.qid === g.q.id) continue; // Folgefrage der Gruppe → trivial
      let bestCase = null;
      for (const lag of [0, 1]) {
        const inG = [], outG = [];
        for (const d of days) {
          const a = ansOn(d, g.q);
          const dB = lag ? addDays(d, 1) : d;
          if (lag && dB > days[days.length - 1]) continue;
          const v = ansOn(dB, b);
          if (!isAnswered(a) || typeof v !== "number") continue;
          (has(a, g.opt) ? inG : outG).push(v);
        }
        if (inG.length < MIN_GROUP || outG.length < MIN_GROUP) continue;
        const pooled = Math.sqrt(((inG.length - 1) * sd(inG) ** 2 + (outG.length - 1) * sd(outG) ** 2) / (inG.length + outG.length - 2)) || 1e-9;
        const dEff = (mean(inG) - mean(outG)) / pooled;
        if (Math.abs(dEff) >= MIN_D && (!bestCase || Math.abs(dEff) > Math.abs(bestCase.dEff) + 0.1)) bestCase = { lag, dEff, m1: mean(inG), m0: mean(outG), n1: inG.length, n0: outG.length };
      }
      if (bestCase) {
        const unit = b.unit ? " " + esc(b.unit) : "";
        found.push({
          score: Math.abs(bestCase.dEff),
          html: `${qName(b)} ${bestCase.lag ? "am Tag nach" : "an Tagen mit"} ${g.label}: <strong>Ø ${b.type === "number" ? fmtNice(b, bestCase.m1) : fmt1(bestCase.m1) + unit}</strong> statt Ø ${b.type === "number" ? fmtNice(b, bestCase.m0) : fmt1(bestCase.m0) + unit}`,
          note: `${bestCase.n1} vs. ${bestCase.n0} Tage`
        });
      }
    }
  }

  // Korrelation zwischen zwei Zahl/Skala-Fragen am selben Tag
  for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) {
    const a = nums[i], b = nums[j];
    const xs = [], ys = [];
    for (const d of days) { const x = ansOn(d, a), y = ansOn(d, b); if (typeof x === "number" && typeof y === "number") { xs.push(x); ys.push(y); } }
    if (xs.length < MIN_PAIRS) continue;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, k) => { sxy += (x - mx) * (ys[k] - my); sxx += (x - mx) ** 2; syy += (ys[k] - my) ** 2; });
    if (!sxx || !syy) continue;
    const r = sxy / Math.sqrt(sxx * syy);
    if (Math.abs(r) < MIN_R) continue;
    found.push({
      score: (2 * Math.abs(r)) / Math.sqrt(1 - Math.min(r * r, 0.99)), // in d umgerechnet, damit vergleichbar
      html: (() => {
        // Uhrzeit zuerst nennen („Je später die Schlafenszeit …“), sonst Reihenfolge wie angelegt
        const [x, y] = b.format === "clock" && a.format !== "clock" ? [b, a] : [a, b];
        const up = (q) => (q.format === "clock" ? "später" : q.format === "duration" ? "länger" : "mehr");
        const down = (q) => (q.format === "clock" ? "früher" : q.format === "duration" ? "kürzer" : "weniger");
        return `<strong>Je ${up(x)} ${qName(x)}, desto ${r > 0 ? up(y) : down(y)} ${qName(y)}</strong> (r = ${r.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
      })(),
      note: `${xs.length} Tage`
    });
  }
  return found.sort((a, b) => b.score - a.score);
}

// Trends für einzelne Zahlen (z. B. Schritte, Schlaf): Normalwert, Wochentage, Rekorde, Serien
const WD_PLURAL = ["sonntags", "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags"];
const MON_LONG = MON;
const niceDate = (d) => { const x = parseIso(d); return `${x.getDate()}. ${MON_LONG[x.getMonth()]}`; };

// Wert lesbar: Zeitformate wie gehabt, große Zahlen mit Tausenderpunkt
function fmtNice(q, v) {
  if (q.format) return fmtQ(q, v);
  const s = Math.abs(v) >= 100 ? Math.round(v).toLocaleString("de-DE") : fmt1(v);
  return s + (q.unit ? " " + q.unit : "");
}
// Unterschied lesbar: bei Zeiten in Minuten, sonst in Prozent
function fmtDiff(q, d, base) {
  if (q.format) {
    const m = Math.round(Math.abs(d) * 60);
    const word = q.format === "clock" ? (d > 0 ? "später" : "früher") : (d > 0 ? "mehr" : "weniger");
    return `${m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`} ${word} als sonst`;
  }
  const p = Math.round((Math.abs(d) / Math.abs(base || 1)) * 100);
  return `${p} % ${d > 0 ? "über" : "unter"} deinem Schnitt`;
}
// Wörter je nach Art der Zahl
function words(q) {
  if (q.format === "clock") return { hi: "am spätesten", lo: "am frühesten", top: "Späteste", bottom: "Früheste" };
  if (q.format === "duration") return { hi: "am längsten", lo: "am kürzesten", top: "Längste", bottom: "Kürzeste" };
  if (q.healthKey === "schritte") return { hi: "am meisten", lo: "am wenigsten", top: "Meiste", bottom: "Wenigste" };
  return { hi: "am höchsten", lo: "am niedrigsten", top: "Höchster Wert", bottom: "Niedrigster Wert" };
}

// Abstand zweier Daten im Jahreslauf (0–182 Tage), z. B. 20.12. und 10.1. → 21
function doyDist(a, b) {
  const doy = (s) => { const d = parseIso(s); return Math.round((d - new Date(d.getFullYear(), 0, 1)) / 864e5); };
  const x = Math.abs(doy(a) - doy(b));
  return Math.min(x, 365 - x);
}
// Meteorologische Jahreszeiten
const SEASONS = ["Winter", "Frühling", "Sommer", "Herbst"];
const SEASON_IN = ["im Winter", "im Frühling", "im Sommer", "im Herbst"];
const seasonOf = (s) => Math.floor((Number(s.slice(5, 7)) % 12) / 3); // Dez–Feb 0, Mär–Mai 1, Jun–Aug 2, Sep–Nov 3

// Jahreszeiten-Muster: Zahlen (Schnitt je Jahreszeit) und Ja/Nein (Anteil Ja je Jahreszeit)
function seasonInsights() {
  const out = [];
  const t = todayIso();
  for (const q of state.questions) {
    if (q.archived) continue;
    const yesNo = q.type === "choice" && !q.multi && q.options.includes("Ja");
    if (q.type !== "number" && !yesNo) continue;
    const last = isHealthQ(q) ? addDays(t, -1) : t;
    const by = [[], [], [], []];
    for (const d of Object.keys(state.answers)) {
      if (d > last) continue;
      const v = (state.answers[d] || {})[q.id];
      if (q.type === "number" ? typeof v === "number" : isAnswered(v)) by[seasonOf(d)].push(q.type === "number" ? v : v === "Ja" ? 1 : 0);
    }
    // mindestens 2 Jahreszeiten mit je mind. 20 Tagen
    const ok = by.map((a, i) => ({ i, a })).filter((x) => x.a.length >= 20);
    if (ok.length < 2) continue;
    const m = ok.map((x) => ({ i: x.i, m: mean(x.a), n: x.a.length }));
    const hi = m.reduce((a, b) => (b.m > a.m ? b : a)), lo = m.reduce((a, b) => (b.m < a.m ? b : a));
    if (hi.i === lo.i) continue;
    const name = q.healthKey === "schritte" ? "Schritte" : esc(q.text.replace(/\?$/, ""));
    const note = ok.length < 4 ? `bisher nur ${ok.map((x) => SEASONS[x.i]).join(" und ")}` : "";
    if (q.type === "number") {
      const all = ok.flatMap((x) => x.a);
      const eff = (hi.m - lo.m) / (sd(all) || 1);
      if (eff < 0.5) continue;
      const w = words(q);
      out.push({ score: 1 + eff, note, html: `${name}: <strong>${SEASON_IN[hi.i]} ${w.hi}</strong> (Ø ${fmtNice(q, hi.m)}), ${SEASON_IN[lo.i]} ${w.lo} (Ø ${fmtNice(q, lo.m)})` });
    } else {
      const pp = Math.round((hi.m - lo.m) * 100);
      if (pp < 20) continue;
      out.push({ score: 1 + pp / 25, note, html: `${qName(q)}: <strong>${SEASON_IN[hi.i]} öfter Ja</strong> (${Math.round(hi.m * 100)} % der Tage), ${SEASON_IN[lo.i]} seltener (${Math.round(lo.m * 100)} %)` });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function numberInsights() {
  const out = [];
  const t = todayIso();
  for (const q of state.questions) {
    if (q.archived || q.type !== "number") continue;
    // Der heutige Health-Wert ist meist noch unvollständig (Schritte) → nicht mitzählen
    const last = isHealthQ(q) ? addDays(t, -1) : t;
    const series = Object.keys(state.answers).sort()
      .filter((d) => d <= last && typeof (state.answers[d] || {})[q.id] === "number")
      .map((d) => ({ d, v: state.answers[d][q.id] }));
    if (series.length < 14) continue;
    const name = q.healthKey === "schritte" ? "Schritte" : esc(q.text.replace(/\?$/, ""));
    const w = words(q);
    const all = series.map((x) => x.v);
    const sdAll = sd(all) || 1;

    // 1. Diese Woche im Vergleich zum Normalwert. Gibt es Vorjahresdaten zur gleichen
    //    Jahreszeit (±30 Tage), wird damit verglichen – sonst mit den 365 Tagen davor.
    const weekStart = addDays(last, -6);
    const week = series.filter((x) => x.d >= weekStart).map((x) => x.v);
    const mid = addDays(weekStart, 3);
    const sameSeason = series.filter((x) => x.d < addDays(weekStart, -300) && doyDist(x.d, mid) <= 30).map((x) => x.v);
    const seasonal = sameSeason.length >= 14;
    const before = seasonal ? sameSeason : series.filter((x) => x.d < weekStart && x.d >= addDays(weekStart, -365)).map((x) => x.v);
    if (week.length >= 4 && before.length >= 14) {
      const mw = mean(week), mb = mean(before), diff = mw - mb;
      const z = Math.abs(diff) / (sd(before) || 1);
      let txt = fmtDiff(q, diff, mb);
      if (seasonal) txt = txt.replace("deinem Schnitt", "deinem Schnitt um diese Jahreszeit").replace("als sonst", "als sonst um diese Jahreszeit");
      const b = betterDir(q), tone = b ? ((diff > 0) === (b === "high") ? " good" : " bad") : "";
      if (z >= 0.4) out.push({ score: 1 + z, tone, html: `<strong>${name} diese Woche Ø ${fmtNice(q, mw)}</strong>, ${txt}` });
    }

    // 2. Wochentagsmuster (mind. 4 Werte je Wochentag)
    const byWd = Array.from({ length: 7 }, () => []);
    series.slice(-365).forEach((x) => byWd[parseIso(x.d).getDay()].push(x.v));
    if (byWd.every((a) => a.length >= 4)) {
      const means = byWd.map(mean);
      const hi = means.indexOf(Math.max(...means)), lo = means.indexOf(Math.min(...means));
      const spread = (means[hi] - means[lo]) / sdAll;
      if (spread >= 0.5) out.push({ score: 0.8 + spread, html: `${name}: <strong>${WD_PLURAL[hi]} ${w.hi}</strong> (Ø ${fmtNice(q, means[hi])}), ${WD_PLURAL[lo]} ${w.lo} (Ø ${fmtNice(q, means[lo])})` });
    }

    // 3. Rekord: letzter Wert ist der höchste/niedrigste seit langem
    const lastPt = series[series.length - 1];
    if (lastPt.d >= addDays(t, -2)) {
      for (const dir of [1, -1]) {
        let i = series.length - 2;
        while (i >= 0 && (dir > 0 ? series[i].v < lastPt.v : series[i].v > lastPt.v)) i--;
        const spanDays = Math.round((parseIso(lastPt.d) - parseIso(i >= 0 ? series[i].d : series[0].d)) / 864e5);
        if (spanDays < 21) continue;
        const since = i >= 0 ? `seit ${niceDate(series[i].d)}` : "seit Beginn der Aufzeichnung";
        const label = q.healthKey === "schritte" ? `${dir > 0 ? w.top : w.bottom} Schritte` : q.format ? `${dir > 0 ? w.top : w.bottom} ${name}` : `${dir > 0 ? w.top : w.bottom} bei „${name}“`;
        out.push({ score: 1.5 + Math.min(spanDays / 60, 2), html: `<strong>${label} ${since}</strong>: ${fmtNice(q, lastPt.v)} am ${shortDate(lastPt.d)}` });
      }
    }

    // 4. Serien über einer Schwelle (bis gestern bzw. heute)
    let rule = null;
    if (q.healthKey === "schritte") rule = { ok: (v) => v >= 10000, text: (n) => `${n} Tage in Folge über 10.000 Schritte` };
    else if (q.format === "duration") rule = { ok: (v) => v >= 7, text: (n) => `${n} Nächte in Folge mindestens 7 h geschlafen` };
    else if (q.format === "clock") rule = { ok: (v) => v < 24, text: (n) => `${n} Nächte in Folge vor Mitternacht eingeschlafen` };
    else if (betterDir(q)) {
      const m = mean(all), lowGood = betterDir(q) === "low";
      rule = { ok: (v) => (lowGood ? v < m : v > m), text: (n) => `${n} Tage in Folge „${name}“ ${lowGood ? "unter" : "über"} deinem Schnitt (Ø ${fmtNice(q, m)})` };
    }
    let n = 0, d = lastPt.d;
    if (!rule) continue;
    const val = Object.fromEntries(series.map((x) => [x.d, x.v]));
    if (d >= addDays(t, -2)) while (val[d] !== undefined && rule.ok(val[d])) { n++; d = addDays(d, -1); }
    if (n >= 3) out.push({ score: 1 + n / 3, html: `<strong>${rule.text(n)}</strong>` });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Zuerst die auffälligsten je Art, der Rest aufklappbar
const T_PREVIEW = { streak: 2, num: 3, season: 2, rel: 2 };
let showAllTrends = false;
function trendsPanel(days) {
  const all = { streak: streakInsights(), num: numberInsights(), season: seasonInsights(), rel: relationInsights(days) };
  const lim = (k) => (showAllTrends ? all[k] : all[k].slice(0, T_PREVIEW[k]));
  const streaks = lim("streak"), nums = lim("num"), seasons = lim("season"), rel = lim("rel");
  const hidden = Object.keys(all).reduce((n, k) => n + Math.max(all[k].length - T_PREVIEW[k], 0), 0);
  const row = (x, kind) => `<li class="trow ${kind}${x.tone || ""}"><span class="tmark" aria-hidden="true"></span><span>${x.html}${x.note ? ` <span class="muted small">· ${x.note}</span>` : ""}</span></li>`;
  return `<section class="panel trends">
    <h2 class="atitle">Trends</h2>
    ${streaks.length || rel.length || nums.length || seasons.length ? `
      ${streaks.length ? `<ul class="tlist">${streaks.map((x) => row(x, "streak")).join("")}</ul>` : ""}
      ${nums.length ? `<ul class="tlist" ${streaks.length ? 'style="margin-top:10px"' : ""}>${nums.map((x) => row(x, "num")).join("")}</ul>` : ""}
      ${seasons.length ? `<p class="tsub small muted">Jahreszeiten (alle bisherigen Daten)</p><ul class="tlist">${seasons.map((x) => row(x, "season")).join("")}</ul>` : ""}
      ${rel.length ? `<p class="tsub small muted">Auffällige Zusammenhänge im gewählten Zeitraum</p><ul class="tlist">${rel.map((x) => row(x, "rel")).join("")}</ul>` : ""}
      ${hidden ? `<button class="btn ghost block" id="tmore" style="margin-top:12px">${showAllTrends ? "Weniger anzeigen" : `Alle Trends anzeigen (${hidden} weitere)`}</button>` : ""}
      ${rel.length ? `<p class="small muted tfoot">Zeigt nur deutliche Unterschiede ab ${MIN_GROUP} Tagen je Gruppe. Ein Zusammenhang heißt nicht, dass das eine das andere verursacht.</p>` : ""}`
      : `<p class="muted small" style="margin:0">Noch nichts Auffälliges. Serien erscheinen ab 3 Tagen am Stück, Zusammenhänge meist nach ein paar Wochen Daten.</p>`}
  </section>`;
}

/* ================= Ziele ================= */
// Gespeichert in state.goals (mit in der Sicherung):
// { period: "week"|"month"|"year", items: [Ziel], seenPeriod, seenFails }
// Ziel: { id, qid, kind: "count"|"days"|"avg"|"sum", key, op: "min"|"max", n, cmp: "ge"|"le", val }
const GOAL_PERIODS = [["week", "Woche"], ["month", "Monat"], ["year", "Jahr"]];
const PER_WORD = { week: "pro Woche", month: "im Monat", year: "im Jahr" };
const PREV_WORD = { week: "Letzte Woche", month: "Letzter Monat", year: "Letztes Jahr" };
const GOAL_PREVIEW = 3;
let showAllGoals = false;

function G() {
  if (!state.goals || typeof state.goals !== "object") state.goals = {};
  const g = state.goals;
  if (!GOAL_PERIODS.some(([k]) => k === g.period)) g.period = "month";
  if (!Array.isArray(g.items)) g.items = [];
  if (!Array.isArray(g.seenFails)) g.seenFails = [];
  return g;
}
const goalItems = () => G().items.filter((x) => { const q = qById(x.qid); return q && !q.archived; });
const dayCount = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 864e5) + 1;
const dm = (s) => { const d = parseIso(s); return `${d.getDate()}.${d.getMonth() + 1}.`; };

// Zeitraum (Kalenderwoche ab Montag, Kalendermonat, Kalenderjahr), der den Tag d enthält
function periodOf(kind, d) {
  if (kind === "week") {
    const s = mondayOf(d), e = addDays(s, 6);
    return { kind, start: s, end: e, key: `week:${s}`, name: `Woche ${dm(s)}–${dm(e)}` };
  }
  if (kind === "year") {
    const y = d.slice(0, 4);
    return { kind, start: `${y}-01-01`, end: `${y}-12-31`, key: `year:${y}`, name: y };
  }
  const s = d.slice(0, 7) + "-01";
  const nx = parseIso(s); nx.setMonth(nx.getMonth() + 1);
  const x = parseIso(s);
  return { kind, start: s, end: addDays(iso(nx), -1), key: `month:${s}`, name: `${MON[x.getMonth()]} ${x.getFullYear()}` };
}
const prevPeriod = (p) => periodOf(p.kind, addDays(p.start, -1));

// Wörter für Vergleich: bei Uhrzeiten früh/spät, sonst mindestens/höchstens
const cmpWord = (q, cmp) => (q.format === "clock" ? (cmp === "le" ? "spätestens" : "frühestens") : (cmp === "le" ? "höchstens" : "mindestens"));
const cmpOk = (cmp, v, x) => (cmp === "le" ? v <= x : v >= x);
const valText = (q, v) => (q.type === "scale" ? String(v) : fmtNice(q, v));

function goalText(g, q) {
  if (g.kind === "count") return `${g.op === "max" ? "höchstens" : "mindestens"} ${g.n}× „${esc(g.key)}“`;
  if (g.kind === "days") return `an mindestens ${g.n} Tagen ${cmpWord(q, g.cmp)} ${valText(q, g.val)}`;
  if (g.kind === "sum") return `insgesamt ${cmpWord(q, g.cmp)} ${valText(q, g.val)}`;
  return `im Schnitt ${cmpWord(q, g.cmp)} ${valText(q, g.val)}`;
}

// Stand eines Ziels in einem Zeitraum. status: done | ok | behind | fail | none
function evalGoal(g, per) {
  const q = qById(g.qid);
  const t = todayIso();
  // Health-Werte von heute sind noch unvollständig → erst ab morgen zählen
  const last0 = isHealthQ(q) ? addDays(t, -1) : t;
  const last = per.end < last0 ? per.end : last0;
  const ended = per.end < t;
  const total = dayCount(per.start, per.end);
  const counted = last >= per.start ? dayCount(per.start, last) : 0; // Tage, die schon zählen
  const vals = [];
  for (let d = per.start; d <= last; d = addDays(d, 1)) {
    const v = (state.answers[d] || {})[q.id];
    if (isAnswered(v)) vals.push({ d, v });
  }
  // Tage, an denen noch etwas dazukommen kann (heute zählt, solange unbeantwortet)
  let rest = ended ? 0 : dayCount(t, per.end) - (isHealthQ(q) ? 0 : 1);
  if (!ended && !isHealthQ(q) && !isAnswered((state.answers[t] || {})[q.id])) rest += 1;
  const daysLeft = ended ? 0 : dayCount(t, per.end);
  const pace = counted / total;
  const r = { q, g, ended, vals: vals.length, daysLeft };

  if (g.kind === "avg") {
    const nums = vals.map((x) => x.v).filter((v) => typeof v === "number");
    if (!nums.length) return { ...r, status: ended ? "fail" : "none", cur: "noch keine Werte", frac: null };
    const a = mean(nums);
    const ok = cmpOk(g.cmp, a, g.val);
    return { ...r, status: ok ? (ended ? "done" : "ok") : (ended ? "fail" : "behind"), cur: `Ø ${valText(q, Math.round(a * 100) / 100)}`, frac: null, curVal: a };
  }

  let c;
  if (g.kind === "count") c = vals.filter((x) => has(x.v, g.key)).length;
  else if (g.kind === "days") c = vals.filter((x) => typeof x.v === "number" && cmpOk(g.cmp, x.v, g.val)).length;
  else c = vals.reduce((s, x) => s + (typeof x.v === "number" ? x.v : 0), 0);
  const target = g.kind === "sum" ? g.val : g.n;
  const upper = g.kind === "sum" ? g.cmp === "le" : g.op === "max"; // „höchstens“-Ziel
  const curTxt = upper && g.kind !== "sum" ? `${c}× · erlaubt ${target}×` : g.kind === "sum" ? `${valText(q, Math.round(c * 100) / 100)} von ${valText(q, target)}` : `${c} von ${target}${g.kind === "count" ? "×" : " Tagen"}`;
  const frac = target > 0 ? Math.min(c / target, 1) : 1;

  if (upper) {
    if (c > target) return { ...r, status: "fail", over: true, cur: curTxt, frac: 1, c, target };
    return { ...r, status: ended ? "done" : "ok", cur: curTxt, frac, c, target, upper: true,
      note: ended ? "" : g.kind === "sum" ? "" : `noch ${target - c}× übrig` };
  }
  if (c >= target) return { ...r, status: "done", cur: curTxt, frac: 1, c, target };
  if (ended) return { ...r, status: "fail", cur: curTxt, frac, c, target };
  if (g.kind !== "sum" && c + rest < target) return { ...r, status: "fail", impossible: true, cur: curTxt, frac, c, target };
  const behind = c < target * pace * 0.9 - 0.01;
  const need = target - c;
  return { ...r, status: behind ? "behind" : "ok", cur: curTxt, frac, c, target,
    note: g.kind === "sum" ? `noch ${valText(q, Math.round(need * 100) / 100)} in ${daysLeft} Tagen` : `noch ${need} in ${daysLeft} Tag${daysLeft === 1 ? "" : "en"}` };
}

const STATUS = {
  done: "Erreicht",
  ok: "Auf Kurs",
  behind: "Hinterher",
  none: "Noch offen"
};
const statusLabel = (e) => (e.status === "fail" ? (e.over ? "Überschritten" : e.impossible ? "Nicht mehr erreichbar" : "Verfehlt") : STATUS[e.status]);
const STATUS_ORDER = { fail: 0, behind: 1, none: 2, ok: 3, done: 4 };

function goalRow(e) {
  const bar = e.frac === null ? "" : `<span class="gbar"><span style="width:${Math.round(e.frac * 100)}%"></span></span>`;
  return `<li class="grow st-${e.status}">
    <div class="gtop"><span class="gq">${esc(e.q.text)}</span><span class="gst"><span class="gdot" aria-hidden="true"></span>${statusLabel(e)}</span></div>
    <div class="gdesc small muted">${goalText(e.g, e.q)}</div>
    ${bar}
    <div class="gcur small"><strong>${e.cur}</strong>${e.note ? ` · ${e.note}` : ""}</div>
  </li>`;
}

// Bereich „Ziele“ in der Analyse
function goalsPanel() {
  const gs = G();
  const items = goalItems();
  if (!items.length) {
    return `<section class="panel goals"><h2 class="atitle">Ziele</h2>
      <p class="muted small" style="margin:0">Noch keine Ziele. Leg sie unter „Tag“ über das Zahnrad oben rechts an.</p></section>`;
  }
  const per = periodOf(gs.period, todayIso());
  const evals = items.map((g) => evalGoal(g, per)).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const n = (s) => evals.filter((e) => e.status === s).length;
  const parts = [];
  if (n("done")) parts.push(`${n("done")} erreicht`);
  if (n("ok")) parts.push(`${n("ok")} auf Kurs`);
  if (n("behind")) parts.push(`${n("behind")} hinterher`);
  if (n("fail")) parts.push(`${n("fail")} verfehlt`);
  if (n("none")) parts.push(`${n("none")} offen`);
  const left = dayCount(todayIso(), per.end);
  const shown = showAllGoals ? evals : evals.slice(0, GOAL_PREVIEW);

  // frühere Zeiträume (höchstens 6), nur mit heutigen Zielen bewertet
  const hist = [];
  let p = prevPeriod(per);
  const first = Object.keys(state.answers).sort()[0];
  for (let i = 0; i < 6 && first && p.start >= first; i++, p = prevPeriod(p)) {
    const ev = items.map((g) => evalGoal(g, p));
    hist.push({ p, ok: ev.filter((e) => e.status === "done").length, all: ev.length, miss: ev.filter((e) => e.status !== "done") });
  }

  return `<section class="panel goals">
    <div class="ghead"><h2 class="atitle">Ziele</h2><span class="small muted">${esc(per.name)} · noch ${left} Tag${left === 1 ? "" : "e"}</span></div>
    <p class="gsum small">${parts.join(" · ")}</p>
    <ul class="glist">${shown.map(goalRow).join("")}</ul>
    ${evals.length > GOAL_PREVIEW ? `<button class="btn ghost block" id="gmore" style="margin-top:10px">${showAllGoals ? "Weniger anzeigen" : `Alle Ziele anzeigen (${evals.length - GOAL_PREVIEW} weitere)`}</button>` : ""}
    ${hist.length ? `<details class="ghist">
      <summary>${PREV_WORD[gs.period]}: ${hist[0].ok} von ${hist[0].all} erreicht</summary>
      <ul class="hlist">${hist.map((h) => `<li><span class="hn">${esc(h.p.name)}</span><span class="hv ${h.ok === h.all ? "all" : ""}">${h.ok}/${h.all}</span>
        ${h.miss.length ? `<span class="hm small muted">verfehlt: ${h.miss.map((e) => esc(e.q.text)).join(", ")}</span>` : ""}</li>`).join("")}</ul>
      <p class="small muted" style="margin:8px 0 0">Bewertet mit deinen aktuellen Zielen.</p>
    </details>` : ""}
  </section>`;
}

// Hinweis: Zeitraum vorbei (mit verfehlten Zielen) oder Ziel nicht mehr erreichbar
function goalNotices() {
  const gs = G();
  const items = goalItems();
  if (!items.length || quiz || document.querySelector("dialog[open]")) return;
  const per = periodOf(gs.period, todayIso());
  const prev = prevPeriod(per);
  let summary = null;
  if (gs.seenPeriod !== prev.key && gs.seenPeriod !== per.key) {
    const ev = items.map((g) => evalGoal(g, prev));
    gs.seenPeriod = prev.key;
    const ok = ev.filter((e) => e.status === "done").length;
    if (ok === ev.length) toast(`${prev.name}: alle ${ev.length} Ziele erreicht!`);
    else summary = { ev, ok };
  }
  gs.seenFails = gs.seenFails.filter((k) => k.startsWith(per.key + "|"));
  const fresh = items.map((g) => evalGoal(g, per)).filter((e) => e.status === "fail" && !gs.seenFails.includes(`${per.key}|${e.g.id}`));
  fresh.forEach((e) => gs.seenFails.push(`${per.key}|${e.g.id}`));
  save();
  if (!summary && !fresh.length) return;

  const dlg = $("#sheet");
  dlg.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><span></span><h2>Ziele</h2><button type="button" class="linkbtn" id="gok">Okay</button></div>
    ${summary ? `<section class="sq">
      <p class="gbig"><strong>${esc(prev.name)}</strong> ist vorbei: ${summary.ok} von ${summary.ev.length} Zielen erreicht.</p>
      <ul class="glist">${summary.ev.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]).map(goalRow).join("")}</ul>
    </section>` : ""}
    ${fresh.length ? `<section class="sq">
      <p class="gbig">${fresh.length === 1 ? "Ein Ziel ist" : `${fresh.length} Ziele sind`} für ${esc(per.name)} nicht mehr zu schaffen.</p>
      <ul class="glist">${fresh.map(goalRow).join("")}</ul>
    </section>` : ""}
    <button type="button" class="btn ghost block" id="gadj">Ziele anpassen</button>
  </div>`;
  $("#gok", dlg).addEventListener("click", () => dlg.close());
  $("#gadj", dlg).addEventListener("click", () => { dlg.close(); openGoals(); });
  dlg.showModal();
  document.activeElement?.blur();
}

// Vorschlag für ein neues Ziel je nach Frage
function goalDraft(q, period) {
  const per = { week: 1, month: 4, year: 50 }[period];
  if (q.type === "choice") return { kind: "count", key: q.options.includes("Ja") ? "Ja" : q.options[0], op: "min", n: Math.min(3 * per, 300) };
  const nums = Object.values(state.answers).map((a) => a[q.id]).filter((v) => typeof v === "number");
  let val = nums.length ? mean(nums.slice(-60)) : q.type === "scale" ? q.max : 0;
  if (q.type === "scale") val = Math.round(val);
  else if (q.format) val = Math.round(val * 4) / 4;
  else val = Math.round(val);
  return { kind: "avg", cmp: betterDir(q) === "low" ? "le" : "ge", val, n: period === "week" ? 5 : period === "month" ? 20 : 250 };
}

// Zahnrad auf „Tag“: Zeitraum wählen, Ziele anlegen, ändern, löschen
function openGoals() {
  const dlg = $("#sheet");
  let edit = null; // Entwurf: { id, qid, ...Ziel }, isNew
  const qs = () => ordered().map((o) => o.q).filter((q) => !q.archived);

  const kindSeg = (q, k) => {
    const opts = [["avg", "Schnitt"], ["days", "Tage"]];
    if (q.type === "number" && q.format !== "clock") opts.push(["sum", "Summe"]);
    return `<div class="seg seg-${opts.length}" role="group">${opts.map(([v, l]) => `<button type="button" data-gk="${v}" aria-pressed="${k === v}">${l}</button>`).join("")}</div>`;
  };
  const seg2 = (attr, opts, cur) => `<div class="seg seg-2" role="group">${opts.map(([v, l]) => `<button type="button" data-${attr}="${v}" aria-pressed="${cur === v}">${l}</button>`).join("")}</div>`;
  const valInput = (q, v) => {
    const shown = v === null || v === undefined || v === "" ? "" : q.format ? fmtQ(q, v) : fmtNum(v);
    return `<input id="gval" class="gin wide" type="text" inputmode="${q.format ? "text" : "decimal"}" autocomplete="off" value="${esc(shown)}" placeholder="${q.format === "clock" ? "23:30" : q.format === "duration" ? "7:00" : "Wert"}">${q.unit && !q.format ? `<span class="muted">${esc(q.unit)}</span>` : ""}`;
  };

  const form = () => {
    const q = qById(edit.qid);
    const per = PER_WORD[G().period];
    let f = `<label class="field">Frage<select id="gq">${qs().map((x) => `<option value="${x.id}" ${x.id === q.id ? "selected" : ""}>${esc(x.text)}</option>`).join("")}</select></label>`;
    if (q.type === "choice") {
      f += `<div class="sq-row"><span>Antwort</span><select id="gkey">${q.options.map((o) => `<option ${o === edit.key ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
        <div class="sq-row"><span>Wie oft</span>${seg2("gop", [["min", "mindestens"], ["max", "höchstens"]], edit.op)}</div>
        <div class="gline"><input id="gn" class="gin" type="text" inputmode="numeric" value="${esc(edit.n ?? "")}"><span>× ${per}</span></div>`;
    } else {
      f += `<div class="sq-row"><span>Art</span>${kindSeg(q, edit.kind)}</div>`;
      if (edit.kind === "days") f += `<div class="gline"><span>an mindestens</span><input id="gn" class="gin" type="text" inputmode="numeric" value="${esc(edit.n ?? "")}"><span>Tagen ${per}</span></div>`;
      f += `<div class="sq-row"><span>${edit.kind === "days" ? "mit Wert" : edit.kind === "sum" ? "Summe" : "Schnitt"}</span>${seg2("gcmp", q.format === "clock" ? [["le", "spätestens"], ["ge", "frühestens"]] : [["ge", "mindestens"], ["le", "höchstens"]], edit.cmp)}</div>
        <div class="gline">${valInput(q, edit.val)}</div>`;
    }
    const valid = goalValid(edit, q);
    f += `<p class="gprev small">${valid ? `Ziel: <strong>${goalText(edit, q)}</strong> ${per}` : `<span class="muted">Bitte ${q.type === "choice" || edit.kind === "days" ? "Anzahl" : "Wert"} eintragen</span>`}</p>
      <div class="gbtns"><button type="button" class="btn ghost" id="gcancel">Abbrechen</button><button type="button" class="btn" id="gsave">${edit.isNew ? "Ziel anlegen" : "Sichern"}</button></div>`;
    return `<section class="sq gform" id="gform">${f}</section>`;
  };

  // Eingaben in den Entwurf übernehmen
  const sync = () => {
    if (!edit) return;
    const q = qById(edit.qid);
    const gn = $("#gn", dlg), gv = $("#gval", dlg), gk = $("#gkey", dlg);
    if (gk) edit.key = gk.value;
    if (gn) { const n = parseInt(gn.value, 10); edit.n = Number.isFinite(n) ? n : null; }
    if (gv) { const v = parseQ(q, gv.value); edit.val = v === null || Number.isNaN(v) ? null : v; }
  };

  const draw = () => {
    const gs = G();
    const keep = dlg.querySelector(".sheet-inner")?.scrollTop || 0;
    const per = periodOf(gs.period, todayIso());
    const items = gs.items.filter((x) => qById(x.qid));
    dlg.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><span></span><h2>Ziele</h2><button type="button" class="linkbtn" id="gdone">Fertig</button></div>
      <section class="sq">
        <div class="sq-row"><span>Zeitraum</span><div class="seg seg-3" role="group">${GOAL_PERIODS.map(([k, l]) => `<button type="button" data-gper="${k}" aria-pressed="${gs.period === k}">${l}</button>`).join("")}</div></div>
        <p class="muted small" style="margin:8px 0 0">Gilt für alle Ziele. Aktuell: ${esc(per.name)} (${dm(per.start)}–${dm(per.end)}).</p>
      </section>
      ${items.map((g) => {
        const q = qById(g.qid);
        if (edit && edit.id === g.id) return form();
        return `<section class="sq ${q.archived ? "off" : ""}">
          <div class="sq-head"><strong>${esc(q.text)}</strong>
            <button type="button" class="iconbtn" data-gdel="${g.id}" aria-label="Ziel löschen">✕</button></div>
          <button type="button" class="gedit" data-gedit="${g.id}">${goalText(g, q)} ${PER_WORD[gs.period]}${q.archived ? " · Frage ausgeblendet" : ""}<span class="muted"> · ändern</span></button>
        </section>`;
      }).join("")}
      ${edit && edit.isNew ? form() : ""}
      ${!edit ? (qs().length ? `<button type="button" class="btn block" id="gadd">Ziel hinzufügen</button>`
        : `<p class="muted small">Leg zuerst unter Einstellungen → Fragen eine Frage an.</p>`) : ""}
      ${!items.length && !edit && qs().length ? `<p class="muted small" style="margin-top:12px">Zum Beispiel: „Heute bouldern?“ mindestens 8× „Ja“ im Monat, oder Schlafdauer im Schnitt mindestens 7 h. Den Stand siehst du unter Analyse → Ziele.</p>` : ""}
    </div>`;
    dlg.querySelector(".sheet-inner").scrollTop = keep;

    $("#gdone", dlg).addEventListener("click", () => dlg.close());
    dlg.querySelectorAll("[data-gper]").forEach((b) => b.addEventListener("click", () => {
      sync();
      gs.period = b.dataset.gper;
      // beim Wechsel keinen Rückblick auf einen alten Zeitraum aufpoppen lassen
      gs.seenPeriod = prevPeriod(periodOf(gs.period, todayIso())).key;
      save(); draw(); render();
    }));
    $("#gadd", dlg)?.addEventListener("click", () => {
      const q = qs()[0];
      edit = { id: uid(), qid: q.id, ...goalDraft(q, gs.period), isNew: true };
      draw();
      $("#gform", dlg)?.scrollIntoView({ block: "nearest" });
    });
    dlg.querySelectorAll("[data-gedit]").forEach((b) => b.addEventListener("click", () => {
      edit = { ...gs.items.find((x) => x.id === b.dataset.gedit), isNew: false };
      draw();
    }));
    dlg.querySelectorAll("[data-gdel]").forEach((b) => b.addEventListener("click", () => {
      const g = gs.items.find((x) => x.id === b.dataset.gdel);
      if (!confirm(`Ziel für „${qById(g.qid).text}“ löschen? Deine Antworten bleiben erhalten.`)) return;
      gs.items = gs.items.filter((x) => x.id !== g.id);
      save(); draw(); render(); toast("Ziel gelöscht");
    }));
    if (!edit) return;
    // Formular
    $("#gq", dlg).addEventListener("change", (e) => {
      const q = qById(e.target.value);
      edit = { id: edit.id, qid: q.id, ...goalDraft(q, gs.period), isNew: edit.isNew };
      draw();
    });
    $("#gkey", dlg)?.addEventListener("change", () => { sync(); draw(); });
    dlg.querySelectorAll("[data-gop]").forEach((b) => b.addEventListener("click", () => { sync(); edit.op = b.dataset.gop; draw(); }));
    dlg.querySelectorAll("[data-gcmp]").forEach((b) => b.addEventListener("click", () => { sync(); edit.cmp = b.dataset.gcmp; draw(); }));
    dlg.querySelectorAll("[data-gk]").forEach((b) => b.addEventListener("click", () => {
      sync(); edit.kind = b.dataset.gk;
      if (edit.kind === "sum" && edit.val !== null) { // Summe: Tageswert × Tage als Vorschlag
        const days = dayCount(periodOf(gs.period, todayIso()).start, periodOf(gs.period, todayIso()).end);
        edit.val = Math.round(edit.val * days);
      }
      draw();
    }));
    dlg.querySelectorAll("#gn, #gval").forEach((inp) => {
      inp.addEventListener("change", () => {
        const before = inp.value;
        sync();
        const prev = dlg.querySelector(".gprev");
        const q = qById(edit.qid);
        if (prev) prev.innerHTML = goalValid(edit, q) ? `Ziel: <strong>${goalText(edit, q)}</strong> ${PER_WORD[gs.period]}` : `<span class="muted">Bitte gültige Zahl eintragen</span>`;
        if (inp.id === "gval" && q.format && edit.val !== null) inp.value = fmtQ(q, edit.val);
        else inp.value = before;
      });
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
    });
    $("#gcancel", dlg).addEventListener("click", () => { edit = null; draw(); });
    $("#gsave", dlg).addEventListener("click", () => {
      sync();
      const q = qById(edit.qid);
      if (!goalValid(edit, q)) return toast(q.type === "choice" || edit.kind === "days" ? "Bitte eine Anzahl ab 1 eintragen" : "Bitte einen Wert eintragen");
      const { isNew, ...g } = edit;
      // nur die Felder behalten, die zur Art passen
      const clean = q.type === "choice" ? { id: g.id, qid: g.qid, kind: "count", key: g.key, op: g.op, n: g.n }
        : { id: g.id, qid: g.qid, kind: g.kind, cmp: g.cmp, val: g.val, ...(g.kind === "days" ? { n: g.n } : {}) };
      if (!gs.seenPeriod) gs.seenPeriod = prevPeriod(periodOf(gs.period, todayIso())).key;
      const i = gs.items.findIndex((x) => x.id === g.id);
      if (i >= 0) gs.items[i] = clean; else gs.items.push(clean);
      // geändertes Ziel darf wieder einen Hinweis auslösen
      gs.seenFails = gs.seenFails.filter((k) => !k.endsWith("|" + g.id));
      edit = null;
      save(); draw(); render();
      toast(isNew ? "Ziel angelegt" : "Ziel gesichert");
    });
  };

  draw();
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

function goalValid(g, q) {
  if (!q) return false;
  if (q.type === "choice" || g.kind === "days") {
    if (!Number.isInteger(g.n) || g.n < (q.type === "choice" && g.op === "max" ? 0 : 1)) return false;
  }
  if (q.type === "choice") return q.options.includes(g.key);
  return typeof g.val === "number" && Number.isFinite(g.val);
}

/* ================= Wochenbericht ================= */
// Standard: sonntags die laufende Woche, sonst die letzte abgeschlossene Woche
const reportDefaultWeek = () => { const t = todayIso(); const m = mondayOf(t); return parseIso(t).getDay() === 0 ? m : addDays(m, -7); };
const kw = (s) => { // ISO-Kalenderwoche
  const d = parseIso(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const y1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - y1) / 864e5 - 3 + ((y1.getDay() + 6) % 7)) / 7);
};

// Kennzahl einer Frage für eine Woche, verglichen mit den 8 Wochen davor
function weekStat(q, mon) {
  const t = todayIso();
  const lastOk = isHealthQ(q) ? addDays(t, -1) : t;
  const daysOf = (m) => Array.from({ length: 7 }, (_, i) => addDays(m, i)).filter((d) => d <= lastOk);
  const valsOf = (m) => daysOf(m).map((d) => (state.answers[d] || {})[q.id]).filter(isAnswered);
  const now = valsOf(mon);
  const prevWeeks = Array.from({ length: 8 }, (_, i) => valsOf(addDays(mon, -7 * (i + 1)))).filter((v) => v.length);
  if (!now.length) return null;
  if (q.type === "choice") {
    const s = qset(q);
    const key = q.options.includes(s.countKey) ? s.countKey : q.options.includes("Ja") ? "Ja" : q.options[0];
    const c = now.filter((v) => has(v, key)).length;
    const prev = prevWeeks.length ? mean(prevWeeks.map((w) => w.filter((v) => has(v, key)).length)) : null;
    return { val: `${c}× „${esc(key)}“`, cmp: prev === null ? "" : `sonst Ø ${fmt1(prev)}×`, dir: prev === null ? 0 : Math.sign(Math.round((c - prev) * 10)), good: null };
  }
  const nums = now.filter((v) => typeof v === "number");
  if (!nums.length) return null;
  const m = mean(nums);
  const prevAll = prevWeeks.flat().filter((v) => typeof v === "number");
  const pm = prevAll.length ? mean(prevAll) : null;
  const f = (v) => (q.type === "scale" ? fmt1(v) : fmtNice(q, v));
  const big = pm !== null && Math.abs(m - pm) > (sd(prevAll) || 1) * 0.25;
  const dir = big ? Math.sign(m - pm) : 0, b = betterDir(q);
  return { val: `Ø ${f(m)}`, cmp: pm === null ? "" : `sonst Ø ${f(pm)}`, dir, good: dir && b ? (dir > 0) === (b === "high") : null };
}

function reportHtml(mon) {
  const t = todayIso();
  const sun = addDays(mon, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i)).filter((d) => d <= t);
  const asked = (d) => askQuestions(d);
  const tracked = days.filter((d) => asked(d).some((q) => isAnswered((state.answers[d] || {})[q.id]))).length;
  const full = days.filter((d) => asked(d).length && dayProgress(d) === 1).length;
  const running = sun >= t;
  const range = `${dm(mon)}–${dm(sun)}${sun.slice(0, 4)}`;

  // Ziele: bei Wochenzielen genau diese Woche, sonst Stand des Monats/Jahres am Wochenende
  const gs = G();
  const items = goalItems();
  let goalsHtml = "";
  if (items.length) {
    const per = periodOf(gs.period, sun <= t ? sun : t);
    const ev = items.map((g) => evalGoal(g, per)).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    const done = ev.filter((e) => e.status === "done").length;
    const okn = ev.filter((e) => e.status === "ok").length;
    goalsHtml = `<section class="sq">
      <div class="ghead"><h3 class="rh">Ziele</h3><span class="small muted">${esc(per.name)}${per.end >= t ? " · Stand heute" : ""}</span></div>
      <p class="gsum small">${done} erreicht · ${okn} auf Kurs · ${ev.length - done - okn} offen oder verfehlt</p>
      <ul class="glist">${ev.map(goalRow).join("")}</ul>
    </section>`;
  }

  // Fragen der Woche
  const qs = ordered().map((o) => o.q).filter((q) => !q.archived);
  const rows = qs.map((q) => ({ q, s: weekStat(q, mon) })).filter((x) => x.s);
  const qHtml = rows.length ? `<section class="sq">
      <h3 class="rh">Deine Woche</h3>
      <ul class="wlist">${rows.map(({ q, s }) => `<li>
        <span class="wq">${esc(q.text)}</span>
        <span class="wv">${s.val}${s.dir ? `<span class="wdir ${s.dir > 0 ? "up" : "down"} ${s.good === true ? "good" : s.good === false ? "bad" : ""}" aria-label="${s.dir > 0 ? "mehr" : "weniger"} als sonst">${s.dir > 0 ? "▲" : "▼"}</span>` : ""}</span>
        ${s.cmp ? `<span class="wc small muted">${s.cmp}</span>` : ""}
      </li>`).join("")}</ul>
      <p class="small muted" style="margin:10px 0 0">„sonst“ = Schnitt der 8 Wochen davor.</p>
    </section>` : "";

  // Trends (immer der aktuelle Stand)
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(t, i - 29));
  const tr = [...streakInsights().slice(0, 3).map((x) => ({ ...x, k: "streak" })), ...numberInsights().slice(0, 3).map((x) => ({ ...x, k: "num" })), ...seasonInsights().slice(0, 1).map((x) => ({ ...x, k: "season" })), ...relationInsights(last30).slice(0, 2).map((x) => ({ ...x, k: "rel" }))];
  const trHtml = tr.length ? `<section class="sq">
      <div class="ghead"><h3 class="rh">Trends</h3><span class="small muted">aktueller Stand</span></div>
      <ul class="tlist">${tr.slice(0, 8).map((x) => `<li class="trow ${x.k}"><span class="tmark" aria-hidden="true"></span><span>${x.html}</span></li>`).join("")}</ul>
    </section>` : "";

  return `
    <section class="sq rtop">
      <p class="rkw">KW ${kw(mon)} · ${range}${running ? " · läuft noch" : ""}</p>
      ${weekPlaces(mon).length ? `<p class="rplaces small">📍 ${weekPlaces(mon).map(([c, n]) => `${esc(c)} <span class="muted">${n} Tag${n === 1 ? "" : "e"}</span>`).join(" · ")}</p>` : ""}
      <div class="rstats">
        <div><strong>${tracked}</strong><span>von ${days.length} Tagen erfasst</span></div>
        <div><strong>${full}</strong><span>Tage vollständig</span></div>
        ${items.length ? `<div><strong>${items.map((g) => evalGoal(g, periodOf(gs.period, sun <= t ? sun : t))).filter((e) => e.status === "done" || e.status === "ok").length}/${items.length}</strong><span>Ziele erreicht oder auf Kurs</span></div>` : ""}
      </div>
    </section>
    ${goalsHtml}${qHtml}${trHtml}
    ${!rows.length && !items.length ? `<p class="muted">In dieser Woche gibt es noch keine Antworten.</p>` : ""}`;
}

function openReport(mon) {
  if (quiz) { quiz = null; render(); }
  let week = mon || reportDefaultWeek();
  const dlg = $("#sheet");
  const first = Object.keys(state.answers).sort()[0];
  const draw = () => {
    const cur = mondayOf(todayIso());
    dlg.innerHTML = `<div class="sheet-inner report">
      <div class="sheet-head"><span></span><h2>Wochenbericht</h2><button type="button" class="linkbtn" id="rdone">Fertig</button></div>
      <div class="rnav">
        <button type="button" class="iconbtn" id="rprev" aria-label="Woche davor" ${first && week <= mondayOf(first) ? "disabled" : ""}>‹</button>
        <span>${week === cur ? "Diese Woche" : week === addDays(cur, -7) ? "Letzte Woche" : `KW ${kw(week)}`}</span>
        <button type="button" class="iconbtn" id="rnext" aria-label="Woche danach" ${week >= cur ? "disabled" : ""}>›</button>
      </div>
      ${reportHtml(week)}
    </div>`;
    $("#rdone", dlg).addEventListener("click", () => dlg.close());
    $("#rprev", dlg).addEventListener("click", () => { week = addDays(week, -7); draw(); dlg.querySelector(".sheet-inner").scrollTop = 0; });
    $("#rnext", dlg).addEventListener("click", () => { week = addDays(week, 7); draw(); dlg.querySelector(".sheet-inner").scrollTop = 0; });
  };
  draw();
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

// Kurztext für die Push-Mitteilung (nur Zusammenfassung, keine Antworten)
function reportTeaser() {
  const t = todayIso(), mon = mondayOf(t);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i)).filter((d) => d <= t);
  const tracked = days.filter((d) => askQuestions(d).some((q) => isAnswered((state.answers[d] || {})[q.id]))).length;
  let s = `${tracked} von 7 Tagen erfasst.`;
  const items = goalItems();
  if (items.length) {
    const ev = items.map((g) => evalGoal(g, periodOf(G().period, t)));
    const done = ev.filter((e) => e.status === "done").length, ok = ev.filter((e) => e.status === "ok").length;
    s += ` Ziele: ${done} erreicht${ok ? `, ${ok} auf Kurs` : ""}.`;
  }
  return s;
}

/* ================= Grafik erstellen (PNG) ================= */
// Bausteine, die als Bild gespeichert werden können – immer vollständig aufgeklappt
function withAllOpen(fn) {
  const keep = [showAllTrends, showAllGoals, showAllFriendChanges];
  showAllTrends = showAllGoals = showAllFriendChanges = true;
  try { return fn(); } finally { [showAllTrends, showAllGoals, showAllFriendChanges] = keep; }
}
const fileSafe = (s) => s.replace(/[^\wäöüÄÖÜß-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "Grafik";

function exportItems() {
  const items = [];
  const f = F();
  if (f.list.length) {
    items.push({ id: "fsum", group: "Freunde", label: `Übersicht und Quoten (${f.list.length} Freunde)`, file: "Freunde_Uebersicht", html: () => friendsSummaryHtml() });
    if (f.history.length) items.push({ id: "fchg", group: "Freunde", label: "Veränderung zum vorigen Stichtag", file: "Freunde_Veraenderung", html: () => withAllOpen(friendChangesPanel) });
    items.push({ id: "flist", group: "Freunde", label: "Liste nach Kategorien", file: "Freunde_Liste", html: () => friendsListHtml() });
  }
  if (state.questions.length) {
    const days = rangeDays(exportRange);
    const range = (RANGES.find(([k]) => k === exportRange) || [, ""])[1];
    items.push({ id: "trends", group: "Analyse", label: `Trends (${range})`, file: "Trends", html: () => withAllOpen(() => trendsPanel(days)) });
    if (goalItems().length) items.push({ id: "goals", group: "Analyse", label: "Ziele", file: "Ziele", html: () => withAllOpen(goalsPanel) });
    analysisQuestions(days).filter((q) => !qset(q).hidden).forEach((q) =>
      items.push({ id: "q:" + q.id, group: "Analyse", label: `${q.text} (${range})`, file: fileSafe(q.text), html: () => analysisCard(q, days) }));
    const wk = reportDefaultWeek();
    items.push({ id: "report", group: "Wochenbericht", label: `Wochenbericht KW ${kw(wk)}`, file: `Wochenbericht_KW${kw(wk)}`, html: () => `<div class="report">${reportHtml(wk)}</div>` });
  }
  return items;
}

let exportSel = new Set();
let exportRange = null; // eigener Zeitraum für Grafiken, startet mit dem der Analyse
function openExport() {
  const dlg = $("#sheet");
  if (!exportRange) exportRange = prefs.range;
  let items = exportItems();
  exportSel = new Set([...exportSel].filter((id) => items.some((x) => x.id === id)));
  const draw = () => {
    const groups = [...new Set(items.map((x) => x.group))];
    dlg.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><button type="button" class="linkbtn" id="xclose">Schließen</button><h2>Grafik erstellen</h2><span></span></div>
      ${items.length ? `
      <div class="field" style="font-weight:600;font-size:15px;margin-bottom:8px">Zeitraum für Analyse-Grafiken</div>
      <div class="seg seg4" role="group" aria-label="Zeitraum">${RANGES.map(([k, l]) => `<button type="button" data-xr="${k}" aria-pressed="${exportRange === k}">${l}</button>`).join("")}</div>
      <div class="xbar"><button type="button" class="linkbtn" id="xall">${exportSel.size === items.length ? "Keine auswählen" : "Alle auswählen"}</button><span class="muted small">${exportSel.size} ausgewählt</span></div>
      ${groups.map((g) => `<section class="sq"><strong>${g}</strong>
        ${items.filter((x) => x.group === g).map((x) => `<label class="xrow"><input type="checkbox" data-xid="${esc(x.id)}" ${exportSel.has(x.id) ? "checked" : ""}><span>${esc(x.label)}</span></label>`).join("")}
      </section>`).join("")}
      <p class="muted small">Bilder sind immer hell mit weißem Hintergrund, damit sie in Präsentationen passen.</p>
      <button type="button" class="btn block hold-btn" id="xgo" ${exportSel.size ? "" : "disabled"}>${exportSel.size > 1 ? `${exportSel.size} Bilder erstellen` : "Bild erstellen"}</button>`
      : `<p class="muted">Noch nichts da. Leg zuerst Fragen oder Freunde an.</p>`}
    </div>`;
    $("#xclose", dlg).addEventListener("click", () => dlg.close());
    dlg.querySelectorAll("[data-xr]").forEach((b) => b.addEventListener("click", () => {
      exportRange = b.dataset.xr;
      // Auswahl behalten: Kennungen ändern sich durch den Zeitraum nicht
      items = exportItems();
      const keep = dlg.querySelector(".sheet-inner").scrollTop;
      draw(); dlg.querySelector(".sheet-inner").scrollTop = keep;
    }));
    $("#xall", dlg)?.addEventListener("click", () => { exportSel = exportSel.size === items.length ? new Set() : new Set(items.map((x) => x.id)); draw(); });
    dlg.querySelectorAll("[data-xid]").forEach((c) => c.addEventListener("change", () => { if (c.checked) exportSel.add(c.dataset.xid); else exportSel.delete(c.dataset.xid); draw(); }));
    $("#xgo", dlg)?.addEventListener("click", () => makeImages(items.filter((x) => exportSel.has(x.id))));
  };
  draw();
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

// Bibliothek erst bei Bedarf laden
function loadScreenshotLib() {
  if (window.modernScreenshot) return Promise.resolve();
  return new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "vendor/modern-screenshot.min.js";
    sc.onload = () => res(); sc.onerror = () => rej(new Error("Grafik-Funktion konnte nicht geladen werden"));
    document.head.appendChild(sc);
  });
}

async function makeImages(list) {
  const dlg = $("#sheet");
  const inner = dlg.querySelector(".sheet-inner");
  const go = $("#xgo", dlg);
  if (go) { go.disabled = true; go.textContent = "Erstelle …"; }
  const out = [];
  try {
    await loadScreenshotLib();
    const stage = document.createElement("div");
    stage.className = "export-stage";
    document.body.appendChild(stage);
    const stamp = fdate(todayIso());
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (go) go.textContent = `Erstelle ${i + 1} von ${list.length} …`;
      stage.innerHTML = `<div class="export-card">${it.html()}<p class="export-foot">Mosaik · ${stamp}</p></div>`;
      const node = stage.firstElementChild;
      await new Promise((r) => requestAnimationFrame(() => r()));
      const url = await modernScreenshot.domToPng(node, { scale: 3, backgroundColor: "#FFFFFF" });
      const blob = await (await fetch(url)).blob();
      out.push({ name: `Mosaik_${it.file}_${todayIso()}.png`, url, blob, label: it.label });
    }
    stage.remove();
  } catch (e) {
    console.error(e);
    document.querySelector(".export-stage")?.remove();
    toast(e.message || "Bild konnte nicht erstellt werden");
    if (go) { go.disabled = false; go.textContent = "Nochmal versuchen"; }
    return;
  }
  // Ergebnis: Vorschau und Sichern (eigener Tipp nötig, sonst blockiert iOS das Teilen)
  inner.innerHTML = `<div class="sheet-head"><button type="button" class="linkbtn" id="xback">Zurück</button><h2>${out.length} Bild${out.length > 1 ? "er" : ""}</h2><button type="button" class="linkbtn" id="xclose">Fertig</button></div>
    <button type="button" class="btn block hold-btn" id="xshare">${out.length > 1 ? "Alle sichern oder teilen" : "Sichern oder teilen"}</button>
    <p class="muted small">„Bilder sichern“ legt sie in Fotos ab. Einzelne Bilder kannst du auch lange drücken.</p>
    <div class="xprev">${out.map((o, i) => `<figure><img src="${o.url}" alt="${esc(o.label)}"><figcaption><span>${esc(o.label)}</span><button type="button" class="linkbtn" data-xone="${i}">Einzeln</button></figcaption></figure>`).join("")}</div>`;
  $("#xclose", inner).addEventListener("click", () => dlg.close());
  $("#xback", inner).addEventListener("click", () => openExport());
  const share = async (files) => {
    const fs = files.map((o) => new File([o.blob], o.name, { type: "image/png" }));
    if (navigator.canShare && navigator.canShare({ files: fs })) {
      try { await navigator.share({ files: fs }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    // Fallback: einzeln herunterladen
    for (const o of files) {
      const a = document.createElement("a");
      a.href = o.url; a.download = o.name; document.body.appendChild(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  $("#xshare", inner).addEventListener("click", () => share(out));
  inner.querySelectorAll("[data-xone]").forEach((b) => b.addEventListener("click", () => share([out[+b.dataset.xone]])));
  inner.scrollTop = 0;
}

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
  const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&localityLanguage=de`);
  if (!res.ok) throw new Error("Ort nicht gefunden");
  const j = await res.json();
  const city = (j.city || j.locality || j.principalSubdivision || "").trim();
  if (!city) throw new Error("Ort nicht gefunden");
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
  placeBusy = true;
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 15000, maximumAge: manual ? 0 : 10 * 60 * 1000 }));
    const city = await cityFor(pos.coords.latitude, pos.coords.longitude);
    const now = new Date();
    settings.places.last = now.getTime(); saveSettings();
    const changed = addPlace(iso(now), city, `${pad(now.getHours())}:${pad(now.getMinutes())}`);
    if (changed) { save(); if (tab === "day" && !quiz && current === iso(now)) renderDay(); }
    if (manual) toast(`Ort: ${city}`);
  } catch (e) {
    if (manual) toast(e && e.code === 1 ? "Standort nicht erlaubt – iPhone-Einstellungen → Datenschutz → Ortungsdienste" : "Ort konnte nicht ermittelt werden");
  } finally { placeBusy = false; }
}

// Zeile unter dem Datum auf „Tag“
function placeLine(date) {
  const list = P()[date] || [];
  if (!list.length && !(settings.places && settings.places.on)) return "";
  return `<button class="placeline" id="placeedit" aria-label="Orte des Tages bearbeiten">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>
    <span>${list.length ? list.map((x) => esc(x.c)).join(" → ") : `<span class="muted">Noch kein Ort</span>`}</span>
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

/* ================= Fragen verwalten ================= */
// Fragen verwalten – als Feld in den Einstellungen; zeigt erst einige, aufklappbar
const Q_PREVIEW = 3;
let showAllQuestions = false;
function questionsPanel() {
  const all = ordered();
  const act = all.filter((o) => !o.q.archived);
  const arch = all.filter((o) => o.q.archived);
  const siblings = (q) => state.questions.filter((x) => !x.archived && (x.cond?.qid || null) === (q.cond?.qid || null));
  const row = ({ q, depth }) => {
    const sib = siblings(q);
    const pos = sib.indexOf(q);
    return `<li class="qrow ${q.archived ? "archived" : ""}" style="margin-left:${q.archived ? 0 : depth * 18}px">
      <button class="qmain" data-edit="${q.id}">
        <span class="qtext">${q.cond && !q.archived ? "↳ " : ""}${esc(q.text)}</span>
        <span class="qmeta">${q.friends ? "Vorlage Freunde · " : ""}${esc(describe(q))}${q.healthKey ? " · Health: " + esc(q.healthKey) : ""}</span>
        ${q.cond ? `<span class="qmeta">${esc(condText(q))}</span>` : ""}
      </button>
      ${q.archived ? "" : `
      <button class="iconbtn" data-move="${q.id}" data-dir="-1" aria-label="Nach oben" ${pos === 0 ? "disabled" : ""}>↑</button>
      <button class="iconbtn" data-move="${q.id}" data-dir="1" aria-label="Nach unten" ${pos === sib.length - 1 ? "disabled" : ""}>↓</button>`}
    </li>`;
  };
  const shown = showAllQuestions ? act : act.slice(0, Q_PREVIEW);
  const more = act.length - shown.length + (showAllQuestions ? 0 : arch.length);
  return `<section class="panel" id="qpanel">
      <div class="panel-head">
        <h2>Fragen</h2>
        <button class="addbtn" id="newq" aria-label="Neue Frage anlegen">+</button>
      </div>
      ${act.length ? `<ul class="qlist">${shown.map(row).join("")}</ul>` : `<p class="muted small" style="margin:0">Noch keine Fragen. Tippe auf +, um die erste anzulegen.</p>`}
      ${showAllQuestions ? `
        ${act.length ? `<p class="muted small" style="margin-top:10px">Folgefragen (↳) erscheinen nur nach einer bestimmten Antwort. Anlegen über + → „Nur fragen, wenn …“.</p>` : ""}
        ${arch.length ? `<h3 class="subhead">Ausgeblendet</h3>
          <p class="muted small">Werden nicht mehr abgefragt, bleiben aber im Excel-Export.</p>
          <ul class="qlist">${arch.map(row).join("")}</ul>` : ""}` : ""}
      ${more > 0 || showAllQuestions && (act.length > Q_PREVIEW || arch.length)
        ? `<button class="btn ghost block" id="qmore" style="margin-top:6px">${showAllQuestions ? "Weniger anzeigen" : `Alle Fragen anzeigen (${more} weitere)`}</button>` : ""}
    </section>`;
}

function wireQuestions(root) {
  $("#newq", root)?.addEventListener("click", () => openEditor(null));
  $("#qmore", root)?.addEventListener("click", () => { showAllQuestions = !showAllQuestions; refreshQuestions(); });
  root.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.edit)));
  root.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", () => {
    const q = qById(b.dataset.move);
    const sib = state.questions.filter((x) => !x.archived && (x.cond?.qid || null) === (q.cond?.qid || null));
    const other = sib[sib.indexOf(q) + Number(b.dataset.dir)];
    if (!other) return;
    const list = state.questions;
    const i1 = list.indexOf(q), i2 = list.indexOf(other);
    [list[i1], list[i2]] = [list[i2], list[i1]];
    save();
    refreshQuestions();
  }));
}

// nur das Fragen-Feld neu zeichnen (Scrollposition bleibt)
function refreshQuestions() {
  const old = $("#qpanel");
  if (!old) return render();
  const tmp = document.createElement("div");
  tmp.innerHTML = questionsPanel();
  const fresh = tmp.firstElementChild;
  old.replaceWith(fresh);
  wireQuestions(fresh);
}

/* ================= Freunde ================= */
// Gespeichert in state.friends (mit in der Sicherung):
// { stichtag, list: [{ id, name, cat, tags: {veg, rel, fem, smoke, acad}, isNew }], history: [{ date, list }], labels: {} }
const FCATS = [["best", "Beste Freunde"], ["good", "Gute Freunde"], ["friend", "Freunde"]];
const FTAGS = [
  { k: "veg", icon: "🌱", label: "Vegetarier" },
  { k: "rel", icon: "💍", label: "In Beziehung" },
  { k: "fem", icon: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="6" r="4"/><path d="M8 10v5M5.5 12.8h5"/></svg>`, label: "Frauen", cls: "fem" },
  { k: "smoke", icon: "🚬", label: "Raucher" },
  { k: "acad", icon: "🎓", label: "Akademiker (voraussichtlich)" }
];
const NEW_BADGE = `<svg class="fnew" viewBox="0 0 24 24" role="img" aria-label="Neu"><polygon points="23.0,12.0 20.9,14.4 21.5,17.5 18.5,18.5 17.5,21.5 14.4,20.9 12.0,23.0 9.6,20.9 6.5,21.5 5.5,18.5 2.5,17.5 3.1,14.4 1.0,12.0 3.1,9.6 2.5,6.5 5.5,5.5 6.5,2.5 9.6,3.1 12.0,1.0 14.4,3.1 17.5,2.5 18.5,5.5 21.5,6.5 20.9,9.6"/><text x="12" y="14.6" text-anchor="middle">NEW</text></svg>`;

function F() {
  if (!state.friends || typeof state.friends !== "object") state.friends = {};
  const f = state.friends;
  if (!Array.isArray(f.list)) f.list = [];
  if (!Array.isArray(f.history)) f.history = [];
  if (!f.labels || typeof f.labels !== "object") f.labels = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.stichtag || "")) f.stichtag = todayIso();
  return f;
}
const tagLabel = (t) => F().labels[t.k] || t.label;
const tagIcon = (t) => `<span class="ftag ${t.cls || ""}" title="${esc(tagLabel(t))}" aria-label="${esc(tagLabel(t))}">${t.icon}</span>`;
const friendIcons = (fr) => FTAGS.filter((t) => fr.tags && fr.tags[t.k]).map(tagIcon).join("") + (fr.isNew ? NEW_BADGE : "");
const fdate = (s) => { const d = parseIso(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
// Reihenfolge wie in der Übersicht: Beste, Gute, Freunde – innerhalb in Eingabereihenfolge
const friendsOrdered = (cats) => FCATS.flatMap(([c]) => F().list.filter((x) => x.cat === c && (!cats || cats.includes(c))));

// Fragen mit Vorlage „Freunde“ bekommen die aktuellen Namen als Antworten
function syncFriendQuestions() {
  let changed = false;
  for (const q of state.questions) {
    if (!q.friends || q.type !== "choice") continue;
    const names = friendsOrdered(q.friends.cats).map((x) => x.name);
    const opts = Array.from(new Set([...names, ...(q.extra || [])]));
    if (JSON.stringify(opts) !== JSON.stringify(q.options)) { q.options = opts; changed = true; }
  }
  return changed;
}

// Übersicht mit Gesamtzahl und Quoten (auch für „Grafik erstellen“)
function friendsSummaryHtml() {
  const f = F();
  const list = f.list;
  const n = list.length;
  const prev = f.history[f.history.length - 1];
  const delta = prev ? n - prev.list.length : null;
  const cnt = (fn) => list.filter(fn).length;
  const pc = (c) => (n ? `${Math.round((c / n) * 100)} %` : "–");
  const rows = [
    { icon: NEW_BADGE, label: "Neue Freunde", c: cnt((x) => x.isNew) },
    ...FTAGS.map((t) => ({ icon: tagIcon(t), label: esc(tagLabel(t)), c: cnt((x) => x.tags && x.tags[t.k]) }))
  ];
  return `<section class="panel fsum">
      <div class="ftop">
        <div><span class="fbig">${n}</span><span class="muted">Freunde insgesamt</span></div>
        <div class="fdelta">${delta === null ? "" : `<strong>${delta > 0 ? "+" + delta : delta < 0 ? "−" + Math.abs(delta) : "±0"}</strong><span class="muted small">seit ${fdate(prev.date)}</span>`}</div>
      </div>
      <p class="small muted fstich">Stichtag ${fdate(f.stichtag)} · ${FCATS.map(([c, l]) => `${l.replace(" Freunde", "")} ${cnt((x) => x.cat === c)}`).join(" · ")}</p>
      <table class="ftable">
        <thead><tr><th></th><th></th><th>%</th><th>Anzahl</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td class="fi">${r.icon}</td><td>${r.label}</td><td class="num">${pc(r.c)}</td><td class="num">${r.c}</td></tr>`).join("")}</tbody>
      </table>
    </section>`;
}

function friendsListHtml() {
  const list = F().list;
  return FCATS.map(([c, l]) => {
    const xs = list.filter((x) => x.cat === c);
    return `<section class="panel fcat">
        <div class="panel-head"><h2>${l}</h2><span class="muted">${xs.length}</span></div>
        ${xs.length ? `<ul class="flist">${xs.map((x) => `<li><button class="frow" data-fid="${x.id}"><span class="fname">${esc(x.name)}</span><span class="ficons">${friendIcons(x)}</span></button></li>`).join("")}</ul>`
          : `<p class="muted small" style="margin:0">Noch niemand.</p>`}
      </section>`;
  }).join("");
}

function renderFriends() {
  const n = F().list.length;
  $("#view").innerHTML = `
    <div class="dayhead">
      <h1>Freunde</h1>
      <div class="headbtns">
        <button class="gear" id="fsettings" aria-label="Stichtag und Labels">${GEAR}</button>
        <button class="addbtn big" id="fadd" aria-label="Freund hinzufügen">+</button>
      </div>
    </div>
    ${n ? `${friendsSummaryHtml()}${friendChangesPanel()}${friendsListHtml()}`
    : `<div class="empty-state">
        <h2>Noch keine Freunde</h2>
        <p class="muted">Tippe oben rechts auf +, um Freunde hinzuzufügen. Du kannst auch mehrere Namen auf einmal eintragen.</p>
        <button class="btn" id="ffirst">Freunde hinzufügen</button>
      </div>`}`;

  $("#fadd").addEventListener("click", () => openFriend(null));
  $("#ffirst")?.addEventListener("click", () => openFriend(null));
  $("#fsettings").addEventListener("click", openFriendSettings);
  $("#fchmore")?.addEventListener("click", () => { showAllFriendChanges = !showAllFriendChanges; renderFriends(); });
  document.querySelectorAll("[data-fid]").forEach((b) => b.addEventListener("click", () => openFriend(b.dataset.fid)));
}

// Veränderung gegenüber dem vorigen Stichtag
let showAllFriendChanges = false;
function friendChangesPanel() {
  const f = F();
  const prev = f.history[f.history.length - 1];
  if (!prev) return `<section class="panel fchg"><h2 class="atitle">Veränderung</h2>
    <p class="muted small" style="margin:0">Erscheint, sobald du über das Zahnrad einen neuen Stichtag anlegst. Dann siehst du hier, wie sich Anzahl, Quoten und Kategorien gegenüber dem Stichtag davor verändert haben.</p></section>`;
  const now = f.list, old = prev.list;
  const sign = (d, unit = "") => (d > 0 ? `+${d}${unit}` : d < 0 ? `−${Math.abs(d)}${unit}` : `±0${unit}`);
  const cls = (d) => (d > 0 ? "up" : d < 0 ? "down" : "");
  const share = (xs, fn) => (xs.length ? (xs.filter(fn).length / xs.length) * 100 : 0);
  const catName = Object.fromEntries(FCATS.map(([c, l]) => [c, l.replace(" Freunde", "")]));
  const rank = { best: 0, good: 1, friend: 2 };

  // Anzahl gesamt und je Kategorie
  const cats = FCATS.map(([c]) => ({ c, n: now.filter((x) => x.cat === c).length, o: old.filter((x) => x.cat === c).length }));
  // Quoten in Prozentpunkten
  const quotes = FTAGS.map((t) => {
    const a = share(now, (x) => x.tags && x.tags[t.k]), b = share(old, (x) => x.tags && x.tags[t.k]);
    return { t, a, b, d: Math.round(a) - Math.round(b), cn: now.filter((x) => x.tags && x.tags[t.k]).length, co: old.filter((x) => x.tags && x.tags[t.k]).length };
  });
  // Personen: neu, weg, auf- und abgestiegen, Label-Änderungen
  const byId = (xs) => Object.fromEntries(xs.map((x) => [x.id, x]));
  const O = byId(old), N = byId(now);
  const added = now.filter((x) => !O[x.id]);
  const gone = old.filter((x) => !N[x.id]);
  const moved = now.filter((x) => O[x.id] && O[x.id].cat !== x.cat).map((x) => ({ x, from: O[x.id].cat, up: rank[x.cat] < rank[O[x.id].cat] }));
  const tagChanges = [];
  for (const x of now) {
    const o = O[x.id];
    if (!o) continue;
    for (const t of FTAGS) {
      const a = !!(x.tags && x.tags[t.k]), b = !!(o.tags && o.tags[t.k]);
      if (a !== b) tagChanges.push({ x, t, on: a });
    }
  }
  const names = (xs) => xs.map((x) => esc(x.name)).join(", ");
  const lines = [];
  if (added.length) lines.push(`<li><strong>${added.length} neu:</strong> ${names(added)}</li>`);
  if (gone.length) lines.push(`<li><strong>${gone.length} nicht mehr dabei:</strong> ${names(gone)}</li>`);
  moved.filter((m) => m.up).forEach((m) => lines.push(`<li><span class="arrow up">▲</span> <strong>${esc(m.x.name)}</strong>: ${catName[m.from]} → ${catName[m.x.cat]}</li>`));
  moved.filter((m) => !m.up).forEach((m) => lines.push(`<li><span class="arrow down">▼</span> <strong>${esc(m.x.name)}</strong>: ${catName[m.from]} → ${catName[m.x.cat]}</li>`));
  tagChanges.forEach((c) => lines.push(`<li>${tagIcon(c.t)} <strong>${esc(c.x.name)}</strong>: ${c.on ? "jetzt" : "nicht mehr"} ${esc(tagLabel(c.t))}</li>`));
  const PREV_N = 4;
  const shownLines = showAllFriendChanges ? lines : lines.slice(0, PREV_N);

  // Verlauf über alle Stichtage
  const points = [...f.history.map((h) => ({ d: h.date, n: h.list.length })), { d: f.stichtag, n: now.length }];

  return `<section class="panel fchg">
    <div class="ghead"><h2 class="atitle">Veränderung</h2><span class="small muted">seit ${fdate(prev.date)}</span></div>
    <div class="fcmp">
      <div><span class="fv ${cls(now.length - old.length)}">${sign(now.length - old.length)}</span><span class="small muted">gesamt (${old.length} → ${now.length})</span></div>
      ${cats.map((c) => `<div><span class="fv ${cls(c.n - c.o)}">${sign(c.n - c.o)}</span><span class="small muted">${catName[c.c]} (${c.o} → ${c.n})</span></div>`).join("")}
    </div>
    <table class="ftable fq">
      <thead><tr><th></th><th></th><th>vorher</th><th>jetzt</th><th>Δ</th></tr></thead>
      <tbody>${quotes.map((q) => `<tr><td class="fi">${tagIcon(q.t)}</td><td>${esc(tagLabel(q.t))}</td>
        <td class="num muted">${Math.round(q.b)} %</td><td class="num">${Math.round(q.a)} %</td>
        <td class="num ${cls(q.d)}">${q.d === 0 ? "±0" : sign(q.d)} PP</td></tr>`).join("")}</tbody>
    </table>
    ${lines.length ? `<ul class="fchlist">${shownLines.join("")}</ul>
      ${lines.length > PREV_N ? `<button class="btn ghost block" id="fchmore" style="margin-top:10px">${showAllFriendChanges ? "Weniger anzeigen" : `Alle Änderungen anzeigen (${lines.length - PREV_N} weitere)`}</button>` : ""}`
      : `<p class="muted small">Keine Personen hinzugekommen, weggefallen oder verschoben.</p>`}
    ${points.length > 2 ? `<p class="small muted fhist">Verlauf: ${points.map((p) => `${fdate(p.d).slice(0, 6)}${p.d.slice(2, 4)} <strong>${p.n}</strong>`).join(" → ")}</p>` : ""}
    <p class="small muted" style="margin:10px 0 0">PP = Prozentpunkte. Quoten beziehen sich jeweils auf alle Freunde zum Stichtag.</p>
  </section>`;
}

function friendsChanged() {
  syncFriendQuestions();
  save();
  render();
}

// Freund anlegen oder bearbeiten
function openFriend(id) {
  const f = F();
  const existing = id ? f.list.find((x) => x.id === id) : null;
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), name: "", cat: "friend", tags: {}, isNew: true };
  let bulk = false, bulkText = "";
  const dlg = $("#sheet");
  const draw = () => {
    dlg.innerHTML = `<form class="sheet-inner" novalidate>
      <div class="sheet-head">
        <button type="button" class="linkbtn" id="fcancel">Abbrechen</button>
        <h2>${existing ? "Freund bearbeiten" : "Neuer Freund"}</h2>
        <button type="submit" class="linkbtn">Sichern</button>
      </div>
      ${bulk ? `<label class="field">Namen, einer pro Zeile<textarea id="fnames" rows="6" placeholder="Bryan&#10;Sabrina&#10;Annika">${esc(bulkText)}</textarea></label>
        <p class="muted small" style="margin-top:-8px">Labels kannst du danach pro Person setzen. Oder ganze Liste einfügen: Zeilen wie „# Beste Freunde“ wählen die Kategorie, Symbole 🌱 💍 ♀ 🚬 🎓 und „NEU“ hinter dem Namen setzen die Labels.</p>`
        : `<label class="field">Name<input id="fname" value="${esc(draft.name)}" autocomplete="off" placeholder="z. B. Bryan"></label>`}
      ${!existing ? `<button type="button" class="linkbtn" id="fbulk" style="margin:-6px 0 14px">${bulk ? "Nur einen Namen eintragen" : "Mehrere auf einmal eintragen"}</button>` : ""}
      <div class="seg seg-3" role="group" aria-label="Kategorie">${FCATS.map(([c, l]) => `<button type="button" data-fcat="${c}" aria-pressed="${draft.cat === c}">${l.replace(" Freunde", "")}</button>`).join("")}</div>
      ${bulk ? "" : `<div class="field" style="font-weight:600;font-size:15px;margin-bottom:8px">Labels</div>
      <div class="chips ftags">
        ${FTAGS.map((t) => `<button type="button" class="chip" data-ftag="${t.k}" aria-pressed="${!!draft.tags[t.k]}">${tagIcon(t)} ${esc(tagLabel(t))}</button>`).join("")}
        <button type="button" class="chip" data-fnew aria-pressed="${!!draft.isNew}">${NEW_BADGE} Neuer Freund</button>
      </div>
      <p class="muted small">„Neu“ bleibt bis zum nächsten Stichtag.</p>`}
      ${existing ? `<div class="stack"><button type="button" class="btn danger" id="fdel">Aus der Liste entfernen</button></div>` : ""}
    </form>`;
    const sync = () => { const i = $("#fname", dlg); if (i) draft.name = i.value; const t = $("#fnames", dlg); if (t) bulkText = t.value; };
    $("#fcancel", dlg).addEventListener("click", () => dlg.close());
    $("#fbulk", dlg)?.addEventListener("click", () => { sync(); bulk = !bulk; draw(); });
    dlg.querySelectorAll("[data-fcat]").forEach((b) => b.addEventListener("click", () => { sync(); draft.cat = b.dataset.fcat; draw(); }));
    dlg.querySelectorAll("[data-ftag]").forEach((b) => b.addEventListener("click", () => { sync(); draft.tags[b.dataset.ftag] = !draft.tags[b.dataset.ftag]; draw(); }));
    dlg.querySelector("[data-fnew]")?.addEventListener("click", () => { sync(); draft.isNew = !draft.isNew; draw(); });
    $("#fdel", dlg)?.addEventListener("click", () => {
      if (!confirm(`${existing.name} aus der Liste entfernen? Frühere Stichtage und Antworten bleiben erhalten.`)) return;
      f.list = f.list.filter((x) => x.id !== existing.id);
      dlg.close(); friendsChanged(); toast("Entfernt");
    });
    dlg.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const taken = (name, self) => f.list.some((x) => x.id !== self && x.name.toLowerCase() === name.toLowerCase());
      if (bulk && /^\s*(#|stichtag)/im.test($("#fnames", dlg).value)) {
        // Liste mit Überschriften und Symbolen, z. B. „# Beste Freunde“ / „Sabrina 🌱 ♀ 🎓 NEU“
        const res = importFriendList($("#fnames", dlg).value);
        dlg.close(); friendsChanged(); toast(`${res.added} hinzugefügt${res.updated ? `, ${res.updated} aktualisiert` : ""}`);
        return;
      }
      if (bulk) {
        const names = Array.from(new Set($("#fnames", dlg).value.split("\n").map((s) => s.trim()).filter(Boolean)));
        const add = names.filter((nm) => !taken(nm, null));
        if (!add.length) return toast(names.length ? "Diese Namen gibt es schon" : "Bitte Namen eintragen");
        add.forEach((nm) => f.list.push({ id: uid(), name: nm, cat: draft.cat, tags: {}, isNew: true }));
        dlg.close(); friendsChanged(); toast(`${add.length} hinzugefügt${add.length < names.length ? `, ${names.length - add.length} schon vorhanden` : ""}`);
        return;
      }
      sync();
      draft.name = draft.name.trim();
      if (!draft.name) return toast("Bitte einen Namen eintragen");
      if (taken(draft.name, draft.id)) return toast("Diesen Namen gibt es schon");
      if (existing) {
        if (existing.name !== draft.name) renameFriendInAnswers(existing.name, draft.name);
        Object.assign(existing, draft);
      } else f.list.push(draft);
      dlg.close(); friendsChanged(); toast(existing ? "Gesichert" : "Hinzugefügt");
    });
  };
  draw();
  dlg.showModal();
  document.activeElement?.blur();
  if (!existing) setTimeout(() => $("#fname", dlg)?.focus(), 50);
}

// Import einer ganzen Liste: Überschriften wählen die Kategorie, Symbole setzen die Labels
function importFriendList(text) {
  const f = F();
  const SYM = { "🌱": "veg", "💍": "rel", "♀": "fem", "🚬": "smoke", "🎓": "acad" };
  let cat = "friend", added = 0, updated = 0;
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line) continue;
    const st = line.match(/^stichtag\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
    if (st) { f.stichtag = `${st[3]}-${pad(st[2])}-${pad(st[1])}`; continue; }
    if (line.startsWith("#")) {
      const h = line.toLowerCase();
      cat = h.includes("beste") ? "best" : h.includes("gute") ? "good" : "friend";
      continue;
    }
    const tags = {};
    for (const [sym, k] of Object.entries(SYM)) if (line.includes(sym)) tags[k] = true;
    const isNew = /\bNEU\b/i.test(line);
    const name = line.replace(/\bNEU\b/gi, "").replace(/[🌱💍♀🚬🎓\uFE0F\u200D]/gu, "").replace(/^[-•·*]\s*/, "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const ex = f.list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (ex) { Object.assign(ex, { cat, tags, isNew }); updated++; }
    else { f.list.push({ id: uid(), name, cat, tags, isNew }); added++; }
  }
  return { added, updated };
}

// Umbenennen: gespeicherte Antworten der verknüpften Fragen mitziehen
function renameFriendInAnswers(oldName, newName) {
  const qs = state.questions.filter((q) => q.friends);
  for (const a of Object.values(state.answers)) {
    for (const q of qs) {
      const v = a[q.id];
      if (Array.isArray(v)) a[q.id] = v.map((x) => (x === oldName ? newName : x));
      else if (v === oldName) a[q.id] = newName;
    }
  }
  for (const q of state.questions) {
    if (q.cond && qs.some((p) => p.id === q.cond.qid)) q.cond.values = q.cond.values.map((x) => (x === oldName ? newName : x));
  }
}

// Zahnrad: Stichtag, Verlauf, Namen der Labels
function openFriendSettings() {
  const f = F();
  const dlg = $("#sheet");
  const draw = () => {
    const hist = [...f.history].reverse();
    dlg.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><span></span><h2>Stichtag</h2><button type="button" class="linkbtn" id="fsdone">Fertig</button></div>
      <section class="sq">
        <div class="timerow" style="margin-top:0"><span>Aktueller Stichtag</span><input type="date" id="fst" class="timein wide" value="${f.stichtag}"></div>
        <p class="muted small" style="margin:8px 0 0">Änderungen an der Liste gelten für diesen Stichtag.</p>
      </section>
      <section class="sq">
        <strong>Neuen Stichtag anlegen</strong>
        <p class="muted small" style="margin:6px 0 10px">Die Liste zum ${fdate(f.stichtag)} wird festgehalten. Wer danach dazukommt, bekommt das Label „Neu“. Bisherige „Neu“-Labels fallen weg.</p>
        <div class="timerow" style="margin-top:0"><span>Neuer Stichtag</span><input type="date" id="fnewst" class="timein wide" value="${todayIso()}"></div>
        <button type="button" class="btn block" id="fnewbtn" style="margin-top:12px">Stichtag anlegen</button>
      </section>
      ${hist.length ? `<section class="sq">
        <strong>Frühere Stichtage</strong>
        <ul class="hlist">${hist.map((h, i) => {
          const before = hist[i + 1];
          const d = before ? h.list.length - before.list.length : null;
          const added = before ? h.list.filter((x) => !before.list.some((y) => y.id === x.id)).length : null;
          return `<li><span class="hn">${fdate(h.date)}</span><span class="hv">${h.list.length}</span>
            ${d !== null ? `<span class="hm small muted">${d > 0 ? "+" + d : d < 0 ? "−" + Math.abs(d) : "±0"} gegenüber ${fdate(before.date)}${added ? ` · ${added} neu` : ""}</span>` : ""}</li>`;
        }).join("")}</ul>
      </section>` : ""}
      <section class="sq">
        <strong>Labels umbenennen</strong>
        ${FTAGS.map((t) => `<div class="timerow"><span>${tagIcon(t)}</span><input class="flabel" data-fl="${t.k}" value="${esc(tagLabel(t))}"></div>`).join("")}
      </section>
    </div>`;
    $("#fsdone", dlg).addEventListener("click", () => dlg.close());
    $("#fst", dlg).addEventListener("change", (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { f.stichtag = e.target.value; save(); render(); } });
    $("#fnewbtn", dlg).addEventListener("click", () => {
      const nd = $("#fnewst", dlg).value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) return toast("Bitte ein Datum wählen");
      if (nd <= f.stichtag) return toast("Der neue Stichtag muss nach dem aktuellen liegen");
      if (!confirm(`Liste zum ${fdate(f.stichtag)} festhalten und neuen Stichtag ${fdate(nd)} anlegen?`)) return;
      f.history.push({ date: f.stichtag, list: JSON.parse(JSON.stringify(f.list)) });
      f.list.forEach((x) => { x.isNew = false; });
      f.stichtag = nd;
      save(); draw(); render(); toast(`Stichtag ${fdate(nd)} angelegt`);
    });
    dlg.querySelectorAll("[data-fl]").forEach((i) => i.addEventListener("change", () => {
      const v = i.value.trim();
      if (v) f.labels[i.dataset.fl] = v; else delete f.labels[i.dataset.fl];
      save(); render();
    }));
  };
  draw();
  dlg.showModal();
  document.activeElement?.blur();
}

function answerCount(qid) {
  return Object.values(state.answers).filter((a) => isAnswered(a[qid])).length;
}

function descendants(id) {
  const out = new Set();
  const walk = (x) => childrenOf(x).forEach((c) => { if (!out.has(c.id)) { out.add(c.id); walk(c.id); } });
  walk(id);
  return out;
}

function openEditor(id) {
  const existing = id ? qById(id) : null;
  const used = existing ? answerCount(existing.id) : 0;
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid(), text: "", type: "choice", options: ["Ja", "Nein"], multi: false, min: 1, max: 5, minLabel: "", maxLabel: "", unit: "", healthKey: "", archived: false, cond: null };
  if (draft.multi === undefined) draft.multi = false;
  if (!draft.friends) draft.friends = null;
  if (draft.friends) draft.options = [...(draft.extra || [])]; // bei Vorlage „Freunde“ nur Zusatzantworten bearbeiten
  if (draft.cond === undefined) draft.cond = null;

  const dlg = $("#sheet");
  const hasChildren = existing && childrenOf(existing.id).length > 0;

  const draw = () => {
    const typeLocked = used > 0;
    const curBetter = draft.better || (betterDir(draft) || "none");
    const betterSeg = (opts) => `<div class="field" style="margin:4px 0 8px;font-weight:600;font-size:15px">Was ist besser?</div>
      <div class="seg seg-3" role="group" aria-label="Richtung">${opts.map(([v, l]) => `<button type="button" data-better="${v}" aria-pressed="${curBetter === v}">${esc(l)}</button>`).join("")}</div>
      <p class="muted small" style="margin-top:-8px">Hilft bei Zielen, Trends und im Wochenbericht: Was in die gute Richtung geht, wird grün markiert.</p>`;
    // mögliche Ausgangsfragen: Auswahl oder Skala, aktiv, nicht sie selbst und keine eigene Folgefrage
    const blocked = existing ? descendants(existing.id) : new Set();
    const parents = ordered().map((o) => o.q).filter((p) => p.id !== draft.id && !p.archived && !blocked.has(p.id) && (p.type === "choice" || p.type === "scale"));
    const parent = draft.cond ? qById(draft.cond.qid) : null;
    const parentVals = parent ? (parent.type === "choice" ? parent.options : Array.from({ length: parent.max - parent.min + 1 }, (_, i) => String(parent.min + i))) : [];

    let typeFields = "";
    if (draft.type === "choice") {
      const fnames = draft.friends ? friendsOrdered(draft.friends.cats).map((x) => x.name) : [];
      typeFields = `<div class="field" style="margin-bottom:8px;font-weight:600;font-size:15px">Antwortmöglichkeiten</div>
        <label class="check" style="margin-top:0"><input type="checkbox" id="fsync" ${draft.friends ? "checked" : ""}> Vorlage „Freunde“: Namen aus deiner Freundesliste, bleibt automatisch aktuell</label>
        ${draft.friends ? `<div class="chips" style="margin:4px 0 8px">${FCATS.map(([c, l]) => `<button type="button" class="chip" data-fsc="${c}" aria-pressed="${draft.friends.cats.includes(c)}">${l}</button>`).join("")}</div>
          <p class="muted small" style="margin:0 0 12px">${fnames.length ? `${fnames.length} Namen: ${esc(fnames.slice(0, 8).join(", "))}${fnames.length > 8 ? " …" : ""}` : "Noch keine Freunde in diesen Kategorien. Leg sie im Bereich „Freunde“ an."}</p>
          <div class="field" style="margin-bottom:8px;font-weight:600;font-size:15px">Zusätzliche Antworten (optional)</div>` : ""}
        ${draft.options.map((o, i) => `<div class="opt">
          <input value="${esc(o)}" data-opt="${i}" aria-label="Antwort ${i + 1}" ${draft.friends ? 'placeholder="z. B. Familie"' : ""}>
          <button type="button" class="iconbtn" data-delopt="${i}" aria-label="Antwort entfernen" ${!draft.friends && draft.options.length <= 2 ? "disabled" : ""}>✕</button>
        </div>`).join("")}
        <button type="button" class="linkbtn" id="addopt">Antwort hinzufügen</button>
        <label class="check"><input type="checkbox" id="multi" ${draft.multi ? "checked" : ""} ${typeLocked ? "disabled" : ""}> Mehrere Antworten gleichzeitig erlauben</label>
        ${used ? `<p class="muted small">Umbenennen ändert nur künftige Antworten. Bereits gespeicherte behalten den alten Text.</p>` : ""}`;
    } else if (draft.type === "scale") {
      typeFields = `<div class="row2">
          <label class="field">Von<input type="number" inputmode="numeric" id="smin" value="${draft.min}"></label>
          <label class="field">Bis<input type="number" inputmode="numeric" id="smax" value="${draft.max}"></label>
        </div>
        <div class="row2">
          <label class="field">Text links <input id="sminl" value="${esc(draft.minLabel)}" placeholder="z. B. schlecht"></label>
          <label class="field">Text rechts <input id="smaxl" value="${esc(draft.maxLabel)}" placeholder="z. B. super"></label>
        </div>
        ${betterSeg([["high", `${draft.max} ist gut`], ["low", `${draft.min} ist gut`], ["none", "Neutral"]])}`;
    } else {
      const UNITS = ["Stunden", "Minuten", "km", "kg", "€", "Liter", "Gläser", "Seiten", "Mal"];
      typeFields = `<div class="field" style="margin-bottom:8px;font-weight:600;font-size:15px">Einheit</div>
        <div class="chips unitchips">
          <button type="button" class="chip" data-fmt="duration" aria-pressed="${draft.format === "duration"}">Dauer h:mm</button>
          <button type="button" class="chip" data-fmt="clock" aria-pressed="${draft.format === "clock"}">Uhrzeit</button>
          ${UNITS.map((u) => `<button type="button" class="chip" data-unit="${esc(u)}" aria-pressed="${!draft.format && draft.unit === u}">${esc(u)}</button>`).join("")}
        </div>
        <label class="field" style="margin-top:10px">Eigene Einheit (optional)<input id="unit" value="${esc(draft.format ? "" : draft.unit)}" placeholder="${draft.format ? (draft.format === "clock" ? "Eingabe als 23:30" : "Eingabe als 7:30") : "z. B. Tassen"}" autocomplete="off"></label>
        ${draft.format ? `<p class="muted small" style="margin-top:-10px">${draft.format === "clock" ? "Eingabe als Uhrzeit, z. B. 23:30 oder 0:45. Zeiten nach Mitternacht zählen als später." : "Eingabe als Stunden:Minuten, z. B. 7:30. Excel zeigt sie als Dauer."}</p>` : ""}
        ${betterSeg(draft.format === "clock" ? [["low", "Früher ist gut"], ["high", "Später ist gut"], ["none", "Neutral"]] : [["high", "Mehr ist gut"], ["low", "Weniger ist gut"], ["none", "Neutral"]])}`;
    }

    const condBlock = `<details class="adv" ${draft.cond ? "open" : ""}>
        <summary>Nur fragen, wenn … (Folgefrage)</summary>
        ${parents.length ? `<label class="field" style="margin-top:8px">Ausgangsfrage
          <select id="cparent">
            <option value="">– immer fragen –</option>
            ${parents.map((p) => `<option value="${p.id}" ${draft.cond?.qid === p.id ? "selected" : ""}>${esc(p.text)}</option>`).join("")}
          </select>
        </label>
        ${parent ? `<div class="field" style="font-weight:600;font-size:15px;margin-bottom:6px">… mit einer dieser Antworten beantwortet wurde</div>
          <div class="chips" style="margin-bottom:12px">${parentVals.map((v) => `<button type="button" class="chip" data-cval="${esc(v)}" aria-pressed="${draft.cond.values.includes(v)}">${esc(v)}</button>`).join("")}</div>` : ""}`
        : `<p class="muted small" style="margin-top:8px">Leg zuerst eine Auswahl- oder Skala-Frage an, z. B. „Heute bouldern?“. Danach kannst du hier einstellen, dass diese Frage nur bei „Ja“ kommt.</p>`}
      </details>`;

    dlg.innerHTML = `<form class="sheet-inner" method="dialog" novalidate>
      <div class="sheet-head">
        <button type="button" class="linkbtn" id="cancel">Abbrechen</button>
        <h2>${existing ? "Frage bearbeiten" : "Neue Frage"}</h2>
        <button type="submit" class="linkbtn" id="savebtn">Sichern</button>
      </div>
      <label class="field">Frage<input id="qtext" value="${esc(draft.text)}" placeholder="z. B. Heute bouldern?" autocomplete="off"></label>
      <div class="seg" role="group" aria-label="Antworttyp">
        ${["choice", "scale", "number"].map((t) => `<button type="button" data-type="${t}" aria-pressed="${draft.type === t}" ${(typeLocked && draft.type !== t) || (hasChildren && t === "number") ? "disabled" : ""}>${typeLabel[t]}</button>`).join("")}
      </div>
      ${typeLocked ? `<p class="muted small" style="margin-top:-8px">Der Antworttyp ist fest, weil es schon ${used} Antworten gibt.</p>` : ""}
      ${typeFields}
      ${condBlock}
      ${existing && existing.healthKey ? `<details class="adv">
        <summary>Apple Health</summary>
        <label class="field" style="margin-top:8px">Health-Kürzel
          <input id="hkey" value="${esc(draft.healthKey)}" placeholder="z. B. schlaf" autocapitalize="off" autocomplete="off">
        </label>
        <p class="muted small">Schickt der Kurzbefehl einen Wert mit diesem Kürzel, wird er hier eingetragen. Anleitung unter Einstellungen → Schnittstelle Apple Health.</p>
        ${draft.type === "number" ? `<label class="check" style="margin-top:4px"><input type="checkbox" id="hsrc" ${draft.source === "health" ? "checked" : ""}> Nur aus Apple Health füllen (unter „Tag“ als Health-Feld, wird nicht abgefragt)</label>` : ""}
      </details>` : ""}
      ${existing ? `<div class="stack">
        <button type="button" class="btn ghost" id="archive">${existing.archived ? "Wieder einblenden" : "Ausblenden (Daten bleiben)"}</button>
        <button type="button" class="btn danger" id="delete">Frage und ${used} Antworten löschen</button>
      </div>` : ""}
    </form>`;

    // Eingaben im Entwurf mitschreiben, damit Neuzeichnen nichts verliert
    const sync = () => {
      draft.text = $("#qtext", dlg).value;
      dlg.querySelectorAll("[data-opt]").forEach((inp) => (draft.options[+inp.dataset.opt] = inp.value));
      if ($("#multi", dlg)) draft.multi = $("#multi", dlg).checked;
      if ($("#smin", dlg)) { draft.min = parseInt($("#smin", dlg).value, 10); draft.max = parseInt($("#smax", dlg).value, 10); draft.minLabel = $("#sminl", dlg).value; draft.maxLabel = $("#smaxl", dlg).value; }
      if ($("#unit", dlg)) {
        const u = $("#unit", dlg).value.trim();
        if (u) { draft.unit = u; draft.format = null; } else if (!draft.format && !$(".unitchips [aria-pressed=true]", dlg)) draft.unit = "";
      }
      if ($("#hkey", dlg)) draft.healthKey = $("#hkey", dlg).value.trim().toLowerCase().replace(/[^a-z0-9_äöüß-]/g, "");
      if ($("#hsrc", dlg)) draft.source = $("#hsrc", dlg).checked ? "health" : null;
      if (draft.type !== "number" || !draft.healthKey) draft.source = null;
    };

    dlg.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => { sync(); draft.type = b.dataset.type; draw(); }));
    dlg.querySelectorAll("[data-fmt]").forEach((b) => b.addEventListener("click", () => { sync(); draft.format = draft.format === b.dataset.fmt ? null : b.dataset.fmt; draft.unit = ""; if (!draft.better || draft.better === "none") draft.better = draft.format === "clock" ? "none" : draft.better; draw(); }));
    dlg.querySelectorAll("[data-unit]").forEach((b) => b.addEventListener("click", () => { sync(); const u = b.dataset.unit; draft.unit = draft.unit === u && !draft.format ? "" : u; draft.format = null; draw(); }));
    dlg.querySelectorAll("[data-better]").forEach((b) => b.addEventListener("click", () => { sync(); draft.better = b.dataset.better; draw(); }));
    $("#fsync", dlg)?.addEventListener("change", (e) => {
      sync();
      const all = F().list.map((x) => x.name);
      if (e.target.checked) {
        draft.friends = { cats: FCATS.map(([c]) => c) };
        draft.options = draft.options.map((o) => o.trim()).filter((o) => o && !all.includes(o) && o !== "Ja" && o !== "Nein");
        if (draft.multi === false && !used) draft.multi = true; // „Mit wem?“ meist mehrere
      } else {
        draft.options = Array.from(new Set([...friendsOrdered(draft.friends.cats).map((x) => x.name), ...draft.options.filter((o) => o.trim())]));
        while (draft.options.length < 2) draft.options.push("");
        draft.friends = null;
      }
      draw();
    });
    dlg.querySelectorAll("[data-fsc]").forEach((b) => b.addEventListener("click", () => {
      sync();
      const c = b.dataset.fsc, cats = draft.friends.cats, i = cats.indexOf(c);
      if (i >= 0) { if (cats.length > 1) cats.splice(i, 1); } else cats.push(c);
      draft.friends.cats = FCATS.map(([k]) => k).filter((k) => cats.includes(k));
      draw();
    }));
    $("#addopt", dlg)?.addEventListener("click", () => { sync(); draft.options.push(""); draw(); dlg.querySelector(`[data-opt="${draft.options.length - 1}"]`).focus(); });
    dlg.querySelectorAll("[data-delopt]").forEach((b) => b.addEventListener("click", () => { sync(); draft.options.splice(+b.dataset.delopt, 1); draw(); }));
    $("#cparent", dlg)?.addEventListener("change", (e) => {
      sync();
      draft.cond = e.target.value ? { qid: e.target.value, values: [] } : null;
      // Bei Ja/Nein-Fragen gleich „Ja“ vorauswählen
      const p = draft.cond && qById(draft.cond.qid);
      if (p && p.type === "choice" && p.options.includes("Ja")) draft.cond.values = ["Ja"];
      draw();
    });
    dlg.querySelectorAll("[data-cval]").forEach((b) => b.addEventListener("click", () => {
      sync();
      const v = b.dataset.cval, arr = draft.cond.values, i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
      draw();
    }));
    $("#cancel", dlg).addEventListener("click", () => dlg.close());

    $("#archive", dlg)?.addEventListener("click", () => {
      existing.archived = !existing.archived; save(); dlg.close(); render();
      toast(existing.archived ? (hasChildren ? "Ausgeblendet – Folgefragen kommen nicht mehr" : "Ausgeblendet") : "Wieder eingeblendet");
    });
    $("#delete", dlg)?.addEventListener("click", () => {
      if (!confirm(`„${existing.text}“ und alle ${used} Antworten endgültig löschen? Das lässt sich nicht rückgängig machen. Zum Behalten der Daten stattdessen „Ausblenden“ wählen.${hasChildren ? " Ihre Folgefragen werden danach immer gestellt." : ""}`)) return;
      state.questions = state.questions.filter((q) => q.id !== existing.id);
      state.questions.forEach((q) => { if (q.cond && q.cond.qid === existing.id) q.cond = null; });
      if (state.goals && Array.isArray(state.goals.items)) state.goals.items = state.goals.items.filter((g) => g.qid !== existing.id);
      for (const d of Object.keys(state.answers)) { delete state.answers[d][existing.id]; if (!Object.keys(state.answers[d]).length) delete state.answers[d]; }
      save(); dlg.close(); render(); toast("Gelöscht");
    });

    dlg.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      sync();
      draft.text = draft.text.trim();
      if (!draft.text) return toast("Bitte eine Frage eingeben");
      if (draft.type === "choice" && draft.friends) {
        draft.extra = Array.from(new Set(draft.options.map((o) => o.trim()).filter(Boolean)));
        draft.options = Array.from(new Set([...friendsOrdered(draft.friends.cats).map((x) => x.name), ...draft.extra]));
        if (draft.options.length < 2) { draft.options = [...draft.extra]; return toast("Mindestens zwei Antworten nötig – leg zuerst Freunde an"); }
      } else if (draft.type === "choice") {
        draft.friends = null; delete draft.extra;
        draft.options = draft.options.map((o) => o.trim()).filter(Boolean);
        if (draft.options.length < 2) return toast("Mindestens zwei Antworten nötig");
        if (new Set(draft.options).size !== draft.options.length) return toast("Antworten müssen unterschiedlich sein");
      } else { draft.multi = false; draft.friends = null; }
      if (draft.type !== "number") draft.format = null;
      if (draft.type === "choice") delete draft.better;
      if (draft.type === "scale") {
        if (!Number.isInteger(draft.min) || !Number.isInteger(draft.max) || draft.max <= draft.min) return toast("Skala: „Bis“ muss größer als „Von“ sein");
        if (draft.max - draft.min > 10) return toast("Skala: höchstens 11 Stufen");
      }
      if (draft.cond && !draft.cond.values.length) return toast("Wähle mindestens eine Antwort, bei der die Folgefrage kommt");
      if (draft.healthKey && state.questions.some((q) => q.id !== draft.id && q.healthKey === draft.healthKey)) return toast("Dieses Health-Kürzel ist schon vergeben");
      if (existing) Object.assign(existing, draft);
      else state.questions.push(draft);
      save(); dlg.close(); render();
      toast(existing ? "Gesichert" : "Frage angelegt");
    });
  };

  draw();
  dlg.showModal();
  document.activeElement?.blur();
  if (!existing) setTimeout(() => $("#qtext", dlg).focus(), 50);
}

/* ================= Export, Backup, Health ================= */
/* ================= Mosaik-Dienst: Erinnerung und Eingang ================= */
const SERVER = "https://mosaik-sync.sebastian-taglieber.workers.dev";
const SETTINGS_KEY = "mosaik.settings";
let settings = { token: "", push: { on: false, time: "23:00", endpoint: null }, weekly: { on: false, day: 0, time: "19:00" }, places: { on: false, last: 0 }, lastInbox: null };
try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); settings = { ...settings, ...s, push: { ...settings.push, ...(s.push || {}) }, weekly: { ...settings.weekly, ...(s.weekly || {}) }, places: { ...settings.places, ...(s.places || {}) } }; } catch (e) { /* egal */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* egal */ } };

async function api(path, body) {
  let res;
  try {
    res = await fetch(SERVER + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${settings.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { throw new Error("Dienst nicht erreichbar. Bist du online?"); }
  let data = {};
  try { data = await res.json(); } catch (e) { /* keine JSON-Antwort */ }
  if (res.status === 401) throw new Error("Der Schlüssel stimmt nicht.");
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

const b64ToBytes = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };

// Push-Abo dieses Geräts holen oder anlegen (gemeinsam für Erinnerung und Wochenbericht)
async function pushSub() {
  // Erlaubnis zuerst anfragen: iOS verlangt das direkt nach dem Tippen
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Mitteilungen sind nicht erlaubt. iPhone-Einstellungen → Mitteilungen → Mosaik → Mitteilungen erlauben.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api("/vapid");
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  }
  return sub;
}

async function enablePush(time) {
  const sub = await pushSub();
  await api("/subscribe", { subscription: sub.toJSON(), time, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin" });
  settings.push = { on: true, time, endpoint: sub.endpoint };
  saveSettings();
  reportStatus();
}

async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const endpoint = (sub && sub.endpoint) || settings.push.endpoint;
  if (endpoint) await api("/unsubscribe", { endpoint }).catch(() => {});
  if (sub && !settings.weekly.on) await sub.unsubscribe().catch(() => {}); // Abo bleibt für den Wochenbericht
  settings.push = { ...settings.push, on: false, endpoint: settings.weekly.on ? settings.push.endpoint : null };
  saveSettings();
}

async function enableWeekly(day, time) {
  const sub = await pushSub();
  await api("/weekly", { on: true, subscription: sub.toJSON(), day, time, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin" });
  settings.weekly = { on: true, day, time, endpoint: sub.endpoint };
  saveSettings();
  reportStatus();
}

async function disableWeekly() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const endpoint = (sub && sub.endpoint) || settings.weekly.endpoint;
  if (endpoint) await api("/weekly", { on: false, subscription: { endpoint } }).catch(() => {});
  settings.weekly = { ...settings.weekly, on: false };
  if (sub && !settings.push.on) await sub.unsubscribe().catch(() => {});
  saveSettings();
}

// Dem Dienst mitteilen, wie viele Fragen heute noch offen sind (keine Antworten!)
let statusTimer;
function reportStatus() {
  if (!settings.token) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    // Kurztext für die Wochenbericht-Mitteilung
    if (settings.weekly.on && settings.weekly.endpoint) api("/weekly/teaser", { endpoint: settings.weekly.endpoint, week: mondayOf(todayIso()), text: reportTeaser() }).catch(() => {});
    if (!settings.push.on || !settings.push.endpoint) return;
    const t = todayIso();
    const a = state.answers[t] || {};
    const open = askQuestions(t).filter((q) => !isAnswered(a[q.id])).length;
    api("/status", { endpoint: settings.push.endpoint, date: t, open }).catch(() => {});
  }, 1500);
}

// Bekannte Kürzel bekommen einen schönen Namen
const HEALTH_NAMES = {
  schlaf: ["Schlafdauer", "", "duration"], schlafenszeit: ["Schlafenszeit", "", "clock"], schritte: ["Schritte", ""], ruhepuls: ["Ruhepuls", "bpm"], puls: ["Puls", "bpm"],
  hrv: ["Herzfrequenzvariabilität", "ms"], kalorien: ["Aktivkalorien", "kcal"], aktivkalorien: ["Aktivkalorien", "kcal"],
  training: ["Trainingsminuten", "min"], stehen: ["Stehstunden", "h"], distanz: ["Distanz", "km"], gewicht: ["Gewicht", "kg"],
  achtsamkeit: ["Achtsamkeitsminuten", "min"], stockwerke: ["Stockwerke", ""]
};
// Für ein Kürzel aus dem Kurzbefehl das passende Health-Feld finden oder anlegen
function ensureHealthQuestion(key, created) {
  let q = state.questions.find((x) => x.healthKey === key);
  if (q) {
    if (q.type === "number" && !q.source) { q.source = "health"; save(); }
    return q;
  }
  const [text, unit, format] = HEALTH_NAMES[key] || [key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " "), ""];
  q = { id: uid(), text, format: format || null, type: "number", options: [], multi: false, min: 1, max: 5, minLabel: "", maxLabel: "", unit, healthKey: key, source: "health", archived: false, cond: null };
  state.questions.push(q);
  created.push(q);
  return q;
}

// Werte abholen, die Kurzbefehle im Hintergrund geschickt haben
let inboxBusy = false, inboxLast = 0;
async function fetchInbox(manual) {
  if (!settings.token || inboxBusy) return;
  if (!manual && Date.now() - inboxLast < 30000) return;
  inboxBusy = true; inboxLast = Date.now();
  try {
    const { items } = await api("/inbox");
    const done = [], unknown = new Set();
    let setCount = 0;
    const created = [];
    for (const it of items) {
      const q = ensureHealthQuestion(it.key, created);
      const r = applyPairs({ [it.key]: it.value }, it.date);
      if (r.set.length) setCount += r.set.length; else r.unknown.forEach((k) => unknown.add(k));
      done.push(it.id); // alles quittieren, auch ungültige Werte (sonst bleiben sie ewig liegen)
      if (q && !r.set.length && created.includes(q)) { /* leeres neues Feld behalten */ }
    }
    if (created.length) save();
    for (let i = 0; i < done.length; i += 500) await api("/inbox/ack", { ids: done.slice(i, i + 500) });
    if (items.length) { settings.shortcutDone = true; }
    settings.lastInbox = new Date().toISOString(); saveSettings();
    if (setCount) { toast(`${setCount} Wert${setCount > 1 ? "e" : ""} aus Kurzbefehlen übernommen`); render(); }
    else if (manual) toast(unknown.size ? `Kein passendes Health-Kürzel: ${[...unknown].join(", ")}` : "Keine neuen Werte");
    else if (tab === "data") renderData();
  } catch (e) {
    if (manual) toast(e.message);
  } finally { inboxBusy = false; }
}

function renderData() {
  const view = $("#view");
  const days = Object.keys(state.answers).sort();
  const nAnswers = days.reduce((s, d) => s + Object.keys(state.answers[d]).length, 0);
  const last = state.lastBackup ? longDate(state.lastBackup.slice(0, 10)) + " " + state.lastBackup.slice(0, 4) : "noch nie";
  const backupOld = !state.lastBackup || (Date.now() - new Date(state.lastBackup).getTime()) > 30 * 864e5;
  const base = location.href.split("#")[0].split("?")[0];
  const connected = !!settings.token;
  const p = settings.push;
  const pushSupport = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const hq = healthQuestions();
  const lastIn = settings.lastInbox ? new Date(settings.lastInbox).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "noch nie";

  let pushBody;
  if (!connected) pushBody = `<p class="muted small">Trag zuerst unten unter „Verbindung“ deinen Schlüssel ein.</p>`;
  else if (!pushSupport || !standalone) pushBody = `<p class="muted small">Mitteilungen gehen nur in der App vom Home-Bildschirm (ab iOS 16.4). Öffne Mosaik über das Icon und komm hierher zurück.</p>`;
  else pushBody = `
      <label class="switch row" style="margin-top:0"><input type="checkbox" id="pushon" ${p.on ? "checked" : ""}><span>Tägliche Erinnerung</span></label>
      <div class="timerow"><span>Uhrzeit</span><input type="time" id="pushtime" value="${esc(p.time)}" class="timein"></div>
      <p class="muted small" style="margin:8px 0 0">Kommt nur, wenn an dem Tag noch Fragen offen sind. Tippen auf die Mitteilung startet direkt die Abfrage für diesen Tag.</p>
      ${p.on ? `<button class="btn ghost block" id="pushtest" style="margin-top:12px">Test-Erinnerung senden</button>` : ""}
      <p class="small" id="pushmsg" style="margin:8px 0 0"></p>`;

  const w = settings.weekly;
  const WDN = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  let weeklyBody = "";
  if (connected && pushSupport && standalone) weeklyBody = `
      <label class="switch row"><input type="checkbox" id="weekon" ${w.on ? "checked" : ""}><span>Jede Woche als Mitteilung</span></label>
      <div class="timerow"><span>Tag</span><select id="weekday" class="timein">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<option value="${i}" ${w.day === i ? "selected" : ""}>${WDN[i]}</option>`).join("")}</select></div>
      <div class="timerow"><span>Uhrzeit</span><input type="time" id="weektime" value="${esc(w.time)}" class="timein"></div>
      <p class="muted small" style="margin:8px 0 0">Tippen auf die Mitteilung öffnet den Bericht in der App.</p>
      ${w.on ? `<button class="btn ghost block" id="weektest" style="margin-top:12px">Test-Mitteilung senden</button>` : ""}
      <p class="small" id="weekmsg" style="margin:8px 0 0"></p>`;
  else if (!connected) weeklyBody = `<p class="muted small" style="margin-top:10px">Für die wöchentliche Mitteilung zuerst unten unter „Verbindung“ den Schlüssel eintragen.</p>`;

  view.innerHTML = `
    <div class="dayhead"><h1>Einstellungen</h1></div>

    ${questionsPanel()}

    <section class="panel">
      <h2>Wochenbericht</h2>
      <p class="muted small">Fasst deine Woche zusammen: erfasste Tage, Ziele, Trends und deine Fragen im Vergleich zu sonst.</p>
      <button class="btn block hold-btn" id="reportopen">Wochenbericht anzeigen</button>
      ${weeklyBody}
    </section>

    <section class="panel">
      <h2>Grafik erstellen</h2>
      <p class="muted small">Speichert Übersichten als PNG, z. B. für Präsentationen: Freunde und Quoten, Veränderung, Trends, Ziele, einzelne Fragen und den Wochenbericht. Mehrere auf einmal möglich.</p>
      <button class="btn block" id="exportopen">Grafiken auswählen</button>
    </section>

    <section class="panel">
      <h2>Erinnerung</h2>
      ${pushBody}
    </section>

    <section class="panel">
      <h2>Orte</h2>
      <label class="switch row" style="margin-top:0"><input type="checkbox" id="placeson" ${settings.places.on ? "checked" : ""}><span>Stadt beim Öffnen erfassen</span></label>
      <p class="muted small" style="margin:8px 0 0">Mosaik merkt sich beim Öffnen die Stadt, höchstens alle 20 Minuten, z. B. „Wedel → Hamburg → Wedel“. Gespeichert wird nur der Ortsname, auf dem iPhone. Für den Namen werden die auf ca. 1 km gerundeten Koordinaten an BigDataCloud geschickt. Orte lassen sich unter „Tag“ antippen und von Hand ergänzen.</p>
    </section>

    <section class="panel">
      <h2>Excel-Tabelle</h2>
      <p class="muted">Enthält immer alle bisher erfassten Tage, eine Spalte pro Frage. In der App wird dabei nichts gelöscht.</p>
      <p class="stat">${days.length} Tage · ${nAnswers} Antworten${days.length ? ` · seit ${longDate(days[0])} ${days[0].slice(0, 4)}` : ""}</p>
      <button class="btn block hold-btn" id="xlsx" ${days.length ? "" : "disabled"}>Excel erstellen</button>
    </section>

    <section class="panel">
      <h2>Sicherung</h2>
      <p class="muted">Die Daten liegen nur auf diesem iPhone. Löschst du die App vom Home-Bildschirm, sind sie weg. Sichere deshalb regelmäßig, am besten in iCloud Drive.</p>
      <p class="small ${backupOld ? "" : "muted"}">Letzte Sicherung: ${last}</p>
      <div class="stack">
        <button class="btn" id="backup">Sicherung erstellen</button>
        <button class="btn ghost" id="restore">Sicherung wiederherstellen</button>
        <input type="file" id="restorefile" accept="application/json,.json" hidden>
      </div>
    </section>

    <section class="panel">
      <h2>Schnittstelle Apple Health</h2>
      ${connected ? `
      <p class="small hstatus ${settings.shortcutDone || hq.length ? "ok" : ""}">${hq.length
        ? `<strong>Eingerichtet.</strong> Empfängt: ${hq.map((q) => esc(q.text)).join(", ")}. Zuletzt abgeholt: ${lastIn}`
        : settings.shortcutDone ? "<strong>Kurzbefehl angelegt.</strong> Noch keine Werte empfangen." : "Noch nicht eingerichtet."}</p>
      <p class="muted small">Ein Kurzbefehl schickt Werte aus Health an Mosaik, z. B. Schlaf und Schritte. Für jeden neuen Wert legt Mosaik automatisch ein Feld an, das unter „Tag“ erscheint und nicht abgefragt wird.</p>
      <div class="stack">
        <button class="btn ghost" id="copyhdr">Header kopieren</button>
        <button class="btn ghost" id="inboxnow">Jetzt abholen</button>
      </div>
      <label class="switch row"><input type="checkbox" id="scdone" ${settings.shortcutDone ? "checked" : ""}><span>Ich habe den Kurzbefehl angelegt</span></label>
      <details ${settings.shortcutDone ? "" : "open"}>
        <summary><strong>Anleitung: Kurzbefehl anlegen</strong></summary>
        <p class="small" style="margin:8px 0 4px">Der Kurzbefehl schickt die letzten 7 Tage auf einmal. Mosaik ordnet jeden Wert seinem Tag zu: Schritte von 0–24 Uhr, Schlaf beim Tag des Aufwachens. Ältere Werte werden dabei aktualisiert.</p>
        <p class="small" style="margin:10px 0 4px"><strong>1. Schritte</strong></p>
        <ol class="steps small">
          <li><strong>Health-Messungen suchen</strong>: Typ <em>Schritte</em>, Startdatum <em>in den letzten 7 Tagen</em>, Gruppieren nach <em>Tag</em>.</li>
        </ol>
        <p class="small" style="margin:10px 0 4px"><strong>2. Schlaf</strong></p>
        <ol class="steps small">
          <li><strong>Health-Messungen suchen</strong> (nicht „filtern“): Typ <em>Schlaf</em>, Startdatum <em>in den letzten 7 Tagen</em>, <em>Wert ist nicht Im Bett</em>, <em>Wert ist nicht Wach</em>.</li>
        </ol>
        <p class="small" style="margin:10px 0 4px"><strong>3. Senden</strong></p>
        <ol class="steps small">
          <li><strong>Inhalte von URL abrufen</strong>: <code>${SERVER}/in</code>, Methode <em>POST</em>, Header <code>Authorization</code> = Wert aus „Header kopieren“, Haupttext <em>JSON</em>.</li>
          <li>Felder vom Typ <strong>Array</strong> (jeweils Variable einsetzen, antippen und die Eigenschaft wählen):
            <br><code>schritte</code> → Schritte-Messungen → <em>Wert</em>
            <br><code>schritte_datum</code> → Schritte-Messungen → <em>Startdatum</em>
            <br><code>schlaf_start</code> → Schlaf-Messungen → <em>Startdatum</em>
            <br><code>schlaf_ende</code> → Schlaf-Messungen → <em>Enddatum</em></li>
          <li>Bei den Datumsfeldern das Datumsformat auf <em>ISO 8601</em> stellen (Variable antippen → Datumsformat), dann ist die Zuordnung eindeutig.</li>
          <li>Kurzbefehle → <strong>Automation</strong> → <em>Tageszeit</em> (z. B. 10:00, täglich) → <em>Sofort ausführen</em>. Morgens ist das iPhone meist entsperrt, dann darf der Kurzbefehl Health lesen.</li>
        </ol>
        <p class="small muted">Einzelwerte gehen weiterhin, z. B. Zahl-Feld <code>ruhepuls</code> (heute) oder <code>kalorien_gestern</code> (Vortag). Werte liegen beim Dienst nur, bis Mosaik sie abholt.</p>
      </details>`
      : `<p class="muted small">Trag zuerst unten unter „Verbindung“ deinen Schlüssel ein.</p>`}
    </section>

    <section class="panel">
      <h2>Verbindung</h2>
      <p class="muted small">Der Mosaik-Dienst verschickt die Erinnerung und nimmt Werte von Kurzbefehlen an. Deine Antworten bleiben auf dem iPhone.</p>
      ${connected
        ? `<p class="small" id="connmsg"><strong>Schlüssel gespeichert.</strong> <span class="muted">Dienst: ${SERVER.replace("https://", "")}</span></p>
           <div class="stack"><button class="btn ghost" id="conntest">Verbindung prüfen</button><button class="btn ghost" id="connreset">Schlüssel entfernen</button></div>`
        : `<label class="field">Schlüssel<input id="tokenin" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Schlüssel einfügen"></label>
           <button class="btn block" id="connsave">Sichern und prüfen</button>
           <p class="small" id="connmsg" style="margin:8px 0 0"></p>`}
    </section>

    <p class="muted small">Adresse dieser App: <code>${esc(base)}</code></p>`;

  wireQuestions($("#qpanel"));
  $("#xlsx").addEventListener("click", exportExcel);
  $("#backup").addEventListener("click", exportBackup);
  $("#restore").addEventListener("click", () => $("#restorefile").click());
  $("#restorefile").addEventListener("change", importBackup);
  $("#scdone")?.addEventListener("change", (e) => { settings.shortcutDone = e.target.checked; saveSettings(); renderData(); });

  const msg = (id, t, bad) => { const el = $("#" + id); if (el) { el.textContent = t; el.style.color = bad ? "var(--danger)" : ""; } };

  $("#connsave")?.addEventListener("click", async () => {
    const t = $("#tokenin").value.trim();
    if (!t) return msg("connmsg", "Bitte den Schlüssel einfügen.", true);
    settings.token = t;
    try { await api("/ping"); saveSettings(); toast("Verbunden"); renderData(); }
    catch (e) { settings.token = ""; msg("connmsg", e.message, true); }
  });
  $("#conntest")?.addEventListener("click", async () => {
    try { await api("/ping"); msg("connmsg", "Verbindung klappt."); } catch (e) { msg("connmsg", e.message, true); }
  });
  $("#connreset")?.addEventListener("click", async () => {
    if (!confirm("Schlüssel entfernen? Die Erinnerung wird dann abgeschaltet.")) return;
    try { await disablePush(); } catch (e) { /* egal */ }
    settings.token = ""; saveSettings(); renderData();
  });

  $("#pushon")?.addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      if (on) { await enablePush($("#pushtime").value || "23:00"); toast(`Erinnerung täglich um ${settings.push.time} Uhr`); }
      else { await disablePush(); toast("Erinnerung aus"); }
      renderData();
    } catch (err) { e.target.checked = !on; msg("pushmsg", err.message, true); }
  });
  $("#pushtime")?.addEventListener("change", async (e) => {
    const t = e.target.value;
    if (!/^\d{2}:\d{2}$/.test(t)) return;
    settings.push.time = t; saveSettings();
    if (!settings.push.on) return;
    try { await enablePush(t); toast(`Erinnerung täglich um ${t} Uhr`); } catch (err) { msg("pushmsg", err.message, true); }
  });
  $("#pushtest")?.addEventListener("click", async () => {
    try { await api("/test", { endpoint: settings.push.endpoint }); msg("pushmsg", "Test verschickt. Die Mitteilung kommt in wenigen Sekunden."); }
    catch (e) { msg("pushmsg", e.message, true); }
  });
  $("#copyhdr")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(`Bearer ${settings.token}`); toast("Header-Wert kopiert"); }
    catch (e) { toast("Kopieren nicht möglich"); }
  });
  $("#inboxnow")?.addEventListener("click", () => fetchInbox(true));

  $("#reportopen").addEventListener("click", () => openReport());
  $("#placeson").addEventListener("change", async (e) => {
    settings.places.on = e.target.checked; settings.places.last = 0; saveSettings();
    if (e.target.checked) await capturePlace(true); else toast("Orte werden nicht mehr erfasst");
  });
  $("#exportopen").addEventListener("click", openExport);
  const weekSave = async () => {
    const day = Number($("#weekday").value), time = $("#weektime").value || "19:00";
    settings.weekly.day = day; settings.weekly.time = time; saveSettings();
    if (!settings.weekly.on) return;
    try { await enableWeekly(day, time); toast(`Wochenbericht jeden ${WDN[day]} um ${time} Uhr`); } catch (err) { msg("weekmsg", err.message, true); }
  };
  $("#weekon")?.addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      if (on) { await enableWeekly(Number($("#weekday").value), $("#weektime").value || "19:00"); toast(`Wochenbericht jeden ${WDN[settings.weekly.day]} um ${settings.weekly.time} Uhr`); }
      else { await disableWeekly(); toast("Wochenbericht-Mitteilung aus"); }
      renderData();
    } catch (err) { e.target.checked = !on; msg("weekmsg", err.message, true); }
  });
  $("#weekday")?.addEventListener("change", weekSave);
  $("#weektime")?.addEventListener("change", (e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) weekSave(); });
  $("#weektest")?.addEventListener("click", async () => {
    try { reportStatus(); await new Promise((r) => setTimeout(r, 1800)); await api("/weekly/test", { endpoint: settings.weekly.endpoint }); msg("weekmsg", "Test verschickt. Die Mitteilung kommt in wenigen Sekunden."); }
    catch (err) { msg("weekmsg", err.message, true); }
  });
}

async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (e) { if (e.name === "AbortError") return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

function buildWorkbook() {
  const qs = ordered().map((o) => o.q); // alle, auch ausgeblendete; Folgefragen hinter ihrer Ausgangsfrage
  const days = Array.from(new Set([...Object.keys(state.answers), ...Object.keys(state.places || {})])).sort();
  const header = ["Datum", "Wochentag", ...qs.map((q) => q.text + (q.type === "number" && q.unit ? ` (${q.unit})` : "")), "Orte"];
  const rows = [header];
  // Jeder Kalendertag vom ersten bis zum letzten Eintrag – unbeantwortete Tage bleiben leer
  if (days.length) {
    for (let d = days[0]; d <= days[days.length - 1]; d = addDays(d, 1)) {
      const a = state.answers[d] || {};
      const dt = parseIso(d);
      rows.push([
        (Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) - Date.UTC(1899, 11, 30)) / 864e5, // Excel-Datumszahl
        WD[dt.getDay()],
        ...qs.map((q) => (isAnswered(a[q.id]) ? (Array.isArray(a[q.id]) ? a[q.id].join(", ") : a[q.id]) : null)),
        placesOn(d).length ? placesOn(d).join(" → ") : null
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  for (let r = 1; r < rows.length; r++) {
    const c = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (c) { c.t = "n"; c.z = "dd.mm.yyyy"; }
    qs.forEach((q, i) => {
      if (!q.format) return;
      const cell = ws[XLSX.utils.encode_cell({ r, c: i + 2 })];
      if (!cell || typeof cell.v !== "number") return;
      if (q.format === "duration") { cell.v = cell.v / 24; cell.z = "[h]:mm"; }
      else { cell.v = (((cell.v % 24) + 24) % 24) / 24; cell.z = "hh:mm"; }
    });
  }
  ws["!cols"] = [{ wch: 12 }, { wch: 11 }, ...qs.map((q) => ({ wch: Math.min(Math.max(q.text.length + 2, 10), 40) })), { wch: 28 }];
  ws["!freeze"] = { xSplit: 1, ySplit: 1 };
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: header.length - 1 } }) };

  const qrows = [["Frage", "Typ", "Antworten / Bereich", "Mehrfachauswahl", "Folgefrage", "Einheit", "Health-Kürzel", "Status", "Anzahl Antworten"]];
  for (const q of qs) {
    qrows.push([
      q.text, typeLabel[q.type],
      q.type === "choice" ? q.options.join(" / ") : q.type === "scale" ? `${q.min}–${q.max}${q.minLabel || q.maxLabel ? ` (${q.minLabel || ""} … ${q.maxLabel || ""})` : ""}` : "",
      q.multi ? "ja" : "", condText(q), q.unit || "", q.healthKey || "", q.archived ? "ausgeblendet" : "aktiv", answerCount(q.id)
    ]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(qrows);
  ws2["!cols"] = [{ wch: 36 }, { wch: 9 }, { wch: 30 }, { wch: 15 }, { wch: 36 }, { wch: 10 }, { wch: 13 }, { wch: 12 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Antworten");
  XLSX.utils.book_append_sheet(wb, ws2, "Fragen");
  return wb;
}

async function exportExcel() {
  const wb = buildWorkbook();
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (await shareOrDownload(blob, `Mosaik_${todayIso()}.xlsx`)) toast("Excel erstellt");
}

async function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
  if (await shareOrDownload(blob, `Mosaik_Sicherung_${todayIso()}.json`)) {
    state.lastBackup = new Date().toISOString();
    save(); renderData(); toast("Sicherung erstellt");
  }
}

function importBackup(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!Array.isArray(s.questions) || typeof s.answers !== "object") throw new Error("Format");
      const nd = Object.keys(s.answers).length;
      if (!confirm(`Sicherung mit ${s.questions.length} Fragen und ${nd} Tagen laden? Die aktuellen Daten in der App werden dadurch ersetzt.`)) return;
      state = { ...empty(), ...s };
      save(); render(); toast("Sicherung wiederhergestellt");
    } catch (err) {
      toast("Diese Datei ist keine Mosaik-Sicherung");
    }
  };
  r.readAsText(f);
  e.target.value = "";
}

// Werte (Kürzel → Wert) an einem Tag eintragen; gibt eingetragene und unbekannte Kürzel zurück
function applyPairs(pairs, date) {
  const set = [], unknown = [];
  for (const [k, v] of Object.entries(pairs)) {
    const q = state.questions.find((x) => x.healthKey === k);
    if (!q) { unknown.push(k); continue; }
    let val;
    if (q.type === "choice") {
      val = q.options.find((o) => o.toLowerCase() === String(v).toLowerCase());
      if (val && q.multi) { const cur = (state.answers[date] || {})[q.id]; val = Array.from(new Set([...(Array.isArray(cur) ? cur : []), val])); }
    } else { val = parseNum(v); if (Number.isNaN(val)) val = undefined; if (q.type === "scale" && val !== undefined) val = Math.round(val); }
    if (val === undefined || val === null) { unknown.push(k); continue; }
    setAnswer(date, q.id, val);
    set.push(q.text);
  }
  return { set, unknown };
}

/* Health-Werte: "mosaik;schlaf=7,4;schritte=9500;datum=2026-10-14" */
function applyHealthText(text, fromPaste) {
  const t = String(text || "").trim();
  if (!/^(mosaik|taeglich);/i.test(t)) { // „taeglich;“ = alter Name, bleibt gültig
    toast(fromPaste ? "Text muss mit „mosaik;“ beginnen" : "In der Zwischenablage sind keine Health-Werte");
    return;
  }
  const pairs = {};
  for (const part of t.split(";").slice(1)) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    pairs[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  let date = todayIso();
  if (pairs.datum) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(pairs.datum)) date = pairs.datum;
    else if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(pairs.datum)) { const [d, m, y] = pairs.datum.split("."); date = `${y}-${pad(m)}-${pad(d)}`; }
    delete pairs.datum;
  }
  const { set, unknown } = applyPairs(pairs, date);
  if (set.length) {
    current = date; tab = "day"; render();
    toast(`${set.length} Wert${set.length > 1 ? "e" : ""} für ${longDate(date)} eingetragen`);
  } else {
    toast(unknown.length ? `Kein passendes Kürzel: ${unknown.join(", ")}` : "Keine Werte gefunden");
  }
}

async function healthFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    applyHealthText(text, false);
  } catch (e) {
    toast("Zwischenablage nicht lesbar – Text unter Einstellungen einfügen");
  }
}

// Werte auch über die Adresse übernehmen: …/#mosaik;schlaf=7,4
function checkHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (/^(mosaik|taeglich);/i.test(h)) {
    applyHealthText(h, false);
    history.replaceState(null, "", location.pathname + location.search);
  }
}

/* ================= Start ================= */
// Tageswechsel bei offen gelassener App
let lastToday = todayIso();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const t = todayIso();
  if (t !== lastToday) { if (current === lastToday) current = t; lastToday = t; if (tab === "day") renderDay(); }
});

if (syncFriendQuestions()) save();
render();
checkHash();

// Tippen auf die Erinnerung: …/?quiz=2026-10-16 startet die Abfrage für diesen Tag
function openQuizFromLink(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || date > todayIso()) return;
  if (!askQuestions(date).length) { current = date; tab = "day"; quiz = null; render(); return; }
  startQuiz(date);
}
{
  const sp = new URLSearchParams(location.search);
  const qd = sp.get("quiz");
  if (qd) { history.replaceState(null, "", location.pathname); openQuizFromLink(qd); }
  if (sp.get("report")) { history.replaceState(null, "", location.pathname); openReport(); }
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "quiz") openQuizFromLink(e.data.date);
    if (e.data && e.data.type === "report") { const d = $("#sheet"); if (d.open) d.close(); openReport(); }
  });
}
fetchInbox(false);
reportStatus();
setTimeout(goalNotices, 600);
capturePlace(false);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { fetchInbox(false); reportStatus(); setTimeout(goalNotices, 600); capturePlace(false); } });

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    // Beim Zurückkehren in die App nach einer neuen Version schauen
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch((e) => console.warn("SW", e));
  // Neue Version aktiv → einmal neu laden (nicht mitten in einer Abfrage oder einem offenen Fenster)
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    const tryReload = () => {
      if (quiz || document.querySelector("dialog[open]")) return setTimeout(tryReload, 5000);
      reloading = true; location.reload();
    };
    tryReload();
  });
}
