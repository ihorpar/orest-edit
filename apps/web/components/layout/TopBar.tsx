"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Columns2, Keyboard, Redo2, Sparkles, Undo2 } from "lucide-react";

import type { DocumentTextStats } from "../../lib/editor/document-model";
import { formatLocalizedNumber } from "../../lib/i18n/product-locale";
import { useProductCopy, useProductLocale } from "../providers/ProductLocaleProvider";
import {
  EDITOR_SETTINGS_UPDATED_EVENT,
  findProviderModelPreset,
  getModelPresetPriceLabel,
  getModelPresetSmartnessLabel,
  getProviderModelPresets,
  readEditorSettings,
  writeEditorSettings,
  type EditorSettings,
  type ProviderId
} from "../../lib/editor/settings";

const TOPBAR_MODEL_PROVIDERS: ProviderId[] = ["openai", "gemini"];

export function TopBar({
  activePath = "/editor",
  documentStats,
  historyControls
}: {
  activePath?: "/editor" | "/settings";
  documentStats?: DocumentTextStats;
  historyControls?: {
    canUndo: boolean;
    canRedo: boolean;
    canCompare: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onCompare: () => void;
  };
}) {
  const copy = useProductCopy();
  const { locale } = useProductLocale();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isHotkeysOpen, setIsHotkeysOpen] = useState(false);
  const [editorSettings, setEditorSettings] = useState<EditorSettings | null>(null);
  const hotkeysRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setEditorSettings(readEditorSettings(locale));

    function refreshSettings(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setEditorSettings(detail ?? readEditorSettings(locale));
    }

    window.addEventListener(EDITOR_SETTINGS_UPDATED_EVENT, refreshSettings);
    window.addEventListener("storage", refreshSettings);

    return () => {
      window.removeEventListener(EDITOR_SETTINGS_UPDATED_EVENT, refreshSettings);
      window.removeEventListener("storage", refreshSettings);
    };
  }, [locale]);

  useEffect(() => {
    if (!isHotkeysOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;

      if (target instanceof Node && hotkeysRef.current?.contains(target)) {
        return;
      }

      setIsHotkeysOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsHotkeysOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isHotkeysOpen]);

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin"
      });
    } finally {
      window.location.assign("/login");
    }
  }

  function handleTopbarModelChange(value: string) {
    const [providerValue, modelId] = value.split("::");

    if (!modelId || !TOPBAR_MODEL_PROVIDERS.includes(providerValue as ProviderId)) {
      return;
    }

    const provider = providerValue as ProviderId;
    const currentSettings = editorSettings ?? readEditorSettings(locale);
    const persisted = writeEditorSettings(
      {
        ...currentSettings,
        provider,
        modelId,
        apiKey: ""
      },
      locale
    );

    setEditorSettings(persisted);
    window.dispatchEvent(new CustomEvent(EDITOR_SETTINGS_UPDATED_EVENT, { detail: persisted }));
  }

  const selectedTopbarModelPreset =
    editorSettings && TOPBAR_MODEL_PROVIDERS.includes(editorSettings.provider)
      ? findProviderModelPreset(editorSettings.provider, editorSettings.modelId)
      : null;
  const topbarModelValue = editorSettings && selectedTopbarModelPreset ? `${editorSettings.provider}::${editorSettings.modelId}` : "";
  const hotkeys = copy.topbar.hotkeyItems;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            OrestGPT <span className="brand-version">V1</span>
          </span>
        </div>
        <nav className="nav-links" aria-label={copy.topbar.navigation}>
          {historyControls ? (
            <div className="topbar-history-controls" aria-label={copy.topbar.history}>
              <button
                type="button"
                className="button-reset topbar-history-button"
                onClick={historyControls.onUndo}
                disabled={!historyControls.canUndo}
                title={copy.topbar.undo}
                aria-label={copy.topbar.undo}
              >
                <Undo2 size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="button-reset topbar-history-button"
                onClick={historyControls.onRedo}
                disabled={!historyControls.canRedo}
                title={copy.topbar.redo}
                aria-label={copy.topbar.redo}
              >
                <Redo2 size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="button-reset topbar-history-button"
                onClick={historyControls.onCompare}
                disabled={!historyControls.canCompare}
                title={copy.topbar.compare}
                aria-label={copy.topbar.compare}
              >
                <Columns2 size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <Link href="/editor" className="mono-ui nav-link" data-active={activePath === "/editor"}>
            {copy.topbar.editor}
          </Link>
          <Link href="/settings" className="mono-ui nav-link" data-active={activePath === "/settings"}>
            {copy.topbar.settings}
          </Link>
        </nav>
      </div>

      <div className="topbar-right">
        {activePath === "/editor" ? (
          <label className="topbar-model-picker" title={copy.topbar.model}>
            <Sparkles size={14} aria-hidden="true" />
            <span className="sr-only">{copy.topbar.model}</span>
            <select
              className="topbar-model-select"
              value={topbarModelValue}
              onChange={(event) => handleTopbarModelChange(event.target.value)}
              aria-label={copy.topbar.model}
            >
              {topbarModelValue ? null : <option value="">{copy.topbar.model}</option>}
              <optgroup label="OpenAI">
                {getProviderModelPresets("openai", locale).map((preset) => (
                  <option key={preset.id} value={`openai::${preset.id}`}>
                    {preset.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Google Gemini">
                {getProviderModelPresets("gemini", locale).map((preset) => (
                  <option key={preset.id} value={`gemini::${preset.id}`}>
                    {preset.label}
                  </option>
                ))}
              </optgroup>
            </select>
            {selectedTopbarModelPreset ? <TopbarModelPresetChips preset={selectedTopbarModelPreset} ratingLabel={copy.topbar.modelRating} /> : null}
          </label>
        ) : null}
        {documentStats ? (
          <div
            className="mono-ui topbar-document-stats"
            aria-label={`${formatLocalizedNumber(documentStats.words, locale)} ${copy.topbar.words}, ${formatLocalizedNumber(documentStats.charactersWithSpaces, locale)} ${copy.topbar.charactersShort}`}
            title={copy.topbar.statsTitle}
          >
            <span>{formatLocalizedNumber(documentStats.words, locale)} {copy.topbar.words}</span>
            <span aria-hidden="true">·</span>
            <span>{formatLocalizedNumber(documentStats.charactersWithSpaces, locale)} {copy.topbar.charactersShort}</span>
          </div>
        ) : null}
        <div className="topbar-hotkeys" ref={hotkeysRef}>
          <button
            type="button"
            className="mono-ui nav-link button-reset topbar-hotkeys-button"
            aria-expanded={isHotkeysOpen}
            aria-haspopup="dialog"
            onClick={() => setIsHotkeysOpen((current) => !current)}
          >
            <Keyboard size={14} aria-hidden="true" />
            <span>{copy.topbar.hotkeys}</span>
          </button>
          {isHotkeysOpen ? (
            <div className="topbar-hotkeys-popover" role="dialog" aria-label={copy.topbar.hotkeys}>
              <div className="topbar-hotkeys-popover-head">
                <p className="topbar-hotkeys-title">{copy.topbar.hotkeys}</p>
              </div>
              <div className="topbar-hotkeys-list">
                {hotkeys.map((item) => (
                  <div key={item.shortcut} className="topbar-hotkeys-row">
                    <kbd>{item.shortcut}</kbd>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <button type="button" className="mono-ui nav-link button-reset" onClick={handleLogout} disabled={isLoggingOut}>
          {copy.topbar.logout}
        </button>
      </div>
    </header>
  );
}

function TopbarModelPresetChips({
  preset,
  ratingLabel
}: {
  preset: NonNullable<ReturnType<typeof findProviderModelPreset>>;
  ratingLabel: string;
}) {
  const smartness = getModelPresetSmartnessLabel(preset);
  const price = getModelPresetPriceLabel(preset);

  if (!smartness && !price) {
    return null;
  }

  return (
    <span className="settings-model-chip-row topbar-model-chip-row" aria-label={ratingLabel}>
      {smartness ? <span className="settings-model-chip topbar-model-chip">💡 {smartness}</span> : null}
      {price ? <span className="settings-model-chip topbar-model-chip">{price}</span> : null}
    </span>
  );
}
