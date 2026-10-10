"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Command } from "@tiptap/pm/state";
import { resolveEditorAssetUrl, storeEditorAssetFromBlob, storeEditorAssetFromDataUrl } from "../../lib/editor/asset-store";
import { getDocumentTextStats, getInlineText, type EditorDocument } from "../../lib/editor/document-model";
import type { PersistedActiveReviewRun } from "../../lib/editor/draft-state";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import type { LocalActionClarifyChoice } from "../../lib/editor/local-action-router";
import type {
  CustomRequestPlanAction,
  DiagnosticsMode,
  EditorialCalloutDepth,
  EditorialCalloutKind,
  EditorialReviewResponse,
  EditorialReviewRunSnapshot,
  EditorialStepRunMode,
} from "../../lib/editor/review-contract";
import { retainReviewRunProgress } from "../../lib/editor/review-run-merge";
import {
  createPersistedActiveReviewRun,
  isRunCompatibleWithEditor,
  isRunTerminal,
  releaseReviewRunPollLease,
  tryAcquireReviewRunPollLease,
  withReviewRunStartLock
} from "../../lib/editor/review-run-persistence";
import { addSpellcheckDictionaryWord, isSpellcheckWordInDictionary, readSpellcheckDictionaryWords } from "../../lib/editor/spellcheck-dictionary";
import {
  getLegacyVisualStylePresetStorageKey,
  getVisualStylePresetStorageKey,
  type AppLocale
} from "../../lib/i18n/product-locale";
import { buildFactCheckActionInstruction } from "../../lib/i18n/server-prompts/review-action";
import { planAccept, planBulkAccept } from "../../lib/v2/accept-plan";
import {
  buildProposalRequest,
  buildReviewRunRequest,
  cancelReviewRun,
  pollReviewRun,
  prepareProposal,
  readEditorSettingsReadOnly,
  refreshItemAnchor,
  runSpellcheck,
  startReviewRun,
  validateCompletedReviewResult,
  type ReviewApiDeps
} from "../../lib/v2/api";
import type { V2Copy } from "../../lib/v2/copy";
import { removeFigure, updateFigure, type FigureContent } from "../../lib/v2/figure-apply";
import {
  buildFragmentManualItem,
  buildLocalActionRequest,
  buildPatchItem,
  buildPatchRequest,
  findUnrewritableBlocks,
  isRewriteExecution,
  isScopeIntact,
  planFragmentExecution,
  planSpellMerge,
  resolvePrepareSettlement,
  requestLocalAction,
  requestPatch,
  shortenQuote,
  type FragmentActionId,
  type FragmentApiMessages,
  type FragmentScope
} from "../../lib/v2/fragment-actions";
import { getItemKind, hasCalloutDraft, needsProposalCall, type V2ReviewItem } from "../../lib/v2/item-kinds";
import { buildItemMarks } from "../../lib/v2/item-marks";
import { buildFactCheck, createAuthorQuery, normalizeFactCheckRows } from "../../lib/v2/overview";
import { applyReviewEdits, replaceAnchoredBlocks, resolveReplacementBlocks, sealHistory } from "../../lib/v2/review-apply";
import type { ReviewMark } from "../../lib/v2/review-marks";
import { buildSpellItems, filterFindingsByDictionary, selectSpellItemsInDictionary } from "../../lib/v2/spell-items";
import {
  buildFigureBlock,
  canGenerate,
  canInsertImage,
  canPreparePrompt,
  resolveStudioDefaults,
  type V2StudioData,
  type V2StudioEvent,
  type V2StudioField
} from "../../lib/v2/studio";
import {
  canAcceptItem,
  canApplyProposal,
  planQuietPreparation,
  QUIET_DWELL_MS,
  createInitialReviewState,
  findFigureItem,
  getFigureBlockId,
  getItemPassId,
  getRunIdForStep,
  getRunStepId,
  isOpenItem,
  isStudioItem,
  normalizeInstruction,
  planRunAll,
  reviewReducer,
  selectBulkCandidates,
  selectNextQueuedPass,
  selectReviewBusy,
  selectRunningPassId,
  selectRunningRunId,
  serializeReviewState,
  shouldPersistAfter,
  type V2PassId,
  type V2PersistedReview,
  type V2RequestEntry,
  type V2RequestOutcome,
  type V2ReviewAction,
  type V2ReviewFilter,
  type V2ReviewState,
  type V2RunId
} from "../../lib/v2/store";
import { createBlockIdForNodeType, V2_NODE } from "../../lib/v2/tiptap-bridge";
import type { V2ToastArea } from "../../lib/v2/toast";
import {
  buildImageRequest,
  buildVisualProposalRequest,
  generateImage,
  requestVisualPrompt,
  storeGeneratedAsset,
  type VisualApiMessages
} from "../../lib/v2/visual-api";
import { createBlocksWhereLabel } from "../../lib/v2/where-label";
import { diffProposalBlocks, type BlockDiff } from "../../lib/v2/word-diff";

const LEASE_RETRY_MS = 2_000;

export type ReviewFocusSource = "card" | "mark";

interface ReviewEngineOptions {
  locale: AppLocale;
  copy: V2Copy;
  /** The manuscript as it is in the editor right now, or null before the editor exists. */
  getDocument: () => EditorDocument | null;
  /** Runs a command on the editor without moving keyboard focus. */
  runCommand: (command: Command) => boolean;
  /** Saves the draft now and returns the saved manuscript, or null when saving is not possible. */
  saveNow: () => EditorDocument | null;
  /** Asks for a debounced save after review state changed. */
  requestSave: () => void;
  /** False when the draft must not be written (conflict, unreadable draft); AI actions are off then. */
  canWrite: () => boolean;
  /** True while the result of this item is visible in the manuscript. */
  isDiffDrawn: (itemId: string) => boolean;
  /** Ids of every item whose result is visible in the manuscript right now. */
  getDrawnIds: () => string[];
  /** Passes that can be launched (the rest are shown but not wired yet). */
  livePasses: ReadonlySet<string>;
  /**
   * `action` adds one button to the message (taking a rejection back). `area` names what an error is about,
   * so it can be taken down when the same thing succeeds later.
   */
  notify: (tone: "info" | "error", message: string, action?: { label: string; run: () => void }, area?: V2ToastArea) => void;
  /** The action of this area went through: an error shown for it earlier is taken down. */
  resolveToast: (area: V2ToastArea) => void;
  /** The result of a request about a fragment is in the queue: show `Правки` and let go of the selection. */
  onShowQueue: () => void;
}

/** How a preparation ended, for callers that wait for it (requests about a fragment). */
export type PrepareOutcome =
  | { kind: "ready" }
  | { kind: "failed"; message: string }
  /** Given up by the editor, or replaced by a newer request for the same item. */
  | { kind: "cancelled" }
  /** Nothing was sent (the item is gone, already being prepared, or the draft cannot be saved). */
  | { kind: "skipped" };

/** What the illustration studio is open for: an illustration of the queue, or an image block added by hand. */
export type StudioTarget = { kind: "item"; itemId: string } | { kind: "block"; blockId: string };

/** One image request in flight; aborting it stops the wait (and a download of the result, if one is running). */
interface VisualRun {
  controller: AbortController;
}

export interface ReviewEngine {
  state: V2ReviewState;
  marks: ReviewMark[];
  focusSource: ReviewFocusSource;
  /** Raised by every explicit focus action; the page scrolls to the focused item only on these. */
  focusSequence: number;
  /** Latest state for saving; always current, also between renders. */
  getPersisted: () => V2PersistedReview;
  hydrate: (persisted: V2PersistedReview | null, document: EditorDocument) => void;
  reset: () => void;
  reconcile: (document: EditorDocument) => void;
  /** Starts a pass (a review run, or spellcheck). False when nothing was started and nothing changed. */
  runPass: (passId: V2PassId) => boolean;
  /** Starts one of the read-only steps of `Огляд`. False when another run holds the review endpoint. */
  runStep: (runId: "diagnostics" | "fact_check") => boolean;
  setDiagnosticsMode: (mode: DiagnosticsMode) => void;
  /** Sends the editor's instruction for the whole chapter. False when nothing was sent. */
  runChapterRequest: (instruction: string) => boolean;
  /** Generates one planned action of the last chapter request again. */
  retryRequestAction: (index: number) => void;
  /**
   * One request about a fragment: a quick action, or the editor's own words (`custom` with `prompt`).
   * False when nothing was sent.
   */
  runFragmentAction: (action: FragmentActionId, scope: FragmentScope, prompt?: string) => boolean;
  cancelFragment: () => void;
  /** Answers the router's question: the same words go to the chosen executor. */
  answerClarify: (choice: LocalActionClarifyChoice) => void;
  dismissClarify: () => void;
  addAuthorQuery: (findingId: string) => void;
  setAuthorQueryNote: (id: string, note: string) => void;
  removeAuthorQuery: (id: string) => void;
  /** Focuses an item in the queue, lifting a filter that would hide it. Never calls the model. */
  revealItem: (itemId: string) => void;
  /** Stops the review run in flight. */
  stopRun: () => void;
  /** Queues every pass that has not run yet; spellcheck starts beside them. */
  runAll: () => void;
  /** Empties the launch queue and stops whatever is running. */
  stopAll: () => void;
  /** Lets a queue that came from a stored draft go on. */
  resumeQueue: () => void;
  /** Empties the launch queue; a run in flight goes on. */
  clearQueue: () => void;
  /** Stops this pass if it is running, or takes it out of the launch queue. */
  stopPass: (passId: V2PassId) => void;
  /** Accepts every visible result of the filtered pass as one manuscript step. */
  acceptAll: () => void;
  editHeading: (itemId: string, change: { title?: string; headingLevel?: 2 | 3 }) => void;
  /** Changes kind or depth of a callout; a draft written for the old choice is prepared again. */
  setCalloutOptions: (itemId: string, change: { calloutKind?: EditorialCalloutKind; calloutDepth?: EditorialCalloutDepth }) => void;
  chooseSuggestion: (itemId: string, choice: number) => void;
  addToDictionary: (itemId: string) => void;
  setQuiet: (quiet: boolean) => void;
  moveFocus: (delta: 1 | -1) => void;
  /** Enter in quiet mode: accepts the current item when its result is on screen, otherwise asks to see it. */
  confirmFocused: () => void;
  /** Focuses a suggestion. Never calls the model. */
  focusItem: (itemId: string | null, source?: ReviewFocusSource) => void;
  /** Explicit request to see a suggestion's change: focuses it and prepares the proposal if it has none. */
  showItem: (itemId: string) => void;
  hoverItem: (itemId: string | null) => void;
  prepareItem: (itemId: string, instruction?: string) => void;
  acceptItem: (itemId: string) => void;
  rejectItem: (itemId: string) => void;
  setFilter: (filter: V2ReviewFilter) => void;
  setInstruction: (itemId: string, text: string) => void;
  /** What the illustration studio is open for, or null while it is closed. */
  studioTarget: StudioTarget | null;
  /** Opens the studio for an illustration. Opening sends nothing: every paid call has its own button inside. */
  openStudio: (itemId: string) => void;
  /** `Змінити` on a figure in the text: the studio of the illustration behind it, or its caption only. */
  openFigure: (blockId: string) => void;
  /** Closes the studio. Everything in it stays on the illustration. */
  closeStudio: () => void;
  setStudioField: (itemId: string, change: V2StudioField) => void;
  /** Asks the model for a prompt for the chosen type and style (a model call; replaces the prompt on screen). */
  prepareVisualPrompt: (itemId: string) => void;
  cancelVisualPrompt: (itemId: string) => void;
  /** Generates an image for the prompt and settings on screen (a call to the image model). */
  generateVisual: (itemId: string) => void;
  /** Stops waiting for the image. The request has been sent already; its result is not shown. */
  cancelVisualGeneration: (itemId: string) => void;
  /** Inserts the generated image after the anchor. `shownAssetId` is the image the studio is showing. */
  insertVisual: (itemId: string, shownAssetId: string | null) => void;
  /** Puts the newly generated image (and the caption) in place of the one in the text. */
  replaceVisual: (itemId: string, shownAssetId: string | null) => void;
  /** Takes an inserted illustration out of the text; it is back in the queue. */
  removeVisual: (itemId: string) => void;
  /** Changes the caption of a figure in the text. False when nothing changed. */
  saveFigureCaption: (blockId: string, caption: string) => boolean;
  /** The image block with this id as the manuscript has it right now. */
  readFigure: (blockId: string) => FigureContent | null;
  /** The figure an illustration stands in right now (read from the latest state, also between renders). */
  findFigureBlockId: (itemId: string) => string | null;
}

