import type { EditorDocument } from "../editor/document-model.ts";
import type { PersistedActiveReviewRun } from "../editor/draft-state.ts";
import {
  areParagraphIdsResolvable,
  computeAnchorFingerprint,
  type ManuscriptRevisionState
} from "../editor/manuscript-structure.ts";
import {
  isEditorialReviewRunSnapshot,
  normalizeRejectedReviewIdeas,
  reconcileReviewItemsWithRevision,
  type EditorialReviewItem,
  type EditorialReviewStepId,
  type EditorialStepRunMode,
  type RejectedReviewIdea,
  type ReviewActionProposal
} from "../editor/review-contract.ts";
import { clearReviewItemsForReplaceRun, mergeIncomingReviewItems } from "../editor/review-run-merge.ts";
import { reviewChunkProgressPercent } from "../editor/review-run-progress.ts";

/**
 * Suggestion engine state for the v2 editor: passes, the review queue, prepared proposals, focus, filter and
 * decisions. A pure reducer — no React, no network, no storage. The workspace feeds it the document and its
 * revision whenever items have to be merged or checked against the text.
 */

/** Passes of the `Правки` tab. `formatting` (lists) joins the visible six in a later milestone. */
export type V2PassId = "structure" | "clarity" | "interest" | "visual" | "accent" | "spell" | "formatting";

/** The review step behind a pass. `spell` has its own endpoint and no review step. */
export const PASS_STEP_ID: Partial<Record<V2PassId, EditorialReviewStepId>> = {
  structure: "structure",
  clarity: "clarity",
  interest: "interest",
  visual: "visuals",
  accent: "emphasis",
  formatting: "formatting"
};

export function getPassIdForStep(stepId: EditorialReviewStepId | undefined): V2PassId | null {
  if (!stepId) {
    return null;
  }

  const entry = (Object.entries(PASS_STEP_ID) as Array<[V2PassId, EditorialReviewStepId]>).find(([, step]) => step === stepId);
  return entry ? entry[0] : null;
}

export type V2PassStatus = "idle" | "running" | "done" | "failed";

export interface V2PassProgress {
  completed: number;
  total: number;
  percent: number;
}

export interface V2PassState {
  status: V2PassStatus;
  /** Server's message of the last failed run. */
  error?: string;
  /** The last run was stopped by the editor before it finished. */
  stopped?: boolean;
  /** The last run finished, but some fragments failed; their messages, as the server reported them. */
  warnings?: string[];
  progress?: V2PassProgress;
  /** Items the last finished run returned. */
  lastRunItemCount?: number;
  /**
   * A rerun in `replace` mode is in flight and has produced nothing yet: the pass's earlier cards stay until
   * its first items arrive or it completes. A failed or stopped rerun leaves them as they were.
   */
  replaceOnResult?: boolean;
}

export interface V2ReadyProposal {
  proposal: ReviewActionProposal;
  /** Consecutive "nothing changed" answers for this item. */
  noOpStreak: number;
}

export type V2ProposalState =
  /** `previous` is the proposal being regenerated; it comes back if the regeneration fails. */
  | { status: "preparing"; noOpStreak: number; previous?: V2ReadyProposal }
  /** `error` is the server's message of a regeneration that failed; the proposal shown is the earlier one. */
  | ({ status: "ready"; error?: string } & V2ReadyProposal)
  | { status: "failed"; message: string };

export type V2DecisionOutcome = "accepted" | "rejected";

export interface V2Decision {
  itemId: string;
  passId: V2PassId | null;
  outcome: V2DecisionOutcome;
  at: string;
  /** Fingerprint of the anchored blocks right after the proposal was applied (accepted items only). */
  appliedFingerprint?: string;
  /** The proposal that was applied, kept so an undone acceptance comes back with its diff. */
  proposal?: ReviewActionProposal;
  /** The applied text was taken back with undo; the item is open again. */
  undone?: boolean;
}

export type V2ReviewFilter = "all" | V2PassId;

