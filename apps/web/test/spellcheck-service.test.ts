import assert from "node:assert/strict";
import test from "node:test";
import type { SpellcheckRequest } from "../lib/editor/spellcheck-contract.ts";
import { generateSpellcheckResponse } from "../lib/server/spellcheck-service.ts";

function createRequest(overrides: Partial<SpellcheckRequest> = {}): SpellcheckRequest {
  return {
    documentRevisionId: "rev-1",
    language: "uk-UA",
    provider: "languagetool_public",
    trigger: "manual",
    selection: {
      blockId: "p1",
      text: "У паціента можуть виникати супутні симптоми.",
      range: {
        start: 2,
        end: 10
      }
    },
    ...overrides
  };
}

test("generateSpellcheckResponse rebases LanguageTool matches into block-local offsets", async () => {
  let requestBody = "";

  const response = await generateSpellcheckResponse(createRequest(), {
    fetchImpl: async (_input, init) => {
      requestBody = typeof init?.body === "string" ? init.body : "";

      return new Response(
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
      );
    },
    now: () => "2026-03-19T16:00:00.000Z"
  });

  assert.match(requestBody, /language=uk-UA/);
  assert.match(requestBody, /text=%D0%BF%D0%B0%D1%86%D1%96%D0%B5%D0%BD%D1%82%D0%B0/);
  assert.equal(response.error, undefined);
  assert.equal(response.issues.length, 1);
  assert.equal(response.issues[0]?.range.start, 2);
  assert.equal(response.issues[0]?.range.end, 10);
  assert.equal(response.issues[0]?.badText, "паціента");
  assert.equal(response.issues[0]?.suggestions[0]?.value, "пацієнта");
  assert.equal(response.issues[0]?.severity, "error");
});

test("generateSpellcheckResponse rejects oversized public API fragments before fetch", async () => {
  let fetchCalled = false;
  const longText = "а".repeat(20_001);

  const response = await generateSpellcheckResponse(
    createRequest({
      selection: {
        blockId: "p1",
        text: longText,
        range: { start: 0, end: longText.length }
      }
    }),
    {
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error("should not reach fetch");
      },
      now: () => "2026-03-19T16:00:00.000Z"
    }
  );

  assert.equal(fetchCalled, false);
  assert.equal(response.issues.length, 0);
  assert.match(response.error ?? "", /20 000 символів/i);
});

test("generateSpellcheckResponse returns localized error on upstream failure", async () => {
  const response = await generateSpellcheckResponse(createRequest(), {
    fetchImpl: async () => new Response("upstream unavailable", { status: 503 }),
    now: () => "2026-03-19T16:00:00.000Z"
  });

  assert.equal(response.issues.length, 0);
  assert.match(response.error ?? "", /не вдалося перевірити правопис/i);
  assert.match(response.diagnostics.rawError ?? "", /upstream unavailable/i);
});

test("generateSpellcheckResponse resolves self-hosted endpoint from LANGUAGETOOL_BASE_URL", async () => {
  let requestedUrl = "";

  await generateSpellcheckResponse(createRequest({ provider: "languagetool_self_hosted" }), {
    fetchImpl: async (input) => {
      requestedUrl = String(input);

      return new Response(JSON.stringify({ matches: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    readEnvValue: (key) => (key === "LANGUAGETOOL_BASE_URL" ? "http://127.0.0.1:8081" : null),
    now: () => "2026-03-19T16:00:00.000Z"
  });

  assert.equal(requestedUrl, "http://127.0.0.1:8081/v2/check");
});

test("generateSpellcheckResponse classifies whitespace and punctuation rules more accurately", async () => {
  const response = await generateSpellcheckResponse(createRequest(), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          matches: [
            {
              message: "Ймовірна помилка: повтор пробілу",
              offset: 0,
              length: 2,
              replacements: [],
              rule: {
                id: "WHITESPACE_RULE",
                issueType: "duplication",
                category: { id: "TYPOS", name: "Possible Typo" }
              }
            },
            {
              message: "Перед повторюваним сполучником чи ставимо кому",
              offset: 3,
              length: 2,
              replacements: [{ value: ", чи" }],
              rule: {
                id: "chy_chy",
                issueType: "grammar",
                category: { id: "GRAMMAR", name: "Grammar" }
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    now: () => "2026-03-19T16:00:00.000Z"
  });

  assert.equal(response.issues[0]?.category, "typography");
  assert.equal(response.issues[0]?.severity, "warning");
  assert.equal(response.issues[1]?.category, "grammar");
  assert.equal(response.issues[1]?.severity, "error");
});
