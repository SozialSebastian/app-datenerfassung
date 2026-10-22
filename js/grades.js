/* Mosaik – Vorlage „Bouldergrad“: Fb-Grade (Fontainebleau) als gemeinsame Skala, je Halle die eigene Stufe daneben */
"use strict";

// Fb-Skala von leicht nach schwer (jeder Grad eine Antwort)
const FB_GRADES = ["bis 3b", "3c", "4a", "4b", "4c", "5a", "5b", "5c", "6a", "6a+", "6b", "6b+", "6c", "6c+", "7a", "7a+", "7b", "7b+", "7c", "7c+", "8a", "8a+", "8b"];
// Startwerte der Hallen-Zuordnung (im Fragen-Editor änderbar). Stufe gilt für alle Fb-Grade von „von“ bis „bis“.
const lv = (l, from, to = from) => ({ l, from, to });
const GRADE_HALLS = () => [
  { name: "Boulderwelt", levels: [lv("1", "bis 3b"), lv("2", "3c", "4b"), lv("3", "4c", "5a"), lv("4", "5b", "5c"), lv("5", "6a", "6a+"), lv("6", "6b", "6b+"), lv("7", "6c", "6c+"), lv("8", "7a", "7b"), lv("9", "7b+", "8b")] },
  { name: "FLASHH", levels: [lv("Weiß", "bis 3b", "3c"), lv("Gelb", "4a", "4c"), lv("Grün", "5a", "5c"), lv("Blau", "6a", "6b"), lv("Rot", "6b+", "6c+"), lv("Schwarz", "7a", "7b"), lv("Lila", "7b+", "8b")] },
  { name: "urban apes", levels: [lv("1", "bis 3b", "3c"), lv("2", "4a", "4b"), lv("3", "4c", "5a"), lv("4", "5b", "5c"), lv("5", "6a", "6a+"), lv("6", "6b", "6c"), lv("7", "6c+", "7a+"), lv("8", "7b", "8b")] }
];
const isGradeQ = (q) => q && q.type === "choice" && Array.isArray(q.halls);
// Hallen-Stufen zu einem Fb-Grad, z. B. [{ hall: "Boulderwelt", l: "5" }, { hall: "FLASHH", l: "Blau" }]
function gradeHints(q, g) {
  const i = FB_GRADES.indexOf(g);
  if (i < 0) return [];
  const out = [];
  for (const h of q.halls || []) {
    const hit = h.levels.filter((x) => FB_GRADES.indexOf(x.from) <= i && i <= FB_GRADES.indexOf(x.to)).map((x) => x.l);
    if (hit.length) out.push({ hall: h.name, l: hit.join("/") });
  }
  return out;
}
// Farbnamen der Hallen als Punkt anzeigen
const GRADE_COLORS = { weiß: "#f4f1ee", weiss: "#f4f1ee", gelb: "#f2c200", grün: "#2fa84f", gruen: "#2fa84f", blau: "#2a78d6", rot: "#e0412f", schwarz: "#1c2a39", lila: "#8a4fd6", violett: "#8a4fd6", orange: "#f28c28", pink: "#e87ba4", grau: "#9a948e" };
const gradeLabel = (l) => { const c = GRADE_COLORS[String(l).toLowerCase()]; return c ? `<i class="gcol" style="background:${c}"></i>${esc(l)}` : esc(l); };

// Antwortliste als Tabelle: Fb-Grad, daneben je Halle eine Spalte mit ihrer Stufe (Kopfzeile mit den Hallennamen)
function gradeInput(q, val) {
  const sel = (o) => (q.multi ? Array.isArray(val) && val.includes(o) : val === o);
  const halls = q.halls || [];
  const cols = `style="--gc:${halls.length}"`;
  const cell = (h, g) => { const i = FB_GRADES.indexOf(g); const hit = h.levels.filter((x) => FB_GRADES.indexOf(x.from) <= i && i <= FB_GRADES.indexOf(x.to)).map((x) => x.l); return hit.length ? hit.map(gradeLabel).join(" / ") : "–"; };
  return `<div class="grades" ${cols}>
    <div class="ghd"><span>Fb</span>${halls.map((h) => `<span>${esc(h.name)}</span>`).join("")}</div>
    ${q.options.map((o) => `<button class="chip grade" data-val="${esc(o)}" aria-pressed="${sel(o)}"><b>${esc(o)}</b>${halls.map((h) => `<span>${cell(h, o)}</span>`).join("")}</button>`).join("")}
  </div>${q.multi ? `<p class="q-hint">Mehrere möglich</p>` : ""}`;
}

