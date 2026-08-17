import test from "node:test";
import assert from "node:assert/strict";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type {
  EditorialReviewItem,
  EditorialReviewRequest,
  EditorialReviewResponse,
  EditorialReviewRunSnapshot
} from "../lib/editor/review-contract.ts";
import { isEditorialReviewRunApiResponse } from "../lib/editor/review-contract.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";
import type { ReviewChunkPlan } from "../lib/server/review-chunk-planner.ts";
import {
  alignReviewItemsToSnapshot,
  buildRunningReviewApiResponse,
  classifyReviewChunkFailure,
  consumeReadableBatches,
  filterCoreReviewChunkItems,
  latestReviewProgress,
  mapInWaves,
  reviewRunPollAfterMs,
  summarizeReviewChunkRun
} from "../lib/server/review-chunk-runtime.ts";

test("filterCoreReviewChunkItems drops cards anchored on context-only blocks", () => {
  const items = [
    itemFor("p1", "simplify"),
    itemFor("p2", "rewrite"),
    itemFor("p3", "expand")
  ];

  assert.deepEqual(
    filterCoreReviewChunkItems(items, ["p1", "p3"]).map((item) => item.anchor.blockIds[0]),
    ["p1", "p3"]
  );
});

test("summarizeReviewChunkRun after 2 of 10 chunks exposes prefix items and character progress", () => {
  const { request, chunks } = createTenChunkFixture();
  const responses = [
    successResponse([itemFor("p1", "simplify")]),
    successResponse([itemFor("p2", "rewrite")])
  ];

  const summary = summarizeReviewChunkRun(request, chunks, responses);
  const envelope = buildRunningReviewApiResponse({
    run: runningSnapshot(summary.progress),
    capability: "cap-test",
    itemBatches: [summary.items.slice(0, 1), summary.items.slice(1)]
  });

  assert.equal(summary.items.length, 2);
  assert.deepEqual(summary.items.map((item) => item.anchor.blockIds[0]), ["p1", "p2"]);
  assert.equal(summary.progress.completedChunks, 2);
  assert.equal(summary.progress.totalChunks, 10);
  assert.equal(summary.progress.completedSourceChars, chunks[0].sourceChars + chunks[1].sourceChars);
  assert.equal(summary.progress.totalSourceChars, chunks.reduce((total, chunk) => total + chunk.sourceChars, 0));
  assert.equal(summary.failedChunks.length, 0);
  assert.equal(isEditorialReviewRunApiResponse(envelope), true);
  assert.equal(envelope.kind, "run");
  assert.equal(envelope.items?.length, 2);
});

test("summarizeReviewChunkRun keeps prefix items when chunk 3 is a hole and later chunks succeed", () => {
  const { request, chunks } = createTenChunkFixture();
  const responses = chunks.map((chunk, index) => {
    if (index === 2) {
      return errorResponse("Фрагмент перевищив таймаут.");
    }

    return successResponse([itemFor(chunk.coreBlockIds[0], "simplify")]);
  });

  const summary = summarizeReviewChunkRun(request, chunks, responses);

  assert.equal(summary.items.length, 9);
  assert.equal(summary.items.some((item) => item.anchor.blockIds[0] === "p3"), false);
  assert.deepEqual(summary.failedChunks, [{
    index: 2,
    coreBlockIds: ["p3"],
    message: "Фрагмент перевищив таймаут."
  }]);
  assert.equal(summary.progress.completedChunks, 9);
  assert.equal(summary.progress.completedSourceChars, summary.progress.totalSourceChars! - chunks[2].sourceChars);
});

test("classifyReviewChunkFailure retries then holes, and treats missing keys as fatal", () => {
  assert.equal(classifyReviewChunkFailure({
    error: "OpenAI перевищив таймаут 280с.",
    providerError: { code: "timeout", retryable: true },
    attempt: 1
  }), "retry");
  assert.equal(classifyReviewChunkFailure({
    error: "OpenAI перевищив таймаут 280с.",
    providerError: { code: "timeout", retryable: true },
    attempt: 3
  }), "hole");
  assert.equal(classifyReviewChunkFailure({
    error: "Invalid JSON",
    providerError: { code: "invalid_output", retryable: false },
    attempt: 1
  }), "hole");
  assert.equal(classifyReviewChunkFailure({
    error: "Немає API key для OpenAI у формі або .env.",
    attempt: 1
  }), "fatal");
  assert.equal(classifyReviewChunkFailure({
    error: "Unauthorized",
    providerError: { code: "http_error", retryable: false, status: 401 },
    attempt: 1
  }), "fatal");
});

test("alignReviewItemsToSnapshot rewrites chunk-local revision and indexes onto the frozen document", () => {
  const { request } = createTenChunkFixture();
  const aligned = alignReviewItemsToSnapshot(
    [{
      ...itemFor("p4", "simplify"),
      documentRevisionId: "chunk-local-revision",
      anchor: {
        ...itemFor("p4", "simplify").anchor,
        generationBlockRange: { start: 0, end: 0 }
      }
    }],
    request
  );

  assert.equal(aligned[0]?.documentRevisionId, request.revision.documentRevisionId);
  assert.deepEqual(aligned[0]?.anchor.generationBlockRange, { start: 3, end: 3 });
});

