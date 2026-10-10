import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { deleteSelection, joinBackward, joinForward } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import { Fragment, Slice } from "@tiptap/pm/model";
import { AllSelection, EditorState, NodeSelection, TextSelection, type Command } from "@tiptap/pm/state";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import { createBlockIdPlugin, findBlockPosition, getTopLevelBlockIds } from "../lib/v2/block-ids.ts";
import {
  getActiveBlockKind,
  handleBackspace,
  handleEnter,
  insertCallout,
  insertHardBreak,
  insertImage,
  replaceDocumentContent,
  setTextBlockType,
  toggleList,
  toggleMarkCommand
} from "../lib/v2/editor-commands.ts";
import { documentToTiptap, tiptapToDocument } from "../lib/v2/tiptap-bridge.ts";
import { createV2Extensions } from "../lib/v2/tiptap-extensions.ts";

const schema = getSchema(createV2Extensions());

const p = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });
const image: Block = { id: "image-1", type: "image", assetId: "asset-1", alt: "схема", caption: [{ text: "підпис" }] };
const callout: Block = {
  id: "callout-1",
  type: "callout",
  kind: "analogy",
  depth: "brief",
  title: [{ text: "Аналогія" }],
  body: [[{ text: "Тіло врізки." }]]
};
const divider: Block = { id: "divider-1", type: "divider" };
const table: Block = { id: "table-1", type: "table", rows: [[[{ text: "а" }], [{ text: "б" }]]] };

function createState(blocks: Block[]): EditorState {
  return EditorState.create({
    doc: schema.nodeFromJSON(documentToTiptap({ version: 2, blocks })),
    plugins: [history(), createBlockIdPlugin()]
  });
}

function run(state: EditorState, command: Command): EditorState {
  let next = state;
  const handled = command(state, (transaction) => {
    next = state.apply(transaction);
  });

  assert.equal(handled, true, "the command should apply");
  return next;
}

/** Cursor inside the text of a top-level block (or of its first list item / callout title). */
function cursor(state: EditorState, blockId: string, offset: number, endOffset = offset): EditorState {
  const pos = findBlockPosition(state.doc, blockId);
  assert.ok(pos >= 0, `block ${blockId} exists`);
  const node = state.doc.nodeAt(pos)!;
  const start = pos + (node.isTextblock ? 1 : 2);

  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, start + offset, start + endOffset)));
}

function type(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.insertText(text));
}

function toDocument(state: EditorState): EditorDocument {
  state.doc.check();
  return tiptapToDocument(state.doc.toJSON());
}

function ids(state: EditorState): string[] {
  const list = getTopLevelBlockIds(state.doc);

  assert.ok(list.every((id) => typeof id === "string" && id.length > 0), "every block has an id");
  assert.equal(new Set(list).size, list.length, `ids are unique: ${list.join(", ")}`);
  return list as string[];
}

function text(state: EditorState, blockId: string): string {
  return state.doc.nodeAt(findBlockPosition(state.doc, blockId))!.textContent;
}

test("typing keeps every block id", () => {
  let state = createState([p("p-1", "Перший"), image, p("p-2", "Другий"), callout, divider, table]);
  const before = ids(state);

  state = type(cursor(state, "p-1", 6), " абзац");
  state = type(cursor(state, "p-2", 0), "Ще ");
  state = type(cursor(state, "callout-1", 8), "!");

  assert.deepStrictEqual(ids(state), before);
  assert.equal(text(state, "p-1"), "Перший абзац");
  assert.equal(text(state, "p-2"), "Ще Другий");
});

test("splitting a paragraph in the middle keeps its id on the first half and gives the second a fresh id", () => {
  const state = run(cursor(createState([p("p-1", "ПершийДругий"), p("p-2", "Далі")]), "p-1", 6), handleEnter);
  const [first, second, third] = ids(state);

  assert.equal(first, "p-1");
  assert.match(second!, /^p-/);
  assert.notEqual(second, "p-1");
  assert.equal(third, "p-2");
  assert.equal(text(state, "p-1"), "Перший");
  assert.equal(text(state, second!), "Другий");
});

