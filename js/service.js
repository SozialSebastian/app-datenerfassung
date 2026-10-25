/* Mosaik – Mosaik-Dienst: Erinnerungen, Eingang, Health */
"use strict";

/* ================= Export, Backup, Health ================= */
/* ================= Mosaik-Dienst: Erinnerung und Eingang ================= */
const SERVER = "https://mosaik-sync.sebastian-taglieber.workers.dev";
const SETTINGS_KEY = "mosaik.settings";
let settings = { token: "", push: { on: false, time: "23:00", endpoint: null }, weekly: { on: false, day: 0, time: "19:00" }, goalpush: { on: false }, places: { on: false, last: 0 }, weather: { on: false, last: 0 }, lastInbox: null };
try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); settings = { ...settings, ...s, push: { ...settings.push, ...(s.push || {}) }, weekly: { ...settings.weekly, ...(s.weekly || {}) }, goalpush: { ...settings.goalpush, ...(s.goalpush || {}) }, places: { ...settings.places, ...(s.places || {}) }, weather: { ...settings.weather, ...(s.weather || {}) } }; } catch (e) { /* egal */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* egal */ } };

async function api(path, body) {
  let res;
  try {
    res = await fetch(SERVER + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${settings.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { throw new Error("Dienst nicht erreichbar. Bist du online?"); }
  let data = {};
  try { data = await res.json(); } catch (e) { /* keine JSON-Antwort */ }
  if (res.status === 401) throw new Error("Der Schlüssel stimmt nicht.");
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

const b64ToBytes = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };

// Push-Abo dieses Geräts holen oder anlegen (gemeinsam für Erinnerung und Wochenbericht)
async function pushSub() {
  // Erlaubnis zuerst anfragen: iOS verlangt das direkt nach dem Tippen
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Mitteilungen sind nicht erlaubt. iPhone-Einstellungen → Mitteilungen → Mosaik → Mitteilungen erlauben.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api("/vapid");
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  }
  return sub;
}

async function enablePush(time) {
  const sub = await pushSub();
  await api("/subscribe", { subscription: sub.toJSON(), time, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin" });
  settings.push = { on: true, time, endpoint: sub.endpoint };
  saveSettings();
  reportStatus();
}

async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const endpoint = (sub && sub.endpoint) || settings.push.endpoint;
  if (endpoint) await api("/unsubscribe", { endpoint }).catch(() => {});
  const keep = settings.weekly.on || settings.goalpush.on;
  if (sub && !keep) await sub.unsubscribe().catch(() => {}); // Abo bleibt für Wochenbericht/Ziele
  settings.push = { ...settings.push, on: false, endpoint: keep ? settings.push.endpoint : null };
  saveSettings();
}

async function enableWeekly(day, time) {
  const sub = await pushSub();
  await api("/weekly", { on: true, subscription: sub.toJSON(), day, time, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin" });
  settings.weekly = { on: true, day, time, endpoint: sub.endpoint };
  saveSettings();
  reportStatus();
}

async function disableWeekly() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const endpoint = (sub && sub.endpoint) || settings.weekly.endpoint;
  if (endpoint) await api("/weekly", { on: false, subscription: { endpoint } }).catch(() => {});
  settings.weekly = { ...settings.weekly, on: false };
  if (sub && !settings.push.on && !settings.goalpush.on) await sub.unsubscribe().catch(() => {});
  saveSettings();
}

// Ziel-Erinnerung: Mitteilung zu einem festen Wochentag, wenn Ziele dieser Woche wackeln
async function enableGoalPush() {
  const sub = await pushSub();
  await api("/goals", { on: true, subscription: sub.toJSON(), day: 0, time: "09:00", tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin" });
  settings.goalpush = { on: true, endpoint: sub.endpoint };
  saveSettings();
  reportStatus();
}
async function disableGoalPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const endpoint = (sub && sub.endpoint) || settings.goalpush.endpoint;
  if (endpoint) await api("/goals", { on: false, subscription: { endpoint } }).catch(() => {});
  settings.goalpush = { ...settings.goalpush, on: false };
  if (sub && !settings.push.on && !settings.weekly.on) await sub.unsubscribe().catch(() => {});
  saveSettings();
}

// Plan für die Ziel-Erinnerung: ab welchem Tag welches Ziel kippt (der Dienst meldet jeden Eintrag einmal)
function goalAlertPlan() {
  const t = todayIso(), plan = [];
  for (const g of goalItems()) {
    const per = goalCur(g);
    const e = evalGoal(g, per);
    if (e.status === "done" || e.status === "fail" || e.status === "none") continue;
    const name = e.q.text.replace(/\?$/, "");
    const until = per.end === addDays(mondayOf(t), 6) ? "Sonntag" : dm(per.end);
    const id = `${g.id}|${per.key}`;
    if (e.upper) { // höchstens-Ziel: Grenze erreicht
      // nicht bei „nie“-Zielen (Grenze 0) – da gibt es nichts vorzuwarnen
      if (e.target > 0 && e.c >= e.target) plan.push({ id: id + "|limit", d: t, t: `${name}: Grenze von ${e.target}× erreicht – bis ${until} besser keins mehr` });
      continue;
    }
    if (g.kind === "count" || g.kind === "days") {
      const need = e.target - e.c;
      if (need <= 0) continue;
      // letzter Tag, ab dem jeder verbleibende Tag klappen muss
      const last = addDays(per.end, -(need - 1));
      plan.push({ id: id + "|last", d: last < t ? t : last, t: `${name}: ab heute an jedem Tag nötig (noch ${need}${g.kind === "days" ? ` Tag${need === 1 ? "" : "e"}` : "×"} bis ${until})` });
      continue;
    }
    if (e.status === "behind" && e.vals >= 3) {
      plan.push({ id: id + "|behind", d: t, t: g.kind === "avg" ? `${name}: ${e.cur}, Ziel ${cmpWord(e.q, g.cmp)} ${valText(e.q, g.val)}` : `${name}: hinter Plan, noch ${valText(e.q, Math.round((e.target - e.c) * 100) / 100)} bis ${until}` });
    }
  }
  return plan;
}

// Dem Dienst mitteilen, wie viele Fragen heute noch offen sind (keine Antworten!)
let statusTimer;
function reportStatus() {
  if (!settings.token) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    // Kurztext für die Wochenbericht-Mitteilung
    if (settings.goalpush.on && settings.goalpush.endpoint) api("/goals/teaser", { endpoint: settings.goalpush.endpoint, week: "", text: JSON.stringify(goalAlertPlan()) }).catch(() => {});
    // Wochenbericht: Mitteilung erst, wenn Mo–So vollständig beantwortet sind (week leer = noch nicht)
    if (settings.weekly.on && settings.weekly.endpoint) { const wk = reportDefaultWeek(), ok = weekComplete(wk); api("/weekly/teaser", { endpoint: settings.weekly.endpoint, week: ok ? wk : "", text: ok ? reportTeaser(wk) : "" }).catch(() => {}); }
    if (!settings.push.on || !settings.push.endpoint) return;
    const t = todayIso();
    const a = state.answers[t] || {};
    const open = askQuestions(t).filter((q) => !isAnswered(a[q.id])).length;
    api("/status", { endpoint: settings.push.endpoint, date: t, open }).catch(() => {});
  }, 1500);
}

// Bekannte Kürzel bekommen einen schönen Namen
const HEALTH_NAMES = {
  schlaf: ["Schlafdauer", "", "duration"], schlafenszeit: ["Einschlafzeit", "", "clock"], aufwachzeit: ["Aufwachzeit", "", "clock"], schritte: ["Schritte", ""], ruhepuls: ["Ruhepuls", "bpm"], puls: ["Puls", "bpm"],
  hrv: ["Herzfrequenzvariabilität", "ms"], kalorien: ["Aktivkalorien", "kcal"], aktivkalorien: ["Aktivkalorien", "kcal"],
  training: ["Trainingsminuten", "min"], stehen: ["Stehstunden", "h"], distanz: ["Distanz", "km"], gewicht: ["Gewicht", "kg"],
  achtsamkeit: ["Achtsamkeitsminuten", "min"], stockwerke: ["Stockwerke", ""]
};
// Für ein Kürzel aus dem Kurzbefehl das passende Health-Feld finden oder anlegen
function ensureHealthQuestion(key, created) {
  let q = state.questions.find((x) => x.healthKey === key);
  if (q) {
    if (q.type === "number" && !q.source) { q.source = "health"; save(); }
    return q;
  }
  const [text, unit, format] = HEALTH_NAMES[key] || [key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " "), ""];
  q = { id: uid(), text, format: format || null, type: "number", options: [], multi: false, min: 1, max: 5, minLabel: "", maxLabel: "", unit, healthKey: key, source: "health", archived: false, cond: null };
  state.questions.push(q);
  created.push(q);
  return q;
}

// Werte abholen, die Kurzbefehle im Hintergrund geschickt haben
let inboxBusy = false, inboxLast = 0;
async function fetchInbox(manual) {
  if (!settings.token || inboxBusy) return;
  if (!manual && Date.now() - inboxLast < 30000) return;
  inboxBusy = true; inboxLast = Date.now();
  try {
    const { items } = await api("/inbox");
    const done = [], unknown = new Set();
    let setCount = 0;
    const created = [];
    for (const it of items) {
      const q = ensureHealthQuestion(it.key, created);
      const r = applyPairs({ [it.key]: it.value }, it.date);
      if (r.set.length) setCount += r.set.length; else r.unknown.forEach((k) => unknown.add(k));
      done.push(it.id); // alles quittieren, auch ungültige Werte (sonst bleiben sie ewig liegen)
      if (q && !r.set.length && created.includes(q)) { /* leeres neues Feld behalten */ }
    }
    if (created.length) save();
    for (let i = 0; i < done.length; i += 500) await api("/inbox/ack", { ids: done.slice(i, i + 500) });
    if (items.length) { settings.shortcutDone = true; }
    settings.lastInbox = new Date().toISOString(); saveSettings();
    if (setCount) { toast(`${setCount} Wert${setCount > 1 ? "e" : ""} aus Kurzbefehlen übernommen`); render(); }
    else if (manual) toast(unknown.size ? `Kein passendes Health-Kürzel: ${[...unknown].join(", ")}` : "Keine neuen Werte");
    else if (tab === "data") renderData();
  } catch (e) {
    if (manual) toast(e.message);
  } finally { inboxBusy = false; }
}
