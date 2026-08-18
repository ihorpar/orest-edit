import test from "node:test";
import assert from "node:assert/strict";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { generateEditorialReview } from "../lib/server/review-service.ts";
import { planEmphasisChunks, planReviewChunks } from "../lib/server/emphasis-chunk-planner.ts";
import { getReviewStepSpec } from "../lib/i18n/server-prompts/review.ts";
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
    modelId: "gpt-5.6-luna",
    changeLevel: 3,
    ...overrides
  };
}

function customRequestCardItem(recommendationType: string, extras: Record<string, unknown> = {}) {
  const isCallout = recommendationType === "callout";
  const isVisual = recommendationType === "visual";
  const isSubsection = recommendationType === "subsection";

  return {
    title: "Картка",
    reason: "Потрібна локальна дія.",
    recommendation: "Зробити локальну правку.",
    recommendationType,
    suggestedAction: isCallout ? "prepare_callout" : isVisual ? "prepare_visual" : isSubsection ? "insert_text" : "rewrite_text",
    priority: "medium",
    blockId: "p1",
    blockStart: 1,
    blockEnd: 1,
    excerpt: "Фрагмент",
    insertionHint: isCallout || isVisual ? "after" : isSubsection ? "before" : "replace",
    anchorBlockId: "p1",
    headingLevel: isSubsection ? 2 : null,
    headingTitle: isSubsection ? "Новий підзаголовок" : null,
    calloutKind: isCallout ? "mechanism" : null,
    calloutDepth: isCallout ? "brief" : null,
    calloutTitle: null,
    calloutPreviewText: null,
    calloutSummary: null,
    calloutPrompt: null,
    visualIntent: isVisual ? "infographic" : null,
    ...extras
  };
}

test("generateEditorialReview returns an explicit error without API key", async () => {
  const response = await generateEditorialReview(createRequest({ stepId: "clarity" }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "clarity");
  assert.equal(response.items.length, 0);
  assert.match(response.error ?? "", /Немає API key/i);
  assert.equal(response.diagnostics.blockCount, 2);
});

test("generateEditorialReview preserves typed provider HTTP failure details", async () => {
  const response = await generateEditorialReview(
    createRequest({ stepId: "clarity", apiKey: "test-key" }),
    {
      fetchImpl: async () => new Response(
        JSON.stringify({ error: { message: "Provider is busy" } }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "3",
            "x-request-id": "provider-request-1"
          }
        }
      ),
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.error, "Provider is busy");
  assert.deepEqual(response.diagnostics.providerError, {
    code: "http_error",
    retryable: true,
    status: 429,
    requestId: "provider-request-1",
    retryAfterMs: 3000
  });
});

test("generateEditorialReview preserves grounded Gemini HTTP failure details", async () => {
  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3.7-flash",
      stepId: "fact_check",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async () => new Response(
        JSON.stringify({ error: { message: "Grounding overloaded" } }),
        {
          status: 503,
          headers: {
            "content-type": "application/json",
            "retry-after": "2",
            "x-goog-request-id": "gemini-grounding-1"
          }
        }
      ),
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.error, "Grounding overloaded");
  assert.deepEqual(response.diagnostics.providerError, {
    code: "http_error",
    retryable: true,
    status: 503,
    requestId: "gemini-grounding-1",
    retryAfterMs: 2000
  });
});

