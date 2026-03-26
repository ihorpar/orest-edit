import test from "node:test";
import assert from "node:assert/strict";
import { parseBoldMarkdownToInlineNodes, serializeInlineNodesToBoldMarkdown } from "../lib/editor/inline-markup.ts";

function compact(nodes: Array<{ text: string; bold?: true; italic?: true; link?: string }>) {
  return nodes.map((node) => ({
    text: node.text,
    ...(node.bold ? { bold: true as const } : {})
  }));
}

test("parseBoldMarkdownToInlineNodes turns **markers** into bold inline nodes", () => {
  assert.deepEqual(compact(parseBoldMarkdownToInlineNodes("Тут є **акцент** у фразі.")), [
    { text: "Тут є " },
    { text: "акцент", bold: true },
    { text: " у фразі." }
  ]);
});

test("serializeInlineNodesToBoldMarkdown restores **markers** from bold inline nodes", () => {
  assert.equal(
    serializeInlineNodesToBoldMarkdown([{ text: "Тут є " }, { text: "акцент", bold: true }, { text: " у фразі." }]),
    "Тут є **акцент** у фразі."
  );
});