export interface V2ReviewState {
  passes: Partial<Record<V2PassId, V2PassState>>;
  items: EditorialReviewItem[];
  proposals: Record<string, V2ProposalState>;
  /** Refine instructions typed on cards and not yet sent. */
  instructions: Record<string, string>;
  focusId: string | null;
  hoverId: string | null;
  filter: V2ReviewFilter;
  /** One-card-at-a-time mode. Only the flag lives here; its interface comes in a later milestone. */
  quiet: boolean;
  decisions: V2Decision[];
  rejectedIdeas: RejectedReviewIdea[];
  /** Signed reference of the run in flight; persisted so a reload can resume polling. */
  activeRun: PersistedActiveReviewRun | null;
}

/** What survives a reload, stored inside the v2 draft. */
export interface V2PersistedReview {
  passes: Partial<Record<V2PassId, V2PassState>>;
  items: EditorialReviewItem[];
  proposals: Record<string, ReviewActionProposal>;
  decisions: V2Decision[];
  rejectedIdeas: RejectedReviewIdea[];
  activeRun: PersistedActiveReviewRun | null;
  filter: V2ReviewFilter;
  quiet: boolean;
}

interface DocumentContext {
  document: EditorDocument;
  revision: ManuscriptRevisionState;
}

export type V2ReviewAction =
  | { type: "hydrate"; persisted: V2PersistedReview | null }
  | { type: "reset" }
  /** The launcher was pressed; the server has not answered yet. */
  | { type: "run/requested"; passId: V2PassId }
  /** The server accepted the run. In `replace` mode the pass's earlier items go when the run first delivers. */
  | { type: "run/started"; passId: V2PassId; runMode: EditorialStepRunMode; record: PersistedActiveReviewRun }
  /** A reload found a run in flight and polling resumed. */
  | { type: "run/resumed"; passId: V2PassId; record: PersistedActiveReviewRun }
  | ({ type: "run/snapshot"; passId: V2PassId; record: PersistedActiveReviewRun; items: EditorialReviewItem[] } & DocumentContext)
  | ({
      type: "run/completed";
      passId: V2PassId;
      runMode: EditorialStepRunMode;
      stepRunId: string;
      items: EditorialReviewItem[];
      warnings?: string[];
    } & DocumentContext)
  | { type: "run/failed"; passId: V2PassId; message: string }
  | { type: "run/stopped"; passId: V2PassId }
  | ({ type: "items/reconciled" } & DocumentContext)
  /** `item` replaces the stored one (a stale item is sent with a refreshed anchor). */
  | { type: "proposal/requested"; item: EditorialReviewItem }
  | { type: "proposal/ready"; itemId: string; proposal: ReviewActionProposal }
  | { type: "proposal/failed"; itemId: string; message: string; stale?: boolean }
  | { type: "item/accepted"; itemId: string; appliedFingerprint: string; at: string }
  | { type: "item/rejected"; itemId: string; at: string }
  | { type: "focus/set"; itemId: string | null }
  | { type: "hover/set"; itemId: string | null }
  | { type: "filter/set"; filter: V2ReviewFilter }
  | { type: "quiet/set"; quiet: boolean }
  | { type: "instruction/set"; itemId: string; text: string };

export function createInitialReviewState(): V2ReviewState {
  return {
    passes: {},
    items: [],
    proposals: {},
    instructions: {},
    focusId: null,
    hoverId: null,
    filter: "all",
    quiet: false,
    decisions: [],
    rejectedIdeas: [],
    activeRun: null
  };
}

/* ---------- selectors ---------- */

const OPEN_STATUSES = new Set<EditorialReviewItem["status"]>(["pending", "preparing", "ready", "stale"]);

/** An item the editor still has to decide on. */
export function isOpenItem(item: EditorialReviewItem): boolean {
  return OPEN_STATUSES.has(item.status);
}

export function getItemPassId(item: EditorialReviewItem): V2PassId | null {
  return getPassIdForStep(item.stepId);
}

export function selectOpenItems(state: V2ReviewState, passId?: V2PassId): EditorialReviewItem[] {
  return state.items.filter((item) => isOpenItem(item) && (!passId || getItemPassId(item) === passId));
}

/** The visible queue: open items of the filtered pass, in manuscript order. */
export function selectQueue(state: V2ReviewState): EditorialReviewItem[] {
  return state.filter === "all" ? selectOpenItems(state) : selectOpenItems(state, state.filter);
}

