import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPatchOperation,
  hasSelection,
  normalizePatchSelection,
  preserveInlineFormatting,
  type PatchOperation
} from "../lib/editor/patch-contract.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";

function createDocument(): EditorDocument {
  return {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "Складний " }, { text: "термін", bold: true }, { text: " треба пояснити." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Другий абзац." }] }
    ]
  };
}

test("normalizePatchSelection keeps contiguous block selection", () => {
  const document = createDocument();
  const selection = normalizePatchSelection(document, {
    blockIds: ["p2", "p1"],
    anchorBlockId: "p1",
    focusBlockId: "p2"
  });

  assert.equal(hasSelection(selection), true);
  assert.deepEqual(selection.blockIds, ["p1", "p2"]);
});

test("applyPatchOperation replaces selected blocks and preserves ids", () => {
  const document = createDocument();
  const operation: PatchOperation = {
    id: "patch-1",
    op: "replace_blocks",
    blockIds: ["p1"],
    oldBlocks: [document.blocks[0]],
    newBlocks: [{ id: "temp", type: "paragraph", content: [{ text: "Пояснений термін." }] }],
    reason: "Спростив блок.",
    type: "clarity"
  };

  const next = applyPatchOperation(document, operation);

  assert.equal(next.blocks[0]?.id, "p1");
  assert.equal(next.blocks[0]?.type, "paragraph");
  assert.equal(next.blocks[0]?.content.map((node) => node.text).join(""), "Пояснений термін.");
});

test("preserveInlineFormatting keeps unchanged bold segment", () => {
  const result = preserveInlineFormatting(
    [{ text: "термін", bold: true }, { text: " і пояснення" }],
    [{ text: "термін і пояснення" }]
  );

  assert.equal(result[0]?.text, "термін");
  assert.equal(result[0]?.bold, true);
});
