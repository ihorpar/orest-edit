import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import {
  getEditorialRecommendationTypeLabel,
  getReviewParagraphRangeLabel,
  isEditorialReviewRunApiResponse,
  normalizeEditorialReviewItems
} from "../lib/editor/review-contract.ts";

function createDocument(): EditorDocument {
  return {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 2, content: [{ text: "Розділ" }] },
      { id: "p1", type: "paragraph", content: [{ text: "Перший абзац із щільним поясненням." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Другий абзац для перевірки діапазону." }] }
    ]
  };
}

test("isEditorialReviewRunApiResponse rejects malformed success envelopes", () => {
  assert.equal(isEditorialReviewRunApiResponse({ kind: "result", result: {} }), false);
  assert.equal(
    isEditorialReviewRunApiResponse({
      kind: "error",
      error: { code: "provider_failed", message: "Provider failed", retryable: true }
    }),
    true
  );
  assert.equal(
    isEditorialReviewRunApiResponse({
      kind: "error",
      error: { code: "provider_failed", message: "Provider failed", retryable: true },
      run: { runId: 42 }
    }),
    false
  );
  const validRun = {
    runId: "wrun_test",
    documentRevisionId: "revision-1",
    stepId: "emphasis",
    locale: "uk",
    provider: "openai",
    modelId: "gpt-5.6-luna",
    runMode: "replace",
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:01.000Z",
    status: "completed",
    pollAfterMs: 0
  };
  assert.equal(
    isEditorialReviewRunApiResponse({
      kind: "result",
      run: validRun,
      result: {
        reviewSessionId: "session-1",
        stepId: "emphasis",
        stepRunId: "step-1",
        runMode: "replace",
        items: [null],
        providerUsed: "openai",
        usedFallback: false,
        diagnostics: {
          requestId: "request-1",
          generatedAt: "2026-08-04T12:00:01.000Z",
          droppedItemCount: 0
        }
      }
    }),
    false
  );
});

test("isEditorialReviewRunApiResponse accepts a running envelope with prefix items and char progress", () => {
  assert.equal(
    isEditorialReviewRunApiResponse({
      kind: "run",
      capability: "cap-test",
      items: [{
        id: "item-p1",
        reviewSessionId: "session-1",
        documentRevisionId: "revision-1",
        changeLevel: 3,
        title: "Спростити",
        reason: "Щільно",
        recommendation: "Простіше.",
        recommendationType: "simplify",
        suggestedAction: "rewrite_text",
        priority: "high",
        anchor: {
          blockIds: ["p1"],
          generationBlockRange: { start: 0, end: 0 },
          excerpt: "фрагмент",
          fingerprint: "fp-p1"
        },
        insertionPoint: { mode: "replace", anchorBlockId: "p1" },
        status: "pending"
      }],
      run: {
        runId: "wrun_test",
        documentRevisionId: "revision-1",
        stepId: "clarity",
        locale: "uk",
        provider: "openai",
        modelId: "gpt-5.6-sol",
        runMode: "replace",
        createdAt: "2026-08-12T12:00:00.000Z",
        updatedAt: "2026-08-12T12:00:01.000Z",
        status: "running",
        pollAfterMs: 2000,
        progress: {
          completedChunks: 2,
          totalChunks: 10,
          completedSourceChars: 32000,
          totalSourceChars: 160000,
          failedChunks: [{ index: 2, coreBlockIds: ["p3"], message: "timeout" }]
        }
      }
    }),
    true
  );
});

test("normalizeEditorialReviewItems coerces legacy visual/callout values into the new taxonomy", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-1",
    changeLevel: 3,
    items: [
      {
        title: "Додати візуал",
        reason: "Тут бракує опори для читача.",
        recommendation: "Показати процес схемою.",
        recommendationType: "illustration",
        suggestedAction: "prepare_visual",
        priority: "medium",
        blockStart: 1,
        blockEnd: 1,
        excerpt: "Перший абзац",
        insertionHint: "after",
        anchorBlockId: "p1",
        calloutKind: null,
        calloutTitle: null,
        calloutPreviewText: null,
        calloutSummary: null,
        calloutPrompt: null,
        visualIntent: "process"
      },
      {
        title: "Винести врізку",
        reason: "Механізм краще пояснити окремо.",
        recommendation: "Додати коротку врізку.",
        recommendationType: "callout",
        suggestedAction: "prepare_callout",
        priority: "high",
        blockStart: 2,
        blockEnd: 2,
        excerpt: "Другий абзац",
        insertionHint: "after",
        anchorBlockId: "p2",
        calloutKind: "mechanism_explained",
        calloutDepth: "deep",
        calloutTitle: "Як це працює",
        calloutPreviewText: "Коротке пояснення.",
        calloutSummary: "Пояснити механізм.",
        calloutPrompt: "Поясни механізм просто.",
        visualIntent: null
      }
    ]
  });

  assert.equal(normalized.droppedCount, 0);
  assert.equal(normalized.items[0]?.recommendationType, "callout");
  assert.equal(normalized.items[0]?.calloutKind, "mechanism");
  assert.equal(normalized.items[0]?.calloutDepth, "deep");
  assert.equal(normalized.items[0]?.calloutDraft?.calloutDepth, "deep");
  assert.equal(normalized.items[1]?.recommendationType, "visual");
  assert.equal(normalized.items[1]?.suggestedAction, "prepare_visual");
  assert.equal(normalized.items[1]?.insertionPoint.mode, "after");
});

