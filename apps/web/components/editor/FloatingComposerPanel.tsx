"use client";

import { useEffect, useMemo, useRef } from "react";
import { ArrowUp, LoaderCircle, X } from "lucide-react";
import {
  getLocalActionTextIntentOptions,
  type LocalActionExecutor,
  type LocalActionMode,
  type LocalActionRouteResponse,
  type LocalActionTextIntent
} from "../../lib/editor/local-action-router";
import {
  getEditorialCalloutKindOptions,
  getEditorialVisualIntentOptions,
  type EditorialCalloutKind,
  type EditorialVisualIntent,
  type VisualStylePreset,
  type WholeTextChangeLevel
} from "../../lib/editor/review-contract";
import { getVisualStylePresetOptions } from "../../lib/editor/settings";
import { type SpellcheckBlockResult } from "../../lib/editor/spellcheck-view-model";

const reviewLevelOptions: Array<{ level: WholeTextChangeLevel; label: string; description: string }> = [
  { level: 1, label: "1", description: "Мінімальні зауваги" },
  { level: 2, label: "2", description: "Легке шліфування" },
  { level: 3, label: "3", description: "Помірне редакторське втручання" },
  { level: 4, label: "4", description: "Суттєве перепакування" },
  { level: 5, label: "5", description: "Максимально глибокий огляд" }
];

type LocalSurfaceMode = "edit" | "proof" | "callout" | "visual";

const LOCAL_SURFACE_MODE_LABELS: Record<LocalSurfaceMode, string> = {
  edit: "Правка",
  proof: "Правопис",
  callout: "Врізка",
  visual: "Візуал"
};

