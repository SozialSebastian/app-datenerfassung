/* Mosaik – Wochenbericht */
"use strict";

/* ================= Wochenbericht ================= */
// Standard: sonntags die laufende Woche, sonst die letzte abgeschlossene Woche
const reportDefaultWeek = () => { const t = todayIso(); const m = mondayOf(t); return parseIso(t).getDay() === 0 ? m : addDays(m, -7); };
const kw = (s) => { // ISO-Kalenderwoche
  const d = parseIso(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const y1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - y1) / 864e5 - 3 + ((y1.getDay() + 6) % 7)) / 7);
};

// Kennzahl einer Frage für eine Woche, verglichen mit den 8 Wochen davor
function weekStat(q, mon) {
  const t = todayIso();
  const lastOk = isHealthQ(q) ? addDays(t, -1) : t;
  const daysOf = (m) => Array.from({ length: 7 }, (_, i) => addDays(m, i)).filter((d) => d <= lastOk);
  const valsOf = (m) => daysOf(m).map((d) => (state.answers[d] || {})[q.id]).filter(isAnswered);
  const now = valsOf(mon);
  const prevWeeks = Array.from({ length: 8 }, (_, i) => valsOf(addDays(mon, -7 * (i + 1)))).filter((v) => v.length);
  if (!now.length) return null;
  if (q.type === "choice") {
    const s = qset(q);
    const key = q.options.includes(s.countKey) ? s.countKey : q.options.includes("Ja") ? "Ja" : q.options[0];
    const c = now.filter((v) => has(v, key)).length;
    const prev = prevWeeks.length ? mean(prevWeeks.map((w) => w.filter((v) => has(v, key)).length)) : null;
    return { val: `${c}× „${esc(key)}“`, cmp: prev === null ? "" : `sonst Ø ${fmt1(prev)}×`, dir: prev === null ? 0 : Math.sign(Math.round((c - prev) * 10)), good: null };
  }
  const nums = now.filter((v) => typeof v === "number");
  if (!nums.length) return null;
  const m = mean(nums);
  const prevAll = prevWeeks.flat().filter((v) => typeof v === "number");
  const pm = prevAll.length ? mean(prevAll) : null;
  const f = (v) => (q.type === "scale" ? fmt1(v) : fmtNice(q, v));
  const big = pm !== null && Math.abs(m - pm) > (sd(prevAll) || 1) * 0.25;
  const dir = big ? Math.sign(m - pm) : 0, b = betterDir(q);
  return { val: `Ø ${f(m)}`, cmp: pm === null ? "" : `sonst Ø ${f(pm)}`, dir, good: dir && b ? (dir > 0) === (b === "high") : null };
}