test("normalizeEditorialReviewItems infers deep depth from deep-callout wording", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-depth",
    changeLevel: 3,
    items: [
      {
        title: "Створити глибоку врізку",
        reason: "Потрібно пояснити механізм докладніше.",
        recommendation: "Створити глибоку врізку, що пояснює процес простими кроками.",
        recommendationType: "callout",
        suggestedAction: "prepare_callout",
        priority: "medium",
        blockStart: 1,
        blockEnd: 1,
        excerpt: "Перший абзац із щільним поясненням.",
        insertionHint: "after",
        anchorBlockId: "p1",
        calloutKind: "mechanism",
        calloutDepth: "brief",
        calloutTitle: "Як це працює",
        calloutPreviewText: "Пояснення механізму.",
        calloutSummary: "Пояснити механізм.",
        calloutPrompt: "Створи deep dive про механізм.",
        visualIntent: null
      }
    ]
  });

  assert.equal(normalized.droppedCount, 0);
  assert.equal(normalized.items[0]?.calloutDepth, "deep");
  assert.equal(normalized.items[0]?.calloutDraft?.calloutDepth, "deep");
});

test("normalizeEditorialReviewItems keeps long recommendation copy up to the raised limit", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);
  const recommendation =
    "Додати після фрагмента глибоку механістичну врізку на 3–4 короткі абзаци. Побудувати її навколо трьох ланок: генетичні варіанти можуть змінювати регуляцію імунної відповіді; ослаблений шкірний бар'єр полегшує контакт алергенів з імунною системою; фактори довкілля можуть впливати на реалізацію цієї схильності через епігенетичні механізми. Перед частиною абзаців використати короткі жирні якорі-підзаголовки, а ключові думки виділити жирним усередині абзаців. Якщо є природне перерахування, додати один короткий список.";

  assert.ok(recommendation.length > 420);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-long-copy",
    changeLevel: 3,
    items: [
      {
        title: "Додати врізку про взаємодію генів, бар’єрів і довкілля",
        reason: "Фрагмент пояснює щільний механізм, який легше читати як глибоку врізку.",
        recommendation,
        recommendationType: "callout",
        priority: "high",
        blockStart: 1,
        blockEnd: 1,
        excerpt: "Перший абзац",
        insertionHint: "after",
        calloutKind: "mechanism",
        calloutDepth: "deep"
      }
    ]
  });

  assert.equal(normalized.droppedCount, 0);
  assert.equal(normalized.items[0]?.recommendation, recommendation);
  assert.ok((normalized.items[0]?.recommendation.length ?? 0) > 420);
});

