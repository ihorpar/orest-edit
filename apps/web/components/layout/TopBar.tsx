"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Columns2, Keyboard, Redo2, Undo2 } from "lucide-react";

import type { DocumentTextStats } from "../../lib/editor/document-model";

const HOTKEY_SECTIONS = [
  { shortcut: "Ctrl/Cmd+B", label: "Жирний" },
  { shortcut: "Ctrl/Cmd+I", label: "Курсив" },
  { shortcut: "Shift+Enter", label: "Новий рядок в абзаці" },
  { shortcut: "Ctrl/Cmd+Shift+8", label: "Маркований список" },
  { shortcut: "Ctrl/Cmd+H", label: "Глобальна заміна" },
  { shortcut: "Ctrl/Cmd+Z", label: "Скасувати" },
  { shortcut: "Ctrl/Cmd+Shift+Z", label: "Повторити" },
  { shortcut: "Ctrl+Y", label: "Повторити у Windows" }
];

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
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isHotkeysOpen, setIsHotkeysOpen] = useState(false);
  const hotkeysRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            OrestGPT <span className="brand-version">V1</span>
          </span>
        </div>
        <nav className="nav-links" aria-label="Основна навігація">
          {historyControls ? (
            <div className="topbar-history-controls" aria-label="Історія змін">
              <button
                type="button"
                className="button-reset topbar-history-button"
                onClick={historyControls.onUndo}
                disabled={!historyControls.canUndo}
                title="Назад (Ctrl/Cmd+Z)"
                aria-label="Назад"
              >
                <Undo2 size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="button-reset topbar-history-button"
                onClick={historyControls.onRedo}
                disabled={!historyControls.canRedo}
                title="Вперед (Ctrl/Cmd+Shift+Z)"
                aria-label="Вперед"
              >
                <Redo2 size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="button-reset topbar-history-button"
                onClick={historyControls.onCompare}
                disabled={!historyControls.canCompare}
                title="Порівняти прийняту правку"
                aria-label="Порівняти"
              >
                <Columns2 size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <Link href="/editor" className="mono-ui nav-link" data-active={activePath === "/editor"}>
            Редактор
          </Link>
          <Link href="/settings" className="mono-ui nav-link" data-active={activePath === "/settings"}>
            Налаштування
          </Link>
        </nav>
      </div>

      <div className="topbar-right">
        {documentStats ? (
          <div
            className="mono-ui topbar-document-stats"
            aria-label={`У документі ${formatTopbarCount(documentStats.words)} слів і ${formatTopbarCount(documentStats.charactersWithSpaces)} символів з пробілами`}
            title="Слова і символи з пробілами"
          >
            <span>{formatTopbarCount(documentStats.words)} слів</span>
            <span aria-hidden="true">·</span>
            <span>{formatTopbarCount(documentStats.charactersWithSpaces)} симв.</span>
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
            <span>Гарячі клавіші</span>
          </button>
          {isHotkeysOpen ? (
            <div className="topbar-hotkeys-popover" role="dialog" aria-label="Гарячі клавіші">
              <div className="topbar-hotkeys-popover-head">
                <p className="topbar-hotkeys-title">Гарячі клавіші</p>
              </div>
              <div className="topbar-hotkeys-list">
                {HOTKEY_SECTIONS.map((item) => (
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
          Вийти
        </button>
      </div>
    </header>
  );
}

function formatTopbarCount(value: number): string {
  return new Intl.NumberFormat("uk-UA").format(value);
}
