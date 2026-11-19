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
      <div class="subsep"></div>
      <p class="muted small"><strong>Mahlzeiten:</strong> Fotografier dein Essen im Claude-Projekt „App“. Claude schätzt die Nährwerte und trägt sie in die Notion-Datenbank „Mahlzeiten“ ein; Mosaik holt sie beim Öffnen ab (letzte 14 Tage werden jedes Mal abgeglichen, Änderungen in Notion gelten). Die Datenbank muss – wie die Rezepte-Seite – für die Verbindung „Mosaik“ freigegeben sein.</p>
      <p class="small hstatus ${Object.keys(mealStore().items).length ? "ok" : ""}">${Object.keys(mealStore().items).length ? `<strong>${Object.keys(mealStore().items).length} Mahlzeiten</strong>${settings.notion.mealsAt ? `, zuletzt geholt ${new Date(settings.notion.mealsAt).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}.` : "Noch keine Mahlzeiten."}</p>
      ${settings.notion.mealsErr ? `<p class="small" style="margin:8px 0 0;color:var(--danger)">Letzter Fehler: ${esc(settings.notion.mealsErr)}</p>` : ""}
      ${settings.token ? `<button class="btn ghost block" id="mealsnow" style="margin-top:12px">Mahlzeiten jetzt holen</button>` : ""}
    </section>`;
}
function wireNotionSettings() {
  $("#mealsnow")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Hole Mahlzeiten …";
    await syncMeals(true);
    renderData();
  });
  $("#notionnow")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Hole Rezepte …";
    await syncRecipes(true);
    renderData();
  });
}

if (syncRecipeQuestions()) save();

/* ================= Mahlzeiten aus Notion =================
   Claude trägt im Projekt-Chat Essen mit geschätzten Nährwerten in die Notion-Datenbank „Mahlzeiten“ ein.
   Mosaik holt die Einträge über den Dienst (/notion/meals), speichert sie je Tag und bildet Tagessummen
   als automatische Felder (wie Apple Health) – damit gibt es Analyse, Ziele, Wochenbericht und Excel. */
const NUTRI = [["nahrung_kcal", "kcal", "Kalorien (Essen)", "kcal"], ["protein", "p", "Protein", "g"], ["kohlenhydrate", "kh", "Kohlenhydrate", "g"],
  ["zucker", "z", "Zucker", "g"], ["fett", "f", "Fett", "g"], ["fett_gesaettigt", "gs", "Gesättigte Fettsäuren", "g"], ["ballaststoffe", "bs", "Ballaststoffe", "g"]];
const NUTRI_KEYS = NUTRI.map((x) => x[0]);
const isNutriQ = (q) => q && q.source === "health" && NUTRI_KEYS.includes(q.healthKey);
const mealStore = () => (state.meals && typeof state.meals === "object" ? state.meals : (state.meals = { items: {}, since: "" }));
const mealsOn = (day) => Object.values(mealStore().items).filter((m) => m.day === day).sort((a, b) => (a.when < b.when ? -1 : 1));
// Tag der Mahlzeit: Datum aus Notion (ohne Uhrzeit = ganzer Tag; mit Uhrzeit = lokales Datum laut Angabe)
const mealDay = (when) => String(when).slice(0, 10);

