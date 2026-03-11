import type { VisualStylePreset } from "./review-contract.ts";

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
  reviewPrompt: string;
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
  "Ти редактор українського науково-популярного рукопису. Перетворюй щільну наукову мову на ясну, природну українську без втрати змісту й авторського наміру. Працюй локально в межах виділеного фрагмента. Пріоритети: 1) пояснити терміни для широкого читача без спотворення фактів, 2) ущільнити перевантажені речення без втрати логіки, 3) вирівняти тон так, щоб текст звучав доказово, спокійно й редакторськи чисто. Не додавай нових фактів, не роби рекламних обіцянок, не підміняй наукову невизначеність категоричними висновками.";
export const DEFAULT_REVIEW_PROMPT = `Ти робиш редакторський review всього рукопису, а не переписуєш текст автоматично. Поверни тільки найцінніші рекомендації, прив'язані до конкретних блоків. Кожна рекомендація має містити: що саме не працює, чому це заважає читачеві, що саме пропонується зробити далі, який це recommendationType і який suggestedAction має підготувати система. Дозволені recommendationType: rewrite, expand, simplify, list, subsection, callout, visual. replace-типи rewrite, expand, simplify, list мають suggestedAction=rewrite_text та insertionHint=replace. subsection має suggestedAction=insert_text та insertionHint=before. callout має suggestedAction=prepare_callout та insertionHint=after. visual має suggestedAction=prepare_visual та insertionHint=after. Якщо обираєш callout, також вкажи calloutKind: mechanism, analogy, everyday_application, myths_vs_truth або top_list. Якщо обираєш visual, також вкажи visualIntent: diagram, comparison, process, timeline, scene або concept. Не пропонуй часткових правок усередині абзацу.`;
export const DEFAULT_REVIEW_LEVEL_GUIDE = `Рівень 1 — Легкий марафет: зберігай структуру і тон майже без змін, виправляй тільки явні перевантаження, дрібні неясності та надто складні формулювання. Рівень 2 — Трохи підчистити: можна локально підсилювати логіку, ущільнювати речення і радити списки чи короткі вставки, але без серйозної перебудови. Рівень 3 — Добряче пройтись: можна сміливо спрощувати, дробити важкі абзаци, радити врізки, списки, локальні доповнення і окремі візуалізації, але не перебудовувати весь розділ. Рівень 4 — Розібрати на гвинтики: дозволено глибоко перекомпоновувати проблемні місця, виносити частини в окремі підрозділи, активно радити врізки й структурні переформатування. Рівень 5 — Згорів сарай — гори хата: дозволено радикально перебудовувати подачу фрагментів, дробити, переносити, пропонувати нові підрозділи, врізки та візуалізації, якщо це реально покращує читабельність.`;
export const DEFAULT_CALLOUT_PROMPT_TEMPLATE = `Створи чернетку врізки для українського науково-популярного рукопису. Використай тип: {{calloutKindLabel}}.

Розшифровка типів:
- mechanism: поясни механізм дії простим причинно-наслідковим ланцюгом без підручникового тону;
- analogy: побудуй аналогію, яка допомагає зрозуміти ідею, і явно познач її як аналогію;
- everyday_application: покажи, як описане явище проявляється в повсякденному житті;
- myths_vs_truth: подай матеріал як короткі пари «Міф / Правда», але лише для тверджень, що прямо випливають із фрагмента;
- top_list: поверни 3-5 практичних пунктів (або менше, якщо джерело підтверджує менше) у форматі окремих рядків «Назва (1-2 слова): пояснення (1 речення)».

Спирайся тільки на фрагмент і редакторську рекомендацію, не додавай нових фактів поза текстом.
Не вигадуй додаткових джерел, продуктів, сполук чи висновків, яких немає у фрагменті.

Формат відповіді (обов'язково): поверни лише JSON-об'єкт без Markdown та без будь-яких пояснень до/після.
{"title":"...","body":"...","summary":"..."}
- title: короткий заголовок врізки (plain text, 1 рядок).
- body: текст врізки як plain text для block editor; без **жирного**, _курсиву_, # заголовків, списків Markdown або code fences.
- summary: одне коротке речення, навіщо ця врізка саме тут.

Додатково для calloutKind=top_list:
- body = multi-line: один пункт на одному рядку, без суцільного абзацу;
- кожен рядок має мати дві частини через двокрапку: «Назва: пояснення»;
- назва коротка (1-2 слова), пояснення конкретне і практичне (1 речення).

2-shot приклади для top_list:
Добре:
{"title":"Де шукати сенолітики","body":"Цибуля: поширене джерело кверцетину.\nЯблука: також містять кверцетин для щоденного раціону.\nПолуниця: містить фізетин.\nКаперси: можуть мати високий вміст кверцетину.","summary":"Дає читачеві практичний список джерел без виходу за межі фрагмента."}

Погано:
{"title":"Практичний гід","body":"Цибуля (джерело кверцетину). Яблука (джерело кверцетину). Полуниця (джерело фізетину).","summary":"Список продуктів."}
Чому погано: один абзац, повторюваний шаблон, слабка практична цінність.

Контекст фрагмента: {{fragment}}. Рекомендація: {{recommendation}}.`;
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
- реалізуй visualIntent через композицію, а не як службове слово:
  comparison -> симетричне порівняння в одному масштабі;
  process -> послідовність етапів із чітким напрямком;
  timeline -> лінія часу;
  diagram -> схема зв'язків;
  concept -> один узагальнений пояснювальний образ;
  scene -> одна конкретна ситуація;
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

export function getProviderModelPresets(provider: ProviderId): ProviderModelPreset[] {
  return PROVIDER_MODEL_PRESETS[provider];
}

export function getDefaultProviderModelId(provider: ProviderId): string {
  return PROVIDER_MODEL_PRESETS[provider][0]?.id ?? "";
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