test("generateEditorialReview injects concise diagnostics rubric by default", async () => {
  let requestBody = "";

  const response = await generateEditorialReview(
    createRequest({
      stepId: "diagnostics",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: "## Головний діагноз розділу\nТестова діагностика."
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "diagnostics");
  assert.match(requestBody, /стислої макродіагностики|concise macro-diagnostics/i);
  assert.match(requestBody, /Головний діагноз розділу/);
  assert.match(requestBody, /Ключові структурні проблеми/);
  assert.match(requestBody, /Що зайве або дубльоване/);
  assert.match(requestBody, /Пріоритетний план перебудови/);
  assert.doesNotMatch(requestBody, /Карта розділу/);
  assert.doesNotMatch(requestBody, /карта структури й читацького маршруту/i);
  assert.doesNotMatch(requestBody, /Короткий outline/);
  assert.doesNotMatch(requestBody, /Показові абзаци|8-15 найпоказовіших/);
  assert.doesNotMatch(requestBody, /Де потрібні підрозділи/);
  assert.match(requestBody, /Починай відповідь відразу з заголовка «## Головний діагноз розділу»/);
  assert.match(requestBody, /Не відкривай відповідь похвалою/i);
});

test("generateEditorialReview injects extended diagnostics outline rubric when requested", async () => {
  let requestBody = "";

  await generateEditorialReview(
    createRequest({
      stepId: "diagnostics",
      apiKey: "test-key",
      stepContext: { diagnosticsMode: "extended" }
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: "## Головний діагноз розділу\nТестова діагностика."
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.match(requestBody, /розширеної макродіагностики|extended macro-diagnostics/i);
  assert.match(requestBody, /Короткий outline/);
  assert.match(requestBody, /5–10 великих смислових зон/);
  assert.doesNotMatch(requestBody, /Показові абзаци|8-15 найпоказовіших/);
  assert.doesNotMatch(requestBody, /Де потрібні підрозділи/);
  assert.doesNotMatch(requestBody, /карта структури й читацького маршруту/i);
});

test("generateEditorialReview uses editable workflow step prompt overrides", async () => {
  let requestBody = "";

  await generateEditorialReview(
    createRequest({
      stepId: "clarity",
      apiKey: "test-key",
      workflowStepPrompts: {
        clarity: "Користувацький промпт ясності: прибирай туманні формулювання без медичних застережень."
      }
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ items: [] })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.match(requestBody, /Користувацький промпт ясності/);
});

test("generateEditorialReview builds a custom-request plan without executable cards", async () => {
  let requestBody = "";
  let callCount = 0;

  const response = await generateEditorialReview(
    createRequest({
      stepId: "final_editing",
      runMode: "replace",
      apiKey: "test-key",
      stepFeedback: "Додай візуал і врізку там, де це допоможе читачеві."
    }),
    {
      fetchImpl: async (_input, init) => {
        callCount += 1;
        requestBody += String(init?.body ?? "");

        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                actions: [
                  {
                    blockId: "p1",
                    recommendationType: "visual",
                    title: "Додати візуал",
                    recommendation: "Підготувати інфографіку з головними кроками механізму.",
                    priority: "high"
                  },
                  {
                    blockId: "p1",
                    recommendationType: "callout",
                    title: "Врізка",
                    recommendation: "Коротка врізка для читача.",
                    priority: "medium"
                  }
                ]
              })
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [
                customRequestCardItem("visual", { title: "Додати візуал" }),
                customRequestCardItem("callout", { title: "Врізка" })
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.stepId, "final_editing");
  assert.equal(response.runMode, "replace");
  assert.equal(callCount, 2);
  assert.equal(response.plan?.actions.length, 2);
  assert.equal(response.items.length, 2);
  assert.deepEqual(
    response.items.map((item) => item.recommendationType).sort(),
    ["callout", "visual"]
  );
  assert.match(requestBody, /Власний запит редактора для цього запуску/);
  assert.match(requestBody, /Додай візуал і врізку/);
  assert.doesNotMatch(requestBody, /Фідбек користувача для кроку/);
});

test("generateEditorialReview forces replace and skips diagnostics for final_editing", async () => {
  let requestBody = "";
  let callCount = 0;

  const response = await generateEditorialReview(
    createRequest({
      stepId: "final_editing",
      runMode: "preserve",
      apiKey: "test-key",
      expertise: "Макродіагноз: розділ перевантажений деталями.",
      stepFeedback: "Додай короткий список ключових кроків.",
      stepContext: {
        diagnosticsExpertise: "Макродіагноз: розділ перевантажений деталями.",
        diagnosticsFeedback: "Більше уваги до структури.",
        currentStepFeedback: "Додай короткий список ключових кроків."
      }
    }),
    {
      fetchImpl: async (_input, init) => {
        callCount += 1;
        requestBody += String(init?.body ?? "");

        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                actions: [
                  {
                    blockId: "p1",
                    recommendationType: "list",
                    title: "Список кроків",
                    recommendation: "Перетворити ключові кроки на список.",
                    priority: "medium"
                  }
                ]
              })
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [customRequestCardItem("list", { title: "Список кроків" })]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.runMode, "replace");
  assert.equal(response.items[0]?.recommendationType, "list");
  assert.doesNotMatch(requestBody, /Контекст діагностики/);
  assert.doesNotMatch(requestBody, /Фідбек користувача до діагностики/);
  assert.doesNotMatch(requestBody, /Макродіагноз/);
  assert.match(requestBody, /Додай короткий список ключових кроків/);
});

test("generateEditorialReview fails loud when final_editing has no custom request", async () => {
  const response = await generateEditorialReview(
    createRequest({
      stepId: "final_editing",
      apiKey: "test-key",
      stepFeedback: "   "
    }),
    {
      fetchImpl: async () => {
        throw new Error("provider must not be called without a custom request");
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.stepId, "final_editing");
  assert.equal(response.usedFallback, false);
  assert.equal(response.items.length, 0);
  assert.match(String(response.error), /власний запит/i);
});

test("generateEditorialReview uses automatic card density instead of visible change levels", async () => {
  let requestBody = "";

  await generateEditorialReview(
    createRequest({
      stepId: "clarity",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ items: [] })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.match(requestBody, /М'який орієнтир за кількістю карток/);
  assert.match(requestBody, /Це не квота і не максимум/);
  assert.match(requestBody, /blockId/);
  assert.doesNotMatch(requestBody, /Рівень змін|1\/5|2\/5|3\/5|4\/5|5\/5/);
});

test("generateEditorialReview uses a 4-8 card density guide for a 16k review chunk", async () => {
  let requestBody = "";
  const blocks = Array.from({ length: 40 }, (_, index) => ({
    id: `p${index + 1}`,
    type: "paragraph" as const,
    content: [{ text: "т".repeat(400) }]
  }));
  const document: EditorDocument = { version: 2, blocks };
  const coreBlockIds = blocks.map((block) => block.id);

  await generateEditorialReview(
    createRequest({
      document,
      revision: deriveManuscriptRevisionState(document),
      stepId: "clarity",
      apiKey: "test-key",
      reviewChunk: {
        index: 0,
        total: 1,
        coreBlockIds,
        contextBlockIds: []
      }
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ items: [] })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.match(requestBody, /приблизно 4-8 на 40 змістовних блоків і 16000 знаків/);
  assert.doesNotMatch(requestBody, /приблизно 3-50|приблизно 40-50/);
});

test("generateEditorialReview injects rejected ideas into step prompt", async () => {
  let requestBody = "";
  const longRejectedRecommendation = `Повторити вже відхилену ідею. ${"Зайвий контекст. ".repeat(40)}`;

  await generateEditorialReview(
    createRequest({
      stepId: "clarity",
      apiKey: "test-key",
      rejectedIdeas: [
        {
          blockIds: ["p1"],
          recommendationType: "rewrite",
          recommendation: longRejectedRecommendation
        }
      ]
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ items: [] })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.match(requestBody, /Ідеї, які редактор уже відхилив/);
  assert.match(requestBody, /Блоки: абз\. 002; тип: rewrite/);
  assert.match(requestBody, /Не повторюй ці ідеї як нові рекомендації/);
  assert.ok(!requestBody.includes("Зайвий контекст. ".repeat(30)));
});

test("generateEditorialReview drops items matching rejected recommendation type and block overlap", async () => {
  const response = await generateEditorialReview(
    createRequest({
      stepId: "clarity",
      apiKey: "test-key",
      rejectedIdeas: [
        {
          blockIds: ["p1"],
          recommendationType: "rewrite",
          recommendation: "Уже відхилена пропозиція переписати цей абзац."
        }
      ]
    }),
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [
                {
                  title: "Переписати абзац",
                  reason: "Фрагмент щільний.",
                  recommendation: "Переписати цей абзац простішою мовою.",
                  recommendationType: "rewrite",
                  suggestedAction: "rewrite_text",
                  priority: "high",
                  blockStart: 1,
                  blockEnd: 1,
                  excerpt: "Фрагмент",
                  insertionHint: "replace",
                  anchorBlockId: null,
                  calloutKind: null,
                  calloutDepth: null,
                  calloutTitle: null,
                  calloutPreviewText: null,
                  calloutSummary: null,
                  calloutPrompt: null,
                  visualIntent: null
                },
                {
                  title: "Трохи розширити пояснення",
                  reason: "Бракує пояснення терміна.",
                  recommendation: "Додати одне коротке уточнення без зміни структури.",
                  recommendationType: "expand",
                  suggestedAction: "rewrite_text",
                  priority: "medium",
                  blockStart: 1,
                  blockEnd: 1,
                  excerpt: "Фрагмент",
                  insertionHint: "replace",
                  anchorBlockId: null,
                  calloutKind: null,
                  calloutDepth: null,
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
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.recommendationType, "expand");
  assert.equal(response.diagnostics.droppedItemCountsByReason?.rejected_idea_duplicate, 1);
});

test("generateEditorialReview returns an explicit error for visuals step without API key", async () => {
  const response = await generateEditorialReview(createRequest({ stepId: "visuals" }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "visuals");
  assert.equal(response.items.length, 0);
  assert.equal(response.diagnostics.droppedItemCount, 0);
  assert.match(response.error ?? "", /Немає API key/i);
});

test("generateEditorialReview prompt encourages deep callouts for dense explanatory fragments", async () => {
  let requestBody = "";

  await generateEditorialReview(
    createRequest({
      stepId: "interest",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

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

  assert.match(requestBody, /для щільного пояснювального тексту — deep/i);
  assert.match(requestBody, /calloutKind і calloutDepth/i);
  assert.match(requestBody, /глобальна рамка/i);
  assert.match(requestBody, /локальне винесення/i);
  assert.doesNotMatch(requestBody, /якорі-підзаголовки/i);
  assert.doesNotMatch(requestBody, /не використовуй #, ## або HTML-заголовки/i);
});

test("generateEditorialReview serializes structural blocks in step prompts", async () => {
  let requestBody = "";
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 2, content: [{ text: "Механізм" }] },
      {
        id: "c1",
        type: "callout",
        kind: "mechanism",
        depth: "deep",
        title: [{ text: "Як це працює" }],
        body: [
          [{ text: "Стислий опис уже додано у врізці." }],
          [{ text: "Другий абзац пояснює наслідок." }]
        ]
      },
      {
        id: "l1",
        type: "bullet_list",
        items: [[{ text: "Перший пункт" }], [{ text: "Другий пункт" }]]
      }
    ]
  };

  await generateEditorialReview(
    createRequest({
      document,
      revision: deriveManuscriptRevisionState(document),
      stepId: "formatting",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ items: [] })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.match(requestBody, /## Механізм/);
  assert.match(requestBody, /\[callout:mechanism:deep\] Як це працює/);
  assert.match(requestBody, /Стислий опис уже додано у врізці/);
  assert.match(requestBody, /- Перший пункт/);
  assert.match(requestBody, /- Другий пункт/);
});

test("generateEditorialReview returns an explicit error for structure step without API key", async () => {
  const response = await generateEditorialReview(createRequest({ stepId: "structure" }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.items.length, 0);
  assert.match(response.error ?? "", /Немає API key/i);
});

test("generateEditorialReview returns an explicit error for emphasis step without API key", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [{ text: "Шкіра часто першою сигналізує про внутрішній стрес, тому читачеві важливо швидко побачити цю головну тезу без переписування всього абзацу." }]
      }
    ]
  };
  const response = await generateEditorialReview(createRequest({
    document,
    revision: deriveManuscriptRevisionState(document),
    stepId: "emphasis"
  }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "emphasis");
  assert.equal(response.items.length, 0);
  assert.match(response.error ?? "", /Немає API key/i);
});

test("generateEditorialReview includes existing bold markers in emphasis prompt", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [
          { text: "Шкіра " },
          { text: "часто першою показує", bold: true },
          { text: ", як організм реагує на стрес." }
        ]
      }
    ]
  };
  let requestBody = "";

  await generateEditorialReview(
    {
      ...createRequest({
        document,
        revision: deriveManuscriptRevisionState(document),
        stepId: "emphasis",
        apiKey: "test-key"
      })
    },
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

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

  assert.match(requestBody, /\*\*часто першою показує\*\*/);
  assert.match(requestBody, /blockId/);
});

test("generateEditorialReview injects automatic emphasis coverage guidance", async () => {
  let requestBody = "";

  await generateEditorialReview(
    createRequest({
      stepId: "emphasis",
      apiKey: "test-key",
      changeLevel: 2
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

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

  assert.match(requestBody, /Багато змістовних абзаців можуть потребувати акценту/);
  assert.match(requestBody, /М'який орієнтир для цього документа: приблизно \d+-\d+ акцентів/);
  assert.match(requestBody, /слід покривати значну частину змістовного тексту/);
  assert.doesNotMatch(requestBody, /Рівень змін|рівня змін|2\/5/);
});

test("generateEditorialReview asks emphasis to cover nearly every meaningful paragraph automatically", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: Array.from({ length: 20 }, (_, index) => ({
      id: `p${index + 1}`,
      type: "paragraph" as const,
      content: [
        {
          text: `Meaningful paragraph ${index + 1} contains a standalone thesis and enough context for a useful scan-friendly accent.`
        }
      ]
    }))
  };
  let requestBody = "";

  await generateEditorialReview(
    createRequest({
      document,
      revision: deriveManuscriptRevisionState(document),
      stepId: "emphasis",
      apiKey: "test-key",
      changeLevel: 5
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

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

  assert.match(requestBody, /17-20/);
  assert.doesNotMatch(requestBody, /5\/5|Рівень змін/);
});

test("generateEditorialReview chunks large emphasis runs and merges global anchors", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: Array.from({ length: 40 }, (_, index) => ({
      id: `p${index + 1}`,
      type: "paragraph" as const,
      content: [{ text: `Абзац ${index + 1} містить ключову тезу для діагонального читання. `.repeat(20) }]
    }))
  };
  const chunks = planEmphasisChunks(document.blocks);
  let requestCount = 0;

  const response = await generateEditorialReview(
    createRequest({
      document,
      revision: deriveManuscriptRevisionState(document),
      stepId: "emphasis",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async () => {
        requestCount += 1;

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [
                {
                  blockId: chunks[requestCount - 1].coreBlockIds[0],
                  excerpt: "тест",
                  priority: "medium",
                  emphasisText: "ключову тезу"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(requestCount, chunks.length);
  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "emphasis");
  assert.equal(response.items.length, chunks.length);
  assert.deepEqual(
    response.items.map((item) => item.anchor.blockIds[0]),
    chunks.map((chunk) => chunk.coreBlockIds[0])
  );
});

test("generateEditorialReview executes a workflow-owned emphasis chunk exactly once with a stable request identity", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: Array.from({ length: 40 }, (_, index) => ({
      id: `p${index + 1}`,
      type: "paragraph" as const,
      content: [{ text: `Абзац ${index + 1} містить ключову тезу для одного workflow-чанка. `.repeat(20) }]
    }))
  };
  let requestCount = 0;
  let clientRequestId: string | null = null;

  const response = await generateEditorialReview(
    createRequest({
      document,
      revision: deriveManuscriptRevisionState(document),
      stepId: "emphasis",
      apiKey: "test-key",
      emphasisChunk: {
        index: 0,
        total: 1,
        coreBlockIds: document.blocks.map((block) => block.id),
        contextBlockIds: []
      },
      providerRequestKey: "step_stable-123"
    }),
    {
      fetchImpl: async (_input, init) => {
        requestCount += 1;
        clientRequestId = new Headers(init?.headers).get("x-client-request-id");
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [{
                blockId: "p1",
                excerpt: "тест",
                priority: "medium",
                emphasisText: "ключову тезу"
              }]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(requestCount, 1);
  assert.equal(clientRequestId, "step_stable-123");
  assert.equal(response.stepRunId, "step-run-emphasis-step_stable-123");
  assert.equal(response.items.length, 1);
});

test("generateEditorialReview retries transient chunked emphasis fetch failures", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: Array.from({ length: 30 }, (_, index) => ({
      id: `p${index + 1}`,
      type: "paragraph" as const,
      content: [{ text: `Абзац ${index + 1} містить ключову тезу для тесту повторних спроб у кроці акцентів. `.repeat(20) }]
    }))
  };
  const chunks = planEmphasisChunks(document.blocks);
  let requestCount = 0;
  let sleepCalls = 0;
  const failedChunkIndexes = new Set<number>();

  const response = await generateEditorialReview(
    createRequest({
      document,
      revision: deriveManuscriptRevisionState(document),
      stepId: "emphasis",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async (_input, init) => {
        const body = String(init?.body ?? "");
        const chunkMatch = body.match(/Чанк (\d+)\//);
        const chunkIndex = Number(chunkMatch?.[1] ?? "1") - 1;
        requestCount += 1;

        if (chunkIndex === 1 && !failedChunkIndexes.has(1)) {
          failedChunkIndexes.add(1);
          throw new TypeError("Failed to fetch");
        }

        const blockId = chunks[chunkIndex].coreBlockIds[0];
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [
                {
                  blockId,
                  excerpt: "тест",
                  priority: "medium",
                  emphasisText: "ключову тезу"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      sleepImpl: async () => {
        sleepCalls += 1;
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(requestCount, chunks.length + 1);
  assert.equal(sleepCalls, 1);
  assert.equal(response.error, undefined);
  assert.deepEqual(
    response.items.map((item) => item.anchor.blockIds[0]),
    chunks.map((chunk) => chunk.coreBlockIds[0])
  );
});

test("generateEditorialReview does not retry invalid chunked emphasis output", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: Array.from({ length: 30 }, (_, index) => ({
      id: `p${index + 1}`,
      type: "paragraph" as const,
      content: [{ text: `Абзац ${index + 1} містить ключову тезу для тесту помилки схеми акцентів. `.repeat(20) }]
    }))
  };
  const chunks = planEmphasisChunks(document.blocks);
  let requestCount = 0;
  let sleepCalls = 0;

  const response = await generateEditorialReview(
    createRequest({
      document,
      revision: deriveManuscriptRevisionState(document),
      stepId: "emphasis",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async () => {
        requestCount += 1;
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [
                {
                  blockId: "p1",
                  excerpt: "тест",
                  priority: "medium"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      sleepImpl: async () => {
        sleepCalls += 1;
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(requestCount, chunks.length);
  assert.equal(sleepCalls, 0);
  assert.equal(response.error, undefined);
  assert.equal(response.items.length, 0);
  assert.equal(response.diagnostics.droppedItemCount, chunks.length);
  assert.equal(response.diagnostics.droppedItemCountsByReason?.missing_required_fields, chunks.length);
});

test("generateEditorialReview repairs emphasis anchor when blockId is wrong but phrase is unique", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [{ text: "Перший абзац задає контекст і не містить цільової фрази." }]
      },
      {
        id: "p2",
        type: "paragraph",
        content: [{ text: "Другий абзац містить унікальний вислів критично важливий маркер для діагонального читання." }]
      }
    ]
  };

  const response = await generateEditorialReview(createRequest({
    document,
    revision: deriveManuscriptRevisionState(document),
    apiKey: "test-key",
    stepId: "emphasis"
  }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            items: [
              {
                blockId: "p1",
                excerpt: "Перший абзац задає контекст",
                priority: "medium",
                emphasisText: "критично важливий маркер"
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
  assert.deepEqual(response.items[0]?.anchor.blockIds, ["p2"]);
  assert.equal(response.items[0]?.emphasisTarget?.text, "критично важливий маркер");
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

test("generateEditorialReview normalizes provider emphasis items to exact targets", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [{ text: "Шкіра часто першою показує, як організм реагує на стрес." }]
      }
    ]
  };

  const response = await generateEditorialReview(createRequest({
    document,
    revision: deriveManuscriptRevisionState(document),
    apiKey: "test-key",
    stepId: "emphasis"
  }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
            output_text: JSON.stringify({
              items: [
                {
                  blockId: "p1",
                  excerpt: "Шкіра часто першою показує, як організм реагує на стрес.",
                  priority: "medium",
                  emphasisText: "першою показує",
                  occurrence: null
                }
              ]
            })
          }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "emphasis");
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.emphasisTarget?.text, "першою показує");
  assert.equal(response.items[0]?.emphasisTarget?.occurrence, undefined);
  assert.deepEqual(response.items[0]?.anchor.blockIds, ["p1"]);
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
                explanation: "Потрібно уточнити силу ефекту та межі застосовності на основі оглядових робіт.",
                sources: []
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
  assert.equal(response.factCheckRows?.[0]?.status, "questionable");
  assert.deepEqual(response.factCheckRows?.[0]?.sources, []);
  assert.equal(
    response.factCheckRows?.[0]?.explanation,
    "Не знайдено надійного зовнішнього джерела. Потрібна ручна перевірка."
  );
});

test("generateEditorialReview fact-check prompt asks for red flags only", async () => {
  let requestBody = "";

  const response = await generateEditorialReview(createRequest({ apiKey: "test-key", stepId: "fact_check" }), {
    fetchImpl: async (_input, init) => {
      requestBody = String(init?.body ?? "");

      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({ rows: [] })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.factCheckRows?.length, 0);
  assert.match(requestBody, /лише проблемні або сумнівні рядки/i);
  assert.match(requestBody, /Ніколи не повертай рядки зі статусом ok/i);
  assert.match(requestBody, /застаріла або радянська медична рамка/i);
  assert.match(requestBody, /дозування, тривалість, ризики, лабораторні пороги/i);
});

test("generateEditorialReview drops ok fact-check rows instead of showing reassurance", async () => {
  const response = await generateEditorialReview(createRequest({ apiKey: "test-key", stepId: "fact_check" }), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            rows: [
              {
                claim: "Вода потрібна організму.",
                status: "ok",
                explanation: "Це коректне твердження.",
                sources: []
              }
            ]
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-10T12:00:00.000Z"
  });

  assert.equal(response.usedFallback, false);
  assert.deepEqual(response.factCheckRows, []);
});

test("generateEditorialReview adds local suspicion rows for medical numbers and units", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [{ text: "Для нормалізації тиску автор радить 500 мг речовини щодня протягом 30 днів." }]
      }
    ]
  };

  const response = await generateEditorialReview(
    createRequest({
      document,
      revision: deriveManuscriptRevisionState(document),
      apiKey: "test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({ rows: [] })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.status, "questionable");
  assert.match(response.factCheckRows?.[0]?.claim ?? "", /500 мг/);
  assert.match(response.factCheckRows?.[0]?.explanation ?? "", /число або одиниця вимірювання/);
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

test("generateEditorialReview sends grounded Gemini fact-check request via header and resolves sources", async () => {
  let requestedUrl = "";
  let requestHeaders = new Headers();
  const requestedUrls: string[] = [];

  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3.7-flash",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async (input, init) => {
        const url = String(input);
        requestedUrls.push(url);

        if (url.includes(":generateContent")) {
          requestedUrl = url;
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
                              status: "сумнівно",
                              explanation: "Тестове обґрунтування.",
                              sources: []
                            }
                          ]
                        })
                      }
                    ]
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test-source",
                          title: "Mayo Clinic"
                        }
                      }
                    ],
                    groundingSupports: [
                      {
                        segment: {
                          text: "Тестове обґрунтування."
                        },
                        groundingChunkIndices: [0]
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url === "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test-source") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://www.mayoclinic.org/symptoms/clubbing/basics/definition/sym-20050759" }
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "fact_check");
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources[0]?.domain, "mayoclinic.org");
  assert.match(requestedUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.doesNotMatch(requestedUrl, /\?key=/);
  assert.equal(requestHeaders.get("x-goog-api-key"), "gemini-test-key");
  assert.equal(requestedUrls.some((url) => url.includes("grounding-api-redirect/test-source")), true);
});

test("generateEditorialReview preserves parsed row sources when grounded mapping misses", async () => {
  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3.7-flash",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.includes(":generateContent")) {
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
                              status: "сумнівно",
                              explanation: "Текст пояснення.",
                              sources: [
                                {
                                  title: "Mayo Clinic",
                                  url: "https://www.mayoclinic.org/symptoms/clubbing/basics/definition/sym-20050759",
                                  domain: "mayoclinic.org"
                                }
                              ]
                            }
                          ]
                        })
                      }
                    ]
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test-source",
                          title: "Ignored source"
                        }
                      }
                    ],
                    groundingSupports: [
                      {
                        segment: {
                          text: "Несумісний сегмент"
                        },
                        groundingChunkIndices: [0]
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url === "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test-source") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://www.clevelandclinic.org/health/symptoms/24474-clubbed-fingers" }
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources[0]?.domain, "mayoclinic.org");
});

test("generateEditorialReview drops grounded sources outside trusted domain allowlist", async () => {
  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3.7-flash",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.includes(":generateContent")) {
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
                              status: "сумнівно",
                              explanation: "Тестове обґрунтування.",
                              sources: []
                            }
                          ]
                        })
                      }
                    ]
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/untrusted",
                          title: "Untrusted Source"
                        }
                      },
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/trusted",
                          title: "Mayo Clinic"
                        }
                      }
                    ],
                    groundingSupports: [
                      {
                        segment: {
                          text: "Тестове обґрунтування."
                        },
                        groundingChunkIndices: [0, 1]
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url === "https://vertexaisearch.cloud.google.com/grounding-api-redirect/untrusted") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://ujdvc.com.ua/article" }
          });
        }

        if (url === "https://vertexaisearch.cloud.google.com/grounding-api-redirect/trusted") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://www.mayoclinic.org/symptoms/clubbing/basics/definition/sym-20050759" }
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources[0]?.domain, "mayoclinic.org");
});

test("generateEditorialReview replaces unsupported explanations when suspicious rows have no trusted sources", async () => {
  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3.7-flash",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
    }),
    {
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.includes(":generateContent")) {
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
                              status: "сумнівно",
                              explanation: "Старе впевнене пояснення без джерела.",
                              sources: []
                            }
                          ]
                        })
                      }
                    ]
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/untrusted-only",
                          title: "Untrusted Source"
                        }
                      }
                    ],
                    groundingSupports: [
                      {
                        segment: {
                          text: "Старе впевнене пояснення без джерела."
                        },
                        groundingChunkIndices: [0]
                      }
                    ]
                  }
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url === "https://vertexaisearch.cloud.google.com/grounding-api-redirect/untrusted-only") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://health-ua.com/article" }
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources.length, 0);
  assert.equal(
    response.factCheckRows?.[0]?.explanation,
    "Не знайдено надійного зовнішнього джерела. Потрібна ручна перевірка."
  );
});

