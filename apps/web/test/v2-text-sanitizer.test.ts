import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { history, undo } from "@tiptap/pm/history";
import { Fragment, Slice } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";

import { sanitizeEditorText, type Block, type EditorDocument } from "../lib/editor/document-model.ts";
import { computeAnchorFingerprint } from "../lib/editor/manuscript-structure.ts";
import { createBlockIdPlugin, getTopLevelBlockIds } from "../lib/v2/block-ids.ts";
import { replaceAnchoredBlocks } from "../lib/v2/review-apply.ts";
import {
  createReviewMarksPlugin,
  getReviewDecorations,
  getReviewDiffReport,
  isReviewDiffDrawn,
  readBlockText,
  setReviewMarks,
  type ReviewDecorationSpec,
  type ReviewMark
} from "../lib/v2/review-marks.ts";
import { createTextSanitizerPlugin } from "../lib/v2/text-sanitizer.ts";
import { documentToTiptap, tiptapToDocument } from "../lib/v2/tiptap-bridge.ts";
import { createV2Extensions } from "../lib/v2/tiptap-extensions.ts";
import { diffProposalBlocks } from "../lib/v2/word-diff.ts";

const schema = getSchema(createV2Extensions());
const p = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });

const NBSP = " ";
const SHY = "­";
const ZWSP = "​";
/** As it comes from Word or a web page: no-break spaces, soft hyphens inside words, a zero-width space. */
const PASTED = `Кофеїн${NBSP}є конку${SHY}рентним антаго${SHY}ністом${ZWSP} аденозинових${NBSP}рецепторів.`;
const CLEAN = "Кофеїн є конкурентним антагоністом аденозинових рецепторів.";

const baseDocument: EditorDocument = {
  version: 2,
  blocks: [p("p-1", "Перший абзац."), p("p-2", "Другий абзац.")]
};

function createState(withSanitizer = true, document: EditorDocument = baseDocument): EditorState {
  return EditorState.create({
    doc: schema.nodeFromJSON(documentToTiptap(document)),
    plugins: [history(), createBlockIdPlugin(), ...(withSanitizer ? [createTextSanitizerPlugin()] : []), createReviewMarksPlugin()]
  });
}

/** Applies a transaction the way the editor view does, including what the plugins append. */
function dispatch(state: EditorState, build: (transaction: Transaction) => Transaction): EditorState {
  return state.applyTransaction(build(state.tr)).state;
}

function blockPosition(state: EditorState, blockId: string): { pos: number; end: number } {
  let found = { pos: -1, end: -1 };
  state.doc.forEach((node, pos) => {
    if (node.attrs.id === blockId) {
      found = { pos, end: pos + node.nodeSize };
    }
  });
  return found;
}

const rawText = (state: EditorState, blockId: string) => readBlockText(state.doc.nodeAt(blockPosition(state, blockId).pos)!);
const read = (state: EditorState) => tiptapToDocument(state.doc.toJSON());

function pasteOver(state: EditorState, blockId: string, content: Fragment): EditorState {
  const { pos, end } = blockPosition(state, blockId);
  return dispatch(state, (transaction) =>
    transaction.setSelection(TextSelection.create(transaction.doc, pos + 1, end - 1)).replaceSelection(new Slice(content, 0, 0))
  );
}

test("the fixture really contains the characters the bridge removes", () => {
  assert.notEqual(PASTED, CLEAN);
  assert.equal(sanitizeEditorText(PASTED), CLEAN);
});

test("pasted text is normalised in the editor: NBSP becomes a space, soft hyphen and ZWSP disappear", () => {
  const pasted = pasteOver(createState(), "p-2", Fragment.from(schema.text(PASTED)));

  assert.equal(rawText(pasted, "p-2"), CLEAN);
  assert.equal(rawText(pasted, "p-2"), (read(pasted).blocks[1] as { content: Array<{ text: string }> }).content[0]!.text, "editor and bridge agree");
  assert.deepEqual(getTopLevelBlockIds(pasted.doc), ["p-1", "p-2"]);
});

test("typed input is normalised too and the caret stays right after it", () => {
  let state = createState();
  const { end } = blockPosition(state, "p-1");
  state = dispatch(state, (transaction) => transaction.setSelection(TextSelection.create(transaction.doc, end - 1)));

  state = dispatch(state, (transaction) => transaction.insertText(`${NBSP}Так`));
  assert.equal(rawText(state, "p-1"), "Перший абзац. Так");
  assert.equal(state.selection.from, blockPosition(state, "p-1").end - 1);

  // A character that is removed entirely leaves the caret where it was.
  const before = state.selection.from;
  state = dispatch(state, (transaction) => transaction.insertText(ZWSP));
  assert.equal(rawText(state, "p-1"), "Перший абзац. Так");
  assert.equal(state.selection.from, before);

  state = dispatch(state, (transaction) => transaction.insertText("!"));
  assert.equal(rawText(state, "p-1"), "Перший абзац. Так!");
});

