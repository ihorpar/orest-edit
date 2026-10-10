"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Command } from "@tiptap/pm/state";
import { getDocumentTextStats, type EditorDocument } from "../../lib/editor/document-model";
import type { PersistedActiveReviewRun } from "../../lib/editor/draft-state";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import type {
  EditorialCalloutDepth,
  EditorialCalloutKind,
  EditorialReviewResponse,
  EditorialReviewRunSnapshot,
  EditorialStepRunMode
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
import type { AppLocale } from "../../lib/i18n/product-locale";
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
import { getItemKind, hasCalloutDraft, needsProposalCall } from "../../lib/v2/item-kinds";
import { buildItemMarks } from "../../lib/v2/item-marks";
import { applyReviewEdits, replaceAnchoredBlocks, resolveReplacementBlocks, sealHistory } from "../../lib/v2/review-apply";
import type { ReviewMark } from "../../lib/v2/review-marks";
import { buildSpellItems, filterFindingsByDictionary, selectSpellItemsInDictionary } from "../../lib/v2/spell-items";
import {
  canAcceptItem,
  canApplyProposal,
  planQuietPreparation,
  QUIET_DWELL_MS,
  createInitialReviewState,
  getPassIdForStep,
  isOpenItem,
  PASS_STEP_ID,
  planRunAll,
  reviewReducer,
  selectBulkCandidates,
  selectNextQueuedPass,
  selectRunningPassId,
  serializeReviewState,
  shouldPersistAfter,
  type V2PassId,
  type V2PersistedReview,
  type V2ReviewAction,
  type V2ReviewFilter,
  type V2ReviewState
} from "../../lib/v2/store";
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
  /** `action` adds one button to the message (taking a rejection back). */
  notify: (tone: "info" | "error", message: string, action?: { label: string; run: () => void }) => void;
}

export interface ReviewEngine {
  state: V2ReviewState;
  marks: ReviewMark[];
  focusSource: ReviewFocusSource;
  /** Latest state for saving; always current, also between renders. */
  getPersisted: () => V2PersistedReview;
  hydrate: (persisted: V2PersistedReview | null, document: EditorDocument) => void;
  reset: () => void;
  reconcile: (document: EditorDocument) => void;
  /** Starts a pass (a review run, or spellcheck). False when nothing was started and nothing changed. */
  runPass: (passId: V2PassId) => boolean;
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
}

function describeUnexpected(error: unknown, fallback: string): string {
  const detail = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  return detail ? `${fallback} ${detail}` : fallback;
}

