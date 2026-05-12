import { createPatchId } from "../editor/patch-contract.ts";
import type {
  EditorialReviewJob,
  EditorialReviewJobResponse,
  EditorialReviewJobStatus,
  EditorialReviewRequest,
  EditorialReviewResponse
} from "../editor/review-contract.ts";
import { generateEditorialReview, type GenerateEditorialReviewOptions } from "./review-service.ts";

const jobTtlMs = 30 * 60 * 1000;
const queuedPollAfterMs = 900;
const processingPollAfterMs = 2000;
const settledPollAfterMs = 0;

interface StoredEditorialReviewJob {
  id: string;
  status: EditorialReviewJobStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  pollAfterMs: number;
  response?: EditorialReviewResponse;
  error?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __orestEditorialReviewJobs: Map<string, StoredEditorialReviewJob> | undefined;
}

export function createQueuedEditorialReviewJob(now = new Date()): EditorialReviewJob {
  const store = getEditorialReviewJobStore();
  pruneExpiredJobs(store, now);

  const job = buildQueuedJob(now);
  store.set(job.id, job);

  return toPublicJob(job);
}

export async function processQueuedEditorialReviewJob(
  jobId: string,
  request: EditorialReviewRequest,
  options: GenerateEditorialReviewOptions = {},
  now: Date = new Date()
): Promise<void> {
  const store = getEditorialReviewJobStore();
  const queued = store.get(jobId);

  if (!queued) {
    return;
  }

  store.set(jobId, withJobState(queued, "processing", now));

  try {
    const response = await generateEditorialReview(request, options);
    const doneAt = new Date();
    const latest = store.get(jobId);

    if (!latest) {
      return;
    }

    const settled = withJobState(latest, "completed", doneAt);
    settled.response = {
      ...response,
      job: toPublicJob(settled)
    };
    settled.error = response.error;
    store.set(jobId, settled);
  } catch (error) {
    const failedAt = new Date();
    const latest = store.get(jobId);

    if (!latest) {
      return;
    }

    const failed = withJobState(latest, "failed", failedAt);
    failed.error = error instanceof Error ? error.message : "Не вдалося завершити review job.";
    store.set(jobId, failed);
  }
}

export function readEditorialReviewJob(jobId: string, now = new Date()): StoredEditorialReviewJob | null {
  const store = getEditorialReviewJobStore();
  pruneExpiredJobs(store, now);

  return store.get(jobId) ?? null;
}

export function buildEditorialReviewJobResponse(job: StoredEditorialReviewJob): EditorialReviewResponse | EditorialReviewJobResponse {
  if (job.status === "completed" && job.response) {
    return {
      ...job.response,
      job: toPublicJob(job)
    };
  }

  return {
    job: toPublicJob(job),
    error: job.status === "failed" ? job.error : undefined
  };
}

function getEditorialReviewJobStore(): Map<string, StoredEditorialReviewJob> {
  if (!globalThis.__orestEditorialReviewJobs) {
    globalThis.__orestEditorialReviewJobs = new Map<string, StoredEditorialReviewJob>();
  }

  return globalThis.__orestEditorialReviewJobs;
}

function buildQueuedJob(now: Date): StoredEditorialReviewJob {
  const timestamp = now.toISOString();
  const expiresAt = new Date(now.getTime() + jobTtlMs).toISOString();

  return {
    id: createPatchId("review-job"),
    status: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt,
    pollAfterMs: queuedPollAfterMs
  };
}

function withJobState(job: StoredEditorialReviewJob, status: EditorialReviewJobStatus, now: Date): StoredEditorialReviewJob {
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

function toPublicJob(job: StoredEditorialReviewJob): EditorialReviewJob {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    pollAfterMs: job.pollAfterMs
  };
}

function pruneExpiredJobs(store: Map<string, StoredEditorialReviewJob>, now: Date) {
  const nowMs = now.getTime();

  for (const [id, job] of store.entries()) {
    if (Date.parse(job.expiresAt) <= nowMs) {
      store.delete(id);
    }
  }
}
