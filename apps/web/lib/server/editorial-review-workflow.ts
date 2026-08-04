import { FatalError, RetryableError, getStepMetadata, getWorkflowMetadata, getWritable } from "workflow";
import type {
  EditorialReviewRequest,
  EditorialReviewResponse,
  EditorialReviewRunProgress
} from "../editor/review-contract.ts";
import { deriveManuscriptRevisionState } from "../editor/manuscript-structure.ts";
import { planEmphasisChunks, type EmphasisChunkPlan } from "./emphasis-chunk-planner.ts";
import { generateEditorialReview, mergeDurableEmphasisChunkResponses } from "./review-service.ts";
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

async function executeEmphasisChunkStep(input: {
  request: EditorialReviewRequest;
  chunk: EmphasisChunkPlan;
  totalChunks: number;
}): Promise<EditorialReviewResponse> {
  "use step";

  const metadata = getStepMetadata();
  const workflowRunId = getWorkflowMetadata().workflowRunId;
  const startedAt = Date.now();
  const progressBase = {
    completedChunks: input.chunk.index,
    totalChunks: input.totalChunks,
    attempt: metadata.attempt
  };
  await writeReviewProgress(progressBase);
  logEditorialReviewEvent("chunk_started", {
    workflowStepId: metadata.stepId,
    runId: workflowRunId,
    step: "emphasis",
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
  const response = await generateEditorialReview({
    ...input.request,
    document: chunkDocument,
    revision: deriveManuscriptRevisionState(chunkDocument),
    emphasisChunk: {
      index: input.chunk.index,
      total: input.totalChunks,
      coreBlockIds: input.chunk.coreBlockIds,
      contextBlockIds: input.chunk.contextBlockIds
    },
    providerRequestKey: metadata.stepId
  });

  if (response.error) {
    const providerError = response.diagnostics.providerError;
    const failure = encodeWorkflowProviderFailure(response.error, providerError);

    if (providerError?.retryable) {
      const retryAfterMs = providerError.retryAfterMs ?? deterministicBackoffMs(input.chunk.index, metadata.attempt);
      await writeReviewProgress({
        ...progressBase,
        retryAt: new Date(Date.now() + retryAfterMs).toISOString()
      });
      logEditorialReviewEvent("chunk_retry_scheduled", {
        workflowStepId: metadata.stepId,
        runId: workflowRunId,
        requestId: response.diagnostics.requestId,
        step: "emphasis",
        provider: input.request.provider,
        model: input.request.modelId,
        chunkIndex: input.chunk.index,
        totalChunks: input.totalChunks,
        attempt: metadata.attempt,
        durationMs: Date.now() - startedAt,
        providerStatus: providerError.status,
        providerRequestId: providerError.requestId,
        retryAfterMs
      }, "error");
      throw new RetryableError(failure, { retryAfter: retryAfterMs });
    }

    logEditorialReviewEvent("chunk_failed", {
      workflowStepId: metadata.stepId,
      runId: workflowRunId,
      requestId: response.diagnostics.requestId,
      step: "emphasis",
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

  await writeReviewProgress({
    completedChunks: input.chunk.index + 1,
    totalChunks: input.totalChunks,
    attempt: metadata.attempt
  });
  logEditorialReviewEvent("chunk_completed", {
    workflowStepId: metadata.stepId,
    runId: workflowRunId,
    requestId: response.diagnostics.requestId,
    step: "emphasis",
    provider: input.request.provider,
    model: input.request.modelId,
    chunkIndex: input.chunk.index,
    totalChunks: input.totalChunks,
    attempt: metadata.attempt,
    durationMs: Date.now() - startedAt,
    returnedItems: response.items.length
  });
  return response;
}

(executeEmphasisChunkStep as typeof executeEmphasisChunkStep & { maxRetries?: number }).maxRetries = 2;

async function mergeEmphasisChunksStep(input: {
  request: EditorialReviewRequest;
  chunks: EmphasisChunkPlan[];
  responses: EditorialReviewResponse[];
}): Promise<EditorialReviewResponse> {
  "use step";

  return mergeDurableEmphasisChunkResponses(input.request, input.chunks, input.responses);
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

    if (input.request.stepId === "emphasis") {
      const chunks = planEmphasisChunks(input.request.document.blocks);

      if (chunks.length > 0) {
        const responses: EditorialReviewResponse[] = [];

        for (const chunk of chunks) {
          responses.push(await executeEmphasisChunkStep({
            request: input.request,
            chunk,
            totalChunks: chunks.length
          }));
        }

        response = await mergeEmphasisChunksStep({ request: input.request, chunks, responses });
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

function deterministicBackoffMs(chunkIndex: number, attempt: number): number {
  const base = Math.min(30_000, 750 * 2 ** Math.max(0, attempt - 1));
  const jitter = (chunkIndex * 137 + attempt * 97) % 250;
  return base + jitter;
}
