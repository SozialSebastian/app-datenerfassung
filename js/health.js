/* Mosaik – Bereich „Gesundheit“: Mosaik-Alter, Erholung, Stress, Belastung, Schlaf, Fitness
   Alle Werte kommen aus Apple Health (Kurzbefehl) und werden nur auf dem iPhone berechnet.
   Die Methoden sind an veröffentlichte Studien angelehnt (Quellen in den Erklärungen, Knopf „i“). Keine Diagnose. */
"use strict";

/* ================= Daten ================= */
// state.hdata: Tagesverläufe aus dem Kurzbefehl, je Tag kompakt als Text
//   hr: { "JJJJ-MM-TT": "Minute:bpm,…" }   st: { Tag: "Minute:Schritte,…" (je Stunde) }   wo: { Tag: "Start-Ende;…" (Minuten) }
// state.profile: { born: Geburtsjahr, sex: "m" | "w" } – für Alter, Maximalpuls und VO₂max-Normwerte
const HD = () => {
  if (!state.hdata || typeof state.hdata !== "object") state.hdata = {};
  for (const k of ["hr", "st", "wo"]) if (!state.hdata[k]) state.hdata[k] = {};
  return state.hdata;
};
const PROFILE = () => (state.profile && typeof state.profile === "object" ? state.profile : (state.profile = {}));
const HSERIES_KEY = { puls_serie: "hr", schrittez_serie: "st", workouts: "wo" };
const HKEEP_DAYS = 60; // Verläufe so lange behalten (Stress braucht 14 Tage Vergleich)

// Eingang aus dem Kurzbefehl: Reihe eines Tages übernehmen (vorhandene Messpunkte werden ergänzt)
function storeHealthSeries(key, date, value) {
  const k = HSERIES_KEY[key];
  if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const h = HD();
  if (k === "wo") {
    const xs = new Set([...(h.wo[date] || "").split(";"), ...String(value).split(";")].filter(Boolean));
    h.wo[date] = [...xs].join(";");
  } else {
    const m = new Map(parsePairs(h[k][date]));
    for (const [a, b] of parsePairs(value)) m.set(a, b);
    h[k][date] = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([a, b]) => `${a}:${b}`).join(",");
  }
  // alte Verläufe aufräumen (Speicherplatz)
  const cut = addDays(todayIso(), -HKEEP_DAYS);
  for (const kk of ["hr", "st", "wo"]) for (const d of Object.keys(h[kk])) if (d < cut) delete h[kk][d];
  hcache.clear();
  return true;
}
const parsePairs = (s) => String(s || "").split(",").map((x) => x.split(":").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
const hcache = new Map();
const hrSeries = (d) => { const k = "hr" + d; if (!hcache.has(k)) hcache.set(k, parsePairs(HD().hr[d])); return hcache.get(k); };
const stepSeries = (d) => parsePairs(HD().st[d]);
const workouts = (d) => String(HD().wo[d] || "").split(";").map((x) => x.split("-").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));