export function selectPassState(state: V2ReviewState, passId: V2PassId): V2PassState {
  return state.passes[passId] ?? { status: "idle" };
}

export function selectPassOpenCount(state: V2ReviewState, passId: V2PassId): number {
  return selectOpenItems(state, passId).length;
}

export function selectSummary(state: V2ReviewState): { open: number; decided: number; hasAny: boolean } {
  const open = selectOpenItems(state).length;
  const decided = state.decisions.filter((decision) => !decision.undone).length;
  return { open, decided, hasAny: open + decided > 0 };
}

export function selectRunningPassId(state: V2ReviewState): V2PassId | null {
  const entry = (Object.entries(state.passes) as Array<[V2PassId, V2PassState]>).find(([, pass]) => pass.status === "running");
  return entry ? entry[0] : null;
}

/** A ready proposal may be applied only when no refine instruction is waiting to be sent, as in v1. */
export function canApplyProposal(state: V2ReviewState, itemId: string): boolean {
  const proposal = state.proposals[itemId];
  const item = state.items.find((entry) => entry.id === itemId);

  return Boolean(
    item &&
      item.status === "ready" &&
      proposal?.status === "ready" &&
      proposal.proposal.kind === "text_diff" &&
      proposal.proposal.textDiff &&
      !(state.instructions[itemId] ?? "").trim()
  );
}

export function getRejectedIdeaKey(idea: RejectedReviewIdea): string {
  return `${idea.recommendationType}:${idea.blockIds.join("|")}`;
}

/** The shape the review endpoint accepts back as `rejectedIdeas`. */
export function buildRejectedIdea(item: EditorialReviewItem): RejectedReviewIdea | null {
  return (
    normalizeRejectedReviewIdeas([
      {
        blockIds: item.anchor.blockIds,
        recommendationType: item.recommendationType,
        recommendation: item.recommendation
      }
    ])[0] ?? null
  );
}

/* ---------- reducer ---------- */

