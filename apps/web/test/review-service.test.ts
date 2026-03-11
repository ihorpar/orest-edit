import test from "node:test";
import assert from "node:assert/strict";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { generateEditorialReview } from "../lib/server/review-service.ts";
import type { EditorialReviewRequest } from "../lib/editor/review-contract.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";

function createRequest(overrides: Partial<EditorialReviewRequest> = {}): EditorialReviewRequest {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 2, content: [{ text: "Розділ" }] },
      {
        id: "p1",
        type: "paragraph",
        content: [{ text: "Це дуже довгий абзац, який спеціально зроблено достатньо об'ємним, щоб fallback review запропонував локальне переписування або структурування для читача. ".repeat(4) }]
      }
    ]
  };

  return {
    document,
    revision: deriveManuscriptRevisionState(document),
    provider: "openai",
    modelId: "gpt-5.4",
    changeLevel: 3,
    ...overrides
  };
}

test("generateEditorialReview builds fallback recommendations without API key", async () => {
  const response = await generateEditorialReview(createRequest(), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, true);
  assert.ok(response.items.length >= 1);
  assert.deepEqual(response.items[0]?.anchor.blockIds, ["p1"]);
  assert.equal(response.diagnostics.blockCount, 2);
});

test("generateEditorialReview normalizes provider items to block anchors", async () => {
  const response = await generateEditorialReview(createRequest({ apiKey: "test-key" }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            items: [
              {
                title: "Розвантажити блок",
                reason: "Абзац перевантажений.",
                recommendation: "Скоротити речення.",
                recommendationType: "rewrite",
                suggestedAction: "rewrite_text",
                priority: "high",
                blockStart: 1,
                blockEnd: 1,
                excerpt: "Це дуже довгий абзац",
                insertionHint: "replace",
                anchorBlockId: "p1",
                calloutKind: null,
                calloutTitle: null,
                calloutPreviewText: null,
                calloutSummary: null,
                calloutPrompt: null,
                visualIntent: null
              }
            ]
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.items.length, 1);
  assert.deepEqual(response.items[0]?.anchor.blockIds, ["p1"]);
  assert.equal(response.items[0]?.anchor.generationBlockRange.start, 1);
});
