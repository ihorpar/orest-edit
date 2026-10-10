import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import type { PersistedActiveReviewRun } from "../lib/editor/draft-state.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorialReviewItem, EditorialReviewRunSnapshot, ReviewActionProposal } from "../lib/editor/review-contract.ts";
import {
  canApplyProposal,
  coercePersistedReview,
  createInitialReviewState,
  getPassIdForStep,
  reviewReducer,
  selectPassOpenCount,
  selectPassState,
  selectQueue,
  selectRunningPassId,
  selectSummary,
  serializeReviewState,
  type V2ReviewAction,
  type V2ReviewState
} from "../lib/v2/store.ts";

const paragraph = (id: string, text: string) => ({ id, type: "paragraph" as const, content: [{ text }] });

const baseDocument: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    paragraph("p-1", "Протягом періоду неспання відбувається акумуляція аденозину."),
    paragraph("p-2", "Аденозин зв’язується з рецепторами."),
    paragraph("p-3", "Кофеїн є конкурентним антагоністом.")
  ]
};

const context = (document: EditorDocument = baseDocument) => ({ document, revision: deriveManuscriptRevisionState(document) });

function edit(document: EditorDocument, blockId: string, text: string): EditorDocument {
  return { version: 2, blocks: document.blocks.map((block) => (block.id === blockId ? paragraph(blockId, text) : block)) };
}

function item(id: string, blockId: string, overrides: Partial<EditorialReviewItem> = {}): EditorialReviewItem {
  return {
    id,
    reviewSessionId: "session-1",
    documentRevisionId: deriveManuscriptRevisionState(baseDocument).documentRevisionId,
    changeLevel: 5,
    title: `Спростити ${blockId}`,
    reason: "Занадто складно.",
    recommendation: `Переписати ${blockId} простіше.`,
    recommendationType: "simplify",
    suggestedAction: "rewrite_text",
    priority: "medium",
    anchor: {
      blockIds: [blockId],
      generationBlockRange: { start: 1, end: 1 },
      excerpt: "…",
      fingerprint: computeAnchorFingerprint(baseDocument, [blockId])
    },
    insertionPoint: { mode: "replace", anchorBlockId: blockId },
    origin: "review",
    stepId: "clarity",
    stepRunId: "step-run-1",
    status: "pending",
    ...overrides
  };
}

function run(overrides: Partial<EditorialReviewRunSnapshot> = {}): EditorialReviewRunSnapshot {
  return {
    runId: "run-1",
    documentRevisionId: "rev-1",
    stepId: "clarity",
    locale: "uk",
    provider: "openai",
    modelId: "gpt-6-luna",
    runMode: "replace",
    createdAt: "2026-10-10T10:00:00.000Z",
    status: "running",
    updatedAt: "2026-10-10T10:00:01.000Z",
    pollAfterMs: 1000,
    ...overrides
  };
}

function record(overrides: Partial<PersistedActiveReviewRun> = {}): PersistedActiveReviewRun {
  return { version: 1, run: run(), capability: "signed-cap", updatedAt: "2026-10-10T10:00:01.000Z", stale: false, ...overrides };
}

function proposal(itemId: string, blockId: string, newText: string, extra: Partial<NonNullable<ReviewActionProposal["textDiff"]>> = {}): ReviewActionProposal {
  const oldBlock = baseDocument.blocks.find((block) => block.id === blockId)!;

  return {
    id: `proposal-${itemId}-${newText.length}`,
    reviewItemId: itemId,
    sourceRevisionId: "rev-1",
    targetRevisionId: "rev-1",
    kind: "text_diff",
    summary: "Спрощено",
    canApplyDirectly: true,
    textDiff: { op: "replace_blocks", blockIds: [blockId], oldBlocks: [oldBlock], newBlocks: [paragraph(blockId, newText)], reason: "Простіше.", ...extra }
  };
}

function reduce(state: V2ReviewState, ...actions: V2ReviewAction[]): V2ReviewState {
  return actions.reduce(reviewReducer, state);
}

function started(): V2ReviewState {
  return reduce(
    createInitialReviewState(),
    { type: "run/requested", passId: "clarity" },
    { type: "run/started", passId: "clarity", runMode: "replace", record: record() }
  );
}

function withItems(...items: EditorialReviewItem[]): V2ReviewState {
  return reduce(
    started(),
    { type: "run/snapshot", passId: "clarity", record: record({ itemCursor: items.length }), items, ...context() },
    { type: "run/completed", passId: "clarity", runMode: "replace", stepRunId: "step-run-1", items, ...context() }
  );
}

function ready(state: V2ReviewState, itemId: string, blockId: string, newText = "Простий текст."): V2ReviewState {
  const target = state.items.find((entry) => entry.id === itemId)!;
  return reduce(
    state,
    { type: "focus/set", itemId },
    { type: "proposal/requested", item: target },
    { type: "proposal/ready", itemId, proposal: proposal(itemId, blockId, newText) }
  );
}

