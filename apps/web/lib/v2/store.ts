import type { Block, EditorDocument } from "../editor/document-model.ts";
import type { PersistedActiveReviewRun } from "../editor/draft-state.ts";
import {
  areParagraphIdsResolvable,
  computeAnchorFingerprint,
  type ManuscriptRevisionState
} from "../editor/manuscript-structure.ts";
import {
  isEditorialReviewRunSnapshot,
  normalizeEditorialCalloutDepth,
  normalizeRejectedReviewIdeas,
  reconcileReviewItemsWithRevision,
  type CustomRequestPlanAction,
  type DiagnosticsMode,
  type EditorialCalloutDepth,
  type EditorialCalloutKind,
  type EditorialReviewItem,
  type EditorialReviewRunPhase,
  type EditorialReviewStepId,
  type EditorialStepRunMode,
  type RejectedReviewIdea,
  type ReviewActionProposal
} from "../editor/review-contract.ts";
import { clearReviewItemsForReplaceRun, mergeIncomingReviewItems } from "../editor/review-run-merge.ts";
import { reviewChunkProgressPercent } from "../editor/review-run-progress.ts";
import { getInlineText } from "../editor/document-model.ts";
import {
  getAccentPhrase,
  getHeadingDraft,
  getItemKind,
  hasBoldOccurrence,
  isAnchorContiguous,
  getSpellKey,
  getSpellReplacement,
  getTextBlockContent,
  hasLocalResult,
  isInlineRangeBold,
  needsProposalCall,
  rebaseSpellRange,
  resolveAccentRange,
  type V2ReviewItem
} from "./item-kinds.ts";
import {
  coerceStudioData,
  coerceVisualPrefs,
  createStudioData,
  isStudioTouched,
  serializeStudioData,
  studioReducer,
  type V2StudioDefaults,
  type V2StudioEvent,
  type V2VisualPrefs
} from "./studio.ts";
import {
  addAuthorQuery,
  coerceOverviewState,
  createInitialOverviewState,
  removeAuthorQuery,
  setAuthorQueryNote,
  type V2AuthorQuery,
  type V2FactFinding,
  type V2OverviewState
} from "./overview.ts";

/**
 * Suggestion engine state for the v2 editor: passes, the review queue, prepared proposals, focus, filter and
 * decisions. A pure reducer — no React, no network, no storage. The workspace feeds it the document and its
 * revision whenever items have to be merged or checked against the text.
 */

/** Passes of the `Правки` tab. */
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

/** Review passes in the order `Запустити всі` runs them: structure first, accents last. */
export const RUN_ALL_ORDER: V2PassId[] = ["structure", "clarity", "interest", "formatting", "visual", "accent"];
/** Passes whose result is visible without a model call, so several can be accepted at once. */
export const BULK_PASSES: ReadonlySet<V2PassId> = new Set<V2PassId>(["structure", "accent", "spell"]);
/** How many accepted decisions keep their proposal in memory for undo. */
export const DECISION_PROPOSALS_KEPT = 30;
/** Quiet mode prepares on its own only after an item has been current this long (holding an arrow key skips it). */
export const QUIET_DWELL_MS = 500;
/** Quiet mode never has more automatic preparations in flight than this. */
export const QUIET_MAX_AUTO_PREPARATIONS = 2;

/**
 * Review runs that have no pass row: the two read-only steps of `Огляд` and the editor's own request for
 * the chapter (`Запит`). They go through the same run endpoint as passes, one run at a time.
 */
export type V2StepRunId = "diagnostics" | "fact_check" | "request";
/** Anything that is run through the review endpoint, plus spellcheck. */
export type V2RunId = V2PassId | V2StepRunId;

export const STEP_RUN_STEP_ID: Record<V2StepRunId, EditorialReviewStepId> = {
  diagnostics: "diagnostics",
  fact_check: "fact_check",
  request: "final_editing"
};

const STEP_RUN_IDS: V2StepRunId[] = ["diagnostics", "fact_check", "request"];

export function isStepRunId(runId: V2RunId): runId is V2StepRunId {
  return runId === "diagnostics" || runId === "fact_check" || runId === "request";
}

/** The review step a run id stands for; undefined for spellcheck, which has its own endpoint. */
export function getRunStepId(runId: V2RunId): EditorialReviewStepId | undefined {
  return isStepRunId(runId) ? STEP_RUN_STEP_ID[runId] : PASS_STEP_ID[runId];
}

export function getRunIdForStep(stepId: EditorialReviewStepId | undefined): V2RunId | null {
  const stepRun = STEP_RUN_IDS.find((runId) => STEP_RUN_STEP_ID[runId] === stepId);
  return stepRun ?? getPassIdForStep(stepId);
}

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
  /** A chapter request first plans its actions, then writes them; other runs have no phases. */
  phase?: EditorialReviewRunPhase;
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
  /** Ids of the blocks that stand where the anchor was after a replacement (accepted `replace` items). */
  appliedBlockIds?: string[];
  /** Ids of the blocks the acceptance inserted (headings, callouts). */
  insertedBlockIds?: string[];
  /**
   * What a rejection replaced, kept in memory so it can be taken back (`item/restored`): the status the
   * item had, its ready proposal, and whether this rejection is the one that added the rejected idea.
   */
  restore?: { status: EditorialReviewItem["status"]; proposal?: V2ReadyProposal; addedIdea: boolean };
}

/** What an acceptance did to the manuscript, as far as the store needs to recognise its undo and redo. */
export interface V2AppliedChange {
  itemId: string;
  appliedFingerprint: string;
  appliedBlockIds?: string[];
  insertedBlockIds?: string[];
}

export type V2ReviewFilter = "all" | V2PassId;

/* ---------- the editor's own requests (`Запит`) ---------- */

export type V2RequestOutcome =
  | { kind: "running" }
  /**
   * `count` suggestions reached the queue; `holes` planned actions came back empty and can be retried;
   * `warnings` are the messages of parts that could not be checked (a fragment spellcheck).
   */
  | { kind: "done"; count: number; holes?: number; warnings?: string[] }
  | { kind: "error"; message: string }
  | { kind: "stopped" }
  /** The router could not tell what is wanted; the question is on screen. */
  | { kind: "question" }
  /** The page was reloaded while a fragment request was in flight; its answer was lost. */
  | { kind: "interrupted" };

export interface V2RequestEntry {
  id: string;
  scope: "chapter" | "fragment";
  /** What was asked: the instruction, or the name of the quick action. */
  text: string;
  /** The selected words, for a fragment request. */
  quote?: string;
  /** Paragraph reference of the fragment as it was when the request was made. */
  where?: string;
  at: string;
  outcome: V2RequestOutcome;
}

/** A planned action of a chapter request that came back without a suggestion. */
export interface V2RequestHole {
  index: number;
  message: string;
}

/** The router's question about a fragment request, with the executors the editor can choose from. */
export interface V2ClarifyQuestion {
  entryId: string;
  prompt: string;
  blockIds: string[];
  quote: string;
  choices: Array<"patch" | "spellcheck" | "callout" | "visual">;
}

export interface V2RequestState {
  history: V2RequestEntry[];
  /** Planned actions of the last chapter request; a hole is retried from here. */
  plan: CustomRequestPlanAction[] | null;
  /** The instruction the plan was made for. A retried action is sent with this one, never with a later one. */
  planInstruction: string;
  holes: V2RequestHole[];
  /** History entry of the chapter request that ran last (or is running). */
  chapterEntryId: string | null;
  /** Instruction of that request. */
  instruction: string;
  /** Index of the planned action being retried, while that run is in flight. */
  retryIndex: number | null;
  /** The fragment request in flight. Not stored: its answer does not survive a reload. */
  fragment: { entryId: string; label: string } | null;
  clarify: V2ClarifyQuestion | null;
}

/** How many requests the history keeps. */
export const REQUEST_HISTORY_LIMIT = 30;

export function createInitialRequestState(): V2RequestState {
  return {
    history: [],
    plan: null,
    planInstruction: "",
    holes: [],
    chapterEntryId: null,
    instruction: "",
    retryIndex: null,
    fragment: null,
    clarify: null
  };
}

/** The instruction as it is sent, or null when there is nothing to send. */
export function normalizeInstruction(text: string): string | null {
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}

/** Label and colour source of a queue item: its pass, or where else it came from. */
export type V2ItemSource = V2PassId | "fact" | "request";

export interface V2ReviewState {
  passes: Partial<Record<V2PassId, V2PassState>>;
  /** Run state of the steps that have no pass row; same shape and lifecycle as a pass. */
  steps: Partial<Record<V2StepRunId, V2PassState>>;
  overview: V2OverviewState;
  request: V2RequestState;
  items: V2ReviewItem[];
  proposals: Record<string, V2ProposalState>;
  /** Refine instructions typed on cards and not yet sent. */
  instructions: Record<string, string>;
  focusId: string | null;
  hoverId: string | null;
  filter: V2ReviewFilter;
  /** One-card-at-a-time mode: the queue is walked item by item and focus never leaves it. */
  quiet: boolean;
  /** Review passes waiting for their turn after `Запустити всі`; the server runs one at a time. */
  queue: V2PassId[];
  /**
   * The queue came from a stored draft: nothing in it starts until the editor says so. A reload must never
   * launch a paid run by itself.
   */
  queuePaused: boolean;
  decisions: V2Decision[];
  rejectedIdeas: RejectedReviewIdea[];
  /** Signed reference of the run in flight; persisted so a reload can resume polling. */
  activeRun: PersistedActiveReviewRun | null;
  /** Style and speed of illustrations as the editor chose them last; v2's own memory of the choice. */
  visualPrefs: V2VisualPrefs;
}