test("normalizeEditorialReviewItems enforces subsection insert semantics", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-2",
    changeLevel: 3,
    items: [
      {
        title: "Додати підзаголовок",
        reason: "Фрагменту бракує локальної структури.",
        recommendation: "Вставити короткий підзаголовок.",
        recommendationType: "subsection",
        suggestedAction: "rewrite_text",
        priority: "medium",
        blockStart: 1,
        blockEnd: 2,
        excerpt: "Перший і другий абзаци",
        insertionHint: "subsection_after",
        anchorBlockId: "p1",
        headingLevel: 2,
        calloutKind: null,
        calloutTitle: null,
        calloutPreviewText: null,
        calloutSummary: null,
        calloutPrompt: null,
        visualIntent: null
      }
    ]
  });

  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.items[0]?.suggestedAction, "insert_text");
  assert.equal(normalized.items[0]?.insertionPoint.mode, "before");
  assert.equal(normalized.items[0]?.headingLevel, 2);
  assert.deepEqual(normalized.items[0]?.anchor.blockIds, ["p1", "p2"]);
});

test("normalizeEditorialReviewItems shifts subsection insert past a leading heading", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-subsection-heading",
    changeLevel: 3,
    items: [
      {
        title: "Додати підзаголовок",
        reason: "Після заголовка йде щільний блок.",
        recommendation: "Вставити H3 перед поясненням.",
        recommendationType: "subsection",
        suggestedAction: "insert_text",
        priority: "high",
        blockStart: 0,
        blockEnd: 1,
        excerpt: "Розділ\n\nПерший абзац",
        insertionHint: "before",
        anchorBlockId: "h1",
        headingLevel: 3
      }
    ]
  });

  assert.equal(normalized.items.length, 1);
  assert.deepEqual(normalized.items[0]?.anchor.blockIds, ["p1"]);
  assert.equal(normalized.items[0]?.insertionPoint.anchorBlockId, "p1");
  assert.equal(normalized.items[0]?.headingLevel, 3);
});

test("normalizeEditorialReviewItems hydrates subsection draft from headingTitle and marks ready", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-heading-title",
    changeLevel: 3,
    items: [
      {
        title: "Додати підзаголовок",
        reason: "Потрібна нова секція.",
        recommendation: "Вставити підзаголовок перед поясненням.",
        recommendationType: "subsection",
        suggestedAction: "insert_text",
        priority: "high",
        blockStart: 1,
        blockEnd: 1,
        excerpt: "Перший абзац",
        insertionHint: "before",
        headingLevel: 2,
        headingTitle: "Як читати сигнали шкіри"
      }
    ]
  });

  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.items[0]?.status, "ready");
  assert.equal(normalized.items[0]?.headingLevel, 2);
  assert.equal(normalized.items[0]?.subsectionDraft?.title, "Як читати сигнали шкіри");
  assert.equal(normalized.items[0]?.subsectionDraft?.headingLevel, 2);
});

test("normalizeEditorialReviewItems extracts subsection title from recommendation quotes", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-heading-quote",
    changeLevel: 3,
    items: [
      {
        title: "Окремо позначити класифікацію",
        reason: "Потрібна нова секція.",
        recommendation: "Вставити підзаголовок «Три моделі предиспозицій» перед переліком.",
        recommendationType: "subsection",
        suggestedAction: "insert_text",
        priority: "medium",
        blockStart: 1,
        blockEnd: 1,
        excerpt: "Перший абзац",
        insertionHint: "before",
        headingLevel: 3
      }
    ]
  });

  assert.equal(normalized.items[0]?.status, "ready");
  assert.equal(normalized.items[0]?.subsectionDraft?.title, "Три моделі предиспозицій");
});

test("normalizeEditorialReviewItems accepts emphasis targets without prose recommendation text", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-emphasis",
    changeLevel: 3,
    stepId: "emphasis",
    items: [
      {
        blockStart: 1,
        blockEnd: 1,
        excerpt: "Перший абзац із щільним поясненням.",
        priority: "medium",
        emphasisText: "щільним поясненням",
        occurrence: 1
      }
    ]
  });

  assert.equal(normalized.droppedCount, 0);
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.items[0]?.stepId, "emphasis");
  assert.equal(normalized.items[0]?.emphasisTarget?.text, "щільним поясненням");
  assert.equal(normalized.items[0]?.emphasisTarget?.occurrence, undefined);
  assert.deepEqual(normalized.items[0]?.anchor.blockIds, ["p1"]);
});