export function reviewReducer(state: V2ReviewState, action: V2ReviewAction): V2ReviewState {
  switch (action.type) {
    case "hydrate":
      return action.persisted ? restoreReviewState(action.persisted) : createInitialReviewState();

    case "reset":
      return createInitialReviewState();

    case "run/requested":
      return withPass(state, action.passId, { status: "running" });

    case "run/started":
      return withPass({ ...state, activeRun: action.record }, action.passId, {
        status: "running",
        progress: readProgress(action.record),
        replaceOnResult: action.runMode === "replace" ? true : undefined
      });

    case "run/resumed":
      return withPass({ ...state, activeRun: action.record }, action.passId, {
        ...selectPassState(state, action.passId),
        status: "running",
        error: undefined,
        stopped: undefined,
        progress: readProgress(action.record) ?? selectPassState(state, action.passId).progress
      });

    case "run/snapshot": {
      if (!isCurrentRun(state, action.record)) {
        return state;
      }

      const stepId = PASS_STEP_ID[action.passId];
      const pass = selectPassState(state, action.passId);
      const delivers = action.items.length > 0 && Boolean(stepId);
      const replaces = delivers && pass.replaceOnResult === true;
      const items =
        delivers && stepId
          ? mergeIncomingReviewItems({
              current: replaces ? clearReviewItemsForReplaceRun(state.items, stepId) : state.items,
              incoming: action.items,
              document: action.document,
              revision: action.revision,
              stepId
            })
          : state.items;

      return withPass(settleItems({ ...state, items, activeRun: action.record }), action.passId, {
        status: "running",
        progress: readProgress(action.record) ?? pass.progress,
        replaceOnResult: pass.replaceOnResult && !replaces ? true : undefined
      });
    }

    case "run/completed": {
      const stepId = PASS_STEP_ID[action.passId];
      const replaces = selectPassState(state, action.passId).replaceOnResult === true;
      const items = stepId
        ? mergeIncomingReviewItems({
            current: replaces ? clearReviewItemsForReplaceRun(state.items, stepId) : state.items,
            incoming: action.items.map((item) => ({ ...item, stepId, stepRunId: action.stepRunId })),
            document: action.document,
            revision: action.revision,
            stepId
          })
        : state.items;

      return withPass(settleItems({ ...state, items, activeRun: null }), action.passId, {
        status: "done",
        warnings: action.warnings && action.warnings.length > 0 ? action.warnings : undefined,
        lastRunItemCount: action.items.length
      });
    }

    case "run/failed":
      // Items that streamed in before the failure are real model output and stay in the queue; a rerun that
      // delivered nothing leaves the earlier cards untouched.
      return withPass({ ...state, activeRun: null }, action.passId, { status: "failed", error: action.message });

    case "run/stopped":
      return withPass({ ...state, activeRun: null }, action.passId, { status: "idle", stopped: true });

    case "items/reconciled":
      return reconcileState(state, action.document, action.revision);

    case "proposal/requested": {
      const exists = state.items.some((item) => item.id === action.item.id);
      const previous = state.proposals[action.item.id];

      if (!exists || previous?.status === "preparing") {
        return state;
      }

      return {
        ...state,
        items: state.items.map((item) => (item.id === action.item.id ? action.item : item)),
        proposals: {
          ...state.proposals,
          [action.item.id]:
            previous?.status === "ready"
              ? {
                  status: "preparing",
                  noOpStreak: previous.noOpStreak,
                  previous: { proposal: previous.proposal, noOpStreak: previous.noOpStreak }
                }
              : { status: "preparing", noOpStreak: 0 }
        }
      };
    }

    case "proposal/ready": {
      const item = state.items.find((entry) => entry.id === action.itemId);
      const pending = state.proposals[action.itemId];

      if (pending?.status !== "preparing") {
        return state;
      }

      if (!item || !isOpenItem(item) || item.status === "stale") {
        // The item was decided, removed or edited while the model was answering.
        return settleItems(restorePrevious(state, action.itemId, pending));
      }

      const isNoOp = action.proposal.textDiff?.warning?.code === "no_op";

      return {
        ...state,
        items: state.items.map((entry) =>
          entry.id === action.itemId ? { ...entry, status: "ready", activeProposalId: action.proposal.id } : entry
        ),
        proposals: {
          ...state.proposals,
          [action.itemId]: { status: "ready", proposal: action.proposal, noOpStreak: isNoOp ? pending.noOpStreak + 1 : 0 }
        },
        instructions: omitKey(state.instructions, action.itemId)
      };
    }

    case "proposal/failed": {
      const pending = state.proposals[action.itemId];

      if (pending?.status !== "preparing") {
        return state;
      }

      if (pending.previous && !action.stale) {
        // A regeneration failed: the proposal that was ready stays, with the error beside it.
        return {
          ...state,
          proposals: { ...state.proposals, [action.itemId]: { status: "ready", ...pending.previous, error: action.message } }
        };
      }

      return {
        ...state,
        items: state.items.map((entry) =>
          entry.id === action.itemId && isOpenItem(entry)
            ? { ...entry, status: action.stale ? "stale" : entry.status === "stale" ? "stale" : "pending", activeProposalId: undefined }
            : entry
        ),
        proposals: { ...state.proposals, [action.itemId]: { status: "failed", message: action.message } }
      };
    }

    case "item/accepted": {
      const item = state.items.find((entry) => entry.id === action.itemId);

      if (!item || !isOpenItem(item)) {
        return state;
      }

      const applied = state.proposals[item.id];

      return decide(state, item, {
        itemId: item.id,
        passId: getItemPassId(item),
        outcome: "accepted",
        at: action.at,
        appliedFingerprint: action.appliedFingerprint,
        proposal: applied?.status === "ready" ? applied.proposal : undefined
      });
    }

    case "item/rejected": {
      const item = state.items.find((entry) => entry.id === action.itemId);

      if (!item || !isOpenItem(item)) {
        return state;
      }

      const idea = buildRejectedIdea(item);
      const rejectedIdeas =
        idea && !state.rejectedIdeas.some((entry) => getRejectedIdeaKey(entry) === getRejectedIdeaKey(idea))
          ? normalizeRejectedReviewIdeas([...state.rejectedIdeas, idea])
          : state.rejectedIdeas;

      return decide({ ...state, rejectedIdeas }, item, {
        itemId: item.id,
        passId: getItemPassId(item),
        outcome: "rejected",
        at: action.at
      });
    }

    case "focus/set":
      if (action.itemId === state.focusId) {
        return state;
      }

      return action.itemId === null || state.items.some((item) => item.id === action.itemId && isOpenItem(item))
        ? { ...state, focusId: action.itemId }
        : state;

    case "hover/set":
      return action.itemId === state.hoverId ? state : { ...state, hoverId: action.itemId };

    case "filter/set": {
      const next = { ...state, filter: action.filter };
      const visible = selectQueue(next);
      return visible.some((item) => item.id === next.focusId) ? next : { ...next, focusId: null };
    }

    case "quiet/set":
      return { ...state, quiet: action.quiet };

    case "instruction/set":
      return action.text
        ? { ...state, instructions: { ...state.instructions, [action.itemId]: action.text } }
        : { ...state, instructions: omitKey(state.instructions, action.itemId) };
  }
}