// Vorlage: als Folgefrage zu „Warst du bouldern?“, falls vorhanden
function gradeMake() {
  const parent = state.questions.find((q) => !q.archived && q.type === "choice" && q.options.includes("Ja") && /boulder/i.test(q.text) && !q.cond);
  return [{ id: uid(), text: "Schwerster Boulder heute?", type: "choice", options: [...FB_GRADES], multi: false, min: 1, max: 5, minLabel: "", maxLabel: "", unit: "", healthKey: "", archived: false,
    cond: parent ? { qid: parent.id, values: ["Ja"] } : null, theme: parent ? undefined : "sport", template: "grade", halls: GRADE_HALLS() }];
}

// Editor: Hallen und ihre Stufen (Fb von–bis) bearbeiten
function gradeEditorHtml(d) {
  if (!isGradeQ(d)) return "";
  const opt = (v) => FB_GRADES.map((g) => `<option ${g === v ? "selected" : ""}>${esc(g)}</option>`).join("");
  return `<details class="adv" open>
    <summary>Hallen-Zuordnung (Fb-Grade je Stufe)</summary>
    <p class="muted small" style="margin:8px 0">Jede Stufe einer Halle gilt für die Fb-Grade von … bis. Neben jedem Grad steht dann die passende Stufe jeder Halle.</p>
    ${d.halls.map((h, hi) => `<div class="ghall">
      <div class="ghead"><input class="gname" data-hname="${hi}" value="${esc(h.name)}" placeholder="Name der Halle" autocomplete="off"><button type="button" class="iconbtn" data-hdel="${hi}" aria-label="Halle entfernen">✕</button></div>
      ${h.levels.map((x, li) => `<div class="glv">
        <input data-lvl="${hi}:${li}" value="${esc(x.l)}" placeholder="Stufe" autocomplete="off">
        <select data-lfrom="${hi}:${li}">${opt(x.from)}</select><span class="muted">–</span><select data-lto="${hi}:${li}">${opt(x.to)}</select>
        <button type="button" class="iconbtn" data-ldel="${hi}:${li}" aria-label="Stufe entfernen">✕</button>
      </div>`).join("")}
      <button type="button" class="linkbtn" data-ladd="${hi}">Stufe hinzufügen</button>
    </div>`).join("")}
    <button type="button" class="btn ghost block" id="hadd" style="margin-top:8px">Halle hinzufügen</button>
  </details>`;
}
function gradeEditorSync(d, dlg) {
  if (!isGradeQ(d)) return;
  dlg.querySelectorAll("[data-hname]").forEach((i) => (d.halls[+i.dataset.hname].name = i.value));
  dlg.querySelectorAll("[data-lvl]").forEach((i) => { const [h, l] = i.dataset.lvl.split(":").map(Number); d.halls[h].levels[l].l = i.value; });
  dlg.querySelectorAll("[data-lfrom]").forEach((i) => { const [h, l] = i.dataset.lfrom.split(":").map(Number); d.halls[h].levels[l].from = i.value; });
  dlg.querySelectorAll("[data-lto]").forEach((i) => { const [h, l] = i.dataset.lto.split(":").map(Number); d.halls[h].levels[l].to = i.value; });
}
function gradeEditorWire(d, dlg, sync, draw) {
  if (!isGradeQ(d)) return;
  const act = (sel, fn) => dlg.querySelectorAll(sel).forEach((b) => b.addEventListener("click", () => { sync(); fn(b); draw(); }));
  act("[data-hdel]", (b) => d.halls.splice(+b.dataset.hdel, 1));
  act("[data-ldel]", (b) => { const [h, l] = b.dataset.ldel.split(":").map(Number); d.halls[h].levels.splice(l, 1); });
  act("[data-ladd]", (b) => { const h = d.halls[+b.dataset.ladd]; const last = h.levels[h.levels.length - 1]; const i = last ? Math.min(FB_GRADES.indexOf(last.to) + 1, FB_GRADES.length - 1) : 0; h.levels.push(lv("", FB_GRADES[i])); });
  act("#hadd", () => d.halls.push({ name: "", levels: [lv("", FB_GRADES[0])] }));
}
// beim Sichern: leere Stufen/Hallen weg, „bis“ nie vor „von“
function gradeEditorClean(d) {
  if (!isGradeQ(d)) return;
  d.halls = d.halls.map((h) => ({ name: h.name.trim(), levels: h.levels.filter((x) => String(x.l).trim()).map((x) => {
    const a = FB_GRADES.indexOf(x.from), b = FB_GRADES.indexOf(x.to);
    return { l: String(x.l).trim(), from: FB_GRADES[Math.min(a, b)], to: FB_GRADES[Math.max(a, b)] };
  }) })).filter((h) => h.name && h.levels.length);
}
