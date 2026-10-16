/* Mosaik – Freunde */
"use strict";

/* ================= Freunde ================= */
// Gespeichert in state.friends (mit in der Sicherung):
// { stichtag, list: [{ id, name, cat, tags: {veg, rel, fem, smoke, acad}, isNew }], history: [{ date, list }], labels: {} }
const FCATS = [["best", "Beste Freunde"], ["good", "Gute Freunde"], ["friend", "Freunde"]];
const FTAGS = [
  { k: "veg", icon: "🌱", label: "Vegetarier" },
  { k: "rel", icon: "💍", label: "In Beziehung" },
  { k: "fem", icon: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="6" r="4"/><path d="M8 10v5M5.5 12.8h5"/></svg>`, label: "Frauen", cls: "fem" },
  { k: "smoke", icon: "🚬", label: "Raucher" },
  { k: "acad", icon: "🎓", label: "Akademiker (voraussichtlich)" }
];
const NEW_BADGE = `<svg class="fnew" viewBox="0 0 24 24" role="img" aria-label="Neu"><polygon points="23.0,12.0 20.9,14.4 21.5,17.5 18.5,18.5 17.5,21.5 14.4,20.9 12.0,23.0 9.6,20.9 6.5,21.5 5.5,18.5 2.5,17.5 3.1,14.4 1.0,12.0 3.1,9.6 2.5,6.5 5.5,5.5 6.5,2.5 9.6,3.1 12.0,1.0 14.4,3.1 17.5,2.5 18.5,5.5 21.5,6.5 20.9,9.6"/><text x="12" y="14.6" text-anchor="middle">NEW</text></svg>`;

function F() {
  if (!state.friends || typeof state.friends !== "object") state.friends = {};
  const f = state.friends;
  if (!Array.isArray(f.list)) f.list = [];
  if (!Array.isArray(f.history)) f.history = [];
  if (!f.labels || typeof f.labels !== "object") f.labels = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.stichtag || "")) f.stichtag = todayIso();
  return f;
}
const tagLabel = (t) => F().labels[t.k] || t.label;
const tagIcon = (t) => `<span class="ftag ${t.cls || ""}" title="${esc(tagLabel(t))}" aria-label="${esc(tagLabel(t))}">${t.icon}</span>`;
const friendIcons = (fr) => FTAGS.filter((t) => fr.tags && fr.tags[t.k]).map(tagIcon).join("") + (fr.isNew ? NEW_BADGE : "");
const fdate = (s) => { const d = parseIso(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
// Reihenfolge wie in der Übersicht: Beste, Gute, Freunde – innerhalb in Eingabereihenfolge
const friendsOrdered = (cats) => FCATS.flatMap(([c]) => F().list.filter((x) => x.cat === c && (!cats || cats.includes(c))));

// Fragen mit Vorlage „Freunde“ bekommen die aktuellen Namen als Antworten
function syncFriendQuestions() {
  let changed = false;
  for (const q of state.questions) {
    if (!q.friends || q.type !== "choice") continue;
    const names = friendsOrdered(q.friends.cats).map((x) => x.name);
    const opts = Array.from(new Set([...names, ...(q.extra || [])]));
    if (JSON.stringify(opts) !== JSON.stringify(q.options)) { q.options = opts; changed = true; }
  }
  return changed;
}

// Treffen: aus Fragen mit Vorlage „Freunde“ (z. B. „Mit wem getroffen?“) – je Freund Anzahl Tage und letztes Treffen
function meetStats() {
  const qs = state.questions.filter((q) => q.friends && q.type === "choice");
  const out = {};
  if (!qs.length) return null;
  const t = todayIso(), from90 = addDays(t, -89);
  for (const [d, a] of Object.entries(state.answers)) {
    const names = new Set();
    qs.forEach((q) => { const v = a[q.id]; (Array.isArray(v) ? v : v ? [v] : []).forEach((n) => names.add(n)); });
    names.forEach((n) => {
      const o = out[n] || (out[n] = { n: 0, n90: 0, last: null });
      o.n++; if (d >= from90) o.n90++;
      if (!o.last || d > o.last) o.last = d;
    });
  }
  return out;
}
function agoText(d) {
  if (!d) return "noch nie";
  const days = dayCount(d, todayIso()) - 1;
  if (days === 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 14) return `vor ${days} Tagen`;
  if (days < 63) return `vor ${Math.round(days / 7)} Wochen`;
  if (days < 365) return `vor ${Math.round(days / 30.4)} Monaten`;
  return "vor über einem Jahr";
}
// Treffen-Tage in einem Zeitraum: Tage mit mind. einem Freund, davon je Kategorie
function meetDays(from, to) {
  const qs = state.questions.filter((q) => q.friends && q.type === "choice");
  const catOf = Object.fromEntries(F().list.map((f) => [f.name, f.cat]));
  const r = { all: 0, best: 0, good: 0, friend: 0 };
  for (const [d, a] of Object.entries(state.answers)) {
    if (d < from || d > to) continue;
    const cats = new Set();
    qs.forEach((q) => { const v = a[q.id]; (Array.isArray(v) ? v : v ? [v] : []).forEach((n) => { if (catOf[n]) cats.add(catOf[n]); }); });
    if (!cats.size) continue;
    r.all++; cats.forEach((c) => r[c]++);
  }
  return r;
}
const MEET_PREVIEW = 5;
let showAllMeets = false;
function meetsPanel() {
  const st = meetStats();
  if (!st) return `<section class="panel"><h2 class="atitle">Treffen</h2>
    <p class="muted small" style="margin:0">Leg eine Frage mit Vorlage „Freunde“ an, z. B. „Mit wem getroffen?“. Dann siehst du hier, wen du wie oft und wann zuletzt gesehen hast.</p></section>`;
  const rank = { best: 0, good: 1, friend: 2 };
  // am längsten nicht gesehen zuerst (nie gesehen ganz oben), bei Gleichstand engere Freunde zuerst
  const rows = F().list.map((f) => ({ f, s: st[f.name] || { n: 0, n90: 0, last: null } }))
    .sort((a, b) => (a.s.last || "") < (b.s.last || "") ? -1 : (a.s.last || "") > (b.s.last || "") ? 1 : rank[a.f.cat] - rank[b.f.cat]);
  const shown = showAllMeets ? rows : rows.slice(0, MEET_PREVIEW);
  const catShort = Object.fromEntries(FCATS.map(([c, l]) => [c, l.replace(" Freunde", "")]));
  const t = todayIso(), m0 = t.slice(0, 7) + "-01";
  const pm = periodOf("month", addDays(m0, -1));
  const cur = meetDays(m0, t), prev = meetDays(pm.start, pm.end);
  const line = (r) => `<strong>${r.all}</strong> Treffen${r.all ? `, davon ${r.best} mit besten, ${r.good} mit guten, ${r.friend} mit weiteren Freunden` : ""}`;
  return `<section class="panel meets">
    <h2 class="atitle">Treffen</h2>
    <div class="mmonth">
      <p><span class="muted small">Diesen Monat</span><br>${line(cur)}</p>
      <p><span class="muted small">${esc(pm.name)}</span><br>${line(prev)}</p>
    </div>
    <p class="small muted" style="margin:12px 0 2px">Am längsten nicht gesehen zuerst</p>
    <ul class="mlist">${shown.map(({ f, s: x }) => `<li>
      <span class="mn">${esc(f.name)} <span class="mcat">${catShort[f.cat]}</span></span>
      <span class="ml ${x.last ? "" : "never"}">${agoText(x.last)}</span>
      <span class="mc small muted">${x.n ? `${x.n}× gesamt · ${x.n90}× in 90 Tagen` : "noch kein Treffen erfasst"}</span>
    </li>`).join("")}</ul>
    ${rows.length > MEET_PREVIEW ? `<button class="btn ghost block" id="mmore" style="margin-top:10px">${showAllMeets ? "Weniger anzeigen" : `Alle anzeigen (${rows.length - MEET_PREVIEW} weitere)`}</button>` : ""}
    <p class="small muted" style="margin:10px 0 0">Ein Treffen ist ein Tag, an dem bei einer Frage mit Vorlage „Freunde“ jemand angekreuzt ist. Mehrere Freunde am selben Tag zählen als ein Treffen, aber in jeder ihrer Kategorien.</p>
  </section>`;
}

// Übersicht mit Gesamtzahl und Quoten (auch für „Grafik erstellen“)
function friendsSummaryHtml() {
  const f = F();
  const list = f.list;
  const n = list.length;
  const prev = f.history[f.history.length - 1];
  const delta = prev ? n - prev.list.length : null;
  const cnt = (fn) => list.filter(fn).length;
  const pc = (c) => (n ? `${Math.round((c / n) * 100)} %` : "–");
  const rows = [
    { icon: NEW_BADGE, label: "Neue Freunde", c: cnt((x) => x.isNew) },
    ...FTAGS.map((t) => ({ icon: tagIcon(t), label: esc(tagLabel(t)), c: cnt((x) => x.tags && x.tags[t.k]) }))
  ];
  return `<section class="panel fsum">
      <div class="ftop">
        <div><span class="fbig">${n}</span><span class="muted">Freunde insgesamt</span></div>
        <div class="fdelta">${delta === null ? "" : `<strong>${delta > 0 ? "+" + delta : delta < 0 ? "−" + Math.abs(delta) : "±0"}</strong><span class="muted small">seit ${fdate(prev.date)}</span>`}</div>
      </div>
      <p class="small muted fstich">Stichtag ${fdate(f.stichtag)} · ${FCATS.map(([c, l]) => `${l.replace(" Freunde", "")} ${cnt((x) => x.cat === c)}`).join(" · ")}</p>
      <table class="ftable">
        <thead><tr><th></th><th></th><th>%</th><th>Anzahl</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td class="fi">${r.icon}</td><td>${r.label}</td><td class="num">${pc(r.c)}</td><td class="num">${r.c}</td></tr>`).join("")}</tbody>
      </table>
    </section>`;
}

function friendsListHtml() {
  const list = F().list;
  const st = meetStats();
  return FCATS.map(([c, l]) => {
    const xs = list.filter((x) => x.cat === c);
    return `<section class="panel fcat">
        <div class="panel-head"><h2>${l}</h2><span class="muted">${xs.length}</span></div>
        ${xs.length ? `<ul class="flist">${xs.map((x) => `<li><button class="frow" data-fid="${x.id}"><span class="fname">${esc(x.name)}</span><span class="ficons">${friendIcons(x)}</span>${st ? `<span class="flast">${agoText((st[x.name] || {}).last)}</span>` : ""}</button></li>`).join("")}</ul>`
          : `<p class="muted small" style="margin:0">Noch niemand.</p>`}
      </section>`;
  }).join("");
}

function renderFriends() {
  const n = F().list.length;
  $("#view").innerHTML = `
    <div class="dayhead">
      <h1>Freunde</h1>
      <div class="headbtns">
        <button class="gear" id="fsettings" aria-label="Stichtag und Labels">${GEAR}</button>
        <button class="addbtn big" id="fadd" aria-label="Freund hinzufügen">+</button>
      </div>
    </div>
    ${n ? `${friendsSummaryHtml()}${meetsPanel()}${friendChangesPanel()}${friendsListHtml()}`
    : `<div class="empty-state">
        <h2>Noch keine Freunde</h2>
        <p class="muted">Tippe oben rechts auf +, um Freunde hinzuzufügen. Du kannst auch mehrere Namen auf einmal eintragen.</p>
        <button class="btn" id="ffirst">Freunde hinzufügen</button>
      </div>`}`;

  $("#fadd").addEventListener("click", () => openFriend(null));
  $("#ffirst")?.addEventListener("click", () => openFriend(null));
  $("#fsettings").addEventListener("click", openFriendSettings);
  $("#fchmore")?.addEventListener("click", () => { showAllFriendChanges = !showAllFriendChanges; renderFriends(); });
  $("#mmore")?.addEventListener("click", () => { showAllMeets = !showAllMeets; renderFriends(); });
  document.querySelectorAll("[data-fid]").forEach((b) => b.addEventListener("click", () => openFriend(b.dataset.fid)));
}

// Veränderung gegenüber dem vorigen Stichtag
let showAllFriendChanges = false;
function friendChangesPanel() {
  const f = F();
  const prev = f.history[f.history.length - 1];
  if (!prev) return `<section class="panel fchg"><h2 class="atitle">Veränderung</h2>
    <p class="muted small" style="margin:0">Erscheint, sobald du über das Zahnrad einen neuen Stichtag anlegst. Dann siehst du hier, wie sich Anzahl, Quoten und Kategorien gegenüber dem Stichtag davor verändert haben.</p></section>`;
  const now = f.list, old = prev.list;
  const sign = (d, unit = "") => (d > 0 ? `+${d}${unit}` : d < 0 ? `−${Math.abs(d)}${unit}` : `±0${unit}`);
  const cls = (d) => (d > 0 ? "up" : d < 0 ? "down" : "");
  const share = (xs, fn) => (xs.length ? (xs.filter(fn).length / xs.length) * 100 : 0);
  const catName = Object.fromEntries(FCATS.map(([c, l]) => [c, l.replace(" Freunde", "")]));
  const rank = { best: 0, good: 1, friend: 2 };

  // Anzahl gesamt und je Kategorie
  const cats = FCATS.map(([c]) => ({ c, n: now.filter((x) => x.cat === c).length, o: old.filter((x) => x.cat === c).length }));
  // Quoten in Prozentpunkten
  const quotes = FTAGS.map((t) => {
    const a = share(now, (x) => x.tags && x.tags[t.k]), b = share(old, (x) => x.tags && x.tags[t.k]);
    return { t, a, b, d: Math.round(a) - Math.round(b), cn: now.filter((x) => x.tags && x.tags[t.k]).length, co: old.filter((x) => x.tags && x.tags[t.k]).length };
  });
  // Personen: neu, weg, auf- und abgestiegen, Label-Änderungen
  const byId = (xs) => Object.fromEntries(xs.map((x) => [x.id, x]));
  const O = byId(old), N = byId(now);
  const added = now.filter((x) => !O[x.id]);
  const gone = old.filter((x) => !N[x.id]);
  const moved = now.filter((x) => O[x.id] && O[x.id].cat !== x.cat).map((x) => ({ x, from: O[x.id].cat, up: rank[x.cat] < rank[O[x.id].cat] }));
  const tagChanges = [];
  for (const x of now) {
    const o = O[x.id];
    if (!o) continue;
    for (const t of FTAGS) {
      const a = !!(x.tags && x.tags[t.k]), b = !!(o.tags && o.tags[t.k]);
      if (a !== b) tagChanges.push({ x, t, on: a });
    }
  }
  const names = (xs) => xs.map((x) => esc(x.name)).join(", ");
  const lines = [];
  if (added.length) lines.push(`<li><strong>${added.length} neu:</strong> ${names(added)}</li>`);
  if (gone.length) lines.push(`<li><strong>${gone.length} nicht mehr dabei:</strong> ${names(gone)}</li>`);
  moved.filter((m) => m.up).forEach((m) => lines.push(`<li><span class="arrow up">▲</span> <strong>${esc(m.x.name)}</strong>: ${catName[m.from]} → ${catName[m.x.cat]}</li>`));
  moved.filter((m) => !m.up).forEach((m) => lines.push(`<li><span class="arrow down">▼</span> <strong>${esc(m.x.name)}</strong>: ${catName[m.from]} → ${catName[m.x.cat]}</li>`));
  tagChanges.forEach((c) => lines.push(`<li>${tagIcon(c.t)} <strong>${esc(c.x.name)}</strong>: Label „${esc(tagLabel(c.t))}“ ${c.on ? "dazugekommen" : "entfernt"}</li>`));
  const PREV_N = 4;
  const shownLines = showAllFriendChanges ? lines : lines.slice(0, PREV_N);

  // Verlauf über alle Stichtage
  const points = [...f.history.map((h) => ({ d: h.date, n: h.list.length })), { d: f.stichtag, n: now.length }];

  return `<section class="panel fchg">
    <div class="ghead"><h2 class="atitle">Veränderung</h2><span class="small muted">seit ${fdate(prev.date)}</span></div>
    <div class="fcmp">
      <div><span class="fv ${cls(now.length - old.length)}">${sign(now.length - old.length)}</span><span class="small muted">gesamt (${old.length} → ${now.length})</span></div>
      ${cats.map((c) => `<div><span class="fv ${cls(c.n - c.o)}">${sign(c.n - c.o)}</span><span class="small muted">${catName[c.c]} (${c.o} → ${c.n})</span></div>`).join("")}
    </div>
    <table class="ftable fq">
      <thead><tr><th></th><th></th><th>vorher</th><th>jetzt</th><th>Δ</th></tr></thead>
      <tbody>${quotes.map((q) => `<tr><td class="fi">${tagIcon(q.t)}</td><td>${esc(tagLabel(q.t))}</td>
        <td class="num muted">${Math.round(q.b)} %</td><td class="num">${Math.round(q.a)} %</td>
        <td class="num ${cls(q.d)}">${q.d === 0 ? "±0" : sign(q.d)} PP</td></tr>`).join("")}</tbody>
    </table>
    ${lines.length ? `<ul class="fchlist">${shownLines.join("")}</ul>
      ${lines.length > PREV_N ? `<button class="btn ghost block" id="fchmore" style="margin-top:10px">${showAllFriendChanges ? "Weniger anzeigen" : `Alle Änderungen anzeigen (${lines.length - PREV_N} weitere)`}</button>` : ""}`
      : `<p class="muted small">Keine Personen hinzugekommen, weggefallen oder verschoben.</p>`}
    ${points.length > 2 ? `<p class="small muted fhist">Verlauf: ${points.map((p) => `${fdate(p.d).slice(0, 6)}${p.d.slice(2, 4)} <strong>${p.n}</strong>`).join(" → ")}</p>` : ""}
    <p class="small muted" style="margin:10px 0 0">PP = Prozentpunkte. Quoten beziehen sich jeweils auf alle Freunde zum Stichtag.</p>
  </section>`;
}

function friendsChanged() {
  syncFriendQuestions();
  save();
  render();
}

// Freund anlegen oder bearbeiten
function openFriend(id) {
  const f = F();
  const existing = id ? f.list.find((x) => x.id === id) : null;
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), name: "", cat: "friend", tags: {}, isNew: true };
  let bulk = false, bulkText = "";
  const dlg = $("#sheet");
  const draw = () => {
    dlg.innerHTML = `<form class="sheet-inner" novalidate>
      <div class="sheet-head">
        <button type="button" class="linkbtn" id="fcancel">Abbrechen</button>
        <h2>${existing ? "Freund bearbeiten" : "Neuer Freund"}</h2>
        <button type="submit" class="linkbtn">Sichern</button>
      </div>
      ${bulk ? `<label class="field">Namen, einer pro Zeile<textarea id="fnames" rows="6" placeholder="Bryan&#10;Sabrina&#10;Annika">${esc(bulkText)}</textarea></label>
        <p class="muted small" style="margin-top:-8px">Labels kannst du danach pro Person setzen. Oder ganze Liste einfügen: Zeilen wie „# Beste Freunde“ wählen die Kategorie, Symbole 🌱 💍 ♀ 🚬 🎓 und „NEU“ hinter dem Namen setzen die Labels.</p>`
        : `<label class="field">Name<input id="fname" value="${esc(draft.name)}" autocomplete="off" placeholder="z. B. Bryan"></label>`}
      ${!existing ? `<button type="button" class="linkbtn" id="fbulk" style="margin:-6px 0 14px">${bulk ? "Nur einen Namen eintragen" : "Mehrere auf einmal eintragen"}</button>` : ""}
      <div class="seg seg-3" role="group" aria-label="Kategorie">${FCATS.map(([c, l]) => `<button type="button" data-fcat="${c}" aria-pressed="${draft.cat === c}">${l.replace(" Freunde", "")}</button>`).join("")}</div>
      ${bulk ? "" : `<div class="field" style="font-weight:600;font-size:15px;margin-bottom:8px">Labels</div>
      <div class="chips ftags">
        ${FTAGS.map((t) => `<button type="button" class="chip" data-ftag="${t.k}" aria-pressed="${!!draft.tags[t.k]}">${tagIcon(t)} ${esc(tagLabel(t))}</button>`).join("")}
        <button type="button" class="chip" data-fnew aria-pressed="${!!draft.isNew}">${NEW_BADGE} Neuer Freund</button>
      </div>
      <p class="muted small">„Neu“ bleibt bis zum nächsten Stichtag.</p>`}
      ${existing ? `<div class="stack"><button type="button" class="btn danger" id="fdel">Aus der Liste entfernen</button></div>` : ""}
    </form>`;
    const sync = () => { const i = $("#fname", dlg); if (i) draft.name = i.value; const t = $("#fnames", dlg); if (t) bulkText = t.value; };
    $("#fcancel", dlg).addEventListener("click", () => dlg.close());
    $("#fbulk", dlg)?.addEventListener("click", () => { sync(); bulk = !bulk; draw(); });
    dlg.querySelectorAll("[data-fcat]").forEach((b) => b.addEventListener("click", () => { sync(); draft.cat = b.dataset.fcat; draw(); }));
    dlg.querySelectorAll("[data-ftag]").forEach((b) => b.addEventListener("click", () => { sync(); draft.tags[b.dataset.ftag] = !draft.tags[b.dataset.ftag]; draw(); }));
    dlg.querySelector("[data-fnew]")?.addEventListener("click", () => { sync(); draft.isNew = !draft.isNew; draw(); });
    $("#fdel", dlg)?.addEventListener("click", () => {
      if (!confirm(`${existing.name} aus der Liste entfernen? Frühere Stichtage und Antworten bleiben erhalten.`)) return;
      f.list = f.list.filter((x) => x.id !== existing.id);
      dlg.close(); friendsChanged(); toast("Entfernt");
    });
    dlg.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const taken = (name, self) => f.list.some((x) => x.id !== self && x.name.toLowerCase() === name.toLowerCase());
      if (bulk && /^\s*(#|stichtag)/im.test($("#fnames", dlg).value)) {
        // Liste mit Überschriften und Symbolen, z. B. „# Beste Freunde“ / „Sabrina 🌱 ♀ 🎓 NEU“
        const res = importFriendList($("#fnames", dlg).value);
        dlg.close(); friendsChanged(); toast(`${res.added} hinzugefügt${res.updated ? `, ${res.updated} aktualisiert` : ""}`);
        return;
      }
      if (bulk) {
        const names = Array.from(new Set($("#fnames", dlg).value.split("\n").map((s) => s.trim()).filter(Boolean)));
        const add = names.filter((nm) => !taken(nm, null));
        if (!add.length) return toast(names.length ? "Diese Namen gibt es schon" : "Bitte Namen eintragen");
        add.forEach((nm) => f.list.push({ id: uid(), name: nm, cat: draft.cat, tags: {}, isNew: true }));
        dlg.close(); friendsChanged(); toast(`${add.length} hinzugefügt${add.length < names.length ? `, ${names.length - add.length} schon vorhanden` : ""}`);
        return;
      }
      sync();
      draft.name = draft.name.trim();
      if (!draft.name) return toast("Bitte einen Namen eintragen");
      if (taken(draft.name, draft.id)) return toast("Diesen Namen gibt es schon");
      if (existing) {
        if (existing.name !== draft.name) renameFriendInAnswers(existing.name, draft.name);
        Object.assign(existing, draft);
      } else f.list.push(draft);
      dlg.close(); friendsChanged(); toast(existing ? "Gesichert" : "Hinzugefügt");
    });
  };
  draw();
  dlg.showModal();
  document.activeElement?.blur();
  if (!existing) setTimeout(() => $("#fname", dlg)?.focus(), 50);
}

// Import einer ganzen Liste: Überschriften wählen die Kategorie, Symbole setzen die Labels
function importFriendList(text) {
  const f = F();
  const SYM = { "🌱": "veg", "💍": "rel", "♀": "fem", "🚬": "smoke", "🎓": "acad" };
  let cat = "friend", added = 0, updated = 0;
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line) continue;
    const st = line.match(/^stichtag\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
    if (st) { f.stichtag = `${st[3]}-${pad(st[2])}-${pad(st[1])}`; continue; }
    if (line.startsWith("#")) {
      const h = line.toLowerCase();
      cat = h.includes("beste") ? "best" : h.includes("gute") ? "good" : "friend";
      continue;
    }
    const tags = {};
    for (const [sym, k] of Object.entries(SYM)) if (line.includes(sym)) tags[k] = true;
    const isNew = /\bNEU\b/i.test(line);
    const name = line.replace(/\bNEU\b/gi, "").replace(/[🌱💍♀🚬🎓\uFE0F\u200D]/gu, "").replace(/^[-•·*]\s*/, "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const ex = f.list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (ex) { Object.assign(ex, { cat, tags, isNew }); updated++; }
    else { f.list.push({ id: uid(), name, cat, tags, isNew }); added++; }
  }
  return { added, updated };
}

// Umbenennen: gespeicherte Antworten der verknüpften Fragen mitziehen
function renameFriendInAnswers(oldName, newName) {
  const qs = state.questions.filter((q) => q.friends);
  for (const a of Object.values(state.answers)) {
    for (const q of qs) {
      const v = a[q.id];
      if (Array.isArray(v)) a[q.id] = v.map((x) => (x === oldName ? newName : x));
      else if (v === oldName) a[q.id] = newName;
    }
  }
  for (const q of state.questions) {
    if (q.cond && qs.some((p) => p.id === q.cond.qid)) q.cond.values = q.cond.values.map((x) => (x === oldName ? newName : x));
  }
}

// Zahnrad: Stichtag, Verlauf, Namen der Labels
function openFriendSettings() {
  const f = F();
  const dlg = $("#sheet");
  const draw = () => {
    const hist = [...f.history].reverse();
    dlg.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><span></span><h2>Stichtag</h2><button type="button" class="linkbtn" id="fsdone">Fertig</button></div>
      <section class="sq">
        <div class="timerow" style="margin-top:0"><span>Aktueller Stichtag</span><input type="date" id="fst" class="timein wide" value="${f.stichtag}"></div>
        <p class="muted small" style="margin:8px 0 0">Änderungen an der Liste gelten für diesen Stichtag.</p>
      </section>
      <section class="sq">
        <strong>Neuen Stichtag anlegen</strong>
        <p class="muted small" style="margin:6px 0 10px">Die Liste zum ${fdate(f.stichtag)} wird festgehalten. Wer danach dazukommt, bekommt das Label „Neu“. Bisherige „Neu“-Labels fallen weg.</p>
        <div class="timerow" style="margin-top:0"><span>Neuer Stichtag</span><input type="date" id="fnewst" class="timein wide" value="${todayIso()}"></div>
        <button type="button" class="btn block" id="fnewbtn" style="margin-top:12px">Stichtag anlegen</button>
      </section>
      ${hist.length ? `<section class="sq">
        <strong>Frühere Stichtage</strong>
        <ul class="hlist">${hist.map((h, i) => {
          const before = hist[i + 1];
          const d = before ? h.list.length - before.list.length : null;
          const added = before ? h.list.filter((x) => !before.list.some((y) => y.id === x.id)).length : null;
          return `<li><span class="hn">${fdate(h.date)}</span><span class="hv">${h.list.length}</span>
            ${d !== null ? `<span class="hm small muted">${d > 0 ? "+" + d : d < 0 ? "−" + Math.abs(d) : "±0"} gegenüber ${fdate(before.date)}${added ? ` · ${added} neu` : ""}</span>` : ""}</li>`;
        }).join("")}</ul>
      </section>` : ""}
      <section class="sq">
        <strong>Labels umbenennen</strong>
        ${FTAGS.map((t) => `<div class="timerow"><span>${tagIcon(t)}</span><input class="flabel" data-fl="${t.k}" value="${esc(tagLabel(t))}"></div>`).join("")}
      </section>
    </div>`;
    $("#fsdone", dlg).addEventListener("click", () => dlg.close());
    $("#fst", dlg).addEventListener("change", (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { f.stichtag = e.target.value; save(); render(); } });
    $("#fnewbtn", dlg).addEventListener("click", () => {
      const nd = $("#fnewst", dlg).value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) return toast("Bitte ein Datum wählen");
      if (nd <= f.stichtag) return toast("Der neue Stichtag muss nach dem aktuellen liegen");
      if (!confirm(`Liste zum ${fdate(f.stichtag)} festhalten und neuen Stichtag ${fdate(nd)} anlegen?`)) return;
      f.history.push({ date: f.stichtag, list: JSON.parse(JSON.stringify(f.list)) });
      f.list.forEach((x) => { x.isNew = false; });
      f.stichtag = nd;
      save(); draw(); render(); toast(`Stichtag ${fdate(nd)} angelegt`);
    });
    dlg.querySelectorAll("[data-fl]").forEach((i) => i.addEventListener("change", () => {
      const v = i.value.trim();
      if (v) f.labels[i.dataset.fl] = v; else delete f.labels[i.dataset.fl];
      save(); render();
    }));
  };
  draw();
  dlg.showModal();
  document.activeElement?.blur();
}
