/* Täglich – tägliche Fragen erfassen, lokal speichern, als Excel exportieren. */
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

const activeQuestions = () => state.questions.filter((q) => !q.archived);
const isAnswered = (v) => v !== undefined && v !== null && v !== "";

function setAnswer(date, qid, value) {
  if (!state.answers[date]) state.answers[date] = {};
  if (isAnswered(value)) state.answers[date][qid] = value;
  else delete state.answers[date][qid];
  if (Object.keys(state.answers[date]).length === 0) delete state.answers[date];
  save();
}

function dayProgress(date) {
  const qs = activeQuestions();
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
  if (q.type === "choice") return q.options.join(" / ");
  if (q.type === "scale") return `Skala ${q.min}–${q.max}`;
  return `Zahl${q.unit ? " in " + q.unit : ""}`;
}

/* ================= Navigation ================= */
let tab = "day";
let current = todayIso();

document.querySelectorAll(".tabbar button").forEach((b) =>
  b.addEventListener("click", () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); })
);

function render() {
  document.querySelectorAll(".tabbar button").forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (tab === "day") renderDay();
  else if (tab === "questions") renderQuestions();
  else renderData();
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

  const qs = activeQuestions();
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
    body = `<p class="progress">${done} von ${qs.length} beantwortet</p>`;
    if (hasHealth) body += `<button class="btn ghost block" id="healthbtn" style="margin-bottom:12px">Werte aus Health einfügen</button>`;
    body += qs.map((q) => questionCard(q, a[q.id])).join("");
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

  view.querySelectorAll(".q").forEach((card) => wireCard(card));
}

function questionCard(q, val) {
  const done = isAnswered(val);
  let input = "";
  if (q.type === "choice") {
    input = `<div class="chips">${q.options.map((o) =>
      `<button class="chip" data-val="${esc(o)}" aria-pressed="${val === o}">${esc(o)}</button>`).join("")}</div>`;
  } else if (q.type === "scale") {
    let btns = "";
    for (let i = q.min; i <= q.max; i++) btns += `<button class="chip" data-val="${i}" aria-pressed="${val === i}">${i}</button>`;
    input = `<div class="scale">${btns}</div>`;
    if (q.minLabel || q.maxLabel) input += `<div class="scale-labels"><span>${esc(q.minLabel)}</span><span>${esc(q.maxLabel)}</span></div>`;
  } else {
    input = `<div class="numrow">
      <input type="text" inputmode="decimal" autocomplete="off" value="${esc(fmtNum(val))}" aria-label="${esc(q.text)}" placeholder="–">
      ${q.unit ? `<span class="unit">${esc(q.unit)}</span>` : ""}
      ${done ? `<button class="clear" data-clear>Leeren</button>` : ""}
    </div>`;
  }
  return `<section class="q ${done ? "done" : ""}" data-qid="${q.id}">
    <p class="q-title">${esc(q.text)}</p>
    ${input}
  </section>`;
}

function wireCard(card) {
  const q = state.questions.find((x) => x.id === card.dataset.qid);
  const cur = (state.answers[current] || {})[q.id];

  card.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    const v = q.type === "scale" ? Number(b.dataset.val) : b.dataset.val;
    setAnswer(current, q.id, cur === v ? null : v); // erneutes Tippen hebt Auswahl auf
    renderDay();
  }));

  const inp = card.querySelector("input");
  if (inp) {
    const commit = () => {
      const n = parseNum(inp.value);
      if (Number.isNaN(n)) { toast("Bitte eine Zahl eingeben, z. B. 7,5"); inp.value = fmtNum(cur); return; }
      if (n === (cur ?? null)) return;
      setAnswer(current, q.id, n);
      renderDay();
    };
    inp.addEventListener("change", commit);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  }
  card.querySelector("[data-clear]")?.addEventListener("click", () => { setAnswer(current, q.id, null); renderDay(); });
}

