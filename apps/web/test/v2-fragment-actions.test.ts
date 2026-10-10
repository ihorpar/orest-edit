import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import { sliceDocumentForBlockRange, type Block, type EditorDocument } from "../lib/editor/document-model.ts";
import { inferLocalActionRoute } from "../lib/editor/local-action-router.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import type { PatchOperation } from "../lib/editor/patch-contract.ts";
import { getDefaultEditorSettings } from "../lib/editor/settings.ts";
import { buildProposalRequest } from "../lib/v2/api.ts";
import { findBlockPosition } from "../lib/v2/block-ids.ts";
import {
  buildFragmentManualItem,
  buildLocalActionRequest,
  buildPatchItem,
  buildPatchRequest,
  FRAGMENT_QUICK_ACTIONS,
  interpretLocalActionReply,
  interpretPatchReply,
  isScopeIntact,
  LOCAL_ACTION_ENDPOINT,
  PATCH_ENDPOINT,
  planFragmentExecution,
  requestLocalAction,
  requestPatch,
  shortenQuote,
  type FragmentActionId,
  type FragmentApiMessages
} from "../lib/v2/fragment-actions.ts";
import { getItemKind, needsProposalCall } from "../lib/v2/item-kinds.ts";
import { getSelectionScope } from "../lib/v2/selection-scope.ts";
import { canApplyProposal, createInitialReviewState, getItemPassId, getItemSource, reviewReducer } from "../lib/v2/store.ts";
import { documentToTiptap } from "../lib/v2/tiptap-bridge.ts";
import { createV2Extensions } from "../lib/v2/tiptap-extensions.ts";
import { createBlocksWhereLabel } from "../lib/v2/where-label.ts";
import { diffProposalBlocks } from "../lib/v2/word-diff.ts";

const p = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });

const P1 = "Аденозин накопичується в мозку протягом дня і створює тиск сну.";
const P2 = "Кофеїн є конкурентним антагоністом аденозинових рецепторів і тимчасово блокує сигнал утоми.";
const P3 = "Коли дія кофеїну минає, накопичений аденозин діє одразу.";

const document: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    p("p-1", P1),
    p("p-2", P2),
    { id: "img-1", type: "image", assetId: "asset-1", alt: "Схема" } as Block,
    p("p-3", P3)
  ]
};
const revision = deriveManuscriptRevisionState(document);

