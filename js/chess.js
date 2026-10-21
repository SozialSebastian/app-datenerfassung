/* Mosaik – Schnittstelle chess.com: Elo, Partien, Spielzeit, Genauigkeit, Eröffnungen */
"use strict";

// Öffentliche, schreibgeschützte API von chess.com, ohne Anmeldung (nur der Benutzername)
const CHESS_API = "https://api.chess.com/pub/player/";
const CHESS_CLS = { rapid: "Rapid", blitz: "Blitz", bullet: "Bullet", daily: "Daily", "chess960-daily": "Chess960 Daily", "chess960-rapid": "Chess960 Rapid", "chess960-blitz": "Chess960 Blitz", "chess960-bullet": "Chess960 Bullet" };
const chessClsName = (k) => CHESS_CLS[k] || k.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const CHESS_DRAWS = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);
const CHESS_HOW = {
  checkmated: "Matt", resigned: "Aufgabe", timeout: "Zeit", abandoned: "Abbruch", lose: "sonstiges",
  agreed: "Einigung", repetition: "Stellungswiederholung", stalemate: "Patt", insufficient: "zu wenig Material",
  "50move": "50-Züge-Regel", timevsinsufficient: "Zeit, aber zu wenig Material",
  kingofthehill: "Variante", threecheck: "Variante", bughousepartnerlose: "Variante"
};
// Kennzahlen, die als automatisch gefüllte Felder (wie Apple Health) in der Analyse erscheinen
const CHESS_METRICS = {
  games: { text: "Schach: Partien", unit: "", better: "none" },
  time: { text: "Schach: Spielzeit", unit: "", format: "duration", better: "none" },
  score: { text: "Schach: Punktequote", unit: "%", better: "high" },
  acc: { text: "Schach: Genauigkeit", unit: "%", better: "high" }
};

if (!settings.chess) settings.chess = { on: false, user: "", lastDay: "", last: 0, err: "" };
const chessData = () => {
  if (!state.chess || typeof state.chess !== "object") state.chess = { user: "", months: {}, done: {}, stats: null };
  if (!state.chess.months) state.chess.months = {};
  if (!state.chess.done) state.chess.done = {};
  // frühere Fassung speicherte nur Tagessummen: einmal alles neu laden, damit es die einzelnen Partien gibt
  if (Object.values(state.chess.months).some((m) => !Array.isArray(m))) {
    state.chess.months = {}; state.chess.done = {};
    if (settings.chess) settings.chess.lastDay = "";
  }
  return state.chess;
};
const isChessQ = (q) => q.source === "chess";
const chessQuestions = () => ordered().map((o) => o.q).filter((q) => isChessQ(q) && !q.archived);

/* ---------- Abruf ---------- */
let chessJsonpN = 0;
// Ausweg, falls der Browser den direkten Abruf nicht erlaubt: chess.com unterstützt offiziell JSONP
function chessJsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = `mosaikChess${Date.now()}_${++chessJsonpN}`;
    const s = document.createElement("script");
    let timer;
    const done = (err, data) => { clearTimeout(timer); delete window[cb]; s.remove(); err ? reject(err) : resolve(data); };
    timer = setTimeout(() => done(new Error("chess.com antwortet nicht. Bist du online?")), 25000);
    window[cb] = (data) => done(null, data);
    s.onerror = () => done(new Error("chess.com nicht erreichbar oder Benutzername unbekannt"));
    s.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cb;
    document.head.appendChild(s);
  });
}
async function chessGet(url, retry = 1) {
  let res;
  try { res = await fetch(url); } catch (e) { return chessJsonp(url); } // Netz oder CORS
  if (res.status === 404) { const e = new Error("Diesen Benutzernamen gibt es bei chess.com nicht"); e.code = 404; throw e; }
  if (res.status === 429 && retry > 0) { await new Promise((r) => setTimeout(r, 3000)); return chessGet(url, retry - 1); }
  if (!res.ok) throw new Error(`chess.com meldet Fehler ${res.status}`);
  return res.json();
}

