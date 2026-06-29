import test from "node:test";
import assert from "node:assert/strict";

import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorialReviewRequest } from "../lib/editor/review-contract.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";
import { generateEditorialReview } from "../lib/server/review-service.ts";
import {
  buildCalloutProviderPrompt,
  buildFactCheckActionInstruction,
  buildReplaceSystemPrompt,
  getReviewActionErrors
} from "../lib/i18n/server-prompts/review-action.ts";
import {
  buildChunkedEmphasisFailureMessage,
  getOpenAiFactCheckStatusEnum,
  getReviewServiceErrors
} from "../lib/i18n/server-prompts/review.ts";
import type { ReviewActionRequest } from "../lib/editor/review-contract.ts";
import { computeAnchorFingerprint } from "../lib/editor/manuscript-structure.ts";

import { getDefaultEditorSettings } from "../lib/editor/settings.ts";

const CYRILLIC_PATTERN = /[\u0400-\u04FF]/;

function createReviewRequest(overrides: Partial<EditorialReviewRequest> = {}): EditorialReviewRequest {
  const locale = overrides.locale ?? "uk";
  const defaults = getDefaultEditorSettings(locale);
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 2, content: [{ text: "Section" }] },
      {
        id: "p1",
        type: "paragraph",
        content: [
          {
            text: "This is a long paragraph deliberately made substantial enough for review prompts to include meaningful editorial guidance. ".repeat(
              4
            )
          }
        ]
      }
    ]
  };

  return {
    document,
    revision: deriveManuscriptRevisionState(document),
    provider: "openai",
    modelId: "gpt-5.4",
    changeLevel: 3,
    basePrompt: defaults.basePrompt,
    reviewPrompt: defaults.reviewPrompt,
    cardsPrompt: defaults.cardsPrompt,
    expertisePrompt: defaults.expertisePrompt,
    ...overrides
  };
}

function createReplaceRequest(locale: "uk" | "en" = "uk"): ReviewActionRequest {
  const defaults = getDefaultEditorSettings(locale);
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p1", type: "paragraph", content: [{ text: "Dense paragraph text." }] }]
  };
  const revision = deriveManuscriptRevisionState(document);

  return {
    document,
    currentRevision: revision,
    provider: "openai",
    modelId: "gpt-5.4",
    locale,
    basePrompt: defaults.basePrompt,
    item: {
      id: "review-rewrite-1",
      reviewSessionId: "review-session-1",
      documentRevisionId: revision.documentRevisionId,
      changeLevel: 3,
      title: "Rewrite",
      reason: "Make this clearer.",
      recommendation: "Simplify the wording locally.",
      recommendationType: "rewrite",
      suggestedAction: "rewrite_text",
      priority: "medium",
      anchor: {
        blockIds: ["p1"],
        generationBlockRange: { start: 0, end: 0 },
        excerpt: "Dense paragraph",
        fingerprint: computeAnchorFingerprint(document, ["p1"])
      },
      insertionPoint: {
        mode: "before",
        anchorBlockId: "p1"
      },
      status: "pending"
    }
  };
}

test("English review system prompt excludes Cyrillic scaffolding", async () => {
  let requestBody = "";

  await generateEditorialReview(
    createReviewRequest({
      locale: "en",
      stepId: "clarity",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ items: [] })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  const parsed = JSON.parse(requestBody) as { instructions?: string };
  assert.ok(parsed.instructions, "expected OpenAI instructions in request body");
  assert.doesNotMatch(parsed.instructions ?? "", CYRILLIC_PATTERN);
  assert.match(parsed.instructions ?? "", /Workflow step:/i);
  assert.match(parsed.instructions ?? "", /English manuscript|Work mode:/i);
});

test("English review-action replace system prompt mentions English manuscript", () => {
  const prompt = buildReplaceSystemPrompt("en", createReplaceRequest("en"));

  assert.match(prompt, /English manuscript/i);
  assert.doesNotMatch(prompt, CYRILLIC_PATTERN);
});

test("Ukrainian review prompts keep Ukrainian scaffolding", async () => {
  let requestBody = "";

  await generateEditorialReview(
    createReviewRequest({
      locale: "uk",
      stepId: "clarity",
      apiKey: "test-key"
    }),
    {
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({ items: [] })
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      now: () => "2026-03-10T12:00:00.000Z"
    }
  );

  const parsed = JSON.parse(requestBody) as { instructions?: string };
  assert.match(parsed.instructions ?? "", /Крок workflow:/i);
  assert.match(parsed.instructions ?? "", CYRILLIC_PATTERN);

  const ukReplacePrompt = buildReplaceSystemPrompt("uk", createReplaceRequest("uk"));
  assert.match(ukReplacePrompt, /українського рукопису/i);
});

test("getOpenAiFactCheckStatusEnum returns locale-specific status values", () => {
  assert.deepEqual(getOpenAiFactCheckStatusEnum("uk"), ["сумнівно", "не підтверджено"]);
  assert.deepEqual(getOpenAiFactCheckStatusEnum("en"), ["questionable", "unsupported"]);
});

test("English callout provider prompt excludes Cyrillic scaffolding", () => {
  const prompt = buildCalloutProviderPrompt("en", {
    excerpt: "A dense explanatory fragment about insulin resistance.",
    calloutKind: "mechanism",
    calloutDepth: "brief",
    recommendation: "Explain the mechanism in simpler terms."
  });

  assert.doesNotMatch(prompt, CYRILLIC_PATTERN);
  assert.match(prompt, /Callout type:/i);
  assert.match(prompt, /JSON schema/i);
});

test("buildFactCheckActionInstruction en returns English guidance", () => {
  const instruction = buildFactCheckActionInstruction("en", {
    id: "review-1",
    reviewSessionId: "session-1",
    documentRevisionId: "rev-1",
    changeLevel: 3,
    stepId: "fact_check",
    title: "Clarify claim",
    reason: "The claim is too categorical.",
    recommendation: "Soften the wording locally.",
    recommendationType: "rewrite",
    suggestedAction: "rewrite_text",
    priority: "high",
    anchor: {
      blockIds: ["p1"],
      generationBlockRange: { start: 0, end: 0 },
      excerpt: "Sample excerpt",
      fingerprint: "fp-1"
    },
    insertionPoint: { mode: "replace", anchorBlockId: "p1" },
    status: "pending"
  });

  assert.ok(instruction);
  assert.doesNotMatch(instruction ?? "", CYRILLIC_PATTERN);
  assert.match(instruction ?? "", /fact-checking/i);
});

test("getReviewServiceErrors and getReviewActionErrors expose localized provider messages", () => {
  const ukReviewErrors = getReviewServiceErrors("uk");
  const enReviewErrors = getReviewServiceErrors("en");
  const ukActionErrors = getReviewActionErrors("uk");
  const enActionErrors = getReviewActionErrors("en");

  assert.match(ukReviewErrors.providerUnavailable("OpenAI"), /недоступний/i);
  assert.match(enReviewErrors.providerUnavailable("OpenAI"), /unavailable/i);
  assert.match(ukActionErrors.providerUnavailable("Gemini"), /недоступний/i);
  assert.match(enActionErrors.providerUnavailable("Gemini"), /unavailable/i);

  const emphasisFailure = buildChunkedEmphasisFailureMessage("en", {
    error: new Error("timeout"),
    chunkIndex: 0,
    totalChunks: 3,
    attemptCount: 3
  });
  assert.match(emphasisFailure, /Emphasis:/i);
  assert.doesNotMatch(emphasisFailure, CYRILLIC_PATTERN);
});
