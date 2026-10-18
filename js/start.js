/* Mosaik – Start, Updates, Links aus Mitteilungen */
"use strict";

/* ================= Start ================= */
// Tageswechsel bei offen gelassener App
let lastToday = todayIso();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const t = todayIso();
  if (t !== lastToday) { if (current === lastToday) current = t; lastToday = t; if (tab === "day") renderDay(); }
});

if (syncFriendQuestions()) save();
render();
checkHash();

// Analyse mit den Zielen öffnen (Tippen auf die Ziel-Erinnerung)
function openGoalsView() {
  quiz = null; tab = "analysis"; showAllGoals = true; prefs.goals = true; render();
  setTimeout(() => document.querySelector(".goals")?.scrollIntoView({ block: "start" }), 50);
}

// Tippen auf die Erinnerung: …/?quiz=2026-10-16 startet die Abfrage für diesen Tag
function openQuizFromLink(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || date > todayIso()) return;
  if (!askQuestions(date).length) { current = date; tab = "day"; quiz = null; render(); return; }
  startQuiz(date);
}
{
  const sp = new URLSearchParams(location.search);
  const qd = sp.get("quiz");
  if (qd) { history.replaceState(null, "", location.pathname); openQuizFromLink(qd); }
  if (sp.get("report")) { history.replaceState(null, "", location.pathname); openReport(); }
  if (sp.get("open") === "goals") { history.replaceState(null, "", location.pathname); openGoalsView(); }
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "quiz") openQuizFromLink(e.data.date);
    if (e.data && e.data.type === "report") { const d = $("#sheet"); if (d.open) d.close(); openReport(); }
    if (e.data && e.data.type === "open" && e.data.what === "goals") { const d = $("#sheet"); if (d.open) d.close(); openGoalsView(); }
  });
}
fetchInbox(false);
reportStatus();
setTimeout(goalNotices, 600);
capturePlace(false);
syncWeather(false);
syncChess(false);
const recipesBg = () => syncRecipes(false).then((changed) => { if (changed) render(); });
recipesBg();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { fetchInbox(false); reportStatus(); setTimeout(goalNotices, 600); capturePlace(false); syncChess(false); recipesBg(); } });

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    // Beim Zurückkehren in die App nach einer neuen Version schauen
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch((e) => console.warn("SW", e));
  // Neue Version aktiv → einmal neu laden (nicht mitten in einer Abfrage oder einem offenen Fenster)
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    const tryReload = () => {
      if (quiz || document.querySelector("dialog[open]")) return setTimeout(tryReload, 5000);
      reloading = true; location.reload();
    };
    tryReload();
  });
}