test("generateEditorialReview filters model-provided row sources by URL domain allowlist", async () => {
  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3.5-flash-lite",
      apiKey: "gemini-test-key",
      stepId: "fact_check"
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
                        rows: [
                          {
                            claim: "Тестове твердження.",
                            status: "сумнівно",
                            explanation: "Тестове обґрунтування.",
                            sources: [
                              {
                                title: "Сумнівний блог",
                                url: "https://health-ua.com/article",
                                domain: "mayoclinic.org"
                              },
                              {
                                title: "Mayo Clinic",
                                url: "https://www.mayoclinic.org/symptoms/clubbing/basics/definition/sym-20050759",
                                domain: "random.invalid"
                              }
                            ]
                          }
                        ]
                      })
                    }
                  ]
                },
                groundingMetadata: {}
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.factCheckRows?.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources.length, 1);
  assert.equal(response.factCheckRows?.[0]?.sources[0]?.domain, "mayoclinic.org");
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
  assert.match(String(requestBody?.instructions ?? ""), /для «ясність» не пропонуй підзаголовки, врізки, таблиці або зміни макроструктури/i);
  assert.match(String(requestBody?.instructions ?? ""), /одна картка має охоплювати лише один суцільний діапазон абзаців без розривів/i);
  assert.doesNotMatch(String(requestBody?.instructions ?? ""), /subsection.*одна картка означає рівно одну дію/i);
  assert.match(String(requestBody?.instructions ?? ""), /якщо одна проблема є в несуміжних місцях/i);
  assert.match(String(requestBody?.instructions ?? ""), /пунктуація списків:/i);
  assert.match(String(requestBody?.instructions ?? ""), /починається з малої літери/i);
  assert.match(String(requestBody?.input ?? ""), /збережи короткі окремі пункти/i);
});

