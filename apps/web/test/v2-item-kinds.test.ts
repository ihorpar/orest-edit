import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { EditorialReviewItem } from "../lib/editor/review-contract.ts";
import type { SpellcheckIssue } from "../lib/editor/spellcheck-contract.ts";
import { createSpellcheckBatchChunks } from "../lib/editor/spellcheck-view-model.ts";
import { planAccept, planBulkAccept } from "../lib/v2/accept-plan.ts";
import { mapSpellcheckIssuesToBlocks, runSpellcheck, SPELLCHECK_ENDPOINT, type SpellFinding } from "../lib/v2/api.ts";
import {
  buildCalloutBlock,
  buildHeadingBlock,
  findOccurrenceRange,
  getItemKind,
  getOccurrenceAt,
  getSpellReplacement,
  hasLocalResult,
  isAnchorContiguous,
  isInlineRangeBold,
  needsProposalCall,
  rebaseSpellRange,
  resolveAccentRange,
  type V2ReviewItem,
  type V2SpellData
} from "../lib/v2/item-kinds.ts";
import { buildSpellItems, filterFindingsByDictionary, selectSpellItemsInDictionary } from "../lib/v2/spell-items.ts";

const paragraph = (id: string, text: string) => ({ id, type: "paragraph" as const, content: [{ text }] });

const document: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    paragraph("p-1", "Чим довше ми не спимо, тим більше його накопичується. Тиск сну росте, і тиск сну не зникає."),
    paragraph("p-2", "До вечора ми відчуваемо дедалі сильнішу сонливість."),
    { id: "p-3", type: "paragraph", content: [{ text: "Кофеїн " }, { text: "займає рецептор", bold: true }, { text: ", але не активує його." }] }
  ]
};

function item(id: string, blockId: string, overrides: Partial<V2ReviewItem> = {}): V2ReviewItem {
  return {
    id,
    reviewSessionId: "session-1",
    documentRevisionId: deriveManuscriptRevisionState(document).documentRevisionId,
    changeLevel: 5,
    title: "Пропозиція",
    reason: "Причина.",
    recommendation: "Що зробити.",
    recommendationType: "simplify",
    suggestedAction: "rewrite_text",
    priority: "medium",
    anchor: { blockIds: [blockId], generationBlockRange: { start: 1, end: 1 }, excerpt: "…", fingerprint: computeAnchorFingerprint(document, [blockId]) },
    insertionPoint: { mode: "replace", anchorBlockId: blockId },
    stepId: "clarity",
    status: "pending",
    ...overrides
  } satisfies EditorialReviewItem & { spell?: V2SpellData };
}

const heading = (id: string, blockId: string, title = "Як кофеїн обманює мозок", level: 2 | 3 = 2) =>
  item(id, blockId, {
    recommendationType: "subsection",
    suggestedAction: "insert_text",
    stepId: "structure",
    insertionPoint: { mode: "before", anchorBlockId: blockId },
    headingLevel: level,
    subsectionDraft: { title, headingLevel: level, prompt: "" }
  });

const accent = (id: string, blockId: string, text: string, occurrence?: number) =>
  item(id, blockId, { recommendationType: "rewrite", stepId: "emphasis", emphasisTarget: { text, occurrence } });

const callout = (id: string, blockId: string, draft = true) =>
  item(id, blockId, {
    recommendationType: "callout",
    suggestedAction: "prepare_callout",
    stepId: "interest",
    insertionPoint: { mode: "after", anchorBlockId: blockId },
    calloutKind: "analogy",
    calloutDepth: "brief",
    ...(draft
      ? {
          calloutPrepared: true,
          calloutDraft: {
            calloutKind: "analogy",
            calloutDepth: "brief",
            title: "Ключ, що застряг у замку",
            prompt: "",
            previewText: "Уявіть, що аденозин — це **ключ** до сну.\n\nКофеїн — схожий ключ, який не повертається."
          }
        }
      : {})
  });

const spellData = (text: string, badText: string, suggestions: string[]): V2SpellData => {
  const start = text.indexOf(badText);
  return { range: { start, end: start + badText.length }, badText, suggestions, choice: 0, category: "misspelling", blockText: text, occurrence: 1 };
};

