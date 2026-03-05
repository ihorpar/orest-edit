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

  useEffect(() => {
    setPrompt(defaultPrompt);
  }, [selectionKey]);

  const trimmedPrompt = prompt.trim();

  return (
    <div className="floating-panel floating-panel-open">
      <div className="floating-panel-header">
        <span className="mono-ui">Кастомні правки</span>
      </div>
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
          <Button variant="secondary" size="sm" disabled={loading} onClick={onRequestDefault}>
            Базова правка
          </Button>
          <div className="send-row">
            <button
              type="button"
              className="send-button"
              onClick={() => onSubmit(trimmedPrompt)}
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
    </div>
  );
}
