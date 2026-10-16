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
  assert.deepEqual(r.header, ["Datum", "Wochentag", "Heute bouldern?", "Laune", "Schlafdauer", "Schlafenszeit", "Schritte", "Orte"]);
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
  await page.click('[data-range="365"]');
  if (await page.locator("#tmore").count()) await page.click("#tmore");
  const txt = await page.locator(".trends").innerText();
  assert.match(txt, /Schritte: (samstags|sonntags) am meisten/);
  assert.match(txt, /Schritte: im Sommer am meisten/);
  assert.match(txt, /„Schlafdauer“ (an Tagen mit|am Tag nach) „Heute bouldern“ = Ja/);
  for (const r of ["7", "30", "ytd", "all"]) await page.click(`[data-range="${r}"]`);
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
  await page.click('[data-tab="analysis"]');
  assert.match(await page.locator(".goals").innerText(), /mindestens 2× „Ja“ pro Woche/);
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