function reportHtml(mon) {
  const t = todayIso();
  const sun = addDays(mon, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i)).filter((d) => d <= t);
  const asked = (d) => askQuestions(d);
  const tracked = days.filter((d) => asked(d).some((q) => isAnswered((state.answers[d] || {})[q.id]))).length;
  const full = days.filter((d) => asked(d).length && dayProgress(d) === 1).length;
  const running = sun >= t;
  const range = `${dm(mon)}–${dm(sun)}${sun.slice(0, 4)}`;

  // Ziele: bei Wochenzielen genau diese Woche, sonst Stand des Monats/Jahres am Wochenende
  const gs = G();
  const items = goalItems();
  let goalsHtml = "";
  if (items.length) {
    const ref = sun <= t ? sun : t;
    const ev = items.map((g) => evalGoal(g, goalPer(g, ref))).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    const running = ev.some((e) => !e.ended);
    const done = ev.filter((e) => e.status === "done").length;
    const okn = ev.filter((e) => e.status === "ok").length;
    goalsHtml = `<section class="sq">
      <div class="ghead"><h3 class="rh">Ziele</h3><span class="small muted">${running ? "Stand heute" : ""}</span></div>
      <p class="gsum small">${done} erreicht · ${okn} auf Kurs · ${ev.length - done - okn} offen oder verfehlt</p>
      <ul class="glist">${ev.map(goalRow).join("")}</ul>
    </section>`;
  }

  // Fragen der Woche
  const qs = ordered().map((o) => o.q).filter((q) => !q.archived);
  const rows = qs.map((q) => ({ q, s: weekStat(q, mon) })).filter((x) => x.s);
  // Themen gesamt (z. B. Sport = alle Sport-Fragen zusammen)
  const lastOk = todayIso();
  const thRows = themesWithYes().map((th) => {
    const tq = themeYesQs(th.k);
    const sum = (m) => { let n = 0, a = 0; for (let i = 0; i < 7; i++) { const d = addDays(m, i); if (d > lastOk) break; const h = themeHits(tq, d); if (h !== null) { a++; if (h > 0) n++; } } return a ? n : null; };
    const c = sum(mon);
    if (c === null) return null;
    const prev = Array.from({ length: 8 }, (_, i) => sum(addDays(mon, -7 * (i + 1)))).filter((x) => x !== null);
    const pm = prev.length ? mean(prev) : null;
    return { th, c, pm };
  }).filter(Boolean);
  const qHtml = rows.length || thRows.length ? `<section class="sq">
      <h3 class="rh">Deine Woche</h3>
      <ul class="wlist">${thRows.map(({ th, c, pm }) => `<li class="wtheme">
        <span class="wq">${th.i} <strong>${esc(th.l)} gesamt</strong></span>
        <span class="wv">${c}×</span>
        ${pm !== null ? `<span class="wc small muted">sonst Ø ${fmt1(pm)}×</span>` : ""}
      </li>`).join("")}${rows.map(({ q, s }) => `<li>
        <span class="wq">${esc(q.text)}</span>
        <span class="wv">${s.val}${s.dir ? `<span class="wdir ${s.dir > 0 ? "up" : "down"} ${s.good === true ? "good" : s.good === false ? "bad" : ""}" aria-label="${s.dir > 0 ? "mehr" : "weniger"} als sonst">${s.dir > 0 ? "▲" : "▼"}</span>` : ""}</span>
        ${s.cmp ? `<span class="wc small muted">${s.cmp}</span>` : ""}
      </li>`).join("")}</ul>
      <p class="small muted" style="margin:10px 0 0">„sonst“ = Schnitt der 8 Wochen davor.</p>
    </section>` : "";

  // Trends (immer der aktuelle Stand)
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(t, i - 29));
  const tr = [...themeInsights().slice(0, 2).map((x) => ({ ...x, k: "theme" })), ...streakInsights().slice(0, 3).map((x) => ({ ...x, k: "streak" })), ...numberInsights().slice(0, 3).map((x) => ({ ...x, k: "num" })), ...seasonInsights().slice(0, 1).map((x) => ({ ...x, k: "season" })), ...relationInsights(last30).slice(0, 2).map((x) => ({ ...x, k: "rel" }))];
  const trHtml = tr.length ? `<section class="sq">
      <div class="ghead"><h3 class="rh">Trends</h3><span class="small muted">aktueller Stand</span></div>
      <ul class="tlist">${tr.slice(0, 8).map((x) => `<li class="trow">${trendIcon(x, x.k)}<span>${x.html}</span></li>`).join("")}</ul>
    </section>` : "";

  return `
    <section class="sq rtop">
      <p class="rkw">KW ${kw(mon)} · ${range}${running ? " · läuft noch" : ""}</p>
      ${weekPlaces(mon).length ? `<p class="rplaces small">📍 ${weekPlaces(mon).map(([c, n]) => `${esc(c)} <span class="muted">${n} Tag${n === 1 ? "" : "e"}</span>`).join(" · ")}</p>` : ""}
      <div class="rstats">
        <div><strong>${tracked}</strong><span>von ${days.length} Tagen erfasst</span></div>
        <div><strong>${full}</strong><span>Tage vollständig</span></div>
        ${items.length ? `<div><strong>${items.map((g) => evalGoal(g, goalPer(g, sun <= t ? sun : t))).filter((e) => e.status === "done" || e.status === "ok").length}/${items.length}</strong><span>Ziele erreicht oder auf Kurs</span></div>` : ""}
      </div>
    </section>
    ${goalsHtml}${qHtml}${trHtml}
    ${!rows.length && !items.length ? `<p class="muted">In dieser Woche gibt es noch keine Antworten.</p>` : ""}`;
}

function openReport(mon) {
  if (quiz) { quiz = null; render(); }
  let week = mon || reportDefaultWeek();
  const dlg = $("#sheet");
  const first = Object.keys(state.answers).sort()[0];
  const draw = () => {
    const cur = mondayOf(todayIso());
    dlg.innerHTML = `<div class="sheet-inner report">
      <div class="sheet-head"><span></span><h2>Wochenbericht</h2><button type="button" class="linkbtn" id="rdone">Fertig</button></div>
      <div class="rnav">
        <button type="button" class="iconbtn" id="rprev" aria-label="Woche davor" ${first && week <= mondayOf(first) ? "disabled" : ""}>‹</button>
        <span>${week === cur ? "Diese Woche" : week === addDays(cur, -7) ? "Letzte Woche" : `KW ${kw(week)}`}</span>
        <button type="button" class="iconbtn" id="rnext" aria-label="Woche danach" ${week >= cur ? "disabled" : ""}>›</button>
      </div>
      ${reportHtml(week)}
    </div>`;
    $("#rdone", dlg).addEventListener("click", () => dlg.close());
    $("#rprev", dlg).addEventListener("click", () => { week = addDays(week, -7); draw(); dlg.querySelector(".sheet-inner").scrollTop = 0; });
    $("#rnext", dlg).addEventListener("click", () => { week = addDays(week, 7); draw(); dlg.querySelector(".sheet-inner").scrollTop = 0; });
  };
  draw();
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

// Kurztext für die Push-Mitteilung (nur Zusammenfassung, keine Antworten)
function reportTeaser() {
  const t = todayIso(), mon = mondayOf(t);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i)).filter((d) => d <= t);
  const tracked = days.filter((d) => askQuestions(d).some((q) => isAnswered((state.answers[d] || {})[q.id]))).length;
  let s = `${tracked} von 7 Tagen erfasst.`;
  const items = goalItems();
  if (items.length) {
    const ev = items.map((g) => evalGoal(g, goalCur(g)));
    const done = ev.filter((e) => e.status === "done").length, ok = ev.filter((e) => e.status === "ok").length;
    s += ` Ziele: ${done} erreicht${ok ? `, ${ok} auf Kurs` : ""}.`;
  }
  return s;
}
