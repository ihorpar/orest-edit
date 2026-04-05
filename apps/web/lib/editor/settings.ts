import type { VisualStylePreset, WholeTextChangeLevel } from "./review-contract.ts";

export type ProviderId = "openai" | "gemini" | "anthropic";
export type ModelIdValidationState = "valid" | "missing" | "invalid";
export type SettingsConnectionState = "idle" | "checking" | "valid" | "missing_key" | "auth_error" | "model_error" | "network_error";
export type SettingsKeySource = "api_key" | "env" | "missing";

export interface ProviderModelPreset {
  id: string;
  label: string;
  description: string;
}

export interface EditorSettings {
  provider: ProviderId;
  modelId: string;
  apiKey: string;
  basePrompt: string;
  /** @deprecated Use expertisePrompt + cardsPrompt instead */
  reviewPrompt: string;
  expertisePrompt: string;
  cardsPrompt: string;
  reviewLevelGuide: string;
  calloutPromptTemplate: string;
  imagePromptTemplate: string;
}

export interface SettingsValidationResult {
  provider: ProviderId;
  modelId: string;
  state: Exclude<SettingsConnectionState, "idle" | "checking">;
  keySource: SettingsKeySource;
  message: string;
  validatedAt: string;
}

export const EDITOR_SETTINGS_STORAGE_KEY = "orest-editor-settings-v1";
export const VISUAL_STYLE_PRESET_STORAGE_KEY = "orest-visual-style-v1";
export const CUSTOM_MODEL_OPTION = "__custom__";
export const DEFAULT_VISUAL_STYLE_PRESET: VisualStylePreset = "calm_gradient";

const VISUAL_STYLE_PRESET_LABELS: Record<VisualStylePreset, string> = {
  minimal: "Мінімал",
  calm_gradient: "Спокійний градієнт",
  neo_brutal: "Нео-бруталізм",
  modern_glass: "Modern glass"
};

const VISUAL_STYLE_PRESET_GUIDES: Record<VisualStylePreset, string> = {
  minimal:
    "Суворий редакторський мінімалізм: багато повітря, чітка сітка, пласкі форми, тонкі контури, 2-3 стримані кольори, висока читабельність без декоративних ефектів.",
  calm_gradient:
    "Сучасний спокійний вигляд: м'які контрольовані градієнти, чистий фон, плавні переходи тону, акуратна ієрархія елементів, без шуму та без перевантаження декором.",
  neo_brutal:
    "Нео-бруталізм для інфографіки: контрастні пласкі кольорові блоки, смілива геометрія, виразні межі, жорстка композиція, мінімум деталей і чіткий фокус на змісті.",
  modern_glass:
    "Мінімалістична liquid-glass естетика: напівпрозорі шари, м'який blur, делікатні підсвічені градієнти, акуратні скляні панелі, але з пріоритетом читабельності та без зайвого блиску."
};

export const DEFAULT_BASE_PROMPT =
  "Ти редактор українського науково-популярного рукопису. Перетворюй щільну наукову мову на ясну, природну українську без втрати змісту й авторського наміру. Працюй локально в межах виділеного фрагмента. Пріоритети: 1) пояснити терміни для широкого читача без спотворення фактів, 2) ущільнити перевантажені речення без втрати логіки, 3) вирівняти тон так, щоб текст звучав доказово, спокійно й редакторськи чисто. Не додавай нових фактів, не роби рекламних обіцянок, не підміняй наукову невизначеність категоричними висновками. Не додавай шаблонних медичних застережень, порад звернутися до лікаря, фраз про самодіагностику чи консультацію, якщо цього прямо не просить редактор і цього немає у фрагменті.";

export const BULLET_LIST_PUNCTUATION_RULE = `Пунктуація списків:
- якщо пункт списку починається з малої літери, він має закінчуватися крапкою з комою (;)
- якщо пункт списку починається з великої літери, він має закінчуватися крапкою (.)
- не змішуй ; і . в межах одного списку без реальної потреби.`;

