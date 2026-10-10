import test from "node:test";
import assert from "node:assert/strict";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import type { PersistedActiveReviewRun } from "../lib/editor/draft-state.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type {
  CustomRequestPlanAction,
  EditorialReviewRunProgress,
  EditorialReviewStepId,
  ReviewActionProposal
} from "../lib/editor/review-contract.ts";
import type { SpellFinding } from "../lib/v2/api.ts";
import { createV2Draft, inspectV2Draft, getV2DraftStorageKey } from "../lib/v2/draft-storage.ts";
import { buildItemMarks } from "../lib/v2/item-marks.ts";
import { getItemKind, type V2ReviewItem } from "../lib/v2/item-kinds.ts";
import { buildFactCheck, createAuthorQuery, type V2FactFinding } from "../lib/v2/overview.ts";
import { buildSpellItems } from "../lib/v2/spell-items.ts";
import {
  canAcceptItem,
  canApplyProposal,
  coercePersistedReview,
  createInitialReviewState,
  getItemPassId,
  getItemSource,
  getRunIdForStep,
  getRunStepId,
  normalizeInstruction,
  REQUEST_HISTORY_LIMIT,
  reviewReducer,
  selectNextQueuedPass,
  selectOpenItems,
  selectQueue,
  selectReviewBusy,
  selectRunningPassId,
  selectRunningRunId,
  selectRunState,
  serializeReviewState,
  shouldPersistAfter,
  type V2RequestEntry,
  type V2ReviewAction,
  type V2ReviewState,
  type V2RunId
} from "../lib/v2/store.ts";

const paragraph = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });

const P1 = "Аденозин накопичується в мозку протягом дня і створює тиск сну.";
const P2 = "Кофеїн повністю виводиться з організму за дві години після чашки кави.";
const P3 = "До вечора ми відчуваемо втому, а концентрація знижуеться.";

const baseDocument: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    paragraph("p-1", P1),
    paragraph("p-2", P2),
    paragraph("p-3", P3)
  ]
};

const context = (document: EditorDocument = baseDocument) => ({ document, revision: deriveManuscriptRevisionState(document) });
const edit = (document: EditorDocument, blockId: string, text: string): EditorDocument => ({
  version: 2,
  blocks: document.blocks.map((block) => (block.id === blockId ? paragraph(blockId, text) : block))
});

