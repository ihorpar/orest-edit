import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { EditorState, TextSelection, type Command } from "@tiptap/pm/state";
import type { Decoration } from "@tiptap/pm/view";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import { createBlockIdPlugin, getTopLevelBlockIds } from "../lib/v2/block-ids.ts";
import { findAnchorRange, readAnchoredBlocks, replaceAnchoredBlocks, resolveReplacementBlocks, sealHistory } from "../lib/v2/review-apply.ts";
import {
  createReviewMarksPlugin,
  getReviewDecorations,
  readBlockText,
  setReviewMarks,
  sliceInlineNodes,
  type ReviewDecorationSpec,
  type ReviewMark
} from "../lib/v2/review-marks.ts";
import { documentToTiptap, tiptapToDocument } from "../lib/v2/tiptap-bridge.ts";
import { createV2Extensions } from "../lib/v2/tiptap-extensions.ts";
import { diffProposalBlocks } from "../lib/v2/word-diff.ts";

const schema = getSchema(createV2Extensions());
const p = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });

const baseDocument: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    p("p-1", "Єдиний фізіологічний механізм елімінації аденозину — це сон."),
    p("p-2", "Під час глибокого сну його концентрація знижується."),
    p("p-3", "Вранці тиск сну починає рости з нуля.")
  ]
};

function createState(document: EditorDocument = baseDocument): EditorState {
  return EditorState.create({
    doc: schema.nodeFromJSON(documentToTiptap(document)),
    plugins: [history({ newGroupDelay: 500 }), createBlockIdPlugin(), createReviewMarksPlugin()]
  });
}

function apply(state: EditorState, command: Command): EditorState {
  let next = state;
  const handled = command(state, (transaction) => {
    next = state.apply(transaction);
  });
  assert.equal(handled, true, "command should apply");
  return next;
}

const read = (state: EditorState) => tiptapToDocument(state.doc.toJSON());
const textOf = (state: EditorState, blockId: string) => {
  const block = read(state).blocks.find((entry) => entry.id === blockId);
  return block && block.type === "paragraph" ? block.content.map((node) => node.text).join("") : null;
};

function typeAt(state: EditorState, blockId: string, text: string, time: number): EditorState {
  let position = -1;
  state.doc.forEach((node, pos) => {
    if (node.attrs.id === blockId) {
      position = pos + node.nodeSize - 1;
    }
  });
  const transaction = state.tr.insertText(text, position);
  transaction.setTime(time);
  return state.apply(transaction.setSelection(TextSelection.create(transaction.doc, position + text.length)));
}

function mark(overrides: Partial<ReviewMark> & Pick<ReviewMark, "itemId" | "blockIds">): ReviewMark {
  return { tone: "clarity", state: "pending", focused: false, hot: false, ...overrides };
}

function decorations(state: EditorState): Array<{ from: number; to: number; spec: ReviewDecorationSpec; attrs: Record<string, string> }> {
  // The accept / reject buttons beside a mark have their own tests (v2-review-edits); here only the marks.
  return getReviewDecorations(state)
    .find()
    .filter((decoration: Decoration) => (decoration.spec as ReviewDecorationSpec).review !== "controls")
    .map((decoration: Decoration) => ({
      from: decoration.from,
      to: decoration.to,
      spec: decoration.spec as ReviewDecorationSpec,
      attrs: ((decoration as unknown as { type: { attrs?: Record<string, string> } }).type.attrs ?? {}) as Record<string, string>
    }));
}

/* ---------- marks ---------- */

test("a pending item highlights its anchored blocks and nothing else", () => {
  const state = apply(createState(), setReviewMarks([mark({ itemId: "item-1", blockIds: ["p-1", "p-2"] })]));
  const blocks = decorations(state).filter((entry) => entry.spec.review === "block");

  assert.deepEqual(blocks.map((entry) => entry.spec.review === "block" && entry.spec.blockId), ["p-1", "p-2"]);
  assert.equal(blocks[0]!.attrs["data-sg"], "pending");
  assert.equal(blocks[0]!.attrs["data-sg-items"], "item-1");
  assert.equal(blocks[0]!.attrs["data-sg-tone"], "clarity");
  assert.equal("data-sg-focus" in blocks[0]!.attrs, false);
  assert.equal(decorations(state).length, 2);
});

