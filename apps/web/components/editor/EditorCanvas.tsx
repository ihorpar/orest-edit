"use client";

import { useEffect, useRef } from "react";
import { getSelectedText, hasSelection, type PatchSelection } from "../../lib/editor/patch-contract";
import { Button } from "../ui/Button";

export function EditorCanvas({
  loading,
  onRequestDefault,
  selection,
  text,
  onSelectionChange,
  onTextChange
}: {
  loading?: boolean;
  onRequestDefault: () => void;
  selection: PatchSelection;
  text: string;
  onSelectionChange: (selection: PatchSelection) => void;
  onTextChange: (text: string, selection: PatchSelection) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasActiveSelection = hasSelection(selection);
  const selectedText = getSelectedText(text, selection);
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  useEffect(() => {
    const element = textareaRef.current;

    if (!element) {
      return;
    }

    if (element.selectionStart !== selection.start || element.selectionEnd !== selection.end) {
      element.setSelectionRange(selection.start, selection.end);
    }
  }, [selection.end, selection.start]);

  return (
    <div className="manuscript-page">
      <div className="manuscript-toolbar">
        <p className="mono-ui manuscript-toolbar-kicker">Редактор</p>
        <div className="mono-ui manuscript-toolbar-meta">{wordCount} слів</div>
      </div>

      <textarea
        ref={textareaRef}
        className="manuscript-textarea"
        value={text}
        onChange={(event) => {
          const nextSelection = {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd
          } satisfies PatchSelection;

          onTextChange(event.currentTarget.value, nextSelection);
        }}
        onSelect={(event) => {
          onSelectionChange({
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd
          });
        }}
        spellCheck={false}
        aria-label="Редактор для локального редагування"
      />

      <div className="manuscript-meta-row">
        <div className="mono-ui manuscript-toolbar-meta">{hasActiveSelection ? `Виділено ${selectedText.length} символів` : "Без виділення"}</div>
        {hasActiveSelection ? (
          <Button variant="primary" size="sm" loading={loading} onClick={onRequestDefault}>
            Базова правка
          </Button>
        ) : null}
      </div>
    </div>
  );
}
