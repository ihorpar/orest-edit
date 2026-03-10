import { createPatchId } from "../editor/patch-contract.ts";
import type {
  ReviewImageGenerationJob,
  ReviewImageGenerationRequest,
  ReviewImageGenerationResponse,
  ReviewImageGenerationJobStatus
} from "../editor/review-contract.ts";
import { generateReviewImage, type GenerateReviewImageOptions } from "./review-image-service.ts";

const reviewImageProvider = "gemini";
const reviewImageModel = "gemini-3.1-flash-image-preview";
const jobTtlMs = 15 * 60 * 1000;
const queuedPollAfterMs = 900;
const processingPollAfterMs = 1500;
const settledPollAfterMs = 0;

interface StoredReviewImageJob {
  id: string;
  status: ReviewImageGenerationJobStatus;
  providerUsed: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  pollAfterMs: number;
  asset?: ReviewImageGenerationResponse["asset"];
  error?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __orestReviewImageJobs: Map<string, StoredReviewImageJob> | undefined;
}

export function createQueuedReviewImageJob(now = new Date()): ReviewImageGenerationJob {
  const store = getReviewImageJobStore();
  pruneExpiredJobs(store, now);

  const job = buildQueuedJob(now);
  store.set(job.id, job);

  return toPublicJob(job);
}

export async function processQueuedReviewImageJob(
  jobId: string,
  request: ReviewImageGenerationRequest,
  options: GenerateReviewImageOptions = {},
  now: Date = new Date()
): Promise<void> {
  const store = getReviewImageJobStore();
  const queued = store.get(jobId);

  if (!queued) {
    return;
  }

  const processing = withJobState(queued, "processing", now);
  store.set(jobId, processing);

  const response = await generateReviewImage(request, options);
  const doneAt = new Date();
  const latest = store.get(jobId);

  if (!latest) {
    return;
  }

  const settled = withJobState(latest, response.asset ? "completed" : "failed", doneAt);
  settled.providerUsed = response.providerUsed;
  settled.modelId = response.modelId;
  settled.asset = response.asset;
  settled.error = response.error;
  store.set(jobId, settled);
}

export function readReviewImageJob(jobId: string, now = new Date()): StoredReviewImageJob | null {
  const store = getReviewImageJobStore();
  pruneExpiredJobs(store, now);

  const job = store.get(jobId);
  return job ?? null;
}

export function buildReviewImageJobResponse(job: StoredReviewImageJob): ReviewImageGenerationResponse {
  return {
    providerUsed: job.providerUsed,
    modelId: job.modelId,
    asset: job.status === "completed" ? job.asset : undefined,
    error: job.status === "failed" ? job.error : undefined,
    job: toPublicJob(job)
  };
}

function getReviewImageJobStore(): Map<string, StoredReviewImageJob> {
  if (!globalThis.__orestReviewImageJobs) {
    globalThis.__orestReviewImageJobs = new Map<string, StoredReviewImageJob>();
  }

  return globalThis.__orestReviewImageJobs;
}

function buildQueuedJob(now: Date): StoredReviewImageJob {
  const timestamp = now.toISOString();
  const expiresAt = new Date(now.getTime() + jobTtlMs).toISOString();

  return {
    id: createPatchId("review-image-job"),
    status: "queued",
    providerUsed: reviewImageProvider,
    modelId: reviewImageModel,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt,
    pollAfterMs: queuedPollAfterMs
  };
}

function withJobState(job: StoredReviewImageJob, status: ReviewImageGenerationJobStatus, now: Date): StoredReviewImageJob {
  const updatedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + jobTtlMs).toISOString();

  return {
    ...job,
    status,
    updatedAt,
    expiresAt,
    pollAfterMs:
      status === "queued"
        ? queuedPollAfterMs
        : status === "processing"
          ? processingPollAfterMs
          : settledPollAfterMs
  };
}

function toPublicJob(job: StoredReviewImageJob): ReviewImageGenerationJob {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    pollAfterMs: job.pollAfterMs
  };
}

function pruneExpiredJobs(store: Map<string, StoredReviewImageJob>, now: Date) {
  const nowMs = now.getTime();

  for (const [id, job] of store.entries()) {
    if (Date.parse(job.expiresAt) <= nowMs) {
      store.delete(id);
    }
  }
}
