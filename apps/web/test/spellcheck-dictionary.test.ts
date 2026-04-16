import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";

import {
  addSpellcheckDictionaryWord,
  createSpellcheckDictionarySet,
  filterSpellcheckIssuesByDictionary,
  isSpellcheckWordInDictionary,
  normalizeSpellcheckDictionaryWord,
  readSpellcheckDictionaryWords
} from "../lib/editor/spellcheck-dictionary.ts";

async function withIndexedDbWindow(run: () => Promise<void>) {
  const originalWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      indexedDB: new IDBFactory()
    }
  });

  try {
    await run();
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  }
}

test("normalizeSpellcheckDictionaryWord trims and lowercases ukrainian words", () => {
  assert.equal(normalizeSpellcheckDictionaryWord("  Їжа  "), "їжа");
});

test("createSpellcheckDictionarySet deduplicates normalized entries", () => {
  const dictionary = createSpellcheckDictionarySet([" Йод ", "йод", "ЙОД"]);

  assert.deepEqual(Array.from(dictionary), ["йод"]);
});

test("isSpellcheckWordInDictionary matches case-insensitively", () => {
  assert.equal(isSpellcheckWordInDictionary("Гормон", ["гормон"]), true);
  assert.equal(isSpellcheckWordInDictionary("Пульс", ["гормон"]), false);
});

test("filterSpellcheckIssuesByDictionary removes matching issues only", () => {
  const issues = [
    { id: "1", badText: "Йод" },
    { id: "2", badText: "магній" }
  ];

  assert.deepEqual(filterSpellcheckIssuesByDictionary(issues, ["йод"]), [{ id: "2", badText: "магній" }]);
});

test("readSpellcheckDictionaryWords returns an empty list when IndexedDB is unavailable", async () => {
  const originalWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: undefined
  });

  try {
    assert.deepEqual(await readSpellcheckDictionaryWords(), []);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  }
});

test("addSpellcheckDictionaryWord persists normalized words and readSpellcheckDictionaryWords deduplicates them", async () => {
  await withIndexedDbWindow(async () => {
    await addSpellcheckDictionaryWord(" Йод ");
    await addSpellcheckDictionaryWord("йод");
    await addSpellcheckDictionaryWord(" ");

    const words = await readSpellcheckDictionaryWords();
    assert.deepEqual(words, ["йод"]);
  });
});