/** What survives a reload, stored inside the v2 draft. */
export interface V2PersistedReview {
  passes: Partial<Record<V2PassId, V2PassState>>;
  items: V2ReviewItem[];
  proposals: Record<string, ReviewActionProposal>;
  decisions: V2Decision[];
  rejectedIdeas: RejectedReviewIdea[];
  activeRun: PersistedActiveReviewRun | null;
  filter: V2ReviewFilter;
  /** Always false in a stored draft: quiet mode is switched on by the editor, never by a reload. */
  quiet: boolean;
  queue?: V2PassId[];
  /** Server messages of preparations that failed; kept so a failed one is retried only by the editor. */
  failed?: Record<string, string>;
  /** Absent in drafts stored before `Огляд` and `Запит` existed. */
  steps?: Partial<Record<V2StepRunId, V2PassState>>;
  overview?: V2OverviewState;
  request?: Pick<V2RequestState, "history" | "plan" | "planInstruction" | "holes" | "chapterEntryId" | "instruction" | "retryIndex">;
  /** Absent in drafts stored before illustrations existed. */
  visualPrefs?: V2VisualPrefs;
}

interface DocumentContext {
  document: EditorDocument;
  revision: ManuscriptRevisionState;
}

export type V2ReviewAction =
  | { type: "hydrate"; persisted: V2PersistedReview | null }
  | { type: "items/staleDismissed"; at: string }
  | { type: "reset" }
  /**
   * The launcher was pressed; the server has not answered yet. `passId` names what runs: a pass, or one of
   * the steps without a pass row (`diagnostics`, `fact_check`, `request`). `retryIndex` marks a chapter
   * request that only retries one planned action.
   */
  | { type: "run/requested"; passId: V2RunId; retryIndex?: number }
  /** The server accepted the run. In `replace` mode the pass's earlier items go when the run first delivers. */
  | { type: "run/started"; passId: V2RunId; runMode: EditorialStepRunMode; record: PersistedActiveReviewRun }
  /** A reload found a run in flight and polling resumed. */
  | { type: "run/resumed"; passId: V2RunId; record: PersistedActiveReviewRun }
  | ({
      type: "run/snapshot";
      passId: V2RunId;
      record: PersistedActiveReviewRun;
      items: EditorialReviewItem[];
      /** Planned actions of a chapter request, once the planning phase is over. */
      plan?: CustomRequestPlanAction[];
    } & DocumentContext)
  | ({
      type: "run/completed";
      passId: V2RunId;
      runMode: EditorialStepRunMode;
      stepRunId: string;
      items: EditorialReviewItem[];
      warnings?: string[];
      /** When the run finished; shown as the date of a report. */
      at?: string;
      /** Diagnostics: the model's markdown. */
      expertise?: string;
      /** Fact-check: the flagged claims; `items` are the suggestions linked to them. */
      factCheck?: { findings: V2FactFinding[]; checkedCount: number };
      /** Chapter request: the plan and the planned actions that came back empty. */
      plan?: CustomRequestPlanAction[];
      holes?: V2RequestHole[];
    } & DocumentContext)
  | { type: "run/failed"; passId: V2RunId; message: string; plan?: CustomRequestPlanAction[]; holes?: V2RequestHole[] }
  | { type: "run/stopped"; passId: V2RunId }
  | { type: "overview/modeSet"; mode: DiagnosticsMode }
  | { type: "author/added"; query: V2AuthorQuery }
  | { type: "author/noteSet"; id: string; note: string }
  | { type: "author/removed"; id: string }
  /**
   * A request was made (or goes on after a question was answered): its history entry is added or set
   * running again. `role` says what is in flight with it.
   */
  | { type: "request/logged"; entry: V2RequestEntry; role: "chapter" | "fragment"; instruction?: string; label?: string }
  | { type: "request/settled"; entryId: string; outcome: V2RequestOutcome }
  | { type: "clarify/set"; clarify: V2ClarifyQuestion | null }
  /**
   * One item made by hand (a fragment request) joins the queue, sorted and checked against the text. With a
   * `proposal` it arrives prepared. An open hand-made item of the same kind on the same blocks is replaced.
   */
  | ({ type: "item/added"; item: V2ReviewItem; proposal?: ReviewActionProposal } & DocumentContext)
  /** The editor gave up on a preparation in flight; whatever was ready before is ready again. */
  | { type: "proposal/cancelled"; itemId: string }
  /** Spelling findings for some blocks only; findings elsewhere and the pass state stay as they are. */
  | ({ type: "spell/merged"; items: V2ReviewItem[]; blockIds: string[] } & DocumentContext)
  | ({ type: "items/reconciled" } & DocumentContext)
  /** `item` replaces the stored one (a stale item is sent with a refreshed anchor). */
  | { type: "proposal/requested"; item: EditorialReviewItem }
  | { type: "proposal/ready"; itemId: string; proposal: ReviewActionProposal }
  | { type: "proposal/failed"; itemId: string; message: string; stale?: boolean }
  /** A prepared callout or heading draft arrived; it is kept on the item itself, as in the classic editor. */
  | { type: "draft/ready"; itemId: string; proposal: ReviewActionProposal }
  | ({ type: "item/accepted"; at: string } & V2AppliedChange)
  /** Several visible results applied in one manuscript step. */
  | { type: "items/accepted"; entries: V2AppliedChange[]; at: string }
  | { type: "item/headingEdited"; itemId: string; title?: string; headingLevel?: 2 | 3 }
  /** Kind or depth of a callout changed: the draft written for the old choice is dropped. */
  | { type: "item/calloutOptions"; itemId: string; calloutKind?: EditorialCalloutKind; calloutDepth?: EditorialCalloutDepth }
  | { type: "spell/choice"; itemId: string; choice: number }
  | { type: "spell/requested" }
  | ({ type: "spell/completed"; items: V2ReviewItem[]; warnings?: string[] } & DocumentContext)
  | { type: "spell/failed"; message: string }
  | { type: "spell/stopped" }
  /** Open findings that leave the queue without a decision (their word is in the personal dictionary). */
  | { type: "spell/removed"; itemIds: string[] }
  | { type: "queue/set"; passIds: V2PassId[] }
  | { type: "queue/removed"; passId: V2PassId }
  | { type: "queue/cleared" }
  /** Quiet-mode navigation: next (1) or previous (-1) item of the visible queue, wrapping around. */
  | { type: "focus/moved"; delta: 1 | -1 }
  | { type: "item/rejected"; itemId: string; at: string }
  /** A rejection taken back: the item is as it was, and the rejected idea it added is gone. */
  | { type: "item/restored"; itemId: string }
  /** The editor let a queue that came from a stored draft go on. */
  | { type: "queue/resumed" }
  | { type: "focus/set"; itemId: string | null }
  | { type: "hover/set"; itemId: string | null }
  | { type: "filter/set"; filter: V2ReviewFilter }
  | { type: "quiet/set"; quiet: boolean }
  | { type: "instruction/set"; itemId: string; text: string }
  /** The studio was opened for an illustration: it gets its studio state, unless it has one already. */
  | { type: "studio/opened"; itemId: string; defaults: V2StudioDefaults }
  /** Something happened in the studio of this illustration (`studioReducer`). */
  | { type: "studio/event"; itemId: string; event: V2StudioEvent };

export function createInitialReviewState(): V2ReviewState {
  return {
    passes: {},
    steps: {},
    overview: createInitialOverviewState(),
    request: createInitialRequestState(),
    items: [],
    proposals: {},
    instructions: {},
    focusId: null,
    hoverId: null,
    filter: "all",
    quiet: false,
    queue: [],
    queuePaused: false,
    decisions: [],
    rejectedIdeas: [],
    activeRun: null,
    visualPrefs: {}
  };
}

/* ---------- selectors ---------- */

const OPEN_STATUSES = new Set<EditorialReviewItem["status"]>(["pending", "preparing", "ready", "stale"]);

/** An item the editor still has to decide on. */
export function isOpenItem(item: V2ReviewItem): boolean {
  return OPEN_STATUSES.has(item.status);
}

/**
 * An illustration whose studio can be opened: one still waiting for a decision, or one that is in the text
 * already (its image can be regenerated and replaced there).
 */
export function isStudioItem(item: V2ReviewItem): boolean {
  return getItemKind(item) === "visual" && (isOpenItem(item) || item.status === "applied");
}

/** The illustration that put this image block into the manuscript, if a suggestion did. */
export function findFigureItem(state: V2ReviewState, blockId: string): V2ReviewItem | null {
  const decision = state.decisions.find(
    (entry) => entry.outcome === "accepted" && !entry.undone && (entry.insertedBlockIds ?? []).includes(blockId)
  );
  const item = decision ? state.items.find((entry) => entry.id === decision.itemId) : undefined;

  return item && item.status === "applied" && getItemKind(item) === "visual" ? item : null;
}

/** The image block an inserted illustration stands in, or null while it is not in the text. */
export function getFigureBlockId(state: V2ReviewState, itemId: string): string | null {
  const item = state.items.find((entry) => entry.id === itemId);
  const decision = state.decisions.find((entry) => entry.itemId === itemId);

  return item?.status === "applied" && decision?.outcome === "accepted" && !decision.undone
    ? decision.insertedBlockIds?.[0] ?? null
    : null;
}

/** The pass an item belongs to (and is filtered by). Items made by hand or by a step without a row have none. */
export function getItemPassId(item: V2ReviewItem): V2PassId | null {
  if (item.spell) {
    return "spell";
  }

  return item.origin === "manual" ? null : getPassIdForStep(item.stepId);
}

/** Where an item came from, for its label and colour: every item has one, also without a pass row. */
export function getItemSource(item: V2ReviewItem): V2ItemSource | null {
  if (item.spell) {
    return "spell";
  }

  if (item.stepId === "fact_check") {
    return "fact";
  }

  if (item.stepId === "final_editing" || item.origin === "manual") {
    return "request";
  }

  return getItemPassId(item);
}

export function selectOpenItems(state: V2ReviewState, passId?: V2PassId): V2ReviewItem[] {
  return state.items.filter((item) => isOpenItem(item) && (!passId || getItemPassId(item) === passId));
}

/** The visible queue: open items of the filtered pass, in manuscript order. */
/** Illustrations that lost their place in the text: all that can be done with them is to reject them. */
export function selectStaleVisuals(state: V2ReviewState): V2ReviewItem[] {
  return state.items.filter((item) => item.status === "stale" && getItemKind(item) === "visual");
}

