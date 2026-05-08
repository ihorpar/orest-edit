"use client";

import { useEffect, useState } from "react";
import { TopBar } from "../../components/layout/TopBar";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { StatusDot } from "../../components/ui/StatusDot";
import { Textarea } from "../../components/ui/Textarea";
import type { EditorialReviewStepId } from "../../lib/editor/review-contract";
import {
  CUSTOM_MODEL_OPTION,
  DEFAULT_BASE_PROMPT,
  DEFAULT_CALLOUT_PROMPT_TEMPLATE,
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_EXPERTISE_PROMPT,
  DEFAULT_CARDS_PROMPT,
  DEFAULT_IMAGE_PROMPT_TEMPLATE,
  DEFAULT_REVIEW_PROMPT,
  DEFAULT_WORKFLOW_STEP_PROMPTS,
  findProviderModelPreset,
  getDefaultProviderModelId,
  getModelPresetOptionLabel,
  getModelPresetPriceLabel,
  getModelPresetSmartnessLabel,
  getProviderEnvKey,
  getProviderLabel,
  getProviderModelPresets,
  normalizeModelId,
  normalizeProvider,
  readEditorSettings,
  validateModelId,
  writeEditorSettings,
  type EditorSettings,
  type ProviderId,
  type SettingsConnectionState,
  type SettingsKeySource,
  type SettingsValidationResult
} from "../../lib/editor/settings";

interface ConnectionStatusSnapshot {
  provider: ProviderId;
  modelId: string;
  state: SettingsConnectionState;
  keySource: SettingsKeySource;
  message: string;
  validatedAt: string | null;
}