const messages: FragmentApiMessages = { invalid: "INVALID", network: "NETWORK", noOperations: "NO_OPERATIONS", fallback: "FALLBACK" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/* ---------- selection → block scope ---------- */

const schema = getSchema(createV2Extensions());

function stateWithSelection(select: (doc: EditorState["doc"]) => { from: number; to: number }): EditorState {
  const doc = schema.nodeFromJSON(documentToTiptap(document));
  const state = EditorState.create({ doc });
  const { from, to } = select(doc);
  return state.apply(state.tr.setSelection(TextSelection.create(doc, from, to)));
}

/** Position of the character `offset` inside the text of a paragraph. */
const inBlock = (doc: EditorState["doc"], blockId: string, offset: number) => findBlockPosition(doc, blockId) + 1 + offset;

test("a few selected words scope the whole paragraph they stand in", () => {
  const state = stateWithSelection((doc) => ({ from: inBlock(doc, "p-2", 10), to: inBlock(doc, "p-2", 34) }));
  const scope = getSelectionScope(state.doc, state.selection);

  assert.deepEqual(scope?.blockIds, ["p-2"]);
  assert.equal(scope?.quote, P2.slice(10, 34));
});

test("a selection across paragraphs scopes every block from the first to the last, with what stands between", () => {
  const state = stateWithSelection((doc) => ({ from: inBlock(doc, "p-2", 60), to: inBlock(doc, "p-3", 12) }));
  const scope = getSelectionScope(state.doc, state.selection);

  assert.deepEqual(scope?.blockIds, ["p-2", "img-1", "p-3"]);
  assert.equal(isScopeIntact(scope!, revision), true);
  assert.match(scope!.quote, /утоми\./);
  assert.match(scope!.quote, /^.+\n.*Коли дія/s);
});

test("a selection that only reaches the edge of the next paragraph does not pull it in", () => {
  // What a triple click leaves: the whole paragraph, ending at the very start of the next block.
  const state = stateWithSelection((doc) => ({ from: inBlock(doc, "p-1", 0), to: inBlock(doc, "p-2", 0) }));
  assert.deepEqual(getSelectionScope(state.doc, state.selection)?.blockIds, ["p-1"]);
});

test("a caret, or a selection of nothing readable, has no scope", () => {
  const caret = stateWithSelection((doc) => ({ from: inBlock(doc, "p-1", 5), to: inBlock(doc, "p-1", 5) }));
  assert.equal(getSelectionScope(caret.doc, caret.selection), null);

  const space = stateWithSelection((doc) => {
    const from = inBlock(doc, "p-1", P1.indexOf(" "));
    return { from, to: from + 1 };
  });
  assert.equal(getSelectionScope(space.doc, space.selection), null);
});

test("the scope reads as paragraph numbers from the gutter", () => {
  const where = createBlocksWhereLabel(document, {
    whereParagraph: (label) => `абз. ${label}`,
    whereHeading: "заголовок",
    whereBlock: "блок",
    whereGone: "фрагмент змінено"
  });

  assert.equal(where(["p-2"]), "абз. 2");
  assert.equal(where(["p-2", "img-1", "p-3"]), "абз. 2–3");
  assert.equal(where(["h-1"]), "заголовок");
  assert.equal(where(["img-1"]), "блок");
  assert.equal(where(["p-2", "missing"]), "фрагмент змінено");
  assert.equal(where([]), "фрагмент змінено");
});

test("a scope is intact only while its blocks stand together in order", () => {
  assert.equal(isScopeIntact({ blockIds: ["p-1", "p-2"], quote: "x" }, revision), true);
  assert.equal(isScopeIntact({ blockIds: ["p-1", "p-3"], quote: "x" }, revision), false);
  assert.equal(isScopeIntact({ blockIds: ["p-9"], quote: "x" }, revision), false);
  assert.equal(isScopeIntact({ blockIds: [], quote: "x" }, revision), false);
});

/* ---------- routing: request bodies and what the router answers ---------- */

const routeOf = (
  action: FragmentActionId,
  prompt?: string,
  choice?: "patch" | "callout" | "visual" | "spellcheck",
  locale: "uk" | "en" = "uk"
) => inferLocalActionRoute(buildLocalActionRequest({ action, prompt, locale, choice }));

test("the local-action request carries the fields the classic editor sends", () => {
  assert.deepEqual(buildLocalActionRequest({ action: "shorten", locale: "uk" }), {
    locale: "uk",
    prompt: "",
    explicitMode: "edit",
    preferredTextIntent: "shorten",
    calloutKind: "mechanism",
    calloutDepth: "brief",
    visualIntent: "infographic"
  });
  assert.deepEqual(buildLocalActionRequest({ action: "custom", prompt: "  Додай приклад із життя  ", locale: "uk" }), {
    locale: "uk",
    prompt: "Додай приклад із життя",
    explicitMode: null,
    preferredTextIntent: null,
    calloutKind: "mechanism",
    calloutDepth: "brief",
    visualIntent: "infographic"
  });
  // A quick action never smuggles free text along.
  assert.equal(buildLocalActionRequest({ action: "callout", prompt: "щось", locale: "uk" }).prompt, "");
});

test("every quick action reaches its executor through the real router", () => {
  assert.deepEqual(
    FRAGMENT_QUICK_ACTIONS.map((action) => [action, routeOf(action).executor]),
    [
      ["simplify", "patch"],
      ["shorten", "patch"],
      ["list", "review"],
      ["subsection", "review"],
      ["callout", "callout"],
      ["visual", "visual"],
      ["spell", "spellcheck"]
    ]
  );
});

test("routing results become execution plans for each executor", () => {
  assert.deepEqual(planFragmentExecution(routeOf("simplify")), { kind: "patch", mode: "default", prompt: undefined, textIntent: "rewrite" });

  const shorten = planFragmentExecution(routeOf("shorten"));
  assert.equal(shorten.kind, "patch");
  assert.equal(shorten.kind === "patch" && shorten.mode, "custom");
  assert.match((shorten.kind === "patch" && shorten.prompt) || "", /Скороти виділений фрагмент/);

  assert.deepEqual(planFragmentExecution(routeOf("list")), { kind: "manual", recommendationType: "list", instruction: undefined });
  assert.deepEqual(planFragmentExecution(routeOf("subsection")), { kind: "manual", recommendationType: "subsection", instruction: undefined });
  assert.deepEqual(planFragmentExecution(routeOf("callout")), {
    kind: "manual",
    recommendationType: "callout",
    instruction: undefined,
    calloutKind: "mechanism",
    calloutDepth: "brief"
  });
  assert.deepEqual(planFragmentExecution(routeOf("visual")), {
    kind: "manual",
    recommendationType: "visual",
    instruction: undefined,
    visualIntent: "infographic"
  });
  assert.deepEqual(planFragmentExecution(routeOf("spell")), { kind: "spellcheck" });
});

test("the editor's own words are routed by what they say", () => {
  const rewrite = planFragmentExecution(routeOf("custom", "Додай приклад із життя"));
  assert.deepEqual(rewrite, { kind: "patch", mode: "custom", prompt: "Додай приклад із життя", textIntent: "rewrite" });

  const callout = planFragmentExecution(routeOf("custom", "Зроби тут врізку з аналогією"));
  assert.equal(callout.kind === "manual" && callout.recommendationType, "callout");
  assert.equal(callout.kind === "manual" && callout.instruction, "Зроби тут врізку з аналогією");

  assert.equal(planFragmentExecution(routeOf("custom", "Перевір правопис")).kind, "spellcheck");
  assert.equal(planFragmentExecution(routeOf("custom", "Оформи списком")).kind, "manual");
});

test("a vague request is a question with choices, never a guess; the answer sends the same words to the chosen executor", () => {
  // The router's Ukrainian "vague" pattern relies on \b, which never matches around Cyrillic letters, so the
  // real router is driven in English here; the reply shape is the same for both languages.
  const vague = "Do something with this, your call";
  const question = planFragmentExecution(routeOf("custom", vague, undefined, "en"));

  assert.deepEqual(question, { kind: "clarify", choices: ["patch", "callout", "visual"] });

  assert.deepEqual(planFragmentExecution(routeOf("custom", vague, "patch", "en")), {
    kind: "patch",
    mode: "custom",
    prompt: vague,
    textIntent: "rewrite"
  });

  const callout = planFragmentExecution(routeOf("custom", vague, "callout", "en"));
  assert.equal(callout.kind === "manual" && callout.recommendationType, "callout");
  assert.equal(callout.kind === "manual" && callout.instruction, vague);

  const visual = planFragmentExecution(routeOf("custom", vague, "visual", "en"));
  assert.equal(visual.kind === "manual" && visual.recommendationType, "visual");

  assert.equal(planFragmentExecution(routeOf("custom", vague, "spellcheck", "en")).kind, "spellcheck");

  // A reply as the Ukrainian router would send it; choices this editor does not know are left out.
  assert.deepEqual(
    planFragmentExecution({ executor: "clarify", actionLabel: "Уточніть дію", choices: ["patch", "teleport" as never, "visual"] }),
    { kind: "clarify", choices: ["patch", "visual"] }
  );
});

test("a router reply is read strictly: the server's error, an unknown executor or a bad status is an error", () => {
  assert.deepEqual(interpretLocalActionReply(JSON.stringify(routeOf("spell")), 200, messages), { kind: "route", route: routeOf("spell") });
  assert.deepEqual(interpretLocalActionReply(JSON.stringify({ error: "Потрібно увійти." }), 401, messages), { kind: "error", message: "Потрібно увійти." });
  assert.deepEqual(interpretLocalActionReply("<html>504</html>", 504, messages), { kind: "error", message: "INVALID (HTTP 504)" });
  assert.deepEqual(interpretLocalActionReply(JSON.stringify({ executor: "magic" }), 200, messages), { kind: "error", message: "INVALID" });
  assert.deepEqual(interpretLocalActionReply(JSON.stringify({ executor: "clarify", choices: [] }), 200, messages), { kind: "error", message: "INVALID" });
  assert.deepEqual(interpretLocalActionReply(JSON.stringify({ executor: "review", recommendationType: "visual" }), 200, messages), {
    kind: "error",
    message: "INVALID"
  });
});

test("the router is called at the classic editor's endpoint; a cancelled call reports nothing", async () => {
  const calls: Array<{ url: string; body: unknown; credentials?: string }> = [];
  const reply = await requestLocalAction(buildLocalActionRequest({ action: "list", locale: "uk" }), {
    messages,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)), credentials: init?.credentials });
      return json(routeOf("list"));
    }
  });

  assert.equal(reply.kind, "route");
  assert.deepEqual(calls, [{ url: LOCAL_ACTION_ENDPOINT, body: buildLocalActionRequest({ action: "list", locale: "uk" }), credentials: "same-origin" }]);

  const controller = new AbortController();
  controller.abort();
  const aborted = await requestLocalAction(buildLocalActionRequest({ action: "list", locale: "uk" }), {
    messages,
    signal: controller.signal,
    fetchImpl: async () => {
      throw new DOMException("aborted", "AbortError");
    }
  });
  assert.deepEqual(aborted, { kind: "aborted" });

  const offline = await requestLocalAction(buildLocalActionRequest({ action: "list", locale: "uk" }), {
    messages,
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    }
  });
  assert.deepEqual(offline, { kind: "error", message: "NETWORK Failed to fetch" });
});

