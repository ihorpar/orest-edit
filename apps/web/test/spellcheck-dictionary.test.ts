import assert from "node:assert/strict";
import test from "node:test";

import {
  createSpellcheckDictionarySet,
  filterSpellcheckIssuesByDictionary,
  isSpellcheckWordInDictionary,
  normalizeSpellcheckDictionaryWord
} from "../lib/editor/spellcheck-dictionary.ts";

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
