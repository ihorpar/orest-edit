import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { EditorState, type Command } from "@tiptap/pm/state";
import type { Decoration } from "@tiptap/pm/view";

import type { Block, EditorDocument, ImageBlock } from "../lib/editor/document-model.ts";
import { createBlockIdPlugin, getTopLevelBlockIds } from "../lib/v2/block-ids.ts";
import { readFigure, removeFigure, updateFigure } from "../lib/v2/figure-apply.ts";
import { applyReviewEdits, sealHistory } from "../lib/v2/review-apply.ts";
import {
  createReviewMarksPlugin,
  getReviewDecorations,
  getReviewDiffReport,
  isReviewDiffDrawn,
  setReviewMarks,
  type ReviewDecorationSpec,
  type ReviewGhost,
  type ReviewMark
} from "../lib/v2/review-marks.ts";
import { buildFigureBlock, createStudioData, studioReducer, type V2StudioData, type V2StudioEvent } from "../lib/v2/studio.ts";
import { blockToTiptapNode, documentToTiptap, tiptapToDocument } from "../lib/v2/tiptap-bridge.ts";
import { createV2Extensions } from "../lib/v2/tiptap-extensions.ts";

const schema = getSchema(createV2Extensions());
const p = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });

const baseDocument: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    p("p-1", "Аденозин накопичується, поки ми не спимо."),
    p("p-2", "Кофеїн займає рецептор аденозину."),
    p("p-3", "Коли кофеїн відпускає, втома повертається.")
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
const step = (state: EditorState, command: Command) => apply(apply(state, command), sealHistory);

const NOW = "2026-10-10T10:00:00.000Z";
const play = (studio: V2StudioData, ...events: V2StudioEvent[]) => events.reduce(studioReducer, studio);

function generatedStudio(assetId: string, caption = "Кофеїн займає рецептор, але не вмикає сигнал утоми."): V2StudioData {
  return play(
    createStudioData({ intent: "infographic", style: "minimal", quality: "fast" }),
    { type: "prompt/requested" },
    { type: "prompt/ready", prompt: "Схема рецептора у два кадри.", alt: "Схема рецептора", intent: "infographic", style: "minimal" },
    { type: "field", change: { caption } },
    { type: "generation/requested", at: NOW },
    { type: "generation/completed", assetId, mimeType: "image/png", at: NOW }
  );
}

const figure = (id: string, assetId: string): ImageBlock => buildFigureBlock(generatedStudio(assetId), id, "Запасний опис")!;
const insertFigure = (state: EditorState, block: ImageBlock, anchorBlockId = "p-2") =>
  step(state, applyReviewEdits([{ type: "insert", anchorBlockId, side: "after", blocks: [block] }]));

/* ---------- insert ---------- */

test("the figure block fits the manuscript schema as it is built", () => {
  const block = figure("image-new", "asset-image-1");
  const node = schema.nodeFromJSON(blockToTiptapNode(block));

  node.check();
  assert.equal(node.type.name, "image");
  assert.deepEqual({ ...node.attrs }, { id: "image-new", assetId: "asset-image-1", alt: "Схема рецептора", caption: [{ text: "Кофеїн займає рецептор, але не вмикає сигнал утоми." }] });
});

test("insert puts a real image block after the anchor: one undo step, ids stable, redo brings the same block back", () => {
  const before = createState();
  const block = figure("image-new", "asset-image-1");
  const after = insertFigure(before, block);

  assert.deepEqual(getTopLevelBlockIds(after.doc), ["h-1", "p-1", "p-2", "image-new", "p-3"]);
  assert.deepEqual(blockOf(after, "image-new"), block, "asset id, alt and caption exactly as built");
  assert.deepEqual(blockOf(after, "p-2"), blockOf(before, "p-2"), "the anchor itself is untouched");
  assert.deepEqual(readFigure(after.doc, "image-new"), {
    assetId: "asset-image-1",
    alt: "Схема рецептора",
    caption: "Кофеїн займає рецептор, але не вмикає сигнал утоми."
  });

  const undone = apply(after, undo);
  assert.deepEqual(read(undone), read(before), "one undo removes exactly the figure");
  assert.equal(undo(undone), false, "and there is nothing else to undo");

  const redone = apply(undone, redo);
  assert.deepEqual(read(redone), read(after));
  assert.deepEqual(getTopLevelBlockIds(redone.doc), ["h-1", "p-1", "p-2", "image-new", "p-3"], "the same id after redo");
});