export function selectQueue(state: V2ReviewState): V2ReviewItem[] {
  return state.filter === "all" ? selectOpenItems(state) : selectOpenItems(state, state.filter);
}

export function selectPassState(state: V2ReviewState, passId: V2PassId): V2PassState {
  return state.passes[passId] ?? { status: "idle" };
}

/** Run state of a pass or of a step without a pass row. */
export function selectRunState(state: V2ReviewState, runId: V2RunId): V2PassState {
  return (isStepRunId(runId) ? state.steps[runId] : state.passes[runId]) ?? { status: "idle" };
}

export function selectPassOpenCount(state: V2ReviewState, passId: V2PassId): number {
  return selectOpenItems(state, passId).length;
}

export function selectSummary(state: V2ReviewState): { open: number; decided: number; hasAny: boolean } {
  const open = selectOpenItems(state).length;
  const decided = state.decisions.filter((decision) => !decision.undone).length;
  return { open, decided, hasAny: open + decided > 0 };
}

/** The review pass in flight. Spellcheck is a different endpoint and may run beside it. */
export function selectRunningPassId(state: V2ReviewState): V2PassId | null {
  const entry = (Object.entries(state.passes) as Array<[V2PassId, V2PassState]>).find(
    ([passId, pass]) => passId !== "spell" && pass.status === "running"
  );
  return entry ? entry[0] : null;
}

/** Whatever goes through the review endpoint right now: a pass or a step without a row. One at a time. */
export function selectRunningRunId(state: V2ReviewState): V2RunId | null {
  return selectRunningPassId(state) ?? STEP_RUN_IDS.find((runId) => state.steps[runId]?.status === "running") ?? null;
}

/**
 * True while the review endpoint is taken or about to be: a run is in flight, or a launch queue is being
 * worked through. A new run cannot start then; its launcher says why.
 */
export function selectReviewBusy(state: V2ReviewState): boolean {
  return selectRunningRunId(state) !== null || (state.queue.length > 0 && !state.queuePaused);
}

/** The queued pass to start now, or null while a review run is in flight or nothing waits. */
export function selectNextQueuedPass(state: V2ReviewState): V2PassId | null {
  return state.queuePaused || selectRunningRunId(state) ? null : state.queue[0] ?? null;
}

/**
 * What `Запустити всі` starts: the review passes that have not produced a finished run yet (never run,
 * stopped or failed), in `RUN_ALL_ORDER`, and whether spellcheck should start beside them.
 */
export function planRunAll(state: V2ReviewState, live: ReadonlySet<string>): { queue: V2PassId[]; spell: boolean } {
  const waiting = (passId: V2PassId) => {
    const status = selectPassState(state, passId).status;
    return live.has(passId) && status !== "running" && status !== "done";
  };

  return { queue: RUN_ALL_ORDER.filter(waiting), spell: waiting("spell") };
}

/** True when the item's result can be applied as far as the store knows; the caller still checks it is drawn. */
export function canAcceptItem(state: V2ReviewState, itemId: string): boolean {
  const item = state.items.find((entry) => entry.id === itemId);

  if (!item) {
    return false;
  }

  const kind = getItemKind(item);

  if (kind === "replace") {
    return canApplyProposal(state, itemId);
  }

  if (kind === "visual" || item.status !== "ready" || !hasLocalResult(item)) {
    return false;
  }

  if (state.proposals[itemId]?.status === "preparing" || (state.instructions[itemId] ?? "").trim()) {
    return false;
  }

  return kind !== "spell" || getSpellReplacement(item) !== null;
}

/**
 * Items `Прийняти всі` would apply: the filtered pass must be one whose results need no model call, and
 * only items whose result is drawn in the manuscript right now (`drawnIds`) count.
 */
export function selectBulkCandidates(state: V2ReviewState, drawnIds: Iterable<string>): V2ReviewItem[] {
  if (state.filter === "all" || !BULK_PASSES.has(state.filter) || state.quiet) {
    return [];
  }

  const drawn = new Set(drawnIds);

  return selectQueue(state).filter((item) => {
    const kind = getItemKind(item);
    return (kind === "heading" || kind === "accent" || kind === "spell") && drawn.has(item.id) && canAcceptItem(state, item.id);
  });
}

/**
 * Quiet mode walks the queue quickly, so it prepares the focused item and the next ONE item on its own.
 * This is the only place where a proposal is requested without a click on a card. Failed, stale and
 * already requested items are never picked again.
 */
export function selectQuietPreparationTargets(state: V2ReviewState): string[] {
  if (!state.quiet) {
    return [];
  }

  const queue = selectQueue(state);
  const index = queue.findIndex((item) => item.id === state.focusId);

  if (index < 0) {
    return [];
  }

  const candidates = queue.length > 1 ? [queue[index]!, queue[(index + 1) % queue.length]!] : [queue[index]!];

  return candidates
    .filter((item) => item.status === "pending" && !state.proposals[item.id] && needsProposalCall(item) && getItemKind(item) !== "visual")
    .map((item) => item.id);
}

/**
 * What quiet mode may prepare right now. On top of the two-item rule:
 * - nothing until the current item has been current for `QUIET_DWELL_MS` (an item the editor only passed
 *   over on the way to another one is never prepared);
 * - never more than `QUIET_MAX_AUTO_PREPARATIONS` automatic preparations in flight.
 */
export function planQuietPreparation(
  state: V2ReviewState,
  timing: { focusedSince: number | null; now: number; autoInFlight: number }
): string[] {
  if (!state.quiet || timing.focusedSince === null || timing.now - timing.focusedSince < QUIET_DWELL_MS) {
    return [];
  }

  const room = QUIET_MAX_AUTO_PREPARATIONS - Math.max(0, timing.autoInFlight);
  return room > 0 ? selectQuietPreparationTargets(state).slice(0, room) : [];
}

