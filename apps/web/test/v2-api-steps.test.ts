import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { CustomRequestPlanAction, EditorialReviewRunSnapshot, EditorialReviewStepId } from "../lib/editor/review-contract.ts";
import { getDefaultEditorSettings } from "../lib/editor/settings.ts";
import {
  buildReviewRunRequest,
  interpretReviewRunReply,
  pollReviewRun,
  runSpellcheck,
  SPELLCHECK_ENDPOINT,
  type ReviewApiMessages
} from "../lib/v2/api.ts";

const messages: ReviewApiMessages = {
  invalid: "INVALID",
  platformTimeout: "PLATFORM",
  pollTimeout: "POLL_TIMEOUT",
  wrongLocale: "WRONG_LOCALE",
  resultInvalid: "RESULT_INVALID",
  proposalInvalid: "PROPOSAL_INVALID",
  network: "NETWORK"
};

const document: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    { id: "p-1", type: "paragraph", content: [{ text: "Кофеїн є конкурентним антагоністом аденозинових рецепторів." }] },
    { id: "p-2", type: "paragraph", content: [{ text: "Втома нікуди не зникае." }] },
    { id: "p-3", type: "paragraph", content: [{ text: "Сон відновлюе мозок." }] }
  ]
};
const revision = deriveManuscriptRevisionState(document);
const settings = { ...getDefaultEditorSettings("uk"), provider: "gemini" as const, modelId: "gemini-test" };
const REPORT = "## Головний діагноз розділу\n\nТекст щільний.";

const build = (stepId: EditorialReviewStepId, extra: Partial<Parameters<typeof buildReviewRunRequest>[0]> = {}) =>
  buildReviewRunRequest({ document, settings, locale: "uk", stepId, runMode: "replace", rejectedIdeas: [], ...extra });

/* ---------- diagnostics ---------- */

test("the diagnostics request carries its mode and the diagnostics prompt, and never an earlier report", () => {
  const concise = build("diagnostics");
  assert.deepEqual(concise.stepContext, { diagnosticsMode: "concise" });
  assert.equal(concise.expertisePrompt, settings.expertisePrompt.trim() || settings.reviewPrompt.trim() || undefined);
  assert.equal(concise.cardsPrompt, undefined);

  const extended = build("diagnostics", { diagnosticsMode: "extended", expertise: REPORT });
  assert.deepEqual(extended.stepContext, { diagnosticsMode: "extended" });
  assert.equal(extended.expertise, undefined, "a rerun of diagnostics is not fed its own previous report");
  assert.equal(extended.stepId, "diagnostics");
  assert.equal(extended.async, true);
});

/* ---------- diagnostics text travels as in the classic editor ---------- */

test("the report is sent to every later step except accents, in both places the classic editor puts it", () => {
  const withReport: EditorialReviewStepId[] = ["fact_check", "structure", "clarity", "interest", "visuals", "formatting", "final_editing"];

  for (const stepId of withReport) {
    const request = build(stepId, { expertise: `  ${REPORT}  `, instruction: stepId === "final_editing" ? "Скороти вступ" : undefined });

    assert.equal(request.expertise, REPORT, `${stepId}: expertise`);
    assert.equal(request.stepContext?.diagnosticsExpertise, REPORT, `${stepId}: stepContext.diagnosticsExpertise`);
    assert.equal(request.stepContext?.diagnosticsMode, undefined, `${stepId}: no diagnostics mode`);
    assert.equal(request.expertisePrompt, undefined, `${stepId}: no diagnostics prompt`);
  }

  // Accents: the classic editor's emphasis request has no step context and no expertise at all.
  const emphasis = build("emphasis", { expertise: REPORT });
  assert.equal("expertise" in emphasis, false);
  assert.equal("stepContext" in emphasis, false);
});

test("without a report nothing is sent in its place", () => {
  for (const expertise of [undefined, null, "", "   "]) {
    const request = build("clarity", { expertise });
    assert.equal(request.expertise, undefined);
    assert.equal(request.stepContext?.diagnosticsExpertise, undefined);
  }
});

/* ---------- the chapter request ---------- */

