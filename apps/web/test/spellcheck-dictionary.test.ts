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

const ukFood = "\u0407\u0436\u0430";
const ukIodine = "\u0439\u043e\u0434";
const ukIodineUpper = "\u0419\u041e\u0414";
const ukHormone = "\u0433\u043e\u0440\u043c\u043e\u043d";
const ukHormoneTitle = "\u0413\u043e\u0440\u043c\u043e\u043d";
const ukPulse = "\u041f\u0443\u043b\u044c\u0441";
const ukMagnesium = "\u043c\u0430\u0433\u043d\u0456\u0439";

test("normalizeSpellcheckDictionaryWord trims and lowercases ukrainian words", () => {
  assert.equal(normalizeSpellcheckDictionaryWord(`  ${ukFood}  `), ukFood.toLocaleLowerCase("uk-UA"));
});

test("createSpellcheckDictionarySet deduplicates normalized entries", () => {
  const dictionary = createSpellcheckDictionarySet([` ${ukIodine} `, ukIodine, ukIodineUpper]);

  assert.deepEqual(Array.from(dictionary), [ukIodine]);
});

test("isSpellcheckWordInDictionary matches case-insensitively", () => {
  assert.equal(isSpellcheckWordInDictionary(ukHormoneTitle, [ukHormone]), true);
  assert.equal(isSpellcheckWordInDictionary(ukPulse, [ukHormone]), false);
});

test("filterSpellcheckIssuesByDictionary removes matching issues only", () => {
  const issues = [
    { id: "1", badText: ukIodineUpper },
    { id: "2", badText: ukMagnesium }
  ];

  assert.deepEqual(filterSpellcheckIssuesByDictionary(issues, [ukIodine]), [{ id: "2", badText: ukMagnesium }]);
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
    await addSpellcheckDictionaryWord(` ${ukIodineUpper} `);
    await addSpellcheckDictionaryWord(ukIodine);
    await addSpellcheckDictionaryWord(" ");

    const words = await readSpellcheckDictionaryWords();
    assert.deepEqual(words, [ukIodine]);
  });
});

test("spellcheck dictionaries are isolated by product locale", async () => {
  await withIndexedDbWindow(async () => {
    await addSpellcheckDictionaryWord(" Iodine ", "uk");
    await addSpellcheckDictionaryWord(" Hormone ", "en");

    assert.deepEqual(await readSpellcheckDictionaryWords("uk"), ["iodine"]);
    assert.deepEqual(await readSpellcheckDictionaryWords("en"), ["hormone"]);
  });
});

test("english dictionary helpers use english lowercasing", () => {
  assert.equal(normalizeSpellcheckDictionaryWord("  Hormone  ", "en"), "hormone");
  assert.equal(isSpellcheckWordInDictionary("HORMONE", ["hormone"], "en"), true);
});