/* ---------- patch ---------- */

const settings = { ...getDefaultEditorSettings("uk"), provider: "gemini" as const, modelId: "gemini-test" };

test("the patch request matches the classic editor: the fragment with one neighbour each side, and the target ids", () => {
  const request = buildPatchRequest({ document, blockIds: ["p-2"], mode: "custom", prompt: "  Скороти.  ", settings, locale: "uk" });

  assert.deepEqual(request, {
    document: sliceDocumentForBlockRange(document, ["p-2"], { before: 1, after: 1 }),
    targetBlockIds: ["p-2"],
    mode: "custom",
    prompt: "Скороти.",
    provider: "gemini",
    modelId: "gemini-test",
    basePrompt: settings.basePrompt,
    locale: "uk"
  });
  assert.deepEqual(request.document.blocks.map((block) => block.id), ["p-1", "p-2", "img-1"]);
  assert.equal("apiKey" in request, false);

  // The default mode sends no prompt at all, as in the classic editor.
  const byDefault = buildPatchRequest({ document, blockIds: ["p-1", "p-2"], mode: "default", prompt: "ігнорується", settings, locale: "uk" });
  assert.equal(byDefault.prompt, undefined);
  assert.deepEqual(byDefault.document.blocks.map((block) => block.id), ["h-1", "p-1", "p-2", "img-1"]);
});

