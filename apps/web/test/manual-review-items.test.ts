import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { deriveManuscriptRevisionState, computeAnchorFingerprint } from "../lib/editor/manuscript-structure.ts";
import {
  buildManualReviewItem,
  createManualReviewDedupeKey,
  createManualReviewDedupeKeyForItem,
  upsertManualReviewItem
} from "../lib/editor/manual-review-items.ts";

function createDocument(): EditorDocument {
  return {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "Перший абзац." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Другий абзац." }] },
      { id: "p3", type: "paragraph", content: [{ text: "Третій абзац." }] }
    ]
  };
}

test("buildManualReviewItem sets required metadata and anchor fields", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);
  const now = "2026-03-11T12:30:00.000Z";

  const item = buildManualReviewItem({
    document,
    revision,
    blockIds: ["p1", "p2"],
    changeLevel: 4,
    recommendationType: "callout",
    calloutKind: "analogy",
    now
  });

  assert.equal(item.reviewSessionId.startsWith("manual-review-session-"), true);
  assert.equal(item.documentRevisionId, revision.documentRevisionId);
  assert.equal(item.changeLevel, 4);
  assert.equal(item.recommendationType, "callout");
  assert.equal(item.calloutKind, "analogy");
  assert.equal(item.origin, "manual");
  assert.equal(item.manualRequest?.source, "floating_local_bar");
  assert.equal(item.manualRequest?.createdAt, now);
  assert.deepEqual(item.anchor.blockIds, ["p1", "p2"]);
  assert.deepEqual(item.anchor.generationBlockRange, { start: 0, end: 1 });
  assert.equal(item.anchor.fingerprint, computeAnchorFingerprint(document, ["p1", "p2"]));
  assert.equal(item.insertionPoint.mode, "after");
  assert.equal(item.insertionPoint.anchorBlockId, "p2");
});

test("buildManualReviewItem rejects empty selection", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);

  assert.throws(
    () =>
      buildManualReviewItem({
        document,
        revision,
        blockIds: [],
        changeLevel: 3,
        recommendationType: "visual"
      }),
    /requires at least one selected block/i
  );
});

test("upsertManualReviewItem reuses existing manual item for same revision+type+anchor", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);
  const first = buildManualReviewItem({
    document,
    revision,
    blockIds: ["p2", "p3"],
    changeLevel: 3,
    recommendationType: "callout",
    calloutKind: "mechanism",
    now: "2026-03-11T12:00:00.000Z"
  });
  const second = buildManualReviewItem({
    document,
    revision,
    blockIds: ["p2", "p3"],
    changeLevel: 3,
    recommendationType: "callout",
    calloutKind: "top_list",
    now: "2026-03-11T12:05:00.000Z"
  });

  const firstInsert = upsertManualReviewItem([], first);
  const secondInsert = upsertManualReviewItem(firstInsert.items, second);

  assert.equal(firstInsert.items.length, 1);
  assert.equal(secondInsert.items.length, 1);
  assert.equal(secondInsert.reused, true);
  assert.equal(secondInsert.item.id, first.id);
  assert.equal(secondInsert.item.calloutKind, "top_list");
  assert.equal(secondInsert.item.status, "pending");
  assert.equal(secondInsert.item.manualRequest?.createdAt, "2026-03-11T12:05:00.000Z");
  assert.equal(secondInsert.dedupeKey, createManualReviewDedupeKeyForItem(second));
});

test("upsertManualReviewItem creates a new manual item when type differs", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);
  const callout = buildManualReviewItem({
    document,
    revision,
    blockIds: ["p1", "p2"],
    changeLevel: 3,
    recommendationType: "callout"
  });
  const visual = buildManualReviewItem({
    document,
    revision,
    blockIds: ["p1", "p2"],
    changeLevel: 3,
    recommendationType: "visual"
  });

  const firstInsert = upsertManualReviewItem([], callout);
  const secondInsert = upsertManualReviewItem(firstInsert.items, visual);

  assert.equal(secondInsert.items.length, 2);
  assert.equal(secondInsert.reused, false);
  assert.equal(
    secondInsert.dedupeKey,
    createManualReviewDedupeKey({
      documentRevisionId: revision.documentRevisionId,
      recommendationType: "visual",
      blockIds: ["p1", "p2"]
    })
  );
});

test("buildManualReviewItem supports local list generation as replace suggestion", () => {
  const document = createDocument();
  const revision = deriveManuscriptRevisionState(document);
  const item = buildManualReviewItem({
    document,
    revision,
    blockIds: ["p2", "p3"],
    changeLevel: 2,
    recommendationType: "list",
    manualInstruction: "Зберегти причинно-наслідковий порядок."
  });

  assert.equal(item.recommendationType, "list");
  assert.equal(item.suggestedAction, "rewrite_text");
  assert.equal(item.insertionPoint.mode, "replace");
  assert.equal(item.insertionPoint.anchorBlockId, "p2");
  assert.match(item.recommendation, /компактний список/i);
  assert.match(item.reason, /Зберегти причинно-наслідковий порядок/i);
});