/* ---------- runs ---------- */

test("a pass goes idle → running → done while items stream in", () => {
  let state = createInitialReviewState();
  assert.equal(selectPassState(state, "clarity").status, "idle");

  state = reviewReducer(state, { type: "run/requested", passId: "clarity" });
  assert.equal(selectPassState(state, "clarity").status, "running");
  assert.equal(selectRunningPassId(state), "clarity");
  assert.equal(state.activeRun, null);

  state = reviewReducer(state, { type: "run/started", passId: "clarity", runMode: "replace", record: record() });
  assert.equal(state.activeRun?.capability, "signed-cap");

  state = reviewReducer(state, {
    type: "run/snapshot",
    passId: "clarity",
    record: record({ itemCursor: 1, run: run({ progress: { completedChunks: 1, totalChunks: 2 } }) }),
    items: [item("item-2", "p-2")],
    ...context()
  });
  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["item-2"]);
  assert.deepEqual(selectPassState(state, "clarity").progress, { completed: 1, total: 2, percent: 50 });
  assert.equal(state.activeRun?.itemCursor, 1);

  state = reviewReducer(state, {
    type: "run/snapshot",
    passId: "clarity",
    record: record({ itemCursor: 2 }),
    items: [item("item-1", "p-1")],
    ...context()
  });
  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["item-1", "item-2"], "the queue is in manuscript order");

  state = reviewReducer(state, {
    type: "run/completed",
    passId: "clarity",
    runMode: "replace",
    stepRunId: "step-run-9",
    items: [item("item-1", "p-1"), item("item-2", "p-2"), item("item-3", "p-3")],
    ...context()
  });
  assert.equal(selectPassState(state, "clarity").status, "done");
  assert.equal(selectPassState(state, "clarity").lastRunItemCount, 3);
  assert.equal(state.activeRun, null);
  assert.equal(selectRunningPassId(state), null);
  assert.equal(selectPassOpenCount(state, "clarity"), 3, "items already streamed are not duplicated by the final result");
  assert.deepEqual(selectSummary(state), { open: 3, decided: 0, hasAny: true });
});

test("a snapshot of a run that is no longer active is ignored", () => {
  const state = reduce(started(), { type: "run/stopped", passId: "clarity" });
  const next = reviewReducer(state, { type: "run/snapshot", passId: "clarity", record: record(), items: [item("late", "p-1")], ...context() });
  assert.equal(next, state);
});

test("a failed run keeps the server's message and the items that arrived before it", () => {
  const state = reduce(
    started(),
    { type: "run/snapshot", passId: "clarity", record: record({ itemCursor: 1 }), items: [item("item-1", "p-1")], ...context() },
    { type: "run/failed", passId: "clarity", message: "OpenAI: модель не знайдено (404)." }
  );

  assert.deepEqual(selectPassState(state, "clarity"), { status: "failed", error: "OpenAI: модель не знайдено (404)." });
  assert.equal(state.activeRun, null);
  assert.equal(selectPassOpenCount(state, "clarity"), 1);
});

test("a stopped run is idle again, flagged as stopped, with no run reference left", () => {
  const state = reduce(started(), { type: "run/stopped", passId: "clarity" });
  assert.deepEqual(selectPassState(state, "clarity"), { status: "idle", stopped: true });
  assert.equal(state.activeRun, null);
  assert.equal(selectRunningPassId(state), null);
});

test("a finished run with failed fragments is done with warnings", () => {
  const state = reduce(started(), {
    type: "run/completed",
    passId: "clarity",
    runMode: "replace",
    stepRunId: "s",
    items: [],
    warnings: ["Модель не відповіла."],
    ...context()
  });
  assert.deepEqual(selectPassState(state, "clarity").warnings, ["Модель не відповіла."]);
});

