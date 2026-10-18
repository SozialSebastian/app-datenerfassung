// Automatische Tests für Mosaik: startet die App im Browser (iPhone-Größe) und prüft die wichtigsten Abläufe.
// Aufruf: cd tests && npm install && npx playwright install chromium && node run.mjs
// Externe Dienste (Ortsname, Wetter, Mosaik-Dienst) werden im Test nachgebildet – es gehen keine echten Anfragen raus.
import { chromium, devices } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "tests", "screens");
fs.mkdirSync(shots, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});

// ---------- Hilfen ----------
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

async function open({ data, settings, dark, geo, url = "" } = {}) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], colorScheme: dark ? "dark" : "light", ...(geo ? { permissions: ["geolocation"], geolocation: geo } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());
  // externe Dienste nachbilden
  await page.route("https://api.bigdatacloud.net/**", (r) => json(r, { city: "Wedel" }));
  await page.route("https://nominatim.openstreetmap.org/**", (r) => json(r, { address: { town: "Wedel" } }));
  await page.route(/open-meteo\.com/, (r) => {
    const u = new URL(r.request().url());
    if (u.searchParams.get("current")) return json(r, { current: { temperature_2m: 12.4, weather_code: 3, is_day: 1 } });
    const out = { time: [], temperature_2m_max: [], precipitation_sum: [], sunshine_duration: [] };
    for (let d = u.searchParams.get("start_date"); d <= u.searchParams.get("end_date"); ) {
      out.time.push(d); out.temperature_2m_max.push(15); out.precipitation_sum.push(0); out.sunshine_duration.push(5 * 3600);
      const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + 1); d = iso(x);
    }
    return json(r, { daily: out });
  });
  await page.route(/workers\.dev/, (r) => json(r, { ok: true, items: [] }));
  await page.addInitScript(([data, settings]) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    if (data) localStorage.setItem("taeglich.v1", JSON.stringify(data));
    if (settings) localStorage.setItem("mosaik.settings", JSON.stringify(settings));
  }, [data || null, settings || null]);
  await page.goto(BASE + url);
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}

const yesNo = (id, text, extra = {}) => ({ id, text, type: "choice", options: ["Ja", "Nein"], multi: false, ...extra });
const health = (id, text, healthKey, format) => ({ id, text, type: "number", unit: "", healthKey, source: "health", ...(format ? { format } : {}) });

// Ein Jahr Testdaten mit Mustern (Wochenende mehr Schritte, Sommer mehr Schritte, Bouldern ↔ Schlaf)
function yearData() {
  const answers = {};
  let r = 11;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  for (let i = 400; i >= 1; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const summer = Math.cos(((d.getMonth() - 6.5) / 12) * 2 * Math.PI);
    const we = d.getDay() === 0 || d.getDay() === 6;
    const b = rnd() < 0.3 ? "Ja" : "Nein";
    answers[iso(d)] = {
      st: Math.round(8000 + 2500 * summer + (we ? 3000 : 0) + rnd() * 2000),
      s: 6.5 + rnd() + (b === "Ja" ? 0.6 : 0),
      z: 23 + rnd() * 1.5,
      b, l: 2 + Math.floor(rnd() * 3) + (b === "Ja" ? 1 : 0)
    };
  }
  return {
    version: 1, lastBackup: null, answers,
    questions: [yesNo("b", "Heute bouldern?"), { id: "l", text: "Laune", type: "scale", min: 1, max: 5, minLabel: "", maxLabel: "", better: "high" },
      health("s", "Schlafdauer", "schlaf", "duration"), health("z", "Schlafenszeit", "schlafenszeit", "clock"), health("st", "Schritte", "schritte")]
  };
}

// ---------- Tests ----------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("Leerer Start zeigt „Noch keine Fragen“", async () => {
  const { page, ctx, errors } = await open();
  assert.match(await page.locator("#view").innerText(), /Noch keine Fragen/);
  for (const t of ["friends", "analysis", "data"]) await page.click(`[data-tab="${t}"]`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Frage anlegen, beantworten, Fortschritt und Abfrage", async () => {
  const { page, ctx, errors } = await open();
  await page.click("#firstq");
  await page.click("#nown"); // zuerst: eigene Frage oder Vorlage
  await page.waitForTimeout(100);
  await page.fill("#qtext", "Heute bouldern?");
  await page.click("#savebtn");
  await page.click("#startquiz");
  await page.locator(".quiz-q .chip", { hasText: "Ja" }).click();
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => state);
  assert.equal(Object.values(st.answers)[0][st.questions[0].id], "Ja");
  assert.match(await page.locator(".quiz-done").innerText(), /Fertig/);
  await page.click("#qfinish");
  assert.match(await page.locator(".progress").innerText(), /1 von 1/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Folgefrage erscheint nur nach „Ja“", async () => {
  const data = { version: 1, answers: {}, lastBackup: null, questions: [yesNo("b", "Bouldern?"), { id: "g", text: "Welche Grade?", type: "scale", min: 1, max: 8, minLabel: "", maxLabel: "", cond: { qid: "b", values: ["Ja"] } }] };
  const { page, ctx, errors } = await open({ data });
  assert.equal(await page.locator('.q[data-qid="g"]').count(), 0);
  await page.locator('.q[data-qid="b"] .chip', { hasText: "Ja" }).click();
  assert.equal(await page.locator('.q[data-qid="g"]').count(), 1);
  await page.locator('.q[data-qid="b"] .chip', { hasText: "Nein" }).click();
  assert.equal(await page.locator('.q[data-qid="g"]').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Zeitformate: Eingabe und Anzeige", async () => {
  const { page, ctx } = await open();
  const r = await page.evaluate(() => {
    const dur = { format: "duration" }, clk = { format: "clock" };
    return [parseQ(dur, "7:23"), fmtQ(dur, 7.5), parseQ(clk, "0:45"), fmtQ(clk, 24.75), parseQ(dur, "7 h 05 min"), parseQ({}, "7,5")];
  });
  assert.equal(Math.round(r[0] * 60), 443);
  assert.equal(r[1], "7 h 30 min");
  assert.equal(r[2], 24.75);
  assert.equal(r[3], "00:45");
  assert.equal(Math.round(r[4] * 60), 425);
  assert.equal(r[5], 7.5);
  await ctx.close();
});

