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
import type { EditorialReviewItem, ReviewActionProposal } from "../../lib/editor/review-contract";

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
  selectionRevealKey?: number;
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
            disabled={loading || hasAppliedDiffs}
            title="Вставити зображення"
            aria-label="Вставити зображення"
          >
            Img
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageFileSelection} />
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