function item(id: string, blockId: string, overrides: Partial<V2ReviewItem> = {}): V2ReviewItem {
  return {
    id,
    reviewSessionId: "session-1",
    documentRevisionId: deriveManuscriptRevisionState(baseDocument).documentRevisionId,
    changeLevel: 5,
    title: `Пропозиція для ${blockId}`,
    reason: "Причина.",
    recommendation: "Що зробити.",
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

const manual = (id: string, blockId: string, overrides: Partial<V2ReviewItem> = {}) =>
  item(id, blockId, { origin: "manual", stepId: undefined, stepRunId: undefined, recommendationType: "rewrite", ...overrides });

function textProposal(itemId: string, blockId: string, text: string): ReviewActionProposal {
  return {
    id: `proposal-${itemId}`,
    reviewItemId: itemId,
    sourceRevisionId: "rev-1",
    targetRevisionId: "rev-1",
    kind: "text_diff",
    summary: "Спрощено",
    canApplyDirectly: true,
    textDiff: {
      op: "replace_blocks",
      blockIds: [blockId],
      oldBlocks: [baseDocument.blocks.find((block) => block.id === blockId)!],
      newBlocks: [paragraph(blockId, text)],
      reason: "Простіше."
    }
  };
}

const record = (
  stepId: EditorialReviewStepId,
  overrides: { runId?: string; progress?: EditorialReviewRunProgress; runMode?: "replace" | "preserve" } = {}
): PersistedActiveReviewRun => ({
  version: 1,
  run: {
    runId: overrides.runId ?? `run-${stepId}`,
    documentRevisionId: "rev-1",
    stepId,
    locale: "uk",
    provider: "openai",
    modelId: "gpt-6-luna",
    runMode: overrides.runMode ?? "replace",
    createdAt: "2026-10-10T10:00:00.000Z",
    status: "running",
    updatedAt: "2026-10-10T10:00:01.000Z",
    pollAfterMs: 1000,
    ...(overrides.progress ? { progress: overrides.progress } : {})
  },
  capability: "signed-cap",
  updatedAt: "2026-10-10T10:00:01.000Z",
  stale: false
});

const reduce = (state: V2ReviewState, ...actions: V2ReviewAction[]): V2ReviewState => actions.reduce(reviewReducer, state);
const initial = () => createInitialReviewState();
const reload = (state: V2ReviewState): V2ReviewState =>
  reduce(initial(), { type: "hydrate", persisted: coercePersistedReview(JSON.parse(JSON.stringify(serializeReviewState(state)))) });

const started = (runId: V2RunId, state: V2ReviewState = initial()) =>
  reduce(state, { type: "run/requested", passId: runId }, { type: "run/started", passId: runId, runMode: "replace", record: record(getRunStepId(runId)!) });

const REPORT = "## Головний діагноз розділу\n\nТекст щільний.\n\n| Місце | Проблема |\n| --- | --- |\n| абз. 2 | термін |";

/* ---------- run ids ---------- */

test("every review step has a home: a pass row or a step run", () => {
  const steps: EditorialReviewStepId[] = ["diagnostics", "fact_check", "structure", "clarity", "interest", "visuals", "formatting", "emphasis", "final_editing"];

  assert.deepEqual(
    steps.map((stepId) => getRunIdForStep(stepId)),
    ["diagnostics", "fact_check", "structure", "clarity", "interest", "visual", "formatting", "accent", "request"]
  );

  for (const stepId of steps) {
    assert.equal(getRunStepId(getRunIdForStep(stepId)!), stepId);
  }

  assert.equal(getRunStepId("spell"), undefined);
  assert.equal(getRunIdForStep(undefined), null);
});

/* ---------- diagnostics ---------- */

test("diagnostics runs through the same lifecycle as a pass and stores the report as written", () => {
  let state = reduce(initial(), { type: "run/requested", passId: "diagnostics" });

  assert.equal(selectRunState(state, "diagnostics").status, "running");
  assert.equal(selectRunningRunId(state), "diagnostics");
  assert.equal(selectRunningPassId(state), null, "no pass row is running");
  assert.deepEqual(state.passes, {});

  state = reduce(state, { type: "run/started", passId: "diagnostics", runMode: "replace", record: record("diagnostics") });
  assert.equal(state.activeRun?.run.stepId, "diagnostics");

  state = reduce(state, { type: "run/snapshot", passId: "diagnostics", record: record("diagnostics"), items: [], ...context() });
  assert.equal(selectRunState(state, "diagnostics").status, "running");

  state = reduce(state, {
    type: "run/completed",
    passId: "diagnostics",
    runMode: "replace",
    stepRunId: "step-diag",
    items: [],
    expertise: `\n${REPORT}\n`,
    at: "2026-10-10T10:05:00.000Z",
    ...context()
  });

  assert.equal(selectRunState(state, "diagnostics").status, "done");
  assert.equal(state.activeRun, null);
  assert.deepEqual(state.overview.diagnostics, { text: REPORT, at: "2026-10-10T10:05:00.000Z", mode: "concise" });
  assert.deepEqual(state.items, [], "diagnostics never puts anything into the queue");
});

test("the report keeps the mode it was made in; the mode cannot change while the chapter is being read", () => {
  let state = reduce(initial(), { type: "overview/modeSet", mode: "extended" });
  assert.equal(state.overview.diagnosticsMode, "extended");
  assert.equal(reduce(state, { type: "overview/modeSet", mode: "extended" }), state);

  state = started("diagnostics", state);
  assert.equal(reduce(state, { type: "overview/modeSet", mode: "concise" }), state);

  state = reduce(state, { type: "run/completed", passId: "diagnostics", runMode: "replace", stepRunId: "s", items: [], expertise: REPORT, ...context() });
  state = reduce(state, { type: "overview/modeSet", mode: "concise" });
  assert.equal(state.overview.diagnostics?.mode, "extended");
  assert.equal(state.overview.diagnosticsMode, "concise");
});

test("a failed or stopped rerun of diagnostics leaves the earlier report on screen", () => {
  const done = reduce(started("diagnostics"), {
    type: "run/completed",
    passId: "diagnostics",
    runMode: "replace",
    stepRunId: "s",
    items: [],
    expertise: REPORT,
    ...context()
  });

  const failed = reduce(started("diagnostics", done), { type: "run/failed", passId: "diagnostics", message: "Модель недоступна." });
  assert.equal(selectRunState(failed, "diagnostics").status, "failed");
  assert.equal(selectRunState(failed, "diagnostics").error, "Модель недоступна.");
  assert.equal(failed.overview.diagnostics?.text, REPORT);
  assert.equal(failed.activeRun, null);

  const stopped = reduce(started("diagnostics", done), { type: "run/stopped", passId: "diagnostics" });
  assert.deepEqual(selectRunState(stopped, "diagnostics"), { status: "idle", stopped: true });
  assert.equal(stopped.overview.diagnostics?.text, REPORT);
});

/* ---------- one run at a time: step runs and the pass queue ---------- */

test("a queued pass waits while a step run holds the review endpoint, and starts when it ends", () => {
  let state = started("fact_check");
  state = reduce(state, { type: "queue/set", passIds: ["structure", "clarity"] });

  assert.equal(selectNextQueuedPass(state), null, "the queue waits for the fact-check");
  assert.equal(selectReviewBusy(state), true);
  assert.deepEqual(state.queue, ["structure", "clarity"]);

  state = reduce(state, { type: "run/completed", passId: "fact_check", runMode: "replace", stepRunId: "s", items: [], factCheck: { findings: [], checkedCount: 0 }, ...context() });
  assert.equal(selectNextQueuedPass(state), "structure");
  assert.equal(selectReviewBusy(state), true, "still busy: the queue is being worked through");

  state = reduce(state, { type: "queue/cleared" });
  assert.equal(selectReviewBusy(state), false);
});

test("a paused queue from a stored draft does not block a step launcher; an active one does", () => {
  const paused = reload(reduce(initial(), { type: "queue/set", passIds: ["clarity"] }));
  assert.equal(paused.queuePaused, true);
  assert.equal(selectReviewBusy(paused), false);
  assert.equal(selectReviewBusy(reduce(paused, { type: "queue/resumed" })), true);
});

test("a failed step run does not disturb the pass queue or the state of the passes", () => {
  let state = reduce(initial(), { type: "queue/set", passIds: ["clarity"] });
  state = reduce(state, { type: "run/failed", passId: "diagnostics", message: "У розділі немає тексту." });

  assert.deepEqual(state.queue, ["clarity"]);
  assert.deepEqual(state.passes, {});
  assert.equal(selectRunState(state, "diagnostics").error, "У розділі немає тексту.");
});

/* ---------- reload ---------- */

test("a step run in flight survives a reload with its run reference and is resumable", () => {
  for (const runId of ["diagnostics", "fact_check", "request"] as const) {
    const restored = reload(started(runId));

    assert.equal(restored.activeRun?.run.stepId, getRunStepId(runId), `${runId}: the run reference is kept`);
    assert.equal(selectRunState(restored, runId).status, "running", `${runId}: still running`);
    assert.equal(selectRunningRunId(restored), runId);

    const resumed = reduce(restored, { type: "run/resumed", passId: runId, record: restored.activeRun! });
    assert.equal(selectRunState(resumed, runId).status, "running");
  }
});

test("a step that was only requested (no run reference yet) is idle after a reload, never stuck running", () => {
  const restored = reload(reduce(initial(), { type: "run/requested", passId: "diagnostics" }));
  assert.equal(selectRunState(restored, "diagnostics").status, "idle");
  assert.equal(selectRunningRunId(restored), null);
});

test("a stored 'running' step that does not match the stored run is not trusted", () => {
  const persisted = serializeReviewState(started("diagnostics"));
  const coerced = coercePersistedReview({ ...persisted, steps: { diagnostics: { status: "running" }, fact_check: { status: "running" } } });

  assert.equal(coerced?.steps?.diagnostics?.status, "running");
  assert.equal(coerced?.steps?.fact_check?.status, "idle");
});

test("reports, findings, author queries and the request history survive a reload", () => {
  const { findings, items } = buildFactCheck({
    rows: [{ claim: "Кофеїн повністю виводиться з організму за дві години", status: "questionable", explanation: "Ні.", sources: [{ title: "НІЗ", url: "https://nih.gov/x", domain: "nih.gov" }] }],
    ...context(),
    reviewSessionId: "session-fact",
    stepRunId: "step-fact",
    locale: "uk",
    createItemId: () => "fact-item-1"
  });
  const entry: V2RequestEntry = { id: "req-1", scope: "fragment", text: "Простіше", quote: "Кофеїн повністю", where: "абз. 2", at: "2026-10-10T10:00:00.000Z", outcome: { kind: "done", count: 1 } };

  const state = reduce(
    started("diagnostics"),
    { type: "run/completed", passId: "diagnostics", runMode: "replace", stepRunId: "sd", items: [], expertise: REPORT, at: "2026-10-10T10:05:00.000Z", ...context() },
    { type: "run/requested", passId: "fact_check" },
    { type: "run/started", passId: "fact_check", runMode: "replace", record: record("fact_check") },
    { type: "run/completed", passId: "fact_check", runMode: "replace", stepRunId: "step-fact", items, factCheck: { findings, checkedCount: 3 }, at: "2026-10-10T10:08:00.000Z", ...context() },
    { type: "author/added", query: createAuthorQuery(findings[0]!, "2026-10-10T10:09:00.000Z", "q-1") },
    { type: "author/noteSet", id: "q-1", note: "Звідки дві години?" },
    { type: "request/logged", entry, role: "fragment" },
    { type: "request/settled", entryId: "req-1", outcome: { kind: "done", count: 1 } }
  );
  const restored = reload(state);

  assert.deepEqual(restored.overview, state.overview);
  assert.equal(restored.overview.diagnostics?.text, REPORT);
  assert.equal(restored.overview.factCheck?.findings[0]?.itemId, "fact-item-1");
  assert.equal(restored.overview.authorQueries[0]?.note, "Звідки дві години?");
  assert.deepEqual(restored.request.history, [entry]);
  assert.equal(restored.items.find((entry) => entry.id === "fact-item-1")?.stepId, "fact_check");
  assert.equal(restored.activeRun, null, "nothing is in flight, so nothing can resume");
  assert.equal(selectRunningRunId(restored), null);
  assert.equal(selectRunState(restored, "diagnostics").status, "done");
});

test("a Milestone 3 draft (no steps, overview or request) opens with its queue and empty new sections", () => {
  const m3 = {
    passes: { clarity: { status: "done", lastRunItemCount: 1 } },
    items: [item("a", "p-1")],
    proposals: { a: textProposal("a", "p-1", "Простіше.") },
    decisions: [],
    rejectedIdeas: [],
    activeRun: null,
    filter: "clarity",
    quiet: false,
    queue: ["structure"],
    failed: {}
  };
  const restored = reduce(initial(), { type: "hydrate", persisted: coercePersistedReview(JSON.parse(JSON.stringify(m3))) });

  assert.equal(restored.items.length, 1);
  assert.equal(restored.proposals.a?.status, "ready");
  assert.equal(restored.filter, "clarity");
  assert.deepEqual(restored.queue, ["structure"]);
  assert.deepEqual(restored.steps, {});
  assert.deepEqual(restored.overview, initial().overview);
  assert.deepEqual(restored.request, initial().request);

  // And through the draft storage itself.
  const storage = new Map<string, string>();
  storage.set(getV2DraftStorageKey("uk"), JSON.stringify({ version: 1, document: baseDocument, sourceName: null, review: m3, updatedAt: "2026-10-10T10:00:00.000Z" }));
  const inspection = inspectV2Draft({ getItem: (key) => storage.get(key) ?? null }, "uk");
  assert.equal(inspection.status, "ok");
  assert.deepEqual(inspection.status === "ok" && inspection.draft.review?.overview, initial().overview);
});

test("a draft written now round-trips through the draft storage", () => {
  const state = reduce(
    started("diagnostics"),
    { type: "run/completed", passId: "diagnostics", runMode: "replace", stepRunId: "sd", items: [], expertise: REPORT, at: "t", ...context() },
    { type: "request/logged", entry: { id: "req-1", scope: "chapter", text: "Скороти вступ", at: "t", outcome: { kind: "running" } }, role: "chapter" },
    { type: "request/settled", entryId: "req-1", outcome: { kind: "error", message: "Провайдер недоступний." } }
  );
  const storage = new Map<string, string>();
  storage.set(getV2DraftStorageKey("uk"), JSON.stringify(createV2Draft(baseDocument, null, serializeReviewState(state))));
  const inspection = inspectV2Draft({ getItem: (key) => storage.get(key) ?? null }, "uk");

  assert.equal(inspection.status, "ok");

  const restored = reduce(initial(), { type: "hydrate", persisted: inspection.status === "ok" ? inspection.draft.review ?? null : null });
  assert.equal(restored.overview.diagnostics?.text, REPORT);
  assert.deepEqual(restored.request.history[0]?.outcome, { kind: "error", message: "Провайдер недоступний." });
});

test("opening another manuscript clears reports and requests but keeps the chosen diagnostics mode", () => {
  const state = reduce(
    reduce(initial(), { type: "overview/modeSet", mode: "extended" }),
    { type: "run/requested", passId: "diagnostics" },
    { type: "run/started", passId: "diagnostics", runMode: "replace", record: record("diagnostics") },
    { type: "run/completed", passId: "diagnostics", runMode: "replace", stepRunId: "s", items: [], expertise: REPORT, ...context() },
    { type: "reset" }
  );

  assert.equal(state.overview.diagnostics, null);
  assert.equal(state.overview.diagnosticsMode, "extended");
  assert.deepEqual(state.steps, {});
  assert.deepEqual(state.request, initial().request);
});

/* ---------- fact-check ---------- */

const factRows = [
  { claim: "Кофеїн повністю виводиться з організму за дві години", status: "questionable" as const, explanation: "Період напіввиведення довший.", sources: [{ title: "НІЗ", url: "https://nih.gov/x", domain: "nih.gov" }] },
  { claim: "Кофеїн виводиться з організму після чашки кави миттєво", status: "unsupported" as const, explanation: "Немає джерел.", sources: [] }
];

function factChecked(state: V2ReviewState = initial(), idPrefix = "fact-item", document: EditorDocument = baseDocument) {
  const built = buildFactCheck({
    rows: factRows,
    ...context(document),
    reviewSessionId: "session-fact",
    stepRunId: `step-${idPrefix}`,
    locale: "uk",
    createItemId: (index) => `${idPrefix}-${index + 1}`
  });

  return {
    built,
    state: reduce(started("fact_check", state), {
      type: "run/completed",
      passId: "fact_check",
      runMode: "replace",
      stepRunId: `step-${idPrefix}`,
      items: built.items,
      factCheck: { findings: built.findings, checkedCount: 5 },
      at: "2026-10-10T10:08:00.000Z",
      ...context(document)
    })
  };
}

test("fact-check findings are stored and their linked suggestions join the queue as their own source", () => {
  const { state } = factChecked();

  assert.equal(selectRunState(state, "fact_check").status, "done");
  assert.equal(state.overview.factCheck?.findings.length, 2);
  assert.equal(state.overview.factCheck?.checkedCount, 5);

  // Two claims of one paragraph are two cards (the classic merge would keep one per type and anchor).
  const queue = selectQueue(state);
  assert.deepEqual(queue.map((entry) => entry.id), ["fact-item-1", "fact-item-2"]);
  assert.deepEqual(queue.map((entry) => getItemKind(entry)), ["replace", "callout"]);

  for (const entry of queue) {
    assert.equal(getItemSource(entry), "fact");
    assert.equal(getItemPassId(entry), null, "not under any pass filter");
    assert.equal(entry.stepId, "fact_check");
  }

  // Every finding points at a card that exists.
  for (const finding of state.overview.factCheck!.findings) {
    assert.ok(state.items.some((entry) => entry.id === finding.itemId));
  }

  assert.deepEqual(
    buildItemMarks(state, { locale: "uk", getDiff: () => undefined }).map((mark) => mark.tone),
    ["fact", "fact"]
  );
});

test("a fact-check that flags nothing is a finished run with an honest empty report", () => {
  const state = reduce(started("fact_check"), {
    type: "run/completed",
    passId: "fact_check",
    runMode: "replace",
    stepRunId: "s",
    items: [],
    factCheck: { findings: [], checkedCount: 4 },
    ...context()
  });

  assert.equal(selectRunState(state, "fact_check").status, "done");
  assert.deepEqual(state.overview.factCheck, { findings: [], at: "", checkedCount: 4 });
  assert.deepEqual(state.items, []);
});

test("a rerun keeps the earlier findings and cards until the new result is in, then replaces them", () => {
  const first = factChecked().state;
  const rerunning = started("fact_check", first);

  assert.equal(rerunning.overview.factCheck?.findings.length, 2);
  assert.equal(selectOpenItems(rerunning).length, 2);

  const failed = reduce(rerunning, { type: "run/failed", passId: "fact_check", message: "Тайм-аут." });
  assert.equal(failed.overview.factCheck?.findings.length, 2);
  assert.equal(selectOpenItems(failed).length, 2);

  const second = factChecked(first, "fact-again").state;
  assert.deepEqual(selectOpenItems(second).map((entry) => entry.id), ["fact-again-1", "fact-again-2"]);
  assert.ok(second.overview.factCheck?.findings.every((finding) => finding.itemId?.startsWith("fact-again")));
});

test("a finding whose linked item did not make it into the queue is not left pointing at nothing", () => {
  const orphan: V2FactFinding = { id: "f-1", claim: "Твердження", status: "questionable", explanation: "", sources: [], blockId: "p-2", itemId: "ghost" };
  const state = reduce(started("fact_check"), {
    type: "run/completed",
    passId: "fact_check",
    runMode: "replace",
    stepRunId: "s",
    items: [],
    factCheck: { findings: [orphan], checkedCount: 1 },
    ...context()
  });

  assert.equal(state.overview.factCheck?.findings[0]?.itemId, null);
});

test("a linked suggestion goes stale with its paragraph like any other card", () => {
  const { state } = factChecked();
  const edited = edit(baseDocument, "p-2", "Зовсім інший текст.");
  const reconciled = reduce(state, { type: "items/reconciled", ...context(edited) });

  assert.equal(reconciled.items.find((entry) => entry.id === "fact-item-1")?.status, "stale");
});

/* ---------- author queries ---------- */

test("author queries: add once, note, remove", () => {
  const { state, built } = factChecked();
  const query = createAuthorQuery(built.findings[0]!, "2026-10-10T10:09:00.000Z", "q-1");
  let next = reduce(state, { type: "author/added", query });

  assert.equal(next.overview.authorQueries.length, 1);
  assert.equal(reduce(next, { type: "author/added", query: { ...query, id: "q-2" } }), next, "the same claim is not listed twice");

  next = reduce(next, { type: "author/noteSet", id: "q-1", note: "Уточніть джерело." });
  assert.equal(next.overview.authorQueries[0]?.note, "Уточніть джерело.");
  assert.equal(reduce(next, { type: "author/noteSet", id: "q-1", note: "Уточніть джерело." }), next);

  // The list is the editor's own: a later fact-check run does not touch it.
  const rerun = factChecked(next, "fact-again").state;
  assert.equal(rerun.overview.authorQueries[0]?.note, "Уточніть джерело.");

  next = reduce(next, { type: "author/removed", id: "q-1" });
  assert.deepEqual(next.overview.authorQueries, []);
  assert.equal(reduce(next, { type: "author/removed", id: "q-1" }), next);

  for (const action of [{ type: "author/added", query } as const, { type: "author/noteSet", id: "q-1", note: "x" } as const, { type: "author/removed", id: "q-1" } as const]) {
    assert.equal(shouldPersistAfter(action), true);
  }
});

/* ---------- the chapter request ---------- */

const plan: CustomRequestPlanAction[] = [
  { blockId: "p-1", recommendationType: "simplify", title: "Спростити вступ", recommendation: "Спростити.", priority: "medium" },
  { blockId: "p-2", recommendationType: "rewrite", title: "Уточнити цифру", recommendation: "Переписати.", priority: "high" },
  { blockId: "p-3", recommendationType: "callout", title: "Додати врізку", recommendation: "Врізка.", priority: "low" }
];

const requestItem = (id: string, blockId: string, overrides: Partial<V2ReviewItem> = {}) =>
  item(id, blockId, { stepId: "final_editing", stepRunId: "step-request", ...overrides });

function requested(instruction = "Скороти вступ удвічі", state: V2ReviewState = initial(), entryId = "req-1"): V2ReviewState {
  return reduce(
    state,
    {
      type: "request/logged",
      role: "chapter",
      instruction,
      entry: { id: entryId, scope: "chapter", text: instruction, at: "2026-10-10T10:00:00.000Z", outcome: { kind: "running" } }
    },
    { type: "run/requested", passId: "request" },
    { type: "run/started", passId: "request", runMode: "replace", record: record("final_editing") }
  );
}

test("an instruction is required: blank text is nothing to send", () => {
  assert.equal(normalizeInstruction(""), null);
  assert.equal(normalizeInstruction("  \n\t "), null);
  assert.equal(normalizeInstruction("  Скороти вступ  "), "Скороти вступ");
});

test("a chapter request is logged, goes through planning and generating, and its cards join the queue", () => {
  let state = requested();

  assert.deepEqual(state.request.history.map((entry) => [entry.text, entry.outcome.kind]), [["Скороти вступ удвічі", "running"]]);
  assert.equal(state.request.chapterEntryId, "req-1");
  assert.equal(state.request.instruction, "Скороти вступ удвічі");
  assert.equal(selectRunningRunId(state), "request");

  // Planning: nothing to count yet, but the phase is known.
  state = reduce(state, {
    type: "run/snapshot",
    passId: "request",
    record: record("final_editing", { progress: { completedChunks: 0, totalChunks: 0, phase: "planning" } }),
    items: [],
    ...context()
  });
  assert.deepEqual(selectRunState(state, "request").progress, { completed: 0, total: 0, percent: 0, phase: "planning" });
  assert.equal(state.request.plan, null);

  // The plan arrives, then cards stream in while generating.
  state = reduce(state, {
    type: "run/snapshot",
    passId: "request",
    record: record("final_editing", { progress: { completedChunks: 1, totalChunks: 3, phase: "generating" } }),
    items: [requestItem("r-1", "p-1")],
    plan,
    ...context()
  });
  assert.equal(selectRunState(state, "request").progress?.phase, "generating");
  assert.equal(selectRunState(state, "request").progress?.completed, 1);
  assert.equal(selectRunState(state, "request").progress?.total, 3);
  assert.deepEqual(state.request.plan, plan);
  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["r-1"]);

  state = reduce(state, {
    type: "run/completed",
    passId: "request",
    runMode: "replace",
    stepRunId: "step-request",
    items: [requestItem("r-1", "p-1"), requestItem("r-2", "p-2"), requestItem("r-3", "p-3", { recommendationType: "callout", suggestedAction: "prepare_callout", insertionPoint: { mode: "after", anchorBlockId: "p-3" } })],
    plan,
    holes: [],
    ...context()
  });

  assert.equal(selectRunState(state, "request").status, "done");
  assert.deepEqual(state.request.history[0]?.outcome, { kind: "done", count: 3 });
  assert.deepEqual(selectQueue(state).map((entry) => [entry.id, getItemKind(entry), getItemSource(entry), getItemPassId(entry)]), [
    ["r-1", "replace", "request", null],
    ["r-2", "replace", "request", null],
    ["r-3", "callout", "request", null]
  ]);
  assert.equal(buildItemMarks(state, { locale: "uk", getDiff: () => undefined })[0]?.tone, "request");
});

test("request cards behave like any other card: prepare, accept-ready, reject, and never under a pass filter", () => {
  let state = reduce(requested(), {
    type: "run/completed",
    passId: "request",
    runMode: "replace",
    stepRunId: "step-request",
    items: [requestItem("r-1", "p-1")],
    ...context()
  });

  state = reduce(state, { type: "proposal/requested", item: state.items[0]! }, { type: "proposal/ready", itemId: "r-1", proposal: textProposal("r-1", "p-1", "Простіше.") });
  assert.equal(canApplyProposal(state, "r-1"), true);

  assert.deepEqual(selectQueue(reduce(state, { type: "filter/set", filter: "clarity" })), []);

  state = reduce(state, { type: "item/rejected", itemId: "r-1", at: "t" });
  assert.equal(state.items[0]?.status, "dismissed");
  assert.equal(state.rejectedIdeas.length, 1);
});

test("holes are kept with the plan and each can be retried on its own", () => {
  let state = reduce(requested(), {
    type: "run/completed",
    passId: "request",
    runMode: "replace",
    stepRunId: "step-request",
    items: [requestItem("r-1", "p-1")],
    plan,
    holes: [
      { index: 1, message: "Модель не повернула правку." },
      { index: 2, message: "Модель не повернула правку." }
    ],
    ...context()
  });

  assert.deepEqual(state.request.history[0]?.outcome, { kind: "done", count: 1, holes: 2 });
  assert.deepEqual(state.request.holes.map((hole) => hole.index), [1, 2]);
  assert.deepEqual(state.request.plan, plan);

  // Retry of action 1 succeeds: its card is added (the first one stays), its hole is closed.
  state = reduce(
    state,
    { type: "run/requested", passId: "request", retryIndex: 1 },
    { type: "run/started", passId: "request", runMode: "preserve", record: record("final_editing", { runMode: "preserve", runId: "run-retry-1" }) }
  );
  assert.equal(state.request.retryIndex, 1);
  assert.deepEqual(state.request.plan, plan, "a retry keeps the plan it retries from");
  assert.equal(state.request.holes.length, 2);
  assert.equal(selectRunState(state, "request").replaceOnResult, undefined, "a retry never replaces the cards already there");

  state = reduce(state, {
    type: "run/completed",
    passId: "request",
    runMode: "preserve",
    stepRunId: "step-retry",
    items: [requestItem("r-2", "p-2")],
    ...context()
  });
  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["r-1", "r-2"]);
  assert.deepEqual(state.request.holes.map((hole) => hole.index), [2]);
  assert.equal(state.request.retryIndex, null);
  assert.deepEqual(state.request.history[0]?.outcome, { kind: "done", count: 2, holes: 1 });

  // Retry of action 2 fails: the hole stays, with what the server said this time; the history is untouched.
  state = reduce(
    state,
    { type: "run/requested", passId: "request", retryIndex: 2 },
    { type: "run/started", passId: "request", runMode: "preserve", record: record("final_editing", { runMode: "preserve", runId: "run-retry-2" }) },
    { type: "run/failed", passId: "request", message: "Провайдер відповів 503." }
  );
  assert.deepEqual(state.request.holes, [{ index: 2, message: "Провайдер відповів 503." }]);
  assert.deepEqual(state.request.history[0]?.outcome, { kind: "done", count: 2, holes: 1 });
  assert.equal(selectRunState(state, "request").error, "Провайдер відповів 503.");
  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["r-1", "r-2"]);

  // A stopped retry changes neither the holes nor the history.
  const stopped = reduce(
    state,
    { type: "run/requested", passId: "request", retryIndex: 2 },
    { type: "run/started", passId: "request", runMode: "preserve", record: record("final_editing", { runMode: "preserve", runId: "run-retry-3" }) },
    { type: "run/stopped", passId: "request" }
  );
  assert.equal(stopped.request.holes.length, 1);
  assert.equal(stopped.request.retryIndex, null);
  assert.deepEqual(stopped.request.history[0]?.outcome, { kind: "done", count: 2, holes: 1 });
});

