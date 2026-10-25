/* Mosaik – Wochenbericht */
"use strict";

/* ================= Wochenbericht ================= */
// Standard: sonntags die laufende Woche, sonst die letzte abgeschlossene Woche
const reportDefaultWeek = () => { const t = todayIso(); const m = mondayOf(t); return parseIso(t).getDay() === 0 ? m : addDays(m, -7); };
// Fehlende Antworten Mo–So: [{ d, open }] – leer heißt: Woche vollständig (alle Tage komplett beantwortet)
function weekMissing(mon) {
  const t = todayIso(), out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const qs = askQuestions(d);
    const a = state.answers[d] || {};
    const open = d > t ? (qs.length || 1) : qs.filter((q) => !isAnswered(a[q.id])).length;
    if (open) out.push({ d, open, future: d > t });
  }
  return out;
}
const weekComplete = (mon) => !weekMissing(mon).length;
const kw = (s) => { // ISO-Kalenderwoche
  const d = parseIso(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const y1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - y1) / 864e5 - 3 + ((y1.getDay() + 6) % 7)) / 7);
};

// Kennzahl einer Frage für eine Woche, verglichen mit den 8 Wochen davor
function weekStat(q, mon) {
  const t = todayIso();
  const lastOk = todayOpen(q) ? addDays(t, -1) : t;
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

// Noch nicht vollständig: welche Tage fehlen (mit Sprung in die Abfrage)
function reportMissingHtml(mon) {
  const miss = weekMissing(mon);
  return `<section class="sq rmiss">
      <p class="rkw">KW ${kw(mon)} · ${dm(mon)}–${dm(addDays(mon, 6))}${addDays(mon, 6).slice(0, 4)}</p>
      <h3 class="rh">Noch nicht vollständig</h3>
      <p class="small muted" style="margin:0 0 8px">Der Bericht entsteht, sobald Montag bis Sonntag beantwortet sind. Dann kommt auch die Mitteilung.</p>
      <ul class="rmlist">${miss.map((x) => `<li><span>${WD[parseIso(x.d).getDay()]} ${dm(x.d)}</span>${x.future ? `<span class="muted small">noch nicht dran</span>` : `<button type="button" class="linkbtn" data-rquiz="${x.d}">${x.open} offen · beantworten</button>`}</li>`).join("")}</ul>
    </section>`;
}

function reportHtml(mon) {
  const sun = addDays(mon, 6), prevMon = addDays(mon, -7);
  const week = (m) => Array.from({ length: 7 }, (_, i) => addDays(m, i));
  const range = `${dm(mon)}–${dm(sun)}${sun.slice(0, 4)}`;
  const valsIn = (q, m) => week(m).map((d) => (state.answers[d] || {})[q.id]);
  const nums = (xs) => xs.filter((v) => typeof v === "number");
  const delta = (d, good, txt) => (d === null ? "" : `<small class="${!d || !good ? "" : (d > 0) === (good === "high") ? "g" : "r"}">${d > 0 ? "▲" : d < 0 ? "▼" : "±"}${txt}</small>`);
  const pctTxt = (a, b) => (b ? `${Math.round(Math.abs((a - b) / b) * 100)} %` : "");
  const numDelta = (q, a, b) => {
    if (b === null) return "";
    const d = a - b;
    if (Math.abs(d) < 1e-9) return delta(0, null, "0");
    return delta(d, betterDir(q), q.format ? ` ${devMin(d)}` : q.type === "scale" ? ` ${fmt1(Math.abs(d))}` : ` ${pctTxt(a, b)}`);
  };
  const fmtV = (q, v) => (q.type === "scale" ? fmt1(v) : q.format ? fmtQ(q, v) : fmtBig(v) + (q.unit ? " " + q.unit : ""));
  const label = (q) => { const t = shortQ(q); return esc(t.charAt(0).toUpperCase() + t.slice(1)); };
  const isYN = (q) => q.type === "choice" && !q.multi && q.options.includes("Ja") && q.options.includes("Nein") && q.options.length === 2;

  // Kacheln oben: Sporttage, Ziele, wichtigste Zahl (z. B. Schritte) – je mit Vergleich zur Vorwoche
  const tiles = [];
  if (sportQs().length) {
    const c = (m) => week(m).filter((d) => sportDay(d)).length;
    const a = c(mon), b = c(prevMon);
    tiles.push(`<div class="wrt"><b>${a}</b><span>${a === 1 ? "Sporttag" : "Sporttage"}</span>${delta(a - b, "high", ` ${Math.abs(a - b)} ggü. Vorwoche`)}</div>`);
  }
  const gitems = goalItems().filter((g) => goalIn(g, goalPer(g, sun)) || gp(g) !== "week");
  const gev = gitems.map((g) => evalGoal(g, goalPer(g, sun)));
  if (gev.length) {
    const done = gev.filter((e) => e.status === "done").length;
    tiles.push(`<div class="wrt"><b>${done}/${gev.length}</b><span>Ziele erreicht</span>${done === gev.length ? `<small class="g">alle ✓</small>` : ""}</div>`);
  }
  const numQs = ordered().map((o) => o.q).filter((q) => !q.archived && !q.cond && q.type === "number" && q.source !== "chess");
  const keyQ = numQs.find((q) => q.healthKey === "schritte") || numQs.find((q) => nums(valsIn(q, mon)).length);
  if (keyQ && nums(valsIn(keyQ, mon)).length) {
    const a = mean(nums(valsIn(keyQ, mon))), pb = nums(valsIn(keyQ, prevMon)), b = pb.length ? mean(pb) : null;
    tiles.push(`<div class="wrt"><b>${esc(fmtV(keyQ, a))}</b><span>Ø ${label(keyQ)}</span>${numDelta(keyQ, a, b)}</div>`);
  }

  // Tag für Tag: alle Hauptfragen und Health-Werte der Woche
  const qs = ordered().map((o) => o.q).filter((q) => !q.archived && !q.cond && q.source !== "chess" && !isIntolQ(q) && valsIn(q, mon).some(isAnswered));
  const WDS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const highlights = [];
  const rows = qs.map((q) => {
    const vs = valsIn(q, mon), pv = valsIn(q, prevMon);
    if (isYN(q) || q.type === "choice") {
      const key = isYN(q) ? "Ja" : null;
      if (key) {
        const c = vs.filter((v) => v === "Ja").length, cp = pv.filter((v) => v === "Ja").length, anyPrev = pv.some(isAnswered);
        const lo = betterDir(q) === "low";
        return `<div class="wrr"><span class="wq">${label(q)}</span><span class="wv">${c}× ${anyPrev ? delta(c - cp, betterDir(q) || (q.sport ? "high" : null), ` ${Math.abs(c - cp)}`) : ""}</span>
          <div class="wrd">${vs.map((v, i) => `<i class="${v === "Ja" ? (lo ? "on lo" : "on") : isAnswered(v) ? "" : "na"}">${WDS[i]}</i>`).join("")}</div></div>`;
      }
      // andere Auswahl: häufigste Antworten, je Tag die Antwort (gekürzt)
      const cnt = {};
      vs.forEach((v) => (Array.isArray(v) ? v : isAnswered(v) ? [v] : []).forEach((k) => (cnt[k] = (cnt[k] || 0) + 1)));
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${esc(k)} ${n}×`).join(" · ");
      return `<div class="wrr"><span class="wq">${label(q)}</span><span class="wv wsm">${top}</span></div>`;
    }
    const n = nums(vs);
    if (!n.length) return "";
    const a = mean(n), pn = nums(pv), b = pn.length ? mean(pn) : null;
    const dir = betterDir(q);
    // Highlight: bester Tag (nach „Was ist besser?“)
    if (dir && n.length >= 3) {
      const best = vs.reduce((bi, v, i) => (typeof v === "number" && (bi < 0 || (dir === "high" ? v > vs[bi] : v < vs[bi])) ? i : bi), -1);
      highlights.push(q.type === "scale" ? `<span>${label(q)} Ø <strong>${fmt1(a)}</strong>, am besten am <strong>${WDS[best]}</strong> (${fmt1(vs[best])})</span>`
        : `<span>${dir === "high" ? "Meiste" : "Wenigste"} ${label(q)}: <strong>${WD[parseIso(addDays(mon, best)).getDay()]} ${dm(addDays(mon, best))} · ${esc(fmtV(q, vs[best]))}</strong></span>`);
    }
    if (q.type === "scale") {
      return `<div class="wrr"><span class="wq">${label(q)}</span><span class="wv">Ø ${fmt1(a)} ${numDelta(q, a, b)}</span>
        <div class="wrd">${vs.map((v) => `<i class="${typeof v === "number" ? "num" : "na"}">${typeof v === "number" ? v : "–"}</i>`).join("")}</div></div>`;
    }
    return `<div class="wrr"><span class="wq">${label(q)}</span><span class="wv">Ø ${esc(fmtV(q, a))} ${numDelta(q, a, b)}</span>${weekSpark(vs, dir)}</div>`;
  }).join("");

  // Highlights: erreichte Ziele zuerst
  const hl = [
    ...gev.filter((e) => e.status === "done").slice(0, 2).map((e) => `<span><strong>${label(e.q)}</strong> – Ziel erreicht (${e.cur.replace(/<[^>]+>/g, "")})</span>`),
    ...highlights
  ].slice(0, 3);

  const goalsHtml = gev.length ? `<section class="sq">
      <h3 class="rh">Ziele</h3>
      ${gev.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]).map((e) => `<div class="wrg"><span>${label(e.q)} <span class="muted small">${goalText(e.g, e.q)} ${PER_WORD[gp(e.g)]}</span></span><b class="${e.status === "done" ? "g" : e.status === "fail" ? "r" : ""}">${e.status === "done" ? "✓ " : e.status === "fail" ? "✗ " : ""}${e.cur}</b></div>`).join("")}
    </section>` : "";

  const places = weekPlaces(mon);
  return `
    <section class="sq rtop">
      <p class="rkw">KW ${kw(mon)} · ${range}</p>
      <h2 class="wrh">Deine Woche</h2>
      ${places.length ? `<p class="rplaces small">📍 ${places.map(([c, n]) => `${esc(c)} <span class="muted">${n} Tag${n === 1 ? "" : "e"}</span>`).join(" · ")}</p>` : ""}
      ${tiles.length ? `<div class="wrts">${tiles.join("")}</div>` : ""}
    </section>
    ${hl.length ? `<section class="sq"><h3 class="rh">Highlights</h3><div class="wrhl">${hl.map((x) => `<div>${x}</div>`).join("")}</div></section>` : ""}
    ${rows ? `<section class="sq"><h3 class="rh">Tag für Tag</h3>${rows}<p class="small muted" style="margin:10px 0 0">▲/▼ im Vergleich zur Vorwoche.</p></section>` : `<p class="muted">In dieser Woche gibt es noch keine Antworten.</p>`}
    ${goalsHtml}`;
}
// Mini-Kurve Mo–So (Lücken bei fehlenden Tagen), Fläche in der App-Farbe
function weekSpark(vs, dir) {
  const W = 340, H = 50, P = 12;
  const pts = vs.map((v, i) => (typeof v === "number" ? { i, v } : null)).filter(Boolean);
  if (pts.length < 2) return "";
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (hi === lo) { hi += 1; lo -= 1; }
  const x = (i) => P + (i / 6) * (W - 2 * P), y = (v) => 6 + (1 - (v - lo) / (hi - lo)) * (H - 22);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(pts[pts.length - 1].i).toFixed(1)},${H - 14} L${x(pts[0].i).toFixed(1)},${H - 14} Z`;
  return `<svg class="wrs" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${area}" class="wa"/><path d="${d}" class="wl"/>${pts.map((p) => `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6" class="wp"/>`).join("")}
    ${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((t, i) => `<text x="${x(i).toFixed(1)}" y="${H - 2}" text-anchor="middle">${t}</text>`).join("")}</svg>`;
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
      ${week >= reportDefaultWeek() && !weekComplete(week) ? reportMissingHtml(week) : `${weekComplete(week) ? "" : `<p class="small muted rinc">Diese Woche ist nicht vollständig beantwortet.</p>`}${reportHtml(week)}`}
    </div>`;
    dlg.querySelectorAll("[data-rquiz]").forEach((b) => b.addEventListener("click", () => { dlg.close(); startQuiz(b.dataset.rquiz); }));
    $("#rdone", dlg).addEventListener("click", () => dlg.close());
    $("#rprev", dlg).addEventListener("click", () => { week = addDays(week, -7); draw(); dlg.querySelector(".sheet-inner").scrollTop = 0; });
    $("#rnext", dlg).addEventListener("click", () => { week = addDays(week, 7); draw(); dlg.querySelector(".sheet-inner").scrollTop = 0; });
  };
  draw();
  if (!dlg.open) dlg.showModal();
  document.activeElement?.blur();
}

// Kurztext für die Push-Mitteilung (nur Zusammenfassung, keine Antworten) zur Woche mon
function reportTeaser(mon) {
  mon = mon || reportDefaultWeek();
  const sun = addDays(mon, 6);
  let s = `KW ${kw(mon)} ist komplett.`;
  const items = goalItems();
  if (items.length) {
    const ev = items.map((g) => evalGoal(g, goalPer(g, sun)));
    const done = ev.filter((e) => e.status === "done").length, ok = ev.filter((e) => e.status === "ok").length;
    s += ` Ziele: ${done} erreicht${ok ? `, ${ok} auf Kurs` : ""}.`;
  }
  return s;
}
