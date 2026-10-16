/* Mosaik – Trends: Serien, Zahlen, Jahreszeiten, Zusammenhänge */
"use strict";

/* ================= Trends: Serien und Zusammenhänge ================= */
const MIN_GROUP = 4;   // mindestens so viele Tage je Gruppe
const MIN_D = 0.5;     // ab mittlerem Effekt (Cohen's d) gilt ein Unterschied als auffällig
const MIN_R = 0.4;     // ab dieser Korrelation gilt ein Zusammenhang als auffällig
const MIN_PAIRS = 8;

const ansOn = (d, q) => (q.themeQs ? (() => { const h = themeHits(q.themeQs, d); return h === null ? undefined : h > 0 ? "Ja" : "Nein"; })() : q.weather ? weatherAns(d, q) : q.id === "__place" ? (placeCities(d).length ? placeCities(d) : undefined) : (state.answers[d] || {})[q.id]);
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

/* ---------- Themen zusammengefasst (z. B. Sport = Bouldern + Paddeln + Volleyball) ---------- */
// Ja/Nein-Fragen eines Themas (ohne Health-Felder); Themen-Trends erst ab 2 solchen Fragen
const themeYesQs = (k) => state.questions.filter((q) => !q.archived && q.type === "choice" && !q.multi && q.options.includes("Ja") && !isHealthQ(q) && themeOf(q) === k);
const themesWithYes = () => THEMES.filter((t) => themeYesQs(t.k).length >= 2);
const shortQ = (q) => q.text.replace(/\?$/, "").replace(/^(heute|warst du heute|hast du heute|bist du heute|war ich heute)\s+/i, "");
// Anzahl „Ja“ an einem Tag; null, wenn keine der Fragen beantwortet ist
function themeHits(qs, d) {
  const a = state.answers[d] || {};
  let any = false, n = 0;
  for (const q of qs) { if (isAnswered(a[q.id])) any = true; if (a[q.id] === "Ja") n++; }
  return any ? n : null;
}
const THEME_WORDS = { sport: { run: "Tage in Folge Sport gemacht", none: "kein Sport" } };

