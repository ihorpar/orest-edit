import test from "node:test";
import assert from "node:assert/strict";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import type { PersistedActiveReviewRun } from "../lib/editor/draft-state.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorialReviewRunSnapshot, EditorialReviewStepId, ReviewActionProposal } from "../lib/editor/review-contract.ts";
import type { SpellFinding } from "../lib/v2/api.ts";
import { buildItemMarks } from "../lib/v2/item-marks.ts";
import { getItemKind, type V2ReviewItem } from "../lib/v2/item-kinds.ts";
import { buildSpellItems } from "../lib/v2/spell-items.ts";
import {
  canAcceptItem,
  canApplyProposal,
  coercePersistedReview,
  createInitialReviewState,
  DECISION_PROPOSALS_KEPT,
  getItemPassId,
  planQuietPreparation,
  planRunAll,
  QUIET_DWELL_MS,
  QUIET_MAX_AUTO_PREPARATIONS,
  reviewReducer,
  selectBulkCandidates,
  selectNextQueuedPass,
  selectPassOpenCount,
  selectPassState,
  selectQueue,
  selectQuietPreparationTargets,
  selectRunningPassId,
  serializeReviewState,
  shouldPersistAfter,
  type V2PassId,
  type V2ReviewAction,
  type V2ReviewState
} from "../lib/v2/store.ts";

const paragraph = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });

const P1 = "Чим довше ми не спимо, тим більше його накопичується. Це називають тиском сну.";
const P2 = "До вечора ми відчуваемо втому, а концентрація знижуеться.";
const P3 = "Кофеїн є конкурентним антагоністом аденозинових рецепторів.";

const baseDocument: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    paragraph("p-1", P1),
    paragraph("p-2", P2),
    paragraph("p-3", P3)
  ]
};

const LIVE = new Set<string>(["structure", "clarity", "interest", "formatting", "accent", "spell"]);

const context = (document: EditorDocument = baseDocument) => ({ document, revision: deriveManuscriptRevisionState(document) });

function withBlock(document: EditorDocument, blockId: string, block: Block | null): EditorDocument {
  return { version: 2, blocks: document.blocks.flatMap((entry) => (entry.id === blockId ? (block ? [block] : []) : [entry])) };
}

const edit = (document: EditorDocument, blockId: string, text: string) => withBlock(document, blockId, paragraph(blockId, text));

function insertBefore(document: EditorDocument, blockId: string, block: Block): EditorDocument {
  return { version: 2, blocks: document.blocks.flatMap((entry) => (entry.id === blockId ? [block, entry] : [entry])) };
}

function insertAfter(document: EditorDocument, blockId: string, block: Block): EditorDocument {
  return { version: 2, blocks: document.blocks.flatMap((entry) => (entry.id === blockId ? [entry, block] : [entry])) };
}

/** Bold over the first occurrence of `phrase` in a paragraph. */
function bolden(document: EditorDocument, blockId: string, phrase: string): EditorDocument {
  const block = document.blocks.find((entry) => entry.id === blockId)!;
  const text = block.type === "paragraph" ? block.content.map((node) => node.text).join("") : "";
  const start = text.indexOf(phrase);
  return withBlock(document, blockId, {
    id: blockId,
    type: "paragraph",
    content: [{ text: text.slice(0, start) }, { text: phrase, bold: true as const }, { text: text.slice(start + phrase.length) }].filter((node) => node.text)
  });
}

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

const heading = (id: string, blockId: string, title = "Як кофеїн обманює мозок", overrides: Partial<V2ReviewItem> = {}) =>
  item(id, blockId, {
    recommendationType: "subsection",
    suggestedAction: "insert_text",
    stepId: "structure",
    insertionPoint: { mode: "before", anchorBlockId: blockId },
    headingLevel: 2,
    subsectionDraft: { title, headingLevel: 2, prompt: "" },
    // The server sends structure items as ready: their title needs no second call.
    status: "ready",
    ...overrides
  });

const accent = (id: string, blockId: string, text: string, occurrence = 1) =>
  item(id, blockId, { recommendationType: "rewrite", stepId: "emphasis", title: `Виділити «${text}»`, emphasisTarget: { text, occurrence } });

const callout = (id: string, blockId: string, overrides: Partial<V2ReviewItem> = {}) =>
  item(id, blockId, {
    recommendationType: "callout",
    suggestedAction: "prepare_callout",
    stepId: "interest",
    insertionPoint: { mode: "after", anchorBlockId: blockId },
    calloutKind: "analogy",
    calloutDepth: "brief",
    ...overrides
  });

function calloutProposal(itemId: string, kind: "analogy" | "mechanism" = "analogy", previewText = "Кофеїн — ключ, що застряг у замку."): ReviewActionProposal {
  return {
    id: `proposal-${itemId}`,
    reviewItemId: itemId,
    sourceRevisionId: "rev-1",
    targetRevisionId: "rev-1",
    kind: "callout_prompt",
    summary: "Врізка",
    canApplyDirectly: false,
    calloutDraft: { calloutKind: kind, calloutDepth: "brief", title: "Ключ у замку", prompt: "prompt", previewText }
  };
}

function textProposal(itemId: string, blockIds: string[], newBlocks: Block[]): ReviewActionProposal {
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
      blockIds,
      oldBlocks: blockIds.map((blockId) => baseDocument.blocks.find((block) => block.id === blockId)!),
      newBlocks,
      reason: "Простіше."
    }
  };
}

function run(stepId: EditorialReviewStepId, runId = `run-${stepId}`): EditorialReviewRunSnapshot {
  return {
    runId,
    documentRevisionId: "rev-1",
    stepId,
    locale: "uk",
    provider: "openai",
    modelId: "gpt-6-luna",
    runMode: "replace",
    createdAt: "2026-10-10T10:00:00.000Z",
    status: "running",
    updatedAt: "2026-10-10T10:00:01.000Z",
    pollAfterMs: 1000
  };
}

const record = (stepId: EditorialReviewStepId, runId?: string): PersistedActiveReviewRun => ({
  version: 1,
  run: run(stepId, runId),
  capability: "signed-cap",
  updatedAt: "2026-10-10T10:00:01.000Z",
  stale: false
});

const STEP: Record<string, EditorialReviewStepId> = {
  structure: "structure",
  clarity: "clarity",
  interest: "interest",
  formatting: "formatting",
  accent: "emphasis"
};

function reduce(state: V2ReviewState, ...actions: V2ReviewAction[]): V2ReviewState {
  return actions.reduce(reviewReducer, state);
}

/** A finished run of `passId` that returned `items`. */
function ran(state: V2ReviewState, passId: V2PassId, items: V2ReviewItem[], document: EditorDocument = baseDocument): V2ReviewState {
  const stepId = STEP[passId]!;
  return reduce(
    state,
    { type: "run/requested", passId },
    { type: "run/started", passId, runMode: "replace", record: record(stepId) },
    { type: "run/completed", passId, runMode: "replace", stepRunId: `step-${passId}`, items, ...context(document) }
  );
}

const finding = (blockId: string, badText: string, suggestions: string[], document: EditorDocument = baseDocument): SpellFinding => {
  const block = document.blocks.find((entry) => entry.id === blockId)!;
  const blockText = block.type === "paragraph" || block.type === "heading" ? block.content.map((node) => node.text).join("") : "";
  const start = blockText.indexOf(badText);
  return { blockId, blockText, range: { start, end: start + badText.length }, badText, suggestions, message: "Можлива помилка.", category: "misspelling", ruleId: "R" };
};

function spelled(state: V2ReviewState, findings: SpellFinding[], runId = "r1", document: EditorDocument = baseDocument): V2ReviewState {
  return reduce(state, { type: "spell/requested" }, { type: "spell/completed", items: buildSpellItems(findings, document, runId), ...context(document) });
}

