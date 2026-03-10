"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { AppliedDiffReviewPanel } from "./cm6/applied-diff-review-panel";
import { ImagePreviewLane } from "./cm6/image-preview-lane";
import { RecommendationLane } from "./cm6/recommendation-lane";
import { Button } from "../ui/Button";
import {
  applyMarkdownFormat,
  getMarkdownImageBlocks,
  type MarkdownFormatAction
} from "../../lib/editor/markdown-editor";
import {
  buildEditorDecorations,
  moveImageBlockWithinDocument
} from "../../lib/editor/cm6/decorations";
import { createBaseEditorExtensions, createEditableExtension, createEditorCompartments, createExternalAnnotation } from "../../lib/editor/cm6/extensions";
import { createParagraphGutter } from "../../lib/editor/cm6/gutters";
import type { AppliedDiffMarker } from "../../lib/editor/applied-diff";
import { hasSelection, type PatchSelection } from "../../lib/editor/patch-contract";
import type { ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import type { EditorialCalloutKind, EditorialReviewItem, ReviewActionProposal } from "../../lib/editor/review-contract";

const markdownToolbarGroups: Array<{
  id: string;
  ariaLabel: string;
  items: Array<{ action: MarkdownFormatAction | "image"; label: string; title: string }>;
}> = [
  {
    id: "inline",
    ariaLabel: "Виділення тексту",
    items: [
      { action: "bold", label: "B", title: "Жирний" },
      { action: "italic", label: "К", title: "Курсив" }
    ]
  },
  {
    id: "headings",
    ariaLabel: "Заголовки",
    items: [
      { action: "heading-1", label: "H1", title: "Заголовок 1" },
      { action: "heading-2", label: "H2", title: "Заголовок 2" },
      { action: "heading-3", label: "H3", title: "Заголовок 3" }
    ]
  },
  {
    id: "blocks",
    ariaLabel: "Блоки та список",
    items: [
      { action: "bullet-list", label: "list", title: "Маркований список" },
      { action: "numbered-list", label: "ordered", title: "Нумерований список" },
      { action: "blockquote", label: "quote", title: "Цитата" },
      { action: "link", label: "link", title: "Посилання" }
    ]
  },
  {
    id: "insert",
    ariaLabel: "Вставки",
    items: [
      { action: "code", label: "<>", title: "Код" },
      { action: "table", label: "table", title: "Таблиця" },
      { action: "divider", label: "divider", title: "Роздільник" },
      { action: "image", label: "[img]", title: "Вставити зображення" }
    ]
  }
];

function renderMarkdownToolbarGlyph(action: MarkdownFormatAction | "image", label: string) {
  if (action === "bullet-list") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="4" cy="4" r="1" fill="currentColor" stroke="none" />
        <circle cx="4" cy="8" r="1" fill="currentColor" stroke="none" />
        <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
        <path d="M7 4h5M7 8h5M7 12h5" />
      </svg>
    );
  }

  if (action === "numbered-list") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <text x="2.2" y="4.9">1.</text>
        <text x="2.2" y="8.9">2.</text>
        <text x="2.2" y="12.9">3.</text>
        <path d="M7.4 4h5M7.4 8h5M7.4 12h5" />
      </svg>
    );
  }

  if (action === "blockquote") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6.1 4.6H4.7a1.8 1.8 0 0 0-1.8 1.8v1.4h2.5l-.5 3h-2V7.4c0-1.7.9-2.8 3.2-2.8Z" />
        <path d="M12.8 4.6h-1.4a1.8 1.8 0 0 0-1.8 1.8v1.4h2.5l-.5 3h-2V7.4c0-1.7.9-2.8 3.2-2.8Z" />
      </svg>
    );
  }

  if (action === "link") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6.4 9.6 5 11a2.4 2.4 0 1 1-3.4-3.4L3 6.2a2.4 2.4 0 0 1 3.4 0" />
        <path d="M9.6 6.4 11 5a2.4 2.4 0 1 1 3.4 3.4L13 9.8a2.4 2.4 0 0 1-3.4 0" />
        <path d="M5.8 8h4.4" />
      </svg>
    );
  }

  if (action === "table") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="3" width="11" height="10" rx="1.2" />
        <path d="M2.8 6.3h10.4M2.8 9.7h10.4M7.9 3.3v9.4" />
      </svg>
    );
  }

  if (action === "divider") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 8h10" />
      </svg>
    );
  }

  return label;
}

