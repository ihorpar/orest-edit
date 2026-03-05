"use client";

import { useState } from "react";
import { Button } from "../ui/Button";

const defaultPrompt = "Поясни цей фрагмент простішою українською та не розширюй зміст без потреби.";
const shortcuts = [
  {
    label: "Спростити",
    prompt: "Спростити терміни для широкого читача."
  },
  {
    label: "Скоротити",
    prompt: "Скоротити фрагмент без втрати змісту."
  },
  {
    label: "Прояснити",
    prompt: "Зробити логіку речення яснішою."
  }
];

export function RequestComposerCard({
  canRequest,
  loading,
  selectionLabel,
  statusMessage,
  statusTone,
  onRequestCustom,
  onRequestDefault
}: {
  canRequest: boolean;
  loading?: boolean;
  selectionLabel: string;
  statusMessage?: string;
  statusTone?: "info" | "error";
  onRequestCustom: (prompt: string) => void;
  onRequestDefault: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const trimmedPrompt = prompt.trim();

  return (
    <section className="request-composer-card">
      <div className="request-composer-head">
        <div className="request-composer-copy-wrap">
          <p className="mono-ui operations-title">Запит на правку</p>
          <p className="request-composer-copy">
            {canRequest ? selectionLabel : "Виділіть фрагмент у Редакторі, щоб зібрати локальний запит і отримати лише точкові правки."}
          </p>
        </div>
        {canRequest ? <span className="mono-ui request-scope-badge">локально</span> : null}
      </div>

      <div className="request-composer-actions">
        <Button variant="primary" size="sm" loading={loading} disabled={!canRequest} onClick={onRequestDefault}>
          Базова правка
        </Button>
        <Button variant="ghost" size="sm" disabled={!canRequest || loading} onClick={() => setCustomOpen((current) => !current)}>
          {customOpen ? "Сховати свій запит" : "Свій запит"}
        </Button>
      </div>

      {customOpen ? (
        <div className="request-custom-panel">
          <textarea
            className="floating-textarea"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Наприклад: спростити термін, скоротити абзац або пояснити твердження для широкого читача"
            disabled={loading}
          />
          <div className="request-custom-footer">
            <div className="floating-shortcuts">
              {shortcuts.map((shortcut) => (
                <button key={shortcut.label} type="button" className="mono-ui shortcut-chip" onClick={() => setPrompt(shortcut.prompt)} disabled={loading}>
                  {shortcut.label}
                </button>
              ))}
            </div>
            <Button variant="primary" size="sm" loading={loading} disabled={!trimmedPrompt || !canRequest} onClick={() => onRequestCustom(trimmedPrompt)}>
              Надіслати свій
            </Button>
          </div>
        </div>
      ) : null}

      <p className="request-inline-status" data-tone={statusTone ?? "info"}>
        {statusMessage ?? "Почніть з базової правки. Свій запит відкривайте лише тоді, коли базового режиму недостатньо."}
      </p>
    </section>
  );
}