/* ================= Fragen verwalten ================= */
function renderQuestions() {
  const view = $("#view");
  const act = state.questions.filter((q) => !q.archived);
  const arch = state.questions.filter((q) => q.archived);
  const row = (q, i, list) => `<li class="qrow ${q.archived ? "archived" : ""}">
      <button class="qmain" data-edit="${q.id}">
        <span class="qtext">${esc(q.text)}</span>
        <span class="qmeta">${esc(describe(q))}${q.healthKey ? " · Health: " + esc(q.healthKey) : ""}</span>
      </button>
      ${q.archived ? "" : `
      <button class="iconbtn" data-move="${q.id}" data-dir="-1" aria-label="Nach oben" ${i === 0 ? "disabled" : ""}>↑</button>
      <button class="iconbtn" data-move="${q.id}" data-dir="1" aria-label="Nach unten" ${i === list.length - 1 ? "disabled" : ""}>↓</button>`}
    </li>`;

  view.innerHTML = `
    <div class="dayhead"><h1>Fragen</h1></div>
    ${act.length ? `<ul class="qlist">${act.map(row).join("")}</ul>` : `<p class="muted">Noch keine Fragen angelegt.</p>`}
    <button class="btn block" id="newq" style="margin-top:8px">Neue Frage</button>
    ${arch.length ? `<h2>Ausgeblendet</h2>
      <p class="muted small">Werden nicht mehr abgefragt, bleiben aber im Excel-Export.</p>
      <ul class="qlist">${arch.map(row).join("")}</ul>` : ""}`;

  $("#newq").addEventListener("click", () => openEditor(null));
  view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.edit)));
  view.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", () => {
    const list = state.questions;
    const actIds = list.filter((q) => !q.archived).map((q) => q.id);
    const pos = actIds.indexOf(b.dataset.move);
    const other = actIds[pos + Number(b.dataset.dir)];
    if (!other) return;
    const i1 = list.findIndex((q) => q.id === b.dataset.move);
    const i2 = list.findIndex((q) => q.id === other);
    [list[i1], list[i2]] = [list[i2], list[i1]];
    save();
    renderQuestions();
  }));
}

function answerCount(qid) {
  return Object.values(state.answers).filter((a) => isAnswered(a[qid])).length;
}