test("Excel enthält alle Fragen, Datumsformat, Dauer und Orte", async () => {
  const data = yearData();
  data.places = { [daysAgo(1)]: [{ c: "Wedel", t: "08:00" }, { c: "Hamburg", t: "12:00" }] };
  const { page, ctx, errors } = await open({ data });
  const r = await page.evaluate(() => {
    const ws = buildWorkbook().Sheets.Antworten;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const header = []; for (let c = 0; c <= range.e.c; c++) header.push(ws[XLSX.utils.encode_cell({ r: 0, c })].v);
    return { header, rows: range.e.r, a2: ws.A2.z, dur: ws[XLSX.utils.encode_cell({ r: 1, c: header.indexOf("Schlafdauer") })].z, last: ws[XLSX.utils.encode_cell({ r: range.e.r, c: header.indexOf("Orte") })]?.v };
  });
  // Spalten nach Thema sortiert: Sport, Gesundheit, Wohlbefinden
  assert.deepEqual(r.header, ["Datum", "Wochentag", "Heute bouldern?", "Schritte", "Schlafdauer", "Schlafenszeit", "Laune", "Orte"]);
  assert.equal(r.rows, 400);
  assert.equal(r.a2, "dd.mm.yyyy");
  assert.equal(r.dur, "[h]:mm");
  assert.equal(r.last, "Wedel → Hamburg");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Analyse mit einem Jahr Daten: Trends, Jahreszeiten, Zusammenhänge", async () => {
  const { page, ctx, errors } = await open({ data: yearData() });
  await page.click('[data-tab="analysis"]');
  await page.selectOption("[data-range-sel]", "365");
  if (await page.locator("#tmore").count()) await page.click("#tmore");
  const txt = await page.locator(".trends").innerText();
  assert.match(txt, /Schritte: (samstags|sonntags) am meisten/);
  assert.match(txt, /Schritte: im Sommer am meisten/);
  assert.match(txt, /„Schlafdauer“ (an Tagen mit|am Tag nach) „Heute bouldern“ = Ja/);
  for (const r of ["1", "7", "30"]) await page.click(`[data-range="${r}"]`);
  for (const r of ["ytd", "all", "custom"]) await page.selectOption("[data-range-sel]", r);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Ziele: Status, Zeitraum je Ziel, einmalige Ziele", async () => {
  const { page, ctx } = await open({ data: yearData() });
  const r = await page.evaluate(() => {
    const t = todayIso();
    const mk = (g) => evalGoal({ id: "x", ...g }, periodOf(g.period, t));
    G().items = [];
    return {
      easy: mk({ qid: "st", kind: "sum", cmp: "ge", val: 1, period: "month" }).status,
      max: mk({ qid: "b", kind: "count", key: "Ja", op: "max", n: 0, period: "year" }).status,
      once: goalActive({ period: "week", repeat: false, once: "week:2000-01-03" }),
      repeat: goalActive({ period: "week", repeat: true }),
      text: goalText({ kind: "days", n: 3, cmp: "le", val: 23.5 }, qById("z"))
    };
  });
  assert.equal(r.easy, "done");
  assert.equal(r.max, "fail");
  assert.equal(r.once, false);
  assert.equal(r.repeat, true);
  assert.equal(r.text, "an mindestens 3 Tagen spätestens 23:30");
  await ctx.close();
});