test("Enter at the end of a paragraph adds a fresh block below; Enter at the start keeps the id with the text", () => {
  const atEnd = run(cursor(createState([p("p-1", "Текст")]), "p-1", 5), handleEnter);
  assert.equal(ids(atEnd)[0], "p-1");
  assert.equal(ids(atEnd).length, 2);
  assert.equal(text(atEnd, "p-1"), "Текст");

  const atStart = run(cursor(createState([p("p-1", "Текст")]), "p-1", 0), handleEnter);
  assert.equal(ids(atStart)[1], "p-1");
  assert.notEqual(ids(atStart)[0], "p-1");
  assert.equal(text(atStart, "p-1"), "Текст");
});

test("Enter at the end of a heading starts a paragraph with a fresh id", () => {
  const state = run(
    cursor(createState([{ id: "h-1", type: "heading", level: 2, content: [{ text: "Заголовок" }] }]), "h-1", 9),
    handleEnter
  );
  const document = toDocument(state);

  assert.deepStrictEqual(document.blocks[0], { id: "h-1", type: "heading", level: 2, content: [{ text: "Заголовок" }] });
  assert.equal(document.blocks[1]!.type, "paragraph");
  assert.match(document.blocks[1]!.id, /^p-/);
  ids(state);
});

test("repeated splits never produce duplicate or missing ids", () => {
  let state = createState([p("p-1", "абвгґдеєжзиіїйклмн"), p("p-2", "опрстуфхцчшщьюя")]);

  for (const [blockId, offset] of [["p-1", 3], ["p-1", 1], ["p-2", 5], ["p-2", 2], ["p-1", 0]] as const) {
    state = run(cursor(state, blockId, offset), handleEnter);
    ids(state);
  }

  assert.equal(ids(state).length, 7);
  assert.ok(ids(state).includes("p-1") && ids(state).includes("p-2"));
});

test("merging two paragraphs keeps the first id and drops the second", () => {
  const backward = run(cursor(createState([p("p-1", "Перший"), p("p-2", "Другий"), p("p-3", "Третій")]), "p-2", 0), joinBackward);
  assert.deepStrictEqual(ids(backward), ["p-1", "p-3"]);
  assert.equal(text(backward, "p-1"), "ПершийДругий");

  const forward = run(cursor(createState([p("p-1", "Перший"), p("p-2", "Другий"), p("p-3", "Третій")]), "p-2", 6), joinForward);
  assert.deepStrictEqual(ids(forward), ["p-1", "p-2"]);
  assert.equal(text(forward, "p-2"), "ДругийТретій");
});

test("split followed by merge returns to the original ids, and undo/redo restore ids exactly", () => {
  const initial = createState([p("p-1", "ПершийДругий"), p("p-2", "Далі")]);
  const split = run(cursor(initial, "p-1", 6), handleEnter);
  const splitIds = ids(split);

  const merged = run(split, joinBackward);
  assert.deepStrictEqual(ids(merged), ["p-1", "p-2"]);
  assert.equal(text(merged, "p-1"), "ПершийДругий");

  const undone = run(split, undo);
  assert.deepStrictEqual(ids(undone), ["p-1", "p-2"]);
  assert.deepStrictEqual(toDocument(undone), toDocument(initial));

  const redone = run(undone, redo);
  assert.deepStrictEqual(ids(redone), splitIds);
});

test("a block inserted with an id that already exists gets a fresh id; the original keeps its own", () => {
  const state = createState([p("p-1", "Оригінал"), p("p-2", "Далі")]);
  const copy = state.doc.child(0);
  const pasted = state.apply(state.tr.insert(state.doc.content.size, copy));
  const [first, second, third] = ids(pasted);

  assert.equal(first, "p-1");
  assert.equal(second, "p-2");
  assert.notEqual(third, "p-1");
  assert.equal(text(pasted, third!), "Оригінал");
});

