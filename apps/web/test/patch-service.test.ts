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

function createOpenAiResponsesPayload(body: unknown) {
  return {
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(body)
          }
        ]
      }
    ]
  };
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
      assert.match(String(input), /\/responses$/);

      return createJsonResponse(
        createOpenAiResponsesPayload({
          operations: [{ op: "replace", start: 0, end: text.length, newText: "Простіший фрагмент.", reason: "Спростив фразу.", type: "clarity" }]
        })
      );
    }
  });

  assert.equal(authHeader, "Bearer sk-test-openai");
  assert.ok(requestBody);
  const openAiRequest = requestBody;
  assert.equal(openAiRequest.model, "gpt-5.2");
  assert.equal(openAiRequest.instructions, "Спрости фрагмент. Ти допомагаєш книжковому редактору, а не лікарю. Працюй лише в межах виділеного фрагмента. Не переписуй увесь розділ. Поверни рівно одну локальну правку. Це має бути одна операція replace, яка охоплює весь виділений фрагмент. Кожна операція повинна містити op, start, end, newText, reason і type. start та end мають бути абсолютними індексами в межах виділення. reason пиши коротко, українською, не більше 12 слів. Дозволені type: clarity, structure, terminology, source, tone. Дозволені op: replace, insert, delete. Не дроби відповідь на кілька правок.");
  assert.equal(typeof openAiRequest.input, "string");
  assert.deepEqual(openAiRequest.text, {
    format: {
      type: "json_schema",
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

  const response = await generatePatchResponse({ ...createRequest("gemini", "gemini-3.1-flash-lite-preview", text), apiKey: "gem-test" }, {
    now: () => "2026-03-05T22:00:00.000Z",
    fetchImpl: async (input, init) => {
      apiKeyHeader = String((init?.headers as Record<string, string>)["x-goog-api-key"]);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.match(String(input), /generativelanguage.googleapis.com/);
      assert.match(String(input), /gemini-3.1-flash-lite-preview:generateContent$/);

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
    responseMimeType: "application/json",
    responseJsonSchema: {
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
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0]?.start, 0);
  assert.equal(response.operations[0]?.end, text.length);
  assert.match(response.error ?? "", /API key/);
});

test("generatePatchResponse collapses multiple provider edits into one selection-wide replace", async () => {
  const text = "Високий LDL і низький HDL часто йдуть разом та погіршують стан судин.";

  const response = await generatePatchResponse(
    {
      text,
      selectionStart: 0,
      selectionEnd: text.length,
      mode: "default",
      provider: "openai",
      modelId: "gpt-5.2",
      apiKey: "sk-test-openai"
    },
    {
      now: () => "2026-03-06T00:45:00.000Z",
      fetchImpl: async () =>
        createJsonResponse(
          createOpenAiResponsesPayload({
            operations: [
              { op: "replace", start: 0, end: 10, newText: "Підвищений LDL", reason: "Спростив термін.", type: "clarity" },
              { op: "replace", start: 13, end: 23, newText: "знижений HDL", reason: "Узгодив форму.", type: "clarity" },
              { op: "replace", start: 42, end: 58, newText: "трапляються разом", reason: "Спростив вислів.", type: "clarity" }
            ]
          })
        )
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0]?.op, "replace");
  assert.equal(response.operations[0]?.start, 0);
  assert.equal(response.operations[0]?.end, text.length);
  assert.equal(response.operations[0]?.oldText, text);
  assert.match(response.operations[0]?.newText ?? "", /Підвищений LDL/);
  assert.match(response.operations[0]?.newText ?? "", /знижений HDL/);
});

test("generatePatchResponse repairs provider operations that use selection-relative offsets", async () => {
  const text = "Преамбула. Складний фрагмент для правки. Епілог.";
  const selectionStart = text.indexOf("Складний");
  const selectedText = "Складний фрагмент для правки.";
  const selectionEnd = selectionStart + selectedText.length;

  const response = await generatePatchResponse(
    {
      text,
      selectionStart,
      selectionEnd,
      mode: "default",
      provider: "openai",
      modelId: "gpt-5.2",
      apiKey: "sk-test-openai"
    },
    {
      now: () => "2026-03-06T00:30:00.000Z",
      fetchImpl: async () =>
        createJsonResponse(
          createOpenAiResponsesPayload({
            operations: [{ op: "replace", start: 0, end: selectedText.length, newText: "Простіший фрагмент.", reason: "Спростив фразу.", type: "clarity" }]
          })
        )
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0]?.start, selectionStart);
  assert.equal(response.operations[0]?.end, selectionEnd);
  assert.equal(response.operations[0]?.oldText, selectedText);
});

test("generatePatchResponse repairs string indices in provider operations", async () => {
  const text = "Преамбула. Складний фрагмент для правки.";
  const selectionStart = text.indexOf("Складний");
  const selectionEnd = text.length;

  const response = await generatePatchResponse(
    {
      text,
      selectionStart,
      selectionEnd,
      mode: "default",
      provider: "openai",
      modelId: "gpt-5.2",
      apiKey: "sk-test-openai"
    },
    {
      now: () => "2026-03-06T00:30:00.000Z",
      fetchImpl: async () =>
        createJsonResponse(
          createOpenAiResponsesPayload({
            operations: [
              {
                op: "replace",
                start: String(selectionStart),
                end: String(selectionEnd),
                replacement: "Простіший фрагмент для правки.",
                comment: "Спростив фразу.",
                category: "clarity"
              }
            ]
          })
        )
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0]?.oldText, text.slice(selectionStart, selectionEnd));
  assert.equal(response.operations[0]?.newText, "Простіший фрагмент для правки.");
});
