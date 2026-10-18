/* Mosaik – Grafik erstellen (PNG) */
"use strict";

/* ================= Grafik erstellen (PNG) ================= */
// Bausteine, die als Bild gespeichert werden können – immer vollständig aufgeklappt
function withAllOpen(fn) {
  const keep = [showAllTrends, showAllGoals, showAllFriendChanges];
  showAllTrends = showAllGoals = showAllFriendChanges = true;
  try { return fn(); } finally { [showAllTrends, showAllGoals, showAllFriendChanges] = keep; }
}
const fileSafe = (s) => s.replace(/[^\wäöüÄÖÜß-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "Grafik";

function exportItems() {
  const items = [];
  const f = F();
  if (f.list.length) {
    items.push({ id: "fsum", group: "Freunde", label: `Übersicht und Quoten (${f.list.length} Freunde)`, file: "Freunde_Uebersicht", html: () => friendsSummaryHtml() });
    if (f.history.length) items.push({ id: "fchg", group: "Freunde", label: "Veränderung zum vorigen Stichtag", file: "Freunde_Veraenderung", html: () => withAllOpen(friendChangesPanel) });
    if (meetStats()) items.push({ id: "fmeet", group: "Freunde", label: "Treffen (wen wann zuletzt)", file: "Freunde_Treffen", html: () => { const k = showAllMeets; showAllMeets = true; try { return meetsPanel(); } finally { showAllMeets = k; } } });
    items.push({ id: "flist", group: "Freunde", label: "Liste nach Kategorien", file: "Freunde_Liste", html: () => friendsListHtml() });
  }
  if (state.questions.length) {
    const days = rangeDays(exportRange);
    const range = rangeLabel(exportRange);
    items.push({ id: "trends", group: "Analyse", label: `Trends (${range})`, file: "Trends", html: () => withAllOpen(() => trendsPanel(days)) });
    if (goalItems().length) items.push({ id: "goals", group: "Analyse", label: "Ziele", file: "Ziele", html: () => withAllOpen(goalsPanel) });
    if (Object.keys(state.places || {}).length) items.push({ id: "places", group: "Analyse", label: `Orte (${range})`, file: "Orte", html: () => { const k = showAllPlaces; showAllPlaces = true; try { return placesPanel(days); } finally { showAllPlaces = k; } } });
    analysisQuestions(days).filter((q) => !qset(q).hidden).forEach((q) =>
      items.push({ id: "q:" + q.id, group: "Analyse", label: `${q.text} (${range})`, file: fileSafe(q.text), html: () => analysisCard(q, days) }));
    const wk = reportDefaultWeek();
    items.push({ id: "report", group: "Wochenbericht", label: `Wochenbericht KW ${kw(wk)}`, file: `Wochenbericht_KW${kw(wk)}`, html: () => `<div class="report">${reportHtml(wk)}</div>` });
  }
  return items;
}

let exportSel = new Set();
let exportRange = null; // eigener Zeitraum für Grafiken, startet mit dem der Analyse
function openExport() {
  const dlg = $("#sheet");
  if (!exportRange) exportRange = prefs.range;
  let items = exportItems();
  exportSel = new Set([...exportSel].filter((id) => items.some((x) => x.id === id)));
  const draw = () => {
    const groups = [...new Set(items.map((x) => x.group))];
    dlg.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><button type="button" class="linkbtn" id="xclose">Schließen</button><h2>Grafik erstellen</h2><span></span></div>
      ${items.length ? `
      <div class="field" style="font-weight:600;font-size:15px;margin-bottom:8px">Zeitraum für Analyse-Grafiken</div>
      ${rangeControl(exportRange, "xr")}
      <div class="xbar"><button type="button" class="linkbtn" id="xall">${exportSel.size === items.length ? "Keine auswählen" : "Alle auswählen"}</button><span class="muted small">${exportSel.size} ausgewählt</span></div>
      ${groups.map((g) => `<section class="sq"><strong>${g}</strong>
        ${items.filter((x) => x.group === g).map((x) => `<label class="xrow"><input type="checkbox" data-xid="${esc(x.id)}" ${exportSel.has(x.id) ? "checked" : ""}><span>${esc(x.label)}</span></label>`).join("")}
      </section>`).join("")}
      <p class="muted small">Bilder sind immer hell mit weißem Hintergrund, damit sie in Präsentationen passen.</p>
      <button type="button" class="btn block hold-btn" id="xgo" ${exportSel.size ? "" : "disabled"}>${exportSel.size > 1 ? `${exportSel.size} Bilder erstellen` : "Bild erstellen"}</button>`
      : `<p class="muted">Noch nichts da. Leg zuerst Fragen oder Freunde an.</p>`}
    </div>`;
    $("#xclose", dlg).addEventListener("click", () => dlg.close());
    wireRange(dlg, "xr", (k) => {
      exportRange = k;
      // Auswahl behalten: Kennungen ändern sich durch den Zeitraum nicht
      items = exportItems();
      const keep = dlg.querySelector(".sheet-inner").scrollTop;
      draw(); dlg.querySelector(".sheet-inner").scrollTop = keep;
    });
    $("#xall", dlg)?.addEventListener("click", () => { exportSel = exportSel.size === items.length ? new Set() : new Set(items.map((x) => x.id)); draw(); });
    dlg.querySelectorAll("[data-xid]").forEach((c) => c.addEventListener("change", () => { if (c.checked) exportSel.add(c.dataset.xid); else exportSel.delete(c.dataset.xid); draw(); }));
    $("#xgo", dlg)?.addEventListener("click", () => makeImages(items.filter((x) => exportSel.has(x.id))));
  };
  draw();
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

// Bibliothek erst bei Bedarf laden
function loadScreenshotLib() {
  if (window.modernScreenshot) return Promise.resolve();
  return new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "vendor/modern-screenshot.min.js";
    sc.onload = () => res(); sc.onerror = () => rej(new Error("Grafik-Funktion konnte nicht geladen werden"));
    document.head.appendChild(sc);
  });
}

async function makeImages(list) {
  const dlg = $("#sheet");
  const inner = dlg.querySelector(".sheet-inner");
  const go = $("#xgo", dlg);
  if (go) { go.disabled = true; go.textContent = "Erstelle …"; }
  const out = [];
  try {
    await loadScreenshotLib();
    const stage = document.createElement("div");
    stage.className = "export-stage";
    document.body.appendChild(stage);
    const stamp = fdate(todayIso());
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (go) go.textContent = `Erstelle ${i + 1} von ${list.length} …`;
      stage.innerHTML = `<div class="export-card">${it.html()}<p class="export-foot">Mosaik · ${stamp}</p></div>`;
      const node = stage.firstElementChild;
      await new Promise((r) => requestAnimationFrame(() => r()));
      const url = await modernScreenshot.domToPng(node, { scale: 3, backgroundColor: "#FFFFFF" });
      const blob = await (await fetch(url)).blob();
      out.push({ name: `Mosaik_${it.file}_${todayIso()}.png`, url, blob, label: it.label });
    }
    stage.remove();
  } catch (e) {
    console.error(e);
    document.querySelector(".export-stage")?.remove();
    toast(e.message || "Bild konnte nicht erstellt werden");
    if (go) { go.disabled = false; go.textContent = "Nochmal versuchen"; }
    return;
  }
  // Ergebnis: Vorschau und Sichern (eigener Tipp nötig, sonst blockiert iOS das Teilen)
  inner.innerHTML = `<div class="sheet-head"><button type="button" class="linkbtn" id="xback">Zurück</button><h2>${out.length} Bild${out.length > 1 ? "er" : ""}</h2><button type="button" class="linkbtn" id="xclose">Fertig</button></div>
    <button type="button" class="btn block hold-btn" id="xshare">${out.length > 1 ? "Alle sichern oder teilen" : "Sichern oder teilen"}</button>
    <p class="muted small">„Bilder sichern“ legt sie in Fotos ab. Einzelne Bilder kannst du auch lange drücken.</p>
    <div class="xprev">${out.map((o, i) => `<figure><img src="${o.url}" alt="${esc(o.label)}"><figcaption><span>${esc(o.label)}</span><button type="button" class="linkbtn" data-xone="${i}">Einzeln</button></figcaption></figure>`).join("")}</div>`;
  $("#xclose", inner).addEventListener("click", () => dlg.close());
  $("#xback", inner).addEventListener("click", () => openExport());
  const share = async (files) => {
    const fs = files.map((o) => new File([o.blob], o.name, { type: "image/png" }));
    if (navigator.canShare && navigator.canShare({ files: fs })) {
      try { await navigator.share({ files: fs }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    // Fallback: einzeln herunterladen
    for (const o of files) {
      const a = document.createElement("a");
      a.href = o.url; a.download = o.name; document.body.appendChild(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  $("#xshare", inner).addEventListener("click", () => share(out));
  inner.querySelectorAll("[data-xone]").forEach((b) => b.addEventListener("click", () => share([out[+b.dataset.xone]])));
  inner.scrollTop = 0;
}