test("typing before and after the insertion is undone separately from it", () => {
  const typed = apply(createState(), (state, dispatch) => {
    dispatch?.(state.tr.insertText("!", 3));
    return true;
  });
  const after = insertFigure(typed, figure("image-new", "asset-image-1"));
  const undone = apply(after, undo);

  assert.deepEqual(getTopLevelBlockIds(undone.doc), ["h-1", "p-1", "p-2", "p-3"]);
  assert.deepEqual(read(undone), read(typed), "the typing before the insertion is still there");
});

test("insert refuses when the anchor is gone or the id is taken, and changes nothing", () => {
  const state = createState();

  refuses(state, applyReviewEdits([{ type: "insert", anchorBlockId: "nope", side: "after", blocks: [figure("image-new", "asset-image-1")] }]));
  refuses(state, applyReviewEdits([{ type: "insert", anchorBlockId: "p-2", side: "after", blocks: [figure("p-1", "asset-image-1")] }]));
});

/* ---------- replace, caption, remove ---------- */

test("replace swaps the image and caption in place: the block keeps its id and one undo restores the old image", () => {
  const inserted = insertFigure(createState(), figure("image-new", "asset-image-1"));
  const replaced = step(inserted, updateFigure("image-new", { assetId: "asset-image-2", alt: "Нова схема", caption: "Новий підпис" }));

  assert.deepEqual(getTopLevelBlockIds(replaced.doc), ["h-1", "p-1", "p-2", "image-new", "p-3"], "same place, same id");
  assert.deepEqual(blockOf(replaced, "image-new"), { id: "image-new", type: "image", assetId: "asset-image-2", alt: "Нова схема", caption: [{ text: "Новий підпис" }] });

  const undone = apply(replaced, undo);
  assert.deepEqual(read(undone), read(inserted), "one undo: the first image and its caption are back");
  assert.deepEqual(read(apply(undone, redo)), read(replaced));

  // A second undo takes the insertion itself back, as its own step.
  assert.deepEqual(getTopLevelBlockIds(apply(undone, undo).doc), ["h-1", "p-1", "p-2", "p-3"]);
});

test("the caption alone can be changed; the image stays", () => {
  const inserted = insertFigure(createState(), figure("image-new", "asset-image-1"));
  const captioned = step(inserted, updateFigure("image-new", { caption: "Інший підпис" }));

  assert.deepEqual(readFigure(captioned.doc, "image-new"), { assetId: "asset-image-1", alt: "Схема рецептора", caption: "Інший підпис" });
  assert.deepEqual(read(apply(captioned, undo)), read(inserted));

  const cleared = step(captioned, updateFigure("image-new", { caption: "" }));
  assert.equal(readFigure(cleared.doc, "image-new")?.caption, "");
});

test("an image added by hand, without a caption attribute, takes a caption the same way", () => {
  const manual: EditorDocument = { version: 2, blocks: [...baseDocument.blocks, { id: "img-manual", type: "image", assetId: "asset-local-1", alt: "фото" }] };
  const state = createState(manual);

  assert.deepEqual(readFigure(state.doc, "img-manual"), { assetId: "asset-local-1", alt: "фото", caption: "" });

  const captioned = step(state, updateFigure("img-manual", { caption: "Фото з лабораторії" }));
  assert.deepEqual(blockOf(captioned, "img-manual"), { id: "img-manual", type: "image", assetId: "asset-local-1", alt: "фото", caption: [{ text: "Фото з лабораторії" }] });
});

test("update refuses a block that is not a figure, an unchanged figure and an empty image", () => {
  const inserted = insertFigure(createState(), figure("image-new", "asset-image-1"));

  refuses(inserted, updateFigure("p-2", { caption: "x" }));
  refuses(inserted, updateFigure("nope", { assetId: "asset-image-2" }));
  refuses(inserted, updateFigure("image-new", { assetId: "asset-image-1" }));
  refuses(inserted, updateFigure("image-new", {}));
  refuses(inserted, updateFigure("image-new", { assetId: "" }));
  assert.equal(readFigure(inserted.doc, "p-2"), null);
});

