// Mosaik-Dienst auf Cloudflare: tägliche Push-Erinnerung und Eingang für Kurzbefehle.
// Schlüssel (SYNC_TOKEN) kommt aus dem GitHub-Secret MOSAIK_TOKEN.
// Es werden KEINE Antworten dauerhaft gespeichert. Werte von Kurzbefehlen liegen nur im
// Eingang, bis die App sie abholt (danach gelöscht, spätestens nach 30 Tagen).

const TZ_DEFAULT = "Europe/Berlin";
const SUBJECT = "https://sozialsebastian.github.io/app-datenerfassung/";
const APP_URL = "https://sozialsebastian.github.io/app-datenerfassung/";

/* ---------- Hilfsfunktionen ---------- */
const enc = new TextEncoder();
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors } });
const text = (t, status = 200) => new Response(t, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...cors } });

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const concat = (...arrs) => { const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

// Datum und Uhrzeit in der Zeitzone des Nutzers
function localNow(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz || TZ_DEFAULT, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, wd: new Date(date + "T12:00:00Z").getUTCDay() };
}
// Montag der Woche zu einem Datum (JJJJ-MM-TT)
function mondayOf(date) {
  const t = new Date(date + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

/* ---------- VAPID-Schlüssel (einmalig erzeugt, in D1 abgelegt) ---------- */
async function vapidKeys(env) {
  const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'vapid'").first();
  if (row) return JSON.parse(row.value);
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
  const keys = { priv, pub };
  await env.DB.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(keys)).run();
  return JSON.parse((await env.DB.prepare("SELECT value FROM config WHERE key = 'vapid'").first()).value);
}

async function vapidAuth(env, endpoint) {
  const { priv, pub } = await vapidKeys(env);
  const key = await crypto.subtle.importKey("jwk", priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 3600, sub: SUBJECT })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${pub}`;
}

/* ---------- Web-Push-Verschlüsselung (RFC 8291, aes128gcm) ---------- */
async function hmac(keyBytes, data) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export async function encryptPayload(payload, p256dh, auth) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 0x02 = letzter Datensatz
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plain));

  const rs = new Uint8Array([0, 0, 16, 0]); // Datensatzgröße 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

async function sendPush(env, sub, message) {
  const body = await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(env, sub.endpoint),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "21600",
      Urgency: "normal"
    },
    body
  });
  // 404/410 = Abo existiert nicht mehr (z. B. App gelöscht) → entfernen
  if (res.status === 404 || res.status === 410) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM subs WHERE endpoint = ?").bind(sub.endpoint),
      env.DB.prepare("DELETE FROM weekly WHERE endpoint = ?").bind(sub.endpoint),
      env.DB.prepare("DELETE FROM goals WHERE endpoint = ?").bind(sub.endpoint)
    ]);
  }
  return res.status;
}

function reminder(sub, date) {
  const open = sub.status_date === date ? sub.status_open : null;
  return {
    title: open ? `Noch ${open} Frage${open === 1 ? "" : "n"} offen` : "Abfrage für heute", // iOS ergänzt selbst „from Mosaik“
    body: open ? "Tippen startet die Abfrage für heute." : "Zeit für die Abfrage von heute. Tippen zum Starten.",
    date,
    url: `${APP_URL}?quiz=${date}`
  };
}

// Wochenbericht: Kurztext kommt von der App (nur Zusammenfassung, keine Antworten)
// Gesendet wird erst, wenn die App die Woche als vollständig meldet (teaser_week = Montag der Woche)
function weeklyMessage(sub) {
  const teaser = sub.teaser || "";
  return {
    title: "Dein Wochenbericht",
    body: `${teaser ? teaser + " " : ""}Tippen öffnet deinen Wochenbericht.`,
    report: "week",
    url: `${APP_URL}?report=week`
  };
}

// Ziel-Erinnerung: Die App schickt einen Plan, ab welchem Tag welches Ziel kippt
// teaser = JSON [{ id, d: "JJJJ-MM-TT", t: "Text" }], last_sent = JSON-Liste schon gemeldeter ids
const GOAL_WINDOW = ["09:00", "21:00"]; // nur tagsüber melden
function dueGoalAlerts(sub, now) {
  if (now.time < GOAL_WINDOW[0] || now.time > GOAL_WINDOW[1]) return null;
  let plan = [], sent = [];
  try { plan = JSON.parse(sub.teaser || "[]"); } catch (e) { plan = []; }
  try { sent = JSON.parse(sub.last_sent || "[]"); } catch (e) { sent = []; }
  if (!Array.isArray(plan) || !Array.isArray(sent)) return null;
  const due = plan.filter((x) => x && x.id && x.d <= now.date && !sent.includes(x.id));
  if (!due.length) return null;
  return { due, sent: sent.concat(due.map((x) => x.id)).slice(-100) };
}

/* ---------- Eingang für Kurzbefehle ---------- */
// akzeptiert: Text „mosaik;schlaf=7,4;datum=2026-10-16“, JSON {"schlaf": 7.4} oder Formular
async function readValues(request) {
  const url = new URL(request.url);
  const pairs = {};
  const lists = {};
  url.searchParams.forEach((v, k) => (pairs[k.toLowerCase()] = v));
  if (request.method === "POST") {
    const type = request.headers.get("Content-Type") || "";
    const raw = (await request.text()).trim();
    if (/^(mosaik|taeglich);/i.test(raw) || (!type.includes("json") && !type.includes("form"))) {
      for (const part of raw.replace(/^(mosaik|taeglich);/i, "").split(/[;\n&]/)) {
        const i = part.indexOf("=");
        if (i > 0) pairs[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
      }
    } else if (type.includes("json") || raw.startsWith("{")) {
      try {
        const j = JSON.parse(raw);
        for (const [k, v] of Object.entries(j)) {
          // Listen kommen als Array oder als Text mit einem Wert pro Zeile (Kurzbefehle setzen Listen so ein)
          if (Array.isArray(v)) lists[k.toLowerCase()] = v;
          else if (typeof v === "string" && /\n/.test(v.trim())) lists[k.toLowerCase()] = v.trim().split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
          else pairs[k.toLowerCase()] = String(v);
        }
      } catch (e) { /* kein JSON */ }
    } else {
      new URLSearchParams(raw).forEach((v, k) => (pairs[k.toLowerCase()] = v));
    }
  }
  return { pairs, lists };
}

/* ---------- Listen aus Kurzbefehlen (mehrere Tage auf einmal) ---------- */
const num = (v) => {
  if (typeof v === "number") return v;
  const m = String(v).replace(/[ \u00a0]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : NaN;
};
// Uhrzeit in Berlin als Stunden (23:30 → 23,5)
const berlinClock = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ_DEFAULT, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Number(p.hour) + Number(p.minute) / 60;
};
const berlinDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ_DEFAULT, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
// Datum aus Kurzbefehlen lesen: ISO 8601 (empfohlen) oder deutsch „16.10.2026, 07:12“
function parseWhen(v) {
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})(?:,?\s*(?:um\s*)?(\d{1,2}):(\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const local = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return { ms: Date.UTC(y, Number(m[2]) - 1, Number(m[1]), Number(m[4] || 12), Number(m[5] || 0)), local, clock: Number(m[4] || 12) + Number(m[5] || 0) / 60 };
  }
  const ms = Date.parse(s);
  if (!Number.isNaN(ms)) return { ms, local: /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : berlinDate(ms), clock: berlinClock(ms) };
  return null;
}
const minusDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };

// Schlaf aus einzelnen Health-Messungen (Phasen Kern/Tief/REM, „Schlafend“ usw.):
//  - mit schlaf_wert: „Im Bett“ fällt weg, „Wach“ wird abgezogen, Watch-Phasen haben Vorrang vor allgemeinem „Schlafend“
//  - überlappende Messungen (z. B. Watch + iPhone) werden zusammengelegt, nichts doppelt gezählt
//  - Messungen mit weniger als 3 h Abstand bilden eine Nacht; je Tag (des Aufwachens) zählt die längste
//  → schlaf = tatsächlich geschlafene Zeit (ohne Wachphasen), schlafenszeit = Einschlafen, aufwachzeit = letztes Aufwachen
const SLEEP_WAKE = /wach|awake/i, SLEEP_BED = /bett|in ?bed/i, SLEEP_STAGE = /kern|tief|rem|core|deep/i;
// Intervalle [a, b] (ms) zusammenlegen
const unite = (iv) => {
  const out = [];
  for (const [a, b] of [...iv].sort((x, y) => x[0] - y[0])) {
    const l = out[out.length - 1];
    if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]);
  }
  return out;
};
const ivLen = (iv) => iv.reduce((s, [a, b]) => s + b - a, 0);
// Länge von iv, ohne die Teile, die in cut liegen
const minus = (iv, cut) => {
  let len = ivLen(iv);
  for (const [a, b] of iv) for (const [c, d] of cut) len -= Math.max(0, Math.min(b, d) - Math.max(a, c));
  return len;
};
function sleepEntries(start, end, kinds) {
  const typed = Array.isArray(kinds) && kinds.length === start.length;
  const sl = [], wake = [];
  for (let i = 0; i < Math.min(start.length, end.length, 20000); i++) {
    const a = parseWhen(start[i]), b = parseWhen(end[i]);
    if (!a || !b || b.ms <= a.ms || b.ms - a.ms > 16 * 3600000) continue;
    const k = typed ? String(kinds[i]) : "";
    if (SLEEP_BED.test(k)) continue;
    if (SLEEP_WAKE.test(k)) { wake.push([a.ms, b.ms]); continue; }
    sl.push({ a, b, stage: SLEEP_STAGE.test(k) });
  }
  sl.sort((x, y) => x.a.ms - y.a.ms);
  // Nächte: Messungen mit weniger als 3 h Abstand gehören zusammen
  const nights = [];
  for (const x of sl) {
    const n = nights[nights.length - 1];
    if (n && x.a.ms - n.endMs < 3 * 3600000) { n.items.push(x); if (x.b.ms > n.endMs) { n.endMs = x.b.ms; n.end = x.b; } }
    else nights.push({ items: [x], start: x.a, end: x.b, endMs: x.b.ms });
  }
  const best = {};
  for (const n of nights) {
    // Gibt es Schlafphasen (Watch), zählen nur diese – allgemeines „Schlafend“ (z. B. iPhone) würde Wachphasen überdecken
    const use = n.items.some((x) => x.stage) ? n.items.filter((x) => x.stage) : n.items;
    const iv = unite(use.map((x) => [x.a.ms, x.b.ms]));
    n.sleep = minus(iv, unite(wake));
    n.start = use[0].a;
    n.end = use.reduce((m, x) => (x.b.ms > m.ms ? x.b : m), use[0].b);
    const d = n.end.local;
    if (!best[d] || n.sleep > best[d].sleep) best[d] = n;
  }
  const out = [];
  for (const [d, n] of Object.entries(best)) {
    if (n.sleep < 3600000) continue; // kürzer als 1 h: Nickerchen, keine Nacht
    const c = n.start.clock, w = n.end.clock;
    out.push(["schlaf", String(Math.round(n.sleep / 360) / 10000), d]);
    out.push(["schlafenszeit", String(Math.round((c < 12 ? c + 24 : c) * 10000) / 10000), d]);
    out.push(["aufwachzeit", String(Math.round(w * 10000) / 10000), d]);
  }
  return out;
}

// Zeitreihe je Tag: [[Minute, Wert], …] → "m:v,m:v" (höchstens 1440 Punkte je Tag)
function seriesEntries(base, vals, dates) {
  const byDay = {};
  for (let i = 0; i < Math.min(vals.length, dates.length, 20000); i++) {
    const n = num(vals[i]), w = parseWhen(dates[i]);
    if (Number.isNaN(n) || !w) continue;
    const m = Math.min(1439, Math.max(0, Math.round(w.clock * 60)));
    (byDay[w.local] ||= {})[m] = Math.round(n);
  }
  return Object.entries(byDay).map(([d, ms]) => [base + "_serie", Object.entries(ms).sort((a, b) => a[0] - b[0]).slice(0, 1440).map(([m, v]) => `${m}:${v}`).join(","), d]);
}
function workoutEntries(start, end) {
  const byDay = {};
  for (let i = 0; i < Math.min(start.length, end.length, 2000); i++) {
    const a = parseWhen(start[i]), b = parseWhen(end[i]);
    if (!a || !b || b.ms <= a.ms || b.ms - a.ms > 12 * 3600000) continue;
    const s = Math.round(a.clock * 60), e = Math.round(b.clock * 60);
    if (a.local === b.local) (byDay[a.local] ||= []).push(`${s}-${e}`);
    else { (byDay[a.local] ||= []).push(`${s}-1440`); (byDay[b.local] ||= []).push(`0-${e}`); }
  }
  return Object.entries(byDay).map(([d, xs]) => ["workouts", xs.join(";"), d]);
}

// Wandelt Listen in Tageswerte um:
//  schlaf_start + schlaf_ende (+ schlaf_wert) → je Nacht Schlafdauer, Einschlaf- und Aufwachzeit (Tag des Aufwachens)
//  schritte + schritte_datum   → Wert je Datum
//  schritte allein             → neuester zuerst: heute, gestern, vorgestern …
export function listEntries(lists, today) {
  const out = [];
  // Kurzbefehle packen eine Liste oft als EINEN Text mit einem Wert pro Zeile → aufteilen
  for (const k of Object.keys(lists)) {
    lists[k] = lists[k].flatMap((x) => (typeof x === "string" ? x.split(/\r?\n/) : [x])).map((x) => (typeof x === "string" ? x.trim() : x)).filter((x) => x !== "" && x !== null && x !== undefined);
  }
  const done = new Set();
  for (const key of Object.keys(lists)) {
    if (key.endsWith("_wert")) continue; // gehört zu …_start/_ende
    const base = key.replace(/_(start|ende|datum)$/, "");
    if (done.has(base)) continue;
    const start = lists[base + "_start"], end = lists[base + "_ende"], dates = lists[base + "_datum"], vals = lists[base];
    if ((base === "puls" || base === "schrittez") && Array.isArray(vals) && Array.isArray(dates)) {
      // Tagesverlauf (Herzfrequenz bzw. Schritte je Stunde): je Tag eine Reihe „Minute:Wert,…“ für den Bereich Gesundheit
      done.add(base);
      out.push(...seriesEntries(base, vals, dates));
    } else if (base === "workout" && Array.isArray(start) && Array.isArray(end)) {
      // Trainingszeiten: je Tag „Startminute-Endminute;…“ (über Mitternacht aufgeteilt)
      done.add(base);
      out.push(...workoutEntries(start, end));
    } else if (base === "schlaf" && Array.isArray(start) && Array.isArray(end)) {
      done.add(base);
      out.push(...sleepEntries(start, end, lists.schlaf_wert));
    } else if (Array.isArray(start) && Array.isArray(end)) {
      done.add(base);
      const perDay = {}, firstStart = {};
      for (let i = 0; i < Math.min(start.length, end.length, 20000); i++) {
        const a = parseWhen(start[i]), b = parseWhen(end[i]);
        if (!a || !b || b.ms <= a.ms) continue;
        perDay[b.local] = (perDay[b.local] || 0) + (b.ms - a.ms) / 3600000;
        if (!firstStart[b.local] || a.ms < firstStart[b.local].ms) firstStart[b.local] = a;
      }
      for (const [d, h] of Object.entries(perDay)) {
        out.push([base, String(Math.round(h * 60) / 60), d]);
        const c = firstStart[d].clock;
        out.push([base + "_beginn", String(Math.round((c < 12 ? c + 24 : c) * 10000) / 10000), d]);
      }
    } else if (Array.isArray(vals)) {
      done.add(base);
      vals.slice(0, 400).forEach((v, i) => {
        const n = num(v);
        if (Number.isNaN(n)) return;
        const w = Array.isArray(dates) && dates[i] !== undefined ? parseWhen(dates[i]) : null;
        out.push([base, String(Math.round(n * 10) / 10), w ? w.local : minusDays(today, i)]);
      });
    }
  }
  return out;
}

/* ---------- Anfragen ---------- */
async function handle(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/") return text("Mosaik-Dienst läuft.");
  if (!env.SYNC_TOKEN) return json({ error: "Dienst noch nicht eingerichtet (Token fehlt)" }, 503);
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!safeEqual(auth, env.SYNC_TOKEN)) return json({ error: "Falscher oder fehlender Schlüssel" }, 401);

  if (path === "/ping") return json({ ok: true });

  if (path === "/vapid") return json({ key: (await vapidKeys(env)).pub });

  if (path === "/subscribe" && request.method === "POST") {
    const b = await request.json();
    const s = b.subscription;
    if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: "Abo unvollständig" }, 400);
    if (!/^\d{2}:\d{2}$/.test(b.time || "")) return json({ error: "Uhrzeit fehlt (HH:MM)" }, 400);
    const tz = b.tz || TZ_DEFAULT;
    // Wird eine Zeit eingestellt, die heute schon vorbei ist, erst ab morgen erinnern
    const now = localNow(tz);
    const last = b.time <= now.time ? now.date : "";
    await env.DB.prepare(
      `INSERT INTO subs (endpoint, p256dh, auth, time, tz, last_sent, created)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, time = ?4, tz = ?5, last_sent = CASE WHEN subs.time = ?4 THEN subs.last_sent ELSE ?6 END`
    ).bind(s.endpoint, s.keys.p256dh, s.keys.auth, b.time, tz, last).run();
    return json({ ok: true });
  }

  if (path === "/unsubscribe" && request.method === "POST") {
    const b = await request.json();
    await env.DB.prepare("DELETE FROM subs WHERE endpoint = ?").bind(b.endpoint || "").run();
    return json({ ok: true });
  }

  if (path === "/status" && request.method === "POST") {
    const b = await request.json();
    await env.DB.prepare("UPDATE subs SET status_date = ?, status_open = ? WHERE endpoint = ?").bind(b.date || "", Number(b.open) || 0, b.endpoint || "").run();
    return json({ ok: true });
  }

  if (path === "/test" && request.method === "POST") {
    const b = await request.json();
    const sub = await env.DB.prepare("SELECT * FROM subs WHERE endpoint = ?").bind(b.endpoint || "").first();
    if (!sub) return json({ error: "Kein Abo für dieses Gerät gefunden" }, 404);
    const date = localNow(sub.tz).date;
    const status = await sendPush(env, sub, { ...reminder(sub, date), body: "Test: So sieht die Erinnerung aus. Tippen startet die Abfrage." });
    return json({ ok: status < 300, status });
  }

  const sched = path.match(/^\/(weekly|goals)(\/teaser|\/test)?$/);
  const table = sched && sched[1];
  if (sched && !sched[2] && request.method === "POST") {
    const b = await request.json();
    const s = b.subscription;
    if (!s || !s.endpoint) return json({ error: "Abo unvollständig" }, 400);
    if (!b.on) {
      await env.DB.prepare(`DELETE FROM ${table} WHERE endpoint = ?`).bind(s.endpoint).run();
      return json({ ok: true });
    }
    if (!s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: "Abo unvollständig" }, 400);
    if (!/^\d{2}:\d{2}$/.test(b.time || "")) return json({ error: "Uhrzeit fehlt (HH:MM)" }, 400);
    const day = Number(b.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) return json({ error: "Wochentag fehlt (0–6)" }, 400);
    const tz = b.tz || TZ_DEFAULT;
    // Ist der Termin heute schon vorbei, erst nächste Woche schicken
    const now = localNow(tz);
    const last = table === "goals" ? "[]" : "";
    await env.DB.prepare(
      `INSERT INTO ${table} (endpoint, p256dh, auth, day, time, tz, last_sent, created)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, day = ?4, time = ?5, tz = ?6,
         last_sent = CASE WHEN ?7 = '' OR (${table}.day = ?4 AND ${table}.time = ?5) THEN ${table}.last_sent ELSE ?7 END`

    ).bind(s.endpoint, s.keys.p256dh, s.keys.auth, day, b.time, tz, last).run();
    return json({ ok: true });
  }

  if (sched && sched[2] === "/teaser" && request.method === "POST") {
    const b = await request.json();
    await env.DB.prepare(`UPDATE ${table} SET teaser = ?, teaser_week = ? WHERE endpoint = ?`)
      .bind(String(b.text || "").slice(0, table === "goals" ? 4000 : 300), String(b.week || ""), b.endpoint || "").run();
    return json({ ok: true });
  }

  if (sched && sched[2] === "/test" && request.method === "POST") {
    const b = await request.json();
    const sub = await env.DB.prepare(`SELECT * FROM ${table} WHERE endpoint = ?`).bind(b.endpoint || "").first();
    if (!sub) return json({ error: `${table === "goals" ? "Ziel-Erinnerung" : "Wochenbericht"} ist für dieses Gerät nicht aktiviert` }, 404);
    const date = localNow(sub.tz).date;
    const msg = table === "goals" ? { title: "Ziele", body: "Test: So sieht die Ziel-Erinnerung aus.", open: "goals", url: `${APP_URL}?open=goals` } : weeklyMessage(sub);
    const status = await sendPush(env, sub, msg);
    return json({ ok: status < 300, status });
  }

  if (path === "/in") {
    const { pairs, lists } = await readValues(request);
    let date = pairs.datum || pairs.date || localNow(TZ_DEFAULT).date;
    if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(date)) { const [d, m, y] = date.split("."); date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return text("Datum nicht erkannt. Bitte JJJJ-MM-TT oder TT.MM.JJJJ.", 400);
    delete pairs.datum; delete pairs.date; delete pairs.mosaik; delete pairs.taeglich;
    const prevDay = (d) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
    // Endung „_gestern“ trägt den Wert beim Vortag ein, z. B. schritte_gestern=9500
    const entries = Object.entries(pairs)
      .filter(([k, v]) => /^[a-z0-9_äöüß-]{1,48}$/.test(k) && v !== "" && v.length <= 200)
      .map(([k, v]) => (k.endsWith("_gestern") ? [k.slice(0, -8), v, prevDay(date)] : [k, v, date]))
      .filter(([k]) => k.length > 0)
      .concat(listEntries(lists, localNow(TZ_DEFAULT).date))
      .filter(([k]) => /^[a-z0-9_äöüß-]{1,48}$/.test(k));
    if (!entries.length) return text("Keine Werte erkannt. Beispiel: mosaik;schlaf=7,4", 400);
    await env.DB.batch(entries.map(([k, v, d]) => env.DB.prepare("INSERT INTO inbox (created, date, key, value) VALUES (datetime('now'), ?, ?, ?)").bind(d, k, v)));
    const byKey = {};
    const hm = (h, wrap) => { let m = Math.round(Number(h) * 60); if (wrap) m = ((m % 1440) + 1440) % 1440; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
    const show = (k, v) => (k.endsWith("_serie") ? `${v.split(",").length} Messwerte` : k === "workouts" ? `${v.split(";").length} Training(s)` : k === "schlaf" ? hm(v) : k === "schlafenszeit" || k === "aufwachzeit" || k.endsWith("_beginn") ? hm(v, true) : v);
    for (const [k, v, d] of entries) (byKey[k] = byKey[k] || []).push(`${d.slice(8, 10)}.${d.slice(5, 7)}.: ${show(k, v)}`);
    return text(`Gespeichert – ${Object.entries(byKey).map(([k, xs]) => `${k}: ${xs.join(", ")}`).join(" | ")}. Mosaik übernimmt das beim nächsten Öffnen.`);
  }

  // Notion: Titel der Unterseiten der Rezepte-Seite (nur lesen; Schlüssel als Secret NOTION_TOKEN)
  if (path === "/notion/recipes" && request.method === "GET") {
    if (!env.NOTION_TOKEN) return json({ error: "Notion ist im Mosaik-Dienst noch nicht eingerichtet (GitHub-Secret NOTION_TOKEN fehlt)" }, 503);
    const page = String(env.NOTION_RECIPES || "").replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/i.test(page)) return json({ error: "Rezepte-Seite nicht eingestellt" }, 503);
    const out = [];
    let cursor = null, rounds = 0;
    do {
      const r = await fetch(`https://api.notion.com/v1/blocks/${page}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`, {
        headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": "2022-06-28" }
      });
      if (!r.ok) {
        const msg = r.status === 401 ? "Der Notion-Schlüssel ist ungültig" : r.status === 404 || r.status === 403 ? "Die Rezepte-Seite ist nicht für die Verbindung „Mosaik“ freigegeben" : `Notion meldet Fehler ${r.status}`;
        return json({ error: msg }, 502);
      }
      const d = await r.json();
      for (const b of d.results || []) if (b.type === "child_page" && b.child_page) out.push({ id: b.id, title: b.child_page.title || "" });
      cursor = d.has_more ? d.next_cursor : null;
    } while (cursor && ++rounds < 20);
    return json({ recipes: out });
  }

  if (path === "/inbox" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, created, date, key, value FROM inbox ORDER BY id").all();
    return json({ items: results });
  }

  if (path === "/inbox/ack" && request.method === "POST") {
    const b = await request.json();
    const ids = (b.ids || []).map(Number).filter(Number.isInteger).slice(0, 2000);
    // D1 erlaubt höchstens 100 Platzhalter pro Abfrage → in Blöcken löschen
    const stmts = [];
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      stmts.push(env.DB.prepare(`DELETE FROM inbox WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, deleted: ids.length });
  }

  return json({ error: "Unbekannte Adresse" }, 404);
}

/* ---------- Zeitplan: jede Minute prüfen, wer erinnert werden muss ---------- */
async function scheduled(env) {
  const { results } = await env.DB.prepare("SELECT * FROM subs").all();
  for (const sub of results) {
    const now = localNow(sub.tz);
    if (now.time < sub.time || sub.last_sent === now.date) continue;
    // Erinnerung nur am selben Abend nachholen (nicht nach Mitternacht für gestern)
    await env.DB.prepare("UPDATE subs SET last_sent = ? WHERE endpoint = ?").bind(now.date, sub.endpoint).run();
    if (sub.status_date === now.date && sub.status_open === 0) continue; // heute schon alles beantwortet
    try { await sendPush(env, sub, reminder(sub, now.date)); } catch (e) { console.error("Push fehlgeschlagen", e); }
  }
  const weekly = (await env.DB.prepare("SELECT * FROM weekly").all()).results;
  for (const sub of weekly) {
    const now = localNow(sub.tz);
    // einmal je Woche, sobald sie vollständig ist (frühestens zur eingestellten Uhrzeit)
    if (!sub.teaser_week || sub.last_sent === sub.teaser_week || now.time < sub.time) continue;
    await env.DB.prepare("UPDATE weekly SET last_sent = ? WHERE endpoint = ?").bind(sub.teaser_week, sub.endpoint).run();
    try { await sendPush(env, sub, weeklyMessage(sub)); } catch (e) { console.error("Wochenbericht fehlgeschlagen", e); }
  }
  const goals = (await env.DB.prepare("SELECT * FROM goals").all()).results;
  for (const sub of goals) {
    const r = dueGoalAlerts(sub, localNow(sub.tz));
    if (!r) continue;
    await env.DB.prepare("UPDATE goals SET last_sent = ? WHERE endpoint = ?").bind(JSON.stringify(r.sent), sub.endpoint).run();
    const msg = { title: "Ziel in Gefahr", body: r.due.map((x) => x.t).join(" · ").slice(0, 300), open: "goals", url: `${APP_URL}?open=goals` };
    try { await sendPush(env, sub, msg); } catch (e) { console.error("Ziel-Erinnerung fehlgeschlagen", e); }
  }
  await env.DB.prepare("DELETE FROM inbox WHERE created < datetime('now', '-30 days')").run();
}

export default {
  fetch: (request, env) => handle(request, env).catch((e) => json({ error: String(e && e.message || e) }, 500)),
  scheduled: (event, env, ctx) => ctx.waitUntil(scheduled(env))
};
