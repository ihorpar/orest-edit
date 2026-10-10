// Round 3 workbench: the three zones (Огляд / Правки / Запит), pass states, the queue,
// quiet mode and the selection composer. Pages only decide where the zones sit.
// Nothing here calls a model: passes reveal fixed sample suggestions from shared.js.
(function () {
  const PASSES = [
    ["structure", "Структура", "Підзаголовки там, де змінюється тема"],
    ["clarity", "Ясність", "Простіша мова, менше термінів"],
    ["interest", "Врізки", "Аналогії та пояснення поруч із текстом"],
    ["visual", "Ілюстрації", "Інфографіка й малюнки"],
    ["format", "Списки", "Переліки замість суцільного тексту"],
    ["accent", "Акценти", "Ключові фрази жирним"],
    ["spell", "Правопис", "Орфографія та пунктуація"]
  ];
  const LABEL = { fact: "Факти" };
  PASSES.forEach((p) => { LABEL[p[0]] = p[1]; });
  const ZONES = {
    ov: ["Огляд", "Зрозуміти розділ. Тексту не змінює."],
    ed: ["Правки", "Пропозиції ШІ: кожна в тексті, з причиною. Вирішуєте ви."],
    ask: ["Запит", "Ваше власне завдання для ШІ."]
  };
  const ASKS = [["clarity", "Простіше"], ["short", "Коротше"], ["format", "Списком"], ["structure", "Підзаголовок"], ["interest", "Врізка"], ["visual", "Ілюстрація"], ["spell", "Правопис"]];
  const NO_MODEL = "Прототип не відповість: для цього потрібна модель, а вигадувати результат не можна.";
  const esc = O.esc;
  const color = (k) => (O.TYPES[k] || { color: "#65a30d" }).color;
  const facts = () => O.S.filter((s) => s.type === "fact");
  let epoch = 0, scroll = false, scope = null, comp = null;

  const P = {
    PASSES, LABEL, ZONES,
    shown: new Set(), ran: new Set(), running: new Set(), author: new Set(),
    diag: "idle", fact: "idle", filter: "all", focus: null, quiet: false, askText: "", askErr: false,
    open: { ov: true, ed: true, ask: true },

    emit: () => O.emit(),
    vis: (s) => P.shown.has(s.id) && (P.filter === "all" || s.type === P.filter),
    queue: () => O.pending(P.vis),
    left: () => O.pending((s) => P.shown.has(s.id)).length,
    tag: (k) => `<span class="tag"><i style="background:${color(k)}"></i>${LABEL[k]}</span>`,
    color,

    // idle → run → wait (n) → done; a pass that was never run can still have suggestions from a fragment request.
    state(k) {
      const n = O.pending((s) => s.type === k && P.shown.has(s.id)).length;
      const st = P.running.has(k) ? "run" : n ? "wait" : P.ran.has(k) ? "done" : "idle";
      const found = O.S.some((s) => s.type === k && P.shown.has(s.id));
      return { st, n, text: st === "run" ? "читаю…" : st === "wait" ? "чекають: " + n : st === "idle" ? "не запускали" : found ? "готово" : "нічого не знайдено" };
    },
    ovState(k) {
      const st = P[k];
      const n = k === "diag" ? O.DIAG.length : facts().length;
      return { st, n, text: st === "run" ? "читаю…" : st === "idle" ? "не запускали" : k === "diag" ? "зауваг: " + n : "сумнівних тверджень: " + n };
    },

    run(k) {
      if (P.running.has(k)) return;
      const my = epoch;
      P.running.add(k); P.emit();
      setTimeout(() => {
        if (my !== epoch) return;
        const pool = O.S.filter((s) => s.type === k && !P.shown.has(s.id));
        const end = () => {
          P.running.delete(k);
          if (P.ran.has(k) && !pool.length) O.toast(`«${LABEL[k]}»: нових пропозицій немає`);
          P.ran.add(k); P.emit();
        };
        if (!pool.length) return end();
        let i = 0;
        const timer = setInterval(() => {   // suggestions stream in one by one
          if (my !== epoch) return clearInterval(timer);
          P.shown.add(pool[i++].id);
          if (i >= pool.length) { clearInterval(timer); return end(); }
          P.emit();
        }, 220);
      }, 700);
    },
    runAll() { PASSES.forEach(([k]) => { if (!P.ran.has(k)) P.run(k); }); },
    overview(k) {
      if (P[k] === "run") return;
      const my = epoch;
      P[k] = "run"; P.emit();
      setTimeout(() => { if (my === epoch) { P[k] = "done"; P.emit(); } }, 900);
    },

    // --- HTML pieces -------------------------------------------------------
    pass(k) {
      const p = PASSES.find((x) => x[0] === k), s = P.state(k);
      const btn = s.st === "run" ? `<span class="spin"></span>`
        : P.ran.has(k) ? `<button class="btn ghost" data-run="${k}" title="Запустити ще раз">↻</button>`
        : `<button class="btn" data-run="${k}">Запустити</button>`;
      return `<div class="pass st-${s.st}${P.filter === k ? " on" : ""}" data-filter="${k}" title="${p[2]}"><i style="background:${color(k)}"></i><b>${p[1]}</b><span class="ps">${s.text}</span>${btn}</div>`;
    },
    ovRow(k) {
      const s = P.ovState(k);
      const btn = s.st === "run" ? `<span class="spin"></span>`
        : s.st === "done" ? `<button class="btn ghost" data-ov="${k}" title="Запустити ще раз">↻</button>`
        : `<button class="btn" data-ov="${k}">${k === "diag" ? "Прочитати" : "Перевірити"}</button>`;
      return `<div class="pass st-${s.st === "done" ? "done" : s.st}"><b>${k === "diag" ? "Діагностика розділу" : "Перевірка фактів"}</b><span class="ps">${s.text}</span>${btn}</div>`;
    },
    diagList() {
      return `<ol class="dg">${O.DIAG.map((d) => {
        const to = d.type === "fact" ? (P.fact === "idle" ? `<button class="lnk" data-ov="fact">Перевірити факти →</button>` : "")
          : !P.ran.has(d.type) && !P.running.has(d.type) ? `<button class="lnk" data-run="${d.type}">Прохід «${LABEL[d.type]}» →</button>` : "";
        return `<li><b>${d.title}.</b> ${d.text} ${to}</li>`;
      }).join("")}</ol>`;
    },
    // A fact-check finding is read-only until the editor sends it to the queue or to the author.
    finding(s) {
      const st = P.shown.has(s.id) ? `<span class="done">У правках${s.status === "pending" ? "" : s.status === "accepted" ? " · прийнято" : " · відхилено"}</span>`
        : P.author.has(s.id) ? `<span class="done">У запитах до автора</span>`
        : `<button class="btn" data-toq="${s.id}">До правок</button><button class="btn ghost" data-author="${s.id}">Запит до автора</button>`;
      return `<div class="finding"><q>${esc(s.from)}</q><p>${esc(s.reason)}</p><div class="tools">${st}</div></div>`;
    },
    chips() {
      const types = PASSES.map((p) => p[0]).concat("fact").filter((k) => O.S.some((s) => s.type === k && P.shown.has(s.id)));
      if (!types.length) return "";
      const chip = (k, label, n) => `<button class="chip${P.filter === k ? " on" : ""}" data-filter="${k}">${k !== "all" ? `<i style="background:${color(k)}"></i>` : ""}${label} <span>${n}</span></button>`;
      return `<div class="chips">${chip("all", "Усі", P.left())}${types.map((k) => chip(k, LABEL[k], O.pending((s) => s.type === k && P.shown.has(s.id)).length)).join("")}</div>`;
    },
    bulk() {
      const q = P.queue(), text = q.filter((s) => s.type !== "visual");
      if (P.quiet || !q.length) return "";
      return `<button class="btn" data-bulk="rejected">Відхилити всі</button>` +
        (text.length ? `<button class="btn primary" data-bulk="accepted" title="Ілюстрації вставляються окремо, після генерування">Прийняти всі · ${text.length}</button>` : "");
    },
    quietSw: () => `<button class="switch" data-quiet role="switch" aria-checked="${P.quiet}" title="По одній правці, з клавіатури: ↵ прийняти, ⌫ відхилити, ← → далі"><i></i>Тихий режим</button>`,
    progress() {
      const all = O.S.filter((s) => P.shown.has(s.id)).length, left = P.left();
      return !all ? "Правок ще немає" : left ? `Лишилось правок: ${left} із ${all}` : `Усі ${all} правок вирішено`;
    },
    tools: () => (P.shown.size ? P.chips() + `<div class="tools">${P.bulk()}${P.quietSw()}</div>` : ""),
    askForm: () => `<form class="ask" data-ask-chapter><input value="${esc(P.askText)}" autocomplete="off" placeholder="Напр.: зроби тон теплішим у всьому розділі"><button class="btn">Спланувати</button></form>` +
      (P.askErr ? `<p class="err">${NO_MODEL}</p>` : ""),

    body(key, o) {
      o = o || {};
      if (key === "ov") return P.ovRow("diag") + (P.diag === "done" ? P.diagList() : "") + P.ovRow("fact") +
        (P.fact === "done" && !o.noFindings ? facts().map(P.finding).join("") : "") +
        (P.author.size ? `<p class="zd">Запитів до автора: ${P.author.size}. Потраплять у DOCX як примітки.</p>` : "");
      if (key === "ed") return `<div class="passes">${PASSES.map((p) => P.pass(p[0])).join("")}</div>` +
        (PASSES.some(([k]) => !P.ran.has(k)) ? `<button class="btn" data-runall>Запустити всі проходи</button>` : "") +
        (o.noTools ? "" : `<p class="zd">${P.progress()}</p>` + P.tools());
      return `<p class="zd"><b>До фрагмента:</b> виділіть текст у рукописі, і поруч з’явиться панель запиту.</p><p class="zd"><b>До всього розділу:</b></p>` + P.askForm();
    },
    zone(key, o) {
      const z = ZONES[key];
      return `<details class="zone" data-zone="${key}"${P.open[key] ? " open" : ""}><summary><h2>${z[0]}</h2><span class="zd">${z[1]}</span></summary><div class="zb">${P.body(key, o)}</div></details>`;
    },

    // --- Manuscript --------------------------------------------------------
    opt: () => (P.quiet
      ? { focus: P.focus, show: (s) => P.vis(s) && (s.from ? true : s.id === P.focus),
          mark: (s, f) => (f ? O.mark(s, true) : `<span class="sg dim" data-s="${s.id}">${esc(s.from)}</span>`) }
      : { focus: P.focus, show: P.vis }),
    acts: (s) => `<span class="acts"><button class="icon-btn no" data-a="rejected" title="Відхилити">✕</button>` + (s.type === "visual"
      ? `<button class="btn" data-studio="${s.id}">Відкрити</button>` : `<button class="icon-btn yes" data-a="accepted" title="Прийняти">✓</button>`) + `</span>`,
    note: (s) => `<div class="note${P.focus === s.id ? " is-focus" : ""}" data-s="${s.id}"><div class="note-top">${P.tag(s.type)}${P.acts(s)}</div><p>${O.what(s) ? `<b>${O.what(s)}.</b> ` : ""}${esc(s.reason)}</p></div>`,
    // Queue card for list layouts: the change itself is spelled out, since it is not next to the text.
    card: (s) => `<div class="note${P.focus === s.id ? " is-focus" : ""}" data-s="${s.id}"><div class="note-top">${P.tag(s.type)}${P.acts(s)}</div><div class="df">${O.diff(s)}</div><p>${esc(s.reason)}</p></div>`,
    quietCard(s) {
      const q = P.queue();
      return `<div class="note qcard is-focus" data-s="${s.id}"><div class="note-top">${P.tag(s.type)}<span class="count">${q.indexOf(s) + 1} з ${q.length}</span></div>
        <p>${O.what(s) ? `<b>${O.what(s)}.</b> ` : ""}${esc(s.reason)}</p>
        <div class="tools"><button class="btn ghost" data-qk="prev" title="Назад">←</button><button class="btn ghost" data-qk="next" title="Пропустити">→</button><span class="sp"></span>
        <button class="btn" data-qk="rejected">Відхилити<kbd>⌫</kbd></button><button class="btn primary" data-qk="accepted">${s.type === "visual" ? "Відкрити студію" : "Прийняти"}<kbd>↵</kbd></button></div></div>`;
    },
    notes(b) {
      if (!P.quiet) return O.pending((s) => s.block === b.id && P.vis(s)).map(P.note).join("");
      const s = P.focus && O.get(P.focus);
      return s && s.block === b.id ? P.quietCard(s) : "";
    },

    // --- Quiet mode --------------------------------------------------------
    setQuiet(on) {
      P.quiet = on; scroll = on;
      if (on && !P.queue().find((s) => s.id === P.focus)) P.focus = (P.queue()[0] || {}).id || null;
      P.emit();
    },
    move(d) {
      const q = P.queue();
      if (!q.length) return;
      P.focus = q[(q.findIndex((s) => s.id === P.focus) + d + q.length) % q.length].id;
      scroll = true; P.emit();
    },
    act(st) {
      const s = P.focus && O.get(P.focus);
      if (!s) return;
      if (st === "accepted" && s.type === "visual") return O.studio(s.id);   // inserted from the studio, once generated
      const q = P.queue(), next = q[q.indexOf(s) + 1] || q[0];
      P.focus = next && next !== s ? next.id : null;
      scroll = true;
      O.set(s.id, st);
    },
    qk(k) { if (k === "prev") P.move(-1); else if (k === "next") P.move(1); else P.act(k); },

    init(render, o) {
      o = o || {};
      if (o.foldMobile && window.matchMedia("(max-width: 1000px)").matches) P.open = { ov: false, ed: false, ask: false };
      O.on(() => {
        if (P.quiet && !P.queue().find((s) => s.id === P.focus)) P.focus = (P.queue()[0] || {}).id || null;
        render();
        if (scroll) {
          scroll = false;
          const el = document.querySelector(".qcard") || document.querySelector(".ms .is-focus");
          if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      });
      document.getElementById("reset").onclick = () => {
        epoch++;
        ["shown", "ran", "running", "author"].forEach((k) => P[k].clear());
        Object.assign(P, { diag: "idle", fact: "idle", filter: "all", focus: null, quiet: false, askText: "", askErr: false });
        hideComp();
        if (o.reset) o.reset();
        O.reset();
      };
      O.hover(document.body);
      P.emit();
    }
  };

  // --- Clicks, keys, typing: one set of handlers for every layout ----------
  document.addEventListener("click", (e) => {
    const c = (sel) => e.target.closest(sel);
    let t;
    if (c("[data-vz], #studio, #comp")) return;
    if ((t = c("[data-run]"))) return P.run(t.dataset.run);
    if (c("[data-runall]")) return P.runAll();
    if ((t = c("[data-ov]"))) return P.overview(t.dataset.ov);
    if ((t = c("[data-toq]"))) { P.shown.add(t.dataset.toq); P.focus = t.dataset.toq; return P.emit(); }
    if ((t = c("[data-author]"))) { P.author.add(t.dataset.author); return P.emit(); }
    if ((t = c("[data-qk]"))) return P.qk(t.dataset.qk);
    if (c("[data-quiet]")) return P.setQuiet(!P.quiet);
    if ((t = c("[data-bulk]"))) return O.set(P.queue().filter((s) => t.dataset.bulk === "rejected" || s.type !== "visual").map((s) => s.id), t.dataset.bulk);
    if ((t = c("[data-a]")) && t.closest("[data-s]")) return O.set(t.closest("[data-s]").dataset.s, t.dataset.a);
    if ((t = c(".pass[data-filter]")) && !t.classList.contains("st-wait")) return;   // nothing to show for this pass yet
    if ((t = c("[data-filter]"))) { const k = t.dataset.filter; P.filter = P.filter === k ? "all" : k; return P.emit(); }
    if (c("[data-studio]")) return;
    if ((t = c("[data-s]")) && window.getSelection().isCollapsed && P.focus !== t.dataset.s) { P.focus = t.dataset.s; P.emit(); }
  });
  document.addEventListener("keydown", (e) => {
    if (!P.quiet || O.studioOpen() || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const map = { Enter: "accepted", Backspace: "rejected", Delete: "rejected", ArrowRight: "next", ArrowLeft: "prev", j: "next", k: "prev" };
    if (map[e.key]) { e.preventDefault(); P.qk(map[e.key]); }
    else if (e.key === "Escape") P.setQuiet(false);
  });
  document.addEventListener("input", (e) => { if (e.target.closest && e.target.closest("[data-ask-chapter]")) P.askText = e.target.value; });
  document.addEventListener("submit", (e) => {
    if (!e.target.matches("[data-ask-chapter]")) return;
    e.preventDefault();
    if (!P.askText.trim()) return;
    P.askErr = true; P.emit();   // no model here, so say so instead of inventing a plan
  });
  document.addEventListener("toggle", (e) => { const z = e.target.dataset && e.target.dataset.zone; if (z) P.open[z] = e.target.open; }, true);

  // --- Запит до фрагмента: a composer that exists only while text is selected ---
  function selInfo() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    const el = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const blk = el && el.closest("[data-b]");
    if (!blk || text.length < 4) return null;
    return { block: blk.dataset.b, text, rect: sel.getRangeAt(0).getBoundingClientRect() };
  }
  function hideComp() { if (comp) { comp.className = ""; comp.innerHTML = ""; } scope = null; }
  function syncComp() {
    const i = selInfo();
    if (!i) { if (comp && !comp.contains(document.activeElement)) hideComp(); return; }
    if (!comp) { comp = document.createElement("div"); comp.id = "comp"; document.body.appendChild(comp); bindComp(); }
    const fresh = !scope || scope.text !== i.text;
    scope = i;
    if (fresh) comp.innerHTML = `<div class="c-h"><span class="tag">Запит до фрагмента</span><q>${esc(i.text)}</q></div>
      <div class="c-acts">${ASKS.map(([k, l]) => `<button class="chip" data-ca="${k}">${l}</button>`).join("")}</div>
      <form class="ask"><input autocomplete="off" placeholder="Або своїми словами…"><button class="btn">Надіслати</button></form><p class="c-msg"></p>`;
    comp.className = "on";
    comp.style.top = i.rect.bottom + window.scrollY + 10 + "px";
    comp.style.left = Math.max(12, Math.min(i.rect.left + window.scrollX, document.documentElement.clientWidth - comp.offsetWidth - 12)) + "px";
  }
  function say(text, err) { const m = comp.querySelector(".c-msg"); m.textContent = text; m.className = "c-msg" + (err ? " err" : ""); }
  function askFragment(kind) {
    const mine = (s) => s.type === kind && s.block === scope.block;
    const pool = O.S.filter((s) => mine(s) && !P.shown.has(s.id));
    if (!pool.length) return O.pending((s) => mine(s)).length ? say("Така пропозиція для цього абзацу вже є на полях.") : say(NO_MODEL, true);
    const my = epoch;
    say("Читаю фрагмент…");
    setTimeout(() => {
      if (my !== epoch) return;
      pool.forEach((s) => P.shown.add(s.id));
      P.focus = pool[0].id; scroll = true;
      window.getSelection().removeAllRanges();
      hideComp(); P.emit();
    }, 600);
  }
  function bindComp() {
    comp.addEventListener("mousedown", (e) => { if (!e.target.closest("input")) e.preventDefault(); });   // keep the text selection alive
    comp.addEventListener("click", (e) => { const b = e.target.closest("[data-ca]"); if (b && scope) askFragment(b.dataset.ca); });
    comp.addEventListener("submit", (e) => { e.preventDefault(); if (comp.querySelector("input").value.trim()) say(NO_MODEL, true); });
    comp.addEventListener("focusout", () => setTimeout(syncComp));
    comp.addEventListener("keydown", (e) => { if (e.key === "Escape") { window.getSelection().removeAllRanges(); hideComp(); } });
  }
  ["selectionchange", "mouseup", "keyup"].forEach((ev) => document.addEventListener(ev, syncComp));

  window.P = P;
})();