test("generateEditorialReview filters recommendation types by focused step allowlist", async () => {
  assert.deepEqual(getReviewStepSpec("formatting", "uk").allowedRecommendationTypes, ["list", "callout"]);
  assert.deepEqual(getReviewStepSpec("interest", "uk").allowedRecommendationTypes, ["callout", "expand"]);

  const providerItems = [
    {
      title: "Переписати речення",
      reason: "Локальна неясність формулювання.",
      recommendation: "Переписати речення коротше.",
      recommendationType: "rewrite",
      suggestedAction: "rewrite_text",
      priority: "high",
      blockStart: 1,
      blockEnd: 1,
      excerpt: "Фрагмент абзацу",
      insertionHint: "replace",
      anchorBlockId: "p1"
    },
    {
      title: "Спростити термін",
      reason: "Надмірна термінологічність.",
      recommendation: "Спростити термін без втрати змісту.",
      recommendationType: "simplify",
      suggestedAction: "rewrite_text",
      priority: "medium",
      blockStart: 1,
      blockEnd: 1,
      excerpt: "Фрагмент абзацу",
      insertionHint: "replace",
      anchorBlockId: "p1"
    },
    {
      title: "Локально розгорнути пояснення",
      reason: "Коротке формулювання без зв'язки.",
      recommendation: "Додати одне коротке пояснення причинно-наслідкового зв'язку.",
      recommendationType: "expand",
      suggestedAction: "rewrite_text",
      priority: "medium",
      blockStart: 1,
      blockEnd: 1,
      excerpt: "Фрагмент абзацу",
      insertionHint: "replace",
      anchorBlockId: "p1"
    },
    {
      title: "Оформити списком",
      reason: "Є дискретні пункти для сканування.",
      recommendation: "Оформити 3-4 пункти списком.",
      recommendationType: "list",
      suggestedAction: "rewrite_text",
      priority: "medium",
      blockStart: 1,
      blockEnd: 1,
      excerpt: "Фрагмент абзацу",
      insertionHint: "replace",
      anchorBlockId: "p1"
    },
    {
      title: "Додати підзаголовок",
      reason: "Тут змінюється мікротема.",
      recommendation: "Додати короткий підзаголовок перед фрагментом.",
      recommendationType: "subsection",
      suggestedAction: "insert_text",
      priority: "medium",
      blockStart: 1,
      blockEnd: 1,
      excerpt: "Фрагмент абзацу",
      insertionHint: "before",
      anchorBlockId: "p1",
      headingLevel: 3
    },
    {
      title: "Додати врізку",
      reason: "Потрібен швидкий пояснювальний винос.",
      recommendation: "Додати коротку врізку після абзацу.",
      recommendationType: "callout",
      suggestedAction: "prepare_callout",
      priority: "medium",
      blockStart: 1,
      blockEnd: 1,
      excerpt: "Фрагмент абзацу",
      insertionHint: "after",
      anchorBlockId: "p1",
      calloutKind: "mechanism"
    },
    {
      title: "Додати візуал",
      reason: "Схема допоможе пояснити процес.",
      recommendation: "Підготувати інфографіку процесу.",
      recommendationType: "visual",
      suggestedAction: "prepare_visual",
      priority: "medium",
      blockStart: 1,
      blockEnd: 1,
      excerpt: "Фрагмент абзацу",
      insertionHint: "after",
      anchorBlockId: "p1",
      visualIntent: "infographic"
    }
  ];

  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          items: providerItems
        })
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  const structureResponse = await generateEditorialReview(
    createRequest({ apiKey: "test-key", stepId: "structure" }),
    { fetchImpl, now: () => "2026-03-10T12:00:00.000Z" }
  );
  const clarityResponse = await generateEditorialReview(
    createRequest({ apiKey: "test-key", stepId: "clarity" }),
    { fetchImpl, now: () => "2026-03-10T12:00:00.000Z" }
  );
  const formattingResponse = await generateEditorialReview(
    createRequest({ apiKey: "test-key", stepId: "formatting" }),
    { fetchImpl, now: () => "2026-03-10T12:00:00.000Z" }
  );
  const interestResponse = await generateEditorialReview(
    createRequest({ apiKey: "test-key", stepId: "interest" }),
    { fetchImpl, now: () => "2026-03-10T12:00:00.000Z" }
  );
  const visualsResponse = await generateEditorialReview(
    createRequest({ apiKey: "test-key", stepId: "visuals" }),
    { fetchImpl, now: () => "2026-03-10T12:00:00.000Z" }
  );
  let finalEditingCalls = 0;
  const finalEditingResponse = await generateEditorialReview(
    createRequest({
      apiKey: "test-key",
      stepId: "final_editing",
      stepFeedback: "Зроби все корисне для читача."
    }),
    {
      fetchImpl: async () => {
        finalEditingCalls += 1;
        if (finalEditingCalls === 1) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                actions: [
                  { blockId: "p1", recommendationType: "rewrite", title: "Rewrite", recommendation: "Seed", priority: "medium" },
                  { blockId: "p1", recommendationType: "simplify", title: "Simplify", recommendation: "Seed", priority: "medium" },
                  { blockId: "p1", recommendationType: "expand", title: "Expand", recommendation: "Seed", priority: "medium" },
                  { blockId: "p1", recommendationType: "list", title: "List", recommendation: "Seed", priority: "medium" },
                  { blockId: "p1", recommendationType: "subsection", title: "Subsection", recommendation: "Seed", priority: "medium" },
                  { blockId: "p1", recommendationType: "callout", title: "Callout", recommendation: "Seed", priority: "medium" },
                  { blockId: "p1", recommendationType: "visual", title: "Visual", recommendation: "Seed", priority: "medium" }
                ]
              })
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [
                customRequestCardItem("rewrite"),
                customRequestCardItem("simplify"),
                customRequestCardItem("expand"),
                customRequestCardItem("list"),
                customRequestCardItem("subsection"),
                customRequestCardItem("callout"),
                customRequestCardItem("visual")
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.deepEqual(
    structureResponse.items.map((item) => item.recommendationType).sort(),
    ["subsection"]
  );
  assert.equal(structureResponse.diagnostics.filteredItemCountsByType?.rewrite, 1);
  assert.equal(structureResponse.diagnostics.filteredItemCountsByType?.list, 1);
  assert.equal(structureResponse.diagnostics.filteredItemCountsByType?.callout, 1);
  assert.equal(structureResponse.diagnostics.droppedItemCountsByReason?.filtered_by_step_type, 6);

  assert.deepEqual(
    clarityResponse.items.map((item) => item.recommendationType).sort(),
    ["expand", "rewrite", "simplify"]
  );
  assert.equal(clarityResponse.diagnostics.filteredItemCountsByType?.list, 1);
  assert.equal(clarityResponse.diagnostics.filteredItemCountsByType?.subsection, 1);
  assert.equal(clarityResponse.diagnostics.filteredItemCountsByType?.callout, 1);
  assert.equal(clarityResponse.diagnostics.filteredItemCountsByType?.visual, 1);
  assert.equal(clarityResponse.diagnostics.droppedItemCountsByReason?.filtered_by_step_type, 4);

  assert.deepEqual(
    formattingResponse.items.map((item) => item.recommendationType).sort(),
    ["callout", "list"]
  );
  assert.equal(formattingResponse.diagnostics.filteredItemCountsByType?.subsection, 1);
  assert.equal(formattingResponse.diagnostics.droppedItemCountsByReason?.filtered_by_step_type, 5);

  assert.deepEqual(
    interestResponse.items.map((item) => item.recommendationType).sort(),
    ["callout", "expand"]
  );
  assert.equal(interestResponse.diagnostics.filteredItemCountsByType?.rewrite, 1);
  assert.equal(interestResponse.diagnostics.filteredItemCountsByType?.visual, 1);
  assert.equal(interestResponse.diagnostics.droppedItemCountsByReason?.filtered_by_step_type, 5);

  assert.deepEqual(
    visualsResponse.items.map((item) => item.recommendationType).sort(),
    ["visual"]
  );
  assert.equal(visualsResponse.diagnostics.droppedItemCountsByReason?.filtered_by_step_type, 6);

  assert.deepEqual(
    finalEditingResponse.plan?.actions.map((item) => item.recommendationType).sort(),
    ["callout", "expand", "list", "rewrite", "simplify", "subsection", "visual"]
  );
  assert.equal(finalEditingResponse.items.length, 7);
  assert.equal(finalEditingResponse.diagnostics.filteredItemCountsByType, undefined);
  assert.equal(finalEditingResponse.diagnostics.droppedItemCountsByReason?.filtered_by_step_type, undefined);

  const emphasisFetchImpl = async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          items: [
            {
              blockId: "p1",
              excerpt: "Це дуже довгий абзац",
              priority: "high",
              emphasisText: "дуже довгий",
              occurrence: 1,
              recommendationType: "rewrite"
            },
            {
              blockId: "p1",
              excerpt: "Це дуже довгий абзац",
              priority: "medium",
              emphasisText: "для читача",
              occurrence: 1,
              recommendationType: "callout"
            }
          ]
        })
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  const emphasisResponse = await generateEditorialReview(
    createRequest({
      apiKey: "test-key",
      stepId: "emphasis",
      emphasisChunk: {
        index: 0,
        total: 1,
        coreBlockIds: ["p1"],
        contextBlockIds: ["h1"]
      }
    }),
    { fetchImpl: emphasisFetchImpl, now: () => "2026-03-10T12:00:00.000Z" }
  );

  assert.equal(emphasisResponse.items.length, 1);
  assert.equal(emphasisResponse.items[0]?.recommendationType, "rewrite");
  assert.equal(emphasisResponse.diagnostics.filteredItemCountsByType?.callout, 1);
  assert.equal(emphasisResponse.diagnostics.droppedItemCountsByReason?.filtered_by_step_type, 1);
});

