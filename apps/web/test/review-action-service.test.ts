import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { generateReviewAction } from "../lib/server/review-action-service.ts";
import type { ReviewActionRequest } from "../lib/editor/review-contract.ts";

function createRequest(): ReviewActionRequest {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 2, content: [{ text: "Розділ" }] },
      { id: "p1", type: "paragraph", content: [{ text: "Щільний абзац, який просить кращої локальної структури." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Другий абзац продовжує ту саму думку." }] }
    ]
  };
  const revision = deriveManuscriptRevisionState(document);

  return {
    document,
    currentRevision: revision,
    provider: "openai",
    modelId: "gpt-5.4",
    item: {
      id: "review-subsection-1",
      reviewSessionId: "review-session-1",
      documentRevisionId: revision.documentRevisionId,
      changeLevel: 3,
      title: "Додати підзаголовок",
      reason: "Фрагмент варто локально структурувати.",
      recommendation: "Перед фрагментом потрібен короткий підзаголовок.",
      recommendationType: "subsection",
      suggestedAction: "insert_text",
      priority: "medium",
      anchor: {
        blockIds: ["p1", "p2"],
        generationBlockRange: { start: 1, end: 2 },
        excerpt: "Щільний абзац",
        fingerprint: computeAnchorFingerprint(document, ["p1", "p2"])
      },
      insertionPoint: {
        mode: "before",
        anchorBlockId: "p1"
      },
      status: "pending"
    }
  };
}

test("generateReviewAction prepares subsection proposal instead of failing safe", async () => {
  const request = createRequest();

  const response = await generateReviewAction(request, {
    readEnvValue: () => null
  });

  assert.equal(response.proposal.kind, "subsection_prompt");
  assert.equal(response.usedFallback, true);
  assert.ok(response.proposal.subsectionDraft?.title);
});

test("generateReviewAction injects explicit callout-kind guidance into provider prompt", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Фрагмент про міфи й факти навколо шкіри." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);
  let requestBody: Record<string, unknown> | undefined;

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      calloutPromptTemplate: "База prompt. Контекст: {{fragment}}. Порада: {{recommendation}}. Тип: {{calloutKindLabel}}.",
      item: {
        id: "review-callout-1",
        reviewSessionId: "review-session-1",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Додати врізку",
        reason: "Читачеві потрібна коротка рамка.",
        recommendation: "Додати блок міфів і правди.",
        recommendationType: "callout",
        suggestedAction: "prepare_callout",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Фрагмент про міфи й факти навколо шкіри.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "after",
          anchorBlockId: "p1"
        },
        calloutKind: "myths_vs_truth",
        status: "pending"
      }
    },
    {
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return new Response(
          JSON.stringify({
            output_text: "Готовий prompt."
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    }
  );

  assert.equal(response.proposal.kind, "callout_prompt");
  assert.ok(requestBody);
  assert.match(String(requestBody?.input ?? ""), /Що означає цей тип/i);
  assert.match(String(requestBody?.input ?? ""), /Міф/i);
  assert.match(String(requestBody?.input ?? ""), /Правда/i);
  assert.match(String(requestBody?.input ?? ""), /Формат відповіді:\s*поверни лише JSON-об'єкт/i);
  assert.match(String(requestBody?.input ?? ""), /без \*\*жирного\*\*/i);
  assert.match(String(requestBody?.input ?? ""), /Фрагмент про міфи й факти навколо шкіри/i);
  assert.match(String(requestBody?.input ?? ""), /Додати блок міфів і правди/i);
  assert.doesNotMatch(String(requestBody?.input ?? ""), /\{\{fragment\}\}|\{\{recommendation\}\}|\{\{calloutKindLabel\}\}/i);
});

test("generateReviewAction renders image template placeholders and adds visual-intent guidance", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Опиши відмінності між блідістю шкіри та пігментацією." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);
  let requestBody: Record<string, unknown> | undefined;

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      imagePromptTemplate: "Збери один prompt. Тип: {{visualIntent}}. Контекст: {{fragment}}. Порада: {{recommendation}}.",
      item: {
        id: "review-visual-1",
        reviewSessionId: "review-session-1",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Додати порівняльний візуал",
        reason: "Матеріал легше сприймається у порівнянні.",
        recommendation: "Покажи поруч два стани шкіри в одному порівняльному візуалі.",
        recommendationType: "visual",
        suggestedAction: "prepare_visual",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Опиши відмінності між блідістю шкіри та пігментацією.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "after",
          anchorBlockId: "p1"
        },
        visualIntent: "comparison",
        status: "pending"
      }
    },
    {
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return new Response(
          JSON.stringify({
            output_text: "Готовий image prompt."
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    }
  );

  assert.equal(response.proposal.kind, "image_prompt");
  assert.ok(requestBody);
  assert.match(String(requestBody?.input ?? ""), /Тип: comparison/i);
  assert.match(String(requestBody?.input ?? ""), /Опиши відмінності між блідістю шкіри та пігментацією/i);
  assert.match(String(requestBody?.input ?? ""), /Покажи поруч два стани шкіри/i);
  assert.match(String(requestBody?.input ?? ""), /симетричне порівняння/i);
  assert.match(String(requestBody?.input ?? ""), /Бажаний формат відповіді:\s*JSON/i);
  assert.match(String(requestBody?.input ?? ""), /увесь текст відповіді буде використано як image prompt/i);
  assert.match(String(requestBody?.input ?? ""), /тільки українською мовою/i);
  assert.doesNotMatch(String(requestBody?.input ?? ""), /\{\{fragment\}\}|\{\{recommendation\}\}|\{\{visualIntent\}\}/i);
});