test("normalizeEditorialReviewItems keeps repeated emphasis phrases on different anchors", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "Ключова теза звучить переконливо." }] },
      { id: "p2", type: "paragraph", content: [{ text: "І тут теж Ключова теза працює як висновок." }] }
    ]
  };
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-emphasis-repeat",
    changeLevel: 3,
    stepId: "emphasis",
    items: [
      {
        blockStart: 0,
        blockEnd: 0,
        excerpt: "Ключова теза звучить переконливо.",
        priority: "medium",
        emphasisText: "Ключова теза"
      },
      {
        blockStart: 1,
        blockEnd: 1,
        excerpt: "І тут теж Ключова теза працює як висновок.",
        priority: "medium",
        emphasisText: "Ключова теза"
      }
    ]
  });

  assert.equal(normalized.droppedCount, 0);
  assert.equal(normalized.items.length, 2);
  assert.deepEqual(normalized.items.map((item) => item.anchor.blockIds), [["p1"], ["p2"]]);
});

test("review helpers expose dynamic Ukrainian paragraph ranges and type labels", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-3",
    changeLevel: 3,
    items: [
      {
        title: "Спростити фрагмент",
        reason: "Фрагмент звучить занадто академічно.",
        recommendation: "Спростити формулювання.",
        recommendationType: "simplify",
        suggestedAction: "rewrite_text",
        priority: "medium",
        blockStart: 1,
        blockEnd: 2,
        excerpt: "Перший і другий абзаци",
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
  });

  assert.equal(getReviewParagraphRangeLabel(normalized.items[0]!, revision), "Абз. 002-003");
  assert.equal(getReviewParagraphRangeLabel(normalized.items[0]!, revision, "en"), "Para. 002-003");
  assert.equal(getEditorialRecommendationTypeLabel("simplify"), "спростити");
  assert.equal(getEditorialRecommendationTypeLabel("rewrite", "en"), "rewrite");
});

test("normalizeEditorialReviewItems resolves insertion anchors by mode when anchorBlockId is missing", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-4",
    changeLevel: 3,
    items: [
      {
        title: "Винести врізку",
        reason: "Краще дати окремий пояснювальний блок після фрагмента.",
        recommendation: "Додати врізку після двох абзаців.",
        recommendationType: "callout",
        suggestedAction: "prepare_callout",
        priority: "medium",
        blockStart: 1,
        blockEnd: 2,
        excerpt: "Перший і другий абзаци",
        insertionHint: "after",
        anchorBlockId: null,
        calloutKind: "mechanism",
        calloutTitle: null,
        calloutPreviewText: null,
        calloutSummary: null,
        calloutPrompt: null,
        visualIntent: null
      },
      {
        title: "Додати підзаголовок",
        reason: "Потрібна локальна структура перед фрагментом.",
        recommendation: "Додати підзаголовок перед абзацами.",
        recommendationType: "subsection",
        suggestedAction: "insert_text",
        priority: "low",
        blockStart: 1,
        blockEnd: 2,
        excerpt: "Перший і другий абзаци",
        insertionHint: "before",
        anchorBlockId: null,
        calloutKind: null,
        calloutTitle: null,
        calloutPreviewText: null,
        calloutSummary: null,
        calloutPrompt: null,
        visualIntent: null
      }
    ]
  });

  const callout = normalized.items.find((item) => item.recommendationType === "callout");
  const subsection = normalized.items.find((item) => item.recommendationType === "subsection");

  assert.equal(callout?.insertionPoint.mode, "after");
  assert.equal(callout?.insertionPoint.anchorBlockId, "p2");
  assert.equal(subsection?.insertionPoint.mode, "before");
  assert.equal(subsection?.insertionPoint.anchorBlockId, "p1");
});

