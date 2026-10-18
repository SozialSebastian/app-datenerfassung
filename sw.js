// Offline-Cache für die App. Bei jeder Änderung an den Dateien VERSION erhöhen.
const VERSION = "mosaik-v72";
const FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/core.js",
  "./js/day.js",
  "./js/analysis.js",
  "./js/trends.js",
  "./js/goals.js",
  "./js/report.js",
  "./js/export.js",
  "./js/places.js",
  "./js/weather.js",
  "./js/questions.js",
  "./js/friends.js",
  "./js/talks.js",
  "./js/service.js",
  "./js/chess.js",
  "./js/notion.js",
  "./js/settings.js",
  "./js/data.js",
  "./js/start.js",
  "./manifest.webmanifest",
  "./vendor/xlsx.full.min.js",
  "./vendor/modern-screenshot.min.js",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Erst Netz (damit Updates sofort ankommen), offline aus dem Cache.
self.addEventListener("fetch", (e) => {
  // nur eigene Dateien cachen, nie Anfragen an den Mosaik-Dienst
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});

// Tägliche Erinnerung vom Mosaik-Dienst
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { /* ohne Inhalt */ }
  e.waitUntil(self.registration.showNotification(d.title || "Abfrage für heute", { // nicht „Mosaik“: iOS zeigt darunter schon „from Mosaik“
    body: d.body || "Zeit für die Abfrage von heute.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.report ? "mosaik-woche" : d.open ? "mosaik-ziele" : "mosaik-taeglich",
    data: { date: d.date || null, report: d.report || null, open: d.open || null }
  }));
});

// Tippen auf die Mitteilung: App öffnen und Abfrage für den Tag starten
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const date = data.date;
  // Wochenbericht öffnen bzw. Abfrage für den Tag starten
  const msg = data.report ? { type: "report" } : data.open ? { type: "open", what: data.open } : { type: "quiz", date };
  const url = new URL(data.report ? "./?report=week" : data.open ? `./?open=${data.open}` : date ? `./?quiz=${date}` : "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) {
      if (!c.url.startsWith(self.registration.scope)) continue;
      try { await c.focus(); c.postMessage(msg); return; } catch (err) { /* weiter mit neuem Fenster */ }
    }
    await self.clients.openWindow(url);
  })());
});
