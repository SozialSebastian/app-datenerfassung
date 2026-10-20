/* Mosaik – Ziele */
"use strict";

/* ================= Ziele ================= */
// Gespeichert in state.goals (mit in der Sicherung):
// { period (Vorgabe für neue Ziele), items: [Ziel], seen: { week|month|year: zuletzt gemeldeter Zeitraum }, seenFails }
// Ziel: { id, qid, kind: "count"|"days"|"avg"|"sum", key, op: "min"|"max", n, cmp: "ge"|"le", val,
//         period: "week"|"month"|"year", repeat: true|false, once: Zeitraum-Schlüssel bei einmaligen Zielen,
//         created: ab wann das Ziel zählt (Startdatum, bei älteren Zielen Tag der Umstellung) – Rückblick erst ab dann,
//         start: Startdatum (optional) – Zeiträume laufen ab diesem Tag, z. B. Woche Do–Mi, Monat 15.–14. }
const GOAL_PERIODS = [["week", "Woche"], ["month", "Monat"], ["year", "Jahr"]];
const PER_WORD = { week: "pro Woche", month: "im Monat", year: "im Jahr" };
const THIS_WORD = { week: "diese Woche", month: "diesen Monat", year: "dieses Jahr" };
const EVERY_WORD = { week: "Jede Woche", month: "Jeden Monat", year: "Jedes Jahr" };
const GOAL_PREVIEW = 3;
let showAllGoals = false;

function G() {
  if (!state.goals || typeof state.goals !== "object") state.goals = {};
  const g = state.goals;
  if (!GOAL_PERIODS.some(([k]) => k === g.period)) g.period = "month";
  if (!Array.isArray(g.items)) g.items = [];
  // ältere Ziele hatten einen gemeinsamen Zeitraum → fest übernehmen
  g.items.forEach((x) => { if (!x.period) x.period = g.period; });
  // ältere Ziele ohne Anlegedatum: ab heute (der Rückblick bewertet keine Zeiträume vor dem Ziel)
  if (g.items.some((x) => !x.created)) { g.items.forEach((x) => { if (!x.created) x.created = todayIso(); }); save(); }
  if (!Array.isArray(g.seenFails)) g.seenFails = [];
  if (!g.seen || typeof g.seen !== "object") { g.seen = {}; if (g.seenPeriod) g.seen[g.seenPeriod.split(":")[0]] = g.seenPeriod; }
  return g;
}
const gp = (g) => g.period || G().period; // Zeitraum eines Ziels (ältere Ziele: gemeinsamer Zeitraum)
const goalPer = (g, d) => periodOf(gp(g), d, g.start); // Zeitraum eines Ziels, der den Tag d enthält
const goalCur = (g) => goalPer(g, todayIso());
const goalStarted = (g) => !g.start || g.start <= todayIso();
// einmalige Ziele nur in ihrem Zeitraum; Ziele mit Startdatum erst ab diesem Tag
const goalActive = (g) => goalStarted(g) && (g.repeat !== false || g.once === goalCur(g).key);
// Gruppe für Rückblick und Meldungen: Zeitraum-Art plus Startdatum (gleiche Zeiträume)
const goalGroup = (g) => (g.start ? `${gp(g)}|${goalAnchor(gp(g), g.start)}` : gp(g));
// aktive Ziele mit aktiver Frage
const goalItems = () => G().items.filter((x) => { const q = qById(x.qid); return q && !q.archived && goalActive(x); });
// Gilt ein Ziel in einem (früheren) Zeitraum?
const goalIn = (g, per) => gp(g) === per.kind && (!g.start || per.start >= g.start) && (!g.created || per.end >= g.created) && (g.repeat !== false || g.once === per.key);
const dayCount = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 864e5) + 1;
const dm = (s) => { const d = parseIso(s); return `${d.getDate()}.${d.getMonth() + 1}.`; };