test("remove takes the figure out as one undo step", () => {
  const inserted = insertFigure(createState(), figure("image-new", "asset-image-1"));
  const removed = step(inserted, removeFigure("image-new"));

  assert.deepEqual(read(removed), baseDocument);
  assert.deepEqual(read(apply(removed, undo)), read(inserted), "undo puts the same figure back, with its id");
  refuses(removed, removeFigure("image-new"));
  refuses(inserted, removeFigure("p-1"));
});

/* ---------- ghost figure ---------- */

const ghost = (overrides: Partial<Extract<ReviewGhost, { type: "figure" }>> = {}): ReviewGhost => ({
  type: "figure",
  anchorBlockId: "p-2",
  label: "Візуал · Інфографіка",
  title: "Кофеїн займає місце аденозину",
  action: "Відкрити студію",
  enabled: true,
  ...overrides
});

const mark = (overrides: Partial<ReviewMark> = {}): ReviewMark => ({
  itemId: "v-1",
  tone: "visual",
  blockIds: [],
  state: "pending",
  focused: false,
  hot: false,
  ghost: ghost(),
  ...overrides
});

function decorations(state: EditorState): Array<{ from: number; to: number; spec: ReviewDecorationSpec }> {
  return getReviewDecorations(state)
    .find()
    .map((decoration: Decoration) => ({ from: decoration.from, to: decoration.to, spec: decoration.spec as ReviewDecorationSpec }));
}

const endOf = (state: EditorState, blockId: string) => {
  let position = -1;
  state.doc.forEach((node, pos) => {
    if (node.attrs.id === blockId) {
      position = pos + node.nodeSize;
    }
  });
  return position;
};

test("a ghost figure is one widget right after its anchor and never part of the document", () => {
  const before = createState();
  const state = apply(before, setReviewMarks([mark()]));
  const drawn = decorations(state);

  assert.equal(drawn.length, 1);
  assert.equal(drawn[0]!.from, endOf(state, "p-2"));
  assert.equal(drawn[0]!.to, drawn[0]!.from, "a widget, not a range");
  assert.deepEqual(drawn[0]!.spec, { ...drawn[0]!.spec, review: "ghost", itemId: "v-1", ghost: ghost() });
  assert.deepEqual(read(state), read(before), "the manuscript is untouched");
  assert.equal(undo(state), false, "and nothing was added to history");
});

test("a ghost figure is never counted as a drawn result: there is no image in it to accept", () => {
  const state = apply(createState(), setReviewMarks([mark({ focused: true })]));

  assert.deepEqual(getReviewDiffReport(state), { drawn: [], failed: [] });
  assert.equal(isReviewDiffDrawn(state, "v-1"), false);
});

test("the ghost figure follows its anchor through edits and disappears with it; a dimmed one is not drawn", () => {
  const state = apply(createState(), setReviewMarks([mark()]));
  const typed = apply(state, (current, dispatch) => {
    dispatch?.(current.tr.insertText("Ще речення. ", 3));
    return true;
  });

  assert.equal(decorations(typed)[0]!.from, endOf(typed, "p-2"));

  const withoutAnchor = apply(createState({ version: 2, blocks: baseDocument.blocks.filter((block) => block.id !== "p-2") }), setReviewMarks([mark()]));
  assert.deepEqual(decorations(withoutAnchor), []);

  assert.deepEqual(decorations(apply(createState(), setReviewMarks([mark({ dim: true })]))), [], "quiet mode: only the current item is expanded");
});

test("after the insertion the ghost and the real figure do not stand side by side", () => {
  const withGhost = apply(createState(), setReviewMarks([mark()]));
  const inserted = insertFigure(withGhost, figure("image-new", "asset-image-1"));

  // The engine drops the mark once the item is decided; until then the ghost still sits after the anchor,
  // before the new block, and is gone as soon as the marks are set again.
  assert.equal(decorations(inserted)[0]!.from, endOf(inserted, "p-2"));
  assert.deepEqual(decorations(apply(inserted, setReviewMarks([]))), []);
  assert.deepEqual(getTopLevelBlockIds(inserted.doc), ["h-1", "p-1", "p-2", "image-new", "p-3"]);
});
