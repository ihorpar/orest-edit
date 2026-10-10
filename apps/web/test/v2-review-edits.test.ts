import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { EditorState, type Command } from "@tiptap/pm/state";
import type { Decoration } from "@tiptap/pm/view";

import type { Block, CalloutBlock, EditorDocument } from "../lib/editor/document-model.ts";
import { createBlockIdPlugin, getTopLevelBlockIds } from "../lib/v2/block-ids.ts";
import { applyReviewEdits, replaceAnchoredBlocks, resolveReplacementBlocks, sealHistory, type ReviewEdit } from "../lib/v2/review-apply.ts";
import {
  createReviewMarksPlugin,
  getReviewDecorations,
  getReviewDiffReport,
  isReviewDiffDrawn,
  setReviewMarks,
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
    p("p-1", "Тиск сну росте, і тиск сну не зникає."),
    p("p-2", "До вечора ми відчуваемо втому, а концентрація знижуеться."),
    { id: "p-3", type: "paragraph", content: [{ text: "Кофеїн " }, { text: "займає", italic: true }, { text: " рецептор аденозину." }] }
  ]
};

const calloutBlock: CalloutBlock = {
  id: "callout-new",
  type: "callout",
  kind: "analogy",
  depth: "brief",
  title: [{ text: "Ключ у замку" }],
  body: [[{ text: "Кофеїн — схожий " }, { text: "ключ", bold: true }, { text: "." }], [{ text: "Він не повертається." }]]
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

function refuses(state: EditorState, command: Command) {
  let dispatched = false;
  const handled = command(state, () => {
    dispatched = true;
  });
  assert.equal(handled, false, "command should refuse");
  assert.equal(dispatched, false, "a refused command changes nothing");
}

const read = (state: EditorState) => tiptapToDocument(state.doc.toJSON());
const blockOf = (state: EditorState, blockId: string) => read(state).blocks.find((entry) => entry.id === blockId);

const accept = (state: EditorState, edits: ReviewEdit[]) => apply(apply(state, applyReviewEdits(edits)), sealHistory);

function mark(overrides: Partial<ReviewMark> & Pick<ReviewMark, "itemId">): ReviewMark {
  return { tone: "accent", blockIds: [], state: "ready", focused: false, hot: false, ...overrides };
}

function decorations(state: EditorState): Array<{ from: number; to: number; spec: ReviewDecorationSpec; attrs: Record<string, string> }> {
  return getReviewDecorations(state)
    .find()
    .map((decoration: Decoration) => ({
      from: decoration.from,
      to: decoration.to,
      spec: decoration.spec as ReviewDecorationSpec,
      attrs: ((decoration as unknown as { type: { attrs?: Record<string, string> } }).type.attrs ?? {}) as Record<string, string>
    }));
}

const positionOf = (state: EditorState, blockId: string) => {
  let position = -1;
  state.doc.forEach((node, pos) => {
    if (node.attrs.id === blockId) {
      position = pos;
    }
  });
  return position;
};

/* ---------- accept transactions ---------- */

test("a heading is inserted before its anchor; ids stay; one undo removes exactly it", () => {
  const before = createState();
  const after = accept(before, [
    { type: "insert", anchorBlockId: "p-2", side: "before", blocks: [{ id: "heading-new", type: "heading", level: 2, content: [{ text: "Що таке тиск сну" }] }] }
  ]);

  assert.deepEqual(getTopLevelBlockIds(after.doc), ["h-1", "p-1", "heading-new", "p-2", "p-3"]);
  assert.deepEqual(blockOf(after, "heading-new"), { id: "heading-new", type: "heading", level: 2, content: [{ text: "Що таке тиск сну" }] });
  assert.deepEqual(blockOf(after, "p-2"), blockOf(before, "p-2"), "the anchor itself is untouched");

  const undone = apply(after, undo);
  assert.deepEqual(read(undone), read(before), "one undo step");
  assert.equal(undo(undone), false, "and nothing else to undo");
  assert.deepEqual(read(apply(undone, redo)), read(after), "redo brings the same block back, with the same id");
});

test("a callout is inserted after its anchor as a real callout block", () => {
  const after = accept(createState(), [{ type: "insert", anchorBlockId: "p-3", side: "after", blocks: [calloutBlock] }]);

  assert.deepEqual(getTopLevelBlockIds(after.doc), ["h-1", "p-1", "p-2", "p-3", "callout-new"]);
  assert.deepEqual(blockOf(after, "callout-new"), calloutBlock, "kind, depth, title and both body paragraphs with their bold");
  assert.deepEqual(read(apply(after, undo)), baseDocument);
});

test("bold lands on the planned occurrence only and keeps other formatting", () => {
  const text = "Тиск сну росте, і тиск сну не зникає.";
  const start = text.indexOf("тиск сну");
  const after = accept(createState(), [{ type: "bold", blockId: "p-1", start, end: start + 8, expected: "тиск сну" }]);

  assert.deepEqual(blockOf(after, "p-1"), {
    id: "p-1",
    type: "paragraph",
    content: [{ text: "Тиск сну росте, і " }, { text: "тиск сну", bold: true }, { text: " не зникає." }]
  });

  const italic = accept(createState(), [{ type: "bold", blockId: "p-3", start: 7, end: 22, expected: "займає рецептор" }]);
  assert.deepEqual(blockOf(italic, "p-3"), {
    id: "p-3",
    type: "paragraph",
    content: [{ text: "Кофеїн " }, { text: "займає", bold: true, italic: true }, { text: " рецептор", bold: true }, { text: " аденозину." }]
  });

  assert.deepEqual(read(apply(after, undo)), baseDocument, "one undo takes the bold back");
});

test("a spelling fix replaces exactly its range and inherits the formatting of the word", () => {
  const after = accept(createState(), [{ type: "text", blockId: "p-2", start: 13, end: 23, expected: "відчуваемо", text: "відчуваємо" }]);
  assert.deepEqual(blockOf(after, "p-2"), p("p-2", "До вечора ми відчуваємо втому, а концентрація знижуеться."));

  const styled = accept(createState(), [{ type: "text", blockId: "p-3", start: 7, end: 13, expected: "займає", text: "займе" }]);
  assert.deepEqual(blockOf(styled, "p-3"), {
    id: "p-3",
    type: "paragraph",
    content: [{ text: "Кофеїн " }, { text: "займе", italic: true }, { text: " рецептор аденозину." }]
  });
});

test("a bulk acceptance is ONE undo step, also for several fixes inside one paragraph", () => {
  const before = createState();
  const text = "До вечора ми відчуваемо втому, а концентрація знижуеться.";
  const second = text.indexOf("знижуеться");
  const after = accept(before, [
    { type: "text", blockId: "p-2", start: 13, end: 23, expected: "відчуваемо", text: "відчуваємо" },
    { type: "text", blockId: "p-2", start: second, end: second + 10, expected: "знижуеться", text: "знижується" },
    { type: "bold", blockId: "p-1", start: 0, end: 8, expected: "Тиск сну" },
    { type: "insert", anchorBlockId: "p-1", side: "before", blocks: [{ id: "heading-a", type: "heading", level: 3, content: [{ text: "Перший" }] }] },
    { type: "insert", anchorBlockId: "p-3", side: "before", blocks: [{ id: "heading-b", type: "heading", level: 2, content: [{ text: "Другий" }] }] }
  ]);

  assert.deepEqual(getTopLevelBlockIds(after.doc), ["h-1", "heading-a", "p-1", "p-2", "heading-b", "p-3"]);
  assert.deepEqual(blockOf(after, "p-2"), p("p-2", "До вечора ми відчуваємо втому, а концентрація знижується."));
  assert.deepEqual(blockOf(after, "p-1"), { id: "p-1", type: "paragraph", content: [{ text: "Тиск сну", bold: true }, { text: " росте, і тиск сну не зникає." }] });

  const undone = apply(after, undo);
  assert.deepEqual(read(undone), read(before), "everything comes back with one undo");
  assert.equal(undo(undone), false);
});

test("a heading before a block and a callout after the block above it both stay next to their own anchor", () => {
  const after = accept(createState(), [
    { type: "insert", anchorBlockId: "p-2", side: "before", blocks: [{ id: "heading-new", type: "heading", level: 2, content: [{ text: "Далі" }] }] },
    { type: "insert", anchorBlockId: "p-1", side: "after", blocks: [calloutBlock] }
  ]);

  assert.deepEqual(getTopLevelBlockIds(after.doc), ["h-1", "p-1", "callout-new", "heading-new", "p-2", "p-3"]);
});

test("nothing is applied when any edit no longer fits the text", () => {
  const state = createState();
  const good: ReviewEdit = { type: "bold", blockId: "p-1", start: 0, end: 8, expected: "Тиск сну" };

  refuses(state, applyReviewEdits([]));
  refuses(state, applyReviewEdits([good, { type: "text", blockId: "p-2", start: 13, end: 23, expected: "відчуваємо", text: "x" }]));
  refuses(state, applyReviewEdits([good, { type: "bold", blockId: "p-9", start: 0, end: 3, expected: "abc" }]));
  refuses(state, applyReviewEdits([{ type: "insert", anchorBlockId: "p-9", side: "before", blocks: [p("new", "x")] }]));
  refuses(state, applyReviewEdits([{ type: "insert", anchorBlockId: "p-1", side: "before", blocks: [p("p-2", "taken id")] }]));
  refuses(state, applyReviewEdits([{ type: "text", blockId: "p-2", start: 13, end: 23, expected: "відчуваемо", text: "" }]));
});

test("two edits over the same text are refused together: only one of them can be what was shown", () => {
  const state = createState();
  refuses(
    state,
    applyReviewEdits([
      { type: "text", blockId: "p-2", start: 13, end: 23, expected: "відчуваемо", text: "відчуваємо" },
      { type: "text", blockId: "p-2", start: 16, end: 23, expected: "чуваемо", text: "чуємо" }
    ])
  );
  refuses(
    state,
    applyReviewEdits([
      { type: "bold", blockId: "p-1", start: 0, end: 8, expected: "Тиск сну" },
      { type: "bold", blockId: "p-1", start: 5, end: 14, expected: "сну росте" }
    ])
  );
});

test("a diff over blocks that no longer stand together is reported as a mismatch and not drawn", () => {
  const diff = diffProposalBlocks(["p-1", "p-2"], [baseDocument.blocks[1]!, baseDocument.blocks[2]!], [p("p-1", "Один абзац замість двох.")]);
  const marks = [mark({ itemId: "k-1", tone: "clarity", blockIds: ["p-1", "p-2"], focused: true, diff })];
  let state = apply(createState(), setReviewMarks(marks));
  assert.deepEqual(getReviewDiffReport(state).drawn, ["k-1"]);

  // A heading is accepted between the two anchored paragraphs.
  state = accept(state, [{ type: "insert", anchorBlockId: "p-2", side: "before", blocks: [{ id: "heading-new", type: "heading", level: 2, content: [{ text: "Далі" }] }] }]);
  assert.deepEqual(getReviewDiffReport(state), { drawn: [], failed: [{ itemId: "k-1", reason: "mismatch" }] });
  assert.equal(decorations(state).some((entry) => entry.spec.review === "del" || entry.spec.review === "ins" || entry.spec.review === "ins-block"), false);
});

test("the ghost heading being typed in keeps its identity through hover, state changes and an emptied title", () => {
  const ghostKey = (overrides: Partial<ReviewMark>, title: string, editable = true) => {
    const state = apply(
      createState(),
      setReviewMarks([mark({ itemId: "s-1", focused: true, ...overrides, ghost: { type: "heading", anchorBlockId: "p-2", title, level: 2, editable } })])
    );
    const [ghost] = getReviewDecorations(state).find(undefined, undefined, (spec) => spec.review === "ghost");
    return ghost!.spec.key as string;
  };

  const typing = ghostKey({}, "Назва");
  assert.equal(ghostKey({ hot: true }, "Назва"), typing, "the pointer moved over it");
  assert.equal(ghostKey({ state: "pending" }, ""), typing, "the last character was deleted");
  assert.equal(ghostKey({ state: "ready" }, "Нова назва"), typing, "typing");
  assert.notEqual(ghostKey({}, "Назва", false), typing, "leaving the ghost redraws it with the text as typed");
  assert.notEqual(ghostKey({}, "Назва", false), ghostKey({}, "Інша", false));
});

test("an accepted change stays its own undo step next to typing", () => {
  let state = createState();
  state = state.apply(state.tr.insertText("!", positionOf(state, "p-1") + 2).setTime(1000));
  state = accept(state, [{ type: "text", blockId: "p-2", start: 13, end: 23, expected: "відчуваемо", text: "відчуваємо" }]);
  state = state.apply(state.tr.insertText("?", positionOf(state, "p-3") + 2).setTime(1001));

  state = apply(state, undo);
  state = apply(state, undo);
  assert.equal((blockOf(state, "p-2") as { content: Array<{ text: string }> }).content[0]!.text.includes("відчуваемо"), true, "the fix is undone by itself");
  assert.equal((blockOf(state, "p-1") as { content: Array<{ text: string }> }).content[0]!.text.startsWith("Т!"), true, "the typing before it is still there");
});

test("a replacement applied with settled ids reports exactly the blocks that stand in the text", () => {
  const resolved = resolveReplacementBlocks(["p-1", "p-2"], [p("x", "Один абзац замість двох.")]);
  assert.deepEqual(resolved.map((block) => block.id), ["p-1"]);

  const after = apply(createState(), replaceAnchoredBlocks(["p-1", "p-2"], resolved, { resolved: true }));
  assert.deepEqual(getTopLevelBlockIds(after.doc), ["h-1", "p-1", "p-3"]);

  const more = resolveReplacementBlocks(["p-1"], [p("x", "Вступ:"), { id: "y", type: "bullet_list", items: [[{ text: "раз" }], [{ text: "два" }]] }], () => "list-new");
  const listed = apply(createState(), replaceAnchoredBlocks(["p-1"], more, { resolved: true }));
  assert.deepEqual(getTopLevelBlockIds(listed.doc), ["h-1", "p-1", "list-new", "p-2", "p-3"]);
  assert.deepEqual(blockOf(listed, "list-new"), { id: "list-new", type: "bullet_list", items: [[{ text: "раз" }], [{ text: "два" }]] });
});

/* ---------- marks: ghosts and inline targets ---------- */

test("a ghost heading is a widget before its anchor; it counts as drawn and never reaches the document", () => {
  const state = apply(
    createState(),
    setReviewMarks([
      mark({ itemId: "s-1", tone: "structure", ghost: { type: "heading", anchorBlockId: "p-2", title: "Що таке тиск сну", level: 2, editable: false } })
    ])
  );
  const ghosts = decorations(state).filter((entry) => entry.spec.review === "ghost");

  assert.equal(ghosts.length, 1);
  assert.equal(ghosts[0]!.from, positionOf(state, "p-2"));
  assert.deepEqual(getReviewDiffReport(state).drawn, ["s-1"]);
  assert.equal(decorations(state).some((entry) => entry.spec.review === "block"), false, "no paragraph is highlighted for it");
  assert.deepEqual(read(state), baseDocument);
});

test("a ghost heading without a title is shown but cannot be accepted; one whose anchor is gone is not shown", () => {
  const state = apply(
    createState(),
    setReviewMarks([
      mark({ itemId: "empty", ghost: { type: "heading", anchorBlockId: "p-2", title: "  ", level: 3, editable: true } }),
      mark({ itemId: "gone", ghost: { type: "heading", anchorBlockId: "p-9", title: "Назва", level: 3, editable: false } })
    ])
  );

  assert.deepEqual(decorations(state).filter((entry) => entry.spec.review === "ghost").map((entry) => (entry.spec as { itemId: string }).itemId), ["empty"]);
  assert.deepEqual(getReviewDiffReport(state).drawn, []);
});

test("a ghost callout stands after its anchor block", () => {
  const state = apply(
    createState(),
    setReviewMarks([
      mark({ itemId: "c-1", tone: "interest", ghost: { type: "callout", anchorBlockId: "p-2", side: "after", block: calloutBlock, label: "Аналогія · стисло" } })
    ])
  );
  const [ghost] = decorations(state).filter((entry) => entry.spec.review === "ghost");

  assert.equal(ghost!.from, positionOf(state, "p-3"), "the end of p-2 is the start of p-3");
  assert.equal(isReviewDiffDrawn(state, "c-1"), true);
});

test("an accent marks exactly its occurrence; bold text and a missing phrase are not marked", () => {
  const text = "Тиск сну росте, і тиск сну не зникає.";
  const start = positionOf(createState(), "p-1") + 1 + text.indexOf("тиск сну");
  let state = apply(
    createState(),
    setReviewMarks([
      mark({ itemId: "a-1", inline: { type: "accent", blockId: "p-1", text: "тиск сну", occurrence: 1 } }),
      mark({ itemId: "a-2", inline: { type: "accent", blockId: "p-1", text: "немає такого", occurrence: 1 } })
    ])
  );
  const inline = decorations(state).filter((entry) => entry.spec.review === "inline");

  assert.equal(inline.length, 1);
  assert.deepEqual([inline[0]!.from, inline[0]!.to], [start, start + 8]);
  assert.equal(inline[0]!.attrs["data-sg-inline"], "accent");
  assert.equal(inline[0]!.attrs["data-sg-items"], "a-1");
  assert.deepEqual(getReviewDiffReport(state).drawn, ["a-1"]);

  // Once the phrase is bold (accepted, or by the editor's own hand) there is nothing left to show.
  state = accept(state, [{ type: "bold", blockId: "p-1", start: text.indexOf("тиск сну"), end: text.indexOf("тиск сну") + 8, expected: "тиск сну" }]);
  assert.equal(decorations(state).some((entry) => entry.spec.review === "inline"), false);
  assert.deepEqual(getReviewDiffReport(state).drawn, []);
});

test("a misspelt word gets an underline and its fix beside it; without a fix it is not acceptable", () => {
  const base = positionOf(createState(), "p-2") + 1;
  const state = apply(
    createState(),
    setReviewMarks([
      mark({ itemId: "sp-1", tone: "spell", inline: { type: "spell", blockId: "p-2", start: 13, end: 23, badText: "відчуваемо", replacement: "відчуваємо" } }),
      mark({ itemId: "sp-2", tone: "spell", inline: { type: "spell", blockId: "p-2", start: 46, end: 56, badText: "знижуеться" } })
    ])
  );
  const all = decorations(state);
  const inline = all.filter((entry) => entry.spec.review === "inline");
  const inserted = all.filter((entry) => entry.spec.review === "ins");

  assert.deepEqual(inline.map((entry) => [entry.from, entry.to]), [[base + 13, base + 23], [base + 46, base + 56]]);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]!.from, base + 23, "the fix stands right after the word");
  assert.equal((inserted[0]!.spec as { text: string }).text, "відчуваємо");
  assert.deepEqual(getReviewDiffReport(state).drawn, ["sp-1"], "a word with nothing to replace it with cannot be accepted");
});

