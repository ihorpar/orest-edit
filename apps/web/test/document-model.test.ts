import test from "node:test";
import assert from "node:assert/strict";
import { mergeTextBlockIntoPrevious, sliceDocumentForBlockRange, type EditorDocument } from "../lib/editor/document-model.ts";

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