export function appendBulletListPunctuationRule(prompt?: string | null): string {
  const trimmed = prompt?.trim();

  if (!trimmed) {
    return BULLET_LIST_PUNCTUATION_RULE;
  }

  if (trimmed.includes("Пунктуація списків:")) {
    return trimmed;
  }

  return `${trimmed}\n\n${BULLET_LIST_PUNCTUATION_RULE}`;
}

export const DEFAULT_EXPERTISE_PROMPT = appendBulletListPunctuationRule(`Зроби редакторську діагностику українського науково-популярного рукопису.

Формат: 3 секції Markdown у такому порядку.

### 1. Загальний огляд
Стисло оціни читабельність, зрозумілість, практичну цінність, структуру, сильні сторони та ключові ризики.

### 2. Детальний аналіз
Розбери лише проблемні місця. Для кожного пункту дай:
- що саме не працює;
- чому це заважає читачеві;
- яку локальну дію варто зробити.
Окремо відмічай мовні/термінологічні збої та потенційно неточні або надто категоричні твердження.

### 3. Резюме рекомендованих змін
Подай пріоритетний список найважливіших кроків для наступних етапів.

Пиши природною українською. Не показуй технічні коди, enum-значення або JSON-поля.`);

export const DEFAULT_CARDS_PROMPT = appendBulletListPunctuationRule(`Ти генеруєш конкретні локальні правки на основі попередньої експертизи документа та зворотного зв'язку від користувача.

Кожна рекомендація має бути прив'язана до одного або кількох суміжних абзаців.
Доступні типи (recommendationType): 'rewrite', 'expand', 'simplify', 'list', 'subsection', 'callout', 'visual'.
replace-типи ('rewrite', 'expand', 'simplify', 'list') мають suggestedAction='rewrite_text' та insertionHint='replace'.
Тип 'subsection' має suggestedAction='insert_text' та insertionHint='before'.
Тип 'callout' має suggestedAction='prepare_callout' та insertionHint='after'.
Тип 'visual' має suggestedAction='prepare_visual' та insertionHint='after'.
Для callout дозволені лише calloutKind: mechanism, analogy, everyday_application, myths_vs_truth, top_list.
Для visual дозволені visualIntent: infographic або illustration.
Для blockStart і blockEnd використовуй нульову нумерацію рядків документа.
У полях title, reason і recommendation не згадуй raw block id.
Усі текстові поля plain text без markdown-розмітки.
Для clarity/simplify/rewrite картка має описувати локальну редакторську дію над мовою, синтаксисом, категоричністю або структурою подачі, а не новий дисклеймер.
Не використовуй картки ясності для шаблонних медичних попереджень, порад звернутися до лікаря, фраз про самодіагностику, «варто перевірити стан» чи повторюваних застережень, якщо редактор не просив цього явно.
Якщо джерело вже подане як перелік або серія коротких пунктів, зберігай scan-friendly подачу й не роздувай кожен рядок у окремий довгий абзац.
Не переписуй весь документ. Пропонуй лише локальні дії з високою цінністю.`);

/** @deprecated Kept for backward-compat with old localStorage. Use DEFAULT_EXPERTISE_PROMPT + DEFAULT_CARDS_PROMPT instead. */
export const DEFAULT_REVIEW_PROMPT = DEFAULT_CARDS_PROMPT;

export const DEFAULT_REVIEW_LEVEL_GUIDE = `Рівень 1 — Легкий марафет: зберігай структуру і тон майже без змін, виправляй тільки явні перевантаження, дрібні неясності та надто складні формулювання. Рівень 2 — Трохи підчистити: можна локально підсилювати логіку, ущільнювати речення і радити списки чи короткі вставки, але без серйозної перебудови. Рівень 3 — Добряче пройтись: можна сміливо спрощувати, дробити важкі абзаци, радити врізки, списки, локальні доповнення і окремі візуалізації, але не перебудовувати весь розділ. Рівень 4 — Розібрати на гвинтики: дозволено глибоко перекомпоновувати проблемні місця, виносити частини в окремі підрозділи, активно радити врізки й структурні переформатування. Рівень 5 — Радикальне перепроєктування: дозволено глибоко перебудовувати подачу фрагментів, дробити, переносити, пропонувати нові підрозділи, врізки та візуалізації, якщо це реально покращує читабельність.`;