test("a request that fails while writing keeps its plan, so every planned action is a retryable hole", () => {
  const state = reduce(requested(), {
    type: "run/failed",
    passId: "request",
    message: "Провайдер недоступний.",
    plan,
    holes: plan.map((_, index) => ({ index, message: "Провайдер недоступний." }))
  });

  assert.deepEqual(state.request.history[0]?.outcome, { kind: "error", message: "Провайдер недоступний." });
  assert.equal(state.request.holes.length, 3);
  assert.deepEqual(state.request.plan, plan);
  assert.equal(selectRunState(state, "request").status, "failed");
});

test("a stopped request is recorded as stopped; a new request starts with a clean plan", () => {
  let state = reduce(requested(), { type: "run/stopped", passId: "request" });
  assert.deepEqual(state.request.history[0]?.outcome, { kind: "stopped" });

  state = reduce(state, { type: "run/failed", passId: "request", message: "x", plan, holes: [{ index: 0, message: "x" }] });
  state = requested("Додай приклад із життя", state, "req-2");

  assert.deepEqual(state.request.history.map((entry) => entry.id), ["req-2", "req-1"]);
  assert.equal(state.request.plan, null);
  assert.deepEqual(state.request.holes, []);
  assert.equal(state.request.instruction, "Додай приклад із життя");
});

