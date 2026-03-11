"use client";

import { FileText, Image as ImageIcon, Search, Sparkles, Wand2 } from "lucide-react";
import {
  getEditorialCalloutKindOptions,
  getEditorialVisualIntentOptions,
  type EditorialCalloutKind,
  type EditorialVisualIntent,
  type VisualStylePreset,
  type WholeTextChangeLevel
} from "../../lib/editor/review-contract";
import { getVisualStylePresetOptions } from "../../lib/editor/settings";

const reviewLevelOptions: Array<{ level: WholeTextChangeLevel; label: string; description: string }> = [
  { level: 1, label: "1", description: "Мінімальні зауваги" },
  { level: 2, label: "2", description: "Легке шліфування" },
  { level: 3, label: "3", description: "Помірне редакторське втручання" },
  { level: 4, label: "4", description: "Суттєве перепакування" },
  { level: 5, label: "5", description: "Максимально глибокий огляд" }
];

type LocalActionMode = "patch" | "callout" | "visual";

export function FloatingComposerPanel({
  mode,
  selectedBlockCount,
  customPrompt,
  onCustomPromptChange,
  onRequestDefaultPatch,
  onRequestCustomPatch,
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
  onManualCalloutPromptChange,
  onManualVisualPromptChange,
  onRequestManualCallout,
  onRequestManualVisual,
  manualLoadingKind,
  onClose
}: {
  mode: "local" | "review";
  selectedBlockCount: number;
  customPrompt: string;
  onCustomPromptChange: (value: string) => void;
  onRequestDefaultPatch: () => void;
  onRequestCustomPatch: () => void;
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
  onManualCalloutPromptChange: (value: string) => void;
  onManualVisualPromptChange: (value: string) => void;
  onRequestManualCallout: () => void;
  onRequestManualVisual: () => void;
  manualLoadingKind?: "callout" | "visual" | null;
  onClose: () => void;
}) {
  const isReview = mode === "review";
  const calloutOptions = getEditorialCalloutKindOptions();
  const visualOptions = getEditorialVisualIntentOptions();
  const visualStyleOptions = getVisualStylePresetOptions();
  const manualInFlight = Boolean(manualLoadingKind);

  return (
    <section className="floating-panel" data-mode={mode} data-collapsed="false" aria-label={isReview ? "Огляд документа" : "Локальна правка"}>
      <header className="floating-panel-header">
        <div className="floating-panel-title-stack">
          <p className="mono-ui">{isReview ? "Огляд документа" : `Локальна правка · ${selectedBlockCount}`}</p>
          <div className="floating-panel-question">
            {isReview
              ? "Наскільки глибоко перевірити документ?"
              : localActionMode === "patch"
                ? "Локальна правка вибраних абзаців"
                : localActionMode === "callout"
                  ? "Згенерувати врізку для виділеного фрагмента"
                  : "Згенерувати візуал для виділеного фрагмента"}
          </div>
        </div>
        <div className="floating-panel-header-actions">
          <button type="button" className="panel-toggle" onClick={onClose} aria-label="Закрити панель" title="Закрити">
            ×
          </button>
        </div>
      </header>

      <div className="floating-panel-body">
        {isReview ? (
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
        ) : (
          <>
            <div className="floating-local-mode-tabs">
              <button
                type="button"
                className="floating-local-mode-tab"
                data-active={localActionMode === "patch" ? "true" : "false"}
                onClick={() => onLocalActionModeChange("patch")}
                disabled={patchLoading || manualInFlight}
                title="Локальна правка"
              >
                <Search size={14} />
                <span>Правка</span>
              </button>
              <button
                type="button"
                className="floating-local-mode-tab"
                data-active={localActionMode === "callout" ? "true" : "false"}
                onClick={() => onLocalActionModeChange("callout")}
                disabled={patchLoading || manualInFlight}
                title="Генерація врізки"
              >
                <FileText size={14} />
                <span>Врізка</span>
              </button>
              <button
                type="button"
                className="floating-local-mode-tab"
                data-active={localActionMode === "visual" ? "true" : "false"}
                onClick={() => onLocalActionModeChange("visual")}
                disabled={patchLoading || manualInFlight}
                title="Генерація візуалу"
              >
                <Wand2 size={14} />
                <span>Візуал</span>
              </button>
            </div>

            {localActionMode === "patch" ? (
              <div className="floating-local-section">
                <div className="floating-local-actions">
                  <button type="button" className="floating-panel-inline-action" onClick={onRequestDefaultPatch} disabled={patchLoading}>
                    <Sparkles size={14} />
                    Швидко покращити
                  </button>
                </div>
                <div className="floating-textarea-shell">
                  <textarea
                    className="floating-textarea"
                    rows={2}
                    placeholder="Уточніть, як саме редагувати (необов'язково)"
                    value={customPrompt}
                    onChange={(event) => onCustomPromptChange(event.currentTarget.value)}
                  />
                </div>
                <p className="floating-mode-hint">Запит вище використовується лише для режиму «Правка за запитом».</p>
                <div className="floating-footer">
                  <div />
                  <div className="send-row">
                    <button
                      type="button"
                      className="floating-panel-inline-action"
                      onClick={onRequestCustomPatch}
                      disabled={patchLoading || !customPrompt.trim()}
                      aria-label="Виконати правку за запитом"
                      title="Виконати правку за запитом"
                    >
                      <Search size={14} />
                      Виконати за запитом
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {localActionMode === "callout" ? (
              <div className="floating-local-section">
                <label className="mono-ui floating-local-label">
                  Тип врізки
                  <select
                    className="floating-local-select"
                    value={manualCalloutKind}
                    onChange={(event) => onManualCalloutKindChange(event.target.value as EditorialCalloutKind)}
                    disabled={manualInFlight}
                  >
                    {calloutOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="floating-textarea-shell">
                  <textarea
                    className="floating-textarea"
                    rows={2}
                    placeholder="Додатковий запит для врізки (необов'язково)"
                    value={manualCalloutPrompt}
                    onChange={(event) => onManualCalloutPromptChange(event.currentTarget.value)}
                    disabled={manualInFlight}
                  />
                </div>
                <p className="floating-mode-hint">Цей запит буде враховано під час генерації врізки.</p>
                <div className="floating-footer">
                  <div />
                  <div className="send-row">
                    <button
                      type="button"
                      className="floating-panel-inline-action"
                      onClick={onRequestManualCallout}
                      disabled={manualInFlight}
                      aria-label="Згенерувати врізку"
                      title="Згенерувати врізку"
                    >
                      <FileText size={14} />
                      {manualLoadingKind === "callout" ? "Генерація…" : "Згенерувати врізку"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {localActionMode === "visual" ? (
              <div className="floating-local-section">
                <label className="mono-ui floating-local-label">
                  Тип візуалу
                  <select
                    className="floating-local-select"
                    value={manualVisualIntent}
                    onChange={(event) => onManualVisualIntentChange(event.target.value as EditorialVisualIntent)}
                    disabled={manualInFlight}
                  >
                    {visualOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mono-ui floating-local-label">
                  Стиль візуалу
                  <select
                    className="floating-local-select"
                    value={manualVisualStylePreset}
                    onChange={(event) => onManualVisualStylePresetChange(event.target.value as VisualStylePreset)}
                    disabled={manualInFlight}
                  >
                    {visualStyleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="floating-textarea-shell">
                  <textarea
                    className="floating-textarea"
                    rows={2}
                    placeholder="Додатковий запит для візуалу (необов'язково)"
                    value={manualVisualPrompt}
                    onChange={(event) => onManualVisualPromptChange(event.currentTarget.value)}
                    disabled={manualInFlight}
                  />
                </div>
                <p className="floating-mode-hint">Цей запит буде враховано під час генерації візуалу.</p>
                <div className="floating-footer">
                  <div />
                  <div className="send-row">
                    <button
                      type="button"
                      className="floating-panel-inline-action"
                      onClick={onRequestManualVisual}
                      disabled={manualInFlight}
                      aria-label="Згенерувати візуал"
                      title="Згенерувати візуал"
                    >
                      <ImageIcon size={14} />
                      {manualLoadingKind === "visual" ? "Генерація…" : "Згенерувати візуал"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
