import test from "node:test";
import assert from "node:assert/strict";

import { generateEditorialReview } from "../lib/server/review-service.ts";
import type { EditorialReviewRequest } from "../lib/editor/review-contract.ts";

function createRequest(provider: EditorialReviewRequest["provider"], modelId: string, text: string): EditorialReviewRequest {
  return {
    text,
    provider,
    modelId,
    apiKey: undefined,
    basePrompt: "Тримай фокус на ясності, структурі та тоні."
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

test("generateEditorialReview uses fallback heuristics when provider key is missing", async () => {
  const text =
    "У популярному біохакінгу часто люблять прості формули. Але абдомінальне ожиріння та серцево-судинні ризики потребують точнішого пояснення.";

  const response = await generateEditorialReview(createRequest("openai", "gpt-5.2", text), {
    readEnvValue: () => null,
    now: () => "2026-03-06T02:40:00.000Z"
  });

  assert.equal(response.usedFallback, true);
  assert.match(response.error ?? "", /API key/);
  assert.ok(response.items.length >= 1);
  assert.equal(response.items[0]?.category, "clarity");
});

test("generateEditorialReview parses provider review items", async () => {
  const text = "Перший абзац.\n\nДругий абзац із надто академічною лексикою та слабким переходом.";
  let authHeader = "";

  const response = await generateEditorialReview(
    { ...createRequest("openai", "gpt-5.2", text), apiKey: "sk-review-test" },
    {
      now: () => "2026-03-06T02:40:00.000Z",
      fetchImpl: async (_input, init) => {
        authHeader = String((init?.headers as Record<string, string>).Authorization);

        return createJsonResponse(
          createOpenAiResponsesPayload({
            items: [
              {
                title: "Послаблений перехід",
                explanation: "Між абзацами губиться смисловий місток, тому текст читається ривком.",
                recommendation: "Додайте коротку фразу-перехід між тезою і поясненням.",
                category: "structure",
                severity: "medium",
                paragraphStart: 2,
                paragraphEnd: 2,
                excerpt: "Другий абзац із надто академічною лексикою"
              }
            ]
          })
        );
      }
    }
  );

  assert.equal(authHeader, "Bearer sk-review-test");
  assert.equal(response.usedFallback, false);
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.category, "structure");
  assert.equal(response.items[0]?.severity, "medium");
  assert.equal(response.items[0]?.paragraphStart, 2);
});

test("generateEditorialReview sends Gemini structured output config in the documented shape", async () => {
  const text = "Перший абзац.\n\nКороткий текст для огляду.";
  let requestBody: Record<string, unknown> | undefined;

  await generateEditorialReview(
    { ...createRequest("gemini", "gemini-2.5-flash", text), apiKey: "gem-review-test" },
    {
      now: () => "2026-03-06T03:40:00.000Z",
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return createJsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      items: [
                        {
                          title: "Тестовий огляд",
                          explanation: "Перевірка request shape.",
                          recommendation: "Нічого не робити.",
                          category: "clarity",
                          severity: "low",
                          paragraphStart: 2,
                          paragraphEnd: 2,
                          excerpt: "Короткий текст для огляду."
                        }
                      ]
                    })
                  }
                ]
              }
            }
          ]
        });
      }
    }
  );

  assert.ok(requestBody);
  const geminiRequest = requestBody;
  assert.deepEqual(geminiRequest.generationConfig, {
    temperature: 0.2,
    responseMimeType: "application/json",
    responseJsonSchema: {
      type: "OBJECT",
      properties: {
        items: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              explanation: { type: "STRING" },
              recommendation: { type: "STRING" },
              category: { type: "STRING" },
              severity: { type: "STRING" },
              paragraphStart: { type: "INTEGER" },
              paragraphEnd: { type: "INTEGER" },
              excerpt: { type: "STRING" }
            },
            required: ["title", "explanation", "recommendation", "category", "severity", "paragraphStart", "paragraphEnd", "excerpt"]
          }
        }
      },
      required: ["items"]
    }
  });
});

test("generateEditorialReview repairs aliased fields and string offsets before dropping items", async () => {
  const text = "Перший абзац.\n\nУ цьому абзаці є каскад змін і майже немає людського пояснення для читача.";

  const response = await generateEditorialReview(
    { ...createRequest("openai", "gpt-5.2", text), apiKey: "sk-review-test" },
    {
      now: () => "2026-03-06T03:10:00.000Z",
      fetchImpl: async () =>
        createJsonResponse(
          createOpenAiResponsesPayload({
            items: [
              {
                problem: "Термін без пояснення",
                whyItMatters: "Читачеві складно швидко уявити, що означає цей фрагмент.",
                action: "Додайте просту побутову розшифровку одразу після терміна.",
                type: "clarity",
                priority: "high",
                start: "18",
                end: "29"
              }
            ]
          })
        )
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.items.length, 1);
  assert.equal(response.diagnostics.droppedItemCount, 0);
  assert.equal(response.items[0]?.title, "Термін без пояснення");
  assert.equal(response.items[0]?.severity, "high");
  assert.equal(response.items[0]?.paragraphStart, 2);
  assert.equal(response.items[0]?.paragraphEnd, 2);
});

test("generateEditorialReview repairs missing offsets from excerpt text", async () => {
  const text = "Перший абзац.\n\nБіохакінг любить прості формули, але серцево-судинне здоров'я не зводиться до одного ритуалу.";

  const response = await generateEditorialReview(
    { ...createRequest("openai", "gpt-5.2", text), apiKey: "sk-review-test" },
    {
      now: () => "2026-03-06T03:10:00.000Z",
      fetchImpl: async () =>
        createJsonResponse(
          createOpenAiResponsesPayload({
            items: [
              {
                title: "Спрощена обіцянка",
                explanation: "Ця фраза ризикує звести складну тему до надто зручної формули.",
                recommendation: "Додайте уточнення про межі такого підходу.",
                category: "tone",
                severity: "medium",
                excerpt: "прості формули, але серцево-судинне здоров'я"
              }
            ]
          })
        )
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.items.length, 1);
  assert.equal(response.diagnostics.droppedItemCount, 0);
  assert.match(response.items[0]?.excerpt ?? "", /прості формули/);
  assert.equal(response.items[0]?.paragraphStart, 2);
  assert.equal(response.items[0]?.paragraphEnd, 2);
});

test("generateEditorialReview keeps raw provider output in diagnostics when it falls back", async () => {
  const text = "Текст для перевірки raw output.";
  const rawBody = {
    items: [
      {
        title: "Битий item",
        explanation: "Є пояснення, але немає коректних меж.",
        recommendation: "Перевірити span.",
        category: "clarity",
        severity: "medium"
      }
    ]
  };

  const response = await generateEditorialReview(
    { ...createRequest("openai", "gpt-5.2", text), apiKey: "sk-review-test" },
    {
      now: () => "2026-03-06T03:45:00.000Z",
      fetchImpl: async () => createJsonResponse(createOpenAiResponsesPayload(rawBody))
    }
  );

  assert.equal(response.usedFallback, true);
  assert.match(response.error ?? "", /невалідні рекомендації/);
  assert.equal(response.diagnostics.rawOutput, JSON.stringify(rawBody));
});
