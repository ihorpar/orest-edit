import type {
  EditorialReviewFailedChunk,
  EditorialReviewItem,
  EditorialReviewRequest,
  EditorialReviewResponse,
  EditorialReviewRunApiResponse,
  EditorialReviewRunProgress,
  EditorialReviewRunSnapshot
} from "../editor/review-contract.ts";
import type { ReviewChunkPlan } from "./review-chunk-planner.ts";

export const CHUNKED_REVIEW_MAX_RETRIES = 2;
export const REVIEW_PARTIAL_ITEMS_NAMESPACE = "review-partial-items";

export function isChunkedRecommendationStep(stepId: EditorialReviewRequest["stepId"]): boolean {
  return stepId === "structure" ||
    stepId === "clarity" ||
    stepId === "interest" ||
    stepId === "visuals" ||
    stepId === "formatting" ||
    stepId === "emphasis" ||
    stepId === "final_editing";
}

export function reviewRunPollAfterMs(
  status: EditorialReviewRunSnapshot["status"],
  stepId: EditorialReviewRequest["stepId"]
): number {
  if (status === "pending") {
    return 900;
  }

  if (status === "running") {
    return isChunkedRecommendationStep(stepId) ? 3000 : 2000;
  }

  return 0;
}

export function filterCoreReviewChunkItems(
  items: EditorialReviewItem[],
  coreBlockIds: string[]
): EditorialReviewItem[] {
  const coreIds = new Set(coreBlockIds);
  return items.filter((item) => {
    const anchorId = item.anchor.blockIds[0];
    return Boolean(anchorId && coreIds.has(anchorId));
  });
}

