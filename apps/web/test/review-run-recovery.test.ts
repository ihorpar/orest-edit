import test from "node:test";
import assert from "node:assert/strict";
import type { EditorialReviewResponse, EditorialReviewRunSnapshot } from "../lib/editor/review-contract.ts";
import {
  interpretCompletedEditorialReviewReturnValue,
  interpretReviewRunPollBody,
  isActiveStepReviewRunning,
  isReviewPollPlatformFailureText,
  isTransientReviewPollFetchError,
  resolveReviewPollFetchTimeoutMs,
  resolveReviewRunStartIntent,
  sanitizeExposedErrorMessage,
  shouldAbandonReviewRunAfterPollError,
  shouldShowReviewRunChrome,
  toTerminalFailedRunSnapshot
} from "../lib/editor/review-run-recovery.ts";

const invalidMessage = "The review run finished without a valid result. Run the step again.";

test("resolveReviewRunStartIntent never hijacks Start on another step", () => {
  assert.equal(resolveReviewRunStartIntent({
    requestedStepId: "emphasis",
    thisTabOwnsPoll: false
  }), "start");

  assert.equal(resolveReviewRunStartIntent({
    requestedStepId: "emphasis",
    existingStepId: "emphasis",
    existingStale: false,
    existingTerminal: false,
    thisTabOwnsPoll: false
  }), "resume");

  assert.equal(resolveReviewRunStartIntent({
    requestedStepId: "emphasis",
    existingStepId: "final_editing",
    existingStale: false,
    existingTerminal: false,
    thisTabOwnsPoll: true
  }), "block_other_step");

  assert.equal(resolveReviewRunStartIntent({
    requestedStepId: "emphasis",
    existingStepId: "final_editing",
    existingStale: false,
    existingTerminal: false,
    thisTabOwnsPoll: false,
    otherTabOwnsPoll: true
  }), "block_other_step");

  assert.equal(resolveReviewRunStartIntent({
    requestedStepId: "emphasis",
    existingStepId: "final_editing",
    existingStale: false,
    existingTerminal: false,
    thisTabOwnsPoll: false,
    otherTabOwnsPoll: false
  }), "replace_zombie");

  assert.equal(resolveReviewRunStartIntent({
    requestedStepId: "clarity",
    existingStepId: "final_editing",
    existingStale: false,
    existingTerminal: true,
    thisTabOwnsPoll: false
  }), "start");
});

test("shouldShowReviewRunChrome stays on the run's own step", () => {
  assert.equal(shouldShowReviewRunChrome({
    viewingStepId: "emphasis",
    runStepId: "final_editing",
    inFlight: true,
    failedChunkCount: 9
  }), false);

  assert.equal(shouldShowReviewRunChrome({
    viewingStepId: "emphasis",
    startingStepId: "emphasis",
    inFlight: true,
    failedChunkCount: 0
  }), true);

  assert.equal(shouldShowReviewRunChrome({
    viewingStepId: "final_editing",
    runStepId: "final_editing",
    inFlight: false,
    failedChunkCount: 9
  }), true);

  assert.equal(shouldShowReviewRunChrome({
    viewingStepId: "emphasis",
    runStepId: "emphasis",
    inFlight: true,
    failedChunkCount: 0
  }), true);

  assert.equal(shouldShowReviewRunChrome({
    viewingStepId: "diagnostics",
    runStepId: "diagnostics",
    inFlight: true,
    failedChunkCount: 0
  }), false);
});

test("isActiveStepReviewRunning scopes loading to the started step", () => {
  assert.equal(isActiveStepReviewRunning({
    viewingStepId: "emphasis",
    runStepId: "final_editing",
    inFlight: true
  }), false);

  assert.equal(isActiveStepReviewRunning({
    viewingStepId: "emphasis",
    startingStepId: "emphasis",
    inFlight: true
  }), true);

  assert.equal(isActiveStepReviewRunning({
    viewingStepId: "clarity",
    startingStepId: "emphasis",
    inFlight: true
  }), false);

  assert.equal(isActiveStepReviewRunning({
    viewingStepId: "emphasis",
    runStepId: undefined,
    inFlight: true
  }), false);

  assert.equal(isActiveStepReviewRunning({
    viewingStepId: "emphasis",
    runStepId: "emphasis",
    inFlight: true
  }), true);
});

