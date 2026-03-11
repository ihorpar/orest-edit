import test from "node:test";
import assert from "node:assert/strict";

import { resolveReviewExecutionLaneState } from "../lib/editor/review-execution-lane.ts";
import type { EditorialReviewItem, ReviewActionProposal } from "../lib/editor/review-contract.ts";

function createItem(id: string, blockIds: string[]): EditorialReviewItem {
  return {
    id,
    reviewSessionId: "review-session-1",
    documentRevisionId: "revision-1",
    changeLevel: 3,
    title: `Картка ${id}`,
    reason: "Причина",
    recommendation: "Рекомендація",
    recommendationType: "callout",
    suggestedAction: "prepare_callout",
    priority: "medium",
    anchor: {
      blockIds,
      generationBlockRange: { start: 0, end: Math.max(0, blockIds.length - 1) },
      excerpt: "Фрагмент",
      fingerprint: "fp-1"
    },
    insertionPoint: {
      mode: "after",
      anchorBlockId: blockIds[blockIds.length - 1] ?? null
    },
    status: "pending"
  };
}

function createTextDiffProposal(reviewItemId: string): ReviewActionProposal {
  return {
    id: "proposal-1",
    reviewItemId,
    sourceRevisionId: "revision-1",
    targetRevisionId: "revision-1",
    kind: "text_diff",
    summary: "Чернетка",
    canApplyDirectly: true,
    textDiff: {
      op: "replace_blocks",
      blockIds: ["p1"],
      oldBlocks: [{ id: "p1", type: "paragraph", content: [{ text: "Було" }] }],
      newBlocks: [{ id: "p1", type: "paragraph", content: [{ text: "Стало" }] }],
      reason: "Причина"
    }
  };
}

test("resolveReviewExecutionLaneState uses active item as the single highlighted lane", () => {
  const items = [createItem("a", ["p1", "p2"]), createItem("b", ["p3"])];
  const state = resolveReviewExecutionLaneState({
    reviewItems: items,
    activeReviewItem: items[1],
    activeProposal: createTextDiffProposal("a"),
    preparingReviewItemId: "a"
  });

  assert.equal(state.highlightedItem?.id, "b");
  assert.deepEqual(state.highlightedBlockIds, ["p3"]);
  assert.equal(state.shouldShowInlineDetail, false);
  assert.equal(state.isReplaceDiffActive, false);
});

test("resolveReviewExecutionLaneState falls back to proposal item when no active item is set", () => {
  const items = [createItem("a", ["p1", "p2"]), createItem("b", ["p3"])];
  const state = resolveReviewExecutionLaneState({
    reviewItems: items,
    activeReviewItem: null,
    activeProposal: createTextDiffProposal("a"),
    preparingReviewItemId: "b"
  });

  assert.equal(state.highlightedItem?.id, "a");
  assert.equal(state.highlightedStartBlockId, "p1");
  assert.equal(state.highlightedEndBlockId, "p2");
  assert.equal(state.shouldShowInlineDetail, false);
  assert.equal(state.isReplaceDiffActive, true);
});

test("resolveReviewExecutionLaneState falls back to preparing item for non-diff inline cards", () => {
  const items = [createItem("a", ["p1", "p2"]), createItem("b", ["p3"])];
  const state = resolveReviewExecutionLaneState({
    reviewItems: items,
    activeReviewItem: null,
    activeProposal: null,
    preparingReviewItemId: "b"
  });

  assert.equal(state.highlightedItem?.id, "b");
  assert.equal(state.shouldShowInlineDetail, true);
  assert.equal(state.isReplaceDiffActive, false);
});
