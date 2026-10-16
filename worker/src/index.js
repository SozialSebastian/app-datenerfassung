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
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
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
  if (res.status === 404 || res.status === 410) await env.DB.prepare("DELETE FROM subs WHERE endpoint = ?").bind(sub.endpoint).run();
  return res.status;
}

function reminder(sub, date) {
  const open = sub.status_date === date ? sub.status_open : null;
  return {
    title: "Mosaik",
    body: open ? `Noch ${open} Frage${open === 1 ? "" : "n"} für heute offen. Tippen startet die Abfrage.` : "Zeit für die Abfrage von heute. Tippen zum Starten.",
    date,
    url: `${APP_URL}?quiz=${date}`
  };
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

// Wandelt Listen in Tageswerte um:
//  schlaf_start + schlaf_ende  → Summe der Stunden je Nacht (Tag des Aufwachens)
//  schritte + schritte_datum   → Wert je Datum
//  schritte allein             → neuester zuerst: heute, gestern, vorgestern …
function listEntries(lists, today) {
  const out = [];
  // Kurzbefehle packen eine Liste oft als EINEN Text mit einem Wert pro Zeile → aufteilen
  for (const k of Object.keys(lists)) {
    lists[k] = lists[k].flatMap((x) => (typeof x === "string" ? x.split(/\r?\n/) : [x])).map((x) => (typeof x === "string" ? x.trim() : x)).filter((x) => x !== "" && x !== null && x !== undefined);
  }
  const done = new Set();
  for (const key of Object.keys(lists)) {
    const base = key.replace(/_(start|ende|datum)$/, "");
    if (done.has(base)) continue;
    const start = lists[base + "_start"], end = lists[base + "_ende"], dates = lists[base + "_datum"], vals = lists[base];
    if (Array.isArray(start) && Array.isArray(end)) {
      done.add(base);
      const perDay = {}, firstStart = {};
      for (let i = 0; i < Math.min(start.length, end.length, 20000); i++) {
        const a = parseWhen(start[i]), b = parseWhen(end[i]);
        if (!a || !b || b.ms <= a.ms) continue;
        perDay[b.local] = (perDay[b.local] || 0) + (b.ms - a.ms) / 3600000;
        if (!firstStart[b.local] || a.ms < firstStart[b.local].ms) firstStart[b.local] = a;
      }
      // Dauer minutengenau (in Stunden), dazu die Uhrzeit des Einschlafens (nach Mitternacht → 24+)
      const startKey = base === "schlaf" ? "schlafenszeit" : base + "_beginn";
      for (const [d, h] of Object.entries(perDay)) {
        out.push([base, String(Math.round(h * 60) / 60), d]);
        const c = firstStart[d].clock;
        out.push([startKey, String(Math.round((c < 12 ? c + 24 : c) * 10000) / 10000), d]);
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
    const show = (k, v) => (k === "schlaf" ? hm(v) : k === "schlafenszeit" || k.endsWith("_beginn") ? hm(v, true) : v);
    for (const [k, v, d] of entries) (byKey[k] = byKey[k] || []).push(`${d.slice(8, 10)}.${d.slice(5, 7)}.: ${show(k, v)}`);
    return text(`Gespeichert – ${Object.entries(byKey).map(([k, xs]) => `${k}: ${xs.join(", ")}`).join(" | ")}. Mosaik übernimmt das beim nächsten Öffnen.`);
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
  await env.DB.prepare("DELETE FROM inbox WHERE created < datetime('now', '-30 days')").run();
}

export default {
  fetch: (request, env) => handle(request, env).catch((e) => json({ error: String(e && e.message || e) }, 500)),
  scheduled: (event, env, ctx) => ctx.waitUntil(scheduled(env))
};
