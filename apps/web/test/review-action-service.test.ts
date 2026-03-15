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

test("generateReviewAction builds subsection draft deterministically from explicit heading/text instruction", async () => {
  const request = createRequest();
  request.item.recommendation =
    "Вставити перед переліком короткий підзаголовок і 3-4 речення рамки. Підзаголовок: Як читати сигнали шкіри без самодіагностики Текст: Шкірні ознаки часто неспецифічні: один і той самий симптом може мати багато причин. Важливі тривалість, раптовість змін і супутні симптоми.";

  const response = await generateReviewAction(request, {
    readEnvValue: () => null
  });

  assert.equal(response.usedFallback, false);
  assert.equal(response.providerUsed, "deterministic:subsection");
  assert.equal(response.proposal.kind, "subsection_prompt");
  assert.equal(response.proposal.subsectionDraft?.title, "Як читати сигнали шкіри без самодіагностики");
  assert.match(response.proposal.subsectionDraft?.lead ?? "", /Шкірні ознаки часто неспецифічні/i);
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
      visualStylePreset: "neo_brutal",
      imagePromptTemplate:
        "Збери один prompt. Тип: {{visualIntent}}. Стиль: {{visualStyleGuide}}. Контекст: {{fragment}}. Порада: {{recommendation}}.",
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
        visualIntent: "infographic",
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
  assert.match(String(requestBody?.input ?? ""), /Тип: infographic/i);
  assert.match(String(requestBody?.input ?? ""), /Опиши відмінності між блідістю шкіри та пігментацією/i);
  assert.match(String(requestBody?.input ?? ""), /Покажи поруч два стани шкіри/i);
  assert.match(String(requestBody?.input ?? ""), /симетричне порівняння/i);
  assert.match(String(requestBody?.input ?? ""), /Нео-бруталізм/i);
  assert.match(String(requestBody?.input ?? ""), /Формат відповіді:\s*поверни рівно один готовий image prompt/i);
  assert.match(String(requestBody?.input ?? ""), /Не повертай JSON/i);
  assert.match(String(requestBody?.input ?? ""), /Додаткова вказівка щодо типу візуалу:/i);
  assert.match(String(requestBody?.input ?? ""), /тільки українською мовою/i);
  assert.doesNotMatch(String(requestBody?.input ?? ""), /\{\{fragment\}\}|\{\{recommendation\}\}|\{\{visualIntent\}\}|\{\{visualStyleGuide\}\}/i);
});

test("generateReviewAction appends style guide when image template has no visualStyleGuide placeholder", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Поясни шлях сигналу від кишківника до шкіри." }] }]
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
      visualStylePreset: "modern_glass",
      imagePromptTemplate: "Збери один prompt. Тип: {{visualIntent}}. Контекст: {{fragment}}.",
      item: {
        id: "review-visual-style-1",
        reviewSessionId: "review-session-1",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Показати процес",
        reason: "Потрібна наочність процесу.",
        recommendation: "Показати послідовність кроків як процес.",
        recommendationType: "visual",
        suggestedAction: "prepare_visual",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Поясни шлях сигналу від кишківника до шкіри.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "after",
          anchorBlockId: "p1"
        },
        visualIntent: "infographic",
        status: "pending"
      }
    },
    {
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ output_text: "Готовий image prompt." }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(response.proposal.kind, "image_prompt");
  assert.equal(response.proposal.imageDraft?.visualStylePreset, "modern_glass");
  assert.ok(requestBody);
  assert.match(String(requestBody?.input ?? ""), /Обраний стиль \(Modern glass\):/i);
  assert.match(String(requestBody?.input ?? ""), /liquid-glass/i);
});