export function mergeReviewChunkItems(
  request: EditorialReviewRequest,
  chunks: ReviewChunkPlan[],
  responses: EditorialReviewResponse[]
): EditorialReviewItem[] {
  const blockIndexById = new Map(request.document.blocks.map((block, index) => [block.id, index]));
  const merged: EditorialReviewItem[] = [];
  const seen = new Set<string>();

  responses.forEach((response, chunkIndex) => {
    const chunk = chunks[chunkIndex];
    if (!chunk || response.error) {
      return;
    }

    for (const item of filterCoreReviewChunkItems(response.items, chunk.coreBlockIds)) {
      const key = `${item.recommendationType}:${item.anchor.blockIds.join("|")}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
    }
  });

  return merged.sort((left, right) => {
    const leftIndex = blockIndexById.get(left.anchor.blockIds[0] ?? "") ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = blockIndexById.get(right.anchor.blockIds[0] ?? "") ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

export function collectFailedReviewChunks(
  chunks: ReviewChunkPlan[],
  responses: EditorialReviewResponse[]
): EditorialReviewFailedChunk[] {
  const failed: EditorialReviewFailedChunk[] = [];

  responses.forEach((response, chunkIndex) => {
    const chunk = chunks[chunkIndex];
    if (!chunk || !response.error) {
      return;
    }

    failed.push({
      index: chunk.index,
      coreBlockIds: chunk.coreBlockIds,
      message: response.error
    });
  });

  return failed;
}

export function buildReviewChunkProgress(input: {
  completedChunks: number;
  totalChunks: number;
  completedSourceChars: number;
  totalSourceChars: number;
  failedChunks?: EditorialReviewFailedChunk[];
  attempt?: number;
  retryAt?: string;
}): EditorialReviewRunProgress {
  return {
    completedChunks: input.completedChunks,
    totalChunks: input.totalChunks,
    completedSourceChars: input.completedSourceChars,
    totalSourceChars: input.totalSourceChars,
    failedChunks: input.failedChunks && input.failedChunks.length > 0 ? input.failedChunks : undefined,
    attempt: input.attempt,
    retryAt: input.retryAt
  };
}

export function sumChunkSourceChars(chunks: Array<{ sourceChars: number }>, endExclusive: number): number {
  return chunks.slice(0, Math.max(0, endExclusive)).reduce((total, chunk) => total + chunk.sourceChars, 0);
}

export function latestReviewProgress(
  batches: Array<EditorialReviewRunProgress | undefined>
): EditorialReviewRunProgress | undefined {
  for (let index = batches.length - 1; index >= 0; index -= 1) {
    const batch = batches[index];
    if (batch && typeof batch.completedChunks === "number" && typeof batch.totalChunks === "number") {
      return batch;
    }
  }

  return undefined;
}

export function classifyReviewChunkFailure(input: {
  error?: string;
  providerError?: EditorialReviewResponse["diagnostics"]["providerError"];
  attempt: number;
  maxRetries?: number;
}): "retry" | "hole" | "fatal" {
  const maxRetries = input.maxRetries ?? CHUNKED_REVIEW_MAX_RETRIES;
  const status = input.providerError?.status;
  const errorText = input.error ?? "";

  if (status === 401 || status === 403 || /api key/i.test(errorText)) {
    return "fatal";
  }

  if (input.providerError?.retryable && input.attempt <= maxRetries) {
    return "retry";
  }

  return "hole";
}

export function alignReviewItemsToSnapshot(
  items: EditorialReviewItem[],
  request: Pick<EditorialReviewRequest, "document" | "revision">
): EditorialReviewItem[] {
  const blockIndexById = new Map(request.document.blocks.map((block, index) => [block.id, index]));
  const documentRevisionId = request.revision.documentRevisionId;

  return items.map((item) => {
    const startId = item.anchor.blockIds[0];
    const endId = item.anchor.blockIds.at(-1);
    const start = startId ? blockIndexById.get(startId) : undefined;
    const end = endId ? blockIndexById.get(endId) : undefined;

    return {
      ...item,
      documentRevisionId,
      anchor: {
        ...item.anchor,
        generationBlockRange: {
          start: start ?? item.anchor.generationBlockRange.start,
          end: end ?? item.anchor.generationBlockRange.end
        }
      }
    };
  });
}

export async function consumeReadableBatches<T>(
  reader: ReadableStreamDefaultReader<T>
): Promise<T[]> {
  const batches: T[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value !== undefined) {
        batches.push(value);
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }

  return batches;
}

export function accumulateReviewPartialItemBatches(batches: EditorialReviewItem[][]): EditorialReviewItem[] {
  const merged: EditorialReviewItem[] = [];
  const seen = new Set<string>();

  for (const batch of batches) {
    for (const item of batch) {
      const key = `${item.recommendationType}:${item.anchor.blockIds.join("|")}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
    }
  }

  return merged;
}

export function summarizeReviewChunkRun(
  request: EditorialReviewRequest,
  chunks: ReviewChunkPlan[],
  responses: EditorialReviewResponse[]
): {
  items: EditorialReviewItem[];
  failedChunks: EditorialReviewFailedChunk[];
  progress: EditorialReviewRunProgress;
} {
  const items = mergeReviewChunkItems(request, chunks, responses);
  const failedChunks = collectFailedReviewChunks(chunks, responses);
  const completedSourceChars = chunks.reduce((total, chunk, index) => {
    return responses[index] && !responses[index].error ? total + chunk.sourceChars : total;
  }, 0);

  return {
    items: alignReviewItemsToSnapshot(items, request),
    failedChunks,
    progress: buildReviewChunkProgress({
      completedChunks: responses.filter((response) => !response.error).length,
      totalChunks: chunks.length,
      completedSourceChars,
      totalSourceChars: sumChunkSourceChars(chunks, chunks.length),
      failedChunks
    })
  };
}

export function buildRunningReviewApiResponse(input: {
  run: EditorialReviewRunSnapshot;
  capability: string;
  itemBatches: EditorialReviewItem[][];
}): Extract<EditorialReviewRunApiResponse, { kind: "run" }> {
  const items = accumulateReviewPartialItemBatches(input.itemBatches);

  return {
    kind: "run",
    run: input.run,
    capability: input.capability,
    items: items.length > 0 ? items : undefined
  };
}