test("pasting a copy of a block above its source leaves the id on the original", () => {
  const state = createState([p("p-1", "Перший"), p("p-2", "Другий"), p("p-3", "Третій")]);
  const copy = state.doc.child(2);

  // Whole block dropped at the very top (closed slice).
  const atTop = state.apply(state.tr.insert(0, copy));
  const topIds = ids(atTop);
  assert.deepStrictEqual(topIds.slice(1), ["p-1", "p-2", "p-3"]);
  assert.notEqual(topIds[0], "p-3");
  assert.equal(atTop.doc.child(0).textContent, "Третій");
  assert.equal(text(atTop, "p-3"), "Третій");
  assert.equal(findBlockPosition(atTop.doc, "p-3"), atTop.doc.content.size - copy.nodeSize);

  // Whole block pasted directly in front of its own source.
  const before = findBlockPosition(state.doc, "p-3");
  const inFront = state.apply(state.tr.insert(before, copy));
  const frontIds = ids(inFront);
  assert.deepStrictEqual([frontIds[0], frontIds[1], frontIds[3]], ["p-1", "p-2", "p-3"]);
  assert.notEqual(frontIds[2], "p-3");
  assert.equal(findBlockPosition(inFront.doc, "p-3"), before + copy.nodeSize);

  // Closed slice pasted through the selection, as a clipboard paste does, into an empty paragraph above.
  const withGap = createState([p("p-0", ""), p("p-1", "Перший"), p("p-3", "Третій")]);
  const pasted = cursor(withGap, "p-0", 0);
  const afterPaste = pasted.apply(pasted.tr.replaceSelection(new Slice(Fragment.from(withGap.doc.child(2)), 0, 0)));
  const pasteIds = ids(afterPaste);
  assert.equal(pasteIds[pasteIds.length - 1], "p-3");
  assert.equal(pasteIds.filter((id) => id === "p-3").length, 1);
  assert.equal(afterPaste.doc.lastChild!.textContent, "Третій");
});

test("pasting an open slice (mid-block to mid-block) above its source does not re-id the untouched originals", () => {
  const state = createState([p("p-1", "ПершийАбзац"), p("p-2", "Другий"), p("p-3", "ТретійАбзац"), p("p-4", "ЧетвертийАбзац")]);
  const from = findBlockPosition(state.doc, "p-3") + 1 + 6;
  const to = findBlockPosition(state.doc, "p-4") + 1 + 9;
  const slice = state.doc.slice(from, to);
  assert.equal(slice.openStart, 1);
  assert.equal(slice.openEnd, 1);

  const target = cursor(state, "p-1", 6);
  const pasted = target.apply(target.tr.replaceSelection(slice));
  const document = toDocument(pasted);
  const pastedIds = ids(pasted);

  assert.deepStrictEqual(
    document.blocks.map((block) => (block.type === "paragraph" ? block.content[0]!.text : "")),
    ["ПершийАбзац", "ЧетвертийАбзац", "Другий", "ТретійАбзац", "ЧетвертийАбзац"]
  );
  assert.equal(pastedIds[0], "p-1");
  assert.deepStrictEqual(pastedIds.slice(2), ["p-2", "p-3", "p-4"]);
  assert.notEqual(pastedIds[1], "p-4");
  assert.match(pastedIds[1]!, /^p-/);
});

test("a drag-copy keeps the id on the source, a drag-move carries the id to the new place", () => {
  const state = createState([p("p-1", "Перший"), image, p("p-2", "Другий")]);
  const imagePos = findBlockPosition(state.doc, "image-1");
  const imageNode = state.doc.nodeAt(imagePos)!;

  // Ctrl-drag: the node is inserted at the drop point and the source stays.
  const copied = state.apply(state.tr.insert(0, imageNode));
  const copiedIds = ids(copied);
  assert.deepStrictEqual(copiedIds.slice(1), ["p-1", "image-1", "p-2"]);
  assert.match(copiedIds[0]!, /^image-/);
  assert.notEqual(copiedIds[0], "image-1");

  // Plain drag: the source is deleted and the node inserted elsewhere in one transaction.
  const moveUp = state.tr.delete(imagePos, imagePos + imageNode.nodeSize);
  const movedUp = state.apply(moveUp.insert(0, imageNode));
  assert.deepStrictEqual(ids(movedUp), ["image-1", "p-1", "p-2"]);

  const moveDown = state.tr.delete(imagePos, imagePos + imageNode.nodeSize);
  const movedDown = state.apply(moveDown.insert(moveDown.doc.content.size, imageNode));
  assert.deepStrictEqual(ids(movedDown), ["p-1", "p-2", "image-1"]);
  assert.deepStrictEqual(toDocument(movedDown).blocks[2], image);
});

