import test from "node:test";
import assert from "node:assert/strict";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import { createV2Draft, getV2DraftStorageKey, inspectV2Draft, writeV2Draft } from "../lib/v2/draft-storage.ts";
import {
  buildHistoryEntry,
  coerceHistory,
  diffDocuments,
  formatHistoryWhere,
  isWellFormedBlock,
  HISTORY_ENTRY_BLOCK_LIMIT,
  HISTORY_LIMIT,
  pushHistoryEntry,
  trimHistory,
  type V2HistoryEntry,
  type V2HistoryKind
} from "../lib/v2/history.ts";
import { getV2Copy } from "../lib/v2/copy.ts";

const p = (id: string, text: string, bold?: string): Block => {
  if (!bold) {
    return { id, type: "paragraph", content: [{ text }] };
  }

  const start = text.indexOf(bold);
  return {
    id,
    type: "paragraph",
    content: [{ text: text.slice(0, start) }, { text: bold, bold: true as const }, { text: text.slice(start + bold.length) }].filter((node) => node.text)
  };
};

const base: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    p("p-1", "Чим довше ми не спимо, тим більше аденозину."),
    p("p-2", "До вечора ми відчуваемо втому."),
    p("p-3", "Кофеїн є конкурентним антагоністом."),
    p("p-4", "Єдиний механізм — сон.")
  ]
};

const withBlocks = (change: (blocks: Block[]) => Block[]): EditorDocument => ({ version: 2, blocks: change(base.blocks.map((block) => structuredClone(block))) });
const replaceBlock = (id: string, ...next: Block[]) => withBlocks((blocks) => blocks.flatMap((block) => (block.id === id ? next : [block])));
const insertBefore = (id: string, added: Block) => withBlocks((blocks) => blocks.flatMap((block) => (block.id === id ? [added, block] : [block])));
const insertAfter = (id: string, added: Block) => withBlocks((blocks) => blocks.flatMap((block) => (block.id === id ? [block, added] : [block])));

let counter = 0;
const entry = (kind: V2HistoryKind, after: EditorDocument, extra: Partial<Parameters<typeof buildHistoryEntry>[0]> = {}) =>
  buildHistoryEntry({ id: `h-${(counter += 1)}`, kind, at: "2026-10-09T10:00:00.000Z", before: base, after, ...extra });

const whereCopy = getV2Copy("uk").edits;

test("a change between two versions of the manuscript is the blocks that differ, on each side", () => {
  const change = diffDocuments(base, replaceBlock("p-2", p("p-2", "До вечора ми відчуваємо втому.")));

  assert.deepEqual(change.before.map((block) => block.id), ["p-2"]);
  assert.deepEqual(change.after.map((block) => block.id), ["p-2"]);
  assert.deepEqual(diffDocuments(base, structuredClone(base)), { before: [], after: [] });
});

test("an accepted text edit is logged with what was and what became, at its paragraph", () => {
  const logged = entry("replace", replaceBlock("p-3", p("p-3", "Кофеїн займає місце аденозину.")), { source: "clarity" })!;

  assert.equal(logged.kind, "replace");
  assert.equal(logged.source, "clarity");
  assert.deepEqual(logged.where, { type: "paragraphs", first: 3, last: 3 });
  assert.equal(formatHistoryWhere(logged.where, whereCopy), "абз. 3");
  assert.equal(logged.before.length, 1);
  assert.equal(logged.after.length, 1);
  assert.equal(logged.at, "2026-10-09T10:00:00.000Z");
});

test("a rewrite that turns one paragraph into two keeps both new blocks", () => {
  const logged = entry("replace", replaceBlock("p-3", p("p-3", "Кофеїн схожий на аденозин."), p("p-new", "Тому він займає його місце.")))!;

  assert.deepEqual(logged.before.map((block) => block.id), ["p-3"]);
  assert.deepEqual(logged.after.map((block) => block.id), ["p-3", "p-new"]);
});

test("a heading, a callout and an illustration are insertions: nothing before, the new block after, named by the paragraph next to it", () => {
  const heading = entry("heading", insertBefore("p-3", { id: "h-new", type: "heading", level: 2, content: [{ text: "Як кофеїн обманює мозок" }] }), { source: "structure" })!;
  assert.deepEqual(heading.before, []);
  assert.deepEqual(heading.after.map((block) => block.id), ["h-new"]);
  assert.deepEqual(heading.where, { type: "paragraphs", first: 3, last: 3 });

  const callout = entry("callout", insertAfter("p-3", { id: "c-new", type: "callout", kind: "analogy", title: [{ text: "Ключ" }], body: [[{ text: "Аналогія." }]] }))!;
  assert.deepEqual(callout.after.map((block) => block.type), ["callout"]);
  assert.deepEqual(callout.where, { type: "paragraphs", first: 4, last: 4 });

  const figure = entry("visual", insertAfter("p-4", { id: "img-new", type: "image", assetId: "asset-1", alt: "Схема" }))!;
  assert.deepEqual(figure.after.map((block) => block.type), ["image"]);
  // Nothing follows it: it is named by the paragraph before it.
  assert.deepEqual(figure.where, { type: "paragraphs", first: 4, last: 4 });
});