/** False for actions that change nothing worth writing to the draft. */
export function shouldPersistAfter(action: V2ReviewAction): boolean {
  switch (action.type) {
    case "hydrate":
    case "focus/set":
    case "focus/moved":
    case "hover/set":
    case "instruction/set":
    case "spell/requested":
    case "clarify/set":
      return false;
    case "run/snapshot":
      // A poll that only moved the progress bar is not worth a full draft write; one that brought items is.
      return action.items.length > 0;
    default:
      return true;
  }
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
export function buildRejectedIdea(item: V2ReviewItem): RejectedReviewIdea | null {
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
  return keepQuietFocus(reduce(state, action));
}

/** In quiet mode there is always a current item while the visible queue is not empty. */
function keepQuietFocus(state: V2ReviewState): V2ReviewState {
  if (!state.quiet) {
    return state;
  }

  const queue = selectQueue(state);

  if (queue.length === 0 || queue.some((item) => item.id === state.focusId)) {
    return state;
  }

  return { ...state, focusId: queue[0]!.id };
}

function reduce(state: V2ReviewState, action: V2ReviewAction): V2ReviewState {
  switch (action.type) {
    case "hydrate":
      return action.persisted ? restoreReviewState(action.persisted) : createInitialReviewState();

    case "reset": {
      // The reports, findings and requests belonged to the text that is gone; the chosen mode is a preference.
      const initial = createInitialReviewState();
      return { ...initial, overview: { ...initial.overview, diagnosticsMode: state.overview.diagnosticsMode } };
    }

    case "run/requested": {
      const next = withPass({ ...state, queue: state.queue.filter((passId) => passId !== action.passId) }, action.passId, {
        status: "running"
      });
      return action.passId === "request" ? { ...next, request: { ...next.request, retryIndex: action.retryIndex ?? null } } : next;
    }

    case "run/started": {
      const next = withPass({ ...state, activeRun: action.record }, action.passId, {
        status: "running",
        progress: readProgress(action.record),
        replaceOnResult: action.runMode === "replace" ? true : undefined
      });

      // A new chapter request has a plan of its own; the holes of the previous one cannot be retried any more.
      return action.passId === "request" && action.runMode === "replace"
        ? { ...next, request: { ...next.request, plan: null, planInstruction: "", holes: [] } }
        : next;
    }

    case "run/resumed":
      return withPass({ ...state, activeRun: action.record }, action.passId, {
        ...selectRunState(state, action.passId),
        status: "running",
        error: undefined,
        stopped: undefined,
        progress: readProgress(action.record) ?? selectRunState(state, action.passId).progress
      });

    case "run/snapshot": {
      if (!isCurrentRun(state, action.record)) {
        return state;
      }

      const stepId = deliveringStepId(action.passId);
      const pass = selectRunState(state, action.passId);
      const delivers = action.items.length > 0 && Boolean(stepId);
      const replaces = delivers && pass.replaceOnResult === true;
      const items =
        delivers && stepId
          ? mergeIncoming({
              current: replaces ? clearForReplaceRun(state.items, stepId) : state.items,
              incoming: action.items,
              document: action.document,
              revision: action.revision,
              stepId
            })
          : state.items;
      const planned =
        action.passId === "request" && action.plan && action.plan.length > 0 && state.request.retryIndex === null
          ? adoptPlan(state.request, action.plan)
          : state.request;
      const merged = { ...state, items, activeRun: action.record, request: planned };

      return withPass(delivers ? reconcileState(merged, action.document, action.revision) : merged, action.passId, {
        status: "running",
        progress: readProgress(action.record) ?? pass.progress,
        replaceOnResult: pass.replaceOnResult && !replaces ? true : undefined
      });
    }

    case "run/completed": {
      if (action.passId === "diagnostics") {
        const text = action.expertise?.trim() ?? "";

        return withPass(
          {
            ...state,
            activeRun: null,
            overview: text
              ? { ...state.overview, diagnostics: { text, at: action.at ?? "", mode: state.overview.diagnosticsMode } }
              : state.overview
          },
          "diagnostics",
          { status: "done" }
        );
      }

      if (action.passId === "fact_check") {
        // Linked suggestions are told apart by their claim, not by type and anchor: two claims of one
        // paragraph are two cards. The earlier ones go only now, when the new result is in.
        const kept = clearReviewItemsForReplaceRun(state.items, "fact_check") as V2ReviewItem[];
        const taken = new Set(kept.map((item) => item.id));
        const linked = action.items
          .filter((item) => !taken.has(item.id))
          .map((item): V2ReviewItem => ({ ...item, stepId: "fact_check", stepRunId: action.stepRunId }));
        const linkedIds = new Set(linked.map((item) => item.id));
        const findings = (action.factCheck?.findings ?? []).map((finding) =>
          finding.itemId && !linkedIds.has(finding.itemId) ? { ...finding, itemId: null } : finding
        );

        return withPass(
          reconcileState(
            {
              ...state,
              items: sortItems([...kept, ...linked], action.document),
              activeRun: null,
              overview: {
                ...state.overview,
                factCheck: { findings, at: action.at ?? "", checkedCount: Math.max(action.factCheck?.checkedCount ?? 0, findings.length) }
              }
            },
            action.document,
            action.revision
          ),
          "fact_check",
          { status: "done", lastRunItemCount: findings.length }
        );
      }

      const stepId = getRunStepId(action.passId);
      const replaces = selectRunState(state, action.passId).replaceOnResult === true;
      const before = stepId ? state.items.filter((item) => item.stepId === stepId).length : 0;
      const items = stepId
        ? mergeIncoming({
            current: replaces ? clearForReplaceRun(state.items, stepId) : state.items,
            incoming: action.items.map((item) => ({ ...item, stepId, stepRunId: action.stepRunId })),
            document: action.document,
            revision: action.revision,
            stepId
          })
        : state.items;

      const completed = withPass(reconcileState({ ...state, items, activeRun: null }, action.document, action.revision), action.passId, {
        status: "done",
        warnings: action.warnings && action.warnings.length > 0 ? action.warnings : undefined,
        lastRunItemCount: action.items.length
      });

      if (action.passId !== "request") {
        return completed;
      }

      const { request } = state;

      if (request.retryIndex !== null) {
        // One planned action was retried: its hole is closed, and what it produced is added to the count.
        const added = Math.max(0, items.filter((item) => item.stepId === stepId).length - before);
        const holes = request.holes.filter((hole) => hole.index !== request.retryIndex);

        return {
          ...completed,
          request: {
            ...request,
            holes,
            retryIndex: null,
            history: request.history.map((entry): V2RequestEntry =>
              entry.id === request.chapterEntryId && entry.outcome.kind === "done"
                ? { ...entry, outcome: { kind: "done", count: entry.outcome.count + added, ...(holes.length > 0 ? { holes: holes.length } : {}) } }
                : entry
            )
          }
        };
      }

      const holes = action.holes ?? [];

      return {
        ...completed,
        request: settleEntry(
          { ...adoptPlan(request, action.plan), holes, retryIndex: null },
          request.chapterEntryId,
          { kind: "done", count: action.items.length, ...(holes.length > 0 ? { holes: holes.length } : {}) }
        )
      };
    }

    case "run/failed": {
      // Items that streamed in before the failure are real model output and stay in the queue; a rerun that
      // delivered nothing leaves the earlier cards untouched.
      // A pass that could not even start (empty text) must not stay in the launch queue either.
      const failed = withPass(
        { ...state, activeRun: null, queue: state.queue.filter((passId) => passId !== action.passId) },
        action.passId,
        { status: "failed", error: action.message }
      );

      if (action.passId !== "request") {
        return failed;
      }

      const { request } = state;

      if (request.retryIndex !== null) {
        // The retried action failed again: its hole stays, with what the server said this time.
        return {
          ...failed,
          request: {
            ...request,
            retryIndex: null,
            holes: request.holes.map((hole) => (hole.index === request.retryIndex ? { ...hole, message: action.message } : hole))
          }
        };
      }

      return {
        ...failed,
        request: settleEntry(
          { ...adoptPlan(request, action.plan), holes: action.holes ?? request.holes, retryIndex: null },
          request.chapterEntryId,
          { kind: "error", message: action.message }
        )
      };
    }

    case "run/stopped": {
      const stopped = withPass({ ...state, activeRun: null }, action.passId, { status: "idle", stopped: true });

      if (action.passId !== "request") {
        return stopped;
      }

      return {
        ...stopped,
        request:
          state.request.retryIndex !== null
            ? { ...state.request, retryIndex: null }
            : settleEntry(state.request, state.request.chapterEntryId, { kind: "stopped" })
      };
    }

    case "overview/modeSet":
      return action.mode === state.overview.diagnosticsMode || selectRunState(state, "diagnostics").status === "running"
        ? state
        : { ...state, overview: { ...state.overview, diagnosticsMode: action.mode } };

    case "author/added": {
      const authorQueries = addAuthorQuery(state.overview.authorQueries, action.query);
      return authorQueries === state.overview.authorQueries ? state : { ...state, overview: { ...state.overview, authorQueries } };
    }

    case "author/noteSet": {
      const authorQueries = setAuthorQueryNote(state.overview.authorQueries, action.id, action.note);
      return authorQueries === state.overview.authorQueries ? state : { ...state, overview: { ...state.overview, authorQueries } };
    }

    case "author/removed": {
      const authorQueries = removeAuthorQuery(state.overview.authorQueries, action.id);
      return authorQueries === state.overview.authorQueries ? state : { ...state, overview: { ...state.overview, authorQueries } };
    }

    case "request/logged": {
      const { request } = state;
      const known = request.history.some((entry) => entry.id === action.entry.id);
      const history = known
        ? request.history.map((entry) => (entry.id === action.entry.id ? { ...entry, outcome: action.entry.outcome } : entry))
        : [action.entry, ...request.history].slice(0, REQUEST_HISTORY_LIMIT);

      return {
        ...state,
        request:
          action.role === "chapter"
            ? {
                ...request,
                history,
                chapterEntryId: action.entry.id,
                instruction: action.instruction ?? action.entry.text,
                // A new request leaves nothing of the previous one to retry: its plan and holes go now, not
                // when the server accepts the run, so a request that fails at the door cannot be "retried"
                // with the old plan and the new words.
                ...(known ? {} : { plan: null, planInstruction: "", holes: [], retryIndex: null })
              }
            : { ...request, history, clarify: null, fragment: { entryId: action.entry.id, label: action.label ?? action.entry.text } }
      };
    }

    case "request/settled": {
      const { request } = state;

      if (!request.history.some((entry) => entry.id === action.entryId)) {
        return state;
      }

      const settled = settleEntry(request, action.entryId, action.outcome);
      return { ...state, request: request.fragment?.entryId === action.entryId ? { ...settled, fragment: null } : settled };
    }

    case "clarify/set":
      return action.clarify === state.request.clarify ? state : { ...state, request: { ...state.request, clarify: action.clarify } };

    case "item/added": {
      if (state.items.some((entry) => entry.id === action.item.id)) {
        return state;
      }

      const kind = getItemKind(action.item);
      const anchorKey = action.item.anchor.blockIds.join("|");
      const superseded = new Set(
        state.items
          .filter(
            (entry) =>
              entry.origin === "manual" &&
              isOpenItem(entry) &&
              getItemKind(entry) === kind &&
              entry.anchor.blockIds.join("|") === anchorKey &&
              state.proposals[entry.id]?.status !== "preparing"
          )
          .map((entry) => entry.id)
      );
      const items = sortItems([...state.items.filter((entry) => !superseded.has(entry.id)), action.item], action.document);
      const proposals: Record<string, V2ProposalState> = action.proposal
        ? { ...state.proposals, [action.item.id]: { status: "ready", proposal: action.proposal, noOpStreak: 0 } }
        : state.proposals;

      return reconcileState({ ...state, items, proposals }, action.document, action.revision);
    }

    case "proposal/cancelled": {
      const pending = state.proposals[action.itemId];
      return pending?.status === "preparing" ? settleItems(restorePrevious(state, action.itemId, pending)) : state;
    }

    case "spell/merged": {
      const scope = new Set(action.blockIds);
      const inScope = (item: V2ReviewItem) => Boolean(item.spell) && scope.has(item.anchor.blockIds[0] ?? "");
      const ignored = new Set(state.items.filter((item) => inScope(item) && item.status === "dismissed").map((item) => getSpellKey(item)));
      const kept = state.items.filter((item) => !(inScope(item) && isOpenItem(item)));
      const taken = new Set(kept.map((item) => item.id));
      const incoming = action.items.filter((item) => inScope(item) && !ignored.has(getSpellKey(item)) && !taken.has(item.id));

      return reconcileState({ ...state, items: sortItems([...kept, ...incoming], action.document) }, action.document, action.revision);
    }

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

      // An item that still carries a drawable draft (a callout whose regeneration failed) is ready again.
      return settleItems({
        ...state,
        items: state.items.map((entry) =>
          entry.id === action.itemId && isOpenItem(entry)
            ? { ...entry, status: action.stale ? "stale" : entry.status === "stale" ? "stale" : "pending", activeProposalId: undefined }
            : entry
        ),
        proposals: { ...state.proposals, [action.itemId]: { status: "failed", message: action.message } }
      });
    }

    case "draft/ready": {
      const item = state.items.find((entry) => entry.id === action.itemId);
      const pending = state.proposals[action.itemId];

      if (pending?.status !== "preparing") {
        return state;
      }

      const settled = { ...state, proposals: omitKey(state.proposals, action.itemId) };

      if (!item || !isOpenItem(item) || item.status === "stale") {
        return settleItems(settled);
      }

      const { calloutDraft, subsectionDraft } = action.proposal;
      let next: V2ReviewItem | null = null;

      if (action.proposal.kind === "callout_prompt" && calloutDraft) {
        const calloutDepth = normalizeEditorialCalloutDepth(calloutDraft.calloutDepth);
        next = {
          ...item,
          calloutKind: calloutDraft.calloutKind,
          calloutDepth,
          calloutPrepared: true,
          calloutDraft: {
            calloutKind: calloutDraft.calloutKind,
            calloutDepth,
            title: calloutDraft.title,
            prompt: calloutDraft.prompt,
            previewText: calloutDraft.previewText ?? ""
          }
        };
      } else if (action.proposal.kind === "subsection_prompt" && subsectionDraft) {
        next = {
          ...item,
          headingLevel: subsectionDraft.headingLevel,
          subsectionDraft: { title: subsectionDraft.title, headingLevel: subsectionDraft.headingLevel, prompt: subsectionDraft.prompt }
        };
      }

      if (!next) {
        return settleItems(settled);
      }

      const updated = next;

      return settleItems({
        ...settled,
        items: state.items.map((entry) => (entry.id === action.itemId ? updated : entry)),
        instructions: omitKey(state.instructions, action.itemId)
      });
    }

    case "item/accepted":
      return accept(state, action, action.at);

    case "items/accepted":
      return action.entries.reduce((current, entry) => accept(current, entry, action.at), state);

    case "item/headingEdited": {
      const item = state.items.find((entry) => entry.id === action.itemId);
      const draft = item ? getHeadingDraft(item) : null;

      if (!item || !isOpenItem(item) || getItemKind(item) !== "heading") {
        return state;
      }

      // The level the item has, also while its title is empty (`draft` is null then): typing the first letter
      // of a new title must not flip H2 to H3, which would also re-create the ghost being typed in.
      const storedLevel = (item.subsectionDraft?.headingLevel ?? item.headingLevel) === 2 ? 2 : 3;
      const headingLevel = action.headingLevel ?? draft?.headingLevel ?? storedLevel;

      // An emptied title is kept as typed: the suggestion then has nothing to insert until a title is back.
      return settleItems({
        ...state,
        items: state.items.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                headingLevel,
                subsectionDraft: {
                  ...entry.subsectionDraft,
                  title: action.title ?? entry.subsectionDraft?.title ?? "",
                  headingLevel,
                  prompt: entry.subsectionDraft?.prompt ?? ""
                }
              }
            : entry
        )
      });
    }

    case "item/calloutOptions": {
      const item = state.items.find((entry) => entry.id === action.itemId);

      if (!item || !isOpenItem(item) || getItemKind(item) !== "callout" || state.proposals[item.id]?.status === "preparing") {
        return state;
      }

      const calloutKind = action.calloutKind ?? item.calloutDraft?.calloutKind ?? item.calloutKind ?? "mechanism";
      const calloutDepth = normalizeEditorialCalloutDepth(action.calloutDepth ?? item.calloutDraft?.calloutDepth ?? item.calloutDepth);

      if (calloutKind === (item.calloutDraft?.calloutKind ?? item.calloutKind) && calloutDepth === (item.calloutDraft?.calloutDepth ?? item.calloutDepth)) {
        return state;
      }

      // The draft was written for another kind or depth: it must not stay on screen as if it matched.
      return settleItems({
        ...state,
        items: state.items.map((entry) =>
          entry.id === item.id ? { ...entry, calloutKind, calloutDepth, calloutDraft: undefined, calloutPrepared: undefined } : entry
        ),
        proposals: omitKey(state.proposals, item.id)
      });
    }

    case "spell/choice": {
      const item = state.items.find((entry) => entry.id === action.itemId);

      if (!item?.spell || !isOpenItem(item) || action.choice < 0 || action.choice >= item.spell.suggestions.length) {
        return state;
      }

      const spell = { ...item.spell, choice: action.choice };
      return { ...state, items: state.items.map((entry) => (entry.id === item.id ? { ...entry, spell } : entry)) };
    }

    case "spell/requested":
      return withPass(state, "spell", { status: "running" });

    case "spell/completed": {
      // Findings the editor chose to leave as they are do not come back on a rerun.
      const ignored = new Set(
        state.items.filter((item) => item.spell && item.status === "dismissed").map((item) => getSpellKey(item))
      );
      const kept = state.items.filter((item) => !(item.spell && isOpenItem(item)));
      const taken = new Set(kept.map((item) => item.id));
      const incoming = action.items.filter((item) => item.spell && !ignored.has(getSpellKey(item)) && !taken.has(item.id));
      const items = sortItems([...kept, ...incoming], action.document);

      return withPass(reconcileState({ ...state, items }, action.document, action.revision), "spell", {
        status: "done",
        warnings: action.warnings && action.warnings.length > 0 ? action.warnings : undefined,
        lastRunItemCount: incoming.length
      });
    }

    case "spell/failed":
      return withPass(state, "spell", { status: "failed", error: action.message });

    case "spell/stopped":
      return withPass(state, "spell", { status: "idle", stopped: true });

    case "spell/removed": {
      const remove = new Set(action.itemIds);
      const items = state.items.filter((item) => !(item.spell && isOpenItem(item) && remove.has(item.id)));
      return items.length === state.items.length ? state : settleItems({ ...state, items });
    }

    case "queue/set":
      return {
        ...state,
        queuePaused: false,
        queue: action.passIds.filter((passId, index, list) => PASS_STEP_ID[passId] && list.indexOf(passId) === index)
      };

    case "queue/resumed":
      return state.queuePaused ? { ...state, queuePaused: false } : state;

    case "queue/removed":
      return state.queue.includes(action.passId) ? { ...state, queue: state.queue.filter((passId) => passId !== action.passId) } : state;

    case "queue/cleared":
      return state.queue.length > 0 || state.queuePaused ? { ...state, queue: [], queuePaused: false } : state;

    case "focus/moved": {
      const queue = selectQueue(state);

      if (queue.length === 0) {
        return state;
      }

      const index = queue.findIndex((item) => item.id === state.focusId);
      const next = index < 0 ? (action.delta > 0 ? 0 : queue.length - 1) : (index + action.delta + queue.length) % queue.length;
      return queue[next]!.id === state.focusId ? state : { ...state, focusId: queue[next]!.id };
    }

    case "item/rejected": {
      const item = state.items.find((entry) => entry.id === action.itemId);

      if (!item || !isOpenItem(item)) {
        return state;
      }

      // A spelling finding is not an idea of the model; it must not travel to later review runs.
      const idea = item.spell ? null : buildRejectedIdea(item);
      const rejectedIdeas =
        idea && !state.rejectedIdeas.some((entry) => getRejectedIdeaKey(entry) === getRejectedIdeaKey(idea))
          ? normalizeRejectedReviewIdeas([...state.rejectedIdeas, idea])
          : state.rejectedIdeas;

      const previous = state.proposals[item.id];
      const kept =
        previous?.status === "ready"
          ? { proposal: previous.proposal, noOpStreak: previous.noOpStreak }
          : previous?.status === "preparing"
            ? previous.previous
            : undefined;

      return decide({ ...state, rejectedIdeas }, item, {
        itemId: item.id,
        passId: getItemPassId(item),
        outcome: "rejected",
        at: action.at,
        restore: {
          status: item.status === "preparing" ? "pending" : item.status,
          ...(kept ? { proposal: kept } : {}),
          addedIdea: rejectedIdeas !== state.rejectedIdeas
        }
      });
    }

    case "items/staleDismissed": {
      // Not a judgement about the idea: the place for the illustration is gone, so no rejected idea is kept.
      let next = state;

      for (const item of selectStaleVisuals(state)) {
        // Kept in memory like a single rejection, so the whole batch can be taken back from its message.
        next = decide(next, item, {
          itemId: item.id,
          passId: getItemPassId(item),
          outcome: "rejected",
          at: action.at,
          restore: { status: item.status, addedIdea: false }
        });
      }

      return next;
    }

    case "item/restored": {
      const item = state.items.find((entry) => entry.id === action.itemId);
      const decision = state.decisions.find((entry) => entry.itemId === action.itemId);

      if (!item || item.status !== "dismissed" || decision?.outcome !== "rejected" || !decision.restore) {
        return state;
      }

      const { restore } = decision;
      const idea = restore.addedIdea ? buildRejectedIdea(item) : null;

      return settleItems({
        ...state,
        items: state.items.map((entry) => (entry.id === item.id ? { ...entry, status: restore.status } : entry)),
        proposals: restore.proposal ? { ...state.proposals, [item.id]: { status: "ready", ...restore.proposal } } : state.proposals,
        decisions: state.decisions.filter((entry) => entry.itemId !== item.id),
        rejectedIdeas: idea ? state.rejectedIdeas.filter((entry) => getRejectedIdeaKey(entry) !== getRejectedIdeaKey(idea)) : state.rejectedIdeas,
        // Back in view, it is the current item again.
        focusId: state.filter === "all" || getItemPassId(item) === state.filter ? item.id : state.focusId
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

    case "studio/opened": {
      const item = state.items.find((entry) => entry.id === action.itemId);

      if (!item || !isStudioItem(item) || item.studio) {
        return state;
      }

      const studio = createStudioData(action.defaults);
      return { ...state, items: state.items.map((entry) => (entry.id === item.id ? { ...entry, studio } : entry)) };
    }

    case "studio/event": {
      const item = state.items.find((entry) => entry.id === action.itemId);

      if (!item?.studio || !isStudioItem(item)) {
        return state;
      }

      const studio = studioReducer(item.studio, action.event);

      if (studio === item.studio) {
        return state;
      }

      // The style and speed chosen last are where the next illustration starts.
      const visualPrefs: V2VisualPrefs =
        studio.style !== item.studio.style || studio.quality !== item.studio.quality
          ? { style: studio.style, quality: studio.quality }
          : state.visualPrefs;

      return { ...state, visualPrefs, items: state.items.map((entry) => (entry.id === item.id ? { ...entry, studio } : entry)) };
    }
  }
}

function withPass(state: V2ReviewState, runId: V2RunId, pass: V2PassState): V2ReviewState {
  return isStepRunId(runId)
    ? { ...state, steps: { ...state.steps, [runId]: pass } }
    : { ...state, passes: { ...state.passes, [runId]: pass } };
}

/** The step whose items a run streams into the queue; the two read-only steps deliver none. */
function deliveringStepId(runId: V2RunId): EditorialReviewStepId | undefined {
  return runId === "diagnostics" || runId === "fact_check" ? undefined : getRunStepId(runId);
}

/** Takes a plan together with the instruction it was made for. Without a plan nothing changes. */
function adoptPlan(request: V2RequestState, plan: CustomRequestPlanAction[] | undefined): V2RequestState {
  return plan && plan.length > 0 ? { ...request, plan, planInstruction: request.instruction } : request;
}

function settleEntry(request: V2RequestState, entryId: string | null, outcome: V2RequestOutcome): V2RequestState {
  return entryId && request.history.some((entry) => entry.id === entryId)
    ? { ...request, history: request.history.map((entry) => (entry.id === entryId ? { ...entry, outcome } : entry)) }
    : request;
}

function readProgress(record: PersistedActiveReviewRun): V2PassProgress | undefined {
  const progress = record.run.progress;

  if (!progress) {
    return undefined;
  }

  if (progress.totalChunks <= 0) {
    // A chapter request reports its phase before there is anything to count.
    return progress.phase ? { completed: 0, total: 0, percent: 0, phase: progress.phase } : undefined;
  }

  return {
    completed: progress.completedChunks,
    total: progress.totalChunks,
    percent: reviewChunkProgressPercent(progress),
    ...(progress.phase ? { phase: progress.phase } : {})
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
 * - an item is `ready` exactly when it is not stale and its result exists: a ready proposal, or a result the
 *   item carries itself (heading title, accent phrase, callout draft, spelling finding);
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

    // Headings, accents, callout drafts and spelling findings carry their result themselves.
    const local = hasLocalResult(item);

    if (item.status === "ready" && entry?.status !== "ready" && entry?.status !== "preparing" && !local) {
      changed = true;
      return { ...item, status: "pending" as const, activeProposalId: undefined };
    }

    if (item.status === "pending" && (entry?.status === "ready" || local)) {
      changed = true;
      return { ...item, status: "ready" as const, activeProposalId: entry?.status === "ready" ? entry.proposal.id : undefined };
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

function accept(state: V2ReviewState, change: V2AppliedChange, at: string): V2ReviewState {
  const item = state.items.find((entry) => entry.id === change.itemId);

  if (!item || !isOpenItem(item)) {
    return state;
  }

  const applied = state.proposals[item.id];

  return decide(state, item, {
    itemId: item.id,
    passId: getItemPassId(item),
    outcome: "accepted",
    at,
    appliedFingerprint: change.appliedFingerprint,
    proposal: applied?.status === "ready" ? applied.proposal : undefined,
    ...(change.appliedBlockIds ? { appliedBlockIds: change.appliedBlockIds } : {}),
    ...(change.insertedBlockIds ? { insertedBlockIds: change.insertedBlockIds } : {})
  });
}

/** Only the most recent accepted decisions keep their proposal: it is there for undo, not as an archive. */
function pruneDecisionProposals(decisions: V2Decision[]): V2Decision[] {
  let kept = 0;
  let changed = false;
  const result = decisions.slice();

  for (let index = result.length - 1; index >= 0; index -= 1) {
    const decision = result[index]!;

    if (!decision.proposal) {
      continue;
    }

    kept += 1;

    if (kept > DECISION_PROPOSALS_KEPT) {
      const { proposal: _dropped, ...rest } = decision;
      result[index] = rest;
      changed = true;
    }
  }

  return changed ? result : decisions;
}

function decide(state: V2ReviewState, item: V2ReviewItem, decision: V2Decision): V2ReviewState {
  const queue = selectQueue(state);
  const index = queue.findIndex((entry) => entry.id === item.id);
  const neighbour = index >= 0 ? queue[index + 1] ?? queue[index - 1] : undefined;
  const status = decision.outcome === "accepted" ? "applied" : "dismissed";

  return {
    ...state,
    items: state.items.map((entry) => (entry.id === item.id ? { ...entry, status, activeProposalId: undefined } : entry)),
    proposals: omitKey(state.proposals, item.id),
    instructions: omitKey(state.instructions, item.id),
    decisions: pruneDecisionProposals([...state.decisions.filter((entry) => entry.itemId !== item.id), decision]),
    focusId: state.focusId === item.id ? neighbour?.id ?? null : state.focusId,
    hoverId: state.hoverId === item.id ? null : state.hoverId
  };
}

/**
 * Checks every item against the current text.
 *
 * Suggestions that rewrite blocks (and callouts, whose draft was written for the anchored text):
 * - an open item whose anchored blocks changed or disappeared becomes stale (`reconcileReviewItemsWithRevision`);
 *   its prepared proposal cannot be applied while it is stale, but is kept;
 * - a stale item whose anchor reads exactly as before again (the edit was undone) is open again;
 * - an accepted item whose anchor is back to the original text (the acceptance was undone) is open again,
 *   with the proposal it had; when the applied blocks return (redo), it is accepted again.
 *
 * Suggestions tied to an exact place rather than to the whole block survive edits elsewhere in it:
 * - an accent stays while its phrase is there and not bold yet; its acceptance is recognised by the bold;
 * - a spelling finding is moved with its word (`rebaseSpellRange`) or goes stale when the word was touched;
 * - a heading stays while the block it goes before exists; headings and callouts recognise their undo and
 *   redo by the block they inserted.
 */
function reconcileState(state: V2ReviewState, document: EditorDocument, revision: ManuscriptRevisionState): V2ReviewState {
  const blocks = new Map<string, Block>(document.blocks.map((block) => [block.id, block]));
  const decisionByItem = new Map(state.decisions.map((decision) => [decision.itemId, decision]));
  let decisions = state.decisions;
  let proposals = state.proposals;
  let changed = false;

  const setDecision = (itemId: string, patch: Partial<V2Decision>) => {
    decisions = decisions.map((decision) => (decision.itemId === itemId ? { ...decision, ...patch } : decision));
  };

  /** The acceptance was taken back: the item is open again, with the proposal it had. */
  const reopen = (item: V2ReviewItem, decision: V2Decision): V2ReviewItem => {
    changed = true;
    setDecision(item.id, { undone: true });

    if (decision.proposal) {
      proposals = { ...proposals, [item.id]: { status: "ready", proposal: decision.proposal, noOpStreak: 0 } };
      return { ...item, status: "ready", activeProposalId: decision.proposal.id };
    }

    return { ...item, status: "pending" };
  };

  /** The undone acceptance is in the manuscript again (redo). */
  const reapply = (item: V2ReviewItem): V2ReviewItem => {
    changed = true;
    setDecision(item.id, { undone: false });
    proposals = omitKey(proposals, item.id);
    return { ...item, status: "applied", activeProposalId: undefined };
  };

  const makeStale = (item: V2ReviewItem): V2ReviewItem => {
    if (item.status === "stale") {
      return item;
    }

    changed = true;
    return { ...item, status: "stale" };
  };

  /** Keeps an open item open: a stale one is revived, and its anchor is re-read from the current text. */
  const keepOpen = (item: V2ReviewItem): V2ReviewItem => {
    const fingerprint = computeAnchorFingerprint(document, item.anchor.blockIds);

    if (item.status !== "stale" && fingerprint === item.anchor.fingerprint) {
      return item;
    }

    changed = true;
    return {
      ...item,
      status: item.status === "stale" ? "pending" : item.status,
      anchor: { ...item.anchor, fingerprint }
    };
  };

  const revived = state.items.map((item): V2ReviewItem => {
    const kind = getItemKind(item);
    const decision = decisionByItem.get(item.id);
    const accepted = decision?.outcome === "accepted" ? decision : undefined;
    const open = isOpenItem(item);

    if (kind === "accent" || kind === "spell") {
      const content = getTextBlockContent(blocks.get(item.anchor.blockIds[0] ?? ""));

      if (!content || item.anchor.blockIds.length !== 1) {
        return open ? makeStale(item) : item;
      }

      const text = getInlineText(content);

      if (kind === "accent") {
        const range = resolveAccentRange(text, item);
        const bold = range ? isInlineRangeBold(content, range.start, range.end) : false;

        if (item.status === "applied") {
          // Judged by what was applied, not by re-counting occurrences: the same phrase typed earlier in the
          // paragraph shifts the count, while the accepted words are still bold where they were.
          return accepted && !accepted.undone && range && !bold && !hasBoldOccurrence(content, getAccentPhrase(item))
            ? reopen(item, accepted)
            : item;
        }

        if (!open) {
          return item;
        }

        if (accepted?.undone && range && bold) {
          return reapply(item);
        }

        // Gone, or bold already by the editor's own hand: there is nothing left to accept.
        return range && !bold ? keepOpen(item) : makeStale(item);
      }

      const spell = item.spell!;

      if (item.status === "applied") {
        return accepted && !accepted.undone && text === spell.blockText ? reopen(item, accepted) : item;
      }

      if (!open) {
        return item;
      }

      if (accepted?.undone && computeAnchorFingerprint(document, item.anchor.blockIds) === accepted.appliedFingerprint) {
        return reapply(item);
      }

      const rebased = rebaseSpellRange(spell, text);

      if (!rebased) {
        return makeStale(item);
      }

      if (rebased !== spell) {
        changed = true;
      }

      return keepOpen(rebased === spell ? item : { ...item, spell: rebased });
    }

    if (kind === "visual") {
      // An illustration belongs to a place, not to exact wording: it stays while its paragraphs and the block
      // it goes after exist. Its insertion, undo and redo are recognised by the image block it inserted.
      const inserted = accepted?.insertedBlockIds ?? [];
      let next = item;

      if (item.status === "applied") {
        if (!(accepted && !accepted.undone && inserted.length > 0 && inserted.every((blockId) => !blocks.has(blockId)))) {
          return item;
        }

        next = reopen(item, accepted);
      } else if (!open) {
        return item;
      } else if (accepted?.undone && inserted.length > 0 && inserted.every((blockId) => blocks.has(blockId))) {
        return reapply(item);
      }

      return areParagraphIdsResolvable(revision, next.anchor.blockIds) && blocks.has(next.insertionPoint.anchorBlockId)
        ? keepOpen(next)
        : makeStale(next);
    }

    if (kind === "heading" || kind === "callout") {
      const inserted = accepted?.insertedBlockIds ?? [];

      if (item.status === "applied") {
        return accepted && !accepted.undone && inserted.length > 0 && inserted.every((blockId) => !blocks.has(blockId))
          ? reopen(item, accepted)
          : item;
      }

      if (open && accepted?.undone && inserted.length > 0 && inserted.every((blockId) => blocks.has(blockId))) {
        return reapply(item);
      }

      if (kind === "heading") {
        if (!open) {
          return item;
        }

        return areParagraphIdsResolvable(revision, item.anchor.blockIds) && blocks.has(item.insertionPoint.anchorBlockId)
          ? keepOpen(item)
          : makeStale(item);
      }
    }

    if (accepted?.undone && open) {
      // Redo. A replacement may leave fewer (or more) blocks than the anchor had, so the applied blocks are
      // looked up by their own ids, and the anchored blocks the replacement removed must be gone again.
      const appliedIds = accepted.appliedBlockIds ?? item.anchor.blockIds;
      const removed = item.anchor.blockIds.filter((blockId) => !appliedIds.includes(blockId));

      if (
        accepted.appliedFingerprint !== undefined &&
        areParagraphIdsResolvable(revision, appliedIds) &&
        removed.every((blockId) => !blocks.has(blockId)) &&
        computeAnchorFingerprint(document, appliedIds) === accepted.appliedFingerprint &&
        (appliedIds.length !== item.anchor.blockIds.length || accepted.appliedFingerprint !== item.anchor.fingerprint)
      ) {
        return reapply(item);
      }
    }

    if (!areParagraphIdsResolvable(revision, item.anchor.blockIds)) {
      return item;
    }

    const fingerprint = computeAnchorFingerprint(document, item.anchor.blockIds);
    // A rewrite replaces its anchored blocks as one run. With something between them now (a heading or a
    // callout inserted, a paragraph typed) it could only fail on accept, so it is stale and can be prepared anew.
    const torn = kind === "replace" && open && !isAnchorContiguous(revision.blockOrder, item.anchor.blockIds);

    if (torn) {
      return makeStale(item);
    }

    if (item.status === "stale" && fingerprint === item.anchor.fingerprint) {
      changed = true;
      return { ...item, status: "pending" as const };
    }

    if (
      kind !== "callout" &&
      item.status === "applied" &&
      accepted &&
      !accepted.undone &&
      accepted.appliedFingerprint !== undefined &&
      accepted.appliedFingerprint !== item.anchor.fingerprint &&
      fingerprint === item.anchor.fingerprint
    ) {
      return reopen(item, accepted);
    }

    return item;
  });

  // `reconcileReviewItemsWithRevision` returns a fresh object for every stale item, also for one that already
  // was stale, so a change is detected by status and untouched items keep their identity.
  const items = (reconcileReviewItemsWithRevision(revived, document, revision) as V2ReviewItem[]).map((item, index) => {
    const before = revived[index]!;

    if (item.status === before.status) {
      return before;
    }

    changed = true;

    return item;
  });

  return settleItems(changed ? { ...state, items, proposals, decisions } : state);
}

/* ---------- order and merging ---------- */

const KIND_ORDER: Record<string, number> = { heading: 0, replace: 1, accent: 2, spell: 2, callout: 3, visual: 4 };

/** Manuscript order: by block, then by what comes first inside it (a heading goes before, a callout after). */
function sortItems(items: V2ReviewItem[], document: EditorDocument): V2ReviewItem[] {
  const blockIndex = new Map(document.blocks.map((block, index) => [block.id, index]));
  const text = new Map<string, string>();
  const keys = new Map<string, [number, number, number]>();

  for (const item of items) {
    const kind = getItemKind(item);
    const blockId = (kind === "heading" ? item.insertionPoint.anchorBlockId : item.anchor.blockIds[0]) ?? "";
    let offset = 0;

    if (kind === "spell") {
      offset = item.spell!.range.start;
    } else if (kind === "accent") {
      if (!text.has(blockId)) {
        const content = getTextBlockContent(document.blocks[blockIndex.get(blockId) ?? -1]);
        text.set(blockId, content ? getInlineText(content) : "");
      }

      offset = resolveAccentRange(text.get(blockId) ?? "", item)?.start ?? 0;
    }

    keys.set(item.id, [blockIndex.get(blockId) ?? Number.MAX_SAFE_INTEGER, KIND_ORDER[kind] ?? 1, offset]);
  }

  return items.slice().sort((left, right) => {
    const a = keys.get(left.id)!;
    const b = keys.get(right.id)!;
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || left.id.localeCompare(right.id);
  });
}

/**
 * An illustration a rerun must keep: it is in the text (its figure still opens its studio), or its studio
 * holds something that was typed, paid for or is in flight. Only untouched suggestions are replaced.
 */
export function isKeptOnReplace(item: V2ReviewItem): boolean {
  return getItemKind(item) === "visual" && (item.status === "applied" || (isOpenItem(item) && isStudioTouched(item.studio)));
}

/** The items a run in `replace` mode starts from: everything of other steps, and what must outlive a rerun. */
function clearForReplaceRun(items: V2ReviewItem[], stepId: EditorialReviewStepId): V2ReviewItem[] {
  const kept = new Set(items.filter((item) => item.stepId === stepId && isKeptOnReplace(item)).map((item) => item.id));
  return items.filter((item) => item.stepId !== stepId || kept.has(item.id));
}

function accentMergeKey(item: V2ReviewItem): string {
  return `${item.anchor.blockIds.join("|")}:${item.emphasisTarget?.text ?? ""}:${item.emphasisTarget?.occurrence ?? 1}`;
}

/**
 * Adds the items a run delivered to the queue. The classic merge keeps one item per recommendation type and
 * anchor, which would drop every accent in a paragraph but the first; accents are told apart by their phrase.
 */
function mergeIncoming(input: {
  current: V2ReviewItem[];
  incoming: EditorialReviewItem[];
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  stepId: EditorialReviewStepId;
}): V2ReviewItem[] {
  if (input.stepId !== "emphasis") {
    // An illustration that is already there for a place (kept through a rerun, or inserted) is the one for
    // that place: a new suggestion for the same paragraphs or the same insertion point is not a second card.
    const held = input.current.filter((item) => getItemKind(item) === "visual" && (isOpenItem(item) || item.status === "applied"));
    const heldAnchors = new Set(held.map((item) => item.anchor.blockIds.join("|")));
    const heldPlaces = new Set(held.map((item) => item.insertionPoint.anchorBlockId));
    const incoming = input.incoming.filter(
      (item) =>
        item.recommendationType !== "visual" ||
        (!heldAnchors.has(item.anchor.blockIds.join("|")) && !heldPlaces.has(item.insertionPoint.anchorBlockId))
    );

    return sortItems(mergeIncomingReviewItems({ ...input, incoming }) as V2ReviewItem[], input.document);
  }

  const seenIds = new Set(input.current.map((item) => item.id));
  const seenKeys = new Set(input.current.filter((item) => item.stepId === input.stepId).map(accentMergeKey));
  const additions = input.incoming
    .map((item): V2ReviewItem => ({ ...item, stepId: input.stepId }))
    .filter((item) => {
      const key = accentMergeKey(item);

      if (seenIds.has(item.id) || seenKeys.has(key)) {
        return false;
      }

      seenIds.add(item.id);
      seenKeys.add(key);
      return true;
    });

  return sortItems([...input.current, ...additions], input.document);
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

  const failed: Record<string, string> = {};

  for (const [itemId, proposal] of Object.entries(state.proposals)) {
    if (proposal.status === "failed") {
      failed[itemId] = proposal.message;
    }
  }

  const steps: Partial<Record<V2StepRunId, V2PassState>> = {};

  for (const [runId, step] of Object.entries(state.steps) as Array<[V2StepRunId, V2PassState]>) {
    steps[runId] = step.status === "running" && !state.activeRun ? { status: "idle" } : step;
  }

  const { history, plan, planInstruction, holes, chapterEntryId, instruction, retryIndex } = state.request;

  return {
    failed,
    steps,
    overview: state.overview,
    // A fragment request in flight and a question on screen do not survive a reload.
    request: { history, plan, planInstruction, holes, chapterEntryId, instruction, retryIndex },
    passes,
    // A request in flight does not survive a reload; the item is simply pending again. So is the studio of
    // an illustration: only a generation job the server has named is kept, to be asked about again.
    items: state.items.map((item) => {
      const studio = item.studio ? serializeStudioData(item.studio) : undefined;

      return item.status === "preparing" || studio !== item.studio
        ? { ...item, status: item.status === "preparing" ? "pending" : item.status, ...(studio ? { studio } : {}) }
        : item;
    }),
    visualPrefs: state.visualPrefs,
    proposals,
    // What a decision keeps for undo (its proposal, what a rejection replaced) does not survive a reload.
    decisions: state.decisions.map(({ proposal: _proposal, restore: _restore, ...decision }) => decision),
    rejectedIdeas: state.rejectedIdeas,
    activeRun: state.activeRun,
    filter: state.filter,
    // Quiet mode spends model calls on its own, so it is never switched on by a reload.
    quiet: false,
    queue: state.queue
  };
}

function restoreReviewState(persisted: V2PersistedReview): V2ReviewState {
  const proposals: Record<string, V2ProposalState> = {};

  for (const item of persisted.items) {
    const proposal = persisted.proposals[item.id];

    if (proposal && isOpenItem(item)) {
      proposals[item.id] = { status: "ready", proposal, noOpStreak: proposal.textDiff?.warning?.code === "no_op" ? 1 : 0 };
    } else if (persisted.failed?.[item.id] && isOpenItem(item)) {
      // Still failed after a reload: it is retried by the editor, never on its own.
      proposals[item.id] = { status: "failed", message: persisted.failed[item.id]! };
    }
  }

  // `settleItems` turns a ready item without its proposal back into a pending one: it has to be prepared again.
  return settleItems({
    ...createInitialReviewState(),
    steps: persisted.steps ?? {},
    overview: persisted.overview ?? createInitialOverviewState(),
    request: { ...createInitialRequestState(), ...(persisted.request ?? {}) },
    passes: persisted.passes,
    items: persisted.items.map((item) => (item.status === "preparing" ? { ...item, status: "pending" as const } : item)),
    proposals,
    decisions: persisted.decisions,
    rejectedIdeas: persisted.rejectedIdeas,
    activeRun: persisted.activeRun,
    filter: persisted.filter,
    quiet: false,
    visualPrefs: persisted.visualPrefs ?? {},
    queue: persisted.queue ?? [],
    // Whatever waited in the launch queue waits for the editor now.
    queuePaused: (persisted.queue ?? []).length > 0
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
  const items = (Array.isArray(record.items) ? record.items.filter(isStoredReviewItem) : []).map((item): V2ReviewItem => {
    if (item.studio === undefined) {
      return item;
    }

    // Only an illustration has a studio; one that cannot be read starts over.
    const { studio: stored, ...rest } = item;
    const studio = getItemKind(item) === "visual" ? coerceStudioData(stored) : undefined;
    return studio ? { ...rest, studio } : rest;
  });
  const itemIds = new Set(items.map((item) => item.id));
  const passes: Partial<Record<V2PassId, V2PassState>> = {};
  const steps: Partial<Record<V2StepRunId, V2PassState>> = {};

  if (record.passes && typeof record.passes === "object") {
    for (const passId of PASS_IDS) {
      const pass = coercePassState((record.passes as Record<string, unknown>)[passId]);

      if (pass) {
        passes[passId] = pass;
      }
    }
  }

  if (record.steps && typeof record.steps === "object") {
    for (const runId of STEP_RUN_IDS) {
      const step = coercePassState((record.steps as Record<string, unknown>)[runId]);

      if (step) {
        steps[runId] = step;
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
      ...(entry.undone === true ? { undone: true } : {}),
      ...(isStringList(entry.appliedBlockIds) ? { appliedBlockIds: entry.appliedBlockIds } : {}),
      ...(isStringList(entry.insertedBlockIds) ? { insertedBlockIds: entry.insertedBlockIds } : {})
    }));
  const activeRun = coerceActiveRun(record.activeRun);

  // Without a resumable run nothing can be "running" after a reload.
  const resumableRunId = activeRun ? getRunIdForStep(activeRun.run.stepId) : null;

  for (const passId of PASS_IDS) {
    if (passes[passId]?.status === "running" && resumableRunId !== passId) {
      passes[passId] = { status: "idle" };
    }
  }

  for (const runId of STEP_RUN_IDS) {
    if (steps[runId]?.status === "running" && resumableRunId !== runId) {
      steps[runId] = { status: "idle" };
    }
  }

  const failed: Record<string, string> = {};

  if (record.failed && typeof record.failed === "object") {
    for (const [itemId, message] of Object.entries(record.failed as Record<string, unknown>)) {
      if (itemIds.has(itemId) && typeof message === "string" && message) {
        failed[itemId] = message;
      }
    }
  }

  const filter = record.filter === "all" || PASS_IDS.includes(record.filter as V2PassId) ? (record.filter as V2ReviewFilter) : "all";
  const queue = (Array.isArray(record.queue) ? record.queue : []).filter(
    (passId, index, list): passId is V2PassId =>
      PASS_IDS.includes(passId as V2PassId) && Boolean(PASS_STEP_ID[passId as V2PassId]) && list.indexOf(passId) === index
  );

  return {
    passes,
    steps,
    overview: coerceOverviewState(record.overview),
    request: coerceRequestState(record.request, resumableRunId === "request"),
    items,
    proposals,
    decisions,
    rejectedIdeas: normalizeRejectedReviewIdeas(record.rejectedIdeas),
    activeRun,
    filter,
    quiet: false,
    queue,
    failed,
    visualPrefs: coerceVisualPrefs(record.visualPrefs)
  };
}

function coercePassState(value: unknown): V2PassState | null {
  if (!value || typeof value !== "object" || !PASS_STATUSES.includes((value as V2PassState).status)) {
    return null;
  }

  const candidate = value as V2PassState;
  const progress =
    candidate.progress &&
    typeof candidate.progress.completed === "number" &&
    typeof candidate.progress.total === "number" &&
    typeof candidate.progress.percent === "number"
      ? candidate.progress
      : undefined;

  return {
    status: candidate.status,
    error: typeof candidate.error === "string" ? candidate.error : undefined,
    stopped: candidate.stopped === true ? true : undefined,
    warnings: Array.isArray(candidate.warnings) ? candidate.warnings.filter((entry) => typeof entry === "string") : undefined,
    progress:
      progress && progress.phase !== undefined && progress.phase !== "planning" && progress.phase !== "generating"
        ? { completed: progress.completed, total: progress.total, percent: progress.percent }
        : progress,
    lastRunItemCount: typeof candidate.lastRunItemCount === "number" ? candidate.lastRunItemCount : undefined,
    replaceOnResult: candidate.replaceOnResult === true ? true : undefined
  };
}

function coerceOutcome(value: unknown): V2RequestOutcome | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const outcome = value as Record<string, unknown>;

  switch (outcome.kind) {
    case "running":
    case "stopped":
    case "question":
    case "interrupted":
      return { kind: outcome.kind };
    case "error":
      return typeof outcome.message === "string" && outcome.message ? { kind: "error", message: outcome.message } : null;
    case "done":
      return typeof outcome.count === "number" && outcome.count >= 0
        ? {
            kind: "done",
            count: Math.floor(outcome.count),
            ...(typeof outcome.holes === "number" && outcome.holes > 0 ? { holes: Math.floor(outcome.holes) } : {}),
            ...(isStringList(outcome.warnings) && outcome.warnings.length > 0 ? { warnings: outcome.warnings } : {})
          }
        : null;
    default:
      return null;
  }
}

const PLAN_TYPES = new Set(["rewrite", "simplify", "expand", "list", "subsection", "callout", "visual"]);
const PLAN_PRIORITIES = new Set(["high", "medium", "low"]);

function coercePlanAction(value: unknown): CustomRequestPlanAction | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const action = value as Partial<CustomRequestPlanAction>;
  return typeof action.blockId === "string" &&
    typeof action.title === "string" &&
    typeof action.recommendation === "string" &&
    PLAN_TYPES.has(action.recommendationType as string) &&
    PLAN_PRIORITIES.has(action.priority as string)
    ? {
        blockId: action.blockId,
        recommendationType: action.recommendationType!,
        title: action.title,
        recommendation: action.recommendation,
        priority: action.priority!
      }
    : null;
}

/**
 * Reads the request part of a stored draft. A request that was "running" when the page went away is running
 * still only when it is the chapter request whose run can be resumed; a fragment request cannot be, so it is
 * recorded as interrupted and nothing is sent again.
 */
function coerceRequestState(value: unknown, chapterRunResumable: boolean): NonNullable<V2PersistedReview["request"]> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const chapterEntryId = typeof record.chapterEntryId === "string" ? record.chapterEntryId : null;
  const history: V2RequestEntry[] = [];

  for (const raw of Array.isArray(record.history) ? record.history : []) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const entry = raw as Partial<V2RequestEntry>;
    const outcome = coerceOutcome(entry.outcome);

    if (typeof entry.id !== "string" || typeof entry.text !== "string" || !outcome || (entry.scope !== "chapter" && entry.scope !== "fragment")) {
      continue;
    }

    const live = outcome.kind === "running" && entry.scope === "chapter" && entry.id === chapterEntryId && chapterRunResumable;

    history.push({
      id: entry.id,
      scope: entry.scope,
      text: entry.text,
      ...(typeof entry.quote === "string" && entry.quote ? { quote: entry.quote } : {}),
      ...(typeof entry.where === "string" && entry.where ? { where: entry.where } : {}),
      at: typeof entry.at === "string" ? entry.at : "",
      outcome: (outcome.kind === "running" && !live) || outcome.kind === "question" ? { kind: "interrupted" } : outcome
    });
  }

  const rawPlan = Array.isArray(record.plan) ? record.plan : [];
  const plan = rawPlan.map(coercePlanAction).filter((action): action is CustomRequestPlanAction => action !== null);
  const holes = (Array.isArray(record.holes) ? record.holes : []).filter(
    (hole): hole is V2RequestHole =>
      Boolean(hole) &&
      typeof hole === "object" &&
      Number.isInteger((hole as V2RequestHole).index) &&
      (hole as V2RequestHole).index >= 0 &&
      typeof (hole as V2RequestHole).message === "string"
  );

  // A plan is an indexed list: with one action unreadable the indexes of the holes would point elsewhere.
  // And a plan without the instruction it was made for cannot be retried, so it is not kept at all.
  const planInstruction = typeof record.planInstruction === "string" ? record.planInstruction.trim() : "";
  const planUsable = plan.length > 0 && plan.length === rawPlan.length && planInstruction.length > 0;

  return {
    history: history.slice(0, REQUEST_HISTORY_LIMIT),
    plan: planUsable ? plan : null,
    planInstruction: planUsable ? planInstruction : "",
    holes: planUsable ? holes.map((hole) => ({ index: hole.index, message: hole.message })) : [],
    chapterEntryId: chapterEntryId && history.some((entry) => entry.id === chapterEntryId) ? chapterEntryId : null,
    instruction: typeof record.instruction === "string" ? record.instruction : "",
    retryIndex:
      chapterRunResumable && typeof record.retryIndex === "number" && Number.isInteger(record.retryIndex) && record.retryIndex >= 0
        ? record.retryIndex
        : null
  };
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStoredSpellData(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const spell = value as Partial<NonNullable<V2ReviewItem["spell"]>>;
  return Boolean(
    spell.range &&
      Number.isInteger(spell.range.start) &&
      Number.isInteger(spell.range.end) &&
      spell.range.start >= 0 &&
      spell.range.end > spell.range.start &&
      typeof spell.badText === "string" &&
      spell.badText.length === spell.range.end - spell.range.start &&
      isStringList(spell.suggestions) &&
      typeof spell.choice === "number" &&
      typeof spell.blockText === "string" &&
      typeof spell.occurrence === "number"
  );
}

function isStoredReviewItem(value: unknown): value is V2ReviewItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<V2ReviewItem>;

  // A damaged spelling finding has no range to draw or to fix; it is left out like any unreadable item.
  if (item.spell !== undefined && !isStoredSpellData(item.spell)) {
    return false;
  }

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
