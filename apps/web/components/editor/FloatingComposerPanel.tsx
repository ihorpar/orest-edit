"use client";
import { Quote, Image as ImageIcon, Sparkles } from "lucide-react";
import {
  getEditorialCalloutKindOptions,
  getEditorialVisualIntentOptions,
  type EditorialCalloutKind,
  type EditorialVisualIntent,
  type WholeTextChangeLevel
} from "../../lib/editor/review-contract";

const reviewLevelOptions: Array<{ level: WholeTextChangeLevel; label: string; description: string }> = [
  { level: 1, label: "1", description: "Мінімальні зауваги" },
  { level: 2, label: "2", description: "Легке шліфування" },
  { level: 3, label: "3", description: "Помірне редакторське втручання" },
  { level: 4, label: "4", description: "Суттєве перепакування" },
  { level: 5, label: "5", description: "Максимально глибокий огляд" }
];

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
  manualCalloutKind,
  manualVisualIntent,
  onManualCalloutKindChange,
  onManualVisualIntentChange,
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
  manualCalloutKind: EditorialCalloutKind;
  manualVisualIntent: EditorialVisualIntent;
  onManualCalloutKindChange: (value: EditorialCalloutKind) => void;
  onManualVisualIntentChange: (value: EditorialVisualIntent) => void;
  onRequestManualCallout: () => void;
  onRequestManualVisual: () => void;
  manualLoadingKind?: "callout" | "visual" | null;
  onClose: () => void;
}) {
  const isReview = mode === "review";
  const calloutOptions = getEditorialCalloutKindOptions();
  const visualOptions = getEditorialVisualIntentOptions();
  const manualInFlight = Boolean(manualLoadingKind);

  return (
    <section className="floating-panel" data-mode={mode} data-collapsed="false" aria-label={isReview ? "Огляд документа" : "Локальна правка"}>
      <header className="floating-panel-header">
        <div className="floating-panel-title-stack">
          <p className="mono-ui">{isReview ? "Огляд документа" : `Локальна правка · ${selectedBlockCount}`}</p>
          <div className="floating-panel-question">
            {isReview ? "Наскільки глибоко перевірити документ?" : "Що змінити у вибраних абзацах?"}
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
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
                marginBottom: "10px"
              }}
            >
              <button
                type="button"
                className="floating-panel-inline-action"
                onClick={onRequestManualCallout}
                disabled={manualInFlight}
                title="Згенерувати врізку"
                aria-label="Згенерувати врізку"
                style={{ justifyContent: "center", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <Quote size={14} />
                <span>Врізка</span>
                {manualLoadingKind === "callout" ? <span className="mono-ui">…</span> : null}
              </button>
              <button
                type="button"
                className="floating-panel-inline-action"
                onClick={onRequestManualVisual}
                disabled={manualInFlight}
                title="Згенерувати візуал"
                aria-label="Згенерувати візуал"
                style={{ justifyContent: "center", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <ImageIcon size={14} />
                <span>Візуал</span>
                {manualLoadingKind === "visual" ? <span className="mono-ui">…</span> : null}
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
                marginBottom: "10px"
              }}
            >
              <label className="mono-ui" style={{ display: "grid", gap: "4px" }}>
                Тип врізки
                <select
                  value={manualCalloutKind}
                  onChange={(event) => onManualCalloutKindChange(event.target.value as EditorialCalloutKind)}
                  disabled={manualInFlight}
                  style={{ height: "32px", borderRadius: "6px", border: "1px solid #d8e0ea", padding: "0 8px", fontSize: "12px" }}
                >
                  {calloutOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mono-ui" style={{ display: "grid", gap: "4px" }}>
                Тип візуалу
                <select
                  value={manualVisualIntent}
                  onChange={(event) => onManualVisualIntentChange(event.target.value as EditorialVisualIntent)}
                  disabled={manualInFlight}
                  style={{ height: "32px", borderRadius: "6px", border: "1px solid #d8e0ea", padding: "0 8px", fontSize: "12px" }}
                >
                  {visualOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="floating-textarea-shell">
              <textarea
                className="floating-textarea"
                rows={2}
                placeholder="Кастомний запит для локальної правки"
                value={customPrompt}
                onChange={(event) => onCustomPromptChange(event.currentTarget.value)}
              />
            </div>
            <div className="floating-footer">
              <div className="floating-shortcuts">
                <button type="button" className="floating-panel-inline-action" onClick={onRequestDefaultPatch} disabled={patchLoading}>
                  <Sparkles size={14} />
                  Покращити
                </button>
              </div>
              <div className="send-row">
                <button
                  type="button"
                  className="send-button mono-ui"
                  onClick={onRequestCustomPatch}
                  disabled={patchLoading || !customPrompt.trim()}
                  aria-label="Запустити кастомну правку"
                  title="Запустити кастомну правку"
                >
                  {patchLoading ? "…" : "→"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
