import { FatalError, RetryableError, getStepMetadata, getWorkflowMetadata, getWritable } from "workflow";
import type {
  EditorialReviewFailedChunk,
  EditorialReviewItem,
  EditorialReviewRequest,
  EditorialReviewResponse,
  EditorialReviewRunProgress
} from "../editor/review-contract.ts";
import { planReviewChunks, type ReviewChunkPlan } from "./review-chunk-planner.ts";
import {
  CHUNKED_REVIEW_MAX_RETRIES,
  REVIEW_PARTIAL_ITEMS_NAMESPACE,
  alignReviewItemsToSnapshot,
  classifyReviewChunkFailure,
  filterCoreReviewChunkItems,
  isChunkedRecommendationStep,
  sumChunkSourceChars
} from "./review-chunk-runtime.ts";
import {
  generateEditorialReview,
  mergeDurableEmphasisChunkResponses,
  mergeDurableRecommendationChunkResponses
} from "./review-service.ts";
import { logEditorialReviewEvent } from "./review-observability.ts";

export interface EditorialReviewWorkflowInput {
  request: EditorialReviewRequest;
}

async function executeEditorialReviewStep(input: EditorialReviewWorkflowInput): Promise<EditorialReviewResponse> {
  "use step";

  const metadata = getStepMetadata();
  const workflowRunId = getWorkflowMetadata().workflowRunId;
  const startedAt = Date.now();
  const response = await generateEditorialReview({
    ...input.request,
    providerRequestKey: metadata.stepId
  });
  logEditorialReviewEvent(response.error ? "step_failed" : "step_completed", {
    workflowStepId: metadata.stepId,
    runId: workflowRunId,
    requestId: response.diagnostics.requestId,
    step: response.stepId,
    provider: input.request.provider,
    model: input.request.modelId,
    attempt: metadata.attempt,
    durationMs: Date.now() - startedAt,
    providerStatus: response.diagnostics.providerError?.status,
    providerRequestId: response.diagnostics.providerError?.requestId,
    returnedItems: response.items.length
  }, response.error ? "error" : "info");
  return response;
}