const TWO_ERRORS = [finding("p-2", "відчуваемо", ["відчуваємо", "відчуваймо"]), finding("p-2", "знижуеться", ["знижується"])];
const byId = (state: V2ReviewState, id: string) => state.items.find((entry) => entry.id === id)!;
const statuses = (state: V2ReviewState) => state.items.map((entry) => [entry.id, entry.status]);
const persisted = (state: V2ReviewState) => coercePersistedReview(JSON.parse(JSON.stringify(serializeReviewState(state))));
const reloaded = (state: V2ReviewState) => reviewReducer(createInitialReviewState(), { type: "hydrate", persisted: persisted(state) });

/* ---------- structure ---------- */

test("structure items are ready as they arrive: the title came with them, no proposal exists or is needed", () => {
  const state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-3"), heading("s-2", "p-2", "Що таке тиск сну", { status: "pending" })]);

  assert.deepEqual(statuses(state), [["s-2", "ready"], ["s-1", "ready"]], "manuscript order; a pending one with a title is ready too");
  assert.deepEqual(state.proposals, {});
  assert.equal(canAcceptItem(state, "s-1"), true);
  assert.equal(getItemPassId(byId(state, "s-1")), "structure");
  assert.deepEqual(selectQuietPreparationTargets({ ...state, quiet: true, focusId: "s-2" }), [], "nothing to prepare, also in quiet mode");
});

test("the title and level of a heading can be changed; without a title it cannot be accepted", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-3")]);

  state = reduce(state, { type: "item/headingEdited", itemId: "s-1", title: "Кофеїн і рецептори" }, { type: "item/headingEdited", itemId: "s-1", headingLevel: 3 });
  assert.deepEqual(byId(state, "s-1").subsectionDraft, { title: "Кофеїн і рецептори", headingLevel: 3, prompt: "" });
  assert.equal(byId(state, "s-1").headingLevel, 3);
  assert.equal(canAcceptItem(state, "s-1"), true);

  state = reduce(state, { type: "item/headingEdited", itemId: "s-1", title: "  " });
  assert.equal(byId(state, "s-1").status, "pending");
  assert.equal(canAcceptItem(state, "s-1"), false);

  state = reduce(state, { type: "item/headingEdited", itemId: "s-1", title: "Назад" });
  assert.equal(byId(state, "s-1").status, "ready");
});

test("a heading survives edits of the paragraph it stands before and goes stale only when that paragraph is gone", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-3")]);
  const edited = edit(baseDocument, "p-3", "Зовсім інший текст абзацу.");

  state = reduce(state, { type: "items/reconciled", ...context(edited) });
  assert.equal(byId(state, "s-1").status, "ready");
  assert.equal(byId(state, "s-1").anchor.fingerprint, computeAnchorFingerprint(edited, ["p-3"]));

  state = reduce(state, { type: "items/reconciled", ...context(withBlock(edited, "p-3", null)) });
  assert.equal(byId(state, "s-1").status, "stale");
  assert.equal(canAcceptItem(state, "s-1"), false);

  state = reduce(state, { type: "items/reconciled", ...context(edited) });
  assert.equal(byId(state, "s-1").status, "ready", "the paragraph came back (undo)");
});

test("an accepted heading is recognised by the block it inserted: undo reopens it, redo accepts it again", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-3")]);
  const inserted: Block = { id: "heading-new", type: "heading", level: 2, content: [{ text: "Як кофеїн обманює мозок" }] };
  const applied = insertBefore(baseDocument, "p-3", inserted);

  state = reduce(
    state,
    { type: "item/accepted", itemId: "s-1", appliedFingerprint: computeAnchorFingerprint(applied, ["p-3"]), insertedBlockIds: ["heading-new"], at: "t" },
    { type: "items/reconciled", ...context(applied) }
  );
  assert.equal(byId(state, "s-1").status, "applied");
  assert.deepEqual(state.decisions[0]!.insertedBlockIds, ["heading-new"]);

  state = reduce(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(byId(state, "s-1").status, "ready", "undo: the suggestion is back with its ghost");
  assert.equal(state.decisions[0]!.undone, true);

  state = reduce(state, { type: "items/reconciled", ...context(applied) });
  assert.equal(byId(state, "s-1").status, "applied", "redo");
  assert.equal(state.decisions[0]!.undone, false);
});

/* ---------- accents ---------- */

test("several accents in one paragraph are all kept, in the order of the text, and need no proposal", () => {
  let state = ran(createInitialReviewState(), "accent", [accent("a-2", "p-1", "тиском сну"), accent("a-1", "p-1", "тим більше його накопичується")]);

  assert.deepEqual(statuses(state), [["a-1", "ready"], ["a-2", "ready"]]);
  assert.equal(getItemKind(byId(state, "a-1")), "accent");
  assert.equal(canAcceptItem(state, "a-1"), true);
  assert.equal(selectPassOpenCount(state, "accent"), 2);

  // A streamed snapshot that repeats an accent does not duplicate it.
  state = reduce(
    state,
    { type: "run/requested", passId: "accent" },
    { type: "run/started", passId: "accent", runMode: "preserve", record: record("emphasis", "run-again") },
    { type: "run/snapshot", passId: "accent", record: record("emphasis", "run-again"), items: [accent("a-9", "p-1", "тиском сну")], ...context() }
  );
  assert.equal(selectPassOpenCount(state, "accent"), 2);
});