const monthLen = (y, m) => new Date(y, m + 1, 0).getDate(); // m: 0–11
// Startdatum auf das Wesentliche kürzen: Woche → Wochentag, Monat → Tag im Monat, Jahr → Monat und Tag
function goalAnchor(kind, a) {
  if (kind === "week") return "w" + parseIso(a).getDay();
  if (kind === "month") return "m" + a.slice(8);
  return "y" + a.slice(5);
}
// Zeitraum, der den Tag d enthält: ohne Startdatum Kalenderwoche (ab Montag), Kalendermonat, Kalenderjahr;
// mit Startdatum a läuft er ab dem Tag von a (Woche ab dem Wochentag, Monat ab dem Tag im Monat, Jahr ab Tag und Monat)
function periodOf(kind, d, a) {
  if (a && (kind !== "week" || parseIso(a).getDay() !== 1) && (kind !== "month" || a.slice(8) !== "01") && (kind !== "year" || a.slice(5) !== "01-01")) {
    let s;
    if (kind === "week") {
      const k = Math.floor(Math.round((parseIso(d) - parseIso(a)) / 864e5) / 7);
      s = addDays(a, 7 * k);
      const e = addDays(s, 6);
      return { kind, a, start: s, end: e, key: `week:${s}`, name: `Woche ${dm(s)}–${dm(e)}` };
    }
    const D = Number(a.slice(8)), M = Number(a.slice(5, 7)) - 1;
    const at = (y, m) => { // Stichtag im Monat m (gekürzt, z. B. 31. → 30.)
      while (m < 0) { m += 12; y--; } while (m > 11) { m -= 12; y++; }
      return `${y}-${pad(m + 1)}-${pad(Math.min(D, monthLen(y, m)))}`;
    };
    const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1;
    let e;
    if (kind === "month") {
      s = at(y, m); if (s > d) s = at(y, m - 1);
      const sm = Number(s.slice(5, 7)) - 1, sy = Number(s.slice(0, 4));
      e = addDays(at(sy, sm + 1), -1);
    } else {
      s = at(y, M); if (s > d) s = at(y - 1, M);
      e = addDays(at(Number(s.slice(0, 4)) + 1, M), -1);
    }
    return { kind, a, start: s, end: e, key: `${kind}:${s}`, name: `${dm(s)}–${dm(e)}${e.slice(0, 4)}` };
  }
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
const prevPeriod = (p) => periodOf(p.kind, addDays(p.start, -1), p.a);

// Wörter für Vergleich: bei Uhrzeiten früh/spät, sonst mindestens/höchstens
const cmpWord = (q, cmp) => (q.format === "clock" ? (cmp === "le" ? "spätestens" : "frühestens") : (cmp === "le" ? "höchstens" : "mindestens"));
const cmpOk = (cmp, v, x) => (cmp === "le" ? v <= x : v >= x);
const valText = (q, v) => (q.type === "scale" ? String(v) : fmtNice(q, v));

function goalText(g, q) {
  if (g.kind === "count" && g.op === "max" && g.n === 0) return `nie „${esc(g.key)}“`;
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
  const last0 = todayOpen(q) ? addDays(t, -1) : t;
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
  let rest = ended ? 0 : dayCount(t, per.end) - (todayOpen(q) ? 0 : 1);
  if (!ended && !todayOpen(q) && !isAnswered((state.answers[t] || {})[q.id])) rest += 1;
  const daysLeft = ended ? 0 : dayCount(t, per.end);
  const pace = counted / total;
  const r = { q, g, per, ended, vals: vals.length, daysLeft };

  if (g.kind === "avg") {
    const nums = vals.map((x) => x.v).filter((v) => typeof v === "number");
    // Abstand zum Ziel: Puffer oder wie viel fehlt (bei Zeiten in Minuten)
    const gap = (v) => {
      const d = Math.abs(v - g.val);
      const txt = q.format ? (() => { const m = Math.round(d * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; })() : valText(q, Math.round(d * 10) / 10);
      if (cmpOk(g.cmp, v, g.val)) return `${txt} Puffer`;
      return `${txt} ${q.format === "clock" ? (g.cmp === "le" ? "zu spät" : "zu früh") : (g.cmp === "le" ? "zu viel" : "zu wenig")}`;
    };
    if (!nums.length) {
      // noch nichts im Zeitraum: bisherigen Schnitt (letzte 30 Tage davor) zeigen
      const before = [];
      for (let d = addDays(per.start, -30); d < per.start; d = addDays(d, 1)) { const v = (state.answers[d] || {})[q.id]; if (typeof v === "number") before.push(v); }
      const b = before.length ? mean(before) : null;
      return { ...r, status: ended ? "fail" : "none", cur: "noch keine Werte", frac: null,
        note: b === null ? "" : `bisher Ø ${valText(q, Math.round(b * 100) / 100)} (${gap(b)})` };
    }
    const a = mean(nums);
    const ok = cmpOk(g.cmp, a, g.val);
    // was ab jetzt im Schnitt nötig ist, damit das Ziel am Ende des Zeitraums erreicht wird
    let need = "";
    const left = ended ? 0 : dayCount(t, per.end) - (!todayOpen(q) && isAnswered((state.answers[t] || {})[q.id]) ? 1 : 0);
    if (!ok && left > 0) {
      const w = (g.val * (nums.length + left) - nums.reduce((x, y) => x + y, 0)) / left;
      const [lo, hi] = q.type === "scale" ? [q.min, q.max] : q.format === "duration" ? [0, 16] : q.format === "clock" && q.healthKey !== "aufwachzeit" ? [18, 32] : [0, Infinity];
      if (w < lo || w > hi) need = " · im Zeitraum nicht mehr aufzuholen";
      else need = ` · ab jetzt Ø ${cmpWord(q, g.cmp)} ${valText(q, Math.round((q.format ? (g.cmp === "le" ? Math.floor(w * 12 + 1e-9) : Math.ceil(w * 12 - 1e-9)) / 12 : w) * 100) / 100 /* Zeiten auf 5 min, zur sicheren Seite */)} nötig`;
    }
    return { ...r, status: ok ? (ended ? "done" : "ok") : (ended ? "fail" : "behind"), cur: `Ø ${valText(q, Math.round(a * 100) / 100)}`, frac: null, curVal: a,
      note: gap(a) + need };
  }

  let c;
  if (g.kind === "count") c = vals.filter((x) => has(x.v, g.key)).length;
  else if (g.kind === "days") c = vals.filter((x) => typeof x.v === "number" && cmpOk(g.cmp, x.v, g.val)).length;
  else c = vals.reduce((s, x) => s + (typeof x.v === "number" ? x.v : 0), 0);
  const target = g.kind === "sum" ? g.val : g.n;
  const upper = g.kind === "sum" ? g.cmp === "le" : g.op === "max"; // „höchstens“-Ziel
  const curTxt = upper && g.kind !== "sum" ? `${c}× · erlaubt ${target}×` : g.kind === "sum" ? `${valText(q, Math.round(c * 100) / 100)} von ${valText(q, target)}` : `${c} von ${target}${g.kind === "count" ? "×" : " Tagen"}`;
  const frac = target > 0 ? Math.min(c / target, 1) : 1;

  // „nie“-Ziel (höchstens 0×): kein Balken, nur eingehalten oder nicht
  if (upper && g.kind === "count" && target === 0) {
    if (c > 0) return { ...r, status: "fail", over: true, never: true, cur: `${c}× „${esc(g.key)}“`, frac: null, c, target };
    return { ...r, status: ended ? "done" : "ok", never: true, upper: true, cur: vals.length ? `an ${vals.length} Tag${vals.length === 1 ? "" : "en"} eingehalten` : "noch keine Antworten", frac: null, c, target };
  }
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
const statusLabel = (e) => (e.never ? (e.status === "fail" ? "Nicht eingehalten" : e.status === "done" ? "Eingehalten" : "Bisher eingehalten")
  : e.status === "fail" ? (e.over ? "Überschritten" : e.impossible ? "Nicht mehr erreichbar" : "Verfehlt") : STATUS[e.status]);
const STATUS_ORDER = { fail: 0, behind: 1, none: 2, ok: 3, done: 4 };

function goalRow(e) {
  const bar = e.frac === null ? "" : `<span class="gbar"><span style="width:${Math.round(e.frac * 100)}%"></span></span>`;
  return `<li class="grow st-${e.status}">
    <div class="gtop"><span class="gq">${esc(e.q.text)}</span><span class="gst"><span class="gdot" aria-hidden="true"></span>${statusLabel(e)}</span></div>
    ${bar}
    ${e.never ? "" : `<div class="gcur small"><strong>${e.cur}</strong>${e.note ? ` · ${e.note}` : ""}</div>`}
  </li>`;
}

// Rückblick: frühere Zeiträume je Zeitraum-Art, jeweils mit den dort gültigen Zielen
function goalHistory() {
  const all = G().items.filter((g) => qById(g.qid));
  const first = Object.keys(state.answers).sort()[0];
  const out = [];
  if (!first) return out;
  const LIMIT = { week: 6, month: 6, year: 3 };
  for (const grp of new Set(all.map(goalGroup))) {
    const gs = all.filter((g) => goalGroup(g) === grp);
    const k = gp(gs[0]);
    let p = prevPeriod(goalCur(gs[0]));
    for (let i = 0; i < LIMIT[k] && p.start >= first; i++, p = prevPeriod(p)) {
      const ev = gs.filter((g) => goalIn(g, p)).map((g) => evalGoal(g, p));
      if (ev.length) out.push({ p, ok: ev.filter((e) => e.status === "done").length, all: ev.length, miss: ev.filter((e) => e.status !== "done") });
    }
  }
  return out.sort((a, b) => (a.p.end < b.p.end ? 1 : -1)).slice(0, 8);
}

// Bereich „Ziele“ in der Analyse
function goalsPanel() {
  const items = goalItems();
  if (!items.length) {
    return `<section class="panel goals"><h2 class="atitle">Ziele</h2>
      <p class="muted small" style="margin:0">Noch keine aktiven Ziele. Leg sie unter „Tag“ über das Zahnrad oben rechts an.</p></section>`;
  }
  const evals = items.map((g) => evalGoal(g, goalCur(g))).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const shown = showAllGoals ? evals : evals.slice(0, GOAL_PREVIEW);
  const hist = goalHistory();

  return `<section class="panel goals">
    <h2 class="atitle">Ziele</h2>
    <ul class="glist">${shown.map(goalRow).join("")}</ul>
    ${evals.length > GOAL_PREVIEW ? `<button class="btn ghost block" id="gmore" style="margin-top:10px">${showAllGoals ? "Weniger anzeigen" : `Alle Ziele anzeigen (${evals.length - GOAL_PREVIEW} weitere)`}</button>` : ""}
    ${hist.length ? `<details class="ghist">
      <summary>Rückblick: ${esc(hist[0].p.name)} ${hist[0].ok} von ${hist[0].all} erreicht</summary>
      <ul class="hlist">${hist.map((h) => `<li><span class="hn">${esc(h.p.name)}</span><span class="hv ${h.ok === h.all ? "all" : ""}">${h.ok}/${h.all}</span>
        ${h.miss.length ? `<span class="hm small muted">verfehlt: ${h.miss.map((e) => esc(e.q.text)).join(", ")}</span>` : ""}</li>`).join("")}</ul>
      <p class="small muted" style="margin:8px 0 0">Wiederholte Ziele werden mit ihrer heutigen Einstellung bewertet.</p>
    </details>` : ""}
  </section>`;
}

// Hinweis: Zeitraum vorbei (mit verfehlten Zielen) oder Ziel nicht mehr erreichbar
function goalNotices() {
  const gs = G();
  const all = gs.items.filter((g) => { const q = qById(g.qid); return q && !q.archived && goalStarted(g); });
  if (!all.length || quiz || document.querySelector("dialog[open]")) return;
  // 1. abgelaufene Zeiträume je Art (Woche, Monat, Jahr) – einmal melden
  const summaries = [];
  for (const k of new Set(all.map(goalGroup))) {
    const gsK = all.filter((g) => goalGroup(g) === k);
    const prev = prevPeriod(goalCur(gsK[0]));
    if (!gs.seen[k]) { gs.seen[k] = prev.key; continue; } // erst ab dem nächsten Wechsel melden
    if (gs.seen[k] === prev.key) continue;
    gs.seen[k] = prev.key;
    const ev = gsK.filter((g) => goalIn(g, prev)).map((g) => evalGoal(g, prev));
    if (!ev.length) continue;
    const ok = ev.filter((e) => e.status === "done").length;
    if (ok === ev.length) toast(`${prev.name}: alle ${ev.length} Ziele erreicht!`);
    else summaries.push({ prev, ev, ok });
  }
  // 2. Ziele, die im laufenden Zeitraum nicht mehr zu schaffen sind
  const curKeys = new Set(goalItems().map((g) => goalCur(g).key));
  gs.seenFails = gs.seenFails.filter((x) => curKeys.has(x.split("|")[0]));
  const fresh = goalItems().map((g) => evalGoal(g, goalCur(g))).filter((e) => e.status === "fail" && !gs.seenFails.includes(`${e.per.key}|${e.g.id}`));
  fresh.forEach((e) => gs.seenFails.push(`${e.per.key}|${e.g.id}`));
  save();
  if (!summaries.length && !fresh.length) return;

  const dlg = $("#sheet");
  dlg.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><span></span><h2>Ziele</h2><button type="button" class="linkbtn" id="gok">Okay</button></div>
    ${summaries.map((sm) => `<section class="sq">
      <p class="gbig"><strong>${esc(sm.prev.name)}</strong> ist vorbei: ${sm.ok} von ${sm.ev.length} Zielen erreicht.</p>
      <ul class="glist">${sm.ev.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]).map(goalRow).join("")}</ul>
    </section>`).join("")}
    ${fresh.length ? `<section class="sq">
      <p class="gbig">${fresh.length === 1 ? "Ein Ziel ist" : `${fresh.length} Ziele sind`} im laufenden Zeitraum nicht mehr zu schaffen.</p>
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

  // erster bzw. laufender Zeitraum zum gewählten Startdatum
  const firstPer = () => periodOf(edit.period, edit.start > todayIso() ? edit.start : todayIso(), edit.start);
  const perInfo = () => {
    const p = firstPer(), W = { week: "Woche", month: "Monat", year: "Jahr" }[edit.period];
    return `${edit.start > todayIso() ? "Erster" : "Laufender"} Zeitraum: ${dm(p.start)}–${dm(p.end)}${p.end.slice(0, 4)}. Jede${edit.period === "week" ? "" : "r"} ${W} beginnt ${edit.period === "week" ? `am ${["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"][parseIso(edit.start).getDay()]}` : edit.period === "month" ? `am ${Number(edit.start.slice(8))}.` : `am ${dm(edit.start)}`}`;
  };
  const once = () => (edit.repeat === false ? ` (nur ${esc(firstPer().name)})` : "");
  const form = () => {
    const q = qById(edit.qid);
    const per = PER_WORD[edit.period];
    let f = `<label class="field">Frage<select id="gq">${qs().map((x) => `<option value="${x.id}" ${x.id === q.id ? "selected" : ""}>${esc(x.text)}</option>`).join("")}</select></label>
      <div class="sq-row"><span>Zeitraum</span><div class="seg seg-3" role="group">${GOAL_PERIODS.map(([k, l]) => `<button type="button" data-gper="${k}" aria-pressed="${edit.period === k}">${l}</button>`).join("")}</div></div>
      <div class="sq-row"><span>Beginnt am</span><input id="gstart" class="gdate" type="date" value="${esc(edit.start)}"></div>
      <p class="small muted gperinfo">${esc(perInfo())}</p>
      <div class="sq-row"><span>Wiederholen</span>${seg2("grep", [["yes", EVERY_WORD[edit.period]], ["no", `Nur ${edit.start > todayIso() ? "einmal" : THIS_WORD[edit.period]}`]], edit.repeat === false ? "no" : "yes")}</div>`;
    if (q.type === "choice") {
      f += `<div class="sq-row"><span>Antwort</span><select id="gkey">${q.options.map((o) => `<option ${o === edit.key ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
        <div class="sq-row"><span>Wie oft</span><div class="seg seg-3" role="group">${[["min", "mindestens"], ["max", "höchstens"], ["never", "nie"]].map(([v, l]) => `<button type="button" data-gop="${v}" aria-pressed="${(edit.op === "max" && edit.n === 0 ? "never" : edit.op) === v}">${l}</button>`).join("")}</div></div>
        ${edit.op === "max" && edit.n === 0 ? "" : `<div class="gline"><input id="gn" class="gin" type="text" inputmode="numeric" value="${esc(edit.n ?? "")}"><span>× ${per}</span></div>`}`;
    } else {
      f += `<div class="sq-row"><span>Art</span>${kindSeg(q, edit.kind)}</div>`;
      if (edit.kind === "days") f += `<div class="gline"><span>an mindestens</span><input id="gn" class="gin" type="text" inputmode="numeric" value="${esc(edit.n ?? "")}"><span>Tagen ${per}</span></div>`;
      f += `<div class="sq-row"><span>${edit.kind === "days" ? "mit Wert" : edit.kind === "sum" ? "Summe" : "Schnitt"}</span>${seg2("gcmp", q.format === "clock" ? [["le", "spätestens"], ["ge", "frühestens"]] : [["ge", "mindestens"], ["le", "höchstens"]], edit.cmp)}</div>
        <div class="gline">${valInput(q, edit.val)}</div>`;
    }
    const valid = goalValid(edit, q);
    f += `<p class="gprev small">${valid ? `Ziel: <strong>${goalText(edit, q)}</strong> ${per}${once()}` : `<span class="muted">Bitte ${q.type === "choice" || edit.kind === "days" ? "Anzahl" : "Wert"} eintragen</span>`}</p>
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
    const items = gs.items.filter((x) => qById(x.qid));
    dlg.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><span></span><h2>Ziele</h2><button type="button" class="linkbtn" id="gdone">Fertig</button></div>
      ${items.map((g) => {
        const q = qById(g.qid);
        if (edit && edit.id === g.id) return form();
        const done = goalStarted(g) && !goalActive(g);
        return `<section class="sq ${q.archived || done ? "off" : ""}">
          <div class="sq-head"><strong>${esc(q.text)}</strong>
            <button type="button" class="iconbtn" data-gdel="${g.id}" aria-label="Ziel löschen">✕</button></div>
          <button type="button" class="gedit" data-gedit="${g.id}">${goalText(g, q)} ${PER_WORD[gp(g)]}<span class="gtag">${!goalStarted(g) ? `ab ${dm(g.start)}` : g.repeat === false ? (done ? "abgeschlossen" : `nur ${esc(goalCur(g).name)}`) : `${EVERY_WORD[gp(g)].toLowerCase()}${g.start && periodOf(gp(g), todayIso(), g.start).a ? ` · ab ${dm(goalCur(g).start)}` : ""}`}</span>${q.archived ? " · Frage ausgeblendet" : ""}<span class="muted"> · ändern</span></button>
        </section>`;
      }).join("")}
      ${edit && edit.isNew ? form() : ""}
      ${!edit ? (qs().length ? `<button type="button" class="btn block" id="gadd">Ziel hinzufügen</button>`
        : `<p class="muted small">Leg zuerst unter Einstellungen → Fragen eine Frage an.</p>`) : ""}
      ${!items.length && !edit && qs().length ? `<p class="muted small" style="margin-top:12px">Zum Beispiel: „Heute bouldern?“ mindestens 8× „Ja“ im Monat, oder Schlafdauer im Schnitt mindestens 7 h. Den Stand siehst du unter Analyse → Ziele.</p>` : ""}
    </div>`;
    dlg.querySelector(".sheet-inner").scrollTop = keep;

    $("#gdone", dlg).addEventListener("click", () => dlg.close());
    $("#gadd", dlg)?.addEventListener("click", () => {
      const q = qs()[0];
      edit = { id: uid(), qid: q.id, period: gs.period, repeat: true, start: periodOf(gs.period, todayIso()).start, autoStart: true, ...goalDraft(q, gs.period), isNew: true };
      draw();
      $("#gform", dlg)?.scrollIntoView({ block: "nearest" });
    });
    dlg.querySelectorAll("[data-gedit]").forEach((b) => b.addEventListener("click", () => {
      const g0 = gs.items.find((x) => x.id === b.dataset.gedit);
      edit = { ...g0, period: gp(g0), repeat: g0.repeat !== false, start: g0.start || (g0.once ? g0.once.split(":")[1].replace(/^(\d{4})$/, "$1-01-01") : periodOf(gp(g0), todayIso()).start), autoStart: !g0.start, isNew: false };
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
      edit = { id: edit.id, qid: q.id, period: edit.period, repeat: edit.repeat, start: edit.start, autoStart: edit.autoStart, ...goalDraft(q, edit.period), isNew: edit.isNew };
      draw();
    });
    $("#gkey", dlg)?.addEventListener("change", () => { sync(); draw(); });
    dlg.querySelectorAll("[data-gper]").forEach((b) => b.addEventListener("click", () => {
      sync();
      // Anzahl bzw. Summe passend zum neuen Zeitraum umrechnen (Woche 1, Monat ≈ 4,3, Jahr 52)
      const W_ = { week: 1, month: 4.3, year: 52 }, f = W_[b.dataset.gper] / W_[edit.period];
      if (f !== 1) {
        if (Number.isInteger(edit.n) && (edit.kind === "count" || edit.kind === "days")) edit.n = Math.max(edit.op === "max" ? 0 : 1, Math.round(edit.n * f));
        if (edit.kind === "sum" && typeof edit.val === "number") edit.val = Math.round(edit.val * f);
        if (edit.kind === "days") edit.n = Math.min(edit.n, dayCount(periodOf(b.dataset.gper, todayIso()).start, periodOf(b.dataset.gper, todayIso()).end));
      }
      edit.period = b.dataset.gper;
      if (edit.autoStart) edit.start = periodOf(edit.period, todayIso()).start; // ohne eigenes Startdatum: Kalender-Zeitraum
      draw();
    }));
    $("#gstart", dlg).addEventListener("change", (e) => {
      sync();
      if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { edit.start = e.target.value; edit.autoStart = false; }
      draw();
    });
    dlg.querySelectorAll("[data-grep]").forEach((b) => b.addEventListener("click", () => { sync(); edit.repeat = b.dataset.grep === "yes"; draw(); }));
    dlg.querySelectorAll("[data-gop]").forEach((b) => b.addEventListener("click", () => {
      sync();
      if (b.dataset.gop === "never") { edit.op = "max"; edit.n = 0; }
      else { if (edit.op === "max" && edit.n === 0) edit.n = b.dataset.gop === "min" ? 3 : 1; edit.op = b.dataset.gop; }
      draw();
    }));
    dlg.querySelectorAll("[data-gcmp]").forEach((b) => b.addEventListener("click", () => { sync(); edit.cmp = b.dataset.gcmp; draw(); }));
    dlg.querySelectorAll("[data-gk]").forEach((b) => b.addEventListener("click", () => {
      sync(); edit.kind = b.dataset.gk;
      if (edit.kind === "sum" && edit.val !== null) { // Summe: Tageswert × Tage als Vorschlag
        const days = dayCount(periodOf(edit.period, todayIso()).start, periodOf(edit.period, todayIso()).end);
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
        if (prev) prev.innerHTML = goalValid(edit, q) ? `Ziel: <strong>${goalText(edit, q)}</strong> ${PER_WORD[edit.period]}${once()}` : `<span class="muted">Bitte gültige Zahl eintragen</span>`;
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
      // Startdatum nur speichern, wenn selbst gewählt (sonst Kalenderwoche/-monat/-jahr wie bisher)
      const start = !g.autoStart && g.start ? g.start : null;
      const fp = periodOf(g.period, start && start > todayIso() ? start : todayIso(), start);
      const timing = { period: g.period, repeat: g.repeat !== false, ...(start ? { start } : {}), ...(g.repeat === false ? { once: fp.key } : {}) };
      // Rückblick zählt ab dem Startdatum (auch wenn es nur der Beginn der laufenden Woche/des Monats ist)
      const created = g.start || g.created || todayIso();
      const clean = q.type === "choice" ? { id: g.id, qid: g.qid, kind: "count", key: g.key, op: g.op, n: g.n, created, ...timing }
        : { id: g.id, qid: g.qid, kind: g.kind, cmp: g.cmp, val: g.val, ...(g.kind === "days" ? { n: g.n } : {}), created, ...timing };
      gs.period = g.period; // Vorgabe für das nächste neue Ziel
      const grp = goalGroup(timing);
      if (!gs.seen[grp]) gs.seen[grp] = prevPeriod(goalPer(timing, start && start > todayIso() ? start : todayIso())).key;
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