test("the chapter request carries the instruction where the server reads it, as the classic editor sends it", () => {
  const request = build("final_editing", {
    instruction: "  Скороти вступ удвічі  ",
    messageStamp: { id: "chat-1", timestamp: "2026-10-10T10:00:00.000Z" }
  });

  assert.equal(request.stepId, "final_editing");
  assert.equal(request.runMode, "replace");
  assert.equal(request.stepFeedback, "Скороти вступ удвічі");
  assert.equal(request.stepContext?.currentStepFeedback, "Скороти вступ удвічі");
  assert.deepEqual(request.history, [
    { id: "chat-1", role: "user", content: "[final_editing] Скороти вступ удвічі", timestamp: "2026-10-10T10:00:00.000Z" }
  ]);
  assert.equal(request.additionalInstructions, "");
  assert.equal(request.cardsPrompt, settings.cardsPrompt.trim() || settings.reviewPrompt.trim() || undefined);
  assert.equal("customRequestPlanAction" in request, false);
  assert.deepEqual(request.revision, { documentRevisionId: revision.documentRevisionId, blockOrder: ["h-1", "p-1", "p-2", "p-3"], blockFingerprints: {} });
});

test("a pass request has no instruction fields at all", () => {
  const request = build("clarity");
  assert.equal("history" in request, false);
  assert.equal("stepFeedback" in request, false);
  assert.equal("customRequestPlanAction" in request, false);
  assert.deepEqual(request.stepContext, { diagnosticsExpertise: undefined });
});

test("a retry sends one planned action with its index, in preserve mode", () => {
  const action: CustomRequestPlanAction = { blockId: "p-2", recommendationType: "rewrite", title: "Уточнити", recommendation: "Переписати.", priority: "high" };
  const request = build("final_editing", { runMode: "preserve", instruction: "Скороти вступ", planAction: { ...action, index: 1 } });

  assert.equal(request.runMode, "preserve");
  assert.deepEqual(request.customRequestPlanAction, { ...action, index: 1 });
  assert.equal(request.stepFeedback, "Скороти вступ");
});

/* ---------- the plan in run replies ---------- */

const run = (overrides: Partial<EditorialReviewRunSnapshot> = {}): EditorialReviewRunSnapshot => ({
  runId: "run-1",
  documentRevisionId: revision.documentRevisionId,
  stepId: "final_editing",
  locale: "uk",
  provider: "gemini",
  modelId: "gemini-test",
  runMode: "replace",
  createdAt: "2026-10-10T10:00:00.000Z",
  status: "running",
  updatedAt: "2026-10-10T10:00:01.000Z",
  pollAfterMs: 1000,
  ...overrides
});

const plan: CustomRequestPlanAction[] = [
  { blockId: "p-1", recommendationType: "simplify", title: "Спростити", recommendation: "Спростити.", priority: "medium" }
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("a run reply hands over the plan of a chapter request once there is one", () => {
  const planning = interpretReviewRunReply(
    JSON.stringify({ kind: "run", run: run({ progress: { completedChunks: 0, totalChunks: 1, phase: "planning" } }), capability: "cap" }),
    200,
    messages
  );
  assert.equal(planning.kind, "run");
  assert.equal(planning.kind === "run" && "plan" in planning, false);
  assert.equal(planning.kind === "run" && planning.run.progress?.phase, "planning");

  const generating = interpretReviewRunReply(
    JSON.stringify({ kind: "run", run: run({ progress: { completedChunks: 0, totalChunks: 1, phase: "generating" } }), capability: "cap", plan: { actions: plan } }),
    200,
    messages
  );
  assert.deepEqual(generating.kind === "run" && generating.plan, plan);

  const empty = interpretReviewRunReply(JSON.stringify({ kind: "run", run: run(), capability: "cap", plan: { actions: [] } }), 200, messages);
  assert.equal(empty.kind === "run" && "plan" in empty, false);
});

test("polling passes the phases and the plan on to the snapshots", async () => {
  const replies = [
    () => json({ kind: "run", run: run({ progress: { completedChunks: 0, totalChunks: 1, phase: "planning" } }), capability: "cap-1" }),
    () => json({ kind: "run", run: run({ progress: { completedChunks: 0, totalChunks: 1, phase: "generating" } }), capability: "cap-2", plan: { actions: plan } }),
    () => json({ kind: "error", error: { code: "provider_failed", message: "Провайдер недоступний.", retryable: false }, run: run({ status: "failed" }) }, 502)
  ];
  const seen: Array<{ phase?: string; plan?: CustomRequestPlanAction[] }> = [];
  let call = 0;

  const outcome = await pollReviewRun({
    messages,
    run: run({ status: "pending" }),
    capability: "cap-0",
    locale: "uk",
    getSourceChars: () => 100,
    isCurrent: () => true,
    acquireLease: () => true,
    wait: async () => undefined,
    onSnapshot: (update) => seen.push({ phase: update.run.progress?.phase, plan: update.plan }),
    fetchImpl: async () => replies[call++]!()
  });

  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.kind === "failed" && outcome.message, "Провайдер недоступний.");
  assert.deepEqual(seen.slice(0, 2), [
    { phase: "planning", plan: undefined },
    { phase: "generating", plan }
  ]);
});

