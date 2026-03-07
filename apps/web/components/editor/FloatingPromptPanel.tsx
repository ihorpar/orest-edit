"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WholeTextChangeLevel } from "../../lib/editor/review-contract";

const shortcuts = [
  {
    label: "Пояснити терміни",
    prompt: "Пояснити спеціальні терміни простою українською, але не спростити зміст до неточності."
  },
  {
    label: "Ущільнити абзац",
    prompt: "Скоротити й ущільнити фрагмент без втрати логіки, фактів і причинно-наслідкових зв'язків."
  },
  {
    label: "Вирівняти тон",
    prompt: "Зробити тон спокійнішим і редакторськи чистішим: менше пафосу, більше ясності та доказовості."
  }
];

const reviewLevels: Array<{ level: WholeTextChangeLevel; label: string; description: string }> = [
  { level: 1, label: "Легкий марафет", description: "Лише локальна полировка: зберігаємо структуру, тон і хід думки майже без змін." },
  { level: 2, label: "Трохи підчистити", description: "Можна прибрати шум, уточнити логіку й порадити кілька локальних покращень без великої перебудови." },
  { level: 3, label: "Добряче пройтись", description: "Сміливо спрощуємо, дробимо важкі місця й радимо списки, врізки або локальні візуалізації." },
  { level: 4, label: "Розібрати на гвинтики", description: "Дозволено глибоко перекомпонувати проблемні шматки, виносити підрозділи й активно міняти подачу." },
  { level: 5, label: "Згорів сарай — гори хата", description: "Можна радикально перебудовувати фрагменти, якщо це реально робить текст зрозумілішим і живішим." }
];

export function FloatingPromptPanel({
  mode,
  loading,
  onSubmit,
  onExitReviewMode,
  selectionKey,
  reviewChangeLevel = 3,
  reviewAdditionalInstructions = "",
  onReviewChangeLevel,
  onReviewAdditionalInstructionsChange
}: {
  mode: "selection" | "review";
  loading?: boolean;
  onSubmit: (prompt: string) => void;
  onExitReviewMode?: () => void;
  selectionKey: string;
  reviewChangeLevel?: WholeTextChangeLevel;
  reviewAdditionalInstructions?: string;
  onReviewChangeLevel?: (value: WholeTextChangeLevel) => void;
  onReviewAdditionalInstructionsChange?: (value: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode === "selection") {
      setPrompt("");
    }
    setIsCollapsed(false);
  }, [mode, selectionKey]);

  useEffect(() => {
    if (loading) {
      setIsCollapsed(true);
    }
  }, [loading]);

  useLayoutEffect(() => {
    const element = textareaRef.current;

    if (!element) {
      return;
    }

    element.style.height = "0px";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 24), 168)}px`;
  }, [mode, prompt, reviewAdditionalInstructions, isCollapsed]);

  const trimmedPrompt = (mode === "review" ? reviewAdditionalInstructions : prompt).trim();
  const selectedReviewLevel = reviewLevels.find((entry) => entry.level === reviewChangeLevel) ?? reviewLevels[2];

  return (
    <div className="floating-panel floating-panel-open" data-collapsed={isCollapsed ? "true" : "false"}>
      <div className="floating-panel-header">
        <div className="floating-panel-title-stack">
          <span className="mono-ui">AI Chat</span>
          {mode === "review" ? <strong className="floating-panel-question">Наскільки сильно змінюємо?</strong> : null}
        </div>
        <div className="floating-panel-header-actions">
          {mode === "review" ? (
            <button
              type="button"
              className="floating-panel-mode-switch"
              onClick={onExitReviewMode}
              disabled={loading}
              aria-label="Повернутися до звичайного чату"
            >
              Звичайний чат
            </button>
          ) : null}
          <button
            type="button"
            className="panel-toggle"
            onClick={() => setIsCollapsed((current) => !current)}
            aria-label={isCollapsed ? "Розгорнути локальну правку" : "Згорнути локальну правку"}
            aria-expanded={isCollapsed ? "false" : "true"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d={isCollapsed ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      {!isCollapsed ? (
        <div className="floating-panel-body">
          {mode === "review" ? (
            <div className="floating-review-body">
              <div className="floating-review-scale">
                {reviewLevels.map((entry) => (
                  <button
                    key={entry.level}
                    type="button"
                    className="floating-review-scale-button"
                    data-active={entry.level === reviewChangeLevel ? "true" : "false"}
                    onClick={() => onReviewChangeLevel?.(entry.level)}
                    disabled={loading}
                  >
                    {entry.level}. {entry.label}
                  </button>
                ))}
              </div>
              <p className="floating-review-description">{selectedReviewLevel.description}</p>
            </div>
          ) : null}
          <div className="floating-compose-row">
            <textarea
              ref={textareaRef}
              className="floating-textarea"
              value={mode === "review" ? reviewAdditionalInstructions : prompt}
              onChange={(event) => {
                if (mode === "review") {
                  onReviewAdditionalInstructionsChange?.(event.target.value);
                } else {
                  setPrompt(event.target.value);
                }
              }}
              placeholder={mode === "review" ? "Додаткові інструкції" : "Що зробити ШІ?"}
              disabled={loading}
              rows={1}
            />
            <div className="send-row">
              <button
                type="button"
                className="send-button"
                onClick={() => {
                  setIsCollapsed(true);
                  onSubmit(trimmedPrompt);
                }}
                aria-label={mode === "review" ? "Запустити review усього тексту" : "Надіслати кастомні правки"}
                disabled={loading || (mode === "selection" && !trimmedPrompt)}
              >
                {loading ? (
                  <span className="button-spinner send-spinner" aria-hidden="true" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M5 12h14M12 5l7 7-7 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
          {mode === "selection" ? (
            <div className="floating-shortcuts">
              {shortcuts.map((shortcut) => (
                <button key={shortcut.label} type="button" className="mono-ui shortcut-chip" onClick={() => setPrompt(shortcut.prompt)} disabled={loading}>
                  {shortcut.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="floating-panel-collapsed-bar">
          {loading ? (
            <div className="floating-panel-loading" role="status" aria-live="polite">
              <span className="floating-loading-orb" aria-hidden="true">
                <span className="floating-loading-orb-core" />
              </span>
              <span className="floating-panel-loading-text">
                <span className="floating-panel-loading-copy">{mode === "review" ? "ШІ готує review…" : "ШІ готує правки…"}</span>
                <span className="mono-ui floating-panel-loading-subcopy">
                  {mode === "review" ? "аналізую структуру, тон і логіку" : "аналізую фрагмент і готую версію"}
                </span>
              </span>
              <span className="floating-loading-equalizer" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : (
            <button type="button" className="floating-panel-inline-action" onClick={() => setIsCollapsed(false)}>
              {mode === "review" ? "Відкрити review" : "Відкрити промпт"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