test("generateEditorialReview injects structure, formatting, and interest scope guardrails into prompts", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);

    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          items: []
        })
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  await generateEditorialReview(createRequest({ apiKey: "test-key", stepId: "structure" }), {
    fetchImpl,
    now: () => "2026-03-10T12:00:00.000Z"
  });
  await generateEditorialReview(createRequest({ apiKey: "test-key", stepId: "formatting" }), {
    fetchImpl,
    now: () => "2026-03-10T12:00:00.000Z"
  });
  await generateEditorialReview(createRequest({ apiKey: "test-key", stepId: "interest" }), {
    fetchImpl,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  const structureInstructions = String(requestBodies[0]?.instructions ?? "");
  const formattingInstructions = String(requestBodies[1]?.instructions ?? "");
  const interestInstructions = String(requestBodies[2]?.instructions ?? "");

  assert.match(structureInstructions, /recommendationType='subsection'/i);
  assert.match(structureInstructions, /headinglevel=2 для нового смислового розділу/i);
  assert.match(structureInstructions, /одна картка = один конкретний підзаголовок/i);
  assert.match(formattingInstructions, /списки та врізки/i);
  assert.doesNotMatch(formattingInstructions, /list\/subsection\/callout/i);
  assert.match(formattingInstructions, /Не пропонуй підзаголовки — вони належать кроку «Структура»/);
  assert.match(interestInstructions, /не пропонуй візуали/i);
  assert.match(interestInstructions, /не роби мовне переписування заради ясності/i);
  assert.match(formattingInstructions, /глобальна рамка/i);
  assert.match(formattingInstructions, /локальне винесення/i);
  assert.match(interestInstructions, /глобальна рамка/i);
  assert.doesNotMatch(formattingInstructions, /якорі-підзаголовки/i);
  assert.doesNotMatch(structureInstructions, /calloutKind/);
});

