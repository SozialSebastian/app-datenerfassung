/* Mosaik – Einstellungen (Seite) */
"use strict";

function renderData() {
  const view = $("#view");
  const days = Object.keys(state.answers).sort();
  const nAnswers = days.reduce((s, d) => s + Object.keys(state.answers[d]).length, 0);
  const last = state.lastBackup ? longDate(state.lastBackup.slice(0, 10)) + " " + state.lastBackup.slice(0, 4) : "noch nie";
  const backupOld = !state.lastBackup || (Date.now() - new Date(state.lastBackup).getTime()) > 30 * 864e5;
  const base = location.href.split("#")[0].split("?")[0];
  const connected = !!settings.token;
  const p = settings.push;
  const pushSupport = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const hq = healthQuestions();
  const lastIn = settings.lastInbox ? new Date(settings.lastInbox).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "noch nie";

  let pushBody;
  if (!connected) pushBody = `<p class="muted small">Trag zuerst unten unter „Verbindung“ deinen Schlüssel ein.</p>`;
  else if (!pushSupport || !standalone) pushBody = `<p class="muted small">Mitteilungen gehen nur in der App vom Home-Bildschirm (ab iOS 16.4). Öffne Mosaik über das Icon und komm hierher zurück.</p>`;
  else pushBody = `
      <label class="switch row" style="margin-top:0"><input type="checkbox" id="pushon" ${p.on ? "checked" : ""}><span>Tägliche Erinnerung</span></label>
      <div class="timerow"><span>Uhrzeit</span><input type="time" id="pushtime" value="${esc(p.time)}" class="timein"></div>
      <p class="muted small" style="margin:8px 0 0">Kommt nur, wenn an dem Tag noch Fragen offen sind. Tippen auf die Mitteilung startet direkt die Abfrage für diesen Tag.</p>
      <p class="small" id="pushmsg" style="margin:8px 0 0"></p>
      <div class="subsep"></div>
      <label class="switch row" style="margin-top:0"><input type="checkbox" id="mornon" ${settings.morning.on ? "checked" : ""}><span>Morgen-Erinnerung</span></label>
      <div class="timerow"><span>Uhrzeit</span><input type="time" id="morntime" value="${esc(settings.morning.time)}" class="timein"></div>
      <p class="muted small" style="margin:8px 0 0">${state.questions.some((q) => !q.archived && q.morning) ? `Fragt die Fragen mit „Morgens abfragen“ ab (${state.questions.filter((q) => !q.archived && q.morning && !q.cond).length}). Kommt nur, wenn sie heute noch offen sind.` : `Markier dazu bei einer Frage „Morgens abfragen“ (Frage bearbeiten → unter Thema).`}</p>
      <p class="small" id="mornmsg" style="margin:8px 0 0"></p>
      <div class="subsep"></div>
      <label class="switch row" style="margin-top:0"><input type="checkbox" id="goalpushon" ${settings.goalpush.on ? "checked" : ""}><span>Ziel-Erinnerung</span></label>
      <p class="muted small" style="margin:8px 0 0">Meldet sich einmal, sobald ein Ziel zu kippen droht, z. B. „Bouldern: ab heute an jedem Tag nötig (noch 2× bis Sonntag)“ oder wenn eine Höchstgrenze erreicht ist. Nur tagsüber. Tippen öffnet die Ziele.</p>
      <p class="small" id="goalpushmsg" style="margin:8px 0 0"></p>`;

  const w = settings.weekly;
  const WDN = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  let weeklyBody = "";
  if (connected && pushSupport && standalone) weeklyBody = `
      <label class="switch row"><input type="checkbox" id="weekon" ${w.on ? "checked" : ""}><span>Mitteilung, sobald die Woche vollständig ist</span></label>
      <div class="timerow"><span>Frühestens um</span><input type="time" id="weektime" value="${esc(w.time)}" class="timein"></div>
      <p class="muted small" style="margin:6px 0 0">Kommt, wenn Montag bis Sonntag beantwortet sind – meist Sonntagabend, sonst sobald du fehlende Tage nachträgst. Vorher nicht vor dieser Uhrzeit.</p>
      <p class="small" id="weekmsg" style="margin:8px 0 0"></p>`;
  else if (!connected) weeklyBody = `<p class="muted small" style="margin-top:10px">Für die wöchentliche Mitteilung zuerst unten unter „Verbindung“ den Schlüssel eintragen.</p>`;

  view.innerHTML = `
    <div class="dayhead"><h1>Einstellungen</h1></div>

    ${profilePanel()}

    ${questionsPanel()}

    ${answersPanel()}

    <section class="panel">
      <h2>Wochenbericht</h2>
      <p class="muted small">Fasst deine Woche zusammen: erfasste Tage, Ziele, Trends und deine Fragen im Vergleich zu sonst.</p>
      <button class="btn block hold-btn" id="reportopen">Wochenbericht anzeigen</button>
      ${weeklyBody}
    </section>

    <section class="panel">
      <h2>Grafik erstellen</h2>
      <p class="muted small">Speichert Übersichten als PNG, z. B. für Präsentationen: Freunde und Quoten, Veränderung, Trends, Ziele, einzelne Fragen und den Wochenbericht. Mehrere auf einmal möglich.</p>
      <button class="btn block" id="exportopen">Grafiken auswählen</button>
    </section>

    <section class="panel">
      <h2>Excel-Tabelle</h2>
      <p class="muted">Enthält immer alle bisher erfassten Tage, eine Spalte pro Frage. In der App wird dabei nichts gelöscht.</p>
      <p class="stat">${days.length} Tage · ${nAnswers} Antworten${days.length ? ` · seit ${longDate(days[0])} ${days[0].slice(0, 4)}` : ""}</p>
      <button class="btn block hold-btn" id="xlsx" ${days.length ? "" : "disabled"}>Excel erstellen</button>
    </section>

    <section class="panel">
      <h2>Erinnerung</h2>
      ${pushBody}
    </section>

    <section class="panel">
      <h2>Orte</h2>
      <label class="switch row" style="margin-top:0"><input type="checkbox" id="placeson" ${settings.places.on ? "checked" : ""}><span>Stadt beim Öffnen erfassen</span></label>
      <p class="muted small" style="margin:8px 0 0">Beim Öffnen (höchstens einmal pro Stunde) wird die Stadt gespeichert, nur der Name und nur auf dem iPhone. Dafür gehen auf ca. 1 km gerundete Koordinaten an BigDataCloud bzw. OpenStreetMap. Dazu kommt das Wetter des Tages von Open-Meteo, genutzt nur für Zusammenhänge in den Trends.${settings.places.on ? ` Wetter für ${Object.keys(state.weather || {}).length} Tage.` : ""}</p>
      ${settings.places.on ? `<p class="small hstatus" id="geoperm" style="margin:8px 0 0" hidden></p>` : ""}
      ${settings.places.on ? `<details style="margin-top:8px"><summary class="small"><strong>Nicht jedes Mal nach Erlaubnis fragen</strong></summary>
        <ol class="steps small" style="margin:6px 0 0">
          <li>iPhone-Einstellungen → <strong>Apps → Safari</strong> → ganz unten <strong>Standort</strong> → <strong>Erlauben</strong>.</li>
          <li>Einstellungen → <strong>Datenschutz & Sicherheit → Ortungsdienste → Safari-Websites</strong> → <strong>Beim Verwenden der App</strong>, „Genauer Standort“ darf aus sein.</li>
        </ol>
        <p class="muted small" style="margin:6px 0 0">Ohne diese Einstellung fragt iOS bei Web-Apps immer wieder. Mosaik fragt dann von sich aus höchstens alle 4 Stunden (beim Öffnen).</p>
      </details>` : ""}
      ${settings.places.on && settings.places.err ? `<p class="small" style="margin:8px 0 0;color:var(--danger)">Letzter Fehler ${esc(settings.places.err)}</p>` : ""}
      ${settings.places.on ? `<button class="btn ghost block" id="placenow" style="margin-top:12px">Standort jetzt erfassen</button>` : ""}
    </section>


    <section class="panel">
      <h2>Sicherung</h2>
      <p class="muted">Die Daten liegen nur auf diesem iPhone. Löschst du die App vom Home-Bildschirm, sind sie weg. Sichere deshalb regelmäßig, am besten in iCloud Drive.</p>
      <p class="small ${backupOld ? "" : "muted"}">Letzte Sicherung: ${last}</p>
      <div class="stack">
        <button class="btn" id="backup">Sicherung erstellen</button>
        <button class="btn ghost" id="restore">Sicherung wiederherstellen</button>
        <input type="file" id="restorefile" accept="application/json,.json" hidden>
      </div>
    </section>

    <section class="panel">
      <h2>Schnittstelle Apple Health</h2>
      ${connected ? `
      <p class="small hstatus ${settings.shortcutDone || hq.length ? "ok" : ""}">${hq.length
        ? `<strong>Eingerichtet.</strong> Empfängt: ${hq.map((q) => esc(q.text)).join(", ")}. Zuletzt abgeholt: ${lastIn}`
        : settings.shortcutDone ? "<strong>Kurzbefehl angelegt.</strong> Noch keine Werte empfangen." : "Noch nicht eingerichtet."}</p>
      <p class="muted small">Ein Kurzbefehl schickt Werte aus Health an Mosaik, z. B. Schlaf und Schritte. Für jeden neuen Wert legt Mosaik automatisch ein Feld an, das unter „Tag“ erscheint und nicht abgefragt wird.</p>
      <div class="stack">
        <button class="btn ghost" id="copyhdr">Header kopieren</button>
        <button class="btn ghost" id="inboxnow">Jetzt abholen</button>
      </div>
      <label class="switch row"><input type="checkbox" id="scdone" ${settings.shortcutDone ? "checked" : ""}><span>Ich habe den Kurzbefehl angelegt</span></label>
      <details ${settings.shortcutDone ? "" : "open"}>
        <summary><strong>Anleitung: Kurzbefehl anlegen</strong></summary>
        <p class="small" style="margin:8px 0 4px">Der Kurzbefehl schickt die letzten 7 Tage auf einmal. Mosaik ordnet jeden Wert seinem Tag zu: Schritte von 0–24 Uhr, Schlaf beim Tag des Aufwachens. Ältere Werte werden dabei aktualisiert.</p>
        <p class="small" style="margin:4px 0">Beim Schlaf zählt nur die tatsächlich geschlafene Zeit: Wachphasen in der Nacht werden abgezogen, doppelte Messungen (Watch und iPhone) nur einmal gezählt, kurze Nickerchen ignoriert. Dazu kommen Einschlaf- und Aufwachzeit.</p>
        <p class="small" style="margin:10px 0 4px"><strong>1. Schritte</strong></p>
        <ol class="steps small">
          <li><strong>Health-Messungen suchen</strong>: Typ <em>Schritte</em>, Startdatum <em>in den letzten 7 Tagen</em>, Gruppieren nach <em>Stunde</em>. Mosaik bildet daraus die Tagessumme und nutzt den Stundenverlauf für den Bereich Gesundheit (nach <em>Tag</em> gruppiert geht auch).</li>
        </ol>
        <p class="small" style="margin:10px 0 4px"><strong>2. Schlaf</strong></p>
        <ol class="steps small">
          <li><strong>Health-Messungen suchen</strong> (nicht „filtern“): Typ <em>Schlaf</em>, Startdatum <em>in den letzten 7 Tagen</em>, <em>Wert ist nicht Im Bett</em>, <em>Wert ist nicht Wach</em>.</li>
        </ol>
        <p class="small" style="margin:10px 0 4px"><strong>3. Senden</strong></p>
        <ol class="steps small">
          <li><strong>Inhalte von URL abrufen</strong>: <code>${SERVER}/in</code>, Methode <em>POST</em>, Header <code>Authorization</code> = Wert aus „Header kopieren“, Haupttext <em>JSON</em>.</li>
          <li>Felder vom Typ <strong>Array</strong> (jeweils Variable einsetzen, antippen und die Eigenschaft wählen):
            <br><code>schritte</code> → Schritte-Messungen → <em>Wert</em>
            <br><code>schritte_datum</code> → Schritte-Messungen → <em>Startdatum</em>
            <br><code>schlaf_start</code> → Schlaf-Messungen → <em>Startdatum</em>
            <br><code>schlaf_ende</code> → Schlaf-Messungen → <em>Enddatum</em>
            <br><code>schlaf_wert</code> → Schlaf-Messungen → <em>Wert</em> (Kern, Tief, REM, Wach …; damit werden Wachphasen sicher erkannt)</li>
          <li>Bei den Datumsfeldern das Datumsformat auf <em>ISO 8601</em> stellen (Variable antippen → Datumsformat), dann ist die Zuordnung eindeutig.</li>
          <li>Kurzbefehle → <strong>Automation</strong> → <em>Tageszeit</em> (z. B. 10:00, täglich) → <em>Sofort ausführen</em>. Morgens ist das iPhone meist entsperrt, dann darf der Kurzbefehl Health lesen.</li>
        </ol>
        <p class="small" style="margin:10px 0 4px"><strong>4. Für den Bereich Gesundheit</strong> (Ruhepuls, HRV, Pulsverlauf, Trainings …): Liste unter Gesundheit → Zahnrad oben rechts.</p>
        <p class="small muted">Einzelwerte gehen weiterhin, z. B. Zahl-Feld <code>ruhepuls</code> (heute) oder <code>kalorien_gestern</code> (Vortag). Werte liegen beim Dienst nur, bis Mosaik sie abholt.</p>
      </details>`
      : `<p class="muted small">Trag zuerst unten unter „Verbindung“ deinen Schlüssel ein.</p>`}
    </section>

    ${chessSettingsPanel()}

    ${notionSettingsPanel()}

    <section class="panel">
      <h2>Verbindung</h2>
      <p class="muted small">Der Mosaik-Dienst verschickt die Erinnerung und nimmt Werte von Kurzbefehlen an. Deine Antworten bleiben auf dem iPhone.</p>
      ${connected
        ? `<p class="small" id="connmsg"><strong>Schlüssel gespeichert.</strong> <span class="muted">Dienst: ${SERVER.replace("https://", "")}</span></p>
           <div class="stack"><button class="btn ghost" id="conntest">Verbindung prüfen</button><button class="btn ghost" id="connreset">Schlüssel entfernen</button></div>`
        : `<label class="field">Schlüssel<input id="tokenin" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Schlüssel einfügen"></label>
           <button class="btn block" id="connsave">Sichern und prüfen</button>
           <p class="small" id="connmsg" style="margin:8px 0 0"></p>`}
    </section>

    <p class="muted small">Adresse dieser App: <code>${esc(base)}</code></p>`;

  wireQuestions($("#qpanel"));
  wireProfile();
  wireAnswers();
  $("#xlsx").addEventListener("click", exportExcel);
  $("#backup").addEventListener("click", exportBackup);
  $("#restore").addEventListener("click", () => $("#restorefile").click());
  $("#restorefile").addEventListener("change", importBackup);
  $("#scdone")?.addEventListener("change", (e) => { settings.shortcutDone = e.target.checked; saveSettings(); renderData(); });

  const msg = (id, t, bad) => { const el = $("#" + id); if (el) { el.textContent = t; el.style.color = bad ? "var(--danger)" : ""; } };

  $("#connsave")?.addEventListener("click", async () => {
    const t = $("#tokenin").value.trim();
    if (!t) return msg("connmsg", "Bitte den Schlüssel einfügen.", true);
    settings.token = t;
    try { await api("/ping"); saveSettings(); toast("Verbunden"); renderData(); }
    catch (e) { settings.token = ""; msg("connmsg", e.message, true); }
  });
  $("#conntest")?.addEventListener("click", async () => {
    try { await api("/ping"); msg("connmsg", "Verbindung klappt."); } catch (e) { msg("connmsg", e.message, true); }
  });
  $("#connreset")?.addEventListener("click", async () => {
    if (!confirm("Schlüssel entfernen? Die Erinnerung wird dann abgeschaltet.")) return;
    try { await disablePush(); } catch (e) { /* egal */ }
    settings.token = ""; saveSettings(); renderData();
  });

  $("#pushon")?.addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      if (on) { await enablePush($("#pushtime").value || "23:00"); toast(`Erinnerung täglich um ${settings.push.time} Uhr`); }
      else { await disablePush(); toast("Erinnerung aus"); }
      renderData();
    } catch (err) { e.target.checked = !on; msg("pushmsg", err.message, true); }
  });
  $("#pushtime")?.addEventListener("change", async (e) => {
    const t = e.target.value;
    if (!/^\d{2}:\d{2}$/.test(t)) return;
    settings.push.time = t; saveSettings();
    if (!settings.push.on) return;
    try { await enablePush(t); toast(`Erinnerung täglich um ${t} Uhr`); } catch (err) { msg("pushmsg", err.message, true); }
  });
  $("#mornon")?.addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      if (on) { await enableMorning($("#morntime").value || "10:00"); toast(`Morgen-Erinnerung um ${settings.morning.time} Uhr`); }
      else { await disableMorning(); toast("Morgen-Erinnerung aus"); }
      renderData();
    } catch (err) { e.target.checked = !on; msg("mornmsg", err.message, true); }
  });
  $("#morntime")?.addEventListener("change", async (e) => {
    const t = e.target.value;
    if (!/^\d{2}:\d{2}$/.test(t)) return;
    settings.morning.time = t; saveSettings();
    if (!settings.morning.on) return;
    try { await enableMorning(t); toast(`Morgen-Erinnerung um ${t} Uhr`); } catch (err) { msg("mornmsg", err.message, true); }
  });
  $("#copyhdr")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(`Bearer ${settings.token}`); toast("Header-Wert kopiert"); }
    catch (e) { toast("Kopieren nicht möglich"); }
  });
  $("#inboxnow")?.addEventListener("click", () => fetchInbox(true));

  $("#reportopen").addEventListener("click", () => openReport());
  $("#goalpushon")?.addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      if (on) { await enableGoalPush(); toast("Ziel-Erinnerung an"); }
      else { await disableGoalPush(); toast("Ziel-Erinnerung aus"); }
      renderData();
    } catch (err) { e.target.checked = !on; msg("goalpushmsg", err.message, true); }
  });
  $("#placeson").addEventListener("change", async (e) => {
    settings.places.on = e.target.checked; settings.places.last = 0; saveSettings();
    if (e.target.checked) { await capturePlace(true); syncWeather(true); } else toast("Orte und Wetter werden nicht mehr erfasst");
    renderData();
  });
  $("#placenow")?.addEventListener("click", async () => { await capturePlace(true); renderData(); });
  // Status der Standort-Erlaubnis, wie iOS sie dieser Web-App meldet
  if ($("#geoperm") && navigator.permissions) navigator.permissions.query({ name: "geolocation" }).then((p) => {
    const el = $("#geoperm");
    if (!el) return;
    const t = { granted: ["ok", "<strong>Standort dauerhaft erlaubt.</strong> Mosaik erfasst ihn ohne Rückfrage beim Öffnen (höchstens einmal pro Stunde)."],
      prompt: ["", "<strong>iOS fragt jedes Mal nach.</strong> Mosaik lässt deshalb höchstens alle 4 Stunden fragen."],
      denied: ["", "<strong>Standort abgelehnt.</strong> Orte werden nicht erfasst."] }[p.state];
    if (!t) return;
    el.className = `small hstatus ${t[0]}`; el.innerHTML = t[1]; el.hidden = false;
  }).catch(() => {});
  wireChessSettings();
  wireNotionSettings();
  settingsNav();
  $("#exportopen").addEventListener("click", openExport);
  const weekSave = async () => {
    const day = 0, time = $("#weektime").value || "19:00";
    settings.weekly.day = day; settings.weekly.time = time; saveSettings();
    if (!settings.weekly.on) return;
    try { await enableWeekly(day, time); toast(`Wochenbericht frühestens um ${time} Uhr`); } catch (err) { msg("weekmsg", err.message, true); }
  };
  $("#weekon")?.addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      if (on) { await enableWeekly(0, $("#weektime").value || "19:00"); toast("Wochenbericht kommt, sobald die Woche vollständig ist"); }
      else { await disableWeekly(); toast("Wochenbericht-Mitteilung aus"); }
      renderData();
    } catch (err) { e.target.checked = !on; msg("weekmsg", err.message, true); }
  });
  $("#weektime")?.addEventListener("change", (e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) weekSave(); });
}

