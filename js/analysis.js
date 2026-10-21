/* Mosaik – Analyse: Zeitraum, Karten, Diagramme, Darstellung */
"use strict";

/* ================= Analyse ================= */
const PREF_KEY = "taeglich.prefs";
let prefs = { range: "30", q: {}, focus: {} };
try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); prefs = { ...prefs, ...p, q: p.q || {}, focus: p.focus || {} }; } catch (e) { /* egal */ }
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* egal */ } };

// Einstellungen pro Frage, mit sinnvollen Vorgaben
const qset = (q) => ({ chart: "bars", unit: q.notion ? "abs" : "pct", trend: q.type !== "choice", hidden: false, hideZero: prefs.hideZero !== false, ...(prefs.q[q.id] || {}) });
// Hat die Karte im Zeitraum nichts zu sagen? (keine Antworten; Ja/Nein bzw. „Kompakt“ 0×; Zahlen nur 0)
function zeroCard(q, days) {
  const vals = days.map((d) => (state.answers[d] || {})[q.id]).filter(isAnswered);
  if (!vals.length) return true;
  const set = qset(q);
  if (q.type === "choice") {
    const yesNo = !q.multi && q.options.length === 2 && q.options.includes("Ja") && q.options.includes("Nein");
    const key = set.chart === "count" ? (q.options.includes(set.countKey) ? set.countKey : q.options[0]) : yesNo ? "Ja" : null;
    return key !== null && !vals.some((v) => (Array.isArray(v) ? v.includes(key) : v === key));
  }
  if (q.type === "number") return vals.every((v) => v === 0);
  return false;
}
const setQ = (qid, patch) => { prefs.q[qid] = { ...(prefs.q[qid] || {}), ...patch }; savePrefs(); };

const RANGES = [["1", "1 Tag"], ["7", "7 Tage"], ["30", "30 Tage"], ["ytd", "Seit 1.1."], ["365", "12 Monate"], ["all", "Alles"], ["custom", "Eigener Zeitraum"]];
const RANGE_MAIN = ["1", "7", "30"]; // direkt sichtbar, der Rest über „Mehr“
const SERIES = 8; // Farben für Kuchendiagramme, weitere Antworten → „Weitere“
const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString("de-DE");
// große Zahlen (z. B. Schritte) ohne Nachkommastelle
const fmtBig = (n) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString("de-DE") : fmt1(n));
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
  else if (range === "custom") {
    const [a, b] = customRange();
    const out = [];
    for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
    return out;
  } else start = addDays(t, -(Number(range) - 1) || 0);
  const out = [];
  for (let d = start; d <= t; d = addDays(d, 1)) out.push(d);
  return out;
}
// Eigener Zeitraum: von–bis, höchstens bis heute
function customRange() {
  const t = todayIso();
  let a = /^\d{4}-\d{2}-\d{2}$/.test(prefs.rfrom || "") ? prefs.rfrom : addDays(t, -13);
  let b = /^\d{4}-\d{2}-\d{2}$/.test(prefs.rto || "") ? prefs.rto : t;
  if (b > t) b = t;
  if (a > b) [a, b] = [b, a];
  return [a, b];
}