export const CHANGE_LEVEL_GUIDANCE: Record<WholeTextChangeLevel, {
  expertiseTone: string;
  /** Approximate number of document blocks per one recommendation card */
  blocksPerCard: number;
  cardsGuidance: string;
}> = {
  1: {
    expertiseTone: "Текст загалом добрий. Будь обережний і делікатний — зміни мають бути мінімальними. Фокусуйся лише на явних проблемах: перевантаженнях, фактичних неточностях або незрозумілих місцях. Не пропонуй змін заради змін.",
    blocksPerCard: 20,
    cardsGuidance: "Лише найважливіші правки — те, що справді заважає читачу."
  },
  2: {
    expertiseTone: "Текст має хорошу основу, але потребує шліфування. Можна локально підсилювати логіку та ущільнювати речення, але не перебудовувати структуру.",
    blocksPerCard: 15,
    cardsGuidance: "Фокус на шліфуванні формулювань і локальному покращенні."
  },
  3: {
    expertiseTone: "Можна сміливо вказувати на проблеми та пропонувати помірні зміни: спрощення щільних абзаців, додавання врізок і списків, локальні доповнення.",
    blocksPerCard: 10,
    cardsGuidance: "Покрий і текстові правки, і структурні покращення (врізки, списки, підзаголовки)."
  },
  4: {
    expertiseTone: "Будь відверто критичний. Дозволено глибоко перекомпоновувати проблемні місця, виносити частини в окремі підрозділи, активно радити врізки, візуали та структурні переформатування.",
    blocksPerCard: 7,
    cardsGuidance: "Активно пропонуй врізки, візуали, підзаголовки та суттєві переписування."
  },
  5: {
    expertiseTone: "Це майже повний ре-едитинг. Будь максимально критичний і сміливий. Дозволено радикально перебудовувати подачу, дробити, переносити, пропонувати нові підрозділи, врізки та візуалізації.",
    blocksPerCard: 5,
    cardsGuidance: "Покрий весь документ: переписування, спрощення, врізки, візуали, підзаголовки, списки."
  }
};
export const DEFAULT_CALLOUT_PROMPT_TEMPLATE = appendBulletListPunctuationRule(`Створи чернетку врізки для українського науково-популярного рукопису. Використай тип: {{calloutKindLabel}}.

Розшифровка типів:
- mechanism: поясни механізм дії простим причинно-наслідковим ланцюгом без підручникового тону;
- analogy: побудуй аналогію, яка допомагає зрозуміти ідею, і явно познач її як аналогію;
- everyday_application: покажи, як описане явище проявляється в повсякденному житті;
- myths_vs_truth: подай матеріал як короткі пари «Міф / Правда», але лише для тверджень, що прямо випливають із фрагмента;
- top_list: поверни 3-5 практичних пунктів (або менше, якщо джерело підтверджує менше) у форматі окремих рядків «Назва (1-2 слова): пояснення (1 речення)».

Спирайся тільки на фрагмент і редакторську рекомендацію, не додавай нових фактів поза текстом.
Не вигадуй додаткових джерел, продуктів, сполук чи висновків, яких немає у фрагменті.

Формат відповіді (обов'язково): поверни лише JSON-об'єкт без Markdown та без будь-яких пояснень до/після.
{"title":"...","body":"..."}
- title: короткий заголовок врізки (plain text, 1 рядок).
- body: текст врізки як plain text для block editor; без **жирного**, _курсиву_, # заголовків, списків Markdown або code fences.

Додатково для calloutKind=top_list:
- body = multi-line: один пункт на одному рядку, без суцільного абзацу;
- кожен рядок має мати дві частини через двокрапку: «Назва: пояснення»;
- назва коротка (1-2 слова), пояснення конкретне і практичне (1 речення).

2-shot приклади для top_list:
Добре:
{"title":"Де шукати сенолітики","body":"Цибуля: поширене джерело кверцетину.\nЯблука: також містять кверцетин для щоденного раціону.\nПолуниця: містить фізетин.\nКаперси: можуть мати високий вміст кверцетину."}

Погано:
{"title":"Практичний гід","body":"Цибуля (джерело кверцетину). Яблука (джерело кверцетину). Полуниця (джерело фізетину)."}
Чому погано: один абзац, повторюваний шаблон, слабка практична цінність.

Контекст фрагмента: {{fragment}}. Рекомендація: {{recommendation}}.`);
export const DEFAULT_IMAGE_PROMPT_TEMPLATE = `Склади один готовий український prompt для моделі генерації зображень. Це має бути не пояснення для редактора, не ТЗ для дизайнера і не структурована пам'ятка, а один downstream prompt, який можна одразу надіслати в image generation.

Працюй тільки з цими даними:
- visualIntent: {{visualIntent}}
- visualStyleGuide: {{visualStyleGuide}}
- фрагмент: {{fragment}}
- редакторська рекомендація: {{recommendation}}

Вимоги до результату:
- поверни рівно один готовий prompt без заголовків, Markdown, нумерації, секцій, вступів, приміток чи прикладів;
- поверни plain text в одному цілісному блоці, придатному для вставки в prompt-поле редактора без додаткового очищення;
- починай із сильного дієслова та прямого опису сцени, а не з фраз на кшталт "Ось prompt", "Prompt для генерації", "Інструкція", "Опис сцени" або "Що показати";
- трактуй visualIntent так:
  infographic -> автоматично обери найдоречніший формат із контексту (порівняння, процес, таймлайн, причина→наслідок, шари/зріз або схема зв'язків) і реалізуй його через композицію;
  illustration -> побудуй одну виразну пояснювальну сцену або образ без таблиць і жорсткої сітки;
- побудуй prompt у такому порядку: головна сцена -> композиція -> ключові елементи -> стиль -> палітра/фон;
- якщо у візуалі потрібен текст, дай точні українські написи в лапках;
- спирайся тільки на фрагмент і рекомендацію, не вигадуй нових фактів, діагнозів, причин або підписів, яких там немає;
- описуй переважно те, що має бути в кадрі; обмеження додай лише короткою фінальною фразою;
- не пиши нічого про "illustrator", "designer", "ТЗ", "technical breakdown", "visual narrative", "освітню функцію" чи "пояснення visualIntent";
- дотримуйся visualStyleGuide буквально: стиль має бути сучасним і чистим, але інфографіка залишається функціональною, а не декоративною;
- уникай фотореалізму, декоративного шуму, мокапів інтерфейсу, стокових сцен, зайвих персонажів і медичних кліше, якщо цього прямо не вимагає фрагмент;
- мова відповіді: тільки українська.

Приклад поганої відповіді:
Ось prompt для генерації візуалу. ### Опис сцени: показати два блоки. ### Стиль: minimalist flat vector.

Приклад хорошої відповіді:
Покажи симетричне порівняння двох станів шкіри у двох сусідніх панелях в одному масштабі: ліворуч рівний світліший тон, праворуч темніші нерівні пігментні плями; використай м'який спокійний градієнт фону та чисті мінімалістичні панелі, тонкі контури, високу контрастність підписів українською в лапках, без фотореалізму й зайвого декору.
`;

