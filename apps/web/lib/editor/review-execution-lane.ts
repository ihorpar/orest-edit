import type { EditorialReviewItem, ReviewActionProposal } from "./review-contract";

export interface ReviewExecutionLaneState {
  preparingItem: EditorialReviewItem | null;
  proposalItem: EditorialReviewItem | null;
  highlightedItem: EditorialReviewItem | null;
  highlightedBlockIds: string[];
  highlightedStartBlockId: string | null;
  highlightedEndBlockId: string | null;
  shouldShowInlineDetail: boolean;
  isReplaceDiffActive: boolean;
}

export function resolveReviewExecutionLaneState(input: {
  reviewItems: EditorialReviewItem[];
  activeReviewItem?: EditorialReviewItem | null;
  activeProposal?: ReviewActionProposal | null;
  preparingReviewItemId?: string | null;
}): ReviewExecutionLaneState {
  const preparingItem = input.preparingReviewItemId
    ? input.reviewItems.find((item) => item.id === input.preparingReviewItemId) ?? null
    : null;
  const proposalItem = input.activeProposal
    ? input.reviewItems.find((item) => item.id === input.activeProposal?.reviewItemId) ?? null
    : null;
  const highlightedItem = input.activeReviewItem ?? proposalItem ?? preparingItem ?? null;
  const highlightedBlockIds = highlightedItem?.anchor.blockIds ?? [];
  const highlightedStartBlockId = highlightedBlockIds[0] ?? null;
  const highlightedEndBlockId = highlightedBlockIds[highlightedBlockIds.length - 1] ?? null;
  const shouldShowInlineDetail = Boolean(highlightedItem) && (!input.activeProposal || input.activeProposal.kind !== "text_diff");
  const isReplaceDiffActive = Boolean(
    input.activeProposal?.kind === "text_diff" && highlightedItem && proposalItem?.id === highlightedItem.id
  );

  return {
    preparingItem,
    proposalItem,
    highlightedItem,
    highlightedBlockIds,
    highlightedStartBlockId,
    highlightedEndBlockId,
    shouldShowInlineDetail,
    isReplaceDiffActive
  };
}
