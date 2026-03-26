import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_COOKIE_NAME, createSessionToken } from "../lib/auth/password-auth.ts";
import {
  buildPatchPromptForTextIntent,
  getLocalActionCalloutDescription,
  getLocalActionVisualDescription,
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

test("local action router builds normalized patch prompts for structured text intents", () => {
  const shortenPrompt = buildPatchPromptForTextIntent("shorten", "");

  assert.ok(shortenPrompt);
  assert.match(shortenPrompt, /Скороти виділений фрагмент/i);
  assert.match(buildPatchPromptForTextIntent("table", "лиш короткі заголовки") ?? "", /Додаткова інструкція/i);
  assert.equal(buildPatchPromptForTextIntent("rewrite", ""), null);
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
  assert.match(getLocalActionVisualDescription("infographic"), /структурований візуал/i);
});
