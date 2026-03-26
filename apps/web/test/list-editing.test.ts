import test from "node:test";
import assert from "node:assert/strict";
import { exitListItemToParagraph } from "../lib/editor/list-editing.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";

test("exitListItemToParagraph removes only the empty tail item and inserts a paragraph after the list", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "list-1",
        type: "bullet_list",
        items: [[{ text: "Перший пункт" }], [{ text: "Другий пункт" }], [{ text: "" }]]
      }
    ]
  };

  const result = exitListItemToParagraph(document, "list-1", 2);

  assert.ok(result);
  assert.equal(result.document.blocks.length, 2);
  assert.equal(result.document.blocks[0]?.type, "bullet_list");
  assert.equal(result.document.blocks[1]?.type, "paragraph");

  if (result.document.blocks[0]?.type !== "bullet_list" || result.document.blocks[1]?.type !== "paragraph") {
    assert.fail("Expected bullet list followed by paragraph.");
  }

  assert.deepEqual(
    result.document.blocks[0].items.map((item) => item[0]?.text ?? ""),
    ["Перший пункт", "Другий пункт"]
  );
  assert.equal(result.focusBlockId, result.document.blocks[1].id);
});

test("exitListItemToParagraph splits a list when the empty item is in the middle", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "list-1",
        type: "bullet_list",
        items: [[{ text: "Перший пункт" }], [{ text: "" }], [{ text: "Третій пункт" }]]
      }
    ]
  };

  const result = exitListItemToParagraph(document, "list-1", 1);

  assert.ok(result);
  assert.equal(result.document.blocks.length, 3);
  assert.equal(result.document.blocks[0]?.type, "bullet_list");
  assert.equal(result.document.blocks[1]?.type, "paragraph");
  assert.equal(result.document.blocks[2]?.type, "bullet_list");

  if (
    result.document.blocks[0]?.type !== "bullet_list" ||
    result.document.blocks[1]?.type !== "paragraph" ||
    result.document.blocks[2]?.type !== "bullet_list"
  ) {
    assert.fail("Expected bullet list, paragraph, bullet list.");
  }

  assert.deepEqual(result.document.blocks[0].items.map((item) => item[0]?.text ?? ""), ["Перший пункт"]);
  assert.deepEqual(result.document.blocks[2].items.map((item) => item[0]?.text ?? ""), ["Третій пункт"]);
  assert.equal(result.focusBlockId, result.document.blocks[1].id);
});

test("exitListItemToParagraph converts a single empty list item into an empty paragraph in place", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "list-1",
        type: "ordered_list",
        items: [[{ text: "" }]]
      }
    ]
  };

  const result = exitListItemToParagraph(document, "list-1", 0);

  assert.ok(result);
  assert.equal(result.document.blocks.length, 1);
  assert.equal(result.document.blocks[0]?.id, "list-1");
  assert.equal(result.document.blocks[0]?.type, "paragraph");
  assert.equal(result.focusBlockId, "list-1");
});
