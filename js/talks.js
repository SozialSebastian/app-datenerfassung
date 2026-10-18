/* Mosaik – Vertiefungsgespräche mit Freunden (Fragebogen, Gespräche, Verlauf) */
"use strict";

// Gespeichert in state.talkForm (der Fragebogen) und state.talks (die Gespräche, mit in der Sicherung).
// Jedes Gespräch speichert eine Kopie des Fragebogens von damals: Änderungen gelten nur für neue Gespräche.
// Frage: { id, text, hint, type: text|choice|multi|scale|friends, options, min, max }
const TALK_TYPES = [["text", "Freitext"], ["choice", "Auswahl"], ["multi", "Mehrfachauswahl"], ["scale", "Skala"], ["friends", "Freunde"]];
const tq = (text, type = "text", extra = {}) => ({ text, type, hint: "", options: [], min: 1, max: 10, ...extra });
const TALK_DEFAULT = () => {
  const parts = [
    ["🧭 Rückblick auf die letzten 6 Monate", [
      tq("Was waren für dich die schönsten gemeinsamen Momente in den letzten sechs Monaten?"),
      tq("Wann habe ich dich (vielleicht unbewusst) besonders unterstützt oder dir gutgetan?"),
      tq("Gab es Momente, in denen du dich von mir entfernt oder unverstanden gefühlt hast?"),
      tq("Wie würdest du unsere Freundschaft aktuell beschreiben?", "choice", { options: ["intensiver", "gleichbleibend", "etwas distanzierter"] })]],
    ["💬 Kommunikation und Miteinander", [
      tq("Fühlst du dich gehört und verstanden, wenn wir miteinander sprechen?", "choice", { options: ["Ja", "Meistens", "Teils", "Nein"] }),
      tq("Gibt es etwas, das du dir wünschst, dass ich anders ausdrücke oder häufiger sage?"),
      tq("Wie offen können wir über schwierige Themen sprechen?", "scale", { min: 1, max: 10 }),
      tq("Gibt es Themen, die du gern ansprechen würdest, dich aber bisher nicht getraut hast?"),
      tq("Wie gehst du damit um, wenn wir unterschiedlicher Meinung sind?")]],
    ["💞 Nähe, Vertrauen & Unterstützung", [
      tq("Hast du das Gefühl, dass du dich in unserer Freundschaft so zeigen kannst, wie du wirklich bist?", "choice", { options: ["Ja", "Meistens", "Teils", "Nein"] }),
      tq("Gibt es etwas, das dir in unserer Freundschaft fehlt?", "multi", { options: ["Gemeinsame Zeit", "Ehrlichkeit", "Tiefe", "Leichtigkeit", "Nichts"] }),
      tq("Wie gut kennt ihr euch?", "scale", { min: 1, max: 10 }),
      tq("Welche Schnittmengen habt ihr?")]],
    ["🫂 Lebenssituationen – würdest du darüber reden?", [
      ["Jobverlust nach Jahren im Unternehmen", "Nach mehreren Jahren im gleichen Unternehmen wirst du plötzlich entlassen. Die finanzielle Unsicherheit trifft dich hart, aber noch stärker ist das Gefühl, versagt zu haben und nicht mehr gebraucht zu werden."],
      ["Trennung nach einer langen Beziehung", "Nach Jahren voller gemeinsamer Pläne geht deine Beziehung zu Ende – eher ein langsames Auseinanderdriften als ein lauter Streit. Alles erinnert dich an die Person, die nicht mehr da ist."],
      ["Psychische Erschöpfung und Überforderung", "Du hast kaum noch Energie, alles fühlt sich anstrengend an, selbst Treffen mit Freunden. Nach außen funktionierst du, innerlich ist da eine Leere."],
      ["Schwerer Konflikt mit einem Familienmitglied", "Mit einem Elternteil oder Geschwister eskaliert ein Streit, der sich über Jahre aufgebaut hat. Jetzt herrscht Funkstille und du weißt nicht, ob du dich melden solltest."],
      ["Finanzielle Krise nach einer Fehlentscheidung", "Eine Investition oder größere Anschaffung war ein Fehler. Das Konto ist im Minus, Rechnungen stapeln sich, und du hast Angst, dich zu blamieren."],
      ["Fehler mit Folgen im Beruf oder Studium", "Du hast eine wichtige Aufgabe vermasselt. Andere sind enttäuscht, und du zweifelst an deinen Fähigkeiten."],
      ["Erkrankung eines nahen Angehörigen", "Ein Elternteil oder enger Freund erhält eine ernste Diagnose. Du willst stark sein, fühlst dich aber hilflos, und der Druck wächst."],
      ["Gefühl der Entfremdung im Freundeskreis", "Gespräche bleiben oberflächlich, du lachst mit, fühlst dich innerlich aber fehl am Platz – und fragst dich, wer sich verändert hat."],
      ["Scheitern an einem lang verfolgten Ziel", "Du hast über Monate oder Jahre auf etwas hingearbeitet und scheiterst kurz vor dem Ende. Die Enttäuschung ist tief."],
      ["Orientierungslosigkeit nach einem großen Umbruch", "Nach einem Abschluss, Umzug oder Lebensabschnitt weißt du nicht, wie es weitergehen soll. Andere scheinen es zu wissen, du nicht."]
    ].map(([t, h]) => tq(t, "choice", { hint: h, options: ["Ja", "Vielleicht", "Nein"] }))],
    ["🔭 Zukunft & Wünsche", [
      tq("Was wünschst du dir für unsere Freundschaft im nächsten halben Jahr?"),
      tq("Gibt es etwas, das du dir vornimmst, um zur Freundschaft beizutragen?"),
      tq("Welche gemeinsamen Erlebnisse oder Projekte würdest du dir wünschen?"),
      tq("Wenn du dir unsere Freundschaft in 5 Jahren vorstellst – wie sähe sie idealerweise aus?")]],
    ["🪞 Offene Reflexion", [
      tq("Gibt es Missverständnisse oder alte Themen, die wir mal klären sollten?"),
      tq("Was schätzt du am meisten an mir – und was fordert dich vielleicht auch manchmal heraus?"),
      tq("Gibt es weitere Themen oder Fragen, die du noch gerne besprechen möchtest oder die gefehlt haben?")]],
    ["⚔️ Gegenseitige Reflexion", [
      tq("Welche Stärken hat dein Gegenüber?"),
      tq("Welche Schwächen hat dein Gegenüber?"),
      tq("Inwiefern hat sich dein Gegenüber in den letzten Jahren verändert?"),
      tq("Welche Prioritäten setzt dein Gegenüber und wie stehst du dazu?")]],
    ["🐏 Freundeskreis", [
      tq("Welche gemeinsamen Freunde gibt es?", "friends"),
      tq("Gibt es einen intakten gemeinsamen Freundeskreis bzw. welche Wünsche oder Auffälligkeiten hast du?"),
      tq("Auf welche gemeinsamen Aktivitäten habt ihr Lust?")]]
  ];
  return { parts: parts.map(([title, qs]) => ({ id: uid(), title, qs: qs.map((q) => ({ id: uid(), ...q })) })) };
};
const talkForm = () => {
  if (!state.talkForm || !Array.isArray(state.talkForm.parts)) { state.talkForm = TALK_DEFAULT(); save(); }
  return state.talkForm;
};
const talks = () => (Array.isArray(state.talks) ? state.talks : (state.talks = []));
const clone = (x) => JSON.parse(JSON.stringify(x));
const talkQs = (t) => t.form.parts.flatMap((p) => p.qs);
const isAns = (a) => a && ((Array.isArray(a.v) ? a.v.length : a.v !== undefined && a.v !== "") || (a.t && a.t.trim()));
const talkProgress = (t) => { const qs = talkQs(t); return [qs.filter((q) => isAns(t.answers[q.id])).length, qs.length]; };
const talkName = (t) => (F().list.find((x) => x.id === t.fid) || {}).name || t.name || "Unbekannt";
const talkSort = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.created || 0) - (a.created || 0);
const fmtAns = (q, a) => {
  if (!isAns(a)) return "–";
  const v = Array.isArray(a.v) ? a.v.join(", ") : a.v !== undefined && a.v !== "" ? String(a.v) + (q.type === "scale" ? ` von ${q.max}` : "") : "";
  return [v, a.t && a.t.trim()].filter(Boolean).join(" – ");
};