test("a rerun of the chapter request keeps the earlier cards until the new run delivers", () => {
  const first = reduce(requested(), {
    type: "run/completed",
    passId: "request",
    runMode: "replace",
    stepRunId: "step-request",
    items: [requestItem("r-1", "p-1")],
    ...context()
  });
  const rerunning = requested("Інакше", first, "req-2");
  assert.deepEqual(selectQueue(rerunning).map((entry) => entry.id), ["r-1"]);

  const delivered = reduce(rerunning, { type: "run/snapshot", passId: "request", record: record("final_editing"), items: [requestItem("r-9", "p-3")], ...context() });
  assert.deepEqual(selectQueue(delivered).map((entry) => entry.id), ["r-9"]);
});

test("a chapter request in flight survives a reload with its entry still running; a retry keeps its index", () => {
  const restored = reload(requested());
  assert.equal(restored.request.history[0]?.outcome.kind, "running");
  assert.equal(restored.request.chapterEntryId, "req-1");
  assert.equal(selectRunState(restored, "request").status, "running");

  const completed = reduce(
    restored,
    { type: "run/resumed", passId: "request", record: restored.activeRun! },
    { type: "run/completed", passId: "request", runMode: "replace", stepRunId: "s", items: [requestItem("r-1", "p-1")], ...context() }
  );
  assert.deepEqual(completed.request.history[0]?.outcome, { kind: "done", count: 1 });

  const retrying = reduce(
    reduce(requested(), { type: "run/failed", passId: "request", message: "x", plan, holes: [{ index: 1, message: "x" }] }),
    { type: "run/requested", passId: "request", retryIndex: 1 },
    { type: "run/started", passId: "request", runMode: "preserve", record: record("final_editing", { runMode: "preserve" }) }
  );
  assert.equal(reload(retrying).request.retryIndex, 1);
});

