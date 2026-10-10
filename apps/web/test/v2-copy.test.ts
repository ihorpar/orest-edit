import test from "node:test";
import assert from "node:assert/strict";

import { formatManuscriptStats, formatV2Date, getV2Copy, pluralizeUk } from "../lib/v2/copy.ts";
import { pluralizeEn } from "../lib/v2/copy-en.ts";
import { getV2DraftStorageKey } from "../lib/v2/draft-storage.ts";

type Shape = string | { [key: string]: Shape } | Shape[];

/** The shape of a catalog: key paths with the kind of value at each, without the values themselves. */
function shapeOf(value: unknown): Shape {
  if (Array.isArray(value)) {
    return value.map(shapeOf);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, shapeOf((value as Record<string, unknown>)[key])])
    );
  }

  return typeof value === "function" ? `function/${(value as (...args: unknown[]) => unknown).length}` : typeof value;
}

/** Every string a catalog can show: plain strings, and what each function returns for sample arguments. */
function collectStrings(value: unknown, path: string, into: Array<{ path: string; text: string }>) {
  if (typeof value === "string") {
    into.push({ path, text: value });
    return;
  }

  if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;

    for (const sample of [
      [1, 1],
      [2, 3],
      [5, 12],
      [0, 0],
      ["слово", "інше"]
    ]) {
      let result: unknown;

      try {
        result = fn(...sample.slice(0, Math.max(fn.length, 1)));
      } catch {
        // A sample of the wrong type for this function (a number where a label is expected).
        continue;
      }

      if (typeof result === "string") {
        into.push({ path: `${path}(${sample.join(",")})`, text: result });
      }
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStrings(entry, `${path}[${index}]`, into));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectStrings(entry, path ? `${path}.${key}` : key, into);
    }
  }
}

const uk = getV2Copy("uk");
const en = getV2Copy("en");

test("the Ukrainian and English catalogs have exactly the same keys, lists of the same length and functions of the same arity", () => {
  assert.deepEqual(shapeOf(en), shapeOf(uk));
});

test("no string of either catalog is empty, also the ones functions build", () => {
  for (const [locale, catalog] of [["uk", uk], ["en", en]] as const) {
    const strings: Array<{ path: string; text: string }> = [];
    collectStrings(catalog, "", strings);

    assert.ok(strings.length > 400, `${locale}: the whole catalog was walked (${strings.length})`);

    // The date of a report may be absent; `reportMeta` then shows the mode alone.
    const emptyOnes = strings.filter((entry) => entry.text.trim().length === 0).map((entry) => entry.path);
    assert.deepEqual(emptyOnes, [], `${locale}: empty strings`);
    assert.deepEqual(strings.filter((entry) => /undefined|NaN|\[object/.test(entry.text)).map((entry) => entry.path), [], `${locale}: broken interpolation`);
  }
});

test("the English catalog is English and the Ukrainian one Ukrainian", () => {
  const cyrillic = /[А-Яа-яІіЇїЄєҐґ]/;
  const strings: Array<{ path: string; text: string }> = [];
  // Sample arguments are Ukrainian words on purpose; only plain strings are judged here.
  collectStrings(JSON.parse(JSON.stringify(en)), "", strings);

  assert.deepEqual(strings.filter((entry) => cyrillic.test(entry.text)).map((entry) => entry.path), []);
  assert.equal(cyrillic.test(uk.tabs.edits), true);
  assert.deepEqual([en.tabs.overview, en.tabs.edits, en.tabs.ask], ["Overview", "Edits", "Request"]);
  assert.deepEqual(
    en.edits.passList.map((pass) => pass.id),
    uk.edits.passList.map((pass) => pass.id),
    "the pass rows are the same passes in the same order"
  );
});

test("the unknown locale falls back to Ukrainian, as the app does", () => {
  assert.equal(getV2Copy("xx" as never), uk);
});

test("plural forms follow each language", () => {
  assert.equal(pluralizeUk(1, "слово", "слова", "слів"), "слово");
  assert.equal(pluralizeUk(3, "слово", "слова", "слів"), "слова");
  assert.equal(pluralizeUk(5, "слово", "слова", "слів"), "слів");
  assert.equal(pluralizeUk(11, "слово", "слова", "слів"), "слів");
  assert.equal(pluralizeUk(21, "слово", "слова", "слів"), "слово");
  assert.equal(pluralizeUk(112, "слово", "слова", "слів"), "слів");
  assert.equal(pluralizeEn(1, "word", "words"), "word");
  assert.equal(pluralizeEn(0, "word", "words"), "words");
  assert.equal(pluralizeEn(21, "word", "words"), "words");

  assert.equal(formatManuscriptStats(1, 1, "uk"), "1 слово · 1 абзац");
  assert.equal(formatManuscriptStats(172, 6, "uk"), "172 слова · 6 абзаців");
  assert.equal(formatManuscriptStats(1, 1, "en"), "1 word · 1 paragraph");
  assert.equal(formatManuscriptStats(172, 6, "en"), "172 words · 6 paragraphs");
  assert.equal(uk.overview.factCount(2), "2 знахідки");
  assert.equal(en.overview.factCount(2), "2 findings");
  assert.equal(en.overview.factCount(1), "1 finding");
  assert.equal(uk.replace.count(5), "5 збігів");
  assert.equal(en.replace.count(1), "1 match");
  assert.equal(uk.historyPanel.count(22), "22 зміни");
  assert.equal(en.ask.outcomeDone(0), "The model proposed no edits");
  assert.equal(en.ask.outcomeDone(3), "3 edits");
});

test("dates are written in the interface language", () => {
  const at = "2026-10-09T14:05:00";

  assert.match(formatV2Date(at, "uk"), /9 жовтня/);
  assert.match(formatV2Date(at, "en"), /October 9/);
  assert.match(formatV2Date(at, "en", "short"), /Oct 9/);
  assert.match(formatV2Date(at, "uk", "short"), /9 жовт/);
  assert.equal(formatV2Date("not a date", "en"), "");
  assert.equal(formatV2Date(undefined, "uk"), "");
  assert.equal(uk.dateLocale, "uk-UA");
  assert.equal(en.dateLocale, "en-US");
});

test("each language has its own draft", () => {
  assert.equal(getV2DraftStorageKey("uk"), "orest-v2-draft-uk-v1");
  assert.equal(getV2DraftStorageKey("en"), "orest-v2-draft-en-v1");
});

test("the hotkeys popup lists the real shortcuts in both languages", () => {
  for (const catalog of [uk, en]) {
    const keys = catalog.hotkeys.groups.flatMap((group) => group.items.map((item) => item.keys));

    for (const expected of ["Ctrl+B", "Ctrl+I", "Ctrl+Z", "Ctrl+H", "Shift+Enter", "Alt+F10", "F6", "Ctrl+/", "Enter", "Backspace / Delete", "Esc", "Tab"]) {
      assert.ok(keys.includes(expected), `${expected} is listed`);
    }
  }
});