test("a rerun in replace mode keeps the earlier cards until it delivers, then replaces them", () => {
  const first = ready(withItems(item("item-1", "p-1"), item("item-2", "p-2")), "item-1", "p-1");
  const rerun = record({ run: run({ runId: "run-2" }) });
  const startedAgain = reduce(
    first,
    { type: "run/requested", passId: "clarity" },
    { type: "run/started", passId: "clarity", runMode: "replace", record: rerun }
  );

  assert.deepEqual(startedAgain.items.map((entry) => entry.id), ["item-1", "item-2"], "nothing is dropped when the rerun starts");
  assert.equal(startedAgain.proposals["item-1"]?.status, "ready");
  assert.equal(startedAgain.focusId, "item-1");
  assert.equal(canApplyProposal(startedAgain, "item-1"), true, "an earlier card can still be accepted while the rerun reads");
  assert.equal(selectPassState(startedAgain, "clarity").replaceOnResult, true);

  // A poll without items changes nothing.
  const emptyPoll = reviewReducer(startedAgain, { type: "run/snapshot", passId: "clarity", record: rerun, items: [], ...context() });
  assert.deepEqual(emptyPoll.items.map((entry) => entry.id), ["item-1", "item-2"]);
  assert.equal(selectPassState(emptyPoll, "clarity").replaceOnResult, true);

  // The first delivered items replace the earlier cards of the pass.
  const delivered = reviewReducer(emptyPoll, {
    type: "run/snapshot",
    passId: "clarity",
    record: { ...rerun, itemCursor: 1 },
    items: [item("item-3", "p-3")],
    ...context()
  });
  assert.deepEqual(delivered.items.map((entry) => entry.id), ["item-3"]);
  assert.deepEqual(delivered.proposals, {});
  assert.equal(delivered.focusId, null);
  assert.equal(selectPassState(delivered, "clarity").replaceOnResult, undefined);

  // Later batches of the same run are added, not replaced again.
  const more = reviewReducer(delivered, {
    type: "run/snapshot",
    passId: "clarity",
    record: { ...rerun, itemCursor: 2 },
    items: [item("item-1b", "p-1")],
    ...context()
  });
  assert.deepEqual(more.items.map((entry) => entry.id), ["item-1b", "item-3"]);
});

test("a failed or stopped rerun leaves the earlier cards and their proposals intact", () => {
  const first = ready(withItems(item("item-1", "p-1"), item("item-2", "p-2")), "item-1", "p-1");
  const rerun = record({ run: run({ runId: "run-2" }) });
  const startedAgain = reduce(
    first,
    { type: "run/requested", passId: "clarity" },
    { type: "run/started", passId: "clarity", runMode: "replace", record: rerun }
  );

  const failed = reviewReducer(startedAgain, { type: "run/failed", passId: "clarity", message: "Модель недоступна." });
  assert.deepEqual(failed.items.map((entry) => [entry.id, entry.status]), [["item-1", "ready"], ["item-2", "pending"]]);
  assert.equal(failed.proposals["item-1"]?.status, "ready");
  assert.equal(selectPassState(failed, "clarity").error, "Модель недоступна.");
  assert.equal(selectPassState(failed, "clarity").replaceOnResult, undefined);

  const stopped = reviewReducer(startedAgain, { type: "run/stopped", passId: "clarity" });
  assert.deepEqual(stopped.items.map((entry) => entry.id), ["item-1", "item-2"]);
  assert.equal(stopped.focusId, "item-1");

  // The next rerun still replaces once it delivers.
  const third = reduce(
    failed,
    { type: "run/started", passId: "clarity", runMode: "replace", record: record({ run: run({ runId: "run-3" }) }) },
    { type: "run/completed", passId: "clarity", runMode: "replace", stepRunId: "s3", items: [item("item-9", "p-3")], ...context() }
  );
  assert.deepEqual(third.items.map((entry) => entry.id), ["item-9"]);
});

test("a rerun that completes successfully with nothing to propose clears the earlier cards", () => {
  const first = withItems(item("item-1", "p-1"));
  const done = reduce(
    first,
    { type: "run/started", passId: "clarity", runMode: "replace", record: record({ run: run({ runId: "run-2" }) }) },
    { type: "run/completed", passId: "clarity", runMode: "replace", stepRunId: "s2", items: [], ...context() }
  );
  assert.deepEqual(done.items, []);
  assert.equal(selectPassState(done, "clarity").status, "done");
});

test("the pending replacement survives a reload together with the run reference", () => {
  const startedAgain = reviewReducer(withItems(item("item-1", "p-1")), {
    type: "run/started",
    passId: "clarity",
    runMode: "replace",
    record: record({ run: run({ runId: "run-2" }) })
  });
  const restored = coercePersistedReview(JSON.parse(JSON.stringify(serializeReviewState(startedAgain))));
  const hydrated = reduce(
    reviewReducer(createInitialReviewState(), { type: "hydrate", persisted: restored }),
    { type: "run/resumed", passId: "clarity", record: record({ run: run({ runId: "run-2" }) }) },
    { type: "run/snapshot", passId: "clarity", record: record({ run: run({ runId: "run-2" }), itemCursor: 1 }), items: [item("item-2", "p-2")], ...context() }
  );
  assert.deepEqual(hydrated.items.map((entry) => entry.id), ["item-2"]);
});