// Tageswert eines Health-Kürzels (z. B. „ruhepuls“)
const hq = (key) => state.questions.find((q) => q.healthKey === key);
function hv(key, d) { const q = hq(key); const v = q ? (state.answers[d] || {})[q.id] : undefined; return typeof v === "number" && !(v <= 0 && HEALTH_POSITIVE.has(key)) ? v : null; }
// Werte der letzten n Tage bis einschließlich „bis“
function hvals(key, n, bis = todayIso()) { const out = []; for (let i = 0; i < n; i++) { const v = hv(key, addDays(bis, -i)); if (v !== null) out.push(v); } return out; }
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ageNow = () => { const p = PROFILE(); return p.born ? new Date().getFullYear() - p.born : null; };
const hrMax = () => { const a = ageNow(); return a ? 208 - 0.7 * a : 190; }; // Tanaka 2001
const fmtYears = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${fmtNum(Math.round(Math.abs(x) * 10) / 10)}`;

/* ================= Mosaik-Alter (biologisches Alter) =================
   Idee: Jede Messgröße verändert das Sterberisiko (Hazard Ratio HR, aus großen Studien) gegenüber einem
   typischen Wert. Weil sich das Sterberisiko Erwachsener etwa alle 8 Jahre verdoppelt (Gompertz),
   entspricht ein Risiko HR einer Alters-Verschiebung von ln(HR) / β Jahren mit β = ln 2 / 8 ≈ 0,087. */
const GOMPERTZ_B = Math.log(2) / 8;
const yearsOf = (hr) => Math.log(hr) / GOMPERTZ_B;
// stückweise lineare Interpolation über Stützstellen [[x, y], …] (außerhalb: Randwert)
function interp(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return pts[pts.length - 1][1];
}
// Schritte: Paluch et al. 2022 (Lancet Public Health), Quartil-Mediane und HR; Bezug 7.000 Schritte
const STEP_HR = [[2000, 1.15], [3553, 1.0], [5801, 0.6], [7842, 0.55], [10901, 0.47]];
// Trainingsminuten je Woche: Arem et al. 2015 (JAMA Intern Med), Vielfache von 150 min; Bezug 150 min
const EX_HR = [[0, 1.0], [75, 0.8], [150, 0.69], [300, 0.63], [450, 0.61], [750, 0.61]];
// Schlafdauer: Cappuccio et al. 2010 (Sleep): kurz RR 1,12, lang RR 1,30 gegenüber 7–8 h
const sleepHR = (h) => (h < 7 ? 1 + Math.min(0.2, 0.06 * (7 - h)) : h <= 9 ? 1 : 1 + Math.min(0.4, 0.3 * (h - 9)));
// Schlafregelmäßigkeit: Windred et al. 2024 (Sleep): regelmäßigste Gruppen 20–48 % geringeres Risiko als die unregelmäßigste.
// Näherung über die Streuung der Schlafmitte (Minuten)
const regHR = (sdMin) => interp([[20, 0.85], [30, 0.9], [45, 1.0], [75, 1.25], [120, 1.5]], sdMin);
// Ruhepuls: Zhang et al. 2016 (CMAJ): HR 1,09 je 10 Schläge/min; Bezug 65/min
const rhrHR = (bpm) => Math.pow(1.09, (bpm - 65) / 10);
// VO₂max: Kodama et al. 2009 (JAMA): je 1 MET (3,5 ml/kg/min) höher 13 % geringeres Risiko; Bezug Median FRIEND 2022 für Alter/Geschlecht
const FRIEND50 = { m: [[25, 46.5], [35, 39.7], [45, 35.3], [55, 29.2], [65, 24.6], [75, 20.6], [85, 17.6]], w: [[25, 36.6], [35, 28.3], [45, 25.7], [55, 22.9], [65, 19.6], [75, 17.2], [85, 15.4]] };
const vo2Norm = (age, sex) => interp(FRIEND50[sex === "w" ? "w" : "m"], age);
const vo2HR = (v, age, sex) => Math.pow(0.87, (v - vo2Norm(age, sex)) / 3.5); // höher als der Median → HR < 1
// Fitness-Alter: Alter, für das dein VO₂max dem Median entspricht
function fitnessAge(v, sex) { const t = FRIEND50[sex === "w" ? "w" : "m"].map(([a, n]) => [n, a]).reverse(); return interp(t, v); }

// Schlafmitte je Nacht (Stunden, nach Mitternacht > 24), aus Einschlaf- und Aufwachzeit
function sleepMids(n, bis = todayIso()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(bis, -i), b = hv("schlafenszeit", d), w = hv("aufwachzeit", d);
    if (b === null || w === null) continue;
    const bed = b < 12 ? b + 24 : b, wake = w + 24;
    if (wake > bed) out.push((bed + wake) / 2);
  }
  return out;
}

// Beiträge zum Mosaik-Alter über ein Zeitfenster (Tage)
function bioParts(win, bis = todayIso()) {
  const age = ageNow(), sex = PROFILE().sex;
  const parts = [];
  const add = (k, label, val, hr, ref, n, w = 1) => parts.push({ k, label, val, hr, years: clamp(yearsOf(hr) * w, -4, 6), ref, n });
  const st = hvals("schritte", win, addDays(bis, -1)); // heute ist noch nicht fertig
  if (st.length >= 7) { const m = mean(st); add("steps", "Schritte", `Ø ${fmtBig(m)} am Tag`, interp(STEP_HR, m) / interp(STEP_HR, 7000), "Bezug 7.000", st.length); }
  const ex = hvals("training", win, addDays(bis, -1));
  if (ex.length >= 7) { const wk = mean(ex) * 7; add("ex", "Training", `Ø ${Math.round(wk)} min pro Woche`, interp(EX_HR, wk) / interp(EX_HR, 150), "Bezug 150 min", ex.length, 0.5); }
  const sl = hvals("schlaf", win, bis);
  if (sl.length >= 7) { const m = mean(sl); add("sleep", "Schlafdauer", `Ø ${fmtDur(m)}`, sleepHR(m), "Bezug 7–9 h", sl.length); }
  const mids = sleepMids(win, bis);
  if (mids.length >= 7) { const s = sd(mids) * 60; add("reg", "Schlafrhythmus", `± ${Math.round(s)} min Schwankung`, regHR(s), "Bezug ± 45 min", mids.length); }
  const rh = hvals("ruhepuls", win, bis);
  if (rh.length >= 7) { const m = mean(rh); add("rhr", "Ruhepuls", `Ø ${Math.round(m)}/min`, rhrHR(m), "Bezug 65/min", rh.length); }
  const vo = hvals("vo2max", Math.max(win, 90), bis);
  if (vo.length && age) { const v = vo[0]; add("vo2", "VO₂max", `${fmtNum(Math.round(v * 10) / 10)} ml/kg/min`, vo2HR(v, age, sex), `Median deines Alters ${fmtNum(Math.round(vo2Norm(age, sex) * 10) / 10)}`, vo.length); }
  return parts;
}
function bioAge() {
  const age = ageNow();
  if (!age) return { missing: "profile" };
  const parts = bioParts(180);
  if (parts.length < 2) return { missing: "data", parts };
  const sum = clamp(parts.reduce((s, p) => s + p.years, 0), -12, 15);
  // Tempo: Gewohnheiten der letzten 30 Tage gegenüber den letzten 6 Monaten (1× = normal, < 1 langsamer, > 1 schneller)
  const p30 = bioParts(30), s30 = clamp(p30.reduce((s, p) => s + p.years, 0), -12, 15);
  const pace = clamp(1 + (s30 - sum) / 3, -1, 3);
  return { age, bio: age + sum, delta: sum, parts, pace };
}

/* ================= Stress (rückwirkend aus dem Pulsverlauf) =================
   Wie Whoop: Puls im Vergleich zum eigenen Normal der letzten 14 Tage, Bewegung und Schlaf ausgenommen.
   15-Minuten-Fenster: z = (Ø Puls − Median) / Streuung, Stress = z begrenzt auf 0–3. */
const WIN = 15;
function awakeSpan(d) {
  const w = hv("aufwachzeit", d), b = hv("schlafenszeit", addDays(d, 1));
  return [w !== null ? w * 60 : 7 * 60, b !== null ? b * 60 : 23 * 60]; // ohne Schlafdaten: 7–23 Uhr
}
// Fenster eines Tages: { i, mean, kind: "ok" | "act" | "sleep" | "none" }
function dayWindows(d) {
  const hr = hrSeries(d);
  if (hr.length < 10) return null;
  const [a, b] = awakeSpan(d);
  const wo = workouts(d);
  const steps = new Map(stepSeries(d).map(([m, v]) => [Math.floor(m / 60), v]));
  const out = [];
  for (let i = 0; i < 1440 / WIN; i++) {
    const s = i * WIN, e = s + WIN;
    const pts = hr.filter(([m]) => m >= s && m < e).map(([, v]) => v);
    let kind = pts.length ? "ok" : "none";
    if (e <= a || s >= b) kind = pts.length ? "sleep" : "none";
    else if (wo.some(([x, y]) => s < y + 10 && e > x - 5) || (steps.get(Math.floor(s / 60)) || 0) > 1200) kind = pts.length ? "act" : "none";
    out.push({ i, mean: pts.length ? mean(pts) : null, kind });
  }
  return out;
}
function stressBaseline(d) {
  const vals = [];
  for (let k = 1; k <= 14; k++) { const ws = dayWindows(addDays(d, -k)); if (ws) ws.forEach((w) => { if (w.kind === "ok") vals.push(w.mean); }); }
  if (vals.length < 40) return null;
  const m = median(vals);
  const mad = median(vals.map((v) => Math.abs(v - m)));
  return { m, s: Math.max(3, 1.4826 * mad), n: vals.length };
}
function stressDay(d) {
  const ws = dayWindows(d);
  if (!ws) return { missing: "hr" };
  const base = stressBaseline(d);
  if (!base) return { missing: "base", ws };
  ws.forEach((w) => { if (w.kind === "ok") w.v = clamp((w.mean - base.m) / base.s, 0, 3); });
  const ok = ws.filter((w) => w.kind === "ok");
  if (!ok.length) return { missing: "awake", ws };
  let avg = mean(ok.map((w) => w.v));
  // HRV des Tages deutlich unter dem eigenen Normal → Tageswert etwas höher (wie Erholung, siehe dort)
  const h = hv("hrv", d), hb = hvals("hrv", 30, addDays(d, -1));
  let hrvNote = "";
  if (h !== null && hb.length >= 7) {
    const z = (Math.log(h) - mean(hb.map(Math.log))) / Math.max(0.05, sd(hb.map(Math.log)));
    if (z < -1) { avg = Math.min(3, avg + 0.25); hrvNote = "HRV unter deinem Normal (+0,25)"; }
  }
  return { ws, base, avg, high: ok.filter((w) => w.v >= 2).length * WIN, low: ok.filter((w) => w.v < 1).length * WIN, awake: ok.length * WIN, act: ws.filter((w) => w.kind === "act").length * WIN, hrvNote };
}
const stressLabel = (v) => (v < 0.75 ? "niedrig" : v < 1.5 ? "mittel" : v < 2.25 ? "erhöht" : "hoch");
const stressColor = (v) => (v < 0.75 ? "var(--s3)" : v < 1.5 ? "#e6b800" : v < 2.25 ? "var(--s2)" : "var(--s8)");

/* ================= Belastung (wie Whoop Strain, 0–21) =================
   Edwards-TRIMP: Minuten je Pulszone (50–60 % … 90–100 % des Maximalpulses) mal Zonennummer 1–5,
   auf 0–21 abgebildet: Belastung = 21 · (1 − e^(−TRIMP/190)). */
function strainDay(d) {
  const hr = hrSeries(d);
  if (hr.length < 10) return null;
  const mx = hrMax();
  let trimp = 0;
  const zones = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < hr.length; i++) {
    const dt = Math.min(10, i + 1 < hr.length ? hr[i + 1][0] - hr[i][0] : 5);
    const p = hr[i][1] / mx;
    const z = p < 0.5 ? 0 : p < 0.6 ? 1 : p < 0.7 ? 2 : p < 0.8 ? 3 : p < 0.9 ? 4 : 5;
    zones[z] += dt; trimp += z * dt;
  }
  return { trimp, strain: 21 * (1 - Math.exp(-trimp / 190)), zones };
}
const strainLabel = (s) => (s < 7 ? "leicht" : s < 11 ? "moderat" : s < 15 ? "hoch" : s < 18 ? "sehr hoch" : "maximal");

/* ================= Erholung (wie Whoop Recovery / Oura Readiness, 0–100 %) =================
   HRV (ln, 55 %), Ruhepuls (25 %) und Schlaf im Verhältnis zum Bedarf (20 %), jeweils als Abweichung vom
   eigenen 30-Tage-Normal; Summe s → Erholung = 100 / (1 + e^(−1,2·(s + 0,25))). */
const SLEEP_NEED = 8;
function recoveryDay(d) {
  const parts = [];
  const h = hv("hrv", d), hb = hvals("hrv", 30, addDays(d, -1));
  if (h !== null && hb.length >= 7) { const L = hb.map(Math.log); parts.push({ k: "hrv", w: 0.55, z: clamp((Math.log(h) - mean(L)) / Math.max(0.05, sd(L)), -3, 3), txt: `HRV ${Math.round(h)} ms`, ref: `Normal ${Math.round(Math.exp(mean(L)))} ms` }); }
  const r = hv("ruhepuls", d), rb = hvals("ruhepuls", 30, addDays(d, -1));
  if (r !== null && rb.length >= 7) parts.push({ k: "rhr", w: 0.25, z: clamp(-(r - mean(rb)) / Math.max(1.5, sd(rb)), -3, 3), txt: `Ruhepuls ${Math.round(r)}/min`, ref: `Normal ${Math.round(mean(rb))}/min` });
  const s = hv("schlaf", d);
  if (s !== null) parts.push({ k: "sleep", w: 0.2, z: clamp((Math.min(1, s / SLEEP_NEED) - 0.85) / 0.1, -3, 1.5), txt: `Schlaf ${fmtDur(s)}`, ref: `${Math.round(Math.min(1, s / SLEEP_NEED) * 100)} % vom Bedarf (${SLEEP_NEED} h)` });
  if (!parts.some((p) => p.k === "hrv" || p.k === "rhr")) return { missing: true, parts };
  const W = parts.reduce((t, p) => t + p.w, 0);
  const sc = parts.reduce((t, p) => t + p.w * p.z, 0) / W;
  return { score: clamp(Math.round(100 / (1 + Math.exp(-1.2 * (sc + 0.25)))), 1, 99), parts };
}
const recColor = (v) => (v >= 67 ? "var(--s3)" : v >= 34 ? "#e6b800" : "var(--s8)");
// Körper-Check: Werte deutlich außerhalb des eigenen Normals (z. B. beginnende Erkältung, schlechte Nacht)
function bodyCheck(d) {
  const flags = [];
  const chk = (key, label, dir, unit, fmt = (v) => Math.round(v)) => {
    const v = hv(key, d), b = hvals(key, 30, addDays(d, -1));
    if (v === null || b.length < 7) return;
    const z = (v - mean(b)) / Math.max(sd(b), 0.001);
    if (dir * z > 2) flags.push(`${label} ${fmt(v)}${unit} (Normal ${fmt(mean(b))}${unit})`);
  };
  chk("ruhepuls", "Ruhepuls erhöht:", 1, "/min");
  chk("hrv", "HRV niedrig:", -1, " ms");
  chk("atemfrequenz", "Atemfrequenz erhöht:", 1, "/min", (v) => fmtNum(Math.round(v * 10) / 10));
  return flags;
}

/* ================= Schlaf ================= */
function sleepStats() {
  const s7 = hvals("schlaf", 7), s14 = hvals("schlaf", 14);
  if (!s7.length) return null;
  const mids = sleepMids(14);
  const bed = hvals("schlafenszeit", 7), wake = hvals("aufwachzeit", 7);
  return {
    avg: mean(s7), n: s7.length,
    debt: s7.reduce((t, x) => t + Math.max(0, SLEEP_NEED - x), 0),
    reg: mids.length >= 5 ? sd(mids) * 60 : null,
    bed: bed.length ? mean(bed.map((b) => (b < 12 ? b + 24 : b))) : null,
    wake: wake.length ? mean(wake) : null,
    trend: s14.length >= 10 ? mean(s7) - mean(hvals("schlaf", 7, addDays(todayIso(), -7))) : null
  };
}
const regLabel = (m) => (m <= 30 ? "sehr regelmäßig" : m <= 45 ? "regelmäßig" : m <= 75 ? "schwankend" : "unregelmäßig");

/* ================= Ansicht ================= */
let hStressDay = null; // gewählter Tag im Stress-Verlauf (Standard: gestern)
const INFO_BTN = (k) => `<button type="button" class="hinfo" data-hinfo="${k}" aria-label="Wie wird das berechnet?">i</button>`;
const hcard = (k, title, body, cls = "") => `<section class="panel hcard ${cls}" data-hk="${k}"><div class="hhead"><h2 class="atitle">${title}</h2>${INFO_BTN(k)}</div>${body}</section>`;
const hmiss = (txt) => `<p class="muted small hmiss">${txt} <button type="button" class="linkbtn" data-hsetup>Kurzbefehl einrichten</button></p>`;

function renderHealth() {
  cleanHealthZeros();
  const view = $("#view");
  const p = PROFILE();
  const t = todayIso(), y = addDays(t, -1);
  if (!hStressDay) hStressDay = y;

  // Profil (für Alter, Maximalpuls und VO₂max-Normen)
  const profile = !p.born || !p.sex ? `<section class="panel hprofile">
      <h2 class="atitle">Kurz zu dir</h2>
      <p class="muted small" style="margin:0 0 10px">Für das Mosaik-Alter, die Pulszonen und die VO₂max-Normwerte. Bleibt nur auf diesem iPhone.</p>
      <div class="row2"><label class="field">Geburtsjahr<input id="hborn" type="number" inputmode="numeric" placeholder="z. B. 1998" value="${p.born || ""}"></label>
      <label class="field">Geschlecht<select id="hsex"><option value="">–</option><option value="m" ${p.sex === "m" ? "selected" : ""}>männlich</option><option value="w" ${p.sex === "w" ? "selected" : ""}>weiblich</option></select></label></div>
      <button type="button" class="btn block" id="hprofsave">Übernehmen</button>
    </section>` : "";

  // Mosaik-Alter
  const B = bioAge();
  let bioBody;
  if (B.missing === "profile") bioBody = `<p class="muted small hmiss">Trag oben dein Geburtsjahr ein.</p>`;
  else if (B.missing) bioBody = hmiss("Dafür braucht es mindestens zwei dieser Werte über eine Woche: Schritte, Training, Schlaf, Ruhepuls, VO₂max.");
  else {
    const max = Math.max(1, ...B.parts.map((x) => Math.abs(x.years)));
    bioBody = `<div class="hbig"><b>${fmtNum(Math.round(B.bio * 10) / 10)}</b><span>Jahre · dein Alter ${B.age}</span><em class="${B.delta <= 0 ? "g" : "r"}">${fmtYears(B.delta)} Jahre</em></div>
      <p class="small" style="margin:2px 0 12px">Tempo der letzten 30 Tage: <strong class="${B.pace <= 1.05 ? "g" : "r"}">${B.pace.toFixed(1).replace(".", ",")}×</strong> <span class="muted">(1× = ein Jahr pro Jahr)</span></p>
      <div class="hparts">${B.parts.sort((a, b) => a.years - b.years).map((x) => `<div class="hpart"><span class="hpl">${esc(x.label)}<small>${esc(x.val)}</small></span>
        <span class="hpb"><span class="${x.years <= 0 ? "neg" : "pos"}" style="width:${(Math.abs(x.years) / max) * 50}%"></span></span>
        <span class="hpv ${x.years <= 0 ? "g" : "r"}">${fmtYears(x.years)}</span></div>`).join("")}</div>`;
  }

  // Erholung (heute) + Körper-Check
  const R = recoveryDay(t);
  const recBody = R.missing ? hmiss("Dafür braucht es HRV oder Ruhepuls von mindestens einer Woche.")
    : `<div class="hrow2">${ring(R.score / 100, recColor(R.score), `${R.score}<small>%</small>`)}
        <div class="hlist">${R.parts.map((x) => `<div><b>${esc(x.txt)}</b><span class="muted small">${esc(x.ref)}</span></div>`).join("")}</div></div>
      ${(() => { const f = bodyCheck(t); return `<p class="small hcheck ${f.length ? "warn" : ""}">${f.length ? `⚠︎ ${f.map(esc).join(" · ")}` : "✓ Körper-Check: alles in deinem normalen Bereich"}</p>`; })()}`;

  // Stress (gewählter Tag, Standard gestern)
  const S = stressDay(hStressDay);
  const nav = `<div class="hnav"><button type="button" class="iconbtn" data-hsd="-1" aria-label="Tag davor">‹</button><span>${hStressDay === y ? "Gestern" : hStressDay === t ? "Heute" : shortDate(hStressDay)}</span><button type="button" class="iconbtn" data-hsd="1" aria-label="Tag danach" ${hStressDay >= t ? "disabled" : ""}>›</button></div>`;
  let stressBody;
  if (S.missing === "hr") stressBody = hmiss("Für diesen Tag gibt es keinen Pulsverlauf.");
  else if (S.missing === "base") stressBody = `<p class="muted small hmiss">Noch zu wenige Vergleichstage – nach etwa 3–4 Tagen mit Pulsverlauf geht es los.</p>${stressStrip(S.ws)}`;
  else if (S.missing) stressBody = `<p class="muted small hmiss">Keine ruhigen Wachphasen mit Messwerten.</p>`;
  else stressBody = `<div class="hbig"><b style="color:${stressColor(S.avg)}">${fmtNum(Math.round(S.avg * 10) / 10)}</b><span>von 3 · ${stressLabel(S.avg)}</span></div>
      ${stressStrip(S.ws)}
      <p class="small muted" style="margin:6px 0 0">Hoch (≥ 2): <strong>${fmtDur(S.high / 60)}</strong> · entspannt (&lt; 1): <strong>${fmtDur(S.low / 60)}</strong>${S.act ? ` · Bewegung ${fmtDur(S.act / 60)}` : ""}${S.hrvNote ? ` · ${esc(S.hrvNote)}` : ""}</p>`;

  // Belastung: heute und die letzten 7 Tage
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const st7 = days7.map((d) => ({ d, s: strainDay(d) }));
  const stT = st7[6].s || st7[5].s;
  const strainBody = !st7.some((x) => x.s) ? hmiss("Dafür braucht es den Pulsverlauf.")
    : `<div class="hbig"><b>${stT ? fmtNum(Math.round(stT.strain * 10) / 10) : "–"}</b><span>von 21 · ${st7[6].s ? "heute" : "gestern"}${stT ? ` · ${strainLabel(stT.strain)}` : ""}</span></div>
      <div class="hbars">${st7.map((x) => `<div><span style="height:${x.s ? Math.max(3, (x.s.strain / 21) * 100) : 0}%"></span><em>${WD_SHORT[parseIso(x.d).getDay()]}</em></div>`).join("")}</div>`;

  // Schlaf
  const SL = sleepStats();
  const sleepBody = !SL ? hmiss("Dafür braucht es die Schlafdaten.")
    : `<div class="hgrid">
        <div><b>${fmtDur(SL.avg)}</b><span>Ø 7 Nächte${SL.trend !== null ? ` <em class="${SL.trend >= 0 ? "g" : "r"}">${SL.trend >= 0 ? "▲" : "▼"} ${devMin(SL.trend)}</em>` : ""}</span></div>
        <div><b>${fmtDur(SL.debt)}</b><span>Schlafschuld (7 Nächte, Bedarf ${SLEEP_NEED} h)</span></div>
        ${SL.reg !== null ? `<div><b>± ${Math.round(SL.reg)} min</b><span>Rhythmus: ${regLabel(SL.reg)}</span></div>` : ""}
        ${SL.bed !== null && SL.wake !== null ? `<div><b>${fmtClock(SL.bed)}–${fmtClock(SL.wake)}</b><span>Ø Einschlafen und Aufwachen</span></div>` : ""}
      </div>`;

  // Fitness (VO₂max)
  const vo = hvals("vo2max", 120);
  const age = ageNow();
  const fitBody = !vo.length ? hmiss("Die Apple Watch schätzt VO₂max beim Gehen oder Laufen draußen (Cardiofitness).")
    : (() => {
      const v = vo[0], n = age ? vo2Norm(age, PROFILE().sex) : null, fa = fitnessAge(v, PROFILE().sex);
      const rel = n ? (v - n) / n : null;
      const cat = rel === null ? "" : rel >= 0.2 ? "sehr gut" : rel >= 0.05 ? "gut" : rel > -0.05 ? "durchschnittlich" : rel > -0.2 ? "unter dem Durchschnitt" : "niedrig";
      return `<div class="hbig"><b>${fmtNum(Math.round(v * 10) / 10)}</b><span>ml/kg/min${cat ? ` · ${cat}` : ""}</span></div>
        <p class="small" style="margin:4px 0 0">${n ? `Median deines Alters: ${fmtNum(Math.round(n * 10) / 10)} · ` : ""}Fitness-Alter: <strong>${Math.round(fa)} Jahre</strong></p>`;
    })();

  view.innerHTML = `
    <div class="dayhead"><h1>Gesundheit</h1><button class="gear" id="hsetup" aria-label="Daten einrichten">${GEAR}</button></div>
    ${profile}
    ${hcard("bio", "Mosaik-Alter", bioBody)}
    ${hcard("rec", "Erholung heute", recBody)}
    ${hcard("stress", "Stress", nav + stressBody)}
    ${hcard("strain", "Belastung", strainBody)}
    ${hcard("sleep", "Schlaf", sleepBody)}
    ${hcard("fit", "Fitness", fitBody)}
    <p class="muted small" style="margin:4px 4px 0">Schätzungen aus deinen Apple-Health-Werten, angelehnt an Studien – keine Diagnose.</p>`;

  $("#hprofsave")?.addEventListener("click", () => {
    const b = parseInt($("#hborn").value, 10), s = $("#hsex").value;
    if (!(b > 1900 && b <= new Date().getFullYear() - 10)) return toast("Bitte ein gültiges Geburtsjahr");
    if (!s) return toast("Bitte Geschlecht wählen");
    state.profile = { born: b, sex: s }; save(); renderHealth();
  });
  view.querySelectorAll("[data-hinfo]").forEach((b) => b.addEventListener("click", () => openHealthInfo(b.dataset.hinfo)));
  view.querySelectorAll("[data-hsetup], #hsetup").forEach((b) => b.addEventListener("click", openHealthSetup));
  view.querySelectorAll("[data-hsd]").forEach((b) => b.addEventListener("click", () => { hStressDay = addDays(hStressDay, +b.dataset.hsd); renderHealth(); }));
}

// Ring (0–1) mit Text in der Mitte
function ring(f, color, label) {
  const r = 34, c = 2 * Math.PI * r;
  return `<svg class="hring" viewBox="0 0 84 84" role="img"><circle cx="42" cy="42" r="${r}" class="hrt"/><circle cx="42" cy="42" r="${r}" stroke="${color}" class="hrv2" stroke-dasharray="${(c * clamp(f, 0, 1)).toFixed(1)} ${c.toFixed(1)}"/></svg><span class="hringv" style="color:${color}">${label}</span>`;
}
// Stressband über den Tag: je 15 Minuten ein Streifen (grau = Bewegung, leer = Schlaf/keine Messung)
function stressStrip(ws) {
  if (!ws) return "";
  const [a, b] = [6 * 4, 24 * 4]; // 6–24 Uhr
  return `<div class="hstrip">${ws.slice(a, b).map((w) => `<i style="${w.kind === "ok" && w.v !== undefined ? `background:${stressColor(w.v)};height:${20 + w.v * 26}%` : w.kind === "act" ? "background:var(--ink-2);opacity:.35;height:30%" : "height:0"}"></i>`).join("")}</div>
    <div class="hstripx"><span>6</span><span>9</span><span>12</span><span>15</span><span>18</span><span>21</span><span>24</span></div>
    <div class="hleg"><span><i style="background:var(--s3)"></i>niedrig</span><span><i style="background:#e6b800"></i>mittel</span><span><i style="background:var(--s2)"></i>erhöht</span><span><i style="background:var(--s8)"></i>hoch</span><span><i style="background:var(--ink-2);opacity:.35"></i>Bewegung</span></div>`;
}

/* ================= Erklärungen („i“) ================= */
const SRC = {
  paluch: ["Paluch et al. 2022, Lancet Public Health – Tägliche Schritte und Sterblichkeit (15 Kohorten)", "https://doaj.org/article/c3639c468b4348958202e52793ab979d"],
  arem: ["Arem et al. 2015, JAMA Internal Medicine – Freizeitaktivität und Sterblichkeit", "https://www.acc.org/latest-in-cardiology/articles/2015/08/07/12/01/leisure-time-physical-activity-and-mortality"],
  cappuccio: ["Cappuccio et al. 2010, Sleep – Schlafdauer und Sterblichkeit (Metaanalyse)", "https://wrap.warwick.ac.uk/5980/"],
  windred: ["Windred et al. 2024, Sleep – Schlafregelmäßigkeit und Sterblichkeit (UK Biobank)", "https://researchnow.flinders.edu.au/en/publications/sleep-regularity-is-a-stronger-predictor-of-mortality-risk-than-s/"],
  zhang: ["Zhang et al. 2016, CMAJ – Ruhepuls und Sterblichkeit (Metaanalyse)", "https://www.cmaj.ca/content/cmaj/188/3/e53.full.pdf"],
  kodama: ["Kodama et al. 2009, JAMA – Ausdauerfitness und Sterblichkeit", "https://www.eurekalert.org/news-releases/708046"],
  mandsager: ["Mandsager et al. 2018, JAMA Netw Open – Fitness ohne Obergrenze für den Nutzen", "https://www.tctmd.com/news/big-fitness-equals-big-survival-benefit-new-study-shows"],
  friend: ["Kaminsky et al. 2022, Mayo Clin Proc – VO₂max-Normwerte (FRIEND)", "https://www.sensai.fit/blog/vo2-max-by-age-chart-men-women"],
  gompertz: ["Gompertz-Gesetz: Sterberisiko verdoppelt sich etwa alle 8 Jahre", "https://en.wikipedia.org/wiki/Gompertz%E2%80%93Makeham_law_of_mortality"],
  whoopage: ["Whoop: Healthspan / WHOOP Age", "https://www.whoop.com//thelocker/how-healthspan-on-whoop-helps-you-optimize-longevity"],
  whoopstress: ["Whoop: Stress Monitor", "https://www.whoop.com/thelocker/introducing-stress-monitor-a-new-way-to-monitor-manage-stress/"],
  whooprec: ["Whoop: Wie Recovery funktioniert", "https://www.whoop.com/au/en/thelocker/how-does-whoop-recovery-work-101/"],
  oura: ["Oura: Readiness Score", "https://ouraring.com/blog/readiness-score/"],
  garmin: ["Garmin/Firstbeat: Body Battery und Stress", "https://the5krunner.com/garmin-features/sleep/body-battery/"]
};
const src = (...ks) => `<p class="small" style="margin:12px 0 4px"><strong>Quellen</strong></p><ul class="hsrc">${ks.map((k) => `<li><a href="${SRC[k][1]}" target="_blank" rel="noopener">${esc(SRC[k][0])}</a></li>`).join("")}</ul>`;
const HINFO = {
  bio: ["Mosaik-Alter", `
    <p>Schätzt, wie „alt“ dein Körper nach deinen Gewohnheiten und Messwerten wirkt – ähnlich wie WHOOP Age. Grundlage sind große Studien, die zeigen, wie stark einzelne Werte das Sterberisiko verändern (Hazard Ratio, HR).</p>
    <p><strong>Rechnung:</strong> Das Sterberisiko Erwachsener verdoppelt sich etwa alle 8 Jahre. Ein um den Faktor HR verändertes Risiko entspricht deshalb einer Alters-Verschiebung von</p>
    <p class="hform">Δ Jahre = ln(HR) / β, &nbsp; β = ln 2 / 8 ≈ 0,087</p>
    <p>Beispiel: Ruhepuls 75 statt 65 → HR = 1,09 → Δ = ln 1,09 / 0,087 ≈ +1,0 Jahre.</p>
    <p><strong>Werte (Ø der letzten 6 Monate) und ihr Bezug:</strong></p>
    <ul class="hul">
      <li><strong>Schritte</strong> – HR nach Paluch 2022 (3.553 → 1,0 · 5.801 → 0,60 · 7.842 → 0,55 · 10.901 → 0,47), dazwischen interpoliert, Bezug 7.000 Schritte, Nutzen flacht danach ab.</li>
      <li><strong>Training</strong> – Trainingsminuten pro Woche nach Arem 2015 (75 min → 0,80 · 150 → 0,69 · 300 → 0,63 · ab 450 → 0,61), Bezug 150 min; halb gewichtet, weil es sich mit den Schritten überschneidet.</li>
      <li><strong>Schlafdauer</strong> – 7–9 h neutral, kürzer bis HR 1,12 (5 h), länger bis 1,30 (10 h), nach Cappuccio 2010.</li>
      <li><strong>Schlafrhythmus</strong> – Schwankung der Schlafmitte (Standardabweichung); regelmäßig (± 30 min) HR 0,9, unregelmäßig (± 2 h) HR 1,5 – Näherung an Windred 2024 (regelmäßigste Gruppen 20–48 % geringeres Risiko).</li>
      <li><strong>Ruhepuls</strong> – HR 1,09 je 10 Schläge/min über 65 (Zhang 2016).</li>
      <li><strong>VO₂max</strong> – je 3,5 ml/kg/min (1 MET) über dem Median deines Alters und Geschlechts HR 0,87 (Kodama 2009, Normen FRIEND 2022).</li>
    </ul>
    <p>Jeder Beitrag ist auf −4 bis +6 Jahre begrenzt, die Summe auf −12 bis +15. <strong>Tempo:</strong> dieselbe Rechnung mit den letzten 30 Tagen; Tempo = 1 + (Δ<sub>30 Tage</sub> − Δ<sub>6 Monate</sub>) / 3, begrenzt auf −1× bis 3× (wie Whoops „Pace of Aging“).</p>
    <p class="muted small">Grenzen: Die Studien zeigen Zusammenhänge in großen Gruppen, nicht Ursache und Wirkung für dich persönlich. Die Effekte überschneiden sich teilweise. Ein Richtwert für deine Gewohnheiten, keine Diagnose.</p>
    ${src("gompertz", "paluch", "arem", "cappuccio", "windred", "zhang", "kodama", "mandsager", "friend", "whoopage")}`],
  rec: ["Erholung", `
    <p>Wie gut dein Körper heute erholt ist – ähnlich Whoop Recovery und Oura Readiness. Entscheidend ist nicht der absolute Wert, sondern die <strong>Abweichung von deinem eigenen Normal</strong> der letzten 30 Tage.</p>
    <ul class="hul">
      <li><strong>HRV</strong> (55 %): z = (ln HRV<sub>heute</sub> − Ø ln HRV) / Streuung – höher ist besser.</li>
      <li><strong>Ruhepuls</strong> (25 %): z = −(Ruhepuls − Ø) / Streuung – niedriger ist besser.</li>
      <li><strong>Schlaf</strong> (20 %): Anteil vom Bedarf (${SLEEP_NEED} h), z = (Anteil − 0,85) / 0,1.</li>
    </ul>
    <p class="hform">s = gewichtete Summe der z-Werte, &nbsp; Erholung = 100 / (1 + e<sup>−1,2·(s + 0,25)</sup>)</p>
    <p>Ein normaler Tag ergibt etwa 57 %. Farben wie bei Whoop: grün ab 67 %, gelb 34–66 %, rot bis 33 %. Fehlt ein Wert, zählen die übrigen anteilig.</p>
    <p><strong>Körper-Check</strong> (ähnlich Whoops „Health Monitor“): Hinweis, wenn Ruhepuls oder Atemfrequenz mehr als 2 Standardabweichungen über bzw. die HRV mehr als 2 darunter liegt – das kommt z. B. bei beginnender Erkältung, nach Alkohol oder wenig Schlaf vor.</p>
    <p class="muted small">Die Apple Watch misst HRV als SDNN (Whoop: RMSSD); weil nur mit deinem eigenen Normal verglichen wird, spielt das kaum eine Rolle. Die Gewichtung ist von Mosaik gewählt – die Hersteller veröffentlichen ihre Formeln nicht.</p>
    ${src("whooprec", "oura")}`],
  stress: ["Stress", `
    <p>Rückwirkend aus dem Pulsverlauf des Tages – wie Whoops Stress Monitor, nur im Nachhinein.</p>
    <ol class="hul">
      <li>Der Tag wird in 15-Minuten-Fenster geteilt, je Fenster der Ø Puls.</li>
      <li><strong>Ausgenommen</strong> sind Schlaf (zwischen Einschlaf- und Aufwachzeit), Trainings und Stunden mit mehr als 1.200 Schritten – ein hoher Puls beim Sport ist kein Stress.</li>
      <li>Dein <strong>Normal</strong>: Median m und Streuung s (robust: 1,4826 × mittlere absolute Abweichung, mindestens 3/min) aller ruhigen Wachfenster der letzten 14 Tage.</li>
      <li>Je Fenster: <span class="hform">z = (Ø Puls − m) / s, &nbsp; Stress = z begrenzt auf 0–3</span></li>
      <li>Tageswert = Ø aller ruhigen Wachfenster; liegt die HRV des Tages mehr als 1 Standardabweichung unter deinem Normal, +0,25.</li>
    </ol>
    <p>0–0,75 niedrig · bis 1,5 mittel · bis 2,25 erhöht · darüber hoch.</p>
    <p class="muted small">Grenzen: Koffein, Wärme, Krankheit oder Aufregung heben den Puls genauso. Bewegung ohne Training wird nur über die Schritte je Stunde erkannt. Zwischen zwei Messungen der Watch (in Ruhe etwa alle 4–10 Minuten) gibt es keine Werte.</p>
    ${src("whoopstress", "garmin")}`],
  strain: ["Belastung", `
    <p>Wie stark dein Herz-Kreislauf-System am Tag gefordert war – ähnlich Whoop Strain (0–21).</p>
    <p><strong>Edwards-TRIMP:</strong> Minuten in den Pulszonen (in % des Maximalpulses) mal Zonennummer:</p>
    <p class="hform">50–60 % ×1 · 60–70 % ×2 · 70–80 % ×3 · 80–90 % ×4 · 90–100 % ×5</p>
    <p>Maximalpuls nach Tanaka: 208 − 0,7 × Alter${ageNow() ? ` = ${Math.round(hrMax())}/min` : ""}. Abstand zwischen zwei Messungen zählt höchstens 10 Minuten.</p>
    <p class="hform">Belastung = 21 · (1 − e<sup>−TRIMP/190</sup>)</p>
    <p>Wie bei Whoop wird es nach oben immer schwerer: 60 Minuten in Zone 3 (TRIMP 180) ergeben etwa 13. Unter 7 leicht · bis 11 moderat · bis 15 hoch · bis 18 sehr hoch.</p>
    <p class="muted small">Die Abbildung auf 0–21 ist von Mosaik gewählt; Whoop veröffentlicht seine Formel nicht.</p>
    ${src("whooprec")}`],
  sleep: ["Schlaf", `
    <ul class="hul">
      <li><strong>Ø Schlafdauer</strong> der letzten 7 Nächte, ▲/▼ im Vergleich zu den 7 Nächten davor.</li>
      <li><strong>Schlafschuld</strong>: Summe der fehlenden Stunden zum Bedarf von ${SLEEP_NEED} h über 7 Nächte.</li>
      <li><strong>Rhythmus</strong>: Standardabweichung der Schlafmitte (Mitte zwischen Einschlafen und Aufwachen) über 14 Nächte. Bis ± 30 min sehr regelmäßig, bis 45 regelmäßig, bis 75 schwankend.</li>
    </ul>
    <p>Regelmäßigkeit ist laut UK-Biobank-Studie ein stärkerer Hinweis auf das Sterberisiko als die Schlafdauer.</p>
    ${src("windred", "cappuccio", "oura")}`],
  fit: ["Fitness", `
    <p>VO₂max ist die maximale Sauerstoffaufnahme – das beste Einzelmaß für Ausdauerfitness. Die Apple Watch schätzt sie als „Cardiofitness“ beim Gehen oder Laufen draußen.</p>
    <p><strong>Vergleich:</strong> Median der FRIEND-Normwerte (Laufband-Tests, 2022) für dein Alter und Geschlecht. <strong>Fitness-Alter:</strong> das Alter, in dem dein Wert dem Median entspricht.</p>
    <p>Je 3,5 ml/kg/min (1 MET) mehr ist das Sterberisiko um etwa 13 % geringer (Kodama 2009); in der Cleveland-Clinic-Studie hatten die Fittesten ein 5-fach geringeres Risiko als die am wenigsten Fitten (Mandsager 2018).</p>
    ${src("friend", "kodama", "mandsager")}`]
};
function openHealthInfo(k) {
  const [title, html] = HINFO[k];
  const dlg = $("#sheet");
  dlg.innerHTML = `<div class="sheet-inner hinfo-sheet"><div class="sheet-head"><span></span><h2>${esc(title)}</h2><button type="button" class="linkbtn" id="hidone">Fertig</button></div>${html}</div>`;
  $("#hidone", dlg).addEventListener("click", () => dlg.close());
  dlg.showModal();
  document.activeElement?.blur();
}

/* ================= Einrichtung (Kurzbefehl) ================= */
function openHealthSetup() {
  const have = (k) => hq(k) && Object.values(state.answers).some((a) => typeof a[hq(k).id] === "number");
  const series = (k) => Object.keys(HD()[k]).length;
  const row = (ok, name, keys, how) => `<li class="${ok ? "ok" : ""}"><span>${ok ? "✓" : "○"}</span><div><strong>${name}</strong> <code>${keys}</code><br><span class="muted small">${how}</span></div></li>`;
  const dlg = $("#sheet");
  dlg.innerHTML = `<div class="sheet-inner"><div class="sheet-head"><span></span><h2>Daten einrichten</h2><button type="button" class="linkbtn" id="hsdone">Fertig</button></div>
    <p class="small">Ergänze deinen Kurzbefehl (Einstellungen → Schnittstelle Apple Health) um diese Felder. Jeweils <strong>Health-Messungen suchen</strong> mit dem Typ, dann im Schritt „Inhalte von URL abrufen“ zwei Array-Felder: Wert und Startdatum (ISO 8601).</p>
    <ul class="hsetup">
      ${row(have("schritte"), "Schritte", "schritte, schritte_datum", "schon eingerichtet – Gruppieren nach Stunde (oder Tag)")}
      ${row(have("schlaf"), "Schlaf", "schlaf_start, schlaf_ende, schlaf_wert", "schon eingerichtet")}
      ${row(have("ruhepuls"), "Ruhepuls", "ruhepuls, ruhepuls_datum", "Typ Ruheherzfrequenz · letzte 7 Tage · Gruppieren nach Tag")}
      ${row(have("hrv"), "HRV", "hrv, hrv_datum", "Typ Herzfrequenzvariabilität · letzte 7 Tage · Gruppieren nach Tag")}
      ${row(have("training"), "Trainingsminuten", "training, training_datum", "Typ Trainingsminuten · letzte 7 Tage · <em>nicht</em> gruppieren, Limit aus – Tagessumme und Uhrzeiten rechnet Mosaik selbst (nach Tag gruppiert geht auch)")}
      ${row(have("vo2max"), "VO₂max", "vo2max, vo2max_datum", "Typ Cardiofitness · letzte 30 Tage")}
      ${row(have("atemfrequenz"), "Atemfrequenz (optional)", "atemfrequenz, atemfrequenz_datum", "Typ Atemfrequenz · letzte 7 Tage · Gruppieren nach Tag")}
      ${row(series("hr") > 0, "Pulsverlauf", "puls, puls_datum", "Typ Herzfrequenz · letzte 2 Tage · <em>nicht</em> gruppieren, Limit aus – für Stress und Belastung")}
      ${row(series("st") > 0, "Schritte je Stunde", "schritte, schritte_datum", "bei den Schritten Gruppieren nach <em>Stunde</em> statt Tag – Tagessumme rechnet Mosaik selbst, der Verlauf erkennt Bewegung")}
      ${row(series("wo") > 0, "Trainingszeiten", "aus training oder workout_start, workout_ende", "kommt automatisch, wenn die Trainingsminuten ungruppiert sind – sonst Typ Trainings · letzte 2 Tage · Start- und Enddatum")}
    </ul>
    <p class="muted small">Der Kurzbefehl läuft wie bisher täglich (z. B. 10 Uhr). Mosaik holt die Werte beim Öffnen ab. Pulsverläufe werden 60 Tage behalten, alles bleibt auf dem iPhone und in deiner Sicherung.</p>
  </div>`;
  $("#hsdone", dlg).addEventListener("click", () => dlg.close());
  dlg.showModal();
  document.activeElement?.blur();
}
