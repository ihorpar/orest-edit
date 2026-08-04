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
import { mergeDurableEmphasisChunkResponses } from "../lib/server/review-service.ts";

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
