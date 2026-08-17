import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import {
  CUSTOM_REQUEST_PLAN_MAX_ACTIONS,
  normalizeCustomRequestPlan
} from "../lib/editor/review-contract.ts";
import {
  CUSTOM_REQUEST_GENERATE_PACK_BUDGET_CHARS,
  CUSTOM_REQUEST_PLAN_PACK_BUDGET_CHARS,
  buildCustomRequestGenerateAllSystemPrompt,
  buildCustomRequestGenerateAllUserPrompt,
  buildCustomRequestPlanSystemPrompt,
  buildCustomRequestPlanUserPrompt,
  packCustomRequestGenerateDocument,
  packCustomRequestPlanDocument,
  parseCustomRequestPlanPayload
} from "../lib/server/custom-request-plan.ts";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorialReviewRequest } from "../lib/editor/review-contract.ts";

function createMultiSectionDocument(): EditorDocument {
  const blocks: EditorDocument["blocks"] = [];
  for (let section = 0; section < 3; section += 1) {
    blocks.push({
      id: `h${section}`,
      type: "heading",
      level: 2,
      content: [{ text: `Розділ ${section + 1}` }]
    });
    for (let paragraph = 0; paragraph < 5; paragraph += 1) {
      blocks.push({
        id: `s${section}p${paragraph}`,
        type: "paragraph",
        content: [{
          text: `Змістовний абзац ${section + 1}.${paragraph + 1} з поясненням механізму для читача науково-популярного тексту. `.repeat(3)
        }]
      });
    }
  }
  return { version: 2, blocks };
}

test("normalizeCustomRequestPlan keeps mixed final_editing types and drops unknown blockIds", () => {
  const document = createMultiSectionDocument();
  const result = normalizeCustomRequestPlan({
    raw: {
      actions: [
        {
          blockId: "s0p0",
          recommendationType: "callout",
          title: "Врізка",
          recommendation: "Коротка врізка про механізм.",
          priority: "high"
        },
        {
          blockId: "missing",
          recommendationType: "visual",
          title: "Схема",
          recommendation: "Інфографіка.",
          priority: "medium"
        },
        {
          blockId: "s1p2",
          recommendationType: "list",
          title: "Список",
          recommendation: "Перетворити на список.",
          priority: "low"
        },
        {
          blockId: "s2p0",
          recommendationType: "rewrite",
          title: "Перепис",
          recommendation: "Спростити формулювання.",
          priority: "medium"
        },
        {
          blockId: "s0p0",
          recommendationType: "callout",
          title: "Дубль",
          recommendation: "Той самий якір і тип.",
          priority: "high"
        }
      ]
    },
    document,
    stepRunId: "step-1"
  });

  assert.deepEqual(
    result.plan.actions.map((action) => action.recommendationType),
    ["callout", "list", "rewrite"]
  );
  assert.equal(result.droppedUnknownBlockIds, 1);
  assert.equal(result.plan.actions[0]?.blockId, "s0p0");
  assert.equal(result.plan.stepRunId, "step-1");
});

test("normalizeCustomRequestPlan enforces the hard action ceiling without regex quotas", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: Array.from({ length: CUSTOM_REQUEST_PLAN_MAX_ACTIONS + 8 }, (_, index) => ({
      id: `p${index}`,
      type: "paragraph" as const,
      content: [{ text: `Абзац ${index} із достатньою змістовною довжиною для плану.` }]
    }))
  };
  const actions = document.blocks.map((block, index) => ({
    blockId: block.id,
    recommendationType: "callout" as const,
    title: `Дія ${index}`,
    recommendation: `Seed ${index}`,
    priority: "medium" as const
  }));

  const result = normalizeCustomRequestPlan({
    raw: { actions },
    document,
    maxActions: CUSTOM_REQUEST_PLAN_MAX_ACTIONS
  });

  assert.equal(result.plan.actions.length, CUSTOM_REQUEST_PLAN_MAX_ACTIONS);
  assert.equal(result.droppedOverCeiling, 8);
});