test("generateReviewAction normalizes unknown visualStylePreset to calm_gradient", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Сформуй візуал." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      visualStylePreset: "broken-style" as unknown as "minimal",
      item: {
        id: "review-visual-style-2",
        reviewSessionId: "review-session-1",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Показати схему",
        reason: "Потрібна схема.",
        recommendation: "Підготуй просту схему.",
        recommendationType: "visual",
        suggestedAction: "prepare_visual",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Сформуй візуал.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "after",
          anchorBlockId: "p1"
        },
        visualIntent: "infographic",
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(JSON.stringify({ output_text: "Готовий image prompt." }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    }
  );

  assert.equal(response.proposal.kind, "image_prompt");
  assert.equal(response.proposal.imageDraft?.visualStylePreset, "calm_gradient");
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
        visualIntent: "infographic",
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

test("generateReviewAction normalizes top_list callout body into actionable multi-line entries", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Цибуля та яблука містять кверцетин, полуниця містить фізетин." }] }]
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
        id: "review-callout-top-list-1",
        reviewSessionId: "review-session-2",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Додати практичний список",
        reason: "Читачеві потрібен короткий прикладний перелік.",
        recommendation: "Зробити врізку-список із джерелами.",
        recommendationType: "callout",
        suggestedAction: "prepare_callout",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Цибуля та яблука містять кверцетин, полуниця містить фізетин.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "after",
          anchorBlockId: "p1"
        },
        calloutKind: "top_list",
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text:
              '{"title":"Де шукати сенолітики","body":"- Цибуля (джерело кверцетину)\\n- Яблука - також містять кверцетин\\n- Полуниця: містить фізетин","summary":"Практичний список джерел."}'
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "callout_prompt");
  const body = response.proposal.calloutDraft?.previewText ?? "";
  const lines = body.split("\n").filter(Boolean);
  assert.ok(lines.length >= 3);
  assert.ok(lines.every((line) => line.includes(":")));
  assert.doesNotMatch(body, /^\s*[-*•]\s+/m);
});

test("generateReviewAction preserves leading numeric lines in callout body cleanup", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Базовий фрагмент." }] }]
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
        id: "review-callout-numeric-1",
        reviewSessionId: "review-session-2",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Додати врізку",
        reason: "Потрібна компактна довідка.",
        recommendation: "Дай практичну довідку з цифрами.",
        recommendationType: "callout",
        suggestedAction: "prepare_callout",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Базовий фрагмент.",
          fingerprint: computeAnchorFingerprint(document, ["p1"])
        },
        insertionPoint: {
          mode: "after",
          anchorBlockId: "p1"
        },
        calloutKind: "mechanism",
        status: "pending"
      }
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text:
              '{"title":"Коротка довідка","body":"2024. Оновлені дані збережено.\\n1) 500 мг щодня протягом 8 тижнів.","summary":"Пояснює, як читати числа у фрагменті."}'
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(response.proposal.kind, "callout_prompt");
  const body = response.proposal.calloutDraft?.previewText ?? "";
  assert.match(body, /^2024\./m);
  assert.match(body, /^1\)\s500 мг/m);
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

test("generateReviewAction keeps replace-proposal provider prompt scoped to selected blocks", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p0", type: "paragraph", content: [{ text: "Нерелевантний вступ, який не має потрапити в локальний replace prompt." }] },
      { id: "p1", type: "paragraph", content: [{ text: "Цільовий абзац 1." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Цільовий абзац 2." }] },
      { id: "p3", type: "paragraph", content: [{ text: "Нерелевантний хвіст, який теж не має потрапити в prompt." }] }
    ]
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
      item: {
        id: "review-rewrite-scoped-1",
        reviewSessionId: "review-session-9",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Переписати фрагмент",
        reason: "Потрібен локальний rewrite.",
        recommendation: "Спростити два абзаци без зміни змісту.",
        recommendationType: "rewrite",
        suggestedAction: "rewrite_text",
        priority: "medium",
        anchor: {
          blockIds: ["p1", "p2"],
          generationBlockRange: { start: 1, end: 2 },
          excerpt: "Цільовий абзац 1.\n\nЦільовий абзац 2.",
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
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              operations: [
                {
                  newBlocks: [
                    { type: "paragraph", content: [{ text: "Оновлений цільовий абзац 1." }] },
                    { type: "paragraph", content: [{ text: "Оновлений цільовий абзац 2." }] }
                  ],
                  reason: "Оновив подачу.",
                  type: "clarity"
                }
              ]
            })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    }
  );

  assert.equal(response.proposal.kind, "text_diff");
  assert.ok(requestBody);
  assert.match(String(requestBody?.input ?? ""), /Цільовий абзац 1/i);
  assert.match(String(requestBody?.input ?? ""), /Цільовий абзац 2/i);
  assert.doesNotMatch(String(requestBody?.input ?? ""), /Нерелевантний вступ/i);
  assert.doesNotMatch(String(requestBody?.input ?? ""), /Нерелевантний хвіст/i);
  assert.deepEqual((requestBody as any)?.text?.format?.schema?.required, ["replacements", "reason"]);
  assert.equal((requestBody as any)?.text?.format?.schema?.properties?.replacements?.items?.type, "string");
  assert.equal((requestBody as any)?.text?.format?.schema?.properties?.operations, undefined);
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
                  newBlocks: [{ type: "paragraph", content: [{ text: "Крок А. Крок Б. Крок В." }] }],
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
  assert.equal((response.proposal.textDiff?.newBlocks[0] as { items?: unknown[] } | undefined)?.items?.length, 3);
});

