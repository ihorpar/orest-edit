import test from "node:test";
import assert from "node:assert/strict";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";
import type { EditorialReviewItem } from "../lib/editor/review-contract.ts";
import { reconcileReviewItemsWithRevision } from "../lib/editor/review-contract.ts";
import {
  clearReviewItemsForReplaceRun,
  mergeIncomingReviewItems
} from "../lib/editor/review-run-merge.ts";

function paragraph(id: string, text: string): EditorDocument["blocks"][number] {
  return { id, type: "paragraph", content: [{ text }] };
}

function itemFor(
  document: EditorDocument,
  blockId: string,
  status: EditorialReviewItem["status"] = "pending"
): EditorialReviewItem {
  return {
    id: `item-${blockId}`,
    reviewSessionId: "session",
    documentRevisionId: "snapshot-revision",
    changeLevel: 3,
    title: "Спростити",
    reason: "Щільно",
    recommendation: "Простіше.",
    recommendationType: "simplify",
    suggestedAction: "rewrite_text",
    priority: "high",
    anchor: {
      blockIds: [blockId],
      generationBlockRange: { start: 0, end: 0 },
      excerpt: blockId,
      fingerprint: computeAnchorFingerprint(document, [blockId])
    },
    insertionPoint: { mode: "replace", anchorBlockId: blockId },
    stepId: "clarity",
    stepRunId: "step-run",
    status
  };
}

test("clearReviewItemsForReplaceRun removes only the active step cards", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [paragraph("p1", "один"), paragraph("p2", "два")]
  };
  const items = [
    itemFor(document, "p1"),
    { ...itemFor(document, "p2"), id: "interest-p2", stepId: "interest" as const }
  ];

  assert.deepEqual(
    clearReviewItemsForReplaceRun(items, "clarity").map((item) => item.id),
    ["interest-p2"]
  );
});

test("mergeIncomingReviewItems accumulates prefix cards in document order", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [paragraph("p1", "один"), paragraph("p2", "два"), paragraph("p3", "три")]
  };
  const revision = deriveManuscriptRevisionState(document);
  const merged = mergeIncomingReviewItems({
    current: [itemFor(document, "p1")],
    incoming: [itemFor(document, "p3"), itemFor(document, "p1"), itemFor(document, "p2")],
    document,
    revision,
    stepId: "clarity"
  });

  assert.deepEqual(merged.map((item) => item.anchor.blockIds[0]), ["p1", "p2", "p3"]);
  assert.equal(merged.filter((item) => item.id === "item-p1").length, 1);
});

test("mergeIncomingReviewItems keeps an applied prefix card when later chunks arrive", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [paragraph("p1", "один"), paragraph("p2", "два")]
  };
  const revision = deriveManuscriptRevisionState(document);
  const merged = mergeIncomingReviewItems({
    current: [itemFor(document, "p1", "applied")],
    incoming: [itemFor(document, "p1"), itemFor(document, "p2")],
    document,
    revision,
    stepId: "clarity"
  });

  assert.equal(merged.find((item) => item.id === "item-p1")?.status, "applied");
  assert.equal(merged.find((item) => item.id === "item-p2")?.status, "pending");
});

test("reconcileReviewItemsWithRevision marks changed or deleted blocks stale and keeps unchanged text ready", () => {
  const snapshot: EditorDocument = {
    version: 2,
    blocks: [paragraph("p1", "один"), paragraph("p2", "два"), paragraph("p3", "три")]
  };
  const items = [
    itemFor(snapshot, "p1"),
    itemFor(snapshot, "p2"),
    itemFor(snapshot, "p3")
  ];
  const live: EditorDocument = {
    version: 2,
    blocks: [paragraph("p1", "один"), paragraph("p2", "два змінено")]
  };
  const liveRevision = deriveManuscriptRevisionState(live);
  const reconciled = reconcileReviewItemsWithRevision(items, live, liveRevision);

  assert.equal(reconciled[0]?.status, "pending");
  assert.equal(reconciled[1]?.status, "stale");
  assert.equal(reconciled[2]?.status, "stale");
});