test("typing elsewhere in the block hides a spelling mark until its range is confirmed again; it never slides onto other text", () => {
  let state = apply(
    createState(),
    setReviewMarks([mark({ itemId: "sp-1", tone: "spell", inline: { type: "spell", blockId: "p-2", start: 13, end: 23, badText: "відчуваемо", replacement: "відчуваємо" } })])
  );

  state = state.apply(state.tr.insertText("Уже ", positionOf(state, "p-2") + 1));
  assert.equal(decorations(state).some((entry) => entry.spec.review === "inline"), false);
  assert.deepEqual(getReviewDiffReport(state).drawn, []);

  // The store rebases the range on the next save and sends the mark again.
  state = apply(
    state,
    setReviewMarks([mark({ itemId: "sp-1", tone: "spell", inline: { type: "spell", blockId: "p-2", start: 17, end: 27, badText: "відчуваемо", replacement: "відчуваємо" } })])
  );
  assert.deepEqual(getReviewDiffReport(state).drawn, ["sp-1"]);
});

test("quiet mode: dimmed marks are traces only; a dimmed ghost is not drawn and nothing dimmed is acceptable", () => {
  const state = apply(
    createState(),
    setReviewMarks([
      mark({ itemId: "a-1", dim: true, inline: { type: "accent", blockId: "p-1", text: "тиск сну", occurrence: 1 } }),
      mark({ itemId: "sp-1", dim: true, tone: "spell", inline: { type: "spell", blockId: "p-2", start: 13, end: 23, badText: "відчуваемо", replacement: "відчуваємо" } }),
      mark({ itemId: "s-1", dim: true, ghost: { type: "heading", anchorBlockId: "p-2", title: "Назва", level: 2, editable: false } }),
      mark({ itemId: "c-1", dim: true, tone: "clarity", state: "pending", blockIds: ["p-3"] }),
      mark({ itemId: "sp-2", focused: true, tone: "spell", inline: { type: "spell", blockId: "p-2", start: 46, end: 56, badText: "знижуеться", replacement: "знижується" } })
    ])
  );
  const all = decorations(state);

  assert.equal(all.filter((entry) => entry.spec.review === "ghost").length, 0);
  assert.equal(all.filter((entry) => entry.spec.review === "ins").length, 1, "only the current item shows its fix");
  assert.deepEqual(
    all.filter((entry) => entry.spec.review === "inline").map((entry) => [(entry.spec as { itemId: string }).itemId, "data-sg-dim" in entry.attrs]),
    [["a-1", true], ["sp-1", true], ["sp-2", false]]
  );
  assert.equal(all.find((entry) => entry.spec.review === "block")?.attrs["data-sg-dim"], "");
  assert.deepEqual(getReviewDiffReport(state).drawn, ["sp-2"]);
});