export const PROVIDER_MODEL_PRESETS: Record<ProviderId, ProviderModelPreset[]> = {
  openai: [
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      description: "Найсильніша якість редагування й найкращий кандидат для складних локальних правок та editorial review."
    },
    {
      id: "gpt-5.3",
      label: "GPT-5.3",
      description: "Трохи дешевше й швидше, коли потрібен майже той самий стиль редагування без фокусу на максимальній якості."
    },
    {
      id: "gpt-5.2",
      label: "GPT-5.2",
      description: "Стабільний запасний варіант, якщо треба залишитися ближче до поточної інтеграції або попередніх результатів."
    }
  ],
  anthropic: [
    {
      id: "claude-opus-4-6",
      label: "Claude Opus 4.6",
      description: "Найкращий варіант Anthropic для глибокого редакторського розбору і делікатного переписування щільних фрагментів."
    },
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      description: "Збалансований режим: якість близька до топової, але з кращою швидкістю і меншими витратами."
    },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      description: "Найшвидший варіант для чернеткових проходів і масових локальних перевірок."
    }
  ],
  gemini: [
    {
      id: "gemini-3-flash-preview",
      label: "Gemini 3 Flash",
      description: "Швидкий і збалансований варіант за замовчуванням для повсякденних patch-запитів та editorial review."
    },
    {
      id: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro Preview",
      description: "Найсильніший Gemini-профіль для довших рукописів, глобального review і складної структурної правки."
    },
    {
      id: "gemini-3.1-flash-lite-preview",
      label: "Gemini 3.1 Flash Lite Preview",
      description: "Більш приземлений і дешевший production-орієнтований варіант для повсякденних patch-запитів."
    }
  ]
};