test("several items on one block share it; the focused one decides how it looks", () => {
  const state = apply(
    createState(),
    setReviewMarks([
      mark({ itemId: "item-1", blockIds: ["p-1"], state: "stale" }),
      mark({ itemId: "item-2", blockIds: ["p-1"], state: "preparing", focused: true, hot: true })
    ])
  );
  const [block] = decorations(state);

  assert.equal(block!.attrs["data-sg-items"], "item-1 item-2");
  assert.equal(block!.attrs["data-sg"], "preparing");
  assert.equal(block!.attrs["data-sg-focus"], "");
  assert.equal(block!.attrs["data-sg-hot"], "");
});

test("a focused ready item draws a word-level diff: del over old words, ins widgets for new ones", () => {
  const newText = "Позбутися аденозину можна лише одним способом — поспати.";
  const diff = diffProposalBlocks(["p-1"], [baseDocument.blocks[1]!], [p("p-1", newText)]);
  const state = apply(createState(), setReviewMarks([mark({ itemId: "item-1", blockIds: ["p-1"], state: "ready", focused: true, diff })]));
  const all = decorations(state);
  const deleted = all.filter((entry) => entry.spec.review === "del");
  const inserted = all.filter((entry) => entry.spec.review === "ins");

  assert.ok(deleted.length > 0 && inserted.length > 0);

  for (const entry of deleted) {
    assert.equal(state.doc.textBetween(entry.from, entry.to), entry.spec.review === "del" ? entry.spec.text : "", "a del decoration covers exactly the removed text");
  }

  // Rebuild the proposed text from the document plus the decorations.
  const blockStart = all.find((entry) => entry.spec.review === "block")!.from + 1;
  const oldText = readBlockText(state.doc.nodeAt(blockStart - 1)!);
  let rebuilt = "";
  let cursor = 0;
  const events = [...deleted, ...inserted].sort((left, right) => left.from - right.from || (left.spec.review === "del" ? -1 : 1));

  for (const entry of events) {
    const offset = entry.from - blockStart;
    rebuilt += oldText.slice(cursor, Math.max(cursor, offset));
    cursor = Math.max(cursor, offset);

    if (entry.spec.review === "del") {
      cursor = entry.to - blockStart;
    } else if (entry.spec.review === "ins") {
      // An insertion that follows a deletion sits at the end of the deleted range.
      rebuilt += entry.spec.text;
    }
  }

  rebuilt += oldText.slice(cursor);
  assert.equal(rebuilt, newText);
  assert.equal(all.find((entry) => entry.spec.review === "block")!.attrs["data-sg-diff"], "text");
});

test("the diff is drawn only for the focused item", () => {
  const diff = diffProposalBlocks(["p-1"], [baseDocument.blocks[1]!], [p("p-1", "Інший текст.")]);
  const state = apply(createState(), setReviewMarks([mark({ itemId: "item-1", blockIds: ["p-1"], state: "ready", diff })]));
  assert.deepEqual(decorations(state).map((entry) => entry.spec.review), ["block"]);
});

test("marks and diffs never reach the document or the saved draft", () => {
  const diff = diffProposalBlocks(["p-1"], [baseDocument.blocks[1]!], [p("p-1", "Зовсім інший текст із новими словами.")]);
  const before = createState();
  const state = apply(before, setReviewMarks([mark({ itemId: "item-1", blockIds: ["p-1"], state: "ready", focused: true, diff })]));

  assert.ok(decorations(state).length > 2);
  assert.ok(state.doc.eq(before.doc), "the document node is unchanged");
  assert.deepEqual(read(state), baseDocument);
  assert.equal(JSON.stringify(read(state)).includes("новими словами"), false);
  assert.equal(JSON.stringify(state.doc.toJSON()).includes("data-sg"), false);
});

test("setting marks is not an undoable step", () => {
  const typed = typeAt(createState(), "p-3", " Так.", 1000);
  const marked = apply(typed, setReviewMarks([mark({ itemId: "item-1", blockIds: ["p-1"] })]));
  const undone = apply(marked, undo);

  assert.equal(textOf(undone, "p-3"), "Вранці тиск сну починає рости з нуля.");
  assert.equal(decorations(undone).length, 1, "marks stay while the text is undone");
});