test("preserve mode keeps the earlier items and adds new ones", () => {
  const first = ready(withItems(item("item-1", "p-1"), item("item-2", "p-2")), "item-1", "p-1");
  const preserved = reduce(
    first,
    { type: "run/started", passId: "clarity", runMode: "preserve", record: record({ run: run({ runId: "run-2", runMode: "preserve" }) }) },
    {
      type: "run/snapshot",
      passId: "clarity",
      record: record({ run: run({ runId: "run-2", runMode: "preserve" }), itemCursor: 2 }),
      // The second one repeats an existing anchor and type, so it is not added twice.
      items: [item("item-3", "p-3"), item("item-2-again", "p-2")],
      ...context()
    }
  );
  assert.deepEqual(preserved.items.map((entry) => entry.id), ["item-1", "item-2", "item-3"]);
  assert.equal(preserved.proposals["item-1"]?.status, "ready");
  assert.equal(preserved.focusId, "item-1");
});

test("replace mode leaves other passes' items alone", () => {
  const structure = item("structure-1", "p-2", { stepId: "structure", recommendationType: "subsection" });
  const state = reduce(
    withItems(item("item-1", "p-1")),
    { type: "run/started", passId: "structure", runMode: "replace", record: record({ run: run({ runId: "r-s", stepId: "structure" }) }) },
    { type: "run/snapshot", passId: "structure", record: record({ run: run({ runId: "r-s", stepId: "structure" }) }), items: [structure], ...context() }
  );
  assert.deepEqual(state.items.map((entry) => entry.id), ["item-1", "structure-1"]);

  const rerun = reduce(
    state,
    { type: "run/started", passId: "clarity", runMode: "replace", record: record({ run: run({ runId: "r-3" }) }) },
    { type: "run/completed", passId: "clarity", runMode: "replace", stepRunId: "s3", items: [], ...context() }
  );
  assert.deepEqual(rerun.items.map((entry) => entry.id), ["structure-1"]);
  assert.equal(getPassIdForStep("visuals"), "visual");
  assert.equal(getPassIdForStep("emphasis"), "accent");
  assert.equal(getPassIdForStep("diagnostics"), null);
});

/* ---------- focus and filter ---------- */

test("focus follows only open items; the filter narrows the queue and drops a hidden focus", () => {
  const structure = item("structure-1", "p-2", { stepId: "structure", recommendationType: "subsection" });
  let state = reduce(
    withItems(item("item-1", "p-1"), item("item-3", "p-3")),
    { type: "run/started", passId: "structure", runMode: "preserve", record: record({ run: run({ runId: "r-s", stepId: "structure" }) }) },
    { type: "run/snapshot", passId: "structure", record: record({ run: run({ runId: "r-s", stepId: "structure" }) }), items: [structure], ...context() }
  );

  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["item-1", "structure-1", "item-3"]);

  state = reviewReducer(state, { type: "focus/set", itemId: "nope" });
  assert.equal(state.focusId, null);

  state = reviewReducer(state, { type: "focus/set", itemId: "structure-1" });
  assert.equal(state.focusId, "structure-1");

  state = reviewReducer(state, { type: "filter/set", filter: "clarity" });
  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["item-1", "item-3"]);
  assert.equal(state.focusId, null, "a focused item hidden by the filter loses focus");

  state = reduce(state, { type: "focus/set", itemId: "item-3" }, { type: "filter/set", filter: "all" });
  assert.equal(state.focusId, "item-3");

  state = reduce(state, { type: "hover/set", itemId: "item-1" }, { type: "quiet/set", quiet: true });
  assert.equal(state.hoverId, "item-1");
  assert.equal(state.quiet, true);
  assert.equal(reviewReducer(state, { type: "focus/set", itemId: "item-3" }), state, "refocusing the same item changes nothing");
});

/* ---------- proposals ---------- */

test("a proposal goes preparing → ready and only then can be applied", () => {
  let state = withItems(item("item-1", "p-1"));
  assert.equal(canApplyProposal(state, "item-1"), false);

  state = reviewReducer(state, { type: "proposal/requested", item: state.items[0]! });
  assert.deepEqual(state.proposals["item-1"], { status: "preparing", noOpStreak: 0 });
  assert.equal(canApplyProposal(state, "item-1"), false);

  state = reviewReducer(state, { type: "proposal/ready", itemId: "item-1", proposal: proposal("item-1", "p-1", "Просто.") });
  assert.equal(state.items[0]!.status, "ready");
  assert.equal(state.items[0]!.activeProposalId, proposal("item-1", "p-1", "Просто.").id);
  assert.equal(canApplyProposal(state, "item-1"), true);
});

test("a pending refine instruction blocks applying until the proposal is regenerated", () => {
  let state = ready(withItems(item("item-1", "p-1")), "item-1", "p-1");
  state = reviewReducer(state, { type: "instruction/set", itemId: "item-1", text: "залиш термін" });
  assert.equal(canApplyProposal(state, "item-1"), false);

  state = reduce(
    state,
    { type: "proposal/requested", item: state.items[0]! },
    { type: "proposal/ready", itemId: "item-1", proposal: proposal("item-1", "p-1", "Просто, але з терміном.") }
  );
  assert.deepEqual(state.instructions, {}, "the instruction is consumed by the regenerated proposal");
  assert.equal(canApplyProposal(state, "item-1"), true);

  state = reduce(state, { type: "instruction/set", itemId: "item-1", text: "x" }, { type: "instruction/set", itemId: "item-1", text: "" });
  assert.equal(canApplyProposal(state, "item-1"), true);
});

