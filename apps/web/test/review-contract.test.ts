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
  assert.equal(normalized.items[1]?.recommendationType, "visual");
  assert.equal(normalized.items[1]?.suggestedAction, "prepare_visual");
  assert.equal(normalized.items[1]?.insertionPoint.mode, "after");
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
  assert.equal(getEditorialRecommendationTypeLabel("simplify"), "спростити");
});
