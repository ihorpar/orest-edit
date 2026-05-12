import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_COOKIE_NAME, createSessionToken } from "../lib/auth/password-auth.ts";
import {
  buildPatchPromptForTextIntent,
  getLocalActionCalloutDescription,
  getLocalActionCalloutDepthDescription,
  getLocalActionTextIntentOptions,
  getLocalActionVisualDescription,
  inferSuggestedLocalActionMode,
  inferLocalActionRoute
} from "../lib/editor/local-action-router.ts";
import { POST } from "../app/api/edit/local-action/route.ts";

test("local action router sends obvious spelling prompts to spellcheck", () => {
  const plan = inferLocalActionRoute({
    prompt: "Перевір правопис і орфографію",
    preferredTextIntent: "rewrite"
  });

  assert.equal(plan.executor, "spellcheck");
});

test("local action router lets explicit feature keywords override text intent", () => {
  const plan = inferLocalActionRoute({
    prompt: "Підготуй візуал до цього фрагмента",
    preferredTextIntent: "list",
    visualIntent: "illustration",
    visualStylePreset: "modern_glass"
  });

  assert.equal(plan.executor, "visual");
  assert.equal(plan.visualIntent, "illustration");
  assert.equal(plan.visualStylePreset, "modern_glass");
});

test("local action router preserves explicit callout depth", () => {
  const plan = inferLocalActionRoute({
    prompt: "Підготуй докладну врізку до цього фрагмента",
    explicitMode: "callout",
    calloutKind: "mechanism",
    calloutDepth: "deep"
  });

  assert.equal(plan.executor, "callout");
  assert.equal(plan.calloutKind, "mechanism");
  assert.equal(plan.calloutDepth, "deep");
});

test("explicit edit mode keeps feature keywords as a suggestion instead of forcing the mode", () => {
  const plan = inferLocalActionRoute({
    prompt: "Перевір правопис",
    explicitMode: "edit",
    preferredTextIntent: "rewrite"
  });

  assert.equal(plan.executor, "patch");
  assert.equal(plan.textIntent, "rewrite");
  assert.equal(inferSuggestedLocalActionMode("Перевір правопис"), "spellcheck");
});

test("local action router builds normalized patch prompts for structured text intents", () => {
  const shortenPrompt = buildPatchPromptForTextIntent("shorten", "");

  assert.ok(shortenPrompt);
  assert.match(shortenPrompt, /Скороти виділений фрагмент/i);
  assert.match(buildPatchPromptForTextIntent("subsection", "лиш короткі заголовки") ?? "", /один короткий H3-підзаголовок/i);
  assert.equal(buildPatchPromptForTextIntent("rewrite", ""), null);
});

test("local action router maps subheaders to review-backed subsection proposals", () => {
  const plan = inferLocalActionRoute({
    prompt: "Запропонуй підзаголовки для цих абзаців",
    preferredTextIntent: "subsection"
  });

  assert.equal(plan.executor, "review");
  assert.equal(plan.recommendationType, "subsection");
  assert.equal(plan.actionLabel, "Підзаголовок");
  assert.deepEqual(
    getLocalActionTextIntentOptions().map((option) => option.label),
    ["Переписати", "Скоротити", "Список", "Підзаголовок"]
  );
});

test("local action route returns authenticated review-backed list plan", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "local-action-secret";

  try {
    const sessionToken = await createSessionToken("local-action-secret", Date.now());
    const response = await POST(
      new Request("http://localhost/api/edit/local-action", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`
        },
        body: JSON.stringify({
          prompt: "Зроби список з цього фрагмента"
        })
      })
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as { executor: string; recommendationType?: string };
    assert.equal(payload.executor, "review");
    assert.equal(payload.recommendationType, "list");
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});

test("local action descriptions expose user-facing copy", () => {
  assert.match(getLocalActionCalloutDescription("mechanism"), /механізм/i);
  assert.match(getLocalActionCalloutDepthDescription("deep"), /Докладно/i);
  assert.match(getLocalActionVisualDescription("infographic"), /структурований візуал/i);
});