const spell = (id: string, blockId: string, badText: string, suggestions: string[]) => {
  const block = document.blocks.find((entry) => entry.id === blockId)!;
  const text = block.type === "paragraph" ? block.content.map((node) => node.text).join("") : "";
  return item(id, blockId, { stepId: undefined, recommendationType: "rewrite", status: "ready", spell: spellData(text, badText, suggestions) });
};

/* ---------- kinds ---------- */

test("the kind of an item decides whether a model call stands between it and its result", () => {
  assert.equal(getItemKind(item("a", "p-1")), "replace");
  assert.equal(getItemKind(item("a", "p-1", { recommendationType: "list", stepId: "formatting" })), "replace");
  assert.equal(getItemKind(heading("a", "p-1")), "heading");
  assert.equal(getItemKind(accent("a", "p-1", "тиск сну")), "accent");
  assert.equal(getItemKind(callout("a", "p-1")), "callout");
  assert.equal(getItemKind(spell("a", "p-2", "відчуваемо", ["відчуваємо"])), "spell");
  assert.equal(getItemKind(item("a", "p-1", { recommendationType: "visual", stepId: "visuals" })), "visual");

  assert.equal(needsProposalCall(item("a", "p-1")), true);
  assert.equal(needsProposalCall(heading("a", "p-1")), false, "a structure item arrives with its title");
  assert.equal(needsProposalCall(heading("a", "p-1", "  ")), false, "a title the editor emptied waits for typing, not for the model");
  assert.equal(needsProposalCall({ ...heading("a", "p-1"), subsectionDraft: undefined }), true, "a heading that never had a title has to be prepared");
  assert.equal(needsProposalCall(accent("a", "p-1", "тиск сну")), false);
  assert.equal(needsProposalCall(callout("a", "p-1", false)), true);
  assert.equal(needsProposalCall(callout("a", "p-1")), false);
  assert.equal(needsProposalCall(spell("a", "p-2", "відчуваемо", ["відчуваємо"])), false);

  assert.equal(hasLocalResult(item("a", "p-1")), false);
  assert.equal(hasLocalResult(heading("a", "p-1")), true);
  assert.equal(hasLocalResult(callout("a", "p-1", false)), false);
});

/* ---------- accents ---------- */

test("an accent points at one exact occurrence of its phrase", () => {
  const text = "Тиск сну росте, і тиск сну не зникає, бо тиск сну — це аденозин.";
  assert.deepEqual(findOccurrenceRange(text, "тиск сну", 1), { start: 18, end: 26 });
  assert.deepEqual(findOccurrenceRange(text, "тиск сну", 2), { start: 41, end: 49 });
  assert.equal(findOccurrenceRange(text, "тиск сну", 3), null);
  assert.equal(findOccurrenceRange(text, "", 1), null);
  assert.equal(getOccurrenceAt(text, "тиск сну", 41), 2);

  // Quotes the model wrapped the phrase in are not part of it; a missing occurrence means the first.
  assert.deepEqual(resolveAccentRange(text, accent("a", "p-1", "«тиск сну»")), { start: 18, end: 26 });
});

test("a range is bold only when every character of it is", () => {
  const nodes = [{ text: "Кофеїн " }, { text: "займає рецептор", bold: true as const }, { text: ", але не активує." }];
  assert.equal(isInlineRangeBold(nodes, 7, 22), true);
  assert.equal(isInlineRangeBold(nodes, 7, 13), true);
  assert.equal(isInlineRangeBold(nodes, 0, 13), false, "partly bold is not bold");
  assert.equal(isInlineRangeBold(nodes, 22, 26), false);
  assert.equal(isInlineRangeBold(nodes, 7, 7), false);
});

/* ---------- headings and callouts ---------- */

test("a heading suggestion becomes one heading block of its level", () => {
  assert.deepEqual(buildHeadingBlock(heading("a", "p-2", "Як кофеїн **обманює** мозок", 3), "heading-new"), {
    id: "heading-new",
    type: "heading",
    level: 3,
    content: [{ text: "Як кофеїн " }, { text: "обманює", bold: true }, { text: " мозок" }]
  });
  assert.equal(buildHeadingBlock(heading("a", "p-2", "   "), "x"), null, "no title, nothing to insert");
});