function clarityCardPayload(blockId: string) {
  return {
    title: "Спростити абзац",
    reason: "Фрагмент щільний.",
    recommendation: "Переписати цей абзац простішою мовою.",
    recommendationType: "simplify",
    suggestedAction: "rewrite_text",
    priority: "high",
    blockStart: 0,
    blockEnd: 0,
    blockId,
    excerpt: "Фрагмент",
    insertionHint: "replace",
    anchorBlockId: null,
    calloutKind: null,
    calloutDepth: null,
    calloutTitle: null,
    calloutPreviewText: null,
    calloutSummary: null,
    calloutPrompt: null,
    visualIntent: null
  };
}

test("generateEditorialReview maps AbortError to a localized timeout instead of the raw abort text", async () => {
  const ukResponse = await generateEditorialReview(
    createRequest({ stepId: "clarity", apiKey: "test-key" }),
    {
      fetchImpl: async () => {
        throw new DOMException("This operation was aborted", "AbortError");
      },
      now: () => "2026-08-12T12:00:00.000Z"
    }
  );

  assert.match(ukResponse.error ?? "", /OpenAI перевищив таймаут 280с/);
  assert.doesNotMatch(ukResponse.error ?? "", /This operation was aborted/);
  assert.deepEqual(ukResponse.diagnostics.providerError, { code: "timeout", retryable: true });

  const enResponse = await generateEditorialReview(
    createRequest({ stepId: "clarity", locale: "en", apiKey: "test-key" }),
    {
      fetchImpl: async () => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        throw error;
      },
      now: () => "2026-08-12T12:00:00.000Z"
    }
  );

  assert.match(enResponse.error ?? "", /OpenAI exceeded the 280s timeout/);
  assert.doesNotMatch(enResponse.error ?? "", /This operation was aborted/);
});

