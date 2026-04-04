import test from "node:test";
import assert from "node:assert/strict";
import { mergeTextBlockIntoPrevious, replaceTextInDocument, sliceDocumentForBlockRange, type EditorDocument } from "../lib/editor/document-model.ts";

test("mergeTextBlockIntoPrevious merges paragraph text into the previous text block and returns the join offset", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p-1",
        type: "paragraph",
        content: [{ text: "Перше речення. " }]
      },
      {
        id: "p-2",
        type: "paragraph",
        content: [{ text: "Друге речення." }]
      }
    ]
  };

  const result = mergeTextBlockIntoPrevious(document, "p-2");

  assert.ok(result);
  assert.equal(result.focusBlockId, "p-1");
  assert.equal(result.focusOffset, "Перше речення. ".length);
  assert.equal(result.document.blocks.length, 1);

  const mergedBlock = result.document.blocks[0];
  if (mergedBlock?.type !== "paragraph") {
    assert.fail("Expected merged paragraph block.");
  }

  assert.equal(mergedBlock.content.map((node) => node.text).join(""), "Перше речення. Друге речення.");
});

test("mergeTextBlockIntoPrevious does not merge a paragraph into a heading", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "h-1",
        type: "heading",
        level: 2,
        content: [{ text: "Розділ" }]
      },
      {
        id: "p-2",
        type: "paragraph",
        content: [{ text: "" }]
      }
    ]
  };

  assert.equal(mergeTextBlockIntoPrevious(document, "p-2"), null);
});

test("mergeTextBlockIntoPrevious returns null for the first block or when the previous block is not text", () => {
  const firstBlockDocument: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p-1",
        type: "paragraph",
        content: [{ text: "Початок" }]
      }
    ]
  };

  assert.equal(mergeTextBlockIntoPrevious(firstBlockDocument, "p-1"), null);

  const nonTextPreviousDocument: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "divider-1",
        type: "divider"
      },
      {
        id: "p-2",
        type: "paragraph",
        content: [{ text: "Абзац" }]
      }
    ]
  };

  assert.equal(mergeTextBlockIntoPrevious(nonTextPreviousDocument, "p-2"), null);
});

test("sliceDocumentForBlockRange keeps selected blocks with one-block neighbor context", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p-1", type: "paragraph", content: [{ text: "one" }] },
      { id: "p-2", type: "paragraph", content: [{ text: "two" }] },
      { id: "p-3", type: "paragraph", content: [{ text: "three" }] },
      { id: "p-4", type: "paragraph", content: [{ text: "four" }] },
      { id: "p-5", type: "paragraph", content: [{ text: "five" }] }
    ]
  };

  const sliced = sliceDocumentForBlockRange(document, ["p-2", "p-3", "p-4"], {
    before: 1,
    after: 1
  });

  assert.deepEqual(
    sliced.blocks.map((block) => block.id),
    ["p-1", "p-2", "p-3", "p-4", "p-5"]
  );
  assert.notEqual(sliced.blocks[1], document.blocks[1]);
});

test("replaceTextInDocument replaces repeated literal matches across text-bearing blocks", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p-1", type: "paragraph", content: [{ text: "skin skin", bold: true }] },
      { id: "h-1", type: "heading", level: 2, content: [{ text: "skin heading" }] },
      { id: "l-1", type: "bullet_list", items: [[{ text: "skin list" }]] },
      { id: "i-1", type: "image", assetId: "asset-1", alt: "skin alt", caption: [{ text: "skin caption" }] }
    ]
  };

  const result = replaceTextInDocument(document, "skin", "barrier");

  assert.equal(result.replacementCount, 6);
  assert.deepEqual(result.changedBlockIds, ["p-1", "h-1", "l-1", "i-1"]);

  const paragraph = result.document.blocks[0];
  const heading = result.document.blocks[1];
  const list = result.document.blocks[2];
  const image = result.document.blocks[3];

  if (paragraph?.type !== "paragraph" || heading?.type !== "heading" || list?.type !== "bullet_list" || image?.type !== "image") {
    assert.fail("Expected all updated block types to stay stable.");
  }

  assert.equal(paragraph.content[0]?.text, "barrier barrier");
  assert.equal(paragraph.content[0]?.bold, true);
  assert.equal(heading.content[0]?.text, "barrier heading");
  assert.equal(list.items[0]?.[0]?.text, "barrier list");
  assert.equal(image.alt, "barrier alt");
  assert.equal(image.caption?.[0]?.text, "barrier caption");
});
