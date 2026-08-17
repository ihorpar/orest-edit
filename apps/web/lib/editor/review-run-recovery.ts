import type { EditorialReviewResponse, EditorialReviewRunSnapshot, EditorialReviewStepId } from "./review-contract.ts";
import { isEditorialReviewResponse } from "./review-contract.ts";

export type ReviewRunStartIntent = "start" | "resume" | "block_other_step" | "replace_zombie";

const INTERNAL_JS_ERROR_PATTERN =
  /cannot read propert(?:y|ies) of (?:undefined|null)|is not a function|undefined is not (?:an object|a function)|null is not an object/i;

export function resolveReviewRunStartIntent(input: {
  requestedStepId: EditorialReviewStepId;
  existingStepId?: EditorialReviewStepId | null;
  existingStale?: boolean;
  existingTerminal?: boolean;
  thisTabOwnsPoll: boolean;
  otherTabOwnsPoll?: boolean;
}): ReviewRunStartIntent {
  if (!input.existingStepId || input.existingStale || input.existingTerminal) {
    return "start";
  }

  if (input.existingStepId === input.requestedStepId) {
    return "resume";
  }

  if (input.thisTabOwnsPoll || input.otherTabOwnsPoll) {
    return "block_other_step";
  }

  return "replace_zombie";
}

export function shouldShowReviewRunChrome(input: {
  viewingStepId: string;
  runStepId?: string | null;
  startingStepId?: string | null;
  inFlight: boolean;
  failedChunkCount: number;
}): boolean {
  if (
    input.viewingStepId === "diagnostics" ||
    input.viewingStepId === "fact_check" ||
    input.viewingStepId === "spellcheck"
  ) {
    return false;
  }

  const scopedStepId = input.runStepId ?? input.startingStepId;
  if (scopedStepId && scopedStepId !== input.viewingStepId) {
    return false;
  }

  return input.failedChunkCount > 0 || input.inFlight;
}

export function isActiveStepReviewRunning(input: {
  viewingStepId: string;
  runStepId?: string | null;
  startingStepId?: string | null;
  inFlight: boolean;
}): boolean {
  if (!input.inFlight || input.viewingStepId === "spellcheck") {
    return false;
  }

  const scopedStepId = input.runStepId ?? input.startingStepId;
  return Boolean(scopedStepId && scopedStepId === input.viewingStepId);
}

export function isInternalJavaScriptErrorMessage(message: string): boolean {
  return INTERNAL_JS_ERROR_PATTERN.test(message.trim());
}

export function sanitizeExposedErrorMessage(message: string, fallback: string): string {
  const trimmed = message.trim();
  if (!trimmed || isInternalJavaScriptErrorMessage(trimmed)) {
    return fallback;
  }

  return trimmed;
}

export function interpretCompletedEditorialReviewReturnValue(
  value: unknown,
  invalidMessage: string
): { ok: true; result: EditorialReviewResponse } | { ok: false; message: string } {
  if (!isEditorialReviewResponse(value)) {
    return { ok: false, message: invalidMessage };
  }

  return { ok: true, result: value };
}

export function toTerminalFailedRunSnapshot(
  run: EditorialReviewRunSnapshot
): EditorialReviewRunSnapshot & { status: "failed" } {
  return {
    ...run,
    status: "failed",
    pollAfterMs: 0
  };
}