test("an accent lives by its phrase: edits elsewhere keep it, a removed phrase or bold by hand retires it", () => {
  let state = ran(createInitialReviewState(), "accent", [accent("a-1", "p-1", "тиском сну")]);

  state = reduce(state, { type: "items/reconciled", ...context(edit(baseDocument, "p-1", `Отже, ${P1}`)) });
  assert.equal(byId(state, "a-1").status, "ready", "the paragraph changed, the phrase is still there");

  state = reduce(state, { type: "items/reconciled", ...context(edit(baseDocument, "p-1", "Чим довше ми не спимо, тим більше його накопичується.")) });
  assert.equal(byId(state, "a-1").status, "stale");
  assert.equal(canAcceptItem(state, "a-1"), false);

  state = reduce(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(byId(state, "a-1").status, "ready");

  state = reduce(state, { type: "items/reconciled", ...context(bolden(baseDocument, "p-1", "тиском сну")) });
  assert.equal(byId(state, "a-1").status, "stale", "bold already, without this suggestion: nothing left to accept");
});

test("an accepted accent is recognised by the bold: undo reopens it, redo accepts it again", () => {
  let state = ran(createInitialReviewState(), "accent", [accent("a-1", "p-1", "тиском сну")]);
  const applied = bolden(baseDocument, "p-1", "тиском сну");

  state = reduce(
    state,
    // Bold does not change the text, so the fingerprint cannot tell applied from not applied.
    { type: "item/accepted", itemId: "a-1", appliedFingerprint: computeAnchorFingerprint(applied, ["p-1"]), at: "t" },
    { type: "items/reconciled", ...context(applied) }
  );
  assert.equal(byId(state, "a-1").status, "applied");

  state = reduce(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(byId(state, "a-1").status, "ready");
  assert.equal(state.decisions[0]!.undone, true);

  state = reduce(state, { type: "items/reconciled", ...context(applied) });
  assert.equal(byId(state, "a-1").status, "applied");
});

/* ---------- callouts ---------- */

test("a callout is prepared by a proposal call and then carries its draft itself", () => {
  let state = ran(createInitialReviewState(), "interest", [callout("c-1", "p-3")]);
  assert.equal(byId(state, "c-1").status, "pending");
  assert.equal(canAcceptItem(state, "c-1"), false);

  state = reduce(state, { type: "proposal/requested", item: byId(state, "c-1") });
  assert.equal(state.proposals["c-1"]?.status, "preparing");

  state = reduce(state, { type: "draft/ready", itemId: "c-1", proposal: calloutProposal("c-1") });
  assert.equal(byId(state, "c-1").status, "ready");
  assert.equal(byId(state, "c-1").calloutDraft?.previewText, "Кофеїн — ключ, що застряг у замку.");
  assert.equal(state.proposals["c-1"], undefined, "the draft lives on the item, not among the text proposals");
  assert.equal(canAcceptItem(state, "c-1"), true);

  // A reply for a request nobody is waiting for changes nothing.
  assert.equal(reduce(state, { type: "draft/ready", itemId: "c-1", proposal: calloutProposal("c-1", "mechanism") }), state);
});

test("the placeholder draft a review run delivers with a callout item is not a prepared callout", () => {
  const delivered = callout("c-1", "p-3", {
    status: "ready",
    calloutDraft: { calloutKind: "mechanism", calloutDepth: "deep", title: "механізм", prompt: "…", previewText: P3 }
  });
  let state = ran(createInitialReviewState(), "interest", [delivered]);

  assert.equal(byId(state, "c-1").status, "pending", "it still has to be prepared, by an explicit action");
  assert.equal(canAcceptItem(state, "c-1"), false);
  assert.equal(buildItemMarks(state, { locale: "uk", getDiff: () => undefined })[0]!.ghost, undefined, "and nothing is drawn as if it were a callout");

  state = reduce(state, { type: "proposal/requested", item: byId(state, "c-1") }, { type: "draft/ready", itemId: "c-1", proposal: calloutProposal("c-1", "mechanism") });
  assert.equal(byId(state, "c-1").status, "ready");
  assert.equal(byId(state, "c-1").calloutPrepared, true);
  assert.equal(byId(reloaded(state), "c-1").calloutPrepared, true, "what was prepared stays prepared after a reload");
});

test("changing kind or depth drops the draft written for the old choice", () => {
  let state = ran(createInitialReviewState(), "interest", [callout("c-1", "p-3")]);
  state = reduce(state, { type: "proposal/requested", item: byId(state, "c-1") }, { type: "draft/ready", itemId: "c-1", proposal: calloutProposal("c-1") });

  const same = reduce(state, { type: "item/calloutOptions", itemId: "c-1", calloutKind: "analogy" });
  assert.equal(same, state, "choosing what is already chosen keeps the draft");

  state = reduce(state, { type: "item/calloutOptions", itemId: "c-1", calloutKind: "mechanism" });
  assert.equal(byId(state, "c-1").calloutKind, "mechanism");
  assert.equal(byId(state, "c-1").calloutDraft, undefined);
  assert.equal(byId(state, "c-1").status, "pending");
  assert.equal(canAcceptItem(state, "c-1"), false);

  state = reduce(state, { type: "item/calloutOptions", itemId: "c-1", calloutDepth: "deep" });
  assert.equal(byId(state, "c-1").calloutDepth, "deep");
  assert.equal(byId(state, "c-1").calloutKind, "mechanism");
});

test("a failed regeneration keeps the draft that was on screen, with the error; a failed first attempt leaves nothing to accept", () => {
  let state = ran(createInitialReviewState(), "interest", [callout("c-1", "p-3"), callout("c-2", "p-2")]);
  state = reduce(state, { type: "proposal/requested", item: byId(state, "c-1") }, { type: "draft/ready", itemId: "c-1", proposal: calloutProposal("c-1") });

  state = reduce(state, { type: "proposal/requested", item: byId(state, "c-1") }, { type: "proposal/failed", itemId: "c-1", message: "Провайдер недоступний." });
  assert.equal(byId(state, "c-1").status, "ready");
  assert.deepEqual(state.proposals["c-1"], { status: "failed", message: "Провайдер недоступний." });
  assert.equal(canAcceptItem(state, "c-1"), true);

  state = reduce(state, { type: "proposal/requested", item: byId(state, "c-2") }, { type: "proposal/failed", itemId: "c-2", message: "Порожня відповідь." });
  assert.equal(byId(state, "c-2").status, "pending");
  assert.equal(canAcceptItem(state, "c-2"), false);
});

test("a callout is written for its paragraph: editing that paragraph makes it stale; its acceptance is recognised by the inserted block", () => {
  let state = ran(createInitialReviewState(), "interest", [callout("c-1", "p-3")]);
  state = reduce(state, { type: "proposal/requested", item: byId(state, "c-1") }, { type: "draft/ready", itemId: "c-1", proposal: calloutProposal("c-1") });

  const stale = reduce(state, { type: "items/reconciled", ...context(edit(baseDocument, "p-3", "Інший текст.")) });
  assert.equal(byId(stale, "c-1").status, "stale");
  assert.equal(canAcceptItem(stale, "c-1"), false);
  assert.equal(byId(reduce(stale, { type: "items/reconciled", ...context() }), "c-1").status, "ready");

  const block: Block = { id: "callout-new", type: "callout", kind: "analogy", depth: "brief", title: [{ text: "Ключ у замку" }], body: [[{ text: "Кофеїн — ключ." }]] };
  const applied = insertAfter(baseDocument, "p-3", block);
  state = reduce(
    state,
    { type: "item/accepted", itemId: "c-1", appliedFingerprint: computeAnchorFingerprint(applied, ["p-3"]), insertedBlockIds: ["callout-new"], at: "t" },
    { type: "items/reconciled", ...context(applied) }
  );
  assert.equal(byId(state, "c-1").status, "applied");

  state = reduce(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(byId(state, "c-1").status, "ready", "undo brings the prepared callout back, no second call");
  assert.equal(byId(reduce(state, { type: "items/reconciled", ...context(applied) }), "c-1").status, "applied");
});

test("a list suggestion of the formatting pass is a rewrite like any other", () => {
  const state = ran(createInitialReviewState(), "formatting", [item("f-1", "p-3", { recommendationType: "list", stepId: "formatting" }), callout("f-2", "p-2", { stepId: "formatting" })]);

  assert.equal(getItemKind(byId(state, "f-1")), "replace");
  assert.equal(getItemKind(byId(state, "f-2")), "callout");
  assert.equal(selectPassOpenCount(state, "formatting"), 2);
  assert.equal(getItemPassId(byId(state, "f-2")), "formatting");
});

/* ---------- reload ---------- */

test("a reload loses nothing: ready headings, accents, prepared callouts, spelling findings, edited titles", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-3")]);
  state = ran(state, "accent", [accent("a-1", "p-1", "тиском сну")]);
  state = ran(state, "interest", [callout("c-1", "p-3"), callout("c-2", "p-2")]);
  state = spelled(state, TWO_ERRORS);
  state = reduce(
    state,
    { type: "item/headingEdited", itemId: "s-1", title: "Моя назва", headingLevel: 3 },
    { type: "proposal/requested", item: byId(state, "c-1") },
    { type: "draft/ready", itemId: "c-1", proposal: calloutProposal("c-1") },
    { type: "spell/choice", itemId: "spell-r1-1", choice: 1 },
    { type: "queue/set", passIds: ["clarity", "formatting"] }
  );

  const hydrated = reduce(reloaded(state), { type: "items/reconciled", ...context() });

  assert.deepEqual(statuses(hydrated), statuses(state));
  assert.deepEqual(byId(hydrated, "s-1").subsectionDraft, { title: "Моя назва", headingLevel: 3, prompt: "" });
  assert.equal(byId(hydrated, "c-1").calloutDraft?.previewText, "Кофеїн — ключ, що застряг у замку.");
  assert.equal(byId(hydrated, "c-2").status, "pending");
  assert.deepEqual(byId(hydrated, "spell-r1-1").spell, byId(state, "spell-r1-1").spell);
  assert.equal(byId(hydrated, "spell-r1-1").spell?.choice, 1);
  assert.deepEqual(hydrated.queue, ["clarity", "formatting"]);
  assert.equal(hydrated.queuePaused, true);
  assert.equal(selectPassState(hydrated, "spell").status, "done");
  for (const id of ["s-1", "a-1", "c-1", "spell-r1-1"]) {
    assert.equal(canAcceptItem(hydrated, id), true, id);
  }
});

test("a damaged spelling finding in a stored draft is left out; the rest of the queue opens", () => {
  const state = spelled(ran(createInitialReviewState(), "accent", [accent("a-1", "p-1", "тиском сну")]), TWO_ERRORS);
  const raw = JSON.parse(JSON.stringify(serializeReviewState(state)));
  raw.items.find((entry: V2ReviewItem) => entry.id === "spell-r1-1").spell.range = { start: 5 };
  raw.queue = ["spell", "nonsense", "clarity", "clarity"];

  const restored = coercePersistedReview(raw);
  assert.deepEqual(restored?.items.map((entry) => entry.id), ["a-1", "spell-r1-2"]);
  assert.deepEqual(restored?.queue, ["clarity"], "only review passes can wait in the launch queue, once each");
});

/* ---------- spelling ---------- */

test("spelling findings join the same queue, in manuscript order, under their own pass", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-3")]);
  state = ran(state, "clarity", [item("k-1", "p-2")]);
  state = spelled(state, [TWO_ERRORS[1]!, TWO_ERRORS[0]!]);

  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["k-1", "spell-r1-2", "spell-r1-1", "s-1"], "by block, then by place inside it");
  assert.equal(getItemPassId(byId(state, "spell-r1-1")), "spell");
  assert.equal(selectPassOpenCount(state, "spell"), 2);
  assert.deepEqual(selectPassState(state, "spell"), { status: "done", warnings: undefined, lastRunItemCount: 2 });
  assert.equal(byId(state, "spell-r1-1").status, "ready");

  state = reduce(state, { type: "filter/set", filter: "spell" });
  assert.deepEqual(selectQueue(state).map((entry) => entry.id), ["spell-r1-2", "spell-r1-1"]);
});