function withPass(state: V2ReviewState, passId: V2PassId, pass: V2PassState): V2ReviewState {
  return { ...state, passes: { ...state.passes, [passId]: pass } };
}

function readProgress(record: PersistedActiveReviewRun): V2PassProgress | undefined {
  const progress = record.run.progress;

  if (!progress || progress.totalChunks <= 0) {
    return undefined;
  }

  return {
    completed: progress.completedChunks,
    total: progress.totalChunks,
    percent: reviewChunkProgressPercent(progress)
  };
}

function isCurrentRun(state: V2ReviewState, record: PersistedActiveReviewRun): boolean {
  return state.activeRun?.run.runId === record.run.runId;
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }

  const next = { ...record };
  delete next[key];
  return next;
}

/** Ends a request in flight without a result: the proposal being regenerated, if any, is ready again. */
function restorePrevious(
  state: V2ReviewState,
  itemId: string,
  pending: Extract<V2ProposalState, { status: "preparing" }>
): V2ReviewState {
  return {
    ...state,
    proposals: pending.previous
      ? { ...state.proposals, [itemId]: { status: "ready", ...pending.previous } }
      : omitKey(state.proposals, itemId)
  };
}

/**
 * The one place where items and proposals are brought back in step after the set of items or their statuses
 * changed (streamed merge, final merge, reconcile with the text, reload):
 *
 * - a stale item cannot have a request in flight (the answer would be for text that is gone) and points at
 *   no active proposal; a proposal that was ready is kept, for the case the text comes back;
 * - an item is `ready` exactly when it is not stale and a ready proposal exists for it;
 * - proposals, instructions, focus and hover of items no longer in the queue are dropped.
 */
function settleItems(state: V2ReviewState): V2ReviewState {
  let proposals = state.proposals;
  let changed = false;

  const items = state.items.map((item) => {
    const entry = proposals[item.id];

    if (item.status === "stale") {
      if (entry?.status === "preparing") {
        proposals = entry.previous
          ? { ...proposals, [item.id]: { status: "ready", ...entry.previous } }
          : omitKey(proposals, item.id);
        changed = true;
      }

      if (item.activeProposalId) {
        changed = true;
        return { ...item, activeProposalId: undefined };
      }

      return item;
    }

    if (item.status === "ready" && entry?.status !== "ready" && entry?.status !== "preparing") {
      changed = true;
      return { ...item, status: "pending" as const, activeProposalId: undefined };
    }

    if (item.status === "pending" && entry?.status === "ready") {
      changed = true;
      return { ...item, status: "ready" as const, activeProposalId: entry.proposal.id };
    }

    return item;
  });

  return dropOrphans(changed ? { ...state, items, proposals } : state);
}

/** Drops proposals, instructions, focus and hover that point at items no longer in the queue. */
function dropOrphans(state: V2ReviewState): V2ReviewState {
  const open = new Set(state.items.filter(isOpenItem).map((item) => item.id));
  const keep = <T,>(record: Record<string, T>) => {
    const entries = Object.entries(record).filter(([itemId]) => open.has(itemId));
    return entries.length === Object.keys(record).length ? record : Object.fromEntries(entries);
  };
  const proposals = keep(state.proposals);
  const instructions = keep(state.instructions);
  const focusId = state.focusId && open.has(state.focusId) ? state.focusId : null;
  const hoverId = state.hoverId && open.has(state.hoverId) ? state.hoverId : null;

  if (
    proposals === state.proposals &&
    instructions === state.instructions &&
    focusId === state.focusId &&
    hoverId === state.hoverId
  ) {
    return state;
  }

  return { ...state, proposals, instructions, focusId, hoverId };
}