function openEditor(id) {
  const existing = id ? state.questions.find((q) => q.id === id) : null;
  const used = existing ? answerCount(existing.id) : 0;
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid(), text: "", type: "choice", options: ["Ja", "Nein"], min: 1, max: 5, minLabel: "", maxLabel: "", unit: "", healthKey: "", archived: false };

  const dlg = $("#sheet");

  const draw = () => {
    const typeLocked = used > 0;
    let typeFields = "";
    if (draft.type === "choice") {
      typeFields = `<div class="field" style="margin-bottom:8px;font-weight:600;font-size:15px">Antwortmöglichkeiten</div>
        ${draft.options.map((o, i) => `<div class="opt">
          <input value="${esc(o)}" data-opt="${i}" aria-label="Antwort ${i + 1}">
          <button class="iconbtn" data-delopt="${i}" aria-label="Antwort entfernen" ${draft.options.length <= 2 ? "disabled" : ""}>✕</button>
        </div>`).join("")}
        <button class="linkbtn" id="addopt">Antwort hinzufügen</button>
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

    dlg.innerHTML = `<form class="sheet-inner" method="dialog" novalidate>
      <div class="sheet-head">
        <button type="button" class="linkbtn" id="cancel">Abbrechen</button>
        <h2>${existing ? "Frage bearbeiten" : "Neue Frage"}</h2>
        <button type="submit" class="linkbtn" id="savebtn">Sichern</button>
      </div>
      <label class="field">Frage<input id="qtext" value="${esc(draft.text)}" placeholder="z. B. Heute bouldern?" autocomplete="off"></label>
      <div class="seg" role="group" aria-label="Antworttyp">
        ${["choice", "scale", "number"].map((t) => `<button type="button" data-type="${t}" aria-pressed="${draft.type === t}" ${typeLocked && draft.type !== t ? "disabled" : ""}>${typeLabel[t]}</button>`).join("")}
      </div>
      ${typeLocked ? `<p class="muted small" style="margin-top:-8px">Der Antworttyp ist fest, weil es schon ${used} Antworten gibt.</p>` : ""}
      ${typeFields}
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
      if ($("#smin", dlg)) { draft.min = parseInt($("#smin", dlg).value, 10); draft.max = parseInt($("#smax", dlg).value, 10); draft.minLabel = $("#sminl", dlg).value; draft.maxLabel = $("#smaxl", dlg).value; }
      if ($("#unit", dlg)) draft.unit = $("#unit", dlg).value;
      draft.healthKey = $("#hkey", dlg).value.trim().toLowerCase().replace(/[^a-z0-9_äöüß-]/g, "");
    };

    dlg.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => { sync(); draft.type = b.dataset.type; draw(); }));
    $("#addopt", dlg)?.addEventListener("click", () => { sync(); draft.options.push(""); draw(); dlg.querySelector(`[data-opt="${draft.options.length - 1}"]`).focus(); });
    dlg.querySelectorAll("[data-delopt]").forEach((b) => b.addEventListener("click", () => { sync(); draft.options.splice(+b.dataset.delopt, 1); draw(); }));
    $("#cancel", dlg).addEventListener("click", () => dlg.close());

    $("#archive", dlg)?.addEventListener("click", () => {
      existing.archived = !existing.archived; save(); dlg.close(); render();
      toast(existing.archived ? "Ausgeblendet" : "Wieder eingeblendet");
    });
    $("#delete", dlg)?.addEventListener("click", () => {
      if (!confirm(`„${existing.text}“ und alle ${used} Antworten endgültig löschen? Das lässt sich nicht rückgängig machen. Zum Behalten der Daten stattdessen „Ausblenden“ wählen.`)) return;
      state.questions = state.questions.filter((q) => q.id !== existing.id);
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
      }
      if (draft.type === "scale") {
        if (!Number.isInteger(draft.min) || !Number.isInteger(draft.max) || draft.max <= draft.min) return toast("Skala: „Bis“ muss größer als „Von“ sein");
        if (draft.max - draft.min > 10) return toast("Skala: höchstens 11 Stufen");
      }
      if (draft.healthKey && state.questions.some((q) => q.id !== draft.id && q.healthKey === draft.healthKey)) return toast("Dieses Health-Kürzel ist schon vergeben");
      if (existing) Object.assign(existing, draft);
      else state.questions.push(draft);
      save(); dlg.close(); render();
      toast(existing ? "Gesichert" : "Frage angelegt");
    });
  };

  draw();
  dlg.showModal();
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
          <li>Aktion <strong>Text</strong>: <code>taeglich;schlaf=</code> und dahinter die Variable mit dem gerundeten Wert.</li>
          <li>Aktion <strong>In Zwischenablage kopieren</strong>.</li>
          <li>Optional: Aktion <strong>URL öffnen</strong> ist nicht nötig. Öffne danach einfach diese App vom Home-Bildschirm.</li>
        </ol>
        <p class="small muted">Mehrere Werte gehen in einer Zeile: <code>taeglich;schlaf=7,4;schritte=9500</code>. Mit <code>datum=2026-10-14</code> landet der Wert an einem bestimmten Tag, sonst am heutigen.</p>
      </details>
      <p class="small" style="margin-top:12px">Zum Testen ohne Kurzbefehl: Text einfügen und übernehmen.</p>
      <textarea class="paste" id="pastebox" placeholder="taeglich;schlaf=7,5"></textarea>
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
  const qs = state.questions; // alle, auch ausgeblendete
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
        ...qs.map((q) => (isAnswered(a[q.id]) ? a[q.id] : null))
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

  const qrows = [["Frage", "Typ", "Antworten / Bereich", "Einheit", "Health-Kürzel", "Status", "Anzahl Antworten"]];
  for (const q of qs) {
    qrows.push([
      q.text, typeLabel[q.type],
      q.type === "choice" ? q.options.join(" / ") : q.type === "scale" ? `${q.min}–${q.max}${q.minLabel || q.maxLabel ? ` (${q.minLabel || ""} … ${q.maxLabel || ""})` : ""}` : "",
      q.unit || "", q.healthKey || "", q.archived ? "ausgeblendet" : "aktiv", answerCount(q.id)
    ]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(qrows);
  ws2["!cols"] = [{ wch: 36 }, { wch: 9 }, { wch: 30 }, { wch: 10 }, { wch: 13 }, { wch: 12 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Antworten");
  XLSX.utils.book_append_sheet(wb, ws2, "Fragen");
  return wb;
}

async function exportExcel() {
  const wb = buildWorkbook();
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (await shareOrDownload(blob, `Taeglich_${todayIso()}.xlsx`)) toast("Excel erstellt");
}

async function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
  if (await shareOrDownload(blob, `Taeglich_Sicherung_${todayIso()}.json`)) {
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
      toast("Diese Datei ist keine Täglich-Sicherung");
    }
  };
  r.readAsText(f);
  e.target.value = "";
}

/* Health-Werte: "taeglich;schlaf=7,4;schritte=9500;datum=2026-10-14" */
function applyHealthText(text, fromPaste) {
  const t = String(text || "").trim();
  if (!/^taeglich;/i.test(t)) {
    toast(fromPaste ? "Text muss mit „taeglich;“ beginnen" : "In der Zwischenablage sind keine Health-Werte");
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
    if (q.type === "choice") { val = q.options.find((o) => o.toLowerCase() === v.toLowerCase()); }
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

// Werte auch über die Adresse übernehmen: …/#taeglich;schlaf=7,4
function checkHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (/^taeglich;/i.test(h)) {
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
