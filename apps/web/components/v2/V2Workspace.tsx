"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import type { Editor } from "@tiptap/react";
import { redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import type { Command } from "@tiptap/pm/state";
import { storeEditorAssetFromBlob } from "../../lib/editor/asset-store";
import {
  documentToPlainText,
  ensureDocumentHasBlocks,
  getDocumentTextStats,
  getInlineText,
  type EditorDocument
} from "../../lib/editor/document-model";
import { buildDocxFileName, deriveDocxFileNameBase, exportDocumentToDocx } from "../../lib/editor/docx-export";
import {
  importFileToDocument,
  importHtmlToDocument,
  importPlainTextToDocument,
  type ImportedDocumentResult
} from "../../lib/editor/import";
import { buildImportFeedback } from "../../lib/editor/import-feedback";
import { getEditorMessages } from "../../lib/i18n/editor-messages";
import type { AppLocale } from "../../lib/i18n/product-locale";
import { formatManuscriptStats, getV2Copy } from "../../lib/v2/copy";
import {
  createV2Draft,
  getV2DraftStorageKey,
  hasV2DraftChangedElsewhere,
  loadInitialV2Draft,
  writeV2DraftIfUnchanged
} from "../../lib/v2/draft-storage";
import { getActiveBlockKind, insertImage, isMarkActive } from "../../lib/v2/editor-commands";
import { getReviewDiffReport, isReviewDiffDrawn, REVIEW_ITEMS_ATTRIBUTE, type ReviewDiffReport } from "../../lib/v2/review-marks";
import { isOpenItem } from "../../lib/v2/store";
import { ensureDocumentBlockIds, tiptapToDocument, V2_MARK } from "../../lib/v2/tiptap-bridge";
import { useProductLocale } from "../providers/ProductLocaleProvider";
import { LIVE_PASSES } from "./EditsTab";
import { FormatToolbar, type ToolbarState } from "./FormatToolbar";
import { V2Icon } from "./icons";
import { ManuscriptEditor, type ManuscriptEditorHandle } from "./ManuscriptEditor";
import { useReviewEngine } from "./useReviewEngine";
import { V2Panel, type PanelTab } from "./V2Panel";
import styles from "./v2.module.css";

type SaveState = "saved" | "saving" | "error";
/** Why this tab must not write the draft: changed in another tab, unreadable in storage, or invalid for the editor. */
type SaveBlock = "conflict" | "unreadable" | "content";
type MenuId = "format" | "open" | "export";

interface EditorSession {
  key: number;
  locale: AppLocale;
  initialDocument: EditorDocument;
}

interface ToastState {
  tone: "info" | "error";
  message: string;
  action?: { label: string; run: () => void };
}

const SAVE_DELAY_MS = 400;
const TOAST_MS = 6000;

const keepSelection = (event: MouseEvent) => event.preventDefault();

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function V2Workspace() {
  const { locale } = useProductLocale();
  const copy = getV2Copy(locale);
  const messages = getEditorMessages(locale);

  const editorRef = useRef<ManuscriptEditorHandle>(null);
  // Outlives the handle above, which React detaches before unmount cleanups run.
  const liveEditorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastDocumentRef = useRef<EditorDocument | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const sourceNameRef = useRef<string | null>(null);
  const sessionKeyRef = useRef(0);
  // `updatedAt` of the stored draft as this tab last read or wrote it; null while nothing is stored.
  const lastKnownUpdatedAtRef = useRef<string | null>(null);
  const blockedRef = useRef<SaveBlock | null>(null);

  const [session, setSession] = useState<EditorSession | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [snapshot, setSnapshot] = useState<EditorDocument | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [blocked, setBlocked] = useState<SaveBlock | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [busy, setBusy] = useState<"import" | "export" | null>(null);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [diffReport, setDiffReport] = useState<ReviewDiffReport>({ drawn: [], failed: [] });
  const contentError = blocked === "content";
  // Set below; the review engine and the save path need each other.
  const flushRef = useRef<() => EditorDocument | null>(() => null);
  const scheduleSaveRef = useRef<() => void>(() => undefined);

  const review = useReviewEngine({
    locale,
    copy,
    getDocument: () => {
      const liveEditor = liveEditorRef.current;

      // Until the editor is mounted the manuscript is the one the session was opened with.
      if (!liveEditor || liveEditor.isDestroyed) {
        return lastDocumentRef.current;
      }

      try {
        return tiptapToDocument(liveEditor.state.doc.toJSON());
      } catch {
        return null;
      }
    },
    runCommand: (command) => editorRef.current?.run(command, { focus: false }) ?? false,
    saveNow: () => flushRef.current(),
    requestSave: () => scheduleSaveRef.current(),
    canWrite: () => blockedRef.current === null && lastDocumentRef.current !== null,
    isDiffDrawn: (itemId) => {
      const liveEditor = liveEditorRef.current;
      return Boolean(liveEditor && !liveEditor.isDestroyed && isReviewDiffDrawn(liveEditor.state, itemId));
    },
    getDrawnIds: () => {
      const liveEditor = liveEditorRef.current;
      return liveEditor && !liveEditor.isDestroyed ? getReviewDiffReport(liveEditor.state).drawn : [];
    },
    livePasses: LIVE_PASSES,
    notify: (tone, message, action) => setToast({ tone, message, action })
  });
  const reviewRef = useRef(review);
  reviewRef.current = review;

  /** Stops every further write of the draft; the reason stays on screen until the page is reloaded. */
  const blockSaving = useCallback((reason: SaveBlock | null) => {
    blockedRef.current = reason;
    setBlocked(reason);

    if (reason) {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      setSaveState("error");
    }
  }, []);

  const startSession = useCallback((sessionLocale: AppLocale, document: EditorDocument) => {
    sessionKeyRef.current += 1;
    liveEditorRef.current = null;
    lastDocumentRef.current = document;
    setSnapshot(document);
    setSession({ key: sessionKeyRef.current, locale: sessionLocale, initialDocument: document });
  }, []);

  const persist = useCallback(
    (document: EditorDocument) => {
      if (blockedRef.current) {
        return;
      }

      try {
        const result = writeV2DraftIfUnchanged(
          window.localStorage,
          locale,
          createV2Draft(document, sourceNameRef.current, reviewRef.current.getPersisted()),
          lastKnownUpdatedAtRef.current
        );

        if (result.status === "conflict") {
          blockSaving("conflict");
          return;
        }

        lastKnownUpdatedAtRef.current = result.updatedAt;
        setSaveState("saved");
      } catch (error) {
        setSaveState("error");
        setToast({ tone: "error", message: describeError(error, `${copy.saveFailed}.`) });
      }
    },
    [blockSaving, copy.saveFailed, locale]
  );

  const flush = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const liveEditor = liveEditorRef.current;

    if (!liveEditor || blockedRef.current) {
      return null;
    }

    try {
      const document = tiptapToDocument(liveEditor.state.doc.toJSON());
      lastDocumentRef.current = document;
      setSnapshot(document);
      // Before saving, so a suggestion whose text was edited is stored as stale, not as ready.
      reviewRef.current.reconcile(document);
      persist(document);
      return document;
    } catch (error) {
      setSaveState("error");
      setToast({ tone: "error", message: describeError(error, `${copy.saveFailed}.`) });
      return null;
    }
  }, [copy.saveFailed, persist]);

  const handleChange = useCallback(() => {
    if (blockedRef.current) {
      return;
    }

    setSaveState("saving");

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  flushRef.current = flush;
  scheduleSaveRef.current = handleChange;

  const handleEditorChange = useCallback((next: Editor | null) => {
    if (next) {
      liveEditorRef.current = next;
    }

    setEditor(next);
  }, []);

  const handleContentError = useCallback(() => blockSaving("content"), [blockSaving]);

  useEffect(() => {
    try {
      const initial = loadInitialV2Draft(window.localStorage, locale);

      if (initial.status === "unreadable") {
        setSession(null);
        setSnapshot(null);
        blockSaving("unreadable");
        return;
      }

      blockSaving(null);
      lastKnownUpdatedAtRef.current = initial.persisted ? initial.draft.updatedAt : null;
      sourceNameRef.current = initial.draft.sourceName;
      setSourceName(initial.draft.sourceName);
      setSaveState(initial.writeError ? "error" : "saved");

      if (initial.writeError) {
        setToast({ tone: "error", message: describeError(initial.writeError, `${copy.saveFailed}.`) });
      }

      startSession(locale, initial.draft.document);
      reviewRef.current.hydrate(initial.draft.review ?? null, initial.draft.document);

      // Work in progress is shown first: a run in flight or suggestions waiting for a decision.
      if (
        initial.draft.review &&
        (initial.draft.review.activeRun || (initial.draft.review.queue ?? []).length > 0 || initial.draft.review.items.some(isOpenItem))
      ) {
        setTab("edits");
      }
    } catch (error) {
      setToast({ tone: "error", message: describeError(error, copy.draftReadFailed) });
    }
  }, [blockSaving, copy.draftReadFailed, copy.saveFailed, locale, startSession]);

  // Another tab saving the same draft must never be overwritten from here.
  useEffect(() => {
    const key = getV2DraftStorageKey(locale);
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || (event.key !== null && event.key !== key) || blockedRef.current) {
        return;
      }

      if (hasV2DraftChangedElsewhere(window.localStorage, locale, lastKnownUpdatedAtRef.current)) {
        blockSaving("conflict");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [blockSaving, locale]);

  useEffect(() => {
    if (editor && !editor.isDestroyed && blocked === "conflict") {
      editor.setEditable(false);
    }
  }, [blocked, editor]);

  useEffect(() => {
    const flushPending = () => {
      if (saveTimerRef.current !== null) {
        flush();
      }
    };
    const handleVisibility = () => {
      if (window.document.visibilityState === "hidden") {
        flushPending();
      }
    };

    window.addEventListener("pagehide", flushPending);
    window.document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("pagehide", flushPending);
      window.document.removeEventListener("visibilitychange", handleVisibility);
      flushPending();
    };
  }, [flush]);

  useEffect(() => {
    if (!menu) {
      return;
    }

    const handlePointer = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-v2-menu]")) {
        setMenu(null);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };

    window.document.addEventListener("mousedown", handlePointer);
    window.document.addEventListener("keydown", handleKey);

    return () => {
      window.document.removeEventListener("mousedown", handlePointer);
      window.document.removeEventListener("keydown", handleKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!toast || toast.tone === "error") {
      return;
    }

    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const [toolbarState, setToolbarState] = useState<ToolbarState | null>(null);

  useEffect(() => {
    if (!editor) {
      setToolbarState(null);
      return;
    }

    const update = () => {
      if (editor.isDestroyed) {
        return;
      }

      const { state } = editor;
      const next: ToolbarState = {
        block: getActiveBlockKind(state),
        bold: isMarkActive(state, V2_MARK.bold),
        italic: isMarkActive(state, V2_MARK.italic),
        canUndo: undoDepth(state) > 0,
        canRedo: redoDepth(state) > 0
      };

      setToolbarState((current) =>
        current &&
        current.block === next.block &&
        current.bold === next.bold &&
        current.italic === next.italic &&
        current.canUndo === next.canUndo &&
        current.canRedo === next.canRedo
          ? current
          : next
      );
    };

    // The view (and with it the plugin state) is attached after the editor object exists.
    update();
    editor.on("mount", update);
    editor.on("transaction", update);

    return () => {
      editor.off("mount", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const run = useCallback((command: Command) => {
    setMenu(null);
    editorRef.current?.run(command);
  }, []);

  function replaceManuscript(document: EditorDocument, nextSourceName: string | null) {
    const nextDocument = ensureDocumentBlockIds(ensureDocumentHasBlocks(document));

    if (editorRef.current?.getEditor() && !contentError) {
      // Throws when the document cannot be loaded; the source name changes only after it is in the editor.
      editorRef.current.replaceDocument(nextDocument);
      // Suggestions belonged to the previous text; a run in flight is cancelled with them.
      review.reset();
      sourceNameRef.current = nextSourceName;
      setSourceName(nextSourceName);
      flush();
      return;
    }

    // The stored draft could not be shown in the editor: the imported document starts a fresh session.
    blockSaving(null);
    review.reset();
    sourceNameRef.current = nextSourceName;
    setSourceName(nextSourceName);
    persist(nextDocument);
    startSession(locale, nextDocument);
  }

  async function importManuscript(load: () => Promise<ImportedDocumentResult>, nextSourceName: string | null, fallbackError: string) {
    setMenu(null);
    setBusy("import");

    try {
      const imported = await load();

      if (imported.assets?.length) {
        await Promise.all(
          imported.assets.map((asset) => storeEditorAssetFromBlob({ blob: asset.blob, assetId: asset.assetId, mimeType: asset.mimeType }))
        );
      }

      replaceManuscript(imported.document, nextSourceName);
      setToast({
        tone: "info",
        message: `${buildImportFeedback(imported.format, imported.warnings, locale).message} ${copy.replacedHint}`
      });
    } catch (error) {
      setToast({ tone: "error", message: error instanceof Error && error.message ? error.message : fallbackError });
    } finally {
      setBusy(null);
    }
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (file) {
      void importManuscript(() => importFileToDocument(file), file.name, messages.exportImport.importFailed);
    }
  }

  async function readClipboard(): Promise<ImportedDocumentResult> {
    if (typeof navigator.clipboard.read === "function") {
      try {
        for (const item of await navigator.clipboard.read()) {
          if (item.types.includes("text/html")) {
            const html = await (await item.getType("text/html")).text();
            const fallbackText = item.types.includes("text/plain") ? await (await item.getType("text/plain")).text() : "";
            return importHtmlToDocument(html, fallbackText);
          }

          if (item.types.includes("text/plain")) {
            return { ...importPlainTextToDocument(await (await item.getType("text/plain")).text()), format: "clipboard_text" };
          }
        }
      } catch {
        // Rich clipboard access can be denied while plain text is still readable.
      }
    }

    return { ...importPlainTextToDocument(await navigator.clipboard.readText()), format: "clipboard_text" };
  }

  async function handleExportDocx() {
    const document = flush() ?? snapshot;
    setMenu(null);

    if (!document) {
      return;
    }

    setBusy("export");

    try {
      const result = await exportDocumentToDocx({ document, locale });
      downloadBlob(result.blob, result.fileName);
      setToast({
        tone: "info",
        message:
          result.warnings.length > 0
            ? messages.exportImport.docxExportedWarnings(result.warnings.length)
            : messages.exportImport.docxExported
      });
    } catch (error) {
      setToast({ tone: "error", message: describeError(error, messages.feedback.docxExportFailed) });
    } finally {
      setBusy(null);
    }
  }

  function handleExportTxt() {
    const document = flush() ?? snapshot;
    setMenu(null);

    if (!document) {
      return;
    }

    try {
      const fileName = buildDocxFileName(deriveDocxFileNameBase(document, locale), locale).replace(/\.docx$/i, ".txt");
      downloadBlob(new Blob([documentToPlainText(document)], { type: "text/plain;charset=utf-8" }), fileName);
      setToast({ tone: "info", message: messages.exportImport.txtExported });
    } catch (error) {
      setToast({ tone: "error", message: describeError(error, messages.feedback.txtExportFailed) });
    }
  }

  async function handleInsertImage(file: File) {
    try {
      const stored = await storeEditorAssetFromBlob({ blob: file, mimeType: file.type });
      run(insertImage({ assetId: stored.assetId, alt: file.name.replace(/\.[^.]+$/, "") }));
    } catch (error) {
      setToast({ tone: "error", message: describeError(error, copy.imageInsertFailed) });
    }
  }

  const title = useMemo(() => {
    const heading = snapshot?.blocks.find((block) => block.type === "heading" && getInlineText(block.content).trim());
    return heading && heading.type === "heading" ? getInlineText(heading.content).trim() : copy.untitledChapter;
  }, [copy.untitledChapter, snapshot]);

  const stats = useMemo(() => {
    if (!snapshot) {
      return "";
    }

    const paragraphs = snapshot.blocks.filter((block) => block.type === "paragraph" && getInlineText(block.content).trim()).length;
    return formatManuscriptStats(getDocumentTextStats(snapshot).words, paragraphs);
  }, [snapshot]);

  const isReady = Boolean(session) && !blocked;
  const { focusItem } = review;

  // A click in a marked paragraph is first of all a caret placement: it focuses the suggestion (no model
  // call), and switches the panel to `Правки` only when it landed on a drawn change.
  const handleMarkClick = useCallback(
    (itemId: string, onDiff: boolean) => {
      if (onDiff) {
        setTab("edits");
      }

      focusItem(itemId, "mark");
    },
    [focusItem]
  );

  // Card and mark stay in step: focusing one side scrolls the other into view.
  const focusId = review.state.focusId;
  const focusSource = review.focusSource;

  useEffect(() => {
    if (!focusId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const root = rootRef.current;

      if (!root) {
        return;
      }

      if (focusSource === "card") {
        const mark = Array.from(root.querySelectorAll<HTMLElement>(`[${REVIEW_ITEMS_ATTRIBUTE}]`)).find((element) =>
          (element.getAttribute(REVIEW_ITEMS_ATTRIBUTE) ?? "").split(" ").includes(focusId)
        );
        mark?.scrollIntoView({ block: "center", behavior: "smooth" });
      }

      const card = Array.from(root.querySelectorAll<HTMLElement>("[data-card]")).find((element) => element.dataset.card === focusId);
      card?.scrollIntoView({ block: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusId, focusSource, tab]);
  // Quiet mode is driven from the keyboard, but never while the editor is typing somewhere: in the
  // manuscript, in a ghost heading, in the refine field, or with a button, link or menu under the keys.
  const quiet = review.state.quiet;
  const { confirmFocused, moveFocus, rejectItem } = review;

  useEffect(() => {
    if (!quiet || tab !== "edits" || !isReady) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;

      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) {
        return;
      }

      // Enter on a focused button or link presses that button.
      if (event.key === "Enter" && target?.closest("button, a")) {
        return;
      }

      const focusedId = reviewRef.current.state.focusId;

      if (!focusedId) {
        return;
      }

      // A held key must not decide one suggestion after another: accepting and rejecting take a fresh press.
      if (event.repeat && (event.key === "Enter" || event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        return;
      }

      switch (event.key) {
        case "Enter":
          event.preventDefault();
          confirmFocused();
          break;
        case "Backspace":
        case "Delete":
          event.preventDefault();
          rejectItem(focusedId);
          break;
        case "ArrowRight":
          event.preventDefault();
          moveFocus(1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          moveFocus(-1);
          break;
      }
    };

    window.document.addEventListener("keydown", handleKey);
    return () => window.document.removeEventListener("keydown", handleKey);
  }, [confirmFocused, isReady, moveFocus, quiet, rejectItem, tab]);

  const toggleMenu = (id: MenuId) => setMenu((current) => (current === id ? null : id));

  return (
    <div className={styles.root} ref={rootRef}>
      <header className={styles.top}>
        <a className={styles.logo} href="/v2">
          <i>O</i>
          <span>{copy.brand}</span>
        </a>
        <div className={styles.crumb}>
          <span>{sourceName ?? copy.untitledSource}</span>
          <b>{title}</b>
        </div>
        <span className={`${styles.saved} ${saveState === "error" ? styles.savedError : ""}`} role="status">
          {saveState === "saved" ? <V2Icon name="check" /> : null}
          {blocked === "conflict"
            ? copy.savePaused
            : blocked
              ? copy.draftNotOpened
              : saveState === "saved"
              ? copy.saved
              : saveState === "saving"
                ? copy.saving
                : copy.saveFailed}
        </span>
        <span className={styles.sp} />
        <button
          type="button"
          className={styles.tb}
          title={`${copy.undo} (Ctrl+Z)`}
          aria-label={copy.undo}
          disabled={!isReady || !toolbarState?.canUndo}
          onMouseDown={keepSelection}
          onClick={() => run(undo)}
        >
          <V2Icon name="undo" />
        </button>
        <button
          type="button"
          className={styles.tb}
          title={`${copy.redo} (Ctrl+Shift+Z)`}
          aria-label={copy.redo}
          disabled={!isReady || !toolbarState?.canRedo}
          onMouseDown={keepSelection}
          onClick={() => run(redo)}
        >
          <V2Icon name="redo" />
        </button>
        <button type="button" className={`${styles.tb} ${styles.wide}`} title={copy.historyPending} disabled>
          <V2Icon name="clock" />
          <span>{copy.history}</span>
        </button>
        <span className={styles.vr} />
        <a className={`${styles.btn} ${styles.btnGhost} ${styles.wide}`} href="/editor" title={copy.classicTitle}>
          {copy.classic}
        </a>
        <span className={`${styles.menuAnchor} ${styles.wide}`} data-v2-menu>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            aria-haspopup="menu"
            aria-expanded={menu === "open"}
            disabled={!session || busy !== null || blocked === "conflict"}
            onClick={() => toggleMenu("open")}
          >
            {busy === "import" ? <span className={styles.spin} /> : null}
            {copy.open}
          </button>
          {menu === "open" ? (
            <div className={styles.menu} role="menu">
              <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { setMenu(null); fileInputRef.current?.click(); }}>
                {copy.openFile}
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => void importManuscript(readClipboard, null, messages.exportImport.clipboardReadFailed)}
              >
                {copy.openClipboard}
              </button>
            </div>
          ) : null}
        </span>
        <span className={styles.menuAnchor} data-v2-menu>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSolid}`}
            aria-haspopup="menu"
            aria-expanded={menu === "export"}
            disabled={!isReady || busy !== null}
            onClick={() => toggleMenu("export")}
          >
            {busy === "export" ? <span className={styles.spin} /> : <V2Icon name="down" />}
            <span>{copy.export}</span>
          </button>
          {menu === "export" ? (
            <div className={styles.menu} role="menu">
              <button type="button" role="menuitem" className={styles.menuItem} onClick={() => void handleExportDocx()}>
                {copy.exportDocx}
              </button>
              <button type="button" role="menuitem" className={styles.menuItem} onClick={handleExportTxt}>
                {copy.exportTxt}
              </button>
            </div>
          ) : null}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={handleFileSelection}
        />
      </header>
      <div className={styles.app}>
        <main className={styles.stage}>
          <FormatToolbar
            copy={copy}
            state={isReady ? toolbarState : null}
            stats={stats}
            isMenuOpen={menu === "format"}
            onToggleMenu={() => toggleMenu("format")}
            onRun={run}
            onInsertImage={(file) => void handleInsertImage(file)}
          />
          <article
            className={styles.sheet}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && editor && !editor.isDestroyed) {
                event.preventDefault();
                editor.commands.focus("end");
              }
            }}
          >
            {contentError ? <p className={styles.sheetError} role="alert">{copy.contentError}</p> : null}
            {blocked === "unreadable" ? <p className={styles.sheetError} role="alert">{copy.draftUnreadable}</p> : null}
            {session && !contentError ? (
              <ManuscriptEditor
                key={session.key}
                ref={editorRef}
                initialDocument={session.initialDocument}
                locale={session.locale}
                placeholder={copy.placeholder}
                ariaLabel={copy.manuscriptLabel}
                imageMissingLabel={copy.imageMissing}
                onChange={handleChange}
                onEditorChange={handleEditorChange}
                onContentError={handleContentError}
                reviewMarks={review.marks}
                onReviewItemClick={handleMarkClick}
                onReviewItemHover={review.hoverItem}
                onReviewDiffReport={setDiffReport}
                onReviewHeadingChange={review.editHeading}
              />
            ) : null}
            {!session && !blocked ? <span className={styles.srOnly}>{copy.loading}</span> : null}
          </article>
        </main>
        <V2Panel copy={copy} locale={locale} tab={tab} onTabChange={setTab} review={review} diffReport={diffReport} document={snapshot} aiDisabled={!isReady} />
      </div>
      {blocked === "conflict" ? (
        <div className={styles.notice} role="alert">
          <span>{copy.conflict}</span>
          <button type="button" onClick={() => window.location.reload()}>
            {copy.reload}
          </button>
        </div>
      ) : null}
      {toast && blocked !== "conflict" ? (
        <div className={`${styles.toast} ${toast.tone === "error" ? styles.toastError : ""}`} role={toast.tone === "error" ? "alert" : "status"}>
          <span>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              data-toast-action
              onClick={(event) => {
                // Not left focused: in quiet mode the next Enter belongs to the current suggestion.
                event.currentTarget.blur();
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button type="button" onClick={() => setToast(null)}>
            {copy.dismiss}
          </button>
        </div>
      ) : null}
    </div>
  );
}