/* ---------- Auswertung der Partien ---------- */
// Eröffnung aus der chess.com-Adresse, auf die Familie gekürzt: „Sicilian-Defense-Open-2...Nc6“ → „Sicilian Defense“
function chessOpening(g) {
  let u = g.eco || "";
  if (!u && g.pgn) { const m = g.pgn.match(/\[ECOUrl "([^"]+)"\]/); if (m) u = m[1]; }
  const slug = decodeURIComponent((u.split("/openings/")[1] || "").split("?")[0]);
  if (!slug) return "";
  const parts = slug.split("-");
  const words = [];
  for (const p of parts) {
    if (/\d/.test(p)) break;
    words.push(p);
    if (/^(Defense|Defence|Game|Opening|Attack|Gambit|System)$/i.test(p)) break;
  }
  return (words.length ? words.slice(0, 4) : parts.slice(0, 3)).join(" ").trim();
}
// Dauer einer Live-Partie in Sekunden aus den PGN-Kopfzeilen (StartTime/EndTime, UTC)
function chessDuration(g) {
  if (g.time_class === "daily" || !g.pgn) return 0;
  const t = (k) => { const m = g.pgn.match(new RegExp(`\\[${k} "(\\d+):(\\d+):(\\d+)"\\]`)); return m ? m[1] * 3600 + m[2] * 60 + +m[3] : null; };
  const a = t("StartTime"), b = t("EndTime");
  if (a === null || b === null) return 0;
  let s = b - a;
  if (s < 0) s += 86400;
  return s > 6 * 3600 ? 0 : s; // Unsinn ignorieren
}
// Zahl der Züge aus der PGN (höchste Zugnummer)
function chessMoves(g) {
  if (!g.pgn) return 0;
  const body = g.pgn.slice(g.pgn.lastIndexOf("]") + 1);
  let m, max = 0;
  const re = /(\d+)\.\s/g;
  while ((m = re.exec(body))) max = Math.max(max, +m[1]);
  return max;
}
// Partien eines Monats auf das Nötige kürzen (ohne PGN), eine Zeile je Partie
function chessCompact(games, user) {
  const out = [];
  for (const g of games || []) {
    if (!g || !g.end_time || !g.white || !g.black) continue;
    const meW = String(g.white.username || "").toLowerCase() === user;
    const meB = String(g.black.username || "").toLowerCase() === user;
    if (!meW && !meB) continue;
    const me = meW ? g.white : g.black, op = meW ? g.black : g.white;
    const res = me.result === "win" ? "w" : CHESS_DRAWS.has(me.result) ? "d" : "l";
    const acc = g.accuracies || {};
    const num = (x) => (typeof x === "number" ? Math.round(x * 10) / 10 : null);
    out.push({
      t: g.end_time, dur: chessDuration(g),
      c: !g.rules || g.rules === "chess" ? g.time_class : `${g.rules}-${g.time_class}`,
      tc: g.time_control || "", rated: g.rated !== false,
      col: meW ? "w" : "b", r: typeof me.rating === "number" ? me.rating : null,
      on: op.username || "", or: typeof op.rating === "number" ? op.rating : null,
      res, how: res === "w" ? op.result : me.result,
      a: num(meW ? acc.white : acc.black), oa: num(meW ? acc.black : acc.white),
      m: chessMoves(g), o: chessOpening(g), u: g.url || ""
    });
  }
  return out;
}
// Partien gegen Coaches/Bots (ungewertet, ohne Uhr oder Name wie „Coach-Mae“, „…-BOT“) zählen nicht
const chessIsBot = (g) => !g.rated && (!/^\d/.test(g.tc || "") || /^coach-|(^|-)bot(-|$)/i.test(g.on || ""));
// alle gespeicherten Partien gegen echte Spieler, nach Ende sortiert
function chessGames() {
  const all = [];
  for (const list of Object.values(chessData().months)) if (Array.isArray(list)) all.push(...list.filter((g) => !chessIsBot(g)));
  return all.sort((a, b) => a.t - b.t);
}
const chessDate = (g) => iso(new Date(g.t * 1000));
// je Tag (Ortszeit des Spielendes) zusammenfassen
function chessDays() {
  const out = {};
  for (const g of chessGames()) {
    const d = chessDate(g);
    const x = out[d] || (out[d] = { n: 0, w: 0, l: 0, dr: 0, s: 0, a: 0, an: 0, r: {}, e: {} });
    x.n++;
    if (g.res === "w") x.w++; else if (g.res === "d") x.dr++; else x.l++;
    x.e[`${g.res}:${g.how}`] = (x.e[`${g.res}:${g.how}`] || 0) + 1;
    if (g.c && g.rated && g.r !== null) x.r[g.c] = [g.r, g.t]; // sortiert: am Ende steht die letzte Partie des Tages
    if (g.a !== null) { x.a += g.a; x.an++; }
    x.s += g.dur || 0;
  }
  return out;
}
// Bedenkzeit lesbar: „600+5“ → „10 min + 5 s“, „1/86400“ → „1 Tag je Zug“
function fmtTc(tc) {
  if (!tc) return "–";
  if (!/^\d/.test(tc)) return "ohne Zeitlimit"; // z. B. „-“ bei Partien gegen Coach/Bots ohne Uhr
  if (tc.includes("/")) { const d = Math.round(+tc.split("/")[1] / 86400); return `${d} ${d === 1 ? "Tag" : "Tage"} je Zug`; }
  const [base, inc] = tc.split("+").map(Number);
  const b = base >= 60 ? `${fmtNum(Math.round((base / 60) * 10) / 10)} min` : `${base} s`;
  return inc ? `${b} + ${inc} s` : b;
}
const fmtSec = (s) => (s >= 3600 ? fmtDur(s / 3600) : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`);

/* ---------- Felder anlegen und füllen ---------- */
function ensureChessQuestion(key, created) {
  let q = state.questions.find((x) => x.source === "chess" && x.chessKey === key);
  if (q) return q;
  const m = key.startsWith("elo:") ? { text: `Schach: Elo ${chessClsName(key.slice(4))}`, unit: "", better: "high" } : CHESS_METRICS[key];
  q = { id: uid(), text: m.text, type: "number", options: [], multi: false, min: 1, max: 5, minLabel: "", maxLabel: "", unit: m.unit, format: m.format || null, healthKey: "", source: "chess", chessKey: key, better: m.better, theme: "other", archived: false, cond: null };
  state.questions.push(q);
  created.push(q);
  return q;
}
function applyChessAnswers() {
  const days = chessDays();
  const created = [];
  const used = new Set(["games", "time", "score"]);
  Object.values(days).forEach((x) => { Object.keys(x.r).forEach((c) => used.add("elo:" + c)); if (x.an) used.add("acc"); });
  const qs = {};
  for (const k of used) qs[k] = ensureChessQuestion(k, created);
  // alte Schach-Werte entfernen und neu schreiben (Nachträge von chess.com übernehmen)
  const ids = new Set(state.questions.filter(isChessQ).map((q) => q.id));
  for (const a of Object.values(state.answers)) for (const id of Object.keys(a)) if (ids.has(id)) delete a[id];
  for (const [d, x] of Object.entries(days)) {
    if (!x.n) continue;
    const a = state.answers[d] || (state.answers[d] = {});
    a[qs.games.id] = x.n;
    if (x.s) a[qs.time.id] = Math.round((x.s / 3600) * 1000) / 1000;
    a[qs.score.id] = Math.round(((x.w + x.dr / 2) / x.n) * 1000) / 10;
    if (x.an) a[qs.acc.id] = Math.round((x.a / x.an) * 10) / 10;
    for (const [c, v] of Object.entries(x.r)) a[qs["elo:" + c].id] = v[0];
  }
  for (const d of Object.keys(state.answers)) if (!Object.keys(state.answers[d]).length) delete state.answers[d];
  return created;
}
// Aktuelle Wertungen, Bestwerte und Bilanz aus /stats (nur das Nötige)
function slimChessStats(s) {
  const out = { cls: {}, tactics: null, rush: null, at: Date.now() };
  for (const [k, v] of Object.entries(s || {})) {
    if (!k.startsWith("chess")) continue;
    const cls = k === "chess_daily" ? "daily" : k.startsWith("chess960") ? "chess960-" + k.split("_")[1] : k.replace("chess_", "");
    out.cls[cls] = { last: v.last ? v.last.rating : null, best: v.best ? { r: v.best.rating, d: v.best.date } : null, rec: v.record ? { w: v.record.win, l: v.record.loss, d: v.record.draw } : null };
  }
  if (s && s.tactics && s.tactics.highest) out.tactics = { r: s.tactics.highest.rating, d: s.tactics.highest.date };
  if (s && s.puzzle_rush && s.puzzle_rush.best) out.rush = s.puzzle_rush.best.score;
  return out;
}

let chessBusy = false;
// Beim Einschalten alles laden, danach höchstens einmal am Tag den laufenden (und ggf. letzten) Monat
async function syncChess(manual, progress) {
  const c = settings.chess;
  if (!c.on || !c.user || chessBusy) return;
  if (!manual && c.lastDay === todayIso()) return;
  if (!navigator.onLine && !manual) return;
  chessBusy = true;
  try {
    const user = c.user.trim().toLowerCase();
    const data = chessData();
    if (data.user !== user) {
      // anderer Benutzer: alte Schach-Werte verwerfen
      state.chess = { user, months: {}, done: {}, stats: null };
    }
    const cd = chessData();
    const base = CHESS_API + encodeURIComponent(user);
    const stats = await chessGet(base + "/stats");
    cd.stats = slimChessStats(stats);
    const { archives = [] } = await chessGet(base + "/games/archives");
    // ein Monat gilt als abgeschlossen, wenn er mindestens 3 Tage vorbei ist (chess.com aktualisiert verzögert)
    const closed = addDays(todayIso(), -3).slice(0, 7).replace("-", "/");
    const todo = archives.filter((u) => !cd.done[u.slice(-7)]);
    let i = 0;
    for (const url of todo) {
      const ym = url.slice(-7);
      progress && progress(++i, todo.length);
      const { games } = await chessGet(url);
      cd.months[ym] = chessCompact(games, user);
      if (ym < closed) cd.done[ym] = true;
    }
    const created = applyChessAnswers();
    c.lastDay = todayIso(); c.last = Date.now(); c.err = "";
    saveSettings(); save();
    if (created.length || manual) render();
    if (manual) toast(created.length ? `chess.com verbunden: ${created.length} Felder angelegt` : "chess.com aktualisiert");
  } catch (e) {
    c.err = e.message; saveSettings();
    if (manual) toast(e.message);
    else console.warn(e);
  } finally {
    chessBusy = false;
  }
}

/* ---------- Anzeige ---------- */
// Tag: Schach-Werte (falls an dem Tag gespielt)
function chessDayCard(date) {
  const a = state.answers[date] || {};
  const qs = chessQuestions().filter((q) => isAnswered(a[q.id]));
  if (!qs.length) return "";
  return `<section class="q healthcard">
    <p class="q-title">chess.com</p>
    ${qs.map((q) => `<div class="hrow"><span>${esc(q.text.replace(/^Schach: /, ""))}</span><span class="hval"><strong>${esc(fmtQ(q, a[q.id]))}</strong></span></div>`).join("")}
  </section>`;
}

// Analyse: Überblick im Zeitraum
function chessPanel(days) {
  const all = chessDays();
  const st = chessData().stats;
  const ds = days.filter((d) => all[d] && all[d].n);
  if (!ds.length) {
    return `<section class="panel"><h2 class="atitle">Schach</h2><p class="muted small" style="margin:0">${settings.chess.on ? "Im gewählten Zeitraum keine Partien auf chess.com." : "Einschalten unter Einstellungen → Schnittstelle chess.com."}</p></section>`;
  }
  const from = days[0], to = days[days.length - 1];
  const games = chessGames().filter((g) => { const d = chessDate(g); return d >= from && d <= to; });
  const sum = { n: 0, w: 0, l: 0, dr: 0, s: 0, a: 0, an: 0 }, how = {}, first = {}, last = {};
  for (const d of ds) {
    const x = all[d];
    for (const k of Object.keys(sum)) sum[k] += x[k];
    for (const [e, v] of Object.entries(x.e)) how[e] = (how[e] || 0) + v;
    for (const [c, v] of Object.entries(x.r)) { if (!first[c]) first[c] = v[0]; last[c] = v[0]; }
  }
  // Veränderung gegenüber dem letzten Tageswert vor dem Zeitraum (sonst dem ersten Tag im Zeitraum)
  const before = {};
  for (const d of Object.keys(all).sort()) { if (d >= ds[0]) break; for (const [c, v] of Object.entries(all[d].r)) before[c] = v[0]; }
  const pct = (x) => `${Math.round((x / sum.n) * 100)} %`;
  const score = Math.round(((sum.w + sum.dr / 2) / sum.n) * 1000) / 10;
  const ord = (c) => { const i = Object.keys(CHESS_CLS).indexOf(c); return i < 0 ? 99 : i; };
  const cls = Object.keys(last).sort((a, b) => ord(a) - ord(b));
  const sel = chessSelCls(cls, games);
  const eloRows = cls.filter((c) => c === sel).map((c) => {
    const start = before[c] ?? first[c];
    const diff = last[c] - start;
    const best = st && st.cls[c] && st.cls[c].best;
    return `<div class="crow"><span>${esc(chessClsName(c))}</span><strong>${last[c]}</strong><span class="${diff > 0 ? "up" : diff < 0 ? "down" : "muted"}">${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(diff)}</span><span class="muted small">${best ? `Bestwert ${best.r} (${new Date(best.d * 1000).toLocaleDateString("de-DE", { month: "numeric", year: "numeric" })})` : ""}</span></div>`;
  }).join("");
  // Bedenkzeit, Dauer und Züge im Durchschnitt
  const live = games.filter((g) => g.dur > 0);
  const withMoves = games.filter((g) => g.m > 0);
  const tcs = {};
  games.forEach((g) => (tcs[g.tc] = (tcs[g.tc] || 0) + 1));
  const tcList = Object.entries(tcs).sort((a, b) => b[1] - a[1]);
  const howRows = (r, label) => {
    const xs = Object.entries(how).filter(([k]) => k.startsWith(r + ":")).sort((a, b) => b[1] - a[1]);
    return xs.length ? `<p class="small" style="margin:4px 0 0"><strong>${label}:</strong> ${xs.map(([k, v]) => `${esc(CHESS_HOW[k.split(":")[1]] || k.split(":")[1])} ${v}×`).join(", ")}</p>` : "";
  };
  return `<section class="panel acard chess">
    <h2 class="atitle">Schach</h2>
    <p class="hero"><span class="big">${sum.n}</span><span class="muted">${sum.n === 1 ? "Partie" : "Partien"} an ${ds.length} von ${days.length} Tagen${sum.s ? ` · ${fmtDur(sum.s / 3600)} gespielt` : ""}</span></p>
    <div class="wdl" role="img" aria-label="${sum.w} Siege, ${sum.dr} Remis, ${sum.l} Niederlagen">
      <span class="w" style="flex:${sum.w}"></span><span class="d" style="flex:${sum.dr}"></span><span class="l" style="flex:${sum.l}"></span>
    </div>
    <p class="small" style="margin:6px 0 0">${sum.w} ${sum.w === 1 ? "Sieg" : "Siege"} (${pct(sum.w)}) · ${sum.dr} Remis (${pct(sum.dr)}) · ${sum.l} ${sum.l === 1 ? "Niederlage" : "Niederlagen"} (${pct(sum.l)}) · Punktequote ${fmtNum(score)} %</p>
    ${eloRows ? `<h3 class="csub">Elo ${esc(chessClsName(sel))} am Ende des Zeitraums</h3><div class="ctable">${eloRows}</div>` : ""}
    ${prefs.chessElo !== false && sel ? chessEloChart(days, sel) : ""}
    <h3 class="csub">Im Durchschnitt</h3>
    <div class="cavg">
      ${live.length ? `<div><span class="muted small">Dauer je Partie</span><strong>${fmtSec(live.reduce((s, g) => s + g.dur, 0) / live.length)}</strong></div>` : ""}
      ${withMoves.length ? `<div><span class="muted small">Züge je Partie</span><strong>${Math.round(withMoves.reduce((s, g) => s + g.m, 0) / withMoves.length)}</strong></div>` : ""}
      ${sum.an ? `<div><span class="muted small">Genauigkeit</span><strong>${fmtNum(Math.round((sum.a / sum.an) * 10) / 10)} %</strong><span class="muted small">${sum.an} analysiert</span></div>` : ""}
      ${live.length ? `<div><span class="muted small">Spielzeit je Spieltag</span><strong>${fmtSec(sum.s / ds.length)}</strong></div>` : ""}
    </div>
    ${prefs.chessAcc !== false ? chessAccChart(days) : ""}
    ${tcList.length ? `<p class="small" style="margin:10px 0 0"><strong>Bedenkzeit:</strong> ${tcList.slice(0, 4).map(([tc, n]) => `${esc(fmtTc(tc))} ${n}×`).join(" · ")}</p>` : ""}
    <h3 class="csub">Wie entschieden</h3>
    ${howRows("w", "Siege")}${howRows("d", "Remis")}${howRows("l", "Niederlagen")}
    ${st && (st.tactics || st.rush) ? `<p class="small" style="margin:10px 0 0">${st.tactics ? `Taktik-Bestwert <strong>${st.tactics.r}</strong>` : ""}${st.tactics && st.rush ? " · " : ""}${st.rush ? `Puzzle-Rush-Rekord <strong>${st.rush}</strong>` : ""}</p>` : ""}
    <button type="button" class="btn ghost block" id="chessgames" style="margin-top:14px">Alle ${games.length} ${games.length === 1 ? "Partie" : "Partien"} im Zeitraum</button>
  </section>`;
}

// Verlauf mit mehreren Linien (z. B. Elo je Bedenkzeit), Punkte über Lücken hinweg verbunden
function chessLineChart(series, days, { fmt = (v) => String(Math.round(v)), avg = null, label = "" } = {}) {
  const W = 300, H = 110, P = 8;
  const nums = series.flatMap((s) => s.pts.map((p) => p.v));
  if (!nums.length) return "";
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (hi === lo) { hi += 1; lo -= 1; }
  const idx = new Map(days.map((d, i) => [d, i]));
  const xi = (d) => (days.length === 1 ? W / 2 : P + (idx.get(d) / (days.length - 1)) * (W - 2 * P));
  const yi = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const total = series.reduce((s, x) => s + x.pts.length, 0);
  // eine Linie: gleiche Optik wie die Verläufe der Fragen (z. B. Schritte); mehrere: farbig
  const col = (k) => (series.length === 1 ? "var(--ink)" : `var(--s${(k % 8) + 1})`);
  const lines = series.map((s, k) => {
    const path = s.pts.map((p, i) => `${i ? "L" : "M"}${xi(p.d).toFixed(1)},${yi(p.v).toFixed(1)}`).join("");
    const dots = total <= 40 || s.pts.length === 1 ? s.pts.map((p) => `<circle cx="${xi(p.d).toFixed(1)}" cy="${yi(p.v).toFixed(1)}" r="3" style="fill:${col(k)}"/>`).join("") : "";
    return `<path d="${path}" class="ln" style="stroke:${col(k)}"/>${dots}`;
  }).join("");
  // zum Antippen: je Tag die Werte aller Linien
  const byDay = {};
  series.forEach((s) => s.pts.forEach((p) => { (byDay[p.d] ||= []).push(`${s.name ? s.name + " " : ""}${fmt(p.v)}`); }));
  // Punkt zum Mitziehen wie bei den Fragen-Verläufen (y der ersten Linie)
  const yOf = {};
  series.forEach((s) => s.pts.forEach((p) => { if (yOf[p.d] === undefined) yOf[p.d] = +yi(p.v).toFixed(1); }));
  const tips = Object.entries(byDay).map(([d, t]) => ({ d, x: +xi(d).toFixed(1), y: yOf[d], t: `${shortDate(d)}: ${t.join(" · ")}` }));
  return `<div class="chart">
      <div class="yax small muted"><span>${fmt(hi)}</span><span>${fmt(lo)}</span>${avg !== null ? `<span class="avgtag" style="top:${(yi(avg) / H) * 100}%" title="Durchschnitt">Ø</span>` : ""}</div>
      <div class="plot">
        <svg class="cline" viewBox="0 0 ${W} ${H}" data-tips='${esc(JSON.stringify(tips))}' role="img" aria-label="${esc(label)}">
          ${avg !== null ? `<line x1="0" x2="${W}" y1="${yi(avg)}" y2="${yi(avg)}" class="avg"/>` : ""}
          ${lines}
          <circle class="hover" r="5" style="display:none"/>
        </svg>
      </div>
    </div>
    ${series.length > 1 ? `<p class="legend small">${series.map((s, k) => `<span class="ln-key" style="border-color:var(--s${(k % 8) + 1})"></span>${esc(s.name)}`).join(" ")}</p>` : ""}
    <p class="ccap small muted" aria-live="polite"></p>`;
}
// Elo je Bedenkzeit: Wert nach der letzten gewerteten Partie des Tages
// gewählter Spielmodus für die Elo (über das Zahnrad der Kachel), sonst der meistgespielte im Zeitraum
function chessSelCls(cls, games) {
  if (prefs.chessCls && cls.includes(prefs.chessCls)) return prefs.chessCls;
  const n = {};
  games.forEach((g) => { if (cls.includes(g.c)) n[g.c] = (n[g.c] || 0) + 1; });
  return cls.slice().sort((a, b) => (n[b] || 0) - (n[a] || 0))[0] || null;
}
// Elo-Verlauf des gewählten Spielmodus, Optik wie die Verläufe der Fragen
function chessEloChart(days, c) {
  const all = chessDays();
  const pts = days.filter((d) => all[d] && all[d].r[c]).map((d) => ({ d, v: all[d].r[c][0] }));
  if (!pts.length) return "";
  const a = pts.reduce((s, p) => s + p.v, 0) / pts.length;
  return `<h3 class="csub">Elo im Verlauf</h3>${chessLineChart([{ name: "", pts }], days, { avg: a, label: `Elo ${chessClsName(c)} im Verlauf` })}`;
}
// Zahnrad der Schach-Kachel: Spielmodus für die Elo und welche Verläufe
function openChessView(days) {
  const dlg = $("#sheet");
  const all = chessDays();
  const ord = (c) => { const i = Object.keys(CHESS_CLS).indexOf(c); return i < 0 ? 99 : i; };
  const cls = [...new Set(Object.values(all).flatMap((x) => Object.keys(x.r)))].sort((a, b) => ord(a) - ord(b));
  const from = days[0], to = days[days.length - 1];
  const games = chessGames().filter((g) => { const d = chessDate(g); return d >= from && d <= to; });
  const draw = () => {
    const sel = chessSelCls(cls, games);
    dlg.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><span></span><h2>Schach</h2><button type="button" class="linkbtn" id="cvdone">Fertig</button></div>
      <section class="sq">
        <strong>Elo für</strong>
        <div class="chips" style="margin-top:10px">${cls.map((c) => `<button type="button" class="chip" data-cls="${c}" aria-pressed="${c === sel}">${esc(chessClsName(c))}</button>`).join("")}</div>
        <p class="muted small" style="margin:8px 0 0">Partien, Bilanz und Durchschnitte zählen immer alle Spielmodi.</p>
      </section>
      <section class="sq">
        <label class="switch row" style="margin-top:0"><input type="checkbox" data-cv="chessElo" ${prefs.chessElo !== false ? "checked" : ""}><span>Elo über die Zeit</span></label>
        <label class="switch row"><input type="checkbox" data-cv="chessAcc" ${prefs.chessAcc !== false ? "checked" : ""}><span>Genauigkeit über die Zeit</span></label>
      </section>
    </div>`;
    $("#cvdone", dlg).addEventListener("click", () => dlg.close());
    dlg.querySelectorAll("[data-cls]").forEach((b) => b.addEventListener("click", () => { prefs.chessCls = b.dataset.cls; savePrefs(); draw(); renderAnalysis(); }));
    dlg.querySelectorAll("[data-cv]").forEach((i) => i.addEventListener("change", () => { prefs[i.dataset.cv] = i.checked; savePrefs(); renderAnalysis(); }));
  };
  draw();
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}
// Genauigkeit: Ø der analysierten Partien je Tag
function chessAccChart(days) {
  const all = chessDays();
  const pts = days.filter((d) => all[d] && all[d].an).map((d) => ({ d, v: all[d].a / all[d].an }));
  if (!pts.length) return "";
  const a = pts.reduce((s, p) => s + p.v, 0) / pts.length;
  return `<h3 class="csub">Genauigkeit im Verlauf</h3>${chessLineChart([{ name: "", pts }], days, { fmt: (v) => `${fmtNum(Math.round(v * 10) / 10)} %`, avg: a, label: "Genauigkeit im Verlauf" })}`;
}
function wireChessCharts(root) {
  root.querySelectorAll("svg.cline").forEach((svg) => {
    const tips = JSON.parse(svg.dataset.tips);
    const cap = svg.closest(".chart").parentElement.querySelector(".ccap");
    const mark = svg.querySelector(".hover");
    const pick = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * 300;
      let best = tips[0];
      for (const t of tips) if (Math.abs(t.x - x) < Math.abs(best.x - x)) best = t;
      mark.setAttribute("cx", best.x); mark.setAttribute("cy", best.y); mark.style.display = "";
      // passende Beschriftung direkt unter diesem Diagramm
      let c = svg.closest(".chart").nextElementSibling;
      if (c && !c.classList.contains("ccap")) c = c.nextElementSibling;
      (c && c.classList.contains("ccap") ? c : cap).textContent = best.t;
    };
    svg.addEventListener("pointerdown", pick);
    svg.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "mouse") pick(e); });
  });
}