async function executeReviewChunkStep(input: {
  request: EditorialReviewRequest;
  chunk: ReviewChunkPlan;
  totalChunks: number;
  totalSourceChars: number;
  completedChunks: number;
  completedSourceChars: number;
  failedChunks: EditorialReviewFailedChunk[];
}): Promise<EditorialReviewResponse> {
  "use step";

  const metadata = getStepMetadata();
  const workflowRunId = getWorkflowMetadata().workflowRunId;
  const startedAt = Date.now();
  const stepId = input.request.stepId ?? "clarity";
  const progressBase: EditorialReviewRunProgress = {
    completedChunks: input.completedChunks,
    totalChunks: input.totalChunks,
    completedSourceChars: input.completedSourceChars,
    totalSourceChars: input.totalSourceChars,
    failedChunks: input.failedChunks.length > 0 ? input.failedChunks : undefined,
    attempt: metadata.attempt
  };
  await writeReviewProgress(progressBase);
  logEditorialReviewEvent("chunk_started", {
    workflowStepId: metadata.stepId,
    runId: workflowRunId,
    step: stepId,
    provider: input.request.provider,
    model: input.request.modelId,
    chunkIndex: input.chunk.index,
    totalChunks: input.totalChunks,
    attempt: metadata.attempt
  });

  const chunkDocument = {
    version: input.request.document.version,
    blocks: input.chunk.blocks
  };
  const chunkScope = {
    index: input.chunk.index,
    total: input.totalChunks,
    coreBlockIds: input.chunk.coreBlockIds,
    contextBlockIds: input.chunk.contextBlockIds
  };
  const response = await generateEditorialReview({
    ...input.request,
    document: chunkDocument,
    reviewChunk: chunkScope,
    emphasisChunk: stepId === "emphasis" ? chunkScope : input.request.emphasisChunk,
    providerRequestKey: metadata.stepId
  });

  if (response.error) {
    const providerError = response.diagnostics.providerError;
    const failure = encodeWorkflowProviderFailure(response.error, providerError);
    const classification = classifyReviewChunkFailure({
      error: response.error,
      providerError,
      attempt: metadata.attempt,
      maxRetries: CHUNKED_REVIEW_MAX_RETRIES
    });

    if (classification === "retry") {
      const retryAfterMs = providerError?.retryAfterMs ?? deterministicBackoffMs(input.chunk.index, metadata.attempt);
      await writeReviewProgress({
        ...progressBase,
        retryAt: new Date(Date.now() + retryAfterMs).toISOString()
      });
      logEditorialReviewEvent("chunk_retry_scheduled", {
        workflowStepId: metadata.stepId,
        runId: workflowRunId,
        requestId: response.diagnostics.requestId,
        step: stepId,
        provider: input.request.provider,
        model: input.request.modelId,
        chunkIndex: input.chunk.index,
        totalChunks: input.totalChunks,
        attempt: metadata.attempt,
        durationMs: Date.now() - startedAt,
        providerStatus: providerError?.status,
        providerRequestId: providerError?.requestId,
        retryAfterMs
      }, "error");
      throw new RetryableError(failure, { retryAfter: retryAfterMs });
    }

    if (classification === "fatal") {
      logEditorialReviewEvent("chunk_failed", {
        workflowStepId: metadata.stepId,
        runId: workflowRunId,
        requestId: response.diagnostics.requestId,
        step: stepId,
        provider: input.request.provider,
        model: input.request.modelId,
        chunkIndex: input.chunk.index,
        totalChunks: input.totalChunks,
        attempt: metadata.attempt,
        durationMs: Date.now() - startedAt,
        providerStatus: providerError?.status,
        providerRequestId: providerError?.requestId
      }, "error");
      throw new FatalError(failure);
    }

    const failedChunks = [
      ...input.failedChunks,
      {
        index: input.chunk.index,
        coreBlockIds: input.chunk.coreBlockIds,
        message: response.error
      }
    ];
    await writeReviewProgress({
      ...progressBase,
      failedChunks
    });
    logEditorialReviewEvent("chunk_failed", {
      workflowStepId: metadata.stepId,
      runId: workflowRunId,
      requestId: response.diagnostics.requestId,
      step: stepId,
      provider: input.request.provider,
      model: input.request.modelId,
      chunkIndex: input.chunk.index,
      totalChunks: input.totalChunks,
      attempt: metadata.attempt,
      durationMs: Date.now() - startedAt,
      providerStatus: providerError?.status,
      providerRequestId: providerError?.requestId,
      hole: true
    }, "error");
    return response;
  }

  const coreItems = alignReviewItemsToSnapshot(
    filterCoreReviewChunkItems(response.items, input.chunk.coreBlockIds),
    input.request
  );
  if (coreItems.length > 0) {
    await writeReviewPartialItems(coreItems);
  }

  await writeReviewProgress({
    completedChunks: input.completedChunks + 1,
    totalChunks: input.totalChunks,
    completedSourceChars: input.completedSourceChars + input.chunk.sourceChars,
    totalSourceChars: input.totalSourceChars,
    failedChunks: input.failedChunks.length > 0 ? input.failedChunks : undefined,
    attempt: metadata.attempt
  });
  logEditorialReviewEvent("chunk_completed", {
    workflowStepId: metadata.stepId,
    runId: workflowRunId,
    requestId: response.diagnostics.requestId,
    step: stepId,
    provider: input.request.provider,
    model: input.request.modelId,
    chunkIndex: input.chunk.index,
    totalChunks: input.totalChunks,
    attempt: metadata.attempt,
    durationMs: Date.now() - startedAt,
    returnedItems: coreItems.length
  });
  return response;
}

(executeReviewChunkStep as typeof executeReviewChunkStep & { maxRetries?: number }).maxRetries = CHUNKED_REVIEW_MAX_RETRIES;

async function mergeReviewChunksStep(input: {
  request: EditorialReviewRequest;
  chunks: ReviewChunkPlan[];
  responses: EditorialReviewResponse[];
}): Promise<EditorialReviewResponse> {
  "use step";

  if (input.request.stepId === "emphasis") {
    return mergeDurableEmphasisChunkResponses(input.request, input.chunks, input.responses);
  }

  return mergeDurableRecommendationChunkResponses(input.request, input.chunks, input.responses);
}

async function recordWorkflowOutcomeStep(input: {
  runId: string;
  step: string;
  provider: string;
  model: string;
  outcome: "completed" | "failed";
  requestId?: string;
  returnedItems?: number;
}): Promise<void> {
  "use step";

  logEditorialReviewEvent(`workflow_${input.outcome}`, input, input.outcome === "failed" ? "error" : "info");
}

