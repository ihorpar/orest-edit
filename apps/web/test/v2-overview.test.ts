import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorialFactCheckRow } from "../lib/editor/review-contract.ts";
import { getItemKind } from "../lib/v2/item-kinds.ts";
import {
  addAuthorQuery,
  AUTHOR_QUERY_NOTE_MAX_LENGTH,
  buildFactCheck,
  coerceOverviewState,
  createAuthorQuery,
  createInitialOverviewState,
  FACT_CHECK_MAX_LINKED_ITEMS,
  formatAuthorQueriesText,
  hasAuthorQuery,
  isSafeSourceUrl,
  normalizeFactCheckRows,
  removeAuthorQuery,
  resolveFactCheckBlock,
  setAuthorQueryNote,
  type V2AuthorQuery,
  type V2FactFinding
} from "../lib/v2/overview.ts";

const document: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    { id: "p-1", type: "paragraph", content: [{ text: "Аденозин накопичується в мозку протягом дня і створює тиск сну." }] },
    { id: "p-2", type: "paragraph", content: [{ text: "Кофеїн повністю виводиться з організму за дві години після чашки кави." }] },
    { id: "p-3", type: "paragraph", content: [{ text: "Вечірня кава скорочує глибокий сон навіть тоді, коли людина засинає швидко." }] }
  ]
};
const revision = deriveManuscriptRevisionState(document);

const source = (domain: string) => ({ title: `Стаття на ${domain}`, url: `https://${domain}/article`, domain });

const rows: EditorialFactCheckRow[] = [
  { claim: "Аденозин накопичується протягом дня", status: "ok", explanation: "Підтверджено.", sources: [source("nih.gov")] },
  {
    claim: "Кофеїн повністю виводиться з організму за дві години",
    status: "questionable",
    explanation: "Період напіввиведення кофеїну — близько п’яти годин.",
    sources: [source("nih.gov"), source("sleepfoundation.org")]
  },
  { claim: "Вечірня кава скорочує глибокий сон на сорок відсотків", status: "unsupported", explanation: "Такої цифри в джерелах немає.", sources: [] },
  { claim: "Шоколад лікує безсоння у дельфінів", status: "questionable", explanation: "Цього в тексті немає.", sources: [] }
];

const build = (input: EditorialFactCheckRow[] = rows) =>
  buildFactCheck({
    rows: input,
    document,
    revision,
    reviewSessionId: "session-fact",
    stepRunId: "step-fact",
    locale: "uk",
    createItemId: (index) => `fact-item-${index + 1}`
  });

/* ---------- rows ---------- */

test("fact-check rows are read defensively: no claim, an unknown status or an unsafe link never gets through", () => {
  const normalized = normalizeFactCheckRows([
    null,
    "рядок",
    { claim: "  ", status: "questionable", explanation: "порожнє твердження", sources: [] },
    { claim: "Без статусу", status: "maybe", explanation: "", sources: [] },
    {
      claim: "  Кофеїн виводиться за дві години  ",
      status: "questionable",
      explanation: "  Ні.  ",
      sources: [
        { title: "НІЗ", url: "https://www.nih.gov/caffeine", domain: "" },
        { title: "Повтор", url: "https://www.nih.gov/caffeine", domain: "nih.gov" },
        { title: "Скрипт", url: "javascript:alert(1)", domain: "evil" },
        { title: "Без адреси" },
        "not-an-object"
      ]
    },
    { claim: "Без джерел", status: "unsupported" }
  ]);

  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], {
    claim: "Кофеїн виводиться за дві години",
    status: "questionable",
    explanation: "Ні.",
    sources: [{ title: "НІЗ", url: "https://www.nih.gov/caffeine", domain: "nih.gov" }]
  });
  assert.deepEqual(normalized[1], { claim: "Без джерел", status: "unsupported", explanation: "", sources: [] });
  assert.deepEqual(normalizeFactCheckRows(undefined), []);
  assert.deepEqual(normalizeFactCheckRows({ rows: [] }), []);
});

test("only plain http(s) addresses may become links", () => {
  assert.equal(isSafeSourceUrl("https://example.org/a"), true);
  assert.equal(isSafeSourceUrl("http://example.org"), true);
  assert.equal(isSafeSourceUrl("javascript:alert(1)"), false);
  assert.equal(isSafeSourceUrl("data:text/html,hi"), false);
  assert.equal(isSafeSourceUrl("example.org"), false);
});

/* ---------- findings and linked suggestions ---------- */

test("a claim is located in the paragraph that shares its words, or nowhere", () => {
  assert.equal(resolveFactCheckBlock(document, revision, rows[1]!.claim)?.blockId, "p-2");
  assert.equal(resolveFactCheckBlock(document, revision, rows[2]!.claim)?.blockId, "p-3");
  assert.equal(resolveFactCheckBlock(document, revision, rows[3]!.claim), null);
  assert.equal(resolveFactCheckBlock(document, revision, "і та що"), null);
});