test("a failed preparation keeps the server's message and leaves the item pending", () => {
  let state = withItems(item("item-1", "p-1"));
  state = reduce(
    state,
    { type: "proposal/requested", item: state.items[0]! },
    { type: "proposal/failed", itemId: "item-1", message: "OpenAI повернув помилку 404." }
  );
  assert.deepEqual(state.proposals["item-1"], { status: "failed", message: "OpenAI повернув помилку 404." });
  assert.equal(state.items[0]!.status, "pending");
  assert.equal(canApplyProposal(state, "item-1"), false);
});

test("a stale_anchor answer marks the item stale", () => {
  let state = withItems(item("item-1", "p-1"));
  state = reduce(
    state,
    { type: "proposal/requested", item: state.items[0]! },
    { type: "proposal/failed", itemId: "item-1", message: "Фрагмент змінено.", stale: true }
  );
  assert.equal(state.items[0]!.status, "stale");
  assert.deepEqual(state.proposals["item-1"], { status: "failed", message: "Фрагмент змінено." });
});

test("an answer that arrives after the item was decided or edited is dropped", () => {
  let state = withItems(item("item-1", "p-1"), item("item-2", "p-2"));
  state = reduce(state, { type: "proposal/requested", item: state.items[0]! }, { type: "item/rejected", itemId: "item-1", at: "t" });
  const afterDecision = reviewReducer(state, { type: "proposal/ready", itemId: "item-1", proposal: proposal("item-1", "p-1", "Пізно.") });
  assert.equal(afterDecision, state);

  let edited = reviewReducer(state, { type: "proposal/requested", item: state.items[1]! });
  edited = reviewReducer(edited, { type: "items/reconciled", ...context(edit(baseDocument, "p-2", "Автор переписав абзац.")) });
  assert.equal(edited.items[1]!.status, "stale");
  assert.equal(edited.proposals["item-2"], undefined);
  assert.equal(reviewReducer(edited, { type: "proposal/ready", itemId: "item-2", proposal: proposal("item-2", "p-2", "Пізно.") }), edited);
});

test("repeated no-op answers are counted across regenerations and reset by a real change", () => {
  const noOp = (text: string) => proposal("item-1", "p-1", text, { warning: { code: "no_op", message: "Майже без змін.", similarity: 0.99 } });
  let state = withItems(item("item-1", "p-1"));
  const request = (current: V2ReviewState): V2ReviewAction => ({ type: "proposal/requested", item: current.items[0]! });

  state = reduce(state, request(state), { type: "proposal/ready", itemId: "item-1", proposal: noOp("а") });
  assert.equal(state.proposals["item-1"]?.status === "ready" && state.proposals["item-1"].noOpStreak, 1);

  state = reduce(state, request(state), { type: "proposal/ready", itemId: "item-1", proposal: noOp("аб") });
  assert.equal(state.proposals["item-1"]?.status === "ready" && state.proposals["item-1"].noOpStreak, 2);

  state = reduce(state, request(state), { type: "proposal/ready", itemId: "item-1", proposal: proposal("item-1", "p-1", "Справді інакше.") });
  assert.equal(state.proposals["item-1"]?.status === "ready" && state.proposals["item-1"].noOpStreak, 0);
});

/* ---------- decisions ---------- */

test("accepting records the decision, clears the proposal and moves focus to the next card", () => {
  let state = ready(withItems(item("item-1", "p-1"), item("item-2", "p-2")), "item-1", "p-1");
  state = reviewReducer(state, { type: "item/accepted", itemId: "item-1", appliedFingerprint: "paragraph:Простий текст.", at: "2026-10-10T11:00:00.000Z" });

  assert.equal(state.items.find((entry) => entry.id === "item-1")!.status, "applied");
  assert.equal(state.proposals["item-1"], undefined);
  assert.equal(state.focusId, "item-2");
  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["item-2"]);
  assert.equal(state.decisions.length, 1);
  assert.equal(state.decisions[0]!.outcome, "accepted");
  assert.equal(state.decisions[0]!.passId, "clarity");
  assert.deepEqual(selectSummary(state), { open: 1, decided: 1, hasAny: true });
  assert.deepEqual(state.rejectedIdeas, []);
});

