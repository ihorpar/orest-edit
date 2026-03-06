"use client";

import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { findParagraphForOffset, getManuscriptParagraphs, type ManuscriptParagraph } from "../../lib/editor/manuscript-structure";
import { hasSelection, type PatchSelection } from "../../lib/editor/patch-contract";
import type { EditorialReviewItem } from "../../lib/editor/review-contract";
import { EditorialReviewDetail } from "./EditorialReviewDetail";
import { DiffInlineMark } from "./DiffInlineMark";

const MIN_EDITOR_HEIGHT = 320;

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
  activeReviewItem,
  onDiscardAppliedDiffs,
  onDismissAppliedDiffs,
  onDismissReviewItem,
  selectionRevealKey,
  selection,
  text,
  onSelectionChange,
  onTextChange
}: {
  appliedDiffs: AppliedDiffMarker[];
  activeReviewItem: EditorialReviewItem | null;
  loading?: boolean;
  onDiscardAppliedDiffs: () => void;
  onDismissAppliedDiffs: () => void;
  onDismissReviewItem: () => void;
  selectionRevealKey?: number;
  selection: PatchSelection;
  text: string;
  onSelectionChange: (selection: PatchSelection) => void;
  onTextChange: (text: string, selection: PatchSelection) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const hasActiveSelection = hasSelection(selection);
  const hasAppliedDiffs = appliedDiffs.length > 0;
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

  useEffect(() => {
    if (!selectionRevealKey || hasAppliedDiffs) {
      return;
    }

    const anchor =
      frameRef.current?.querySelector('[data-review-detail-anchor="true"]') ??
      frameRef.current?.querySelector(".manuscript-selection-anchor") ??
      frameRef.current?.querySelector('[data-selection-anchor="true"]');

    if (anchor instanceof HTMLElement) {
      anchor.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
  }, [hasAppliedDiffs, selectionRevealKey, selection.start, selection.end]);

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

  const reviewFooter = (
    <div className="manuscript-review-footer">
      <div className="mono-ui manuscript-review-status">Щойно застосовано • {appliedDiffs.length} diff</div>
      <div className="manuscript-review-actions">
        <button type="button" className="manuscript-review-secondary" onClick={onDiscardAppliedDiffs}>
          Скасувати
        </button>
        <button type="button" className="manuscript-review-toggle" onClick={handleResumeEditing}>
          Готово
        </button>
      </div>
    </div>
  );

  return (
    <div className="manuscript-page">
      <div className="manuscript-toolbar">
        <p className="mono-ui manuscript-toolbar-kicker">Редактор</p>
        <div className="mono-ui manuscript-toolbar-meta">{wordCount} слів</div>
      </div>

      <div
        ref={frameRef}
        className="manuscript-editor-frame"
        data-review-mode={hasAppliedDiffs ? "true" : "false"}
        data-has-selection={hasActiveSelection ? "true" : "false"}
        data-editor-focused={isEditorFocused ? "true" : "false"}
      >
        {hasAppliedDiffs ? (
          <div className="manuscript-review-flow manuscript-editor-copy">
            {renderDecoratedContent(text, selection, appliedDiffs, reviewFooter)}
          </div>
        ) : (
          <>
            <div className="manuscript-render-layer manuscript-editor-copy" aria-hidden="true">
              {renderDecoratedContent(text, selection, [], undefined, activeReviewItem, onDismissReviewItem)}
            </div>
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
                setIsEditorFocused(true);
              }}
              onBlur={() => {
                setIsEditorFocused(false);
              }}
              spellCheck={false}
              disabled={loading}
              aria-label="Редактор для локального редагування"
            />
          </>
        )}
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

function renderDecoratedContent(
  text: string,
  selection: PatchSelection,
  appliedDiffs: AppliedDiffMarker[],
  footerAfterDiff?: ReactNode,
  activeReviewItem?: EditorialReviewItem | null,
  onDismissReviewItem?: () => void
) {
  const paragraphs = getManuscriptParagraphs(text);
  const decorations: CanvasDecoration[] =
    appliedDiffs.length > 0
      ? appliedDiffs
          .slice()
          .sort((left, right) => left.start - right.start || left.end - right.end)
          .map((diff) => ({ ...diff, kind: "diff" as const }))
      : hasSelection(selection)
        ? [{ kind: "selection", start: selection.start, end: selection.end }]
        : [];

  if (paragraphs.length === 0) {
    return <span className="placeholder-line">Вставте або виділіть фрагмент для локальної правки…</span>;
  }

  const lastDiffId = appliedDiffs.at(-1)?.id;
  const firstSelectionParagraph = hasSelection(selection) ? findParagraphForOffset(text, selection.start) : null;

  return paragraphs
    .map((paragraph) => {
      const paragraphContent = renderParagraphContent(paragraph, text, decorations, {
        footerAfterDiff,
        firstSelectionParagraph,
        lastDiffId
      });

      if (!paragraphContent.content) {
        return null;
      }

      const shouldRenderReviewDetail = activeReviewItem && paragraph.index === activeReviewItem.paragraphEnd && onDismissReviewItem;

      return (
        <Fragment key={paragraph.id}>
          <p
            className="manuscript-paragraph"
            data-selection-anchor={firstSelectionParagraph === paragraph.index ? "true" : "false"}
          >
            <span className="mono-ui manuscript-paragraph-number">{paragraph.label}</span>
            <span className="manuscript-render-text">{paragraphContent.content}</span>
          </p>
          {paragraphContent.footerAfterParagraph ? <div className="manuscript-review-inline-anchor">{paragraphContent.footerAfterParagraph}</div> : null}
          {shouldRenderReviewDetail ? (
            <div className="manuscript-review-detail-anchor" data-review-detail-anchor="true">
              <EditorialReviewDetail item={activeReviewItem} onClose={onDismissReviewItem} />
            </div>
          ) : null}
        </Fragment>
      );
    })
    .filter(Boolean);
}

function renderParagraphContent(
  paragraph: ManuscriptParagraph,
  text: string,
  decorations: CanvasDecoration[],
  options: {
    footerAfterDiff?: ReactNode;
    firstSelectionParagraph: number | null;
    lastDiffId?: string;
  }
) {
  const content: ReactNode[] = [];
  let footerAfterParagraph: ReactNode | null = null;
  let cursor = paragraph.start;

  for (const decoration of decorations) {
    if (decoration.end <= paragraph.start || decoration.start >= paragraph.end) {
      continue;
    }

    const overlapStart = Math.max(cursor, decoration.start, paragraph.start);
    const overlapEnd = Math.min(decoration.end, paragraph.end);

    if (cursor < overlapStart) {
      content.push(<Fragment key={`text-${paragraph.id}-${cursor}`}>{text.slice(cursor, overlapStart)}</Fragment>);
    }

    if (decoration.kind === "selection") {
      content.push(
        <mark
          key={`selection-${paragraph.id}-${overlapStart}-${overlapEnd}`}
          className={`manuscript-persistent-selection${options.firstSelectionParagraph === paragraph.index ? " manuscript-selection-anchor" : ""}`}
        >
          {text.slice(overlapStart, overlapEnd)}
        </mark>
      );
      cursor = overlapEnd;
      continue;
    }

    if (decoration.start >= paragraph.start && decoration.start < paragraph.end) {
      content.push(
        <span key={decoration.id} className="manuscript-applied-diff" title={decoration.reason}>
          <DiffInlineMark oldText={decoration.oldText} newText={decoration.newText} variant="canvas" />
        </span>
      );

      if (options.footerAfterDiff && decoration.id === options.lastDiffId) {
        footerAfterParagraph = options.footerAfterDiff;
      }
    }

    cursor = Math.max(cursor, overlapEnd);
  }

  if (cursor < paragraph.end) {
    content.push(<Fragment key={`text-${paragraph.id}-${cursor}-tail`}>{text.slice(cursor, paragraph.end)}</Fragment>);
  }

  return {
    content: content.length > 0 ? content : null,
    footerAfterParagraph
  };
}
