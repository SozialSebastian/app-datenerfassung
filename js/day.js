/* Mosaik – Tag und Abfrage */
"use strict";

/* ================= Tag ================= */
function renderDay() {
  const view = $("#view");
  const t = todayIso();
  const d = parseIso(current);
  const isToday = current === t;
  const label = isToday ? "Heute" : current === addDays(t, -1) ? "Gestern" : WD[d.getDay()];

  const mon = mondayOf(current);
  let week = `<button class="nav" data-week="-7" aria-label="Vorherige Woche">‹</button>`;
  for (let i = 0; i < 7; i++) {
    const ds = addDays(mon, i);
    const p = dayProgress(ds);
    const dd = parseIso(ds);
    const cls = ["day", ds === t ? "is-today" : "", ds > t ? "future" : ""].join(" ");
    week += `<button class="${cls}" data-date="${ds}" ${ds === current ? 'aria-current="date"' : ""} aria-label="${WD[dd.getDay()]}, ${longDate(ds)}, ${Math.round(p * 100)} % beantwortet">
      <span>${WD_SHORT[dd.getDay()]}</span>
      <span class="hold ${p === 0 ? "empty" : ""}" style="--p:${p}"></span>
      <span class="num">${dd.getDate()}</span>
    </button>`;
  }
  week += `<button class="nav" data-week="7" aria-label="Nächste Woche">›</button>`;

  const qs = askQuestions(current);
  const a = state.answers[current] || {};
  const done = qs.filter((q) => isAnswered(a[q.id])).length;
  // nur Health-Werte zeigen, die für den Tag vorliegen
  const hq = healthQuestions().filter((q) => isAnswered(a[q.id]));
  const healthHtml = hq.length ? `<section class="q healthcard">
      <p class="q-title">Apple Health</p>
      ${hq.map((q) => `<label class="hrow" data-hq="${q.id}"><span>${esc(q.text)}</span><span class="hval"><input type="text" inputmode="${q.format ? "text" : "decimal"}" autocomplete="off" value="${esc(q.format ? fmtQ(q, a[q.id]) : fmtNum(a[q.id]))}" placeholder="${q.format === "clock" ? "hh:mm" : q.format === "duration" ? "h:mm" : "–"}" aria-label="${esc(q.text)}" class="${q.format ? "wide" : ""}">${q.unit && !q.format ? `<span class="unit">${esc(q.unit)}</span>` : ""}</span></label>`).join("")}
    </section>` : "";

  let body;
  if (!qs.length && hq.length) {
    body = healthHtml + `<p class="muted small">Leg unter Einstellungen → Fragen deine erste Frage an.</p>`;
  } else if (!qs.length) {
    body = `<div class="empty-state">
      <h2>Noch keine Fragen</h2>
      <p class="muted">Leg deine erste Frage an, zum Beispiel „Heute bouldern?“ mit den Antworten Ja und Nein.</p>
      <button class="btn" id="firstq">Frage anlegen</button>
    </div>`;
  } else {
    const startLabel = done === 0 ? "Abfrage starten" : done < qs.length ? "Abfrage fortsetzen" : "Abfrage nochmal durchgehen";
    body = `<button class="btn block ${done < qs.length ? "hold-btn" : "ghost"}" id="startquiz">${startLabel}</button>
      <p class="progress">${done} von ${qs.length} beantwortet</p>`;
    body += healthHtml;
    let lastTheme = null;
    body += qs.map((q) => {
      const val = a[q.id];
      const th = q.cond ? null : themeOf(q);
      const head = th && th !== lastTheme ? `<h3 class="themehead">${themeById(th).i} ${esc(themeById(th).l)}</h3>` : "";
      if (th) lastTheme = th;
      return `${head}<section class="q ${isAnswered(val) ? "done" : ""} ${q.cond ? "child" : ""}" data-qid="${q.id}">
        <p class="q-title">${esc(q.text)}</p>
        ${answerInput(q, val)}
      </section>`;
    }).join("");
  }

  view.innerHTML = `
    <div class="dayhead">
      <div>
        <div class="weekday">${esc(label)}</div>
        <h1>${longDate(current)}</h1>
      </div>
      <div class="headbtns">
        ${isToday ? "" : `<button class="todaybtn" id="gotoday">Zu heute</button>`}
        <button class="gear" id="goalsbtn" aria-label="Ziele festlegen">${GEAR}</button>
      </div>
    </div>
    ${placeLine(current)}
    <div class="week">${week}</div>
    ${body}`;

  view.querySelectorAll("[data-week]").forEach((b) => b.addEventListener("click", () => { current = addDays(current, +b.dataset.week); renderDay(); }));
  view.querySelectorAll("[data-date]").forEach((b) => b.addEventListener("click", () => { current = b.dataset.date; renderDay(); }));
  $("#gotoday")?.addEventListener("click", () => { current = todayIso(); renderDay(); });
  $("#firstq")?.addEventListener("click", () => openEditor(null));
  $("#goalsbtn").addEventListener("click", openGoals);
  $("#placeedit")?.addEventListener("click", () => openPlaces(current));
  if (isToday) refreshNowWeather();
  view.querySelectorAll("[data-hq]").forEach((row) => {
    const inp = row.querySelector("input");
    inp.addEventListener("change", () => {
      const hqq = qById(row.dataset.hq);
      const n = parseQ(hqq, inp.value);
      if (Number.isNaN(n)) { toast(hqq.format ? "Bitte so eingeben: 7:23" : "Bitte eine Zahl eingeben"); inp.value = hqq.format ? fmtQ(hqq, (state.answers[current] || {})[row.dataset.hq]) : fmtNum((state.answers[current] || {})[row.dataset.hq]); return; }
      setAnswer(current, row.dataset.hq, n);
      if (hqq.format) inp.value = fmtQ(hqq, n);
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  });
  $("#startquiz")?.addEventListener("click", () => startQuiz(current));

  view.querySelectorAll(".q[data-qid]").forEach((card) => wireInput(card, qById(card.dataset.qid), current, (kind) => {
    if (kind !== "input") return renderDay();
    // Zahlen können keine Folgefragen auslösen → nur Markierung und Zähler aktualisieren
    const aa = state.answers[current] || {};
    card.classList.toggle("done", isAnswered(aa[card.dataset.qid]));
    const vq = askQuestions(current);
    $(".progress").textContent = `${vq.filter((x) => isAnswered(aa[x.id])).length} von ${vq.length} beantwortet`;
  }));
}

/* ================= Abfrage: eine Frage nach der anderen ================= */
function startQuiz(date) {
  if (date === todayIso()) capturePlace(false);
  const qs = askQuestions(date);
  const a = state.answers[date] || {};
  const first = qs.findIndex((q) => !isAnswered(a[q.id]));
  quiz = { date, idx: first < 0 ? 0 : first };
  render();
  window.scrollTo(0, 0);
}

function renderQuiz() {
  const view = $("#view");
  const { date } = quiz;
  const qs = askQuestions(date); // wird nach jeder Antwort neu berechnet → Folgefragen erscheinen
  const a = state.answers[date] || {};

  if (quiz.idx >= qs.length) {
    const open = qs.filter((q) => !isAnswered(a[q.id]));
    view.innerHTML = `<div class="quiz">
      <div class="quiz-top"><span class="muted">${longDate(date)}</span><button class="linkbtn" id="qclose">Schließen</button></div>
      <div class="quiz-done">
        <div class="hold big" style="--p:${dayProgress(date)}"></div>
        <h1>${open.length ? "Fast geschafft" : "Fertig"}</h1>
        <p class="muted">${open.length ? `${open.length} Frage${open.length > 1 ? "n" : ""} übersprungen.` : `Alle ${qs.length} Fragen für den ${longDate(date)} beantwortet.`}</p>
        <ul class="summary">${qs.map((q) => `<li><span>${esc(q.text)}</span><strong>${isAnswered(a[q.id]) ? esc(fmtQ(q, a[q.id])) : "–"}</strong></li>`).join("")}</ul>
        <div class="stack">
          ${open.length ? `<button class="btn hold-btn" id="qopen">Übersprungene beantworten</button>` : ""}
          <button class="btn ${open.length ? "ghost" : ""}" id="qfinish">Zur Tagesübersicht</button>
        </div>
      </div>
    </div>`;
    $("#qclose").addEventListener("click", endQuiz);
    $("#qfinish").addEventListener("click", endQuiz);
    $("#qopen")?.addEventListener("click", () => { quiz.idx = qs.findIndex((q) => !isAnswered(a[q.id])); renderQuiz(); });
    return;
  }

  const q = qs[quiz.idx];
  const val = a[q.id];
  const needsNext = q.type === "number" || (q.type === "choice" && q.multi);
  view.innerHTML = `<div class="quiz">
    <div class="quiz-top">
      <span class="muted">${longDate(date)} · Frage ${quiz.idx + 1} von ${qs.length}</span>
      <button class="linkbtn" id="qclose">Beenden</button>
    </div>
    <div class="bar"><span style="width:${(quiz.idx / qs.length) * 100}%"></span></div>
    <section class="quiz-q" data-qid="${q.id}">
      ${q.cond ? `<p class="q-hint">Weil du „${esc(fmtVal(a[q.cond.qid]))}“ geantwortet hast</p>` : ""}
      <h1 class="quiz-title">${esc(q.text)}</h1>
      ${answerInput(q, val)}
    </section>
    <div class="quiz-nav">
      <button class="btn ghost" id="qback" ${quiz.idx === 0 ? "disabled" : ""}>Zurück</button>
      <button class="btn ${needsNext || isAnswered(val) ? "" : "ghost"}" id="qnext">${isAnswered(val) || needsNext ? "Weiter" : "Überspringen"}</button>
    </div>
  </div>`;

  const sec = view.querySelector(".quiz-q");
  const next = () => { quiz.idx++; renderQuiz(); window.scrollTo(0, 0); };
  wireInput(sec, q, date, (kind) => {
    if (kind === "pick" || kind === "enter") { renderQuiz(); setTimeout(next, 220); } // kurz Auswahl zeigen, dann weiter
    else if (kind !== "input") renderQuiz();
  });
  $("#qclose").addEventListener("click", endQuiz);
  $("#qback").addEventListener("click", () => { quiz.idx = Math.max(0, quiz.idx - 1); renderQuiz(); });
  $("#qnext").addEventListener("click", () => {
    if (sec._commit && sec._commit() === false) return;
    next();
  });
  if (q.type === "number" && !isAnswered(val)) setTimeout(() => sec.querySelector("input")?.focus(), 50);
}

function endQuiz() {
  current = quiz.date;
  quiz = null;
  tab = "day";
  render();
  window.scrollTo(0, 0);
}