const NEW_P2 = "Кофеїн займає місце аденозину на рецепторах, і мозок на якийсь час не чує сигналу втоми.";

const operation = (overrides: Partial<PatchOperation> = {}): PatchOperation => ({
  id: "patch-1",
  op: "replace_blocks",
  blockIds: ["p-2"],
  oldBlocks: [p("p-2", P2)],
  newBlocks: [p("p-2", NEW_P2)],
  reason: "Термін «конкурентний антагоніст» замінено поясненням.",
  type: "clarity",
  ...overrides
});

const patchBody = (overrides: Record<string, unknown> = {}) => ({
  operations: [operation()],
  providerUsed: "gemini",
  usedFallback: false,
  diagnostics: {},
  ...overrides
});

test("a patch reply is a result only when it carries real operations from the model", () => {
  const ok = interpretPatchReply(JSON.stringify(patchBody()), 200, messages);
  assert.equal(ok.kind, "operations");
  assert.equal(ok.kind === "operations" && ok.operations.length, 1);

  // The provider's own words are shown, whatever else the body carries.
  assert.deepEqual(interpretPatchReply(JSON.stringify(patchBody({ error: "Model gemini-nope was not found." })), 502, messages), {
    kind: "error",
    message: "Model gemini-nope was not found."
  });
  assert.deepEqual(interpretPatchReply(JSON.stringify(patchBody({ error: "Помилка провайдера." })), 200, messages), {
    kind: "error",
    message: "Помилка провайдера."
  });
  // A fallback draft is never shown as model output.
  assert.deepEqual(interpretPatchReply(JSON.stringify(patchBody({ usedFallback: true })), 200, messages), { kind: "error", message: "FALLBACK" });
  assert.deepEqual(interpretPatchReply(JSON.stringify(patchBody({ operations: [] })), 200, messages), { kind: "error", message: "NO_OPERATIONS" });
  assert.deepEqual(interpretPatchReply(JSON.stringify(patchBody({ operations: [{ op: "delete_everything" }] })), 200, messages), {
    kind: "error",
    message: "INVALID"
  });
  assert.deepEqual(interpretPatchReply("upstream timeout", 504, messages), { kind: "error", message: "INVALID (HTTP 504)" });
  assert.deepEqual(interpretPatchReply(JSON.stringify(patchBody()), 500, messages), { kind: "error", message: "INVALID (HTTP 500)" });
});