test("generateEditorialReview keeps prefix clarity cards when a later chunk times out", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "перший ".repeat(1500) }] },
      { id: "p2", type: "paragraph", content: [{ text: "другий ".repeat(1500) }] }
    ]
  };
  let requestCount = 0;

  const response = await generateEditorialReview(
    createRequest({
      document,
      revision: deriveManuscriptRevisionState(document),
      stepId: "clarity",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async () => {
        requestCount += 1;

        if (requestCount === 1) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({ items: [clarityCardPayload("p1")] })
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        throw new DOMException("This operation was aborted", "AbortError");
      },
      sleepImpl: async () => undefined,
      now: () => "2026-08-12T12:00:00.000Z"
    }
  );

  assert.ok(requestCount >= 2);
  assert.equal(response.error, undefined);
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0]?.anchor.blockIds[0], "p1");
  assert.equal(response.items[0]?.documentRevisionId, deriveManuscriptRevisionState(document).documentRevisionId);
  assert.equal(response.diagnostics.failedChunks?.length, 1);
  assert.deepEqual(response.diagnostics.failedChunks?.[0]?.coreBlockIds, ["p2"]);
  assert.match(response.diagnostics.failedChunks?.[0]?.message ?? "", /таймаут 280с/);
  assert.doesNotMatch(response.diagnostics.failedChunks?.[0]?.message ?? "", /This operation was aborted/);
});