test("two pasted copies of one id that nobody owned: the first keeps it, the second gets a fresh one", () => {
  const state = createState([p("p-1", "Текст")]);
  const foreign = schema.nodes.paragraph!.create({ id: "p-foreign" }, schema.text("Чужий"));
  const next = state.apply(state.tr.insert(state.doc.content.size, [foreign, foreign]));
  const nextIds = ids(next);

  assert.deepStrictEqual(nextIds.slice(0, 2), ["p-1", "p-foreign"]);
  assert.notEqual(nextIds[2], "p-foreign");
});

test("Backspace at the start of a paragraph selects the divider, image or table above; the next one deletes it", () => {
  for (const atom of [divider, image, table]) {
    const state = cursor(createState([p("p-1", "Перед"), atom, p("p-2", "Після")]), "p-2", 0);

    const selected = run(state, handleBackspace);
    assert.ok(selected.selection instanceof NodeSelection, `${atom.type} is selected`);
    assert.equal((selected.selection as NodeSelection).node.attrs.id, atom.id);
    assert.deepStrictEqual(ids(selected), ["p-1", atom.id, "p-2"]);
    assert.deepStrictEqual(toDocument(selected), toDocument(state), "nothing is deleted by the first Backspace");

    // With the node selected, Backspace is no longer ours: the default deletes the selection.
    assert.equal(handleBackspace(selected, undefined), false);
    const deleted = run(selected, deleteSelection);
    assert.deepStrictEqual(ids(deleted), ["p-1", "p-2"]);
    assert.equal(text(deleted, "p-2"), "Після");
  }

  const midText = cursor(createState([divider, p("p-2", "Після")]), "p-2", 2);
  assert.equal(handleBackspace(midText, undefined), false, "inside the text Backspace stays a normal delete");

  const emptyBelow = cursor(createState([divider, p("p-2", "")]), "p-2", 0);
  assert.equal(handleBackspace(emptyBelow, undefined), false, "an empty paragraph is left to the default (remove it, select the block above)");
});

test("a block inserted without an id gets one", () => {
  const state = createState([p("p-1", "Текст")]);
  const next = state.apply(state.tr.insert(0, schema.nodes.heading!.create({ level: 2 }, schema.text("Новий"))));

  assert.match(ids(next)[0]!, /^h-/);
  assert.equal(ids(next)[1], "p-1");
});

test("toggling a list wraps the selected paragraphs under the first id and unwraps back", () => {
  let state = createState([p("p-0", "Перед"), p("p-1", "Один"), p("p-2", "Два"), p("p-3", "Після")]);
  const from = findBlockPosition(state.doc, "p-1") + 2;
  const to = findBlockPosition(state.doc, "p-2") + 3;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));

  const listed = run(state, toggleList("bulletList"));
  assert.deepStrictEqual(ids(listed), ["p-0", "p-1", "p-3"]);
  assert.deepStrictEqual(toDocument(listed).blocks[1], {
    id: "p-1",
    type: "bullet_list",
    items: [[{ text: "Один" }], [{ text: "Два" }]]
  });
  assert.equal(listed.selection.$from.parent.textContent, "Один");
  assert.equal(listed.selection.$from.parentOffset, 1);
  assert.equal(listed.selection.$to.parent.textContent, "Два");
  assert.equal(listed.selection.$to.parentOffset, 2);
  assert.equal(getActiveBlockKind(listed), "bulletList");

  const ordered = run(listed, toggleList("orderedList"));
  assert.equal(toDocument(ordered).blocks[1]!.type, "ordered_list");
  assert.deepStrictEqual(ids(ordered), ["p-0", "p-1", "p-3"]);

  const unwrapped = run(ordered, toggleList("orderedList"));
  const unwrappedIds = ids(unwrapped);
  assert.equal(unwrappedIds.length, 4);
  assert.equal(unwrappedIds[1], "p-1");
  assert.deepStrictEqual(
    toDocument(unwrapped).blocks.map((block) => block.type),
    ["paragraph", "paragraph", "paragraph", "paragraph"]
  );
  assert.equal(text(unwrapped, unwrappedIds[2]!), "Два");
});

