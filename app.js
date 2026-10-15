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
}

function dayProgress(date) {
  const qs = visibleQuestions(date);
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
  else if (tab === "questions") renderQuestions();
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
      <input type="text" inputmode="decimal" autocomplete="off" value="${esc(fmtNum(val))}" aria-label="${esc(q.text)}" placeholder="–">
      ${q.unit ? `<span class="unit">${esc(q.unit)}</span>` : ""}
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
      const n = parseNum(inp.value);
      if (Number.isNaN(n)) { toast("Bitte eine Zahl eingeben, z. B. 7,5"); inp.value = fmtNum(cur()); return false; }
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

  const qs = visibleQuestions(current);
  const a = state.answers[current] || {};
  const done = qs.filter((q) => isAnswered(a[q.id])).length;
  const hasHealth = qs.some((q) => q.healthKey);

  let body;
  if (!qs.length) {
    body = `<div class="empty-state">
      <h2>Noch keine Fragen</h2>
      <p class="muted">Leg deine erste Frage an, zum Beispiel „Heute bouldern?“ mit den Antworten Ja und Nein.</p>
      <button class="btn" id="firstq">Frage anlegen</button>
    </div>`;
  } else {
    const startLabel = done === 0 ? "Abfrage starten" : done < qs.length ? "Abfrage fortsetzen" : "Abfrage nochmal durchgehen";
    body = `<button class="btn block ${done < qs.length ? "hold-btn" : "ghost"}" id="startquiz">${startLabel}</button>
      <p class="progress">${done} von ${qs.length} beantwortet</p>`;
    if (hasHealth) body += `<button class="btn ghost block" id="healthbtn" style="margin-bottom:12px">Werte aus Health einfügen</button>`;
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
      ${isToday ? "" : `<button class="todaybtn" id="gotoday">Zu heute</button>`}
    </div>
    <div class="week">${week}</div>
    ${body}`;

  view.querySelectorAll("[data-week]").forEach((b) => b.addEventListener("click", () => { current = addDays(current, +b.dataset.week); renderDay(); }));
  view.querySelectorAll("[data-date]").forEach((b) => b.addEventListener("click", () => { current = b.dataset.date; renderDay(); }));
  $("#gotoday")?.addEventListener("click", () => { current = todayIso(); renderDay(); });
  $("#firstq")?.addEventListener("click", () => openEditor(null));
  $("#healthbtn")?.addEventListener("click", healthFromClipboard);
  $("#startquiz")?.addEventListener("click", () => startQuiz(current));

  view.querySelectorAll(".q").forEach((card) => wireInput(card, qById(card.dataset.qid), current, (kind) => {
    if (kind !== "input") return renderDay();
    // Zahlen können keine Folgefragen auslösen → nur Markierung und Zähler aktualisieren
    const aa = state.answers[current] || {};
    card.classList.toggle("done", isAnswered(aa[card.dataset.qid]));
    const vq = visibleQuestions(current);
    $(".progress").textContent = `${vq.filter((x) => isAnswered(aa[x.id])).length} von ${vq.length} beantwortet`;
  }));
}

/* ================= Abfrage: eine Frage nach der anderen ================= */
function startQuiz(date) {
  const qs = visibleQuestions(date);
  const a = state.answers[date] || {};
  const first = qs.findIndex((q) => !isAnswered(a[q.id]));
  quiz = { date, idx: first < 0 ? 0 : first };
  render();
  window.scrollTo(0, 0);
}

function renderQuiz() {
  const view = $("#view");
  const { date } = quiz;
  const qs = visibleQuestions(date); // wird nach jeder Antwort neu berechnet → Folgefragen erscheinen
  const a = state.answers[date] || {};

  if (quiz.idx >= qs.length) {
    const open = qs.filter((q) => !isAnswered(a[q.id]));
    view.innerHTML = `<div class="quiz">
      <div class="quiz-top"><span class="muted">${longDate(date)}</span><button class="linkbtn" id="qclose">Schließen</button></div>
      <div class="quiz-done">
        <div class="hold big" style="--p:${dayProgress(date)}"></div>
        <h1>${open.length ? "Fast geschafft" : "Fertig"}</h1>
        <p class="muted">${open.length ? `${open.length} Frage${open.length > 1 ? "n" : ""} übersprungen.` : `Alle ${qs.length} Fragen für den ${longDate(date)} beantwortet.`}</p>
        <ul class="summary">${qs.map((q) => `<li><span>${esc(q.text)}</span><strong>${isAnswered(a[q.id]) ? esc(fmtVal(a[q.id])) + (q.unit ? " " + esc(q.unit) : "") : "–"}</strong></li>`).join("")}</ul>
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

const RANGES = [["7", "7 Tage"], ["30", "30 Tage"], ["365", "12 Monate"], ["all", "Alles"]];
const SERIES = 8; // Farben für Kuchendiagramme, weitere Antworten → „Weitere“
const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString("de-DE");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const shortDate = (s) => { const d = parseIso(s); return `${WD_SHORT[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };
const MON_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function rangeDays() {
  const t = todayIso();
  let start;
  if (prefs.range === "all") {
    const first = Object.keys(state.answers).sort()[0];
    start = first && first < t ? first : t;
  } else start = addDays(t, -(Number(prefs.range) - 1));
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
    ${qs.length ? qs.map((q) => analysisCard(q, days)).join("") : `<p class="muted">${all.length ? "Alle Fragen sind über das Zahnrad ausgeblendet." : "Noch keine Fragen angelegt."}</p>`}`;

  $("#asettings")?.addEventListener("click", openAnalysisSettings);
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
        cap.textContent = `${shortDate(best.d)}: ${fmtVal(v)}${q.unit ? " " + q.unit : ""}`;
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
    body = `
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
    <div class="yax small muted"><span>${fmt1(hi)}</span><span>${fmt1(lo)}</span></div>
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
      if (i.dataset.f === "show") setQ(i.dataset.q, { hidden: !i.checked });
      else setQ(i.dataset.q, { trend: i.checked });
      draw(); renderAnalysis();
    }));
    dlg.querySelectorAll("select[data-f]").forEach((sel) => sel.addEventListener("change", () => { setQ(sel.dataset.q, { countKey: sel.value }); renderAnalysis(); }));
  };
  draw();
  dlg.showModal();
  document.activeElement?.blur(); // sonst zeigt iOS einen Rahmen um „Fertig“
}

/* ================= Fragen verwalten ================= */
function renderQuestions() {
  const view = $("#view");
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
        <span class="qmeta">${esc(describe(q))}${q.healthKey ? " · Health: " + esc(q.healthKey) : ""}</span>
        ${q.cond ? `<span class="qmeta">${esc(condText(q))}</span>` : ""}
      </button>
      ${q.archived ? "" : `
      <button class="iconbtn" data-move="${q.id}" data-dir="-1" aria-label="Nach oben" ${pos === 0 ? "disabled" : ""}>↑</button>
      <button class="iconbtn" data-move="${q.id}" data-dir="1" aria-label="Nach unten" ${pos === sib.length - 1 ? "disabled" : ""}>↓</button>`}
    </li>`;
  };

  view.innerHTML = `
    <div class="dayhead"><h1>Fragen</h1></div>
    ${act.length ? `<ul class="qlist">${act.map(row).join("")}</ul>` : `<p class="muted">Noch keine Fragen angelegt.</p>`}
    <button class="btn block" id="newq" style="margin-top:8px">Neue Frage</button>
    ${act.length ? `<p class="muted small" style="margin-top:10px">Folgefragen (↳) erscheinen nur nach einer bestimmten Antwort. Anlegen über „Neue Frage“ → „Nur fragen, wenn …“.</p>` : ""}
    ${arch.length ? `<h2>Ausgeblendet</h2>
      <p class="muted small">Werden nicht mehr abgefragt, bleiben aber im Excel-Export.</p>
      <ul class="qlist">${arch.map(row).join("")}</ul>` : ""}`;

  $("#newq").addEventListener("click", () => openEditor(null));
  view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.edit)));
  view.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", () => {
    const q = qById(b.dataset.move);
    const sib = siblings(q);
    const other = sib[sib.indexOf(q) + Number(b.dataset.dir)];
    if (!other) return;
    const list = state.questions;
    const i1 = list.indexOf(q), i2 = list.indexOf(other);
    [list[i1], list[i2]] = [list[i2], list[i1]];
    save();
    renderQuestions();
  }));
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
  if (draft.cond === undefined) draft.cond = null;

  const dlg = $("#sheet");
  const hasChildren = existing && childrenOf(existing.id).length > 0;

  const draw = () => {
    const typeLocked = used > 0;
    // mögliche Ausgangsfragen: Auswahl oder Skala, aktiv, nicht sie selbst und keine eigene Folgefrage
    const blocked = existing ? descendants(existing.id) : new Set();
    const parents = ordered().map((o) => o.q).filter((p) => p.id !== draft.id && !p.archived && !blocked.has(p.id) && (p.type === "choice" || p.type === "scale"));
    const parent = draft.cond ? qById(draft.cond.qid) : null;
    const parentVals = parent ? (parent.type === "choice" ? parent.options : Array.from({ length: parent.max - parent.min + 1 }, (_, i) => String(parent.min + i))) : [];

    let typeFields = "";
    if (draft.type === "choice") {
      typeFields = `<div class="field" style="margin-bottom:8px;font-weight:600;font-size:15px">Antwortmöglichkeiten</div>
        ${draft.options.map((o, i) => `<div class="opt">
          <input value="${esc(o)}" data-opt="${i}" aria-label="Antwort ${i + 1}">
          <button type="button" class="iconbtn" data-delopt="${i}" aria-label="Antwort entfernen" ${draft.options.length <= 2 ? "disabled" : ""}>✕</button>
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
        </div>`;
    } else {
      typeFields = `<label class="field">Einheit (optional)<input id="unit" value="${esc(draft.unit)}" placeholder="z. B. Stunden"></label>`;
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
      <details class="adv" ${draft.healthKey ? "open" : ""}>
        <summary>Apple Health (optional)</summary>
        <label class="field" style="margin-top:8px">Health-Kürzel
          <input id="hkey" value="${esc(draft.healthKey)}" placeholder="z. B. schlaf" autocapitalize="off" autocomplete="off">
        </label>
        <p class="muted small">Wenn dein Kurzbefehl einen Wert mit diesem Kürzel liefert, trägt „Werte aus Health einfügen“ ihn hier ein. Anleitung unter Export.</p>
      </details>
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
      if ($("#unit", dlg)) draft.unit = $("#unit", dlg).value;
      draft.healthKey = $("#hkey", dlg).value.trim().toLowerCase().replace(/[^a-z0-9_äöüß-]/g, "");
    };

    dlg.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => { sync(); draft.type = b.dataset.type; draw(); }));
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
      for (const d of Object.keys(state.answers)) { delete state.answers[d][existing.id]; if (!Object.keys(state.answers[d]).length) delete state.answers[d]; }
      save(); dlg.close(); render(); toast("Gelöscht");
    });

    dlg.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      sync();
      draft.text = draft.text.trim();
      if (!draft.text) return toast("Bitte eine Frage eingeben");
      if (draft.type === "choice") {
        draft.options = draft.options.map((o) => o.trim()).filter(Boolean);
        if (draft.options.length < 2) return toast("Mindestens zwei Antworten nötig");
        if (new Set(draft.options).size !== draft.options.length) return toast("Antworten müssen unterschiedlich sein");
      } else draft.multi = false;
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
function renderData() {
  const view = $("#view");
  const days = Object.keys(state.answers).sort();
  const nAnswers = days.reduce((s, d) => s + Object.keys(state.answers[d]).length, 0);
  const last = state.lastBackup ? longDate(state.lastBackup.slice(0, 10)) + " " + state.lastBackup.slice(0, 4) : "noch nie";
  const backupOld = !state.lastBackup || (Date.now() - new Date(state.lastBackup).getTime()) > 30 * 864e5;
  const base = location.href.split("#")[0].split("?")[0];

  view.innerHTML = `
    <div class="dayhead"><h1>Export</h1></div>

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
      <h2>Apple Health</h2>
      <p class="muted">Eine Web-App kann Health nicht direkt lesen. Ein Kurzbefehl kann es: Er liest z. B. deine Schlafdauer und kopiert sie. In der App tippst du dann auf „Werte aus Health einfügen“.</p>
      <details>
        <summary><strong>Kurzbefehl für Schlaf einrichten</strong></summary>
        <ol class="steps small">
          <li>Leg hier unter Fragen eine Zahl-Frage an, z. B. „Wie lange geschlafen?“ mit Einheit Stunden, und trag unter Apple Health das Kürzel <code>schlaf</code> ein.</li>
          <li>Öffne die App Kurzbefehle und tippe auf <strong>+</strong>.</li>
          <li>Aktion <strong>Health-Stichproben suchen</strong>: Typ <em>Schlafanalyse</em>, Filter <em>Startdatum ist in den letzten 1 Tagen</em> und <em>Wert ist nicht Im Bett</em> und <em>Wert ist nicht Wach</em>.</li>
          <li>Aktion <strong>Details von Health-Stichproben abrufen</strong>: <em>Dauer</em>.</li>
          <li>Aktion <strong>Statistik berechnen</strong>: <em>Summe</em>.</li>
          <li>Aktion <strong>Maßeinheit umwandeln</strong> in <em>Stunden</em> (falls angeboten), dann <strong>Zahl runden</strong> auf 1 Nachkommastelle.</li>
          <li>Aktion <strong>Text</strong>: <code>mosaik;schlaf=</code> und dahinter die Variable mit dem gerundeten Wert.</li>
          <li>Aktion <strong>In Zwischenablage kopieren</strong>.</li>
          <li>Optional: Aktion <strong>URL öffnen</strong> ist nicht nötig. Öffne danach einfach diese App vom Home-Bildschirm.</li>
        </ol>
        <p class="small muted">Mehrere Werte gehen in einer Zeile: <code>mosaik;schlaf=7,4;schritte=9500</code>. Mit <code>datum=2026-10-14</code> landet der Wert an einem bestimmten Tag, sonst am heutigen.</p>
      </details>
      <p class="small" style="margin-top:12px">Zum Testen ohne Kurzbefehl: Text einfügen und übernehmen.</p>
      <textarea class="paste" id="pastebox" placeholder="mosaik;schlaf=7,5"></textarea>
      <button class="btn ghost block" id="pastego" style="margin-top:8px">Text übernehmen</button>
    </section>

    <p class="muted small">Adresse dieser App: <code>${esc(base)}</code></p>`;

  $("#xlsx").addEventListener("click", exportExcel);
  $("#backup").addEventListener("click", exportBackup);
  $("#restore").addEventListener("click", () => $("#restorefile").click());
  $("#restorefile").addEventListener("change", importBackup);
  $("#pastego").addEventListener("click", () => applyHealthText($("#pastebox").value, true));
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
  const days = Object.keys(state.answers).sort();
  const header = ["Datum", "Wochentag", ...qs.map((q) => q.text + (q.type === "number" && q.unit ? ` (${q.unit})` : ""))];
  const rows = [header];
  // Jeder Kalendertag vom ersten bis zum letzten Eintrag – unbeantwortete Tage bleiben leer
  if (days.length) {
    for (let d = days[0]; d <= days[days.length - 1]; d = addDays(d, 1)) {
      const a = state.answers[d] || {};
      const dt = parseIso(d);
      rows.push([
        (Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) - Date.UTC(1899, 11, 30)) / 864e5, // Excel-Datumszahl
        WD[dt.getDay()],
        ...qs.map((q) => (isAnswered(a[q.id]) ? (Array.isArray(a[q.id]) ? a[q.id].join(", ") : a[q.id]) : null))
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  for (let r = 1; r < rows.length; r++) {
    const c = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (c) { c.t = "n"; c.z = "dd.mm.yyyy"; }
  }
  ws["!cols"] = [{ wch: 12 }, { wch: 11 }, ...qs.map((q) => ({ wch: Math.min(Math.max(q.text.length + 2, 10), 40) }))];
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
  const set = [];
  const unknown = [];
  for (const [k, v] of Object.entries(pairs)) {
    const q = state.questions.find((x) => x.healthKey === k);
    if (!q) { unknown.push(k); continue; }
    let val;
    if (q.type === "choice") { val = q.options.find((o) => o.toLowerCase() === v.toLowerCase()); if (val && q.multi) val = [val]; }
    else { val = parseNum(v); if (Number.isNaN(val)) val = undefined; if (q.type === "scale" && val !== undefined) val = Math.round(val); }
    if (val === undefined || val === null) { unknown.push(k); continue; }
    setAnswer(date, q.id, val);
    set.push(q.text);
  }
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
    toast("Zwischenablage nicht lesbar – Text unter Export einfügen");
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

render();
checkHash();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
}
