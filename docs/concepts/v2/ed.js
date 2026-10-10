// "Три вкладки" editor prototype. One script for every visual design: the page supplies only CSS.
// Suggestions are fixed sample data from shared.js; no model is called anywhere.
(function () {
  const esc = O.esc;
  const svg = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    down: svg('<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>'),
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
    checks: svg('<path d="m3 7 2 2 3-4"/><path d="m3 16 2 2 3-4"/><path d="M12 7h9"/><path d="M12 16h9"/>'),
    chat: svg('<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z"/>'),
    structure: svg('<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/>'),
    clarity: svg('<path d="M12 3.5 13.9 9l5.6 2-5.6 2-1.9 5.5-1.9-5.5-5.6-2 5.6-2Z"/>'),
    interest: svg('<path d="M9.5 18h5"/><path d="M10.5 21h3"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z"/>'),
    visual: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-8 8"/>'),
    accent: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7Z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7Z"/>'),
    spell: svg('<path d="m4 16 4-10 4 10"/><path d="M5.5 12.5h5"/><path d="m14 17 2.5 2.5L21 14"/>'),
    fact: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
    italic: svg('<path d="M10 5h7"/><path d="M7 19h7"/><path d="m14 5-4 14"/>'),
    list: svg('<path d="M9 7h11"/><path d="M9 12h11"/><path d="M9 17h11"/><path d="M4.5 7h.01"/><path d="M4.5 12h.01"/><path d="M4.5 17h.01"/>'),
    box: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8"/><path d="M8 14h5"/>'),
    left: svg('<path d="m14 6-6 6 6 6"/>'),
    right: svg('<path d="m10 6 6 6-6 6"/>'),
    arrow: svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    x: svg('<path d="m6 6 12 12"/><path d="M18 6 6 18"/>')
  };
  const PASSES = [
    ["structure", "Структура", "Підзаголовки там, де змінюється тема"],
    ["clarity", "Ясність", "Простіша мова без втрати змісту"],
    ["interest", "Врізки", "Аналогії та пояснення для читача"],
    ["visual", "Ілюстрації", "Схеми й малюнки до складних місць"],
    ["accent", "Акценти", "Ключові фрази напівжирним"],
    ["spell", "Правопис", "Орфографія та одруківки"]
  ];
  const QUICK = [["clarity", "Простіше"], ["short", "Коротше"], ["list", "Списком"], ["structure", "Підзаголовок"], ["interest", "Врізка"], ["visual", "Ілюстрація"]];
  const IDEAS = ["Скороти вступ удвічі", "Додай приклад із життя", "Поясни терміни простіше"];
  const NEED_MODEL = "Для цього потрібна модель. У прототипі є лише готові зразки.";
  const FACT = "s9";

  const words = O.blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
  document.body.insertAdjacentHTML("afterbegin", `
    <header class="top">
      <a class="logo" href="index.html" title="Усі прототипи"><i>O</i><span>Orest Edit</span></a>
      <div class="crumb"><span>Кава і сон</span><b>Розділ 3. Чому кава не замінює сон</b></div>
      <span class="saved">${I.check}Збережено</span>
      <span class="sp"></span>
      <button class="tb" id="undo" title="Скасувати останню дію">${I.undo}</button>
      <button class="tb" title="Повторити" disabled>${I.redo}</button>
      <button class="tb wide" id="hbtn" title="Історія змін">${I.clock}<span>Історія</span></button>
      <span class="vr"></span>
      <button class="btn ghost wide" data-docx>Відкрити</button>
      <button class="btn solid" data-docx>${I.down}<span>Експорт .docx</span></button>
      <div id="histpop"></div>
    </header>
    <div class="app">
      <main class="stage">
        <div class="fmt" role="toolbar" aria-label="Форматування">
          <button class="sel" data-fmt>Звичайний текст<span>▾</span></button><span class="vr"></span>
          <button data-fmt title="Напівжирний">${I.accent}</button><button data-fmt title="Курсив">${I.italic}</button><span class="vr"></span>
          <button data-fmt title="Список">${I.list}</button><button data-fmt title="Врізка">${I.box}</button><button data-fmt title="Зображення">${I.visual}</button>
          <span class="stats">${words} слів · 6 абзаців</span>
        </div>
        <article class="sheet"><p class="kicker">Розділ 3</p><div id="doc" class="ms"></div></article>
      </main>
      <aside id="panel">
        <nav id="tabs"></nav>
        <div id="body"></div>
        <footer class="proto">Прототип на зразкових даних · <a href="index.html">усі варіанти</a> · <button id="reset">скинути</button></footer>
      </aside>
    </div>
    <div id="selbar"></div>`);

  const $ = (id) => document.getElementById(id);
  const st = { tab: "ov", filter: "all", focus: null, quiet: false, run: {}, diag: "idle", fact: "idle", author: false, scope: null, draft: "", asks: [] };
  const shown = new Set();    // suggestions the "model" has already produced
  const drawn = new Set();    // cards that have already animated in
  let sel = null, seen = null;

  const paras = O.blocks.filter((b) => b.tag === "p").map((b) => b.id);
  const where = (block) => (paras.includes(block) ? "абз. " + (paras.indexOf(block) + 1) : "заголовок");
  const short = (t, n = 64) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "…" : t);
  const pend = (type) => O.S.filter((s) => shown.has(s.id) && s.status === "pending" && (!type || s.type === type));
  const queue = () => pend().filter((s) => st.filter === "all" || s.type === st.filter);
  const passName = (t) => (PASSES.find((p) => p[0] === t) || [0, O.TYPES[t].label])[1];
  const ttag = (t) => `<span class="ttag">${I[t]}${passName(t)}</span>`;
  const busy = (text) => `<div class="busy"><span class="spin"></span>${text}</div>`;

  /* ---------- actions ---------- */
  function startPass(type) {
    if (st.run[type]) return;
    st.run[type] = "busy";
    render();
    const pool = O.S.filter((s) => s.type === type && !shown.has(s.id));
    setTimeout(() => {
      let i = 0;
      const step = () => {
        if (i >= pool.length) { st.run[type] = "done"; return render(); }
        shown.add(pool[i++].id);
        render();
        setTimeout(step, 220);
      };
      step();
    }, 700);
  }
  function timed(key) {
    st[key] = "busy"; render();
    setTimeout(() => { st[key] = "done"; render(); }, 900);
  }
  function show(id) { shown.add(id); st.tab = "ed"; st.filter = "all"; st.focus = id; seen = null; render(); }
  function quick(action, label, block, text) {
    const hit = O.S.find((s) => s.type === action && s.block === block && s.status === "pending");
    const entry = { text: label + " · " + where(block), quote: short(text, 70) };
    st.asks.unshift(entry);
    window.getSelection().removeAllRanges();
    if (hit) { entry.res = "Пропозиція в черзі правок"; return show(hit.id); }
    entry.err = NEED_MODEL;
    st.tab = "ask";
    render();
  }
  function move(d) {
    const q = queue();
    if (!q.length) return;
    const i = q.findIndex((s) => s.id === st.focus);
    st.focus = q[(i + d + q.length) % q.length].id;
    render();
  }
  function decide(id, status) {
    const q = queue();
    const i = q.findIndex((s) => s.id === id);
    const next = q[i + 1] || q[i - 1];
    if (st.focus === id) st.focus = next ? next.id : null;
    O.set(id, status);
  }

  /* ---------- panel ---------- */
  function overview() {
    const fixFor = (d) => {
      if (d.type === "fact") return st.fact === "idle" ? `<button class="link" data-do="fact">Перевірити факти${I.arrow}</button>` : `<span class="note">Результат нижче</span>`;
      const n = pend(d.type).length;
      if (!st.run[d.type]) return `<button class="link" data-pass="${d.type}" data-go>Запустити «${passName(d.type)}»${I.arrow}</button>`;
      return `<button class="link" data-showtype="${d.type}">${n ? "Показати правки · " + n : "«" + passName(d.type) + "»: усе вирішено"}${I.arrow}</button>`;
    };
    const diag = st.diag === "idle"
      ? `<div class="starter"><div><b>Діагностика</b><p>Що заважає читачеві: мова, структура, прогалини.</p></div><button class="btn solid" data-do="diag">Прочитати розділ</button></div>`
      : st.diag === "busy" ? `<div class="starter"><div><b>Діагностика</b>${busy("Читаю розділ…")}</div></div>`
      : `<h3 class="sec">Діагностика<span>${O.DIAG.length} спостережень</span></h3>
         <ol class="finds">${O.DIAG.map((d) => `<li class="t-${d.type}"><i class="ico">${I[d.type]}</i><div><b>${d.title}</b><p>${d.text}</p>${fixFor(d)}</div></li>`).join("")}</ol>`;

    const f = O.get(FACT);
    const factActs = shown.has(FACT) ? `<button class="link" data-show="${FACT}">${f.status === "pending" ? "Правка чекає в черзі" : "Правку вирішено"}${I.arrow}</button>`
      : st.author ? `<span class="note ok">${I.check}Додано до запитів до автора</span>`
      : `<div class="row"><button class="btn soft" data-do="factfix">Запропонувати правку</button><button class="btn ghost" data-do="author">Запит до автора</button></div>`;
    const fact = st.fact === "idle"
      ? `<div class="starter"><div><b>Перевірка фактів</b><p>Шукає сумнівні твердження. Знахідку можна перетворити на правку або запит до автора.</p></div><button class="btn outline" data-do="fact">Перевірити</button></div>`
      : st.fact === "busy" ? `<div class="starter"><div><b>Перевірка фактів</b>${busy("Перевіряю твердження…")}</div></div>`
      : `<h3 class="sec">Перевірка фактів<span>1 знахідка · ${where(f.block)}</span></h3>
         <div class="finding"><p class="claim">${esc(f.from)}</p><p>${esc(f.reason)}</p>${factActs}</div>`;

    return `<h2>Огляд розділу</h2><p class="lead">ШІ читає розділ і нічого в ньому не змінює.</p>${diag}${fact}`;
  }

  function card(s, quiet) {
    const what = s.type === "spell" ? `${esc(s.from)} <span class="to">→</span> ${esc(s.to)}`
      : s.to ? `«${esc(short(s.from))}»` : O.what(s);
    const main = s.type === "visual"
      ? `<button class="btn soft" data-studio="${s.id}">Відкрити студію</button>`
      : `<button class="btn soft" data-a="accepted">Прийняти</button>`;
    const nav = quiet ? `<span class="nav"><button class="tb" data-do="prev" title="Попередня">${I.left}</button><button class="tb" data-do="next" title="Наступна">${I.right}</button></span>` : "";
    const fresh = drawn.has(s.id) ? "" : " new";
    drawn.add(s.id);
    return `<article class="card t-${s.type}${st.focus === s.id ? " is-focus" : ""}${fresh}" data-s="${s.id}" tabindex="0">
      <header>${ttag(s.type)}<span class="where">${where(s.block)}</span></header>
      <div class="what">${what}</div><p class="why">${esc(s.reason)}</p>
      <footer>${nav}<button class="btn ghost" data-a="rejected">Відхилити</button>${main}</footer></article>`;
  }

  function edits() {
    const rows = PASSES.map(([t, name, desc]) => {
      const r = st.run[t], n = pend(t).length;
      const right = !r ? `<button class="btn outline sm" data-pass="${t}">Запустити</button>`
        : r === "busy" ? `<span class="state"><span class="spin"></span>читаю</span>`
        : n ? `<span class="n" title="Чекають рішення">${n}</span>` : `<span class="state ok">${I.check}готово</span>`;
      return `<li class="pass t-${t}${r === "done" ? " ran" : ""}${st.filter === t ? " on" : ""}" data-filter="${t}">
        <i class="ico">${I[t]}</i><span class="pn"><b>${name}</b><em>${desc}</em></span>${right}</li>`;
    }).join("");
    const idle = PASSES.some(([t]) => !st.run[t]);
    const q = queue(), total = pend().length;
    const decided = O.S.filter((s) => shown.has(s.id) && s.status !== "pending").length;

    let list;
    if (!shown.size) list = `<div class="empty"><b>Черга порожня</b>Запустіть прохід — пропозиції з’являться тут і в тексті, кожна з причиною.</div>`;
    else if (!q.length) list = `<div class="empty"><b>${st.filter === "all" ? "Усе вирішено" : "Тут усе вирішено"}</b>${st.filter === "all" ? "Можна запустити інший прохід або експортувати розділ." : "Оберіть інший прохід або покажіть усі правки."}</div>`;
    else if (st.quiet) {
      const s = q.find((x) => x.id === st.focus) || q[0];
      list = card(s, true) + `<p class="keys"><b>${q.indexOf(s) + 1} з ${q.length}</b><span><kbd>↵</kbd> прийняти</span><span><kbd>⌫</kbd> відхилити</span><span><kbd>←</kbd><kbd>→</kbd> далі</span></p>`;
    } else list = `<div class="queue">${q.map((s) => card(s)).join("")}</div>`;

    const bulk = st.filter !== "all" && st.filter !== "visual" && q.length > 1 && !st.quiet
      ? `<button class="btn soft sm" data-do="bulk">Прийняти всі · ${q.length}</button>` : "";
    const filterbar = st.filter !== "all"
      ? `<div class="filterbar"><span>Лише «${passName(st.filter)}» · <button class="link" data-filter="all">показати всі</button></span>${bulk}</div>` : "";
    const summary = shown.size
      ? `<div class="summary"><p><b>${total}</b> ${total === 1 ? "правка чекає" : "чекають рішення"}<span>вирішено ${decided}</span></p><div class="bar"><i style="width:${(decided / (decided + total || 1)) * 100}%"></i></div></div>` : "";

    return `${summary}<h3 class="sec">Проходи${idle ? `<button class="link" data-do="all">Запустити всі</button>` : ""}</h3>
      <ul class="passes">${rows}</ul>
      <h3 class="sec">Черга${total ? `<button class="switch${st.quiet ? " on" : ""}" data-do="quiet" role="switch" aria-checked="${st.quiet}" title="Показувати по одній правці"><i></i>Тихий режим</button>` : ""}</h3>
      ${filterbar}${list}`;
  }

  function ask() {
    const sc = st.scope;
    const scope = sc
      ? `<div class="scope is-frag"><span>Фрагмент · ${where(sc.block)}</span><button class="tb" data-do="unscope" title="Працювати з усім розділом">${I.x}</button><q>${esc(short(sc.text, 120))}</q></div>`
      : `<div class="scope"><span>Увесь розділ</span><em>Щоб попросити про фрагмент, виділіть його в тексті.</em></div>`;
    const asks = st.asks.length ? `<h3 class="sec">Попередні запити</h3><ul class="asks">${st.asks.map((a) =>
      `<li><b>${esc(a.text)}</b>${a.quote ? `<q>${esc(a.quote)}</q>` : ""}<span class="${a.err ? "err" : "res"}">${a.err || a.res}</span></li>`).join("")}</ul>` : "";
    const extras = sc
      ? `<h3 class="sec">Швидкі дії для фрагмента</h3><div class="quick">${QUICK.map(([k, l]) => `<button class="chip" data-quick="${k}">${l}</button>`).join("")}</div>`
      : `<h3 class="sec">Наприклад</h3><div class="quick">${IDEAS.map((t) => `<button class="chip" data-idea>${t}</button>`).join("")}</div>`;
    return `<h2>Власний запит</h2><p class="lead">Попросіть своїми словами. Відповідь прийде правками в чергу, а не готовим текстом.</p>
      ${scope}
      <div class="composer"><textarea id="askq" rows="4" placeholder="${sc ? "Що зробити з цим фрагментом?" : "Що зробити з розділом?"}">${esc(st.draft)}</textarea>
      <button class="btn solid" data-do="send">Надіслати</button></div>
      ${extras}${asks}`;
  }

  /* ---------- render ---------- */
  const TABS = [["ov", "Огляд", I.eye], ["ed", "Правки", I.checks], ["ask", "Запит", I.chat]];
  function render() {
    const q = queue();
    if (st.focus && !q.find((s) => s.id === st.focus)) st.focus = st.quiet && q.length ? q[0].id : null;
    if (st.quiet && !st.focus && q.length) st.focus = q[0].id;
    const left = pend().length;
    $("tabs").innerHTML = TABS.map(([k, l, icon]) =>
      `<button data-tab="${k}" class="${st.tab === k ? "on" : ""}">${icon}<span>${l}</span>${k === "ed" && left ? `<b>${left}</b>` : ""}</button>`).join("");
    const keep = $("body").scrollTop;
    $("body").dataset.view = st.tab;
    $("body").innerHTML = st.tab === "ov" ? overview() : st.tab === "ed" ? edits() : ask();
    $("body").scrollTop = keep;
    $("doc").innerHTML = O.doc({
      focus: st.focus,
      show: (s) => shown.has(s.id) && (st.filter === "all" || s.type === st.filter) && (!st.quiet || s.from || s.id === st.focus),
      mark: (s, f) => (st.quiet && !f ? `<span class="sg dim" data-s="${s.id}">${esc(s.from)}</span>` : O.mark(s, f))
    });
    document.body.classList.toggle("is-quiet", st.quiet);
    $("selbar").className = "";
    if (st.focus !== seen) {
      seen = st.focus;
      const m = $("doc").querySelector(".is-focus"), c = $("body").querySelector(".card.is-focus");
      if (m) m.scrollIntoView({ block: "center", behavior: "smooth" });
      if (c) c.scrollIntoView({ block: "nearest" });
    }
  }

  /* ---------- events ---------- */
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { st.tab = b.dataset.tab; render(); } });

  $("body").addEventListener("click", (e) => {
    const t = (q) => e.target.closest(q);
    let b;
    if ((b = t("[data-pass]"))) { if (b.hasAttribute("data-go")) st.tab = "ed"; return startPass(b.dataset.pass); }
    if ((b = t("[data-a]"))) return decide(b.closest("[data-s]").dataset.s, b.dataset.a);
    if (t("[data-studio]")) return;
    if ((b = t("[data-show]"))) return show(b.dataset.show);
    if ((b = t("[data-showtype]"))) { st.tab = "ed"; st.filter = b.dataset.showtype; return render(); }
    if ((b = t("[data-quick]"))) return quick(b.dataset.quick, b.textContent, st.scope.block, st.scope.text);
    if ((b = t("[data-idea]"))) { st.draft = b.textContent; render(); return $("askq").focus(); }
    if ((b = t("[data-do]"))) {
      const k = b.dataset.do;
      if (k === "diag" || k === "fact") return timed(k);
      if (k === "factfix") return show(FACT);
      if (k === "author") { st.author = true; O.toast("Додано до запитів до автора"); return render(); }
      if (k === "all") return PASSES.forEach(([p]) => startPass(p));
      if (k === "quiet") { st.quiet = !st.quiet; seen = null; return render(); }
      if (k === "bulk") return O.set(queue().map((s) => s.id), "accepted");
      if (k === "prev") return move(-1);
      if (k === "next") return move(1);
      if (k === "unscope") { st.scope = null; return render(); }
      if (k === "send") {
        const text = st.draft.trim();
        if (!text) return $("askq").focus();
        st.asks.unshift({ text, quote: st.scope ? short(st.scope.text, 70) : "", err: "Довільний запит потребує моделі. У прототипі вона не викликається." });
        st.draft = "";
        return render();
      }
    }
    if ((b = t("[data-filter]"))) {
      const f = b.dataset.filter;
      if (f !== "all" && st.run[f] !== "done") return;
      st.filter = st.filter === f ? "all" : f;
      return render();
    }
    if ((b = t(".card"))) { st.focus = b.dataset.s; render(); }
  });
  $("body").addEventListener("input", (e) => { if (e.target.id === "askq") st.draft = e.target.value; });

  $("doc").addEventListener("click", (e) => {
    if (e.target.closest("[data-studio]") || !window.getSelection().isCollapsed) return;
    const m = e.target.closest("[data-s]");
    if (m) { st.tab = "ed"; st.focus = m.dataset.s; seen = null; render(); }
  });
  O.hover(document.querySelector(".app"));

  // The composer exists only while text is selected.
  function readSel() {
    const s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) return null;
    const r = s.getRangeAt(0);
    const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const block = n.closest("#doc [data-b]");
    const text = s.toString().trim();
    return block && text.length > 2 ? { block: block.dataset.b, text, rect: r.getBoundingClientRect() } : null;
  }
  let selTimer;
  document.addEventListener("selectionchange", () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      sel = readSel();
      const bar = $("selbar");
      if (!sel) { bar.className = ""; return; }
      bar.innerHTML = QUICK.map(([k, l]) => `<button data-quick="${k}">${l}</button>`).join("") + `<button class="own" data-quick="own">${I.chat}Свій запит</button>`;
      bar.className = "on";
      const max = document.documentElement.clientWidth - bar.offsetWidth - 12;
      bar.style.top = sel.rect.bottom + window.scrollY + 10 + "px";
      bar.style.left = Math.max(12, Math.min(sel.rect.left + window.scrollX, max)) + "px";
    }, 150);
  });
  $("selbar").addEventListener("mousedown", (e) => e.preventDefault());   // keep the selection alive
  $("selbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-quick]");
    if (!b || !sel) return;
    if (b.dataset.quick !== "own") return quick(b.dataset.quick, b.textContent, sel.block, sel.text);
    st.scope = { block: sel.block, text: sel.text };
    st.tab = "ask";
    window.getSelection().removeAllRanges();
    render();
    $("askq").focus();
  });

  document.addEventListener("keydown", (e) => {
    if (!st.quiet || st.tab !== "ed" || O.studioOpen() || e.target.closest("input, textarea")) return;
    const map = { Enter: "accepted", Backspace: "rejected", Delete: "rejected", ArrowRight: 1, ArrowLeft: -1 };
    const k = map[e.key];
    if (k === undefined || !st.focus) return;
    e.preventDefault();
    if (typeof k === "number") return move(k);
    if (k === "accepted" && O.get(st.focus).type === "visual") return O.studio(st.focus);
    decide(st.focus, k);
  });

  $("undo").onclick = O.undo;
  $("reset").onclick = () => {
    Object.assign(st, { tab: "ov", filter: "all", focus: null, quiet: false, run: {}, diag: "idle", fact: "idle", author: false, scope: null, draft: "", asks: [] });
    shown.clear(); drawn.clear(); seen = null;
    O.reset();
    const toast = $("toast");
    if (toast) toast.className = "";
  };
  document.querySelectorAll("[data-docx]").forEach((b) => { b.onclick = () => O.toast("Імпорт і експорт DOCX у прототипі не працюють."); });
  document.querySelector(".fmt").addEventListener("click", (e) => { if (e.target.closest("[data-fmt]")) O.toast("Ручне редагування в прототипі вимкнено."); });
  $("hbtn").onclick = () => {
    $("histpop").innerHTML = `<b>Історія змін</b>` + (O.log.length ? `<ol>${O.log.slice().reverse().map((l) => `<li>${l}</li>`).join("")}</ol>` : `<p>Змін ще немає.</p>`);
    $("histpop").classList.toggle("on");
  };
  document.addEventListener("click", (e) => { if (!e.target.closest("#histpop, #hbtn")) $("histpop").classList.remove("on"); });

  O.on(render);
  render();
})();