test("a callout draft becomes a well-formed callout block: kind, depth, title, body paragraphs with bold", () => {
  const block = buildCalloutBlock(callout("a", "p-3"), "uk", "callout-new");
  assert.ok(block);
  assert.equal(block.type, "callout");
  assert.equal(block.kind, "analogy");
  assert.equal(block.depth, "brief");
  assert.deepEqual(block.title, [{ text: "Ключ, що застряг у замку" }]);
  assert.equal(block.body.length, 2);
  assert.deepEqual(block.body[0], [{ text: "Уявіть, що аденозин — це " }, { text: "ключ", bold: true }, { text: " до сну." }]);

  assert.equal(buildCalloutBlock(callout("a", "p-3", false), "uk", "x"), null, "nothing is built without a prepared draft");

  // A review run delivers callout items with a placeholder draft (a copy of the source fragment). It is not a callout.
  const placeholder = { ...callout("a", "p-3"), calloutPrepared: undefined };
  assert.equal(hasLocalResult(placeholder), false);
  assert.equal(needsProposalCall(placeholder), true);
  assert.equal(buildCalloutBlock(placeholder, "uk", "x"), null);

  const untitled = callout("a", "p-3");
  untitled.calloutDraft!.title = "";
  assert.deepEqual(buildCalloutBlock(untitled, "uk", "x")?.title, [{ text: "Аналогія" }], "the kind names a callout that has no title");
});

/* ---------- spelling: ranges ---------- */

test("findings of a batch are moved back to their blocks with block-local offsets", () => {
  const [chunk] = createSpellcheckBatchChunks([
    { blockId: "p-1", paragraphLabel: "001", text: "Перший абзац без помилок." },
    { blockId: "p-2", paragraphLabel: "002", text: "До вечора ми відчуваемо сонливість." }
  ]);
  assert.ok(chunk);

  const start = chunk.text.indexOf("відчуваемо");
  const issue = (range: { start: number; end: number }, values: string[]): SpellcheckIssue => ({
    id: "i",
    ruleId: "MORFOLOGIK_RULE_UK_UA",
    category: "misspelling",
    severity: "error",
    message: "Можлива орфографічна помилка.",
    range,
    badText: "",
    suggestions: values.map((value) => ({ value }))
  });

  const findings = mapSpellcheckIssuesToBlocks(chunk, [
    issue({ start, end: start + 10 }, ["відчуваємо", "відчуваємо", ""]),
    // Spans the separator between two blocks: belongs to neither.
    issue({ start: chunk.parts[0]!.textEnd - 2, end: chunk.parts[1]!.textStart + 2 }, ["x"]),
    issue({ start: 5, end: 5 }, ["x"])
  ]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.blockId, "p-2");
  assert.deepEqual(findings[0]!.range, { start: 13, end: 23 });
  assert.equal(findings[0]!.badText, "відчуваемо");
  assert.deepEqual(findings[0]!.suggestions, ["відчуваємо"], "duplicates and empty suggestions are dropped");
});

test("a finding follows its word through edits elsewhere in the block", () => {
  const text = "До вечора ми відчуваемо дедалі сильнішу сонливість.";
  const data = spellData(text, "відчуваемо", ["відчуваємо"]);

  const before = rebaseSpellRange(data, `Уже ${text}`);
  assert.deepEqual(before?.range, { start: data.range.start + 4, end: data.range.end + 4 });
  assert.equal(before?.blockText, `Уже ${text}`);

  const after = rebaseSpellRange(data, text.replace("сонливість", "втому"));
  assert.deepEqual(after?.range, data.range);

  const deletedBefore = rebaseSpellRange(data, text.replace("До вечора ", ""));
  assert.deepEqual(deletedBefore?.range, { start: 3, end: 13 });

  assert.equal(rebaseSpellRange(data, text), data, "unchanged text keeps the same object");
});

