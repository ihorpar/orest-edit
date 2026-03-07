import test from "node:test";
import assert from "node:assert/strict";

import { getMarkdownImageBlocks, insertMarkdownImageBlock, moveMarkdownImageBlock } from "../lib/editor/markdown-editor.ts";

test("insertMarkdownImageBlock inserts a standalone markdown image block with caption", () => {
  const result = insertMarkdownImageBlock("Перший абзац.", { start: 13, end: 13 }, {
    alt: "Схема серця",
    source: "asset:img-1",
    caption: "Пояснювальний підпис"
  });

  assert.equal(result.text, "Перший абзац.\n\n![Схема серця](asset:img-1)\nПояснювальний підпис");
  assert.deepEqual(result.selection, { start: result.text.length, end: result.text.length });
});

test("getMarkdownImageBlocks finds standalone image blocks with optional caption", () => {
  const text = [
    "Вступний абзац.",
    "![Схема](asset:img-1)",
    "Короткий підпис",
    "",
    "Ще абзац."
  ].join("\n\n").replace("\n\nКороткий підпис", "\nКороткий підпис");
  const blocks = getMarkdownImageBlocks(text);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.alt, "Схема");
  assert.equal(blocks[0]?.source, "asset:img-1");
  assert.equal(blocks[0]?.caption, "Короткий підпис");
});

test("moveMarkdownImageBlock moves a standalone image block to a later paragraph boundary", () => {
  const text = [
    "Перший абзац.",
    "![Схема](asset:img-1)",
    "Підпис",
    "",
    "Другий абзац.",
    "",
    "Третій абзац."
  ].join("\n\n").replace("\n\nПідпис", "\nПідпис");
  const block = getMarkdownImageBlocks(text)[0];

  assert.ok(block);

  const targetIndex = text.length;
  const result = moveMarkdownImageBlock(text, block, targetIndex);

  assert.equal(result.text, "Перший абзац.\n\nДругий абзац.\n\nТретій абзац.\n\n![Схема](asset:img-1)\nПідпис");
  assert.deepEqual(result.selection, {
    start: result.text.lastIndexOf("![Схема](asset:img-1)") + "![Схема](asset:img-1)\nПідпис".length,
    end: result.text.lastIndexOf("![Схема](asset:img-1)") + "![Схема](asset:img-1)\nПідпис".length
  });
});