function themeInsights() {
  const out = [];
  const t = todayIso();
  const first = Object.keys(state.answers).sort()[0];
  if (!first) return out;
  for (const th of themesWithYes()) {
    const qs = themeYesQs(th.k);
    const w = THEME_WORDS[th.k] || { run: `Tage in Folge etwas bei ${th.l}`, none: `nichts bei ${th.l}` };
    const lead = `${th.i} ${esc(th.l)}`;
    // 1. letzte 7 Tage gegenüber den 8 Wochen davor (heute zählt erst, wenn schon etwas beantwortet ist)
    const end = themeHits(qs, t) === null ? addDays(t, -1) : t;
    const block = (e) => { let n = 0, ans = 0; const per = {}; for (let i = 0; i < 7; i++) { const d = addDays(e, -i); const h = themeHits(qs, d); if (h === null) continue; ans++; n += h; qs.forEach((q) => { if ((state.answers[d] || {})[q.id] === "Ja") per[q.id] = (per[q.id] || 0) + 1; }); } return { n, ans, per }; };
    const cur = block(end);
    const prev = Array.from({ length: 8 }, (_, i) => block(addDays(end, -7 * (i + 1)))).filter((b) => b.ans >= 3);
    if (cur.ans >= 4 && prev.length >= 3) {
      const m = mean(prev.map((b) => b.n)), diff = cur.n - m;
      if (Math.abs(diff) >= Math.max(2, 0.35 * m)) {
        const parts = qs.filter((q) => cur.per[q.id]).map((q) => `${esc(shortQ(q))} ${cur.per[q.id]}×`).join(", ");
        out.push({ score: 1.5 + Math.abs(diff) / Math.max(m, 1), html: `${lead}: <strong>letzte 7 Tage ${cur.n}×</strong>${parts ? ` (${parts})` : ""}, sonst Ø ${fmt1(m)}× pro Woche` });
      }
    }
    // 2. Serie: Tage in Folge mit mindestens einem „Ja“ im Thema
    let d = themeHits(qs, t) ? t : addDays(t, -1), run = 0;
    while (d >= first && themeHits(qs, d) > 0) { run++; d = addDays(d, -1); }
    if (run >= 3) out.push({ score: 10 + run, html: `${lead}: <strong>${run} ${w.run}</strong>` });
    // 3. Pause: ungewöhnlich lange nichts im Thema
    let last = null, yes = 0, ans = 0;
    for (let x = first; x <= t; x = addDays(x, 1)) { const h = themeHits(qs, x); if (h === null) continue; ans++; if (h > 0) { yes++; last = x; } }
    if (last && ans >= 14 && yes / ans >= 1 / 7 && run < 3) {
      const gap = dayCount(last, t) - 1, usual = ans / yes;
      if (gap >= 5 && gap >= 2 * usual) out.push({ score: 5 + gap / 7, html: `${lead}: <strong>seit ${gap} Tagen ${w.none}</strong> · sonst etwa alle ${Math.round(usual)} Tage` });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
// Für Zusammenhänge: „Tag mit Sport (egal welcher)“ als eigene Gruppe
function themeGroupings() {
  return themesWithYes().map((th) => {
    const qs = themeYesQs(th.k);
    return { q: { id: "__theme_" + th.k, text: th.l, type: "choice", options: ["Ja", "Nein"], themeQs: qs }, opt: "Ja", label: `${th.i} ${esc(th.l)} (egal welche Frage)` };
  });
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
  const wx = weatherOn() ? WEATHER_QS : []; // Wetter nur als Faktor
  const found = [];

  // Mittelwertvergleich: Zahl/Skala an Tagen mit vs. ohne eine bestimmte Antwort (gleicher Tag und Tag danach)
  for (const g of [...groupings(qs), ...themeGroupings(), ...placeGroupings(days), ...(wx.length ? [{ q: RAIN_Q, opt: "Ja", label: "Regen (ab 1 mm)" }] : [])]) {
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

  // Korrelation zwischen zwei Zahl/Skala-Fragen am selben Tag (Wetter nur mit Fragen, nicht untereinander)
  const cnums = [...nums, ...wx];
  for (let i = 0; i < cnums.length; i++) for (let j = i + 1; j < cnums.length; j++) {
    const a = cnums[i], b = cnums[j];
    if (a.weather && b.weather) continue;
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
        const [x, y] = b.weather ? [b, a] : b.format === "clock" && a.format !== "clock" && !a.weather ? [b, a] : [a, b];
        const up = (q) => (q.format === "clock" ? "später" : q.format === "duration" ? "länger" : "mehr");
        const down = (q) => (q.format === "clock" ? "früher" : q.format === "duration" ? "kürzer" : "weniger");
        return `<strong>${x.lead || `Je ${up(x)} ${qName(x)}`}, desto ${r > 0 ? up(y) : down(y)} ${qName(y)}</strong> (r = ${r.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
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
const T_PREVIEW = { theme: 2, streak: 2, num: 3, season: 2, rel: 2 };
let showAllTrends = false;
function trendsPanel(days) {
  const all = { theme: themeInsights(), streak: streakInsights(), num: numberInsights(), season: seasonInsights(), rel: relationInsights(days) };
  const lim = (k) => (showAllTrends ? all[k] : all[k].slice(0, T_PREVIEW[k]));
  const themes = lim("theme"), streaks = lim("streak"), nums = lim("num"), seasons = lim("season"), rel = lim("rel");
  const hidden = Object.keys(all).reduce((n, k) => n + Math.max(all[k].length - T_PREVIEW[k], 0), 0);
  const row = (x, kind) => `<li class="trow ${kind}${x.tone || ""}"><span class="tmark" aria-hidden="true"></span><span>${x.html}${x.note ? ` <span class="muted small">· ${x.note}</span>` : ""}</span></li>`;
  return `<section class="panel trends">
    <h2 class="atitle">Trends</h2>
    ${themes.length || streaks.length || rel.length || nums.length || seasons.length ? `
      ${themes.length ? `<ul class="tlist" style="margin-bottom:10px">${themes.map((x) => row(x, "theme")).join("")}</ul>` : ""}
      ${streaks.length ? `<ul class="tlist">${streaks.map((x) => row(x, "streak")).join("")}</ul>` : ""}
      ${nums.length ? `<ul class="tlist" ${streaks.length ? 'style="margin-top:10px"' : ""}>${nums.map((x) => row(x, "num")).join("")}</ul>` : ""}
      ${seasons.length ? `<p class="tsub small muted">Jahreszeiten (alle bisherigen Daten)</p><ul class="tlist">${seasons.map((x) => row(x, "season")).join("")}</ul>` : ""}
      ${rel.length ? `<p class="tsub small muted">Auffällige Zusammenhänge im gewählten Zeitraum</p><ul class="tlist">${rel.map((x) => row(x, "rel")).join("")}</ul>` : ""}
      ${hidden ? `<button class="btn ghost block" id="tmore" style="margin-top:12px">${showAllTrends ? "Weniger anzeigen" : `Alle Trends anzeigen (${hidden} weitere)`}</button>` : ""}
      ${rel.length ? `<p class="small muted tfoot">Zeigt nur deutliche Unterschiede ab ${MIN_GROUP} Tagen je Gruppe. Ein Zusammenhang heißt nicht, dass das eine das andere verursacht.</p>` : ""}`
      : `<p class="muted small" style="margin:0">Noch nichts Auffälliges. Serien erscheinen ab 3 Tagen am Stück, Zusammenhänge meist nach ein paar Wochen Daten.</p>`}
  </section>`;
}
