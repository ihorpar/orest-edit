import test from "node:test";
import assert from "node:assert/strict";
import { generatePatchResponse } from "../lib/server/patch-service.ts";
import type { PatchRequest } from "../lib/editor/patch-contract.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";

function createRequest(overrides: Partial<PatchRequest> = {}): PatchRequest {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Серцево-судинна система працює безперервно." }] }]
  };

  return {
    document,
    targetBlockIds: ["p1"],
    mode: "default",
    provider: "openai",
    modelId: "gpt-5.4",
    ...overrides
  };
}

test("generatePatchResponse falls back locally when no API key is present", async () => {
  const response = await generatePatchResponse(createRequest(), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, true);
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0]?.blockIds[0], "p1");
  assert.match(response.operations[0]?.newBlocks[0]?.type === "paragraph" ? response.operations[0].newBlocks[0].content[0].text : "", /система серця і судин/);
});

test("generatePatchResponse rejects empty block selection", async () => {
  const response = await generatePatchResponse(createRequest({ targetBlockIds: [] }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.providerUsed, "invalid-selection");
  assert.equal(response.operations.length, 0);
});

test("generatePatchResponse normalizes provider block operations", async () => {
  const response = await generatePatchResponse(createRequest({ apiKey: "test-key" }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            operations: [
              {
                blockIds: ["p1"],
                newBlocks: [{ type: "paragraph", content: [{ text: "Пояснений блок." }] }],
                reason: "Спростив блок.",
                type: "clarity"
              }
            ]
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0]?.newBlocks[0]?.type, "paragraph");
});

test("generatePatchResponse normalizes loose provider text replacement", async () => {
  const response = await generatePatchResponse(createRequest({ apiKey: "test-key" }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            operations: [
              {
                blockIds: ["p1"],
                newText: "Спростив блок у запасному режимі.",
                reason: "Спростив блок.",
                type: "clarity"
              }
            ]
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0]?.blockIds[0], "p1");
  assert.equal(response.operations[0]?.newBlocks[0]?.type, "paragraph");
  assert.match(response.operations[0]?.newBlocks[0]?.type === "paragraph" ? response.operations[0].newBlocks[0].content[0].text : "", /Спростив блок/);
});

test("generatePatchResponse sends Gemini API key via header instead of URL query", async () => {
  let requestedUrl = "";
  let requestHeaders = new Headers();

  const response = await generatePatchResponse(
    createRequest({
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey: "gemini-test-key"
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
                        operations: [
                          {
                            blockIds: ["p1"],
                            newBlocks: [{ type: "paragraph", content: [{ text: "Пояснений блок." }] }],
                            reason: "Спростив блок.",
                            type: "clarity"
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
  assert.equal(response.operations.length, 1);
  assert.match(requestedUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
  assert.doesNotMatch(requestedUrl, /\?key=/);
  assert.equal(requestHeaders.get("x-goog-api-key"), "gemini-test-key");
});
