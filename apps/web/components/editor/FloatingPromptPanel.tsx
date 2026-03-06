"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/Button";

const defaultPrompt = "Поясни цей фрагмент простішою українською та не розширюй зміст без потреби.";
const shortcuts = [
  { label: "Спростити", prompt: "Спростити терміни для широкого читача." },
  { label: "Скоротити", prompt: "Скоротити фрагмент без втрати змісту." },
  { label: "Прояснити", prompt: "Зробити логіку речення яснішою." }
];

export function FloatingPromptPanel({
  loading,
  onRequestDefault,
  onSubmit,
  selectionKey
}: {
  loading?: boolean;
  onRequestDefault: () => void;
  onSubmit: (prompt: string) => void;
  selectionKey: string;
}) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    setPrompt(defaultPrompt);
    setIsCollapsed(false);
  }, [selectionKey]);

  useEffect(() => {
    if (loading) {
      setIsCollapsed(true);
    }
  }, [loading]);

  const trimmedPrompt = prompt.trim();

  return (
    <div className="floating-panel floating-panel-open" data-collapsed={isCollapsed ? "true" : "false"}>
      <div className="floating-panel-header">
        <span className="mono-ui">Локальна правка</span>
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
        <textarea
          className="floating-textarea"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Наприклад: спростити термін, скоротити або пояснити фрагмент"
          disabled={loading}
        />
        <div className="floating-shortcuts">
          {shortcuts.map((shortcut) => (
            <button key={shortcut.label} type="button" className="mono-ui shortcut-chip" onClick={() => setPrompt(shortcut.prompt)} disabled={loading}>
              {shortcut.label}
            </button>
          ))}
        </div>
        <div className="floating-footer compact-floating-footer">
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => {
              setIsCollapsed(true);
              onRequestDefault();
            }}
          >
            Базова правка
          </Button>
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
            </button>
          </div>
        </div>
        </div>
      ) : (
        <div className="floating-panel-collapsed-bar">
          <button
            type="button"
            className="floating-panel-inline-action"
            disabled={loading}
            onClick={() => {
              setIsCollapsed(true);
              onRequestDefault();
            }}
          >
            Базова правка
          </button>
          <button type="button" className="floating-panel-inline-action" onClick={() => setIsCollapsed(false)}>
            Відкрити промпт
          </button>
        </div>
      )}
    </div>
  );
}