test("a finding whose word was touched goes stale instead of pointing at something else", () => {
  const text = "До вечора ми відчуваемо дедалі сильнішу сонливість.";
  const data = spellData(text, "відчуваемо", ["відчуваємо"]);

  assert.equal(rebaseSpellRange(data, text.replace("відчуваемо", "відчуваємо")), null, "fixed by hand");
  assert.equal(rebaseSpellRange(data, text.replace("відчуваемо", "відчуваемося")), null, "a letter joined the word at its end");
  assert.equal(rebaseSpellRange(data, text.replace("відчуваемо", "невідчуваемо")), null, "a letter joined the word at its start");
  assert.equal(rebaseSpellRange(data, text.replace("ми відчуваемо дедалі", "ми дедалі")), null, "the word is gone");
  assert.equal(rebaseSpellRange(data, ""), null);
});

test("several words fixed at once: the others are found again only when that is unambiguous", () => {
  const text = "Ми відчуваемо втому, концентрація знижуеться, а тиск росте.";
  const second = spellData(text, "знижуеться", ["знижується"]);
  // Both the word before it and the end of the sentence changed in one step (a bulk fix).
  const next = "Ми відчуваємо втому, концентрація знижуеться, а тиск зростає.";
  assert.deepEqual(rebaseSpellRange(second, next)?.range, { start: next.indexOf("знижуеться"), end: next.indexOf("знижуеться") + 10 });

  const twice = "помилка тут і помилка там, і ще текст.";
  const firstOfTwo = { ...spellData(twice, "помилка", ["Помилка"]) };
  assert.equal(rebaseSpellRange(firstOfTwo, "Xпомилка тут і помилка там, і ще текстY."), null, "one of two identical words changed: no guessing");
});

test("the chosen suggestion is what would be applied; a suggestion equal to the word is no fix", () => {
  const withTwo = spell("s", "p-2", "відчуваемо", ["відчуваємо", "відчуваймо"]);
  assert.equal(getSpellReplacement(withTwo), "відчуваємо");
  assert.equal(getSpellReplacement({ ...withTwo, spell: { ...withTwo.spell!, choice: 1 } }), "відчуваймо");
  assert.equal(getSpellReplacement(spell("s", "p-2", "відчуваемо", [])), null);
  assert.equal(getSpellReplacement(spell("s", "p-2", "відчуваемо", ["відчуваемо"])), null);
});

/* ---------- spelling: client, items, dictionary ---------- */

const spellMessages = { invalid: "Не вдалося прочитати.", network: "Немає з’єднання." };

function spellResponse(text: string, words: string[]): string {
  return JSON.stringify({
    issues: words.map((word, index) => ({
      id: `i-${index}`,
      ruleId: "R",
      category: "misspelling",
      severity: "error",
      message: "Можлива орфографічна помилка.",
      range: { start: text.indexOf(word), end: text.indexOf(word) + word.length },
      badText: word,
      suggestions: [{ value: word.replace("е", "є") }]
    }))
  });
}

test("spellcheck sends the text blocks in batches and returns block-local findings", async () => {
  const requests: Array<{ url: string; body: { selection: { text: string }; language: string; provider: string } }> = [];
  const reply = await runSpellcheck(
    { document, locale: "uk" },
    {
      messages: spellMessages,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(String(init?.body));
        requests.push({ url, body });
        return new Response(spellResponse(body.selection.text, ["відчуваемо"]), { status: 200 });
      }
    }
  );

  assert.equal(requests.length, 1, "a short chapter is one request, not one per block");
  assert.equal(requests[0]!.url, SPELLCHECK_ENDPOINT);
  assert.equal(requests[0]!.body.language, "uk-UA");
  assert.equal(requests[0]!.body.provider, "languagetool_public");
  assert.ok(reply.kind === "ok");
  assert.equal(reply.checkedBlocks, 4, "the heading and three paragraphs");
  assert.deepEqual(reply.findings.map((finding) => [finding.blockId, finding.badText, finding.range.start]), [["p-2", "відчуваемо", 13]]);
  assert.deepEqual(reply.failures, []);
});

