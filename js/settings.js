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
      <label class="switch row" style="margin-top:0"><input type="checkbox" id="goalpushon" ${settings.goalpush.on ? "checked" : ""}><span>Ziel-Erinnerung</span></label>
      <p class="muted small" style="margin:8px 0 0">Meldet sich einmal, sobald ein Ziel zu kippen droht, z. B. „Bouldern: ab heute an jedem Tag nötig (noch 2× bis Sonntag)“ oder wenn eine Höchstgrenze erreicht ist. Nur tagsüber. Tippen öffnet die Ziele.</p>
      <p class="small" id="goalpushmsg" style="margin:8px 0 0"></p>`;

  const w = settings.weekly;
  const WDN = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  let weeklyBody = "";
  if (connected && pushSupport && standalone) weeklyBody = `
      <label class="switch row"><input type="checkbox" id="weekon" ${w.on ? "checked" : ""}><span>Jede Woche als Mitteilung</span></label>
      <div class="timerow"><span>Tag</span><select id="weekday" class="timein">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<option value="${i}" ${w.day === i ? "selected" : ""}>${WDN[i]}</option>`).join("")}</select></div>
      <div class="timerow"><span>Uhrzeit</span><input type="time" id="weektime" value="${esc(w.time)}" class="timein"></div>
      <p class="small" id="weekmsg" style="margin:8px 0 0"></p>`;
  else if (!connected) weeklyBody = `<p class="muted small" style="margin-top:10px">Für die wöchentliche Mitteilung zuerst unten unter „Verbindung“ den Schlüssel eintragen.</p>`;

  view.innerHTML = `
    <div class="dayhead"><h1>Einstellungen</h1></div>

    ${questionsPanel()}

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
      <p class="muted small" style="margin:8px 0 0">Beim Öffnen (höchstens alle 20 Minuten) wird die Stadt gespeichert, nur der Name und nur auf dem iPhone. Dafür gehen auf ca. 1 km gerundete Koordinaten an BigDataCloud bzw. OpenStreetMap. Dazu kommt das Wetter des Tages von Open-Meteo, genutzt nur für Zusammenhänge in den Trends.${settings.places.on ? ` Wetter für ${Object.keys(state.weather || {}).length} Tage.` : ""}</p>
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
          <li><strong>Health-Messungen suchen</strong>: Typ <em>Schritte</em>, Startdatum <em>in den letzten 7 Tagen</em>, Gruppieren nach <em>Tag</em>.</li>
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
    const t = { granted: ["ok", "<strong>Standort dauerhaft erlaubt.</strong> Mosaik erfasst ihn ohne Rückfrage beim Öffnen (höchstens alle 20 Minuten)."],
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
    const day = Number($("#weekday").value), time = $("#weektime").value || "19:00";
    settings.weekly.day = day; settings.weekly.time = time; saveSettings();
    if (!settings.weekly.on) return;
    try { await enableWeekly(day, time); toast(`Wochenbericht jeden ${WDN[day]} um ${time} Uhr`); } catch (err) { msg("weekmsg", err.message, true); }
  };
  $("#weekon")?.addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      if (on) { await enableWeekly(Number($("#weekday").value), $("#weektime").value || "19:00"); toast(`Wochenbericht jeden ${WDN[settings.weekly.day]} um ${settings.weekly.time} Uhr`); }
      else { await disableWeekly(); toast("Wochenbericht-Mitteilung aus"); }
      renderData();
    } catch (err) { e.target.checked = !on; msg("weekmsg", err.message, true); }
  });
  $("#weekday")?.addEventListener("change", weekSave);
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