test("generateReviewAction strips editorial wrappers from generated image prompt output", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Поясни вісь кишківник-шкіра через послідовність впливу." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-visual-2",
        reviewSessionId: "review-session-1",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Показати вісь кишківник-шкіра",
        reason: "Текст легше зчитується як схема.",
        recommendation: "Покажи послідовність впливу від кишківника до шкіри.",
        recommendationType: "visual",
        suggestedAction: "prepare_visual",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Поясни вісь кишківник-шкіра через послідовність впливу.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "after",
          anchorBlockId: "p1"
        },
        visualIntent: "process",
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: `Ось детально розроблений prompt для створення чернеткової ілюстрації.

---

### Prompt для генерації візуалу

**Опис сцени:**
Мінімалістична лінійна схема, що демонструє шлях впливу від кишківника до шкіри.

**Стиль:**
Плоска векторна чернетка, чисті лінії, білий фон.

### Інструкція для ілюстратора

**1. Що саме показати:**
* Ліворуч: капсула або корисні бактерії.
* Центр: стилізований кишечник.
* Праворуч: схематичний зріз шкіри.

**Пояснення visualIntent:**
Послідовність має зчитуватися зліва направо.`
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "image_prompt");
  const prompt = response.proposal.imageDraft?.prompt ?? "";
  assert.match(prompt, /Мінімалістична лінійна схема/i);
  assert.match(prompt, /Ліворуч: капсула або корисні бактерії/i);
  assert.match(prompt, /Послідовність має зчитуватися зліва направо/i);
  assert.doesNotMatch(prompt, /Ось детально розроблений prompt|###|Інструкція для ілюстратора|Пояснення visualIntent|\*\*/i);
  assert.equal(response.proposal.imageDraft?.caption, "Покажи послідовність впливу від кишківника до шкіри.");
});

test("generateReviewAction parses structured callout draft output and strips markdown syntax", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Шкіра і нервова система мають спільне ембріональне походження." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-callout-2",
        reviewSessionId: "review-session-2",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Додати аналогію",
        reason: "Аналогія зніме когнітивне навантаження.",
        recommendation: "Подати ідею через порівняння з побутовим образом.",
        recommendationType: "callout",
        suggestedAction: "prepare_callout",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Шкіра і нервова система мають спільне ембріональне походження.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "after",
          anchorBlockId: "p1"
        },
        calloutKind: "analogy",
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text:
              '{"title":"**Шкіра — дзеркало мозку**","body":"- **Шкіра** і нервова система мають спільне походження.","summary":"**Коротко пояснює звязок.**"}'
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "callout_prompt");
  assert.equal(response.proposal.calloutDraft?.title, "Шкіра — дзеркало мозку");
  assert.equal(response.proposal.calloutDraft?.previewText, "Шкіра і нервова система мають спільне походження.");
  assert.equal(response.proposal.summary, "Коротко пояснює звязок.");
  assert.doesNotMatch(response.proposal.calloutDraft?.previewText ?? "", /\*\*|^-\s/m);
});