test("spellcheck runs beside a review pass, and its failure is its own", () => {
  let state = reduce(
    createInitialReviewState(),
    { type: "run/requested", passId: "clarity" },
    { type: "run/started", passId: "clarity", runMode: "replace", record: record("clarity") },
    { type: "spell/requested" }
  );
  assert.equal(selectPassState(state, "spell").status, "running");
  assert.equal(selectRunningPassId(state), "clarity", "the review run in flight is the clarity one");

  state = reduce(state, { type: "spell/failed", message: "LanguageTool недоступний." });
  assert.deepEqual(selectPassState(state, "spell"), { status: "failed", error: "LanguageTool недоступний." });
  assert.equal(selectPassState(state, "clarity").status, "running");

  state = reduce(state, { type: "spell/requested" }, { type: "spell/stopped" });
  assert.deepEqual(selectPassState(state, "spell"), { status: "idle", stopped: true });

  // A spellcheck in flight cannot be resumed after a reload.
  const midFlight = reduce(state, { type: "spell/requested" });
  assert.equal(selectPassState(reloaded(midFlight), "spell").status, "idle");
  assert.equal(selectPassState(reloaded(midFlight), "clarity").status, "running");
});

test("partial spellcheck results come with the failures of the batches that could not be checked", () => {
  const state = reduce(createInitialReviewState(), { type: "spell/requested" }, {
    type: "spell/completed",
    items: buildSpellItems([TWO_ERRORS[0]!], baseDocument, "r1"),
    warnings: ["Перевищено ліміт запитів."],
    ...context()
  });

  assert.deepEqual(selectPassState(state, "spell").warnings, ["Перевищено ліміт запитів."]);
});

test("a finding moves with its word when the paragraph is edited elsewhere, and goes stale when the word is touched", () => {
  let state = spelled(createInitialReviewState(), TWO_ERRORS);
  const shifted = edit(baseDocument, "p-2", `Уже ${P2}`);

  state = reduce(state, { type: "items/reconciled", ...context(shifted) });
  assert.deepEqual(byId(state, "spell-r1-1").spell?.range, { start: 17, end: 27 });
  assert.equal(byId(state, "spell-r1-1").status, "ready");
  assert.equal(byId(state, "spell-r1-1").anchor.fingerprint, computeAnchorFingerprint(shifted, ["p-2"]));

  state = reduce(state, { type: "items/reconciled", ...context(edit(baseDocument, "p-2", P2.replace("відчуваемо", "відчуваємо"))) });
  assert.equal(byId(state, "spell-r1-1").status, "stale", "fixed by hand: the finding no longer points at anything");
  assert.equal(byId(state, "spell-r1-2").status, "ready", "the other word in the same paragraph is still found");
  assert.equal(canAcceptItem(state, "spell-r1-1"), false);

  const marks = buildItemMarks(state, { locale: "uk", getDiff: () => undefined });
  assert.deepEqual(marks.map((mark) => mark.itemId), ["spell-r1-2"], "a stale finding draws nothing");
});

test("the chosen suggestion is what the mark shows and what is accepted", () => {
  let state = spelled(createInitialReviewState(), TWO_ERRORS);
  const replacementOf = (current: V2ReviewState) => {
    const mark = buildItemMarks(current, { locale: "uk", getDiff: () => undefined }).find((entry) => entry.itemId === "spell-r1-1");
    return mark?.inline?.type === "spell" ? mark.inline.replacement : undefined;
  };

  assert.equal(replacementOf(state), "відчуваємо");
  state = reduce(state, { type: "spell/choice", itemId: "spell-r1-1", choice: 1 });
  assert.equal(replacementOf(state), "відчуваймо");
  assert.equal(reduce(state, { type: "spell/choice", itemId: "spell-r1-1", choice: 7 }), state, "there is no such suggestion");

  const none = spelled(createInitialReviewState(), [finding("p-2", "відчуваемо", [])]);
  assert.equal(canAcceptItem(none, "spell-r1-1"), false, "nothing to replace the word with: only ignore or dictionary");
});

test("accepting a fix: the neighbour in the same paragraph is re-read at once; undo reopens, redo accepts again", () => {
  let state = spelled(createInitialReviewState(), TWO_ERRORS);
  const fixed = edit(baseDocument, "p-2", P2.replace("відчуваемо", "відчуваємо"));

  state = reduce(
    state,
    { type: "item/accepted", itemId: "spell-r1-1", appliedFingerprint: computeAnchorFingerprint(fixed, ["p-2"]), at: "t" },
    { type: "items/reconciled", ...context(fixed) }
  );
  assert.equal(byId(state, "spell-r1-1").status, "applied");
  assert.equal(byId(state, "spell-r1-2").status, "ready");
  assert.equal(byId(state, "spell-r1-2").spell?.blockText, P2.replace("відчуваемо", "відчуваємо"));

  state = reduce(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(byId(state, "spell-r1-1").status, "ready", "undo");
  assert.equal(byId(state, "spell-r1-2").status, "ready");

  state = reduce(state, { type: "items/reconciled", ...context(fixed) });
  assert.equal(byId(state, "spell-r1-1").status, "applied", "redo");
});

test("`Залишити як є` ignores a finding for good: a rerun does not bring it back, and the review passes never hear of it", () => {
  let state = spelled(createInitialReviewState(), TWO_ERRORS);

  state = reduce(state, { type: "item/rejected", itemId: "spell-r1-1", at: "t" });
  assert.equal(byId(state, "spell-r1-1").status, "dismissed");
  assert.deepEqual(state.rejectedIdeas, [], "a spelling finding is not a rejected idea of the model");

  state = spelled(state, [...TWO_ERRORS, finding("p-3", "конкурентним", ["конкурентом"])], "r2");
  assert.deepEqual(selectQueue(state).map((entry) => [entry.id, entry.spell?.badText]), [["spell-r2-2", "знижуеться"], ["spell-r2-3", "конкурентним"]]);
  assert.equal(selectPassState(state, "spell").lastRunItemCount, 2);
});

test("a word added to the dictionary leaves the queue without a decision", () => {
  let state = spelled(ran(createInitialReviewState(), "clarity", [item("k-1", "p-2")]), TWO_ERRORS);
  state = reduce(state, { type: "focus/set", itemId: "spell-r1-1" });

  state = reduce(state, { type: "spell/removed", itemIds: ["spell-r1-1", "k-1", "unknown"] });
  assert.deepEqual(state.items.map((entry) => entry.id), ["k-1", "spell-r1-2"], "only spelling findings can be removed this way");
  assert.equal(state.focusId, null);
  assert.deepEqual(state.decisions, []);
  assert.equal(reduce(state, { type: "spell/removed", itemIds: ["nope"] }), state);
});

/* ---------- bulk accept ---------- */

test("`Прийняти всі` exists only for a filtered pass whose results need no model call, and only for drawn items", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-2"), heading("s-2", "p-3"), heading("s-3", "p-1", " ")]);
  state = ran(state, "clarity", [item("k-1", "p-2")]);
  state = spelled(state, [...TWO_ERRORS, finding("p-3", "конкурентним", [])]);
  const everything = state.items.map((entry) => entry.id);

  assert.deepEqual(selectBulkCandidates(state, everything), [], "no filter, no bulk");
  assert.deepEqual(selectBulkCandidates(reduce(state, { type: "filter/set", filter: "clarity" }), everything), [], "rewrites are never accepted in bulk");

  const structure = reduce(state, { type: "filter/set", filter: "structure" });
  assert.deepEqual(selectBulkCandidates(structure, everything).map((entry) => entry.id), ["s-1", "s-2"], "a heading without a title is left out");
  assert.deepEqual(selectBulkCandidates(structure, ["s-2"]).map((entry) => entry.id), ["s-2"], "what is not drawn is not accepted");
  assert.deepEqual(selectBulkCandidates(structure, []), []);
  assert.deepEqual(selectBulkCandidates(reduce(structure, { type: "quiet/set", quiet: true }), everything), [], "quiet mode goes one by one");

  const spell = reduce(state, { type: "filter/set", filter: "spell" });
  assert.deepEqual(selectBulkCandidates(spell, everything).map((entry) => entry.id), ["spell-r1-1", "spell-r1-2"], "a word with no fix is left out");
});