test("spellcheck fails loud: a server error, an unreadable reply and a dead network are errors, never 'no mistakes'", async () => {
  const failing = async (response: () => Promise<Response>) =>
    runSpellcheck({ document, locale: "uk" }, { messages: spellMessages, fetchImpl: response });

  const serverError = await failing(async () => new Response(JSON.stringify({ issues: [], error: "LanguageTool недоступний." }), { status: 502 }));
  assert.deepEqual(serverError, { kind: "error", message: "LanguageTool недоступний." });

  const unreadable = await failing(async () => new Response("<html>504</html>", { status: 504 }));
  assert.deepEqual(unreadable, { kind: "error", message: "Не вдалося прочитати. (HTTP 504)" });

  const noIssuesField = await failing(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  assert.equal(noIssuesField.kind, "error");

  const network = await failing(async () => {
    throw new TypeError("fetch failed");
  });
  assert.deepEqual(network, { kind: "error", message: "Немає з’єднання. fetch failed" });

  const controller = new AbortController();
  controller.abort();
  const aborted = await runSpellcheck(
    { document, locale: "uk", signal: controller.signal },
    {
      messages: spellMessages,
      fetchImpl: async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
    }
  );
  assert.deepEqual(aborted, { kind: "aborted" });
});

const finding = (blockId: string, badText: string, suggestions: string[]): SpellFinding => {
  const block = document.blocks.find((entry) => entry.id === blockId);
  const blockText = block && (block.type === "paragraph" || block.type === "heading") ? block.content.map((node) => node.text).join("") : badText;
  const start = blockText.indexOf(badText);
  return { blockId, blockText, range: { start, end: start + badText.length }, badText, suggestions, message: "Помилка.", category: "misspelling", ruleId: "R" };
};

test("findings become queue items that carry their range, suggestions and the checked text", () => {
  const items = buildSpellItems([finding("p-2", "відчуваемо", ["відчуваємо"]), finding("p-9", "x", [])], document, "run1");
  assert.equal(items.length, 1, "a finding for a block that is gone is left out");

  const [first] = items;
  assert.equal(first!.id, "spell-run1-1");
  assert.equal(first!.stepId, undefined, "spellcheck is not a review step");
  assert.equal(first!.status, "ready");
  assert.deepEqual(first!.anchor.blockIds, ["p-2"]);
  assert.equal(first!.anchor.fingerprint, computeAnchorFingerprint(document, ["p-2"]));
  assert.deepEqual(first!.spell?.range, { start: 13, end: 23 });
  assert.equal(first!.spell?.occurrence, 1);
  assert.equal(first!.reason, "Помилка.", "the reason shown on the card is the checker's own message");
});

test("words of the personal dictionary are filtered from new findings and from the open queue", () => {
  const findings = [finding("p-2", "відчуваемо", ["відчуваємо"]), finding("p-1", "накопичується", [])];
  assert.deepEqual(filterFindingsByDictionary(findings, [], "uk"), findings);
  assert.deepEqual(
    filterFindingsByDictionary(findings, ["Відчуваемо "], "uk").map((entry) => entry.badText),
    ["накопичується"],
    "case and surrounding spaces do not matter"
  );

  const items = buildSpellItems(findings, document, "r");
  const decided = { ...items[0]!, status: "applied" as const };
  assert.deepEqual(selectSpellItemsInDictionary([decided, items[1]!], ["відчуваемо", "накопичується"], "uk"), [items[1]!.id], "decided items are left alone");
  assert.deepEqual(selectSpellItemsInDictionary(items, [], "uk"), []);
});

/* ---------- accept plans ---------- */

test("accepting a heading plans one insertion before its anchor, with a fresh id", () => {
  const plan = planAccept(heading("a", "p-2"), document, { locale: "uk", createId: () => "heading-new" });
  assert.deepEqual(plan, {
    itemId: "a",
    edit: {
      type: "insert",
      anchorBlockId: "p-2",
      side: "before",
      blocks: [{ id: "heading-new", type: "heading", level: 2, content: [{ text: "Як кофеїн обманює мозок" }] }]
    },
    insertedBlockIds: ["heading-new"]
  });

  assert.equal(planAccept(heading("a", "p-9"), document, { locale: "uk" }), null, "the anchor is gone");
  assert.equal(planAccept(heading("a", "p-2", ""), document, { locale: "uk" }), null, "no title");
});

test("accepting a callout plans one insertion after its anchor", () => {
  const plan = planAccept(callout("a", "p-3"), document, { locale: "uk", createId: () => "callout-new" });
  assert.ok(plan && plan.edit.type === "insert");
  assert.equal(plan.edit.side, "after");
  assert.equal(plan.edit.anchorBlockId, "p-3");
  assert.equal(plan.edit.blocks[0]!.id, "callout-new");
  assert.equal(plan.edit.blocks[0]!.type, "callout");
  assert.deepEqual(plan.insertedBlockIds, ["callout-new"]);
  assert.equal(planAccept(callout("a", "p-3", false), document, { locale: "uk" }), null, "an unprepared callout has nothing to insert");
});

test("accepting an accent plans bold over the right occurrence only, and nothing when it is bold already", () => {
  const plan = planAccept(accent("a", "p-1", "тиск сну", 1), document, { locale: "uk" });
  const text = "Чим довше ми не спимо, тим більше його накопичується. Тиск сну росте, і тиск сну не зникає.";
  const start = text.indexOf("тиск сну");
  assert.deepEqual(plan?.edit, { type: "bold", blockId: "p-1", start, end: start + 8, expected: "тиск сну" });

  assert.equal(planAccept(accent("a", "p-1", "тиск сну", 2), document, { locale: "uk" }), null, "there is no second occurrence");
  assert.equal(planAccept(accent("a", "p-3", "займає рецептор"), document, { locale: "uk" }), null, "bold already");
  assert.equal(planAccept(accent("a", "h-9", "x"), document, { locale: "uk" }), null);
});

test("accepting a spelling fix plans a replacement of exactly the misspelt range", () => {
  const plan = planAccept(spell("a", "p-2", "відчуваемо", ["відчуваємо"]), document, { locale: "uk" });
  assert.deepEqual(plan?.edit, { type: "text", blockId: "p-2", start: 13, end: 23, expected: "відчуваемо", text: "відчуваємо" });

  assert.equal(planAccept(spell("a", "p-2", "відчуваемо", []), document, { locale: "uk" }), null, "nothing to replace it with");

  const moved = spell("a", "p-2", "відчуваемо", ["відчуваємо"]);
  moved.spell = { ...moved.spell!, range: { start: 0, end: 10 } };
  assert.equal(planAccept(moved, document, { locale: "uk" }), null, "the range no longer reads as the word");

  assert.equal(planAccept(item("a", "p-1"), document, { locale: "uk" }), null, "rewrites are not planned here");
});

test("two findings over the same word: a bulk plan takes the first and leaves the other open", () => {
  const first = spell("a", "p-2", "відчуваемо", ["відчуваємо"]);
  const same = spell("b", "p-2", "відчуваемо", ["відчуваймо"]);
  const inside = spell("c", "p-2", "відчуваемо", ["чуємо"]);
  inside.spell = { ...inside.spell!, range: { start: 16, end: 23 }, badText: "чуваемо" };
  const apart = spell("d", "p-2", "сонливість", ["сонливости"]);

  const { plans, skipped } = planBulkAccept([first, same, inside, apart], document, { locale: "uk" });
  assert.deepEqual(plans.map((plan) => plan.itemId), ["a", "d"]);
  assert.deepEqual(skipped, ["b", "c"]);
});

test("a multi-block anchor is whole only while its blocks stand next to each other in order", () => {
  const order = ["h-1", "p-1", "p-2", "p-3"];
  assert.equal(isAnchorContiguous(order, ["p-1", "p-2"]), true);
  assert.equal(isAnchorContiguous(order, ["p-2"]), true);
  assert.equal(isAnchorContiguous(["h-1", "p-1", "new", "p-2", "p-3"], ["p-1", "p-2"]), false, "something was put between them");
  assert.equal(isAnchorContiguous(order, ["p-2", "p-1"]), false);
  assert.equal(isAnchorContiguous(order, ["p-3", "p-4"]), false);
  assert.equal(isAnchorContiguous(order, []), false);
});

test("a bulk plan gives every inserted block its own id and reports what it could not plan", () => {
  let counter = 0;
  const { plans, skipped } = planBulkAccept([heading("a", "p-1"), heading("b", "p-2"), heading("gone", "p-9")], document, {
    locale: "uk",
    createId: () => `heading-${(counter += 1) > 1 ? Math.min(counter - 1, 2) : 1}`
  });

  assert.deepEqual(skipped, ["gone"]);
  assert.equal(plans.length, 2);
  assert.notEqual(plans[0]!.insertedBlockIds![0], plans[1]!.insertedBlockIds![0], "an id handed out twice is not used twice");
});