test("generateReviewAction constrains rewrite output to the original block count", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "Перший складний абзац." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Другий складний абзац." }] }
    ]
  };
  const revision = deriveManuscriptRevisionState(document);

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-rewrite-1",
        reviewSessionId: "review-session-3",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Переписати фрагмент",
        reason: "Фрагмент перевантажений.",
        recommendation: "Зробити формулювання яснішими.",
        recommendationType: "rewrite",
        suggestedAction: "rewrite_text",
        priority: "medium",
        anchor: {
          blockIds: ["p1", "p2"],
          generationBlockRange: { start: 0, end: 1 },
          excerpt: "Перший складний абзац.\n\nДругий складний абзац.",
          fingerprint: computeAnchorFingerprint(document, ["p1", "p2"])
        },
        insertionPoint: {
          mode: "replace",
          anchorBlockId: "p1"
        },
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              operations: [
                {
                  blockIds: ["p1", "p2"],
                  newBlocks: [
                    { type: "paragraph", content: [{ text: "Оновлений блок 1." }] },
                    { type: "paragraph", content: [{ text: "Оновлений блок 2." }] },
                    { type: "paragraph", content: [{ text: "Зайвий блок 3." }] }
                  ],
                  reason: "Зробив подачу яснішою.",
                  type: "clarity"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "text_diff");
  assert.equal(response.proposal.textDiff?.blockIds.length, 2);
  assert.equal(response.proposal.textDiff?.newBlocks.length, 2);
  assert.match((response.proposal.textDiff?.newBlocks[1] as any)?.content?.[0]?.text ?? "", /Зайвий блок 3/i);
});

test("generateReviewAction keeps list replacements within selection block ceiling", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "Пункт А. Пункт Б. Пункт В." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Додатковий контекст." }] }
    ]
  };
  const revision = deriveManuscriptRevisionState(document);

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-list-1",
        reviewSessionId: "review-session-4",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Зробити список",
        reason: "Список читатиметься краще.",
        recommendation: "Перетвори це на список.",
        recommendationType: "list",
        suggestedAction: "rewrite_text",
        priority: "medium",
        anchor: {
          blockIds: ["p1", "p2"],
          generationBlockRange: { start: 0, end: 1 },
          excerpt: "Пункт А. Пункт Б. Пункт В.",
          fingerprint: computeAnchorFingerprint(document, ["p1", "p2"])
        },
        insertionPoint: {
          mode: "replace",
          anchorBlockId: "p1"
        },
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              operations: [
                {
                  blockIds: ["p1", "p2"],
                  newBlocks: [
                    { type: "bullet_list", items: [[{ text: "Пункт А" }], [{ text: "Пункт Б" }]] },
                    { type: "paragraph", content: [{ text: "Коментар 1" }] },
                    { type: "paragraph", content: [{ text: "Коментар 2" }] }
                  ],
                  reason: "Сформував список.",
                  type: "structure"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "text_diff");
  assert.ok((response.proposal.textDiff?.newBlocks.length ?? 0) <= 2);
});

test("generateReviewAction coerces list recommendation into list block when provider returns paragraphs", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Крок А. Крок Б. Крок В." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-list-2",
        reviewSessionId: "review-session-4",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Зробити список",
        reason: "Список читатиметься краще.",
        recommendation: "Перетвори це на список.",
        recommendationType: "list",
        suggestedAction: "rewrite_text",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Крок А. Крок Б. Крок В.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "replace",
          anchorBlockId: "p1"
        },
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              operations: [
                {
                  blockIds: ["p1"],
                  newBlocks: [{ type: "paragraph", content: [{ text: "Крок А\nКрок Б\nКрок В" }] }],
                  reason: "Сформував список.",
                  type: "structure"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "text_diff");
  assert.equal(response.proposal.textDiff?.newBlocks[0]?.type, "bullet_list");
});