let mealsBusy = false;
async function syncMeals(manual) {
  if (mealsBusy) return false;
  if (!settings.token) { if (manual) toast("Zuerst unter „Verbindung“ den Schlüssel eintragen"); return false; }
  // automatisch höchstens alle 5 Minuten
  if (!manual && Date.now() - (settings.notion.mealsAt || 0) < 5 * 60e3) return false;
  mealsBusy = true;
  try {
    const st = mealStore();
    // erster Abruf: ein Jahr zurück, danach die letzten 14 Tage neu abgleichen (Änderungen und Löschungen in Notion)
    const since = st.since ? addDays(todayIso(), -14) : addDays(todayIso(), -365);
    const { meals = [] } = await api(`/notion/meals?since=${since}`);
    const before = JSON.stringify(Object.values(st.items).filter((m) => m.day >= since));
    for (const [id, m] of Object.entries(st.items)) if (m.day >= since) delete st.items[id];
    for (const m of meals) st.items[m.id] = { ...m, day: mealDay(m.when) };
    st.since = since;
    settings.notion.mealsAt = Date.now(); settings.notion.mealsErr = ""; saveSettings();
    const changed = before !== JSON.stringify(Object.values(st.items).filter((m) => m.day >= since));
    // Tagessummen ab „since“ neu setzen (Tage ohne Eintrag: keine Werte – nichts gegessen heißt hier „nicht erfasst“)
    if (changed || manual) {
      const created = [];
      const any = Object.keys(st.items).length > 0;
      const qs = any ? NUTRI.map(([key, , text, unit]) => {
        const q = ensureHealthQuestion(key, created);
        if (!q.theme) q.theme = "food";
        q.text = q.text || text; if (!q.unit) q.unit = unit;
        return q;
      }) : state.questions.filter(isNutriQ);
      for (let d = since; d <= todayIso(); d = addDays(d, 1)) {
        const ms = mealsOn(d);
        const a = state.answers[d] || (state.answers[d] = {});
        NUTRI.forEach(([key, f], i) => {
          const q = qs[i] || qs.find((x) => x.healthKey === key);
          if (!q) return;
          const vals = ms.map((m) => m[f]).filter((v) => typeof v === "number");
          // gesättigte Fettsäuren nur, wenn jede Mahlzeit mit Fett einen Wert hat (ältere Einträge haben die Spalte nicht)
          const partial = f === "gs" && ms.some((m) => typeof m.gs !== "number" && (m.f || 0) > 0);
          if (vals.length && !partial) a[q.id] = Math.round(vals.reduce((x, y) => x + y, 0) * 10) / 10;
          else delete a[q.id];
        });
        if (!Object.keys(a).length) delete state.answers[d];
      }
      save();
    }
    if (manual) toast(`${meals.length} Mahlzeiten seit ${shortDate(since)} aus Notion`);
    return changed;
  } catch (e) {
    settings.notion.mealsErr = e.message; saveSettings();
    if (manual) toast(e.message);
    return false;
  } finally {
    mealsBusy = false;
  }
}