test("an accent and a spelling fix are logged as changes of their paragraph", () => {
  const accent = entry("accent", replaceBlock("p-1", p("p-1", "Чим довше ми не спимо, тим більше аденозину.", "тим більше аденозину")), { source: "accent" })!;
  assert.equal(accent.kind, "accent");
  assert.deepEqual(accent.where, { type: "paragraphs", first: 1, last: 1 });
  assert.equal(JSON.stringify(accent.after).includes('"bold":true'), true);

  const spell = entry("spell", replaceBlock("p-2", p("p-2", "До вечора ми відчуваємо втому.")), { source: "spell" })!;
  assert.equal(spell.kind, "spell");
  assert.deepEqual(spell.where, { type: "paragraphs", first: 2, last: 2 });
});

test("replacing, removing and re-captioning an illustration are logged with the figure on both sides", () => {
  const withFigure = insertAfter("p-3", { id: "img-1", type: "image", assetId: "asset-1", alt: "Схема", caption: [{ text: "Підпис" }] });
  const replaced: EditorDocument = { version: 2, blocks: withFigure.blocks.map((block) => (block.id === "img-1" ? { ...block, assetId: "asset-2" } : block)) as Block[] };
  const captioned: EditorDocument = { version: 2, blocks: withFigure.blocks.map((block) => (block.id === "img-1" ? { ...block, caption: [{ text: "Новий підпис" }] } : block)) as Block[] };

  const replace = buildHistoryEntry({ id: "r", kind: "visualReplace", at: "t", before: withFigure, after: replaced })!;
  assert.deepEqual([replace.before[0]!.type, replace.after[0]!.type], ["image", "image"]);

  const caption = buildHistoryEntry({ id: "c", kind: "caption", at: "t", before: withFigure, after: captioned })!;
  assert.equal(caption.before.length, 1);
  assert.equal(caption.after.length, 1);

  const removed = buildHistoryEntry({ id: "x", kind: "visualRemove", at: "t", before: withFigure, after: base })!;
  assert.deepEqual(removed.before.map((block) => block.id), ["img-1"]);
  assert.deepEqual(removed.after, []);
  assert.deepEqual(removed.where, { type: "paragraphs", first: 4, last: 4 });
});

test("a bulk accept is ONE entry covering every changed paragraph, with its count", () => {
  const after: EditorDocument = {
    version: 2,
    blocks: base.blocks.map((block) => (block.type === "paragraph" && block.id !== "p-3" ? p(block.id, `${block.content[0]!.text} `.trim(), block.content[0]!.text.split(" ")[0]) : block))
  };
  const history = pushHistoryEntry([], entry("bulk", after, { source: "accent", count: 3 })!);

  assert.equal(history.length, 1);
  assert.equal(history[0]!.kind, "bulk");
  assert.equal(history[0]!.count, 3);
  assert.deepEqual(history[0]!.before.map((block) => block.id), ["p-1", "p-2", "p-4"]);
  assert.deepEqual(history[0]!.where, { type: "paragraphs", first: 1, last: 4 });
  assert.equal(formatHistoryWhere(history[0]!.where, whereCopy), "абз. 1–4");
});

test("a global replace is one entry that remembers what was searched and what replaced it", () => {
  const after: EditorDocument = { version: 2, blocks: base.blocks.map((block) => (block.id === "p-1" ? p("p-1", "Чим довше ми не спимо, тим більше АДЕНОЗИНУ.") : block)) };
  const logged = entry("globalReplace", after, { count: 1, find: "аденозину", replacement: "АДЕНОЗИНУ" })!;

  assert.equal(logged.find, "аденозину");
  assert.equal(logged.replacement, "АДЕНОЗИНУ");
  assert.equal(logged.count, 1);
});

test("nothing is logged when the manuscript did not change, so manual typing has no way into the history", () => {
  assert.equal(entry("replace", structuredClone(base)), null);
});

test("the history is capped: the oldest entries go first, by count and by size", () => {
  let history: V2HistoryEntry[] = [];

  for (let index = 0; index < HISTORY_LIMIT + 7; index += 1) {
    history = pushHistoryEntry(history, entry("replace", replaceBlock("p-3", p("p-3", `Варіант ${index}`)))!);
  }

  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(JSON.stringify(history[history.length - 1]!.after).includes(`Варіант ${HISTORY_LIMIT + 6}`), true);
  assert.equal(JSON.stringify(history[0]!.after).includes("Варіант 7"), true);

  const big = entry("replace", replaceBlock("p-3", p("p-3", "щ".repeat(3000))))!;
  const small = trimHistory([big, big, big, big], { chars: 7000 });
  assert.equal(small.length, 2, "as many of the newest as fit the budget");
  assert.equal(trimHistory([big], { chars: 10 }).length, 1, "the newest entry is always kept");
});

