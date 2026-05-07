import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_COOKIE_NAME, createSessionToken } from "../lib/auth/password-auth.ts";
import { POST } from "../app/api/edit/review/route.ts";

test("review route returns provider error status while preserving requested step id", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "review-secret";

  try {
    const sessionToken = await createSessionToken("review-secret", Date.now());
    const response = await POST(
      new Request("http://localhost/api/edit/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`
        },
        body: JSON.stringify({
          document: {
            version: 2,
            blocks: [
              {
                id: "p1",
                type: "paragraph",
                content: [{ text: "Шкіра часто першою сигналізує про внутрішній стрес, тому тезу варто швидко побачити." }]
              }
            ]
          },
          revision: {
            documentRevisionId: "rev-1",
            blockOrder: ["p1"],
            blockFingerprints: { p1: "fp-1" }
          },
          provider: "gemini",
          modelId: "gemini-3-flash-preview",
          changeLevel: 3,
          additionalInstructions: "",
          runMode: "replace",
          stepId: "emphasis"
        })
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
