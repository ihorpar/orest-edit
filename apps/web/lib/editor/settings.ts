export type ProviderId = "openai" | "gemini" | "anthropic";
export type SettingsValidationState = "valid" | "missing" | "invalid";

export interface EditorSettings {
  provider: ProviderId;
  modelId: string;
  apiKey: string;
  basePrompt: string;
}

export const EDITOR_SETTINGS_STORAGE_KEY = "orest-editor-settings-v1";

export const DEFAULT_BASE_PROMPT =
  "Спрости складну наукову мову до зрозумілої української. Пропонуй лише локальні правки, які зберігають фактичну точність і полегшують читання.";

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  provider: "openai",
  modelId: "gpt-5.2",
  apiKey: "",
  basePrompt: DEFAULT_BASE_PROMPT
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

export function normalizeModelId(provider: ProviderId, modelId: string): string {
  const trimmed = modelId.trim().replace(/\s+/g, "");

  if (trimmed) {
    return trimmed;
  }

  if (provider === "gemini") {
    return "gemini-2.5-pro";
  }

  if (provider === "anthropic") {
    return "claude-sonnet-4-5";
  }

  return "gpt-5.2";
}

export function validateModelId(modelId: string): SettingsValidationState {
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
    basePrompt: typeof candidate?.basePrompt === "string" && candidate.basePrompt.trim() ? candidate.basePrompt.trim() : DEFAULT_EDITOR_SETTINGS.basePrompt
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