const WORKFLOW_STEP_PROMPT_OPTIONS: Array<{ value: EditorialReviewStepId; label: string }> = [
  { value: "diagnostics", label: "Діагностика" },
  { value: "fact_check", label: "Перевірка фактів" },
  { value: "structure", label: "Структура" },
  { value: "clarity", label: "Ясність" },
  { value: "interest", label: "Інтерес" },
  { value: "visuals", label: "Візуали" },
  { value: "formatting", label: "Форматування" },
  { value: "emphasis", label: "Акценти" },
  { value: "final_editing", label: "Власний запит" }
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [persistedSettings, setPersistedSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [activeStepPromptId, setActiveStepPromptId] = useState<EditorialReviewStepId>("diagnostics");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [validationNonce, setValidationNonce] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatusSnapshot>({
    provider: DEFAULT_EDITOR_SETTINGS.provider,
    modelId: DEFAULT_EDITOR_SETTINGS.modelId,
    state: "idle",
    keySource: "missing",
    message: "Оберіть модель, щоб перевірити підключення.",
    validatedAt: null
  });

  useEffect(() => {
    const restored = stripClientApiKeys(readEditorSettings());
    setSettings(restored);
    setPersistedSettings(restored);
  }, []);

  const providerLabel = getProviderLabel(settings.provider);
  const modelPresets = getProviderModelPresets(settings.provider);
  const selectedPreset = findProviderModelPreset(settings.provider, settings.modelId);
  const selectedModelOption = selectedPreset?.id ?? CUSTOM_MODEL_OPTION;
  const currentModelId = selectedModelOption === CUSTOM_MODEL_OPTION ? settings.modelId.trim() : normalizeModelId(settings.provider, settings.modelId);
  const modelState = validateModelId(currentModelId);
  const providerEnvKey = getProviderEnvKey(settings.provider);
  const hasUnsavedChanges = !areSettingsEqual(settings, persistedSettings);

  useEffect(() => {
    const validationKeySource: SettingsKeySource = "missing";

    if (modelState !== "valid") {
      setConnectionStatus({
        provider: settings.provider,
        modelId: currentModelId,
        state: modelState === "missing" ? "idle" : "model_error",
        keySource: validationKeySource,
        message: modelState === "missing" ? "Оберіть або введіть model id, щоб перевірити підключення." : "Model id має невалідний формат.",
        validatedAt: null
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setConnectionStatus((current) => ({
        provider: settings.provider,
        modelId: currentModelId,
        state: "checking",
        keySource: current.keySource,
        message: "Перевіряю модель…",
        validatedAt: current.validatedAt
      }));

      try {
        const response = await fetch("/api/settings/validate", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            provider: settings.provider,
            modelId: currentModelId
          }),
          signal: controller.signal
        });

        if (response.status === 401) {
          const authError = await readApiErrorMessage(
            response,
            "API відхилив сесію. Оновіть сторінку й увійдіть знову, якщо проблема повториться."
          );
          setConnectionStatus({
            provider: settings.provider,
            modelId: currentModelId,
            state: "auth_error",
            keySource: "missing",
            message: authError,
            validatedAt: new Date().toISOString()
          });
          return;
        }

        const payload = (await response.json().catch(() => null)) as SettingsValidationResult | null;

        if (controller.signal.aborted) {
          return;
        }

        if (!payload || typeof payload.message !== "string") {
          setConnectionStatus({
            provider: settings.provider,
            modelId: currentModelId,
            state: "network_error",
            keySource: "missing",
            message: "Сервер повернув некоректну відповідь.",
            validatedAt: new Date().toISOString()
          });
          return;
        }

        setConnectionStatus({
          provider: payload.provider,
          modelId: payload.modelId,
          state: payload.state,
          keySource: payload.keySource,
          message: payload.message,
          validatedAt: payload.validatedAt
        });

      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setConnectionStatus({
          provider: settings.provider,
          modelId: currentModelId,
          state: "network_error",
          keySource: "missing",
          message: error instanceof Error ? error.message : "Не вдалося перевірити модель.",
          validatedAt: new Date().toISOString()
        });
      }
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [currentModelId, modelState, settings.provider, validationNonce]);

  return (
    <main className="app-shell">
      <TopBar activePath="/settings" />

      <section className="settings-page-shell">
        <div className="settings-stage">
          <section className="settings-sheet settings-sheet-focused">
            <header className="settings-hero">
              <div className="settings-hero-copy">
                <p className="mono-ui sidebar-title">Налаштування</p>
                <h1 className="settings-title">Підключення AI</h1>
              </div>

              <div className="settings-summary-grid">
                <article className="settings-summary-card">
                  <p className="mono-ui settings-summary-label">Поточний провайдер</p>
                  <p className="settings-summary-value">{providerLabel}</p>
                  <p className="settings-summary-copy">{selectedPreset?.label ?? (currentModelId || "Буде вибрано після збереження.")}</p>
                  {selectedPreset ? <ModelPresetChips preset={selectedPreset} /> : null}
                </article>

                <article className="settings-summary-card" data-tone={connectionStatus.state}>
                  <div className="settings-summary-head">
                    <p className="mono-ui settings-summary-label">Перевірка моделі</p>
                    <span className="settings-summary-status">
                      <StatusDot state={connectionStatus.state} />
                      <span>{getConnectionLabel(connectionStatus.state)}</span>
                    </span>
                  </div>
                  <p className="settings-summary-copy">{connectionStatus.message}</p>
                </article>
              </div>
            </header>

            <section className="settings-section">
              <div className="settings-section-head">
                <div>
                  <p className="mono-ui settings-section-kicker">Підключення</p>
                  <h2 className="settings-section-title">Що потрібно, щоб редактор працював</h2>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={connectionStatus.state === "checking"}
                  loadingLabel="Перевіряю…"
                  onClick={() => setValidationNonce((current) => current + 1)}
                >
                  Перевірити
                </Button>
              </div>

              <div className="settings-form-grid">
                <label className="settings-field" htmlFor="provider">
                  <span className="mono-ui settings-label">Провайдер</span>
                  <Select
                    id="provider"
                    value={settings.provider}
                    onChange={(event) => {
                      const provider = normalizeProvider(event.target.value);
                      setSettings((current) => ({
                        ...current,
                        provider,
                        modelId: getDefaultProviderModelId(provider)
                      }));
                      setSaveMessage(null);
                    }}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="anthropic">Anthropic</option>
                  </Select>
                  <p className="settings-field-note">Виберіть той провайдер, через який редактор робитиме локальні правки та editorial review.</p>
                </label>

                <label className="settings-field" htmlFor="model-preset">
                  <span className="mono-ui settings-label">Модель</span>
                  <Select
                    id="model-preset"
                    value={selectedModelOption}
                    onChange={(event) => {
                      const nextValue = event.target.value;

                      setSettings((current) => ({
                        ...current,
                        modelId: nextValue === CUSTOM_MODEL_OPTION ? (selectedPreset ? "" : current.modelId) : nextValue
                      }));
                      setSaveMessage(null);
                    }}
                  >
                    {modelPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {getModelPresetOptionLabel(preset)}
                      </option>
                    ))}
                    <option value={CUSTOM_MODEL_OPTION}>Ввести вручну</option>
                  </Select>

                  {selectedModelOption === CUSTOM_MODEL_OPTION ? (
                    <div className="settings-inline-field">
                      <Input
                        id="model"
                        error={modelState === "invalid"}
                        value={settings.modelId}
                        onChange={(event) => {
                          setSettings((current) => ({ ...current, modelId: event.target.value }));
                          setSaveMessage(null);
                        }}
                        placeholder="Наприклад: gpt-5.4"
                      />
                      <span className="settings-inline-status">
                        <StatusDot state={modelState} />
                      </span>
                    </div>
                  ) : null}

                  <div className="settings-validation-row">
                    <span className="settings-validation-status">
                      <StatusDot state={connectionStatus.state} />
                      <span>{getConnectionLabel(connectionStatus.state)}</span>
                    </span>
                    {selectedPreset ? <ModelPresetChips preset={selectedPreset} /> : null}
                    <span className="settings-validation-text">
                      {selectedPreset ? selectedPreset.description : getManualModelHelp(modelState)}
                    </span>
                  </div>
                </label>

                <div className="settings-field">
                  <span className="mono-ui settings-label">Ключ провайдера</span>
                  <p className="settings-field-note">Ключ береться тільки із серверного оточення: <code>{providerEnvKey}</code>.</p>
                </div>
              </div>
            </section>

            <section className="settings-section settings-section-advanced">
              <div className="settings-section-head settings-section-head-static">
                <div>
                  <p className="mono-ui settings-section-kicker">Поведінка редактора</p>
                  <h2 className="settings-section-title">Prompt templates</h2>
                </div>
              </div>

              <label className="settings-field" htmlFor="base-prompt">
                <span className="mono-ui settings-label">Що казати моделі перед кожним запитом</span>
                <Textarea
                  id="base-prompt"
                  rows={7}
                  value={settings.basePrompt}
                  onChange={(event) => {
                    setSettings((current) => ({ ...current, basePrompt: event.target.value }));
                    setSaveMessage(null);
                  }}
                  className="settings-textarea"
                />
                <div className="settings-textarea-toolbar">
                  <p className="settings-field-note">Цей текст впливає і на локальні patch-запити, і на whole-text editorial review.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, basePrompt: DEFAULT_BASE_PROMPT }));
                      setSaveMessage(null);
                    }}
                  >
                    Типовий промпт
                  </Button>
                </div>
              </label>

              <label className="settings-field" htmlFor="expertise-prompt">
                <span className="mono-ui settings-label">Промпт експертизи</span>
                <Textarea
                  id="expertise-prompt"
                  rows={10}
                  value={settings.expertisePrompt}
                  onChange={(event) => {
                    setSettings((current) => ({ ...current, expertisePrompt: event.target.value }));
                    setSaveMessage(null);
                  }}
                  className="settings-textarea"
                />
                <div className="settings-textarea-toolbar">
                  <p className="settings-field-note">Цей промпт використовується на етапі експертизи — загальний огляд та поблочний аналіз без технічних кодів.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, expertisePrompt: DEFAULT_EXPERTISE_PROMPT }));
                      setSaveMessage(null);
                    }}
                  >
                    Типовий промпт
                  </Button>
                </div>
              </label>

              <label className="settings-field" htmlFor="review-prompt">
                <span className="mono-ui settings-label">Загальний промпт review</span>
                <Textarea
                  id="review-prompt"
                  rows={8}
                  value={settings.reviewPrompt}
                  onChange={(event) => {
                    setSettings((current) => ({ ...current, reviewPrompt: event.target.value }));
                    setSaveMessage(null);
                  }}
                  className="settings-textarea"
                />
                <div className="settings-textarea-toolbar">
                  <p className="settings-field-note">Сумісний fallback для старих review-запитів, якщо окремі промпти експертизи або карток порожні.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, reviewPrompt: DEFAULT_REVIEW_PROMPT }));
                      setSaveMessage(null);
                    }}
                  >
                    Типовий промпт
                  </Button>
                </div>
              </label>

              <label className="settings-field" htmlFor="cards-prompt">
                <span className="mono-ui settings-label">Промпт генерації карток</span>
                <Textarea
                  id="cards-prompt"
                  rows={10}
                  value={settings.cardsPrompt}
                  onChange={(event) => {
                    setSettings((current) => ({ ...current, cardsPrompt: event.target.value }));
                    setSaveMessage(null);
                  }}
                  className="settings-textarea"
                />
                <div className="settings-textarea-toolbar">
                  <p className="settings-field-note">Цей промпт використовується на етапі генерації карток — тут живуть enum-типи, suggestedAction і insertionHint.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, cardsPrompt: DEFAULT_CARDS_PROMPT }));
                      setSaveMessage(null);
                    }}
                  >
                    Типовий промпт
                  </Button>
                </div>
              </label>

              <div className="settings-field">
                <label className="settings-field" htmlFor="workflow-step-prompt">
                  <span className="mono-ui settings-label">Промпти кроків workflow</span>
                  <div className="settings-step-prompt-head">
                    <Select
                      id="workflow-step-prompt"
                      value={activeStepPromptId}
                      onChange={(event) => setActiveStepPromptId(event.target.value as EditorialReviewStepId)}
                    >
                      {WORKFLOW_STEP_PROMPT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => {
                        setSettings((current) => ({
                          ...current,
                          workflowStepPrompts: {
                            ...current.workflowStepPrompts,
                            [activeStepPromptId]: DEFAULT_WORKFLOW_STEP_PROMPTS[activeStepPromptId]
                          }
                        }));
                        setSaveMessage(null);
                      }}
                    >
                      Типовий крок
                    </Button>
                  </div>
                </label>
                <Textarea
                  rows={7}
                  value={settings.workflowStepPrompts[activeStepPromptId]}
                  onChange={(event) => {
                    setSettings((current) => ({
                      ...current,
                      workflowStepPrompts: {
                        ...current.workflowStepPrompts,
                        [activeStepPromptId]: event.target.value
                      }
                    }));
                    setSaveMessage(null);
                  }}
                  className="settings-textarea"
                />
                <p className="settings-field-note">Це інструкція саме для вибраного етапу: діагностика, фактчек, структура, ясність, візуали, акценти тощо.</p>
              </div>

              <label className="settings-field" htmlFor="callout-prompt">
                <span className="mono-ui settings-label">Prompt для врізок</span>
                <Textarea
                  id="callout-prompt"
                  rows={8}
                  value={settings.calloutPromptTemplate}
                  onChange={(event) => {
                    setSettings((current) => ({ ...current, calloutPromptTemplate: event.target.value }));
                    setSaveMessage(null);
                  }}
                  className="settings-textarea"
                />
                <div className="settings-textarea-toolbar">
                  <p className="settings-field-note">Плейсхолдери: <code>{`{{calloutKindLabel}}`}</code>, <code>{`{{calloutDepth}}`}</code>, <code>{`{{calloutDepthLabel}}`}</code>, <code>{`{{fragment}}`}</code>, <code>{`{{recommendation}}`}</code>. Prompt може використати тип і глибину врізки як окремі параметри.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, calloutPromptTemplate: DEFAULT_CALLOUT_PROMPT_TEMPLATE }));
                      setSaveMessage(null);
                    }}
                  >
                    Типовий prompt
                  </Button>
                </div>
              </label>

              <label className="settings-field" htmlFor="image-prompt">
                <span className="mono-ui settings-label">Prompt для image generation</span>
                <Textarea
                  id="image-prompt"
                  rows={8}
                  value={settings.imagePromptTemplate}
                  onChange={(event) => {
                    setSettings((current) => ({ ...current, imagePromptTemplate: event.target.value }));
                    setSaveMessage(null);
                  }}
                  className="settings-textarea"
                />
                <div className="settings-textarea-toolbar">
                  <p className="settings-field-note">Плейсхолдери: <code>{`{{visualIntent}}`}</code>, <code>{`{{visualStyleGuide}}`}</code>, <code>{`{{fragment}}`}</code>, <code>{`{{recommendation}}`}</code>.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, imagePromptTemplate: DEFAULT_IMAGE_PROMPT_TEMPLATE }));
                      setSaveMessage(null);
                    }}
                  >
                    Типовий prompt
                  </Button>
                </div>
              </label>
            </section>

            <div className="settings-actions-row">
              <Button
                variant="secondary"
                onClick={() => {
                  setSettings(stripClientApiKeys(DEFAULT_EDITOR_SETTINGS));
                  setSaveMessage(null);
                }}
              >
                Скинути до типових
              </Button>

              <Button
                variant="primary"
                disabled={!hasUnsavedChanges}
                onClick={() => {
                  const persisted = writeEditorSettings(stripClientApiKeys(settings));
                  setSettings(persisted);
                  setPersistedSettings(persisted);
                  window.dispatchEvent(new CustomEvent("orest-editor-settings-updated", { detail: persisted }));
                  setSaveMessage("Налаштування збережено локально в браузері.");
                }}
              >
                Зберегти налаштування
              </Button>
            </div>

            {saveMessage ? <p className="save-note settings-save-note">{saveMessage}</p> : null}
          </section>
        </div>
      </section>
    </main>
  );
}