test("generateReviewAction sends lightweight OpenAI list schema instead of nested block diff schema", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Крок А. Крок Б. Крок В." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);
  let requestBody: Record<string, any> | undefined;

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-list-openai-1",
        reviewSessionId: "review-session-11",
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
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, any>;

        return new Response(
          JSON.stringify({
            output_text: "{\"items\":[\"Крок А\",\"Крок Б\",\"Крок В\"],\"reason\":\"Сформував короткий список.\"}"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.providerUsed, "openai:list_replace");
  assert.equal(response.proposal.textDiff?.newBlocks[0]?.type, "bullet_list");
  assert.deepEqual(requestBody?.text?.format?.schema?.required, ["items", "reason"]);
  assert.equal(requestBody?.text?.format?.schema?.properties?.items?.items?.type, "string");
  assert.equal(requestBody?.text?.format?.schema?.properties?.operations, undefined);
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
        visualIntent: "infographic",
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

test("generateReviewAction forwards raw provider abort diagnostics for rewrite proposals", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Текст для локальної правки." }] }]
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
        id: "review-rewrite-abort-1",
        reviewSessionId: "review-session-7",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Переписати абзац",
        reason: "Потрібен ясніший варіант.",
        recommendation: "Зробити формулювання чіткішим.",
        recommendationType: "rewrite",
        suggestedAction: "rewrite_text",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Текст для локальної правки.",
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
      fetchImpl: async () => {
        throw new DOMException("This operation was aborted", "AbortError");
      }
    }
  );

  assert.equal(response.proposal.kind, "text_diff");
  assert.equal(response.usedFallback, true);
  assert.equal(response.providerUsed, "fallback:openai");
  assert.match(response.error ?? "", /перевищив таймаут 45с/i);
  assert.match(response.diagnostics.rawError ?? "", /AbortError: This operation was aborted/);
});

test("generateReviewAction uses Gemini fast replace schema for rewrite proposals", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Може свідчити про наявність:" }] }]
  };
  const revision = deriveManuscriptRevisionState(document);
  let requestBody: Record<string, any> | undefined;

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey: "gemini-test-key",
      item: {
        id: "review-gemini-rewrite-1",
        reviewSessionId: "review-session-10",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Пом'якшити тон",
        reason: "Потрібно знизити тривожність формулювання.",
        recommendation: "Зробити lead-in фразу спокійнішою і природнішою.",
        recommendationType: "rewrite",
        suggestedAction: "rewrite_text",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Свербіж шкіри",
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
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, any>;

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "{\"replacements\":[\"Це може вказувати на такі стани:\"],\"reason\":\"Пом'якшив локальну lead-in фразу.\"}" }]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.providerUsed, "gemini:text_replace");
  assert.equal(response.proposal.kind, "text_diff");
  assert.equal((response.proposal.textDiff?.newBlocks[0] as { content?: Array<{ text: string }> })?.content?.[0]?.text, "Це може вказувати на такі стани:");
  assert.ok(requestBody);
  assert.deepEqual(requestBody?.generationConfig?.responseSchema?.required, ["replacements", "reason"]);
  assert.equal(requestBody?.generationConfig?.responseSchema?.properties?.replacements?.items?.type, "STRING");
  assert.equal(requestBody?.generationConfig?.responseSchema?.properties?.operations, undefined);
});

