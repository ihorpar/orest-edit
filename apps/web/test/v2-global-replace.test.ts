import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { EditorState, type Command } from "@tiptap/pm/state";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { createBlockIdPlugin, getTopLevelBlockIds } from "../lib/v2/block-ids.ts";
import { countTextMatches, findTextMatches, getReplaceStatus, replaceAllText, type ReplaceOutcome } from "../lib/v2/global-replace.ts";
import type { V2ReviewItem } from "../lib/v2/item-kinds.ts";
import { sealHistory } from "../lib/v2/review-apply.ts";
import { createInitialReviewState, reviewReducer, type V2ReviewState } from "../lib/v2/store.ts";
import { documentToTiptap, tiptapToDocument } from "../lib/v2/tiptap-bridge.ts";
import { createV2Extensions } from "../lib/v2/tiptap-extensions.ts";

const schema = getSchema(createV2Extensions());
const p = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });

const base: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Сон і аденозин" }] },
    p("p-1", "Аденозин накопичується. Більше аденозин — сильніший тиск сну."),
    { id: "p-2", type: "paragraph", content: [{ text: "Кофеїн блокує " }, { text: "аденозин", bold: true }, { text: " на рецепторі." }] },
    { id: "l-1", type: "bullet_list", items: [[{ text: "аденозин росте" }], [{ text: "кофеїн заважає" }]] },
    { id: "c-1", type: "callout", kind: "analogy", title: [{ text: "Ключ і аденозин" }], body: [[{ text: "Кофеїн — не аденозин." }]] },
    { id: "img-1", type: "image", assetId: "asset-1", alt: "аденозин", caption: [{ text: "аденозин на схемі" }] },
    p("p-3", "Перший рядок аденозин\nдругий рядок.")
  ]
};

function createState(document: EditorDocument = base): EditorState {
  return EditorState.create({ doc: schema.nodeFromJSON(documentToTiptap(document)), plugins: [history({ newGroupDelay: 500 }), createBlockIdPlugin()] });
}

function apply(state: EditorState, command: Command): EditorState {
  let next = state;
  assert.equal(command(state, (transaction) => (next = state.apply(transaction))), true, "command should apply");
  return next;
}

const read = (state: EditorState) => tiptapToDocument(state.doc.toJSON());
const textOf = (document: EditorDocument, id: string) => JSON.stringify(document.blocks.find((block) => block.id === id));

test("matches are counted over paragraphs, headings, lists and callouts; figures are left alone", () => {
  const state = createState();

  // heading 1, p-1 1 (the other is capitalised), p-2 1, list 1, callout 2, p-3 1; the image's alt and caption are not searched.
  assert.equal(countTextMatches(state.doc, "аденозин"), 7);
  assert.equal(countTextMatches(state.doc, "Аденозин"), 1, "the search is case-sensitive");
  assert.equal(countTextMatches(state.doc, ""), 0);
  assert.equal(countTextMatches(state.doc, "цього немає"), 0);
  assert.deepEqual([...new Set(findTextMatches(state.doc, "аденозин").map((match) => match.blockId))], ["h-1", "p-1", "p-2", "l-1", "c-1", "p-3"]);
});

test("a match never spans two blocks or a line break", () => {
  const state = createState();

  assert.equal(countTextMatches(state.doc, "аденозин\nдругий"), 0);
  assert.equal(countTextMatches(state.doc, "сну.Кофеїн"), 0);
});

test("replace all changes every match in one step and reports what it did", () => {
  let outcome: ReplaceOutcome | null = null;
  const state = apply(createState(), replaceAllText("аденозин", "АТФ-залишок", (result) => (outcome = result)));
  const document = read(state);

  assert.deepEqual(outcome, { count: 7, blockIds: ["h-1", "p-1", "p-2", "l-1", "c-1", "p-3"] });
  assert.equal(countTextMatches(state.doc, "аденозин"), 0);
  assert.equal(countTextMatches(state.doc, "АТФ-залишок"), 7);
  assert.match(textOf(document, "p-1"), /Більше АТФ-залишок — сильніший/);
  assert.match(textOf(document, "p-3"), /АТФ-залишок\\nдругий рядок/);
  assert.equal(textOf(document, "img-1"), textOf(base, "img-1"), "the figure is untouched");
});