test("typing inside the anchored block removes its diff (the text no longer matches) but keeps the highlight", () => {
  const diff = diffProposalBlocks(["p-1"], [baseDocument.blocks[1]!], [p("p-1", "Інший текст.")]);
  const marked = apply(createState(), setReviewMarks([mark({ itemId: "item-1", blockIds: ["p-1"], state: "ready", focused: true, diff })]));
  const typed = typeAt(marked, "p-1", " Ще речення.", 1000);

  assert.deepEqual(decorations(typed).map((entry) => entry.spec.review), ["block"]);
  assert.equal("data-sg-diff" in decorations(typed)[0]!.attrs, false);

  const elsewhere = typeAt(marked, "p-3", " Так.", 1000);
  assert.ok(decorations(elsewhere).some((entry) => entry.spec.review === "ins"), "typing in another block keeps the diff");
});

test("reshaped, removed and added blocks are shown as whole blocks", () => {
  const list: Block = { id: "p-1", type: "bullet_list", items: [[{ text: "раз" }], [{ text: "два" }]] };
  const diff = diffProposalBlocks(["p-1", "p-2"], [baseDocument.blocks[1]!, baseDocument.blocks[2]!], [list]);
  const state = apply(createState(), setReviewMarks([mark({ itemId: "item-1", blockIds: ["p-1", "p-2"], state: "ready", focused: true, diff })]));
  const all = decorations(state);
  const blocks = all.filter((entry) => entry.spec.review === "block");

  assert.deepEqual(blocks.map((entry) => entry.attrs["data-sg-diff"]), ["block", "block"]);
  assert.equal(all.filter((entry) => entry.spec.review === "ins-block").length, 1);
  assert.deepEqual(read(state), baseDocument);

  const added = diffProposalBlocks(["p-3"], [baseDocument.blocks[3]!], [baseDocument.blocks[3]!, p("new", "Додатковий абзац.")]);
  const withAdded = apply(createState(), setReviewMarks([mark({ itemId: "item-2", blockIds: ["p-3"], state: "ready", focused: true, diff: added })]));
  const widget = decorations(withAdded).find((entry) => entry.spec.review === "ins-block")!;
  assert.equal(widget.from, withAdded.doc.content.size, "the added block is previewed right after the anchor");
});

test("a mark whose block is gone draws nothing", () => {
  const state = apply(createState(), setReviewMarks([mark({ itemId: "item-1", blockIds: ["p-gone"] })]));
  assert.equal(decorations(state).length, 0);
});

/* ---------- applying ---------- */

test("replacement blocks keep the anchored ids by position and get fresh ids beyond them", () => {
  const resolved = resolveReplacementBlocks(["p-1", "p-2"], [p("x", "А"), p("y", "Б"), p("p-1", "В")], () => "p-new");
  assert.deepEqual(resolved.map((block) => block.id), ["p-1", "p-2", "p-new"]);
});

test("the anchor must be intact: all blocks present, in order, next to each other", () => {
  const { doc } = createState();
  assert.ok(findAnchorRange(doc, ["p-1", "p-2"]));
  assert.equal(findAnchorRange(doc, ["p-1", "p-3"]), null);
  assert.equal(findAnchorRange(doc, ["p-2", "p-1"]), null);
  assert.equal(findAnchorRange(doc, ["p-1", "p-gone"]), null);
  assert.equal(findAnchorRange(doc, []), null);
  assert.deepEqual(readAnchoredBlocks(doc, ["p-2"]), [baseDocument.blocks[2]]);
  assert.equal(replaceAnchoredBlocks(["p-1", "p-3"], [p("p-1", "x")])(createState()), false);
  assert.equal(replaceAnchoredBlocks(["p-1"], [])(createState()), false);
});

test("accepting replaces the text, keeps ids and inline bold, and one undo restores the original exactly", () => {
  const newBlock: Block = {
    id: "server-id",
    type: "paragraph",
    content: [{ text: "Позбутися аденозину можна лише одним способом — " }, { text: "поспати", bold: true }, { text: "." }]
  };
  const before = createState();
  const accepted = apply(apply(before, replaceAnchoredBlocks(["p-1"], [newBlock])), sealHistory);

  assert.deepEqual(getTopLevelBlockIds(accepted.doc), ["h-1", "p-1", "p-2", "p-3"]);
  assert.deepEqual(read(accepted).blocks[1], { ...newBlock, id: "p-1" });

  const undone = apply(accepted, undo);
  assert.ok(undone.doc.eq(before.doc));
  assert.deepEqual(read(undone), baseDocument);

  const redone = apply(undone, redo);
  assert.deepEqual(read(redone).blocks[1], { ...newBlock, id: "p-1" });
});

