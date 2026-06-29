"use client";

import { useEffect, useMemo, useState } from "react";
import { TopBar } from "../../components/layout/TopBar";
import { useProductCopy, useProductLocale } from "../../components/providers/ProductLocaleProvider";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { StatusDot } from "../../components/ui/StatusDot";
import { Textarea } from "../../components/ui/Textarea";
import { EDITORIAL_REVIEW_STEP_IDS, type EditorialReviewStepId } from "../../lib/editor/review-contract";
import {
  CUSTOM_MODEL_OPTION,
  findProviderModelPreset,
  getDefaultEditorSettings,
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
import { getWorkflowStepLabel } from "../../lib/i18n/editor-messages";
import type { ProductCopy } from "../../lib/i18n/copy";

interface ConnectionStatusSnapshot {
  provider: ProviderId;
  modelId: string;
  state: SettingsConnectionState;
  keySource: SettingsKeySource;
  message: string;
  validatedAt: string | null;
}

export default function SettingsPage() {
  const copy = useProductCopy();
  const { locale, setLocale } = useProductLocale();
  const defaultSettings = useMemo(() => getDefaultEditorSettings(locale), [locale]);
  const [settings, setSettings] = useState<EditorSettings>(() => getDefaultEditorSettings(locale));
  const [persistedSettings, setPersistedSettings] = useState<EditorSettings>(() => getDefaultEditorSettings(locale));
  const [activeStepPromptId, setActiveStepPromptId] = useState<EditorialReviewStepId>("diagnostics");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [validationNonce, setValidationNonce] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatusSnapshot>(() => ({
    provider: defaultSettings.provider,
    modelId: defaultSettings.modelId,
    state: "idle",
    keySource: "missing",
    message: copy.settings.connectionPrompt,
    validatedAt: null
  }));

  useEffect(() => {
    const restored = stripClientApiKeys(readEditorSettings(locale));
    setSettings(restored);
    setPersistedSettings(restored);
  }, [locale]);

  const providerLabel = getProviderLabel(settings.provider);
  const modelPresets = getProviderModelPresets(settings.provider, locale);
  const normalizedSettingsModelId = normalizeModelId(settings.provider, settings.modelId);
  const selectedPreset = modelPresets.find((preset) => preset.id === normalizedSettingsModelId) ?? null;
  const selectedModelOption = selectedPreset?.id ?? CUSTOM_MODEL_OPTION;
  const currentModelId = selectedModelOption === CUSTOM_MODEL_OPTION ? settings.modelId.trim() : normalizeModelId(settings.provider, settings.modelId);
  const modelState = validateModelId(currentModelId);
  const providerEnvKey = getProviderEnvKey(settings.provider);
  const hasUnsavedChanges = !areSettingsEqual(settings, persistedSettings);
  const workflowStepPromptOptions = useMemo(
    () =>
      EDITORIAL_REVIEW_STEP_IDS.map((stepId) => ({
        value: stepId,
        label: getWorkflowStepLabel(locale, stepId)
      })),
    [locale]
  );

  useEffect(() => {
    const validationKeySource: SettingsKeySource = "missing";

    if (modelState !== "valid") {
      setConnectionStatus({
        provider: settings.provider,
        modelId: currentModelId,
        state: modelState === "missing" ? "idle" : "model_error",
        keySource: validationKeySource,
        message:
          modelState === "missing" ? copy.settings.connectionModelMissing : copy.settings.connectionModelInvalid,
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
        message: copy.settings.connectionCheckingMessage,
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
          const authError = await readApiErrorMessage(response, copy.settings.authSessionError);
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
            message: copy.settings.serverInvalidResponse,
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
          message: error instanceof Error ? error.message : copy.settings.modelCheckFailed,
          validatedAt: new Date().toISOString()
        });
      }
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [copy.settings, currentModelId, modelState, settings.provider, validationNonce]);

  return (
    <main className="app-shell">
      <TopBar activePath="/settings" />

      <section className="settings-page-shell">
        <div className="settings-stage">
          <section className="settings-sheet settings-sheet-focused">
            <header className="settings-hero">
              <div className="settings-hero-copy">
                <p className="mono-ui sidebar-title">{copy.settings.title}</p>
                <h1 className="settings-title">{copy.settings.heroTitle}</h1>
              </div>

              <div className="settings-summary-grid">
                <article className="settings-summary-card">
                  <p className="mono-ui settings-summary-label">{copy.settings.currentProvider}</p>
                  <p className="settings-summary-value">{providerLabel}</p>
                  <p className="settings-summary-copy">
                    {selectedPreset?.label ?? (currentModelId || copy.settings.pendingModelSelection)}
                  </p>
                  {selectedPreset ? <ModelPresetChips preset={selectedPreset} ratingLabel={copy.topbar.modelRating} /> : null}
                </article>

                <article className="settings-summary-card" data-tone={connectionStatus.state}>
                  <div className="settings-summary-head">
                    <p className="mono-ui settings-summary-label">{copy.settings.modelCheck}</p>
                    <span className="settings-summary-status">
                      <StatusDot state={connectionStatus.state} />
                      <span>{getConnectionLabel(connectionStatus.state, copy)}</span>
                    </span>
                  </div>
                  <p className="settings-summary-copy">{connectionStatus.message}</p>
                </article>
              </div>
            </header>

            <section className="settings-section">
              <div className="settings-section-head settings-section-head-static">
                <div>
                  <p className="mono-ui settings-section-kicker">{copy.settings.title}</p>
                  <h2 className="settings-section-title">{copy.settings.language.label}</h2>
                </div>
              </div>
              <div className="settings-form-grid">
                <label className="settings-field" htmlFor="app-language">
                  <span className="mono-ui settings-label">{copy.settings.language.label}</span>
                  <Select
                    id="app-language"
                    value={locale}
                    onChange={(event) => {
                      const nextLocale = event.target.value === "en" ? "en" : "uk";
                      const confirmed = window.confirm(`${copy.settings.language.confirmTitle}\n\n${copy.settings.language.confirmBody}`);

                      if (!confirmed) {
                        return;
                      }

                      setLocale(nextLocale);
                      setSaveMessage(copy.settings.language.switched);
                    }}
                  >
                    <option value="uk">{copy.settings.language.uk}</option>
                    <option value="en">{copy.settings.language.en}</option>
                  </Select>
                  <p className="settings-field-note">{copy.settings.language.note}</p>
                </label>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-head">
                <div>
                  <p className="mono-ui settings-section-kicker">{copy.settings.connectionKicker}</p>
                  <h2 className="settings-section-title">{copy.settings.connectionTitle}</h2>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={connectionStatus.state === "checking"}
                  loadingLabel={copy.settings.validateChecking}
                  onClick={() => setValidationNonce((current) => current + 1)}
                >
                  {copy.generic.check}
                </Button>
              </div>

              <div className="settings-form-grid">
                <label className="settings-field" htmlFor="provider">
                  <span className="mono-ui settings-label">{copy.settings.provider}</span>
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
                  <p className="settings-field-note">{copy.settings.providerNote}</p>
                </label>

                <label className="settings-field" htmlFor="model-preset">
                  <span className="mono-ui settings-label">{copy.settings.model}</span>
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
                    <option value={CUSTOM_MODEL_OPTION}>{copy.settings.manualModel}</option>
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
                        placeholder={copy.settings.modelPlaceholder}
                      />
                      <span className="settings-inline-status">
                        <StatusDot state={modelState} />
                      </span>
                    </div>
                  ) : null}

                  <div className="settings-validation-row">
                    <span className="settings-validation-status">
                      <StatusDot state={connectionStatus.state} />
                      <span>{getConnectionLabel(connectionStatus.state, copy)}</span>
                    </span>
                    {selectedPreset ? <ModelPresetChips preset={selectedPreset} ratingLabel={copy.topbar.modelRating} /> : null}
                    <span className="settings-validation-text">
                      {selectedPreset ? selectedPreset.description : getManualModelHelp(modelState, copy)}
                    </span>
                  </div>
                </label>

                <div className="settings-field">
                  <span className="mono-ui settings-label">{copy.settings.providerKey}</span>
                  <p className="settings-field-note">
                    {copy.settings.providerKeyNotePrefix} <code>{providerEnvKey}</code>.
                  </p>
                </div>
              </div>
            </section>

            <section className="settings-section settings-section-advanced">
              <div className="settings-section-head settings-section-head-static">
                <div>
                  <p className="mono-ui settings-section-kicker">{copy.settings.behavior}</p>
                  <h2 className="settings-section-title">{copy.settings.promptTemplates}</h2>
                </div>
              </div>

              <label className="settings-field" htmlFor="base-prompt">
                <span className="mono-ui settings-label">{copy.settings.basePromptLabel}</span>
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
                  <p className="settings-field-note">{copy.settings.basePromptNote}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, basePrompt: defaultSettings.basePrompt }));
                      setSaveMessage(null);
                    }}
                  >
                    {copy.settings.defaultPrompt}
                  </Button>
                </div>
              </label>

              <label className="settings-field" htmlFor="expertise-prompt">
                <span className="mono-ui settings-label">{copy.settings.expertisePromptLabel}</span>
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
                  <p className="settings-field-note">{copy.settings.expertisePromptNote}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, expertisePrompt: defaultSettings.expertisePrompt }));
                      setSaveMessage(null);
                    }}
                  >
                    {copy.settings.defaultPrompt}
                  </Button>
                </div>
              </label>

              <label className="settings-field" htmlFor="review-prompt">
                <span className="mono-ui settings-label">{copy.settings.reviewPromptLabel}</span>
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
                  <p className="settings-field-note">{copy.settings.reviewPromptNote}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, reviewPrompt: defaultSettings.reviewPrompt }));
                      setSaveMessage(null);
                    }}
                  >
                    {copy.settings.defaultPrompt}
                  </Button>
                </div>
              </label>

              <label className="settings-field" htmlFor="cards-prompt">
                <span className="mono-ui settings-label">{copy.settings.cardsPromptLabel}</span>
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
                  <p className="settings-field-note">{copy.settings.cardsPromptNote}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, cardsPrompt: defaultSettings.cardsPrompt }));
                      setSaveMessage(null);
                    }}
                  >
                    {copy.settings.defaultPrompt}
                  </Button>
                </div>
              </label>

              <div className="settings-field">
                <label className="settings-field" htmlFor="workflow-step-prompt">
                  <span className="mono-ui settings-label">{copy.settings.workflowStepPromptsLabel}</span>
                  <div className="settings-step-prompt-head">
                    <Select
                      id="workflow-step-prompt"
                      value={activeStepPromptId}
                      onChange={(event) => setActiveStepPromptId(event.target.value as EditorialReviewStepId)}
                    >
                      {workflowStepPromptOptions.map((option) => (
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
                            [activeStepPromptId]: defaultSettings.workflowStepPrompts[activeStepPromptId]
                          }
                        }));
                        setSaveMessage(null);
                      }}
                    >
                      {copy.settings.defaultStep}
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
                <p className="settings-field-note">{copy.settings.workflowStepPromptNote}</p>
              </div>

              <label className="settings-field" htmlFor="callout-prompt">
                <span className="mono-ui settings-label">{copy.settings.calloutPromptLabel}</span>
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
                  <p className="settings-field-note">{copy.settings.calloutPromptNote}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, calloutPromptTemplate: defaultSettings.calloutPromptTemplate }));
                      setSaveMessage(null);
                    }}
                  >
                    {copy.settings.defaultPrompt}
                  </Button>
                </div>
              </label>

              <label className="settings-field" htmlFor="image-prompt">
                <span className="mono-ui settings-label">{copy.settings.imagePromptLabel}</span>
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
                  <p className="settings-field-note">{copy.settings.imagePromptNote}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({ ...current, imagePromptTemplate: defaultSettings.imagePromptTemplate }));
                      setSaveMessage(null);
                    }}
                  >
                    {copy.settings.defaultPrompt}
                  </Button>
                </div>
              </label>
            </section>

            <div className="settings-actions-row">
              <Button
                variant="secondary"
                onClick={() => {
                  setSettings(stripClientApiKeys(getDefaultEditorSettings(locale)));
                  setSaveMessage(null);
                }}
              >
                {copy.settings.resetDefaults}
              </Button>

              <Button
                variant="primary"
                disabled={!hasUnsavedChanges}
                onClick={() => {
                  const persisted = writeEditorSettings(stripClientApiKeys(settings), locale);
                  setSettings(persisted);
                  setPersistedSettings(persisted);
                  window.dispatchEvent(new CustomEvent("orest-editor-settings-updated", { detail: persisted }));
                  setSaveMessage(copy.settings.saveSuccess);
                }}
              >
                {copy.settings.saveSettings}
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
  return EDITORIAL_REVIEW_STEP_IDS.every((stepId) => left[stepId] === right[stepId]);
}

