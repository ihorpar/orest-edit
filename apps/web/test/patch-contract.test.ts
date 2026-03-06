import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPatchOperations,
  normalizePatchOperationsResult,
  type PatchSelection
} from "../lib/editor/patch-contract.ts";
import { applyMarkdownFormat } from "../lib/editor/markdown-editor.ts";

test("normalizePatchOperationsResult drops invalid and overlapping operations", () => {
  const text = "abcdefghij";
  const selection: PatchSelection = { start: 2, end: 8 };

  const result = normalizePatchOperationsResult(text, selection, [
    { op: "replace", start: 2, end: 4, newText: "XX", reason: "ok", type: "clarity" },
    { op: "replace", start: 3, end: 5, newText: "YY", reason: "overlap", type: "clarity" },
    { op: "replace", start: 0, end: 1, newText: "bad", reason: "outside", type: "clarity" },
    { op: "delete", start: 6, end: 6, reason: "invalid", type: "clarity" }
  ]);

  assert.equal(result.operations.length, 1);
  assert.equal(result.droppedCount, 3);
  assert.equal(result.operations[0]?.oldText, "cd");
});

test("applyPatchOperations applies multiple operations from the end of the text safely", () => {
  const text = "alpha beta gamma";
  const operations = [
    {
      id: "op-1",
      op: "replace" as const,
      start: text.indexOf("alpha"),
      end: text.indexOf("alpha") + "alpha".length,
      oldText: "alpha",
      newText: "один",
      reason: "Спростив.",
      type: "clarity" as const
    },
    {
      id: "op-2",
      op: "replace" as const,
      start: text.indexOf("gamma"),
      end: text.indexOf("gamma") + "gamma".length,
      oldText: "gamma",
      newText: "три",
      reason: "Спростив.",
      type: "clarity" as const
    }
  ];

  const next = applyPatchOperations(text, operations);

  assert.equal(next, "один beta три");
});

test("applyMarkdownFormat wraps the selected text in bold markers", () => {
  const result = applyMarkdownFormat("Простий текст", { start: 0, end: 7 }, "bold");

  assert.equal(result.text, "**Простий** текст");
  assert.deepEqual(result.selection, { start: 2, end: 9 });
});

test("applyMarkdownFormat toggles heading markers on the current line", () => {
  const result = applyMarkdownFormat("Заголовок\nДругий рядок", { start: 0, end: 0 }, "heading-2");

  assert.equal(result.text, "## Заголовок\nДругий рядок");
  assert.deepEqual(result.selection, { start: 0, end: 12 });
});

test("applyMarkdownFormat toggles bullet markers for all selected lines", () => {
  const result = applyMarkdownFormat("перший\nдругий", { start: 0, end: 13 }, "bullet-list");

  assert.equal(result.text, "- перший\n- другий");
  assert.deepEqual(result.selection, { start: 0, end: 18 });
});

test("applyMarkdownFormat inserts a table template as a standalone block", () => {
  const result = applyMarkdownFormat("Вступ", { start: 5, end: 5 }, "table");

  assert.equal(result.text, "Вступ\n\n| Колонка 1 | Колонка 2 |\n| --- | --- |\n| Значення | Значення |");
  assert.deepEqual(result.selection, { start: 7, end: 76 });
});

test("applyMarkdownFormat inserts a markdown link and selects the label placeholder", () => {
  const result = applyMarkdownFormat("Текст", { start: 5, end: 5 }, "link");

  assert.equal(result.text, "Текст[текст посилання](https://example.com)");
  assert.deepEqual(result.selection, { start: 6, end: 21 });
});