test("`ok` rows are dropped; each flagged claim is a finding linked to a suggestion where the text allows", () => {
  const { findings, items } = build();

  assert.deepEqual(
    findings.map((finding) => [finding.status, finding.blockId, finding.itemId]),
    [
      ["questionable", "p-2", "fact-item-2"],
      ["unsupported", "p-3", "fact-item-3"],
      // Not found in the manuscript: still a finding (it can go to the author), but there is nothing to edit.
      ["questionable", null, null]
    ]
  );
  assert.equal(new Set(findings.map((finding) => finding.id)).size, 3);
  assert.equal(findings[0]!.sources.length, 2);
  assert.equal(items.length, 2);
});

test("a sourced doubtful claim becomes a local rewrite; an unsupported or unsourced one a `Міф / Правда` callout", () => {
  const { items } = build();
  const [rewrite, callout] = items;

  assert.equal(rewrite!.recommendationType, "rewrite");
  assert.equal(rewrite!.suggestedAction, "rewrite_text");
  assert.equal(rewrite!.insertionPoint.mode, "replace");
  assert.equal(rewrite!.priority, "medium");
  assert.equal(getItemKind(rewrite!), "replace");
  assert.match(rewrite!.reason, /Період напіввиведення/);
  assert.match(rewrite!.reason, /nih\.gov, sleepfoundation\.org/);

  assert.equal(callout!.recommendationType, "callout");
  assert.equal(callout!.suggestedAction, "prepare_callout");
  assert.equal(callout!.calloutKind, "myths_vs_truth");
  assert.equal(callout!.calloutDepth, "brief");
  assert.equal(callout!.insertionPoint.mode, "after");
  assert.equal(callout!.priority, "high");
  assert.equal(getItemKind(callout!), "callout");

  for (const item of items) {
    assert.equal(item.stepId, "fact_check");
    assert.equal(item.stepRunId, "step-fact");
    assert.equal(item.status, "pending");
    assert.equal(item.documentRevisionId, revision.documentRevisionId);
    assert.equal(item.anchor.fingerprint, computeAnchorFingerprint(document, item.anchor.blockIds));
    assert.ok(item.reason.trim().length > 0, "every suggestion carries a reason");
  }
});

test("a questionable claim without any source is a callout, as in the classic editor", () => {
  const { items } = build([{ claim: rows[1]!.claim, status: "questionable", explanation: "Сумнівно.", sources: [] }]);
  assert.equal(items[0]!.recommendationType, "callout");
});

test("an empty result is a valid result: no findings, no suggestions", () => {
  assert.deepEqual(build([]), { findings: [], items: [] });
  assert.deepEqual(build([rows[0]!]), { findings: [], items: [] });
});

test("no more linked suggestions are made than the classic editor makes; the rest stay findings", () => {
  const many = Array.from({ length: FACT_CHECK_MAX_LINKED_ITEMS + 3 }, (_, index): EditorialFactCheckRow => ({
    claim: `${rows[1]!.claim} (${index})`,
    status: "questionable",
    explanation: "Сумнівно.",
    sources: [source("nih.gov")]
  }));
  const { findings, items } = build(many);

  assert.equal(items.length, FACT_CHECK_MAX_LINKED_ITEMS);
  assert.equal(findings.length, many.length);
  assert.equal(findings.filter((finding) => finding.itemId === null).length, 3);
});

/* ---------- questions for the author ---------- */

const finding = (overrides: Partial<V2FactFinding> = {}): V2FactFinding => ({ ...build().findings[0]!, ...overrides });

test("a finding is added to the author queries once; the same claim is never listed twice", () => {
  const first = createAuthorQuery(finding(), "2026-10-10T10:00:00.000Z", "q-1");
  let queries = addAuthorQuery([], first);

  assert.equal(queries.length, 1);
  assert.equal(queries[0]!.note, "");
  assert.equal(queries[0]!.blockId, "p-2");
  assert.equal(hasAuthorQuery(queries, finding()), true);

  // The same finding again, and the same claim from a later run under another id.
  assert.equal(addAuthorQuery(queries, createAuthorQuery(finding(), "2026-10-10T10:01:00.000Z", "q-2")), queries);
  assert.equal(addAuthorQuery(queries, createAuthorQuery(finding({ id: "fact-other-run" }), "2026-10-10T10:02:00.000Z", "q-3")), queries);

  queries = addAuthorQuery(queries, createAuthorQuery(build().findings[1]!, "2026-10-10T10:03:00.000Z", "q-4"));
  assert.deepEqual(queries.map((query) => query.id), ["q-1", "q-4"]);
});

