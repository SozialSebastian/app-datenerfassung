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
// Partien eines Monats je Tag (Ortszeit des Spielendes) zusammenfassen
function chessAggregate(games, user) {
  const days = {};
  for (const g of games || []) {
    if (!g || !g.end_time || !g.white || !g.black) continue;
    const meW = String(g.white.username || "").toLowerCase() === user;
    const meB = String(g.black.username || "").toLowerCase() === user;
    if (!meW && !meB) continue;
    const me = meW ? g.white : g.black, op = meW ? g.black : g.white;
    const d = iso(new Date(g.end_time * 1000));
    const x = days[d] || (days[d] = { n: 0, w: 0, l: 0, dr: 0, s: 0, a: 0, an: 0, r: {}, o: {}, e: {} });
    const res = me.result === "win" ? "w" : CHESS_DRAWS.has(me.result) ? "d" : "l";
    x.n++;
    if (res === "w") x.w++; else if (res === "d") x.dr++; else x.l++;
    const how = res === "w" ? op.result : me.result;
    x.e[`${res}:${how}`] = (x.e[`${res}:${how}`] || 0) + 1;
    const cls = !g.rules || g.rules === "chess" ? g.time_class : `${g.rules}-${g.time_class}`;
    if (cls && g.rated !== false && typeof me.rating === "number") {
      const prev = x.r[cls];
      if (!prev || g.end_time >= prev[1]) x.r[cls] = [me.rating, g.end_time]; // Elo nach der letzten Partie des Tages
    }
    const acc = g.accuracies && (meW ? g.accuracies.white : g.accuracies.black);
    if (typeof acc === "number") { x.a += acc; x.an++; }
    x.s += chessDuration(g);
    const o = chessOpening(g);
    if (o) { const p = x.o[o] || (x.o[o] = [0, 0]); p[0]++; p[1] += res === "w" ? 1 : res === "d" ? 0.5 : 0; }
  }
  return days;
}
// Alle Monate zu einem Tag zusammenführen (eine Partie kurz nach Mitternacht kann im Vormonat liegen)
function chessDays() {
  const out = {};
  const months = chessData().months;
  for (const ym of Object.keys(months).sort()) {
    for (const [d, x] of Object.entries(months[ym])) {
      const y = out[d];
      if (!y) { out[d] = JSON.parse(JSON.stringify(x)); continue; }
      for (const k of ["n", "w", "l", "dr", "s", "a", "an"]) y[k] += x[k];
      for (const [c, v] of Object.entries(x.r)) if (!y.r[c] || v[1] >= y.r[c][1]) y.r[c] = v;
      for (const [o, v] of Object.entries(x.o)) { const p = y.o[o] || (y.o[o] = [0, 0]); p[0] += v[0]; p[1] += v[1]; }
      for (const [e, v] of Object.entries(x.e)) y.e[e] = (y.e[e] || 0) + v;
    }
  }
  return out;
}

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
      cd.months[ym] = chessAggregate(games, user);
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
  const sum = { n: 0, w: 0, l: 0, dr: 0, s: 0, a: 0, an: 0 }, op = {}, how = {}, first = {}, last = {};
  for (const d of ds) {
    const x = all[d];
    for (const k of Object.keys(sum)) sum[k] += x[k];
    for (const [o, v] of Object.entries(x.o)) { const p = op[o] || (op[o] = [0, 0]); p[0] += v[0]; p[1] += v[1]; }
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
  const eloRows = cls.map((c) => {
    const start = before[c] ?? first[c];
    const diff = last[c] - start;
    const best = st && st.cls[c] && st.cls[c].best;
    return `<div class="crow"><span>${esc(chessClsName(c))}</span><strong>${last[c]}</strong><span class="${diff > 0 ? "up" : diff < 0 ? "down" : "muted"}">${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(diff)}</span><span class="muted small">${best ? `Bestwert ${best.r} (${new Date(best.d * 1000).toLocaleDateString("de-DE", { month: "numeric", year: "numeric" })})` : ""}</span></div>`;
  }).join("");
  const ops = Object.entries(op).sort((a, b) => b[1][0] - a[1][0]).slice(0, 5);
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
    ${eloRows ? `<h3 class="csub">Elo am Ende des Zeitraums</h3><div class="ctable">${eloRows}</div>` : ""}
    ${sum.an ? `<p class="small" style="margin:10px 0 0">Ø Genauigkeit <strong>${fmtNum(Math.round((sum.a / sum.an) * 10) / 10)} %</strong> <span class="muted">(${sum.an} analysierte Partie${sum.an === 1 ? "" : "n"})</span></p>` : ""}
    ${ops.length ? `<h3 class="csub">Häufigste Eröffnungen</h3><div class="olist">${ops.map(([o, [n, p]]) => `<div class="orow">
      <span class="on">${esc(o)}</span><span class="ov">${n}× · ${Math.round((p / n) * 100)} %</span>
      <span class="ob"><span style="width:${(n / ops[0][1][0]) * 100}%"></span></span>
    </div>`).join("")}</div><p class="muted small" style="margin:4px 0 0">Prozent = Punktequote mit dieser Eröffnung.</p>` : ""}
    <h3 class="csub">Wie entschieden</h3>
    ${howRows("w", "Siege")}${howRows("d", "Remis")}${howRows("l", "Niederlagen")}
    ${st && (st.tactics || st.rush) ? `<p class="small" style="margin:10px 0 0">${st.tactics ? `Taktik-Bestwert <strong>${st.tactics.r}</strong>` : ""}${st.tactics && st.rush ? " · " : ""}${st.rush ? `Puzzle-Rush-Rekord <strong>${st.rush}</strong>` : ""}</p>` : ""}
    <p class="muted small" style="margin:10px 0 0">Daten von chess.com (${esc(chessData().user)}), aktualisiert ${settings.chess.last ? new Date(settings.chess.last).toLocaleDateString("de-DE") : "–"}.</p>
  </section>`;
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
