import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import {
  getEditorialRecommendationTypeLabel,
  getReviewParagraphRangeLabel,
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
  assert.deepEqual(normalized.items[0]?.anchor.blockIds, ["p1", "p2"]);
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
