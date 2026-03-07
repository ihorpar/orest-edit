"use client";

import { Fragment, type ChangeEvent, type ClipboardEvent, type DragEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  findParagraphForOffset,
  getManuscriptParagraphs,
  type ManuscriptParagraph,
  type ManuscriptRevisionState
} from "../../lib/editor/manuscript-structure";
import {
  applyMarkdownFormat,
  getMarkdownImageBlocks,
  moveMarkdownImageBlock,
  type MarkdownFormatAction,
  type MarkdownImageBlock
} from "../../lib/editor/markdown-editor";
import { hasSelection, type PatchSelection } from "../../lib/editor/patch-contract";
import type { EditorialReviewItem, ReviewActionProposal } from "../../lib/editor/review-contract";
import { EditorialReviewDetail } from "./EditorialReviewDetail";
import { DiffInlineMark } from "./DiffInlineMark";
import { useResolvedEditorAssetUrl } from "./ResolvedEditorImage";
import { Button } from "../ui/Button";

const MIN_EDITOR_HEIGHT = 320;

const markdownToolbarActions: Array<{ action: MarkdownFormatAction; label: string; title: string }> = [
  { action: "bold", label: "B", title: "Жирний" },
  { action: "italic", label: "I", title: "Курсив" },
  { action: "heading-1", label: "H1", title: "Заголовок 1" },
  { action: "heading-2", label: "H2", title: "Заголовок 2" },
  { action: "heading-3", label: "H3", title: "Заголовок 3" },
  { action: "bullet-list", label: "•", title: "Список" },
  { action: "numbered-list", label: "1.", title: "Нумерований список" },
  { action: "blockquote", label: ">", title: "Цитата" },
  { action: "link", label: "[]", title: "Посилання" },
  { action: "code", label: "<>", title: "Код" },
  { action: "table", label: "Tbl", title: "Таблиця" },
  { action: "divider", label: "---", title: "Роздільник" }
];

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
  activeProposal,
  canClearDraft,
  loading,
  activeReviewItem,
  revision,
  reviewImageGenerating,
  reviewImageInserting,
  reviewPreparing,
  onClearDraft,
  onMarkdownFormat,
  onAppliedDiffChange,
  onApplyReviewCallout,
  onApplyReviewText,
  onDiscardAppliedDiffs,
  onDiscardReviewProposal,
  onDismissAppliedDiffs,
  onDismissReviewItem,
  onGenerateReviewImage,
  onInsertLocalImage,
  onInsertReviewImage,
  onPrepareReviewItem,
  selectionRevealKey,
  selection,
  text,
  onSelectionChange,
  onTextChange
}: {
  appliedDiffs: AppliedDiffMarker[];
  activeProposal: ReviewActionProposal | null;
  canClearDraft?: boolean;
  activeReviewItem: EditorialReviewItem | null;
  loading?: boolean;
  revision: ManuscriptRevisionState;
  reviewImageGenerating?: boolean;
  reviewImageInserting?: boolean;
  reviewPreparing?: boolean;
  onClearDraft?: () => void;
  onMarkdownFormat: () => void;
  onAppliedDiffChange: (id: string, newText: string) => void;
  onApplyReviewCallout: () => void;
  onApplyReviewText: () => void;
  onDiscardAppliedDiffs: () => void;
  onDiscardReviewProposal: () => void;
  onDismissAppliedDiffs: () => void;
  onDismissReviewItem: () => void;
  onGenerateReviewImage: () => void;
  onInsertLocalImage: (input: { blob: Blob; fileName?: string; source: "upload" | "paste" }) => Promise<void>;
  onInsertReviewImage: () => void;
  onPrepareReviewItem: () => void;
  selectionRevealKey?: number;
  selection: PatchSelection;
  text: string;
  onSelectionChange: (selection: PatchSelection) => void;
  onTextChange: (text: string, selection: PatchSelection) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [isLocalImageActionInFlight, setIsLocalImageActionInFlight] = useState(false);
  const [draggedImageBlock, setDraggedImageBlock] = useState<MarkdownImageBlock | null>(null);
  const [imageDropTargetIndex, setImageDropTargetIndex] = useState<number | null>(null);
  const hasActiveSelection = hasSelection(selection);
  const hasAppliedDiffs = appliedDiffs.length > 0;
  const isPreviewMode = !hasAppliedDiffs && !hasActiveSelection && !activeReviewItem && !isEditorFocused;
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

  function handleMarkdownAction(action: MarkdownFormatAction) {
    if (hasAppliedDiffs || loading) {
      return;
    }

    const liveSelection =
      textareaRef.current
        ? {
            start: textareaRef.current.selectionStart,
            end: textareaRef.current.selectionEnd
          }
        : selection;

    onMarkdownFormat();
    const result = applyMarkdownFormat(text, liveSelection, action);
    onTextChange(result.text, result.selection);

    requestAnimationFrame(() => {
      const element = textareaRef.current;

      if (!element) {
        return;
      }

      element.focus();
      element.setSelectionRange(result.selection.start, result.selection.end);
    });
  }

  async function handleLocalImageInsert(input: { blob: Blob; fileName?: string; source: "upload" | "paste" }) {
    if (loading || hasAppliedDiffs || isLocalImageActionInFlight) {
      return;
    }

    setIsLocalImageActionInFlight(true);

    try {
      onMarkdownFormat();
      await onInsertLocalImage(input);
    } finally {
      setIsLocalImageActionInFlight(false);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }

  function handleImageFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file || !file.type.startsWith("image/")) {
      event.currentTarget.value = "";
      return;
    }

    void handleLocalImageInsert({
      blob: file,
      fileName: file.name,
      source: "upload"
    });
    event.currentTarget.value = "";
  }

  function handleTextareaPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFile =
      Array.from(event.clipboardData.items)
        .map((item) => (item.type.startsWith("image/") ? item.getAsFile() : null))
        .find((entry): entry is File => Boolean(entry)) ?? null;

    if (!imageFile) {
      return;
    }

    event.preventDefault();
    void handleLocalImageInsert({
      blob: imageFile,
      fileName: imageFile.name,
      source: "paste"
    });
  }

  function handleImageDragStart(event: DragEvent<HTMLElement>, block: MarkdownImageBlock) {
    setDraggedImageBlock(block);
    setImageDropTargetIndex(block.end);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", block.markdown);
  }

  function handleImageDragEnd() {
    setDraggedImageBlock(null);
    setImageDropTargetIndex(null);
  }

  function handleImageDragOver(event: DragEvent<HTMLElement>, targetIndex: number) {
    if (!draggedImageBlock) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setImageDropTargetIndex(targetIndex);
  }

  function handleImageDrop(event: DragEvent<HTMLElement>, targetIndex: number) {
    if (!draggedImageBlock) {
      return;
    }

    event.preventDefault();
    onMarkdownFormat();

    const result = moveMarkdownImageBlock(text, draggedImageBlock, targetIndex);
    const nextSelection = { start: result.selection.end, end: result.selection.end };
    onTextChange(result.text, nextSelection);

    setDraggedImageBlock(null);
    setImageDropTargetIndex(null);

    requestAnimationFrame(() => {
      const element = textareaRef.current;

      if (!element) {
        return;
      }

      element.focus();
      element.setSelectionRange(nextSelection.start, nextSelection.end);
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
        <div className="manuscript-toolbar-copy">
          <p className="mono-ui manuscript-toolbar-kicker">Редактор</p>
        </div>
        <div className="manuscript-toolbar-meta-row">
          <div className="mono-ui manuscript-toolbar-meta">{wordCount} слів</div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClearDraft}
            disabled={!canClearDraft}
            style={{ color: "#b42318", borderColor: "#f1d7d3", background: "#fffaf9" }}
          >
            Скинути чернетку
          </Button>
        </div>
      </div>

      <div className="markdown-toolbar-shell">
        <div className="markdown-toolbar" role="toolbar" aria-label="Панель форматування markdown">
          {markdownToolbarActions.map((item) => (
            <button
              key={item.action}
              type="button"
              className="markdown-toolbar-button"
              data-action={item.action}
              onClick={() => handleMarkdownAction(item.action)}
              disabled={loading || hasAppliedDiffs}
              title={item.title}
              aria-label={item.title}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className="markdown-toolbar-button markdown-toolbar-button-image"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || hasAppliedDiffs || isLocalImageActionInFlight}
            title="Вставити зображення"
            aria-label="Вставити зображення"
          >
            Img
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageFileSelection} />
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
            {renderDecoratedContent(text, revision, selection, appliedDiffs, reviewFooter, undefined, undefined, undefined, onAppliedDiffChange)}
          </div>
        ) : (
          <>
            {isPreviewMode ? (
              <div className="manuscript-render-layer manuscript-editor-copy manuscript-markdown-preview" aria-hidden="true">
                <MarkdownPreview text={text} />
              </div>
            ) : (
              <div className="manuscript-render-layer manuscript-editor-copy" aria-hidden="true">
                {renderDecoratedContent(text, revision, selection, [], undefined, activeReviewItem, {
                  proposal: activeProposal,
                  reviewPreparing,
                  reviewImageGenerating,
                  reviewImageInserting,
                  onClose: onDismissReviewItem,
                  onPrepare: onPrepareReviewItem,
                  onApplyText: onApplyReviewText,
                  onApplyCallout: onApplyReviewCallout,
                  onGenerateImage: onGenerateReviewImage,
                  onInsertImage: onInsertReviewImage,
                  onDiscardProposal: onDiscardReviewProposal
                }, {
                  draggedBlock: draggedImageBlock,
                  dropTargetIndex: imageDropTargetIndex,
                  onDragStart: handleImageDragStart,
                  onDragEnd: handleImageDragEnd,
                  onDragOver: handleImageDragOver,
                  onDrop: handleImageDrop
                })}
              </div>
            )}
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
              onPaste={handleTextareaPaste}
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

function MarkdownPreview({ text }: { text: string }) {
  if (!text.trim()) {
    return <span className="placeholder-line">Вставте або виділіть фрагмент для локальної правки…</span>;
  }

  const blockquoteRenderer = ({ children, ...props }: { children?: ReactNode }) => {
    const parsedCallout = parseCalloutBlock(children);

    if (!parsedCallout) {
      return <blockquote {...props}>{children}</blockquote>;
    }

    return (
      <aside className="manuscript-callout" data-kind={parsedCallout.kind}>
        <p className="mono-ui manuscript-callout-kicker">{getCalloutKindLabel(parsedCallout.kind)}</p>
        <h4 className="manuscript-callout-title">{parsedCallout.title}</h4>
        <p className="manuscript-callout-body">{parsedCallout.body}</p>
      </aside>
    );
  };

  return (
    <div className="manuscript-markdown-flow">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          blockquote: blockquoteRenderer,
          img: ({ src, alt }) => <MarkdownPreviewImage source={typeof src === "string" ? src : null} alt={alt ?? "Зображення"} />
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownPreviewImage({ source, alt }: { source?: string | null; alt: string }) {
  const { resolvedUrl, isLoading } = useResolvedEditorAssetUrl(source ?? null);

  if (isLoading) {
    return <span className="mono-ui manuscript-image-loading">Завантажую зображення…</span>;
  }

  if (!resolvedUrl) {
    return <span className="mono-ui manuscript-image-missing">Зображення недоступне</span>;
  }

  return <img className="manuscript-inline-image" src={resolvedUrl} alt={alt} />;
}

function parseCalloutBlock(children: ReactNode): { kind: string; title: string; body: string } | null {
  const plainText = extractNodeText(children).trim();

  if (!plainText) {
    return null;
  }

  const lines = plainText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const headerMatch = /^\[!CALLOUT:\s*([a-z_]+)\]\s*(.*)$/i.exec(lines[0]);

  if (!headerMatch) {
    return null;
  }

  const kind = headerMatch[1].trim().toLowerCase();
  const title = (headerMatch[2] || "").trim() || "Врізка";
  const body = lines.slice(1).join(" ").trim();

  if (!body) {
    return null;
  }

  return { kind, title, body };
}

function extractNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((entry) => extractNodeText(entry)).join("");
  }

  if (!node || typeof node !== "object") {
    return "";
  }

  const nodeWithProps = node as { props?: { children?: ReactNode } };

  if (nodeWithProps.props && typeof nodeWithProps.props === "object" && "children" in nodeWithProps.props) {
    return extractNodeText(nodeWithProps.props.children ?? null);
  }

  return "";
}

function getCalloutKindLabel(kind: string): string {
  if (kind === "mini_story") {
    return "Мініісторія";
  }

  if (kind === "mechanism_explained") {
    return "Як це працює";
  }

  if (kind === "step_by_step") {
    return "Покроково";
  }

  if (kind === "myth_vs_fact") {
    return "Міф і факт";
  }

  return "Короткий факт";
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
  revision: ManuscriptRevisionState,
  selection: PatchSelection,
  appliedDiffs: AppliedDiffMarker[],
  footerAfterDiff?: ReactNode,
  activeReviewItem?: EditorialReviewItem | null,
  reviewDetailActions?: {
    proposal: ReviewActionProposal | null;
    reviewPreparing?: boolean;
    reviewImageGenerating?: boolean;
    reviewImageInserting?: boolean;
    onClose: () => void;
    onPrepare: () => void;
    onApplyText: () => void;
    onApplyCallout: () => void;
    onGenerateImage: () => void;
    onInsertImage: () => void;
    onDiscardProposal: () => void;
  },
  imageDragActions?: {
    draggedBlock: MarkdownImageBlock | null;
    dropTargetIndex: number | null;
    onDragStart: (event: DragEvent<HTMLElement>, block: MarkdownImageBlock) => void;
    onDragEnd: () => void;
    onDragOver: (event: DragEvent<HTMLElement>, targetIndex: number) => void;
    onDrop: (event: DragEvent<HTMLElement>, targetIndex: number) => void;
  },
  onAppliedDiffChange?: (id: string, newText: string) => void
) {
  const paragraphs = getManuscriptParagraphs(text, revision);
  const imageBlocks = getMarkdownImageBlocks(text);
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
  const firstSelectionParagraph = hasSelection(selection) ? findParagraphForOffset(text, selection.start, revision) : null;
  const imageBlocksByParagraphId = new Map(
    paragraphs
      .map((paragraph) => {
        const block = imageBlocks.find((candidate) => candidate.start === paragraph.start && candidate.end === paragraph.end);
        return block ? [paragraph.id, block] : null;
      })
      .filter((entry): entry is [string, MarkdownImageBlock] => Boolean(entry))
  );

  return paragraphs
    .map((paragraph, index) => {
      const imageBlock = imageBlocksByParagraphId.get(paragraph.id) ?? null;
      const paragraphContent = renderParagraphContent(paragraph, text, decorations, {
        footerAfterDiff,
        firstSelectionParagraph,
        lastDiffId,
        onAppliedDiffChange
      });

      if (!imageBlock && !paragraphContent.content) {
        return null;
      }

      const shouldRenderReviewDetail =
        activeReviewItem &&
        reviewDetailActions &&
        paragraph.id === activeReviewItem.anchor.paragraphIds[activeReviewItem.anchor.paragraphIds.length - 1];
      const isReviewHighlighted = Boolean(activeReviewItem?.anchor.paragraphIds.includes(paragraph.id));
      const shouldShowDropZones = Boolean(imageDragActions?.draggedBlock);

      return (
        <Fragment key={paragraph.id}>
          {shouldShowDropZones ? (
            <ImageDropZone
              targetIndex={paragraph.start}
              active={imageDragActions?.dropTargetIndex === paragraph.start}
              onDragOver={imageDragActions ? (event) => imageDragActions.onDragOver(event, paragraph.start) : undefined}
              onDrop={imageDragActions ? (event) => imageDragActions.onDrop(event, paragraph.start) : undefined}
            />
          ) : null}
          {imageBlock ? (
            <div
              className="manuscript-paragraph"
              data-selection-anchor={firstSelectionParagraph === paragraph.index ? "true" : "false"}
              data-review-highlight={isReviewHighlighted ? "true" : "false"}
              data-image-block="true"
            >
              <span className="mono-ui manuscript-paragraph-number">{paragraph.label}</span>
              <div className="manuscript-image-render-shell">
                <EditorImageBlock
                  block={imageBlock}
                  dragging={imageDragActions?.draggedBlock?.start === imageBlock.start && imageDragActions?.draggedBlock?.end === imageBlock.end}
                  onDragStart={imageDragActions ? (event) => imageDragActions.onDragStart(event, imageBlock) : undefined}
                  onDragEnd={imageDragActions?.onDragEnd}
                />
              </div>
            </div>
          ) : (
            <p
              className="manuscript-paragraph"
              data-selection-anchor={firstSelectionParagraph === paragraph.index ? "true" : "false"}
              data-review-highlight={isReviewHighlighted ? "true" : "false"}
              data-image-block="false"
            >
              <span className="mono-ui manuscript-paragraph-number">{paragraph.label}</span>
              <span className="manuscript-render-text">{paragraphContent.content}</span>
            </p>
          )}
          {paragraphContent.footerAfterParagraph ? <div className="manuscript-review-inline-anchor">{paragraphContent.footerAfterParagraph}</div> : null}
          {shouldRenderReviewDetail ? (
            <div className="manuscript-review-detail-anchor" data-review-detail-anchor="true">
              <EditorialReviewDetail
                item={activeReviewItem}
                revision={revision}
                proposal={reviewDetailActions.proposal}
                preparing={reviewDetailActions.reviewPreparing}
                imageGenerating={reviewDetailActions.reviewImageGenerating}
                imageInserting={reviewDetailActions.reviewImageInserting}
                onClose={reviewDetailActions.onClose}
                onPrepare={reviewDetailActions.onPrepare}
                onApplyText={reviewDetailActions.onApplyText}
                onApplyCallout={reviewDetailActions.onApplyCallout}
                onGenerateImage={reviewDetailActions.onGenerateImage}
                onInsertImage={reviewDetailActions.onInsertImage}
                onDiscardProposal={reviewDetailActions.onDiscardProposal}
              />
            </div>
          ) : null}
          {shouldShowDropZones && index === paragraphs.length - 1 ? (
            <ImageDropZone
              targetIndex={text.length}
              active={imageDragActions?.dropTargetIndex === text.length}
              onDragOver={imageDragActions ? (event) => imageDragActions.onDragOver(event, text.length) : undefined}
              onDrop={imageDragActions ? (event) => imageDragActions.onDrop(event, text.length) : undefined}
            />
          ) : null}
        </Fragment>
      );
    })
    .filter(Boolean);
}

function EditorImageBlock({
  block,
  dragging,
  onDragStart,
  onDragEnd
}: {
  block: MarkdownImageBlock;
  dragging?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
}) {
  const { resolvedUrl, isLoading } = useResolvedEditorAssetUrl(block.source);

  return (
    <figure
      className="manuscript-embedded-image"
      draggable={Boolean(onDragStart)}
      data-dragging={dragging ? "true" : "false"}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="mono-ui manuscript-image-handle">Перетягніть, щоб змінити місце</div>
      {isLoading ? (
        <div className="mono-ui manuscript-image-loading">Завантажую зображення…</div>
      ) : resolvedUrl ? (
        <img src={resolvedUrl} alt={block.alt || "Зображення"} />
      ) : (
        <div className="mono-ui manuscript-image-missing">Зображення недоступне</div>
      )}
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    </figure>
  );
}

function ImageDropZone({
  targetIndex,
  active,
  onDragOver,
  onDrop
}: {
  targetIndex: number;
  active: boolean;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
}) {
  return (
    <div
      className="manuscript-image-dropzone"
      data-active={active ? "true" : "false"}
      data-target-index={targetIndex}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
}

function renderParagraphContent(
  paragraph: ManuscriptParagraph,
  text: string,
  decorations: CanvasDecoration[],
  options: {
    footerAfterDiff?: ReactNode;
    firstSelectionParagraph: number | null;
    lastDiffId?: string;
    onAppliedDiffChange?: (id: string, newText: string) => void;
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
          <DiffInlineMark
            oldText={decoration.oldText}
            newText={decoration.newText}
            variant="canvas"
            editableNewText={typeof decoration.newText === "string"}
            onNewTextChange={
              options.onAppliedDiffChange ? (value) => options.onAppliedDiffChange?.(decoration.id, value) : undefined
            }
          />
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