function rangeLabel(k) {
  if (k === "custom") { const [a, b] = customRange(); return a === b ? dm(a) : `${dm(a)}–${dm(b)}`; }
  return (RANGES.find(([x]) => x === k) || [, ""])[1];
}
// Zeitraum-Wahl: 1 Tag, 7 Tage, 30 Tage und „Mehr“ (Auswahlliste von iOS) für die übrigen
function rangeControl(cur, attr) {
  const main = RANGE_MAIN.includes(cur);
  return `<div class="seg seg4 rseg" role="group" aria-label="Zeitraum">
      ${RANGE_MAIN.map((k) => `<button type="button" data-${attr}="${k}" aria-pressed="${cur === k}">${rangeLabel(k)}</button>`).join("")}
      <label class="rmore" aria-pressed="${!main}"><span class="${cur === "custom" ? "rsmall" : ""}">${main ? "Mehr" : esc(cur === "custom" ? rangeLabel(cur) : rangeLabel(cur).replace("12 Monate", "12 Mon."))} ▾</span>
        <select data-${attr}-sel aria-label="Weitere Zeiträume">
          <option value="" disabled ${main ? "selected" : ""}>Zeitraum wählen</option>
          ${RANGES.filter(([k]) => !RANGE_MAIN.includes(k)).map(([k, l]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${l}${k === "custom" ? " …" : ""}</option>`).join("")}
        </select>
      </label>
    </div>
    ${cur === "custom" ? `<div class="rcustom">
      <label>von<input type="date" data-${attr}-from value="${customRange()[0]}" max="${todayIso()}"></label>
      <label>bis<input type="date" data-${attr}-to value="${customRange()[1]}" max="${todayIso()}"></label>
    </div>` : ""}`;
}
function wireRange(root, attr, set) {
  root.querySelectorAll(`button[data-${attr}]`).forEach((b) => b.addEventListener("click", () => set(b.getAttribute(`data-${attr}`))));
  root.querySelector(`[data-${attr}-sel]`)?.addEventListener("change", (e) => { if (e.target.value) set(e.target.value); });
  const upd = (k) => (e) => { if (e.target.value) { prefs[k] = e.target.value; savePrefs(); set("custom"); } };
  root.querySelector(`[data-${attr}-from]`)?.addEventListener("change", upd("rfrom"));
  root.querySelector(`[data-${attr}-to]`)?.addEventListener("change", upd("rto"));
}

const GEAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

function analysisQuestions(days) {
  // Schach-Werte stehen gebündelt in der Schach-Kachel, nicht als eigene Karten
  return ordered().map((o) => o.q).filter((q) => q.source !== "chess" && !isIntolQ(q) && (!q.archived || days.some((d) => isAnswered((state.answers[d] || {})[q.id]))));
}

function renderAnalysis() {
  const view = $("#view");
  const days = rangeDays();
  const all = analysisQuestions(days);
  // Filter nach Thema (nur wenn es mehrere Themen gibt)
  const usedThemes = THEMES.filter((t) => all.some((q) => themeOf(q) === t.k));
  if (prefs.theme && !usedThemes.some((t) => t.k === prefs.theme)) prefs.theme = "";
  let qs = all.filter((q) => !qset(q).hidden && (!prefs.theme || themeOf(q) === prefs.theme) && !(qset(q).hideZero && zeroCard(q, days)));
  // Folgefragen stehen in der Kachel ihrer Hauptfrage (wenn die angezeigt wird und zusammengefasst ist)
  const shown = new Set(qs.map((q) => q.id));
  qs = qs.filter((q) => !(q.cond && shown.has(q.cond.qid) && mergedKids(qById(q.cond.qid), days).includes(q)));

  view.innerHTML = `
    <div class="dayhead">
      <h1>Analyse</h1>
      ${all.length ? `<button class="gear" id="asettings" aria-label="Darstellung einstellen">${GEAR}</button>` : ""}
    </div>
    ${rangeControl(prefs.range, "range")}
    <p class="muted small" style="margin:0 0 16px">${days.length === 1 ? shortDate(days[0]) : `${shortDate(days[0])} – ${shortDate(days[days.length - 1])}`}</p>
    ${all.length && prefs.trends !== false ? trendsPanel(days) : ""}
    ${all.length && prefs.goals !== false ? goalsPanel() : ""}
    ${prefs.sport !== false && sportQs().length && !(prefs.hideZero !== false && !days.some((d) => sportDay(d))) ? sportPanel(days) : ""}
    ${prefs.intol !== false ? intolPanel() : ""}
    ${prefs.places !== false && !(prefs.hideZero !== false && !days.some((d) => placeCities(d).length)) && (Object.keys(state.places || {}).length || (settings.places && settings.places.on)) ? placesPanel(days) : ""}
    ${prefs.chess !== false && !(prefs.hideZero !== false && !days.some((d) => (chessDays()[d] || {}).n)) && (settings.chess.on || Object.keys(chessData().months).length) ? chessPanel(days) : ""}
    ${usedThemes.length > 1 ? `<div class="tfilter" role="group" aria-label="Thema">
      <button data-th="" aria-pressed="${!prefs.theme}">Alle</button>
      ${usedThemes.map((t) => `<button data-th="${t.k}" aria-pressed="${prefs.theme === t.k}">${t.i} ${esc(t.l)}</button>`).join("")}
    </div>` : ""}
    ${qs.length ? qs.map((q) => analysisCard(q, days)).join("") : prefs.theme ? `<p class="muted">Keine Fragen in diesem Thema.</p>` : `<p class="muted">${all.length ? "Alle Fragen sind ausgeblendet oder im Zeitraum leer (Zahnrad)." : "Noch keine Fragen angelegt."}</p>`}`;

  $("#asettings")?.addEventListener("click", () => openAnalysisSettings());
  // lange auf eine Karte drücken (oder Rechtsklick): Darstellung dieser Karte anpassen
  view.querySelectorAll(".acard[data-qid]").forEach((card) => onHold(card, () => openAnalysisSettings(card.dataset.qid)));
  view.querySelectorAll(".acard.sport").forEach((card) => onHold(card, openSportView));
  view.querySelectorAll(".acard.chess").forEach((card) => onHold(card, () => openChessView(days)));
  view.querySelectorAll("[data-th]").forEach((b) => b.addEventListener("click", () => { prefs.theme = b.dataset.th; savePrefs(); renderAnalysis(); }));
  $("#tmore")?.addEventListener("click", () => { showAllTrends = !showAllTrends; renderAnalysis(); });
  view.querySelectorAll(".panel.trends").forEach((card) => onHold(card, openTrendSettings));
  $("#pmore")?.addEventListener("click", () => { showAllPlaces = !showAllPlaces; renderAnalysis(); });
  $("#chessgames")?.addEventListener("click", () => openChessGames(days));
  wireRange(view, "range", (k) => { prefs.range = k; savePrefs(); renderAnalysis(); });
  view.querySelectorAll("[data-focus]").forEach((b) => b.addEventListener("click", () => {
    prefs.focus[b.dataset.qid] = b.dataset.focus; savePrefs(); renderAnalysis();
  }));

  wireCurves(view);
  // Antippen einer Säule zeigt den Wert darunter
  view.querySelectorAll(".acard").forEach((card) => {
    const cap = card.querySelector(".acap");
    card.querySelectorAll(".col[data-cap]").forEach((c) => c.addEventListener("click", () => {
      card.querySelectorAll(".col.sel").forEach((x) => x.classList.remove("sel"));
      c.classList.add("sel");
      cap.textContent = c.dataset.cap;
    }));
  });
}

// Verläufe antippen bzw. darüberziehen: Sprechblase mit Datum, Wert und Abstand zum Ø; woanders tippen blendet sie aus
function wireCurves(root) {
  root.querySelectorAll(".lchart").forEach((box) => {
    const svg = box.querySelector("svg.line"), tip = box.querySelector(".ltip");
    if (!svg || !tip || svg._wired) return;
    svg._wired = true;
    const pts = JSON.parse(svg.dataset.pts);
    const mark = svg.querySelector(".hover"), guide = svg.querySelector(".guide");
    const vb = svg.viewBox.baseVal;
    const pick = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * vb.width;
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
      mark.setAttribute("cx", best.x); mark.setAttribute("cy", best.y); mark.style.display = "";
      guide.setAttribute("x1", best.x); guide.setAttribute("x2", best.x); guide.setAttribute("y1", best.y); guide.style.display = "";
      svg.querySelectorAll(".xl").forEach((t) => t.classList.toggle("on", t.dataset.d === best.d));
      tip.querySelector(".lt1").textContent = shortDate(best.d);
      tip.querySelector(".lt2").textContent = best.t;
      const t3 = tip.querySelector(".lt3");
      t3.textContent = best.dv; t3.className = "lt3 " + best.tone;
      tip.hidden = false;
      // Sprechblase über dem Punkt, am Rand eingerückt
      const bw = tip.offsetWidth, cw = box.clientWidth, px = (best.x / vb.width) * cw, py = (best.y / vb.height) * r.height;
      const left = Math.min(Math.max(px - bw / 2, 0), cw - bw);
      tip.style.left = `${left}px`; tip.style.top = `${py - tip.offsetHeight - 12}px`; tip.style.setProperty("--ax", `${px - left}px`);
    };
    svg.addEventListener("pointerdown", pick);
    svg.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "mouse") pick(e); });
    const hide = () => { tip.hidden = true; mark.style.display = "none"; guide.style.display = "none"; svg.querySelectorAll(".xl.on").forEach((t) => t.classList.remove("on")); };
    const out = (e) => { if (!svg.isConnected) return document.removeEventListener("pointerdown", out, true); if (!tip.hidden && !svg.contains(e.target)) hide(); };
    document.addEventListener("pointerdown", out, true);
  });
}

// Häufigkeiten je Antwort (Auswahl) bzw. je Stufe (Skala)
function distribution(q, vals) {
  if (q.type === "scale") {
    return Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map((s) => ({
      key: String(s),
      label: `${s}${scaleLabel(q, s) ? " · " + scaleLabel(q, s) : ""}`,
      c: vals.filter((x) => x.v === s).length
    }));
  }
  const keys = [...q.options];
  // ältere Antworttexte (z. B. nach Umbenennen) trotzdem zählen
  vals.forEach((x) => (Array.isArray(x.v) ? x.v : [x.v]).forEach((v) => { if (!keys.includes(v)) keys.push(v); }));
  const out = keys.map((k) => ({ key: k, label: k, c: vals.filter((x) => (Array.isArray(x.v) ? x.v.includes(k) : x.v === k)).length }));
  // Rezepte: nur Gekochtes, am häufigsten zuerst
  if (q.notion) return out.filter((x) => x.c > 0).sort((a, b) => b.c - a.c || a.label.localeCompare(b.label, "de"));
  return out;
}

// Folgefragen stehen immer in der Kachel der Hauptfrage
function mergedKids(p, days) {
  if (!p) return [];
  const list = analysisQuestions(days);
  return childrenOf(p.id).filter((c) => list.includes(c) && !qset(c).hidden);
}
// Folgefrage, nach der die Säulen eingefärbt werden (Auswahl-Frage; einstellbar)
function stackKid(p, kids) {
  const ch = kids.filter((c) => c.type === "choice");
  return ch.find((c) => c.id === qset(p).stackBy) || ch[0] || null;
}
// Je Tag: Anteile der Antworten der Folgefrage (Mehrfachauswahl wird aufgeteilt), sonst „ohne Angabe“
const stackOf = (c) => (d) => {
  const v = (state.answers[d] || {})[c.id];
  const xs = Array.isArray(v) ? v : isAnswered(v) ? [v] : [];
  return xs.length ? xs.map((k) => [k, 1 / xs.length]) : [["__none", 1]];
};
const stackColor = (c, k) => (k === "__none" ? "var(--line)" : `var(--s${(Math.max(0, c.options.indexOf(k)) % SERIES) + 1})`);
// kurze Zusammenfassung einer Folgefrage in der Kachel der Hauptfrage
function kidLine(c, days, skipStack) {
  const vals = days.map((d) => (state.answers[d] || {})[c.id]).filter(isAnswered);
  if (!vals.length) return "";
  const head = `<span class="kq">↳ ${esc(c.text)}</span>`;
  if (c.type === "choice") {
    const cnt = {};
    vals.forEach((v) => (Array.isArray(v) ? v : [v]).forEach((k) => (cnt[k] = (cnt[k] || 0) + 1)));
    const rows = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    // eingestellt „Kuchen“: Kuchen auch in der gemeinsamen Kachel (gleiche Farben wie die Säulen)
    if (qset(c).chart === "pie") return `<div class="kid">${head}${labeledPie(rows.map(([k, n]) => ({ label: k, c: n, color: stackColor(c, k) })), null, { big: String(rows.reduce((t, [, n]) => t + n, 0)), sub: c.multi ? "Nennungen" : "Antworten" })}</div>`;
    return `<div class="kid">${head}<div class="klegend">${rows.map(([k, n]) => `<span>${skipStack ? `<i style="background:${stackColor(c, k)}"></i>` : ""}${esc(k)} <b>${n}×</b></span>`).join("")}</div></div>`;
  }
  const nums = vals.filter((v) => typeof v === "number");
  if (!nums.length) return "";
  const avg = nums.reduce((s, x) => s + x, 0) / nums.length;
  const f = (v) => (c.format ? fmtQ(c, v) : fmt1(v) + (c.unit ? " " + c.unit : ""));
  // kompakt: Uhrzeit mit Spanne, Dauer und Zahl mit Summe
  const sum = nums.reduce((s, x) => s + x, 0);
  const extra = c.format === "clock" ? (nums.length > 1 ? `<span>${fmtQ(c, Math.min(...nums))}–${fmtQ(c, Math.max(...nums))} Uhr</span>` : "")
    : c.type === "number" ? `<span>Summe ${c.format ? fmtQ(c, sum) : fmt1(sum) + (c.unit ? " " + c.unit : "")}</span>` : "";
  return `<div class="kid">${head}<div class="kstats"><b>Ø ${f(avg)}</b>${extra}</div>${contractBlock(c, days)}</div>`;
}

function analysisCard(q, days) {
  const set = qset(q);
  const kids = mergedKids(q, days);
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
    const yesNo = q.type === "choice" && !q.multi && q.options.length === 2 && q.options.includes("Ja") && q.options.includes("Nein");
    if (yesNo) focusKey = "Ja";

    if (q.type === "scale" && set.chart === "count") {
      body = hero; // Kompakt: nur der Durchschnitt
    } else if (q.type === "scale" && set.chart === "pie") {
      // Ø in der Mitte des Rings statt darüber
      const avgS = vals.reduce((t, x) => t + x.v, 0) / n;
      body = labeledPie(dist.map((x, i) => ({ label: String(x.key) + (scaleLabel(q, +x.key) ? " · " + scaleLabel(q, +x.key) : ""), c: x.c, color: `var(--s${(i % SERIES) + 1})` })), null, { big: `Ø ${fmt1(avgS)}`, sub: `Skala ${q.min}–${q.max}` });
    } else if (yesNo && set.chart !== "pie") {
      // Ja/Nein: Kennzahlen statt Balken
      const c = vals.filter((x) => x.v === "Ja").length;
      const perWeek = c / (days.length / 7);
      const prev = prevCount(days, (d) => { const v = (state.answers[d] || {})[q.id]; return isAnswered(v) ? v === "Ja" : null; });
      body = kpiRow(c, perWeek, pct(c, n), days, prev, betterDir(q));
    } else if (set.chart === "pie") {
      // Kuchen: Anteile an allen Nennungen (bei Mehrfachauswahl ≠ Anteil der Tage)
      let slices = dist.filter((x) => x.c > 0);
      if (slices.length > SERIES) {
        const rest = slices.slice(SERIES - 1);
        slices = slices.slice(0, SERIES - 1).concat([{ key: "__rest", label: "Weitere", c: rest.reduce((s, x) => s + x.c, 0), rest: true }]);
      }
      const total = slices.reduce((s, x) => s + x.c, 0);
      const colorIdx = (k) => dist.findIndex((x) => x.key === k); // Farbe hängt an der Antwort, nicht am Rang
      body = hero + labeledPie(slices.map((x) => ({ label: x.label, c: x.c, color: x.rest ? "var(--ink-2)" : `var(--s${(colorIdx(x.key) % SERIES) + 1})` })), null, { big: String(total), sub: q.multi ? "Nennungen" : "Antworten" });
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
`;
    }

    if (set.trend) {
      const sk = yesNo ? stackKid(q, kids) : null;
      body += q.type === "scale" ? (n >= 2 ? lineChart(q, days, vals, vals.reduce((s, x) => s + x.v, 0) / n) : "")
        : columnChart(q, days, focusKey, yesNo ? "abs" : set.unit, null, sk ? { of: stackOf(sk), color: (k) => stackColor(sk, k), name: (k) => (k === "__none" ? "ohne Angabe" : k), order: (k) => (k === "__none" ? 999 : sk.options.indexOf(k) < 0 ? 998 : sk.options.indexOf(k)) } : null);
    }
  } else {
    const nums = vals.map((x) => x.v);
    const avg = nums.reduce((s, x) => s + x, 0) / n;
    const chart = set.trend && n >= 2;
    const sum = nums.reduce((s, x) => s + x, 0);
    // Veränderung zum gleich langen Zeitraum davor (Ø gegen Ø)
    const pv = []; for (let i = 1; i <= days.length; i++) { const v = (state.answers[addDays(days[0], -i)] || {})[q.id]; if (typeof v === "number") pv.push(v); }
    let chg = "";
    if (pv.length && days.length > 1) {
      const pa = pv.reduce((s, x) => s + x, 0) / pv.length, d = avg - pa, dir = betterDir(q);
      const tone = Math.abs(d) < 1e-9 || !dir ? "" : (d > 0) === (dir === "high") ? "good" : "bad";
      const txt = q.format ? (() => { const m = Math.round(Math.abs(d) * 60); return `${m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`} ${q.format === "clock" ? (d > 0 ? "später" : "früher") : d > 0 ? "mehr" : "weniger"}`; })()
        : pa ? `${Math.round(Math.abs(d / pa) * 100)} %` : fmtBig(Math.abs(d));
      chg = `<span class="chgw"><span class="chg ${tone}">${Math.abs(d) < 1e-9 ? "±0" : `${d > 0 ? "▲" : "▼"} ${txt}`}</span> ggü. ${days.length} Tagen davor</span>`;
    }
    if (q.format) {
      // Dauer bzw. Uhrzeit: Durchschnitt und Streuung (Standardabweichung) in Minuten; früheste/späteste stehen in der Grafik
      const sdMin = n > 1 ? Math.round(Math.sqrt(nums.reduce((s, x) => s + (x - avg) ** 2, 0) / (n - 1)) * 60) : 0;
      const lo = q.format === "clock" ? "früheste" : "kürzeste", hi = q.format === "clock" ? "späteste" : "längste";
      body = `
      <p class="hero"><span class="big">Ø ${fmtQ(q, avg)}</span>${q.format === "clock" ? `<span class="muted">Uhr</span>` : ""}</p>
      <p class="stats small">${chg}${chart ? "" : `<span>${lo} ${fmtQ(q, Math.min(...nums))}</span><span>${hi} ${fmtQ(q, Math.max(...nums))}</span>`}${n > 1 ? `<span>Streuung ± ${sdMin} min</span>` : ""}${q.format === "duration" && !NIGHT_KEYS.includes(q.healthKey) ? `<span>Summe ${fmtQ(q, sum)}</span>` : ""}</p>
      ${chart ? lineChart(q, days, vals, avg) : ""}`;
    } else body = `
      <p class="hero"><span class="big">Ø ${fmtBig(avg)}</span><span class="muted">${q.unit ? esc(q.unit) : ""}</span></p>
      <p class="stats small">${chg}${chart ? "" : `<span>Min ${fmtBig(Math.min(...nums))}</span><span>Max ${fmtBig(Math.max(...nums))}</span>`}<span>Summe ${fmtBig(sum)}</span></p>
      ${chart ? lineChart(q, days, vals, avg) : ""}`;
  }

  const sk0 = kids.length && set.trend ? stackKid(q, kids) : null;
  const kidsHtml = kids.map((c) => kidLine(c, days, c === sk0)).join("");
  return `<section class="panel acard ${kids.length ? "merged" : ""}" data-qid="${q.id}">
    ${title}
    ${body}
    ${contractBlock(q, days)}
    ${kidsHtml ? `<div class="kids">${kidsHtml}</div>` : ""}
    <p class="acap small" aria-live="polite"></p>
  </section>`;
}

// Vertrag bei der Stunden-Frage: vertragliche gegen tatsächliche Stunden, effektiver Stundenlohn
function contractBlock(q, days) {
  const p = q.cond ? qById(q.cond.qid) : null;
  if (!p || !p.contract || !(p.contract.h > 0 && p.contract.wage > 0) || hoursChildOf(p) !== q) return "";
  // Zeitraum erst ab der ersten Antwort zur Arbeitsfrage zählen
  const firstAns = Object.keys(state.answers).sort().find((d) => isAnswered(state.answers[d][p.id]));
  if (!firstAns) return "";
  const t = todayIso();
  const ds = days.filter((d) => d >= firstAns && d <= t);
  if (!ds.length) return "";
  const actual = ds.reduce((s, d) => s + (asHours(q, (state.answers[d] || {})[q.id]) || 0), 0);
  const perDay = p.contract.per === "month" ? p.contract.h / (365.25 / 12) : p.contract.h / 7;
  const contracted = perDay * ds.length;
  const pay = contracted * p.contract.wage;
  const eff = actual > 0 ? pay / actual : null;
  const diff = actual - contracted;
  const euro = (x) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const tone = eff === null ? "" : eff >= p.contract.wage ? "good" : "bad";
  return `<div class="contract">
    <div class="cgrid">
      <div><span class="muted small">Effektiver Stundenlohn</span><strong class="${tone}">${eff === null ? "–" : euro(eff)}</strong><span class="muted small">vertraglich ${euro(p.contract.wage)}</span></div>
      <div><span class="muted small">Gearbeitet</span><strong>${fmtDur(actual)}</strong><span class="muted small">vertraglich ${fmtDur(contracted)}</span></div>
    </div>
    <p class="small" style="margin:8px 0 0">${Math.abs(diff) < 1 / 60 ? "Genau im Soll." : diff > 0 ? `<strong>${fmtDur(diff)} mehr</strong> als vereinbart` : `<strong>${fmtDur(-diff)} weniger</strong> als vereinbart`} · Lohn im Zeitraum ${euro(pay)}</p>
    <p class="muted small" style="margin:6px 0 0">Vertrag: ${fmtNum(p.contract.h)} h ${p.contract.per === "month" ? "pro Monat" : "pro Woche"}, anteilig für ${ds.length} Tag${ds.length === 1 ? "" : "e"} ab ${shortDate(ds[0])}</p>
  </div>`;
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

// Sport-Kachel: Sporttage im Zeitraum (alle Fragen mit Haken „Ist eine Sportart“)

// Gedrückthalten (oder Rechtsklick) auf ein Element löst fn aus; ein normaler Tipp bleibt ein Tipp
function onHold(card, fn) {
  let timer = null, fired = false;
  const stop = () => { clearTimeout(timer); timer = null; };
  card.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    fired = false;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev) => { if (Math.abs(ev.clientX - x0) > 8 || Math.abs(ev.clientY - y0) > 8) stop(); };
    const end = () => { stop(); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
    timer = setTimeout(() => { timer = null; fired = true; if (navigator.vibrate) navigator.vibrate(15); fn(); }, 550);
  });
  card.addEventListener("click", (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
  card.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!fired) fn(); });
}

// Gleich langer Zeitraum direkt davor: Anzahl Treffer (null, wenn dort nichts beantwortet ist)
function prevCount(days, hitOf) {
  let n = 0, any = false;
  for (let i = 1; i <= days.length; i++) { const h = hitOf(addDays(days[0], -i)); if (h !== null) { any = true; if (h) n++; } }
  return any ? n : null;
}
// Kennzahlen für Ja/Nein und Sport: Tage, Ø pro Woche, Anteil, Veränderung zum Zeitraum davor
function kpiRow(c, perWeek, share, days, prev, good) {
  const d = prev === null || days.length < 2 ? null : c - prev; // bei „1 Tag“ keine Veränderung
  const tone = d === null || d === 0 || !good ? "" : (d > 0) === (good === "high") ? "good" : "bad";
  const span = `${days.length} Tagen davor`;
  return `<div class="kpi kpi4">
      <div><strong>${c}</strong><span>${c === 1 ? "Tag" : "Tage"}</span></div>
      ${days.length >= 7 ? `<div><strong>${fmt1(perWeek)}</strong><span>Ø pro Woche</span></div>` : ""}
      <div><strong>${share} %</strong><span>der Tage</span></div>
      ${d === null ? "" : `<div><strong class="${tone}">${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)}</strong><span>ggü. ${span}</span></div>`}
    </div>`;
}

// Einstellungen der Sport-Kachel (Gedrückthalten)
function openSportView() {
  const dlg = $("#sheet");
  const row = (k, l) => `<label class="switch row"><input type="checkbox" data-sv="${k}" ${prefs[k] !== false ? "checked" : ""}><span>${l}</span></label>`;
  dlg.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><span></span><h2>Sport</h2><button type="button" class="linkbtn" id="svdone">Fertig</button></div>
    <section class="sq">${row("sportKpi", "Kennzahlen (Sporttage, Ø pro Woche, Anteil)").replace('class="switch row"', 'class="switch row" style="margin-top:0"')}${row("sportBars", "Sportarten")}${row("sportChart", "Verlauf")}</section>
    <section class="sq">${row("sport", "Kachel anzeigen").replace('class="switch row"', 'class="switch row" style="margin-top:0"')}
      <p class="muted small" style="margin:6px 0 0">Wieder einblenden über das Zahnrad oben in der Analyse.</p></section>
  </div>`;
  $("#svdone", dlg).addEventListener("click", () => dlg.close());
  dlg.querySelectorAll("[data-sv]").forEach((i) => i.addEventListener("change", () => { prefs[i.dataset.sv] = i.checked; savePrefs(); renderAnalysis(); }));
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

function sportPanel(days) {
  const qs = sportQs();
  let n = 0, ans = 0;
  const per = Object.fromEntries(qs.map((q) => [q.id, 0]));
  for (const d of days) {
    const h = sportDay(d);
    if (h === null) continue;
    ans++; if (h) n++;
    qs.forEach((q) => { if ((state.answers[d] || {})[q.id] === "Ja") per[q.id]++; });
  }
  const rows = qs.map((q) => [q, per[q.id]]).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, c]) => c));
  return `<section class="panel acard sport">
    <h2 class="atitle">🏃 Sport</h2>
    ${ans ? `${prefs.sportKpi === false ? "" : kpiRow(n, n / (days.length / 7), pct(n, ans), days, prevCount(days, sportDay), "high")}
      ${rows.length && prefs.sportBars !== false ? `<div class="bars">${rows.map(([q, c]) => `<div class="barrow static"><span class="bl">${esc(shortQ(q).replace(/^./, (c) => c.toUpperCase()))}</span><span class="bt"><span style="width:${(c / max) * 100}%"></span></span><span class="bv">${c}×</span></div>`).join("")}</div>` : ""}
      ${days.length > 1 && prefs.sportChart !== false ? columnChart({ id: "__sport" }, days, "Sport", "abs", sportDay) : ""}`
    : `<p class="muted small" style="margin:0">Im gewählten Zeitraum noch keine Antworten zu deinen Sportarten.</p>`}
  </section>`;
}

