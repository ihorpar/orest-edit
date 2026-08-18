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

test("serializeInlineNodesToBoldMarkdown restores *markers* from italic inline nodes", () => {
  assert.equal(
    serializeInlineNodesToBoldMarkdown([{ text: "Тут є " }, { text: "курсив", italic: true }, { text: " у фразі." }]),
    "Тут є *курсив* у фразі."
  );
});

test("serializeInlineNodesToBoldMarkdown restores combined bold and italic markers", () => {
  assert.equal(
    serializeInlineNodesToBoldMarkdown([{ text: "важливо", bold: true, italic: true }]),
    "***важливо***"
  );
});