const DEFAULT_PROVIDER_MODEL_IDS: Record<ProviderId, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-opus-4-6",
  gemini: "gemini-3.1-flash-lite-preview"
};

export function getProviderModelPresets(provider: ProviderId): ProviderModelPreset[] {
  return PROVIDER_MODEL_PRESETS[provider];
}

export function getDefaultProviderModelId(provider: ProviderId): string {
  return DEFAULT_PROVIDER_MODEL_IDS[provider] ?? "";
}

export function findProviderModelPreset(provider: ProviderId, modelId: string): ProviderModelPreset | null {
  const normalized = modelId.trim();
  return PROVIDER_MODEL_PRESETS[provider].find((preset) => preset.id === normalized) ?? null;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  provider: "gemini",
  modelId: getDefaultProviderModelId("gemini"),
  apiKey: "",
  basePrompt: DEFAULT_BASE_PROMPT,
  reviewPrompt: DEFAULT_REVIEW_PROMPT,
  expertisePrompt: DEFAULT_EXPERTISE_PROMPT,
  cardsPrompt: DEFAULT_CARDS_PROMPT,
  reviewLevelGuide: DEFAULT_REVIEW_LEVEL_GUIDE,
  calloutPromptTemplate: DEFAULT_CALLOUT_PROMPT_TEMPLATE,
  imagePromptTemplate: DEFAULT_IMAGE_PROMPT_TEMPLATE
};

export function normalizeProvider(provider: string): ProviderId {
  return provider === "gemini" || provider === "anthropic" ? provider : "openai";
}

export function getProviderLabel(provider: ProviderId): string {
  if (provider === "gemini") {
    return "Google Gemini";
  }

  if (provider === "anthropic") {
    return "Anthropic";
  }

  return "OpenAI";
}

export function getProviderEnvKey(provider: ProviderId): string {
  if (provider === "gemini") {
    return "GEMINI_API_KEY";
  }

  if (provider === "anthropic") {
    return "ANTHROPIC_API_KEY";
  }

  return "OPENAI_API_KEY";
}

export function normalizeModelId(provider: ProviderId, modelId: string): string {
  const trimmed = modelId.trim().replace(/\s+/g, "");

  if (trimmed) {
    return trimmed;
  }

  return getDefaultProviderModelId(provider);
}

export function validateModelId(modelId: string): ModelIdValidationState {
  const trimmed = modelId.trim();

  if (!trimmed) {
    return "missing";
  }

  return /^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/.test(trimmed) ? "valid" : "invalid";
}

export function getVisualStylePresetOptions(): Array<{ value: VisualStylePreset; label: string }> {
  return (Object.keys(VISUAL_STYLE_PRESET_LABELS) as VisualStylePreset[]).map((value) => ({
    value,
    label: VISUAL_STYLE_PRESET_LABELS[value]
  }));
}

