import test from "node:test";
import assert from "node:assert/strict";

import { generatePatchResponse } from "../lib/server/patch-service.ts";
import type { PatchRequest } from "../lib/editor/patch-contract.ts";

function createRequest(provider: PatchRequest["provider"], modelId: string, text: string): PatchRequest {
  return {
    text,
    selectionStart: 0,
    selectionEnd: text.length,
    mode: "default",
    provider,
    modelId,
    basePrompt: "Спрости фрагмент.",
    prompt: undefined,
    apiKey: undefined
  };
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("generatePatchResponse uses OPENAI_API_KEY from env when form key is blank", async () => {
  const text = "Складний фрагмент для правки.";
  let authHeader = "";
  let requestBody: Record<string, unknown> | undefined;

  const response = await generatePatchResponse(createRequest("openai", "gpt-5.2", text), {
    readEnvValue: (key) => (key === "OPENAI_API_KEY" ? "sk-test-openai" : null),
    now: () => "2026-03-05T22:00:00.000Z",
    fetchImpl: async (input, init) => {
      authHeader = String((init?.headers as Record<string, string>).Authorization);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.match(String(input), /chat\/completions$/);

      return createJsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                operations: [
                  { op: "replace", start: 0, end: text.length, newText: "Простіший фрагмент.", reason: "Спростив фразу.", type: "clarity" }
                ]
              })
            }
          }
        ]
      });
    }
  });

  assert.equal(authHeader, "Bearer sk-test-openai");
  assert.ok(requestBody);
  const openAiRequest = requestBody;
  assert.equal(openAiRequest.model, "gpt-5.2");
  assert.deepEqual(openAiRequest.response_format, {
    type: "json_schema",
    json_schema: {
      name: "patch_operations",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          operations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                op: { type: "string", enum: ["replace", "insert", "delete"] },
                start: { type: "integer" },
                end: { type: "integer" },
                newText: { type: "string" },
                reason: { type: "string" },
                type: { type: "string", enum: ["clarity", "structure", "terminology", "source", "tone"] }
              },
              required: ["op", "start", "end", "newText", "reason", "type"]
            }
          }
        },
        required: ["operations"]
      }
    }
  });
  assert.equal(response.usedFallback, false);
  assert.equal(response.providerUsed, "openai");
  assert.equal(response.operations.length, 1);
});

test("generatePatchResponse parses Gemini generateContent responses", async () => {
  const text = "Абдомінальне ожиріння підсилює ризик.";
  let apiKeyHeader = "";
  let requestBody: Record<string, unknown> | undefined;

  const response = await generatePatchResponse({ ...createRequest("gemini", "gemini-2.5-flash", text), apiKey: "gem-test" }, {
    now: () => "2026-03-05T22:00:00.000Z",
    fetchImpl: async (input, init) => {
      apiKeyHeader = String((init?.headers as Record<string, string>)["x-goog-api-key"]);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.match(String(input), /generativelanguage.googleapis.com/);
      assert.match(String(input), /gemini-2.5-flash:generateContent$/);

      return createJsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    operations: [
                      { op: "replace", start: 0, end: 21, newText: "Жир навколо живота", reason: "Пояснив термін.", type: "terminology" }
                    ]
                  })
                }
              ]
            }
          }
        ]
      });
    }
  });

  assert.equal(apiKeyHeader, "gem-test");
  assert.ok(requestBody);
  const geminiRequest = requestBody;
  assert.deepEqual(geminiRequest.generationConfig, {
    temperature: 0.2,
    response_mime_type: "application/json",
    response_schema: {
      type: "OBJECT",
      properties: {
        operations: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              op: { type: "STRING" },
              start: { type: "INTEGER" },
              end: { type: "INTEGER" },
              newText: { type: "STRING" },
              reason: { type: "STRING" },
              type: { type: "STRING" }
            },
            required: ["op", "start", "end", "newText", "reason", "type"]
          }
        }
      },
      required: ["operations"]
    }
  });
  assert.equal(response.usedFallback, false);
  assert.equal(response.providerUsed, "gemini");
  assert.equal(response.operations[0]?.newText, "Жир навколо живота");
});

test("generatePatchResponse parses Anthropic Messages responses", async () => {
  const text = "Хронічне запалення часто недооцінюють.";
  let versionHeader = "";
  let apiKeyHeader = "";
  let requestBody: Record<string, unknown> | undefined;

  const response = await generatePatchResponse({ ...createRequest("anthropic", "claude-sonnet-4-5", text), apiKey: "anth-test" }, {
    now: () => "2026-03-05T22:00:00.000Z",
    fetchImpl: async (input, init) => {
      const headers = init?.headers as Record<string, string>;
      versionHeader = String(headers["anthropic-version"]);
      apiKeyHeader = String(headers["x-api-key"]);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.match(String(input), /api.anthropic.com\/v1\/messages$/);

      return createJsonResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              operations: [
                { op: "replace", start: 0, end: 19, newText: "Тривале запалення", reason: "Пояснив термін.", type: "terminology" }
              ]
            })
          }
        ]
      });
    }
  });

  assert.equal(apiKeyHeader, "anth-test");
  assert.equal(versionHeader, "2023-06-01");
  assert.ok(requestBody);
  const anthropicRequest = requestBody;
  assert.equal(anthropicRequest.model, "claude-sonnet-4-5");
  assert.equal(anthropicRequest.max_tokens, 1200);
  assert.equal(typeof anthropicRequest.system, "string");
  assert.equal(Array.isArray(anthropicRequest.messages), true);
  assert.equal(response.usedFallback, false);
  assert.equal(response.providerUsed, "anthropic");
  assert.equal(response.operations[0]?.newText, "Тривале запалення");
});

test("generatePatchResponse falls back when no provider key is available", async () => {
  const text = "Абдомінальне ожиріння та хронічне запалення.";
  let fetchCalls = 0;

  const response = await generatePatchResponse(createRequest("openai", "gpt-5.2", text), {
    readEnvValue: () => null,
    now: () => "2026-03-05T22:00:00.000Z",
    fetchImpl: async () => {
      fetchCalls += 1;
      return createJsonResponse({});
    }
  });

  assert.equal(fetchCalls, 0);
  assert.equal(response.usedFallback, true);
  assert.equal(response.operations.length > 0, true);
  assert.match(response.error ?? "", /API key/);
});