test("the patch endpoint is called once with the request as built; cancel and network failure are told apart", async () => {
  const request = buildPatchRequest({ document, blockIds: ["p-2"], mode: "default", settings, locale: "uk" });
  const calls: Array<{ url: string; method?: string; body: unknown }> = [];
  const reply = await requestPatch(request, {
    messages,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
      return json(patchBody());
    }
  });

  assert.equal(reply.kind, "operations");
  assert.deepEqual(calls, [{ url: PATCH_ENDPOINT, method: "POST", body: JSON.parse(JSON.stringify(request)) }]);

  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(
    await requestPatch(request, {
      messages,
      signal: controller.signal,
      fetchImpl: async () => {
        throw new Error("socket closed");
      }
    }),
    { kind: "aborted" }
  );
  assert.deepEqual(
    await requestPatch(request, {
      messages,
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      }
    }),
    { kind: "error", message: "NETWORK Failed to fetch" }
  );
});

/* ---------- results as queue items ---------- */

const itemCopy = { title: "Простіше", recommendation: "Простіше", reasonFallback: "Модель не пояснила цю правку." };

test("a patch operation becomes a queue item that is ready for the inline diff", () => {
  const built = buildPatchItem({ operation: operation(), document, revision, textIntent: "rewrite", copy: itemCopy, itemId: "local-1", now: "2026-10-10T10:00:00.000Z" });

  assert.equal(built.kind, "item");

  if (built.kind !== "item") {
    return;
  }

  const { item, proposal } = built;

  assert.equal(getItemKind(item), "replace");
  assert.equal(item.status, "ready");
  assert.equal(item.origin, "manual");
  assert.equal(item.stepId, undefined, "a hand-made item belongs to no pass, so no pass rerun removes it");
  assert.equal(getItemPassId(item), null);
  assert.equal(getItemSource(item), "request");
  assert.deepEqual(item.anchor.blockIds, ["p-2"]);
  assert.equal(item.anchor.fingerprint, computeAnchorFingerprint(document, ["p-2"]));
  assert.equal(item.reason, "Термін «конкурентний антагоніст» замінено поясненням.", "the model's reason is the card's reason");
  assert.equal(item.activeProposalId, proposal.id);

  assert.equal(proposal.kind, "text_diff");
  assert.equal(proposal.reviewItemId, "local-1");
  assert.deepEqual(proposal.textDiff?.blockIds, ["p-2"]);
  assert.equal(proposal.textDiff?.reason, item.reason);

  // The same diff the manuscript draws for a prepared rewrite.
  const diff = diffProposalBlocks(proposal.textDiff!.blockIds, proposal.textDiff!.oldBlocks, proposal.textDiff!.newBlocks);
  assert.equal(diff.length, 1);
  assert.equal(diff[0]!.kind === "text" && diff[0]!.blockId, "p-2");

  // In the store it is an ordinary prepared suggestion: acceptable through the usual path.
  const context = { document, revision };
  const state = reviewReducer(createInitialReviewState(), { type: "item/added", item, proposal, ...context });
  assert.equal(canApplyProposal(state, "local-1"), true);
});