export async function editorialReviewWorkflow(input: EditorialReviewWorkflowInput): Promise<EditorialReviewResponse> {
  "use workflow";

  const workflowRunId = getWorkflowMetadata().workflowRunId;

  try {
    let response: EditorialReviewResponse;
    const stepId = input.request.stepId;

    if (isChunkedRecommendationStep(stepId)) {
      const plannedChunks = planReviewChunks(input.request.document.blocks);
      const scopedRetry = input.request.reviewChunk;
      const chunks = scopedRetry
        ? plannedChunks.filter((chunk) => chunk.index === scopedRetry.index)
        : plannedChunks;

      if (scopedRetry && chunks.length === 0) {
        throw new FatalError(`Fragment retry could not resolve chunk ${scopedRetry.index}`);
      } else if (chunks.length > 0) {
        const responses: EditorialReviewResponse[] = [];
        const failedChunks: EditorialReviewFailedChunk[] = [];
        let completedChunks = 0;
        let completedSourceChars = 0;
        const totalChunks = plannedChunks.length;
        const totalSourceChars = sumChunkSourceChars(plannedChunks, totalChunks);

        for (const chunk of chunks) {
          const chunkResponse = await executeReviewChunkStep({
            request: input.request,
            chunk,
            totalChunks,
            totalSourceChars,
            completedChunks,
            completedSourceChars,
            failedChunks: [...failedChunks]
          });
          responses.push(chunkResponse);

          if (chunkResponse.error) {
            failedChunks.push({
              index: chunk.index,
              coreBlockIds: chunk.coreBlockIds,
              message: chunkResponse.error
            });
          } else {
            completedChunks += 1;
            completedSourceChars += chunk.sourceChars;
          }
        }

        response = await mergeReviewChunksStep({ request: input.request, chunks, responses });
      } else {
        response = await executeEditorialReviewStep(input);
      }
    } else {
      response = await executeEditorialReviewStep(input);
    }

    await recordWorkflowOutcomeStep({
      runId: workflowRunId,
      step: response.stepId,
      provider: input.request.provider,
      model: input.request.modelId,
      outcome: response.error ? "failed" : "completed",
      requestId: response.diagnostics.requestId,
      returnedItems: response.items.length
    });
    return response;
  } catch (error) {
    await recordWorkflowOutcomeStep({
      runId: workflowRunId,
      step: input.request.stepId ?? "diagnostics",
      provider: input.request.provider,
      model: input.request.modelId,
      outcome: "failed"
    });
    throw error;
  }
}

const workflowProviderFailurePrefix = "OREST_PROVIDER_ERROR:";

export function parseEditorialReviewWorkflowFailure(message: string): {
  message: string;
  retryable: boolean;
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
} | null {
  const markerIndex = message.indexOf(workflowProviderFailurePrefix);

  if (markerIndex === -1) {
    return null;
  }

  const encoded = message.slice(markerIndex + workflowProviderFailurePrefix.length).split(/\s/)[0];

  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;

    if (typeof value.message !== "string" || typeof value.retryable !== "boolean") {
      return null;
    }

    return {
      message: value.message,
      retryable: value.retryable,
      status: typeof value.status === "number" ? value.status : undefined,
      requestId: typeof value.requestId === "string" ? value.requestId : undefined,
      retryAfterMs: typeof value.retryAfterMs === "number" ? value.retryAfterMs : undefined
    };
  } catch {
    return null;
  }
}

function encodeWorkflowProviderFailure(
  message: string,
  details: EditorialReviewResponse["diagnostics"]["providerError"]
): string {
  const payload = Buffer.from(JSON.stringify({
    message,
    retryable: details?.retryable ?? false,
    status: details?.status,
    requestId: details?.requestId,
    retryAfterMs: details?.retryAfterMs
  }), "utf8").toString("base64url");

  return `${workflowProviderFailurePrefix}${payload}`;
}

async function writeReviewProgress(progress: EditorialReviewRunProgress): Promise<void> {
  const writer = getWritable<EditorialReviewRunProgress>({ namespace: "review-progress" }).getWriter();

  try {
    await writer.write(progress);
  } finally {
    writer.releaseLock();
  }
}

async function writeReviewPartialItems(items: EditorialReviewItem[]): Promise<void> {
  const writer = getWritable<EditorialReviewItem[]>({ namespace: REVIEW_PARTIAL_ITEMS_NAMESPACE }).getWriter();

  try {
    await writer.write(items);
  } finally {
    writer.releaseLock();
  }
}

function deterministicBackoffMs(chunkIndex: number, attempt: number): number {
  const base = Math.min(30_000, 750 * 2 ** Math.max(0, attempt - 1));
  const jitter = (chunkIndex * 137 + attempt * 97) % 250;
  return base + jitter;
}