// Tagesziele oben in der Ernährungskarte: Kalorien groß, darunter je Nährstoff eine Kachel mit dem Ist-Wert;
// Ziel, Zielbereich bzw. Obergrenze sind im Balken markiert.
function nutriBuffer(day, ms) {
  const T = nutriTargets(), isToday = day === todayIso();
  const tot = (k) => { const xs = ms.map((m) => m[k]).filter((v) => typeof v === "number"); return xs.length ? xs.reduce((a, b) => a + b, 0) : null; };
  // gesättigte Fettsäuren nur, wenn jede Mahlzeit mit Fett einen Wert hat
  const gsOk = !ms.some((m) => typeof m.gs !== "number" && (m.f || 0) > 0);
  const E = { kcal: tot("kcal"), p: tot("p"), kh: tot("kh"), f: tot("f"), gs: gsOk ? tot("gs") : null, z: tot("z"), bs: tot("bs") };
  const r = (x) => Math.round(x), fb = (x) => fmtBig(r(x)), r10 = (x) => fmtBig(Math.round(x / 10) * 10);
  // Farbe des Ist-Werts: grün = Ziel erreicht bzw. im Rahmen, rot = zu viel (Obergrenze/Bereich überschritten)
  // oder an einem vergangenen Tag nicht erreicht, schwarz = heute noch nicht erreicht
  const stOf = (t, e) => e === null ? "na" : t.t === "cap" ? (e <= t.hi ? "ok" : "bad")
    : e > (t.hi ?? Infinity) ? "bad" : e >= t.lo ? "ok" : isToday ? "open" : "bad";
  // Balken: Skala bis 125 % des Ziels; Zielbereich grün hinterlegt, Grenzen als Strich
  const bar = (t, e, st, cls) => {
    const mx = 1.25 * (t.hi ?? t.lo), P = (x) => `${Math.min(100, (x / mx) * 100)}%`;
    const zone = t.t === "cap" ? `<span class="z" style="left:0;width:${P(t.hi)}"></span>` : t.t === "min" ? `<span class="z" style="left:${P(t.lo)};right:0"></span>` : `<span class="z" style="left:${P(t.lo)};width:${P(t.hi - t.lo)}"></span>`;
    const marks = [t.t !== "cap" ? t.lo : null, t.hi ?? null].filter((x) => x !== null).map((x) => `<span class="m" style="left:${P(x)}"></span>`).join("");
    return `<div class="${cls}">${zone}<span class="e ${st}" style="width:${P(e || 0)}"></span>${marks}</div>`;
  };
  const goalTxt = (t, f) => t.t === "cap" ? `max. ${f(t.hi)}` : t.t === "min" ? `Ziel ≥ ${f(t.lo)}` : `Ziel ${f(t.lo)}–${f(t.hi)}`;
  const tile = (k, label) => {
    const t = T[k], e = E[k], st = stOf(t, e);
    return `<div class="ntile ${st}" data-nt="${k}"><div class="n">${label}</div><div class="v">${e === null ? "–" : `${fb(e)}<small> g</small>`}</div><div class="s">${e === null ? "nicht erfasst" : goalTxt(t, fb) + " g"}</div>${bar(t, e, st, "tb")}</div>`;
  };
  let head = "";
  if (T.kcal) {
    const e = E.kcal || 0, st = stOf(T.kcal, e);
    head = `<div class="nbig ${st}"><b>${fb(e)}</b><span>kcal · ${goalTxt(T.kcal, r10)}</span></div>
      ${bar(T.kcal, e, st, "nkbar")}`;
  }
  const S = nutriScore([{ d: day, kcal: E.kcal || 0, p: E.p, kh: E.kh, z: E.z, f: E.f, gs: E.gs, bs: E.bs }]);
  return `<div class="nhead"><p class="q-title">Ernährung</p>${S && E.kcal ? `<span class="nscore${isToday ? " now" : ""}">Score <b>${S.score}</b></span>` : ""}</div>
    ${head}
    <div class="ngrid">${tile("p", "Protein")}${tile("kh", "Kohlenhydr.")}${tile("f", "Fett")}${tile("gs", "ges. Fett")}${tile("z", "Zucker")}${tile("bs", "Ballaststoffe")}</div>
    ${T.need ? "" : `<p class="muted small" style="margin:8px 0 0">Ziele für 2.000 kcal. Mit Geburtsjahr, Geschlecht, Größe und Gewicht im Profil gelten deine eigenen.</p>`}
    <div class="nsep"></div>`;
}

// Tag-Seite: Karte „Ernährung“ mit den Mahlzeiten des Tages und der Summe
function mealsDayCard(day) {
  const ms = mealsOn(day);
  if (!ms.length) return "";
  const sum = (f) => Math.round(ms.reduce((t, m) => t + (typeof m[f] === "number" ? m[f] : 0), 0));
  const hm = (w) => (String(w).length > 10 ? String(w).slice(11, 16) : "");
  return `<section class="q mealcard">
    ${nutriBuffer(day, ms)}
    ${ms.map((m) => `<div class="mrow"><span class="mt">${esc(hm(m.when))}</span><span class="mn">${esc(m.name || m.meal || "Mahlzeit")}${m.note ? `<small>${esc(m.note)}</small>` : ""}</span><span class="mk">${typeof m.kcal === "number" ? `${Math.round(m.kcal)} kcal` : ""}</span></div>`).join("")}
  </section>`;
}
