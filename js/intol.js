/* Mosaik – Vorlage „Unverträglichkeiten“: Lebensmittel + Bauchprobleme, Auswertung in einer Kachel */
"use strict";

// Antwort → mögliche Unverträglichkeit (mehrere Antworten können auf dieselbe zeigen)
const INTOL_FOODS = [
  ["Milch, Joghurt, Quark, Sahne", "Laktose"],
  ["Weichkäse, Frischkäse", "Laktose"],
  ["Gereifter Käse (Parmesan, Gouda alt)", "Histamin"],
  ["Salami, Schinken, Geräuchertes", "Histamin"],
  ["Rotwein, Sekt, Bier", "Histamin"],
  ["Tomaten, Spinat, Aubergine", "Histamin"],
  ["Sauerkraut, Essig, Fermentiertes", "Histamin"],
  ["Fisch, Thunfisch, Meeresfrüchte", "Histamin"],
  ["Äpfel, Birnen, Mango", "Fruktose"],
  ["Saft, Trockenobst, Honig", "Fruktose"],
  ["Steinobst (Pflaumen, Kirschen, Pfirsich)", "Sorbit"],
  ["Zuckerfreie Süßigkeiten, Kaugummi", "Sorbit"],
  ["Weizen (Brot, Nudeln, Gebäck)", "Gluten / Weizen"],
  ["Roggen, Gerste, Dinkel", "Gluten / Weizen"],
  ["Zwiebeln, Knoblauch, Lauch", "FODMAP (Fruktane)"],
  ["Hülsenfrüchte (Linsen, Bohnen, Kichererbsen)", "FODMAP (Galaktane)"],
  ["Kohl (Brokkoli, Blumenkohl, Rosenkohl)", "FODMAP / Blähendes"],
  ["Nüsse, Erdnüsse", "Nüsse (Allergie?)"],
  ["Ei", "Ei (Allergie?)"],
  ["Soja", "Soja (Allergie?)"],
  ["Kaffee, Energydrinks", "Koffein"],
  ["Alkohol (sonstiger)", "Alkohol"],
  ["Scharfes Essen", "Scharfes (Capsaicin)"],
  ["Fettiges, Frittiertes", "Fett"],
  ["Sprudel, Softdrinks", "Kohlensäure"],
  ["Fertiggerichte, Fast Food", "Zusatzstoffe (z. B. Glutamat)"]
];
const INTOL_NONE = "Nichts davon";
const INTOL_TPL = ["intol-food", "intol-belly", "intol-symptoms", "intol-strength"];
const isIntolQ = (q) => INTOL_TPL.includes(q.template);
const intolQ = (t) => state.questions.find((q) => q.template === t && !q.archived);

// Vorlage: Lebensmittel (Mehrfachauswahl), Bauchprobleme (Ja/Nein) mit Folgefragen
function intolMake() {
  const base = { multi: false, min: 1, max: 5, minLabel: "", maxLabel: "", unit: "", healthKey: "", archived: false, cond: null };
  const food = { ...base, id: uid(), text: "Was davon hast du heute gegessen oder getrunken?", type: "choice", multi: true, options: [...INTOL_FOODS.map(([o]) => o), INTOL_NONE], theme: "food", template: "intol-food" };
  const belly = { ...base, id: uid(), text: "Hattest du heute Bauchprobleme?", type: "choice", options: ["Ja", "Nein"], theme: "health", template: "intol-belly" };
  const sym = { ...base, id: uid(), text: "Welche Beschwerden?", type: "choice", multi: true, options: ["Blähungen", "Bauchschmerzen", "Durchfall", "Übelkeit", "Sodbrennen", "Verstopfung", "Kopfschmerzen", "Hautreaktion"], cond: { qid: belly.id, values: ["Ja"] }, template: "intol-symptoms" };
  const str = { ...base, id: uid(), text: "Wie stark?", type: "scale", minLabel: "leicht", maxLabel: "heftig", cond: { qid: belly.id, values: ["Ja"] }, template: "intol-strength" };
  return [food, belly, sym, str];
}

