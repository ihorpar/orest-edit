"use client";
import type { WholeTextChangeLevel } from "../../lib/editor/review-contract";

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
  loading,
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
  loading?: boolean;
  onClose: () => void;
}) {
  const isReview = mode === "review";

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
                <button type="button" className="send-button mono-ui" onClick={onRequestReview} disabled={loading} aria-label="Запустити огляд" title="Запустити огляд">
                  {loading ? "…" : "→"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
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
                <button type="button" className="floating-panel-inline-action" onClick={onRequestDefaultPatch} disabled={loading}>
                  Покращити
                </button>
              </div>
              <div className="send-row">
                <button
                  type="button"
                  className="send-button mono-ui"
                  onClick={onRequestCustomPatch}
                  disabled={loading || !customPrompt.trim()}
                  aria-label="Запустити кастомну правку"
                  title="Запустити кастомну правку"
                >
                  {loading ? "…" : "→"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