test("consumeReadableBatches concatenates GET prefix item batches including after a hole", async () => {
  const stream = new ReadableStream<EditorialReviewItem[]>({
    start(controller) {
      controller.enqueue([itemFor("p1", "simplify")]);
      controller.enqueue([itemFor("p2", "rewrite")]);
      controller.close();
    }
  });
  const batches = await consumeReadableBatches(stream.getReader());
  const envelope = buildRunningReviewApiResponse({
    run: runningSnapshot({
      completedChunks: 2,
      totalChunks: 10,
      completedSourceChars: 3200,
      totalSourceChars: 16000,
      failedChunks: [{ index: 2, coreBlockIds: ["p3"], message: "timeout" }]
    }),
    capability: "cap-test",
    itemBatches: batches
  });

  assert.equal(isEditorialReviewRunApiResponse(envelope), true);
  assert.deepEqual(envelope.items?.map((item) => item.anchor.blockIds[0]), ["p1", "p2"]);
  assert.equal(isEditorialReviewRunApiResponse({
    kind: "error",
    error: { code: "workflow_failed", message: "fatal after prefix", retryable: false },
    run: envelope.run,
    items: envelope.items
  }), true);
});

test("latestReviewProgress keeps the last written chunk progress", () => {
  assert.equal(latestReviewProgress([]), undefined);
  assert.deepEqual(latestReviewProgress([
    { completedChunks: 0, totalChunks: 8, completedSourceChars: 0, totalSourceChars: 128000 },
    { completedChunks: 1, totalChunks: 8, completedSourceChars: 16000, totalSourceChars: 128000 }
  ]), {
    completedChunks: 1,
    totalChunks: 8,
    completedSourceChars: 16000,
    totalSourceChars: 128000
  });
});

test("reviewRunPollAfterMs slows chunked running polls and keeps pending snappy", () => {
  assert.equal(reviewRunPollAfterMs("pending", "clarity"), 900);
  assert.equal(reviewRunPollAfterMs("running", "clarity"), 3000);
  assert.equal(reviewRunPollAfterMs("running", "diagnostics"), 2000);
  assert.equal(reviewRunPollAfterMs("completed", "clarity"), 0);
});

test("mapInWaves runs at most the requested concurrency", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const order: number[] = [];

  const results = await mapInWaves([1, 2, 3, 4], 3, async (value) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    order.push(value);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    return value * 10;
  });

  assert.deepEqual(results, [10, 20, 30, 40]);
  assert.equal(maxInFlight, 3);
  assert.deepEqual(order.slice(0, 3).sort((left, right) => left - right), [1, 2, 3]);
  assert.equal(order[3], 4);
});

function createTenChunkFixture(): { request: EditorialReviewRequest; chunks: ReviewChunkPlan[] } {
  const document: EditorDocument = {
    version: 2,
    blocks: Array.from({ length: 10 }, (_, index) => ({
      id: `p${index + 1}`,
      type: "paragraph" as const,
      content: [{ text: `абзац ${index + 1} ${"т".repeat(80)}` }]
    }))
  };
  const request: EditorialReviewRequest = {
    document,
    revision: deriveManuscriptRevisionState(document),
    locale: "uk",
    provider: "openai",
    modelId: "gpt-5.6-sol",
    changeLevel: 3,
    stepId: "clarity",
    runMode: "replace"
  };
  const chunks: ReviewChunkPlan[] = document.blocks.map((block, index) => ({
    index,
    startBlockIndex: index,
    endBlockIndex: index + 1,
    sourceChars: 1600,
    coreBlockIds: [block.id],
    contextBlockIds: [],
    blocks: [block]
  }));

  return { request, chunks };
}

function itemFor(blockId: string, recommendationType: EditorialReviewItem["recommendationType"]): EditorialReviewItem {
  return {
    id: `item-${blockId}-${recommendationType}`,
    reviewSessionId: "review-session-source",
    documentRevisionId: "revision-source",
    changeLevel: 3,
    title: "Спростити",
    reason: "Щільний фрагмент",
    recommendation: "Переписати простіше.",
    recommendationType,
    suggestedAction: "rewrite_text",
    priority: "high",
    anchor: {
      blockIds: [blockId],
      generationBlockRange: { start: 0, end: 0 },
      excerpt: "фрагмент",
      fingerprint: `fingerprint-${blockId}`
    },
    insertionPoint: { mode: "replace", anchorBlockId: blockId },
    stepId: "clarity",
    stepRunId: "step-run-source",
    status: "pending"
  };
}

function successResponse(items: EditorialReviewItem[]): EditorialReviewResponse {
  return {
    reviewSessionId: "review-session-source",
    stepId: "clarity",
    stepRunId: "step-run-source",
    runMode: "replace",
    items,
    factCheckRows: [],
    providerUsed: "openai",
    usedFallback: false,
    diagnostics: {
      requestId: "request-source",
      reviewSessionId: "review-session-source",
      stepId: "clarity",
      stepRunId: "step-run-source",
      runMode: "replace",
      requestedProvider: "openai",
      requestedModelId: "gpt-5.6-sol",
      blockCount: 1,
      changeLevel: 3,
      returnedItemCount: items.length,
      returnedFactCheckCount: 0,
      droppedItemCount: 0,
      generatedAt: "2026-08-12T12:00:00.000Z"
    }
  };
}

function errorResponse(message: string): EditorialReviewResponse {
  return {
    ...successResponse([]),
    error: message,
    diagnostics: {
      ...successResponse([]).diagnostics,
      providerError: { code: "timeout", retryable: true }
    }
  };
}

function runningSnapshot(progress: EditorialReviewRunSnapshot["progress"]): EditorialReviewRunSnapshot {
  return {
    runId: "wrun_test",
    documentRevisionId: "revision-source",
    stepId: "clarity",
    locale: "uk",
    provider: "openai",
    modelId: "gpt-5.6-sol",
    runMode: "replace",
    createdAt: "2026-08-12T12:00:00.000Z",
    updatedAt: "2026-08-12T12:00:01.000Z",
    status: "running",
    pollAfterMs: 2000,
    progress
  };
}