function decide(state: V2ReviewState, item: EditorialReviewItem, decision: V2Decision): V2ReviewState {
  const queue = selectQueue(state);
  const index = queue.findIndex((entry) => entry.id === item.id);
  const neighbour = index >= 0 ? queue[index + 1] ?? queue[index - 1] : undefined;
  const status = decision.outcome === "accepted" ? "applied" : "dismissed";

  return {
    ...state,
    items: state.items.map((entry) => (entry.id === item.id ? { ...entry, status, activeProposalId: undefined } : entry)),
    proposals: omitKey(state.proposals, item.id),
    instructions: omitKey(state.instructions, item.id),
    decisions: [...state.decisions.filter((entry) => entry.itemId !== item.id), decision],
    focusId: state.focusId === item.id ? neighbour?.id ?? null : state.focusId,
    hoverId: state.hoverId === item.id ? null : state.hoverId
  };
}

/**
 * Checks every item against the current text.
 *
 * - An open item whose anchored blocks changed or disappeared becomes stale (`reconcileReviewItemsWithRevision`).
 *   Its prepared proposal cannot be applied while it is stale, but is kept.
 * - A stale item whose anchor reads exactly as before again (the edit was undone) is open again: ready when
 *   its proposal is still there, pending otherwise.
 * - An accepted item whose anchor is back to the original text (the acceptance was undone) is open again,
 *   with the proposal it had; when the applied text returns (redo), it is accepted again.
 */
function reconcileState(state: V2ReviewState, document: EditorDocument, revision: ManuscriptRevisionState): V2ReviewState {
  const decisionByItem = new Map(state.decisions.map((decision) => [decision.itemId, decision]));
  let decisions = state.decisions;
  let proposals = state.proposals;
  let changed = false;

  const setDecision = (itemId: string, patch: Partial<V2Decision>) => {
    decisions = decisions.map((decision) => (decision.itemId === itemId ? { ...decision, ...patch } : decision));
  };

  const revived = state.items.map((item) => {
    if (!areParagraphIdsResolvable(revision, item.anchor.blockIds)) {
      return item;
    }

    const fingerprint = computeAnchorFingerprint(document, item.anchor.blockIds);
    const decision = decisionByItem.get(item.id);

    if (item.status === "stale" && fingerprint === item.anchor.fingerprint) {
      changed = true;
      return { ...item, status: "pending" as const };
    }

    if (
      item.status === "applied" &&
      decision?.outcome === "accepted" &&
      !decision.undone &&
      decision.appliedFingerprint !== undefined &&
      decision.appliedFingerprint !== item.anchor.fingerprint &&
      fingerprint === item.anchor.fingerprint
    ) {
      changed = true;
      setDecision(item.id, { undone: true });

      if (decision.proposal) {
        proposals = { ...proposals, [item.id]: { status: "ready", proposal: decision.proposal, noOpStreak: 0 } };
        return { ...item, status: "ready" as const, activeProposalId: decision.proposal.id };
      }

      return { ...item, status: "pending" as const };
    }

    if (
      decision?.outcome === "accepted" &&
      decision.undone &&
      isOpenItem(item) &&
      fingerprint === decision.appliedFingerprint
    ) {
      changed = true;
      setDecision(item.id, { undone: false });
      proposals = omitKey(proposals, item.id);
      return { ...item, status: "applied" as const, activeProposalId: undefined };
    }

    return item;
  });

  // `reconcileReviewItemsWithRevision` returns a fresh object for every stale item, also for one that already
  // was stale, so a change is detected by status and untouched items keep their identity.
  const items = reconcileReviewItemsWithRevision(revived, document, revision).map((item, index) => {
    const before = revived[index]!;

    if (item.status === before.status) {
      return before;
    }

    changed = true;

    return item;
  });

  return settleItems(changed ? { ...state, items, proposals, decisions } : state);
}

