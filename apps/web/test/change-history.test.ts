import test from "node:test";
import assert from "node:assert/strict";

import { createMutationEntry, createCompareHistoryEntry, pushMutationEntry } from "../lib/editor/change-history.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";

const baseDocument: EditorDocument = {
  version: 2,
  blocks: [{ id: "p-1", type: "paragraph", content: [{ text: "До" }] }]
};

test("pushMutationEntry merges adjacent manual entries with the same merge key", () => {
  const first = createMutationEntry({
    id: "hist-1",
    kind: "manual_edit",
    label: "Ручне редагування",
    timestamp: 1000,
    timestampLabel: "10:00",
    blockIds: ["p-1"],
    mergeKey: "manual:p-1",
    before: {
      document: baseDocument,
      selection: { blockIds: ["p-1"], anchorBlockId: "p-1", focusBlockId: "p-1" },
      focusedBlockId: "p-1"
    },
    after: {
      document: { version: 2, blocks: [{ id: "p-1", type: "paragraph", content: [{ text: "Після 1" }] }] },
      selection: { blockIds: ["p-1"], anchorBlockId: "p-1", focusBlockId: "p-1" },
      focusedBlockId: "p-1"
    }
  });
  const second = createMutationEntry({
    id: "hist-2",
    kind: "manual_edit",
    label: "Ручне редагування",
    timestamp: 1600,
    timestampLabel: "10:01",
    blockIds: ["p-1"],
    mergeKey: "manual:p-1",
    before: {
      document: baseDocument,
      selection: { blockIds: ["p-1"], anchorBlockId: "p-1", focusBlockId: "p-1" },
      focusedBlockId: "p-1"
    },
    after: {
      document: { version: 2, blocks: [{ id: "p-1", type: "paragraph", content: [{ text: "Після 2" }] }] },
      selection: { blockIds: ["p-1"], anchorBlockId: "p-1", focusBlockId: "p-1" },
      focusedBlockId: "p-1"
    }
  });

  const next = pushMutationEntry([first], second, { mergeWindowMs: 1000 });

  assert.equal(next.length, 1);
  assert.equal(next[0]?.before.document.blocks[0]?.type, "paragraph");
  assert.equal(next[0]?.after.document.blocks[0]?.type, "paragraph");
  assert.equal(next[0]?.after.document.blocks[0]?.content[0]?.text, "Після 2");
});

test("createCompareHistoryEntry clones before and after blocks", () => {
  const compare = createCompareHistoryEntry({
    id: "cmp-1",
    kind: "ai_apply",
    label: "ШІ правка",
    timestampLabel: "10:00",
    blockIds: ["p-1"],
    beforeBlocks: [{ id: "p-1", type: "paragraph", content: [{ text: "Було" }] }],
    afterBlocks: [{ id: "p-1", type: "paragraph", content: [{ text: "Стало" }] }]
  });

  if (compare.beforeBlocks[0]?.type !== "paragraph" || compare.afterBlocks[0]?.type !== "paragraph") {
    throw new Error("Expected paragraph compare blocks");
  }

  compare.beforeBlocks[0].content[0]!.text = "Змінено";

  assert.equal(compare.afterBlocks[0].content[0]?.text, "Стало");
});

test("createMutationEntry clones spellcheck snapshot state", () => {
  const sourceSpellcheck = {
    results: [
      {
        blockId: "p-1",
        paragraphLabel: "001",
        text: "Текст",
        issues: [
          {
            id: "issue-1",
            ruleId: "rule-1",
            category: "misspelling" as const,
            severity: "error" as const,
            message: "Помилка",
            range: { start: 0, end: 5 },
            badText: "Текст",
            suggestions: [{ value: "Тест" }]
          }
        ]
      }
    ],
    meta: {
      checkedBlockCount: 1,
      issueCount: 1,
      skippedCount: 0,
      errorCount: 0
    },
    summary: "Знайдено 1 проблему у 1 абз.",
    secondarySummary: null,
    invalidatedCount: 0
  };
  const entry = createMutationEntry({
    id: "hist-spell",
    kind: "spellcheck_apply",
    label: "Виправлення правопису",
    timestamp: 1000,
    timestampLabel: "10:00",
    blockIds: ["p-1"],
    before: {
      document: baseDocument,
      selection: { blockIds: ["p-1"], anchorBlockId: "p-1", focusBlockId: "p-1" },
      focusedBlockId: "p-1",
      spellcheck: sourceSpellcheck
    },
    after: {
      document: { version: 2, blocks: [{ id: "p-1", type: "paragraph", content: [{ text: "Тест" }] }] },
      selection: { blockIds: ["p-1"], anchorBlockId: "p-1", focusBlockId: "p-1" },
      focusedBlockId: "p-1"
    }
  });

  if (!entry.before.spellcheck) {
    assert.fail("Expected spellcheck snapshot.");
  }

  sourceSpellcheck.results[0]!.issues[0]!.suggestions[0]!.value = "Змінено";
  sourceSpellcheck.meta.issueCount = 9;

  assert.equal(entry.before.spellcheck.results[0]?.issues[0]?.suggestions[0]?.value, "Тест");
  assert.equal(entry.before.spellcheck.meta?.issueCount, 1);
});