test("one entry keeps a bounded number of blocks and says how many it left out", () => {
  const many: EditorDocument = { version: 2, blocks: Array.from({ length: HISTORY_ENTRY_BLOCK_LIMIT + 12 }, (_, index) => p(`q-${index}`, `Абзац ${index}`)) };
  const changed: EditorDocument = { version: 2, blocks: many.blocks.map((block) => p(block.id, "змінено")) };
  const logged = buildHistoryEntry({ id: "b", kind: "bulk", at: "t", before: many, after: changed, count: many.blocks.length })!;

  assert.equal(logged.before.length, HISTORY_ENTRY_BLOCK_LIMIT);
  assert.equal(logged.after.length, HISTORY_ENTRY_BLOCK_LIMIT);
  assert.equal(logged.omitted, 12);
});

test("the history is stored in the v2 draft and read back; damaged entries are left out", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  const history = [entry("replace", replaceBlock("p-3", p("p-3", "Нове")), { source: "clarity" })!, entry("heading", insertBefore("p-3", { id: "h-x", type: "heading", level: 2, content: [{ text: "Т" }] }))!];

  writeV2Draft(storage, "uk", createV2Draft(base, null, null, { history }));
  const read = inspectV2Draft(storage, "uk");
  assert.equal(read.status, "ok");
  assert.deepEqual(read.status === "ok" ? read.draft.history : null, history);

  // A draft without history (saved before it existed) opens with none.
  writeV2Draft(storage, "uk", createV2Draft(base));
  const plain = inspectV2Draft(storage, "uk");
  assert.equal(plain.status === "ok" ? plain.draft.history : "x", undefined);

  const raw = JSON.parse(JSON.stringify(createV2Draft(base, null, null, { history })));
  raw.history = [history[0], { id: "bad" }, "text", { ...history[1], kind: "unknown" }, { ...history[1], before: "no" }];
  store.set(getV2DraftStorageKey("uk"), JSON.stringify(raw));
  const damaged = inspectV2Draft(storage, "uk");
  assert.deepEqual(damaged.status === "ok" ? damaged.draft.history?.map((item) => item.id) : null, [history[0]!.id]);
  assert.deepEqual(coerceHistory("nonsense"), []);
});

test("the place of a change reads in the interface language", () => {
  assert.equal(formatHistoryWhere({ type: "paragraphs", first: 2, last: 2 }, getV2Copy("en").edits), "para. 2");
  assert.equal(formatHistoryWhere({ type: "heading" }, getV2Copy("en").edits), "heading");
  assert.equal(formatHistoryWhere({ type: "block" }, whereCopy), "блок");
});

test("a stored entry with a damaged block is dropped whole, so the history dialog never meets a block it cannot draw", () => {
  const good = entry("replace", replaceBlock("p-3", p("p-3", "Нове")))!;
  const damaged = (blocks: unknown[]) => ({ ...good, id: `bad-${Math.random()}`, after: blocks });

  const read = coerceHistory([
    good,
    damaged([{ id: "t-1", type: "table" }]),
    damaged([{ id: "t-2", type: "table", rows: "x" }]),
    damaged([{ id: "t-3", type: "table", rows: [[[{ text: 1 }]]] }]),
    damaged([{ id: "p-x", type: "paragraph" }]),
    damaged([{ id: "p-y", type: "paragraph", content: [null] }]),
    damaged([{ id: "h-x", type: "heading", level: 7, content: [{ text: "x" }] }]),
    damaged([{ id: "l-x", type: "bullet_list", items: [{ text: "not a list of lists" }] }]),
    damaged([{ id: "c-x", type: "callout", kind: "analogy", title: [{ text: "x" }] }]),
    damaged([{ id: "i-x", type: "image", alt: "no asset" }]),
    damaged([{ id: "", type: "paragraph", content: [{ text: "no id" }] }]),
    damaged([{ id: "u-x", type: "unknown" }]),
    damaged([p("p-ok", "добре"), { id: "t-4", type: "table" }])
  ]);

  assert.deepEqual(read.map((item) => item.id), [good.id]);

  for (const block of [
    p("p", "текст"),
    { id: "h", type: "heading", level: 2, content: [{ text: "Заголовок" }] },
    { id: "l", type: "ordered_list", items: [[{ text: "один" }], []] },
    { id: "i", type: "image", assetId: "a", alt: "" },
    { id: "i2", type: "image", assetId: "a", alt: "", caption: [{ text: "підпис" }] },
    { id: "c", type: "callout", kind: "analogy", title: [], body: [[{ text: "тіло" }]] },
    { id: "d", type: "divider" },
    { id: "t", type: "table", rows: [[[{ text: "клітинка" }], []]] }
  ]) {
    assert.equal(isWellFormedBlock(block), true, block.type);
  }
});