test("packCustomRequestPlanDocument prefers outline plus section samples under the char budget", () => {
  const document = createMultiSectionDocument();
  const pack = packCustomRequestPlanDocument(document);

  assert.match(pack.outlineText, /H2 \[h0\] Розділ 1/);
  assert.match(pack.outlineText, /H2 \[h2\] Розділ 3/);
  assert.ok(pack.sampleLineCount > 0);
  assert.ok(pack.packedText.length <= CUSTOM_REQUEST_PLAN_PACK_BUDGET_CHARS + 32);
  assert.doesNotMatch(pack.packedText, /Змістовний абзац 1\.1 з поясненням механізму для читача науково-популярного тексту\. Змістовний абзац 1\.1 з поясненням механізму для читача науково-популярного тексту\. Змістовний абзац 1\.1 з поясненням механізму для читача науково-популярного тексту\./);
  assert.match(pack.packedText, /OUTLINE/);
  assert.match(pack.packedText, /SAMPLES/);
  assert.match(pack.samplesText, /\[s0p0\]/);
});

test("parseCustomRequestPlanPayload tolerates malformed brace-extracted JSON", () => {
  assert.deepEqual(parseCustomRequestPlanPayload("not json {broken"), { actions: [] });
  assert.deepEqual(
    parseCustomRequestPlanPayload('prefix {"actions":[{"blockId":"p1","recommendationType":"list","title":"A","recommendation":"B","priority":"medium"}]} suffix'),
    {
      actions: [
        {
          blockId: "p1",
          recommendationType: "list",
          title: "A",
          recommendation: "B",
          priority: "medium"
        }
      ]
    }
  );
});

test("custom request plan prompts use packed overview and custom request, not full card JSON", () => {
  const document = createMultiSectionDocument();
  const request: EditorialReviewRequest = {
    document,
    revision: deriveManuscriptRevisionState(document),
    provider: "openai",
    modelId: "gpt-5.6-luna",
    changeLevel: 3,
    stepId: "final_editing",
    stepFeedback: "запропонуй 10 врізок"
  };
  const system = buildCustomRequestPlanSystemPrompt("uk");
  const user = buildCustomRequestPlanUserPrompt({
    request,
    customPrompt: "запропонуй 10 врізок",
    locale: "uk"
  });

  assert.match(system, /actions/);
  assert.match(system, /не більше 20/);
  assert.doesNotMatch(system, /recommendationCardsJsonFormat|items\[\{"blockId"/);
  assert.match(user, /запропонуй 10 врізок/);
  assert.match(user, /OUTLINE/);
  assert.doesNotMatch(user, /Контекст діагностики/);
});

test("packCustomRequestGenerateDocument keeps planned anchors and neighboring blocks", () => {
  const document = createMultiSectionDocument();
  const pack = packCustomRequestGenerateDocument(document, [
    {
      blockId: "s0p0",
      recommendationType: "callout",
      title: "Врізка",
      recommendation: "Seed",
      priority: "medium"
    },
    {
      blockId: "s2p4",
      recommendationType: "list",
      title: "Список",
      recommendation: "Seed",
      priority: "medium"
    }
  ]);

  assert.match(pack.packedText, /\[s0p0\]/);
  assert.match(pack.packedText, /\[s2p4\]/);
  assert.ok(pack.includedBlockIds.includes("s0p0"));
  assert.ok(pack.packedText.length <= CUSTOM_REQUEST_GENERATE_PACK_BUDGET_CHARS + 32);
});

test("custom request generate-all prompts include every planned action and local context", () => {
  const document = createMultiSectionDocument();
  const request: EditorialReviewRequest = {
    document,
    revision: deriveManuscriptRevisionState(document),
    provider: "openai",
    modelId: "gpt-5.6-luna",
    changeLevel: 3,
    stepId: "final_editing",
    stepFeedback: "запропонуй 10 врізок"
  };
  const actions = [
    {
      blockId: "s0p0",
      recommendationType: "callout" as const,
      title: "Врізка 1",
      recommendation: "Seed 1",
      priority: "medium" as const
    },
    {
      blockId: "s1p2",
      recommendationType: "callout" as const,
      title: "Врізка 2",
      recommendation: "Seed 2",
      priority: "medium" as const
    }
  ];
  const system = buildCustomRequestGenerateAllSystemPrompt("uk");
  const user = buildCustomRequestGenerateAllUserPrompt({
    request,
    actions,
    customPrompt: "запропонуй 10 врізок",
    locale: "uk"
  });

  assert.match(system, /по одному item на кожну planned action/);
  assert.match(user, /Врізка 1/);
  assert.match(user, /Врізка 2/);
  assert.match(user, /\[s0p0\]/);
  assert.match(user, /\[s1p2\]/);
  assert.doesNotMatch(user, /Контекст діагностики/);
});
