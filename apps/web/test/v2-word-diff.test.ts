import test from "node:test";
import assert from "node:assert/strict";

import type { Block } from "../lib/editor/document-model.ts";
import {
  coalesceRewrittenSentences,
  diffProposalBlocks,
  diffWords,
  hasBlockDiffChanges,
  hasDiffChanges,
  tokenizeForDiff,
  type DiffSegment
} from "../lib/v2/word-diff.ts";

const oldSide = (segments: DiffSegment[]) => segments.filter((segment) => segment.kind !== "insert").map((segment) => segment.text).join("");
const newSide = (segments: DiffSegment[]) => segments.filter((segment) => segment.kind !== "delete").map((segment) => segment.text).join("");
const p = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });

function assertRebuilds(oldText: string, newText: string): DiffSegment[] {
  const segments = diffWords(oldText, newText);
  assert.equal(oldSide(segments), oldText, "equal + delete segments rebuild the old text");
  assert.equal(newSide(segments), newText, "equal + insert segments rebuild the new text");
  return segments;
}

test("identical text is one equal segment and counts as unchanged", () => {
  const segments = diffWords("Кава не замінює сон.", "Кава не замінює сон.");
  assert.deepEqual(segments, [{ kind: "equal", text: "Кава не замінює сон." }]);
  assert.equal(hasDiffChanges(segments), false);
  assert.deepEqual(diffWords("", ""), []);
});

test("tokens keep Ukrainian words with apostrophes and hyphens whole, punctuation apart", () => {
  assert.deepEqual(tokenizeForDiff("зв’язується з A2A — кофеїн-антагоніст, так?"), [
    "зв’язується", " ", "з", " ", "A2A", " ", "—", " ", "кофеїн-антагоніст", ",", " ", "так", "?"
  ]);
});

test("a single replaced Ukrainian word is one delete and one insert", () => {
  const segments = assertRebuilds("ми відчуваемо сонливість", "ми відчуваємо сонливість");
  assert.deepEqual(segments, [
    { kind: "equal", text: "ми " },
    { kind: "delete", text: "відчуваемо" },
    { kind: "insert", text: "відчуваємо" },
    { kind: "equal", text: " сонливість" }
  ]);
});

test("neighbouring changed words read as one phrase, not as words sharing a space", () => {
  const segments = assertRebuilds("Єдиний фізіологічний механізм елімінації аденозину — це сон.", "Єдиний спосіб позбутися аденозину — це сон.");
  assert.deepEqual(segments, [
    { kind: "equal", text: "Єдиний " },
    { kind: "delete", text: "фізіологічний механізм елімінації" },
    { kind: "insert", text: "спосіб позбутися" },
    { kind: "equal", text: " аденозину — це сон." }
  ]);
});

test("punctuation changes are isolated from the words around them", () => {
  const segments = assertRebuilds("Втома не зникає, мозок її не помічає.", "Втома не зникає: мозок її не помічає!");
  assert.deepEqual(
    segments.filter((segment) => segment.kind !== "equal"),
    [
      { kind: "delete", text: "," },
      { kind: "insert", text: ":" },
      { kind: "delete", text: "." },
      { kind: "insert", text: "!" }
    ]
  );
});

test("pure insertions and pure deletions", () => {
  assert.deepEqual(assertRebuilds("Кава бадьорить.", "Кава ненадовго бадьорить."), [
    { kind: "equal", text: "Кава " },
    { kind: "insert", text: "ненадовго " },
    { kind: "equal", text: "бадьорить." }
  ]);
  assert.deepEqual(assertRebuilds("Кава дуже сильно бадьорить.", "Кава бадьорить."), [
    { kind: "equal", text: "Кава " },
    { kind: "delete", text: "дуже сильно " },
    { kind: "equal", text: "бадьорить." }
  ]);
  assert.deepEqual(diffWords("", "Новий текст"), [{ kind: "insert", text: "Новий текст" }]);
  assert.deepEqual(diffWords("Старий текст", ""), [{ kind: "delete", text: "Старий текст" }]);
});

