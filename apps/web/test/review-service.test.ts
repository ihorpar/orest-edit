import test from "node:test";
import assert from "node:assert/strict";

import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { generateEditorialReview } from "../lib/server/review-service.ts";
import type { EditorialReviewRequest } from "../lib/editor/review-contract.ts";

function createRequest(provider: EditorialReviewRequest["provider"], modelId: string, text: string): EditorialReviewRequest {
  return {
    text,
    revision: deriveManuscriptRevisionState(text),
    provider,
    modelId,
    apiKey: undefined,
    basePrompt: "Тримай фокус на ясності й науковій точності.",
    reviewPrompt: "Пояснюй тип рекомендації, suggestedAction і прив'язку до абзаців.",
    reviewLevelGuide: "Рівень 3: можна сміливо спрощувати й радити локальні структурні зміни.",
    changeLevel: 3,
    additionalInstructions: "Шукай тільки сильні рекомендації."
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
  assert.equal(response.items[0]?.suggestedAction, "rewrite_text");
  assert.equal(response.diagnostics.changeLevel, 3);
});

test("generateEditorialReview parses provider review items into the new contract", async () => {
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
                reason: "Між абзацами губиться смисловий місток, тому текст читається ривком.",
                recommendation: "Додати коротку фразу-перехід між тезою і поясненням.",
                recommendationType: "rewrite",
                suggestedAction: "rewrite_text",
                priority: "medium",
                paragraphStart: 2,
                paragraphEnd: 2,
                excerpt: "Другий абзац із надто академічною лексикою",
                insertionHint: "replace"
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
  assert.equal(response.items[0]?.recommendationType, "rewrite");
  assert.equal(response.items[0]?.priority, "medium");
  assert.equal(response.items[0]?.anchor.generationParagraphRange.start, 2);
  assert.equal(response.items[0]?.anchor.generationParagraphRange.end, 2);
});

test("generateEditorialReview sends Gemini structured output config in the documented shape", async () => {
  const text = "Перший абзац.\n\nКороткий текст для огляду.";
  let requestBody: Record<string, unknown> | undefined;

  await generateEditorialReview(
    { ...createRequest("gemini", "gemini-3.1-flash-lite-preview", text), apiKey: "gem-review-test" },
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
                          reason: "Перевірка request shape.",
                          recommendation: "Нічого не робити.",
                          recommendationType: "rewrite",
                          suggestedAction: "rewrite_text",
                          priority: "low",
                          paragraphStart: 2,
                          paragraphEnd: 2,
                          excerpt: "Короткий текст для огляду.",
                          insertionHint: "replace"
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
  const generationConfig = requestBody.generationConfig as Record<string, unknown>;
  assert.equal(generationConfig.temperature, 0.2);
  assert.equal(generationConfig.responseMimeType, "application/json");
  assert.ok(generationConfig.responseJsonSchema);
});

test("generateEditorialReview repairs aliased fields before dropping items", async () => {
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
  assert.equal(response.items[0]?.title, "Термін без пояснення");
  assert.equal(response.items[0]?.priority, "high");
  assert.equal(response.items[0]?.anchor.generationParagraphRange.start, 2);
  assert.equal(response.items[0]?.suggestedAction, "rewrite_text");
});

test("generateEditorialReview keeps raw provider output in diagnostics when it falls back", async () => {
  const text = "Текст для перевірки raw output.";
  const rawBody = {
    items: [
      {
        title: "Битий item",
        reason: "Є пояснення, але немає коректних меж."
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

test("generateEditorialReview prebuilds callout draft content during initial review", async () => {
  const text = "Вступний абзац.\n\nТут складний механізм без простого пояснення для читача.";

  const response = await generateEditorialReview(
    { ...createRequest("openai", "gpt-5.2", text), apiKey: "sk-review-test" },
    {
      now: () => "2026-03-08T01:20:00.000Z",
      fetchImpl: async () =>
        createJsonResponse(
          createOpenAiResponsesPayload({
            items: [
              {
                title: "Додати врізку з поясненням",
                reason: "Механізм звучить занадто щільно і без людського містка.",
                recommendation: "Підготувати коротку врізку, яка просто пояснить механізм дії.",
                recommendationType: "callout",
                suggestedAction: "prepare_callout",
                priority: "medium",
                paragraphStart: 2,
                paragraphEnd: 2,
                excerpt: "складний механізм без простого пояснення",
                insertionHint: "after",
                calloutKind: "mechanism_explained",
                calloutTitle: "Як це працює",
                calloutPreviewText:
                  "Вісь «кишечник — шкіра» означає, що стан мікробіому впливає на імунні сигнали і системне запалення. Коли мікрофлора порушена, запальні реакції можуть ставати сильнішими, і це відбивається на шкірі. Тому цей зв'язок варто читати як біологічний механізм, а не випадковий збіг.",
                calloutSummary: "Коротке пояснення механізму осі «кишечник — шкіра».",
                calloutPrompt: null,
                visualIntent: null
              }
            ]
          })
        )
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.recommendationType, "callout");
  assert.equal(response.items[0]?.status, "ready");
  assert.equal(response.items[0]?.calloutDraft?.calloutKind, "mechanism_explained");
  assert.ok((response.items[0]?.calloutDraft?.title ?? "").length > 0);
  assert.ok((response.items[0]?.calloutDraft?.previewText ?? "").length > 0);
  assert.ok((response.items[0]?.calloutDraft?.prompt ?? "").length > 0);
});

test("generateEditorialReview drops callout recommendation when preview text is unusable", async () => {
  const text = "Перший абзац.\n\nТут описано зв'язок, але пояснення механізму поверхневе.";

  const response = await generateEditorialReview(
    { ...createRequest("openai", "gpt-5.2", text), apiKey: "sk-review-test" },
    {
      now: () => "2026-03-08T02:10:00.000Z",
      fetchImpl: async () =>
        createJsonResponse(
          createOpenAiResponsesPayload({
            items: [
              {
                title: "Додати врізку",
                reason: "Пояснення механізму недостатнє.",
                recommendation: "Потрібна пояснювальна врізка.",
                recommendationType: "callout",
                suggestedAction: "prepare_callout",
                priority: "high",
                paragraphStart: 2,
                paragraphEnd: 2,
                excerpt: "пояснення механізму поверхневе",
                insertionHint: "after",
                calloutKind: "mechanism_explained",
                calloutTitle: "Як це працює?",
                calloutPreviewText: "Як кишечник керує обличчям?",
                calloutSummary: "Тема врізки",
                calloutPrompt: "Напиши врізку",
                visualIntent: null
              }
            ]
          })
        )
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.items.length, 0);
  assert.match(response.error ?? "", /врізк/);
  assert.equal(response.diagnostics.droppedItemCount, 1);
});