async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;

  if (!payload) {
    return fallback;
  }

  const parts = [payload.error, payload.code].filter((value): value is string => typeof value === "string" && value.length > 0);
  return parts.length > 0 ? parts.join(" ") : fallback;
}

function areSettingsEqual(left: EditorSettings, right: EditorSettings) {
  return (
    left.provider === right.provider &&
    left.modelId === right.modelId &&
    left.basePrompt === right.basePrompt &&
    left.reviewPrompt === right.reviewPrompt &&
    left.expertisePrompt === right.expertisePrompt &&
    left.cardsPrompt === right.cardsPrompt &&
    left.reviewLevelGuide === right.reviewLevelGuide &&
    areWorkflowStepPromptsEqual(left.workflowStepPrompts, right.workflowStepPrompts) &&
    left.calloutPromptTemplate === right.calloutPromptTemplate &&
    left.imagePromptTemplate === right.imagePromptTemplate
  );
}

function areWorkflowStepPromptsEqual(
  left: EditorSettings["workflowStepPrompts"],
  right: EditorSettings["workflowStepPrompts"]
) {
  return WORKFLOW_STEP_PROMPT_OPTIONS.every((option) => left[option.value] === right[option.value]);
}

function stripClientApiKeys(settings: EditorSettings): EditorSettings {
  return {
    ...settings,
    apiKey: "",
    apiKeys: {}
  };
}