test("sanitizeExposedErrorMessage hides raw TypeError text", () => {
  assert.equal(
    sanitizeExposedErrorMessage("Cannot read properties of undefined (reading 'requestId')", invalidMessage),
    invalidMessage
  );
  assert.equal(
    sanitizeExposedErrorMessage("Provider timed out after 280s.", invalidMessage),
    "Provider timed out after 280s."
  );
});

test("interpretCompletedEditorialReviewReturnValue rejects completed payloads without diagnostics", () => {
  assert.deepEqual(
    interpretCompletedEditorialReviewReturnValue({ error: "failed" }, invalidMessage),
    { ok: false, message: invalidMessage }
  );
  assert.deepEqual(
    interpretCompletedEditorialReviewReturnValue(undefined, invalidMessage),
    { ok: false, message: invalidMessage }
  );

  const valid: EditorialReviewResponse = {
    reviewSessionId: "session-1",
    stepId: "final_editing",
    stepRunId: "step-1",
    runMode: "replace",
    items: [],
    providerUsed: "openai",
    usedFallback: false,
    diagnostics: {
      requestId: "request-1",
      reviewSessionId: "session-1",
      stepId: "final_editing",
      stepRunId: "step-1",
      runMode: "replace",
      requestedProvider: "openai",
      requestedModelId: "gpt-5.6-luna",
      blockCount: 1,
      changeLevel: 5,
      returnedItemCount: 0,
      returnedFactCheckCount: 0,
      droppedItemCount: 0,
      generatedAt: "2026-08-17T12:00:00.000Z"
    }
  };

  assert.deepEqual(interpretCompletedEditorialReviewReturnValue(valid, invalidMessage), {
    ok: true,
    result: valid
  });
});

test("toTerminalFailedRunSnapshot marks a completed zombie as failed", () => {
  const run: EditorialReviewRunSnapshot = {
    runId: "wrun_test",
    documentRevisionId: "revision-1",
    stepId: "final_editing",
    locale: "uk",
    provider: "openai",
    modelId: "gpt-5.6-luna",
    runMode: "replace",
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-17T12:00:01.000Z",
    status: "completed",
    pollAfterMs: 1500
  };

  assert.equal(toTerminalFailedRunSnapshot(run).status, "failed");
  assert.equal(toTerminalFailedRunSnapshot(run).pollAfterMs, 0);
});

test("interpretReviewRunPollBody maps Vercel HTML timeouts instead of JSON parse errors", () => {
  const platform = interpretReviewRunPollBody(
    "An error occurred with your deployment\nFUNCTION_INVOCATION_TIMEOUT",
    { invalid: "invalid", platformTimeout: "platform-timeout" }
  );
  assert.deepEqual(platform, { ok: false, message: "platform-timeout" });
  assert.equal(isReviewPollPlatformFailureText("FUNCTION_INVOCATION_TIMEOUT"), true);

  const invalid = interpretReviewRunPollBody("<html>oops</html>", {
    invalid: "invalid",
    platformTimeout: "platform-timeout"
  });
  assert.deepEqual(invalid, { ok: false, message: "invalid" });

  const ok = interpretReviewRunPollBody("{\"kind\":\"run\"}", {
    invalid: "invalid",
    platformTimeout: "platform-timeout"
  });
  assert.deepEqual(ok, { ok: true, payload: { kind: "run" } });
});

test("shouldAbandonReviewRunAfterPollError keeps a superseded poll alive", () => {
  assert.equal(
    shouldAbandonReviewRunAfterPollError(new Error("review_job_superseded"), "review_job_superseded"),
    false
  );
  assert.equal(
    shouldAbandonReviewRunAfterPollError(new Error("Unexpected token 'A'"), "review_job_superseded"),
    true
  );
  assert.equal(shouldAbandonReviewRunAfterPollError("not-an-error", "review_job_superseded"), true);
});

test("resolveReviewPollFetchTimeoutMs scales with manuscript length", () => {
  assert.equal(resolveReviewPollFetchTimeoutMs(8_000), 12_000);
  assert.equal(resolveReviewPollFetchTimeoutMs(80_000), 20_000);
  assert.equal(resolveReviewPollFetchTimeoutMs(400_000), 45_000);
});

test("isTransientReviewPollFetchError treats abort and network failures as retryable", () => {
  assert.equal(isTransientReviewPollFetchError(new DOMException("Aborted", "AbortError")), true);
  assert.equal(isTransientReviewPollFetchError(new Error("Failed to fetch")), true);
  assert.equal(isTransientReviewPollFetchError(new Error("Unexpected token 'A'")), false);
});