test("a note is the editor's own text, capped; removing a query leaves the others", () => {
  const queries = [createAuthorQuery(build().findings[0]!, "t", "q-1"), createAuthorQuery(build().findings[1]!, "t", "q-2")];
  const noted = setAuthorQueryNote(queries, "q-2", "Звідки цифра?");

  assert.equal(noted[1]!.note, "Звідки цифра?");
  assert.equal(noted[0], queries[0]);
  assert.equal(setAuthorQueryNote(noted, "q-2", "Звідки цифра?"), noted, "an unchanged note changes nothing");
  assert.equal(setAuthorQueryNote(noted, "missing", "x"), noted);
  assert.equal(setAuthorQueryNote(queries, "q-1", "я".repeat(AUTHOR_QUERY_NOTE_MAX_LENGTH + 50))[0]!.note.length, AUTHOR_QUERY_NOTE_MAX_LENGTH);

  assert.deepEqual(removeAuthorQuery(noted, "q-1").map((query) => query.id), ["q-2"]);
  assert.equal(removeAuthorQuery(noted, "missing"), noted);
});

test("the copied text is a numbered list ready for a letter: claim, paragraph, note, reason, sources", () => {
  const queries: V2AuthorQuery[] = [
    { ...createAuthorQuery(build().findings[0]!, "t", "q-1"), note: "  Уточніть, будь ласка, джерело.  " },
    createAuthorQuery(build().findings[1]!, "t", "q-2"),
    createAuthorQuery(build().findings[2]!, "t", "q-3")
  ];
  const text = formatAuthorQueriesText(queries, {
    chapterTitle: "Чому кава не замінює сон",
    where: (query) => (query.blockId === "p-2" ? "абз. 2" : query.blockId === "p-3" ? "абз. 3" : null),
    copy: {
      heading: (title) => `Запити до автора — «${title}»`,
      note: "Коментар редактора",
      why: "Чому виникло питання",
      sources: "Джерела",
      noSource: "Надійного джерела не знайдено"
    }
  });

  assert.equal(
    text,
    [
      "Запити до автора — «Чому кава не замінює сон»",
      "",
      "1. «Кофеїн повністю виводиться з організму за дві години» (абз. 2)",
      "   Коментар редактора: Уточніть, будь ласка, джерело.",
      "   Чому виникло питання: Період напіввиведення кофеїну — близько п’яти годин.",
      "   Джерела: https://nih.gov/article; https://sleepfoundation.org/article",
      "",
      "2. «Вечірня кава скорочує глибокий сон на сорок відсотків» (абз. 3)",
      "   Чому виникло питання: Такої цифри в джерелах немає.",
      "   Надійного джерела не знайдено",
      "",
      "3. «Шоколад лікує безсоння у дельфінів»",
      "   Чому виникло питання: Цього в тексті немає.",
      "   Надійного джерела не знайдено"
    ].join("\n")
  );
});

/* ---------- persistence ---------- */

test("the overview survives a JSON round-trip and is read back field by field", () => {
  const { findings } = build();
  const state = {
    diagnosticsMode: "extended" as const,
    diagnostics: { text: "## Головний діагноз\n\nТекст.", at: "2026-10-10T10:00:00.000Z", mode: "extended" as const },
    factCheck: { findings, at: "2026-10-10T11:00:00.000Z", checkedCount: 4 },
    authorQueries: [{ ...createAuthorQuery(findings[0]!, "2026-10-10T11:05:00.000Z", "q-1"), note: "Звідки це?" }]
  };

  assert.deepEqual(coerceOverviewState(JSON.parse(JSON.stringify(state))), state);
});

test("a draft without an overview, or with a damaged one, opens with an empty overview", () => {
  assert.deepEqual(coerceOverviewState(undefined), createInitialOverviewState());
  assert.deepEqual(coerceOverviewState("garbage"), createInitialOverviewState());

  const damaged = coerceOverviewState({
    diagnosticsMode: "huge",
    diagnostics: { text: "   ", at: 5 },
    factCheck: {
      findings: [
        { id: "f-1", claim: "Твердження", status: "questionable", sources: [{ url: "javascript:1", title: "x" }, { url: "https://a.org/x" }] },
        { id: "f-2", claim: "Без статусу" },
        { claim: "Без id", status: "unsupported" },
        null
      ],
      checkedCount: -3
    },
    authorQueries: [{ id: "q-1", claim: "Питання", note: 42 }, { id: "q-2" }, "x"]
  });

  assert.equal(damaged.diagnosticsMode, "concise");
  assert.equal(damaged.diagnostics, null, "an empty report is not kept as a report");
  assert.deepEqual(damaged.factCheck?.findings, [
    {
      id: "f-1",
      claim: "Твердження",
      status: "questionable",
      explanation: "",
      sources: [{ title: "a.org", url: "https://a.org/x", domain: "a.org" }],
      blockId: null,
      itemId: null
    }
  ]);
  assert.equal(damaged.factCheck?.checkedCount, 1);
  assert.deepEqual(damaged.authorQueries.map((query) => [query.id, query.note, query.status]), [["q-1", "", "questionable"]]);
});