/* ---------- fragment spellcheck ---------- */

test("a fragment spellcheck sends the selected blocks only and maps findings back to them", async () => {
  const bodies: Array<{ selection: { text: string } }> = [];
  const reply = await runSpellcheck(
    { document, locale: "uk", blockIds: ["p-2"] },
    {
      messages: { invalid: "SPELL_INVALID", network: "NETWORK" },
      fetchImpl: async (url, init) => {
        assert.equal(url, SPELLCHECK_ENDPOINT);
        const body = JSON.parse(String(init?.body)) as { selection: { text: string } };
        bodies.push(body);
        const start = body.selection.text.indexOf("зникае");
        return json({ issues: [{ range: { start, end: start + 6 }, message: "Помилка", category: "misspelling", ruleId: "R", suggestions: [{ value: "зникає" }] }] });
      }
    }
  );

  assert.equal(bodies.length, 1);
  assert.match(bodies[0]!.selection.text, /Втома нікуди не зникае\./);
  assert.doesNotMatch(bodies[0]!.selection.text, /Кофеїн|Сон відновлюе/);
  assert.equal(reply.kind, "ok");
  assert.equal(reply.kind === "ok" && reply.checkedBlocks, 1);
  assert.deepEqual(reply.kind === "ok" && reply.checkedBlockIds, ["p-2"]);
  assert.deepEqual(reply.kind === "ok" && reply.findings.map((finding) => [finding.blockId, finding.badText, finding.suggestions]), [["p-2", "зникае", ["зникає"]]]);
});

test("a fragment without checkable text is not reported as clean", async () => {
  const withImage: EditorDocument = { version: 2, blocks: [...document.blocks, { id: "d-1", type: "divider" } as EditorDocument["blocks"][number]] };
  const reply = await runSpellcheck(
    { document: withImage, locale: "uk", blockIds: ["d-1"] },
    {
      messages: { invalid: "SPELL_INVALID", network: "NETWORK" },
      fetchImpl: async () => {
        throw new Error("no request is expected");
      }
    }
  );

  // Nothing was checked: the caller turns `checkedBlocks === 0` into an error, never into "no mistakes".
  assert.deepEqual(reply, { kind: "ok", findings: [], checkedBlocks: 0, checkedBlockIds: [], failures: [] });
});

test("a spellcheck reports which blocks were really checked when a batch fails", async () => {
  const long = (word: string) => Array.from({ length: 900 }, () => word).join(" ");
  const big: EditorDocument = {
    version: 2,
    blocks: [
      { id: "b-1", type: "paragraph", content: [{ text: long("перший") }] },
      { id: "b-2", type: "paragraph", content: [{ text: long("другий") }] },
      { id: "b-3", type: "paragraph", content: [{ text: long("третій") }] }
    ]
  };
  let call = 0;
  const reply = await runSpellcheck(
    { document: big, locale: "uk", blockIds: ["b-1", "b-2", "b-3"] },
    {
      messages: { invalid: "SPELL_INVALID", network: "NETWORK" },
      fetchImpl: async () => {
        call += 1;
        return call === 2 ? json({ error: "Сервіс правопису недоступний." }, 502) : json({ issues: [] });
      }
    }
  );

  assert.ok(call >= 2, "the fragment is long enough to be sent in several batches");
  assert.equal(reply.kind, "ok");

  if (reply.kind === "ok") {
    assert.deepEqual(reply.failures, ["Сервіс правопису недоступний."]);
    assert.ok(reply.checkedBlockIds.length >= 1 && reply.checkedBlockIds.length < 3);
    assert.equal(reply.checkedBlocks, reply.checkedBlockIds.length);
    assert.equal(reply.checkedBlockIds.includes("b-1"), true);
  }
});