test("a patch operation without a reason still shows one; an operation for unknown or scattered blocks is not shown", () => {
  const silent = buildPatchItem({ operation: operation({ reason: "  " }), document, revision, textIntent: "shorten", copy: itemCopy, itemId: "local-2" });
  assert.equal(silent.kind === "item" && silent.item.reason, "Модель не пояснила цю правку.");
  assert.equal(silent.kind === "item" && silent.item.recommendationType, "simplify");

  assert.deepEqual(
    buildPatchItem({ operation: operation({ blockIds: ["p-9"] }), document, revision, textIntent: "rewrite", copy: itemCopy, itemId: "x" }),
    { kind: "unusable" }
  );
  assert.deepEqual(
    buildPatchItem({ operation: operation({ blockIds: ["p-1", "p-3"] }), document, revision, textIntent: "rewrite", copy: itemCopy, itemId: "x" }),
    { kind: "unusable" }
  );
});

test("list, subheading, callout and illustration requests become manual items of their own kinds", () => {
  const make = (recommendationType: "list" | "subsection" | "callout" | "visual", instruction?: string) =>
    buildFragmentManualItem({
      document,
      revision,
      blockIds: ["p-1", "p-2"],
      recommendationType,
      instruction,
      calloutKind: "analogy",
      calloutDepth: "deep",
      visualIntent: "illustration",
      copy: { title: "Заголовок картки", reason: "Ваш запит для виділеного фрагмента." },
      now: "2026-10-10T10:00:00.000Z"
    });

  const list = make("list");
  assert.equal(getItemKind(list), "replace");
  assert.equal(needsProposalCall(list), true);
  assert.equal(list.insertionPoint.mode, "replace");

  const heading = make("subsection");
  assert.equal(getItemKind(heading), "heading");
  assert.equal(needsProposalCall(heading), true, "a subheading asked for by hand has no title until the proposal call");
  assert.equal(heading.insertionPoint.anchorBlockId, "p-1");

  const callout = make("callout", "з аналогією про замок");
  assert.equal(getItemKind(callout), "callout");
  assert.equal(callout.calloutKind, "analogy");
  assert.equal(callout.calloutDepth, "deep");
  assert.equal(callout.insertionPoint.anchorBlockId, "p-2");
  assert.match(callout.recommendation, /з аналогією про замок/);

  const visual = make("visual");
  assert.equal(getItemKind(visual), "visual");
  assert.equal(visual.visualIntent, "illustration");

  for (const item of [list, heading, callout, visual]) {
    assert.equal(item.origin, "manual");
    assert.equal(item.status, "pending");
    assert.equal(item.stepId, undefined);
    assert.equal(getItemSource(item), "request");
    assert.equal(item.title, "Заголовок картки");
    assert.equal(item.reason, "Ваш запит для виділеного фрагмента.");
    assert.deepEqual(item.anchor.blockIds, ["p-1", "p-2"]);
    assert.equal(item.anchor.fingerprint, computeAnchorFingerprint(document, ["p-1", "p-2"]));
  }

  // The proposal endpoint gets the manual item the way the classic editor sends one.
  const request = buildProposalRequest({ document, item: callout, settings, locale: "uk", editorialInstruction: "з аналогією про замок" });
  assert.equal(request.item.recommendationType, "callout");
  assert.equal(request.item.calloutKind, "analogy");
  assert.equal(request.editorialInstruction, "з аналогією про замок");
  assert.equal(request.calloutPromptTemplate, settings.calloutPromptTemplate);
  assert.deepEqual(request.document.blocks.map((block) => block.id), ["p-1", "p-2"]);
});

test("a quote is shortened at a word boundary and flattened to one line", () => {
  assert.equal(shortenQuote("  Кофеїн\n блокує   сигнал  "), "Кофеїн блокує сигнал");
  const short = shortenQuote(P2, 40);
  assert.ok(short.length <= 41);
  assert.ok(short.endsWith("…"));
  assert.ok(P2.startsWith(short.slice(0, -1)));
});

/* ---------- guards and settlements (review round) ---------- */

import { findUnrewritableBlocks, isRewriteExecution, planSpellMerge, resolvePrepareSettlement } from "../lib/v2/fragment-actions.ts";

