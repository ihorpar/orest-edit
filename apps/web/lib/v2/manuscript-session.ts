import { getBlockText, type EditorDocument } from "../editor/document-model.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import type { V2HistoryEntry } from "./history.ts";
import { coercePersistedReview, type V2PersistedReview } from "./store.ts";

/**
 * Replacing the whole manuscript: clearing it, opening another text over it, starting over after an
 * unreadable draft. None of these happens on one click: the request is held until the editor confirms it,
 * and what a clear or an open replaced is kept for the session, so it can be brought back.
 *
 * The session keeps the last `RECOVERY_LIMIT` replaced manuscripts, newest first. Each belongs to the
 * language and draft it was taken from and can only be brought back there.
 */

export type ManuscriptRequest =
  | { kind: "clear" }
  | { kind: "open"; source: "file" | "clipboard" }
  /** `Почати заново` for a v2 draft that cannot be read. Nothing can be kept for recovery. */
  | { kind: "restart" };

/** What a clear or an open replaced; kept in memory only, until the page is reloaded. */
export interface RecoverySnapshot {
  id: string;
  reason: "clear" | "open";
  /** The interface language and the draft key the manuscript belonged to. */
  locale: AppLocale;
  draftKey: string;
  document: EditorDocument;
  sourceName: string | null;
  review: V2PersistedReview;
  history: V2HistoryEntry[];
  at: string;
}

/** Most replaced manuscripts the session keeps. */
export const RECOVERY_LIMIT = 3;

export interface ManuscriptGuardState {
  /** The request waiting for the editor's confirmation. */
  pending: ManuscriptRequest | null;
  /** Replaced manuscripts, newest first, at most `RECOVERY_LIMIT`. */
  recovery: RecoverySnapshot[];
}

export type ManuscriptGuardEvent =
  | { type: "requested"; request: ManuscriptRequest }
  | { type: "cancelled" }
  /** The editor confirmed: the request is carried out by the caller, which then reports `replaced`. */
  | { type: "confirmed" }
  | { type: "replaced"; snapshot: RecoverySnapshot | null }
  /** This snapshot is back in the editor and leaves the list. */
  | { type: "restored"; id: string }
  /** The workspace now shows another draft (another language): nothing held belongs to it. */
  | { type: "reset" };

export const INITIAL_GUARD_STATE: ManuscriptGuardState = { pending: null, recovery: [] };

/** True when the manuscript holds anything worth asking about: text, or a block that is not text. */
export function hasManuscriptContent(document: EditorDocument | null): boolean {
  return Boolean(
    document?.blocks.some((block) => (block.type === "image" || block.type === "divider" || block.type === "table" ? true : getBlockText(block).trim().length > 0))
  );
}

/** True when there is work beside the text that a replacement would take away. */
export function hasReviewWork(review: V2PersistedReview | null, history: V2HistoryEntry[]): boolean {
  return Boolean(
    history.length > 0 ||
      (review &&
        (review.items.length > 0 ||
          review.activeRun ||
          (review.queue ?? []).length > 0 ||
          (review.overview?.authorQueries ?? []).length > 0 ||
          review.overview?.diagnostics ||
          review.overview?.factCheck ||
          (review.request?.history ?? []).length > 0))
  );
}

/**
 * What a request does when it is made: `confirm` holds it for the editor's answer, `proceed` lets it run at
 * once. Clearing and starting over always ask; opening asks only when something would be replaced.
 */
export function resolveManuscriptRequest(
  request: ManuscriptRequest,
  context: { document: EditorDocument | null; review: V2PersistedReview | null; history: V2HistoryEntry[] }
): "confirm" | "proceed" {
  if (request.kind === "clear" || request.kind === "restart") {
    return "confirm";
  }

  return hasManuscriptContent(context.document) || hasReviewWork(context.review, context.history) ? "confirm" : "proceed";
}

/**
 * What the confirmation may promise about the manuscript that is about to be replaced:
 * - `none`: nothing will be kept (starting over, or a draft the editor could not show);
 * - `kept`: it joins the list of recoverable manuscripts;
 * - `kept_drops_oldest`: it joins the list, and the oldest one held (`dropped`) leaves it for good.
 */
export type RecoveryPromise = { kind: "none" } | { kind: "kept" } | { kind: "kept_drops_oldest"; dropped: RecoverySnapshot };

export function describeRecoveryPromise(request: ManuscriptRequest, state: ManuscriptGuardState, canSnapshot: boolean): RecoveryPromise {
  if (request.kind === "restart" || !canSnapshot) {
    return { kind: "none" };
  }

  return state.recovery.length >= RECOVERY_LIMIT ? { kind: "kept_drops_oldest", dropped: state.recovery[state.recovery.length - 1]! } : { kind: "kept" };
}

export function manuscriptGuardReducer(state: ManuscriptGuardState, event: ManuscriptGuardEvent): ManuscriptGuardState {
  switch (event.type) {
    case "requested":
      return { ...state, pending: event.request };
    case "cancelled":
    case "confirmed":
      return state.pending ? { ...state, pending: null } : state;
    case "replaced":
      // A replacement with nothing worth keeping leaves the list as it is.
      return event.snapshot ? { ...state, recovery: [event.snapshot, ...state.recovery].slice(0, RECOVERY_LIMIT) } : state;
    case "restored":
      return state.recovery.some((snapshot) => snapshot.id === event.id)
        ? { ...state, recovery: state.recovery.filter((snapshot) => snapshot.id !== event.id) }
        : state;
    case "reset":
      return state.pending === null && state.recovery.length === 0 ? state : INITIAL_GUARD_STATE;
  }
}

/** A snapshot goes back only into the language and the draft it was taken from. */
export function canRestoreSnapshot(snapshot: RecoverySnapshot, target: { locale: AppLocale; draftKey: string }): boolean {
  return snapshot.locale === target.locale && snapshot.draftKey === target.draftKey;
}

/**
 * The snapshot a clear or an open leaves behind. Runs do not come back: the run in flight was cancelled on
 * the server and the launch queue was emptied, so bringing the document back never starts a paid call.
 */
export function createRecoverySnapshot(input: {
  id: string;
  reason: "clear" | "open";
  locale: AppLocale;
  draftKey: string;
  document: EditorDocument;
  sourceName: string | null;
  review: V2PersistedReview;
  history: V2HistoryEntry[];
  at: string;
}): RecoverySnapshot | null {
  if (!hasManuscriptContent(input.document) && !hasReviewWork(input.review, input.history)) {
    return null;
  }

  const settle = <T extends { status: string }>(entry: T): T => (entry.status === "running" ? ({ status: "idle" } as T) : entry);
  const passes = Object.fromEntries(Object.entries(input.review.passes).map(([id, pass]) => [id, pass ? settle(pass) : pass]));
  const steps = input.review.steps
    ? Object.fromEntries(Object.entries(input.review.steps).map(([id, step]) => [id, step ? settle(step) : step]))
    : undefined;
  const stripped = structuredClone({
    ...input.review,
    passes,
    ...(steps ? { steps } : {}),
    activeRun: null,
    queue: [],
    quiet: false
  });

  return {
    id: input.id,
    reason: input.reason,
    locale: input.locale,
    draftKey: input.draftKey,
    document: structuredClone(input.document),
    sourceName: input.sourceName,
    // Read back the way a stored draft is: a request that was running is marked as interrupted, not as running.
    review: coercePersistedReview(stripped) ?? (stripped as V2PersistedReview),
    history: structuredClone(input.history),
    at: input.at
  };
}