test("rejecting stores a rejected idea in the shape the review endpoint accepts, once", () => {
  let state = withItems(item("item-1", "p-1"), item("item-2", "p-2"));
  state = reduce(state, { type: "focus/set", itemId: "item-2" }, { type: "item/rejected", itemId: "item-2", at: "t1" });

  assert.equal(state.items.find((entry) => entry.id === "item-2")!.status, "dismissed");
  assert.deepEqual(state.rejectedIdeas, [{ blockIds: ["p-2"], recommendationType: "simplify", recommendation: "Переписати p-2 простіше." }]);
  assert.equal(state.focusId, "item-1", "focus moves to the previous card when there is no next one");
  assert.equal(state.decisions[0]!.outcome, "rejected");

  const again = reviewReducer(state, { type: "item/rejected", itemId: "item-2", at: "t2" });
  assert.equal(again, state, "an already decided item cannot be decided again");

  // A new run proposes the same idea on the same block; rejecting it does not duplicate the stored idea.
  const repeat = reduce(
    state,
    { type: "run/started", passId: "clarity", runMode: "replace", record: record({ run: run({ runId: "run-2" }) }) },
    { type: "run/snapshot", passId: "clarity", record: record({ run: run({ runId: "run-2" }) }), items: [item("item-2b", "p-2")], ...context() },
    { type: "item/rejected", itemId: "item-2b", at: "t3" }
  );
  assert.equal(repeat.rejectedIdeas.length, 1);
  assert.equal(repeat.decisions.length, 2, "decisions survive a rerun in replace mode");
});

/* ---------- stale ---------- */

