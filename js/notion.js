/* Mosaik – Schnittstelle Notion: Rezepte als Antworten für „Was hast du heute gekocht?“ */
"use strict";

// Unterseiten, die keine Rezepte sind
const NOTION_SKIP = /^rezeptideen$/i;
// feste Zusatzantworten der Vorlage „Gekocht“
const RECIPE_OTHER = "Etwas anderes gekocht";
const RECIPE_EXTRA = [RECIPE_OTHER, "Nichts gekocht"];
if (!settings.notion) settings.notion = { lastDay: "", err: "" };

const recipeList = () => (state.recipes && Array.isArray(state.recipes.list) ? state.recipes.list : []);
const recipeNames = () => recipeList().map((r) => r.title);

// Fragen mit Vorlage „Rezepte“ bekommen die aktuellen Rezepte (plus eigene Zusatzantworten) als Antworten
function syncRecipeQuestions() {
  let changed = false;
  for (const q of state.questions) {
    if (!q.notion || q.type !== "choice") continue;
    // ältere Fragen der Vorlage: „Etwas anderes gekocht“ ergänzen (vor „Nichts gekocht“)
    if (!q.tplv) {
      const ex = (q.extra || []).filter((x) => x !== RECIPE_OTHER);
      const i = ex.indexOf("Nichts gekocht");
      ex.splice(i < 0 ? ex.length : i, 0, RECIPE_OTHER);
      q.extra = ex; q.tplv = 2; changed = true;
      if (!recipeNames().length) q.options = Array.from(new Set([...q.options.filter((o) => !ex.includes(o)), ...ex]));
    }
    const opts = Array.from(new Set([...recipeNames(), ...(q.extra || [])]));
    if (opts.length && JSON.stringify(opts) !== JSON.stringify(q.options)) { q.options = opts; changed = true; }
  }
  return changed;
}

let recipesBusy = false;
// höchstens einmal am Tag (oder auf Wunsch) die Rezepte über den Mosaik-Dienst holen
async function syncRecipes(manual) {
  if (recipesBusy) return false;
  if (!settings.token) { if (manual) toast("Zuerst unter „Verbindung“ den Schlüssel eintragen"); return false; }
  if (!manual && (settings.notion.lastDay === todayIso() || !state.questions.some((q) => q.notion && !q.archived))) return false;
  recipesBusy = true;
  try {
    const { recipes = [] } = await api("/notion/recipes");
    const list = recipes.map((r) => ({ id: r.id, title: String(r.title || "").replace(/\s+/g, " ").trim() }))
      .filter((r) => r.title && !NOTION_SKIP.test(r.title))
      .sort((a, b) => a.title.localeCompare(b.title, "de"));
    // umbenannte Rezepte (gleiche Seite, neuer Titel) auch in alten Antworten umbenennen
    const old = new Map(recipeList().map((r) => [r.id, r.title]));
    const ren = new Map(list.filter((r) => old.has(r.id) && old.get(r.id) !== r.title).map((r) => [old.get(r.id), r.title]));
    if (ren.size) {
      const ids = state.questions.filter((q) => q.notion).map((q) => q.id);
      for (const a of Object.values(state.answers)) for (const id of ids) {
        const v = a[id];
        if (Array.isArray(v)) a[id] = Array.from(new Set(v.map((x) => ren.get(x) || x)));
        else if (typeof v === "string" && ren.has(v)) a[id] = ren.get(v);
      }
    }
    state.recipes = { list, at: Date.now() };
    syncRecipeQuestions();
    settings.notion.lastDay = todayIso(); settings.notion.err = "";
    saveSettings(); save();
    if (manual) toast(`${list.length} Rezepte aus Notion`);
    return true;
  } catch (e) {
    settings.notion.err = e.message; saveSettings();
    if (manual) toast(e.message);
    return false;
  } finally {
    recipesBusy = false;
  }
}

// Einstellungen: Status und Anleitung
function notionSettingsPanel() {
  const n = recipeList().length;
  const has = state.questions.some((q) => q.notion && !q.archived);
  return `<section class="panel">
      <h2>Schnittstelle Notion</h2>
      <p class="muted small">Liest die Titel deiner Rezepte von der Notion-Seite „Rezepte“. Sie sind die Antworten der Frage aus der Vorlage „Gekocht (Rezepte aus Notion)“ und bleiben automatisch aktuell (einmal am Tag beim Öffnen). Mosaik liest nur, ändert in Notion nichts.</p>
      <p class="small hstatus ${n ? "ok" : ""}">${n ? `<strong>Verbunden.</strong> ${n} Rezepte${state.recipes.at ? `, zuletzt geholt ${new Date(state.recipes.at).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}.${has ? "" : " Leg unter Fragen → + → Vorlage „Gekocht“ die Frage an."}` : "Noch nicht eingerichtet."}</p>
      ${settings.notion.err ? `<p class="small" style="margin:8px 0 0;color:var(--danger)">Letzter Fehler: ${esc(settings.notion.err)}</p>` : ""}
      ${settings.token ? `<button class="btn ghost block" id="notionnow" style="margin-top:12px">Rezepte jetzt holen</button>` : `<p class="muted small">Trag zuerst unten unter „Verbindung“ deinen Schlüssel ein.</p>`}
    </section>`;
}
function wireNotionSettings() {
  $("#notionnow")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Hole Rezepte …";
    await syncRecipes(true);
    renderData();
  });
}

if (syncRecipeQuestions()) save();