/* Desktop: Einstellungen in der Seitenleiste aufklappen, immer nur ein Bereich sichtbar (auf dem iPhone bleibt alles untereinander) */
let settingsSec = "fragen";
function settingsNav() {
  const panels = [...document.querySelectorAll("#view > section.panel")];
  const items = panels.map((p) => {
    const t = (p.querySelector("h2")?.textContent || "").trim();
    const id = t.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-").replace(/^-|-$/g, "");
    p.dataset.sec = id;
    return { id, label: t.replace(/^Schnittstelle\s+/, "") };
  });
  if (!items.some((x) => x.id === settingsSec)) settingsSec = items[0]?.id || "";
  let nav = document.querySelector(".tabbar .subnav");
  if (!nav) {
    nav = document.createElement("div");
    nav.className = "subnav";
    document.querySelector('.tabbar [data-tab="data"]').after(nav);
  }
  nav.innerHTML = items.map((x) => `<button type="button" data-sec="${x.id}">${esc(x.label)}</button>`).join("");
  const show = (id) => {
    settingsSec = id;
    panels.forEach((p) => p.classList.toggle("sec-on", p.dataset.sec === id));
    nav.querySelectorAll("button").forEach((b) => (b.dataset.sec === id ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  };
  nav.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    if (tab !== "data") { tab = "data"; render(); }
    show(b.dataset.sec); window.scrollTo(0, 0);
  }));
  show(settingsSec);
}