// Kuchen mit Beschriftung direkt am Stück (Name fett, darunter der Anteil), für alle Fragentypen
function labeledPie(items, unit, center = null) {
  const sl = items.filter((x) => x.c > 0);
  const total = sl.reduce((s, x) => s + x.c, 0);
  if (!total) return "";
  const W = 360, R = 60, w = 22, cx = W / 2, LH = 36; // LH: Mindestabstand zweizeiliger Beschriftungen
  // Höhe nach Anzahl der Beschriftungen je Seite
  const H = Math.max(210, Math.ceil(sl.length / 2) * LH + 50), cy = H / 2;
  let a0 = -Math.PI / 2;
  const pt = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const arcs = [], labs = [];
  for (const s of sl) {
    const a1 = a0 + (s.c / total) * 2 * Math.PI;
    const gap = sl.length > 1 ? 0.03 : 0;
    const [x0, y0] = pt(R, a0 + gap), [x1, y1] = pt(R, Math.max(a0 + gap, a1 - gap));
    const big = a1 - a0 > Math.PI ? 1 : 0;
    arcs.push(sl.length === 1 ? `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${s.color}" stroke-width="${w}"/>`
      : `<path d="M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${big} 1 ${x1.toFixed(1)},${y1.toFixed(1)}" fill="none" stroke="${s.color}" stroke-width="${w}"/>`);
    const am = (a0 + a1) / 2;
    const [ex, ey] = pt(R + w / 2 + 3, am), [kx, ky] = pt(R + w / 2 + 14, am);
    labs.push({ s, right: Math.cos(am) >= 0, ex, ey, kx, ky });
    a0 = a1;
  }
  // je Seite von oben nach unten sortieren und auseinanderschieben, damit nichts überlappt
  for (const side of [true, false]) {
    const xs = labs.filter((l) => l.right === side).sort((a, b) => a.ky - b.ky);
    xs.forEach((l, i) => { if (i && l.ky - xs[i - 1].ky < LH) l.ky = xs[i - 1].ky + LH; });
    const over = xs.length ? xs[xs.length - 1].ky - (H - 22) : 0;
    if (over > 0) xs.forEach((l) => (l.ky -= over));
    const under = xs.length ? 18 - xs[0].ky : 0;
    if (under > 0) xs.forEach((l) => (l.ky += under));
  }
  const short = (t) => (t.length > 15 ? t.slice(0, 14) + "…" : t);
  // Linie in der Farbe des Stücks vom Ring zur Beschriftung, Punkt an der Beschriftung; darunter „50 % (2×)“
  const txt = labs.map(({ s, right, ex, ey, kx, ky }) => {
    const tx = right ? cx + R + w / 2 + 30 : cx - R - w / 2 - 30;
    const dx = tx + (right ? -7 : 7);
    const anchor = right ? "start" : "end";
    return `<polyline points="${ex.toFixed(1)},${ey.toFixed(1)} ${kx.toFixed(1)},${ky.toFixed(1)} ${dx.toFixed(1)},${ky.toFixed(1)}" class="pl" style="stroke:${s.color}"/>
      <circle cx="${dx.toFixed(1)}" cy="${ky.toFixed(1)}" r="2.6" style="fill:${s.color}"/>
      <text x="${tx.toFixed(1)}" y="${(ky - 3).toFixed(1)}" text-anchor="${anchor}" class="pk">${esc(short(s.label))}<title>${esc(s.label)}</title></text>
      <text x="${tx.toFixed(1)}" y="${(ky + 13).toFixed(1)}" text-anchor="${anchor}" class="pv"><tspan class="pp" style="fill:${s.color}">${Math.round((s.c / total) * 100)} %</tspan> (${s.c}×)</text>`;
  }).join("");
  // in der Mitte: Ø (Skala) bzw. Gesamtzahl
  const mid = center ? `<text x="${cx}" y="${cy + (center.sub ? 4 : 9)}" text-anchor="middle" class="pc">${esc(center.big)}</text>${center.sub ? `<text x="${cx}" y="${cy + 21}" text-anchor="middle" class="ps">${esc(center.sub)}</text>` : ""}` : "";
  return `<svg class="spie" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kuchendiagramm">${arcs.join("")}${txt}${mid}</svg>`;
}