function createTabId(): string {
  return `v2-tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function useReviewEngine(options: ReviewEngineOptions): ReviewEngine {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const stateRef = useRef<V2ReviewState>(createInitialReviewState());
  const [state, setState] = useState<V2ReviewState>(stateRef.current);
  const [focusSource, setFocusSource] = useState<ReviewFocusSource>("card");

  const tabIdRef = useRef<string>("");
  const runTokenRef = useRef<object | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const leaseTimerRef = useRef<number | null>(null);
  const spellRunRef = useRef<{ token: object; controller: AbortController } | null>(null);
  /** Items quiet mode asked to prepare on its own and that have not answered yet. */
  const autoPreparingRef = useRef(new Set<string>());
  const quietFocusRef = useRef<{ itemId: string | null; since: number | null }>({ itemId: null, since: null });
  const prepareRequestsRef = useRef(new Map<string, number>());
  const prepareCounterRef = useRef(0);
  const diffCacheRef = useRef(new Map<string, BlockDiff[]>());

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

  const withContext = useCallback((document: EditorDocument) => ({ document, revision: deriveManuscriptRevisionState(document) }), []);

  const clearLeaseTimer = useCallback(() => {
    if (leaseTimerRef.current !== null) {
      window.clearTimeout(leaseTimerRef.current);
      leaseTimerRef.current = null;
    }
  }, []);

  const completeRun = useCallback(
    (passId: V2PassId, run: EditorialReviewRunSnapshot, result: EditorialReviewResponse, runMode: EditorialStepRunMode) => {
      const { copy, getDocument, saveNow } = optionsRef.current;
      const problem = validateCompletedReviewResult(result, run, copy.api);

      if (problem || result.error) {
        dispatch({ type: "run/failed", passId, message: result.error?.trim() || problem || copy.api.resultInvalid });
        saveNow();
        return;
      }

      const document = getDocument();

      if (!document) {
        dispatch({ type: "run/failed", passId, message: copy.api.resultInvalid });
        return;
      }

      dispatch({
        type: "run/completed",
        passId,
        runMode,
        stepRunId: result.stepRunId,
        items: result.items,
        warnings: result.diagnostics.failedChunks?.map((chunk) => chunk.message),
        ...withContext(document)
      });
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
    (passId: V2PassId, token: object, error: unknown, reference: { runId: string; capability: string } | null) => {
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
    async (passId: V2PassId, record: PersistedActiveReviewRun, token: object) => {
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
    async (passId: V2PassId, record: PersistedActiveReviewRun, token: object) => {
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
      const passId = getPassIdForStep(record.run.stepId);
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

  const hydrate = useCallback(
    (persisted: V2PersistedReview | null, document: EditorDocument) => {
      stopLocalRun();
      prepareRequestsRef.current.clear();
      diffCacheRef.current.clear();
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
    [dispatch, resumeRun, stopLocalRun, withContext]
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
    const passId = selectRunningPassId(stateRef.current);

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

    prepareRequestsRef.current.clear();
    diffCacheRef.current.clear();
    dispatch({ type: "reset" });
  }, [apiDeps, dispatch, stopLocalRun]);

  const reconcile = useCallback(
    (document: EditorDocument) => {
      if (stateRef.current.items.length > 0) {
        dispatch({ type: "items/reconciled", ...withContext(document) });
      }
    },
    [dispatch, withContext]
  );

  const runPass = useCallback(
    (passId: V2PassId): boolean => {
      const { locale, copy, saveNow, getDocument, canWrite, notify } = optionsRef.current;

      if (passId === "spell") {
        return runSpell();
      }

      const stepId = PASS_STEP_ID[passId];

      if (!stepId) {
        return false;
      }

      if (!canWrite()) {
        notify("error", copy.edits.writeBlocked);
        return false;
      }

      if (selectRunningPassId(stateRef.current) || runTokenRef.current) {
        notify("error", copy.edits.anotherRun);
        return false;
      }

      const document = saveNow() ?? getDocument();

      if (!document || getDocumentTextStats(document).words === 0) {
        dispatch({ type: "run/failed", passId, message: copy.edits.emptyDocument });
        return true;
      }

      const runMode: EditorialStepRunMode = "replace";
      const request = buildReviewRunRequest({
        document,
        settings: readEditorSettingsReadOnly(window.localStorage, locale),
        locale,
        stepId,
        runMode,
        rejectedIdeas: stateRef.current.rejectedIdeas
      });
      const token = {};
      runTokenRef.current = token;
      dispatch({ type: "run/requested", passId });

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
    [abandonRun, apiDeps, completeRun, dispatch, driveRun, runSpell, withContext]
  );

  const prepareItem = useCallback(
    (itemId: string, instruction?: string) => {
      const { locale, copy, getDocument, canWrite, notify } = optionsRef.current;
      const current = stateRef.current;
      const item = current.items.find((entry) => entry.id === itemId);

      if (!item || !isOpenItem(item) || current.proposals[itemId]?.status === "preparing") {
        return;
      }

      if (!canWrite()) {
        notify("error", copy.edits.writeBlocked);
        return;
      }

      const document = getDocument();

      if (!document) {
        return;
      }

      const requestItem = refreshItemAnchor(item, document);

      if (!requestItem) {
        dispatch({ type: "proposal/requested", item });
        dispatch({ type: "proposal/failed", itemId, message: copy.edits.staleGone, stale: true });
        return;
      }

      if (item.status !== "stale" && requestItem.anchor.fingerprint !== item.anchor.fingerprint) {
        // The text under the suggestion changed since the last save; it is stale, not preparable as is.
        dispatch({ type: "items/reconciled", ...withContext(document) });
        return;
      }

      const requestId = (prepareCounterRef.current += 1);
      prepareRequestsRef.current.set(itemId, requestId);
      dispatch({ type: "proposal/requested", item: { ...requestItem, status: item.status === "stale" ? "pending" : item.status } });

      void (async () => {
        try {
        const reply = await prepareProposal(
          buildProposalRequest({
            document,
            item: requestItem,
            settings: readEditorSettingsReadOnly(window.localStorage, locale),
            locale,
            editorialInstruction: instruction
          }),
          apiDeps()
        );

        if (prepareRequestsRef.current.get(itemId) !== requestId) {
          return;
        }

        prepareRequestsRef.current.delete(itemId);

        if (reply.kind === "error") {
          dispatch({ type: "proposal/failed", itemId, message: reply.message });
          return;
        }

        if (reply.kind === "stale_anchor") {
          dispatch({ type: "proposal/failed", itemId, message: reply.message, stale: true });
          return;
        }

        const kind = getItemKind(requestItem);
        const live = getDocument();

        if (!live || computeAnchorFingerprint(live, requestItem.anchor.blockIds) !== requestItem.anchor.fingerprint) {
          // Edited while the model was answering: the answer is for text that is no longer there.
          dispatch({ type: "proposal/failed", itemId, message: copy.edits.stale, stale: true });
          return;
        }

        if (reply.kind === "draft") {
          const { proposal } = reply;

          if (kind === "callout" && proposal.kind === "callout_prompt" && proposal.calloutDraft) {
            if (!proposal.calloutDraft.previewText?.trim()) {
              dispatch({ type: "proposal/failed", itemId, message: copy.edits.calloutEmpty });
              return;
            }

            dispatch({ type: "draft/ready", itemId, proposal });
            return;
          }

          if (kind === "heading" && proposal.kind === "subsection_prompt" && proposal.subsectionDraft?.title?.trim()) {
            dispatch({ type: "draft/ready", itemId, proposal });
            return;
          }

          dispatch({ type: "proposal/failed", itemId, message: copy.edits.proposalUnsupported });
          return;
        }

        if (kind !== "replace") {
          // A rewrite came back for a suggestion that inserts a block: not something this card can show.
          dispatch({ type: "proposal/failed", itemId, message: copy.edits.proposalUnsupported });
          return;
        }

        dispatch({ type: "proposal/ready", itemId, proposal: reply.proposal });
        } catch (error) {
          // Never leave the card "preparing": show what went wrong.
          if (prepareRequestsRef.current.get(itemId) === requestId) {
            prepareRequestsRef.current.delete(itemId);
            dispatch({ type: "proposal/failed", itemId, message: describeUnexpected(error, copy.edits.unexpected) });
          }
        }
      })();
    },
    [apiDeps, dispatch, withContext]
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
    [focusItem, prepareItem]
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
          notify("error", copy.edits.notDrawn);
          return;
        }

        const before = getDocument();
        const plan = before ? planAccept(item, before, { locale }) : null;

        if (!before || !plan || !runCommand(applyReviewEdits([plan.edit]))) {
          if (before) {
            dispatch({ type: "items/reconciled", ...withContext(before) });
          }

          notify("error", copy.edits.applyFailed);
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
        notify("error", copy.edits.acceptNeedsDiff);
        return;
      }

      const { blockIds, newBlocks } = proposal.proposal.textDiff;
      const before = getDocument();

      if (!before || computeAnchorFingerprint(before, item.anchor.blockIds) !== item.anchor.fingerprint) {
        if (before) {
          dispatch({ type: "items/reconciled", ...withContext(before) });
        }

        notify("error", copy.edits.applyFailed);
        return;
      }

      // Ids are settled here, so the decision knows exactly which blocks stand in the text afterwards.
      const resolved = resolveReplacementBlocks(blockIds, newBlocks);

      if (!runCommand(replaceAnchoredBlocks(blockIds, resolved, { resolved: true }))) {
        notify("error", copy.edits.applyFailed);
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
      notify("error", copy.edits.bulkFailed);
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

      prepareRequestsRef.current.delete(itemId);
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
    [dispatch]
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

    if (canAcceptItem(current, itemId) && isDiffDrawn(itemId)) {
      acceptItem(itemId);
      return;
    }

    const proposal = current.proposals[itemId];

    if (proposal?.status === "preparing" || item.status === "stale" || getItemKind(item) === "visual") {
      return;
    }

    // Not prepared (or the last attempt failed): Enter asks to see the change, it never applies one unseen.
    if (needsProposalCall(item) && proposal?.status !== "ready") {
      prepareItem(itemId, (current.instructions[itemId] ?? "").trim() || undefined);
      return;
    }

    notify("error", copy.edits.notDrawn);
  }, [acceptItem, prepareItem]);

  const setFilter = useCallback((filter: V2ReviewFilter) => dispatch({ type: "filter/set", filter }), [dispatch]);
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
    },
    [stopLocalRun]
  );

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

  const { locale } = options;

  const marks = useMemo<ReviewMark[]>(() => {
    const cache = diffCacheRef.current;
    const liveProposalIds = new Set<string>();
    const result = buildItemMarks(state, {
      locale,
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
  }, [locale, state]);

  return {
    state,
    marks,
    focusSource,
    getPersisted,
    hydrate,
    reset,
    reconcile,
    runPass,
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
    setInstruction
  };
}