test("normalizeEditorialReviewItems clips adjacent structural heading from replace/list range", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 2, content: [{ text: "Зміна кольору шкіри" }] },
      { id: "p1", type: "paragraph", content: [{ text: "Ціаноз шкіри може свідчити про системні порушення." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Охряно-сірий колір шкіри можливий при нирковій недостатності." }] },
      { id: "h2", type: "heading", level: 2, content: [{ text: "Сухість шкіри" }] }
    ]
  };
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-5",
    changeLevel: 3,
    items: [
      {
        title: "Зробити список",
        reason: "Список читатиметься краще.",
        recommendation: "Стисни у короткий перелік.",
        recommendationType: "list",
        suggestedAction: "rewrite_text",
        priority: "medium",
        blockStart: 1,
        blockEnd: 3,
        excerpt: "Ціаноз... Сухість шкіри",
        insertionHint: "replace",
        anchorBlockId: "p1"
      }
    ]
  });

  assert.equal(normalized.items.length, 1);
  assert.deepEqual(normalized.items[0]?.anchor.blockIds, ["p1", "p2"]);
  assert.equal(normalized.items[0]?.anchor.generationBlockRange.end, 2);
  assert.match(normalized.items[0]?.reason ?? "", /автоматично обрізано/i);
});

test("normalizeEditorialReviewItems does not dedupe non-emphasis cards only by identical title", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "Перший фрагмент для підзаголовка." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Другий фрагмент для підзаголовка." }] }
    ]
  };
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-6",
    changeLevel: 3,
    stepId: "structure",
    items: [
      {
        title: "Додати підзаголовок",
        reason: "Перша локальна зона без заголовка.",
        recommendation: "Додати підзаголовок перед абз. 001.",
        recommendationType: "subsection",
        suggestedAction: "insert_text",
        priority: "medium",
        blockStart: 0,
        blockEnd: 0,
        excerpt: "Перший фрагмент",
        insertionHint: "before",
        anchorBlockId: "p1"
      },
      {
        title: "Додати підзаголовок",
        reason: "Друга локальна зона без заголовка.",
        recommendation: "Додати підзаголовок перед абз. 002.",
        recommendationType: "subsection",
        suggestedAction: "insert_text",
        priority: "medium",
        blockStart: 1,
        blockEnd: 1,
        excerpt: "Другий фрагмент",
        insertionHint: "before",
        anchorBlockId: "p2"
      }
    ]
  });

  assert.equal(normalized.items.length, 2);
  assert.deepEqual(normalized.items.map((item) => item.anchor.blockIds[0]), ["p1", "p2"]);
});

test("normalizeEditorialReviewItems splits subsection cards by explicit non-contiguous paragraph references", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "Абзац 1." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Абзац 2." }] },
      { id: "p3", type: "paragraph", content: [{ text: "Абзац 3." }] },
      { id: "p4", type: "paragraph", content: [{ text: "Абзац 4." }] },
      { id: "p5", type: "paragraph", content: [{ text: "Абзац 5." }] },
      { id: "p6", type: "paragraph", content: [{ text: "Абзац 6." }] },
      { id: "p7", type: "paragraph", content: [{ text: "Абзац 7." }] },
      { id: "p8", type: "paragraph", content: [{ text: "Абзац 8." }] }
    ]
  };
  const revision = deriveManuscriptRevisionState(document);

  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-7",
    changeLevel: 3,
    stepId: "structure",
    items: [
      {
        title: "Додати підзаголовки",
        reason: "Є кілька окремих зламів теми.",
        recommendation: "Додати підзаголовки для абз. 2, 5, 7-8.",
        recommendationType: "subsection",
        suggestedAction: "insert_text",
        priority: "high",
        blockStart: 1,
        blockEnd: 7,
        excerpt: "Довгий фрагмент",
        insertionHint: "before",
        anchorBlockId: "p2"
      }
    ]
  });

  assert.equal(normalized.items.length, 3);
  assert.deepEqual(
    normalized.items.map((item) => item.anchor.blockIds),
    [["p2"], ["p5"], ["p7", "p8"]]
  );
});