test("a request whose run cannot be resumed is shown as interrupted after a reload, and nothing is sent again", () => {
  // Logged, but the server had not accepted the run yet.
  const early = reload(
    reduce(initial(), {
      type: "request/logged",
      role: "chapter",
      entry: { id: "req-1", scope: "chapter", text: "Скороти", at: "t", outcome: { kind: "running" } }
    })
  );
  assert.deepEqual(early.request.history[0]?.outcome, { kind: "interrupted" });
  assert.equal(early.activeRun, null);
  assert.equal(selectRunningRunId(early), null);

  // A fragment request has nothing to resume at all.
  const fragment = reduce(initial(), {
    type: "request/logged",
    role: "fragment",
    label: "Простіше",
    entry: { id: "frag-1", scope: "fragment", text: "Простіше", quote: "Кофеїн", where: "абз. 2", at: "t", outcome: { kind: "running" } }
  });
  assert.deepEqual(fragment.request.fragment, { entryId: "frag-1", label: "Простіше" });

  const restored = reload(fragment);
  assert.deepEqual(restored.request.history[0]?.outcome, { kind: "interrupted" });
  assert.equal(restored.request.fragment, null);
  assert.equal(restored.request.clarify, null);
});

/* ---------- fragment requests in the store ---------- */

test("a fragment request is logged running, settled once, and frees the composer", () => {
  const entry: V2RequestEntry = { id: "frag-1", scope: "fragment", text: "Коротше", quote: "Кофеїн повністю", where: "абз. 2", at: "t", outcome: { kind: "running" } };
  let state = reduce(initial(), { type: "request/logged", role: "fragment", label: "Коротше", entry });

  assert.deepEqual(state.request.fragment, { entryId: "frag-1", label: "Коротше" });
  assert.equal(state.request.chapterEntryId, null, "a fragment request is not the chapter request");

  state = reduce(state, { type: "request/settled", entryId: "frag-1", outcome: { kind: "error", message: "Model gemini-nope was not found." } });
  assert.equal(state.request.fragment, null);
  assert.deepEqual(state.request.history[0]?.outcome, { kind: "error", message: "Model gemini-nope was not found." });

  assert.equal(reduce(state, { type: "request/settled", entryId: "missing", outcome: { kind: "stopped" } }), state);
});

