"use client";

import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { getSelectedText, hasSelection, type PatchSelection } from "../../lib/editor/patch-contract";
import { DiffInlineMark } from "./DiffInlineMark";

const MIN_EDITOR_HEIGHT = 540;

export interface AppliedDiffMarker {
  id: string;
  start: number;
  end: number;
  oldText: string;
  newText?: string;
  reason: string;
}

export function EditorCanvas({
  appliedDiffs,
  loading,
  onDismissAppliedDiffs,
  selection,
  text,
  onSelectionChange,
  onTextChange
}: {
  appliedDiffs: AppliedDiffMarker[];
  loading?: boolean;
  onDismissAppliedDiffs: () => void;
  selection: PatchSelection;
  text: string;
  onSelectionChange: (selection: PatchSelection) => void;
  onTextChange: (text: string, selection: PatchSelection) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasActiveSelection = hasSelection(selection);
  const hasAppliedDiffs = appliedDiffs.length > 0;
  const selectedText = getSelectedText(text, selection);
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  useLayoutEffect(() => {
    const element = textareaRef.current;

    if (!element) {
      return;
    }

    element.style.height = "0px";
    element.style.height = `${Math.max(element.scrollHeight, MIN_EDITOR_HEIGHT)}px`;
  }, [text]);

  useEffect(() => {
    const element = textareaRef.current;

    if (!element) {
      return;
    }

    if (element.selectionStart !== selection.start || element.selectionEnd !== selection.end) {
      element.setSelectionRange(selection.start, selection.end);
    }
  }, [selection.end, selection.start]);

  useEffect(() => {
    function handleResize() {
      const element = textareaRef.current;

      if (!element) {
        return;
      }

      element.style.height = "0px";
      element.style.height = `${Math.max(element.scrollHeight, MIN_EDITOR_HEIGHT)}px`;
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handleResumeEditing() {
    onDismissAppliedDiffs();

    requestAnimationFrame(() => {
      const element = textareaRef.current;

      if (!element) {
        return;
      }

      element.focus();
      element.setSelectionRange(selection.end, selection.end);
    });
  }

  return (
    <div className="manuscript-page">
      <div className="manuscript-toolbar">
        <p className="mono-ui manuscript-toolbar-kicker">Редактор</p>
        <div className="mono-ui manuscript-toolbar-meta">{wordCount} слів</div>
      </div>

      {hasAppliedDiffs ? (
        <div className="selection-preview-card selection-preview-card-applied">
          <div className="selection-preview-head">
            <span className="mono-ui">Щойно застосовано</span>
            <span className="mono-ui">{appliedDiffs.length} diff</span>
          </div>
          <p className="selection-note selection-note-applied">Показано вбудований diff. Натисніть у рукопис, щоб повернутися до звичайного редагування.</p>
        </div>
      ) : null}

      <div className="manuscript-editor-frame" data-review-mode={hasAppliedDiffs ? "true" : "false"} data-has-selection={hasActiveSelection ? "true" : "false"}>
        <div className="manuscript-render-layer manuscript-editor-copy" aria-hidden="true">
          {renderDecoratedContent(text, selection, appliedDiffs)}
        </div>

        {hasAppliedDiffs ? (
          <button type="button" className="manuscript-review-toggle" onClick={handleResumeEditing}>
            Повернутись до редагування
          </button>
        ) : (
          <textarea
            ref={textareaRef}
            className="manuscript-textarea manuscript-editor-copy"
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
            onFocus={() => {
              if (hasAppliedDiffs) {
                onDismissAppliedDiffs();
              }
            }}
            spellCheck={false}
            disabled={loading}
            aria-label="Редактор для локального редагування"
          />
        )}
      </div>

      <div className="manuscript-meta-row">
        <div className="mono-ui manuscript-toolbar-meta">
          {hasAppliedDiffs ? `Показано ${appliedDiffs.length} застосовані diff` : hasActiveSelection ? `Виділено ${selectedText.length} символів` : "Без виділення"}
        </div>
      </div>
    </div>
  );
}

type CanvasDecoration =
  | {
      kind: "selection";
      start: number;
      end: number;
    }
  | (AppliedDiffMarker & {
      kind: "diff";
    });

function renderDecoratedContent(text: string, selection: PatchSelection, appliedDiffs: AppliedDiffMarker[]) {
  const decorations: CanvasDecoration[] =
    appliedDiffs.length > 0
      ? appliedDiffs
          .slice()
          .sort((left, right) => left.start - right.start || left.end - right.end)
          .map((diff) => ({ ...diff, kind: "diff" as const }))
      : hasSelection(selection)
        ? [{ kind: "selection", start: selection.start, end: selection.end }]
        : [];

  const content: ReactNode[] = [];
  let cursor = 0;

  for (const decoration of decorations) {
    if (cursor < decoration.start) {
      content.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor, decoration.start)}</Fragment>);
    }

    if (decoration.kind === "selection") {
      content.push(
        <mark key={`selection-${decoration.start}-${decoration.end}`} className="manuscript-persistent-selection">
          {text.slice(decoration.start, decoration.end)}
        </mark>
      );
      cursor = decoration.end;
      continue;
    }

    content.push(
      <span key={decoration.id} className="manuscript-applied-diff" title={decoration.reason}>
        <DiffInlineMark oldText={decoration.oldText} newText={decoration.newText} variant="canvas" />
      </span>
    );
    cursor = decoration.end;
  }

  if (cursor < text.length) {
    content.push(<Fragment key={`text-${cursor}-tail`}>{text.slice(cursor)}</Fragment>);
  }

  if (content.length === 0) {
    return <span className="placeholder-line">Вставте або виділіть фрагмент для локальної правки…</span>;
  }

  return content;
}