test("normalizeEditorialReviewItems prefers explicit blockId over a wrong positional index", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);
  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-blockid",
    changeLevel: 3,
    stepId: "clarity",
    items: [
      {
        title: "Спростити",
        reason: "Формулювання перевантажене.",
        recommendation: "Переписати простішими словами.",
        recommendationType: "simplify",
        suggestedAction: "rewrite_text",
        priority: "high",
        blockId: "p2",
        blockStart: 0,
        blockEnd: 0,
        excerpt: "Другий абзац",
        insertionHint: "replace"
      }
    ]
  });

  assert.equal(normalized.items.length, 1);
  assert.deepEqual(normalized.items[0]?.anchor.blockIds, ["p2"]);
});

test("normalizeEditorialReviewItems falls back to blockStart when blockId is unknown", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);
  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-unknown-blockid",
    changeLevel: 3,
    stepId: "clarity",
    items: [
      {
        title: "Спростити",
        reason: "Формулювання перевантажене.",
        recommendation: "Переписати простішими словами.",
        recommendationType: "simplify",
        suggestedAction: "rewrite_text",
        priority: "high",
        blockId: "missing-block",
        blockStart: 2,
        blockEnd: 2,
        excerpt: "Другий абзац",
        insertionHint: "replace"
      }
    ]
  });

  assert.equal(normalized.items.length, 1);
  assert.deepEqual(normalized.items[0]?.anchor.blockIds, ["p2"]);
});

test("normalizeEditorialReviewItems keeps a multi-block range when blockId start and later blockEnd agree", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);
  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-blockid-range",
    changeLevel: 3,
    stepId: "clarity",
    items: [
      {
        title: "Спростити",
        reason: "Два абзаци варто ущільнити разом.",
        recommendation: "Переписати обидва абзаци простіше.",
        recommendationType: "simplify",
        suggestedAction: "rewrite_text",
        priority: "high",
        blockId: "p1",
        blockStart: 1,
        blockEnd: 2,
        excerpt: "Перший і другий абзаци",
        insertionHint: "replace"
      }
    ]
  });

  assert.equal(normalized.items.length, 1);
  assert.deepEqual(normalized.items[0]?.anchor.blockIds, ["p1", "p2"]);
});

test("normalizeEditorialReviewItems keeps a blockId anchor after the block is reordered", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);
  const normalized = normalizeEditorialReviewItems({
    document,
    revision,
    reviewSessionId: "review-session-reorder",
    changeLevel: 3,
    stepId: "clarity",
    items: [
      {
        title: "Спростити",
        reason: "Формулювання перевантажене.",
        recommendation: "Переписати простішими словами.",
        recommendationType: "simplify",
        suggestedAction: "rewrite_text",
        priority: "high",
        blockId: "p2",
        blockStart: 2,
        blockEnd: 2,
        excerpt: "Другий абзац",
        insertionHint: "replace"
      }
    ]
  });

  const reordered = {
    version: 2 as const,
    blocks: [document.blocks[2], document.blocks[0], document.blocks[1]]
  };
  const reorderedRevision = deriveManuscriptRevisionState(reordered);
  const reconciled = normalizeEditorialReviewItems({
    document: reordered,
    revision: reorderedRevision,
    reviewSessionId: "review-session-reorder",
    changeLevel: 3,
    stepId: "clarity",
    items: [
      {
        title: "Спростити",
        reason: "Формулювання перевантажене.",
        recommendation: "Переписати простішими словами.",
        recommendationType: "simplify",
        suggestedAction: "rewrite_text",
        priority: "high",
        blockId: "p2",
        blockStart: 0,
        blockEnd: 0,
        excerpt: "Другий абзац",
        insertionHint: "replace"
      }
    ]
  });

  assert.deepEqual(normalized.items[0]?.anchor.blockIds, ["p2"]);
  assert.deepEqual(reconciled.items[0]?.anchor.blockIds, ["p2"]);
  assert.equal(reorderedRevision.blockOrder[0], "p2");
});
