/* Mosaik – Excel, Sicherung, Health-Text */
"use strict";

async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } // ohne Titel, sonst speichert iOS eine zweite Textdatei
    catch (e) { if (e.name === "AbortError") return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

function buildWorkbook() {
  const qs = ordered().map((o) => o.q); // alle, auch ausgeblendete; Folgefragen hinter ihrer Ausgangsfrage
  const days = Array.from(new Set([...Object.keys(state.answers), ...Object.keys(state.places || {})])).sort();
  const header = ["Datum", "Wochentag", ...qs.map((q) => q.text + (q.type === "number" && q.unit ? ` (${q.unit})` : "")), "Orte"];
  const rows = [header];
  // Jeder Kalendertag vom ersten bis zum letzten Eintrag – unbeantwortete Tage bleiben leer
  if (days.length) {
    for (let d = days[0]; d <= days[days.length - 1]; d = addDays(d, 1)) {
      const a = state.answers[d] || {};
      const dt = parseIso(d);
      rows.push([
        (Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) - Date.UTC(1899, 11, 30)) / 864e5, // Excel-Datumszahl
        WD[dt.getDay()],
        ...qs.map((q) => (isAnswered(a[q.id]) ? (Array.isArray(a[q.id]) ? a[q.id].join(", ") : a[q.id]) : null)),
        placesOn(d).length ? placesOn(d).join(" → ") : null
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  for (let r = 1; r < rows.length; r++) {
    const c = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (c) { c.t = "n"; c.z = "dd.mm.yyyy"; }
    qs.forEach((q, i) => {
      if (!q.format) return;
      const cell = ws[XLSX.utils.encode_cell({ r, c: i + 2 })];
      if (!cell || typeof cell.v !== "number") return;
      if (q.format === "duration") { cell.v = cell.v / 24; cell.z = "[h]:mm"; }
      else { cell.v = (((cell.v % 24) + 24) % 24) / 24; cell.z = "hh:mm"; }
    });
  }
  ws["!cols"] = [{ wch: 12 }, { wch: 11 }, ...qs.map((q) => ({ wch: Math.min(Math.max(q.text.length + 2, 10), 40) })), { wch: 28 }];
  ws["!freeze"] = { xSplit: 1, ySplit: 1 };
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: header.length - 1 } }) };

  const qrows = [["Frage", "Thema", "Typ", "Antworten / Bereich", "Mehrfachauswahl", "Folgefrage", "Einheit", "Health-Kürzel", "Status", "Anzahl Antworten"]];
  for (const q of qs) {
    qrows.push([
      q.text, themeById(themeOf(q)).l, typeLabel[q.type],
      q.type === "choice" ? q.options.join(" / ") : q.type === "scale" ? `${q.min}–${q.max}${q.minLabel || q.maxLabel ? ` (${q.minLabel || ""} … ${q.maxLabel || ""})` : ""}` : "",
      q.multi ? "ja" : "", condText(q), q.unit || "", q.healthKey || "", q.archived ? "ausgeblendet" : "aktiv", answerCount(q.id)
    ]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(qrows);
  ws2["!cols"] = [{ wch: 36 }, { wch: 14 }, { wch: 9 }, { wch: 30 }, { wch: 15 }, { wch: 36 }, { wch: 10 }, { wch: 13 }, { wch: 12 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Antworten");
  XLSX.utils.book_append_sheet(wb, ws2, "Fragen");
  return wb;
}

async function exportExcel() {
  const wb = buildWorkbook();
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (await shareOrDownload(blob, `Mosaik_${todayIso()}.xlsx`)) toast("Excel erstellt");
}

async function exportBackup() {
  // alles aus dem App-Speicher plus die Darstellung der Analyse (ohne Schlüssel und Geräte-Einstellungen)
  // dazu die chess.com-Einstellung (Benutzername, an/aus) – kein Geheimnis, damit sie auf einem anderen Gerät mitkommt
  const chessSettings = settings.chess ? { user: settings.chess.user, on: settings.chess.on } : null;
  const blob = new Blob([JSON.stringify({ ...state, prefs, chessSettings }, null, 1)], { type: "application/json" });
  if (await shareOrDownload(blob, `Mosaik_Sicherung_${todayIso()}.json`)) {
    state.lastBackup = new Date().toISOString();
    save(); renderData(); toast("Sicherung erstellt");
  }
}

function importBackup(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!Array.isArray(s.questions) || typeof s.answers !== "object") throw new Error("Format");
      const nd = Object.keys(s.answers).length;
      if (!confirm(`Sicherung mit ${s.questions.length} Fragen und ${nd} Tagen laden? Die aktuellen Daten in der App werden dadurch ersetzt.`)) return;
      if (s.prefs && typeof s.prefs === "object") { prefs = { ...prefs, ...s.prefs }; savePrefs(); }
      delete s.prefs;
      if (s.chessSettings && typeof s.chessSettings === "object") {
        settings.chess = { ...settings.chess, user: String(s.chessSettings.user || ""), on: !!s.chessSettings.on, lastDay: "", err: "" };
        saveSettings();
      }
      delete s.chessSettings;
      state = { ...empty(), ...s };
      save(); render(); toast("Sicherung wiederhergestellt");
      if (settings.chess && settings.chess.on) syncChess(false); // fehlende neue Partien nachholen
    } catch (err) {
      toast("Diese Datei ist keine Mosaik-Sicherung");
    }
  };
  r.readAsText(f);
  e.target.value = "";
}

// Werte (Kürzel → Wert) an einem Tag eintragen; gibt eingetragene und unbekannte Kürzel zurück
function applyPairs(pairs, date) {
  const set = [], unknown = [];
  for (const [k, v] of Object.entries(pairs)) {
    const q = state.questions.find((x) => x.healthKey === k);
    if (!q) { unknown.push(k); continue; }
    let val;
    if (q.type === "choice") {
      val = q.options.find((o) => o.toLowerCase() === String(v).toLowerCase());
      if (val && q.multi) { const cur = (state.answers[date] || {})[q.id]; val = Array.from(new Set([...(Array.isArray(cur) ? cur : []), val])); }
    } else { val = parseNum(v); if (Number.isNaN(val)) val = undefined; if (q.type === "scale" && val !== undefined) val = Math.round(val); }
    if (val === undefined || val === null) { unknown.push(k); continue; }
    setAnswer(date, q.id, val);
    set.push(q.text);
  }
  return { set, unknown };
}

/* Health-Werte: "mosaik;schlaf=7,4;schritte=9500;datum=2026-10-14" */
function applyHealthText(text, fromPaste) {
  const t = String(text || "").trim();
  if (!/^(mosaik|taeglich);/i.test(t)) { // „taeglich;“ = alter Name, bleibt gültig
    toast(fromPaste ? "Text muss mit „mosaik;“ beginnen" : "In der Zwischenablage sind keine Health-Werte");
    return;
  }
  const pairs = {};
  for (const part of t.split(";").slice(1)) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    pairs[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  let date = todayIso();
  if (pairs.datum) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(pairs.datum)) date = pairs.datum;
    else if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(pairs.datum)) { const [d, m, y] = pairs.datum.split("."); date = `${y}-${pad(m)}-${pad(d)}`; }
    delete pairs.datum;
  }
  const { set, unknown } = applyPairs(pairs, date);
  if (set.length) {
    current = date; tab = "day"; render();
    toast(`${set.length} Wert${set.length > 1 ? "e" : ""} für ${longDate(date)} eingetragen`);
  } else {
    toast(unknown.length ? `Kein passendes Kürzel: ${unknown.join(", ")}` : "Keine Werte gefunden");
  }
}

async function healthFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    applyHealthText(text, false);
  } catch (e) {
    toast("Zwischenablage nicht lesbar – Text unter Einstellungen einfügen");
  }
}

// Werte auch über die Adresse übernehmen: …/#mosaik;schlaf=7,4
function checkHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (/^(mosaik|taeglich);/i.test(h)) {
    applyHealthText(h, false);
    history.replaceState(null, "", location.pathname + location.search);
  }
}
