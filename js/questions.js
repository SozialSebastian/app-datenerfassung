/* Mosaik – Fragen verwalten und Fragen-Editor */
"use strict";

/* ================= Fragen verwalten ================= */
// Fragen verwalten – als Feld in den Einstellungen; zeigt erst einige, aufklappbar
const Q_PREVIEW = 3;
let showAllQuestions = false;
// Liste mit Überschrift, sobald das Thema wechselt
function withThemeHeads(list, keyOf, render, head) {
  let last = null;
  return list.map((x) => {
    const k = keyOf(x);
    const h = k && k !== last ? head(themeById(k)) : "";
    if (k) last = k;
    return h + render(x);
  }).join("");
}

/* ---------- Neue Frage: eigene oder aus Vorlage ---------- */
const TEMPLATES = [
  { k: "intol", icon: "🩺", title: "Unverträglichkeiten", desc: "„Was davon hast du heute gegessen oder getrunken?“ (Laktose, Fruktose, Histamin, Gluten, FODMAP & Co.) und „Hattest du heute Bauchprobleme?“ mit Beschwerden und Stärke. Die Analyse zeigt in einer Kachel, ob ein Verdacht erkannt wurde.",
    make: () => intolMake() },
  { k: "recipes", icon: "🍳", title: "Gekocht (Rezepte aus Notion)", desc: "„Was hast du heute gekocht?“ mit deinen Rezepten von der Notion-Seite als Antworten, bleibt automatisch aktuell. Die Analyse zeigt, was du wie oft gekocht hast.",
    needs: async () => {
      if (!recipeList().length) await syncRecipes(true);
      if (!recipeList().length) { toast(settings.notion.err || "Noch keine Rezepte – Notion unter Einstellungen → Schnittstelle Notion verbinden"); return false; }
      return true;
    },
    make: () => [{ id: uid(), text: "Was hast du heute gekocht?", type: "choice", options: Array.from(new Set([...recipeNames(), ...RECIPE_EXTRA])), extra: [...RECIPE_EXTRA], tplv: 2, notion: { src: "recipes" }, multi: true, min: 1, max: 5, minLabel: "", maxLabel: "", unit: "", healthKey: "", archived: false, cond: null, theme: "food", template: "recipes" }] },
  { k: "work", icon: "💼", title: "Arbeit", desc: "„Hast du heute gearbeitet?“ und bei Ja „Wie lange hast du gearbeitet?“. Mit Vertrag (Stunden und Stundenlohn) zeigt die Analyse deinen effektiven Stundenlohn.",
    make: () => {
      const p = { id: uid(), text: "Hast du heute gearbeitet?", type: "choice", options: ["Ja", "Nein"], multi: false, min: 1, max: 5, minLabel: "", maxLabel: "", unit: "", healthKey: "", archived: false, cond: null, theme: "work", template: "work" };
      const c = { id: uid(), text: "Wie lange hast du gearbeitet?", type: "number", options: [], multi: false, min: 1, max: 5, minLabel: "", maxLabel: "", unit: "", format: "duration", healthKey: "", archived: false, cond: { qid: p.id, values: ["Ja"] }, better: "none", template: "work-hours" };
      return [p, c];
    } }
];
function openNewQuestion() {
  const dlg = $("#sheet");
  dlg.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><button type="button" class="linkbtn" id="ncancel">Abbrechen</button><h2>Neue Frage</h2><span></span></div>
    <button type="button" class="newopt" id="nown"><span class="ni">✏️</span><span><strong>Eigene Frage</strong><span class="muted small">Text, Antworten und Thema selbst festlegen</span></span></button>
    <div class="field" style="margin:18px 0 8px;font-weight:600;font-size:15px">Aus Vorlage</div>
    ${TEMPLATES.map((t) => `<button type="button" class="newopt" data-tpl="${t.k}"><span class="ni">${t.icon}</span><span><strong>${esc(t.title)}</strong><span class="muted small">${esc(t.desc)}</span></span></button>`).join("")}
  </div>`;
  $("#ncancel", dlg).addEventListener("click", () => dlg.close());
  $("#nown", dlg).addEventListener("click", () => openEditor(null));
  dlg.querySelectorAll("[data-tpl]").forEach((b) => b.addEventListener("click", async () => {
    const t = TEMPLATES.find((x) => x.k === b.dataset.tpl);
    if (t.needs && !(await t.needs())) return;
    if (state.questions.some((q) => (q.template === t.k || String(q.template || "").startsWith(t.k + "-")) && !q.archived) && !confirm(`Die Vorlage „${t.title}“ ist schon angelegt. Trotzdem noch einmal anlegen?`)) return;
    const qs = t.make();
    state.questions.push(...qs);
    save(); render();
    toast(`Vorlage „${t.title}“ angelegt`);
    openEditor(qs[0].id); // gleich Vertrag usw. einstellen
  }));
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

// Arbeitszeit: Ja/Nein-Frage mit einer Zahl-Folgefrage (Stunden) – nur dann gibt es einen Vertrag
const hoursChildOf = (p) => p && p.type === "choice" && p.options.includes("Ja") ? childrenOf(p.id).find((c) => c.type === "number" && !c.archived) : null;
// Wert der Stunden-Frage in Stunden
const asHours = (q, v) => (typeof v !== "number" ? null : q.format === "duration" ? v : /^min/i.test(q.unit || "") ? v / 60 : v);

function questionsPanel() {
  const all = ordered();
  const act = all.filter((o) => !o.q.archived);
  const arch = all.filter((o) => o.q.archived);
  const siblings = (q) => state.questions.filter((x) => !x.archived && (x.cond?.qid || null) === (q.cond?.qid || null) && (q.cond || themeOf(x) === themeOf(q)));
  const row = ({ q, depth }) => {
    const sib = siblings(q);
    const pos = sib.indexOf(q);
    return `<li class="qrow ${q.archived ? "archived" : ""}" data-qrow="${q.id}" style="margin-left:${q.archived ? 0 : depth * 18}px">
      <button class="qmain" data-edit="${q.id}">
        <span class="qtext">${q.cond && !q.archived ? "↳ " : ""}${esc(q.text)}</span>
        <span class="qmeta">${q.friends ? "Vorlage Freunde · " : q.notion ? "Rezepte aus Notion · " : ""}${esc(describe(q))}${q.healthKey ? " · Health: " + esc(q.healthKey) : ""}</span>
        ${q.cond ? `<span class="qmeta">${esc(condText(q))}</span>` : ""}
      </button>
      ${q.archived ? "" : `
      <button class="iconbtn" data-move="${q.id}" data-dir="-1" aria-label="Nach oben" ${pos === 0 ? "disabled" : ""}>↑</button>
      <button class="iconbtn" data-move="${q.id}" data-dir="1" aria-label="Nach unten" ${pos === sib.length - 1 ? "disabled" : ""}>↓</button>`}
    </li>`;
  };
  const shown = showAllQuestions ? act : act.slice(0, Q_PREVIEW);
  const more = act.length - shown.length + (showAllQuestions ? 0 : arch.length);
  return `<section class="panel" id="qpanel">
      <div class="panel-head">
        <h2>Fragen</h2>
        <button class="addbtn" id="newq" aria-label="Neue Frage anlegen">+</button>
      </div>
      ${act.length ? `<ul class="qlist">${withThemeHeads(shown, (o) => o.depth === 0 && themeOf(o.q), row, (t) => `<li class="qtheme">${t.i} ${esc(t.l)}</li>`)}</ul>` : `<p class="muted small" style="margin:0">Noch keine Fragen. Tippe auf +, um die erste anzulegen.</p>`}
      ${showAllQuestions ? `
        ${act.length ? `<p class="muted small" style="margin-top:10px">Folgefragen (↳) erscheinen nur nach einer bestimmten Antwort. Anlegen über + → „Nur fragen, wenn …“. Reihenfolge ändern: Frage lange drücken und ziehen oder die Pfeile nutzen.</p>` : ""}
        ${arch.length ? `<h3 class="subhead">Ausgeblendet</h3>
          <p class="muted small">Werden nicht mehr abgefragt, bleiben aber im Excel-Export.</p>
          <ul class="qlist">${arch.map(row).join("")}</ul>` : ""}` : ""}
      ${more > 0 || showAllQuestions && (act.length > Q_PREVIEW || arch.length)
        ? `<button class="btn ghost block" id="qmore" style="margin-top:6px">${showAllQuestions ? "Weniger anzeigen" : `Alle Fragen anzeigen (${more} weitere)`}</button>` : ""}
    </section>`;
}

// Lange drücken und ziehen: Frage unter ihren Geschwistern (gleiche Ausgangsfrage) verschieben
function wireDrag(root) {
  const list = root.querySelector(".qlist");
  if (!list) return;
  let drag = null, timer = null, suppressClick = false;
  const sibs = (q) => state.questions.filter((x) => !x.archived && (x.cond?.qid || null) === (q.cond?.qid || null) && (q.cond || themeOf(x) === themeOf(q)));
  const cancel = () => { clearTimeout(timer); timer = null; };
  const finish = (commit) => {
    if (!drag) return;
    const { el, q, marker, target } = drag;
    el.classList.remove("dragging"); el.style.transform = "";
    marker.remove();
    document.body.classList.remove("no-scroll");
    drag = null;
    if (!commit || target === undefined) return;
    const arr = state.questions;
    arr.splice(arr.indexOf(q), 1);
    if (target === null) { const s2 = sibs(q); const last = s2[s2.length - 1]; arr.splice(last ? arr.indexOf(last) + 1 : arr.length, 0, q); }
    else arr.splice(arr.indexOf(target), 0, q);
    save(); refreshQuestions();
  };
  list.querySelectorAll(".qrow:not(.archived)").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-move]")) return;
      const q = qById(el.dataset.qrow);
      const x0 = e.clientX, y0 = e.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        const marker = document.createElement("li");
        marker.className = "qdrop";
        drag = { el, q, y0, x0, marker, target: undefined };
        el.classList.add("dragging");
        document.body.classList.add("no-scroll");
        if (navigator.vibrate) navigator.vibrate(15);
      }, 450);
      const move = (ev) => {
        if (!drag) { if (Math.abs(ev.clientY - y0) > 8 || Math.abs(ev.clientX - x0) > 8) cancel(); return; }
        ev.preventDefault();
        drag.el.style.transform = `translateY(${ev.clientY - drag.y0}px)`;
        // Ziel: erste sichtbare Geschwister-Zeile, deren Mitte unter dem Finger liegt
        const rows = sibs(drag.q).filter((x) => x !== drag.q).map((x) => list.querySelector(`[data-qrow="${x.id}"]`)).filter(Boolean);
        let target = null, before = null;
        for (const r of rows) { const b = r.getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { target = qById(r.dataset.qrow); before = r; break; } }
        drag.target = target;
        if (before) list.insertBefore(drag.marker, before);
        else { const lastRow = rows[rows.length - 1]; if (lastRow) lastRow.after(drag.marker); }
      };
      const up = () => {
        cancel();
        if (drag) { suppressClick = true; finish(true); setTimeout(() => (suppressClick = false), 50); }
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
    el.addEventListener("click", (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  // iOS: Scrollen während des Ziehens verhindern
  list.addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { passive: false });
}

function wireQuestions(root) {
  wireDrag(root);
  $("#newq", root)?.addEventListener("click", openNewQuestion);
  $("#qmore", root)?.addEventListener("click", () => { showAllQuestions = !showAllQuestions; refreshQuestions(); });
  root.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.edit)));
  root.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", () => {
    const q = qById(b.dataset.move);
    const sib = state.questions.filter((x) => !x.archived && (x.cond?.qid || null) === (q.cond?.qid || null) && (q.cond || themeOf(x) === themeOf(q)));
    const other = sib[sib.indexOf(q) + Number(b.dataset.dir)];
    if (!other) return;
    const list = state.questions;
    const i1 = list.indexOf(q), i2 = list.indexOf(other);
    [list[i1], list[i2]] = [list[i2], list[i1]];
    save();
    refreshQuestions();
  }));
}

// nur das Fragen-Feld neu zeichnen (Scrollposition bleibt)
function refreshQuestions() {
  const old = $("#qpanel");
  if (!old) return render();
  const tmp = document.createElement("div");
  tmp.innerHTML = questionsPanel();
  const fresh = tmp.firstElementChild;
  old.replaceWith(fresh);
  wireQuestions(fresh);
}

function answerCount(qid) {
  return Object.values(state.answers).filter((a) => isAnswered(a[qid])).length;
}

function descendants(id) {
  const out = new Set();
  const walk = (x) => childrenOf(x).forEach((c) => { if (!out.has(c.id)) { out.add(c.id); walk(c.id); } });
  walk(id);
  return out;
}

function openEditor(id) {
  const existing = id ? qById(id) : null;
  const used = existing ? answerCount(existing.id) : 0;
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid(), text: "", type: "choice", options: ["Ja", "Nein"], multi: false, min: 1, max: 5, minLabel: "", maxLabel: "", unit: "", healthKey: "", archived: false, cond: null };
  if (draft.multi === undefined) draft.multi = false;
  if (!draft.friends) draft.friends = null;
  if (draft.friends || draft.notion) draft.options = [...(draft.extra || [])]; // bei Vorlage „Freunde“/„Rezepte“ nur Zusatzantworten bearbeiten
  if (draft.cond === undefined) draft.cond = null;

  const dlg = $("#sheet");
  const hasChildren = existing && childrenOf(existing.id).length > 0;

  const draw = () => {
    const typeLocked = used > 0;
    const curBetter = draft.better || (betterDir(draft) || "none");
    const betterSeg = (opts) => `<div class="field" style="margin:4px 0 8px;font-weight:600;font-size:15px">Was ist besser?</div>
      <div class="seg seg-3" role="group" aria-label="Richtung">${opts.map(([v, l]) => `<button type="button" data-better="${v}" aria-pressed="${curBetter === v}">${esc(l)}</button>`).join("")}</div>
      <p class="muted small" style="margin-top:-8px">Hilft bei Zielen, Trends und im Wochenbericht: Was in die gute Richtung geht, wird grün markiert.</p>`;
    // mögliche Ausgangsfragen: Auswahl oder Skala, aktiv, nicht sie selbst und keine eigene Folgefrage
    const blocked = existing ? descendants(existing.id) : new Set();
    const parents = ordered().map((o) => o.q).filter((p) => p.id !== draft.id && !p.archived && !blocked.has(p.id) && (p.type === "choice" || p.type === "scale"));
    const parent = draft.cond ? qById(draft.cond.qid) : null;
    const parentVals = parent ? (parent.type === "choice" ? parent.options : Array.from({ length: parent.max - parent.min + 1 }, (_, i) => String(parent.min + i))) : [];

    let typeFields = "";
    if (draft.type === "choice") {
      const fnames = draft.friends ? friendsOrdered(draft.friends.cats).map((x) => x.name) : [];
      typeFields = `<div class="field" style="margin-bottom:8px;font-weight:600;font-size:15px">Antwortmöglichkeiten</div>
        ${draft.notion ? `<p class="small" style="margin:0 0 4px"><strong>Rezepte aus Notion</strong>, bleiben automatisch aktuell.</p>
          <p class="muted small" style="margin:0 0 12px">${recipeList().length} Rezepte: ${esc(recipeNames().slice(0, 8).join(", "))}${recipeList().length > 8 ? " …" : ""}</p>
          <div class="field" style="margin-bottom:8px;font-weight:600;font-size:15px">Zusätzliche Antworten (optional)</div>` : `<label class="check" style="margin-top:0"><input type="checkbox" id="fsync" ${draft.friends ? "checked" : ""}> Vorlage „Freunde“: Namen aus deiner Freundesliste, bleibt automatisch aktuell</label>`}
        ${draft.friends ? `<div class="chips" style="margin:4px 0 8px">${FCATS.map(([c, l]) => `<button type="button" class="chip" data-fsc="${c}" aria-pressed="${draft.friends.cats.includes(c)}">${l}</button>`).join("")}</div>
          <p class="muted small" style="margin:0 0 12px">${fnames.length ? `${fnames.length} Namen: ${esc(fnames.slice(0, 8).join(", "))}${fnames.length > 8 ? " …" : ""}` : "Noch keine Freunde in diesen Kategorien. Leg sie im Bereich „Freunde“ an."}</p>
          <div class="field" style="margin-bottom:8px;font-weight:600;font-size:15px">Zusätzliche Antworten (optional)</div>` : ""}
        ${draft.options.map((o, i) => `<div class="opt">
          <input value="${esc(o)}" data-opt="${i}" aria-label="Antwort ${i + 1}" ${draft.friends ? 'placeholder="z. B. Familie"' : draft.notion ? 'placeholder="z. B. Essen gegangen"' : ""}>
          <button type="button" class="iconbtn" data-delopt="${i}" aria-label="Antwort entfernen" ${!draft.friends && !draft.notion && draft.options.length <= 2 ? "disabled" : ""}>✕</button>
        </div>`).join("")}
        <button type="button" class="linkbtn" id="addopt">Antwort hinzufügen</button>
        <label class="check"><input type="checkbox" id="multi" ${draft.multi ? "checked" : ""} ${typeLocked ? "disabled" : ""}> Mehrere Antworten gleichzeitig erlauben</label>
        ${used ? `<p class="muted small">Umbenennen ändert nur künftige Antworten. Bereits gespeicherte behalten den alten Text.</p>` : ""}`;
    } else if (draft.type === "scale") {
      typeFields = `<div class="row2">
          <label class="field">Von<input type="number" inputmode="numeric" id="smin" value="${draft.min}"></label>
          <label class="field">Bis<input type="number" inputmode="numeric" id="smax" value="${draft.max}"></label>
        </div>
        <div class="row2">
          <label class="field">Text links <input id="sminl" value="${esc(draft.minLabel)}" placeholder="z. B. schlecht"></label>
          <label class="field">Text rechts <input id="smaxl" value="${esc(draft.maxLabel)}" placeholder="z. B. super"></label>
        </div>
        ${betterSeg([["high", `${draft.max} ist gut`], ["low", `${draft.min} ist gut`], ["none", "Neutral"]])}`;
    } else {
      const UNITS = ["Stunden", "Minuten", "km", "kg", "€", "Liter", "Gläser", "Seiten", "Mal"];
      typeFields = `<div class="field" style="margin-bottom:8px;font-weight:600;font-size:15px">Einheit</div>
        <div class="chips unitchips">
          <button type="button" class="chip" data-fmt="duration" aria-pressed="${draft.format === "duration"}">Dauer h:mm</button>
          <button type="button" class="chip" data-fmt="clock" aria-pressed="${draft.format === "clock"}">Uhrzeit</button>
          ${UNITS.map((u) => `<button type="button" class="chip" data-unit="${esc(u)}" aria-pressed="${!draft.format && draft.unit === u}">${esc(u)}</button>`).join("")}
        </div>
        <label class="field" style="margin-top:10px">Eigene Einheit (optional)<input id="unit" value="${esc(draft.format ? "" : draft.unit)}" placeholder="${draft.format ? (draft.format === "clock" ? "Eingabe als 23:30" : "Eingabe als 7:30") : "z. B. Tassen"}" autocomplete="off"></label>
        ${draft.format ? `<p class="muted small" style="margin-top:-10px">${draft.format === "clock" ? "Eingabe als Uhrzeit, z. B. 23:30 oder 0:45. Zeiten nach Mitternacht zählen als später." : "Eingabe als Stunden:Minuten, z. B. 7:30. Excel zeigt sie als Dauer."}</p>` : ""}
        ${betterSeg(draft.format === "clock" ? [["low", "Früher ist gut"], ["high", "Später ist gut"], ["none", "Neutral"]] : [["high", "Mehr ist gut"], ["low", "Weniger ist gut"], ["none", "Neutral"]])}`;
    }

    const condBlock = `<details class="adv" ${draft.cond ? "open" : ""}>
        <summary>Nur fragen, wenn … (Folgefrage)</summary>
        ${parents.length ? `<label class="field" style="margin-top:8px">Ausgangsfrage
          <select id="cparent">
            <option value="">– immer fragen –</option>
            ${parents.map((p) => `<option value="${p.id}" ${draft.cond?.qid === p.id ? "selected" : ""}>${esc(p.text)}</option>`).join("")}
          </select>
        </label>
        ${parent ? `<div class="field" style="font-weight:600;font-size:15px;margin-bottom:6px">… mit einer dieser Antworten beantwortet wurde</div>
          <div class="chips" style="margin-bottom:12px">${parentVals.map((v) => `<button type="button" class="chip" data-cval="${esc(v)}" aria-pressed="${draft.cond.values.includes(v)}">${esc(v)}</button>`).join("")}</div>` : ""}`
        : `<p class="muted small" style="margin-top:8px">Leg zuerst eine Auswahl- oder Skala-Frage an, z. B. „Heute bouldern?“. Danach kannst du hier einstellen, dass diese Frage nur bei „Ja“ kommt.</p>`}
      </details>`;

    dlg.innerHTML = `<form class="sheet-inner" method="dialog" novalidate>
      <div class="sheet-head">
        <button type="button" class="linkbtn" id="cancel">Abbrechen</button>
        <h2>${existing ? "Frage bearbeiten" : "Neue Frage"}</h2>
        <button type="submit" class="linkbtn" id="savebtn">Sichern</button>
      </div>
      <label class="field">Frage<input id="qtext" value="${esc(draft.text)}" placeholder="z. B. Heute bouldern?" autocomplete="off"></label>
      ${draft.cond ? "" : `<div class="field" style="margin-bottom:8px;font-weight:600;font-size:15px">Thema</div>
      <div class="chips themechips">${THEMES.map((t) => `<button type="button" class="chip" data-theme="${t.k}" aria-pressed="${(draft.theme || guessTheme(draft)) === t.k}">${t.i} ${esc(t.l)}</button>`).join("")}</div>
      ${(draft.theme || guessTheme(draft)) === "sport" && draft.type === "choice" && !draft.multi && draft.options.includes("Ja") ? `<label class="check" style="margin:-4px 0 14px"><input type="checkbox" id="qsport" ${draft.sport ? "checked" : ""}> Ist eine Sportart – „Ja“ zählt als Sport (Sport-Kachel und Trends)</label>` : ""}`}
      <div class="seg" role="group" aria-label="Antworttyp">
        ${["choice", "scale", "number"].map((t) => `<button type="button" data-type="${t}" aria-pressed="${draft.type === t}" ${(typeLocked && draft.type !== t) || (hasChildren && t === "number") ? "disabled" : ""}>${typeLabel[t]}</button>`).join("")}
      </div>
      ${typeLocked ? `<p class="muted small" style="margin-top:-8px">Der Antworttyp ist fest, weil es schon ${used} Antworten gibt.</p>` : ""}
      ${typeFields}
      ${condBlock}
      ${existing && existing.healthKey ? `<details class="adv">
        <summary>Apple Health</summary>
        <label class="field" style="margin-top:8px">Health-Kürzel
          <input id="hkey" value="${esc(draft.healthKey)}" placeholder="z. B. schlaf" autocapitalize="off" autocomplete="off">
        </label>
        <p class="muted small">Schickt der Kurzbefehl einen Wert mit diesem Kürzel, wird er hier eingetragen. Anleitung unter Einstellungen → Schnittstelle Apple Health.</p>
        ${draft.type === "number" ? `<label class="check" style="margin-top:4px"><input type="checkbox" id="hsrc" ${draft.source === "health" ? "checked" : ""}> Nur aus Apple Health füllen (unter „Tag“ als Health-Feld, wird nicht abgefragt)</label>` : ""}
      </details>` : ""}
      ${existing && hoursChildOf(draft) ? `<details class="adv" ${draft.contract || draft.template === "work" ? "open" : ""}>
        <summary>Vertrag (für den effektiven Stundenlohn)</summary>
        <div class="gline"><span>Vertraglich</span><input id="ch" class="gin" type="text" inputmode="decimal" value="${esc(draft.contract ? fmtNum(draft.contract.h) : "")}" placeholder="20"><span>Stunden</span></div>
        <div class="seg seg-2" role="group" style="margin-top:10px">${[["week", "pro Woche"], ["month", "pro Monat"]].map(([v, l]) => `<button type="button" data-cper="${v}" aria-pressed="${(draft.contract?.per || "week") === v}">${l}</button>`).join("")}</div>
        <div class="gline" style="margin-top:0"><span>Stundenlohn</span><input id="cw" class="gin wide" type="text" inputmode="decimal" value="${esc(draft.contract ? fmtNum(draft.contract.wage) : "")}" placeholder="15,00"><span>€</span></div>
        <p class="muted small">Bezahlt wird nach Vertrag. Die Analyse der Frage „${esc(hoursChildOf(draft).text)}“ vergleicht das mit deinen tatsächlichen Stunden.</p>
      </details>` : ""}
      ${existing ? `<div class="stack">
        <button type="button" class="btn ghost" id="archive">${existing.archived ? "Wieder einblenden" : "Ausblenden (Daten bleiben)"}</button>
        <button type="button" class="btn danger" id="delete">Frage und ${used} Antworten löschen</button>
      </div>` : ""}
    </form>`;

    // Eingaben im Entwurf mitschreiben, damit Neuzeichnen nichts verliert
    const sync = () => {
      draft.text = $("#qtext", dlg).value;
      if ($("#qsport", dlg)) draft.sport = $("#qsport", dlg).checked;
      if ($("#ch", dlg)) {
        const h = parseNum($("#ch", dlg).value), w = parseNum($("#cw", dlg).value);
        const per = draft._cper || draft.contract?.per || "week";
        draft.contract = h > 0 && w > 0 ? { h, wage: w, per } : (h > 0 || w > 0 ? { h: h || 0, wage: w || 0, per } : null);
      }
      dlg.querySelectorAll("[data-opt]").forEach((inp) => (draft.options[+inp.dataset.opt] = inp.value));
      if ($("#multi", dlg)) draft.multi = $("#multi", dlg).checked;
      if ($("#smin", dlg)) { draft.min = parseInt($("#smin", dlg).value, 10); draft.max = parseInt($("#smax", dlg).value, 10); draft.minLabel = $("#sminl", dlg).value; draft.maxLabel = $("#smaxl", dlg).value; }
      if ($("#unit", dlg)) {
        const u = $("#unit", dlg).value.trim();
        if (u) { draft.unit = u; draft.format = null; } else if (!draft.format && !$(".unitchips [aria-pressed=true]", dlg)) draft.unit = "";
      }
      if ($("#hkey", dlg)) draft.healthKey = $("#hkey", dlg).value.trim().toLowerCase().replace(/[^a-z0-9_äöüß-]/g, "");
      if ($("#hsrc", dlg)) draft.source = $("#hsrc", dlg).checked ? "health" : null;
      if (draft.source !== "chess" && (draft.type !== "number" || !draft.healthKey)) draft.source = null;
    };

    dlg.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => { sync(); draft.type = b.dataset.type; draw(); }));
    dlg.querySelectorAll("[data-cper]").forEach((b) => b.addEventListener("click", () => { draft._cper = b.dataset.cper; sync(); draw(); }));
    dlg.querySelectorAll("[data-theme]").forEach((b) => b.addEventListener("click", () => { sync(); draft.theme = b.dataset.theme; draw(); }));
    dlg.querySelectorAll("[data-fmt]").forEach((b) => b.addEventListener("click", () => { sync(); draft.format = draft.format === b.dataset.fmt ? null : b.dataset.fmt; draft.unit = ""; if (!draft.better || draft.better === "none") draft.better = draft.format === "clock" ? "none" : draft.better; draw(); }));
    dlg.querySelectorAll("[data-unit]").forEach((b) => b.addEventListener("click", () => { sync(); const u = b.dataset.unit; draft.unit = draft.unit === u && !draft.format ? "" : u; draft.format = null; draw(); }));
    dlg.querySelectorAll("[data-better]").forEach((b) => b.addEventListener("click", () => { sync(); draft.better = b.dataset.better; draw(); }));
    $("#fsync", dlg)?.addEventListener("change", (e) => {
      sync();
      const all = F().list.map((x) => x.name);
      if (e.target.checked) {
        draft.friends = { cats: FCATS.map(([c]) => c) };
        draft.options = draft.options.map((o) => o.trim()).filter((o) => o && !all.includes(o) && o !== "Ja" && o !== "Nein");
        if (draft.multi === false && !used) draft.multi = true; // „Mit wem?“ meist mehrere
      } else {
        draft.options = Array.from(new Set([...friendsOrdered(draft.friends.cats).map((x) => x.name), ...draft.options.filter((o) => o.trim())]));
        while (draft.options.length < 2) draft.options.push("");
        draft.friends = null;
      }
      draw();
    });
    dlg.querySelectorAll("[data-fsc]").forEach((b) => b.addEventListener("click", () => {
      sync();
      const c = b.dataset.fsc, cats = draft.friends.cats, i = cats.indexOf(c);
      if (i >= 0) { if (cats.length > 1) cats.splice(i, 1); } else cats.push(c);
      draft.friends.cats = FCATS.map(([k]) => k).filter((k) => cats.includes(k));
      draw();
    }));
    $("#addopt", dlg)?.addEventListener("click", () => { sync(); draft.options.push(""); draw(); dlg.querySelector(`[data-opt="${draft.options.length - 1}"]`).focus(); });
    dlg.querySelectorAll("[data-delopt]").forEach((b) => b.addEventListener("click", () => { sync(); draft.options.splice(+b.dataset.delopt, 1); draw(); }));
    $("#cparent", dlg)?.addEventListener("change", (e) => {
      sync();
      draft.cond = e.target.value ? { qid: e.target.value, values: [] } : null;
      // Bei Ja/Nein-Fragen gleich „Ja“ vorauswählen
      const p = draft.cond && qById(draft.cond.qid);
      if (p && p.type === "choice" && p.options.includes("Ja")) draft.cond.values = ["Ja"];
      draw();
    });
    dlg.querySelectorAll("[data-cval]").forEach((b) => b.addEventListener("click", () => {
      sync();
      const v = b.dataset.cval, arr = draft.cond.values, i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
      draw();
    }));
    $("#cancel", dlg).addEventListener("click", () => dlg.close());

    $("#archive", dlg)?.addEventListener("click", () => {
      existing.archived = !existing.archived; save(); dlg.close(); render();
      toast(existing.archived ? (hasChildren ? "Ausgeblendet – Folgefragen kommen nicht mehr" : "Ausgeblendet") : "Wieder eingeblendet");
    });
    $("#delete", dlg)?.addEventListener("click", () => {
      if (!confirm(`„${existing.text}“ und alle ${used} Antworten endgültig löschen? Das lässt sich nicht rückgängig machen. Zum Behalten der Daten stattdessen „Ausblenden“ wählen.${hasChildren ? " Ihre Folgefragen werden danach immer gestellt." : ""}`)) return;
      state.questions = state.questions.filter((q) => q.id !== existing.id);
      state.questions.forEach((q) => { if (q.cond && q.cond.qid === existing.id) q.cond = null; });
      if (state.goals && Array.isArray(state.goals.items)) state.goals.items = state.goals.items.filter((g) => g.qid !== existing.id);
      for (const d of Object.keys(state.answers)) { delete state.answers[d][existing.id]; if (!Object.keys(state.answers[d]).length) delete state.answers[d]; }
      save(); dlg.close(); render(); toast("Gelöscht");
    });

    dlg.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      sync();
      draft.text = draft.text.trim();
      if (!draft.text) return toast("Bitte eine Frage eingeben");
      if (draft.type === "choice" && draft.notion) {
        draft.extra = Array.from(new Set(draft.options.map((o) => o.trim()).filter(Boolean)));
        draft.options = Array.from(new Set([...recipeNames(), ...draft.extra]));
        if (draft.options.length < 2) { draft.options = [...draft.extra]; return toast("Mindestens zwei Antworten nötig – Rezepte aus Notion fehlen noch"); }
      } else if (draft.type === "choice" && draft.friends) {
        draft.extra = Array.from(new Set(draft.options.map((o) => o.trim()).filter(Boolean)));
        draft.options = Array.from(new Set([...friendsOrdered(draft.friends.cats).map((x) => x.name), ...draft.extra]));
        if (draft.options.length < 2) { draft.options = [...draft.extra]; return toast("Mindestens zwei Antworten nötig – leg zuerst Freunde an"); }
      } else if (draft.type === "choice") {
        draft.friends = null; delete draft.extra;
        draft.options = draft.options.map((o) => o.trim()).filter(Boolean);
        if (draft.options.length < 2) return toast("Mindestens zwei Antworten nötig");
        if (new Set(draft.options).size !== draft.options.length) return toast("Antworten müssen unterschiedlich sein");
      } else { draft.multi = false; draft.friends = null; }
      if (draft.type !== "number") draft.format = null;
      if (draft.type === "choice") delete draft.better;
      if (draft.type === "scale") {
        if (!Number.isInteger(draft.min) || !Number.isInteger(draft.max) || draft.max <= draft.min) return toast("Skala: „Bis“ muss größer als „Von“ sein");
        if (draft.max - draft.min > 10) return toast("Skala: höchstens 11 Stufen");
      }
      if (draft.cond && !draft.cond.values.length) return toast("Wähle mindestens eine Antwort, bei der die Folgefrage kommt");
      if (draft.healthKey && state.questions.some((q) => q.id !== draft.id && q.healthKey === draft.healthKey)) return toast("Dieses Health-Kürzel ist schon vergeben");
      if (!draft.cond && !draft.theme) draft.theme = guessTheme(draft);
      delete draft._cper;
      if (draft.contract && !(draft.contract.h > 0 && draft.contract.wage > 0)) return toast("Vertrag: bitte Stunden und Stundenlohn eintragen (oder beide leeren)");
      if (existing) Object.assign(existing, draft);
      else state.questions.push(draft);
      save(); dlg.close(); render();
      toast(existing ? "Gesichert" : "Frage angelegt");
    });
  };

  draw();
  dlg.showModal();
  document.activeElement?.blur();
  if (!existing) setTimeout(() => $("#qtext", dlg).focus(), 50);
}