// Säulen über die Zeit: wie oft die gewählte Antwort vorkam (pro Tag, Woche oder Monat)
// hitOf(d): optional eigene Zählung je Tag (null = nicht beantwortet, true/false = Treffer)
function columnChart(q, days, focusKey, unit, hitOf, stack) {
  const span = days.length;
  const mode = span <= 14 ? "day" : span <= 92 ? "week" : "month";
  const buckets = [];
  const keyOf = (d) => (mode === "day" ? d : mode === "week" ? mondayOf(d) : d.slice(0, 7));
  for (const d of days) {
    const k = keyOf(d);
    let b = buckets[buckets.length - 1];
    if (!b || b.k !== k) { b = { k, first: d, n: 0, hit: 0 }; buckets.push(b); }
    if (hitOf) { const h = hitOf(d); if (h !== null) { b.n++; if (h) b.hit++; } continue; }
    const v = (state.answers[d] || {})[q.id];
    if (isAnswered(v)) {
      b.n++;
      if (Array.isArray(v) ? v.includes(focusKey) : v === focusKey) {
        b.hit++;
        if (stack) { b.seg = b.seg || {}; for (const [k, w] of stack.of(d)) b.seg[k] = (b.seg[k] || 0) + w; }
      }
    }
  }
  const val = (b) => (unit === "pct" ? (b.n ? (b.hit / b.n) * 100 : 0) : b.hit);
  const fmtV = (b) => (unit === "pct" ? `${Math.round(val(b))} %` : String(b.hit));
  const vs = buckets.map(val);
  const max = Math.max(unit === "pct" ? 1 : 1, ...vs);
  // Ø: bei Anzahlen auf volle Wochen/Monate gerechnet (angefangene Abschnitte am Rand verzerren sonst), bei % Mittel der Abschnitte
  const avg = unit === "pct" ? vs.reduce((s, x) => s + x, 0) / (vs.length || 1)
    : buckets.reduce((s, b) => s + b.hit, 0) / (span / (mode === "week" ? 7 : mode === "month" ? 365.25 / 12 : 1));
  const H = 96;
  const many = buckets.length > 16 || mode === "day" && unit !== "pct"; // Tageswerte 0/1 brauchen keine Zahl
  const every = Math.ceil(buckets.length / (many ? 8 : 16));
  const lab = (b) => {
    const d = parseIso(b.first);
    return mode === "day" ? WD_SHORT[d.getDay()] : mode === "week" ? `${parseIso(b.k).getDate()}.${parseIso(b.k).getMonth() + 1}.` : buckets.length > 13 ? `${MON_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : MON_SHORT[d.getMonth()];
  };
  const name = mode === "day" ? "" : mode === "week" ? "Woche ab " : "";
  const capName = (b) => (mode === "month" ? `${MON_SHORT[parseIso(b.first).getMonth()]} ${parseIso(b.first).getFullYear()}` : `${name}${lab(b)}`);
  return `<div class="vcols" style="--n:${buckets.length}">
      <div class="vbars" style="height:${H + (many ? 4 : 20)}px">
        ${buckets.map((b, i) => {
          const segs = stack && b.seg ? Object.entries(b.seg).sort((x, y) => stack.order(x[0]) - stack.order(y[0])) : null; // feste Reihenfolge wie die Antworten
          const segTxt = segs ? ` – ${segs.map(([k, w]) => `${stack.name(k)} ${fmt1(w)}`).join(", ")}` : "";
          const h = Math.max(val(b) > 0 ? 3 : 0, (val(b) / max) * H);
          const inner = segs ? segs.map(([k, w]) => `<span style="flex:${w};background:${stack.color(k)}"></span>`).join("") : "";
          return `<button type="button" class="col vb ${i === buckets.length - 1 ? "cur" : ""}" data-cap="${esc(`${capName(b)}: ${unit === "pct" ? Math.round(val(b)) + " %" : b.hit + "×"} „${focusKey}“${segTxt} (${b.n} Tag${b.n === 1 ? "" : "e"} beantwortet)`)}">
          ${many ? "" : `<em>${unit === "pct" && buckets.length > 8 ? Math.round(val(b)) : fmtV(b)}</em>`}<span class="cbar ${segs ? "stack" : ""}" style="height:${h}px">${inner}</span>
        </button>`;
        }).join("")}
        ${avg > 0 && mode !== "day" ? `<div class="vavg" style="bottom:${(avg / max) * H}px" title="Durchschnitt ${unit === "pct" ? Math.round(avg) + " %" : fmt1(avg) + "× pro " + (mode === "week" ? "Woche" : "Monat")}"><b>Ø ${unit === "pct" ? Math.round(avg) + " %" : fmt1(avg)}</b></div>` : ""}
      </div>
      <div class="vlabs">${buckets.map((b, i) => `<span>${i % every === 0 || i === buckets.length - 1 && !many ? lab(b) : ""}</span>`).join("")}</div>
    </div>`;
}

// Abstand zum Durchschnitt als Text, z. B. „+2.611 über Ø“, „23 min früher als Ø“
const devMin = (h) => { const m = Math.round(Math.abs(h) * 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };
function devText(q, d) {
  if (Math.abs(d) < 1e-9) return "genau Ø";
  const t = q.format ? devMin(d) : fmtBig(Math.abs(d)) + (q.unit ? " " + q.unit : "");
  return `${d > 0 ? "+" : "−"}${t} ${q.format === "clock" ? (d > 0 ? "später als Ø" : "früher als Ø") : d > 0 ? "über Ø" : "unter Ø"}`;
}
// Verlauf einer Frage
function lineChart(q, days, vals, avg) {
  return curveChart(vals, days, {
    avg, dir: betterDir(q), id: q.id, label: `Verlauf von ${q.text}`,
    range: q.type === "scale" ? [q.min, q.max] : null,
    fmt: (v) => (q.format ? fmtQ(q, v) : fmtBig(v)),
    tipFmt: (v) => (q.format ? fmtQ(q, v) : fmtBig(v) + (q.unit ? " " + q.unit : "")),
    dev: (d) => devText(q, d)
  });
}
// Verlauf über die Zeit: monotone Kurve, Fläche zum Durchschnitt (darüber/darunter eingefärbt), Höchst- und Tiefstwert am Punkt,
// Antippen zeigt eine Sprechblase (wireCurves). pts: [{ d, v }]
// connect: Lücken überbrücken (z. B. Elo bleibt an Tagen ohne Partie gleich)
function curveChart(pts0, days, { avg, dir = null, id = "", label = "", range = null, fmt = fmtBig, tipFmt = null, dev = null, connect = false }) {
  if (!pts0.length) return "";
  const W = 340, H = 172, PL = 12, PR = 12, PT = 24, PB = 34;
  const nums = pts0.map((x) => x.v);
  const mn = Math.min(...nums), mx = Math.max(...nums);
  let lo = mn, hi = mx;
  if (range) [lo, hi] = range;
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const xi = (d) => (days.length === 1 ? W / 2 : PL + (days.indexOf(d) / (days.length - 1)) * (W - PL - PR));
  const yi = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const r1 = (n) => Math.round(n * 10) / 10;
  const pts = pts0.map((x) => ({ d: x.d, v: x.v, x: r1(xi(x.d)), y: r1(yi(x.v)) }));
  // Abschnitte ohne Lücke (fehlende Tage unterbrechen die Kurve)
  const segs = [];
  pts.forEach((p, i) => { if (!i || (!connect && days.indexOf(p.d) - days.indexOf(pts[i - 1].d) > 1)) segs.push([]); segs[segs.length - 1].push(p); });
  // monotone Kurve (Fritsch–Carlson): geht genau durch jeden Punkt und schießt nie über Höchst-/Tiefstwerte hinaus
  const curve = (s) => {
    const n = s.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = s[i + 1].x - s[i].x; m[i] = (s[i + 1].y - s[i].y) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${s[0].x},${s[0].y}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ` C${r1(s[i].x + h)},${r1(s[i].y + t[i] * h)} ${r1(s[i + 1].x - h)},${r1(s[i + 1].y - t[i + 1] * h)} ${s[i + 1].x},${s[i + 1].y}`;
    }
    return d;
  };
  const ya = r1(yi(avg));
  const lines = segs.filter((s) => s.length > 1).map(curve);
  const areas = segs.filter((s) => s.length > 1).map((s) => `${curve(s)} L${s[s.length - 1].x},${ya} L${s[0].x},${ya} Z`);
  // Farben: „Was ist besser?“ → darüber grün/darunter orange (bzw. umgekehrt), neutral in der App-Farbe
  const [cUp, cDn] = dir === "high" ? ["var(--s3)", "var(--s2)"] : dir === "low" ? ["var(--s2)", "var(--s3)"] : ["var(--hold)", "var(--hold)"];
  const gid = "lc" + String(id).replace(/[^\w]/g, "") + Math.random().toString(36).slice(2, 6);
  const f = fmt, tf = tipFmt || fmt;
  // für die Sprechblase: Datum, Wert, Abstand zum Ø und ob das gut ist
  const tips = pts.map((p) => { const d = p.v - avg; return { d: p.d, x: p.x, y: p.y, t: tf(p.v), dv: dev ? dev(d) : "", tone: !dir || Math.abs(d) < 1e-9 ? "" : (d > 0) === (dir === "high") ? "good" : "bad" }; });
  const pMax = pts.find((p) => p.v === mx), pMin = pts.find((p) => p.v === mn);
  // Ø-Pille rechts, außer dort liegt ein Punkt oder eine Beschriftung auf Höhe der Ø-Linie → dann links
  const near = (side) => pts.some((p) => (side ? p.x > W - PR - 75 : p.x < PL + 75) && Math.abs(p.y - ya) < 26);
  const lastX = pts[pts.length - 1].x, firstX = pts[0].x;
  const pillLeft = (near(true) || (lastX > W - PR - 75 && pts.length > 1 && lastX - firstX < 120)) && !near(false);
  // Beschriftung direkt über bzw. unter dem Punkt; am Rand bündig, damit sie nicht abgeschnitten wird
  const tag = (p, up) => {
    const anchor = p.x < PL + 26 ? "start" : p.x > W - PR - 26 ? "end" : "middle";
    const x = anchor === "start" ? p.x - 5 : anchor === "end" ? p.x + 5 : p.x;
    return `<text x="${x}" y="${up ? p.y - 8 : p.y + 15}" text-anchor="${anchor}" class="mm">${up ? "▲" : "▼"} ${esc(f(p.v))}</text>`;
  };
  // Beschriftung unten: Wochentage (bis 14 Tage) bzw. einige Daten
  const step = days.length <= 14 ? 1 : Math.ceil(days.length / 5);
  const xl = days.map((d, i) => (i % step === 0 || i === days.length - 1) && (days.length <= 14 || i === days.length - 1 || days.length - 1 - i >= step * 0.6)
    ? `<text x="${r1(xi(d))}" y="${H - 7}" text-anchor="${days.length > 14 && i === 0 ? "start" : days.length > 14 && i === days.length - 1 ? "end" : "middle"}" class="xl" data-d="${d}">${days.length <= 14 ? WD_SHORT[parseIso(d).getDay()] : `${parseIso(d).getDate()}.${parseIso(d).getMonth() + 1}.`}</text>` : "").join("");
  return `<div class="lchart">
    <svg class="line" viewBox="0 0 ${W} ${H}" data-pts='${esc(JSON.stringify(tips))}' role="img" aria-label="${esc(label)}">
      <defs>
        <linearGradient id="${gid}u" x1="0" y1="${PT}" x2="0" y2="${ya}" gradientUnits="userSpaceOnUse"><stop offset="0" style="stop-color:${cUp};stop-opacity:.45"/><stop offset="1" style="stop-color:${cUp};stop-opacity:.05"/></linearGradient>
        <linearGradient id="${gid}d" x1="0" y1="${ya}" x2="0" y2="${H - PB}" gradientUnits="userSpaceOnUse"><stop offset="0" style="stop-color:${cDn};stop-opacity:.05"/><stop offset="1" style="stop-color:${cDn};stop-opacity:.4"/></linearGradient>
        <clipPath id="${gid}cu"><rect x="0" y="0" width="${W}" height="${ya}"/></clipPath>
        <clipPath id="${gid}cd"><rect x="0" y="${ya}" width="${W}" height="${H - ya}"/></clipPath>
      </defs>
      ${areas.map((a) => `<path d="${a}" fill="url(#${gid}u)" clip-path="url(#${gid}cu)"/><path d="${a}" fill="url(#${gid}d)" clip-path="url(#${gid}cd)"/>`).join("")}
      <line x1="${PL}" x2="${W - PR}" y1="${ya}" y2="${ya}" class="avg"/>
      ${lines.map((l) => `<path d="${l}" class="ln"/>`).join("")}
      ${pts.length <= 45 ? pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${pts.length > 20 ? 2 : 3}" class="dot"/>`).join("") : ""}
      ${pMax ? tag(pMax, true) : ""}${pMin && pMin !== pMax ? tag(pMin, false) : ""}
      <g class="avgpill" transform="translate(${pillLeft ? PL : W - PR - 60},${r1(ya - 9)})"><rect width="60" height="18" rx="9"/><text x="30" y="12.5" text-anchor="middle">Ø ${esc(f(avg))}</text></g>
      <line class="guide" x1="0" x2="0" y1="${PT - 6}" y2="${H - PB}" style="display:none"/>
      <circle class="hover" r="6" style="display:none"/>
      ${xl}
    </svg>
    <div class="ltip" hidden><span class="lt1"></span><strong class="lt2"></strong><span class="lt3"></span></div>
  </div>`;
}

// Zahnrad: Darstellung pro Frage einstellen
// onlyQid: nur die Darstellung dieser einen Frage (lange auf eine Karte drücken)
function openAnalysisSettings(onlyQid) {
  const dlg = $("#sheet");
  // gedrückte Kachel: die Frage und ihre Folgefragen
  const qs = analysisQuestions(rangeDays()).filter((q) => !onlyQid || q.id === onlyQid || (q.cond && q.cond.qid === onlyQid));
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
      ${onlyQid ? "" : `
      <section class="sq">
        <label class="switch row" style="margin-top:0"><input type="checkbox" data-f="hideZero" ${prefs.hideZero !== false ? "checked" : ""}><span><strong>Leere Kacheln ausblenden</strong></span></label>
        <p class="muted small" style="margin:6px 0 0">Kacheln ohne Aussage im Zeitraum (keine Antworten, 0× „Ja“, nur Nullen, kein Sport, keine Partien, keine Orte) erscheinen erst, wenn dort etwas steht. Einzelne Fragen lassen sich unten abweichend einstellen.</p>
      </section>
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
      ${intolQ("intol-food") ? `<section class="sq">
        <div class="sq-head"><strong>Unverträglichkeiten</strong>
          <label class="switch"><input type="checkbox" data-f="intol" ${prefs.intol !== false ? "checked" : ""}><span>Anzeigen</span></label>
        </div>
        <p class="muted small" style="margin:6px 0 0">Ob nach bestimmten Lebensmitteln auffällig oft Bauchprobleme kamen (alle Daten).</p>
      </section>` : ""}
      ${sportQs().length ? `<section class="sq">
        <div class="sq-head"><strong>Sport</strong>
          <label class="switch"><input type="checkbox" data-f="sport" ${prefs.sport !== false ? "checked" : ""}><span>Anzeigen</span></label>
        </div>
        <p class="muted small" style="margin:6px 0 0">Wie oft du im Zeitraum Sport gemacht hast, alle Sportarten zusammen.</p>
      </section>` : ""}
      <section class="sq">
        <div class="sq-head"><strong>Orte</strong>
          <label class="switch"><input type="checkbox" data-f="places" ${prefs.places !== false ? "checked" : ""}><span>Anzeigen</span></label>
        </div>
        <p class="muted small" style="margin:6px 0 0">Wo du im Zeitraum warst, je Ort die Anzahl Tage.</p>
      </section>
      ${settings.chess.on || Object.keys(chessData().months).length ? `<section class="sq">
        <div class="sq-head"><strong>Schach</strong>
          <label class="switch"><input type="checkbox" data-f="chess" ${prefs.chess !== false ? "checked" : ""}><span>Anzeigen</span></label>
        </div>
        <p class="muted small" style="margin:6px 0 0">Überblick von chess.com: Bilanz, Elo, Durchschnitte und alle Partien. Elo, Partien, Spielzeit, Punktequote und Genauigkeit stehen außerdem unten als eigene Karten.</p>
        ${prefs.chess !== false ? `<label class="switch row"><input type="checkbox" data-f="chessElo" ${prefs.chessElo !== false ? "checked" : ""}><span>Elo über die Zeit</span></label>
        <label class="switch row"><input type="checkbox" data-f="chessAcc" ${prefs.chessAcc !== false ? "checked" : ""}><span>Genauigkeit über die Zeit</span></label>` : ""}
      </section>` : ""}
      `}
      ${qs.map((q) => {
        const s = qset(q);
        const dist = q.type === "choice" || q.type === "scale";
        return `<section class="sq ${s.hidden ? "off" : ""}">
          <div class="sq-head">
            <strong>${q.cond ? "↳ " : ""}${esc(q.text)}</strong>
            <label class="switch"><input type="checkbox" data-q="${q.id}" data-f="show" ${s.hidden ? "" : "checked"}><span>Anzeigen</span></label>
          </div>
          ${s.hidden ? "" : `
          ${dist ? `<div class="sq-row"><span>Diagramm</span>${seg(q, "chart", [["bars", "Balken"], ["pie", "Kuchen"], ["count", "Kompakt"]], s.chart)}</div>
          ${q.type === "choice" && s.chart === "count"
            ? `<div class="sq-row"><span>Zählt</span><select data-q="${q.id}" data-f="countKey">${q.options.map((o) => `<option ${o === (q.options.includes(s.countKey) ? s.countKey : q.options[0]) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
               <p class="muted small" style="margin:6px 0 0">Zeigt nur: an wie vielen Tagen im Zeitraum diese Antwort kam.</p>`
            : q.type === "scale" && s.chart === "count" ? `<p class="muted small" style="margin:6px 0 0">Zeigt nur den Durchschnitt.</p>` : s.chart === "pie" ? "" : `<div class="sq-row"><span>Werte</span>${seg(q, "unit", [["pct", "%"], ["abs", "Anzahl"]], s.unit)}</div>`}` : ""}
          <label class="switch row"><input type="checkbox" data-q="${q.id}" data-f="trend" ${s.trend ? "checked" : ""}><span>Verlauf über die Zeit</span></label>
          <label class="switch row"><input type="checkbox" data-q="${q.id}" data-f="hideZeroQ" ${s.hideZero ? "checked" : ""}><span>Ausblenden, solange der Wert 0 ist</span></label>
          ${(() => {
            const kids = childrenOf(q.id).filter((c) => !c.archived);
            if (!kids.length) return "";
            const ch = kids.filter((c) => c.type === "choice");
            const sk = stackKid(q, ch);
            return `${ch.length > 1 ? `<div class="sq-row"><span>Farben nach</span><select data-q="${q.id}" data-f="stackBy">${ch.map((c) => `<option value="${c.id}" ${c === sk ? "selected" : ""}>${esc(c.text)}</option>`).join("")}</select></div>` : ""}`;
          })()}`}
        </section>`;
      }).join("")}
    </div>`;
    dlg.querySelector(".sheet-inner").scrollTop = keep;
    $("#adone", dlg).addEventListener("click", () => dlg.close());
    dlg.querySelectorAll("button[data-f]").forEach((b) => b.addEventListener("click", () => { setQ(b.dataset.q, { [b.dataset.f]: b.dataset.v }); draw(); renderAnalysis(); }));
    dlg.querySelectorAll("input[data-f]").forEach((i) => i.addEventListener("change", () => {
      if (i.dataset.f === "trends") { prefs.trends = i.checked; savePrefs(); }
      else if (i.dataset.f === "goals") { prefs.goals = i.checked; savePrefs(); }
      else if (i.dataset.f === "places") { prefs.places = i.checked; savePrefs(); }
      else if (i.dataset.f === "sport") { prefs.sport = i.checked; savePrefs(); }
      else if (i.dataset.f === "intol") { prefs.intol = i.checked; savePrefs(); }
      else if (i.dataset.f === "chess") { prefs.chess = i.checked; savePrefs(); }
      else if (i.dataset.f === "chessElo" || i.dataset.f === "chessAcc") { prefs[i.dataset.f] = i.checked; savePrefs(); }
      else if (i.dataset.f === "show") setQ(i.dataset.q, { hidden: !i.checked });
      else if (i.dataset.f === "hideZero") { prefs.hideZero = i.checked; Object.values(prefs.q).forEach((x) => delete x.hideZero); savePrefs(); }
      else if (i.dataset.f === "hideZeroQ") setQ(i.dataset.q, { hideZero: i.checked });
      else setQ(i.dataset.q, { trend: i.checked });
      draw(); renderAnalysis();
    }));
    dlg.querySelectorAll("select[data-f]").forEach((sel) => sel.addEventListener("change", () => { setQ(sel.dataset.q, { [sel.dataset.f === "stackBy" ? "stackBy" : "countKey"]: sel.value }); renderAnalysis(); }));
  };
  draw();
  dlg.showModal();
  document.activeElement?.blur(); // sonst zeigt iOS einen Rahmen um „Fertig“
}
