import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_COOKIE_NAME, createSessionToken } from "../lib/auth/password-auth.ts";
import { POST } from "../app/api/edit/spellcheck/route.ts";

test("spellcheck route rejects invalid selection range", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "spellcheck-secret";

  try {
    const sessionToken = await createSessionToken("spellcheck-secret", Date.now());
    const response = await POST(
      new Request("http://localhost/api/edit/spellcheck", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`
        },
        body: JSON.stringify({
          documentRevisionId: "rev-1",
          language: "uk-UA",
          provider: "languagetool_public",
          trigger: "manual",
          selection: {
            blockId: "p1",
            text: "текст",
            range: { start: 10, end: 20 }
          }
        })
      })
    );

    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error?: string };
    assert.match(payload.error ?? "", /Некоректний selection\.range/i);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});

test("spellcheck route returns normalized response for authenticated requests", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  const previousFetch = globalThis.fetch;
  process.env.APP_PASSWORD = "spellcheck-secret";

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        matches: [
          {
            message: "Можлива орфографічна помилка.",
            shortMessage: "Орфографія",
            offset: 0,
            length: 8,
            replacements: [{ value: "пацієнта" }],
            rule: {
              id: "UK_SPELLING",
              issueType: "misspelling",
              category: { id: "TYPOS", name: "Possible Typo" }
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  try {
    const sessionToken = await createSessionToken("spellcheck-secret", Date.now());
    const response = await POST(
      new Request("http://localhost/api/edit/spellcheck", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`
        },
        body: JSON.stringify({
          documentRevisionId: "rev-1",
          language: "uk-UA",
          provider: "languagetool_public",
          trigger: "manual",
          selection: {
            blockId: "p1",
            text: "У паціента можуть виникати супутні симптоми.",
            range: { start: 2, end: 10 }
          }
        })
      })
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      providerUsed: string;
      issues: Array<{ badText: string; suggestions: Array<{ value: string }> }>;
    };
    assert.equal(payload.providerUsed, "languagetool_public");
    assert.equal(payload.issues.length, 1);
    assert.equal(payload.issues[0]?.badText, "паціента");
    assert.equal(payload.issues[0]?.suggestions[0]?.value, "пацієнта");
  } finally {
    globalThis.fetch = previousFetch;

    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});
