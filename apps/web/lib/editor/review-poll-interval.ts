export const REVIEW_POLL_MIN_MS = 1_000;
export const REVIEW_POLL_MAX_MS = 3_000;
const REVIEW_POLL_CHARS_PER_STEP = 40_000;
const REVIEW_POLL_STEP_MS = 500;

export function reviewPollIntervalForDocumentChars(sourceChars: number): number {
  const extraSteps = Math.floor(Math.max(0, sourceChars) / REVIEW_POLL_CHARS_PER_STEP);
  return Math.min(
    REVIEW_POLL_MAX_MS,
    REVIEW_POLL_MIN_MS + extraSteps * REVIEW_POLL_STEP_MS
  );
}

export function resolveReviewPollWaitMs(
  serverPollAfterMs: number | undefined,
  sourceChars: number
): number {
  const serverMs = typeof serverPollAfterMs === "number" && serverPollAfterMs > 0
    ? serverPollAfterMs
    : 0;
  return Math.max(
    REVIEW_POLL_MIN_MS,
    serverMs,
    reviewPollIntervalForDocumentChars(sourceChars)
  );
}