test("a bulk acceptance decides every applied item at once and leaves the rest open", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-2"), heading("s-2", "p-3"), heading("s-3", "p-1")]);
  state = reduce(state, { type: "filter/set", filter: "structure" }, { type: "focus/set", itemId: "s-1" });

  state = reduce(state, {
    type: "items/accepted",
    at: "t",
    entries: [
      { itemId: "s-1", appliedFingerprint: "x", insertedBlockIds: ["heading-a"] },
      { itemId: "s-2", appliedFingerprint: "y", insertedBlockIds: ["heading-b"] },
      { itemId: "unknown", appliedFingerprint: "z" }
    ]
  });

  assert.deepEqual(statuses(state), [["s-3", "ready"], ["s-1", "applied"], ["s-2", "applied"]]);
  assert.deepEqual(state.decisions.map((decision) => [decision.itemId, decision.outcome, decision.insertedBlockIds]), [
    ["s-1", "accepted", ["heading-a"]],
    ["s-2", "accepted", ["heading-b"]]
  ]);
  assert.equal(state.focusId, "s-3", "focus moves to what is left");

  // One undo takes all of them back: both inserted blocks are gone again.
  state = reduce(state, { type: "items/reconciled", ...context() });
  assert.deepEqual(statuses(state), [["s-3", "ready"], ["s-1", "ready"], ["s-2", "ready"]]);
});

/* ---------- the launch queue ---------- */

test("`Запустити всі` queues the review passes that have not finished a run, in order, and spellcheck beside them", () => {
  let state = createInitialReviewState();
  assert.deepEqual(planRunAll(state, LIVE), { queue: ["structure", "clarity", "interest", "formatting", "accent"], spell: true });
  assert.deepEqual(planRunAll(state, new Set(["clarity", "spell"])), { queue: ["clarity"], spell: true }, "passes that are not wired are not queued");

  state = ran(state, "clarity", []);
  state = reduce(state, { type: "run/requested", passId: "structure" }, { type: "spell/requested" });
  assert.deepEqual(planRunAll(state, LIVE), { queue: ["interest", "formatting", "accent"], spell: false }, "done and running passes are left alone");

  state = reduce(state, { type: "run/failed", passId: "structure", message: "Помилка." });
  assert.deepEqual(planRunAll(state, LIVE).queue, ["structure", "interest", "formatting", "accent"], "a failed pass is tried again");
});

test("queued passes start one after another: the next one only when no review run is in flight", () => {
  let state = reduce(createInitialReviewState(), { type: "queue/set", passIds: ["structure", "interest", "accent", "interest", "spell"] });
  assert.deepEqual(state.queue, ["structure", "interest", "accent"], "once each; spellcheck never waits in this queue");
  assert.equal(selectNextQueuedPass(state), "structure");

  state = reduce(state, { type: "run/requested", passId: "structure" });
  assert.deepEqual(state.queue, ["interest", "accent"], "a pass leaves the queue when it starts");
  assert.equal(selectNextQueuedPass(state), null, "one review run at a time");

  state = reduce(
    state,
    { type: "run/started", passId: "structure", runMode: "replace", record: record("structure") },
    { type: "run/completed", passId: "structure", runMode: "replace", stepRunId: "s", items: [heading("s-1", "p-3")], ...context() }
  );
  assert.equal(selectNextQueuedPass(state), "interest");

  // Spellcheck in flight does not hold the queue back.
  assert.equal(selectNextQueuedPass(reduce(state, { type: "spell/requested" })), "interest");
});

test("a failed pass does not stop the rest; its row keeps the real error", () => {
  let state = reduce(createInitialReviewState(), { type: "queue/set", passIds: ["structure", "interest", "accent"] }, { type: "run/requested", passId: "structure" });

  state = reduce(state, { type: "run/failed", passId: "structure", message: "Невідома модель gpt-x." });
  assert.deepEqual(selectPassState(state, "structure"), { status: "failed", error: "Невідома модель gpt-x." });
  assert.equal(selectNextQueuedPass(state), "interest");

  // A pass that cannot even start (no text) fails without having left the queue first; it must not be picked forever.
  state = reduce(state, { type: "run/failed", passId: "interest", message: "У розділі немає тексту." });
  assert.deepEqual(state.queue, ["accent"]);
  assert.equal(selectNextQueuedPass(state), "accent");
});

test("the queue can be stopped as a whole or one pass at a time", () => {
  let state = reduce(createInitialReviewState(), { type: "queue/set", passIds: ["structure", "clarity", "interest"] }, { type: "run/requested", passId: "structure" });

  state = reduce(state, { type: "queue/removed", passId: "clarity" });
  assert.deepEqual(state.queue, ["interest"]);
  assert.equal(reduce(state, { type: "queue/removed", passId: "accent" }), state);

  // Stopping the running pass alone lets the next one start.
  const stoppedOne = reduce(state, { type: "run/stopped", passId: "structure" });
  assert.deepEqual(selectPassState(stoppedOne, "structure"), { status: "idle", stopped: true });
  assert.equal(selectNextQueuedPass(stoppedOne), "interest");

  // Stopping everything empties the queue first.
  const stoppedAll = reduce(state, { type: "queue/cleared" }, { type: "run/stopped", passId: "structure" });
  assert.deepEqual(stoppedAll.queue, []);
  assert.equal(selectNextQueuedPass(stoppedAll), null);
  assert.equal(reduce(stoppedAll, { type: "queue/cleared" }), stoppedAll);
});

test("a queue that comes back from a stored draft is paused: nothing in it starts until the editor continues it", () => {
  let state = reduce(
    createInitialReviewState(),
    { type: "queue/set", passIds: ["structure", "interest", "accent"] },
    { type: "run/requested", passId: "structure" },
    { type: "run/started", passId: "structure", runMode: "replace", record: record("structure") }
  );

  // Reload mid-run: the run in flight is resumable, the queued passes wait.
  let hydrated = reloaded(state);
  assert.equal(selectPassState(hydrated, "structure").status, "running");
  assert.deepEqual(hydrated.queue, ["interest", "accent"]);
  assert.equal(hydrated.queuePaused, true);

  hydrated = reduce(hydrated, { type: "run/completed", passId: "structure", runMode: "replace", stepRunId: "s", items: [], ...context() });
  assert.equal(selectNextQueuedPass(hydrated), null, "the resumed run ended; still nothing starts by itself");

  assert.equal(selectNextQueuedPass(reduce(hydrated, { type: "queue/resumed" })), "interest", "`Продовжити чергу`");
  assert.deepEqual(reduce(hydrated, { type: "queue/cleared" }).queue, [], "`Очистити чергу`");
  assert.equal(reduce(hydrated, { type: "queue/cleared" }).queuePaused, false);

  // Reload with nothing in flight (the next day, a second tab): the same.
  state = reduce(createInitialReviewState(), { type: "queue/set", passIds: ["clarity", "formatting"] });
  assert.equal(selectNextQueuedPass(state), "clarity");
  assert.equal(selectNextQueuedPass(reloaded(state)), null);

  // A new `Запустити всі` is an explicit action: it unpauses.
  assert.equal(selectNextQueuedPass(reduce(reloaded(state), { type: "queue/set", passIds: ["clarity"] })), "clarity");
  assert.equal(reloaded(createInitialReviewState()).queuePaused, false);
});