/* ---------- Auswertung ---------- */
// Je Tag mit Bauch-Antwort: „betroffen“, wenn das Lebensmittel heute oder gestern gegessen wurde
// (viele Reaktionen kommen verzögert). Vergleich: Beschwerden an betroffenen gegen übrige Tage.
function intolAnalyse() {
  const fq = intolQ("intol-food"), bq = intolQ("intol-belly");
  if (!fq || !bq) return null;
  const A = state.answers;
  const belly = (d) => { const v = (A[d] || {})[bq.id]; return v === "Ja" ? true : v === "Nein" ? false : null; };
  const ate = (d) => { const v = (A[d] || {})[fq.id]; return Array.isArray(v) ? v : null; };
  const days = Object.keys(A).sort().filter((d) => ate(d) && belly(d) !== null);
  const groups = {};
  INTOL_FOODS.forEach(([f, g]) => (groups[g] ||= []).push(f));
  const out = [];
  for (const [g, foods] of Object.entries(groups)) {
    let n1 = 0, k1 = 0, n0 = 0, k0 = 0;
    const per = {};
    for (const d of days) {
      const today = ate(d), yest = ate(addDays(d, -1)) || [];
      const eaten = foods.filter((f) => today.includes(f) || yest.includes(f));
      const p = belly(d);
      if (eaten.length) { n1++; if (p) k1++; eaten.forEach((f) => { per[f] ||= [0, 0]; per[f][0]++; if (p) per[f][1]++; }); }
      else { n0++; if (p) k0++; }
    }
    if (n1 < 4 || n0 < 4) continue;
    const p1 = k1 / n1, p0 = k0 / n0;
    // Verdacht: deutlich häufiger Beschwerden (mind. 25 Prozentpunkte mehr und mindestens doppelt so oft)
    if (k1 >= 3 && p1 - p0 >= 0.25 && p1 >= 2 * p0) out.push({ g, n1, k1, n0, k0, p1, p0, foods: Object.entries(per).filter(([, [, k]]) => k > 0).sort((a, b) => b[1][1] / b[1][0] - a[1][1] / a[1][0]) });
  }
  out.sort((a, b) => (b.p1 - b.p0) - (a.p1 - a.p0));
  return { days: days.length, bad: days.filter((d) => belly(d)).length, found: out };
}

function intolPanel() {
  const r = intolAnalyse();
  if (!r) return "";
  const MIN = 14;
  let body;
  if (r.days < MIN) {
    body = `<p class="hero"><span class="big">${r.days}</span><span class="muted">von mind. ${MIN} Tagen erfasst</span></p>
      <p class="muted small" style="margin:0">Für eine Auswertung braucht es Tage mit beiden Fragen: was du gegessen hast und ob du Bauchprobleme hattest. Ab etwa zwei Wochen werden erste Verdachtsfälle sichtbar.</p>`;
  } else if (!r.found.length) {
    body = `<p class="iok"><span class="ibadge ok">✓</span><span><strong>Keine Unverträglichkeit erkannt</strong><br><span class="muted small">${r.days} Tage ausgewertet, an ${r.bad} davon Bauchprobleme. Kein Lebensmittel fällt deutlich auf.</span></span></p>`;
  } else {
    body = `<p class="small muted" style="margin:0 0 10px">${r.days} Tage ausgewertet · Lebensmittel vom selben Tag oder Vortag</p>
      <ul class="ilist">${r.found.map((x) => `<li>
        <div class="itop"><span class="ibadge warn">!</span><strong>Verdacht: ${esc(x.g)}</strong></div>
        <p class="small" style="margin:4px 0 0">An ${x.n1} Tagen mit (oder nach) diesen Lebensmitteln <strong>${x.k1}×</strong> Beschwerden (${Math.round(x.p1 * 100)} %), sonst an ${x.k0} von ${x.n0} (${Math.round(x.p0 * 100)} %).</p>
        <p class="muted small" style="margin:2px 0 0">Am häufigsten nach: ${x.foods.slice(0, 3).map(([f, [n, k]]) => `${esc(f)} (${k} von ${n})`).join(", ")}</p>
      </li>`).join("")}</ul>
      <p class="muted small" style="margin:10px 0 0">Ein Hinweis, keine Diagnose. Bei anhaltenden Beschwerden ärztlich abklären lassen.</p>`;
  }
  return `<section class="panel acard intol"><h2 class="atitle">Unverträglichkeiten</h2>${body}</section>`;
}