const mixedDocument: EditorDocument = {
  version: 2,
  blocks: [
    ...document.blocks,
    { id: "div-1", type: "divider" } as Block,
    { id: "list-1", type: "bullet_list", items: [[{ text: "раз" }], [{ text: "два" }]] } as Block,
    { id: "call-1", type: "callout", kind: "analogy", depth: "brief", title: [{ text: "Ключ" }], body: [[{ text: "Текст." }]] } as Block,
    { id: "tbl-1", type: "table", rows: [] } as unknown as Block
  ]
};

test("a rewrite scope may hold running text only: an image, table, divider or callout in it is named", () => {
  assert.deepEqual(findUnrewritableBlocks(mixedDocument, ["p-1", "p-2"]), []);
  assert.deepEqual(findUnrewritableBlocks(mixedDocument, ["h-1", "p-1", "list-1"]), []);
  assert.deepEqual(findUnrewritableBlocks(mixedDocument, ["p-2", "img-1", "p-3"]), ["img-1"]);
  assert.deepEqual(findUnrewritableBlocks(mixedDocument, ["p-3", "div-1", "list-1", "call-1", "tbl-1"]), ["div-1", "call-1", "tbl-1"]);
  // A block that is not in the manuscript is not something to rewrite either.
  assert.deepEqual(findUnrewritableBlocks(mixedDocument, ["ghost"]), ["ghost"]);
});

test("only executions that replace the scope are held to the text-only rule", () => {
  assert.equal(isRewriteExecution(planFragmentExecution(routeOf("simplify"))), true);
  assert.equal(isRewriteExecution(planFragmentExecution(routeOf("shorten"))), true);
  assert.equal(isRewriteExecution(planFragmentExecution(routeOf("custom", "Додай приклад із життя"))), true);
  assert.equal(isRewriteExecution(planFragmentExecution(routeOf("list"))), true, "a list is written in place of the fragment");
  // These only insert next to the fragment, so an image inside the scope is not at risk.
  assert.equal(isRewriteExecution(planFragmentExecution(routeOf("subsection"))), false);
  assert.equal(isRewriteExecution(planFragmentExecution(routeOf("callout"))), false);
  assert.equal(isRewriteExecution(planFragmentExecution(routeOf("visual"))), false);
  assert.equal(isRewriteExecution(planFragmentExecution(routeOf("spell"))), false);
});

test("a fragment request always ends when its preparation ends: done, failed, or stopped", () => {
  assert.deepEqual(resolvePrepareSettlement({ kind: "ready" }, true, "FALLBACK"), { kind: "done", count: 1 });
  assert.deepEqual(resolvePrepareSettlement({ kind: "failed", message: "Провайдер відповів 503." }, true, "FALLBACK"), {
    kind: "error",
    message: "Провайдер відповів 503."
  });
  assert.deepEqual(resolvePrepareSettlement({ kind: "failed", message: "" }, true, "FALLBACK"), { kind: "error", message: "FALLBACK" });
  // The card was rejected while the model was answering: the request is over, not running for ever.
  assert.deepEqual(resolvePrepareSettlement({ kind: "cancelled" }, true, "FALLBACK"), { kind: "stopped" });
  assert.deepEqual(resolvePrepareSettlement({ kind: "skipped" }, true, "FALLBACK"), { kind: "error", message: "FALLBACK" });
});

test("a run that was replaced or cancelled by its own button is not settled a second time", () => {
  for (const outcome of [{ kind: "ready" }, { kind: "cancelled" }, { kind: "failed", message: "x" }, { kind: "skipped" }] as const) {
    assert.equal(resolvePrepareSettlement(outcome, false, "FALLBACK"), null);
  }
});

test("a fragment spellcheck touches only the blocks that were really checked and keeps the failures", () => {
  assert.deepEqual(planSpellMerge(["p-1", "p-2", "p-3"], { checkedBlockIds: ["p-1", "p-3"], failures: ["Сервіс недоступний.", "Сервіс недоступний.", " "] }), {
    blockIds: ["p-1", "p-3"],
    warnings: ["Сервіс недоступний."]
  });
  assert.deepEqual(planSpellMerge(["p-1"], { checkedBlockIds: ["p-1", "p-9"], failures: [] }), { blockIds: ["p-1"], warnings: [] });
});