test("generateEditorialReview truncates diagnostics context for a review chunk", async () => {
  let requestBody = "";
  const uniqueTail = "UNIQUE_DIAGNOSTICS_TAIL_MARKER";
  const longDiagnostics = `${"Діагностика розділу. ".repeat(80)}${uniqueTail}`;

  await generateEditorialReview(
    createRequest({
      stepId: "clarity",
      apiKey: "test-key",
      expertise: longDiagnostics,
      reviewChunk: {
        index: 0,
        total: 2,
        coreBlockIds: ["p1"],
        contextBlockIds: []
      }
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({ output_text: JSON.stringify({ items: [] }) }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-08-12T12:00:00.000Z"
    }
  );

  assert.ok(requestBody.includes("Діагностика розділу."));
  assert.ok(!requestBody.includes(uniqueTail));
  assert.ok(requestBody.includes("…"));
});

test("generateEditorialReview tells chunked clarity to skip context-only blocks", async () => {
  let requestBody = "";

  await generateEditorialReview(
    createRequest({
      stepId: "clarity",
      apiKey: "test-key",
      reviewChunk: {
        index: 1,
        total: 4,
        coreBlockIds: ["p1"],
        contextBlockIds: ["h1"]
      }
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({ output_text: JSON.stringify({ items: [] }) }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-08-12T12:00:00.000Z"
    }
  );

  assert.match(requestBody, /Чанк 2\/4/);
  assert.match(requestBody, /основних blockId: p1/);
  assert.match(requestBody, /не повертай для них картки: h1/);
});

test("generateEditorialReview runs at most three recommendation chunks at once", async () => {
  const filler = "абзац для паралельного розбору ".repeat(450);
  const document: EditorDocument = {
    version: 2,
    blocks: [1, 2, 3, 4].flatMap((index) => [
      { id: `h${index}`, type: "heading" as const, level: 2 as const, content: [{ text: `Розділ ${index}` }] },
      { id: `p${index}`, type: "paragraph" as const, content: [{ text: `${filler} ${index}` }] }
    ])
  };
  const chunks = planReviewChunks(document.blocks);
  assert.ok(chunks.length >= 4, `expected at least 4 chunks, got ${chunks.length}`);

  let inFlight = 0;
  let maxInFlight = 0;
  let started = 0;

  await generateEditorialReview(
    createRequest({
      document,
      revision: deriveManuscriptRevisionState(document),
      stepId: "clarity",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async () => {
        started += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlight -= 1;
        return new Response(
          JSON.stringify({ output_text: JSON.stringify({ items: [] }) }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-08-17T12:00:00.000Z"
    }
  );

  assert.equal(started, chunks.length);
  assert.equal(maxInFlight, 3);
});

test("generateEditorialReview fails loud when custom-request plan has no valid actions", async () => {
  const response = await generateEditorialReview(
    createRequest({
      stepId: "final_editing",
      apiKey: "test-key",
      stepFeedback: "запропонуй 10 врізок до цього тексту."
    }),
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              actions: [
                {
                  blockId: "missing-block",
                  recommendationType: "callout",
                  title: "Врізка",
                  recommendation: "Невалідний якір.",
                  priority: "high"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
      now: () => "2026-08-17T12:00:00.000Z"
    }
  );

  assert.equal(response.items.length, 0);
  assert.equal(response.plan?.actions.length, 0);
  assert.match(String(response.error), /план дій|action plan/i);
});

test("generateEditorialReview plan prompt aims near whole-chapter volume without fragment count guidance", async () => {
  let requestBody = "";
  let callCount = 0;

  await generateEditorialReview(
    createRequest({
      stepId: "final_editing",
      apiKey: "test-key",
      stepFeedback: "запропонуй 10 врізок до цього тексту. Вони можуть бути короткими — обсягом 500 знаків."
    }),
    {
      fetchImpl: async (_input, init) => {
        callCount += 1;
        if (callCount === 1) {
          requestBody = String(init?.body ?? "");
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                actions: [
                  {
                    blockId: "p1",
                    recommendationType: "callout",
                    title: "Врізка",
                    recommendation: "Локальна врізка.",
                    priority: "medium"
                  }
                ]
              })
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [
                {
                  title: "Врізка",
                  reason: "Seed",
                  recommendation: "Локальна врізка.",
                  recommendationType: "callout",
                  suggestedAction: "prepare_callout",
                  priority: "medium",
                  blockStart: 1,
                  blockEnd: 1,
                  blockId: "p1",
                  excerpt: "Фрагмент",
                  insertionHint: "after",
                  anchorBlockId: "p1",
                  headingLevel: null,
                  headingTitle: null,
                  calloutKind: "mechanism",
                  calloutDepth: "brief",
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
        );
      },
      now: () => "2026-08-17T12:00:00.000Z"
    }
  );

  assert.match(requestBody, /Жорстка стеля: не більше 20/);
  assert.match(requestBody, /якщо запит називає цільову кількість/i);
  assert.doesNotMatch(requestBody, /не виконуй їх у одному фрагменті/i);
  assert.doesNotMatch(requestBody, /зазвичай 0-2/i);
  assert.doesNotMatch(requestBody, /Квота редактора на весь розділ: 10/);
});

test("generateEditorialReview generates planned custom-request cards in one provider call", async () => {
  let generateBody = "";
  let callCount = 0;

  const response = await generateEditorialReview(
    createRequest({
      stepId: "final_editing",
      apiKey: "test-key",
      stepFeedback: "зроби чотири локальні правки"
    }),
    {
      fetchImpl: async (_input, init) => {
        callCount += 1;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                actions: [
                  { blockId: "p1", recommendationType: "rewrite", title: "A", recommendation: "Seed", priority: "medium" },
                  { blockId: "p1", recommendationType: "simplify", title: "B", recommendation: "Seed", priority: "medium" },
                  { blockId: "p1", recommendationType: "expand", title: "C", recommendation: "Seed", priority: "medium" },
                  { blockId: "p1", recommendationType: "list", title: "D", recommendation: "Seed", priority: "medium" }
                ]
              })
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        generateBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [
                customRequestCardItem("rewrite", { title: "A" }),
                customRequestCardItem("simplify", { title: "B" }),
                customRequestCardItem("expand", { title: "C" }),
                customRequestCardItem("list", { title: "D" })
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-08-17T12:00:00.000Z"
    }
  );

  assert.equal(callCount, 2);
  assert.equal(response.plan?.actions.length, 4);
  assert.equal(response.items.length, 4);
  assert.match(generateBody, /title\\":\\"A\\"/);
  assert.match(generateBody, /title\\":\\"D\\"/);
  assert.match(generateBody, /рівно по одному item на кожну planned action/);
});