test("marks survive the clean-up, and a text node made only of removed characters is dropped", () => {
  const bold = schema.marks.bold!.create();
  const pasted = pasteOver(
    createState(),
    "p-2",
    Fragment.from([schema.text(`жир${SHY}ний${NBSP}`, [bold]), schema.text(`${ZWSP}${SHY}`), schema.text("звичайний")])
  );

  assert.deepEqual(read(pasted).blocks[1], {
    id: "p-2",
    type: "paragraph",
    content: [{ text: "жирний ", bold: true }, { text: "звичайний" }]
  });
  assert.equal(rawText(pasted, "p-2"), "жирний звичайний");
});

test("one undo takes back the paste together with its clean-up", () => {
  const start = createState();
  const pasted = pasteOver(start, "p-2", Fragment.from(schema.text(PASTED)));
  let undone = pasted;
  undo(pasted, (transaction) => {
    undone = pasted.apply(transaction);
  });

  assert.ok(undone.doc.eq(start.doc));
});

test("clean text is left alone: no extra transaction, same document", () => {
  const state = createState();
  const result = state.applyTransaction(state.tr.insertText("звичайний текст", 2));
  assert.equal(result.transactions.length, 1);
});

/* ---------- the diff-first hole this closes ---------- */

function proposalFor(state: EditorState, blockId: string, newText: string) {
  // What the client sends is the bridge's (sanitised) document; the proposal echoes it as oldBlocks.
  const sent = read(state);
  const oldBlock = sent.blocks.find((block) => block.id === blockId)!;
  const mark: ReviewMark = {
    itemId: "item-1",
    tone: "clarity",
    blockIds: [blockId],
    state: "ready",
    focused: true,
    hot: false,
    diff: diffProposalBlocks([blockId], [oldBlock], [p(blockId, newText)])
  };
  return { sent, mark };
}

const kinds = (state: EditorState) =>
  getReviewDecorations(state)
    .find()
    .map((decoration) => (decoration.spec as ReviewDecorationSpec).review)
    .filter((review) => review !== "controls");

test("a prepared change draws over a pasted paragraph, because editor and bridge read the same text", () => {
  const pasted = pasteOver(createState(), "p-2", Fragment.from(schema.text(PASTED)));
  const { mark } = proposalFor(pasted, "p-2", "Молекула кофеїну займає місце аденозину.");
  let state = pasted;
  setReviewMarks([mark])(pasted, (transaction) => {
    state = pasted.apply(transaction);
  });

  assert.ok(kinds(state).includes("del") && kinds(state).includes("ins"));
  assert.deepEqual(getReviewDiffReport(state), { drawn: ["item-1"], failed: [] });
  assert.equal(isReviewDiffDrawn(state, "item-1"), true);
});

test("without normalisation the same paragraph cannot be drawn, and that is reported instead of hidden", () => {
  // The state the reviewer probed: raw characters in the editor, sanitised text in the proposal.
  const raw = pasteOver(createState(false), "p-2", Fragment.from(schema.text(PASTED)));
  assert.notEqual(rawText(raw, "p-2"), CLEAN);

  const { sent, mark } = proposalFor(raw, "p-2", "Молекула кофеїну займає місце аденозину.");
  assert.equal(computeAnchorFingerprint(sent, ["p-2"]), `paragraph:${CLEAN}`, "the fingerprint is taken from sanitised text and still matches");

  let state = raw;
  setReviewMarks([mark])(raw, (transaction) => {
    state = raw.apply(transaction);
  });

  assert.deepEqual(kinds(state), ["block"], "no del/ins can be laid over text that differs");
  assert.deepEqual(getReviewDiffReport(state), { drawn: [], failed: [{ itemId: "item-1", reason: "mismatch" }] });
  assert.equal(isReviewDiffDrawn(state, "item-1"), false, "so the change must not be applicable");
  // The command itself would still work, which is exactly why the engine and the card check `drawn`.
  assert.equal(replaceAnchoredBlocks(["p-2"], [p("p-2", "x")])(state), true);
});

test("a proposal that changes nothing is reported as empty, a drawn one stops being drawn when the text is edited", () => {
  const start = createState();
  const same = proposalFor(start, "p-1", "Перший абзац.");
  let state = start;
  setReviewMarks([same.mark])(start, (transaction) => {
    state = start.apply(transaction);
  });
  assert.deepEqual(getReviewDiffReport(state), { drawn: [], failed: [{ itemId: "item-1", reason: "empty" }] });

  const changed = proposalFor(start, "p-1", "Перший абзац, переписаний.");
  setReviewMarks([changed.mark])(start, (transaction) => {
    state = start.apply(transaction);
  });
  assert.equal(isReviewDiffDrawn(state, "item-1"), true);

  const edited = dispatch(state, (transaction) => transaction.insertText(" Ще.", blockPosition(state, "p-1").end - 1));
  assert.equal(isReviewDiffDrawn(edited, "item-1"), false);
  assert.deepEqual(getReviewDiffReport(edited).failed, [{ itemId: "item-1", reason: "mismatch" }]);

  // Unfocused or diff-less marks are neither drawn nor failed.
  setReviewMarks([{ ...changed.mark, focused: false }])(start, (transaction) => {
    state = start.apply(transaction);
  });
  assert.deepEqual(getReviewDiffReport(state), { drawn: [], failed: [] });
});
