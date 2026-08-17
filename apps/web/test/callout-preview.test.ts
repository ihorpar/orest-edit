import test from "node:test";
import assert from "node:assert/strict";
import { getInlineText } from "../lib/editor/document-model.ts";
import { isCalloutSectionHeadingText, splitCalloutDraftIntoParagraphs } from "../lib/editor/callout-preview.ts";

function flattenParagraphs(paragraphs: ReturnType<typeof splitCalloutDraftIntoParagraphs>) {
  return paragraphs.map((paragraph) => paragraph.map((node) => ({ text: node.text, ...(node.bold ? { bold: true as const } : {}) })));
}

test("splitCalloutDraftIntoParagraphs preserves standalone section labels as separate bold paragraphs", () => {
  const paragraphs = splitCalloutDraftIntoParagraphs(
    [
      "Прихована загроза",
      "Порушення ліпідного обміну починається з невидимих змін у складі крові.",
      "",
      "Ключові наслідки",
      "1. Виникнення дисліпідемії змінює склад крові.",
      "2. Поступове накопичення ліпідів стає основою для атеросклерозу.",
      "",
      "Чому це важливо",
      "Статистика свідчить, що кожен другий дорослий перебуває в групі ризику."
    ].join("\n"),
    "mechanism"
  );

  assert.deepEqual(flattenParagraphs(paragraphs), [
    [{ text: "Прихована загроза", bold: true }],
    [{ text: "Порушення ліпідного обміну починається з невидимих змін у складі крові." }],
    [{ text: "Ключові наслідки", bold: true }],
    [{ text: "1. Виникнення дисліпідемії змінює склад крові." }],
    [{ text: "2. Поступове накопичення ліпідів стає основою для атеросклерозу." }],
    [{ text: "Чому це важливо", bold: true }],
    [{ text: "Статистика свідчить, що кожен другий дорослий перебуває в групі ризику." }]
  ]);
});

test("splitCalloutDraftIntoParagraphs keeps already-bold section labels intact", () => {
  const paragraphs = splitCalloutDraftIntoParagraphs(
    [
      "**Що відбувається.**",
      "З віком накопичуються сенесцентні клітини."
    ].join("\n"),
    "mechanism"
  );

  assert.equal(getInlineText(paragraphs[0]), "Що відбувається.");
  assert.equal(paragraphs[0]?.every((node) => node.bold), true);
  assert.equal(getInlineText(paragraphs[1]), "З віком накопичуються сенесцентні клітини.");
});

test("splitCalloutDraftIntoParagraphs splits a short warning label and consecutive finished prose", () => {
  const paragraphs = splitCalloutDraftIntoParagraphs(
    [
      "Важливе застереження",
      "Для більшості описаних методів епігенетичний вік лишається оцінкою.",
      "Результати досліджень на гризунах не можна прямо переносити на людей."
    ].join("\n"),
    "mechanism"
  );

  assert.deepEqual(flattenParagraphs(paragraphs), [
    [{ text: "Важливе застереження", bold: true }],
    [{ text: "Для більшості описаних методів епігенетичний вік лишається оцінкою." }],
    [{ text: "Результати досліджень на гризунах не можна прямо переносити на людей." }]
  ]);
});

test("splitCalloutDraftIntoParagraphs still joins wrapped lines that continue in lowercase", () => {
  const paragraphs = splitCalloutDraftIntoParagraphs(
    [
      "Порушення ліпідного обміну починається з невидимих змін",
      "у складі крові під час тривалого запалення."
    ].join("\n"),
    "mechanism"
  );

  assert.deepEqual(flattenParagraphs(paragraphs), [
    [{ text: "Порушення ліпідного обміну починається з невидимих змін у складі крові під час тривалого запалення." }]
  ]);
});

test("isCalloutSectionHeadingText stays focused on short section labels", () => {
  assert.equal(isCalloutSectionHeadingText("Чому це важливо"), true);
  assert.equal(isCalloutSectionHeadingText("**Ключові наслідки**"), true);
  assert.equal(
    isCalloutSectionHeadingText("Порушення ліпідного обміну починається з невидимих змін у складі крові."),
    false
  );
});
