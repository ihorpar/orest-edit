"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import type { Editor } from "@tiptap/react";
import { redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import { TextSelection, type Command } from "@tiptap/pm/state";
import { storeEditorAssetFromBlob } from "../../lib/editor/asset-store";
import {
  createEmptyParagraphBlock,
  documentToPlainText,
  ensureDocumentHasBlocks,
  getDocumentTextStats,
  getInlineText,
  sanitizeEditorText,
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
import { getNextRegion, planAnnouncements, type V2Region } from "../../lib/v2/a11y";
import { formatV2Date, getV2Copy } from "../../lib/v2/copy";
import {
  createV2Draft,
  getV2DraftStorageKey,
  hasV2DraftChangedElsewhere,
  loadInitialV2Draft,
  restartUnreadableV2Draft,
  writeV2DraftIfUnchanged
} from "../../lib/v2/draft-storage";
import { getActiveBlockKind, insertImage, isMarkActive } from "../../lib/v2/editor-commands";
import type { FragmentScope } from "../../lib/v2/fragment-actions";
import { countTextMatches, replaceAllText, type ReplaceOutcome } from "../../lib/v2/global-replace";
import { buildHistoryEntry, pushHistoryEntry, type V2HistoryEntry, type V2HistoryKind } from "../../lib/v2/history";
import { getSaveDelay, getV2HotkeyAction, isPageShortcutBlocked } from "../../lib/v2/hotkeys";
import {
  canRestoreSnapshot,
  createRecoverySnapshot,
  describeRecoveryPromise,
  INITIAL_GUARD_STATE,
  manuscriptGuardReducer,
  resolveManuscriptRequest,
  type ManuscriptRequest,
  type RecoverySnapshot
} from "../../lib/v2/manuscript-session";
import { sealHistory } from "../../lib/v2/review-apply";
import { shouldScrollToFocus, type FocusScrollState } from "../../lib/v2/focus-scroll";
import { getReviewDiffReport, isReviewDiffDrawn, REVIEW_ITEMS_ATTRIBUTE, type ReviewDecision, type ReviewDiffReport } from "../../lib/v2/review-marks";
import { isOpenItem } from "../../lib/v2/store";
import { isSelfDismissing, toastReducer, type V2Toast, type V2ToastEvent } from "../../lib/v2/toast";
import { ensureDocumentBlockIds, tiptapToDocument, V2_MARK } from "../../lib/v2/tiptap-bridge";
import { useProductLocale } from "../providers/ProductLocaleProvider";
import { ConfirmDialog, HistoryDialog, HotkeysDialog, ReplaceDialog } from "./Dialogs";
import { LIVE_PASSES } from "./EditsTab";
import { FormatToolbar, type ToolbarState } from "./FormatToolbar";
import { V2Icon } from "./icons";
import { ManuscriptEditor, type ManuscriptEditorHandle } from "./ManuscriptEditor";
import { SelectionComposer } from "./SelectionComposer";
import { useReviewEngine } from "./useReviewEngine";
import { V2Panel, type PanelTab } from "./V2Panel";
import { VisualStudio } from "./VisualStudio";
import styles from "./v2.module.css";

type SaveState = "saved" | "saving" | "error";
/** Why this tab must not write the draft: changed in another tab, unreadable in storage, or invalid for the editor. */
type SaveBlock = "conflict" | "unreadable" | "content";
type MenuId = "format" | "open" | "export" | "more";
type DialogId = "history" | "replace" | "hotkeys";

interface EditorSession {
  key: number;
  locale: AppLocale;
  initialDocument: EditorDocument;
}

type ToastState = V2Toast;

const TOAST_MS = 6000;

/** Time of day with seconds: two manuscripts replaced in the same minute must still be told apart. */
function formatClock(value: string, dateLocale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(dateLocale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

/** The first words of a kept manuscript, so the editor can tell which one a menu line brings back. */
function describeSnapshot(snapshot: RecoverySnapshot): string {
  const words = snapshot.document.blocks
    .map((block) => (block.type === "paragraph" || block.type === "heading" ? getInlineText(block.content).trim() : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
  return words.length > 32 ? `${words.slice(0, 32).trimEnd()}…` : words;
}

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Arrow keys inside an open menu; the menu's own Escape and outside click are handled by the page. */
function handleMenuKeys(event: ReactKeyboardEvent<HTMLElement>) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)'));
  const index = items.indexOf(window.document.activeElement as HTMLElement);
  const next =
    event.key === "ArrowDown"
      ? items[(index + 1) % items.length]
      : event.key === "ArrowUp"
        ? items[(index - 1 + items.length) % items.length]
        : event.key === "Home"
          ? items[0]
          : event.key === "End"
            ? items[items.length - 1]
            : null;

  if (next) {
    event.preventDefault();
    next.focus();
  }
}

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
  const stageRef = useRef<HTMLElement>(null);
  const askInputRef = useRef<HTMLTextAreaElement>(null);
  const lastDocumentRef = useRef<EditorDocument | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const sourceNameRef = useRef<string | null>(null);
  const sessionKeyRef = useRef(0);
  // `updatedAt` of the stored draft as this tab last read or wrote it; null while nothing is stored.
  const lastKnownUpdatedAtRef = useRef<string | null>(null);
  // The exact text of the draft as this tab stored it last: a cheap way to see that nobody else wrote since.
  const lastKnownRawRef = useRef<string | null>(null);
  const blockedRef = useRef<SaveBlock | null>(null);

  const [session, setSession] = useState<EditorSession | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [snapshot, setSnapshot] = useState<EditorDocument | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [blocked, setBlocked] = useState<SaveBlock | null>(null);
  const [toast, setToastState] = useState<ToastState | null>(null);
  const sendToast = useCallback((event: V2ToastEvent) => setToastState((current) => toastReducer(current, event)), []);
  /** Shows a message (replacing the one on screen) or closes it. */
  const setToast = useCallback(
    (next: ToastState | null) => sendToast(next ? { type: "show", toast: next } : { type: "dismissed" }),
    [sendToast]
  );
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [busy, setBusy] = useState<"import" | "export" | null>(null);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [diffReport, setDiffReport] = useState<ReviewDiffReport>({ drawn: [], failed: [] });
  // What the `Запит` tab is about and what is typed there; kept here so switching tabs loses neither.
  const [askScope, setAskScope] = useState<FragmentScope | null>(null);
  const [askDraft, setAskDraft] = useState("");
  const [askFocus, setAskFocus] = useState(0);
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const [guard, sendGuard] = useReducer(manuscriptGuardReducer, INITIAL_GUARD_STATE);
  // Accepted changes of this draft, oldest first; the ref is what a save reads between renders.
  const historyRef = useRef<V2HistoryEntry[]>([]);
  const [history, setHistoryState] = useState<V2HistoryEntry[]>([]);
  const setHistory = useCallback((next: V2HistoryEntry[]) => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);
  const [loadNonce, setLoadNonce] = useState(0);
  // The interface language is known only in the browser (it is the editor's own choice, kept there), so
  // nothing that depends on it is rendered on the server or in the first client render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // What a screen reader is told; the same text twice in a row is told again thanks to the counter.
  const [announcement, setAnnouncement] = useState<{ text: string; id: number }>({ text: "", id: 0 });
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
    onApplied: (change) => recordChangeRef.current(change),
    notify: (tone, message, action, area) => setToast({ tone, message, action, area }),
    resolveToast: (area) => sendToast({ type: "resolved", area }),
    onShowQueue: () => {
      setTab("edits");

      // The result is drawn where the selection was: let go of it, so the change is what is seen.
      const liveEditor = liveEditorRef.current;

      if (liveEditor && !liveEditor.isDestroyed && !liveEditor.state.selection.empty) {
        const { state } = liveEditor;
        liveEditor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(state.selection.to), -1)));
      }
    }
  });
  const reviewRef = useRef(review);
  reviewRef.current = review;

  /** Adds an accepted change to the history of the draft. Typing never comes here. */
  const recordChange = useCallback(
    (change: { kind: V2HistoryKind; before: EditorDocument; after: EditorDocument; source?: string | null; count?: number; find?: string; replacement?: string }) => {
      const entry = buildHistoryEntry({ id: createLocalId("h"), at: new Date().toISOString(), ...change });

      if (entry) {
        setHistory(pushHistoryEntry(historyRef.current, entry));
        scheduleSaveRef.current();
      }
    },
    [setHistory]
  );
  const recordChangeRef = useRef(recordChange);
  recordChangeRef.current = recordChange;

  // One polite announcement per finished pass, prepared edit, finished image or failure. Nothing else.
  const announcedStateRef = useRef(review.state);

  useEffect(() => {
    const messages = planAnnouncements(announcedStateRef.current, review.state, copy);
    announcedStateRef.current = review.state;

    if (messages.length > 0) {
      setAnnouncement((current) => ({ text: messages.join(" "), id: current.id + 1 }));
    }
  }, [copy, review.state]);

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
          createV2Draft(document, sourceNameRef.current, reviewRef.current.getPersisted(), { history: historyRef.current }),
          lastKnownUpdatedAtRef.current,
          lastKnownRawRef.current
        );

        if (result.status === "conflict") {
          blockSaving("conflict");
          return;
        }

        lastKnownUpdatedAtRef.current = result.updatedAt;
        lastKnownRawRef.current = result.raw;
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

    // A long chapter is read and stored less often: both cost more there.
    saveTimerRef.current = window.setTimeout(flush, getSaveDelay(liveEditorRef.current?.state.doc.content.size ?? 0));
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

  const loadedLocaleRef = useRef<AppLocale | null>(null);

  useEffect(() => {
    if (loadedLocaleRef.current !== null && loadedLocaleRef.current !== locale) {
      // The workspace now shows the draft of another language (the language can change under an open page,
      // from `/settings` in another tab). Dialogs about the old draft close, and the manuscripts kept for
      // recovery are let go: they belong to the other draft and must never be written into this one.
      sendGuard({ type: "reset" });
      setDialog(null);
      setMenu(null);
    }

    loadedLocaleRef.current = locale;

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
      lastKnownRawRef.current = null;
      sourceNameRef.current = initial.draft.sourceName;
      setSourceName(initial.draft.sourceName);
      setSaveState(initial.writeError ? "error" : "saved");

      if (initial.writeError) {
        setToast({ tone: "error", message: describeError(initial.writeError, `${copy.saveFailed}.`) });
      }

      startSession(locale, initial.draft.document);
      setAskScope(null);
      setAskDraft("");
      setHistory(initial.draft.history ?? []);
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
  }, [blockSaving, copy.draftReadFailed, copy.saveFailed, loadNonce, locale, setHistory, startSession]);

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
    // An error stays until it is closed, replaced, or the action it reported succeeds on a retry.
    if (!isSelfDismissing(toast)) {
      return;
    }

    const timer = window.setTimeout(() => sendToast({ type: "expired" }), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [sendToast, toast]);

  const [toolbarState, setToolbarState] = useState<ToolbarState | null>(null);
  const isReady = Boolean(session) && !blocked;

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

  const takeSnapshot = (reason: "clear" | "open"): RecoverySnapshot | null => {
    const current = flush() ?? lastDocumentRef.current;

    return current
      ? createRecoverySnapshot({
          id: createLocalId("r"),
          reason,
          locale,
          draftKey: getV2DraftStorageKey(locale),
          document: current,
          sourceName: sourceNameRef.current,
          review: review.getPersisted(),
          history: historyRef.current,
          at: new Date().toISOString()
        })
      : null;
  };

  /**
   * Puts another document in place of the manuscript. With `reason`, what is replaced (text, suggestions,
   * reports, history) is kept for this session and can be brought back from the `Ще` menu; the snapshot that
   * was kept is returned (null when nothing was kept).
   */
  function replaceManuscript(document: EditorDocument, nextSourceName: string | null, reason?: "clear" | "open"): RecoverySnapshot | null {
    const nextDocument = ensureDocumentBlockIds(ensureDocumentHasBlocks(document));

    if (editorRef.current?.getEditor() && !contentError) {
      const snapshot = reason ? takeSnapshot(reason) : null;

      // Throws when the document cannot be loaded; the source name changes only after it is in the editor.
      editorRef.current.replaceDocument(nextDocument);
      // Suggestions belonged to the previous text; a run in flight is cancelled with them.
      review.reset();
      setAskScope(null);
      setHistory([]);
      sourceNameRef.current = nextSourceName;
      setSourceName(nextSourceName);
      sendGuard({ type: "replaced", snapshot });
      flush();
      return snapshot;
    }

    // The stored draft could not be shown in the editor: the imported document starts a fresh session.
    // Nothing is kept for recovery here, and the confirmation says so.
    blockSaving(null);
    review.reset();
    setAskScope(null);
    setHistory([]);
    sourceNameRef.current = nextSourceName;
    setSourceName(nextSourceName);
    persist(nextDocument);
    startSession(locale, nextDocument);
    return null;
  }

  /**
   * Brings a replaced manuscript back (the most recent one unless another is named). What is on screen now
   * takes a place in the recovery list, so bringing back is itself reversible.
   */
  function restoreReplaced(target?: RecoverySnapshot) {
    const snapshot = target ?? guard.recovery[0];
    setMenu(null);

    if (!snapshot || !editorRef.current?.getEditor() || blocked) {
      return;
    }

    // A snapshot goes back only into the draft it came from: never into another language's draft.
    if (!canRestoreSnapshot(snapshot, { locale, draftKey: getV2DraftStorageKey(locale) })) {
      setToast({ tone: "error", message: copy.confirm.restoreWrongLocale });
      return;
    }

    try {
      const swapped = takeSnapshot(snapshot.reason);

      editorRef.current.replaceDocument(snapshot.document);
      // Cancels whatever runs for the text that is leaving; the snapshot itself never carries a run.
      review.reset();
      review.hydrate(snapshot.review, snapshot.document);
      setAskScope(null);
      setHistory(snapshot.history);
      sourceNameRef.current = snapshot.sourceName;
      setSourceName(snapshot.sourceName);
      sendGuard({ type: "restored", id: snapshot.id });
      sendGuard({ type: "replaced", snapshot: swapped });
      flush();
      setToast({ tone: "info", message: copy.confirm.restored });
    } catch (error) {
      setToast({ tone: "error", message: describeError(error, copy.confirm.restoreFailed) });
    }
  }

  function clearManuscript() {
    try {
      const snapshot = replaceManuscript({ version: 2, blocks: [createEmptyParagraphBlock()] }, null, "clear");
      setToast({
        tone: "info",
        message: copy.confirm.cleared,
        ...(snapshot ? { action: { label: copy.confirm.restore, run: () => restoreRef.current(snapshot) } } : {})
      });
    } catch (error) {
      setToast({ tone: "error", message: describeError(error, copy.edits.unexpected) });
    }
  }

  function startOpen(source: "file" | "clipboard") {
    if (source === "file") {
      fileInputRef.current?.click();
    } else {
      void importManuscript(readClipboard, null, messages.exportImport.clipboardReadFailed);
    }
  }

  /** Clear, open and start over go through here: nothing of the three happens on one click. */
  function requestManuscript(request: ManuscriptRequest) {
    setMenu(null);

    const decision = resolveManuscriptRequest(request, {
      document: (isReady ? flush() : null) ?? lastDocumentRef.current,
      review: session ? review.getPersisted() : null,
      history: historyRef.current
    });

    if (decision === "confirm") {
      sendGuard({ type: "requested", request });
    } else if (request.kind === "open") {
      startOpen(request.source);
    }
  }

  function confirmManuscriptRequest() {
    const request = guard.pending;
    sendGuard({ type: "confirmed" });

    if (!request) {
      return;
    }

    if (request.kind === "clear") {
      clearManuscript();
    } else if (request.kind === "open") {
      startOpen(request.source);
    } else {
      try {
        restartUnreadableV2Draft(window.localStorage, locale);
        // Whatever is stored now (the empty draft, or a draft another tab wrote meanwhile) is opened.
        setLoadNonce((current) => current + 1);
      } catch (error) {
        setToast({ tone: "error", message: describeError(error, copy.confirm.restartFailed) });
      }
    }
  }

  const countMatches = useCallback((query: string) => {
    const liveEditor = liveEditorRef.current;
    return liveEditor && !liveEditor.isDestroyed ? countTextMatches(liveEditor.state.doc, sanitizeEditorText(query)) : 0;
  }, []);

  /** Replace all, as one undo step. Suggestions over the changed text go stale on the save that follows. */
  function handleReplaceAll(rawQuery: string, rawReplacement: string): number {
    const query = sanitizeEditorText(rawQuery);
    const replacement = sanitizeEditorText(rawReplacement).replace(/\n/g, " ");
    const before = flush();
    let outcome: ReplaceOutcome | null = null;

    if (!before || !editorRef.current?.run(replaceAllText(query, replacement, (result) => (outcome = result)), { focus: false })) {
      return 0;
    }

    editorRef.current.run(sealHistory, { focus: false });

    const after = flush();
    const count = (outcome as ReplaceOutcome | null)?.count ?? 0;

    if (after) {
      recordChange({ kind: "globalReplace", before, after, count, find: query, replacement });
    }

    setToast({ tone: "info", message: copy.replace.done(count) });
    return count;
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

      const snapshot = replaceManuscript(imported.document, nextSourceName, "open");
      setToast({
        tone: "info",
        message: buildImportFeedback(imported.format, imported.warnings, locale).message,
        ...(snapshot ? { action: { label: copy.confirm.restore, run: () => restoreRef.current(snapshot) } } : {})
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
    return copy.stats(getDocumentTextStats(snapshot).words, paragraphs);
  }, [copy, snapshot]);

  const restoreRef = useRef(restoreReplaced);
  restoreRef.current = restoreReplaced;

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

  const focusSequence = review.focusSequence;
  const focusScrollRef = useRef<FocusScrollState | null>(null);

  useEffect(() => {
    // Only when the focused item changed or the editor asked to see it again; never because the panel tab
    // changed or the page re-rendered for another reason.
    const next: FocusScrollState = { focusId, sequence: focusSequence };
    const scroll = shouldScrollToFocus(focusScrollRef.current, next);
    focusScrollRef.current = next;

    if (!focusId || !scroll) {
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
  }, [focusId, focusSequence, focusSource]);
  // Quiet mode is driven from the keyboard, but never while the editor is typing somewhere: in the
  // manuscript, in a ghost heading, in the refine field, or with a button, link or menu under the keys.
  const quiet = review.state.quiet;
  const { confirmFocused, moveFocus, rejectItem } = review;
  const studioOpen = review.studioTarget !== null;
  const modalOpen = dialog !== null || guard.pending !== null;

  useEffect(() => {
    // With the studio open the keys belong to it: nothing is decided in the queue behind it.
    if (!quiet || tab !== "edits" || !isReady || studioOpen) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;

      // Nothing in the queue is decided from behind a dialog.
      if (isPageShortcutBlocked({ modalOpen, studioOpen, dialogInDocument: window.document.querySelector("dialog[open]") !== null, target })) {
        return;
      }

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
  }, [confirmFocused, isReady, modalOpen, moveFocus, quiet, rejectItem, studioOpen, tab]);

  const toggleMenu = (id: MenuId) => setMenu((current) => (current === id ? null : id));
  const hasToast = toast !== null && blocked !== "conflict";

  // Page shortcuts: find and replace, the list of shortcuts, moving between the parts of the page, and the
  // way from a selection to its actions. They are off while the studio or a dialog has the keyboard.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      const action = getV2HotkeyAction(event);

      if (!action) {
        return;
      }

      // The browser's own meaning of these keys (history, quick find) is never wanted over the editor.
      event.preventDefault();

      if (
        isPageShortcutBlocked({
          modalOpen,
          studioOpen,
          dialogInDocument: window.document.querySelector("dialog[open]") !== null,
          target: event.target instanceof Element ? event.target : null
        })
      ) {
        return;
      }

      const root = rootRef.current;
      const active = window.document.activeElement;

      switch (action) {
        case "replace":
          if (isReady) {
            setMenu(null);
            setDialog("replace");
          }
          break;
        case "hotkeys":
          setMenu(null);
          setDialog("hotkeys");
          break;
        case "composer":
          root?.querySelector<HTMLElement>("[data-selbar] button")?.focus();
          break;
        case "region-next":
        case "region-previous": {
          const available = new Set<V2Region>(["panel"]);

          if (isReady && liveEditorRef.current && !liveEditorRef.current.isDestroyed) {
            available.add("manuscript");
          }

          if (hasToast) {
            available.add("toast");
          }

          const current: V2Region | null = !(active instanceof Element)
            ? null
            : active.closest("[data-v2-toast]")
              ? "toast"
              : active.closest("[data-v2-panel]")
                ? "panel"
                : active.closest("[data-v2-stage]")
                  ? "manuscript"
                  : null;
          const next = getNextRegion(current, available, action === "region-previous");

          if (next === "manuscript") {
            liveEditorRef.current?.view.focus();
          } else if (next === "panel") {
            root?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
          } else if (next === "toast") {
            root?.querySelector<HTMLElement>("[data-v2-toast] button")?.focus();
          }
          break;
        }
      }
    };

    window.document.addEventListener("keydown", handleKey);
    return () => window.document.removeEventListener("keydown", handleKey);
  }, [hasToast, isReady, modalOpen, studioOpen]);

  // `Свій запит` in the composer: the fragment becomes the scope of the `Запит` tab and the field takes focus.
  const handleOwnRequest = useCallback((scope: FragmentScope) => {
    setAskScope(scope);
    setTab("ask");
    setAskFocus((current) => current + 1);
  }, []);

  useEffect(() => {
    if (askFocus > 0 && tab === "ask") {
      askInputRef.current?.focus();
    }
  }, [askFocus, tab]);

  // `Відкрити студію` on a ghost figure: the card it belongs to is shown behind the studio.
  const { openStudio } = review;
  const handleStudioOpen = useCallback(
    (itemId: string) => {
      setTab("edits");
      openStudio(itemId);
    },
    [openStudio]
  );

  const { acceptItem: acceptReviewItem, rejectItem: rejectReviewItem, showItem: showReviewItem } = review;
  const handleDecide = useCallback(
    (itemId: string, decision: ReviewDecision) => {
      if (decision === "accept") {
        acceptReviewItem(itemId);
      } else if (decision === "reject") {
        rejectReviewItem(itemId);
      } else {
        // The same step as `Показати` on the card: the change is prepared and drawn, nothing is applied.
        setTab("edits");
        showReviewItem(itemId);
      }
    },
    [acceptReviewItem, rejectReviewItem, showReviewItem]
  );
  const decideLabels = useMemo(
    () => ({ accept: copy.edits.accept, reject: copy.edits.reject, show: copy.edits.show, busy: copy.edits.preparing }),
    [copy]
  );

  const notifyFromPanel = useCallback(
    (tone: "info" | "error", message: string) => setToast({ tone, message, area: "overview" }),
    [setToast]
  );
  const clearAskScope = useCallback(() => setAskScope(null), []);

  if (!mounted) {
    return <div className={styles.root} aria-busy="true" />;
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <header className={styles.top}>
        <a className={styles.logo} href="/v2">
          <i>B</i>
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
        <button
          type="button"
          className={styles.tb}
          title={copy.historyTitle}
          aria-label={copy.history}
          aria-haspopup="dialog"
          disabled={!isReady}
          data-v2-history
          onClick={() => {
            setMenu(null);
            setDialog("history");
          }}
        >
          <V2Icon name="clock" />
          <span className={styles.wide}>{copy.history}</span>
        </button>
        <span className={styles.menuAnchor} data-v2-menu>
          <button
            type="button"
            className={styles.tb}
            title={copy.moreTitle}
            aria-label={copy.more}
            aria-haspopup="menu"
            aria-expanded={menu === "more"}
            data-v2-more
            onClick={() => toggleMenu("more")}
          >
            <V2Icon name="more" />
          </button>
          {menu === "more" ? (
            <div className={styles.menu} role="menu" aria-label={copy.more} onKeyDown={handleMenuKeys}>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                autoFocus
                disabled={!isReady}
                data-more="replace"
                onClick={() => {
                  setMenu(null);
                  setDialog("replace");
                }}
              >
                {copy.menuMore.replace}
                <kbd>Ctrl+H</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                data-more="hotkeys"
                onClick={() => {
                  setMenu(null);
                  setDialog("hotkeys");
                }}
              >
                {copy.menuMore.hotkeys}
                <kbd>Ctrl+/</kbd>
              </button>
              {guard.recovery.length > 0 ? (
                <p className={styles.menuNote} data-more-recovery={guard.recovery.length}>
                  {copy.menuMore.recoveryHeld(guard.recovery.length)}
                </p>
              ) : null}
              {guard.recovery.map((snapshot, index) => (
                <button
                  key={snapshot.id}
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  disabled={!isReady}
                  data-more="restore"
                  data-restore-index={index}
                  onClick={() => restoreReplaced(snapshot)}
                >
                  {copy.menuMore.restoreOne(snapshot.reason, formatClock(snapshot.at, copy.dateLocale), describeSnapshot(snapshot))}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                disabled={!isReady}
                data-more="clear"
                onClick={() => requestManuscript({ kind: "clear" })}
              >
                {copy.menuMore.clear}
              </button>
              <a role="menuitem" className={`${styles.menuItem} ${styles.narrowOnly}`} href="/editor">
                {copy.classic}
              </a>
            </div>
          ) : null}
        </span>
        <span className={styles.vr} />
        <a className={`${styles.btn} ${styles.btnGhost} ${styles.wide}`} href="/editor" title={copy.classicTitle}>
          {copy.classic}
        </a>
        <span className={styles.menuAnchor} data-v2-menu>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            aria-haspopup="menu"
            aria-expanded={menu === "open"}
            data-v2-open
            disabled={!session || busy !== null || blocked === "conflict"}
            onClick={() => toggleMenu("open")}
          >
            {busy === "import" ? <span className={styles.spin} /> : null}
            {copy.open}
          </button>
          {menu === "open" ? (
            <div className={styles.menu} role="menu" aria-label={copy.open} onKeyDown={handleMenuKeys}>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                autoFocus
                data-open="file"
                onClick={() => requestManuscript({ kind: "open", source: "file" })}
              >
                {copy.openFile}
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                data-open="clipboard"
                onClick={() => requestManuscript({ kind: "open", source: "clipboard" })}
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
            data-v2-export
            disabled={!isReady || busy !== null}
            onClick={() => toggleMenu("export")}
          >
            {busy === "export" ? <span className={styles.spin} /> : <V2Icon name="down" />}
            <span>{copy.export}</span>
          </button>
          {menu === "export" ? (
            <div className={styles.menu} role="menu" aria-label={copy.export} onKeyDown={handleMenuKeys}>
              <button type="button" role="menuitem" className={styles.menuItem} autoFocus data-export="docx" onClick={() => void handleExportDocx()}>
                {copy.exportDocx}
              </button>
              <button type="button" role="menuitem" className={styles.menuItem} data-export="txt" onClick={handleExportTxt}>
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
        <main className={styles.stage} ref={stageRef} data-v2-stage>
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
            {blocked === "unreadable" ? (
              <div className={styles.sheetError} role="alert" data-v2-unreadable>
                <p>{copy.draftUnreadable}</p>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnOutline}`}
                  data-v2-restart
                  onClick={() => requestManuscript({ kind: "restart" })}
                >
                  {copy.confirm.restart}
                </button>
              </div>
            ) : null}
            {session && !contentError ? (
              <ManuscriptEditor
                key={session.key}
                ref={editorRef}
                initialDocument={session.initialDocument}
                locale={session.locale}
                placeholder={copy.placeholder}
                ariaLabel={copy.manuscriptLabel}
                imageMissingLabel={copy.imageMissing}
                imageEditLabel={copy.studio.edit}
                onStudioOpen={handleStudioOpen}
                onImageEdit={review.openFigure}
                onChange={handleChange}
                onEditorChange={handleEditorChange}
                onContentError={handleContentError}
                reviewMarks={review.marks}
                onReviewItemClick={handleMarkClick}
                onReviewItemHover={review.hoverItem}
                onReviewDiffReport={setDiffReport}
                onReviewHeadingChange={review.editHeading}
                onReviewDecide={handleDecide}
                decideLabels={decideLabels}
              />
            ) : null}
            {!session && !blocked ? <span className={styles.srOnly}>{copy.loading}</span> : null}
          </article>
          {isReady ? (
            <SelectionComposer editor={editor} copy={copy} review={review} containerRef={stageRef} onOwnRequest={handleOwnRequest} />
          ) : null}
        </main>
        <V2Panel
          copy={copy}
          locale={locale}
          tab={tab}
          onTabChange={setTab}
          review={review}
          diffReport={diffReport}
          document={snapshot}
          chapterTitle={title}
          aiDisabled={!isReady}
          askScope={askScope}
          onAskScopeClear={clearAskScope}
          askDraft={askDraft}
          onAskDraftChange={setAskDraft}
          askInputRef={askInputRef}
          onNotify={notifyFromPanel}
        />
      </div>
      {review.studioTarget ? (
        <VisualStudio copy={copy} locale={locale} review={review} target={review.studioTarget} disabled={!isReady} />
      ) : null}
      {dialog === "history" ? <HistoryDialog copy={copy} locale={locale} entries={history} onClose={() => setDialog(null)} /> : null}
      {dialog === "replace" ? (
        <ReplaceDialog copy={copy} countMatches={countMatches} onReplace={handleReplaceAll} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "hotkeys" ? <HotkeysDialog copy={copy} onClose={() => setDialog(null)} /> : null}
      {guard.pending ? (
        <ConfirmDialog
          copy={copy}
          request={guard.pending}
          promise={describeRecoveryPromise(guard.pending, guard, !contentError)}
          locale={locale}
          onConfirm={confirmManuscriptRequest}
          onCancel={() => sendGuard({ type: "cancelled" })}
        />
      ) : null}
      <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true" data-v2-live data-studio-outside>
        <span key={announcement.id}>{announcement.text}</span>
      </div>
      {blocked === "conflict" ? (
        <div className={styles.notice} role="alert" data-studio-outside>
          <span>{copy.conflict}</span>
          <button type="button" onClick={() => window.location.reload()}>
            {copy.reload}
          </button>
        </div>
      ) : null}
      {toast && blocked !== "conflict" ? (
        <div
          className={`${styles.toast} ${toast.tone === "error" ? styles.toastError : ""}`}
          role={toast.tone === "error" ? "alert" : "status"}
          aria-label={copy.a11y.toast}
          data-studio-outside
          data-v2-toast
        >
          <span>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              data-toast-action
              onClick={(event) => {
                // Not left focused: in quiet mode the next Enter belongs to the current suggestion.
                event.currentTarget.blur();
                // Taken down first, so a message the action itself shows (a refusal, a confirmation) stays up.
                const action = toast.action;
                setToast(null);
                action?.run();
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