test("a router question is held until answered; the answer continues the same history entry", () => {
  const entry: V2RequestEntry = { id: "frag-1", scope: "fragment", text: "Зроби щось", at: "t", outcome: { kind: "running" } };
  const question = { entryId: "frag-1", prompt: "Зроби щось", blockIds: ["p-2"], quote: "Кофеїн", choices: ["patch" as const, "callout" as const, "visual" as const] };
  let state = reduce(
    initial(),
    { type: "request/logged", role: "fragment", entry },
    { type: "request/settled", entryId: "frag-1", outcome: { kind: "question" } },
    { type: "clarify/set", clarify: question }
  );

  assert.equal(state.request.fragment, null, "nothing is in flight while the question is open");
  assert.deepEqual(state.request.clarify, question);
  assert.equal(state.request.history[0]?.outcome.kind, "question");
  assert.equal(shouldPersistAfter({ type: "clarify/set", clarify: question }), false);

  state = reduce(state, { type: "request/logged", role: "fragment", entry: { ...entry, outcome: { kind: "running" } } });
  assert.equal(state.request.history.length, 1, "the same entry, not a second one");
  assert.equal(state.request.history[0]?.outcome.kind, "running");
  assert.equal(state.request.clarify, null);
  assert.equal(state.request.fragment?.entryId, "frag-1");
});

test("the history keeps the latest requests only", () => {
  let state = initial();

  for (let index = 0; index < REQUEST_HISTORY_LIMIT + 5; index += 1) {
    state = reduce(state, {
      type: "request/logged",
      role: "fragment",
      entry: { id: `frag-${index}`, scope: "fragment", text: `Запит ${index}`, at: "t", outcome: { kind: "running" } }
    });
    state = reduce(state, { type: "request/settled", entryId: `frag-${index}`, outcome: { kind: "done", count: 0 } });
  }

  assert.equal(state.request.history.length, REQUEST_HISTORY_LIMIT);
  assert.equal(state.request.history[0]?.id, `frag-${REQUEST_HISTORY_LIMIT + 4}`);
});

/* ---------- one hand-made item into the queue ---------- */

test("a hand-made item joins the queue in manuscript order, checked against the text, with its own tone", () => {
  let state = reduce(initial(), { type: "run/requested", passId: "clarity" }, { type: "run/started", passId: "clarity", runMode: "replace", record: record("clarity") });
  state = reduce(state, { type: "run/completed", passId: "clarity", runMode: "replace", stepRunId: "s", items: [item("a", "p-1"), item("c", "p-3")], ...context() });

  const added = manual("m-1", "p-2", { status: "ready", activeProposalId: "proposal-m-1" });
  state = reduce(state, { type: "item/added", item: added, proposal: textProposal("m-1", "p-2", "Кофеїн виводиться довго."), ...context() });

  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["a", "m-1", "c"]);
  assert.equal(state.items.find((entry) => entry.id === "m-1")?.status, "ready");
  assert.equal(canApplyProposal(state, "m-1"), true, "it arrived prepared: the diff can be drawn and accepted");
  assert.equal(getItemSource(state.items.find((entry) => entry.id === "m-1")!), "request");
  assert.equal(shouldPersistAfter({ type: "item/added", item: added, ...context() }), true);

  // Adding the same id again changes nothing.
  assert.equal(reduce(state, { type: "item/added", item: added, ...context() }), state);

  // A clarity rerun replaces clarity cards only; what the editor asked for by hand stays.
  state = reduce(
    state,
    { type: "run/requested", passId: "clarity" },
    { type: "run/started", passId: "clarity", runMode: "replace", record: record("clarity", { runId: "run-2" }) },
    { type: "run/completed", passId: "clarity", runMode: "replace", stepRunId: "s2", items: [item("z", "p-3")], ...context() }
  );
  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["m-1", "z"]);
});

test("a hand-made item for text that has changed since is stale on arrival, not acceptable", () => {
  const edited = edit(baseDocument, "p-2", "Інший текст абзацу.");
  const state = reduce(initial(), {
    type: "item/added",
    item: manual("m-1", "p-2", { status: "ready" }),
    proposal: textProposal("m-1", "p-2", "Нове."),
    ...context(edited)
  });

  assert.equal(state.items[0]?.status, "stale");
  assert.equal(canApplyProposal(state, "m-1"), false);
});

test("a second request of the same kind for the same blocks replaces the open one; other kinds and decided ones stay", () => {
  let state = reduce(initial(), { type: "item/added", item: manual("m-1", "p-2", { status: "ready" }), proposal: textProposal("m-1", "p-2", "Версія один."), ...context() });
  state = reduce(state, { type: "item/added", item: manual("m-callout", "p-2", { recommendationType: "callout", suggestedAction: "prepare_callout", insertionPoint: { mode: "after", anchorBlockId: "p-2" } }), ...context() });
  state = reduce(state, { type: "item/added", item: manual("m-2", "p-2", { status: "ready" }), proposal: textProposal("m-2", "p-2", "Версія два."), ...context() });

  assert.deepEqual(selectQueue(state).map((entry) => entry.id).sort(), ["m-2", "m-callout"]);
  assert.equal("m-1" in state.proposals, false, "the proposal of the replaced item goes with it");

  // A rejected one is history, not something to replace.
  state = reduce(state, { type: "item/rejected", itemId: "m-2", at: "t" });
  state = reduce(state, { type: "item/added", item: manual("m-3", "p-2", { status: "ready" }), proposal: textProposal("m-3", "p-2", "Версія три."), ...context() });
  assert.equal(state.items.find((entry) => entry.id === "m-2")?.status, "dismissed");
  assert.equal(state.items.find((entry) => entry.id === "m-3")?.status, "ready");

  // A model suggestion on the same paragraph is never replaced by a hand-made one.
  const withReview = reduce(
    reduce(initial(), { type: "run/requested", passId: "clarity" }, { type: "run/started", passId: "clarity", runMode: "replace", record: record("clarity") }),
    { type: "run/completed", passId: "clarity", runMode: "replace", stepRunId: "s", items: [item("a", "p-2")], ...context() },
    { type: "item/added", item: manual("m-1", "p-2"), ...context() }
  );
  assert.deepEqual(selectQueue(withReview).map((entry) => entry.id).sort(), ["a", "m-1"]);
});

