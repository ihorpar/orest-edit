import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { insertBlocksBefore } from "../lib/editor/review-apply.ts";

function createDocument(): EditorDocument {
  return {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "Перший" }] },
      { id: "p2", type: "paragraph", content: [{ text: "Другий" }] },
      { id: "p3", type: "paragraph", content: [{ text: "Третій" }] }
    ]
  };
}

test("insertBlocksBefore inserts before middle anchor", () => {
  const document = createDocument();
  const next = insertBlocksBefore(document, "p3", [{ id: "h-new", type: "heading", level: 3, content: [{ text: "Підзаголовок" }] }]);

  assert.deepEqual(
    next.blocks.map((block) => block.id),
    ["p1", "p2", "h-new", "p3"]
  );
});

test("insertBlocksBefore prepends when anchor is the first block", () => {
  const document = createDocument();
  const next = insertBlocksBefore(document, "p1", [{ id: "h-new", type: "heading", level: 3, content: [{ text: "Підзаголовок" }] }]);

  assert.deepEqual(
    next.blocks.map((block) => block.id),
    ["h-new", "p1", "p2", "p3"]
  );
});

test("insertBlocksBefore prepends when anchor is missing", () => {
  const document = createDocument();
  const next = insertBlocksBefore(document, "missing", [{ id: "h-new", type: "heading", level: 3, content: [{ text: "Підзаголовок" }] }]);

  assert.deepEqual(
    next.blocks.map((block) => block.id),
    ["h-new", "p1", "p2", "p3"]
  );
});
