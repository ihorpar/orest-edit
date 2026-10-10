import type { AppLocale } from "../i18n/product-locale.ts";
import { EN } from "./copy-en.ts";

/**
 * v2 interface copy. Ukrainian is the source catalog and defines the shape (`V2Copy`); the English catalog
 * in `copy-en.ts` is typed against it, so a key missing there fails the type check.
 */
const PASS_IDS = ["structure", "clarity", "interest", "formatting", "visual", "accent", "spell"] as const;

/** Passes shown as rows in the `Правки` tab. */
export type V2PassRowId = (typeof PASS_IDS)[number];

export interface V2PassCopy {
  id: V2PassRowId;
  name: string;
  text: string;
}

/** One line of the hotkeys popup: the keys (already written for display) and what they do. */
export interface V2HotkeyCopy {
  keys: string;
  text: string;
}

const UK = {
  /** BCP 47 tag for dates and numbers. */
  dateLocale: "uk-UA",
  stats: (words: number, paragraphs: number): string =>
    `${words} ${pluralizeUk(words, "слово", "слова", "слів")} · ${paragraphs} ${pluralizeUk(paragraphs, "абзац", "абзаци", "абзаців")}`,
  brand: "Orest Edit",
  untitledSource: "Рукопис",
  untitledChapter: "Без заголовка",
  saved: "Збережено",
  saving: "Зберігаю…",
  saveFailed: "Не вдалося зберегти чернетку",
  undo: "Скасувати",
  redo: "Повторити",
  history: "Історія",
  historyTitle: "Прийняті зміни",
  more: "Ще",
  moreTitle: "Інші дії",
  menuMore: {
    replace: "Знайти й замінити",
    hotkeys: "Гарячі клавіші",
    clear: "Очистити документ",
    recoveryHeld: (count: number): string =>
      `Можна повернути: ${count} ${pluralizeUk(count, "замінений документ", "замінені документи", "замінених документів")}`,
    restoreOne: (reason: "clear" | "open", time: string, excerpt: string): string =>
      `${reason === "clear" ? "Повернути очищений о" : "Повернути замінений о"} ${time}${excerpt ? ` — «${excerpt}»` : ""}`
  },
  historyPanel: {
    title: "Історія змін",
    empty: "Прийнятих правок ще немає.",
    before: "Було",
    after: "Стало",
    nothingBefore: "Блок додано.",
    nothingAfter: "Блок прибрано.",
    back: "До списку",
    close: "Закрити",
    open: (label: string): string => `Порівняти: ${label}`,
    count: (count: number): string => `${count} ${pluralizeUk(count, "зміна", "зміни", "змін")}`,
    blocks: (count: number): string => `${count} ${pluralizeUk(count, "блок", "блоки", "блоків")}`,
    image: "Зображення",
    divider: "Роздільник",
    table: "Таблиця",
    kinds: {
      replace: "Правка тексту",
      heading: "Підзаголовок",
      accent: "Акцент",
      callout: "Врізка",
      spell: "Правопис",
      visual: "Ілюстрація",
      visualReplace: "Заміна ілюстрації",
      visualRemove: "Ілюстрацію прибрано",
      caption: "Підпис ілюстрації",
      bulk: "Прийнято разом",
      globalReplace: "Пошук і заміна"
    },
    bulkLabel: (name: string, count: number): string => `${name} · ${count}`,
    replaceLabel: (find: string, replacement: string): string => `«${find}» → «${replacement}»`
  },
  replace: {
    title: "Знайти й замінити",
    find: "Знайти",
    with: "Замінити на",
    hint: "Пошук з урахуванням регістру.",
    count: (count: number): string => `${count} ${pluralizeUk(count, "збіг", "збіги", "збігів")}`,
    none: "Нічого не знайдено.",
    typeQuery: "Введіть, що шукати.",
    same: "Текст заміни такий самий.",
    action: "Замінити всі",
    done: (count: number): string => `Замінено: ${count}`,
    failed: "Текст змінився. Нічого не замінено.",
    close: "Закрити"
  },
  hotkeys: {
    title: "Гарячі клавіші",
    close: "Закрити",
    macNote: "На Mac замість Ctrl — клавіша ⌘.",
    groups: [
      {
        title: "Текст",
        items: [
          { keys: "Ctrl+B", text: "Напівжирний" },
          { keys: "Ctrl+I", text: "Курсив" },
          { keys: "Ctrl+Z", text: "Скасувати" },
          { keys: "Ctrl+Shift+Z / Ctrl+Y", text: "Повторити" },
          { keys: "Shift+Enter", text: "Новий рядок у тому самому абзаці" },
          { keys: "Ctrl+H", text: "Знайти й замінити" }
        ]
      },
      {
        title: "Виділений фрагмент",
        items: [
          { keys: "Alt+F10", text: "Перейти до дій для виділеного тексту" },
          { keys: "← →", text: "Наступна чи попередня дія" },
          { keys: "Esc", text: "Повернутися до тексту" }
        ]
      },
      {
        title: "Панель",
        items: [
          { keys: "F6", text: "Перейти між текстом, панеллю і повідомленням" },
          { keys: "← →", text: "Сусідня вкладка (коли фокус на вкладках)" },
          { keys: "Enter", text: "На картці: показати правку" },
          { keys: "Ctrl+/", text: "Цей список" }
        ]
      },
      {
        title: "Тихий режим",
        items: [
          { keys: "Enter", text: "Прийняти показану правку або підготувати її" },
          { keys: "Backspace / Delete", text: "Відхилити" },
          { keys: "← →", text: "Попередня чи наступна пропозиція" }
        ]
      },
      {
        title: "Студія ілюстрації",
        items: [
          { keys: "Enter", text: "На картці ілюстрації: відкрити студію" },
          { keys: "Tab", text: "Наступний елемент студії або повідомлення" },
          { keys: "Esc", text: "Закрити студію" }
        ]
      }
    ] as Array<{ title: string; items: V2HotkeyCopy[] }>
  },
  confirm: {
    cancel: "Скасувати",
    clearTitle: "Очистити документ?",
    clearText: "Текст, пропозиції, звіти та історію буде прибрано.",
    recoveryKept: "Документ можна буде повернути через меню «Ще», доки сторінку не перезавантажено.",
    recoveryDropsOldest: (time: string): string => `Найстаріший збережений документ (${time}) повернути вже не вдасться.`,
    recoveryNone: "Поточну чернетку повернути не вдасться.",
    clearAction: "Очистити",
    openTitle: "Замінити поточний текст?",
    openText: "Новий текст замінить поточний разом із пропозиціями, звітами та історією.",
    openAction: "Замінити",
    restartTitle: "Почати заново?",
    restartText: "Збережені дані пошкоджено. Їх буде видалено, відкриється порожній документ.",
    restartAction: "Видалити й почати заново",
    restart: "Почати заново",
    restartFailed: "Не вдалося почати заново.",
    cleared: "Документ очищено.",
    restore: "Повернути",
    restored: "Документ повернуто.",
    restoreFailed: "Не вдалося повернути попередній документ.",
    restoreWrongLocale: "Цей документ збережено для іншої мови інтерфейсу."
  },
  a11y: {
    panel: "Помічник редактора",
    toast: "Повідомлення",
    live: {
      passDone: (name: string, count: number): string =>
        count > 0
          ? `«${name}»: готово, ${count} ${pluralizeUk(count, "пропозиція", "пропозиції", "пропозицій")}.`
          : `«${name}»: готово, пропозицій немає.`,
      passFailed: (name: string): string => `«${name}»: не завершено, сталася помилка.`,
      proposalReady: "Правку підготовлено й показано в тексті.",
      proposalFailed: "Правку не підготовлено: сталася помилка.",
      imageReady: "Зображення готове.",
      imageFailed: "Зображення не згенеровано: сталася помилка.",
      promptReady: "Промпт для ілюстрації готовий.",
      promptFailed: "Промпт для ілюстрації не підготовлено: сталася помилка."
    }
  },
  classic: "Класична версія",
  classicTitle: "Попередня версія редактора",
  open: "Відкрити",
  openFile: "Файл .docx або .txt",
  openClipboard: "Вставити з буфера обміну",
  export: "Експорт",
  exportDocx: "Word (.docx)",
  exportTxt: "Текст (.txt)",
  dismiss: "Закрити",
  loading: "Відкриваю чернетку…",
  placeholder: "Почніть писати або відкрийте файл.",
  manuscriptLabel: "Текст рукопису",
  imageMissing: "Зображення не знайдено в цьому браузері",
  contentError: "Чернетку пошкоджено — відкрити не вдалося.",
  draftUnreadable: "Збережену чернетку не вдалося прочитати.",
  conflict: "Чернетку змінено в іншій вкладці. Тут збереження зупинено.",
  reload: "Перезавантажити",
  savePaused: "Автозбереження зупинено",
  draftNotOpened: "Чернетку не відкрито",
  draftReadFailed: "Не вдалося прочитати чернетку з цього браузера.",
  imageInsertFailed: "Не вдалося додати зображення.",
  toolbar: {
    label: "Форматування",
    blockType: "Стиль абзацу",
    paragraph: "Звичайний текст",
    heading1: "Заголовок 1",
    heading2: "Заголовок 2",
    heading3: "Заголовок 3",
    bulletList: "Маркований список",
    orderedList: "Нумерований список",
    callout: "Врізка",
    otherBlock: "Блок",
    bold: "Напівжирний",
    italic: "Курсив",
    insertCallout: "Додати врізку",
    insertImage: "Додати зображення"
  },
  tabs: {
    overview: "Огляд",
    edits: "Правки",
    ask: "Запит"
  },
  overview: {
    title: "Огляд розділу",
    diagnostics: "Діагностика",
    diagnosticsText: "Що заважає читачеві",
    diagnosticsAction: "Прочитати розділ",
    mode: "Глибина звіту",
    modeConcise: "По суті",
    modeExtended: "Розширена",
    modeConciseHint: "Короткий звіт",
    modeExtendedHint: "Докладний звіт; готується довше",
    starting: "Запускаю…",
    diagnosticsRunning: "Читаю розділ…",
    diagnosticsFailed: "Діагностику не завершено.",
    diagnosticsStopped: "Діагностику зупинено.",
    diagnosticsEmpty: "Модель повернула порожній звіт діагностики.",
    reportMeta: (mode: string, date: string) => (date ? `${mode} · ${date}` : mode),
    rerun: "Прочитати ще раз",
    stop: "Зупинити",
    shortcuts: "Запустити перевірку",
    shortcutTitle: (name: string) => `Запустити «${name}»`,
    busyRun: (name: string) => `Зачекайте: виконується «${name}».`,
    busyQueue: "Зачекайте: виконуються перевірки.",
    factCheck: "Перевірка фактів",
    factCheckText: "Сумнівні твердження",
    factCheckAction: "Перевірити",
    factRunning: "Перевіряю твердження…",
    factFailed: "Перевірку фактів не завершено.",
    factStopped: "Перевірку фактів зупинено.",
    factCount: (count: number) => `${count} ${pluralizeUk(count, "знахідка", "знахідки", "знахідок")}`,
    factNoneTitle: "Сумнівних тверджень не знайдено",
    factNoneText: (checked: number) => (checked > 0 ? `Перевірено тверджень: ${checked}.` : "Перевірка шукає лише явні помилки."),
    factRerun: "Перевірити ще раз",
    statusQuestionable: "сумнівне",
    statusUnsupported: "не підтверджено",
    sources: "Джерела",
    noSource: "Немає надійного джерела",
    toEdit: "До правки",
    toEditDecided: "Правку вирішено",
    toEditMissing: "Цього твердження вже немає в тексті.",
    askAuthor: "Запит до автора",
    askAuthorAdded: "У запитах до автора",
    authorTitle: "Запити до автора",
    authorAdded: "Додано до запитів до автора.",
    authorNoteLabel: "Примітка для автора",
    authorNotePlaceholder: "Примітка для автора (необов’язково)",
    authorRemove: "Прибрати",
    copyAll: "Скопіювати все",
    copied: "Скопійовано.",
    copyFailed: "Не вдалося скопіювати.",
    copyText: {
      heading: (chapterTitle: string) => `Запити до автора — «${chapterTitle}»`,
      note: "Коментар редактора",
      why: "Чому виникло питання",
      sources: "Джерела",
      noSource: "Надійного джерела не знайдено"
    },
    runNames: { diagnostics: "Діагностика", fact_check: "Перевірка фактів", request: "Власний запит" }
  },
  edits: {
    passes: "Перевірки",
    run: "Запустити",
    rerun: "Ще раз",
    rerunTitle: "Запустити знову",
    stop: "Зупинити",
    starting: "запускаю",
    reading: "читаю",
    readingProgress: (done: number, total: number) => `читаю · ${done} з ${total}`,
    done: "готово",
    stopped: "зупинено",
    failed: "помилка",
    openCountTitle: "Чекають рішення",
    notLive: "Ще не підключено",
    soon: "незабаром",
    runAll: "Запустити всі",
    runAllTitle: "Запустити всі перевірки по черзі",
    stopAll: "Зупинити всі",
    queued: "у черзі",
    queuedPaused: "у черзі · пауза",
    resumeQueue: "Продовжити чергу",
    resumeQueueTitle: "Запустити перевірки, що чекали",
    clearQueue: "Очистити чергу",
    restore: "Повернути",
    ignored: "Слово залишено як є.",
    reasonAccent: "Ключова фраза абзацу.",
    reasonMissing: "Модель не пояснила цю правку.",
    unqueue: "Прибрати",
    unqueueTitle: "Прибрати з черги",
    checking: "перевіряю",
    runFailed: "Перевірку не завершено.",
    runWarnings: (count: number) => `Модель не обробила фрагментів: ${count}.`,
    queue: "Пропозиції",
    emptyTitle: "Пропозицій поки немає",
    waitingTitle: "Модель читає розділ…",
    noneFoundTitle: "Пропозицій немає",
    allDecidedTitle: "Усе вирішено",
    filterDoneTitle: "Тут усе вирішено",
    filterOnly: (name: string) => `Лише «${name}»`,
    showAll: "показати всі",
    bulkAccept: (count: number) => `Прийняти всі · ${count}`,
    bulkAcceptTitle: "Прийняти всі правки, показані в тексті",
    bulkAccepted: (count: number) => `Прийнято: ${count}.`,
    bulkFailed: "Текст уже інший. Нічого не змінено.",
    quiet: "Тихий режим",
    quietTitle: "По одній правці, з клавіатури. Правки готуються автоматично.",
    quietPosition: (index: number, total: number) => `${index} з ${total}`,
    keyAccept: "прийняти",
    keyShow: "показати",
    keyReject: "відхилити",
    keyMove: "далі",
    previous: "Попередня",
    next: "Наступна",
    whatHeading: (title: string) => `Підзаголовок: «${title}»`,
    whatHeadingEmpty: "Підзаголовок без назви",
    whatAccent: (phrase: string) => `Виділити: «${phrase}»`,
    whatCallout: (kind: string, title: string) => `${kind}: «${title}»`,
    insert: "Вставити",
    whatVisual: (intent: string, title: string) => `${intent}: «${title}»`,
    openStudio: "Відкрити студію",
    keyStudio: "студія",
    visualPreparing: "Модель готує опис ілюстрації…",
    visualPromptFailed: "Ілюстрацію не підготовлено.",
    visualGenerating: "Генерую зображення…",
    visualGenerationFailed: "Зображення не згенеровано.",
    visualInterrupted: "Генерування перервано. Згенеруйте ще раз.",
    visualReady: "Зображення готове.",
    visualStale: "Налаштування змінено — згенеруйте знову.",
    visualGone: "Абзац видалено. Пропозицію можна лише відхилити.",
    headingLevel: "Рівень заголовка",
    headingEmpty: "Введіть назву підзаголовка в тексті.",
    headingGone: "Абзац видалено. Пропозицію можна лише відхилити.",
    accentStale: "Фрази вже немає або її вже виділено.",
    notDrawn: "Правку не показано в тексті — прийняти її не можна.",
    prepareCallout: "Підготувати врізку",
    preparingCallout: "Готую врізку…",
    calloutKind: "Тип врізки",
    calloutDepth: "Обсяг",
    calloutEmpty: "Модель повернула врізку без тексту.",
    spellSuggestions: "Варіанти виправлення",
    spellNoSuggestion: "Варіантів немає. Виправте вручну або залиште як є.",
    spellStale: "Слово змінено. Перевірте правопис ще раз.",
    ignore: "Залишити як є",
    addToDictionary: "Додати у словник",
    dictionaryAdded: (word: string) => `«${word}» додано у словник.`,
    dictionaryFailed: "Не вдалося додати слово у словник.",
    dictionaryReadFailed: "Не вдалося прочитати словник правопису.",
    spellEmpty: "У розділі немає тексту для перевірки.",
    summaryOpen: (count: number): string => (count === 1 ? "правка чекає" : "чекають рішення"),
    staleTag: "застаріла",
    staleVisualsNote: (count: number): string => `Ілюстрацій без місця в тексті: ${count}.`,
    dismissStale: (count: number): string => `Прибрати · ${count}`,
    dismissStaleTitle: "Прибрати ці ілюстрації з пропозицій",
    staleDismissed: (count: number): string => `Прибрано ілюстрацій: ${count}.`,
    summaryDecided: (count: number) => `вирішено ${count}`,
    whereParagraph: (label: string) => `абз. ${label}`,
    whereHeading: "заголовок",
    whereBlock: "блок",
    whereGone: "фрагмент змінено",
    accept: "Прийняти",
    reject: "Відхилити",
    show: "Показати правку",
    preparing: "Готую правку…",
    retry: "Спробувати ще раз",
    prepareAgain: "Підготувати знову",
    recommendation: "Що зробити",
    changeReason: "Що змінено",
    stale: "Текст змінено. Підготуйте правку знову.",
    staleGone: "Фрагмент видалено. Пропозицію можна лише відхилити.",
    proposalFailed: "Правку не підготовлено.",
    proposalUnsupported: "Цей тип пропозиції ще не підтримується.",
    noOpRepeat: "Модель повернула майже той самий текст. Уточніть завдання.",
    diffEmpty: "Модель не змінила текст. Уточніть завдання або відхиліть.",
    diffMismatch: "Текст уже інший, правку показати не вдалося. Перегенеруйте її.",
    acceptNeedsDiff: "Спершу покажіть правку в тексті.",
    regenerateFailed: "Не вдалося перегенерувати. Показано попередню правку.",
    unexpected: "Сталася неочікувана помилка.",
    refineLabel: "Уточнення для моделі",
    refinePlaceholder: "Наприклад: залиш термін, але поясни його",
    regenerate: "Перегенерувати",
    regenerateWithRefine: "Перегенерувати з уточненням",
    refinePending: "Уточнення не надіслано: перегенеруйте або зітріть його.",
    applyFailed: "Текст уже інший. Підготуйте правку знову.",
    accepted: "Правку прийнято.",
    rejected: "Пропозицію відхилено.",
    emptyDocument: "У розділі немає тексту.",
    anotherRun: "Зачекайте: виконується інша перевірка.",
    runElsewhere: "Ця перевірка виконується в іншій вкладці.",
    runOutdated: "Текст змінився. Запустіть перевірку ще раз.",
    stopFailed: "Сервер не підтвердив зупинку:",
    writeBlocked: "Чернетка не зберігається — дії ШІ вимкнено.",
    sourceNames: { fact: "Факти", request: "Запит" },
    passList: [
      { id: "structure", name: "Структура", text: "Підзаголовки там, де змінюється тема" },
      { id: "clarity", name: "Ясність", text: "Простіша мова без втрати змісту" },
      { id: "interest", name: "Врізки", text: "Аналогії та пояснення для читача" },
      { id: "formatting", name: "Списки", text: "Переліки там, де їх легше читати списком" },
      { id: "visual", name: "Ілюстрації", text: "Схеми й малюнки до складних місць" },
      { id: "accent", name: "Акценти", text: "Ключові фрази напівжирним" },
      { id: "spell", name: "Правопис", text: "Орфографія та одруківки" }
    ] as V2PassCopy[]
  },
  studio: {
    label: "Студія ілюстрації",
    close: "Закрити",
    tag: "Ілюстрації",
    ghostKind: (intent: string) => `Візуал · ${intent}`,
    edit: "Змінити",
    intent: "Тип зображення",
    intents: { infographic: "Інфографіка", illustration: "Ілюстрація" },
    quality: "Швидкість",
    prompt: "Промпт",
    promptPlaceholder: "Опишіть, що має бути на зображенні.",
    promptPreparing: "Готую промпт…",
    promptFailed: "Промпт не підготовлено.",
    promptRetry: "Спробувати ще раз",
    promptEmpty: "Напишіть промпт або",
    promptPrepare: "підготуйте автоматично",
    promptPrepareTitle: "Модель складе промпт за текстом абзацу",
    generateNeedsPrompt: "Потрібен промпт.",
    promptMismatch: (intent: string, style: string) => `Промпт написано для «${intent} · ${style}».`,
    promptRefresh: "Оновити промпт",
    promptRefreshTitle: "Модель напише промпт заново; ваші правки в ньому зникнуть",
    promptCancel: "Скасувати",
    style: "Стиль",
    caption: "Підпис",
    captionPlaceholder: "Підпис під зображенням (необов’язково)",
    captionSave: "Зберегти підпис",
    captionSaved: "Підпис оновлено.",
    generate: "Згенерувати",
    regenerate: "Перегенерувати",
    insert: "Вставити в текст",
    insertNeedsImage: "Спершу згенеруйте зображення.",
    insertNeedsFresh: "Налаштування змінено — перегенеруйте зображення.",
    reject: "Відхилити",
    inText: "У тексті",
    remove: "Прибрати з тексту",
    removed: "Ілюстрацію прибрано.",
    replace: "Замінити в тексті",
    replaceSame: "У тексті вже стоїть це зображення.",
    replaced: "Зображення замінено.",
    inserted: "Ілюстрацію вставлено.",
    applyFailed: "Місця для ілюстрації в тексті вже немає.",
    previewEmpty: "Зображення ще не згенеровано",
    previewStale: "Не відповідає поточним налаштуванням",
    previewMissing: "Зображення не знайдено. Згенеруйте ще раз.",
    previewLoading: "Відкриваю зображення…",
    generatingImage: "Створюю зображення…",
    previewBroken: "Зображення не вдалося показати",
    previewBrokenHint: "Спробуйте ще раз або перегенеруйте.",
    previewRetry: "Спробувати ще раз",
    whyGenerating: "Зображення ще створюється.",
    whyPreparing: "Промпт ще готується.",
    whyBroken: "Зображення не відкрилося.",
    whyLoading: "Зображення відкривається…",
    elapsed: (seconds: number) => `${seconds} с`,
    cancel: "Скасувати",
    cancelled: "Генерування скасовано.",
    generationFailed: "Зображення не згенеровано.",
    interrupted: "Генерування перервано. Згенеруйте ще раз.",
    manualLead: "Зображення додано вручну — можна змінити лише підпис.",
    figureGone: "Цієї ілюстрації в тексті вже немає.",
    alt: (title: string) => `Ілюстрація: ${title}`
  },
  api: {
    visualPromptInvalid: "Сервер повернув відповідь, яку не вдалося прочитати як опис для ілюстрації.",
    visualPromptEmpty: "Модель повернула порожню відповідь замість опису ілюстрації.",
    imageInvalid: "Сервер повернув відповідь, яку не вдалося прочитати як результат генерування зображення.",
    imageEmpty: "Генерування завершилося без зображення, і сервер не пояснив чому.",
    imageTimeout: "Модель зображень не відповіла вчасно. Спробуйте згенерувати ще раз.",
    assetFailed: "Зображення згенеровано, але його не вдалося зберегти в цьому браузері.",
    invalid: "Сервер повернув відповідь, яку не вдалося прочитати як стан перевірки.",
    platformTimeout: "Перевірка перевищила ліміт часу сервера. Запустіть перевірку ще раз.",
    pollTimeout: "Сервер не відповів на перевірку стану. Запуск зупинено, щоб він не завис.",
    wrongLocale: "Перевірку було створено для іншої мови застосунку. Запустіть перевірку ще раз.",
    resultInvalid: "Запуск завершився без коректної відповіді. Запустіть перевірку ще раз.",
    proposalInvalid: "Сервер повернув відповідь, яку не вдалося прочитати як правку.",
    spellInvalid: "Сервер повернув відповідь, яку не вдалося прочитати як результат перевірки правопису.",
    network: "Не вдалося з’єднатися із сервером.",
    localInvalid: "Сервер повернув відповідь, яку не вдалося прочитати як дію для фрагмента.",
    patchInvalid: "Сервер повернув відповідь, яку не вдалося прочитати як правку фрагмента.",
    patchNoOperations: "Модель не запропонувала жодної зміни для цього фрагмента.",
    patchFallback: "Сервер повернув запасну чернетку замість відповіді моделі. Її не показано."
  },
  ask: {
    title: "Власний запит",
    scope: "Увесь розділ",
    scopeFragment: (where: string) => `Фрагмент · ${where}`,
    unscope: "Увесь розділ",
    placeholder: "Що зробити з розділом?",
    placeholderFragment: "Що зробити з цим фрагментом?",
    send: "Надіслати",
    empty: "Напишіть запит.",
    examples: "Наприклад",
    ideas: ["Скороти вступ удвічі", "Додай приклад із життя", "Поясни терміни простіше"] as string[],
    quickTitle: "Швидкі дії для фрагмента",
    quick: {
      simplify: "Простіше",
      shorten: "Коротше",
      list: "Списком",
      subsection: "Підзаголовок",
      callout: "Врізка",
      visual: "Ілюстрація",
      spell: "Правопис"
    },
    own: "Свій запит",
    composerLabel: "Дії для виділеного фрагмента",
    fragmentRunning: (label: string) => `${label}: чекаю відповіді…`,
    cancel: "Скасувати",
    starting: "Запускаю…",
    planning: "Планую правки…",
    generating: (done: number, total: number) => `Готую правки · ${done} з ${total}`,
    generatingPlain: "Готую правки…",
    retrying: "Повторюю дію…",
    stop: "Зупинити",
    failed: "Запит не виконано.",
    stopped: "Запит зупинено.",
    history: "Попередні запити",
    outcomeRunning: "виконується…",
    outcomeDone: (count: number) =>
      count === 0 ? "Модель не запропонувала правок" : `${count} ${pluralizeUk(count, "правка", "правки", "правок")}`,
    outcomeHoles: (count: number) => `не виконано: ${count}`,
    outcomeStopped: "зупинено",
    outcomeQuestion: "потрібне уточнення",
    outcomeInterrupted: "перервано",
    showQueue: "Показати правки",
    holesTitle: "Не виконано",
    holeRetry: "Повторити",
    retryUnavailable: "Цю дію вже не можна повторити.",
    clarifyTitle: "Що зробити з фрагментом?",
    clarifyChoices: {
      patch: "Переписати текст",
      callout: "Підготувати врізку",
      visual: "Підготувати ілюстрацію",
      spellcheck: "Перевірити правопис"
    },
    clarifyDismiss: "Скасувати запит",
    fragmentBusy: "Зачекайте: попередній запит ще виконується.",
    scopeGone: "Фрагмент змінено. Виділіть текст ще раз.",
    scopeNotText: "Виділіть лише текст — без зображень, таблиць і врізок.",
    spellPartial: (count: number) => `Правопис перевірено не повністю (пропущено: ${count}).`,
    outcomeWarnings: (count: number) => `перевірено не повністю: ${count}`,
    patchUnusable: "Модель повернула правку не для цього фрагмента.",
    reasonFallback: "Модель не пояснила цю правку.",
    manualReason: (label: string) => `Ваш запит: ${label.toLocaleLowerCase("uk")}.`,
    customTitle: "Свій запит"
  },
  settings: "Налаштування"
};

export type V2Copy = typeof UK;

const CATALOGS: Record<AppLocale, V2Copy> = { uk: UK, en: EN };

export function getV2Copy(locale: AppLocale): V2Copy {
  return CATALOGS[locale] ?? UK;
}

/** Ukrainian plural: 1 слово, 2 слова, 5 слів. */
export function pluralizeUk(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }

  return many;
}

export function formatManuscriptStats(words: number, paragraphs: number, locale: AppLocale = "uk"): string {
  return getV2Copy(locale).stats(words, paragraphs);
}

/** A stored ISO time as the interface shows it; empty when the value is not a date. */
export function formatV2Date(value: string | undefined, locale: AppLocale, month: "long" | "short" = "long"): string {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(getV2Copy(locale).dateLocale, { day: "numeric", month, hour: "2-digit", minute: "2-digit" }).format(date);
}