function stripClientApiKeys(settings: EditorSettings): EditorSettings {
  return {
    ...settings,
    apiKey: "",
    apiKeys: {}
  };
}

function ModelPresetChips({
  preset,
  ratingLabel
}: {
  preset: NonNullable<ReturnType<typeof findProviderModelPreset>>;
  ratingLabel: string;
}) {
  const smartness = getModelPresetSmartnessLabel(preset);
  const price = getModelPresetPriceLabel(preset);

  if (!smartness && !price) {
    return null;
  }

  return (
    <span className="settings-model-chip-row" aria-label={ratingLabel}>
      {smartness ? <span className="settings-model-chip">💡 {smartness}</span> : null}
      {price ? <span className="settings-model-chip">{price}</span> : null}
    </span>
  );
}

function getConnectionLabel(state: SettingsConnectionState, copy: ProductCopy) {
  switch (state) {
    case "checking":
      return copy.settings.connectionChecking;
    case "valid":
      return copy.settings.connectionValid;
    case "missing_key":
      return copy.settings.connectionMissingKey;
    case "auth_error":
      return copy.settings.connectionAuthError;
    case "model_error":
      return copy.settings.connectionModelError;
    case "network_error":
      return copy.settings.connectionNetworkError;
    default:
      return copy.settings.connectionIdle;
  }
}

function getManualModelHelp(modelState: ReturnType<typeof validateModelId>, copy: ProductCopy) {
  if (modelState === "missing") {
    return copy.settings.manualModelHelpMissing;
  }

  if (modelState === "invalid") {
    return copy.settings.manualModelHelpInvalid;
  }

  return copy.settings.manualModelHelpValid;
}
