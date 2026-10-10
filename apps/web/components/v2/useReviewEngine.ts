"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Command } from "@tiptap/pm/state";
import { getDocumentTextStats, type EditorDocument } from "../../lib/editor/document-model";
import type { PersistedActiveReviewRun } from "../../lib/editor/draft-state";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import type { EditorialReviewResponse, EditorialReviewRunSnapshot, EditorialStepRunMode } from "../../lib/editor/review-contract";
import { retainReviewRunProgress } from "../../lib/editor/review-run-merge";
import {
  createPersistedActiveReviewRun,
  isRunCompatibleWithEditor,
  isRunTerminal,
  releaseReviewRunPollLease,
  tryAcquireReviewRunPollLease,
  withReviewRunStartLock
} from "../../lib/editor/review-run-persistence";
import type { AppLocale } from "../../lib/i18n/product-locale";
import {
  buildProposalRequest,
  buildReviewRunRequest,
  cancelReviewRun,
  pollReviewRun,
  prepareProposal,
  readEditorSettingsReadOnly,
  refreshItemAnchor,
  startReviewRun,
  validateCompletedReviewResult,
  type ReviewApiDeps
} from "../../lib/v2/api";
import type { V2Copy } from "../../lib/v2/copy";
import { replaceAnchoredBlocks, sealHistory } from "../../lib/v2/review-apply";
import type { ReviewMark } from "../../lib/v2/review-marks";
import {
  canApplyProposal,
  createInitialReviewState,
  getItemPassId,
  getPassIdForStep,
  isOpenItem,
  PASS_STEP_ID,
  reviewReducer,
  selectQueue,
  selectRunningPassId,
  serializeReviewState,
  type V2PassId,
  type V2PersistedReview,
  type V2ReviewAction,
  type V2ReviewFilter,
  type V2ReviewState
} from "../../lib/v2/store";
import { diffProposalBlocks, type BlockDiff } from "../../lib/v2/word-diff";

const LEASE_RETRY_MS = 2_000;
/** Actions that change nothing worth saving. */
const TRANSIENT_ACTIONS = new Set<V2ReviewAction["type"]>(["focus/set", "hover/set", "instruction/set"]);

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
  /** True while the prepared change of this item is visible in the manuscript. */
  isDiffDrawn: (itemId: string) => boolean;
  notify: (tone: "info" | "error", message: string) => void;
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
  runPass: (passId: V2PassId) => void;
  stopRun: () => void;
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

    if (!TRANSIENT_ACTIONS.has(action.type) && action.type !== "hydrate") {
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
    },
    [dispatch, resumeRun, stopLocalRun, withContext]
  );

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
    (passId: V2PassId) => {
      const { locale, copy, saveNow, getDocument, canWrite, notify } = optionsRef.current;
      const stepId = PASS_STEP_ID[passId];

      if (!stepId) {
        return;
      }

      if (!canWrite()) {
        notify("error", copy.edits.writeBlocked);
        return;
      }

      if (selectRunningPassId(stateRef.current) || runTokenRef.current) {
        notify("error", copy.edits.anotherRun);
        return;
      }

      const document = saveNow() ?? getDocument();

      if (!document || getDocumentTextStats(document).words === 0) {
        dispatch({ type: "run/failed", passId, message: copy.edits.emptyDocument });
        return;
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
    },
    [abandonRun, apiDeps, completeRun, dispatch, driveRun, withContext]
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

        if (reply.kind === "draft") {
          dispatch({ type: "proposal/failed", itemId, message: copy.edits.proposalUnsupported });
          return;
        }

        const live = getDocument();

        if (!live || computeAnchorFingerprint(live, requestItem.anchor.blockIds) !== requestItem.anchor.fingerprint) {
          // Edited while the model was answering: the answer is for text that is no longer there.
          dispatch({ type: "proposal/failed", itemId, message: copy.edits.stale, stale: true });
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
      if (stateRef.current.focusId === itemId && item && item.status === "pending" && !stateRef.current.proposals[itemId]) {
        prepareItem(itemId);
      }
    },
    [focusItem, prepareItem]
  );

  const hoverItem = useCallback((itemId: string | null) => dispatch({ type: "hover/set", itemId }), [dispatch]);

  const acceptItem = useCallback(
    (itemId: string) => {
      const { copy, getDocument, runCommand, notify, canWrite, isDiffDrawn } = optionsRef.current;
      const current = stateRef.current;
      const item = current.items.find((entry) => entry.id === itemId);
      const proposal = current.proposals[itemId];

      if (!item || !canApplyProposal(current, itemId) || proposal?.status !== "ready" || !proposal.proposal.textDiff || !canWrite()) {
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

      if (!runCommand(replaceAnchoredBlocks(blockIds, newBlocks))) {
        notify("error", copy.edits.applyFailed);
        return;
      }

      runCommand(sealHistory);

      const after = getDocument();
      dispatch({
        type: "item/accepted",
        itemId,
        appliedFingerprint: after ? computeAnchorFingerprint(after, item.anchor.blockIds) : "",
        at: new Date().toISOString()
      });
      notify("info", copy.edits.accepted);
    },
    [dispatch, withContext]
  );

  const rejectItem = useCallback(
    (itemId: string) => {
      prepareRequestsRef.current.delete(itemId);
      dispatch({ type: "item/rejected", itemId, at: new Date().toISOString() });
    },
    [dispatch]
  );

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
    },
    [stopLocalRun]
  );

  const marks = useMemo<ReviewMark[]>(() => {
    const cache = diffCacheRef.current;
    const liveProposalIds = new Set<string>();
    const result = selectQueue(state).map((item): ReviewMark => {
      const proposal = state.proposals[item.id];
      const focused = state.focusId === item.id;
      let diff: BlockDiff[] | undefined;

      if (focused && proposal?.status === "ready" && proposal.proposal.textDiff && item.status === "ready") {
        const { id } = proposal.proposal;
        const { blockIds, oldBlocks, newBlocks } = proposal.proposal.textDiff;
        liveProposalIds.add(id);
        diff = cache.get(id);

        if (!diff) {
          diff = diffProposalBlocks(blockIds, oldBlocks, newBlocks);
          cache.set(id, diff);
        }
      }

      return {
        itemId: item.id,
        tone: getItemPassId(item),
        blockIds: item.anchor.blockIds,
        state: proposal?.status === "preparing" ? "preparing" : item.status === "stale" ? "stale" : item.status === "ready" ? "ready" : "pending",
        focused,
        hot: state.hoverId === item.id,
        diff
      };
    });

    for (const id of cache.keys()) {
      if (!liveProposalIds.has(id)) {
        cache.delete(id);
      }
    }

    return result;
  }, [state]);

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