test("a full rewrite of a long sentence still rebuilds both sides, soft breaks included", () => {
  assertRebuilds(
    "Протягом періоду неспання в позаклітинному просторі базальних відділів переднього мозку відбувається прогресивна акумуляція аденозину — нуклеозиду, що утворюється внаслідок гідролізу аденозинтрифосфату.\nЧим довше ми не спимо, тим більше його накопичується.",
    "Поки ми не спимо, у мозку поступово накопичується аденозин — речовина, що залишається, коли клітини витрачають енергію.\nЧим довше ми не спимо, тим більше його накопичується."
  );
});

test("multi-block proposals are paired by position and keep the anchored ids", () => {
  const diffs = diffProposalBlocks(
    ["p-1", "p-2"],
    [p("p-1", "Перший абзац лишається."), p("p-2", "Другий абзац є складним.")],
    [p("x", "Перший абзац лишається."), p("y", "Другий абзац простий.")]
  );

  assert.equal(diffs.length, 2);
  assert.deepEqual(diffs.map((diff) => (diff.kind === "add" ? diff.afterBlockId : diff.blockId)), ["p-1", "p-2"]);
  assert.equal(diffs[0]!.kind === "text" && diffs[0]!.changed, false);
  assert.equal(diffs[1]!.kind === "text" && diffs[1]!.changed, true);
  assert.equal(hasBlockDiffChanges(diffs), true);
  assert.equal(hasBlockDiffChanges([diffs[0]!]), false);
});

test("fewer, more and reshaped blocks become remove, add and replace", () => {
  const list: Block = { id: "l", type: "bullet_list", items: [[{ text: "раз" }], [{ text: "два" }]] };

  assert.deepEqual(
    diffProposalBlocks(["p-1", "p-2"], [p("p-1", "А."), p("p-2", "Б.")], [p("p-1", "А і Б.")]).map((diff) => diff.kind),
    ["text", "remove"]
  );

  const more = diffProposalBlocks(["p-1"], [p("p-1", "А. Б.")], [p("p-1", "А."), p("n", "Б.")]);
  assert.deepEqual(more.map((diff) => diff.kind), ["text", "add"]);
  assert.equal(more[1]!.kind === "add" && more[1]!.afterBlockId, "p-1");

  const reshaped = diffProposalBlocks(["p-1"], [p("p-1", "раз, два")], [list]);
  assert.deepEqual(reshaped, [{ kind: "replace", blockId: "p-1", newBlock: list }]);
});

test("a heading that changes level is a block replacement, not a word diff", () => {
  const diffs = diffProposalBlocks(
    ["h-1"],
    [{ id: "h-1", type: "heading", level: 2, content: [{ text: "Тиск сну" }] }],
    [{ id: "h-1", type: "heading", level: 3, content: [{ text: "Тиск сну" }] }]
  );
  assert.equal(diffs[0]!.kind, "replace");
});

/* ---------- sentence coalescing ---------- */

const changes = (segments: DiffSegment[]) => segments.filter((segment) => segment.kind !== "equal");

test("a mostly rewritten sentence is one whole deletion followed by one insertion", () => {
  const oldText = "Єдиний фізіологічний механізм елімінації аденозину — це сон.";
  const newText = "Під час сну концентрація аденозину знижується.";
  const fine = diffWords(oldText, newText, { coalesce: false });
  const segments = assertRebuilds(oldText, newText);

  assert.ok(changes(fine).length > 2, "the plain word alignment is fragmented");
  assert.deepEqual(segments, [
    { kind: "delete", text: oldText },
    { kind: "insert", text: newText }
  ]);
});