/* ---------- persistence ---------- */

export function serializeReviewState(state: V2ReviewState): V2PersistedReview {
  const proposals: Record<string, ReviewActionProposal> = {};

  for (const [itemId, proposal] of Object.entries(state.proposals)) {
    if (proposal.status === "ready") {
      proposals[itemId] = proposal.proposal;
    } else if (proposal.status === "preparing" && proposal.previous) {
      // A regeneration in flight does not survive a reload; the proposal it was replacing does.
      proposals[itemId] = proposal.previous.proposal;
    }
  }

  const passes: Partial<Record<V2PassId, V2PassState>> = {};

  for (const [passId, pass] of Object.entries(state.passes) as Array<[V2PassId, V2PassState]>) {
    // A running pass is only meaningful together with the run reference that can resume it.
    passes[passId] = pass.status === "running" && !state.activeRun ? { status: "idle" } : pass;
  }

  return {
    passes,
    // A request in flight does not survive a reload; the item is simply pending again.
    items: state.items.map((item) => (item.status === "preparing" ? { ...item, status: "pending" } : item)),
    proposals,
    decisions: state.decisions,
    rejectedIdeas: state.rejectedIdeas,
    activeRun: state.activeRun,
    filter: state.filter,
    quiet: state.quiet
  };
}

function restoreReviewState(persisted: V2PersistedReview): V2ReviewState {
  const proposals: Record<string, V2ProposalState> = {};

  for (const item of persisted.items) {
    const proposal = persisted.proposals[item.id];

    if (proposal && isOpenItem(item)) {
      proposals[item.id] = { status: "ready", proposal, noOpStreak: proposal.textDiff?.warning?.code === "no_op" ? 1 : 0 };
    }
  }

  // `settleItems` turns a ready item without its proposal back into a pending one: it has to be prepared again.
  return settleItems({
    ...createInitialReviewState(),
    passes: persisted.passes,
    items: persisted.items.map((item) => (item.status === "preparing" ? { ...item, status: "pending" as const } : item)),
    proposals,
    decisions: persisted.decisions,
    rejectedIdeas: persisted.rejectedIdeas,
    activeRun: persisted.activeRun,
    filter: persisted.filter,
    quiet: persisted.quiet
  });
}

const PASS_IDS: V2PassId[] = ["structure", "clarity", "interest", "visual", "accent", "spell", "formatting"];
const PASS_STATUSES: V2PassStatus[] = ["idle", "running", "done", "failed"];
const ITEM_STATUSES: Array<EditorialReviewItem["status"]> = ["pending", "preparing", "ready", "applied", "dismissed", "stale"];

/**
 * Reads the review part of a stored draft. Anything that does not have the expected shape is left out, so a
 * draft written before this part existed, or a damaged review section, still opens with its manuscript.
 */
