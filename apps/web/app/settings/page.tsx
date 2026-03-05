"use client";

import { useEffect, useState } from "react";
import { ThreePaneShell } from "../../components/layout/ThreePaneShell";
import { TopBar } from "../../components/layout/TopBar";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { StatusDot } from "../../components/ui/StatusDot";
import { Textarea } from "../../components/ui/Textarea";
import {
  DEFAULT_EDITOR_SETTINGS,
  getProviderLabel,
  normalizeProvider,
  readEditorSettings,
  validateModelId,
  writeEditorSettings,
  type EditorSettings
} from "../../lib/editor/settings";

export default function SettingsPage() {
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    setSettings(readEditorSettings());
  }, []);

  const modelState = validateModelId(settings.modelId);
  const providerLabel = getProviderLabel(settings.provider);

  return (
    <main className="app-shell">
      <TopBar pendingCount={0} activePath="/settings" />
      <ThreePaneShell
        left={
          <div className="sidebar-stack">
            <section className="sidebar-section">
              <p className="mono-ui chapter-kicker">Конфіг</p>
              <h1 className="chapter-name">Налаштування редактора</h1>
            </section>

            <section className="sidebar-section">
              <p className="mono-ui sidebar-title">Активна модель</p>
              <div className="status-row">
                <span className="status-ring" aria-hidden="true" />
                <span className="status-copy">{providerLabel}</span>
              </div>
              <p className="pending-copy">{settings.modelId.trim() || "Модель буде підставлена автоматично після збереження."}</p>
            </section>

            <section className="sidebar-section">
              <p className="mono-ui sidebar-title">Що мінімум налаштовуємо</p>
              <div className="source-list">
                <div className="source-row source-row-plain">
                  <span>Провайдер та модель</span>
                </div>
                <div className="source-row source-row-plain">
                  <span>API-ключ у формі або в `.env`</span>
                </div>
                <div className="source-row source-row-plain">
                  <span>Базовий редакторський промпт</span>
                </div>
              </div>
            </section>
          </div>
        }
        center={
          <div className="settings-stage">
            <section className="settings-sheet">
              <div className="settings-sheet-header">
                <p className="mono-ui sidebar-title">Робоча конфігурація</p>
                <h2 className="settings-title">Лише те, що впливає на роботу редактора</h2>
              </div>

              <div className="settings-form-grid">
                <label className="settings-field" htmlFor="provider">
                  <span className="mono-ui settings-label">Провайдер</span>
                  <Select
                    id="provider"
                    value={settings.provider}
                    onChange={(event) => {
                      const provider = normalizeProvider(event.target.value);
                      setSettings((current) => ({ ...current, provider }));
                      setSaveMessage(null);
                    }}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="anthropic">Anthropic</option>
                  </Select>
                </label>

                <label className="settings-field" htmlFor="model">
                  <span className="mono-ui settings-label">Модель</span>
                  <div className="settings-input-row">
                    <Input
                      id="model"
                      error={modelState === "invalid"}
                      value={settings.modelId}
                      onChange={(event) => {
                        setSettings((current) => ({ ...current, modelId: event.target.value }));
                        setSaveMessage(null);
                      }}
                    />
                    <StatusDot state={modelState} />
                  </div>
                  <p className="pending-copy">
                    {modelState === "missing"
                      ? "Якщо поле порожнє, під час збереження буде підставлено типовий model id для вибраного провайдера."
                      : modelState === "invalid"
                        ? "Model id містить недопустимі символи."
                        : "Model id виглядає валідним за форматом."}
                  </p>
                </label>

                <label className="settings-field" htmlFor="api-key">
                  <span className="mono-ui settings-label">API-ключ</span>
                  <Input
                    id="api-key"
                    type="password"
                    value={settings.apiKey}
                    onChange={(event) => {
                      setSettings((current) => ({ ...current, apiKey: event.target.value }));
                      setSaveMessage(null);
                    }}
                    placeholder="Залиште порожнім, щоб сервер узяв ключ із .env"
                  />
                  <p className="pending-copy">Порожнє поле тепер означає: використовуй `OPENAI_API_KEY` із кореневого `.env` на сервері.</p>
                </label>

                <label className="settings-field" htmlFor="base-prompt">
                  <span className="mono-ui settings-label">Базовий редакторський промпт</span>
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
                </label>
              </div>

              <div className="settings-actions">
                <Button
                  variant="primary"
                  style={{ width: "fit-content" }}
                  onClick={() => {
                    const persisted = writeEditorSettings(settings);
                    setSettings(persisted);
                    setSaveMessage("Налаштування збережено локально в браузері.");
                  }}
                >
                  Зберегти налаштування
                </Button>
                {saveMessage ? <p className="save-note">{saveMessage}</p> : null}
              </div>
            </section>
          </div>
        }
        right={
          <div>
            <p className="mono-ui operations-title">Орієнтир</p>
            <div className="operations-stack">
              <section className="editor-note-card">
                <p className="editor-note-title">Вертикальний зріз</p>
                <p className="editor-note-copy">Редактор читає ці значення в `/editor` і відправляє їх разом із виділеним фрагментом у patch API.</p>
              </section>
              <section className="editor-note-card">
                <p className="editor-note-title">Поточний шлях для ключа</p>
                <p className="editor-note-copy">Для локальної розробки достатньо залишити поле API-ключа порожнім, якщо `OPENAI_API_KEY` уже записано в кореневому `.env`.</p>
              </section>
            </div>
          </div>
        }
      />
    </main>
  );
}
