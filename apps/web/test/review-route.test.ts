import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_COOKIE_NAME, createSessionToken } from "../lib/auth/password-auth.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorialReviewRequest } from "../lib/editor/review-contract.ts";
import { DELETE, GET, POST } from "../app/api/edit/review/route.ts";

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
    modelId: "gemini-3.7-flash",
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
    const payload = (await response.json()) as {
      kind: string;
      run?: { stepId?: string };
      error?: { message?: string };
      result?: { stepId?: string; diagnostics?: { stepId?: string } };
    };
    assert.equal(payload.run?.stepId, "emphasis");
    if (response.status === 502) {
      assert.equal(payload.kind, "error");
      assert.ok(payload.error?.message);
    } else {
      assert.equal(payload.kind, "result");
      assert.equal(payload.result?.stepId, "emphasis");
      assert.equal(payload.result?.diagnostics?.stepId, "emphasis");
    }
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});

test("review route returns a discriminated invalid-request error", async () => {
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
        body: "not-json"
      })
    );

    assert.equal(response.status, 400);
    const payload = (await response.json()) as { kind?: string; error?: { code?: string; message?: string } };
    assert.equal(payload.kind, "error");
    assert.equal(payload.error?.code, "invalid_request");
    assert.ok(payload.error?.message);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});

test("review route GET requires a run capability", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "review-secret";

  try {
    const missingIdResponse = await GET(
      new Request("http://localhost/api/edit/review", {
        headers: { cookie: await createAuthCookie() }
      })
    );
    assert.equal(missingIdResponse.status, 400);
    const missingIdPayload = (await missingIdResponse.json()) as { kind?: string; error?: { code?: string } };
    assert.equal(missingIdPayload.kind, "error");
    assert.equal(missingIdPayload.error?.code, "invalid_request");

    const deniedResponse = await GET(
      new Request("http://localhost/api/edit/review?runId=missing-run&locale=en", {
        headers: {
          cookie: await createAuthCookie(),
          "x-review-run-capability": "invalid"
        }
      })
    );
    assert.equal(deniedResponse.status, 403);
    const deniedPayload = (await deniedResponse.json()) as { kind?: string; error?: { code?: string; message?: string } };
    assert.equal(deniedPayload.kind, "error");
    assert.equal(deniedPayload.error?.code, "run_access_denied");
    assert.match(deniedPayload.error?.message ?? "", /cannot be opened/i);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});

test("review route GET returns authentication failures in the discriminated run contract", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "review-secret";

  try {
    const response = await GET(new Request("http://localhost/api/edit/review?runId=wrun_test"));
    assert.equal(response.status, 401);
    const payload = (await response.json()) as {
      kind?: string;
      error?: { code?: string; message?: string; retryable?: boolean };
    };
    assert.equal(payload.kind, "error");
    assert.equal(payload.error?.code, "authentication_required");
    assert.equal(payload.error?.retryable, false);
    assert.ok(payload.error?.message);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});

test("review route DELETE requires a run capability", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "review-secret";

  try {
    const missingIdResponse = await DELETE(
      new Request("http://localhost/api/edit/review", {
        method: "DELETE",
        headers: { cookie: await createAuthCookie() }
      })
    );
    assert.equal(missingIdResponse.status, 400);
    const missingIdPayload = (await missingIdResponse.json()) as { kind?: string; error?: { code?: string } };
    assert.equal(missingIdPayload.kind, "error");
    assert.equal(missingIdPayload.error?.code, "invalid_request");

    const deniedResponse = await DELETE(
      new Request("http://localhost/api/edit/review?runId=missing-run&locale=en", {
        method: "DELETE",
        headers: {
          cookie: await createAuthCookie(),
          "x-review-run-capability": "invalid"
        }
      })
    );
    assert.equal(deniedResponse.status, 403);
    const deniedPayload = (await deniedResponse.json()) as { kind?: string; error?: { code?: string; message?: string } };
    assert.equal(deniedPayload.kind, "error");
    assert.equal(deniedPayload.error?.code, "run_access_denied");
    assert.match(deniedPayload.error?.message ?? "", /cannot be opened/i);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});