/* ---------- taking a rejection back ---------- */

test("a rejection can be taken back: the card returns as it was and the rejected idea it added is gone", () => {
  let state = ran(createInitialReviewState(), "clarity", [item("k-1", "p-1"), item("k-2", "p-2")]);
  state = reduce(
    state,
    { type: "focus/set", itemId: "k-1" },
    { type: "proposal/requested", item: byId(state, "k-1") },
    { type: "proposal/ready", itemId: "k-1", proposal: textProposal("k-1", ["p-1"], [paragraph("p-1", "Просто.")]) }
  );
  const before = state;

  state = reduce(state, { type: "item/rejected", itemId: "k-1", at: "t" });
  assert.equal(byId(state, "k-1").status, "dismissed");
  assert.equal(state.rejectedIdeas.length, 1);
  assert.equal(state.focusId, "k-2");

  state = reduce(state, { type: "item/restored", itemId: "k-1" });
  assert.equal(byId(state, "k-1").status, "ready");
  assert.equal(state.proposals["k-1"]?.status, "ready", "with the proposal it had");
  assert.equal(canApplyProposal(state, "k-1"), true);
  assert.deepEqual(state.rejectedIdeas, [], "later runs are not told it was rejected");
  assert.deepEqual(state.decisions, []);
  assert.equal(state.focusId, "k-1");
  assert.deepEqual(statuses(state), statuses(before));

  assert.equal(reduce(state, { type: "item/restored", itemId: "k-1" }), state, "only a rejection can be taken back, once");
  assert.equal(reduce(state, { type: "item/restored", itemId: "nope" }), state);
});

test("taking a rejection back keeps a rejected idea that another rejection had added before", () => {
  // Two cards of one type on one paragraph share one rejected idea.
  let state = ran(createInitialReviewState(), "clarity", [item("k-1", "p-1")]);
  state = ran(state, "interest", [item("e-1", "p-1", { stepId: "interest" })]);

  state = reduce(state, { type: "item/rejected", itemId: "k-1", at: "t" }, { type: "item/rejected", itemId: "e-1", at: "t" });
  assert.equal(state.rejectedIdeas.length, 1);

  state = reduce(state, { type: "item/restored", itemId: "e-1" });
  assert.equal(state.rejectedIdeas.length, 1, "the first rejection still stands");
  assert.equal(byId(state, "e-1").status, "pending");
});

test("a rejected heading, accent, callout or spelling finding comes back ready; what a rejection kept is not stored", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-3")]);
  state = spelled(state, TWO_ERRORS);
  state = reduce(state, { type: "quiet/set", quiet: true }, { type: "item/rejected", itemId: "s-1", at: "t" }, { type: "item/rejected", itemId: "spell-r1-1", at: "t" });

  assert.equal(serializeReviewState(state).decisions.some((decision) => "restore" in decision), false);
  assert.equal(byId(reduce(reloaded(state), { type: "item/restored", itemId: "s-1" }), "s-1").status, "dismissed", "after a reload there is nothing to take back");

  state = reduce(state, { type: "item/restored", itemId: "spell-r1-1" }, { type: "item/restored", itemId: "s-1" });
  assert.equal(byId(state, "s-1").status, "ready");
  assert.equal(byId(state, "spell-r1-1").status, "ready");
  assert.equal(state.focusId, "s-1", "in quiet mode the restored card is the current one");
  assert.deepEqual(state.rejectedIdeas, []);
});

/* ---------- quiet mode ---------- */

function mixedQueue(): V2ReviewState {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-1")]);
  state = ran(state, "clarity", [item("k-1", "p-1"), item("k-2", "p-2"), item("k-3", "p-3")]);
  state = ran(state, "interest", [callout("c-1", "p-3")]);
  return state;
}

test("quiet mode always has a current item and walks the visible queue in a circle", () => {
  let state = mixedQueue();
  const order = ["s-1", "k-1", "k-2", "k-3", "c-1"];
  assert.deepEqual(selectQueue(state).map((entry) => entry.id), order);
  assert.equal(state.focusId, null);

  state = reduce(state, { type: "quiet/set", quiet: true });
  assert.equal(state.focusId, "s-1", "the first item becomes current");

  const walk = (delta: 1 | -1) => {
    state = reduce(state, { type: "focus/moved", delta });
    return state.focusId;
  };
  assert.deepEqual([walk(1), walk(1), walk(1), walk(1), walk(1)], ["k-1", "k-2", "k-3", "c-1", "s-1"]);
  assert.deepEqual([walk(-1), walk(-1)], ["c-1", "k-3"]);

  state = reduce(state, { type: "item/rejected", itemId: "k-3", at: "t" });
  assert.equal(state.focusId, "c-1", "deciding moves on to the next one");
  state = reduce(state, { type: "item/rejected", itemId: "c-1", at: "t" });
  assert.equal(state.focusId, "k-2", "after the last one, to the one before it");

  state = reduce(state, { type: "focus/set", itemId: null });
  assert.equal(state.focusId, "s-1", "focus cannot be dropped while the queue has items");

  state = reduce(state, { type: "filter/set", filter: "clarity" });
  assert.equal(state.focusId, "k-1", "the filter narrows the walk");

  state = reduce(state, { type: "quiet/set", quiet: false }, { type: "focus/set", itemId: null });
  assert.equal(state.focusId, null);
  assert.equal(reduce(createInitialReviewState(), { type: "focus/moved", delta: 1 }).focusId, null);
});

test("quiet mode prepares the current item and the next ONE, and nothing else, ever", () => {
  let state = mixedQueue();
  assert.deepEqual(selectQuietPreparationTargets(reduce(state, { type: "focus/set", itemId: "k-1" })), [], "outside quiet mode nothing is prepared on its own");

  state = reduce(state, { type: "quiet/set", quiet: true });
  assert.deepEqual(selectQuietPreparationTargets(state), ["k-1"], "the current heading needs no call; the next rewrite does");

  state = reduce(state, { type: "focus/moved", delta: 1 });
  assert.deepEqual(selectQuietPreparationTargets(state), ["k-1", "k-2"]);

  state = reduce(state, { type: "proposal/requested", item: byId(state, "k-1") }, { type: "proposal/requested", item: byId(state, "k-2") });
  assert.deepEqual(selectQuietPreparationTargets(state), [], "requests in flight are not repeated; the third item waits its turn");

  state = reduce(
    state,
    { type: "proposal/ready", itemId: "k-1", proposal: textProposal("k-1", ["p-1"], [paragraph("p-1", "Просто.")]) },
    { type: "proposal/failed", itemId: "k-2", message: "Провайдер недоступний." }
  );
  assert.deepEqual(selectQuietPreparationTargets(state), [], "a failed preparation is retried only by the editor");

  state = reduce(state, { type: "focus/moved", delta: 1 }, { type: "focus/moved", delta: 1 });
  assert.equal(state.focusId, "k-3");
  assert.deepEqual(selectQuietPreparationTargets(state), ["k-3", "c-1"], "an unprepared callout is prepared like a rewrite");

  const stale = reduce(state, { type: "items/reconciled", ...context(edit(baseDocument, "p-3", "Інший текст.")) });
  assert.deepEqual(selectQuietPreparationTargets(stale), [], "stale items are never prepared on their own");
});

