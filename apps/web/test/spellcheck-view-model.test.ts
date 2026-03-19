import assert from "node:assert/strict";
import test from "node:test";
import type { EditorDocument } from "../lib/editor/document-model.ts";
import type { ManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { getSpellcheckableBlocks } from "../lib/editor/spellcheck-view-model.ts";

test("getSpellcheckableBlocks keeps only text blocks in selection order", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p1", type: "paragraph", content: [{ text: "Перший абзац." }] },
      { id: "img1", type: "image", assetId: "asset-1", alt: "diagram", caption: [{ text: "" }] },
      { id: "h1", type: "heading", level: 2, content: [{ text: "Підзаголовок" }] }
    ]
  };
  const revision: ManuscriptRevisionState = {
    documentRevisionId: "rev-1",
    blockOrder: ["p1", "img1", "h1"],
    blockFingerprints: { p1: "a", img1: "b", h1: "c" }
  };

  const result = getSpellcheckableBlocks(document, revision, ["p1", "img1", "h1"]);

  assert.deepEqual(
    result.map((entry) => ({
      blockId: entry.blockId,
      paragraphLabel: entry.paragraphLabel,
      text: entry.text
    })),
    [
      { blockId: "p1", paragraphLabel: "002", text: "Перший абзац." },
      { blockId: "h1", paragraphLabel: "004", text: "Підзаголовок" }
    ]
  );
});
