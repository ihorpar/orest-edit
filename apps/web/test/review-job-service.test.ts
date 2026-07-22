import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorialReviewRequest } from "../lib/editor/review-contract.ts";
import {
  buildEditorialReviewJobResponse,
  createQueuedEditorialReviewJob,
  processQueuedEditorialReviewJob,
  readEditorialReviewJob
} from "../lib/server/review-job-service.ts";

function createRequest(overrides: Partial<EditorialReviewRequest> = {}): EditorialReviewRequest {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [{ text: "Один медичний симптом не дає остаточного висновку без контексту." }]
      }
    ]
  };

  return {
    document,
    revision: deriveManuscriptRevisionState(document),
    provider: "openai",
    modelId: "gpt-5.6-luna",
    changeLevel: 3,
    stepId: "clarity",
    ...overrides
  };
}

test("editorial review job transitions from queued to completed and returns final response", async () => {
  const job = createQueuedEditorialReviewJob();
  const queued = readEditorialReviewJob(job.id);

  assert.ok(queued);
  assert.equal(queued.status, "queued");

  await processQueuedEditorialReviewJob(job.id, createRequest(), {
    readEnvValue: () => null,
    now: () => "2026-05-12T12:00:00.000Z"
  });

  const completed = readEditorialReviewJob(job.id);
  assert.ok(completed);
  assert.equal(completed.status, "completed");

  const payload = buildEditorialReviewJobResponse(completed);
  assert.ok(payload.job);
  assert.equal(payload.job.status, "completed");
  assert.equal("reviewSessionId" in payload, true);
  assert.match(payload.error ?? "", /Немає API key/i);
});

test("editorial review job marks failure when generation throws before response creation", async () => {
  const job = createQueuedEditorialReviewJob();

  await processQueuedEditorialReviewJob(job.id, createRequest(), {
    readEnvValue: () => {
      throw new Error("env unavailable");
    }
  });

  const failed = readEditorialReviewJob(job.id);
  assert.ok(failed);
  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /env unavailable/i);
});

test("editorial review job store prunes expired jobs on read", () => {
  const createdAt = new Date("2026-05-12T10:00:00.000Z");
  const job = createQueuedEditorialReviewJob(undefined, createdAt);

  const beforeExpiry = readEditorialReviewJob(job.id, new Date("2026-05-12T10:29:59.000Z"));
  assert.ok(beforeExpiry);

  const afterExpiry = readEditorialReviewJob(job.id, new Date("2026-05-12T10:30:00.000Z"));
  assert.equal(afterExpiry, null);
});
