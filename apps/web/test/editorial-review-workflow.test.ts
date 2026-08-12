import test from "node:test";
import assert from "node:assert/strict";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type {
  EditorialReviewItem,
  EditorialReviewRequest,
  EditorialReviewResponse
} from "../lib/editor/review-contract.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";
import {
  parseEditorialReviewWorkflowFailure
} from "../lib/server/editorial-review-workflow.ts";
import type { EmphasisChunkPlan } from "../lib/server/emphasis-chunk-planner.ts";
import {
  mergeDurableEmphasisChunkResponses,
  mergeDurableRecommendationChunkResponses
} from "../lib/server/review-service.ts";
import { classifyReviewChunkFailure } from "../lib/server/review-chunk-runtime.ts";

test("parseEditorialReviewWorkflowFailure preserves provider retry diagnostics", () => {
  const payload = Buffer.from(JSON.stringify({
    message: "Provider is busy",
    retryable: true,
    status: 429,
    requestId: "provider-request-1",
    retryAfterMs: 3000
  }), "utf8").toString("base64url");

  assert.deepEqual(
    parseEditorialReviewWorkflowFailure(`FatalError: OREST_PROVIDER_ERROR:${payload}`),
    {
      message: "Provider is busy",
      retryable: true,
      status: 429,
      requestId: "provider-request-1",
      retryAfterMs: 3000
    }
  );
  assert.equal(parseEditorialReviewWorkflowFailure("unstructured workflow failure"), null);
});

test("mergeDurableEmphasisChunkResponses keeps core results in document order and drops context duplicates", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      paragraph("p1", "Перша ключова теза."),
      paragraph("p2", "Друга ключова теза."),
      paragraph("p3", "Третя ключова теза.")
    ]
  };
  const request: EditorialReviewRequest = {
    document,
    revision: deriveManuscriptRevisionState(document),
    locale: "uk",
    provider: "openai",
    modelId: "gpt-5.6-luna",
    changeLevel: 3,
    stepId: "emphasis",
    runMode: "replace"
  };
  const chunks: EmphasisChunkPlan[] = [
    {
      index: 0,
      startBlockIndex: 0,
      endBlockIndex: 2,
      sourceChars: 20,
      coreBlockIds: ["p1"],
      contextBlockIds: ["p2"],
      blocks: document.blocks.slice(0, 2)
    },
    {
      index: 1,
      startBlockIndex: 1,
      endBlockIndex: 3,
      sourceChars: 20,
      coreBlockIds: ["p2", "p3"],
      contextBlockIds: [],
      blocks: document.blocks.slice(1, 3)
    }
  ];
  const responses = [
    responseFor(request, [
      itemFor(request, "p2", "Друга"),
      itemFor(request, "p1", "Перша")
    ]),
    responseFor(request, [
      itemFor(request, "p3", "Третя"),
      itemFor(request, "p2", "Друга")
    ])
  ];

  const merged = mergeDurableEmphasisChunkResponses(
    request,
    chunks,
    responses,
    "2026-08-04T12:00:00.000Z"
  );

  assert.deepEqual(merged.items.map((item) => item.anchor.blockIds[0]), ["p1", "p2", "p3"]);
  assert.equal(merged.items.filter((item) => item.anchor.blockIds[0] === "p2").length, 1);
});

function paragraph(id: string, text: string): EditorDocument["blocks"][number] {
  return { id, type: "paragraph", content: [{ text }] };
}

function itemFor(
  request: EditorialReviewRequest,
  blockId: string,
  emphasisText: string
): EditorialReviewItem {
  const blockIndex = request.document.blocks.findIndex((block) => block.id === blockId);

  return {
    id: `item-${blockId}`,
    reviewSessionId: "review-session-source",
    documentRevisionId: request.revision.documentRevisionId,
    changeLevel: request.changeLevel,
    title: "Акцент",
    reason: "Для сканування",
    recommendation: emphasisText,
    recommendationType: "rewrite",
    suggestedAction: "rewrite_text",
    priority: "medium",
    anchor: {
      blockIds: [blockId],
      generationBlockRange: { start: blockIndex, end: blockIndex },
      excerpt: emphasisText,
      fingerprint: `fingerprint-${blockId}`
    },
    insertionPoint: { mode: "replace", anchorBlockId: blockId },
    emphasisTarget: { text: emphasisText },
    stepId: "emphasis",
    stepRunId: "step-run-source",
    status: "pending"
  };
}

function responseFor(
  request: EditorialReviewRequest,
  items: EditorialReviewItem[]
): EditorialReviewResponse {
  return {
    reviewSessionId: "review-session-source",
    stepId: "emphasis",
    stepRunId: "step-run-source",
    runMode: "replace",
    items,
    factCheckRows: [],
    providerUsed: "openai:gpt-5.6-luna",
    usedFallback: false,
    diagnostics: {
      requestId: "request-source",
      reviewSessionId: "review-session-source",
      stepId: "emphasis",
      stepRunId: "step-run-source",
      runMode: "replace",
      requestedProvider: request.provider,
      requestedModelId: request.modelId,
      blockCount: request.document.blocks.length,
      changeLevel: request.changeLevel,
      returnedItemCount: items.length,
      returnedFactCheckCount: 0,
      droppedItemCount: 0,
      generatedAt: "2026-08-04T12:00:00.000Z"
    }
  };
}

test("mergeDurableRecommendationChunkResponses keeps prefix cards and records a hole", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      paragraph("p1", "Перший абзац для ясності."),
      paragraph("p2", "Другий абзац для ясності."),
      paragraph("p3", "Третій абзац для ясності."),
      paragraph("p4", "Четвертий абзац для ясності.")
    ]
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
  const chunks: EmphasisChunkPlan[] = document.blocks.map((block, index) => ({
    index,
    startBlockIndex: index,
    endBlockIndex: index + 1,
    sourceChars: 20,
    coreBlockIds: [block.id],
    contextBlockIds: [],
    blocks: [block]
  }));
  const clarityItem = (blockId: string): EditorialReviewItem => ({
    id: `item-${blockId}`,
    reviewSessionId: "review-session-source",
    documentRevisionId: "chunk-local-revision",
    changeLevel: 3,
    title: "Спростити",
    reason: "Щільно",
    recommendation: "Простіше.",
    recommendationType: "simplify",
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
  });
  const responses = [
    { ...responseFor(request, [clarityItem("p1")]), stepId: "clarity" as const },
    { ...responseFor(request, [clarityItem("p2")]), stepId: "clarity" as const },
    { ...responseFor(request, []), stepId: "clarity" as const, error: "OpenAI перевищив таймаут 280с." },
    { ...responseFor(request, [clarityItem("p4")]), stepId: "clarity" as const }
  ];

  const merged = mergeDurableRecommendationChunkResponses(request, chunks, responses, "2026-08-12T12:00:00.000Z");

  assert.equal(merged.error, undefined);
  assert.deepEqual(merged.items.map((item) => item.anchor.blockIds[0]), ["p1", "p2", "p4"]);
  assert.ok(merged.items.every((item) => item.documentRevisionId === request.revision.documentRevisionId));
  assert.equal(merged.diagnostics.failedChunks?.length, 1);
  assert.equal(merged.diagnostics.failedChunks?.[0]?.index, 2);
  assert.equal(classifyReviewChunkFailure({
    error: "OpenAI перевищив таймаут 280с.",
    providerError: { code: "timeout", retryable: true },
    attempt: 3
  }), "hole");
});

