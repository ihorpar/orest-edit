import type { EditorDocument } from "./document-model.ts";
import type { ManuscriptRevisionState } from "./manuscript-structure.ts";
import {
  reconcileReviewItemsWithRevision,
  type EditorialReviewItem,
  type EditorialReviewStepId
} from "./review-contract.ts";

export function clearReviewItemsForReplaceRun(
  items: EditorialReviewItem[],
  stepId: EditorialReviewStepId
): EditorialReviewItem[] {
  return items.filter((item) => item.stepId !== stepId);
}

export function manuscriptSharesIdentity(liveBlockIds: string[], snapshotBlockIds?: string[]): boolean {
  if (liveBlockIds.length === 0) {
    return false;
  }

  if (!snapshotBlockIds || snapshotBlockIds.length === 0) {
    // Pre-M3 persisted runs have no snapshot ids. Empty live docs still fail above.
    return true;
  }

  const live = new Set(liveBlockIds);
  return snapshotBlockIds.some((blockId) => live.has(blockId));
}

export function mergeIncomingReviewItems(input: {
  current: EditorialReviewItem[];
  incoming: EditorialReviewItem[];
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  stepId: EditorialReviewStepId;
}): EditorialReviewItem[] {
  const current = reconcileReviewItemsWithRevision(input.current, input.document, input.revision);
  const incoming = reconcileReviewItemsWithRevision(
    input.incoming.map((item) => ({ ...item, stepId: input.stepId })),
    input.document,
    input.revision
  );
  const seenIds = new Set(current.map((item) => item.id));
  const seenKeys = new Set(
    current
      .filter((item) => item.stepId === input.stepId)
      .map((item) => reviewItemMergeKey(item))
  );
  const additions = incoming.filter((item) => {
    if (seenIds.has(item.id) || seenKeys.has(reviewItemMergeKey(item))) {
      return false;
    }

    seenIds.add(item.id);
    seenKeys.add(reviewItemMergeKey(item));
    return true;
  });
  const merged = [...current, ...additions];
  const blockIndexById = new Map(input.document.blocks.map((block, index) => [block.id, index]));

  return merged.sort((left, right) => {
    const leftIndex = blockIndexById.get(left.anchor.blockIds[0] ?? "") ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = blockIndexById.get(right.anchor.blockIds[0] ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return left.id.localeCompare(right.id);
  });
}

function reviewItemMergeKey(item: EditorialReviewItem): string {
  return `${item.recommendationType}:${item.anchor.blockIds.join("|")}`;
}