export function getVisualStylePresetLabel(preset: VisualStylePreset): string {
  return VISUAL_STYLE_PRESET_LABELS[preset];
}

export function getVisualStylePresetGuide(preset: VisualStylePreset): string {
  return VISUAL_STYLE_PRESET_GUIDES[preset];
}

export function normalizeVisualStylePreset(
  candidate: unknown,
  fallback: VisualStylePreset = DEFAULT_VISUAL_STYLE_PRESET
): VisualStylePreset {
  if (typeof candidate !== "string") {
    return fallback;
  }

  const value = candidate.trim() as VisualStylePreset;
  return value in VISUAL_STYLE_PRESET_GUIDES ? value : fallback;
}

export function sanitizeEditorSettings(candidate: Partial<EditorSettings> | null | undefined): EditorSettings {
  return {
    provider: normalizeProvider(candidate?.provider ?? DEFAULT_EDITOR_SETTINGS.provider),
    modelId: typeof candidate?.modelId === "string" ? candidate.modelId.trim() : DEFAULT_EDITOR_SETTINGS.modelId,
    apiKey: typeof candidate?.apiKey === "string" ? candidate.apiKey.trim() : DEFAULT_EDITOR_SETTINGS.apiKey,
    basePrompt: typeof candidate?.basePrompt === "string" && candidate.basePrompt.trim() ? candidate.basePrompt.trim() : DEFAULT_EDITOR_SETTINGS.basePrompt,
    reviewPrompt:
      typeof candidate?.reviewPrompt === "string" && candidate.reviewPrompt.trim() ? candidate.reviewPrompt.trim() : DEFAULT_EDITOR_SETTINGS.reviewPrompt,
    expertisePrompt:
      typeof candidate?.expertisePrompt === "string" && candidate.expertisePrompt.trim() ? candidate.expertisePrompt.trim() : DEFAULT_EDITOR_SETTINGS.expertisePrompt,
    cardsPrompt:
      typeof candidate?.cardsPrompt === "string" && candidate.cardsPrompt.trim() ? candidate.cardsPrompt.trim() : DEFAULT_EDITOR_SETTINGS.cardsPrompt,
    reviewLevelGuide:
      typeof candidate?.reviewLevelGuide === "string" && candidate.reviewLevelGuide.trim()
        ? candidate.reviewLevelGuide.trim()
        : DEFAULT_EDITOR_SETTINGS.reviewLevelGuide,
    calloutPromptTemplate:
      typeof candidate?.calloutPromptTemplate === "string" && candidate.calloutPromptTemplate.trim()
        ? candidate.calloutPromptTemplate.trim()
        : DEFAULT_EDITOR_SETTINGS.calloutPromptTemplate,
    imagePromptTemplate:
      typeof candidate?.imagePromptTemplate === "string" && candidate.imagePromptTemplate.trim()
        ? candidate.imagePromptTemplate.trim()
        : DEFAULT_EDITOR_SETTINGS.imagePromptTemplate
  };
}

export function readEditorSettings(): EditorSettings {
  if (typeof window === "undefined") {
    return DEFAULT_EDITOR_SETTINGS;
  }

  const raw = window.localStorage.getItem(EDITOR_SETTINGS_STORAGE_KEY);

  if (!raw) {
    return DEFAULT_EDITOR_SETTINGS;
  }

  try {
    return sanitizeEditorSettings(JSON.parse(raw) as Partial<EditorSettings>);
  } catch {
    return DEFAULT_EDITOR_SETTINGS;
  }
}

export function writeEditorSettings(settings: EditorSettings): EditorSettings {
  const sanitized = sanitizeEditorSettings(settings);
  const persisted = {
    ...sanitized,
    modelId: validateModelId(sanitized.modelId) === "missing" ? normalizeModelId(sanitized.provider, sanitized.modelId) : sanitized.modelId
  } satisfies EditorSettings;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(EDITOR_SETTINGS_STORAGE_KEY, JSON.stringify(persisted));
  }

  return persisted;
}