test("Ziel über das Zahnrad anlegen und in der Analyse sehen", async () => {
  const { page, ctx, errors } = await open({ data: yearData() });
  await page.click("#goalsbtn");
  await page.click("#gadd");
  await page.click('[data-gper="week"]');
  await page.fill("#gn", "2");
  await page.dispatchEvent("#gn", "change");
  await page.click("#gsave");
  await page.click("#gdone");
  // je nach Wochentag meldet die App kurz darauf „nicht mehr zu schaffen“ – Hinweis schließen
  await page.waitForTimeout(700);
  await page.evaluate(() => { const d = document.querySelector("#sheet"); if (d.open) d.close(); });
  await page.click('[data-tab="analysis"]');
  assert.match(await page.locator(".goals").innerText(), /Heute bouldern\?[\s\S]*\d von 2×/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Wochenbericht öffnet über den Link aus der Mitteilung", async () => {
  const { page, ctx, errors } = await open({ data: yearData(), url: "?report=week" });
  await page.waitForTimeout(300);
  const txt = await page.locator(".report").innerText();
  assert.match(txt, /KW \d+/);
  assert.match(txt, /Deine Woche/);
  await page.click("#rprev");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Freunde: Liste einfügen, Quoten, Stichtag, Veränderung", async () => {
  const { page, ctx, errors } = await open();
  await page.click('[data-tab="friends"]');
  await page.click("#fadd"); await page.click("#fbulk");
  await page.fill("#fnames", "Stichtag: 01.05.2026\n# Beste Freunde\nAnna 💍 ♀ 🎓\nBen 🌱\n# Freunde\nCem 🚬\nDora ♀ NEU");
  await page.click(".sheet-head [type=submit]");
  assert.match(await page.locator(".fsum").innerText(), /4\s+Freunde insgesamt/);
  assert.match(await page.locator(".fsum").innerText(), /Frauen\s+50 %\s+2/);
  await page.click("#fsettings"); await page.fill("#fnewst", "2026-10-01"); await page.click("#fnewbtn"); await page.click("#fsdone");
  await page.click(".frow:has-text('Ben')"); await page.click('[data-fcat="good"]'); await page.click(".sheet-head [type=submit]");
  const chg = await page.locator(".fchg").innerText();
  assert.match(chg, /Ben: Beste → Gute/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Vorlage „Freunde“: Antworten bleiben synchron, Umbenennen zieht mit", async () => {
  const data = { version: 1, lastBackup: null, answers: { [daysAgo(3)]: { w: ["Anna"] } },
    questions: [{ id: "w", text: "Mit wem?", type: "choice", options: ["Anna"], multi: true, friends: { cats: ["best", "good", "friend"] }, extra: ["Familie"] }],
    friends: { stichtag: daysAgo(30), history: [], labels: {}, list: [{ id: "a", name: "Anna", cat: "best", tags: {} }, { id: "b", name: "Ben", cat: "friend", tags: {} }] } };
  const { page, ctx, errors } = await open({ data });
  assert.deepEqual(await page.evaluate(() => qById("w").options), ["Anna", "Ben", "Familie"]);
  await page.click('[data-tab="friends"]');
  assert.match(await page.locator(".meets").innerText(), /Anna[\s\S]*vor 3 Tagen/);
  await page.click(".frow:has-text('Anna')"); await page.fill("#fname", "Anna K."); await page.click(".sheet-head [type=submit]");
  const st = await page.evaluate(() => [qById("w").options, state.answers[addDays(todayIso(), -3)].w]);
  assert.deepEqual(st, [["Anna K.", "Ben", "Familie"], ["Anna K."]]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Orte und Wetter (nachgebildete Dienste)", async () => {
  const data = { version: 1, lastBackup: null, answers: {}, questions: [yesNo("b", "Bouldern?")], wloc: { [daysAgo(1)]: [53.58, 9.71] } };
  const { page, ctx, errors } = await open({ data, settings: { places: { on: true, last: 0 } }, geo: { latitude: 53.58, longitude: 9.71 } });
  await page.waitForTimeout(800);
  assert.match(await page.locator(".placeline").innerText(), /Wedel[\s\S]*12 °C/);
  const w = await page.evaluate(() => state.weather);
  assert.ok(w[await page.evaluate(() => addDays(todayIso(), -1))], "Wetter für gestern geladen");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Grafik erstellen liefert ein PNG", async () => {
  const { page, ctx, errors } = await open({ data: yearData() });
  await page.click('[data-tab="data"]');
  await page.click("#exportopen");
  await page.locator(".xrow", { hasText: "Schritte" }).locator("input").check();
  await page.click("#xgo");
  await page.waitForSelector(".xprev img", { timeout: 30000 });
  const src = await page.locator(".xprev img").first().getAttribute("src");
  assert.match(src, /^data:image\/png;base64,/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Ziel-Erinnerung: Plan, ab wann ein Ziel kippt", async () => {
  const { page, ctx } = await open({ data: yearData() });
  // Monatsziel „mindestens 2×“, bisher 0×, heute noch offen → kippt am vorletzten Tag des Monats (oder heute)
  const r = await page.evaluate(() => {
    G().items = [{ id: "m", qid: "b", kind: "count", key: "Ja", op: "min", n: 2, period: "month", repeat: true }];
    const per = periodOf("month", todayIso());
    for (let d = per.start; d <= todayIso(); d = addDays(d, 1)) if (state.answers[d]) state.answers[d].b = "Nein";
    delete (state.answers[todayIso()] || {}).b;
    const last = addDays(per.end, -1);
    const possible = dayCount(todayIso(), per.end) >= 2;
    return { plan: goalAlertPlan(), expected: last < todayIso() ? todayIso() : last, possible };
  });
  if (!r.possible) { assert.equal(r.plan.length, 0); await ctx.close(); return; } // letzter Monatstag: schon verloren
  assert.equal(r.plan.length, 1);
  assert.equal(r.plan[0].d, r.expected);
  assert.match(r.plan[0].t, /Heute bouldern: ab heute an jedem Tag nötig \(noch 2× bis/);
  await ctx.close();
});

test("Ziel „nie“: eigene Darstellung, keine Warnung, kein Überlaufen", async () => {
  const data = yearData();
  data.questions.push(yesNo("al", "Hast du heute Alkohol getrunken oder Süßigkeiten gegessen?"));
  data.goals = { period: "month", seen: { week: "x", month: "x" }, seenFails: [], items: [
    { id: "n", qid: "al", kind: "count", key: "Ja", op: "max", n: 0, period: "month", repeat: true },
    { id: "w", qid: "b", kind: "count", key: "Ja", op: "min", n: 2, period: "week", repeat: true }] };
  const { page, ctx, errors } = await open({ data });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const d = document.querySelector("#sheet"); if (d.open) d.close(); });
  await page.click('[data-tab="analysis"]');
  const txt = await page.locator(".goals").innerText();
  assert.doesNotMatch(txt, /im Monat|noch \d+ Tage|an \d+ Tagen eingehalten|auf Kurs ·/); // schlank: nur Name, Status, Balken, Stand
  assert.match(txt, /Bisher eingehalten/);
  assert.equal(await page.evaluate(() => goalAlertPlan().filter((x) => x.id.startsWith("n|")).length), 0);
  // nichts ragt über den rechten Rand des Feldes hinaus
  const over = await page.evaluate(() => { const p = document.querySelector(".goals").getBoundingClientRect(); return [...document.querySelectorAll(".goals .gst, .goals .gbar")].some((el) => el.getBoundingClientRect().right > p.right - 8); });
  assert.equal(over, false);
  await page.locator(".goals").screenshot({ path: path.join(shots, "ziele-nie.png") });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Themen: Zuordnung, Überschriften, Filter und Themen-Trends", async () => {
  const answers = {};
  let r = 3; const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  for (let i = 90; i >= 0; i--) {
    const recent = i <= 6;
    // früher ca. 2× Sport pro Woche, in den letzten 7 Tagen fast täglich
    answers[daysAgo(i)] = { b: rnd() < (recent ? 0.6 : 0.15) ? "Ja" : "Nein", p: rnd() < (recent ? 0.5 : 0.1) ? "Ja" : "Nein", v: rnd() < 0.05 ? "Ja" : "Nein", al: "Nein", s: 7 + rnd() };
  }
  const data = { version: 1, lastBackup: null, answers, questions: [
    yesNo("al", "Alkohol getrunken?"), { ...yesNo("b", "Heute bouldern?"), sport: true }, { ...yesNo("p", "Heute paddeln?"), sport: true }, yesNo("v", "Volleyball gespielt?"),
    health("s", "Schlafdauer", "schlaf", "duration")] };
  const { page, ctx, errors } = await open({ data });
  // Vorschläge: Sport-Fragen in Sport, Alkohol in Ernährung, Schlaf in Gesundheit; Sortierung nach Thema
  assert.deepEqual(await page.evaluate(() => ordered().map((o) => `${o.q.id}:${themeOf(o.q)}`)), ["b:sport", "p:sport", "v:sport", "s:health", "al:food"]);
  assert.match(await page.locator("#view").innerText(), /🏃 Sport[\s\S]*Heute bouldern\?[\s\S]*🍽️ Ernährung[\s\S]*Alkohol/);
  await page.click('[data-tab="analysis"]');
  await page.selectOption("[data-range-sel]", "365");
  if (await page.locator("#tmore").count()) await page.click("#tmore");
  const tr = await page.locator(".trends").innerText();
  assert.match(tr, /Diese Woche \d+ Sporttag/); // nur Fragen mit Haken „Ist eine Sportart“
  assert.doesNotMatch(tr, /Gesundheit|Ernährung|egal welche Frage/); // keine Trends über andere Themen
  // Sport-Kachel: Sporttage im Zeitraum, je Sportart
  const sp = await page.locator(".sport").innerText();
  assert.match(sp, /Sport[\s\S]*\d+\s*Sporttage[\s\S]*bouldern[\s\S]*paddeln/i);
  assert.doesNotMatch(sp, /Volleyball/); // ohne Haken zählt es nicht
  await page.click('[data-th="sport"]');
  assert.equal(await page.locator(".acard[data-qid]").count(), 3);
  // Haken „Ist eine Sportart“ im Editor (nur bei Sport-Ja/Nein-Fragen)
  await page.evaluate(() => openEditor("v"));
  await page.check("#qsport"); await page.click("#savebtn");
  assert.equal(await page.evaluate(() => qById("v").sport), true);
  await page.evaluate(() => openEditor("al"));
  assert.equal(await page.locator("#qsport").count(), 0);
  await page.click("#cancel");
  // Thema im Editor ändern
  await page.click('[data-tab="data"]'); await page.click("#qmore"); await page.click('[data-edit="al"]');
  await page.click('[data-theme="mood"]'); await page.click("#savebtn");
  assert.equal(await page.evaluate(() => qById("al").theme), "mood");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Neue Frage aus Vorlage „Arbeit“ mit Vertrag und effektivem Stundenlohn", async () => {
  const data = { version: 1, lastBackup: null, answers: {}, questions: [] };
  const { page, ctx, errors } = await open({ data });
  await page.click("#firstq");
  await page.waitForSelector('[data-tpl="work"]');
  await page.click('[data-tpl="work"]');
  // Editor der Arbeitsfrage ist offen, Vertrag eintragen
  await page.waitForSelector("#ch");
  await page.fill("#ch", "20"); await page.fill("#cw", "15");
  await page.click('[data-cper="week"]');
  await page.click("#savebtn");
  const qs = await page.evaluate(() => state.questions.map((q) => ({ t: q.text, type: q.type, f: q.format, c: q.cond, k: q.contract, th: q.theme })));
  assert.equal(qs.length, 2);
  assert.equal(qs[0].t, "Hast du heute gearbeitet?");
  assert.deepEqual(qs[0].k, { h: 20, wage: 15, per: "week" });
  assert.equal(qs[0].th, "work");
  assert.equal(qs[1].f, "duration");
  // 7 Tage: 5× gearbeitet je 5 h = 25 h; Vertrag 20 h → Lohn 300 €, effektiv 12,00 €
  await page.evaluate(() => {
    const [p, c] = state.questions;
    for (let i = 0; i < 7; i++) { const d = addDays(todayIso(), -i); state.answers[d] = i < 5 ? { [p.id]: "Ja", [c.id]: 5 } : { [p.id]: "Nein" }; }
    save();
  });
  await page.click('[data-tab="analysis"]');
  await page.click('[data-range="7"]');
  const txt = await page.locator(".contract").innerText();
  assert.match(txt, /Effektiver Stundenlohn\s*12,00 €/);
  assert.match(txt, /5 h 00 min mehr/);
  assert.match(txt, /Lohn im Zeitraum 300,00 €/);
  await page.locator(".contract").screenshot({ path: path.join(shots, "vertrag.png") });
  assert.deepEqual(errors, []);
  await ctx.close();
});

// chess.com nachbilden: zwei Monatsarchive mit Partien relativ zu heute
function chessMock(cors) {
  const now = new Date(); now.setHours(12, 0, 0, 0);
  const at = (daysBack, h) => { const d = new Date(now); d.setDate(d.getDate() - daysBack); d.setHours(h, 0, 0, 0); return Math.floor(d / 1000); };
  const me = (rating, result) => ({ username: "TestUser", rating, result });
  const op = (result) => ({ username: "Gegner", rating: 1300, result });
  const pgn = (s, e, eco) => `[Event "Live Chess"]\n[ECOUrl "https://www.chess.com/openings/${eco}"]\n[StartTime "${s}"]\n[EndTime "${e}"]\n\n1. e4 e5`;
  const games = [
    { end_time: at(10, 12), time_class: "blitz", time_control: "180+2", rules: "chess", rated: true, white: me(1100, "agreed"), black: op("agreed"), pgn: pgn("11:00:00", "11:05:00", "Sicilian-Defense-Open-2...Nc6") },
    { end_time: at(1, 10), time_class: "rapid", time_control: "600", rules: "chess", rated: true, url: "https://www.chess.com/game/live/1", white: me(1210, "win"), black: op("checkmated"), accuracies: { white: 80, black: 60 }, pgn: pgn("10:00:00", "10:15:00", "Italian-Game-Two-Knights-Defense-4.d3") },
    { end_time: at(1, 11), time_class: "rapid", time_control: "600", rules: "chess", rated: true, black: me(1200, "resigned"), white: op("win"), pgn: pgn("11:00:00", "11:20:00", "Sicilian-Defense-Open-2...Nc6") },
    { end_time: at(0, 9), time_class: "rapid", time_control: "600", rules: "chess", rated: true, white: me(1220, "win"), black: op("timeout"), pgn: pgn("08:50:00", "09:00:00", "Italian-Game") }
  ];
  const ym = (t) => { const d = new Date(t * 1000); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  const months = {};
  games.forEach((g) => (months[ym(g.end_time)] ||= []).push(g));
  const base = "https://api.chess.com/pub/player/testuser";
  const calls = [];
  const handler = (r) => {
    const u = new URL(r.request().url());
    calls.push(u.pathname + u.search);
    let body = null;
    if (u.pathname.endsWith("/stats")) body = { chess_rapid: { last: { rating: 1220 }, best: { rating: 1250, date: at(200, 12) }, record: { win: 5, loss: 3, draw: 1 } }, tactics: { highest: { rating: 1800, date: at(50, 12) } }, puzzle_rush: { best: { score: 21 } } };
    else if (u.pathname.endsWith("/archives")) body = { archives: Object.keys(months).sort().map((m) => `${base}/games/${m}`) };
    else { const m = u.pathname.match(/games\/(\d{4}\/\d{2})$/); if (m) body = { games: months[m[1]] || [] }; }
    if (!body) return r.fulfill({ status: 404, body: "" });
    const cb = u.searchParams.get("callback");
    if (cb) return r.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(body)})` });
    return r.fulfill({ status: 200, contentType: "application/json", headers: cors ? { "access-control-allow-origin": "*" } : {}, body: JSON.stringify(body) });
  };
  return { handler, calls };
}

for (const cors of [true, false]) test(`chess.com: Einschalten lädt alles, Werte in Tag und Analyse (${cors ? "direkt" : "über JSONP"})`, async () => {
  const data = { version: 1, lastBackup: null, answers: {}, questions: [yesNo("b", "Heute bouldern?")] };
  const { page, ctx, errors } = await open({ data });
  const mock = chessMock(cors);
  await page.route(/api\.chess\.com/, mock.handler);
  await page.click('[data-tab="data"]');
  await page.fill("#chessuser", "TestUser");
  await page.locator("#chessuser").dispatchEvent("change");
  await page.click("#chesson");
  await page.waitForFunction(() => /Verbunden/.test(document.querySelector("#chessmsg")?.textContent || ""), null, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const y = addDays(todayIso(), -1);
    const byKey = (k) => state.questions.find((q) => q.chessKey === k);
    const v = (k, d) => (state.answers[d] || {})[byKey(k)?.id];
    return { games: v("games", y), time: v("time", y), score: v("score", y), acc: v("acc", y), rapid: v("elo:rapid", y), rapidToday: v("elo:rapid", todayIso()), blitz: v("elo:blitz", addDays(todayIso(), -10)), src: state.questions.filter((q) => q.source === "chess").length, ask: askQuestions(todayIso()).length, user: state.chess.user };
  });
  assert.equal(r.games, 2); assert.ok(Math.abs(r.time - 35 / 60) < 0.01); assert.equal(r.score, 50); assert.equal(r.acc, 80);
  assert.equal(r.rapid, 1200); assert.equal(r.rapidToday, 1220); assert.equal(r.blitz, 1100);
  assert.equal(r.src, 6); // Partien, Spielzeit, Punktequote, Genauigkeit, Elo Rapid, Elo Blitz
  assert.equal(r.ask, 1); // Schach wird nicht abgefragt
  assert.equal(r.user, "testuser");
  // Tag zeigt die Werte von gestern
  await page.click('[data-tab="day"]');
  await page.evaluate(() => { current = addDays(todayIso(), -1); renderDay(); });
  const day = await page.locator("#view").innerText();
  assert.match(day, /chess\.com[\s\S]*Elo Rapid[\s\S]*1200/);
  // Analyse: Überblick
  await page.click('[data-tab="analysis"]');
  await page.click('[data-range="30"]');
  const txt = await page.locator(".chess").innerText();
  assert.match(txt, /^Schach\s*4\s*Partien an 3 von 30 Tagen/m);
  assert.match(txt, /2 Siege \(50 %\) · 1 Remis \(25 %\) · 1 Niederlage \(25 %\) · Punktequote 62,5 %/);
  assert.match(txt, /Rapid\s*1220\s*\+20\s*Bestwert 1250/);
  assert.doesNotMatch(txt, /Eröffnung/);
  assert.match(txt, /Dauer je Partie\s*12 min 30 s/);
  assert.match(txt, /Züge je Partie\s*1\b/);
  assert.match(txt, /Genauigkeit\s*80 %\s*1 analysiert/);
  assert.match(txt, /Bedenkzeit: 10 min 3× · 3 min \+ 2 s 1×/);
  assert.match(txt, /Alle 4 Partien im Zeitraum/);
  assert.match(txt, /Siege: Matt 1×, Zeit 1×|Siege: Zeit 1×, Matt 1×/);
  assert.match(txt, /Niederlagen: Aufgabe 1×/);
  assert.match(txt, /Taktik-Bestwert 1800 · Puzzle-Rush-Rekord 21/);
  assert.equal(await page.locator('.acard[data-qid]').filter({ hasText: "Schach:" }).count(), 0); // keine einzelnen Schach-Karten mehr
  if (cors) await page.locator(".chess").screenshot({ path: path.join(shots, "schach.png") });
  // Elo und Genauigkeit im Verlauf, abschaltbar über das Zahnrad
  assert.equal(await page.locator(".chess svg.cline").count(), 2); // Elo des gewählten Modus, Genauigkeit
  assert.match(txt, /Elo Rapid am Ende des Zeitraums[\s\S]*Elo im Verlauf/);
  assert.doesNotMatch(txt, /Daten von chess\.com/);
  // Zahnrad der Kachel: Elo für Blitz
  await page.click("#chessgear");
  await page.click('#sheet [data-cls="blitz"]');
  await page.click("#cvdone");
  assert.match(await page.locator(".chess").innerText(), /Elo Blitz am Ende des Zeitraums\s*Blitz\s*1100\s*±0/);
  assert.match(await page.locator(".chess").innerText(), /32|4\s*Partien/); // Partien zählen weiter alle Modi
  await page.evaluate(() => { prefs.chessCls = "rapid"; savePrefs(); renderAnalysis(); });
  assert.match(txt, /Genauigkeit im Verlauf/);
  await page.locator(".chess svg.cline").first().evaluate((el) => el.scrollIntoView({ block: "center" })); // nicht unter der Leiste unten
  const box = await page.locator(".chess svg.cline").first().boundingBox();
  await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
  assert.match(await page.locator(".chess .ccap").first().innerText(), /: 1220$/);
  await page.click("#asettings");
  await page.locator('#sheet [data-f="chessElo"]').uncheck();
  await page.evaluate(() => document.querySelector("#sheet").close());
  assert.equal(await page.locator(".chess svg.cline").count(), 1);
  await page.evaluate(() => { prefs.chessElo = true; savePrefs(); renderAnalysis(); });
  // Partienliste: neueste zuerst, Details je Partie
  await page.click("#chessgames");
  assert.equal(await page.locator("#sheet .cgame").count(), 4);
  await page.locator("#sheet .cgame summary").first().click();
  const g1 = await page.locator("#sheet .cgame").first().innerText();
  assert.match(g1, /Gegner \(1300\)/);
  assert.match(g1, /Sieg durch Zeit/);
  assert.match(g1, /Bedenkzeit\s*10 min \(Rapid\)/);
  assert.match(g1, /Deine Elo danach\s*1220 \(\+20\)/);
  assert.match(g1, /Dauer 10 min 00 s/);
  if (cors) await page.locator("#sheet .sheet-inner").screenshot({ path: path.join(shots, "schach-partien.png") });
  await page.click("#cgclose");
  // zweites Öffnen am selben Tag ruft nichts erneut ab
  const n = mock.calls.length;
  await page.evaluate(() => syncChess(false));
  assert.equal(mock.calls.length, n);
  // tägliche Aktualisierung lädt nur nicht abgeschlossene Monate
  await page.evaluate(() => { settings.chess.lastDay = ""; return syncChess(false); });
  const monthCalls = mock.calls.slice(n).filter((c) => /games\/\d{4}\/\d{2}/.test(c));
  assert.ok(monthCalls.length >= 1 && monthCalls.length <= 2);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Zeitraum: 1 Tag, Mehr-Auswahl und eigener Zeitraum (Analyse und Grafik)", async () => {
  const { page, ctx, errors } = await open({ data: yearData() });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const d = document.querySelector("#sheet"); if (d.open) d.close(); });
  await page.click('[data-tab="analysis"]');
  // sichtbar: 1 Tag, 7 Tage, 30 Tage, Mehr
  assert.deepEqual(await page.locator(".rseg > button, .rseg > label > span").allInnerTexts(), ["1 Tag", "7 Tage", "30 Tage", "Mehr ▾"]);
  await page.click('[data-range="1"]');
  assert.equal(await page.evaluate(() => rangeDays().length), 1);
  assert.match(await page.locator("#view").innerText(), /Erfasst · |Noch nicht erfasst · /);
  await page.selectOption("[data-range-sel]", "ytd");
  assert.match(await page.locator(".rmore").innerText(), /Seit 1\.1\. ▾/);
  await page.selectOption("[data-range-sel]", "custom");
  await page.fill("[data-range-from]", await page.evaluate(() => addDays(todayIso(), -9)));
  await page.locator("[data-range-from]").dispatchEvent("change");
  await page.fill("[data-range-to]", await page.evaluate(() => addDays(todayIso(), -5)));
  await page.locator("[data-range-to]").dispatchEvent("change");
  assert.equal(await page.evaluate(() => rangeDays().length), 5);
  assert.match(await page.locator("#view").innerText(), /von 5 Tagen erfasst/);
  await page.locator(".rseg").screenshot({ path: path.join(shots, "zeitraum.png") });
  // Grafik erstellen übernimmt den Zeitraum und hat dieselbe Auswahl
  await page.click('[data-tab="data"]'); await page.click("#exportopen");
  assert.equal(await page.locator("#sheet [data-xr-from]").count(), 1);
  await page.click('#sheet [data-xr="7"]');
  assert.equal(await page.locator("#sheet [data-xr-from]").count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Vorlage „Gekocht“: Rezepte aus Notion, Umbenennen, Analyse zeigt was wie oft", async () => {
  const data = { version: 1, lastBackup: null, answers: {}, questions: [yesNo("b", "Heute bouldern?")] };
  const { page, ctx, errors } = await open({ data, settings: { token: "test" } });
  let recipes = [
    { id: "r-brot", title: "Brot" }, { id: "r-ideen", title: "Rezeptideen" }, { id: "r-linsen", title: "Linseneintopf" },
    { id: "r-pesto", title: "Pesto" }, { id: "r-ruehr", title: "Rührteig " }
  ];
  await page.route(/workers\.dev\/notion\/recipes/, (r) => json(r, { recipes }));
  await page.click('[data-tab="data"]');
  await page.click("#newq");
  await page.click('[data-tpl="recipes"]');
  await page.waitForSelector("#savebtn");
  await page.click("#savebtn");
  const q = await page.evaluate(() => state.questions.find((x) => x.notion));
  assert.deepEqual(q.options, ["Brot", "Linseneintopf", "Pesto", "Rührteig", "Etwas anderes gekocht", "Nichts gekocht"]);
  assert.equal(q.multi, true); assert.equal(q.theme, "food");
  await page.evaluate((id) => {
    const t = todayIso();
    [["Brot", "Linseneintopf"], ["Linseneintopf"], ["Linseneintopf", "Pesto"], ["Brot"]].forEach((v, i) => { state.answers[addDays(t, -i)] = { [id]: v }; });
    save();
  }, q.id);
  // Umbenennen in Notion: gleiche Seite, neuer Titel → auch alte Antworten
  recipes = recipes.map((r) => (r.id === "r-brot" ? { ...r, title: "Sauerteigbrot" } : r));
  await page.evaluate(() => syncRecipes(true));
  const after = await page.evaluate((id) => ({ opts: qById(id).options, a: state.answers[todayIso()][id] }), q.id);
  assert.equal(after.opts.includes("Brot"), false);
  assert.ok(after.opts.includes("Sauerteigbrot"));
  assert.deepEqual(after.a, ["Sauerteigbrot", "Linseneintopf"]);
  // Analyse: nur Gekochtes, am häufigsten zuerst, als Anzahl
  await page.click('[data-tab="analysis"]');
  await page.click('[data-range="7"]');
  const card = await page.locator(`.acard[data-qid="${q.id}"]`).innerText();
  assert.match(card, /Linseneintopf\s*3×[\s\S]*Sauerteigbrot\s*2×[\s\S]*Pesto\s*1×/);
  assert.doesNotMatch(card, /Rührteig|Nichts gekocht/);
  // Einstellungen zeigen den Stand
  await page.click('[data-tab="data"]');
  assert.match(await page.locator("#view").innerText(), /Schnittstelle Notion[\s\S]*Verbunden\. 4 Rezepte/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Abfrage fortsetzen springt nur zu offenen Fragen (inkl. neuer Folgefragen)", async () => {
  const t = iso(new Date());
  const qs = ["a", "b", "c", "d"].map((x) => yesNo(x, `Frage ${x.toUpperCase()}?`));
  qs.push({ ...yesNo("b2", "Folge zu B?"), cond: { qid: "b", values: ["Ja"] } });
  const data = { version: 1, lastBackup: null, answers: { [t]: { a: "Ja", c: "Nein" } }, questions: qs };
  const { page, ctx, errors } = await open({ data });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const d = document.querySelector("#sheet"); if (d.open) d.close(); });
  assert.match(await page.locator("#startquiz").innerText(), /Abfrage fortsetzen/);
  await page.click("#startquiz");
  const title = () => page.locator(".quiz-title").innerText();
  assert.equal(await title(), "Frage B?");
  assert.match(await page.locator(".quiz-top").innerText(), /noch 2 offen/);
  await page.locator(".quiz-q .chip", { hasText: "Ja" }).click();
  await page.waitForTimeout(400);
  assert.equal(await title(), "Folge zu B?"); // neue Folgefrage kommt dran
  await page.locator(".quiz-q .chip", { hasText: "Nein" }).click();
  await page.waitForTimeout(400);
  assert.equal(await title(), "Frage D?"); // C war schon beantwortet
  await page.click("#qback");
  assert.equal(await title(), "Folge zu B?");
  await page.click("#qnext");
  await page.locator(".quiz-q .chip", { hasText: "Ja" }).click();
  await page.waitForTimeout(400);
  assert.match(await page.locator(".quiz-done").innerText(), /Fertig/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Desktop-Ansicht am Mac (Maus/Trackpad), iPhone unverändert", async () => {
  // iPhone: Leiste unten
  const m = await open({ data: yearData() });
  const mb = await m.page.locator(".tabbar").boundingBox();
  assert.ok(mb.y > 500 && mb.width > 300);
  await m.page.click('[data-tab="data"]');
  assert.equal(await m.page.locator(".tabbar .subnav").isVisible(), false);
  assert.ok(await m.page.locator("#view > section.panel").evaluateAll((els) => els.every((e) => e.offsetParent)));
  await m.ctx.close();
  // Mac-Fenster: Leiste links, Analyse in zwei Spalten
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/workers\.dev|bigdatacloud|open-meteo|nominatim/, (r) => json(r, {}));
  await page.addInitScript((d) => { if (!sessionStorage.getItem("s")) { sessionStorage.setItem("s", "1"); localStorage.setItem("taeglich.v1", JSON.stringify(d)); } }, yearData());
  await page.goto(BASE);
  const tb = await page.locator(".tabbar").boundingBox();
  assert.ok(tb.x === 0 && tb.width < 300 && tb.height > 800);
  await page.evaluate(() => { const d = document.querySelector("#sheet"); if (d.open) d.close(); });
  await page.click('[data-tab="analysis"]');
  const xs = await page.locator("main > .acard[data-qid]").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().x)))]);
  assert.ok(xs.length >= 2); // Kacheln fließen in mehrere Spalten
  // Einstellungen: Unterpunkte in der Seitenleiste, immer nur ein Bereich sichtbar
  await page.click('[data-tab="data"]');
  assert.ok(await page.locator(".tabbar .subnav button").count() >= 10);
  const visible = () => page.locator("#view > section.panel").evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.querySelector("h2").textContent.trim()));
  assert.deepEqual(await visible(), ["Fragen"]);
  await page.click('.subnav [data-sec="sicherung"]');
  assert.deepEqual(await visible(), ["Sicherung"]);
  await page.click('[data-tab="analysis"]');
  assert.equal(await page.locator(".tabbar .subnav").isVisible(), false);
  // auch im schmalen Mac-Fenster bleibt die Seitenleiste links
  await page.setViewportSize({ width: 800, height: 900 });
  const tb2 = await page.locator(".tabbar").boundingBox();
  assert.ok(tb2.x === 0 && tb2.height > 800);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Vertiefungsgespräche: anlegen, ausfüllen, Verlauf mit „Letztes Mal“, Fragebogen bearbeiten", async () => {
  const data = { version: 1, lastBackup: null, answers: {}, questions: [], friends: { stichtag: daysAgo(30), labels: {}, history: [], list: [{ id: "a", name: "Anna", cat: "best", tags: {} }, { id: "b", name: "Ben", cat: "good", tags: {} }] } };
  const { page, ctx, errors } = await open({ data });
  await page.click('[data-tab="friends"]');
  assert.match(await page.locator(".talks").innerText(), /Vertiefungsgespräche/);
  // erstes Gespräch (vor 3 Monaten)
  await page.click("#tnew");
  await page.selectOption("#tnf", "a");
  await page.fill("#tndate", daysAgo(90));
  await page.click("#tngo");
  assert.equal(await page.locator("#sheet .tpart").count(), 8);
  assert.match(await page.locator("#sheet").innerText(), /Lebenssituationen[\s\S]*Jobverlust/);
  await page.locator("#sheet .tta").first().fill("Der Wanderurlaub");
  await page.locator("#sheet .tq").nth(3).locator(".chip", { hasText: "gleichbleibend" }).click();
  await page.locator("#sheet .tq").nth(6).locator(".chip", { hasText: /^7$/ }).click();
  await page.click("#tdone");
  let st = await page.evaluate(() => state.talks[0]);
  assert.equal(st.done, true);
  const q0 = st.form.parts[0].qs[0].id, q3 = st.form.parts[0].qs[3].id, q6 = st.form.parts[1].qs[2].id;
  assert.equal(st.answers[q0].t, "Der Wanderurlaub");
  assert.equal(st.answers[q3].v, "gleichbleibend");
  assert.equal(st.answers[q6].v, 7);
  assert.match(await page.locator(".talks").innerText(), /Anna[\s\S]*3 von \d+ Fragen/);
  // zweites Gespräch: zeigt, was letztes Mal geantwortet wurde
  await page.click("#tnew");
  await page.selectOption("#tnf", "a");
  await page.click("#tngo");
  assert.match(await page.locator("#sheet .tq").first().innerText(), /Letztes Mal \(\d\d\.\d\d\.\d{4}\): Der Wanderurlaub/);
  assert.match(await page.locator("#sheet .tq").nth(6).innerText(), /Letztes Mal.*7 von 10/);
  await page.locator("#sheet .sheet-inner").screenshot({ path: path.join(shots, "gespraech.png") });
  await page.click("#tclose");
  assert.match(await page.locator(".talks").innerText(), /Entwurf/i);
  // Fragebogen bearbeiten: gilt nur für neue Gespräche
  await page.click("#tform");
  assert.equal(await page.locator("#sheet .tftitle, #sheet [data-pt]").count(), 0); // Teile sind fest
  await page.click('[data-edit="0.0"]');
  await page.fill("#tfqt", "Was war unser schönster Moment?");
  await page.click("#tfok");
  await page.click('[data-qadd="0"]');
  await page.fill("#tfqt", "Neue Frage?");
  await page.click('[data-ty="choice"]');
  await page.click("#tfoadd");
  await page.fill('[data-o="2"]', "Weiß nicht");
  await page.click("#tfok");
  // per Gedrückthalten: erste Frage hinter die zweite schieben
  const r0 = await page.locator('[data-ti="0.0"]').boundingBox(), r1 = await page.locator('[data-ti="0.1"]').boundingBox();
  await page.mouse.move(r0.x + 40, r0.y + r0.height / 2); await page.mouse.down(); await page.waitForTimeout(800);
  for (let i = 1; i <= 12; i++) { await page.mouse.move(r0.x + 40, r0.y + r0.height / 2 + (r1.y + r1.height + 4 - r0.y - r0.height / 2) * i / 12); await page.waitForTimeout(15); }
  await page.mouse.up();
  await page.waitForTimeout(100);
  await page.locator("#sheet .sheet-inner").screenshot({ path: path.join(shots, "fragebogen.png") });
  await page.click("#tfsave");
  const f = await page.evaluate(() => ({ t0: state.talkForm.parts[0].qs[0].text, n: state.talkForm.parts[0].qs.length, o: state.talkForm.parts[0].qs[4].options, old: state.talks[0].form.parts[0].qs[0].text }));
  assert.deepEqual(f, { t0: "Wann habe ich dich (vielleicht unbewusst) besonders unterstützt oder dir gutgetan?", n: 5, o: ["Ja", "Nein", "Weiß nicht"], old: "Was waren für dich die schönsten gemeinsamen Momente in den letzten sechs Monaten?" });
  assert.equal(await page.evaluate(() => state.talkForm.parts[0].qs[1].text), "Was war unser schönster Moment?");
  // Gespräch löschen
  await page.locator('[data-talk]').first().click();
  await page.click("#tdel");
  assert.equal(await page.evaluate(() => state.talks.length), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Analyse: lange auf eine Karte drücken öffnet ihre Darstellung", async () => {
  const { page, ctx, errors } = await open({ data: yearData() });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const d = document.querySelector("#sheet"); if (d.open) d.close(); });
  await page.click('[data-tab="analysis"]');
  const card = page.locator('.acard[data-qid="b"]');
  await card.scrollIntoViewIfNeeded();
  const bb = await card.boundingBox();
  await page.mouse.move(bb.x + 40, bb.y + 20); await page.mouse.down(); await page.waitForTimeout(750); await page.mouse.up();
  await page.waitForSelector("#sheet[open]");
  assert.equal(await page.locator("#sheet .sq").count(), 1); // nur diese Frage, ohne Trends/Ziele
  assert.match(await page.locator("#sheet").innerText(), /Heute bouldern/);
  const before = await page.locator('.acard[data-qid="b"] .vcols').count();
  await page.locator('#sheet [data-q="b"][data-f="trend"]').click();
  assert.notEqual(await page.locator('.acard[data-qid="b"] .vcols').count(), before);
  await page.click("#adone");
  // Zahnrad zeigt weiterhin alles
  await page.click("#asettings");
  assert.ok(await page.locator("#sheet .sq").count() > 3);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Trends: ruhig nach Art gruppiert, höchstens 5, Arten über das Zahnrad abschaltbar", async () => {
  const { page, ctx, errors } = await open({ data: yearData() });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const d = document.querySelector("#sheet"); if (d.open) d.close(); });
  await page.click('[data-tab="analysis"]');
  await page.selectOption("[data-range-sel]", "365");
  assert.ok(await page.locator(".trends .trow").count() <= 5);
  assert.equal(await page.locator(".trends .tmark").count(), 0); // keine bunten Quadrate mehr
  const heads = await page.locator(".trends .tsub").allInnerTexts();
  assert.ok(heads.length >= 2);
  await page.click("#trendgear");
  await page.locator('#sheet [data-tk="season"]').uncheck();
  await page.locator('#sheet [data-tk="rel"]').uncheck();
  await page.click("#tsdone");
  const heads2 = (await page.locator(".trends .tsub").allInnerTexts()).join(" ");
  assert.doesNotMatch(heads2, /JAHRESZEITEN|ZUSAMMENHÄNGE|Jahreszeiten|Zusammenhänge/i);
  await page.locator(".trends").screenshot({ path: path.join(shots, "trends.png") });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Fragen per Gedrückthalten verschieben", async () => {
  const data = { version: 1, lastBackup: null, answers: {}, questions: ["A", "B", "C"].map((x) => yesNo(x.toLowerCase(), x + "?")) };
  const { page, ctx, errors } = await open({ data });
  await page.click('[data-tab="data"]');
  const a = await page.locator('[data-qrow="a"] .qmain').boundingBox(), c = await page.locator('[data-qrow="c"] .qmain').boundingBox();
  await page.mouse.move(a.x + 30, a.y + a.height / 2); await page.mouse.down(); await page.waitForTimeout(600);
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + 30, a.y + a.height / 2 + (c.y + c.height * 0.8 - a.y - a.height / 2) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => state.questions.map((q) => q.id)), ["b", "c", "a"]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Health-Werte per Text übernehmen", async () => {
  const data = { version: 1, lastBackup: null, answers: {}, questions: [health("st", "Schritte", "schritte")] };
  const { page, ctx } = await open({ data });
  await page.evaluate(() => applyHealthText("mosaik;schritte=9500;datum=2026-10-01", true));
  assert.equal(await page.evaluate(() => state.answers["2026-10-01"].st), 9500);
  await ctx.close();
});

test("Sicherung enthält alles und lässt sich wiederherstellen", async () => {
  const data = yearData();
  data.friends = { stichtag: daysAgo(5), labels: {}, history: [], list: [{ id: "a", name: "Anna", cat: "best", tags: { fem: true } }] };
  data.goals = { period: "week", seen: {}, seenFails: [], items: [{ id: "g", qid: "b", kind: "count", key: "Ja", op: "min", n: 2, period: "week", repeat: true }] };
  data.places = { [daysAgo(1)]: [{ c: "Wedel", t: "08:00" }] };
  data.weather = { [daysAgo(1)]: { t: 14, r: 0, s: 3 } };
  const { page, ctx, errors } = await open({ data });
  // so baut die App die Sicherungsdatei
  const backup = await page.evaluate(() => { prefs.range = "365"; settings.chess.user = "TestUser"; return JSON.stringify({ ...state, prefs, chessSettings: { user: settings.chess.user, on: false } }); });
  const b = JSON.parse(backup);
  for (const k of ["questions", "answers", "friends", "goals", "places", "weather", "prefs"]) assert.ok(b[k], `Sicherung enthält ${k}`);
  // Wiederherstellen in einer leeren App
  const file = path.join(shots, "sicherung-test.json");
  fs.writeFileSync(file, backup);
  const fresh = await open();
  await fresh.page.click('[data-tab="data"]');
  await fresh.page.setInputFiles("#restorefile", file);
  await fresh.page.waitForTimeout(300);
  const r = await fresh.page.evaluate(() => [state.friends.list[0].name, state.goals.items.length, Object.keys(state.answers).length, prefs.range, "prefs" in state, settings.chess.user, "chessSettings" in state]);
  assert.deepEqual(r, ["Anna", 1, 400, "365", false, "TestUser", false]);
  assert.deepEqual([...errors, ...fresh.errors], []);
  await ctx.close(); await fresh.ctx.close();
});

test("Dunkelmodus: alle Bereiche ohne Fehler (Bilder unter tests/screens)", async () => {
  const data = yearData();
  data.friends = { stichtag: daysAgo(10), labels: {}, history: [{ date: daysAgo(100), list: [{ id: "a", name: "Anna", cat: "best", tags: {} }] }],
    list: [{ id: "a", name: "Anna", cat: "best", tags: { fem: true, rel: true } }, { id: "b", name: "Ben", cat: "good", tags: { veg: true }, isNew: true }] };
  data.goals = { period: "month", seen: { month: "x" }, seenFails: [], items: [{ id: "g", qid: "b", kind: "count", key: "Ja", op: "min", n: 30, period: "month" }] };
  data.places = { [daysAgo(1)]: [{ c: "Wedel", t: "08:00" }] };
  for (const dark of [false, true]) {
    const { page, ctx, errors } = await open({ data, dark });
    await page.waitForTimeout(900); // Ziel-Hinweis abwarten und schließen
    await page.evaluate(() => { const d = document.querySelector("#sheet"); if (d.open) d.close(); });
    const name = dark ? "dunkel" : "hell";
    await page.screenshot({ path: path.join(shots, `${name}-1-tag.png`), fullPage: true });
    for (const [t, n] of [["friends", "2-freunde"], ["analysis", "3-analyse"], ["data", "4-einstellungen"]]) {
      await page.click(`[data-tab="${t}"]`);
      await page.screenshot({ path: path.join(shots, `${name}-${n}.png`), fullPage: true });
    }
    await page.evaluate(() => openReport());
    await page.screenshot({ path: path.join(shots, `${name}-5-bericht.png`) });
    await page.evaluate(() => { document.querySelector("#sheet").close(); openGoals(); });
    await page.screenshot({ path: path.join(shots, `${name}-6-ziele.png`) });
    assert.deepEqual(errors, [], name);
    await ctx.close();
  }
});

// ---------- Ausführen ----------
let failed = 0;
for (const t of tests) {
  const t0 = Date.now();
  try { await t.fn(); console.log(`✓ ${t.name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`✗ ${t.name}\n  ${String(e && e.stack || e).split("\n").slice(0, 6).join("\n  ")}`); }
}
await browser.close();
server.close();
console.log(failed ? `\n${failed} von ${tests.length} Tests fehlgeschlagen` : `\nAlle ${tests.length} Tests bestanden`);
process.exit(failed ? 1 : 0);
