import type { EditorDocument } from "./document-model.ts";
import type { EditorialReviewFailedChunk, EditorialReviewRunProgress } from "./review-contract.ts";

export function reviewChunkProgressPercent(progress: EditorialReviewRunProgress): number {
  const totalChars = progress.totalSourceChars ?? 0;
  const completedChars = progress.completedSourceChars ?? 0;

  if (totalChars > 0) {
    return Math.max(0, Math.min(100, Math.round((completedChars / totalChars) * 100)));
  }

  if (progress.totalChunks <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((progress.completedChunks / progress.totalChunks) * 100)));
}

export function isReviewRunProgressFeedback(
  message: string,
  copy: {
    reviewRunProgress: (completed: number, total: number, attempt?: number, retrying?: boolean) => string;
    reviewRunProgressPending: string;
  }
): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === copy.reviewRunProgressPending) {
    return true;
  }

  const marker = copy.reviewRunProgress(1, 8).split("·")[0]?.trim();
  return Boolean(marker && trimmed.includes(marker));
}

export function sliceDocumentForFragmentRetry(
  document: EditorDocument,
  failedChunk: Pick<EditorialReviewFailedChunk, "coreBlockIds">
): EditorDocument | null {
  const coreIds = new Set(failedChunk.coreBlockIds);
  const indexes = document.blocks
    .map((block, index) => (coreIds.has(block.id) ? index : -1))
    .filter((index) => index >= 0);

  if (indexes.length === 0) {
    return null;
  }

  const start = Math.max(0, Math.min(...indexes) - 1);
  const end = Math.min(document.blocks.length, Math.max(...indexes) + 2);

  return {
    version: document.version,
    blocks: document.blocks.slice(start, end)
  };
}