test("generateReviewAction injects anti-disclaimer guardrails into rewrite replace prompt", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Блідість шкіри буває при ендокардиті, міокардиті та аортальній недостатності." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);
  let requestBody: Record<string, any> | undefined;

  const response = await generateReviewAction(
    {
      document,
      currentRevision: revision,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "test-key",
      item: {
        id: "review-rewrite-guardrail-1",
        reviewSessionId: "review-session-12",
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 3,
        title: "Знизити категоричність",
        reason: "Фраза звучить надто остаточно.",
        recommendation: "Пом'якшити категоричність і зробити формулювання спокійнішим.",
        recommendationType: "rewrite",
        suggestedAction: "rewrite_text",
        priority: "medium",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "Блідість шкіри буває при ендокардиті, міокардиті та аортальній недостатності.",
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
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, any>;

        return new Response(
          JSON.stringify({
            output_text: "{\"replacements\":[\"Блідість шкіри може траплятися при ендокардиті, міокардиті чи аортальній недостатності.\"],\"reason\":\"Пом'якшив категоричність локально.\"}"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    }
  );

  assert.equal(response.usedFallback, false);
  assert.equal(response.proposal.kind, "text_diff");
  assert.ok(requestBody);
  assert.match(String(requestBody?.instructions ?? ""), /не перетворюй локальну редактуру на safety-боілерплейт/i);
  assert.match(String(requestBody?.input ?? ""), /не додавай загальних пересторог/i);
  assert.match(String(requestBody?.input ?? ""), /фраз про самодіагностику або консультацію/i);
});

test("generateReviewAction falls back on empty provider output instead of echoing prompt text", async () => {
  const request = createRequest();
  request.apiKey = "test-key";

  const response = await generateReviewAction(request, {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output_text: "   "
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  });

  assert.equal(response.usedFallback, true);
  assert.equal(response.proposal.kind, "subsection_prompt");
  assert.match(response.error ?? "", /порожню відповідь/i);
  assert.doesNotMatch(response.proposal.subsectionDraft?.lead ?? "", /Ти готуєш вставку підзаголовка|Поверни лише JSON/i);
});

test("generateReviewAction uses Gemini header auth and parses subsection output", async () => {
  const request = createRequest();
  request.provider = "gemini";
  request.modelId = "gemini-2.5-flash";
  request.apiKey = "gemini-test-key";
  let requestedUrl = "";
  let requestPrompt = "";
  let requestHeaders = new Headers();

  const response = await generateReviewAction(request, {
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body)) as { contents?: Array<{ parts?: Array<{ text?: string }> }> };
      requestPrompt = body.contents?.[0]?.parts?.[0]?.text ?? "";

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "{\"title\":\"Як читати сигнали\",\"lead\":\"Коротка рамка перед переліком.\",\"summary\":\"Дає безпечний контекст.\"}" }]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  assert.equal(response.proposal.kind, "subsection_prompt");
  assert.equal(response.proposal.subsectionDraft?.title, "Як читати сигнали");
  assert.match(requestedUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
  assert.doesNotMatch(requestedUrl, /\?key=/);
  assert.equal(requestHeaders.get("x-goog-api-key"), "gemini-test-key");
  assert.match(requestPrompt, /Рекомендація:/i);
  assert.match(requestPrompt, /Щільний абзац/i);
});

test("generateReviewAction uses Anthropic headers and parses subsection output", async () => {
  const request = createRequest();
  request.provider = "anthropic";
  request.modelId = "claude-3-7-sonnet-latest";
  request.apiKey = "anthropic-test-key";
  let requestedUrl = "";
  let requestPrompt = "";
  let requestSystem = "";
  let requestHeaders = new Headers();

  const response = await generateReviewAction(request, {
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }>; system?: string };
      requestPrompt = body.messages?.[0]?.content ?? "";
      requestSystem = body.system ?? "";

      return new Response(
        JSON.stringify({
          content: [{ text: "{\"title\":\"Контекст перед сигналами\",\"lead\":\"Ознаки неспецифічні, потрібна обережна інтерпретація.\",\"summary\":\"Зменшує ризик самодіагностики.\"}" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  assert.equal(response.proposal.kind, "subsection_prompt");
  assert.equal(response.proposal.subsectionDraft?.title, "Контекст перед сигналами");
  assert.match(requestedUrl, /api\.anthropic\.com\/v1\/messages$/);
  assert.equal(requestHeaders.get("x-api-key"), "anthropic-test-key");
  assert.equal(requestHeaders.get("anthropic-version"), "2023-06-01");
  assert.match(requestSystem, /Дотримуйся формату відповіді/i);
  assert.doesNotMatch(requestSystem, /лише чистий текст/i);
  assert.match(requestPrompt, /Рекомендація:/i);
  assert.match(requestPrompt, /Щільний абзац/i);
});
