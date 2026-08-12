import test from "node:test";
import assert from "node:assert/strict";
import type { EditorDocument } from "../lib/editor/document-model.ts";
import {
  isReviewRunProgressFeedback,
  reviewChunkProgressPercent,
  sliceDocumentForFragmentRetry
} from "../lib/editor/review-run-progress.ts";

test("reviewChunkProgressPercent is character-weighted; holes are excluded via completedSourceChars", () => {
  assert.equal(reviewChunkProgressPercent({
    completedChunks: 2,
    totalChunks: 10,
    completedSourceChars: 32000,
    totalSourceChars: 160000
  }), 20);
  assert.equal(reviewChunkProgressPercent({
    completedChunks: 9,
    totalChunks: 10,
    completedSourceChars: 144000,
    totalSourceChars: 160000,
    failedChunks: [{ index: 2, coreBlockIds: ["p3"], message: "timeout" }]
  }), 90);
  assert.equal(reviewChunkProgressPercent({
    completedChunks: 2,
    totalChunks: 10
  }), 20);
});

test("sliceDocumentForFragmentRetry keeps core ids plus one neighbor on each side", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "один" }] },
      { id: "p2", type: "paragraph", content: [{ text: "два" }] },
      { id: "p3", type: "paragraph", content: [{ text: "три" }] },
      { id: "p4", type: "paragraph", content: [{ text: "чотири" }] }
    ]
  };

  const sliced = sliceDocumentForFragmentRetry(document, { coreBlockIds: ["p3"] });
  assert.deepEqual(sliced?.blocks.map((block) => block.id), ["p2", "p3", "p4"]);
  assert.equal(sliceDocumentForFragmentRetry(document, { coreBlockIds: ["missing"] }), null);
});

test("isReviewRunProgressFeedback matches in-flight progress copy and ignores card-ready messages", () => {
  const copy = {
    reviewRunProgress: (completed: number, total: number) => `Розібрано початок розділу · ${completed} з ${total} фрагментів`,
    reviewRunProgressPending: "Розбираємо розділ…"
  };

  assert.equal(isReviewRunProgressFeedback("Розібрано початок розділу · 4 з 8 фрагментів", copy), true);
  assert.equal(isReviewRunProgressFeedback("Розбираємо розділ…", copy), true);
  assert.equal(isReviewRunProgressFeedback("Підготовлено 44 картки з рекомендаціями для цього кроку.", copy), false);
});
