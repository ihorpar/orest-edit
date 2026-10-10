import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import {
  blockToTiptapNode,
  documentToTiptap,
  ensureDocumentBlockIds,
  inlineNodesToTiptap,
  tiptapNodeToBlock,
  tiptapToDocument,
  tiptapToInlineNodes
} from "../lib/v2/tiptap-bridge.ts";
import { createV2Extensions } from "../lib/v2/tiptap-extensions.ts";

const schema = getSchema(createV2Extensions());

const paragraph: Block = {
  id: "p-1",
  type: "paragraph",
  content: [
    { text: "Звичайний текст, " },
    { text: "жирний", bold: true },
    { text: " і " },
    { text: "курсив", italic: true },
    { text: " та " },
    { text: "обидва", bold: true, italic: true },
    { text: ", " },
    { text: "посилання", link: "https://example.org/a" },
    { text: "." }
  ]
};
const softBreaks: Block = {
  id: "p-2",
  type: "paragraph",
  content: [{ text: "Перший рядок\nдругий рядок\n\nчетвертий " }, { text: "жирний\nрядок", bold: true }, { text: "\n" }]
};
const emptyParagraph: Block = { id: "p-3", type: "paragraph", content: [{ text: "" }] };
const headings: Block[] = [
  { id: "h-1", type: "heading", level: 1, content: [{ text: "Назва розділу" }] },
  { id: "h-2", type: "heading", level: 2, content: [{ text: "Підрозділ з " }, { text: "акцентом", italic: true }] },
  { id: "h-3", type: "heading", level: 3, content: [{ text: "" }] }
];
const bulletList: Block = {
  id: "list-1",
  type: "bullet_list",
  items: [[{ text: "перший пункт" }], [{ text: "другий " }, { text: "пункт", bold: true }], [{ text: "" }], [{ text: "з\nперенесенням" }]]
};
const orderedList: Block = {
  id: "list-2",
  type: "ordered_list",
  items: [[{ text: "крок один" }], [{ text: "крок два", italic: true }]]
};
const imageWithCaption: Block = {
  id: "image-1",
  type: "image",
  assetId: "asset-local-abc",
  alt: "Схема рецептора",
  caption: [{ text: "Підпис із " }, { text: "виділенням", bold: true }]
};
const imageWithoutCaption: Block = { id: "image-2", type: "image", assetId: "asset-local-def", alt: "" };
const imageWithEmptyCaption: Block = { id: "image-3", type: "image", assetId: "asset-local-ghi", alt: "alt", caption: [{ text: "" }] };
const calloutDeep: Block = {
  id: "callout-1",
  type: "callout",
  kind: "analogy",
  depth: "deep",
  title: [{ text: "Ключ, що " }, { text: "застряг", bold: true }],
  body: [[{ text: "Перший абзац врізки." }], [{ text: "Другий " }, { text: "абзац", italic: true }, { text: "\nз перенесенням." }]]
};
const calloutWithoutDepth: Block = {
  id: "callout-2",
  type: "callout",
  kind: "myths_vs_truth",
  title: [{ text: "" }],
  body: []
};
const calloutBrief: Block = {
  id: "callout-3",
  type: "callout",
  kind: "top_list",
  depth: "brief",
  title: [{ text: "Пункти" }],
  body: [[{ text: "" }]]
};
const divider: Block = { id: "divider-1", type: "divider" };
const table: Block = {
  id: "table-1",
  type: "table",
  rows: [
    [[{ text: "Речовина" }], [{ text: "Дія", bold: true }]],
    [[{ text: "Кофеїн" }], [{ text: "блокує\nрецептор" }]],
    [[{ text: "" }], [{ text: "порожня клітинка ліворуч", italic: true }]]
  ]
};
const emptyTable: Block = { id: "table-2", type: "table", rows: [] };

const everyBlock: Block[] = [
  headings[0]!,
  paragraph,
  softBreaks,
  emptyParagraph,
  headings[1]!,
  headings[2]!,
  bulletList,
  orderedList,
  imageWithCaption,
  imageWithoutCaption,
  imageWithEmptyCaption,
  calloutDeep,
  calloutWithoutDepth,
  calloutBrief,
  divider,
  table,
  emptyTable
];

function roundTripThroughProseMirror(document: EditorDocument): EditorDocument {
  const node = schema.nodeFromJSON(documentToTiptap(document));
  node.check();
  return tiptapToDocument(node.toJSON());
}

test("every block type survives EditorDocument -> Tiptap -> EditorDocument unchanged", () => {
  const document: EditorDocument = { version: 2, blocks: everyBlock };
  const source = structuredClone(document);

  assert.deepStrictEqual(roundTripThroughProseMirror(document), source);
  assert.deepStrictEqual(document, source, "the source document must not be mutated");
});

for (const block of everyBlock) {
  test(`round-trip is lossless for ${block.type} ${block.id}`, () => {
    assert.deepStrictEqual(roundTripThroughProseMirror({ version: 2, blocks: [block] }).blocks, [block]);
    assert.deepStrictEqual(tiptapNodeToBlock(blockToTiptapNode(block)), block);
  });
}

