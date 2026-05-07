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

test("generateEditorialReview injects strict diagnostics rubric into provider prompt", async () => {
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
            output_text: "### 1. Редакторський вердикт\nТестова діагностика."
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "diagnostics");
  assert.match(requestBody, /макродіагностики великого розділу/i);
  assert.match(requestBody, /карта структури й читацького маршруту/i);
  assert.match(requestBody, /Головний діагноз розділу/);
  assert.match(requestBody, /Карта розділу/);
  assert.match(requestBody, /Що зайве або дубльоване/);
  assert.match(requestBody, /8-15 найпоказовіших абзаців/);
  assert.match(requestBody, /Починай відповідь відразу з заголовка «## Головний діагноз розділу»/);
  assert.match(requestBody, /Не відкривай відповідь похвалою/i);
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

test("generateEditorialReview treats final_editing as custom prompt cards with visual support", async () => {
  let requestBody = "";

  const response = await generateEditorialReview(
    createRequest({
      stepId: "final_editing",
      apiKey: "test-key",
      stepFeedback: "Додай візуал і врізку там, де це допоможе читачеві."
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              items: [
                {
                  title: "Додати візуал",
                  reason: "Фрагмент пояснює механізм, який легше сприйняти як схему.",
                  recommendation: "Підготувати інфографіку з головними кроками механізму.",
                  recommendationType: "visual",
                  suggestedAction: "prepare_visual",
                  priority: "high",
                  blockStart: 1,
                  blockEnd: 1,
                  excerpt: "Фрагмент",
                  insertionHint: "after",
                  visualIntent: "infographic"
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

  assert.equal(response.stepId, "final_editing");
  assert.equal(response.items[0]?.recommendationType, "visual");
  assert.equal(JSON.parse(requestBody).temperature, undefined);
  assert.match(requestBody, /Крок workflow: Власний запит/);
  assert.match(requestBody, /Власний запит редактора для цього запуску/);
  assert.match(requestBody, /Додай візуал і врізку/);
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
  assert.doesNotMatch(requestBody, /Рівень змін|1\/5|2\/5|3\/5|4\/5|5\/5/);
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

  assert.match(requestBody, /Не обирай brief за замовчуванням/i);
  assert.match(requestBody, /віддавай перевагу deep/i);
  assert.match(requestBody, /активним використанням \*\*жирного\*\*/i);
  assert.match(requestBody, /якорі-підзаголовки/i);
  assert.match(requestBody, /ключові думки/i);
  assert.match(requestBody, /не використовуй #, ## або HTML-заголовки/i);
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

test("generateEditorialReview fallback callout after dense heading paragraph prefers deep", async () => {
  const response = await generateEditorialReview(createRequest({ stepId: "structure" }), {
    readEnvValue: () => null,
    now: () => "2026-03-10T12:00:00.000Z"
  });

  const callout = response.items.find((item) => item.recommendationType === "callout");
  assert.ok(callout);
  assert.equal(callout?.calloutDepth, "deep");
  assert.equal(callout?.calloutDraft?.calloutDepth, "deep");
});

test("generateEditorialReview builds fallback emphasis targets as exact inline spans", async () => {
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

  assert.equal(response.usedFallback, true);
  assert.equal(response.stepId, "emphasis");
  assert.ok(response.items.length >= 1);
  assert.ok(response.items.every((item) => item.recommendationType === "rewrite"));
  assert.ok(response.items.every((item) => item.stepId === "emphasis"));
  assert.ok(response.items.every((item) => Boolean(item.emphasisTarget?.text)));
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
      content: [{ text: `Абзац ${index + 1} містить ключову тезу для діагонального читання.` }]
    }))
  };
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
                  blockId: `p${1 + (requestCount - 1) * 16}`,
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

  assert.equal(requestCount, 3);
  assert.equal(response.usedFallback, false);
  assert.equal(response.stepId, "emphasis");
  assert.equal(response.items.length, 3);
  assert.deepEqual(
    response.items.map((item) => item.anchor.blockIds[0]),
    ["p1", "p17", "p33"]
  );
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
                occurrence: 1
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
  assert.equal(response.factCheckRows?.[0]?.status, "сумнівно");
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
  assert.equal(response.factCheckRows?.[0]?.status, "сумнівно");
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
      modelId: "gemini-3-flash-preview",
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
  assert.match(requestedUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.1-flash-lite-preview:generateContent$/);
  assert.doesNotMatch(requestedUrl, /\?key=/);
  assert.equal(requestHeaders.get("x-goog-api-key"), "gemini-test-key");
  assert.equal(requestedUrls.some((url) => url.includes("grounding-api-redirect/test-source")), true);
});

test("generateEditorialReview preserves parsed row sources when grounded mapping misses", async () => {
  const response = await generateEditorialReview(
    createRequest({
      provider: "gemini",
      modelId: "gemini-3-flash-preview",
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
      modelId: "gemini-3.1-pro-preview",
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
      modelId: "gemini-3.1-pro-preview",
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
      modelId: "gemini-3.1-flash-lite-preview",
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
  assert.match(String(requestBody?.instructions ?? ""), /для кроку «ясність» пропонуй лише мовні й локально-структурні правки/i);
  assert.match(String(requestBody?.instructions ?? ""), /для «ясність» не пропонуй підзаголовки, врізки, таблиці або зміни макроструктури/i);
  assert.match(String(requestBody?.instructions ?? ""), /одна картка має охоплювати лише один суцільний діапазон абзаців без розривів/i);
  assert.match(String(requestBody?.instructions ?? ""), /якщо одна проблема є в несуміжних місцях/i);
  assert.match(String(requestBody?.instructions ?? ""), /пунктуація списків:/i);
  assert.match(String(requestBody?.instructions ?? ""), /починається з малої літери/i);
  assert.match(String(requestBody?.input ?? ""), /збережи короткі окремі пункти/i);
});

test("generateEditorialReview enforces step-specific card type boundaries", async () => {
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
      anchorBlockId: "p1"
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

  assert.deepEqual(
    structureResponse.items.map((item) => item.recommendationType).sort(),
    ["callout", "list", "subsection"]
  );
  assert.deepEqual(
    clarityResponse.items.map((item) => item.recommendationType).sort(),
    ["expand", "rewrite", "simplify"]
  );
  assert.deepEqual(
    formattingResponse.items.map((item) => item.recommendationType).sort(),
    ["callout", "list", "subsection"]
  );
  assert.ok((clarityResponse.diagnostics.filteredItemCountsByType?.list ?? 0) >= 1);
  assert.ok((clarityResponse.diagnostics.filteredItemCountsByType?.subsection ?? 0) >= 1);
  assert.ok((clarityResponse.diagnostics.filteredItemCountsByType?.callout ?? 0) >= 1);
  assert.ok((clarityResponse.diagnostics.droppedItemCountsByReason?.filtered_by_step_type ?? 0) >= 3);
});

test("generateEditorialReview injects structure and formatting scope guardrails into prompts", async () => {
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

  const structureInstructions = String(requestBodies[0]?.instructions ?? "");
  const formattingInstructions = String(requestBodies[1]?.instructions ?? "");

  assert.match(structureInstructions, /для «структура» не витрачай картки на мікролексичні або пунктуаційні правки/i);
  assert.match(structureInstructions, /одна картка = один конкретний підзаголовок/i);
  assert.match(formattingInstructions, /для «форматування» фокусуйся на форматі подачі/i);
  assert.match(formattingInstructions, /не пропонуй мовне переписування абзаців як окремий тип правки/i);
});
