import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPatchOperations,
  normalizePatchOperationsResult,
  type PatchSelection
} from "../lib/editor/patch-contract.ts";

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