/* ---------- Kachel unter Freunde ---------- */
let showAllTalks = false;
function talksPanel() {
  const list = [...talks()].sort(talkSort);
  const shown = showAllTalks ? list : list.slice(0, 6);
  return `<section class="panel talks">
    <div class="panel-head"><h2>Vertiefungsgespräche</h2><span class="muted">${list.length || ""}</span></div>
    <div class="stack">
      <button class="btn hold-btn" id="tnew">Neues Vertiefungsgespräch</button>
      <button class="btn ghost" id="tform">Fragebogen festlegen</button>
    </div>
    ${list.length ? `<ul class="tklist">${shown.map((t) => { const [a, n] = talkProgress(t); return `<li><button type="button" class="tkrow" data-talk="${t.id}">
        <span class="tkn"><strong>${esc(talkName(t))}</strong>${t.done ? "" : ` <span class="tkdraft">Entwurf</span>`}</span>
        <span class="tkd">${fdate(t.date)}</span>
        <span class="muted small">${a} von ${n} Fragen · ${agoText(t.date)}</span>
      </button></li>`; }).join("")}</ul>
      ${list.length > 6 ? `<button class="btn ghost block" id="tmoreh" style="margin-top:10px">${showAllTalks ? "Weniger anzeigen" : `Alle anzeigen (${list.length - 6} weitere)`}</button>` : ""}`
    : `<p class="muted small" style="margin:12px 0 0">Noch keine Gespräche. Lege eins an, dann kommt der Fragebogen mit Antwortfeldern. Später siehst du hier den Verlauf und bei jeder Frage, was beim letzten Gespräch mit dieser Person war.</p>`}
  </section>`;
}
function wireTalks() {
  $("#tnew")?.addEventListener("click", openTalkNew);
  $("#tform")?.addEventListener("click", openTalkForm);
  $("#tmoreh")?.addEventListener("click", () => { showAllTalks = !showAllTalks; renderFriends(); });
  document.querySelectorAll("[data-talk]").forEach((b) => b.addEventListener("click", () => openTalk(b.dataset.talk)));
}

