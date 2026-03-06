"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

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

export function FloatingPromptPanel({
  loading,
  onSubmit,
  selectionKey
}: {
  loading?: boolean;
  onSubmit: (prompt: string) => void;
  selectionKey: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setPrompt("");
    setIsCollapsed(false);
  }, [selectionKey]);

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
  }, [prompt, isCollapsed]);

  const trimmedPrompt = prompt.trim();

  return (
    <div className="floating-panel floating-panel-open" data-collapsed={isCollapsed ? "true" : "false"}>
      <div className="floating-panel-header">
        <span className="mono-ui">AI Chat</span>
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
      {!isCollapsed ? (
        <div className="floating-panel-body">
          <div className="floating-compose-row">
            <textarea
              ref={textareaRef}
              className="floating-textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Що зробити ШІ?"
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
                aria-label="Надіслати кастомні правки"
                disabled={loading || !trimmedPrompt}
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
          <div className="floating-shortcuts">
            {shortcuts.map((shortcut) => (
              <button key={shortcut.label} type="button" className="mono-ui shortcut-chip" onClick={() => setPrompt(shortcut.prompt)} disabled={loading}>
                {shortcut.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="floating-panel-collapsed-bar">
          {loading ? (
            <div className="floating-panel-loading" role="status" aria-live="polite">
              <span className="button-spinner floating-panel-loading-spinner" aria-hidden="true" />
              <span className="floating-panel-loading-copy">ШІ готує правки…</span>
            </div>
          ) : (
            <button type="button" className="floating-panel-inline-action" onClick={() => setIsCollapsed(false)}>
              Відкрити промпт
            </button>
          )}
        </div>
      )}
    </div>
  );
}