function ModelPresetChips({ preset }: { preset: NonNullable<ReturnType<typeof findProviderModelPreset>> }) {
  const smartness = getModelPresetSmartnessLabel(preset);
  const price = getModelPresetPriceLabel(preset);

  if (!smartness && !price) {
    return null;
  }

  return (
    <span className="settings-model-chip-row" aria-label="Оцінка моделі">
      {smartness ? <span className="settings-model-chip">💡 {smartness}</span> : null}
      {price ? <span className="settings-model-chip">{price}</span> : null}
    </span>
  );
}

function getConnectionLabel(state: SettingsConnectionState) {
  switch (state) {
    case "checking":
      return "Перевіряю";
    case "valid":
      return "Працює";
    case "missing_key":
      return "Немає ключа";
    case "auth_error":
      return "Ключ не підходить";
    case "model_error":
      return "Модель недоступна";
    case "network_error":
      return "Мережа";
    default:
      return "Не перевірено";
  }
}

function getManualModelHelp(modelState: ReturnType<typeof validateModelId>) {
  if (modelState === "missing") {
    return "Введіть точний model id, якщо потрібен preview або внутрішня назва моделі, якої немає в пресетах.";
  }

  if (modelState === "invalid") {
    return "Model id містить недопустимі символи або порожній формат.";
  }

  return "Це ручний model id. Після зміни сторінка автоматично перевірить, чи модель відповідає.";
}