function selectionFromView(view: EditorView): PatchSelection {
  return {
    start: view.state.selection.main.from,
    end: view.state.selection.main.to
  };
}

export function CodeMirrorCanvas({
  appliedDiffs,
  activeProposal,
  activeReviewItem,
  canClearDraft,
  loading,
  revision,
  reviewItems,
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
  onCalloutKindChange,
  selectedCalloutKind,
  selectionRevealKey,
  selection,
  text,
  onSelectionChange,
  onTextChange
}: {
  appliedDiffs?: AppliedDiffMarker[];
  activeProposal: ReviewActionProposal | null;
  activeReviewItem: EditorialReviewItem | null;
  canClearDraft?: boolean;
  loading?: boolean;
  revision: ManuscriptRevisionState;
  reviewItems: EditorialReviewItem[];
  reviewImageGenerating?: boolean;
  reviewImageInserting?: boolean;
  reviewPreparing?: boolean;
  onClearDraft?: () => void;
  onMarkdownFormat: () => void;
  onAppliedDiffChange?: (id: string, newText: string) => void;
  onApplyReviewCallout: () => void;
  onApplyReviewText: () => void;
  onDiscardAppliedDiffs?: () => void;
  onDiscardReviewProposal: () => void;
  onDismissAppliedDiffs?: () => void;
  onDismissReviewItem: () => void;
  onGenerateReviewImage: () => void;
  onInsertLocalImage: (input: { blob: Blob; fileName?: string; source: "upload" | "paste" }) => Promise<void>;
  onInsertReviewImage: () => void;
  onPrepareReviewItem: () => void;
  onCalloutKindChange: (kind: EditorialCalloutKind) => void;
  selectionRevealKey?: number;
  selectedCalloutKind?: EditorialCalloutKind;
  selection: PatchSelection;
  text: string;
  onSelectionChange: (selection: PatchSelection) => void;
  onTextChange: (text: string, selection: PatchSelection) => void;
}) {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const hasAppliedDiffs = (appliedDiffs?.length ?? 0) > 0;
  const wordCount = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);
  const imageBlocks = useMemo(() => getMarkdownImageBlocks(text), [text]);
  const activeImageBlock = useMemo(
    () =>
      imageBlocks.find((block) =>
        hasSelection(selection)
          ? selection.start < block.end && selection.end > block.start
          : selection.start >= block.start && selection.start <= block.end
      ) ?? null,
    [imageBlocks, selection]
  );
  const activeImageIndex = activeImageBlock ? imageBlocks.findIndex((block) => block.markdown === activeImageBlock.markdown) : -1;
  const hasSidePanel = activeReviewItem !== null || activeImageBlock !== null;
  const compartmentsRef = useRef(createEditorCompartments());
  const externalAnnotationRef = useRef(createExternalAnnotation<boolean>());
  const latestHandlersRef = useRef({
    onSelectionChange,
    onTextChange,
    onInsertLocalImage
  });

  latestHandlersRef.current = {
    onSelectionChange,
    onTextChange,
    onInsertLocalImage
  };

  useEffect(() => {
    if (!editorHostRef.current || editorViewRef.current) {
      return;
    }

    const baseExtensions = createBaseEditorExtensions({
      onUpdate: EditorView.updateListener.of((update) => {
        const isExternal = update.transactions.some((transaction) => transaction.annotation(externalAnnotationRef.current));

        if (!isExternal) {
          if (update.docChanged) {
            latestHandlersRef.current.onTextChange(update.state.doc.toString(), selectionFromView(update.view));
          } else if (update.selectionSet) {
            latestHandlersRef.current.onSelectionChange(selectionFromView(update.view));
          }
        }

        if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
          setLayoutVersion((current) => current + 1);
        }
      }),
      onPasteImage: EditorView.domEventHandlers({
        paste(event) {
          const imageFile =
            Array.from(event.clipboardData?.items ?? [])
              .map((item) => (item.type.startsWith("image/") ? item.getAsFile() : null))
              .find((entry): entry is File => Boolean(entry)) ?? null;

          if (!imageFile) {
            return false;
          }

          event.preventDefault();
          void latestHandlersRef.current.onInsertLocalImage({
            blob: imageFile,
            fileName: imageFile.name,
            source: "paste"
          });
          return true;
        }
      }),
      onFocusChange: EditorView.domEventHandlers({
        focus() {
          setIsEditorFocused(true);
          return false;
        },
        blur() {
          setIsEditorFocused(false);
          return false;
        }
      })
    });

    const initialSelection = EditorSelection.single(selection.start, selection.end);
    const initialState = EditorState.create({
      doc: text,
      selection: initialSelection,
      extensions: [
        ...baseExtensions,
        compartmentsRef.current.chrome.of([]),
        compartmentsRef.current.editable.of(createEditableExtension(!loading && !hasAppliedDiffs))
      ]
    });

    editorViewRef.current = new EditorView({
      state: initialState,
      parent: editorHostRef.current
    });

    return () => {
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = editorViewRef.current;

    if (!view) {
      return;
    }

    const currentDoc = view.state.doc.toString();
    const currentSelection = selectionFromView(view);
    let changes:
      | {
          from: number;
          to: number;
          insert: string;
        }
      | undefined;
    let nextSelection = currentSelection;

    if (currentDoc !== text) {
      changes = {
        from: 0,
        to: currentDoc.length,
        insert: text
      };
      nextSelection = selection;
    } else if (currentSelection.start !== selection.start || currentSelection.end !== selection.end) {
      nextSelection = selection;
    }

    if (!changes && nextSelection.start === currentSelection.start && nextSelection.end === currentSelection.end) {
      return;
    }

    view.dispatch({
      changes,
      selection: EditorSelection.single(nextSelection.start, nextSelection.end),
      annotations: externalAnnotationRef.current.of(true)
    });
  }, [selection, text]);

  useEffect(() => {
    const view = editorViewRef.current;

    if (!view) {
      return;
    }

    const effects = [
      compartmentsRef.current.chrome.reconfigure([
        createParagraphGutter({
          text,
          revision,
          reviewItems,
          activeReviewItem
        }),
        EditorView.decorations.of(
          buildEditorDecorations({
            appliedDiffs,
            text,
            revision,
            selection,
            reviewItems,
            activeReviewItem,
            showPersistentSelection: !isEditorFocused || activeReviewItem !== null,
            state: view.state,
            onMoveImageBlock: (blockMarkdown, direction) => {
              const result = moveImageBlockWithinDocument({
                text,
                revision,
                blockMarkdown,
                direction
              });

              if (!result) {
                return;
              }

              onTextChange(result.text, result.selection);
            }
          })
        )
      ]),
      compartmentsRef.current.editable.reconfigure(createEditableExtension(!loading && !hasAppliedDiffs))
    ];

    view.dispatch({
      effects,
      annotations: externalAnnotationRef.current.of(true)
    });
  }, [activeReviewItem, appliedDiffs, hasAppliedDiffs, isEditorFocused, loading, onTextChange, reviewItems, revision, selection, text]);

  useEffect(() => {
    const view = editorViewRef.current;

    if (!view || !selectionRevealKey) {
      return;
    }

    const from = activeReviewItem
      ? Math.min(...activeReviewItem.anchor.paragraphIds.map((id) => revision.paragraphsById[id]?.start ?? selection.start))
      : selection.start;

    view.dispatch({
      effects: EditorView.scrollIntoView(from, { y: "center" }),
      annotations: externalAnnotationRef.current.of(true)
    });
    setLayoutVersion((current) => current + 1);
  }, [activeReviewItem, revision, selection.start, selectionRevealKey]);

  function handleMarkdownAction(action: MarkdownFormatAction) {
    const view = editorViewRef.current;

    if (!view || loading || hasAppliedDiffs) {
      return;
    }

    const liveSelection = selectionFromView(view);
    onMarkdownFormat();
    const result = applyMarkdownFormat(text, liveSelection, action);
    onTextChange(result.text, result.selection);

    requestAnimationFrame(() => {
      const liveView = editorViewRef.current;

      if (!liveView) {
        return;
      }

      liveView.focus();
    });
  }

  async function handleLocalImageInsert(input: { blob: Blob; fileName?: string; source: "upload" | "paste" }) {
    if (loading || hasAppliedDiffs) {
      return;
    }

    onMarkdownFormat();
    await onInsertLocalImage(input);
    requestAnimationFrame(() => {
      editorViewRef.current?.focus();
    });
  }

  function handleMoveActiveImage(direction: "up" | "down") {
    if (!activeImageBlock) {
      return;
    }

    const result = moveImageBlockWithinDocument({
      text,
      revision,
      blockMarkdown: activeImageBlock.markdown,
      direction
    });

    if (!result) {
      return;
    }

    onTextChange(result.text, result.selection);
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

  return (
    <div className="manuscript-page" data-has-side-panel={hasSidePanel ? "true" : "false"}>
      <div className="editor-toolbar-surface">
        <div className="manuscript-toolbar">
          <div className="manuscript-toolbar-copy">
            <p className="mono-ui manuscript-toolbar-kicker">Редактор</p>
          </div>
          <div className="manuscript-toolbar-meta-row">
            <div className="mono-ui manuscript-toolbar-meta">{wordCount} слів</div>
            <Button variant="secondary" size="sm" onClick={onClearDraft} disabled={!canClearDraft}>
              Скинути текст
            </Button>
          </div>
        </div>

        <div className="markdown-toolbar-shell">
          <div className="markdown-toolbar" role="toolbar" aria-label="Панель форматування markdown">
            {markdownToolbarGroups.map((group) => (
              <div key={group.id} className="markdown-toolbar-group" role="group" aria-label={group.ariaLabel}>
                {group.items.map((item) => {
                  const isImageButton = item.action === "image";
                  const handleToolbarAction = () => {
                    if (item.action === "image") {
                      fileInputRef.current?.click();
                      return;
                    }

                    handleMarkdownAction(item.action);
                  };

                  return (
                    <button
                      key={item.action}
                      type="button"
                      className={`markdown-toolbar-button${isImageButton ? " markdown-toolbar-button-image" : ""}`}
                      data-action={item.action}
                      onClick={handleToolbarAction}
                      disabled={loading || hasAppliedDiffs}
                      title={item.title}
                      aria-label={item.title}
                    >
                      {renderMarkdownToolbarGlyph(item.action, item.label)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageFileSelection} />
        </div>
      </div>

      <div className="cm-orest-editor-shell" data-has-side-panel={hasSidePanel ? "true" : "false"}>
        <div className="cm-orest-editor-column">
          <div className="cm-orest-editor-frame">
            <div ref={editorHostRef} className="cm-orest-editor-host" />
          </div>
        </div>

        {activeReviewItem ? (
          <RecommendationLane
            editorView={editorViewRef.current}
            item={activeReviewItem}
            revision={revision}
            proposal={activeProposal}
            preparing={reviewPreparing}
            imageGenerating={reviewImageGenerating}
            imageInserting={reviewImageInserting}
            layoutKey={`${layoutVersion}:${selectionRevealKey ?? 0}:${text.length}:${activeReviewItem.id}`}
            onClose={onDismissReviewItem}
            onPrepare={onPrepareReviewItem}
            onApplyText={onApplyReviewText}
            onApplyCallout={onApplyReviewCallout}
            onGenerateImage={onGenerateReviewImage}
            onInsertImage={onInsertReviewImage}
            onDiscardProposal={onDiscardReviewProposal}
            selectedCalloutKind={selectedCalloutKind}
            onCalloutKindChange={onCalloutKindChange}
          />
        ) : activeImageBlock ? (
          <ImagePreviewLane
            editorView={editorViewRef.current}
            block={activeImageBlock}
            canMoveUp={activeImageIndex > 0}
            canMoveDown={activeImageIndex >= 0 && activeImageIndex < imageBlocks.length - 1}
            layoutKey={`${layoutVersion}:${selectionRevealKey ?? 0}:${activeImageBlock.start}:${activeImageBlock.end}`}
            onMoveUp={() => handleMoveActiveImage("up")}
            onMoveDown={() => handleMoveActiveImage("down")}
          />
        ) : null}
      </div>

      {hasAppliedDiffs && appliedDiffs && onAppliedDiffChange && onDiscardAppliedDiffs && onDismissAppliedDiffs ? (
        <AppliedDiffReviewPanel
          appliedDiffs={appliedDiffs}
          revision={revision}
          text={text}
          onAppliedDiffChange={onAppliedDiffChange}
          onDiscardAppliedDiffs={onDiscardAppliedDiffs}
          onDismissAppliedDiffs={onDismissAppliedDiffs}
        />
      ) : null}
    </div>
  );
}