test("Enter in a list adds an item without touching the list id; Enter on an empty item leaves the list", () => {
  const list: Block = { id: "list-1", type: "bullet_list", items: [[{ text: "Один" }], [{ text: "Два" }]] };
  let state = createState([list, p("p-1", "Після")]);

  state = run(cursor(state, "list-1", 4), handleEnter);
  assert.deepStrictEqual(ids(state), ["list-1", "p-1"]);
  assert.deepStrictEqual(toDocument(state).blocks[0], {
    id: "list-1",
    type: "bullet_list",
    items: [[{ text: "Один" }], [{ text: "" }], [{ text: "Два" }]]
  });

  // The cursor is now in the empty middle item: Enter splits the list around a new paragraph.
  state = run(state, handleEnter);
  const document = toDocument(state);
  const [first, second, third, fourth] = ids(state);

  assert.equal(first, "list-1");
  assert.equal(fourth, "p-1");
  assert.deepStrictEqual(document.blocks.map((block) => block.type), ["bullet_list", "paragraph", "bullet_list", "paragraph"]);
  assert.match(second!, /^p-/);
  assert.match(third!, /^list-/);
  assert.equal(state.selection.$from.parent.type.name, "paragraph");
  assert.equal(state.selection.$from.node(1).attrs.id, second);
});

test("Enter on the only, empty list item turns the list into a paragraph with the same id", () => {
  const state = run(cursor(createState([{ id: "list-1", type: "ordered_list", items: [[{ text: "" }]] }]), "list-1", 0), handleEnter);

  assert.deepStrictEqual(toDocument(state).blocks, [{ id: "list-1", type: "paragraph", content: [{ text: "" }] }]);
});

test("Backspace at the start of the first list item lifts it out; the rest of the list keeps the id", () => {
  const list: Block = { id: "list-1", type: "bullet_list", items: [[{ text: "Один" }], [{ text: "Два" }]] };
  const lifted = run(cursor(createState([list]), "list-1", 0), handleBackspace);
  const document = toDocument(lifted);

  assert.equal(ids(lifted)[1], "list-1");
  assert.equal(document.blocks[0]!.type, "paragraph");
  assert.deepStrictEqual(document.blocks[1], { id: "list-1", type: "bullet_list", items: [[{ text: "Два" }]] });

  const single = run(cursor(createState([{ id: "list-1", type: "bullet_list", items: [[{ text: "Один" }]] }]), "list-1", 0), handleBackspace);
  assert.deepStrictEqual(toDocument(single).blocks, [{ id: "list-1", type: "paragraph", content: [{ text: "Один" }] }]);

  assert.equal(handleBackspace(cursor(createState([list]), "list-1", 2), undefined), false, "mid-text Backspace is left to the default");
});

test("changing the block type keeps the id, and a list turned into text keeps it on the first paragraph", () => {
  let state = cursor(createState([p("p-1", "Заголовок"), { id: "list-1", type: "bullet_list", items: [[{ text: "а" }], [{ text: "б" }]] }]), "p-1", 3);

  state = run(state, setTextBlockType({ type: "heading", level: 2 }));
  assert.deepStrictEqual(toDocument(state).blocks[0], { id: "p-1", type: "heading", level: 2, content: [{ text: "Заголовок" }] });
  assert.equal(getActiveBlockKind(state), "heading-2");
  assert.equal(state.selection.$from.parentOffset, 3);

  state = run(state, setTextBlockType({ type: "heading", level: 3 }));
  assert.equal(getActiveBlockKind(state), "heading-3");
  state = run(state, setTextBlockType({ type: "paragraph" }));
  assert.deepStrictEqual(toDocument(state).blocks[0], p("p-1", "Заголовок"));

  state = run(cursor(state, "list-1", 1), setTextBlockType({ type: "paragraph" }));
  const document = toDocument(state);
  assert.deepStrictEqual(document.blocks.map((block) => block.type), ["paragraph", "paragraph", "paragraph"]);
  assert.equal(ids(state)[1], "list-1");
});

