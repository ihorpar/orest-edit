import { getBlock, getBlockText, type EditorDocument } from "./document-model";
import { createPatchId } from "./patch-contract";
import { computeAnchorFingerprint, type ManuscriptRevisionState } from "./manuscript-structure";
import type {
  EditorialCalloutDepth,
  EditorialCalloutKind,
  EditorialReviewItem,
  EditorialReviewRecommendationType,
  EditorialVisualIntent,
  WholeTextChangeLevel
} from "./review-contract";
import {
  getInsertionHintForRecommendationType,
  getSuggestedActionForRecommendationType
} from "./review-contract";

export interface BuildManualReviewItemInput {
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  blockIds: string[];
  changeLevel: WholeTextChangeLevel;
  recommendationType: "callout" | "visual" | "list";
  calloutKind?: EditorialCalloutKind;
  calloutDepth?: EditorialCalloutDepth;
  visualIntent?: EditorialVisualIntent;
  manualInstruction?: string;
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
  const manualInstruction = input.manualInstruction?.trim() ?? "";
  const instructionSuffix = manualInstruction ? ` Додаткова інструкція: ${manualInstruction}` : "";
  const recommendationType = input.recommendationType;
  const suggestedAction = getSuggestedActionForRecommendationType(recommendationType);
  const insertionMode = getInsertionHintForRecommendationType(recommendationType);
  const anchorBlockId = insertionMode === "after" ? orderedBlockIds[orderedBlockIds.length - 1] : orderedBlockIds[0];

  return {
    id: createPatchId("manual-review-item"),
    reviewSessionId: createPatchId("manual-review-session"),
    documentRevisionId: input.revision.documentRevisionId,
    changeLevel: input.changeLevel,
    title:
      recommendationType === "callout"
        ? "Ручна врізка"
        : recommendationType === "visual"
          ? "Ручний візуал"
          : "Ручний список",
    reason: `Ручний запит із панелі локальної правки.${instructionSuffix}`,
    recommendation:
      recommendationType === "callout"
        ? `Згенерувати врізку для виділеного фрагмента.${instructionSuffix}`
        : recommendationType === "visual"
          ? `Згенерувати візуал для виділеного фрагмента.${instructionSuffix}`
          : `Перетворити виділений фрагмент на компактний список.${instructionSuffix}`,
    recommendationType,
    suggestedAction,
    priority: "medium",
    anchor: {
      blockIds: orderedBlockIds,
      generationBlockRange: { start, end },
      excerpt,
      fingerprint: computeAnchorFingerprint(input.document, orderedBlockIds)
    },
    insertionPoint: {
      mode: insertionMode,
      anchorBlockId
    },
    calloutKind: recommendationType === "callout" ? input.calloutKind ?? "mechanism" : undefined,
    calloutDepth: recommendationType === "callout" ? input.calloutDepth ?? "brief" : undefined,
    visualIntent: recommendationType === "visual" ? input.visualIntent ?? "infographic" : undefined,
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
