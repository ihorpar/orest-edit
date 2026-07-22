import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_COOKIE_NAME, createSessionToken } from "../lib/auth/password-auth.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorialReviewRequest } from "../lib/editor/review-contract.ts";
import { createQueuedEditorialReviewJob, processQueuedEditorialReviewJob } from "../lib/server/review-job-service.ts";
import { GET, POST } from "../app/api/edit/review/route.ts";

function createRequestBody(overrides: Partial<EditorialReviewRequest> = {}): EditorialReviewRequest {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [{ text: "Шкіра часто першою сигналізує про внутрішній стрес, тому тезу варто швидко побачити." }]
      }
    ]
  };

  return {
    document,
    revision: deriveManuscriptRevisionState(document),
    provider: "gemini",
    modelId: "gemini-3.6-flash",
    changeLevel: 3,
    additionalInstructions: "",
    runMode: "replace",
    stepId: "emphasis",
    ...overrides
  };
}

async function createAuthCookie() {
  const sessionToken = await createSessionToken("review-secret", Date.now());
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`;
}

test("review route returns provider error status while preserving requested step id", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "review-secret";

  try {
    const response = await POST(
      new Request("http://localhost/api/edit/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await createAuthCookie()
        },
        body: JSON.stringify(createRequestBody({ async: false }))
      })
    );

    assert.ok(response.status === 200 || response.status === 502);
    const payload = (await response.json()) as { stepId: string; diagnostics?: { stepId?: string }; error?: string };
    assert.equal(payload.stepId, "emphasis");
    assert.equal(payload.diagnostics?.stepId, "emphasis");
    if (response.status === 502) {
      assert.match(payload.error ?? "", /API key/i);
    }
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});

test("review route starts an async job by default", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "review-secret";

  try {
    const response = await POST(
      new Request("http://localhost/api/edit/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: await createAuthCookie()
        },
        body: JSON.stringify(createRequestBody())
      })
    );

    assert.equal(response.status, 202);
    const payload = (await response.json()) as { job?: { id?: string; status?: string } };
    assert.ok(payload.job?.id);
    assert.equal(payload.job.status, "queued");
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});

test("review route GET validates and returns job state", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "review-secret";

  try {
    const missingIdResponse = await GET(
      new Request("http://localhost/api/edit/review", {
        headers: { cookie: await createAuthCookie() }
      })
    );
    assert.equal(missingIdResponse.status, 400);

    const missingJobResponse = await GET(
      new Request("http://localhost/api/edit/review?jobId=missing-job&locale=en", {
        headers: { cookie: await createAuthCookie() }
      })
    );
    assert.equal(missingJobResponse.status, 404);
    const missingJobPayload = (await missingJobResponse.json()) as { error?: string };
    assert.match(missingJobPayload.error ?? "", /not found or expired/i);

    const job = createQueuedEditorialReviewJob();
    await processQueuedEditorialReviewJob(job.id, createRequestBody({ provider: "openai", modelId: "gpt-5.6-luna", stepId: "clarity" }), {
      readEnvValue: () => null,
      now: () => "2026-05-12T12:00:00.000Z"
    });

    const completedJobResponse = await GET(
      new Request(`http://localhost/api/edit/review?jobId=${encodeURIComponent(job.id)}`, {
        headers: { cookie: await createAuthCookie() }
      })
    );
    assert.equal(completedJobResponse.status, 502);
    const completedPayload = (await completedJobResponse.json()) as { job?: { status?: string }; stepId?: string; error?: string };
    assert.equal(completedPayload.job?.status, "completed");
    assert.equal(completedPayload.stepId, "clarity");
    assert.match(completedPayload.error ?? "", /Немає API key/i);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});