test("a manual edit inside an anchored block makes its item stale and unappliable; other items stay", () => {
  let state = ready(withItems(item("item-1", "p-1"), item("item-2", "p-2")), "item-1", "p-1");
  const edited = edit(baseDocument, "p-1", "Автор сам переписав цей абзац.");
  state = reviewReducer(state, { type: "items/reconciled", ...context(edited) });

  assert.equal(state.items[0]!.status, "stale");
  assert.equal(state.items[0]!.activeProposalId, undefined);
  assert.equal(canApplyProposal(state, "item-1"), false);
  assert.equal(state.items[1]!.status, "pending");
  assert.equal(state.focusId, "item-1", "a stale item is still in the queue and keeps focus");
  assert.equal(reviewReducer(state, { type: "items/reconciled", ...context(edited) }), state, "reconciling again changes nothing");

  // The edit is undone: the proposal that was ready is ready again, without a new model call.
  state = reviewReducer(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(state.items[0]!.status, "ready");
  assert.equal(state.items[0]!.activeProposalId, proposal("item-1", "p-1", "Простий текст.").id);
  assert.equal(canApplyProposal(state, "item-1"), true);
});

test("an item made stale by a streamed merge is cleaned up the same way and comes back ready", () => {
  // item-1 is ready with a proposal; a second batch of the run arrives after the author edited p-1.
  let state = reduce(
    started(),
    { type: "run/snapshot", passId: "clarity", record: record({ itemCursor: 1 }), items: [item("item-1", "p-1")], ...context() }
  );
  state = reduce(
    state,
    { type: "focus/set", itemId: "item-1" },
    { type: "proposal/requested", item: state.items[0]! },
    { type: "proposal/ready", itemId: "item-1", proposal: proposal("item-1", "p-1", "Простий текст.") }
  );
  const edited = edit(baseDocument, "p-1", "Автор сам переписав цей абзац.");

  state = reviewReducer(state, {
    type: "run/snapshot",
    passId: "clarity",
    record: record({ itemCursor: 2 }),
    items: [item("item-2", "p-2")],
    ...context(edited)
  });
  assert.equal(state.items[0]!.status, "stale");
  assert.equal(state.items[0]!.activeProposalId, undefined);
  assert.equal(canApplyProposal(state, "item-1"), false);

  // Undo of the edit: not "pending with a leftover proposal" (a card whose button does nothing), but ready.
  state = reviewReducer(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(state.items[0]!.status, "ready");
  assert.equal(state.proposals["item-1"]?.status, "ready");
  assert.equal(canApplyProposal(state, "item-1"), true);

  // The same through the final merge of the run.
  let final = reviewReducer(state, {
    type: "run/completed",
    passId: "clarity",
    runMode: "replace",
    stepRunId: "s",
    items: [item("item-1", "p-1"), item("item-2", "p-2")],
    ...context(edited)
  });
  assert.equal(final.items[0]!.status, "stale");
  final = reviewReducer(final, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(final.items[0]!.status, "ready");
  assert.equal(canApplyProposal(final, "item-1"), true);
});

test("a request in flight for an item that goes stale is dropped; a regeneration falls back to the earlier proposal", () => {
  let state = ready(withItems(item("item-1", "p-1"), item("item-2", "p-2")), "item-1", "p-1");
  state = reduce(state, { type: "proposal/requested", item: state.items[0]! }, { type: "proposal/requested", item: state.items[1]! });
  state = reviewReducer(state, {
    type: "items/reconciled",
    ...context(edit(edit(baseDocument, "p-1", "Інакше."), "p-2", "Теж інакше."))
  });

  assert.equal(state.proposals["item-1"]?.status, "ready", "the earlier proposal is kept for the case the text comes back");
  assert.equal(state.proposals["item-2"], undefined);
  assert.equal(canApplyProposal(state, "item-1"), false);

  const late = reviewReducer(state, { type: "proposal/ready", itemId: "item-1", proposal: proposal("item-1", "p-1", "Запізніла відповідь.") });
  assert.equal(late, state);
});

test("a failed regeneration keeps the proposal that was ready and shows the error beside it", () => {
  let state = ready(withItems(item("item-1", "p-1")), "item-1", "p-1", "Простий текст.");
  const firstProposal = proposal("item-1", "p-1", "Простий текст.");

  state = reduce(state, { type: "instruction/set", itemId: "item-1", text: "ще простіше" }, { type: "proposal/requested", item: state.items[0]! });
  assert.equal(state.proposals["item-1"]?.status, "preparing");
  assert.equal(state.items[0]!.status, "ready");
  assert.equal(canApplyProposal(state, "item-1"), false, "nothing can be applied while the regeneration is in flight");

  state = reviewReducer(state, { type: "proposal/failed", itemId: "item-1", message: "OpenAI повернув помилку 500." });
  assert.deepEqual(state.proposals["item-1"], { status: "ready", proposal: firstProposal, noOpStreak: 0, error: "OpenAI повернув помилку 500." });
  assert.equal(state.items[0]!.status, "ready");
  assert.equal(state.instructions["item-1"], "ще простіше", "the unsent instruction is kept for another try");
  assert.equal(canApplyProposal(state, "item-1"), false, "the instruction is still waiting");

  state = reviewReducer(state, { type: "instruction/set", itemId: "item-1", text: "" });
  assert.equal(canApplyProposal(state, "item-1"), true);

  // A successful regeneration replaces the proposal and clears the error.
  state = reduce(
    state,
    { type: "proposal/requested", item: state.items[0]! },
    { type: "proposal/ready", itemId: "item-1", proposal: proposal("item-1", "p-1", "Ще простіше.") }
  );
  assert.deepEqual(state.proposals["item-1"], { status: "ready", proposal: proposal("item-1", "p-1", "Ще простіше."), noOpStreak: 0 });
});

test("a regeneration answered with stale_anchor makes the item stale", () => {
  let state = ready(withItems(item("item-1", "p-1")), "item-1", "p-1");
  state = reduce(
    state,
    { type: "proposal/requested", item: state.items[0]! },
    { type: "proposal/failed", itemId: "item-1", message: "Фрагмент змінено.", stale: true }
  );
  assert.equal(state.items[0]!.status, "stale");
  assert.deepEqual(state.proposals["item-1"], { status: "failed", message: "Фрагмент змінено." });
});

test("a regeneration in flight does not survive a reload, the proposal it was replacing does", () => {
  let state = ready(withItems(item("item-1", "p-1")), "item-1", "p-1");
  state = reviewReducer(state, { type: "proposal/requested", item: state.items[0]! });
  const hydrated = reviewReducer(createInitialReviewState(), {
    type: "hydrate",
    persisted: coercePersistedReview(JSON.parse(JSON.stringify(serializeReviewState(state))))
  });
  assert.equal(hydrated.items[0]!.status, "ready");
  assert.equal(hydrated.proposals["item-1"]?.status, "ready");
});

test("an item whose block was deleted is stale", () => {
  const state = reviewReducer(withItems(item("item-3", "p-3")), {
    type: "items/reconciled",
    ...context({ version: 2, blocks: baseDocument.blocks.filter((block) => block.id !== "p-3") })
  });
  assert.equal(state.items[0]!.status, "stale");
});

test("undoing the manual edit brings a stale item back to pending", () => {
  let state = withItems(item("item-1", "p-1"));
  state = reviewReducer(state, { type: "items/reconciled", ...context(edit(baseDocument, "p-1", "Тимчасова правка.")) });
  assert.equal(state.items[0]!.status, "stale");

  state = reviewReducer(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(state.items[0]!.status, "pending");
});

test("undoing an accepted change reopens the item with its proposal; redo accepts it again", () => {
  let state = ready(withItems(item("item-1", "p-1"), item("item-2", "p-2")), "item-1", "p-1", "Простий текст.");
  const applied = edit(baseDocument, "p-1", "Простий текст.");
  state = reviewReducer(state, {
    type: "item/accepted",
    itemId: "item-1",
    appliedFingerprint: computeAnchorFingerprint(applied, ["p-1"]),
    at: "t"
  });
  state = reviewReducer(state, { type: "items/reconciled", ...context(applied) });
  assert.equal(state.items[0]!.status, "applied", "an accepted item is not stale after its own change");
  assert.equal(selectSummary(state).decided, 1);

  state = reviewReducer(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(state.items[0]!.status, "ready");
  assert.equal(state.proposals["item-1"]?.status, "ready");
  assert.equal(canApplyProposal(state, "item-1"), true);
  assert.deepEqual(selectSummary(state), { open: 2, decided: 0, hasAny: true });

  state = reviewReducer(state, { type: "items/reconciled", ...context(applied) });
  assert.equal(state.items[0]!.status, "applied");
  assert.equal(state.proposals["item-1"], undefined);
  assert.equal(selectSummary(state).decided, 1);
});

/* ---------- persistence ---------- */

test("what must survive a reload round-trips through JSON", () => {
  let state = ready(withItems(item("item-1", "p-1"), item("item-2", "p-2"), item("item-3", "p-3")), "item-1", "p-1");
  state = reduce(
    state,
    { type: "item/rejected", itemId: "item-3", at: "t" },
    { type: "filter/set", filter: "clarity" },
    { type: "quiet/set", quiet: true },
    { type: "proposal/requested", item: state.items[1]! },
    { type: "run/started", passId: "clarity", runMode: "preserve", record: record({ run: run({ runId: "run-2", runMode: "preserve" }), itemCursor: 3, snapshotBlockIds: ["p-1"] }) }
  );

  const restored = coercePersistedReview(JSON.parse(JSON.stringify(serializeReviewState(state))));
  assert.ok(restored);

  const hydrated = reviewReducer(createInitialReviewState(), { type: "hydrate", persisted: restored });
  assert.deepEqual(hydrated.items.map((entry) => [entry.id, entry.status]), [["item-1", "ready"], ["item-2", "pending"], ["item-3", "dismissed"]]);
  assert.equal(hydrated.proposals["item-1"]?.status, "ready");
  assert.equal(hydrated.proposals["item-2"], undefined, "a request in flight does not survive a reload");
  assert.equal(hydrated.rejectedIdeas.length, 1);
  assert.equal(hydrated.decisions.length, 1);
  assert.equal(hydrated.filter, "clarity");
  assert.equal(hydrated.quiet, false, "quiet mode calls the model on its own, so a reload never switches it on");
  assert.equal(hydrated.focusId, null);
  assert.equal(hydrated.activeRun?.run.runId, "run-2");
  assert.equal(hydrated.activeRun?.capability, "signed-cap");
  assert.equal(hydrated.activeRun?.itemCursor, 3);
  assert.deepEqual(hydrated.activeRun?.snapshotBlockIds, ["p-1"]);
  assert.equal(selectPassState(hydrated, "clarity").status, "running");
  assert.equal(canApplyProposal(hydrated, "item-1"), true);
});

test("a pass that was only starting, with no run reference yet, is idle after a reload", () => {
  const state = reviewReducer(createInitialReviewState(), { type: "run/requested", passId: "clarity" });
  const restored = coercePersistedReview(JSON.parse(JSON.stringify(serializeReviewState(state))));
  assert.equal(restored?.passes.clarity?.status, "idle");
  assert.equal(restored?.activeRun, null);
});

test("damaged review data is left out instead of breaking the draft", () => {
  assert.equal(coercePersistedReview(undefined), null);
  assert.equal(coercePersistedReview("nope"), null);

  const coerced = coercePersistedReview({
    passes: { clarity: { status: "running" }, structure: { status: "weird" }, bogus: { status: "done" } },
    items: [item("item-1", "p-1"), { id: "broken" }, null],
    proposals: { "item-1": { id: "p", reviewItemId: "item-1", kind: "text_diff" }, "ghost": proposal("ghost", "p-1", "x") },
    decisions: [{ itemId: "item-1", outcome: "accepted", at: "t" }, { outcome: "accepted" }, 7],
    rejectedIdeas: "nope",
    activeRun: { version: 1, capability: "", run: {} },
    filter: "everything",
    quiet: "yes"
  });

  assert.ok(coerced);
  assert.deepEqual(coerced.items.map((entry) => entry.id), ["item-1"]);
  assert.deepEqual(coerced.proposals, {});
  assert.equal(coerced.decisions.length, 1);
  assert.deepEqual(coerced.rejectedIdeas, []);
  assert.equal(coerced.activeRun, null);
  assert.deepEqual(coerced.passes, { clarity: { status: "idle" } }, "running without a run reference cannot be resumed");
  assert.equal(coerced.filter, "all");
  assert.equal(coerced.quiet, false);
});

test("reset returns to an empty engine", () => {
  const state = reviewReducer(ready(withItems(item("item-1", "p-1")), "item-1", "p-1"), { type: "reset" });
  assert.deepEqual(state, createInitialReviewState());
});