test("bold, italic and soft breaks apply to the selection without changing ids", () => {
  let state = cursor(createState([p("p-1", "один два три")]), "p-1", 5, 8);

  state = run(state, toggleMarkCommand("bold"));
  state = run(cursor(state, "p-1", 0, 4), toggleMarkCommand("italic"));
  state = run(cursor(state, "p-1", 8), insertHardBreak);

  assert.deepStrictEqual(toDocument(state).blocks, [
    {
      id: "p-1",
      type: "paragraph",
      content: [{ text: "один", italic: true }, { text: " " }, { text: "два\n", bold: true }, { text: " три" }]
    }
  ]);
});

test("callout editing keeps the callout id: Enter in the title goes to the body, an empty last line leaves the callout", () => {
  let state = cursor(createState([callout, p("p-1", "Після")]), "callout-1", 8);

  state = run(state, handleEnter);
  assert.equal(state.selection.$from.parent.type.name, "calloutBody");
  assert.equal(state.selection.$from.parentOffset, 0);
  assert.deepStrictEqual(toDocument(state).blocks[0], callout);

  const bodyEnd = state.selection.$from.end();
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, bodyEnd)));
  state = run(state, handleEnter);
  assert.deepStrictEqual(ids(state), ["callout-1", "p-1"]);
  assert.equal((toDocument(state).blocks[0] as Extract<Block, { type: "callout" }>).body.length, 2);

  state = run(state, handleEnter);
  const document = toDocument(state);
  assert.deepStrictEqual(document.blocks[0], callout);
  assert.deepStrictEqual(document.blocks.map((block) => block.type), ["callout", "paragraph", "paragraph"]);
  assert.equal(ids(state).length, 3);
  assert.equal(state.selection.$from.parent.type.name, "paragraph");
});

test("inserted callouts and images get fresh ids after the current block", () => {
  let state = cursor(createState([p("p-1", "Один"), p("p-2", "Два")]), "p-1", 2);

  state = run(state, insertCallout("mechanism"));
  assert.equal(state.selection.$from.parent.type.name, "calloutTitle");
  state = run(cursor(state, "p-2", 0), insertImage({ assetId: "asset-9", alt: "файл" }));

  const document = toDocument(state);
  assert.deepStrictEqual(document.blocks.map((block) => block.type), ["paragraph", "callout", "paragraph", "image"]);
  assert.match(ids(state)[1]!, /^callout-/);
  assert.match(ids(state)[3]!, /^image-/);
  assert.deepStrictEqual(document.blocks[3], { id: ids(state)[3], type: "image", assetId: "asset-9", alt: "файл", caption: [{ text: "" }] });
});

test("replacing the whole manuscript keeps the new ids and is one undo step", () => {
  const initial = createState([p("p-1", "Старий"), image, table]);
  const incoming = schema.nodeFromJSON(documentToTiptap({ version: 2, blocks: [p("p-9", "Новий"), callout, divider] }));
  const replaced = run(initial, replaceDocumentContent(incoming.content));

  assert.deepStrictEqual(ids(replaced), ["p-9", "callout-1", "divider-1"]);
  assert.deepStrictEqual(toDocument(run(replaced, undo)), toDocument(initial));
});

test("deleting everything leaves one paragraph with an id", () => {
  const state = createState([p("p-1", "Один"), image, callout, p("p-2", "Два")]);
  const cleared = state.apply(state.tr.setSelection(new AllSelection(state.doc)).deleteSelection());

  assert.equal(ids(cleared).length, 1);
  assert.equal(toDocument(cleared).blocks[0]!.type, "paragraph");
});

test("blocks that are not edited come back from the editor byte-for-byte", () => {
  const blocks = [p("p-1", "ПершийДругий"), image, callout, divider, table, p("p-2", "Кінець")];
  let state = createState(blocks);

  state = run(cursor(state, "p-1", 6), handleEnter);
  state = type(cursor(state, "p-2", 6), "!");
  state = run(cursor(state, "p-2", 0, 3), toggleMarkCommand("bold"));

  const document = toDocument(state);
  for (const block of [image, callout, divider, table]) {
    assert.deepStrictEqual(document.blocks.find((candidate) => candidate.id === block.id), block);
  }
});
