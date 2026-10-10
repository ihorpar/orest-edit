// Shared sample manuscript, suggestion state and render helpers for the v2 prototypes.
// Nothing here calls a model: suggestions are fixed sample data.
(function () {
  const TYPES = {
    clarity: { label: "Ясність", color: "#059669" },
    structure: { label: "Структура", color: "#2563eb" },
    interest: { label: "Інтерес", color: "#7c3aed" },
    accent: { label: "Акценти", color: "#0891b2" },
    spell: { label: "Правопис", color: "#dc2626" },
    fact: { label: "Факти", color: "#d97706" },
    visual: { label: "Візуали", color: "#db2777" }
  };
  const STYLES = { minimal: "Мінімалізм", gradient: "Спокійний градієнт", brutal: "Необрутал", glass: "Сучасне скло" };
  const INTENTS = { info: "Інфографіка", illu: "Ілюстрація" };

  const blocks = [
    { id: "t", tag: "h1", text: "Чому кава не замінює сон" },
    { id: "p1", tag: "p", text: "Протягом періоду неспання в позаклітинному просторі базальних відділів переднього мозку відбувається прогресивна акумуляція аденозину — нуклеозиду, що утворюється внаслідок гідролізу аденозинтрифосфату. Чим довше ми не спимо, тим більше його накопичується." },
    { id: "p2", tag: "p", text: "Аденозин зв’язується з рецепторами A1 та A2A і пригнічує активність нейронів, які підтримують стан бадьорості. Саме через це до вечора ми відчуваемо дедалі сильнішу сонливість — вчені називають це тиском сну." },
    { id: "p3", tag: "p", text: "Кофеїн є конкурентним антагоністом аденозинових рецепторів: його молекула структурно подібна до аденозину, тож вона займає рецептор, але не активує його. Втома нікуди не зникає — мозок просто тимчасово перестає її помічати." },
    { id: "p4", tag: "p", text: "Важливо, що кофеїн виводиться з організму повністю вже за дві години, тому чашка кави по обіді ніяк не впливає на нічний сон. Тим часом аденозин продовжує накопичуватися." },
    { id: "p5", tag: "p", text: "Коли дія кофеїну завершується, накопичений аденозин одномоментно отримує доступ до вивільнених рецепторів, що маніфестує різким зниженням рівня бадьорості. У побуті це називають «кофеїновою ямою»." },
    { id: "p6", tag: "p", text: "Єдиний фізіологічний механізм елімінації аденозину — це сон. Під час глибокого сну його концентрація знижуеться до вихідного рівня, і вранці тиск сну починає рости з нуля." }
  ];

  // In document order.
  const S = [
    { id: "s1", type: "clarity", block: "p1",
      from: "Протягом періоду неспання в позаклітинному просторі базальних відділів переднього мозку відбувається прогресивна акумуляція аденозину — нуклеозиду, що утворюється внаслідок гідролізу аденозинтрифосфату.",
      to: "Поки ми не спимо, у мозку поступово накопичується аденозин — речовина, що залишається, коли клітини витрачають енергію.",
      reason: "Три терміни поспіль в одному реченні. Сенс збережено, анатомічні деталі прибрано." },
    { id: "s2", type: "accent", block: "p1", from: "тим більше його накопичується",
      reason: "Головна теза абзацу." },
    { id: "s3", type: "spell", block: "p2", from: "відчуваемо", to: "відчуваємо",
      reason: "Орфографічна помилка: «є» замість «е»." },
    { id: "s4", type: "accent", block: "p2", from: "тиском сну",
      reason: "Термін, на який спирається решта розділу." },
    { id: "s5", type: "structure", block: "p3", title: "Як кофеїн обманює мозок",
      reason: "Тут текст переходить від аденозину до кофеїну — читачеві потрібна нова точка входу." },
    { id: "s6", type: "clarity", block: "p3",
      from: "Кофеїн є конкурентним антагоністом аденозинових рецепторів: його молекула структурно подібна до аденозину, тож вона займає рецептор, але не активує його.",
      to: "Молекула кофеїну схожа на аденозин, тому вона займає його місце на рецепторі — але не вмикає сигнал утоми.",
      reason: "«Конкурентний антагоніст» нічого не каже читачеві без фармакологічної підготовки." },
    { id: "s7", type: "accent", block: "p3", from: "мозок просто тимчасово перестає її помічати",
      reason: "Висновок, який варто запам’ятати." },
    { id: "s8", type: "interest", block: "p3", kind: "Аналогія", title: "Ключ, що застряг у замку",
      body: "Уявіть, що аденозин — це ключ, який відмикає двері до сну. Кофеїн — схожий ключ: він входить у замок, але не повертається. Двері зачинені, а справжній ключ уже не вставити.",
      reason: "Механізм абстрактний; побутова аналогія допоможе його утримати." },
    { id: "v1", type: "visual", block: "p3", intent: "info", style: "minimal", title: "Кофеїн займає місце аденозину",
      prompt: "Схема рецептора в мембрані нейрона у два кадри. Ліворуч: молекула аденозину входить у рецептор, підпис «сигнал утоми ввімкнено». Праворуч: молекула кофеїну займає той самий рецептор, аденозин лишається зовні, підпис «сигнал заблоковано». Без зайвих деталей, підписи українською.",
      caption: "Кофеїн займає рецептор аденозину, але не вмикає сигнал утоми.",
      reason: "Механізм легше побачити, ніж прочитати: два кадри «до» і «після» замінять абзац пояснень." },
    { id: "s9", type: "fact", block: "p4",
      from: "кофеїн виводиться з організму повністю вже за дві години, тому чашка кави по обіді ніяк не впливає на нічний сон",
      to: "період напіввиведення кофеїну становить у середньому близько п’яти годин, тому чашка кави по обіді може погіршити нічний сон",
      reason: "Сумнівне твердження: за дві години кофеїн не виводиться. Запропоноване формулювання потребує джерела перед публікацією." },
    { id: "s10", type: "structure", block: "p5", title: "Борг, який доведеться повернути",
      reason: "Починається розповідь про наслідки — логічна межа підрозділу." },
    { id: "s11", type: "clarity", block: "p5",
      from: "Коли дія кофеїну завершується, накопичений аденозин одномоментно отримує доступ до вивільнених рецепторів, що маніфестує різким зниженням рівня бадьорості.",
      to: "Коли кофеїн перестає діяти, весь накопичений аденозин одразу потрапляє на вільні рецептори — і бадьорість різко падає.",
      reason: "Канцелярит («маніфестує», «одномоментно») замінено простими дієсловами." },
    { id: "v2", type: "visual", block: "p5", intent: "illu", style: "gradient", title: "Кофеїнова яма",
      prompt: "Людина за робочим столом по обіді: порожня чашка кави, важкі повіки, а за спиною здіймається хвиля, що от-от накриє. Спокійна, трохи іронічна ілюстрація без тексту.",
      caption: "Коли кофеїн відпускає, накопичена втома повертається вся одразу.",
      reason: "Абзац описує відчуття, знайоме кожному. Ілюстрація дасть читачеві перепочити після щільного пояснення." },
    { id: "s12", type: "clarity", block: "p6",
      from: "Єдиний фізіологічний механізм елімінації аденозину — це сон.",
      to: "Позбутися аденозину можна лише одним способом — поспати.",
      reason: "«Механізм елімінації» — зайвий термін для простої думки." },
    { id: "s13", type: "spell", block: "p6", from: "знижуеться", to: "знижується",
      reason: "Орфографічна помилка: «є» замість «е»." },
    { id: "s14", type: "accent", block: "p6", from: "вранці тиск сну починає рости з нуля",
      reason: "Замикає думку, розпочату в другому абзаці." }
  ].map((s) => Object.assign(s, { status: "pending" }));

  // Visuals carry editable state on top of status; V0 keeps the sample values for reset.
  const V0 = {};
  const blank = { quality: "fast", gen: 0, shot: null, stale: false, busy: false };
  S.filter((s) => s.type === "visual").forEach((s) => {
    V0[s.id] = { intent: s.intent, style: s.style, prompt: s.prompt, caption: s.caption };
    Object.assign(s, blank);
  });

  // Read-only chapter overview; `type` names the pass that addresses the problem.
  const DIAG = [
    { type: "clarity", title: "Щільна термінологія", text: "Чотири абзаци з шести написані мовою наукової статті: «акумуляція», «конкурентний антагоніст», «маніфестує».", run: "Спростити мову" },
    { type: "structure", title: "Суцільний текст", text: "Шість абзаців без жодного підзаголовка, хоча тема змінюється двічі.", run: "Додати підзаголовки" },
    { type: "fact", title: "Сумнівне твердження", text: "«Кофеїн виводиться за дві години» суперечить відомим даним.", run: "Перевірити факти" },
    { type: "visual", title: "Механізм без образу", text: "Ключове пояснення про рецептори абстрактне: бракує схеми або аналогії.", run: "Запропонувати візуали" },
    { type: "spell", title: "Орфографічні помилки", text: "Дві: «відчуваемо», «знижуеться».", run: "Перевірити правопис" }
  ];
  // How hard each paragraph is for a lay reader (0-100); `fix` is the suggestion that removes the stumble.
  const READ = {
    p1: { heat: 92, why: "Три терміни поспіль в одному довгому реченні.", fix: "s1" },
    p2: { heat: 38, why: "Читається легко; є одна орфографічна помилка.", fix: "s3" },
    p3: { heat: 78, why: "На «конкурентному антагоністі» читач без підготовки зупиниться.", fix: "s6" },
    p4: { heat: 30, why: "Мова проста, але твердження про дві години сумнівне.", fix: "s9" },
    p5: { heat: 84, why: "Канцелярит: «одномоментно», «маніфестує».", fix: "s11" },
    p6: { heat: 55, why: "«Механізм елімінації» замість простого слова.", fix: "s12" }
  };

  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const subs = [];
  const undos = [];
  let toastTimer = null;
  let studioId = null;

  const O = {
    TYPES, STYLES, INTENTS, DIAG, READ, blocks, S, esc, log: [],
    get: (id) => S.find((s) => s.id === id),
    pending: (f) => S.filter((s) => s.status === "pending" && (!f || f(s))),
    count: (status) => S.filter((s) => s.status === status).length,
    on(fn) { subs.push(fn); },
    emit() { subs.forEach((fn) => fn()); },

    set(ids, status, word) {
      ids = [].concat(ids);
      if (!ids.length) return;
      const prev = ids.map((id) => [id, O.get(id).status]);
      ids.forEach((id) => { O.get(id).status = status; });
      if (status !== "pending") {
        word = word || (status === "accepted" ? "Прийнято" : "Відхилено");
        const types = [...new Set(ids.map((id) => TYPES[O.get(id).type].label))].join(", ");
        O.log.push(word + " · " + types + (ids.length > 1 ? " · " + ids.length : ""));
        undos.push(() => { prev.forEach(([id, st]) => { O.get(id).status = st; }); O.log.push("Скасовано: " + word.toLowerCase()); });
        O.toast(ids.length > 1 ? word + " · " + ids.length : word, O.undo);
      }
      O.emit();
    },
    undo() {
      const fn = undos.pop();
      const t = document.getElementById("toast");
      if (t) t.className = "";
      if (!fn) return O.toast("Немає що скасовувати");
      fn();
      O.emit();
    },
    reset() {
      S.forEach((s) => { s.status = "pending"; if (V0[s.id]) Object.assign(s, V0[s.id], blank); });
      undos.length = 0; O.log.length = 0;
      O.studio(null);
      O.emit();
    },

    applied: (s) => (s.type === "accent" ? "<b>" + esc(s.from) + "</b>" : esc(s.to)),

    mark(s, focused) {
      const cls = "sg sg-" + s.type + (focused ? " is-focus" : "");
      if (s.type === "accent") return `<span class="${cls}" data-s="${s.id}">${esc(s.from)}</span>`;
      return `<span class="${cls}" data-s="${s.id}"><del>${esc(s.from)}</del><ins>${esc(s.to)}</ins></span>`;
    },

    // Replace every inline suggestion span of a block with fn(s).
    inline(b, fn) {
      let html = esc(b.text);
      const mine = S.filter((s) => s.block === b.id && s.from);
      mine.forEach((s) => { html = html.replace(esc(s.from), "\u0001" + s.id + "\u0002"); });
      mine.forEach((s) => { html = html.replace("\u0001" + s.id + "\u0002", () => fn(s)); });
      return html;
    },

    heading(s, ghost, focused) {
      if (!ghost) return `<h2>${esc(s.title)}</h2>`;
      return `<h2 class="sg ghost-h${focused ? " is-focus" : ""}" data-s="${s.id}"><span class="lvl">H2</span>${esc(s.title)}</h2>`;
    },
    // Honest stand-in for a generated image: no model runs in these prototypes.
    frame(s, mini) {
      if (s.busy) return `<div class="ph ph-busy"><span class="spin"></span><span>Імітація генерування…</span></div>`;
      if (!s.gen) return `<div class="ph ph-empty"><span>${mini ? "Ще не згенеровано" : "Зображення ще не згенеровано"}</span></div>`;
      const g = s.shot;
      return `<div class="ph ph-${g.style}" role="img" aria-label="Заглушка прототипу"><span class="ph-tag">Прототип · заглушка</span>` +
        (mini ? "" : `<b>Тут буде ${g.intent === "info" ? "інфографіка" : "ілюстрація"}</b><span>Модель зображень не викликалась.</span>`) +
        `<span class="ph-meta">${STYLES[g.style]} · ${g.quality === "fast" ? "швидко" : "якість"} · варіант ${s.gen}</span></div>`;
    },
    figure(s, ghost, focused) {
      const cap = `<figcaption data-cap="${s.id}">${esc(s.caption)}</figcaption>`;
      if (!ghost) return `<figure class="fig">${O.frame(s)}${cap}<button class="btn fig-edit" data-studio="${s.id}">Змінити</button></figure>`;
      return `<figure class="fig sg ghost-fig${focused ? " is-focus" : ""}" data-s="${s.id}"><span class="kind">Візуал · ${INTENTS[s.intent]}</span><b>${esc(s.title)}</b>${cap}<button class="btn" data-studio="${s.id}">Відкрити студію</button></figure>`;
    },
    // Visual editor: preview + intent, prompt, style, speed, caption. Clicks and typing are handled once, below.
    vz(s, roomy) {
      const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-va="${k}:${v}" class="${s[k] === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
      const acts = s.status === "accepted"
        ? `<span class="done">✓ У тексті</span><button class="btn ghost" data-va="remove">Прибрати з тексту</button>`
        : `<button class="btn primary" data-va="insert"${s.gen && !s.busy ? "" : " disabled"}>Вставити в текст</button><button class="btn ghost" data-va="reject">Відхилити</button>`;
      return `<div class="vz${roomy ? " vz-roomy" : ""}${s.stale ? " is-stale" : ""}" data-vz="${s.id}">
        <div class="vz-view">${O.frame(s)}<p class="vz-cap" data-cap="${s.id}">${esc(s.caption)}</p></div>
        <div class="vz-form">
          <div class="vz-row">${seg("intent", Object.entries(INTENTS))}${seg("quality", [["fast", "Швидко"], ["quality", "Якість"]])}</div>
          <label>Промпт<textarea data-vf="prompt" rows="${roomy ? 9 : 4}">${esc(s.prompt)}</textarea></label>
          <div class="vz-row">${Object.keys(STYLES).map((k) => `<button type="button" class="chip${s.style === k ? " on" : ""}" data-va="style:${k}"><i class="sw sw-${k}"></i>${STYLES[k]}</button>`).join("")}</div>
          <label>Підпис<input data-vf="caption" value="${esc(s.caption)}"></label>
          <p class="vz-stale">Промпт або налаштування змінено після генерування — перегенеруйте.</p>
          <div class="vz-row">
            <button class="btn" data-va="gen"${s.busy ? " disabled" : ""}>${s.gen ? "Перегенерувати" : "Згенерувати"}</button>${acts}
            ${roomy ? "" : `<button class="btn ghost" data-va="expand" title="Просторий перегляд">⤢ Студія</button>`}
          </div>
        </div></div>`;
    },
    // Roomy overlay around the same editor.
    studio(id) {
      studioId = id || null;
      let el = document.getElementById("studio");
      if (!el) {
        if (!studioId) return;
        el = document.createElement("div"); el.id = "studio";
        el.innerHTML = `<div class="st-box" role="dialog" aria-label="Студія візуалу" tabindex="-1"></div>`;
        document.body.appendChild(el);
        // Keep page-level shortcuts (Enter, Backspace) away from the prompt field.
        el.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") O.studio(null); });
        el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) O.studio(null); });
      }
      renderStudio();
    },
    studioOpen: () => !!studioId,

    what(s) {
      if (s.type === "structure") return "Підзаголовок: «" + esc(s.title) + "»";
      if (s.type === "interest") return esc(s.kind) + ": «" + esc(s.title) + "»";
      if (s.type === "visual") return INTENTS[s.intent] + ": «" + esc(s.title) + "»";
      if (s.type === "accent") return "Виділити: «" + esc(s.from) + "»";
      return "";
    },
    diff: (s) => (s.to ? `<del>${esc(s.from)}</del> <ins>${esc(s.to)}</ins>` : O.what(s)),
    // List row for a suggestion; `inner` lets a page tuck an editor inside it.
    item(s, inner) {
      const acts = `<button class="icon-btn no" data-a="rejected" title="Відхилити">✕</button>` + (s.type === "visual"
        ? `<button class="btn" data-vopen="${s.id}">${inner ? "Згорнути" : "Відкрити"}</button>`
        : `<button class="icon-btn yes" data-a="accepted" title="Прийняти">✓</button>`);
      const what = O.what(s);
      return `<li class="it" data-s="${s.id}"><div class="it-top">${O.tag(s.type)}<span class="acts">${acts}</span></div>${what ? `<b>${what}</b>` : ""}<p>${esc(s.reason)}</p>${inner || ""}</li>`;
    },

    callout(s, ghost, focused) {
      const cls = ghost ? "callout sg ghost-callout" + (focused ? " is-focus" : "") : "callout";
      return `<aside class="${cls}" data-s="${s.id}"><span class="kind">${esc(s.kind)}</span><b>${esc(s.title)}</b><p>${esc(s.body)}</p></aside>`;
    },

    // o.show(s): is a pending suggestion visible; o.focus: focused id; o.mark: inline mark renderer.
    // o.render: per-type overrides for block-level suggestions ({ structure, interest, visual }).
    blockHtml(b, o) {
      o = o || {};
      const show = o.show || (() => true);
      const R = Object.assign({ structure: O.heading, interest: O.callout, visual: O.figure }, o.render);
      const blockLevel = (type, render = R[type]) => S.filter((s) => s.block === b.id && s.type === type).map((s) => {
        if (s.status === "accepted") return render(s, false);
        if (s.status === "pending" && show(s)) return render(s, true, o.focus === s.id);
        return "";
      }).join("");
      return blockLevel("structure") + O.para(b, o) + blockLevel("interest") + blockLevel("visual");
    },
    para(b, o) {
      o = o || {};
      const show = o.show || (() => true);
      const mark = o.mark || O.mark;
      const body = O.inline(b, (s) => {
        if (s.status === "accepted") return O.applied(s);
        if (s.status === "pending" && show(s)) return mark(s, o.focus === s.id);
        return esc(s.from);
      });
      return `<${b.tag} data-b="${b.id}">${body}</${b.tag}>`;
    },
    doc: (o) => blocks.map((b) => O.blockHtml(b, o)).join(""),

    tag: (type) => `<span class="tag"><i style="background:${TYPES[type].color}"></i>${TYPES[type].label}</span>`,

    chips(el, cur, pick, f) {
      const p = O.pending(f);
      const items = [["all", "Усі", p.length]].concat(
        Object.keys(TYPES).map((k) => [k, TYPES[k].label, p.filter((s) => s.type === k).length])
      );
      el.innerHTML = items.map(([k, label, n]) =>
        `<button class="chip${cur === k ? " on" : ""}" data-k="${k}">${k !== "all" ? `<i style="background:${TYPES[k].color}"></i>` : ""}${label} <span>${n}</span></button>`
      ).join("");
      el.onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) pick(b.dataset.k); };
    },

    header(key) {
      const names = { 1: "Панель редактора", 2: "Стрічка", 3: "Редакторський аркуш", 4: "Три вкладки", 5: "Поля з обох боків" };
      const r1 = { a: "Поля", b: "Черга", c: "Команда" };
      const r2 = { "r2-1": "Поля і команда", "r2-2": "Очима читача", "r2-3": "Розкадровка", "r2-4": "Розмова", "r2-5": "Сторінка" };
      const old = r1[key] ? "раунд 1 · " + key.toUpperCase() + " · " + r1[key] : r2[key] ? "раунд 2 · " + key.slice(3) + " · " + r2[key] : "";
      document.getElementById("hd").innerHTML =
        `<a class="brand" href="index.html"><span>Orest<i> Edit</i></span><em>v2 · прототип</em></a>` +
        `<nav>${Object.keys(names).map((k) => `<a href="${k}.html" class="${k === String(key) ? "on" : ""}"><b>${k}</b><span>${names[k]}</span></a>`).join("")}` +
        `${old ? `<span class="r1">${old}</span>` : ""}</nav>` +
        `<span class="tools"><button class="btn ghost" id="undo" title="Скасувати останню дію">↶</button>` +
        `<button class="btn ghost" id="histb" title="Історія змін">◷<span> Історія</span></button>` +
        `<button class="btn ghost" id="docx" title="Імпорт і експорт DOCX">⇅<span> DOCX</span></button></span>` +
        `<button class="btn ghost" id="reset" title="Скинути прототип">⟲<span> Скинути</span></button><div id="hist"></div>`;
      const hist = document.getElementById("hist");
      document.getElementById("reset").onclick = O.reset;
      document.getElementById("undo").onclick = O.undo;
      document.getElementById("docx").onclick = () => O.toast("Тут буде імпорт і експорт DOCX. У прототипі не працює.");
      document.getElementById("histb").onclick = () => {
        hist.innerHTML = `<b>Історія змін</b>` + (O.log.length ? `<ol>${O.log.slice().reverse().map((l) => `<li>${l}</li>`).join("")}</ol>` : `<p>Змін ще немає.</p>`);
        hist.classList.toggle("on");
      };
      document.addEventListener("click", (e) => { if (!e.target.closest("#hist, #histb")) hist.classList.remove("on"); });
    },

    toast(msg, undo) {
      let el = document.getElementById("toast");
      if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
      el.innerHTML = `<span>${msg}</span>` + (undo ? `<button>Скасувати</button>` : "");
      el.className = "on" + (undo ? "" : " plain");
      if (undo) el.querySelector("button").onclick = undo;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.className = ""; }, 4000);
    },

    // Cross-highlight every element that shares a data-s id, without re-rendering.
    hover(root) {
      root.addEventListener("mouseover", (e) => {
        const t = e.target.closest("[data-s]");
        root.querySelectorAll(".is-hot").forEach((n) => n.classList.remove("is-hot"));
        if (t) root.querySelectorAll(`[data-s="${t.dataset.s}"]`).forEach((n) => n.classList.add("is-hot"));
      });
    }
  };

  function renderStudio() {
    const el = document.getElementById("studio");
    if (!el) return;
    const s = studioId && O.get(studioId);
    el.className = s ? "on" : "";
    const box = el.firstChild;
    box.innerHTML = s ? `<header><div>${O.tag("visual")}<b>${esc(s.title)}</b><p>${esc(s.reason)}</p></div><button class="icon-btn" data-close title="Закрити">✕</button></header>${O.vz(s, true)}` : "";
    if (s && !box.contains(document.activeElement)) box.focus();
  }
  subs.push(renderStudio);

  document.addEventListener("click", (e) => {
    const st = e.target.closest("[data-studio]");
    if (st) return O.studio(st.dataset.studio);
    const b = e.target.closest("[data-va]");
    const root = b && b.closest("[data-vz]");
    if (!root) return;
    const s = O.get(root.dataset.vz);
    const [k, v] = b.dataset.va.split(":");
    if (k === "gen") {
      if (s.busy) return;
      s.busy = true; O.emit();
      setTimeout(() => {
        Object.assign(s, { busy: false, stale: false, gen: s.gen + 1, shot: { intent: s.intent, style: s.style, quality: s.quality } });
        O.emit();
      }, 900);
    } else if (k === "insert") { if (s.gen) { O.studio(null); O.set(s.id, "accepted", "Вставлено в текст"); } }
    else if (k === "reject") { O.studio(null); O.set(s.id, "rejected"); }
    else if (k === "remove") O.set(s.id, "pending");
    else if (k === "expand") O.studio(s.id);
    else { s[k] = v; if (s.gen) s.stale = true; O.emit(); }
  });
  // Typing must not re-render (it would drop focus): write state and patch the few dependent nodes.
  document.addEventListener("input", (e) => {
    const root = e.target.closest && e.target.closest("[data-vz]");
    const f = root && e.target.dataset.vf;
    if (!f) return;
    const s = O.get(root.dataset.vz);
    s[f] = e.target.value;
    if (f === "caption") document.querySelectorAll(`[data-cap="${s.id}"]`).forEach((n) => { n.textContent = s.caption; });
    else if (s.gen) { s.stale = true; document.querySelectorAll(`[data-vz="${s.id}"]`).forEach((n) => n.classList.add("is-stale")); }
  });

  window.O = O;
})();