test("the accepted change is its own undo step even between immediate, adjacent typing", () => {
  const start = createState();
  // All within the history's grouping delay, and right next to the replaced block.
  const typedBefore = typeAt(start, "p-1", " До.", 1000);
  const replaced = apply(typedBefore, (state, dispatch) =>
    replaceAnchoredBlocks(["p-1"], [p("p-1", "Новий текст абзацу.")])(state, dispatch ? (transaction) => dispatch(transaction.setTime(1010)) : undefined)
  );
  const sealed = apply(replaced, sealHistory);
  const typedAfter = typeAt(sealed, "p-1", " Після.", 1020);

  assert.equal(textOf(typedAfter, "p-1"), "Новий текст абзацу. Після.");

  const first = apply(typedAfter, undo);
  assert.equal(textOf(first, "p-1"), "Новий текст абзацу.", "the first undo removes only what was typed after");

  const second = apply(first, undo);
  assert.equal(textOf(second, "p-1"), "Єдиний фізіологічний механізм елімінації аденозину — це сон. До.", "the second undo takes back exactly the accepted change");

  const third = apply(second, undo);
  assert.deepEqual(read(third), baseDocument);
});

test("a multi-block replacement with more blocks keeps the first ids and stays one undo step", () => {
  const before = createState();
  const accepted = apply(
    apply(before, replaceAnchoredBlocks(["p-1", "p-2"], [p("a", "Перший."), p("b", "Другий."), p("c", "Третій.")])),
    sealHistory
  );
  const ids = getTopLevelBlockIds(accepted.doc);

  assert.equal(ids.length, 5);
  assert.deepEqual(ids.slice(0, 3), ["h-1", "p-1", "p-2"]);
  assert.equal(ids[4], "p-3");
  assert.equal(new Set(ids).size, 5);
  assert.notEqual(ids[3], "c");
  assert.deepEqual(read(apply(accepted, undo)), baseDocument);
});

test("a paragraph can become a list in place, keeping the anchored id", () => {
  const list: Block = { id: "whatever", type: "bullet_list", items: [[{ text: "раз" }], [{ text: "два" }]] };
  const accepted = apply(createState(), replaceAnchoredBlocks(["p-2"], [list]));
  assert.deepEqual(read(accepted).blocks[2], { ...list, id: "p-2" });
});

test("inserted text carries the bold and italic of the proposed block", () => {
  const newBlock: Block = {
    id: "p-1",
    type: "paragraph",
    content: [{ text: "Позбутися аденозину можна лише одним способом — " }, { text: "поспати", bold: true }, { text: "." }]
  };
  const diff = diffProposalBlocks(["p-1"], [baseDocument.blocks[1]!], [newBlock]);
  const state = apply(createState(), setReviewMarks([mark({ itemId: "item-1", blockIds: ["p-1"], state: "ready", focused: true, diff })]));
  const inserted = decorations(state).filter((entry) => entry.spec.review === "ins");
  const nodes = inserted.flatMap((entry) => (entry.spec.review === "ins" ? entry.spec.nodes : []));

  assert.ok(nodes.some((node) => node.bold && node.text === "поспати"), "the bold run is kept as a bold node");
  assert.equal(nodes.map((node) => node.text).join(""), inserted.map((entry) => (entry.spec.review === "ins" ? entry.spec.text : "")).join(""));
  assert.equal(JSON.stringify(read(state)).includes("поспати"), false);
});

test("inline nodes are sliced by text offsets, falling back to plain text when they do not match", () => {
  const nodes = [{ text: "звичайний " }, { text: "жирний", bold: true as const }, { text: " кінець" }];
  assert.deepEqual(sliceInlineNodes(nodes, 6, 13, "ний жир"), [{ text: "ний " }, { text: "жир", bold: true }]);
  assert.deepEqual(sliceInlineNodes(nodes, 0, 3, "зви"), [{ text: "зви" }]);
  assert.deepEqual(sliceInlineNodes(nodes, 0, 3, "інше"), [{ text: "інше" }]);
});
