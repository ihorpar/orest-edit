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
  const providerOutput = JSON.stringify({
    operations: [
      {
        blockIds: ["p1"],
        newBlocks: [{ type: "paragraph", content: [{ text: "Пояснений блок." }] }],
        reason: "Спростив блок.",
        type: "clarity"
      }
    ]
  });

  const response = await generatePatchResponse(createRequest({ apiKey: "test-key" }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: providerOutput
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0]?.newBlocks[0]?.type, "paragraph");
  assert.equal(response.diagnostics.rawOutput, providerOutput);
});

test("generatePatchResponse includes raw abort diagnostics when provider request is canceled", async () => {
  const response = await generatePatchResponse(createRequest({ apiKey: "test-key" }), {
    fetchImpl: async () => {
      throw new DOMException("This operation was aborted", "AbortError");
    },
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, true);
  assert.equal(response.providerUsed, "fallback:openai");
  assert.match(response.error ?? "", /перевищив таймаут 60с/i);
  assert.match(response.diagnostics.rawError ?? "", /AbortError: This operation was aborted/);
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
  let requestBody = "";

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
        requestBody = typeof init?.body === "string" ? init.body : "";

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
                            replacements: ["Пояснений блок."],
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
  assert.equal(response.operations[0]?.newBlocks[0]?.type, "paragraph");
  assert.equal(
    response.operations[0]?.newBlocks[0]?.type === "paragraph" ? response.operations[0].newBlocks[0].content[0]?.text : "",
    "Пояснений блок."
  );
  assert.match(requestedUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
  assert.doesNotMatch(requestedUrl, /\?key=/);
  assert.equal(requestHeaders.get("x-goog-api-key"), "gemini-test-key");

  const payload = JSON.parse(requestBody) as {
    systemInstruction?: { parts?: Array<{ text?: string }> };
    generationConfig?: {
      responseSchema?: {
        properties?: {
          operations?: {
            items?: {
              properties?: {
                replacements?: { type?: string; items?: { type?: string } };
              };
              required?: string[];
            };
          };
        };
      };
      temperature?: number;
    };
  };

  assert.equal(
    payload.generationConfig?.responseSchema?.properties?.operations?.items?.properties?.replacements?.type,
    "ARRAY"
  );
  assert.equal(
    payload.generationConfig?.responseSchema?.properties?.operations?.items?.properties?.replacements?.items?.type,
    "STRING"
  );
  assert.ok(payload.generationConfig?.responseSchema?.properties?.operations?.items?.required?.includes("replacements"));
  assert.match(payload.systemInstruction?.parts?.[0]?.text ?? "", /Не повертай rich-text blocks, newBlocks/i);
  assert.match(payload.systemInstruction?.parts?.[0]?.text ?? "", /ключових думок|ключові думки/i);
  assert.match(payload.systemInstruction?.parts?.[0]?.text ?? "", /label-line/i);
  assert.match(payload.systemInstruction?.parts?.[0]?.text ?? "", /\*\*жирний\*\*/i);
  assert.match(payload.systemInstruction?.parts?.[0]?.text ?? "", /Кожен змістовий абзац/i);
  assert.match(payload.systemInstruction?.parts?.[0]?.text ?? "", /2-3 короткі акценти/i);
  assert.match(payload.systemInstruction?.parts?.[0]?.text ?? "", /пунктуація списків:/i);
  assert.match(payload.systemInstruction?.parts?.[0]?.text ?? "", /починається з малої літери/i);
});

test("generatePatchResponse preserves line breaks inside a single replacement block", async () => {
  const response = await generatePatchResponse(
    createRequest({
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey: "gemini-test-key"
    }),
    {
      fetchImpl: async () =>
        new Response(
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
                            replacements: ["Рядок один\nРядок два\nРядок три\nРядок чотири"],
                            reason: "Перетворив фрагмент на короткий вірш.",
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
        ),
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0]?.newBlocks[0]?.type, "paragraph");
  assert.equal(
    response.operations[0]?.newBlocks[0]?.type === "paragraph" ? response.operations[0].newBlocks[0].content[0]?.text : "",
    "Рядок один\nРядок два\nРядок три\nРядок чотири"
  );
});

test("generatePatchResponse sends strict OpenAI patch schema with closed objects", async () => {
  let requestBody = "";

  await generatePatchResponse(createRequest({ apiKey: "openai-test-key" }), {
    fetchImpl: async (_input, init) => {
      requestBody = typeof init?.body === "string" ? init.body : "";

      return new Response(
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
      );
    },
    now: () => "2026-03-10T12:00:00.000Z"
  });

  const payload = JSON.parse(requestBody) as {
    text?: {
      format?: {
        schema?: {
          properties?: {
            operations?: {
              items?: {
                additionalProperties?: boolean;
                properties?: {
                  newBlocks?: {
                    items?: {
                      additionalProperties?: boolean;
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
  };

  assert.equal(payload.text?.format?.schema?.properties?.operations?.items?.additionalProperties, false);
  assert.equal(payload.text?.format?.schema?.properties?.operations?.items?.properties?.newBlocks?.items?.additionalProperties, false);
});

test("generatePatchResponse fallback rewrites standalone lists into a visible paragraph draft", async () => {
  const response = await generatePatchResponse(
    createRequest({
      document: {
        version: 2,
        blocks: [
          {
            id: "p1",
            type: "bullet_list",
            items: [[{ text: "Шкірні хвороби" }], [{ text: "Хронічні захворювання нирок" }], [{ text: "Синдром Рейтера" }]]
          }
        ]
      },
      prompt: "Перепиши це природною зв'язною мовою.",
      mode: "custom"
    }),
    {
      readEnvValue: () => null,
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, true);
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0]?.newBlocks[0]?.type, "paragraph");
  assert.match(response.operations[0]?.newBlocks[0]?.type === "paragraph" ? response.operations[0].newBlocks[0].content[0].text : "", /Шкірні хвороби, Хронічні захворювання нирок та Синдром Рейтера\./);
});

test("generatePatchResponse turns fetch failures into a user-facing provider availability message", async () => {
  const response = await generatePatchResponse(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3-flash-preview",
      apiKey: "gemini-test-key"
    }),
    {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, true);
  assert.match(response.error ?? "", /Gemini недоступний або мережа не відповідає/i);
  assert.match(response.diagnostics.rawError ?? "", /fetch failed/i);
});