/* ================= Profil: Angaben über dich ================= */
// Arbeitsfragen: Vorlage „Arbeit“ (oder schon mit Vertrag) mit Stunden-Folgefrage
const workQuestions = () => state.questions.filter((q) => !q.archived && hoursChildOf(q) && (q.template === "work" || q.contract));
function profilePanel() {
  const p = state.profile || {};
  const jobs = workQuestions();
  return `<section class="panel" id="profil">
      <h2>Profil</h2>
      <div class="row2">
        <label class="field">Geburtsjahr<input id="pborn" type="number" inputmode="numeric" placeholder="z. B. 1998" value="${p.born || ""}"></label>
        <label class="field">Geschlecht<select id="psex"><option value="">–</option><option value="m" ${p.sex === "m" ? "selected" : ""}>männlich</option><option value="w" ${p.sex === "w" ? "selected" : ""}>weiblich</option></select></label>
      </div>
      <div class="gline" style="margin-top:0"><span>Schlafbedarf</span><input id="psleep" class="gin" type="text" inputmode="decimal" value="${fmtNum(p.sleepNeed || 8)}"><span>Stunden</span></div>
      ${jobs.map((q) => `<div class="subsep"></div>
        <div class="olab">Arbeitsvertrag · ${esc(q.text)}</div>
        <div class="gline" style="margin-top:0"><span>Vertraglich</span><input class="gin" data-ch="${q.id}" type="text" inputmode="decimal" value="${esc(q.contract ? fmtNum(q.contract.h) : "")}" placeholder="20"><span>Stunden</span></div>
        <div class="seg seg-2" role="group" style="margin:10px 0">${[["week", "pro Woche"], ["month", "pro Monat"]].map(([v, l]) => `<button type="button" data-cper="${q.id}:${v}" aria-pressed="${(q.contract?.per || "week") === v}">${l}</button>`).join("")}</div>
        <div class="gline" style="margin-top:0"><span>Stundenlohn</span><input class="gin wide" data-cw="${q.id}" type="text" inputmode="decimal" value="${esc(q.contract && q.contract.wage ? q.contract.wage.toFixed(2).replace(".", ",") : "")}" placeholder="15,00"><span>€</span></div>`).join("")}
      <p class="muted small" style="margin:10px 0 0">Für Mosaik-Alter, Pulszonen, Schlafschuld${jobs.length ? " und den effektiven Stundenlohn" : ""}. Bleibt auf diesem iPhone.</p>
    </section>`;
}
function wireProfile() {
  const P = () => (state.profile && typeof state.profile === "object" ? state.profile : (state.profile = {}));
  $("#pborn")?.addEventListener("change", (e) => {
    const b = parseInt(e.target.value, 10);
    if (e.target.value && !(b > 1900 && b <= new Date().getFullYear() - 10)) return toast("Bitte ein gültiges Geburtsjahr");
    if (b) P().born = b; else delete P().born;
    save(); toast("Gesichert");
  });
  $("#psex")?.addEventListener("change", (e) => { if (e.target.value) P().sex = e.target.value; else delete P().sex; save(); toast("Gesichert"); });
  $("#psleep")?.addEventListener("change", (e) => {
    const h = parseNum(e.target.value);
    if (!(h >= 4 && h <= 12)) { e.target.value = fmtNum(P().sleepNeed || 8); return toast("Schlafbedarf zwischen 4 und 12 Stunden"); }
    P().sleepNeed = h; save(); toast("Gesichert");
  });
  const setC = (id, patch) => {
    const q = qById(id); if (!q) return;
    const c = { h: 0, wage: 0, per: "week", ...(q.contract || {}), ...patch };
    q.contract = c.h > 0 || c.wage > 0 ? c : null;
    save();
  };
  document.querySelectorAll("[data-ch]").forEach((i) => i.addEventListener("change", () => { setC(i.dataset.ch, { h: parseNum(i.value) || 0 }); toast("Gesichert"); }));
  document.querySelectorAll("[data-cw]").forEach((i) => i.addEventListener("change", () => { setC(i.dataset.cw, { wage: parseNum(i.value) || 0 }); toast("Gesichert"); }));
  document.querySelectorAll("[data-cper]").forEach((b) => b.addEventListener("click", () => {
    const [id, per] = b.dataset.cper.split(":");
    setC(id, { per });
    b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  }));
}