test("quiet mode waits for the current item to stay current, and never has more than two requests of its own in flight", () => {
  let state = ran(createInitialReviewState(), "clarity", [item("k-1", "p-1"), item("k-2", "p-2"), item("k-3", "p-3")]);
  state = reduce(state, { type: "quiet/set", quiet: true });
  const at = (elapsed: number, autoInFlight = 0, current = state) => planQuietPreparation(current, { focusedSince: 1000, now: 1000 + elapsed, autoInFlight });

  assert.deepEqual(at(0), [], "just arrived");
  assert.deepEqual(at(QUIET_DWELL_MS - 1), [], "an arrow key held down passes over items without preparing any");
  assert.deepEqual(at(QUIET_DWELL_MS), ["k-1", "k-2"]);

  assert.deepEqual(at(QUIET_DWELL_MS, 1), ["k-1"], "one request already in flight leaves room for one");
  assert.deepEqual(at(QUIET_DWELL_MS, QUIET_MAX_AUTO_PREPARATIONS), []);
  assert.deepEqual(at(QUIET_DWELL_MS, 5), []);

  assert.deepEqual(planQuietPreparation(state, { focusedSince: null, now: 99999, autoInFlight: 0 }), [], "focus changed since the timer was set");
  assert.deepEqual(at(QUIET_DWELL_MS, 0, reduce(state, { type: "quiet/set", quiet: false })), []);
});

test("a heading whose title the editor emptied is never prepared by quiet mode", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-1"), heading("s-2", "p-2")]);
  state = reduce(state, { type: "quiet/set", quiet: true }, { type: "item/headingEdited", itemId: "s-1", title: "" });

  assert.equal(byId(state, "s-1").status, "pending", "nothing to accept until a title is typed");
  assert.deepEqual(selectQuietPreparationTargets(state), []);
  assert.deepEqual(planQuietPreparation(state, { focusedSince: 0, now: 10_000, autoInFlight: 0 }), []);

  state = reduce(state, { type: "item/headingEdited", itemId: "s-2", title: "" }, { type: "item/headingEdited", itemId: "s-1", title: "Н" });
  assert.equal(byId(state, "s-1").subsectionDraft?.title, "Н", "the title is the editor's own");
  assert.deepEqual(selectQuietPreparationTargets(state), []);
});

test("quiet mode is never on after a reload, and a preparation that failed stays failed", () => {
  let state = ran(createInitialReviewState(), "clarity", [item("k-1", "p-1"), item("k-2", "p-2")]);
  state = reduce(
    state,
    { type: "quiet/set", quiet: true },
    { type: "proposal/requested", item: byId(state, "k-1") },
    { type: "proposal/failed", itemId: "k-1", message: "Провайдер недоступний." }
  );
  assert.deepEqual(selectQuietPreparationTargets(state), ["k-2"], "the failed one is not asked for again");

  const hydrated = reloaded(state);
  assert.equal(hydrated.quiet, false);
  assert.equal(hydrated.focusId, null);
  assert.deepEqual(planQuietPreparation(hydrated, { focusedSince: 0, now: 10_000, autoInFlight: 0 }), [], "nothing is prepared without an action");
  assert.deepEqual(hydrated.proposals["k-1"], { status: "failed", message: "Провайдер недоступний." });

  // The editor switches quiet mode on again: the failed one is still left to an explicit retry.
  const again = reduce(hydrated, { type: "quiet/set", quiet: true });
  assert.deepEqual(selectQuietPreparationTargets(again), ["k-2"]);
});

test("with one item in the queue quiet mode prepares just that one", () => {
  let state = ran(createInitialReviewState(), "clarity", [item("k-1", "p-1")]);
  state = reduce(state, { type: "quiet/set", quiet: true });
  assert.deepEqual(selectQuietPreparationTargets(state), ["k-1"]);
});

test("quiet-mode marks: the current item in full, every other one dimmed", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-2")]);
  state = ran(state, "accent", [accent("a-1", "p-1", "тиском сну")]);
  state = reduce(state, { type: "quiet/set", quiet: true });

  const marks = buildItemMarks(state, { locale: "uk", getDiff: () => undefined });
  assert.deepEqual(marks.map((mark) => [mark.itemId, mark.focused, Boolean(mark.dim)]), [["a-1", true, false], ["s-1", false, true]]);

  const loud = buildItemMarks(reduce(state, { type: "quiet/set", quiet: false }), { locale: "uk", getDiff: () => undefined });
  assert.equal(loud.some((mark) => mark.dim), false);
});

/* ---------- marks per kind ---------- */

test("each kind is drawn its own way: ghost heading, ghost callout, inline accent, block highlight for what is not prepared", () => {
  let state = ran(createInitialReviewState(), "structure", [heading("s-1", "p-2")]);
  state = ran(state, "accent", [accent("a-1", "p-1", "тиском сну", 1)]);
  state = ran(state, "interest", [callout("c-1", "p-3"), callout("c-2", "p-2")]);
  state = ran(state, "clarity", [item("k-1", "p-1")]);
  state = reduce(state, { type: "proposal/requested", item: byId(state, "c-1") }, { type: "draft/ready", itemId: "c-1", proposal: calloutProposal("c-1") }, { type: "focus/set", itemId: "s-1" });

  const marks = new Map(buildItemMarks(state, { locale: "uk", getDiff: () => undefined }).map((mark) => [mark.itemId, mark]));

  assert.deepEqual(marks.get("s-1")?.ghost, { type: "heading", anchorBlockId: "p-2", title: "Як кофеїн обманює мозок", level: 2, editable: true });
  assert.deepEqual(marks.get("s-1")?.blockIds, []);
  assert.deepEqual(marks.get("a-1")?.inline, { type: "accent", blockId: "p-1", text: "тиском сну", occurrence: 1 });

  const ghost = marks.get("c-1")?.ghost;
  assert.ok(ghost?.type === "callout");
  assert.equal(ghost.anchorBlockId, "p-3");
  assert.equal(ghost.side, "after");
  assert.equal(ghost.label, "Аналогія · стисло");
  assert.equal(ghost.block.kind, "analogy");

  assert.equal(marks.get("c-2")?.ghost, undefined, "an unprepared callout has nothing to show but its paragraph");
  assert.deepEqual(marks.get("c-2")?.blockIds, ["p-2"]);
  assert.deepEqual(marks.get("k-1")?.blockIds, ["p-1"]);
  assert.equal(marks.get("k-1")?.tone, "clarity");
});

/* ---------- redo, pruning, saving ---------- */

test("redo is recognised when a replacement left fewer blocks than it anchored", () => {
  let state = ran(createInitialReviewState(), "clarity", [
    item("k-1", "p-2", { anchor: { blockIds: ["p-2", "p-3"], generationBlockRange: { start: 2, end: 3 }, excerpt: "…", fingerprint: computeAnchorFingerprint(baseDocument, ["p-2", "p-3"]) } })
  ]);
  const merged = paragraph("p-2", "Два абзаци стали одним.");
  state = reduce(
    state,
    { type: "focus/set", itemId: "k-1" },
    { type: "proposal/requested", item: byId(state, "k-1") },
    { type: "proposal/ready", itemId: "k-1", proposal: textProposal("k-1", ["p-2", "p-3"], [merged]) }
  );
  const applied = withBlock(withBlock(baseDocument, "p-2", merged), "p-3", null);

  state = reduce(
    state,
    { type: "item/accepted", itemId: "k-1", appliedFingerprint: computeAnchorFingerprint(applied, ["p-2"]), appliedBlockIds: ["p-2"], at: "t" },
    { type: "items/reconciled", ...context(applied) }
  );
  assert.equal(byId(state, "k-1").status, "applied");

  state = reduce(state, { type: "items/reconciled", ...context() });
  assert.equal(byId(state, "k-1").status, "ready", "undo: both paragraphs are back, and so is the diff");
  assert.equal(state.proposals["k-1"]?.status, "ready");

  state = reduce(state, { type: "items/reconciled", ...context(applied) });
  assert.equal(byId(state, "k-1").status, "applied", "redo: one block where two were anchored");
  assert.equal(state.decisions[0]!.undone, false);
  assert.equal(state.proposals["k-1"], undefined);
});