test("block ids and the formatting around a match survive the replacement", () => {
  const before = createState();
  const state = apply(before, replaceAllText("аденозин", "рецептор"));
  const document = read(state);

  assert.deepEqual(getTopLevelBlockIds(state.doc), getTopLevelBlockIds(before.doc));
  assert.deepEqual(document.blocks.find((block) => block.id === "p-2"), {
    id: "p-2",
    type: "paragraph",
    content: [{ text: "Кофеїн блокує " }, { text: "рецептор", bold: true }, { text: " на рецепторі." }]
  });
});

test("one undo takes the whole replacement back and nothing typed before it; redo brings it again", () => {
  let state = createState();
  state = state.apply(state.tr.insertText("Вступ. ", 1));
  state = apply(state, sealHistory);
  const typed = JSON.stringify(read(state));

  state = apply(state, replaceAllText("аденозин", "X"));
  state = apply(state, sealHistory);
  assert.equal(countTextMatches(state.doc, "аденозин"), 0);

  state = apply(state, undo);
  assert.equal(JSON.stringify(read(state)), typed, "exactly the replacement is undone");

  state = apply(state, redo);
  assert.equal(countTextMatches(state.doc, "аденозин"), 0);
  assert.equal(countTextMatches(state.doc, "X"), 7);
});

test("an empty replacement deletes the matches", () => {
  const state = apply(createState(), replaceAllText(" аденозин", ""));

  assert.match(textOf(read(state), "p-1"), /Більше — сильніший/);
});

test("nothing found, or a replacement equal to the search, changes nothing", () => {
  const state = createState();
  let dispatched = false;
  const dispatch = () => {
    dispatched = true;
  };

  assert.equal(replaceAllText("цього немає", "щось")(state, dispatch), false);
  assert.equal(replaceAllText("аденозин", "аденозин")(state, dispatch), false);
  assert.equal(replaceAllText("", "щось")(state, dispatch), false);
  assert.equal(dispatched, false);
});

test("the dialog says honestly what it found", () => {
  assert.deepEqual(getReplaceStatus(0, "", "x"), { kind: "empty" });
  assert.deepEqual(getReplaceStatus(0, "слово", "x"), { kind: "none" });
  assert.deepEqual(getReplaceStatus(3, "слово", "слово"), { kind: "same", count: 3 });
  assert.deepEqual(getReplaceStatus(3, "слово", ""), { kind: "ready", count: 3 });
});

test("open suggestions over text the replacement changed go stale; the others stay as they were", () => {
  const item = (id: string, blockId: string): V2ReviewItem =>
    ({
      id,
      reviewSessionId: "s",
      documentRevisionId: deriveManuscriptRevisionState(base).documentRevisionId,
      changeLevel: 5,
      title: id,
      reason: "Причина.",
      recommendation: "Що зробити.",
      recommendationType: "simplify",
      suggestedAction: "rewrite_text",
      priority: "medium",
      anchor: { blockIds: [blockId], generationBlockRange: { start: 1, end: 1 }, excerpt: "…", fingerprint: computeAnchorFingerprint(base, [blockId]) },
      insertionPoint: { mode: "replace", anchorBlockId: blockId },
      origin: "review",
      stepId: "clarity",
      stepRunId: "run",
      status: "pending"
    }) as V2ReviewItem;

  // Seeded through hydration, the way a stored draft arrives.
  let review: V2ReviewState = reviewReducer(createInitialReviewState(), {
    type: "hydrate",
    persisted: { passes: {}, items: [item("k-1", "p-1"), item("k-2", "p-2")], proposals: {}, decisions: [], rejectedIdeas: [], activeRun: null, filter: "all", quiet: false }
  });

  const after = read(apply(createState(), replaceAllText("накопичується", "росте")));
  review = reviewReducer(review, { type: "items/reconciled", document: after, revision: deriveManuscriptRevisionState(after) });

  assert.equal(review.items.find((entry) => entry.id === "k-1")!.status, "stale", "its paragraph changed");
  assert.equal(review.items.find((entry) => entry.id === "k-2")!.status, "pending", "its paragraph did not");
});
