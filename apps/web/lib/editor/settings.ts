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
export const CUSTOM_MODEL_OPTION = "__custom__";

export const DEFAULT_BASE_PROMPT =
  "Ти редактор українського науково-популярного рукопису. Перетворюй щільну наукову мову на ясну, природну українську без втрати змісту й авторського наміру. Працюй локально в межах виділеного фрагмента. Пріоритети: 1) пояснити терміни для широкого читача без спотворення фактів, 2) ущільнити перевантажені речення без втрати логіки, 3) вирівняти тон так, щоб текст звучав доказово, спокійно й редакторськи чисто. Не додавай нових фактів, не роби рекламних обіцянок, не підміняй наукову невизначеність категоричними висновками.";
export const DEFAULT_REVIEW_PROMPT = `Ти робиш редакторський review всього рукопису, а не переписуєш текст автоматично. Поверни тільки найцінніші рекомендації, прив'язані до конкретних абзаців. Кожна рекомендація має містити: що саме не працює, чому це заважає читачеві, що саме пропонується зробити далі, який це тип рекомендації і який наступний action має підготувати система. Пояснення recommendation types: rewrite = локально переписати існуючий текст; expand = дописати новий пояснювальний текст; simplify = зробити простіше без зміни змісту; list = перетворити фрагмент на список або структурований перелік; subsection = винести матеріал в окремий підрозділ; callout = додати врізку, інфографіку або додатковий пояснювальний блок; visualize = перевести зміст у схему, процес, порівняння або інфографіку; illustration = залишити текст, але підсилити його окремою ілюстрацією. Пояснення suggestedAction: rewrite_text = підготувати diff для заміни; insert_text = підготувати новий текст для вставки; prepare_callout = підготувати промпт або чернетку врізки; prepare_visual = підготувати промпт для візуалізації або ілюстрації. Якщо обираєш callout, також вкажи calloutKind: quick_fact, mini_story, mechanism_explained, step_by_step або myth_vs_fact. Якщо обираєш visualize або illustration, також вкажи visualIntent: diagram, comparison, process, timeline, scene або concept.`;
export const DEFAULT_REVIEW_LEVEL_GUIDE = `Рівень 1 — Легкий марафет: зберігай структуру і тон майже без змін, виправляй тільки явні перевантаження, дрібні неясності та надто складні формулювання. Рівень 2 — Трохи підчистити: можна локально підсилювати логіку, ущільнювати речення і радити списки чи короткі вставки, але без серйозної перебудови. Рівень 3 — Добряче пройтись: можна сміливо спрощувати, дробити важкі абзаци, радити врізки, списки, локальні доповнення і окремі візуалізації, але не перебудовувати весь розділ. Рівень 4 — Розібрати на гвинтики: дозволено глибоко перекомпоновувати проблемні місця, виносити частини в окремі підрозділи, активно радити врізки й структурні переформатування. Рівень 5 — Згорів сарай — гори хата: дозволено радикально перебудовувати подачу фрагментів, дробити, переносити, пропонувати нові підрозділи, врізки та візуалізації, якщо це реально покращує читабельність.`;
export const DEFAULT_CALLOUT_PROMPT_TEMPLATE = `Створи чернетку врізки для українського науково-популярного рукопису. Використай тип: {{calloutKind}}. Під "врізкою" тут мається на увазі додатковий пояснювальний блок, який може бути коротким фактом, мініісторією, поясненням механізму, покроковим розбором або блоком "міф і факт". Спирайся тільки на фрагмент і редакторську рекомендацію, не додавай нових фактів поза текстом. Поверни короткий заголовок, сам текст врізки і стисле пояснення, навіщо вона тут. Контекст фрагмента: {{fragment}}. Рекомендація: {{recommendation}}.`;
export const DEFAULT_IMAGE_PROMPT_TEMPLATE = `Підготуй prompt для генерації чернеткової ілюстрації для книжкового редактора. Мета: допомогти ілюстратору швидко зрозуміти, що саме варто візуалізувати у фрагменті. Стиль обов'язково: мінімалістичний, простий, чернетка для ілюстратора. Вкажи: що саме показати, яку освітню функцію має виконати візуал, які елементи обов'язкові, яких візуальних кліше або зайвого декору уникати. Тип візуалу: {{visualIntent}}. Фрагмент: {{fragment}}. Рекомендація: {{recommendation}}.`;

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
      id: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro Preview",
      description: "Найсильніший Gemini-профіль для довших рукописів, глобального review і складної структурної правки."
    },
    {
      id: "gemini-3-flash-preview",
      label: "Gemini 3 Flash Preview",
      description: "Швидший preview-варіант, коли потрібен хороший редакторський результат при нижчій латентності."
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
  provider: "openai",
  modelId: getDefaultProviderModelId("openai"),
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