test("a manual illustration item is a card that cannot be accepted yet", () => {
  const visual = manual("m-vis", "p-2", { recommendationType: "visual", suggestedAction: "prepare_visual", insertionPoint: { mode: "after", anchorBlockId: "p-2" }, visualIntent: "infographic" });
  const state = reduce(initial(), { type: "item/added", item: visual, ...context() });

  assert.equal(getItemKind(state.items[0]!), "visual");
  assert.equal(state.items[0]?.status, "pending");
  assert.equal(canAcceptItem(state, "m-vis"), false);
  assert.equal(getItemSource(state.items[0]!), "request");
});

test("a cancelled preparation leaves the card as it was before it was asked for", () => {
  let state = reduce(initial(), { type: "item/added", item: manual("m-1", "p-2", { recommendationType: "list" }), ...context() });
  state = reduce(state, { type: "proposal/requested", item: state.items[0]! });
  assert.equal(state.proposals["m-1"]?.status, "preparing");

  state = reduce(state, { type: "proposal/cancelled", itemId: "m-1" });
  assert.equal("m-1" in state.proposals, false);
  assert.equal(state.items[0]?.status, "pending");
  assert.equal(reduce(state, { type: "proposal/cancelled", itemId: "m-1" }), state);

  // A late answer to the cancelled request is ignored.
  assert.equal(reduce(state, { type: "proposal/ready", itemId: "m-1", proposal: textProposal("m-1", "p-2", "Пізно.") }), state);

  // Cancelling a regeneration brings the earlier proposal back.
  let ready = reduce(state, { type: "proposal/requested", item: state.items[0]! }, { type: "proposal/ready", itemId: "m-1", proposal: textProposal("m-1", "p-2", "Перша.") });
  ready = reduce(ready, { type: "proposal/requested", item: ready.items[0]! }, { type: "proposal/cancelled", itemId: "m-1" });
  assert.equal(ready.proposals["m-1"]?.status, "ready");
  assert.equal(canApplyProposal(ready, "m-1"), true);
});

/* ---------- accents from other sources ---------- */

test("an accent is recognised by what it carries, not only by the step it came from", () => {
  assert.equal(getItemKind(item("a", "p-1", { stepId: "emphasis", recommendationType: "rewrite", emphasisTarget: { text: "тиск сну" } })), "accent");
  assert.equal(getItemKind(item("a", "p-1", { stepId: "emphasis", recommendationType: "rewrite" })), "accent", "an emphasis item without a phrase is still an accent");
  assert.equal(getItemKind(item("a", "p-1", { stepId: "final_editing", recommendationType: "rewrite", emphasisTarget: { text: "тиск сну" } })), "accent");
  assert.equal(getItemKind(manual("a", "p-1", { emphasisTarget: { text: "тиск сну" } })), "accent");

  // Without a phrase, items of other sources are what their type says.
  assert.equal(getItemKind(item("a", "p-1", { stepId: "final_editing", recommendationType: "rewrite" })), "replace");
  assert.equal(getItemKind(item("a", "p-1", { stepId: "final_editing", recommendationType: "rewrite", emphasisTarget: { text: "   " } })), "replace");
  assert.equal(getItemKind(item("a", "p-1", { stepId: "fact_check", recommendationType: "callout", emphasisTarget: { text: "тиск сну" } })), "callout");
  assert.equal(getItemKind(item("a", "p-1", { stepId: "final_editing", recommendationType: "subsection", emphasisTarget: { text: "тиск сну" } })), "heading");
});

/* ---------- fragment spellcheck ---------- */

const finding = (blockId: string, text: string, badText: string, suggestion: string): SpellFinding => {
  const start = text.indexOf(badText);
  return { blockId, blockText: text, range: { start, end: start + badText.length }, badText, suggestions: [suggestion], message: "Помилка", category: "misspelling", ruleId: "RULE" };
};

test("a fragment spellcheck replaces the findings of its blocks only and leaves the pass as it was", () => {
  const spellDocument = edit(baseDocument, "p-1", "Аденозин накопичуеться в мозку.");
  const whole = buildSpellItems(
    [finding("p-1", "Аденозин накопичуеться в мозку.", "накопичуеться", "накопичується"), finding("p-3", P3, "відчуваемо", "відчуваємо"), finding("p-3", P3, "знижуеться", "знижується")],
    spellDocument,
    "run-whole"
  );
  let state = reduce(initial(), { type: "spell/requested" }, { type: "spell/completed", items: whole, ...context(spellDocument) });
  const ignoredId = state.items.find((entry) => entry.spell?.badText === "знижуеться")!.id;
  state = reduce(state, { type: "item/rejected", itemId: ignoredId, at: "t" });

  const passBefore = state.passes.spell;
  const fragment = buildSpellItems([finding("p-3", P3, "відчуваемо", "відчуваємо"), finding("p-3", P3, "знижуеться", "знижується")], spellDocument, "run-frag");
  state = reduce(state, { type: "spell/merged", items: fragment, blockIds: ["p-3"], ...context(spellDocument) });

  const open = selectOpenItems(state, "spell");
  assert.deepEqual(open.map((entry) => [entry.anchor.blockIds[0], entry.spell?.badText]), [
    ["p-1", "накопичуеться"],
    ["p-3", "відчуваемо"]
  ]);
  assert.ok(open[0]!.id.includes("run-whole") || !open[0]!.id.includes("run-frag"), "the finding outside the fragment is untouched");
  assert.equal(open.some((entry) => entry.spell?.badText === "знижуеться"), false, "an ignored word does not come back");
  assert.equal(state.passes.spell, passBefore, "a fragment check does not claim the whole chapter was checked");

  // A fragment check that finds nothing clears the open findings of its blocks.
  const cleared = reduce(state, { type: "spell/merged", items: [], blockIds: ["p-3"], ...context(spellDocument) });
  assert.deepEqual(selectOpenItems(cleared, "spell").map((entry) => entry.anchor.blockIds[0]), ["p-1"]);

  // Findings for blocks outside the requested scope are not taken.
  const outside = reduce(cleared, { type: "spell/merged", items: fragment, blockIds: ["p-2"], ...context(spellDocument) });
  assert.deepEqual(selectOpenItems(outside, "spell").map((entry) => entry.anchor.blockIds[0]), ["p-1"]);
});