function describeUnexpected(error: unknown, fallback: string): string {
  const detail = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  return detail ? `${fallback} ${detail}` : fallback;
}

function createTabId(): string {
  return `v2-tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

interface LaunchOptions {
  runMode?: EditorialStepRunMode;
  instruction?: string;
  planAction?: CustomRequestPlanAction & { index: number };
}

interface FragmentRun {
  controller: AbortController;
  entryId: string;
  /** The manual item whose preparation this request is waiting for, when it has one. */
  itemId?: string;
}

export function useReviewEngine(options: ReviewEngineOptions): ReviewEngine {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const stateRef = useRef<V2ReviewState>(createInitialReviewState());
  const [state, setState] = useState<V2ReviewState>(stateRef.current);
  const [focusSource, setFocusSourceState] = useState<ReviewFocusSource>("card");
  const [focusSequence, setFocusSequence] = useState(0);
  /** Every explicit focus action goes through here, so the page knows the editor asked to see the item. */
  const setFocusSource = useCallback((source: ReviewFocusSource) => {
    setFocusSourceState(source);
    setFocusSequence((current) => current + 1);
  }, []);

  const tabIdRef = useRef<string>("");
  const runTokenRef = useRef<object | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const leaseTimerRef = useRef<number | null>(null);
  const spellRunRef = useRef<{ token: object; controller: AbortController } | null>(null);
  /** Items quiet mode asked to prepare on its own and that have not answered yet. */
  const autoPreparingRef = useRef(new Set<string>());
  const quietFocusRef = useRef<{ itemId: string | null; since: number | null }>({ itemId: null, since: null });
  const prepareRequestsRef = useRef(new Map<string, number>());
  const prepareControllersRef = useRef(new Map<string, AbortController>());
  const prepareCounterRef = useRef(0);
  const fragmentRunRef = useRef<FragmentRun | null>(null);
  const diffCacheRef = useRef(new Map<string, BlockDiff[]>());
  const [studioTarget, setStudioTarget] = useState<StudioTarget | null>(null);
  /** Prompt preparations and image generations in flight, by illustration. */
  const visualPromptRunsRef = useRef(new Map<string, AbortController>());
  const visualRunsRef = useRef(new Map<string, VisualRun>());

  if (!tabIdRef.current) {
    tabIdRef.current = createTabId();
  }

  /** Reduces synchronously, so async flows can read the result right after dispatching. */
  const dispatch = useCallback((action: V2ReviewAction) => {
    const previous = stateRef.current;
    const next = reviewReducer(previous, action);

    if (next === previous) {
      return;
    }

    stateRef.current = next;
    setState(next);

    if (shouldPersistAfter(action)) {
      optionsRef.current.requestSave();
    }
  }, []);

  const apiDeps = useCallback((): ReviewApiDeps => ({ messages: optionsRef.current.copy.api }), []);

  const fragmentMessages = useCallback((): FragmentApiMessages => {
    const { api } = optionsRef.current.copy;
    return { invalid: api.localInvalid, network: api.network, noOperations: api.patchNoOperations, fallback: api.patchFallback };
  }, []);

  const withContext = useCallback((document: EditorDocument) => ({ document, revision: deriveManuscriptRevisionState(document) }), []);

  const clearLeaseTimer = useCallback(() => {
    if (leaseTimerRef.current !== null) {
      window.clearTimeout(leaseTimerRef.current);
      leaseTimerRef.current = null;
    }
  }, []);

  const completeRun = useCallback(
    (passId: V2RunId, run: EditorialReviewRunSnapshot, result: EditorialReviewResponse, runMode: EditorialStepRunMode) => {
      const { locale, copy, getDocument, saveNow } = optionsRef.current;
      const problem = validateCompletedReviewResult(result, run, copy.api);
      const failedChunks = result.diagnostics.failedChunks ?? [];
      // A chapter request that failed while writing still has its plan: each planned action can be retried.
      const requestParts =
        passId === "request" && !problem
          ? {
              plan: result.plan?.actions,
              holes: failedChunks.map((chunk) => ({ index: chunk.index, message: chunk.message }))
            }
          : {};

      if (problem || result.error) {
        dispatch({ type: "run/failed", passId, message: result.error?.trim() || problem || copy.api.resultInvalid, ...requestParts });
        saveNow();
        return;
      }

      const document = getDocument();

      if (!document) {
        dispatch({ type: "run/failed", passId, message: copy.api.resultInvalid });
        return;
      }

      const base = { type: "run/completed" as const, passId, runMode, stepRunId: result.stepRunId, at: new Date().toISOString(), ...withContext(document) };

      if (passId === "diagnostics") {
        const expertise = result.expertise?.trim();

        if (!expertise) {
          // An empty report is not a report: nothing is shown as if the chapter had been read.
          dispatch({ type: "run/failed", passId, message: copy.overview.diagnosticsEmpty });
          saveNow();
          return;
        }

        dispatch({ ...base, items: [], expertise });
      } else if (passId === "fact_check") {
        const rows = normalizeFactCheckRows(result.factCheckRows);
        const built = buildFactCheck({
          rows,
          document,
          revision: base.revision,
          reviewSessionId: result.reviewSessionId,
          stepRunId: result.stepRunId,
          locale
        });

        dispatch({ ...base, items: built.items, factCheck: { findings: built.findings, checkedCount: rows.length } });
      } else {
        dispatch({
          ...base,
          items: result.items,
          warnings: passId === "request" ? undefined : failedChunks.map((chunk) => chunk.message),
          ...requestParts
        });
      }

      saveNow();
    },
    [dispatch, withContext]
  );

  /**
   * Last resort for anything unexpected inside a run (a storage error in the lease helper, a bug): the pass
   * must not stay "running" forever. The run token and the lease are given up, the server run is cancelled
   * and the real message is shown on the pass.
   */
  const abandonRun = useCallback(
    (passId: V2RunId, token: object, error: unknown, reference: { runId: string; capability: string } | null) => {
      const { locale, copy } = optionsRef.current;

      if (runTokenRef.current !== token) {
        return;
      }

      runTokenRef.current = null;
      runAbortRef.current = null;

      if (reference) {
        try {
          releaseReviewRunPollLease(reference.runId, tabIdRef.current);
        } catch {
          // The lease expires on its own.
        }

        void cancelReviewRun({ ...reference, locale }, apiDeps());
      }

      dispatch({ type: "run/failed", passId, message: describeUnexpected(error, copy.edits.unexpected) });

      try {
        optionsRef.current.saveNow();
      } catch {
        // The failure is on screen; the next save will store it.
      }
    },
    [apiDeps, dispatch]
  );

  /** Polls a started or recovered run to its end and reports the outcome to the store. */
  const driveRunUnguarded = useCallback(
    async (passId: V2RunId, record: PersistedActiveReviewRun, token: object) => {
      const { locale, copy, getDocument, saveNow } = optionsRef.current;
      const ownerId = tabIdRef.current;
      const runId = record.run.runId;
      let leaseLost = false;

      const outcome = await pollReviewRun({
        ...apiDeps(),
        run: record.run,
        capability: record.capability,
        locale,
        itemCursor: record.itemCursor ?? 0,
        getSourceChars: () => {
          const document = getDocument();
          return document ? getDocumentTextStats(document).charactersWithSpaces : 0;
        },
        isCurrent: () => runTokenRef.current === token,
        acquireLease: (leaseRunId) => {
          const acquired = tryAcquireReviewRunPollLease({ runId: leaseRunId, ownerId });
          leaseLost = !acquired;
          return acquired;
        },
        onRequest: (controller) => {
          runAbortRef.current = controller;
        },
        onSnapshot: (update) => {
          const document = getDocument();

          if (!document || runTokenRef.current !== token) {
            return;
          }

          dispatch({
            type: "run/snapshot",
            passId,
            record: createPersistedActiveReviewRun(
              retainReviewRunProgress(update.run, stateRef.current.activeRun?.run),
              update.capability,
              false,
              record.snapshotBlockIds,
              update.itemCursor
            ),
            items: update.items,
            ...(update.plan ? { plan: update.plan } : {}),
            ...withContext(document)
          });
        }
      });

      releaseReviewRunPollLease(runId, ownerId);

      if (runTokenRef.current !== token) {
        return;
      }

      runTokenRef.current = null;

      if (outcome.kind === "superseded") {
        // Still the owner here, so the lease went to another tab that polls the same run.
        dispatch({ type: "run/failed", passId, message: leaseLost ? copy.edits.runElsewhere : copy.api.resultInvalid });
        saveNow();
        return;
      }

      if (outcome.kind === "failed") {
        // The run is over for this editor; make sure it is not left working on the server.
        void cancelReviewRun({ runId, capability: stateRef.current.activeRun?.capability ?? record.capability, locale }, apiDeps());
        dispatch({ type: "run/failed", passId, message: outcome.message });
        saveNow();
        return;
      }

      completeRun(passId, outcome.run, outcome.result, record.run.runMode);
    },
    [apiDeps, completeRun, dispatch, withContext]
  );

  const driveRun = useCallback(
    async (passId: V2RunId, record: PersistedActiveReviewRun, token: object) => {
      try {
        await driveRunUnguarded(passId, record, token);
      } catch (error) {
        abandonRun(passId, token, error, {
          runId: record.run.runId,
          capability: stateRef.current.activeRun?.capability ?? record.capability
        });
      }
    },
    [abandonRun, driveRunUnguarded]
  );

  const resumeRun = useCallback(
    (record: PersistedActiveReviewRun, knownDocument?: EditorDocument) => {
      const { locale, copy, getDocument, saveNow } = optionsRef.current;
      // Every step has a home: a pass row, or one of the runs of `Огляд` and `Запит`.
      const passId = getRunIdForStep(record.run.stepId);
      const document = knownDocument ?? getDocument();

      clearLeaseTimer();

      if (!passId) {
        return;
      }

      if (
        record.stale ||
        isRunTerminal(record.run) ||
        !document ||
        !isRunCompatibleWithEditor({ record, locale, liveBlockIds: document.blocks.map((block) => block.id) })
      ) {
        dispatch({ type: "run/failed", passId, message: copy.edits.runOutdated });
        saveNow();
        return;
      }

      let leased: boolean;

      try {
        leased = tryAcquireReviewRunPollLease({ runId: record.run.runId, ownerId: tabIdRef.current });
      } catch (error) {
        dispatch({ type: "run/failed", passId, message: describeUnexpected(error, copy.edits.unexpected) });
        return;
      }

      if (!leased) {
        // Another tab polls this run; look again shortly in case that tab goes away.
        dispatch({ type: "run/resumed", passId, record });
        leaseTimerRef.current = window.setTimeout(() => {
          leaseTimerRef.current = null;
          const current = stateRef.current.activeRun;

          if (current && current.run.runId === record.run.runId && !runTokenRef.current) {
            resumeRun(current);
          }
        }, LEASE_RETRY_MS);
        return;
      }

      const token = {};
      runTokenRef.current = token;
      dispatch({ type: "run/resumed", passId, record });
      void driveRun(passId, record, token);
    },
    [clearLeaseTimer, dispatch, driveRun]
  );

  const stopLocalRun = useCallback(() => {
    clearLeaseTimer();
    runTokenRef.current = null;
    runAbortRef.current?.abort();
    runAbortRef.current = null;
  }, [clearLeaseTimer]);

  /* ---------- illustrations ---------- */

  const visualMessages = useCallback((): VisualApiMessages => {
    const { api } = optionsRef.current.copy;

    return {
      network: api.network,
      promptInvalid: api.visualPromptInvalid,
      promptEmpty: api.visualPromptEmpty,
      imageInvalid: api.imageInvalid,
      imageEmpty: api.imageEmpty,
      imageTimeout: api.imageTimeout,
      assetFailed: api.assetFailed
    };
  }, []);

  const studioEvent = useCallback((itemId: string, event: V2StudioEvent) => dispatch({ type: "studio/event", itemId, event }), [dispatch]);

  const findStudio = useCallback((itemId: string): { item: V2ReviewItem; studio: V2StudioData } | null => {
    const item = stateRef.current.items.find((entry) => entry.id === itemId);
    return item && item.studio && isStudioItem(item) ? { item, studio: item.studio } : null;
  }, []);

  /** Lets go of every illustration request in flight without touching the store (the state is being replaced). */
  const stopVisualRuns = useCallback(() => {
    for (const controller of visualPromptRunsRef.current.values()) {
      controller.abort();
    }

    for (const run of visualRunsRef.current.values()) {
      run.controller.abort();
    }

    visualPromptRunsRef.current.clear();
    visualRunsRef.current.clear();
  }, []);

  const cancelVisualPrompt = useCallback(
    (itemId: string) => {
      const controller = visualPromptRunsRef.current.get(itemId);
      visualPromptRunsRef.current.delete(itemId);
      controller?.abort();
      studioEvent(itemId, { type: "prompt/cancelled" });
    },
    [studioEvent]
  );

  const cancelVisualGeneration = useCallback(
    (itemId: string) => {
      const run = visualRunsRef.current.get(itemId);
      visualRunsRef.current.delete(itemId);
      run?.controller.abort();
      studioEvent(itemId, { type: "generation/cancelled" });
    },
    [studioEvent]
  );

  const prepareVisualPrompt = useCallback(
    (itemId: string) => {
      const { locale, copy, getDocument, canWrite, notify } = optionsRef.current;
      const found = findStudio(itemId);

      if (!found || !canPreparePrompt(found.studio) || visualPromptRunsRef.current.has(itemId)) {
        return;
      }

      if (!canWrite()) {
        notify("error", copy.edits.writeBlocked);
        return;
      }

      const { item, studio } = found;
      const document = getDocument();
      const requestItem = document ? refreshItemAnchor(item, document) : null;
      const controller = new AbortController();
      visualPromptRunsRef.current.set(itemId, controller);
      studioEvent(itemId, { type: "prompt/requested" });

      const isCurrent = () => visualPromptRunsRef.current.get(itemId) === controller;
      const settle = (event: V2StudioEvent) => {
        if (isCurrent()) {
          visualPromptRunsRef.current.delete(itemId);
          studioEvent(itemId, event);
          optionsRef.current.saveNow();
        }
      };

      if (!document || !requestItem) {
        // The paragraphs the illustration was proposed for are gone: there is nothing to write a prompt about.
        settle({ type: "prompt/failed", message: copy.edits.visualGone });
        return;
      }

      const requested = { intent: studio.intent, style: studio.style, quality: studio.quality };

      void (async () => {
        try {
          const reply = await requestVisualPrompt(
            buildVisualProposalRequest({
              document,
              item: requestItem,
              settings: readEditorSettingsReadOnly(window.localStorage, locale),
              locale,
              ...requested
            }),
            { messages: { ...visualMessages() }, signal: controller.signal }
          );

          if (reply.kind === "prompt") {
            // The prompt was written for what was asked: the chosen type and style at the time of the request.
            settle({ type: "prompt/ready", prompt: reply.prompt, alt: reply.alt, caption: reply.caption, intent: requested.intent, style: requested.style });
          } else {
            settle({ type: "prompt/failed", message: reply.message });
          }
        } catch (error) {
          settle({ type: "prompt/failed", message: describeUnexpected(error, copy.edits.unexpected) });
        }
      })();
    },
    [findStudio, studioEvent, visualMessages]
  );

  /**
   * Generates the image the way the classic editor does: one request whose answer carries the image. The
   * image goes straight into the browser's asset store; only its id reaches the state.
   */
  const generateVisual = useCallback(
    (itemId: string) => {
      const { locale, copy, canWrite, notify, saveNow } = optionsRef.current;
      const found = findStudio(itemId);

      if (!found || !canGenerate(found.studio) || visualRunsRef.current.has(itemId)) {
        return;
      }

      if (!canWrite()) {
        notify("error", copy.edits.writeBlocked);
        return;
      }

      const { studio } = found;
      const run: VisualRun = { controller: new AbortController() };
      visualRunsRef.current.set(itemId, run);
      studioEvent(itemId, { type: "generation/requested", at: new Date().toISOString() });
      // On disk before the wait: a reload during it finds "interrupted", never a request to repeat.
      saveNow();

      void (async () => {
        const isCurrent = () => visualRunsRef.current.get(itemId) === run;
        const settle = (event: V2StudioEvent) => {
          if (isCurrent()) {
            visualRunsRef.current.delete(itemId);
            studioEvent(itemId, event);
            saveNow();
          }
        };

        try {
          const reply = await generateImage(buildImageRequest({ prompt: studio.prompt, quality: studio.quality, locale }), {
            messages: visualMessages(),
            signal: run.controller.signal
          });

          if (!isCurrent() || reply.kind === "aborted") {
            return;
          }

          if (reply.kind === "failed") {
            settle({ type: "generation/failed", message: reply.message });
            return;
          }

          let stored: { assetId: string; mimeType: string };

          try {
            stored = await storeGeneratedAsset(reply.asset, {
              storeDataUrl: storeEditorAssetFromDataUrl,
              storeBlob: storeEditorAssetFromBlob,
              resolveUrl: resolveEditorAssetUrl,
              signal: run.controller.signal
            });
          } catch (error) {
            settle({ type: "generation/failed", message: describeUnexpected(error, copy.api.assetFailed) });
            return;
          }

          settle({ type: "generation/completed", assetId: stored.assetId, mimeType: stored.mimeType, at: new Date().toISOString() });
        } catch (error) {
          settle({ type: "generation/failed", message: describeUnexpected(error, copy.edits.unexpected) });
        }
      })();
    },
    [findStudio, studioEvent, visualMessages]
  );

  const setStudioField = useCallback(
    (itemId: string, change: V2StudioField) => studioEvent(itemId, { type: "field", change }),
    [studioEvent]
  );

  const closeStudio = useCallback(() => setStudioTarget(null), []);

  const openStudio = useCallback(
    (itemId: string) => {
      const { locale } = optionsRef.current;
      const item = stateRef.current.items.find((entry) => entry.id === itemId);

      // A stale illustration has lost its place in the text; its card says so.
      if (!item || !isStudioItem(item) || item.status === "stale") {
        return;
      }

      if (isOpenItem(item)) {
        setFocusSource("card");
        dispatch({ type: "focus/set", itemId });
      }

      if (!item.studio) {
        let classicStyle: string | null = null;

        try {
          // Read only: the classic editor's remembered style is the starting point until v2 has its own.
          classicStyle =
            window.localStorage.getItem(getVisualStylePresetStorageKey(locale)) ??
            (locale === "uk" ? window.localStorage.getItem(getLegacyVisualStylePresetStorageKey()) : null);
        } catch {
          classicStyle = null;
        }

        dispatch({
          type: "studio/opened",
          itemId,
          defaults: resolveStudioDefaults({ intent: item.visualIntent, prefs: stateRef.current.visualPrefs, classicStyle })
        });
      }

      // Opening is free: nothing is sent until `Підготувати промпт` or `Згенерувати` is pressed in the studio.
      setStudioTarget({ kind: "item", itemId });
    },
    [dispatch, setFocusSource]
  );

  const openFigure = useCallback(
    (blockId: string) => {
      const item = findFigureItem(stateRef.current, blockId);

      if (item?.studio) {
        setStudioTarget({ kind: "item", itemId: item.id });
      } else {
        // Added from the toolbar or imported, or its illustration is no longer known: the caption only.
        setStudioTarget({ kind: "block", blockId });
      }
    },
    []
  );

  const readFigure = useCallback((blockId: string): FigureContent | null => {
    const block = optionsRef.current.getDocument()?.blocks.find((entry) => entry.id === blockId);
    return block?.type === "image" ? { assetId: block.assetId, alt: block.alt, caption: getInlineText(block.caption ?? []) } : null;
  }, []);

  const findFigureBlockId = useCallback((itemId: string) => getFigureBlockId(stateRef.current, itemId), []);

  const insertVisual = useCallback(
    (itemId: string, shownAssetId: string | null) => {
      const { copy, getDocument, runCommand, notify, canWrite } = optionsRef.current;
      const found = findStudio(itemId);

      // Only an image that is on screen in the studio, generated for exactly what the studio shows.
      if (!found || !isOpenItem(found.item) || found.item.status === "stale" || !canInsertImage(found.studio, shownAssetId) || !canWrite()) {
        return;
      }

      const { item, studio } = found;
      const before = getDocument();
      const anchorBlockId = item.insertionPoint.anchorBlockId;
      let id = createBlockIdForNodeType(V2_NODE.image);

      while (before?.blocks.some((block) => block.id === id)) {
        id = createBlockIdForNodeType(V2_NODE.image);
      }

      const block = buildFigureBlock(studio, id, item.title);

      if (
        !before ||
        !block ||
        !before.blocks.some((entry) => entry.id === anchorBlockId) ||
        !runCommand(applyReviewEdits([{ type: "insert", anchorBlockId, side: "after", blocks: [block] }]))
      ) {
        if (before) {
          dispatch({ type: "items/reconciled", ...withContext(before) });
        }

        notify("error", copy.studio.applyFailed, undefined, "accept");
        return;
      }

      runCommand(sealHistory);

      const after = getDocument();
      dispatch({
        type: "item/accepted",
        itemId,
        appliedFingerprint: after ? computeAnchorFingerprint(after, item.anchor.blockIds) : "",
        insertedBlockIds: [id],
        at: new Date().toISOString()
      });

      if (after) {
        dispatch({ type: "items/reconciled", ...withContext(after) });
      }

      setStudioTarget(null);
      notify("info", copy.studio.inserted);
    },
    [dispatch, findStudio, withContext]
  );

  const replaceVisual = useCallback(
    (itemId: string, shownAssetId: string | null) => {
      const { copy, getDocument, runCommand, notify, canWrite } = optionsRef.current;
      const found = findStudio(itemId);
      const blockId = getFigureBlockId(stateRef.current, itemId);

      if (!found || !blockId || !found.studio.asset || !canInsertImage(found.studio, shownAssetId) || !canWrite()) {
        return;
      }

      const { item, studio } = found;
      const change = { assetId: found.studio.asset.assetId, alt: studio.alt.trim() || item.title, caption: studio.caption.trim() };

      if (!runCommand(updateFigure(blockId, change))) {
        notify("error", readFigure(blockId) ? copy.studio.replaceSame : copy.studio.figureGone, undefined, "accept");
        return;
      }

      runCommand(sealHistory);

      const after = getDocument();

      if (after) {
        dispatch({ type: "items/reconciled", ...withContext(after) });
      }

      notify("info", copy.studio.replaced);
    },
    [dispatch, findStudio, readFigure, withContext]
  );

  const removeVisual = useCallback(
    (itemId: string) => {
      const { copy, getDocument, runCommand, notify, canWrite } = optionsRef.current;
      const blockId = getFigureBlockId(stateRef.current, itemId);

      if (!blockId || !canWrite()) {
        return;
      }

      if (!runCommand(removeFigure(blockId))) {
        notify("error", copy.studio.figureGone, undefined, "accept");
        return;
      }

      runCommand(sealHistory);

      const after = getDocument();

      if (after) {
        // The image block is gone, so the illustration is open again, with everything its studio had.
        dispatch({ type: "items/reconciled", ...withContext(after) });
      }

      notify("info", copy.studio.removed);
    },
    [dispatch, withContext]
  );

  const saveFigureCaption = useCallback((blockId: string, caption: string): boolean => {
    const { copy, runCommand, notify, canWrite } = optionsRef.current;

    if (!canWrite() || !runCommand(updateFigure(blockId, { caption: caption.trim() }))) {
      return false;
    }

    runCommand(sealHistory);
    notify("info", copy.studio.captionSaved);
    return true;
  }, []);

  const hydrate = useCallback(
    (persisted: V2PersistedReview | null, document: EditorDocument) => {
      stopLocalRun();
      // A fragment request belongs to the state that is being replaced; its answer must not land in the new one.
      fragmentRunRef.current?.controller.abort();
      fragmentRunRef.current = null;
      for (const controller of prepareControllersRef.current.values()) {
        controller.abort();
      }
      prepareControllersRef.current.clear();
      prepareRequestsRef.current.clear();
      diffCacheRef.current.clear();
      stopVisualRuns();
      setStudioTarget(null);
      dispatch({ type: "hydrate", persisted });
      dispatch({ type: "items/reconciled", ...withContext(document) });

      const record = stateRef.current.activeRun;

      if (record) {
        resumeRun(record, document);
      }

      // Words added to the dictionary since the findings were stored (also from the classic editor) go.
      if (stateRef.current.items.some((item) => item.spell && isOpenItem(item))) {
        const { locale } = optionsRef.current;

        void readSpellcheckDictionaryWords(locale).then(
          (words) => {
            const itemIds = selectSpellItemsInDictionary(stateRef.current.items, words, locale);

            if (itemIds.length > 0) {
              dispatch({ type: "spell/removed", itemIds });
            }
          },
          (error: unknown) => optionsRef.current.notify("error", describeUnexpected(error, optionsRef.current.copy.edits.dictionaryReadFailed))
        );
      }
    },
    [dispatch, resumeRun, stopLocalRun, stopVisualRuns, withContext]
  );

  const stopSpell = useCallback(() => {
    const run = spellRunRef.current;

    if (!run) {
      return;
    }

    spellRunRef.current = null;
    run.controller.abort();
    dispatch({ type: "spell/stopped" });
  }, [dispatch]);

  const runSpell = useCallback((): boolean => {
    const { locale, copy, saveNow, getDocument, canWrite, notify } = optionsRef.current;

    if (!canWrite()) {
      notify("error", copy.edits.writeBlocked);
      return false;
    }

    if (spellRunRef.current) {
      return false;
    }

    const document = saveNow() ?? getDocument();

    if (!document || getDocumentTextStats(document).words === 0) {
      dispatch({ type: "spell/failed", message: copy.edits.emptyDocument });
      return true;
    }

    const run = { token: {}, controller: new AbortController() };
    spellRunRef.current = run;
    dispatch({ type: "spell/requested" });

    void (async () => {
      const isCurrent = () => spellRunRef.current === run;

      try {
        let words: string[] = [];

        try {
          words = await readSpellcheckDictionaryWords(locale);
        } catch (error) {
          notify("error", describeUnexpected(error, copy.edits.dictionaryReadFailed));
        }

        const reply = await runSpellcheck(
          { document, locale, signal: run.controller.signal },
          { messages: { invalid: copy.api.spellInvalid, network: copy.api.network } }
        );

        if (!isCurrent() || reply.kind === "aborted") {
          return;
        }

        spellRunRef.current = null;

        if (reply.kind === "error") {
          dispatch({ type: "spell/failed", message: reply.message });
        } else if (reply.checkedBlocks === 0) {
          dispatch({ type: "spell/failed", message: copy.edits.spellEmpty });
        } else {
          const live = getDocument() ?? document;
          const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

          dispatch({
            type: "spell/completed",
            // Built against the text that was checked; the store then moves each finding to where its word is now.
            items: buildSpellItems(filterFindingsByDictionary(reply.findings, words, locale), document, runId),
            warnings: reply.failures,
            ...withContext(live)
          });
        }

        saveNow();
      } catch (error) {
        if (isCurrent()) {
          spellRunRef.current = null;
          dispatch({ type: "spell/failed", message: describeUnexpected(error, copy.edits.unexpected) });
        }
      }
    })();

    return true;
  }, [dispatch, withContext]);

  const stopRun = useCallback(() => {
    const { locale, copy, notify, saveNow } = optionsRef.current;
    const record = stateRef.current.activeRun;
    const passId = selectRunningRunId(stateRef.current);

    stopLocalRun();

    if (record) {
      releaseReviewRunPollLease(record.run.runId, tabIdRef.current);
      void cancelReviewRun({ runId: record.run.runId, capability: record.capability, locale }, apiDeps()).then((reply) => {
        if (reply.kind === "error") {
          notify("error", `${copy.edits.stopFailed} ${reply.message}`);
        }
      });
    }

    if (passId) {
      dispatch({ type: "run/stopped", passId });
      saveNow();
    }
  }, [apiDeps, dispatch, stopLocalRun]);

  const reset = useCallback(() => {
    const { locale } = optionsRef.current;
    const record = stateRef.current.activeRun;

    stopLocalRun();

    if (record) {
      releaseReviewRunPollLease(record.run.runId, tabIdRef.current);
      void cancelReviewRun({ runId: record.run.runId, capability: record.capability, locale }, apiDeps());
    }

    if (spellRunRef.current) {
      spellRunRef.current.controller.abort();
      spellRunRef.current = null;
    }

    fragmentRunRef.current?.controller.abort();
    fragmentRunRef.current = null;
    prepareRequestsRef.current.clear();
    diffCacheRef.current.clear();
    stopVisualRuns();
    setStudioTarget(null);
    dispatch({ type: "reset" });
  }, [apiDeps, dispatch, stopLocalRun, stopVisualRuns]);

  const reconcile = useCallback(
    (document: EditorDocument) => {
      if (stateRef.current.items.length > 0) {
        dispatch({ type: "items/reconciled", ...withContext(document) });
      }
    },
    [dispatch, withContext]
  );

  /**
   * Starts a run through the review endpoint: a pass, a step of `Огляд`, or the chapter request. All of
   * them share one lifecycle (start, stream, stop, fail, resume after a reload) and one slot: the server
   * runs one at a time.
   */
  const launchRun = useCallback(
    (passId: V2RunId, launch: LaunchOptions = {}): boolean => {
      const { locale, copy, saveNow, getDocument, canWrite, notify } = optionsRef.current;
      const stepId = getRunStepId(passId);

      if (!stepId) {
        return false;
      }

      if (!canWrite()) {
        notify("error", copy.edits.writeBlocked);
        return false;
      }

      if (selectRunningRunId(stateRef.current) || runTokenRef.current) {
        notify("error", copy.edits.anotherRun, undefined, "run");
        return false;
      }

      const document = saveNow() ?? getDocument();

      if (!document || getDocumentTextStats(document).words === 0) {
        dispatch({ type: "run/failed", passId, message: copy.edits.emptyDocument });
        return true;
      }

      // The run is being started: "another run is in flight" is no longer true.
      optionsRef.current.resolveToast("run");

      const runMode: EditorialStepRunMode = launch.runMode ?? "replace";
      const { overview } = stateRef.current;
      const request = buildReviewRunRequest({
        document,
        settings: readEditorSettingsReadOnly(window.localStorage, locale),
        locale,
        stepId,
        runMode,
        rejectedIdeas: stateRef.current.rejectedIdeas,
        // Once the chapter has been read, later runs get the report as context, as in the classic editor.
        expertise: overview.diagnostics?.text,
        diagnosticsMode: overview.diagnosticsMode,
        instruction: launch.instruction,
        planAction: launch.planAction
      });
      const token = {};
      runTokenRef.current = token;
      dispatch({ type: "run/requested", passId, ...(launch.planAction ? { retryIndex: launch.planAction.index } : {}) });

      void (async () => {
        let started: { runId: string; capability: string } | null = null;

        try {
        const reply = await withReviewRunStartLock(locale, () => startReviewRun(request, apiDeps()));

        if (runTokenRef.current !== token) {
          // Stopped while the server was starting the run: do not leave it working.
          if (reply.kind === "run") {
            void cancelReviewRun({ runId: reply.run.runId, capability: reply.capability, locale }, apiDeps());
          }

          return;
        }

        if (reply.kind === "error") {
          runTokenRef.current = null;
          dispatch({ type: "run/failed", passId, message: reply.message });
          saveNow();
          return;
        }

        if (reply.kind === "result") {
          runTokenRef.current = null;
          dispatch({
            type: "run/started",
            passId,
            runMode,
            record: createPersistedActiveReviewRun(reply.run, "completed", false, document.blocks.map((block) => block.id))
          });
          completeRun(passId, reply.run, reply.result, runMode);
          return;
        }

        started = { runId: reply.run.runId, capability: reply.capability };

        const record = createPersistedActiveReviewRun(
          reply.run,
          reply.capability,
          false,
          document.blocks.map((block) => block.id),
          reply.itemCursor
        );
        dispatch({ type: "run/started", passId, runMode, record });

        if (reply.items.length > 0) {
          const live = getDocument() ?? document;
          dispatch({ type: "run/snapshot", passId, record, items: reply.items, ...withContext(live) });
        }

        // The run reference must be on disk before anything else, so a reload can pick the run up.
        saveNow();
        await driveRun(passId, stateRef.current.activeRun ?? record, token);
        } catch (error) {
          abandonRun(passId, token, error, started);
        }
      })();

      return true;
    },
    [abandonRun, apiDeps, completeRun, dispatch, driveRun, withContext]
  );

  const runPass = useCallback(
    (passId: V2PassId): boolean => (passId === "spell" ? runSpell() : launchRun(passId)),
    [launchRun, runSpell]
  );

  /** A launcher outside the pass rows: it never jumps a launch queue that is being worked through. */
  const launchWhenFree = useCallback(
    (passId: V2RunId, launch?: LaunchOptions): boolean => {
      const { copy, notify, canWrite } = optionsRef.current;

      if (!canWrite()) {
        notify("error", copy.edits.writeBlocked);
        return false;
      }

      if (selectReviewBusy(stateRef.current) || runTokenRef.current) {
        notify("error", copy.edits.anotherRun, undefined, "run");
        return false;
      }

      return launchRun(passId, launch);
    },
    [launchRun]
  );

  const runStep = useCallback((runId: "diagnostics" | "fact_check"): boolean => launchWhenFree(runId), [launchWhenFree]);

  const setDiagnosticsMode = useCallback((mode: DiagnosticsMode) => dispatch({ type: "overview/modeSet", mode }), [dispatch]);

  const describeBlocks = useCallback((document: EditorDocument, blockIds: string[]) => {
    return createBlocksWhereLabel(document, optionsRef.current.copy.edits)(blockIds);
  }, []);

  const runChapterRequest = useCallback(
    (text: string): boolean => {
      const { copy, notify, canWrite } = optionsRef.current;
      const instruction = normalizeInstruction(text);

      if (!instruction) {
        return false;
      }

      if (!canWrite()) {
        notify("error", copy.edits.writeBlocked);
        return false;
      }

      if (selectReviewBusy(stateRef.current) || runTokenRef.current) {
        notify("error", copy.edits.anotherRun, undefined, "run");
        return false;
      }

      const entry: V2RequestEntry = {
        id: createLocalId("request"),
        scope: "chapter",
        text: instruction,
        at: new Date().toISOString(),
        outcome: { kind: "running" }
      };

      // The entry is written first: whatever happens to the run, the history says what was asked.
      dispatch({ type: "request/logged", entry, role: "chapter", instruction });

      if (!launchRun("request", { instruction })) {
        dispatch({ type: "request/settled", entryId: entry.id, outcome: { kind: "error", message: copy.edits.anotherRun } });
        return false;
      }

      return true;
    },
    [dispatch, launchRun]
  );

  const retryRequestAction = useCallback(
    (index: number) => {
      const { copy, notify, getDocument } = optionsRef.current;
      // Always the instruction the plan was made for, whatever has been typed or sent since.
      const { plan, planInstruction: instruction, holes } = stateRef.current.request;
      const action = plan?.[index];
      const document = getDocument();

      if (!action || !instruction.trim() || !holes.some((hole) => hole.index === index) || !document?.blocks.some((block) => block.id === action.blockId)) {
        notify("error", copy.ask.retryUnavailable, undefined, "run");
        return;
      }

      launchWhenFree("request", { runMode: "preserve", instruction, planAction: { ...action, index } });
    },
    [launchWhenFree]
  );

  const prepareItemAsync = useCallback(
    async (itemId: string, instruction?: string): Promise<PrepareOutcome> => {
      const { locale, copy, getDocument, canWrite, notify } = optionsRef.current;
      const current = stateRef.current;
      const item = current.items.find((entry) => entry.id === itemId);

      if (!item || !isOpenItem(item) || current.proposals[itemId]?.status === "preparing") {
        return { kind: "skipped" };
      }

      if (!canWrite()) {
        notify("error", copy.edits.writeBlocked);
        return { kind: "skipped" };
      }

      const document = getDocument();

      if (!document) {
        return { kind: "skipped" };
      }

      const requestItem = refreshItemAnchor(item, document);

      if (!requestItem) {
        dispatch({ type: "proposal/requested", item });
        dispatch({ type: "proposal/failed", itemId, message: copy.edits.staleGone, stale: true });
        return { kind: "failed", message: copy.edits.staleGone };
      }

      if (item.status !== "stale" && requestItem.anchor.fingerprint !== item.anchor.fingerprint) {
        // The text under the suggestion changed since the last save; it is stale, not preparable as is.
        dispatch({ type: "items/reconciled", ...withContext(document) });
        return { kind: "failed", message: copy.edits.stale };
      }

      const requestId = (prepareCounterRef.current += 1);
      const controller = new AbortController();
      prepareRequestsRef.current.set(itemId, requestId);
      prepareControllersRef.current.set(itemId, controller);
      dispatch({ type: "proposal/requested", item: { ...requestItem, status: item.status === "stale" ? "pending" : item.status } });

      const fail = (message: string, stale = false): PrepareOutcome => {
        dispatch({ type: "proposal/failed", itemId, message, ...(stale ? { stale: true } : {}) });
        return { kind: "failed", message };
      };

      try {
        // A suggestion made for a flagged claim is prepared with the classic editor's own instruction for it.
        const editorialInstruction = [buildFactCheckActionInstruction(locale, requestItem), instruction?.trim()]
          .filter((value): value is string => Boolean(value && value.trim()))
          .join("\n\n");
        const reply = await prepareProposal(
          buildProposalRequest({
            document,
            item: requestItem,
            settings: readEditorSettingsReadOnly(window.localStorage, locale),
            locale,
            editorialInstruction: editorialInstruction || undefined
          }),
          { ...apiDeps(), signal: controller.signal }
        );

        if (prepareRequestsRef.current.get(itemId) !== requestId) {
          return { kind: "cancelled" };
        }

        prepareRequestsRef.current.delete(itemId);
        prepareControllersRef.current.delete(itemId);

        if (reply.kind === "error") {
          return fail(reply.message);
        }

        if (reply.kind === "stale_anchor") {
          return fail(reply.message, true);
        }

        const kind = getItemKind(requestItem);
        const live = getDocument();

        if (!live || computeAnchorFingerprint(live, requestItem.anchor.blockIds) !== requestItem.anchor.fingerprint) {
          // Edited while the model was answering: the answer is for text that is no longer there.
          return fail(copy.edits.stale, true);
        }

        if (reply.kind === "draft") {
          const { proposal } = reply;

          if (kind === "callout" && proposal.kind === "callout_prompt" && proposal.calloutDraft) {
            if (!proposal.calloutDraft.previewText?.trim()) {
              return fail(copy.edits.calloutEmpty);
            }

            dispatch({ type: "draft/ready", itemId, proposal });
            return { kind: "ready" };
          }

          if (kind === "heading" && proposal.kind === "subsection_prompt" && proposal.subsectionDraft?.title?.trim()) {
            dispatch({ type: "draft/ready", itemId, proposal });
            return { kind: "ready" };
          }

          return fail(copy.edits.proposalUnsupported);
        }

        if (kind !== "replace") {
          // A rewrite came back for a suggestion that inserts a block: not something this card can show.
          return fail(copy.edits.proposalUnsupported);
        }

        dispatch({ type: "proposal/ready", itemId, proposal: reply.proposal });
        return { kind: "ready" };
      } catch (error) {
        // Never leave the card "preparing": show what went wrong.
        if (prepareRequestsRef.current.get(itemId) !== requestId) {
          return { kind: "cancelled" };
        }

        prepareRequestsRef.current.delete(itemId);
        prepareControllersRef.current.delete(itemId);
        return fail(describeUnexpected(error, copy.edits.unexpected));
      }
    },
    [apiDeps, dispatch, withContext]
  );

  const prepareItem = useCallback(
    (itemId: string, instruction?: string) => {
      void prepareItemAsync(itemId, instruction);
    },
    [prepareItemAsync]
  );

  /** Gives up on a preparation in flight; a late answer is ignored. */
  const cancelPreparation = useCallback(
    (itemId: string) => {
      prepareRequestsRef.current.delete(itemId);
      prepareControllersRef.current.get(itemId)?.abort();
      prepareControllersRef.current.delete(itemId);
      dispatch({ type: "proposal/cancelled", itemId });
    },
    [dispatch]
  );

  const focusItem = useCallback(
    (itemId: string | null, source: ReviewFocusSource = "card") => {
      setFocusSource(source);
      dispatch({ type: "focus/set", itemId });
    },
    [dispatch]
  );

  const showItem = useCallback(
    (itemId: string) => {
      focusItem(itemId, "card");

      const item = stateRef.current.items.find((entry) => entry.id === itemId);

      // What an illustration has to show is its studio.
      if (item && getItemKind(item) === "visual") {
        openStudio(itemId);
        return;
      }

      // Failed and stale suggestions have their own explicit retry buttons.
      if (
        stateRef.current.focusId === itemId &&
        item &&
        item.status === "pending" &&
        !stateRef.current.proposals[itemId] &&
        needsProposalCall(item) &&
        getItemKind(item) !== "visual"
      ) {
        prepareItem(itemId);
      }
    },
    [focusItem, openStudio, prepareItem]
  );

  const hoverItem = useCallback((itemId: string | null) => dispatch({ type: "hover/set", itemId }), [dispatch]);

  const acceptItem = useCallback(
    (itemId: string) => {
      const { locale, copy, getDocument, runCommand, notify, canWrite, isDiffDrawn } = optionsRef.current;
      const current = stateRef.current;
      const item = current.items.find((entry) => entry.id === itemId);

      if (!item || !canWrite()) {
        return;
      }

      if (getItemKind(item) !== "replace") {
        if (!canAcceptItem(current, itemId)) {
          return;
        }

        // Diff-first: the heading, callout, accent or spelling fix must be on screen at this very moment.
        if (!isDiffDrawn(itemId)) {
          notify("error", copy.edits.notDrawn, undefined, "accept");
          return;
        }

        const before = getDocument();
        const plan = before ? planAccept(item, before, { locale }) : null;

        if (!before || !plan || !runCommand(applyReviewEdits([plan.edit]))) {
          if (before) {
            dispatch({ type: "items/reconciled", ...withContext(before) });
          }

          notify("error", copy.edits.applyFailed, undefined, "accept");
          return;
        }

        runCommand(sealHistory);

        const after = getDocument();
        dispatch({
          type: "item/accepted",
          itemId,
          appliedFingerprint: after ? computeAnchorFingerprint(after, item.anchor.blockIds) : "",
          insertedBlockIds: plan.insertedBlockIds,
          at: new Date().toISOString()
        });

        if (after) {
          // Other suggestions in the same block are re-read at once, not on the next save.
          dispatch({ type: "items/reconciled", ...withContext(after) });
        }

        notify("info", copy.edits.accepted);
        return;
      }

      const proposal = current.proposals[itemId];

      if (!canApplyProposal(current, itemId) || proposal?.status !== "ready" || !proposal.proposal.textDiff) {
        return;
      }

      // Diff-first: nothing is applied that is not on screen as a diff at this very moment.
      if (current.focusId !== itemId || !isDiffDrawn(itemId)) {
        notify("error", copy.edits.acceptNeedsDiff, undefined, "accept");
        return;
      }

      const { blockIds, newBlocks } = proposal.proposal.textDiff;
      const before = getDocument();

      if (!before || computeAnchorFingerprint(before, item.anchor.blockIds) !== item.anchor.fingerprint) {
        if (before) {
          dispatch({ type: "items/reconciled", ...withContext(before) });
        }

        notify("error", copy.edits.applyFailed, undefined, "accept");
        return;
      }

      // Ids are settled here, so the decision knows exactly which blocks stand in the text afterwards.
      const resolved = resolveReplacementBlocks(blockIds, newBlocks);

      if (!runCommand(replaceAnchoredBlocks(blockIds, resolved, { resolved: true }))) {
        notify("error", copy.edits.applyFailed, undefined, "accept");
        return;
      }

      runCommand(sealHistory);

      const after = getDocument();
      const appliedBlockIds = resolved.map((block) => block.id);
      dispatch({
        type: "item/accepted",
        itemId,
        appliedFingerprint: after ? computeAnchorFingerprint(after, appliedBlockIds) : "",
        appliedBlockIds,
        at: new Date().toISOString()
      });

      if (after) {
        dispatch({ type: "items/reconciled", ...withContext(after) });
      }

      notify("info", copy.edits.accepted);
    },
    [dispatch, withContext]
  );

  const acceptAll = useCallback(() => {
    const { locale, copy, getDocument, runCommand, notify, canWrite, getDrawnIds } = optionsRef.current;

    if (!canWrite()) {
      return;
    }

    const before = getDocument();
    // Only what the manuscript shows right now; anything else stays in the queue.
    const candidates = selectBulkCandidates(stateRef.current, getDrawnIds());

    if (!before || candidates.length === 0) {
      return;
    }

    const { plans } = planBulkAccept(candidates, before, { locale });

    if (plans.length === 0 || !runCommand(applyReviewEdits(plans.map((plan) => plan.edit)))) {
      dispatch({ type: "items/reconciled", ...withContext(before) });
      notify("error", copy.edits.bulkFailed, undefined, "accept");
      return;
    }

    runCommand(sealHistory);

    const after = getDocument();
    const byId = new Map(candidates.map((item) => [item.id, item]));
    dispatch({
      type: "items/accepted",
      at: new Date().toISOString(),
      entries: plans.map((plan) => ({
        itemId: plan.itemId,
        appliedFingerprint: after ? computeAnchorFingerprint(after, byId.get(plan.itemId)!.anchor.blockIds) : "",
        insertedBlockIds: plan.insertedBlockIds
      }))
    });

    if (after) {
      dispatch({ type: "items/reconciled", ...withContext(after) });
    }

    notify("info", copy.edits.bulkAccepted(plans.length));
  }, [dispatch, withContext]);

  const rejectItem = useCallback(
    (itemId: string) => {
      const { copy, notify } = optionsRef.current;
      const item = stateRef.current.items.find((entry) => entry.id === itemId);

      if (!item || !isOpenItem(item)) {
        return;
      }

      // A preparation in flight is given up: its answer is not waited for, and whoever waits for it (a
      // request about a fragment) is told at once that it was cancelled.
      prepareRequestsRef.current.delete(itemId);
      prepareControllersRef.current.get(itemId)?.abort();
      prepareControllersRef.current.delete(itemId);

      if (item.studio) {
        // Nothing of a rejected illustration stays in flight: a restored one is simply not generating.
        cancelVisualPrompt(itemId);
        cancelVisualGeneration(itemId);
      }

      dispatch({ type: "item/rejected", itemId, at: new Date().toISOString() });
      // A mistaken rejection can be taken back while this message is on screen.
      notify("info", item.spell ? copy.edits.ignored : copy.edits.rejected, {
        label: copy.edits.restore,
        run: () => {
          setFocusSource("card");
          dispatch({ type: "item/restored", itemId });
        }
      });
    },
    [cancelVisualGeneration, cancelVisualPrompt, dispatch]
  );

  const runAll = useCallback(() => {
    const { canWrite, copy, notify, livePasses } = optionsRef.current;

    if (!canWrite()) {
      notify("error", copy.edits.writeBlocked);
      return;
    }

    const plan = planRunAll(stateRef.current, livePasses);

    if (plan.spell) {
      runSpell();
    }

    // The effect below starts the first one; each next starts when the run before it ends, however it ends.
    dispatch({ type: "queue/set", passIds: [...stateRef.current.queue, ...plan.queue] });
  }, [dispatch, runSpell]);

  const stopAll = useCallback(() => {
    dispatch({ type: "queue/cleared" });
    stopRun();
    stopSpell();
  }, [dispatch, stopRun, stopSpell]);

  const resumeQueue = useCallback(() => {
    const { canWrite, copy, notify } = optionsRef.current;

    if (!canWrite()) {
      notify("error", copy.edits.writeBlocked);
      return;
    }

    dispatch({ type: "queue/resumed" });
  }, [dispatch]);

  const clearQueue = useCallback(() => dispatch({ type: "queue/cleared" }), [dispatch]);

  const stopPass = useCallback(
    (passId: V2PassId) => {
      if (passId === "spell") {
        stopSpell();
      } else if (stateRef.current.queue.includes(passId)) {
        dispatch({ type: "queue/removed", passId });
      } else if (selectRunningPassId(stateRef.current) === passId) {
        stopRun();
      }
    },
    [dispatch, stopRun, stopSpell]
  );

  const editHeading = useCallback(
    (itemId: string, change: { title?: string; headingLevel?: 2 | 3 }) => dispatch({ type: "item/headingEdited", itemId, ...change }),
    [dispatch]
  );

  const setCalloutOptions = useCallback(
    (itemId: string, change: { calloutKind?: EditorialCalloutKind; calloutDepth?: EditorialCalloutDepth }) => {
      const item = stateRef.current.items.find((entry) => entry.id === itemId);

      if (!item) {
        return;
      }

      const hadDraft = hasCalloutDraft(item);
      dispatch({ type: "item/calloutOptions", itemId, ...change });

      const next = stateRef.current.items.find((entry) => entry.id === itemId);

      // The old draft was written for another kind or depth; choosing a new one on the card asks for a new draft.
      if (hadDraft && next && !hasCalloutDraft(next)) {
        prepareItem(itemId);
      }
    },
    [dispatch, prepareItem]
  );

  const chooseSuggestion = useCallback((itemId: string, choice: number) => dispatch({ type: "spell/choice", itemId, choice }), [dispatch]);

  const addToDictionary = useCallback(
    (itemId: string) => {
      const { locale, copy, notify } = optionsRef.current;
      const word = stateRef.current.items.find((entry) => entry.id === itemId)?.spell?.badText;

      if (!word) {
        return;
      }

      void (async () => {
        try {
          await addSpellcheckDictionaryWord(word, locale);

          // The helper is silent when the browser has no storage for it; make sure the word is really there.
          if (!isSpellcheckWordInDictionary(word, await readSpellcheckDictionaryWords(locale), locale)) {
            notify("error", copy.edits.dictionaryFailed);
            return;
          }

          dispatch({ type: "spell/removed", itemIds: selectSpellItemsInDictionary(stateRef.current.items, [word], locale) });
          notify("info", copy.edits.dictionaryAdded(word));
        } catch (error) {
          notify("error", describeUnexpected(error, copy.edits.dictionaryFailed));
        }
      })();
    },
    [dispatch]
  );

  const setQuiet = useCallback(
    (quiet: boolean) => {
      dispatch({ type: "quiet/set", quiet });

      if (quiet) {
        // The one mode that calls the model without a click on a card says so when it is switched on.
        optionsRef.current.notify("info", optionsRef.current.copy.edits.quietNote);
      }
    },
    [dispatch]
  );

  const moveFocus = useCallback(
    (delta: 1 | -1) => {
      setFocusSource("card");
      dispatch({ type: "focus/moved", delta });
    },
    [dispatch]
  );

  const confirmFocused = useCallback(() => {
    const { copy, notify, isDiffDrawn } = optionsRef.current;
    const current = stateRef.current;
    const itemId = current.focusId;
    const item = itemId ? current.items.find((entry) => entry.id === itemId) : undefined;

    if (!itemId || !item || !isOpenItem(item)) {
      return;
    }

    if (getItemKind(item) === "visual") {
      // An illustration is never accepted from the keyboard: Enter opens its studio, where the image is seen.
      openStudio(itemId);
      return;
    }

    if (canAcceptItem(current, itemId) && isDiffDrawn(itemId)) {
      acceptItem(itemId);
      return;
    }

    const proposal = current.proposals[itemId];

    if (proposal?.status === "preparing" || item.status === "stale") {
      return;
    }

    // Not prepared (or the last attempt failed): Enter asks to see the change, it never applies one unseen.
    if (needsProposalCall(item) && proposal?.status !== "ready") {
      prepareItem(itemId, (current.instructions[itemId] ?? "").trim() || undefined);
      return;
    }

    notify("error", copy.edits.notDrawn, undefined, "accept");
  }, [acceptItem, openStudio, prepareItem]);

  const setFilter = useCallback((filter: V2ReviewFilter) => dispatch({ type: "filter/set", filter }), [dispatch]);

  const revealItem = useCallback(
    (itemId: string) => {
      const item = stateRef.current.items.find((entry) => entry.id === itemId);

      if (!item || !isOpenItem(item)) {
        return;
      }

      if (stateRef.current.filter !== "all" && getItemPassId(item) !== stateRef.current.filter) {
        dispatch({ type: "filter/set", filter: "all" });
      }

      focusItem(itemId, "card");
    },
    [dispatch, focusItem]
  );

  const addAuthorQuery = useCallback(
    (findingId: string) => {
      const finding = stateRef.current.overview.factCheck?.findings.find((entry) => entry.id === findingId);

      if (!finding) {
        return;
      }

      dispatch({ type: "author/added", query: createAuthorQuery(finding, new Date().toISOString(), createLocalId("author")) });
      optionsRef.current.notify("info", optionsRef.current.copy.overview.authorAdded);
    },
    [dispatch]
  );

  const setAuthorQueryNote = useCallback((id: string, note: string) => dispatch({ type: "author/noteSet", id, note }), [dispatch]);
  const removeAuthorQuery = useCallback((id: string) => dispatch({ type: "author/removed", id }), [dispatch]);

  /**
   * One request about a fragment, start to finish. The router is asked first (it only reads the words and
   * calls no model), then the executor it named is called once. Whatever comes back is put into the queue;
   * a failure is written into the request history with the server's own words.
   */
  const executeFragment = useCallback(
    async (input: {
      run: FragmentRun;
      action: FragmentActionId;
      scope: FragmentScope;
      prompt?: string;
      choice?: LocalActionClarifyChoice;
      label: string;
      document: EditorDocument;
    }) => {
      const { run, action, scope, label, document } = input;
      const { locale, copy, getDocument, saveNow, notify, onShowQueue } = optionsRef.current;
      const isCurrent = () => fragmentRunRef.current === run;
      const settle = (outcome: V2RequestOutcome) => {
        if (isCurrent()) {
          fragmentRunRef.current = null;
        }

        dispatch({ type: "request/settled", entryId: run.entryId, outcome });

        if (outcome.kind === "done") {
          // A request for a fragment went through: an error shown for an earlier one is no longer news.
          optionsRef.current.resolveToast("fragment");
        }
      };
      const fail = (message: string) => {
        settle({ kind: "error", message });
        notify("error", `${copy.ask.failed} ${message}`, undefined, "fragment");
      };
      const show = (itemIds: string[]) => {
        const first = itemIds[0];

        if (first) {
          revealItem(first);
        }

        saveNow();
        onShowQueue();
      };

      try {
        const routed = await requestLocalAction(
          buildLocalActionRequest({
            action,
            prompt: input.prompt,
            locale,
            choice: input.choice,
            visualStylePreset: resolveStudioDefaults({ prefs: stateRef.current.visualPrefs }).style
          }),
          {
            messages: fragmentMessages(),
            signal: run.controller.signal
          }
        );

        if (!isCurrent() || routed.kind === "aborted") {
          return;
        }

        if (routed.kind === "error") {
          fail(routed.message);
          return;
        }

        const execution = planFragmentExecution(routed.route);

        if (isRewriteExecution(execution) && findUnrewritableBlocks(document, scope.blockIds).length > 0) {
          // A rewrite replaces the whole scope; with an image or a table inside it would delete them.
          fail(copy.ask.scopeNotText);
          return;
        }

        if (execution.kind === "clarify") {
          // Not guessed: the editor is asked, and until the answer nothing is sent anywhere.
          settle({ kind: "question" });
          dispatch({
            type: "clarify/set",
            clarify: { entryId: run.entryId, prompt: input.prompt ?? "", blockIds: scope.blockIds, quote: scope.quote, choices: execution.choices }
          });
          return;
        }

        if (execution.kind === "spellcheck") {
          let words: string[] = [];

          try {
            words = await readSpellcheckDictionaryWords(locale);
          } catch (error) {
            notify("error", describeUnexpected(error, copy.edits.dictionaryReadFailed));
          }

          const reply = await runSpellcheck(
            { document, locale, signal: run.controller.signal, blockIds: scope.blockIds },
            { messages: { invalid: copy.api.spellInvalid, network: copy.api.network } }
          );

          if (!isCurrent() || reply.kind === "aborted") {
            return;
          }

          if (reply.kind === "error") {
            fail(reply.message);
            return;
          }

          if (reply.checkedBlocks === 0) {
            fail(copy.edits.spellEmpty);
            return;
          }

          const live = getDocument() ?? document;
          // Only the blocks whose batch answered are touched; a batch that failed is reported, not passed over.
          const merge = planSpellMerge(scope.blockIds, reply);
          const scopeIds = new Set(merge.blockIds);

          dispatch({
            type: "spell/merged",
            items: buildSpellItems(filterFindingsByDictionary(reply.findings, words, locale), document, createLocalId("frag")),
            blockIds: merge.blockIds,
            ...withContext(live)
          });

          const found = stateRef.current.items.filter((item) => item.spell && isOpenItem(item) && scopeIds.has(item.anchor.blockIds[0] ?? ""));
          settle({ kind: "done", count: found.length, ...(merge.warnings.length > 0 ? { warnings: merge.warnings } : {}) });
          show(found.map((item) => item.id));

          if (merge.warnings.length > 0) {
            notify("error", `${copy.ask.spellPartial(reply.failures.length)} ${merge.warnings.join(" · ")}`, undefined, "fragment");
          }

          return;
        }

        if (execution.kind === "patch") {
          const reply = await requestPatch(
            buildPatchRequest({
              document,
              blockIds: scope.blockIds,
              mode: execution.mode,
              prompt: execution.prompt,
              settings: readEditorSettingsReadOnly(window.localStorage, locale),
              locale
            }),
            { messages: { ...fragmentMessages(), invalid: copy.api.patchInvalid }, signal: run.controller.signal }
          );

          if (!isCurrent() || reply.kind === "aborted") {
            return;
          }

          if (reply.kind === "error") {
            fail(reply.message);
            return;
          }

          const live = getDocument();

          if (!live || computeAnchorFingerprint(live, scope.blockIds) !== computeAnchorFingerprint(document, scope.blockIds)) {
            // Edited while the model was answering: the answer is for text that is no longer there.
            fail(copy.edits.stale);
            return;
          }

          const context = withContext(live);
          const added: string[] = [];

          for (const operation of reply.operations) {
            const built = buildPatchItem({
              operation,
              document: live,
              revision: context.revision,
              textIntent: execution.textIntent,
              copy: { title: label, recommendation: execution.prompt?.trim() || label, reasonFallback: copy.ask.reasonFallback },
              itemId: createLocalId("local-item")
            });

            if (built.kind === "item") {
              dispatch({ type: "item/added", item: built.item, proposal: built.proposal, ...context });
              added.push(built.item.id);
            }
          }

          if (added.length === 0) {
            fail(copy.ask.patchUnusable);
            return;
          }

          settle({ kind: "done", count: added.length });
          show(added);
          return;
        }

        const live = getDocument() ?? document;
        const context = withContext(live);

        if (!isScopeIntact(scope, context.revision)) {
          fail(copy.ask.scopeGone);
          return;
        }

        const item: V2ReviewItem = buildFragmentManualItem({
          document: live,
          revision: context.revision,
          blockIds: scope.blockIds,
          recommendationType: execution.recommendationType,
          instruction: execution.instruction,
          calloutKind: execution.calloutKind,
          calloutDepth: execution.calloutDepth,
          visualIntent: execution.visualIntent,
          copy: { title: label, reason: copy.ask.manualReason(label) }
        });

        dispatch({ type: "item/added", item, ...context });

        if (execution.recommendationType === "visual") {
          // The card and the ghost figure are the result; the prompt is prepared when the studio is opened.
          settle({ kind: "done", count: 1 });
          show([item.id]);
          return;
        }

        run.itemId = item.id;
        const outcome = await prepareItemAsync(item.id, execution.instruction);

        // Null only when this run was replaced or cancelled by its own button, which settled it already.
        // A preparation given up from elsewhere (the card rejected mid-flight) ends the request as stopped.
        const settlement = resolvePrepareSettlement(outcome, isCurrent(), copy.edits.proposalFailed);

        if (!settlement) {
          return;
        }

        settle(settlement);

        if (settlement.kind !== "stopped") {
          // A failed card stays in the queue with the error and its own retry button.
          show([item.id]);
        }
      } catch (error) {
        if (isCurrent()) {
          fail(describeUnexpected(error, copy.edits.unexpected));
        }
      }
    },
    [dispatch, fragmentMessages, prepareItemAsync, revealItem, withContext]
  );

  const startFragment = useCallback(
    (input: { action: FragmentActionId; scope: FragmentScope; prompt?: string; choice?: LocalActionClarifyChoice; entryId?: string }): boolean => {
      const { copy, notify, canWrite, saveNow, getDocument } = optionsRef.current;
      const { action, scope } = input;
      const prompt = action === "custom" ? normalizeInstruction(input.prompt ?? "") : null;

      if (action === "custom" && !prompt) {
        return false;
      }

      if (!canWrite()) {
        notify("error", copy.edits.writeBlocked);
        return false;
      }

      if (fragmentRunRef.current) {
        notify("error", copy.ask.fragmentBusy);
        return false;
      }

      const document = saveNow() ?? getDocument();

      if (!document || !isScopeIntact(scope, deriveManuscriptRevisionState(document))) {
        notify("error", copy.ask.scopeGone);
        return false;
      }

      const label = action === "custom" ? prompt! : copy.ask.quick[action];
      const run: FragmentRun = { controller: new AbortController(), entryId: input.entryId ?? createLocalId("request") };
      fragmentRunRef.current = run;
      dispatch({
        type: "request/logged",
        role: "fragment",
        label: action === "custom" ? copy.ask.customTitle : label,
        entry: {
          id: run.entryId,
          scope: "fragment",
          text: label,
          quote: shortenQuote(scope.quote, 90),
          where: describeBlocks(document, scope.blockIds),
          at: new Date().toISOString(),
          outcome: { kind: "running" }
        }
      });

      void executeFragment({
        run,
        action,
        scope,
        prompt: prompt ?? undefined,
        choice: input.choice,
        label: action === "custom" ? copy.ask.customTitle : label,
        document
      });
      return true;
    },
    [describeBlocks, dispatch, executeFragment]
  );

  const runFragmentAction = useCallback(
    (action: FragmentActionId, scope: FragmentScope, prompt?: string) => startFragment({ action, scope, prompt }),
    [startFragment]
  );

  const cancelFragment = useCallback(() => {
    const run = fragmentRunRef.current;

    if (!run) {
      return;
    }

    fragmentRunRef.current = null;
    run.controller.abort();

    if (run.itemId) {
      cancelPreparation(run.itemId);
    }

    dispatch({ type: "request/settled", entryId: run.entryId, outcome: { kind: "stopped" } });
  }, [cancelPreparation, dispatch]);

  const answerClarify = useCallback(
    (choice: LocalActionClarifyChoice) => {
      const question = stateRef.current.request.clarify;

      if (question) {
        startFragment({
          action: "custom",
          scope: { blockIds: question.blockIds, quote: question.quote },
          prompt: question.prompt,
          choice,
          entryId: question.entryId
        });
      }
    },
    [startFragment]
  );

  const dismissClarify = useCallback(() => {
    const question = stateRef.current.request.clarify;

    if (question) {
      dispatch({ type: "request/settled", entryId: question.entryId, outcome: { kind: "stopped" } });
      dispatch({ type: "clarify/set", clarify: null });
    }
  }, [dispatch]);
  const setInstruction = useCallback((itemId: string, text: string) => dispatch({ type: "instruction/set", itemId, text }), [dispatch]);
  const getPersisted = useCallback(() => serializeReviewState(stateRef.current), []);

  // Leaving the page must not cancel the run on the server: a reload resumes it from the saved reference.
  useEffect(
    () => () => {
      const record = stateRef.current.activeRun;
      stopLocalRun();

      if (record) {
        releaseReviewRunPollLease(record.run.runId, tabIdRef.current);
      }

      spellRunRef.current?.controller.abort();
      spellRunRef.current = null;
      fragmentRunRef.current?.controller.abort();
      fragmentRunRef.current = null;
      // A request in flight is let go of; the saved draft already says the generation was interrupted.
      stopVisualRuns();
    },
    [stopLocalRun, stopVisualRuns]
  );

  // The studio closes by itself when the illustration it was open for is no longer there to work on.
  useEffect(() => {
    if (studioTarget?.kind !== "item") {
      return;
    }

    const item = state.items.find((entry) => entry.id === studioTarget.itemId);

    if (!item || !item.studio || !isStudioItem(item)) {
      setStudioTarget(null);
    }
  }, [state.items, studioTarget]);

  // `Запустити всі`: the next queued pass starts as soon as no review run is in flight.
  useEffect(() => {
    const next = selectNextQueuedPass(state);

    if (!next || runTokenRef.current || leaseTimerRef.current !== null) {
      return;
    }

    if (!runPass(next)) {
      // Nothing can be started right now (the draft cannot be saved); do not keep trying.
      dispatch({ type: "queue/cleared" });
    }
  }, [dispatch, runPass, state]);

  // Quiet mode, and only quiet mode, prepares on its own: the current item and the next one, once the
  // current item has stayed current for a moment, and never more than two requests at a time.
  const prepareForQuiet = useCallback(() => {
    const current = stateRef.current;
    const auto = autoPreparingRef.current;

    for (const itemId of auto) {
      if (current.proposals[itemId]?.status !== "preparing") {
        auto.delete(itemId);
      }
    }

    if (!current.quiet || !optionsRef.current.canWrite()) {
      return;
    }

    const targets = planQuietPreparation(current, {
      focusedSince: quietFocusRef.current.itemId === current.focusId ? quietFocusRef.current.since : null,
      now: Date.now(),
      autoInFlight: auto.size
    });

    for (const itemId of targets) {
      auto.add(itemId);
      prepareItem(itemId);
    }
  }, [prepareItem]);

  const quietFocusId = state.quiet ? state.focusId : null;

  useEffect(() => {
    quietFocusRef.current = { itemId: quietFocusId, since: quietFocusId ? Date.now() : null };

    if (!quietFocusId) {
      return;
    }

    const timer = window.setTimeout(prepareForQuiet, QUIET_DWELL_MS + 20);
    return () => window.clearTimeout(timer);
  }, [prepareForQuiet, quietFocusId]);

  // A finished request frees room for the next one the current item is still waiting for.
  useEffect(() => {
    if (state.quiet && autoPreparingRef.current.size > 0) {
      prepareForQuiet();
    }
  }, [prepareForQuiet, state]);

  const { locale, copy } = options;

  const marks = useMemo<ReviewMark[]>(() => {
    const cache = diffCacheRef.current;
    const liveProposalIds = new Set<string>();
    const result = buildItemMarks(state, {
      locale,
      figure: {
        label: (intent) => copy.studio.ghostKind(copy.studio.intents[intent]),
        action: copy.edits.openStudio,
        notes: {
          preparing: copy.edits.visualPreparing,
          prompt_failed: copy.edits.visualPromptFailed,
          generating: copy.edits.visualGenerating,
          generation_failed: copy.edits.visualGenerationFailed,
          generated: copy.edits.visualReady,
          stale: copy.edits.visualStale
        }
      },
      getDiff: (item) => {
        const proposal = state.proposals[item.id];

        if (proposal?.status !== "ready" || !proposal.proposal.textDiff) {
          return undefined;
        }

        const { id } = proposal.proposal;
        const { blockIds, oldBlocks, newBlocks } = proposal.proposal.textDiff;
        liveProposalIds.add(id);
        let diff = cache.get(id);

        if (!diff) {
          diff = diffProposalBlocks(blockIds, oldBlocks, newBlocks);
          cache.set(id, diff);
        }

        return diff;
      }
    });

    for (const id of cache.keys()) {
      if (!liveProposalIds.has(id)) {
        cache.delete(id);
      }
    }

    return result;
  }, [copy, locale, state]);

  return {
    state,
    marks,
    focusSource,
    focusSequence,
    getPersisted,
    hydrate,
    reset,
    reconcile,
    runPass,
    runStep,
    setDiagnosticsMode,
    runChapterRequest,
    retryRequestAction,
    runFragmentAction,
    cancelFragment,
    answerClarify,
    dismissClarify,
    addAuthorQuery,
    setAuthorQueryNote,
    removeAuthorQuery,
    revealItem,
    stopRun,
    runAll,
    stopAll,
    resumeQueue,
    clearQueue,
    stopPass,
    acceptAll,
    editHeading,
    setCalloutOptions,
    chooseSuggestion,
    addToDictionary,
    setQuiet,
    moveFocus,
    confirmFocused,
    focusItem,
    showItem,
    hoverItem,
    prepareItem,
    acceptItem,
    rejectItem,
    setFilter,
    setInstruction,
    studioTarget,
    openStudio,
    openFigure,
    closeStudio,
    setStudioField,
    prepareVisualPrompt,
    cancelVisualPrompt,
    generateVisual,
    cancelVisualGeneration,
    insertVisual,
    replaceVisual,
    removeVisual,
    saveFigureCaption,
    readFigure,
    findFigureBlockId
  };
}