/* ---------- Neues Gespräch ---------- */
function openTalkNew() {
  const dlg = $("#sheet");
  const fr = friendsOrdered();
  dlg.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><button type="button" class="linkbtn" id="tncancel">Abbrechen</button><h2>Neues Gespräch</h2><span></span></div>
    <label class="field">Mit wem?
      <select id="tnf">${fr.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}<option value="">Andere Person …</option></select>
    </label>
    <label class="field" id="tnnamef" ${fr.length ? "hidden" : ""}>Name<input id="tnname" type="text" autocomplete="off"></label>
    <label class="field">Datum<input id="tndate" type="date" value="${todayIso()}" max="${todayIso()}"></label>
    <button class="btn block hold-btn" id="tngo">Gespräch beginnen</button>
  </div>`;
  const sel = $("#tnf", dlg);
  sel.addEventListener("change", () => { $("#tnnamef", dlg).hidden = !!sel.value; });
  $("#tncancel", dlg).addEventListener("click", () => dlg.close());
  $("#tngo", dlg).addEventListener("click", () => {
    const fid = sel.value, name = fid ? "" : $("#tnname", dlg).value.trim();
    if (!fid && !name) return toast("Bitte einen Namen eintragen");
    const t = { id: uid(), fid: fid || null, name: fid ? (fr.find((x) => x.id === fid) || {}).name : name, date: $("#tndate", dlg).value || todayIso(), created: Date.now(), done: false, form: clone(talkForm()), answers: {} };
    talks().push(t); save();
    openTalk(t.id);
  });
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

/* ---------- Gespräch ausfüllen / ansehen ---------- */
function openTalk(id) {
  const t = talks().find((x) => x.id === id);
  if (!t) return;
  const dlg = $("#sheet");
  // letztes früheres Gespräch mit derselben Person (für „Letztes Mal“)
  const same = (x) => x.id !== t.id && (t.fid ? x.fid === t.fid : !x.fid && x.name === t.name);
  const prev = talks().filter((x) => same(x) && talkSort(t, x) < 0).sort(talkSort)[0];
  const prevQ = prev ? new Map(talkQs(prev).map((q) => [q.id, q])) : new Map();
  let timer;
  const store = () => { clearTimeout(timer); timer = setTimeout(() => { save(); prog(); }, 300); };
  const ans = (qid) => t.answers[qid] || (t.answers[qid] = {});
  const others = friendsOrdered().filter((x) => x.id !== t.fid).map((x) => x.name);
  const chips = (q, a) => {
    const opts = q.type === "scale" ? Array.from({ length: q.max - q.min + 1 }, (_, i) => String(q.min + i)) : q.type === "friends" ? others : q.options;
    const sel = Array.isArray(a.v) ? a.v : a.v !== undefined ? [String(a.v)] : [];
    return `<div class="chips ${q.type === "scale" ? "tscale" : ""}">${opts.map((o) => `<button type="button" class="chip" data-tc="${q.id}" data-v="${esc(o)}" aria-pressed="${sel.includes(o)}">${esc(o)}</button>`).join("")}</div>`;
  };
  const qHtml = (q) => {
    const a = t.answers[q.id] || {};
    const pq = prevQ.get(q.id), pa = prev && prev.answers[q.id];
    return `<div class="tq" data-q="${q.id}">
      <p class="tqt">${esc(q.text)}</p>
      ${q.hint ? `<p class="muted small tqh">${esc(q.hint)}</p>` : ""}
      ${q.type === "text" ? "" : chips(q, a)}
      <textarea class="tta" data-tt="${q.id}" rows="${q.type === "text" ? 3 : 1}" placeholder="${q.type === "text" ? "Antwort" : "Notiz (optional)"}">${esc(a.t || "")}</textarea>
      ${pq && isAns(pa) ? `<p class="tprev small"><span class="muted">Letztes Mal (${fdate(prev.date)}):</span> ${esc(fmtAns(pq, pa))}</p>` : ""}
    </div>`;
  };
  const prog = () => { const [a, n] = talkProgress(t); const el = $("#tprog", dlg); if (el) el.textContent = `${a} von ${n} Fragen beantwortet`; };
  dlg.innerHTML = `<div class="sheet-inner wide">
    <div class="sheet-head"><button type="button" class="linkbtn" id="tclose">Schließen</button><h2>${esc(talkName(t))}</h2><button type="button" class="linkbtn" id="tdone">${t.done ? "Fertig" : "Abschließen"}</button></div>
    <div class="tmeta"><input type="date" id="tdate" value="${t.date}" max="${todayIso()}" aria-label="Datum"><span class="muted small" id="tprog"></span></div>
    ${prev ? `<p class="muted small" style="margin:0 0 8px">Unter den Fragen steht, was ${esc(talkName(t))} beim letzten Gespräch am ${fdate(prev.date)} geantwortet hat.</p>` : ""}
    ${t.form.parts.map((p, i) => `<details class="tpart" ${i === 0 || !t.done ? "open" : ""}>
      <summary><strong>${esc(p.title)}</strong> <span class="muted small">${p.qs.filter((q) => isAns(t.answers[q.id])).length}/${p.qs.length}</span></summary>
      ${p.qs.map(qHtml).join("")}
    </details>`).join("")}
    <button type="button" class="btn ghost block danger" id="tdel" style="margin-top:18px">Gespräch löschen</button>
  </div>`;
  prog();
  $("#tclose", dlg).addEventListener("click", () => { save(); dlg.close(); renderFriends(); });
  $("#tdone", dlg).addEventListener("click", () => { t.done = true; save(); dlg.close(); renderFriends(); toast("Gespräch gespeichert"); });
  $("#tdate", dlg).addEventListener("change", (e) => { if (e.target.value) { t.date = e.target.value; save(); } });
  $("#tdel", dlg).addEventListener("click", () => {
    if (!confirm(`Gespräch mit ${talkName(t)} vom ${fdate(t.date)} wirklich löschen?`)) return;
    state.talks = talks().filter((x) => x.id !== t.id); save(); dlg.close(); renderFriends();
  });
  dlg.querySelectorAll("[data-tt]").forEach((ta) => ta.addEventListener("input", () => {
    ans(ta.dataset.tt).t = ta.value; store();
    if (ta.rows < 3 && ta.value.includes("\n")) ta.rows = 3;
  }));
  dlg.querySelectorAll("[data-tc]").forEach((b) => b.addEventListener("click", () => {
    const q = talkQs(t).find((x) => x.id === b.dataset.tc), a = ans(q.id), v = b.dataset.v;
    if (q.type === "multi" || q.type === "friends") {
      const cur = Array.isArray(a.v) ? a.v : [];
      a.v = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      b.setAttribute("aria-pressed", a.v.includes(v));
    } else {
      const same = String(a.v) === v;
      a.v = same ? undefined : q.type === "scale" ? Number(v) : v;
      b.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", !same && c === b));
    }
    store();
  }));
  if (!dlg.open) dlg.showModal();
  dlg.querySelector(".sheet-inner").scrollTop = 0;
  document.activeElement?.blur();
}

/* ---------- Fragebogen festlegen ---------- */
function openTalkForm() {
  const dlg = $("#sheet");
  const draft = clone(talkForm());
  const draw = () => {
    const keep = dlg.querySelector(".sheet-inner")?.scrollTop || 0;
    dlg.innerHTML = `<div class="sheet-inner wide">
      <div class="sheet-head"><button type="button" class="linkbtn" id="tfcancel">Abbrechen</button><h2>Fragebogen</h2><button type="button" class="linkbtn" id="tfsave">Sichern</button></div>
      <p class="muted small">Gilt für alle neuen Vertiefungsgespräche. Bereits geführte Gespräche behalten ihren Fragebogen von damals.</p>
      ${draft.parts.map((p, pi) => `<section class="sq tfpart">
        <div class="tfrow"><input class="tftitle" data-pt="${pi}" value="${esc(p.title)}" aria-label="Titel des Teils">
          <button type="button" class="iconbtn" data-pmv="${pi}" data-dir="-1" ${pi === 0 ? "disabled" : ""} aria-label="Teil nach oben">↑</button>
          <button type="button" class="iconbtn" data-pmv="${pi}" data-dir="1" ${pi === draft.parts.length - 1 ? "disabled" : ""} aria-label="Teil nach unten">↓</button>
          <button type="button" class="iconbtn" data-pdel="${pi}" aria-label="Teil entfernen">✕</button></div>
        ${p.qs.map((q, qi) => `<div class="tfq">
          <div class="tfrow"><textarea data-qt="${pi}.${qi}" rows="2" placeholder="Frage" aria-label="Frage">${esc(q.text)}</textarea>
            <button type="button" class="iconbtn" data-qmv="${pi}.${qi}" data-dir="-1" ${qi === 0 ? "disabled" : ""} aria-label="Nach oben">↑</button>
            <button type="button" class="iconbtn" data-qmv="${pi}.${qi}" data-dir="1" ${qi === p.qs.length - 1 ? "disabled" : ""} aria-label="Nach unten">↓</button>
            <button type="button" class="iconbtn" data-qdel="${pi}.${qi}" aria-label="Frage entfernen">✕</button></div>
          <div class="tfrow tfopts">
            <select data-qty="${pi}.${qi}" aria-label="Antwortart">${TALK_TYPES.map(([k, l]) => `<option value="${k}" ${q.type === k ? "selected" : ""}>${l}</option>`).join("")}</select>
            ${q.type === "choice" || q.type === "multi" ? `<input data-qo="${pi}.${qi}" value="${esc(q.options.join(", "))}" placeholder="Antworten, mit Komma getrennt" aria-label="Antworten">` : ""}
            ${q.type === "scale" ? `<span class="small">von</span><input class="tfnum" type="number" data-qmin="${pi}.${qi}" value="${q.min}"><span class="small">bis</span><input class="tfnum" type="number" data-qmax="${pi}.${qi}" value="${q.max}">` : ""}
            ${q.type === "friends" ? `<span class="muted small">Namen aus deiner Freundesliste</span>` : ""}
          </div>
          <input class="tfhint" data-qh="${pi}.${qi}" value="${esc(q.hint || "")}" placeholder="Erklärung (optional)" aria-label="Erklärung">
        </div>`).join("")}
        <button type="button" class="linkbtn" data-qadd="${pi}">Frage hinzufügen</button>
      </section>`).join("")}
      <button type="button" class="btn ghost block" id="tfpadd">Teil hinzufügen</button>
      <button type="button" class="linkbtn" id="tfreset" style="margin-top:14px">Auf Vorlage zurücksetzen</button>
    </div>`;
    dlg.querySelector(".sheet-inner").scrollTop = keep;
    const at = (s) => { const [pi, qi] = s.split(".").map(Number); return [draft.parts[pi], qi]; };
    const q = (s) => { const [p, qi] = at(s); return p.qs[qi]; };
    $("#tfcancel", dlg).addEventListener("click", () => dlg.close());
    $("#tfsave", dlg).addEventListener("click", () => {
      for (const p of draft.parts) {
        p.title = p.title.trim() || "Ohne Titel";
        p.qs = p.qs.filter((x) => x.text.trim());
        for (const x of p.qs) {
          x.text = x.text.trim();
          if ((x.type === "choice" || x.type === "multi") && x.options.length < 2) return toast(`„${x.text}“: mindestens zwei Antworten, mit Komma getrennt`);
          if (x.type === "scale" && !(x.max > x.min)) return toast(`„${x.text}“: Skala „bis“ muss größer als „von“ sein`);
        }
      }
      state.talkForm = draft; save(); dlg.close(); toast("Fragebogen gesichert");
    });
    $("#tfreset", dlg).addEventListener("click", () => { if (confirm("Fragebogen auf die Vorlage zurücksetzen?")) { const d = TALK_DEFAULT(); draft.parts = d.parts; draw(); } });
    $("#tfpadd", dlg).addEventListener("click", () => { draft.parts.push({ id: uid(), title: "Neuer Teil", qs: [{ id: uid(), ...tq("") }] }); draw(); });
    dlg.querySelectorAll("[data-pt]").forEach((i) => i.addEventListener("input", () => { draft.parts[+i.dataset.pt].title = i.value; }));
    dlg.querySelectorAll("[data-qt]").forEach((i) => i.addEventListener("input", () => { q(i.dataset.qt).text = i.value; }));
    dlg.querySelectorAll("[data-qh]").forEach((i) => i.addEventListener("input", () => { q(i.dataset.qh).hint = i.value; }));
    dlg.querySelectorAll("[data-qo]").forEach((i) => i.addEventListener("input", () => { q(i.dataset.qo).options = Array.from(new Set(i.value.split(",").map((x) => x.trim()).filter(Boolean))); }));
    dlg.querySelectorAll("[data-qmin]").forEach((i) => i.addEventListener("input", () => { q(i.dataset.qmin).min = Math.round(+i.value || 0); }));
    dlg.querySelectorAll("[data-qmax]").forEach((i) => i.addEventListener("input", () => { q(i.dataset.qmax).max = Math.round(+i.value || 0); }));
    dlg.querySelectorAll("[data-qty]").forEach((s) => s.addEventListener("change", () => {
      const x = q(s.dataset.qty); x.type = s.value;
      if ((x.type === "choice" || x.type === "multi") && x.options.length < 2) x.options = ["Ja", "Nein"];
      if (x.type === "scale" && !(x.max > x.min)) { x.min = 1; x.max = 10; }
      draw();
    }));
    dlg.querySelectorAll("[data-qadd]").forEach((b) => b.addEventListener("click", () => { draft.parts[+b.dataset.qadd].qs.push({ id: uid(), ...tq("") }); draw(); dlg.querySelector(`[data-qt="${b.dataset.qadd}.${draft.parts[+b.dataset.qadd].qs.length - 1}"]`)?.focus(); }));
    dlg.querySelectorAll("[data-qdel]").forEach((b) => b.addEventListener("click", () => { const [p, qi] = at(b.dataset.qdel); p.qs.splice(qi, 1); draw(); }));
    dlg.querySelectorAll("[data-qmv]").forEach((b) => b.addEventListener("click", () => { const [p, qi] = at(b.dataset.qmv), j = qi + +b.dataset.dir; [p.qs[qi], p.qs[j]] = [p.qs[j], p.qs[qi]]; draw(); }));
    dlg.querySelectorAll("[data-pmv]").forEach((b) => b.addEventListener("click", () => { const i = +b.dataset.pmv, j = i + +b.dataset.dir; [draft.parts[i], draft.parts[j]] = [draft.parts[j], draft.parts[i]]; draw(); }));
    dlg.querySelectorAll("[data-pdel]").forEach((b) => b.addEventListener("click", () => { const p = draft.parts[+b.dataset.pdel]; if (p.qs.length && !confirm(`Teil „${p.title}“ mit ${p.qs.length} Fragen entfernen?`)) return; draft.parts.splice(+b.dataset.pdel, 1); draw(); }));
  };
  draw();
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}