test("a rewrite whose anchored blocks no longer stand together is stale, and comes back when they do", () => {
  const anchor = { blockIds: ["p-2", "p-3"], generationBlockRange: { start: 2, end: 3 }, excerpt: "…", fingerprint: computeAnchorFingerprint(baseDocument, ["p-2", "p-3"]) };
  let state = ran(createInitialReviewState(), "formatting", [item("f-1", "p-2", { recommendationType: "list", stepId: "formatting", anchor })]);
  state = reduce(
    state,
    { type: "focus/set", itemId: "f-1" },
    { type: "proposal/requested", item: byId(state, "f-1") },
    { type: "proposal/ready", itemId: "f-1", proposal: textProposal("f-1", ["p-2", "p-3"], [paragraph("p-2", "Разом.")]) }
  );
  assert.equal(canApplyProposal(state, "f-1"), true);

  // A heading is accepted between the two paragraphs: their text is unchanged, the anchor is torn.
  const torn = insertBefore(baseDocument, "p-3", { id: "heading-new", type: "heading", level: 2, content: [{ text: "Далі" }] });
  state = reduce(state, { type: "items/reconciled", ...context(torn) });
  assert.equal(byId(state, "f-1").status, "stale");
  assert.equal(canApplyProposal(state, "f-1"), false, "no enabled accept that can only fail");

  // A callout after the first paragraph tears it the same way.
  const withCallout = insertAfter(baseDocument, "p-2", { id: "callout-new", type: "callout", kind: "analogy", title: [{ text: "Т" }], body: [[{ text: "Б" }]] });
  assert.equal(byId(reduce(state, { type: "items/reconciled", ...context(withCallout) }), "f-1").status, "stale");

  state = reduce(state, { type: "items/reconciled", ...context() });
  assert.equal(byId(state, "f-1").status, "ready", "the heading was undone: the prepared change is valid again");

  // A single-block rewrite and a heading are not affected by what is inserted around them.
  let single = ran(createInitialReviewState(), "clarity", [item("k-1", "p-2")]);
  single = reduce(single, { type: "items/reconciled", ...context(torn) });
  assert.equal(byId(single, "k-1").status, "pending");
});

test("an accepted accent stays accepted when the same phrase is typed earlier in the paragraph", () => {
  let state = ran(createInitialReviewState(), "accent", [accent("a-1", "p-1", "тиском сну")]);
  const applied = bolden(baseDocument, "p-1", "тиском сну");
  state = reduce(
    state,
    { type: "item/accepted", itemId: "a-1", appliedFingerprint: computeAnchorFingerprint(applied, ["p-1"]), at: "t" },
    { type: "items/reconciled", ...context(applied) }
  );

  // "тиском сну" now also stands at the start, not bold: occurrence 1 is other text than what was accepted.
  const typed = withBlock(applied, "p-1", {
    id: "p-1",
    type: "paragraph",
    content: [{ text: `Під тиском сну ми слабнемо. ${P1.slice(0, P1.indexOf("тиском сну"))}` }, { text: "тиском сну", bold: true }, { text: "." }]
  });
  state = reduce(state, { type: "items/reconciled", ...context(typed) });
  assert.equal(byId(state, "a-1").status, "applied");
  assert.equal(state.decisions[0]!.undone, undefined);

  // Undo of the acceptance itself is still recognised: no occurrence is bold any more.
  state = reduce(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(byId(state, "a-1").status, "ready");
});

test("redo is recognised when a replacement left more blocks than it anchored", () => {
  let state = ran(createInitialReviewState(), "formatting", [item("f-1", "p-3", { recommendationType: "list", stepId: "formatting" })]);
  const intro = paragraph("p-3", "Кофеїн:");
  const list: Block = { id: "list-new", type: "bullet_list", items: [[{ text: "займає рецептор" }], [{ text: "не активує його" }]] };
  state = reduce(
    state,
    { type: "focus/set", itemId: "f-1" },
    { type: "proposal/requested", item: byId(state, "f-1") },
    { type: "proposal/ready", itemId: "f-1", proposal: textProposal("f-1", ["p-3"], [intro, list]) }
  );
  const applied = insertAfter(withBlock(baseDocument, "p-3", intro), "p-3", list);

  state = reduce(state, {
    type: "item/accepted",
    itemId: "f-1",
    appliedFingerprint: computeAnchorFingerprint(applied, ["p-3", "list-new"]),
    appliedBlockIds: ["p-3", "list-new"],
    at: "t"
  });
  state = reduce(state, { type: "items/reconciled", ...context(applied) });
  assert.equal(byId(state, "f-1").status, "applied");

  state = reduce(state, { type: "items/reconciled", ...context() });
  assert.equal(byId(state, "f-1").status, "ready");
  state = reduce(state, { type: "items/reconciled", ...context(applied) });
  assert.equal(byId(state, "f-1").status, "applied");
});

test("proposals of decided items are pruned: only recent acceptances keep theirs in memory, and none is written to the draft", () => {
  const blocks = Array.from({ length: DECISION_PROPOSALS_KEPT + 5 }, (_, index) => paragraph(`q-${index}`, `Абзац номер ${index}.`));
  const document: EditorDocument = { version: 2, blocks };
  const items = blocks.map((block, index) =>
    item(`k-${index}`, block.id, { anchor: { blockIds: [block.id], generationBlockRange: { start: index, end: index }, excerpt: "…", fingerprint: computeAnchorFingerprint(document, [block.id]) } })
  );
  let state = ran(createInitialReviewState(), "clarity", items, document);

  for (const [index, block] of blocks.entries()) {
    const id = `k-${index}`;
    const proposal = textProposal(id, [block.id], [paragraph(block.id, "Просто.")]);
    proposal.textDiff!.oldBlocks = [block];
    state = reduce(
      state,
      { type: "focus/set", itemId: id },
      { type: "proposal/requested", item: byId(state, id) },
      { type: "proposal/ready", itemId: id, proposal },
      { type: "item/accepted", itemId: id, appliedFingerprint: "applied", appliedBlockIds: [block.id], at: "t" }
    );
  }

  assert.equal(state.decisions.length, blocks.length);
  assert.equal(state.decisions.filter((decision) => decision.proposal).length, DECISION_PROPOSALS_KEPT);
  assert.equal(state.decisions[0]!.proposal, undefined, "the oldest ones gave theirs up");
  assert.ok(state.decisions.at(-1)!.proposal);
  assert.deepEqual(state.proposals, {}, "nothing is kept for decided items among the live proposals");

  const stored = serializeReviewState(state);
  assert.equal(stored.decisions.some((decision) => "proposal" in decision), false, "undo history does not survive a reload, so neither do these");
  assert.deepEqual(stored.proposals, {});
  assert.deepEqual(persisted(state)?.decisions[0], { itemId: "k-0", passId: "clarity", outcome: "accepted", at: "t", appliedFingerprint: "applied", appliedBlockIds: ["q-0"] });
});

test("a poll that only moved the progress bar is not worth a draft write; anything that changed the queue is", () => {
  const snapshot = (items: V2ReviewItem[]): V2ReviewAction => ({ type: "run/snapshot", passId: "clarity", record: record("clarity"), items, ...context() });

  assert.equal(shouldPersistAfter(snapshot([])), false);
  assert.equal(shouldPersistAfter(snapshot([item("k-1", "p-1")])), true);

  for (const action of [
    { type: "focus/set", itemId: "k-1" },
    { type: "focus/moved", delta: 1 },
    { type: "hover/set", itemId: "k-1" },
    { type: "instruction/set", itemId: "k-1", text: "x" },
    { type: "spell/requested" },
    { type: "hydrate", persisted: null }
  ] satisfies V2ReviewAction[]) {
    assert.equal(shouldPersistAfter(action), false, action.type);
  }

  for (const action of [
    { type: "run/started", passId: "clarity", runMode: "replace", record: record("clarity") },
    { type: "item/rejected", itemId: "k-1", at: "t" },
    { type: "item/headingEdited", itemId: "s-1", title: "x" },
    { type: "spell/choice", itemId: "s", choice: 1 },
    { type: "queue/set", passIds: ["clarity"] },
    { type: "quiet/set", quiet: true },
    { type: "filter/set", filter: "spell" }
  ] satisfies V2ReviewAction[]) {
    assert.equal(shouldPersistAfter(action), true, action.type);
  }
});