test("light edits keep word-level marks: a swapped word, a spelling fix, a changed comma", () => {
  const swapped = assertRebuilds(
    "Саме через це до вечора ми відчуваемо дедалі сильнішу сонливість.",
    "Саме через це до вечора ми відчуваємо дедалі сильнішу сонливість."
  );
  assert.deepEqual(changes(swapped), [
    { kind: "delete", text: "відчуваемо" },
    { kind: "insert", text: "відчуваємо" }
  ]);

  // One word of two changed: a high share, but a single word is never blown up to the whole sentence.
  assert.deepEqual(changes(assertRebuilds("Кава бадьорить.", "Чай бадьорить.")), [
    { kind: "delete", text: "Кава" },
    { kind: "insert", text: "Чай" }
  ]);

  assert.deepEqual(changes(assertRebuilds("Втома не зникає, мозок її не помічає.", "Втома не зникає: мозок її не помічає.")), [
    { kind: "delete", text: "," },
    { kind: "insert", text: ":" }
  ]);
});

test("only the rewritten sentence is coalesced; its neighbours keep their own marks", () => {
  const oldText = "Перше речення лишається. Кофеїн є конкурентним антагоністом аденозинових рецепторів. Втома нікуди не зникае.";
  const newText = "Перше речення лишається. Молекула кофеїну займає місце аденозину на рецепторі. Втома нікуди не зникає.";
  const segments = assertRebuilds(oldText, newText);

  assert.deepEqual(segments, [
    { kind: "equal", text: "Перше речення лишається. " },
    { kind: "delete", text: "Кофеїн є конкурентним антагоністом аденозинових рецепторів." },
    { kind: "insert", text: "Молекула кофеїну займає місце аденозину на рецепторі." },
    { kind: "equal", text: " Втома нікуди не " },
    { kind: "delete", text: "зникае" },
    { kind: "insert", text: "зникає" },
    { kind: "equal", text: "." }
  ]);
});

test("adjacent rewritten sentences merge into one deletion and one insertion", () => {
  const oldText = "Єдиний фізіологічний механізм елімінації аденозину — це сон. Під час глибокого сну його концентрація знижуеться до вихідного рівня, і вранці тиск сну починає рости з нуля.";
  const newText = "Позбутися аденозину можна лише одним способом — поспати. Уночі його стає менше, тож зранку втома накопичується заново.";
  const segments = assertRebuilds(oldText, newText);

  assert.deepEqual(segments, [
    { kind: "delete", text: oldText },
    { kind: "insert", text: newText }
  ]);
});

test("a sentence with many separate small changes is coalesced even when most words survive", () => {
  const oldText = "Коли дія кофеїну завершується, накопичений аденозин одномоментно отримує доступ до вивільнених рецепторів, що маніфестує різким зниженням рівня бадьорості у людини.";
  const newText = "Коли дія кофеїну слабшає, накопичений аденозин одразу отримує доступ до вільних рецепторів, що проявляється різким зниженням рівня бадьорості у людини.";
  const fine = diffWords(oldText, newText, { coalesce: false });

  assert.equal(changes(fine).filter((segment) => segment.kind === "delete").length, 4, "four separate places changed");
  assert.deepEqual(assertRebuilds(oldText, newText), [
    { kind: "delete", text: oldText },
    { kind: "insert", text: newText }
  ]);
});

test("sentences that were merged or split by the change are judged together", () => {
  const oldText = "Кава бадьорить. Але ненадовго.";
  const newText = "Кава бадьорить, але лише на кілька годин і не замінює сну.";
  const segments = assertRebuilds(oldText, newText);
  assert.deepEqual(changes(segments).map((segment) => segment.kind), ["delete", "insert"]);
});

test("coalescing leaves an unchanged diff and whitespace around a rewritten sentence alone", () => {
  const same = diffWords("Без змін.", "Без змін.");
  assert.equal(coalesceRewrittenSentences(same), same);

  const segments = assertRebuilds("Вступ.\nСтарий складний канцелярський зворот тут.\nКінець.", "Вступ.\nНове просте речення.\nКінець.");
  assert.deepEqual(segments, [
    { kind: "equal", text: "Вступ.\n" },
    { kind: "delete", text: "Старий складний канцелярський зворот тут." },
    { kind: "insert", text: "Нове просте речення." },
    { kind: "equal", text: "\nКінець." }
  ]);
});