export function FloatingComposerPanel({
  mode,
  customPrompt,
  onCustomPromptChange,
  localTextIntent,
  localActionRoute,
  onLocalTextIntentChange,
  onRequestAutoAction,
  reviewChangeLevel,
  reviewAdditionalInstructions,
  onReviewChangeLevel,
  onReviewAdditionalInstructionsChange,
  onRequestReview,
  patchLoading,
  reviewLoading,
  localActionMode,
  onLocalActionModeChange,
  manualCalloutKind,
  manualVisualIntent,
  manualVisualStylePreset,
  onManualCalloutKindChange,
  onManualVisualIntentChange,
  onManualVisualStylePresetChange,
  manualCalloutPrompt,
  manualVisualPrompt,
  spellcheckResults,
  spellcheckLoading,
  spellcheckSummary,
  spellcheckSecondarySummary,
  onManualCalloutPromptChange,
  onManualVisualPromptChange,
  onRequestManualCallout,
  onRequestManualVisual,
  onRequestSpellcheck,
  manualLoadingKind,
  onClose
}: {
  mode: "local" | "review";
  customPrompt: string;
  onCustomPromptChange: (value: string) => void;
  localTextIntent: LocalActionTextIntent;
  localActionRoute: LocalActionRouteResponse;
  onLocalTextIntentChange: (intent: LocalActionTextIntent) => void;
  onRequestAutoAction: () => void;
  reviewChangeLevel: WholeTextChangeLevel;
  reviewAdditionalInstructions: string;
  onReviewChangeLevel: (level: WholeTextChangeLevel) => void;
  onReviewAdditionalInstructionsChange: (value: string) => void;
  onRequestReview: () => void;
  patchLoading?: boolean;
  reviewLoading?: boolean;
  localActionMode: LocalActionMode;
  onLocalActionModeChange: (mode: LocalActionMode) => void;
  manualCalloutKind: EditorialCalloutKind;
  manualVisualIntent: EditorialVisualIntent;
  manualVisualStylePreset: VisualStylePreset;
  onManualCalloutKindChange: (value: EditorialCalloutKind) => void;
  onManualVisualIntentChange: (value: EditorialVisualIntent) => void;
  onManualVisualStylePresetChange: (value: VisualStylePreset) => void;
  manualCalloutPrompt: string;
  manualVisualPrompt: string;
  spellcheckResults: SpellcheckBlockResult[];
  spellcheckLoading?: boolean;
  spellcheckSummary?: string | null;
  spellcheckSecondarySummary?: string | null;
  onManualCalloutPromptChange: (value: string) => void;
  onManualVisualPromptChange: (value: string) => void;
  onRequestManualCallout: () => void;
  onRequestManualVisual: () => void;
  onRequestSpellcheck: () => void;
  manualLoadingKind?: "callout" | "visual" | "list" | null;
  onClose: () => void;
}) {
  const isReview = mode === "review";
  const calloutOptions = getEditorialCalloutKindOptions();
  const visualOptions = getEditorialVisualIntentOptions();
  const visualStyleOptions = getVisualStylePresetOptions();
  const manualInFlight = Boolean(manualLoadingKind);
  const localBusy = Boolean(patchLoading || manualInFlight || spellcheckLoading);
  const primaryTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoCalloutTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoVisualTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const calloutTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const visualTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const reviewTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textIntentOptions = getLocalActionTextIntentOptions();
  const showAutoTextModes =
    localActionRoute.executor === "patch" || localActionRoute.executor === "review" || localActionRoute.executor === "clarify";
  useAutosizeTextarea(primaryTextareaRef, customPrompt);
  useAutosizeTextarea(autoCalloutTextareaRef, customPrompt);
  useAutosizeTextarea(autoVisualTextareaRef, customPrompt);
  useAutosizeTextarea(calloutTextareaRef, manualCalloutPrompt);
  useAutosizeTextarea(visualTextareaRef, manualVisualPrompt);
  useAutosizeTextarea(reviewTextareaRef, reviewAdditionalInstructions);

  const localSurfaceMode = useMemo<LocalSurfaceMode>(() => {
    if (localActionMode === "spellcheck") {
      return "proof";
    }

    if (localActionMode === "callout") {
      return "callout";
    }

    if (localActionMode === "visual") {
      return "visual";
    }

    if (localActionRoute.executor === "spellcheck") {
      return "proof";
    }

    if (localActionRoute.executor === "callout") {
      return "callout";
    }

    if (localActionRoute.executor === "visual") {
      return "visual";
    }

    return "edit";
  }, [localActionMode, localActionRoute.executor]);

  const spellcheckStatusCopy =
    spellcheckSummary ??
    (spellcheckLoading
      ? "Перевіряємо вибрані текстові блоки."
      : "Перевірити виділений фрагмент через LanguageTool і показати проблеми в рукописі.");
  const autoCalloutPromptValue = localActionMode === "callout" ? manualCalloutPrompt : customPrompt;
  const autoVisualPromptValue = localActionMode === "visual" ? manualVisualPrompt : customPrompt;
  const isExplicitSpecialMode = localActionMode === "callout" || localActionMode === "visual";
  const sendLabel =
    localActionMode === "callout"
      ? "Підготувати врізку"
      : localActionMode === "visual"
        ? "Підготувати візуал"
        : localActionMode === "spellcheck"
          ? "Перевірити правопис"
          : localActionRoute.actionLabel;

  function isExecutorLoading(executor: LocalActionExecutor) {
    if (executor === "patch") {
      return Boolean(patchLoading);
    }

    if (executor === "review") {
      return manualLoadingKind === "list";
    }

    if (executor === "spellcheck") {
      return Boolean(spellcheckLoading);
    }

    if (executor === "callout") {
      return manualLoadingKind === "callout";
    }

    if (executor === "visual") {
      return manualLoadingKind === "visual";
    }

    return false;
  }

  const editSendLoading = !isReview && localActionMode === "auto" ? isExecutorLoading(localActionRoute.executor) : false;
  const proofSendLoading = Boolean(spellcheckLoading);
  const calloutSendLoading =
    localActionMode === "callout"
      ? manualLoadingKind === "callout"
      : !isReview && localActionRoute.executor === "callout" && manualLoadingKind === "callout";
  const visualSendLoading =
    localActionMode === "visual"
      ? manualLoadingKind === "visual"
      : !isReview && localActionRoute.executor === "visual" && manualLoadingKind === "visual";

  function renderSendIcon(isLoading: boolean) {
    if (isLoading) {
      return <LoaderCircle size={15} className="floating-bridge-send-spinner" />;
    }

    return <ArrowUp size={15} />;
  }

  function handleModeSelect(nextMode: LocalSurfaceMode) {
    onLocalActionModeChange(
      nextMode === "edit" ? "auto" : nextMode === "proof" ? "spellcheck" : nextMode
    );
  }

  if (!isReview) {
    return (
      <section className="floating-bridge-shell" aria-label="Локальна правка">
        <div className="floating-bridge-surface" data-mode={localSurfaceMode}>
          <div className="floating-bridge-top">
            <div className="floating-bridge-mode-tabs" role="tablist" aria-label="Режими локальної дії">
              {(["edit", "proof", "callout", "visual"] as LocalSurfaceMode[]).map((surfaceMode) => (
                <button
                  key={surfaceMode}
                  type="button"
                  role="tab"
                  aria-selected={localSurfaceMode === surfaceMode}
                  className="floating-bridge-mode-tab"
                  data-active={localSurfaceMode === surfaceMode ? "true" : "false"}
                  onClick={() => handleModeSelect(surfaceMode)}
                  disabled={localBusy}
                >
                  {LOCAL_SURFACE_MODE_LABELS[surfaceMode]}
                </button>
              ))}
            </div>
            <button type="button" className="floating-bridge-close" onClick={onClose} aria-label="Закрити панель" title="Закрити">
              <X size={14} />
            </button>
          </div>

          <div className="floating-bridge-mode-shell">
            <section className="floating-bridge-mode-panel" data-active={localSurfaceMode === "edit" ? "true" : "false"}>
              <div className="floating-bridge-main">
                <div className="floating-bridge-textarea-shell" data-working={editSendLoading ? "true" : "false"}>
                  <textarea
                    ref={primaryTextareaRef}
                    className="floating-bridge-textarea"
                    rows={2}
                    placeholder="Що зробити з виділеним?"
                    value={customPrompt}
                    onChange={(event) => onCustomPromptChange(event.currentTarget.value)}
                    disabled={localBusy}
                  />
                </div>
                {localActionRoute.executor === "clarify" ? (
                  <div className="floating-bridge-clarify">
                    <span className="floating-bridge-clarify-label">Уточніть дію</span>
                    <div className="floating-bridge-clarify-row">
                      <button type="button" className="floating-bridge-clarify-button" onClick={() => onLocalTextIntentChange("rewrite")}>
                        Правка
                      </button>
                      <button type="button" className="floating-bridge-clarify-button" onClick={() => handleModeSelect("callout")}>
                        Врізка
                      </button>
                      <button type="button" className="floating-bridge-clarify-button" onClick={() => handleModeSelect("visual")}>
                        Візуал
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="floating-bridge-footer">
                <div className="floating-bridge-footer-left">
                  {showAutoTextModes ? (
                    <div className="floating-bridge-segmented" role="tablist" aria-label="Режим текстової дії">
                      {textIntentOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="tab"
                          aria-selected={localTextIntent === option.value}
                          className="floating-bridge-segmented-option"
                          data-active={localTextIntent === option.value ? "true" : "false"}
                          onClick={() => onLocalTextIntentChange(option.value)}
                          disabled={localBusy}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="floating-bridge-segmented floating-bridge-segmented-ghost">
                      <button type="button" className="floating-bridge-segmented-option" disabled>
                        {getLocalActionTextIntentOptions().find((option) => option.value === localTextIntent)?.label ?? "Переписати"}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="floating-bridge-send"
                  onClick={onRequestAutoAction}
                  disabled={localBusy}
                  data-loading={editSendLoading ? "true" : "false"}
                  aria-busy={editSendLoading}
                  aria-label={sendLabel}
                  title={sendLabel}
                >
                  {renderSendIcon(editSendLoading)}
                </button>
              </div>
            </section>

            <section className="floating-bridge-mode-panel" data-active={localSurfaceMode === "proof" ? "true" : "false"}>
              <div className="floating-bridge-main">
                <p className="floating-bridge-status-copy">{spellcheckStatusCopy}</p>
                {spellcheckSecondarySummary ? <p className="floating-bridge-status-copy floating-bridge-status-copy-secondary">{spellcheckSecondarySummary}</p> : null}
                {spellcheckResults.length > 0 ? (
                  <p className="floating-bridge-status-copy floating-bridge-status-copy-secondary">Проблемні блоки вже підсвічено в рукописі.</p>
                ) : null}
              </div>
              <div className="floating-bridge-footer">
                <div className="floating-bridge-footer-left" />
                <button
                  type="button"
                  className="floating-bridge-send"
                  onClick={localActionMode === "spellcheck" ? onRequestSpellcheck : onRequestAutoAction}
                  disabled={localActionMode === "spellcheck" ? Boolean(spellcheckLoading) : localBusy}
                  data-loading={proofSendLoading ? "true" : "false"}
                  aria-busy={proofSendLoading}
                  aria-label={sendLabel}
                  title={sendLabel}
                >
                  {renderSendIcon(proofSendLoading)}
                </button>
              </div>
            </section>

            <section className="floating-bridge-mode-panel" data-active={localSurfaceMode === "callout" ? "true" : "false"}>
              <div className="floating-bridge-main">
                <div className="floating-bridge-textarea-shell" data-working={calloutSendLoading ? "true" : "false"}>
                  <textarea
                    ref={localActionMode === "callout" ? calloutTextareaRef : autoCalloutTextareaRef}
                    className="floating-bridge-textarea"
                    rows={2}
                    placeholder="Що саме підкреслити у врізці..."
                    value={autoCalloutPromptValue}
                    onChange={(event) =>
                      localActionMode === "callout"
                        ? onManualCalloutPromptChange(event.currentTarget.value)
                        : onCustomPromptChange(event.currentTarget.value)
                    }
                    disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                  />
                </div>
              </div>
              <div className="floating-bridge-footer">
                <div className="floating-bridge-footer-left">
                  <div className="floating-bridge-select-shell">
                    <select
                      value={manualCalloutKind}
                      onChange={(event) => onManualCalloutKindChange(event.target.value as EditorialCalloutKind)}
                      disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                      aria-label="Тип врізки"
                    >
                      {calloutOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className="floating-bridge-send"
                  onClick={localActionMode === "callout" ? onRequestManualCallout : onRequestAutoAction}
                  disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                  data-loading={calloutSendLoading ? "true" : "false"}
                  aria-busy={calloutSendLoading}
                  aria-label={sendLabel}
                  title={sendLabel}
                >
                  {renderSendIcon(calloutSendLoading)}
                </button>
              </div>
            </section>

            <section className="floating-bridge-mode-panel" data-active={localSurfaceMode === "visual" ? "true" : "false"}>
              <div className="floating-bridge-main">
                <div className="floating-bridge-textarea-shell" data-working={visualSendLoading ? "true" : "false"}>
                  <textarea
                    ref={localActionMode === "visual" ? visualTextareaRef : autoVisualTextareaRef}
                    className="floating-bridge-textarea"
                    rows={2}
                    placeholder="Що саме має показати візуал..."
                    value={autoVisualPromptValue}
                    onChange={(event) =>
                      localActionMode === "visual"
                        ? onManualVisualPromptChange(event.currentTarget.value)
                        : onCustomPromptChange(event.currentTarget.value)
                    }
                    disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                  />
                </div>
              </div>
              <div className="floating-bridge-footer">
                <div className="floating-bridge-footer-left">
                  <div className="floating-bridge-segmented floating-bridge-segmented-compact">
                    {visualOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="floating-bridge-segmented-option"
                        data-active={manualVisualIntent === option.value ? "true" : "false"}
                        onClick={() => onManualVisualIntentChange(option.value)}
                        disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="floating-bridge-select-shell">
                    <select
                      value={manualVisualStylePreset}
                      onChange={(event) => onManualVisualStylePresetChange(event.target.value as VisualStylePreset)}
                      disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                      aria-label="Стиль візуалу"
                    >
                      {visualStyleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className="floating-bridge-send"
                  onClick={localActionMode === "visual" ? onRequestManualVisual : onRequestAutoAction}
                  disabled={isExplicitSpecialMode ? manualInFlight : localBusy}
                  data-loading={visualSendLoading ? "true" : "false"}
                  aria-busy={visualSendLoading}
                  aria-label={sendLabel}
                  title={sendLabel}
                >
                  {renderSendIcon(visualSendLoading)}
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="floating-panel" data-mode={mode} data-collapsed="false" aria-label={isReview ? "Огляд документа" : "Локальна правка"}>
      <header className="floating-panel-header">
        <div className="floating-panel-title-stack">
          <p className="mono-ui">{isReview ? "Огляд документа" : "Локальні дії"}</p>
          <div className="floating-panel-question">
            {isReview
              ? "Наскільки глибоко перевірити документ?"
              : localActionMode === "auto"
                ? "Виконайте локальну дію для виділеного фрагмента"
                : localActionMode === "spellcheck"
                  ? "Перевірте правопис у виділеному фрагменті"
                  : localActionMode === "callout"
                    ? "Підготуйте врізку для виділеного фрагмента"
                    : "Підготуйте візуал для виділеного фрагмента"}
          </div>
        </div>
        <div className="floating-panel-header-actions">
          <button type="button" className="panel-toggle" onClick={onClose} aria-label="Закрити панель" title="Закрити">
            ×
          </button>
        </div>
      </header>

      <div className="floating-panel-body">
        <div className="floating-review-body">
            <div className="floating-review-scale">
              {reviewLevelOptions.map((option) => (
                <button
                  key={option.level}
                  type="button"
                  className="floating-review-scale-button"
                  data-active={reviewChangeLevel === option.level ? "true" : "false"}
                  onClick={() => onReviewChangeLevel(option.level)}
                >
                  <span className="mono-ui">{option.label}</span>
                </button>
              ))}
            </div>
            <p className="floating-review-description">
              {reviewLevelOptions.find((option) => option.level === reviewChangeLevel)?.description}
            </p>
            <div className="floating-textarea-shell">
              <textarea
                ref={reviewTextareaRef}
                className="floating-textarea"
                rows={3}
                placeholder="Додаткові інструкції для огляду"
                value={reviewAdditionalInstructions}
                onChange={(event) => onReviewAdditionalInstructionsChange(event.currentTarget.value)}
              />
            </div>
            <div className="floating-footer">
              <div />
              <div className="send-row">
                <button type="button" className="send-button mono-ui" onClick={onRequestReview} disabled={reviewLoading} aria-label="Запустити огляд" title="Запустити огляд">
                  {reviewLoading ? "…" : "→"}
                </button>
              </div>
            </div>
          </div>
      </div>
    </section>
  );
}

function useAutosizeTextarea(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const node = ref.current;

    if (!node) {
      return;
    }

    node.style.height = "auto";
    const lineHeight = Number.parseFloat(window.getComputedStyle(node).lineHeight || "22");
    const maxHeight = lineHeight * 5 + 24;
    node.style.height = `${Math.min(node.scrollHeight, maxHeight)}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [ref, value]);
}