test("the round-trip is stable when repeated and after JSON persistence", () => {
  const document: EditorDocument = { version: 2, blocks: everyBlock };
  const once = roundTripThroughProseMirror(document);
  const twice = roundTripThroughProseMirror(JSON.parse(JSON.stringify(once)) as EditorDocument);

  assert.deepStrictEqual(twice, once);
});

test("all eight block types map to a valid ProseMirror node with the block id in attrs", () => {
  const types = new Set(everyBlock.map((block) => block.type));
  assert.deepStrictEqual(
    [...types].sort(),
    ["bullet_list", "callout", "divider", "heading", "image", "ordered_list", "paragraph", "table"]
  );

  const node = schema.nodeFromJSON(documentToTiptap({ version: 2, blocks: everyBlock }));
  const ids: string[] = [];
  node.forEach((child) => ids.push(child.attrs.id));

  assert.deepStrictEqual(ids, everyBlock.map((block) => block.id));
});

test("soft line breaks become hardBreak nodes and keep their marks", () => {
  const content = inlineNodesToTiptap([{ text: "а\nб", bold: true }, { text: "\nв" }]);

  assert.deepStrictEqual(content, [
    { type: "text", text: "а", marks: [{ type: "bold" }] },
    { type: "hardBreak", marks: [{ type: "bold" }] },
    { type: "text", text: "б", marks: [{ type: "bold" }] },
    { type: "hardBreak" },
    { type: "text", text: "в" }
  ]);
  assert.deepStrictEqual(tiptapToInlineNodes(content), [{ text: "а\nб", bold: true }, { text: "\nв" }]);
});

test("inline output is normalised: adjacent runs with equal marks merge, empty content is one empty run", () => {
  assert.deepStrictEqual(
    tiptapToInlineNodes([
      { type: "text", text: "раз " },
      { type: "text", text: "два" },
      { type: "text", text: " три", marks: [{ type: "italic" }] }
    ]),
    [{ text: "раз два" }, { text: " три", italic: true }]
  );
  assert.deepStrictEqual(tiptapToInlineNodes(undefined), [{ text: "" }]);
  assert.deepStrictEqual(tiptapToInlineNodes([]), [{ text: "" }]);
});

test("legacy inline nodes with explicit undefined marks round-trip to clean nodes", () => {
  const block: Block = {
    id: "p-legacy",
    type: "paragraph",
    content: [
      { text: "текст ", bold: undefined, italic: undefined, link: undefined },
      { text: "жирний", bold: true, italic: undefined, link: undefined }
    ]
  };

  assert.deepStrictEqual(roundTripThroughProseMirror({ version: 2, blocks: [block] }).blocks, [
    { id: "p-legacy", type: "paragraph", content: [{ text: "текст " }, { text: "жирний", bold: true }] }
  ]);
});

test("an empty document becomes one empty paragraph with an id", () => {
  const result = roundTripThroughProseMirror({ version: 2, blocks: [] });

  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0]!.type, "paragraph");
  assert.match(result.blocks[0]!.id, /^p-/);
});

test("ids are never invented on the way out: a block node without an id throws, an unknown node is skipped", () => {
  assert.throws(() => tiptapNodeToBlock({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Без id" }] }), /has no id/);
  assert.throws(() => tiptapToDocument({ type: "doc", content: [{ type: "paragraph", attrs: { id: null } }] }), /has no id/);
  assert.equal(tiptapNodeToBlock({ type: "unknownNode" }), null);
});

test("a document with missing or duplicate ids is normalised once, on entry to the editor", () => {
  const broken = {
    version: 2,
    blocks: [
      { id: null, type: "paragraph", content: [{ text: "без id" }] },
      { id: "p-1", type: "paragraph", content: [{ text: "оригінал" }] },
      { id: "p-1", type: "heading", level: 2, content: [{ text: "дублікат" }] },
      { id: "", type: "divider" },
      { type: "bullet_list", items: [[{ text: "пункт" }]] }
    ]
  } as unknown as EditorDocument;
  const source = structuredClone(broken);

  const normalised = ensureDocumentBlockIds(broken);
  const ids = normalised.blocks.map((block) => block.id);

  assert.deepStrictEqual(broken, source, "the input is not mutated");
  assert.equal(new Set(ids).size, 5);
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
  assert.equal(ids[1], "p-1", "the first owner keeps the id");
  assert.match(ids[0]!, /^p-/);
  assert.match(ids[2]!, /^h-/);
  assert.match(ids[3]!, /^divider-/);
  assert.match(ids[4]!, /^list-/);

  // In the editor every read of the unedited state gives the same ids.
  const node = schema.nodeFromJSON(documentToTiptap(broken));
  const first = tiptapToDocument(node.toJSON());
  const second = tiptapToDocument(node.toJSON());

  assert.deepStrictEqual(first, second);
  assert.equal(new Set(first.blocks.map((block) => block.id)).size, 5);
  assert.equal(first.blocks[1]!.id, "p-1");
});

test("a document whose ids are already fine is returned as is", () => {
  const document: EditorDocument = { version: 2, blocks: everyBlock };

  assert.equal(ensureDocumentBlockIds(document), document);
});