/* ---------- review round ---------- */

test("a new chapter request that fails before the server accepts it leaves nothing of the previous one to retry", () => {
  // Request A finished with a hole.
  const afterA = reduce(requested("INSTRUCTION A", initial(), "A"), {
    type: "run/completed",
    passId: "request",
    runMode: "replace",
    stepRunId: "step-a",
    items: [requestItem("r-1", "p-1")],
    plan,
    holes: [{ index: 1, message: "Модель не повернула правку." }],
    ...context()
  });
  assert.equal(afterA.request.planInstruction, "INSTRUCTION A");
  assert.equal(afterA.request.holes.length, 1);

  // Request B is logged and fails at the door (empty text, provider refused, another run…): no run/started.
  const logB: V2ReviewAction = {
    type: "request/logged",
    role: "chapter",
    instruction: "INSTRUCTION B",
    entry: { id: "B", scope: "chapter", text: "INSTRUCTION B", at: "t", outcome: { kind: "running" } }
  };
  const failedB = reduce(afterA, logB, { type: "run/requested", passId: "request" }, { type: "run/failed", passId: "request", message: "Немає ключа." });

  assert.equal(failedB.request.instruction, "INSTRUCTION B");
  assert.equal(failedB.request.plan, null, "the plan of A is gone");
  assert.equal(failedB.request.planInstruction, "");
  assert.deepEqual(failedB.request.holes, [], "no hole of A can be retried with the words of B");
  assert.deepEqual(failedB.request.history.map((entry) => [entry.id, entry.outcome.kind]), [["B", "error"], ["A", "done"]]);

  // The same when B is stopped before the server answered.
  const stoppedB = reduce(afterA, logB, { type: "run/requested", passId: "request" }, { type: "run/stopped", passId: "request" });
  assert.equal(stoppedB.request.plan, null);
  assert.deepEqual(stoppedB.request.holes, []);

  // The cards A produced are real model output and stay in the queue.
  assert.deepEqual(selectQueue(failedB).map((entry) => entry.id), ["r-1"]);
});

test("a plan always carries the instruction it was made for, also across a reload", () => {
  let state = requested("INSTRUCTION A", initial(), "A");
  state = reduce(state, { type: "run/snapshot", passId: "request", record: record("final_editing"), items: [], plan, ...context() });
  assert.equal(state.request.planInstruction, "INSTRUCTION A", "taken when the plan arrives");

  state = reduce(state, { type: "run/failed", passId: "request", message: "Провайдер недоступний.", plan, holes: [{ index: 0, message: "x" }] });
  assert.equal(state.request.planInstruction, "INSTRUCTION A");

  // A retry does not change which instruction the plan belongs to.
  const retrying = reduce(
    state,
    { type: "run/requested", passId: "request", retryIndex: 0 },
    { type: "run/started", passId: "request", runMode: "preserve", record: record("final_editing", { runMode: "preserve" }) }
  );
  assert.equal(retrying.request.planInstruction, "INSTRUCTION A");
  assert.deepEqual(retrying.request.plan, plan);

  const restored = reload(state);
  assert.equal(restored.request.planInstruction, "INSTRUCTION A");
  assert.deepEqual(restored.request.plan, plan);
  assert.equal(restored.request.holes.length, 1);
});

test("a stored plan without its instruction cannot be retried, so it is not kept", () => {
  const persisted = serializeReviewState(
    reduce(requested("INSTRUCTION A"), { type: "run/failed", passId: "request", message: "x", plan, holes: [{ index: 0, message: "x" }] })
  );
  const stripped = JSON.parse(JSON.stringify(persisted)) as { request: Record<string, unknown> };
  delete stripped.request.planInstruction;
  const coerced = coercePersistedReview(stripped);

  assert.equal(coerced?.request?.plan, null);
  assert.deepEqual(coerced?.request?.holes, []);
  assert.equal(coerced?.request?.planInstruction, "");
});

test("rejecting a fragment card while it is being prepared ends the request as stopped and frees the composer", () => {
  const entry: V2RequestEntry = { id: "frag-1", scope: "fragment", text: "Врізка", quote: "Кофеїн", where: "абз. 2", at: "t", outcome: { kind: "running" } };
  const card = manual("m-callout", "p-2", { recommendationType: "callout", suggestedAction: "prepare_callout", insertionPoint: { mode: "after", anchorBlockId: "p-2" } });
  let state = reduce(
    initial(),
    { type: "request/logged", role: "fragment", label: "Врізка", entry },
    { type: "item/added", item: card, ...context() },
    { type: "proposal/requested", item: card }
  );
  assert.equal(state.request.fragment?.entryId, "frag-1");
  assert.equal(state.proposals["m-callout"]?.status, "preparing");

  // `Відхилити` on the card (or Backspace in quiet mode) while the model is answering.
  state = reduce(state, { type: "item/rejected", itemId: "m-callout", at: "t" });
  assert.equal(state.items[0]?.status, "dismissed");
  assert.equal("m-callout" in state.proposals, false);

  // The engine settles with what `resolvePrepareSettlement` gives for a cancelled preparation of the current run.
  state = reduce(state, { type: "request/settled", entryId: "frag-1", outcome: { kind: "stopped" } });
  assert.equal(state.request.fragment, null, "no spinner, and the next fragment action is not refused as busy");
  assert.deepEqual(state.request.history[0]?.outcome, { kind: "stopped" });

  // The late answer of the model changes nothing.
  const late = reduce(state, { type: "draft/ready", itemId: "m-callout", proposal: textProposal("m-callout", "p-2", "x") });
  assert.equal(late, state);
});

test("a partly failed fragment spellcheck is recorded with its warnings and survives a reload", () => {
  const entry: V2RequestEntry = { id: "frag-1", scope: "fragment", text: "Правопис", at: "t", outcome: { kind: "running" } };
  const state = reduce(
    initial(),
    { type: "request/logged", role: "fragment", entry },
    { type: "request/settled", entryId: "frag-1", outcome: { kind: "done", count: 1, warnings: ["Сервіс правопису недоступний."] } }
  );

  assert.deepEqual(reload(state).request.history[0]?.outcome, { kind: "done", count: 1, warnings: ["Сервіс правопису недоступний."] });
});

test("findings in a block whose batch never answered are left alone by a fragment spellcheck", () => {
  const spellDocument = edit(baseDocument, "p-1", "Аденозин накопичуеться в мозку.");
  const whole = buildSpellItems(
    [finding("p-1", "Аденозин накопичуеться в мозку.", "накопичуеться", "накопичується"), finding("p-3", P3, "відчуваемо", "відчуваємо")],
    spellDocument,
    "run-whole"
  );
  const before = reduce(initial(), { type: "spell/requested" }, { type: "spell/completed", items: whole, ...context(spellDocument) });

  // The selection covered p-1 and p-3, but only the batch with p-3 answered (and found nothing).
  const after = reduce(before, { type: "spell/merged", items: [], blockIds: ["p-3"], ...context(spellDocument) });

  assert.deepEqual(selectOpenItems(after, "spell").map((entry) => entry.spell?.badText), ["накопичуеться"], "p-1 was not checked: its finding stays");
});