test("generateReviewAction accepts structured visual JSON with prompt/caption/alt", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Поясни різницю між еритемою та пігментацією." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-visual-json-1",
        reviewSessionId: "review-session-5",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Порівняння станів",
        reason: "Потрібно візуально зіставити ознаки.",
        recommendation: "Зробити порівняльний візуал для двох станів шкіри.",
        recommendationType: "visual",
        suggestedAction: "prepare_visual",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Поясни різницю між еритемою та пігментацією.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "after",
          anchorBlockId: "p1"
        },
        visualIntent: "comparison",
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text:
              '{"prompt":"Порівняльна схема двох станів шкіри без декоративного фону.","caption":"Порівняння еритеми та пігментації","alt":"Схема порівняння двох станів шкіри"}'
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "image_prompt");
  assert.equal(response.proposal.imageDraft?.prompt, "Порівняльна схема двох станів шкіри без декоративного фону.");
  assert.equal(response.proposal.imageDraft?.caption, "Порівняння еритеми та пігментації");
  assert.equal(response.proposal.imageDraft?.alt, "Схема порівняння двох станів шкіри");
});

test("generateReviewAction strips markdown artifacts from rewrite replacements", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Складний абзац про причини та наслідки." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-rewrite-2",
        reviewSessionId: "review-session-6",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Переписати абзац",
        reason: "Текст виглядає перевантажено.",
        recommendation: "Спростити й зробити яснішим.",
        recommendationType: "rewrite",
        suggestedAction: "rewrite_text",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Складний абзац про причини та наслідки.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "replace",
          anchorBlockId: "p1"
        },
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              operations: [
                {
                  blockIds: ["p1"],
                  newBlocks: [{ type: "paragraph", content: [{ text: "# **Простіше** пояснення\n- Перший пункт" }] }],
                  reason: "Оновив подачу.",
                  type: "clarity"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "text_diff");
  const nextText = (response.proposal.textDiff?.newBlocks[0] as { content: Array<{ text: string }> } | undefined)?.content?.[0]?.text ?? "";
  assert.equal(nextText, "Простіше пояснення\nПерший пункт");
  assert.doesNotMatch(nextText, /^#|^\s*-\s|\*\*/m);
});

test("generateReviewAction preserves leading numeric prose in rewrite replacements", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Поточний фрагмент." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-rewrite-numeric-1",
        reviewSessionId: "review-session-8",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Переписати фрагмент",
        reason: "Потрібен ясніший варіант.",
        recommendation: "Зробити формулювання чіткішим.",
        recommendationType: "rewrite",
        suggestedAction: "rewrite_text",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Поточний фрагмент.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "replace",
          anchorBlockId: "p1"
        },
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              operations: [
                {
                  blockIds: ["p1"],
                  newBlocks: [{ type: "paragraph", content: [{ text: "2024. Дані лишаються релевантними.\n1) 500 мг щодня протягом 8 тижнів." }] }],
                  reason: "Уточнив формулювання.",
                  type: "clarity"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "text_diff");
  const nextText = (response.proposal.textDiff?.newBlocks[0] as { content: Array<{ text: string }> } | undefined)?.content?.[0]?.text ?? "";
  assert.match(nextText, /^2024\./m);
  assert.match(nextText, /^1\)\s500 мг/m);
});

test("generateReviewAction marks rewrite/simplify no-op proposals with warning", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Текст уже доволі простий для читача." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-simplify-1",
        reviewSessionId: "review-session-7",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Спростити абзац",
        reason: "Потрібен простіший варіант.",
        recommendation: "Переформулювати доступніше.",
        recommendationType: "simplify",
        suggestedAction: "rewrite_text",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Текст уже доволі простий для читача.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "replace",
          anchorBlockId: "p1"
        },
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              operations: [
                {
                  blockIds: ["p1"],
                  newBlocks: [{ type: "paragraph", content: [{ text: "Текст уже доволі простий для читача." }] }],
                  reason: "Оновив стиль.",
                  type: "clarity"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "text_diff");
  assert.equal(response.proposal.textDiff?.warning?.code, "no_op");
  assert.match(response.proposal.textDiff?.warning?.message ?? "", /майже не змінює текст/i);
});