export function coercePersistedReview(value: unknown): V2PersistedReview | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items.filter(isStoredReviewItem) : [];
  const itemIds = new Set(items.map((item) => item.id));
  const passes: Partial<Record<V2PassId, V2PassState>> = {};

  if (record.passes && typeof record.passes === "object") {
    for (const passId of PASS_IDS) {
      const pass = (record.passes as Record<string, unknown>)[passId];

      if (pass && typeof pass === "object" && PASS_STATUSES.includes((pass as V2PassState).status)) {
        const candidate = pass as V2PassState;
        passes[passId] = {
          status: candidate.status,
          error: typeof candidate.error === "string" ? candidate.error : undefined,
          stopped: candidate.stopped === true ? true : undefined,
          warnings: Array.isArray(candidate.warnings) ? candidate.warnings.filter((entry) => typeof entry === "string") : undefined,
          progress:
            candidate.progress &&
            typeof candidate.progress.completed === "number" &&
            typeof candidate.progress.total === "number" &&
            typeof candidate.progress.percent === "number"
              ? candidate.progress
              : undefined,
          lastRunItemCount: typeof candidate.lastRunItemCount === "number" ? candidate.lastRunItemCount : undefined,
          replaceOnResult: candidate.replaceOnResult === true ? true : undefined
        };
      }
    }
  }

  const proposals: Record<string, ReviewActionProposal> = {};

  if (record.proposals && typeof record.proposals === "object") {
    for (const [itemId, proposal] of Object.entries(record.proposals as Record<string, unknown>)) {
      if (itemIds.has(itemId) && isStoredTextDiffProposal(proposal)) {
        proposals[itemId] = proposal;
      }
    }
  }

  const decisions: V2Decision[] = (Array.isArray(record.decisions) ? record.decisions : [])
    .filter(
      (entry): entry is V2Decision =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as V2Decision).itemId === "string" &&
        ((entry as V2Decision).outcome === "accepted" || (entry as V2Decision).outcome === "rejected")
    )
    .map((entry) => ({
      itemId: entry.itemId,
      passId: PASS_IDS.includes(entry.passId as V2PassId) ? entry.passId : null,
      outcome: entry.outcome,
      at: typeof entry.at === "string" ? entry.at : "",
      ...(typeof entry.appliedFingerprint === "string" ? { appliedFingerprint: entry.appliedFingerprint } : {}),
      ...(isStoredTextDiffProposal(entry.proposal) ? { proposal: entry.proposal } : {}),
      ...(entry.undone === true ? { undone: true } : {})
    }));
  const activeRun = coerceActiveRun(record.activeRun);

  // Without a resumable run nothing can be "running" after a reload.
  for (const passId of PASS_IDS) {
    const pass = passes[passId];

    if (pass?.status === "running" && (!activeRun || getPassIdForStep(activeRun.run.stepId) !== passId)) {
      passes[passId] = { status: "idle" };
    }
  }

  const filter = record.filter === "all" || PASS_IDS.includes(record.filter as V2PassId) ? (record.filter as V2ReviewFilter) : "all";

  return {
    passes,
    items,
    proposals,
    decisions,
    rejectedIdeas: normalizeRejectedReviewIdeas(record.rejectedIdeas),
    activeRun,
    filter,
    quiet: record.quiet === true
  };
}

function isStoredReviewItem(value: unknown): value is EditorialReviewItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<EditorialReviewItem>;
  return Boolean(
    typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.reason === "string" &&
      typeof item.recommendation === "string" &&
      typeof item.recommendationType === "string" &&
      item.anchor &&
      Array.isArray(item.anchor.blockIds) &&
      item.anchor.blockIds.every((blockId) => typeof blockId === "string") &&
      typeof item.anchor.fingerprint === "string" &&
      item.insertionPoint &&
      typeof item.insertionPoint.anchorBlockId === "string" &&
      ITEM_STATUSES.includes(item.status as EditorialReviewItem["status"])
  );
}

function isStoredTextDiffProposal(value: unknown): value is ReviewActionProposal {
  if (!value || typeof value !== "object") {
    return false;
  }

  const proposal = value as Partial<ReviewActionProposal>;
  return Boolean(
    typeof proposal.id === "string" &&
      typeof proposal.reviewItemId === "string" &&
      proposal.kind === "text_diff" &&
      proposal.textDiff &&
      Array.isArray(proposal.textDiff.blockIds) &&
      Array.isArray(proposal.textDiff.oldBlocks) &&
      Array.isArray(proposal.textDiff.newBlocks)
  );
}

function coerceActiveRun(value: unknown): PersistedActiveReviewRun | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<PersistedActiveReviewRun>;

  if (
    record.version !== 1 ||
    typeof record.capability !== "string" ||
    !record.capability.trim() ||
    typeof record.updatedAt !== "string" ||
    !isEditorialReviewRunSnapshot(record.run)
  ) {
    return null;
  }

  return {
    version: 1,
    run: record.run,
    capability: record.capability,
    updatedAt: record.updatedAt,
    stale: record.stale === true,
    snapshotBlockIds: Array.isArray(record.snapshotBlockIds)
      ? record.snapshotBlockIds.filter((blockId): blockId is string => typeof blockId === "string")
      : undefined,
    itemCursor:
      typeof record.itemCursor === "number" && Number.isFinite(record.itemCursor) && record.itemCursor >= 0
        ? Math.floor(record.itemCursor)
        : undefined
  };
}
