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
  const response = await generateEditorialReview(createRequest({ stepId: "clarity" }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, true);
  assert.equal(response.stepId, "clarity");
  assert.ok(response.items.length >= 1);
  assert.deepEqual(response.items[0]?.anchor.blockIds, ["p1"]);
  assert.equal(response.diagnostics.blockCount, 2);
});

test("generateEditorialReview fallback enforces step-specific recommendation types", async () => {
  const response = await generateEditorialReview(createRequest({ stepId: "visuals" }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, true);
  assert.equal(response.stepId, "visuals");
  assert.equal(response.items.length, 0);
  assert.ok(response.diagnostics.droppedItemCount >= 1);
});

test("generateEditorialReview normalizes provider items to block anchors", async () => {
  const response = await generateEditorialReview(createRequest({ apiKey: "test-key", currentStatus: "cards" }), {
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
  assert.equal(response.stepId, "clarity");
  assert.equal(response.items.length, 1);
  assert.deepEqual(response.items[0]?.anchor.blockIds, ["p1"]);
  assert.equal(response.items[0]?.anchor.generationBlockRange.start, 1);
});

test("generateEditorialReview returns provider-native structured fact-check rows", async () => {
  const response = await generateEditorialReview(createRequest({ apiKey: "test-key", stepId: "fact_check" }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            rows: [
              {
                claim: "Кортизол пригнічує регенерацію при хронічному стресі.",
                status: "сумнівно",
                explanation: "Потрібно уточнити силу ефекту та межі застосовності на основі оглядових робіт."
              }
            ]
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "fact_check");
  assert.equal(response.items.length, 0);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.status, "сумнівно");
});

test("generateEditorialReview treats valid empty provider recommendations as empty result, not fallback", async () => {
  const response = await generateEditorialReview(createRequest({ apiKey: "test-key", stepId: "clarity" }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            items: []
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "clarity");
  assert.equal(response.items.length, 0);
  assert.equal(response.error, undefined);
});

test("generateEditorialReview sends Gemini API key via header instead of URL query", async () => {
  let requestedUrl = "";
  let requestHeaders = new Headers();

  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestHeaders = new Headers(init?.headers);

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        rows: [
                          {
                            claim: "Тестове твердження.",
                            status: "ok",
                            explanation: "Тестове обґрунтування."
                          }
                        ]
                      })
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "fact_check");
  assert.equal(response.factCheckRows?.length, 1);
  assert.match(requestedUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
  assert.doesNotMatch(requestedUrl, /\?key=/);
  assert.equal(requestHeaders.get("x-goog-api-key"), "gemini-test-key");
});

test("generateEditorialReview Gemini schema does not force nullable card fields", async () => {
  let schemaRequired: string[] = [];

  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey: "gemini-test-key",
      stepId: "clarity"
    }),
    {
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          generationConfig?: { responseSchema?: { properties?: { items?: { items?: { required?: string[] } } } } };
        };
        schemaRequired = body.generationConfig?.responseSchema?.properties?.items?.items?.required ?? [];

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        items: []
                      })
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.deepEqual(schemaRequired.includes("anchorBlockId"), false);
  assert.deepEqual(schemaRequired.includes("calloutKind"), false);
  assert.deepEqual(schemaRequired.includes("calloutTitle"), false);
  assert.deepEqual(schemaRequired.includes("calloutPreviewText"), false);
  assert.deepEqual(schemaRequired.includes("calloutSummary"), false);
  assert.deepEqual(schemaRequired.includes("calloutPrompt"), false);
  assert.deepEqual(schemaRequired.includes("visualIntent"), false);
});

test("generateEditorialReview injects clarity-specific anti-disclaimer guardrails into provider prompt", async () => {
  let requestBody: Record<string, unknown> | undefined;

  const response = await generateEditorialReview(
    createRequest({
      apiKey: "test-key",
      stepId: "clarity"
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: []
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.ok(requestBody);
  assert.match(String(requestBody?.instructions ?? ""), /не пропонуй шаблонних застережень про консультацію з лікарем/i);
  assert.match(String(requestBody?.instructions ?? ""), /для кроку «ясність» пропонуй лише мовні й локально-структурні правки/i);
  assert.match(String(requestBody?.input ?? ""), /збережи короткі окремі пункти/i);
});
