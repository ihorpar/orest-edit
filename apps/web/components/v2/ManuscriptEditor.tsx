"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { Command } from "@tiptap/pm/state";
import { resolveEditorAssetUrl, createEditorAssetToken } from "../../lib/editor/asset-store";
import { ensureDocumentHasBlocks, type EditorDocument } from "../../lib/editor/document-model";
import type { AppLocale } from "../../lib/i18n/product-locale";
import { createDocumentNode, replaceDocumentContent } from "../../lib/v2/editor-commands";
import { setReviewMarks, type ReviewDiffReport, type ReviewMark } from "../../lib/v2/review-marks";
import { documentToTiptap, tiptapToDocument } from "../../lib/v2/tiptap-bridge";
import { createV2Extensions } from "../../lib/v2/tiptap-extensions";
import styles from "./v2.module.css";

export interface ManuscriptEditorHandle {
  /** The Tiptap editor, or null before it is mounted. */
  getEditor(): Editor | null;
  /** Current manuscript as an `EditorDocument` (block ids are the ones in the editor). */
  getDocument(): EditorDocument | null;
  /** Replaces the whole manuscript as one undoable step. */
  replaceDocument(document: EditorDocument): void;
  /** Runs a ProseMirror command against the editor and returns the focus to the text (unless `focus` is false). */
  run(command: Command, options?: { focus?: boolean }): boolean;
}

interface ManuscriptEditorProps {
  ref?: Ref<ManuscriptEditorHandle>;
  initialDocument: EditorDocument;
  locale: AppLocale;
  placeholder: string;
  ariaLabel: string;
  imageMissingLabel: string;
  /** Called on every document change; read the document lazily with `getDocument()`. */
  onChange: () => void;
  onEditorChange: (editor: Editor | null) => void;
  onContentError: (error: Error) => void;
  /** Suggestions to draw over the text. They are decorations and never become part of the document. */
  reviewMarks?: ReviewMark[];
  /** `onDiff` is true when the click landed on drawn del/ins text. */
  onReviewItemClick?: (itemId: string, onDiff: boolean) => void;
  onReviewItemHover?: (itemId: string | null) => void;
  /** Which prepared changes are visible in the text right now. */
  onReviewDiffReport?: (report: ReviewDiffReport) => void;
}

const NO_MARKS: ReviewMark[] = [];

export function ManuscriptEditor({
  ref,
  initialDocument,
  locale,
  placeholder,
  ariaLabel,
  imageMissingLabel,
  onChange,
  onEditorChange,
  onContentError,
  reviewMarks = NO_MARKS,
  onReviewItemClick,
  onReviewItemHover,
  onReviewDiffReport
}: ManuscriptEditorProps) {
  const callbacks = useRef({ onChange, onContentError, onReviewItemClick, onReviewItemHover, onReviewDiffReport });
  callbacks.current = { onChange, onContentError, onReviewItemClick, onReviewItemHover, onReviewDiffReport };

  const extensions = useMemo(
    () =>
      createV2Extensions({
        locale,
        placeholder,
        imageMissingLabel,
        resolveAssetUrl: (assetId) => resolveEditorAssetUrl(createEditorAssetToken(assetId)),
        review: {
          onItemClick: (itemId, onDiff) => callbacks.current.onReviewItemClick?.(itemId, onDiff),
          onItemHover: (itemId) => callbacks.current.onReviewItemHover?.(itemId),
          onDiffReport: (report) => callbacks.current.onReviewDiffReport?.(report)
        }
      }),
    [locale, placeholder, imageMissingLabel]
  );
  const initialContent = useMemo(() => documentToTiptap(ensureDocumentHasBlocks(initialDocument)), [initialDocument]);

  const editor = useEditor({
    extensions,
    content: initialContent,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    enableInputRules: false,
    enablePasteRules: false,
    enableContentCheck: true,
    editorProps: {
      attributes: {
        class: styles.ms ?? "",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
        lang: locale === "en" ? "en" : "uk",
        spellcheck: "true"
      }
    },
    onUpdate: () => callbacks.current.onChange(),
    onContentError: ({ error }) => callbacks.current.onContentError(error)
  });

  useEffect(() => {
    onEditorChange(editor);
    return () => onEditorChange(null);
  }, [editor, onEditorChange]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    const apply = () => {
      if (!editor.isDestroyed) {
        setReviewMarks(reviewMarks)(editor.state, editor.view.dispatch);
      }
    };

    // The view is attached after the editor object exists.
    if (editor.isInitialized) {
      apply();
      return;
    }

    editor.on("mount", apply);
    return () => {
      editor.off("mount", apply);
    };
  }, [editor, reviewMarks]);

  useImperativeHandle(
    ref,
    () => ({
      getEditor: () => editor,
      getDocument: () => (editor && !editor.isDestroyed ? tiptapToDocument(editor.state.doc.toJSON()) : null),
      replaceDocument: (document) => {
        if (!editor || editor.isDestroyed) {
          return;
        }

        const node = createDocumentNode(editor.schema, documentToTiptap(ensureDocumentHasBlocks(document)));
        replaceDocumentContent(node.content)(editor.state, editor.view.dispatch);
      },
      run: (command, options) => {
        if (!editor || editor.isDestroyed) {
          return false;
        }

        const handled = command(editor.state, editor.view.dispatch, editor.view);

        if (options?.focus !== false) {
          editor.view.focus();
        }

        return handled;
      }
    }),
    [editor]
  );

  return <EditorContent editor={editor} />;
}