// Liste aller Partien im Zeitraum, je Partie aufklappbar
const CHESS_PAGE = 100;
function openChessGames(days) {
  const from = days[0], to = days[days.length - 1];
  const all = chessGames();
  // Elo-Veränderung je Partie: gegenüber der vorigen gewerteten Partie derselben Bedenkzeit
  const prev = {}, delta = new Map();
  for (const g of all) {
    if (!g.rated || g.r === null) continue;
    if (prev[g.c] !== undefined) delta.set(g, g.r - prev[g.c]);
    prev[g.c] = g.r;
  }
  const games = all.filter((g) => { const d = chessDate(g); return d >= from && d <= to; }).reverse();
  let shown = CHESS_PAGE;
  const dlg = $("#sheet");
  const resText = { w: "Sieg", d: "Remis", l: "Niederlage" };
  const time = (t) => new Date(t * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const row = (g) => {
    const dl = delta.get(g);
    const how = CHESS_HOW[g.how] || g.how;
    return `<details class="cgame">
      <summary>
        <span class="cres ${g.res}" aria-label="${resText[g.res]}">${g.res === "w" ? "1" : g.res === "d" ? "½" : "0"}</span>
        <span class="cwho"><span class="cname"><strong>${esc(g.on || "Gegner")}</strong>${g.or ? ` <span class="muted">(${g.or})</span>` : ""}</span><span class="muted small">${esc(chessClsName(g.c))} · ${esc(fmtTc(g.tc))} · ${time(g.t)}</span></span>
        <span class="celo">${g.r ?? ""}${dl !== undefined ? `<span class="${dl > 0 ? "up" : dl < 0 ? "down" : "muted"}">${dl > 0 ? "+" : dl < 0 ? "−" : "±"}${Math.abs(dl)}</span>` : ""}</span>
      </summary>
      <dl class="cdet small">
        <dt>Ergebnis</dt><dd>${resText[g.res]}${how ? ` durch ${esc(how)}` : ""}</dd>
        <dt>Bedenkzeit</dt><dd>${esc(fmtTc(g.tc))} (${esc(chessClsName(g.c))}${g.rated ? "" : ", ungewertet"})</dd>
        <dt>Farbe</dt><dd>${g.col === "w" ? "Weiß" : "Schwarz"}</dd>
        <dt>Ende</dt><dd>${new Date(g.t * 1000).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}${g.dur ? ` · Dauer ${fmtSec(g.dur)}` : ""}</dd>
        ${g.m ? `<dt>Züge</dt><dd>${g.m}</dd>` : ""}
        <dt>Deine Elo danach</dt><dd>${g.r ?? "–"}${dl !== undefined ? ` (${dl > 0 ? "+" : dl < 0 ? "−" : "±"}${Math.abs(dl)})` : ""}</dd>
        <dt>Gegner</dt><dd>${esc(g.on || "–")}${g.or ? `, Elo ${g.or}` : ""}</dd>
        ${g.a !== null || g.oa !== null ? `<dt>Genauigkeit</dt><dd>du ${g.a !== null ? fmtNum(g.a) + " %" : "–"} · Gegner ${g.oa !== null ? fmtNum(g.oa) + " %" : "–"}</dd>` : ""}
        ${g.o ? `<dt>Eröffnung</dt><dd>${esc(g.o)}</dd>` : ""}
      </dl>
      ${g.u ? `<a class="small" href="${esc(g.u)}" target="_blank" rel="noopener">Partie auf chess.com ansehen ↗</a>` : ""}
    </details>`;
  };
  const draw = () => {
    let lastDay = "", html = "";
    for (const g of games.slice(0, shown)) {
      const d = chessDate(g);
      if (d !== lastDay) { html += `<h3 class="cday">${parseIso(d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", ...(d.slice(0, 4) !== todayIso().slice(0, 4) ? { year: "numeric" } : {}) })}</h3>`; lastDay = d; }
      html += row(g);
    }
    dlg.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><button type="button" class="linkbtn" id="cgclose">Schließen</button><h2>Partien</h2><span></span></div>
      <p class="muted small" style="margin:0 0 8px">${games.length} ${games.length === 1 ? "Partie" : "Partien"} · ${from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`} · neueste zuerst</p>
      ${html}
      ${games.length > shown ? `<button type="button" class="btn ghost block" id="cgmore" style="margin-top:12px">Weitere ${Math.min(CHESS_PAGE, games.length - shown)} anzeigen</button>` : ""}
    </div>`;
    $("#cgclose", dlg).addEventListener("click", () => dlg.close());
    $("#cgmore", dlg)?.addEventListener("click", () => { const keep = dlg.querySelector(".sheet-inner").scrollTop; shown += CHESS_PAGE; draw(); dlg.querySelector(".sheet-inner").scrollTop = keep; });
  };
  draw();
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

/* ---------- Einstellungen ---------- */
function chessSettingsPanel() {
  const c = settings.chess;
  const cd = chessData();
  const all = chessDays();
  const nGames = Object.values(all).reduce((s, x) => s + x.n, 0);
  const nDays = Object.keys(all).length;
  return `<section class="panel">
      <h2>Schnittstelle chess.com</h2>
      <p class="muted small">Holt deine Partien von chess.com: Elo je Bedenkzeit, Partien, Spielzeit, Punktequote, Genauigkeit und Eröffnungen. Beim Einschalten einmal alles seit deiner Anmeldung, danach einmal am Tag beim Öffnen. Nötig ist nur dein Benutzername, die Daten sind bei chess.com öffentlich.</p>
      <label class="field">Benutzername<input id="chessuser" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(c.user)}" placeholder="z. B. MagnusCarlsen"></label>
      <label class="switch row"><input type="checkbox" id="chesson" ${c.on ? "checked" : ""}><span>Einschalten</span></label>
      <p class="small" id="chessmsg" style="margin:8px 0 0">${c.on && nGames ? `<strong>Verbunden.</strong> ${nGames} Partien an ${nDays} Tagen${c.last ? `, zuletzt aktualisiert ${new Date(c.last).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}.` : c.on && cd.user ? "Noch keine Partien gefunden." : ""}</p>
      ${c.err ? `<p class="small" style="margin:8px 0 0;color:var(--danger)">Letzter Fehler: ${esc(c.err)}</p>` : ""}
      ${c.on ? `<button class="btn ghost block" id="chessnow" style="margin-top:12px">Jetzt aktualisieren</button>` : ""}
      <p class="muted small" style="margin:8px 0 0">Die Werte erscheinen unter „Tag“ (an Tagen mit Partien) und in der Analyse. Ausschalten behält die bisherigen Werte.</p>
    </section>`;
}
function wireChessSettings() {
  const msg = (t) => { const el = $("#chessmsg"); if (el) el.innerHTML = t; };
  const run = async () => {
    const box = $("#chesson"); if (box) box.disabled = true;
    msg("Lade Daten von chess.com …");
    await syncChess(true, (i, n) => msg(`Lade Partien: Monat ${i} von ${n} …`));
    renderData();
  };
  $("#chessuser")?.addEventListener("change", (e) => {
    const u = e.target.value.trim();
    if (u === settings.chess.user) return;
    settings.chess.user = u; settings.chess.lastDay = ""; settings.chess.err = ""; saveSettings();
    if (settings.chess.on && u) run();
  });
  $("#chesson")?.addEventListener("change", (e) => {
    settings.chess.user = $("#chessuser").value.trim();
    if (e.target.checked && !settings.chess.user) { e.target.checked = false; return toast("Bitte zuerst den Benutzernamen eintragen"); }
    settings.chess.on = e.target.checked; settings.chess.lastDay = ""; settings.chess.err = ""; saveSettings();
    if (settings.chess.on) run(); else { toast("chess.com aus"); renderData(); }
  });
  $("#chessnow")?.addEventListener("click", run);
}

// einmalig: Bot-/Coach-Partien aus den gespeicherten Tageswerten nehmen; Elo-Felder, die dadurch leer sind, entfernen
if (state.chess && state.chess.months && Object.keys(state.chess.months).length && !state.chess.noBots) {
  applyChessAnswers();
  const used = new Set(Object.values(state.answers).flatMap((a) => Object.keys(a)));
  state.questions = state.questions.filter((q) => !(q.source === "chess" && String(q.chessKey || "").startsWith("elo:") && !used.has(q.id)));
  state.chess.noBots = true;
  save();
}
