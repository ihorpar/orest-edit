import { getBlock, getBlockText, type EditorDocument } from "./document-model";
import { createPatchId } from "./patch-contract";
import { computeAnchorFingerprint, type ManuscriptRevisionState } from "./manuscript-structure";
import type {
  EditorialCalloutKind,
  EditorialReviewItem,
  EditorialReviewRecommendationType,
  EditorialVisualIntent,
  WholeTextChangeLevel
} from "./review-contract";

export interface BuildManualReviewItemInput {
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  blockIds: string[];
  changeLevel: WholeTextChangeLevel;
  recommendationType: "callout" | "visual";
  calloutKind?: EditorialCalloutKind;
  visualIntent?: EditorialVisualIntent;
  now?: string;
}

export function createManualReviewDedupeKey(input: {
  documentRevisionId: string;
  recommendationType: EditorialReviewRecommendationType;
  blockIds: string[];
}): string {
  return `${input.documentRevisionId}::${input.recommendationType}::${input.blockIds.join("|")}`;
}

export function createManualReviewDedupeKeyForItem(item: EditorialReviewItem): string {
  return createManualReviewDedupeKey({
    documentRevisionId: item.documentRevisionId,
    recommendationType: item.recommendationType,
    blockIds: item.anchor.blockIds
  });
}

export function buildManualReviewItem(input: BuildManualReviewItemInput): EditorialReviewItem {
  if (input.blockIds.length === 0) {
    throw new Error("Manual review item requires at least one selected block.");
  }

  const orderedBlockIds = input.blockIds.slice();
  const anchorStart = input.revision.blockOrder.indexOf(orderedBlockIds[0]);
  const anchorEnd = input.revision.blockOrder.indexOf(orderedBlockIds[orderedBlockIds.length - 1]);
  const start = anchorStart >= 0 ? anchorStart : 0;
  const end = anchorEnd >= 0 ? anchorEnd : start;
  const excerpt = orderedBlockIds
    .map((blockId) => {
      const block = getBlock(input.document, blockId);
      return block ? getBlockText(block) : "";
    })
    .filter((value) => value.trim().length > 0)
    .join("\n\n");
  const now = input.now ?? new Date().toISOString();

  return {
    id: createPatchId("manual-review-item"),
    reviewSessionId: createPatchId("manual-review-session"),
    documentRevisionId: input.revision.documentRevisionId,
    changeLevel: input.changeLevel,
    title: input.recommendationType === "callout" ? "Ручна врізка" : "Ручний візуал",
    reason: "Ручний запит із панелі локальної правки.",
    recommendation:
      input.recommendationType === "callout"
        ? "Згенерувати врізку для виділеного фрагмента."
        : "Згенерувати візуал для виділеного фрагмента.",
    recommendationType: input.recommendationType,
    suggestedAction: input.recommendationType === "callout" ? "prepare_callout" : "prepare_visual",
    priority: "medium",
    anchor: {
      blockIds: orderedBlockIds,
      generationBlockRange: { start, end },
      excerpt,
      fingerprint: computeAnchorFingerprint(input.document, orderedBlockIds)
    },
    insertionPoint: {
      mode: "after",
      anchorBlockId: orderedBlockIds[orderedBlockIds.length - 1]
    },
    calloutKind: input.recommendationType === "callout" ? input.calloutKind ?? "mechanism" : undefined,
    visualIntent: input.recommendationType === "visual" ? input.visualIntent ?? "diagram" : undefined,
    status: "pending",
    origin: "manual",
    manualRequest: {
      source: "floating_local_bar",
      createdAt: now
    }
  };
}

export function upsertManualReviewItem(
  items: EditorialReviewItem[],
  nextManualItem: EditorialReviewItem
): { items: EditorialReviewItem[]; item: EditorialReviewItem; reused: boolean; dedupeKey: string } {
  const dedupeKey = createManualReviewDedupeKeyForItem(nextManualItem);
  const existingIndex = items.findIndex(
    (item) =>
      item.origin === "manual" &&
      item.status !== "applied" &&
      item.status !== "dismissed" &&
      createManualReviewDedupeKeyForItem(item) === dedupeKey
  );

  if (existingIndex < 0) {
    return {
      items: [nextManualItem, ...items],
      item: nextManualItem,
      reused: false,
      dedupeKey
    };
  }

  const existing = items[existingIndex];
  const merged: EditorialReviewItem = {
    ...nextManualItem,
    id: existing.id,
    reviewSessionId: existing.reviewSessionId,
    status: "pending",
    activeProposalId: undefined,
    calloutDraft: undefined
  };

  const nextItems = items.slice();
  nextItems[existingIndex] = merged;

  return {
    items: nextItems,
    item: merged,
    reused: true,
    dedupeKey
  };
}
