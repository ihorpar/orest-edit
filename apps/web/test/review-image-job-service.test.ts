import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReviewImageJobResponse,
  createQueuedReviewImageJob,
  processQueuedReviewImageJob,
  readReviewImageJob
} from "../lib/server/review-image-job-service.ts";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("review-image job transitions from queued to completed and returns final asset", async () => {
  const job = createQueuedReviewImageJob();
  const queued = readReviewImageJob(job.id);

  assert.ok(queued);
  assert.equal(queued.status, "queued");

  await processQueuedReviewImageJob(job.id, { prompt: "Зроби ілюстрацію HDL/LDL." }, {
    fetchImpl: async () =>
      createJsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: "ZmFrZS1hc3NldA=="
                  }
                }
              ]
            }
          }
        ]
      })
  });

  const completed = readReviewImageJob(job.id);
  assert.ok(completed);
  assert.equal(completed.status, "completed");
  assert.ok(completed.asset);

  const payload = buildReviewImageJobResponse(completed);
  assert.equal(payload.job?.status, "completed");
  assert.ok(payload.asset);
});

test("review-image job marks failure when provider generation fails", async () => {
  const job = createQueuedReviewImageJob();

  await processQueuedReviewImageJob(job.id, { prompt: "Зроби схему." }, {
    fetchImpl: async () =>
      createJsonResponse(
        {
          error: { message: "Provider unavailable" }
        },
        503
      )
  });

  const failed = readReviewImageJob(job.id);
  assert.ok(failed);
  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /Provider unavailable/i);
});

test("review-image job store prunes expired jobs on read", () => {
  const createdAt = new Date("2026-04-15T10:00:00.000Z");
  const job = createQueuedReviewImageJob(undefined, createdAt);

  const beforeExpiry = readReviewImageJob(job.id, new Date("2026-04-15T10:14:59.000Z"));
  assert.ok(beforeExpiry);

  const afterExpiry = readReviewImageJob(job.id, new Date("2026-04-15T10:15:00.000Z"));
  assert.equal(afterExpiry, null);
});
