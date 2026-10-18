/* Mosaik – Analyse: Zeitraum, Karten, Diagramme, Darstellung */
"use strict";

/* ================= Analyse ================= */
const PREF_KEY = "taeglich.prefs";
let prefs = { range: "30", q: {}, focus: {} };
try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); prefs = { ...prefs, ...p, q: p.q || {}, focus: p.focus || {} }; } catch (e) { /* egal */ }
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* egal */ } };

// Einstellungen pro Frage, mit sinnvollen Vorgaben
const qset = (q) => ({ chart: "bars", unit: "pct", trend: q.type !== "choice", hidden: false, ...(prefs.q[q.id] || {}) });
const setQ = (qid, patch) => { prefs.q[qid] = { ...(prefs.q[qid] || {}), ...patch }; savePrefs(); };

const RANGES = [["1", "1 Tag"], ["7", "7 Tage"], ["30", "30 Tage"], ["ytd", "Seit 1.1."], ["365", "12 Monate"], ["all", "Alles"], ["custom", "Eigener Zeitraum"]];
const RANGE_MAIN = ["1", "7", "30"]; // direkt sichtbar, der Rest über „Mehr“
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
  return ordered().map((o) => o.q).filter((q) => !q.archived || days.some((d) => isAnswered((state.answers[d] || {})[q.id])));
}

function renderAnalysis() {
  const view = $("#view");
  const days = rangeDays();
  const all = analysisQuestions(days);
  // Filter nach Thema (nur wenn es mehrere Themen gibt)
  const usedThemes = THEMES.filter((t) => all.some((q) => themeOf(q) === t.k));
  if (prefs.theme && !usedThemes.some((t) => t.k === prefs.theme)) prefs.theme = "";
  const qs = all.filter((q) => !qset(q).hidden && (!prefs.theme || themeOf(q) === prefs.theme));
  const tracked = days.filter((d) => state.answers[d]).length;
  const hiddenN = all.length - qs.length;

  view.innerHTML = `
    <div class="dayhead">
      <h1>Analyse</h1>
      ${all.length ? `<button class="gear" id="asettings" aria-label="Darstellung einstellen">${GEAR}</button>` : ""}
    </div>
    ${rangeControl(prefs.range, "range")}
    <p class="muted small" style="margin:0 0 16px">${days.length === 1 ? `${tracked ? "Erfasst" : "Noch nicht erfasst"} · ${shortDate(days[0])}` : `${tracked} von ${days.length} Tagen erfasst · ${shortDate(days[0])} – ${shortDate(days[days.length - 1])}`}${hiddenN ? ` · ${hiddenN} Frage${hiddenN > 1 ? "n" : ""} ausgeblendet` : ""}</p>
    ${all.length && prefs.trends !== false ? trendsPanel(days) : ""}
    ${all.length && prefs.goals !== false ? goalsPanel() : ""}
    ${prefs.places !== false && (Object.keys(state.places || {}).length || (settings.places && settings.places.on)) ? placesPanel(days) : ""}
    ${prefs.chess !== false && (settings.chess.on || Object.keys(chessData().months).length) ? chessPanel(days) : ""}
    ${usedThemes.length > 1 ? `<div class="tfilter" role="group" aria-label="Thema">
      <button data-th="" aria-pressed="${!prefs.theme}">Alle</button>
      ${usedThemes.map((t) => `<button data-th="${t.k}" aria-pressed="${prefs.theme === t.k}">${t.i} ${esc(t.l)}</button>`).join("")}
    </div>` : ""}
    ${qs.length ? qs.map((q) => analysisCard(q, days)).join("") : prefs.theme ? `<p class="muted">Keine Fragen in diesem Thema.</p>` : `<p class="muted">${all.length ? "Alle Fragen sind über das Zahnrad ausgeblendet." : "Noch keine Fragen angelegt."}</p>`}`;

  $("#asettings")?.addEventListener("click", openAnalysisSettings);
  view.querySelectorAll("[data-th]").forEach((b) => b.addEventListener("click", () => { prefs.theme = b.dataset.th; savePrefs(); renderAnalysis(); }));
  $("#gmore")?.addEventListener("click", () => { showAllGoals = !showAllGoals; renderAnalysis(); });
  $("#tmore")?.addEventListener("click", () => { showAllTrends = !showAllTrends; renderAnalysis(); });
  $("#pmore")?.addEventListener("click", () => { showAllPlaces = !showAllPlaces; renderAnalysis(); });
  $("#chessgames")?.addEventListener("click", () => openChessGames(days));
  wireRange(view, "range", (k) => { prefs.range = k; savePrefs(); renderAnalysis(); });
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
    ${contractBlock(q, days)}
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
      </section>` : ""}
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
      else if (i.dataset.f === "places") { prefs.places = i.checked; savePrefs(); }
      else if (i.dataset.f === "chess") { prefs.chess = i.checked; savePrefs(); }
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