/* ================= Antworten bearbeiten ================= */
// Auswahlfragen mit gespeicherten Antworten; je Antworttext die Anzahl, alte (nicht mehr vorhandene) Texte markiert
let ansQ = null;
const ansQuestions = () => ordered().map((o) => o.q).filter((q) => q.type === "choice" && !isHealthQ(q) && answerCount(q.id));
function answerTally(q) {
  const cnt = {};
  for (const a of Object.values(state.answers)) {
    const v = a[q.id];
    if (!hasData(v)) continue;
    for (const k of Array.isArray(v) ? v : [v]) cnt[k] = (cnt[k] || 0) + 1;
  }
  return Object.entries(cnt).sort((x, y) => y[1] - x[1]);
}
const isOldText = (q, k) => !q.options.includes(k);
// Antworten zu Fragen, die es nicht mehr gibt
function orphanIds() {
  const ids = new Set(state.questions.map((q) => q.id)), out = {};
  for (const a of Object.values(state.answers)) for (const id of Object.keys(a)) if (!ids.has(id)) out[id] = (out[id] || 0) + 1;
  return out;
}
function answersPanel() {
  const qs = ansQuestions();
  if (ansQ && !qs.some((q) => q.id === ansQ)) ansQ = null;
  const q = qById(ansQ) || qs[0];
  const tally = q ? answerTally(q) : [];
  const orph = Object.values(orphanIds()).reduce((t, n) => t + n, 0);
  const old = qs.flatMap((x) => answerTally(x).filter(([k]) => isOldText(x, k)).map(([k, n]) => ({ q: x, k, n })));
  const row = (qq, k, n, sub) => `<div class="ansrow"><button type="button" class="atxt${isOldText(qq, k) ? " aold" : ""}" data-aren="${qq.id}" data-aval="${esc(k)}">${esc(k)}${sub ? `<small>${esc(sub)}</small>` : ""}</button><span class="pill">${n}×</span><button type="button" class="iconbtn" data-adel="${qq.id}" data-aval="${esc(k)}" aria-label="Antworten „${esc(k)}“ löschen">✕</button></div>`;
  return `<section class="panel" id="antworten">
      <h2>Antworten bearbeiten</h2>
      ${qs.length ? `<label class="field" style="margin-bottom:6px"><select id="ansq">${qs.map((x) => `<option value="${x.id}" ${x === q ? "selected" : ""}>${esc(x.text)}${x.archived ? " (ausgeblendet)" : ""}</option>`).join("")}</select></label>
      <div class="alist">${tally.map(([k, n]) => row(q, k, n)).join("")}</div>` : `<p class="muted small">Noch keine Antworten auf Auswahlfragen.</p>`}
      ${orph || old.length ? `<div class="olab" style="margin-top:16px">Aufräumen</div>
      <div class="alist">
        ${orph ? `<div class="ansrow"><span class="atxt">Verwaiste Antworten<small>Frage gelöscht</small></span><span class="pill">${orph}</span><button type="button" class="iconbtn" id="orphdel" aria-label="Verwaiste Antworten löschen">✕</button></div>` : ""}
        ${old.map((o) => row(o.q, o.k, o.n, o.q.text)).join("")}
      </div>` : ""}
    </section>`;
}
// Antworttext k bei Frage q überall entfernen; Folgefragen, deren Bedingung dann nicht mehr passt, mit aufräumen
function deleteAnswerValue(q, k) {
  const kids = [...descendants(q.id)].map(qById).filter(Boolean);
  for (const [d, a] of Object.entries(state.answers)) {
    const v = a[q.id];
    if (Array.isArray(v) ? !v.includes(k) : v !== k) continue;
    if (Array.isArray(v) && v.length > 1) a[q.id] = v.filter((x) => x !== k);
    else delete a[q.id];
    for (let changed = true; changed; ) {
      changed = false;
      for (const c of kids) if (c.id in a && !condMet(c, a)) { delete a[c.id]; changed = true; }
    }
    if (!Object.keys(a).length) delete state.answers[d];
  }
  save();
}
// Antworttext umbenennen: alle gespeicherten Antworten, die Antwortmöglichkeit und Bedingungen von Folgefragen
function renameAnswerValue(q, k, nk) {
  for (const a of Object.values(state.answers)) {
    const v = a[q.id];
    if (Array.isArray(v)) { if (v.includes(k)) a[q.id] = [...new Set(v.map((x) => (x === k ? nk : x)))]; }
    else if (v === k) a[q.id] = nk;
  }
  const i = q.options.indexOf(k);
  if (i >= 0) { if (q.options.includes(nk)) q.options.splice(i, 1); else q.options[i] = nk; }
  for (const c of state.questions) if (c.cond && c.cond.qid === q.id && c.cond.values.includes(k)) c.cond.values = [...new Set(c.cond.values.map((x) => (x === k ? nk : x)))];
  save();
}
function wireAnswers() {
  document.querySelectorAll("[data-aren]").forEach((b) => b.addEventListener("click", () => {
    const q = qById(b.dataset.aren), k = b.dataset.aval, row = b.closest(".ansrow");
    row.innerHTML = `<input class="aren" value="${esc(k)}" autocomplete="off" aria-label="Neuer Text"><button type="button" class="btn small" data-aok>Ändern</button><button type="button" class="iconbtn" data-acancel aria-label="Abbrechen">✕</button>`;
    const inp = row.querySelector("input"); inp.focus(); inp.select();
    const back = () => { const y = scrollY; renderData(); scrollTo(0, y); };
    const ok = () => {
      const nk = inp.value.trim();
      if (!nk || nk === k) return back();
      const merge = q.options.includes(nk) || answerTally(q).some(([x]) => x === nk);
      const n = (answerTally(q).find(([x]) => x === k) || [, 0])[1];
      if (merge && !confirm(`„${nk}“ gibt es schon. ${n} Antwort${n === 1 ? "" : "en"} „${k}“ damit zusammenlegen?`)) return;
      renameAnswerValue(q, k, nk); back(); toast(`${n} Antwort${n === 1 ? "" : "en"} geändert`);
    };
    row.querySelector("[data-aok]").addEventListener("click", ok);
    row.querySelector("[data-acancel]").addEventListener("click", back);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); if (e.key === "Escape") back(); });
  }));
  $("#ansq")?.addEventListener("change", (e) => { ansQ = e.target.value; const y = scrollY; renderData(); scrollTo(0, y); });
  document.querySelectorAll("[data-adel]").forEach((b) => b.addEventListener("click", () => {
    const q = qById(b.dataset.adel), k = b.dataset.aval;
    const n = (answerTally(q).find(([x]) => x === k) || [, 0])[1];
    if (!confirm(`${n} Antwort${n === 1 ? "" : "en"} „${k}“ bei „${q.text}“ löschen? Das lässt sich nicht rückgängig machen.`)) return;
    deleteAnswerValue(q, k);
    const y = scrollY; renderData(); scrollTo(0, y); toast(`${n} Antwort${n === 1 ? "" : "en"} gelöscht`);
  }));
  $("#orphdel")?.addEventListener("click", () => {
    const o = orphanIds(), n = Object.values(o).reduce((t, x) => t + x, 0);
    if (!confirm(`${n} Antworten zu gelöschten Fragen entfernen? Das lässt sich nicht rückgängig machen.`)) return;
    for (const [d, a] of Object.entries(state.answers)) { for (const id of Object.keys(o)) delete a[id]; if (!Object.keys(a).length) delete state.answers[d]; }
    save();
    const y = scrollY; renderData(); scrollTo(0, y); toast(`${n} Antworten entfernt`);
  });
}
