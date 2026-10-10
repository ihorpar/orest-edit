import test from "node:test";
import assert from "node:assert/strict";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import type { PersistedActiveReviewRun } from "../lib/editor/draft-state.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { DEFAULT_VISUAL_IMAGE_QUALITY, DEFAULT_VISUAL_STYLE_PRESET } from "../lib/editor/settings.ts";
import { createV2Draft, readV2Draft, writeV2Draft } from "../lib/v2/draft-storage.ts";
import { buildItemMarks, type FigureMarkCopy } from "../lib/v2/item-marks.ts";
import { getItemKind, type V2ReviewItem } from "../lib/v2/item-kinds.ts";
import {
  BULK_PASSES,
  canAcceptItem,
  coercePersistedReview,
  createInitialReviewState,
  findFigureItem,
  getFigureBlockId,
  getItemPassId,
  getItemSource,
  isKeptOnReplace,
  isStudioItem,
  planQuietPreparation,
  planRunAll,
  QUIET_DWELL_MS,
  reviewReducer,
  RUN_ALL_ORDER,
  selectBulkCandidates,
  selectQueue,
  selectQuietPreparationTargets,
  serializeReviewState,
  shouldPersistAfter,
  type V2ReviewAction,
  type V2ReviewState
} from "../lib/v2/store.ts";
import {
  buildFigureBlock,
  canGenerate,
  canInsertImage,
  canPreparePrompt,
  coerceStudioData,
  coerceVisualPrefs,
  createStudioData,
  getStudioPhase,
  getStudioPreview,
  getStudioSignature,
  isPromptMismatched,
  isStudioStale,
  isStudioTouched,
  resolveStudioDefaults,
  serializeStudioData,
  studioReducer,
  type V2StudioData,
  type V2StudioDefaults,
  type V2StudioEvent
} from "../lib/v2/studio.ts";

/* ---------- fixtures ---------- */

const paragraph = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });

const baseDocument: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Чому кава не замінює сон" }] },
    paragraph("p-1", "Чим довше ми не спимо, тим більше аденозину накопичується."),
    paragraph("p-2", "Кофеїн є конкурентним антагоністом аденозинових рецепторів."),
    paragraph("p-3", "Коли дія кофеїну завершується, втома повертається вся одразу.")
  ]
};

const context = (document: EditorDocument = baseDocument) => ({ document, revision: deriveManuscriptRevisionState(document) });
const reduce = (state: V2ReviewState, ...actions: V2ReviewAction[]) => actions.reduce(reviewReducer, state);
const DEFAULTS: V2StudioDefaults = { intent: "infographic", style: "minimal", quality: "fast" };
const NOW = "2026-10-10T10:00:00.000Z";
const PROMPT = "Схема рецептора у два кадри: аденозин входить у рецептор; кофеїн займає його місце.";

function visualItem(id: string, blockId: string, overrides: Partial<V2ReviewItem> = {}): V2ReviewItem {
  return {
    id,
    reviewSessionId: "session-1",
    documentRevisionId: deriveManuscriptRevisionState(baseDocument).documentRevisionId,
    changeLevel: 5,
    title: "Кофеїн займає місце аденозину",
    reason: "Механізм легше побачити, ніж прочитати.",
    recommendation: "Показати рецептор у два кадри.",
    recommendationType: "visual",
    suggestedAction: "prepare_visual",
    priority: "medium",
    anchor: {
      blockIds: [blockId],
      generationBlockRange: { start: 1, end: 1 },
      excerpt: "…",
      fingerprint: computeAnchorFingerprint(baseDocument, [blockId])
    },
    insertionPoint: { mode: "after", anchorBlockId: blockId },
    origin: "review",
    stepId: "visuals",
    stepRunId: "step-run-1",
    status: "pending",
    visualIntent: "infographic",
    ...overrides
  };
}

const play = (studio: V2StudioData, ...events: V2StudioEvent[]) => events.reduce(studioReducer, studio);
const ready = (prompt = PROMPT, caption = ""): V2StudioEvent => ({ type: "prompt/ready", prompt, alt: "Схема рецептора", caption, intent: "infographic", style: "minimal" });
const prepared = () => play(createStudioData(DEFAULTS), { type: "prompt/requested" }, ready());
const generated = (assetId = "asset-image-1", from: V2StudioData = prepared()) =>
  play(
    from,
    { type: "generation/requested", at: NOW },
    { type: "generation/completed", assetId, mimeType: "image/png", at: NOW }
  );

const stateWith = (...items: V2ReviewItem[]): V2ReviewState => ({ ...createInitialReviewState(), items });
const studioOf = (state: V2ReviewState, itemId: string) => state.items.find((entry) => entry.id === itemId)!.studio!;
const event = (itemId: string, studioEvent: V2StudioEvent): V2ReviewAction => ({ type: "studio/event", itemId, event: studioEvent });

/** The store after the studio was opened, the prompt prepared and an image generated for it. */
function generatedState(itemId = "v-1", blockId = "p-2", assetId = "asset-image-1"): V2ReviewState {
  return reduce(
    stateWith(visualItem(itemId, blockId)),
    { type: "studio/opened", itemId, defaults: DEFAULTS },
    event(itemId, { type: "prompt/requested" }),
    event(itemId, ready()),
    event(itemId, { type: "generation/requested", at: NOW }),
    event(itemId, { type: "generation/completed", assetId, mimeType: "image/png", at: NOW })
  );
}

const figureBlock = (id: string, assetId = "asset-image-1"): Block => ({ id, type: "image", assetId, alt: "Схема", caption: [{ text: "" }] });
const insertAfter = (document: EditorDocument, blockId: string, block: Block): EditorDocument => ({
  version: 2,
  blocks: document.blocks.flatMap((entry) => (entry.id === blockId ? [entry, block] : [entry]))
});
const without = (document: EditorDocument, blockId: string): EditorDocument => ({ version: 2, blocks: document.blocks.filter((entry) => entry.id !== blockId) });

/** Inserts the generated image of `itemId` as block `fig-1` after its anchor, the way the engine does. */
function inserted(state: V2ReviewState, itemId = "v-1", blockId = "p-2", figureId = "fig-1") {
  const document = insertAfter(baseDocument, blockId, figureBlock(figureId, studioOf(state, itemId).asset!.assetId));
  const next = reduce(
    state,
    { type: "item/accepted", itemId, appliedFingerprint: computeAnchorFingerprint(document, [blockId]), insertedBlockIds: [figureId], at: NOW },
    { type: "items/reconciled", ...context(document) }
  );

  return { state: next, document };
}

/* ---------- the state machine ---------- */

test("a new studio starts unprepared with the given defaults and nothing to generate or insert", () => {
  const studio = createStudioData(DEFAULTS);

  assert.equal(getStudioPhase(undefined), "unprepared");
  assert.equal(getStudioPhase(studio), "unprepared");
  assert.equal(getStudioPreview(studio), "empty");
  assert.equal(canPreparePrompt(studio), true);
  assert.equal(canGenerate(studio), false, "there is no prompt yet");
  assert.equal(canInsertImage(studio, null), false);
  assert.deepEqual([studio.intent, studio.style, studio.quality, studio.preparedFor], ["infographic", "minimal", "fast", null]);
});

test("defaults: the item's intent, then v2's own remembered choice, then the classic editor's style, then settings", () => {
  assert.deepEqual(resolveStudioDefaults({}), { intent: "infographic", style: DEFAULT_VISUAL_STYLE_PRESET, quality: DEFAULT_VISUAL_IMAGE_QUALITY });
  assert.deepEqual(resolveStudioDefaults({ intent: "illustration", classicStyle: "neo_brutal" }), {
    intent: "illustration",
    style: "neo_brutal",
    quality: DEFAULT_VISUAL_IMAGE_QUALITY
  });
  assert.deepEqual(
    resolveStudioDefaults({ classicStyle: "neo_brutal", prefs: { style: "modern_glass", quality: "quality" } }),
    { intent: "infographic", style: "modern_glass", quality: "quality" },
    "v2's own choice wins over the classic editor's"
  );
  assert.equal(resolveStudioDefaults({ classicStyle: "no-such-style" }).style, DEFAULT_VISUAL_STYLE_PRESET);
});

test("open → prepared: the prompt, its alt text and what it was written for arrive together", () => {
  const preparing = play(createStudioData(DEFAULTS), { type: "prompt/requested" });

  assert.equal(getStudioPhase(preparing), "preparing");
  assert.equal(canPreparePrompt(preparing), false, "one preparation at a time");
  assert.equal(canGenerate(preparing), false);

  const studio = play(preparing, ready(PROMPT, "Підпис від моделі"));

  assert.equal(getStudioPhase(studio), "prepared");
  assert.equal(studio.prompt, PROMPT);
  assert.equal(studio.alt, "Схема рецептора");
  assert.equal(studio.caption, "Підпис від моделі", "an empty caption field takes the model's caption");
  assert.deepEqual(studio.preparedFor, { intent: "infographic", style: "minimal" });
  assert.equal(isPromptMismatched(studio), false);
  assert.equal(canGenerate(studio), true);
  assert.equal(canInsertImage(studio, null), false, "nothing has been generated");
});

test("a prompt answer nobody asked for, or an empty one, changes nothing", () => {
  const idle = createStudioData(DEFAULTS);

  assert.equal(studioReducer(idle, ready()), idle);

  const preparing = play(idle, { type: "prompt/requested" });
  assert.equal(studioReducer(preparing, ready("   ")), preparing, "an empty prompt is not a prompt");
});

test("a caption the editor typed is never replaced by the model's", () => {
  const studio = play(
    createStudioData(DEFAULTS),
    { type: "field", change: { caption: "Мій підпис" } },
    { type: "prompt/requested" },
    ready(PROMPT, "Підпис від моделі")
  );

  assert.equal(studio.caption, "Мій підпис");
});

test("prepared → edited: the prompt can be typed over; without an image nothing is stale", () => {
  const studio = play(prepared(), { type: "field", change: { prompt: `${PROMPT} Підписи українською.` } });

  assert.equal(getStudioPhase(studio), "prepared");
  assert.equal(isStudioStale(studio), false);
  assert.equal(canGenerate(studio), true);
  assert.notEqual(getStudioSignature(studio), getStudioSignature(prepared()));
});

test("generating → generated: the image belongs to the prompt and settings it was requested with", () => {
  const requested = play(prepared(), { type: "generation/requested", at: NOW });

  assert.equal(getStudioPhase(requested), "generating");
  assert.equal(getStudioPreview(requested), "generating");
  assert.deepEqual(requested.generation, { status: "generating", startedAt: NOW, signature: getStudioSignature(prepared()) });
  assert.equal(canGenerate(requested), false, "one generation at a time");
  assert.equal(canPreparePrompt(requested), false);

  assert.equal(studioReducer(requested, { type: "generation/requested", at: "later" }), requested, "a second press while waiting changes nothing");

  const studio = play(requested, { type: "generation/completed", assetId: "asset-image-1", mimeType: "image/png", at: NOW });

  assert.equal(getStudioPhase(studio), "generated");
  assert.equal(getStudioPreview(studio), "image");
  assert.deepEqual(studio.asset, { assetId: "asset-image-1", mimeType: "image/png", signature: getStudioSignature(studio), at: NOW });
  assert.deepEqual(studio.generation, { status: "idle" });
});

test("while a request is in flight the prompt and settings do not move under it; the caption does", () => {
  const generating = play(prepared(), { type: "generation/requested", at: NOW });

  for (const change of [{ prompt: "інший" }, { intent: "illustration" as const }, { style: "neo_brutal" as const }, { quality: "quality" as const }]) {
    assert.equal(studioReducer(generating, { type: "field", change }), generating);
  }

  assert.equal(studioReducer(generating, { type: "field", change: { caption: "Підпис" } }).caption, "Підпис");

  const preparing = play(createStudioData(DEFAULTS), { type: "prompt/requested" });
  assert.equal(studioReducer(preparing, { type: "field", change: { style: "neo_brutal" } }), preparing);
});

test("the image may be inserted only when it is current, nothing is in flight, and it is the one on screen", () => {
  const studio = generated();

  assert.equal(canInsertImage(studio, "asset-image-1"), true);
  assert.equal(canInsertImage(studio, null), false, "the picture has not been drawn in the preview");
  assert.equal(canInsertImage(studio, "asset-image-0"), false, "another picture is on screen");
  assert.equal(canInsertImage(play(studio, { type: "generation/requested", at: NOW }), "asset-image-1"), false, "a new image is being generated");
  assert.equal(canInsertImage(play(studio, { type: "prompt/requested" }), "asset-image-1"), false, "the prompt is being rewritten");
});

test("generated → stale: any change of prompt, intent, style or speed makes the image stale and uninsertable", () => {
  const studio = generated();
  const changes = [
    { prompt: `${PROMPT} Без тексту.` },
    { intent: "illustration" as const },
    { style: "calm_gradient" as const },
    { quality: "quality" as const }
  ];

  for (const change of changes) {
    const next = studioReducer(studio, { type: "field", change });

    assert.equal(isStudioStale(next), true, JSON.stringify(change));
    assert.equal(getStudioPhase(next), "stale");
    assert.equal(getStudioPreview(next), "stale");
    assert.equal(canInsertImage(next, "asset-image-1"), false);
    assert.equal(next.asset?.assetId, "asset-image-1", "the old image is kept, to be shown as not matching");
    assert.equal(canGenerate(next), true);
  }

  // The caption is not what the image is made from.
  assert.equal(isStudioStale(studioReducer(studio, { type: "field", change: { caption: "Новий підпис" } })), false);
  // Putting everything back as it was makes the image current again.
  const back = play(studio, { type: "field", change: { style: "neo_brutal" } }, { type: "field", change: { style: "minimal" } });
  assert.equal(isStudioStale(back), false);
  assert.equal(canInsertImage(back, "asset-image-1"), true);
});

test("changing intent or style does not touch the prompt: it is flagged as written for something else until it is refreshed", () => {
  const changed = play(generated(), { type: "field", change: { style: "neo_brutal" } }, { type: "field", change: { intent: "illustration" } });

  assert.equal(changed.prompt, PROMPT, "no model call, no new prompt");
  assert.equal(isPromptMismatched(changed), true);
  assert.deepEqual(changed.preparedFor, { intent: "infographic", style: "minimal" });
  assert.equal(isPromptMismatched(studioReducer(generated(), { type: "field", change: { quality: "quality" } })), false, "speed is not part of the prompt");

  const refreshed = play(changed, { type: "prompt/requested" }, { type: "prompt/ready", prompt: "Іронічна сцена без сітки.", alt: "Сцена", intent: "illustration", style: "neo_brutal" });

  assert.equal(isPromptMismatched(refreshed), false);
  assert.equal(refreshed.prompt, "Іронічна сцена без сітки.");
  assert.equal(isStudioStale(refreshed), true, "the image was made for the old prompt");
  assert.equal(canInsertImage(refreshed, "asset-image-1"), false);
});

test("stale → regenerated: a new image replaces the old one and can be inserted", () => {
  const stale = studioReducer(generated(), { type: "field", change: { style: "calm_gradient" } });
  const studio = play(stale, { type: "generation/requested", at: NOW }, { type: "generation/completed", assetId: "asset-image-2", mimeType: "image/png", at: NOW });

  assert.equal(getStudioPhase(studio), "generated");
  assert.equal(studio.asset?.assetId, "asset-image-2");
  assert.equal(canInsertImage(studio, "asset-image-2"), true);
  assert.equal(canInsertImage(studio, "asset-image-1"), false, "the old picture is not the one to insert");
});

test("a failed prompt preparation shows the server's message and never leaves the studio preparing", () => {
  const failed = play(createStudioData(DEFAULTS), { type: "prompt/requested" }, { type: "prompt/failed", message: "Немає OPENAI_API_KEY." });

  assert.equal(getStudioPhase(failed), "prompt_failed");
  assert.deepEqual(failed.promptState, { status: "failed", message: "Немає OPENAI_API_KEY." });
  assert.equal(failed.prompt, "");
  assert.equal(canPreparePrompt(failed), true, "it can be tried again, by the editor");
  assert.equal(canGenerate(failed), false);

  const retried = play(failed, { type: "prompt/requested" }, ready());
  assert.equal(getStudioPhase(retried), "prepared");
});

test("a failed refresh keeps the prompt that was there", () => {
  const failed = play(generated(), { type: "field", change: { style: "neo_brutal" } }, { type: "prompt/requested" }, { type: "prompt/failed", message: "502" });

  assert.equal(failed.prompt, PROMPT);
  assert.equal(isPromptMismatched(failed), true);
  assert.equal(failed.asset?.assetId, "asset-image-1");
});

test("a failed generation shows the provider's message; an earlier image stays what it was", () => {
  const first = play(prepared(), { type: "generation/requested", at: NOW }, { type: "generation/failed", message: "Gemini не відповів вчасно." });

  assert.equal(getStudioPhase(first), "generation_failed");
  assert.deepEqual(first.generation, { status: "failed", message: "Gemini не відповів вчасно." });
  assert.equal(first.asset, null, "no image is invented");
  assert.equal(getStudioPreview(first), "empty");
  assert.equal(canInsertImage(first, null), false);
  assert.equal(canGenerate(first), true);

  // Regenerating for the same prompt failed: the image that exists is still the image for that prompt.
  const again = play(generated(), { type: "generation/requested", at: NOW }, { type: "generation/failed", message: "429" });
  assert.equal(again.asset?.assetId, "asset-image-1");
  assert.equal(getStudioPreview(again), "image");
  assert.equal(canInsertImage(again, "asset-image-1"), true);

  // A late answer after a failure is ignored.
  assert.equal(studioReducer(first, { type: "generation/completed", assetId: "late", mimeType: "image/png", at: NOW }), first);
});

test("cancel: the editor gives up on a prompt or on an image, and a late result is not taken", () => {
  const promptCancelled = play(createStudioData(DEFAULTS), { type: "prompt/requested" }, { type: "prompt/cancelled" });
  assert.deepEqual(promptCancelled.promptState, { status: "idle" });
  assert.equal(studioReducer(promptCancelled, ready()), promptCancelled, "the answer to a cancelled request is dropped");

  const cancelled = play(prepared(), { type: "generation/requested", at: NOW }, { type: "generation/cancelled" });
  assert.deepEqual(cancelled.generation, { status: "cancelled" });
  assert.equal(getStudioPreview(cancelled), "empty");
  assert.equal(cancelled.asset, null);
  assert.equal(studioReducer(cancelled, { type: "generation/completed", assetId: "late", mimeType: "image/png", at: NOW }), cancelled);
  assert.equal(canGenerate(cancelled), true);
});

test("the figure block is well formed: the stored asset id, alt text and caption, never image bytes", () => {
  const studio = play(generated(), { type: "field", change: { caption: "  Кофеїн займає рецептор.  " } });

  assert.deepEqual(buildFigureBlock(studio, "image-1", "Запасний опис"), {
    id: "image-1",
    type: "image",
    assetId: "asset-image-1",
    alt: "Схема рецептора",
    caption: [{ text: "Кофеїн займає рецептор." }]
  });
  assert.equal(buildFigureBlock({ ...studio, alt: "" }, "image-1", "Запасний опис")?.alt, "Запасний опис");
  assert.deepEqual(buildFigureBlock({ ...studio, caption: "" }, "image-1", "x")?.caption, [{ text: "" }]);
  assert.equal(buildFigureBlock(prepared(), "image-1", "x"), null, "nothing to insert before an image exists");
  assert.equal(buildFigureBlock(studio, "", "x"), null);
});

/* ---------- the studio on a queue item ---------- */

test("opening the studio gives an illustration its studio state once; other kinds never get one", () => {
  const rewrite = visualItem("r-1", "p-1", { recommendationType: "simplify", suggestedAction: "rewrite_text", stepId: "clarity", visualIntent: undefined });
  const state = reduce(stateWith(visualItem("v-1", "p-2"), rewrite), { type: "studio/opened", itemId: "v-1", defaults: DEFAULTS });

  assert.deepEqual(studioOf(state, "v-1"), createStudioData(DEFAULTS));
  assert.equal(reviewReducer(state, { type: "studio/opened", itemId: "v-1", defaults: { ...DEFAULTS, style: "neo_brutal" } }), state, "an existing studio is not reset");
  assert.equal(reviewReducer(state, { type: "studio/opened", itemId: "r-1", defaults: DEFAULTS }), state);
  assert.equal(reviewReducer(state, { type: "studio/opened", itemId: "nope", defaults: DEFAULTS }), state);
  assert.equal(reviewReducer(state, event("r-1", { type: "prompt/requested" })), state);
});

test("the three sources of an illustration behave the same: a pass, a chapter request and a hand-made item", () => {
  const fromPass = visualItem("v-pass", "p-1");
  const fromRequest = visualItem("v-request", "p-2", { stepId: "final_editing" });
  const manual = visualItem("v-manual", "p-3", { origin: "manual", stepId: undefined });
  let state = stateWith(fromPass, fromRequest, manual);

  assert.deepEqual([fromPass, fromRequest, manual].map(getItemKind), ["visual", "visual", "visual"]);
  assert.deepEqual([fromPass, fromRequest, manual].map(getItemSource), ["visual", "request", "request"]);
  assert.deepEqual([fromPass, fromRequest, manual].map(getItemPassId), ["visual", null, null]);

  for (const entry of [fromPass, fromRequest, manual]) {
    assert.equal(isStudioItem(entry), true);
    state = reduce(state, { type: "studio/opened", itemId: entry.id, defaults: DEFAULTS }, event(entry.id, { type: "prompt/requested" }), event(entry.id, ready()));
    assert.equal(getStudioPhase(studioOf(state, entry.id)), "prepared");
    assert.equal(state.items.find((candidate) => candidate.id === entry.id)!.status, "pending", "an illustration is never `ready` to be accepted from the queue");
    assert.equal(canAcceptItem(state, entry.id), false);
  }
});

test("the style and speed chosen last are remembered in the store, as v2's own choice", () => {
  let state = reduce(stateWith(visualItem("v-1", "p-2"), visualItem("v-2", "p-3")), { type: "studio/opened", itemId: "v-1", defaults: DEFAULTS });

  assert.deepEqual(state.visualPrefs, {});

  state = reduce(state, event("v-1", { type: "field", change: { style: "neo_brutal" } }));
  assert.deepEqual(state.visualPrefs, { style: "neo_brutal", quality: "fast" });

  state = reduce(state, event("v-1", { type: "field", change: { quality: "quality" } }));
  assert.deepEqual(state.visualPrefs, { style: "neo_brutal", quality: "quality" });

  // Typing does not touch the remembered choice.
  assert.equal(reduce(state, event("v-1", { type: "field", change: { prompt: "щось" } })).visualPrefs, state.visualPrefs);
  assert.deepEqual(resolveStudioDefaults({ intent: "illustration", prefs: state.visualPrefs, classicStyle: "minimal" }), {
    intent: "illustration",
    style: "neo_brutal",
    quality: "quality"
  });
});

test("insert: the illustration is decided, its image block is known, and the studio state stays on it", () => {
  const { state } = inserted(generatedState());
  const item = state.items[0]!;

  assert.equal(item.status, "applied");
  assert.equal(selectQueue(state).length, 0, "the card has left the queue");
  assert.equal(state.decisions[0]?.outcome, "accepted");
  assert.deepEqual(state.decisions[0]?.insertedBlockIds, ["fig-1"]);
  assert.equal(getFigureBlockId(state, "v-1"), "fig-1");
  assert.equal(findFigureItem(state, "fig-1")?.id, "v-1");
  assert.equal(findFigureItem(state, "some-manual-image"), null, "an image added by hand has no illustration behind it");
  assert.equal(item.studio?.prompt, PROMPT);
  assert.equal(item.studio?.asset?.assetId, "asset-image-1");
  assert.equal(isStudioItem(item), true, "its studio can be opened again");
});

test("undo of the insertion reopens the card with everything its studio had; redo decides it again", () => {
  const { state, document } = inserted(generatedState());

  const undone = reduce(state, { type: "items/reconciled", ...context(baseDocument) });
  assert.equal(undone.items[0]!.status, "pending");
  assert.equal(selectQueue(undone).length, 1);
  assert.equal(undone.decisions[0]?.undone, true);
  assert.equal(getFigureBlockId(undone, "v-1"), null);
  assert.equal(findFigureItem(undone, "fig-1"), null);
  assert.equal(getStudioPhase(studioOf(undone, "v-1")), "generated", "the image is still there to insert again");
  assert.equal(canInsertImage(studioOf(undone, "v-1"), "asset-image-1"), true);

  const redone = reduce(undone, { type: "items/reconciled", ...context(document) });
  assert.equal(redone.items[0]!.status, "applied");
  assert.equal(redone.decisions[0]?.undone, false);
  assert.equal(getFigureBlockId(redone, "v-1"), "fig-1");
});

test("reopen from an inserted figure and replace: a new image is generated on the applied item and the block keeps its id", () => {
  const { state, document } = inserted(generatedState());

  // `Змінити`: the studio of an applied illustration takes events like an open one.
  const regenerated = reduce(
    state,
    event("v-1", { type: "field", change: { style: "calm_gradient" } }),
    event("v-1", { type: "generation/requested", at: NOW }),
    event("v-1", { type: "generation/completed", assetId: "asset-image-2", mimeType: "image/png", at: NOW })
  );
  const studio = studioOf(regenerated, "v-1");

  assert.equal(regenerated.items[0]!.status, "applied");
  assert.equal(studio.asset?.assetId, "asset-image-2");
  assert.equal(canInsertImage(studio, "asset-image-2"), true);

  // The image in the block is replaced in place: the block id is the same, so the item stays applied.
  const replaced: EditorDocument = { version: 2, blocks: document.blocks.map((block) => (block.id === "fig-1" ? figureBlock("fig-1", "asset-image-2") : block)) };
  const after = reduce(regenerated, { type: "items/reconciled", ...context(replaced) });

  assert.equal(after.items[0]!.status, "applied");
  assert.equal(getFigureBlockId(after, "v-1"), "fig-1");
  // Undo of the replacement puts the old image back; the illustration is still in the text.
  assert.equal(reduce(after, { type: "items/reconciled", ...context(document) }).items[0]!.status, "applied");
});

test("an inserted figure deleted from the text puts its illustration back into the queue", () => {
  const { state, document } = inserted(generatedState());
  const removed = reduce(state, { type: "items/reconciled", ...context(without(document, "fig-1")) });

  assert.equal(removed.items[0]!.status, "pending");
  assert.equal(selectQueue(removed)[0]?.id, "v-1");
  assert.equal(removed.items[0]!.studio?.asset?.assetId, "asset-image-1");
});

test("an illustration survives edits of its paragraph and goes stale only when its place is gone", () => {
  const state = generatedState();
  const edited: EditorDocument = { version: 2, blocks: baseDocument.blocks.map((block) => (block.id === "p-2" ? paragraph("p-2", "Кофеїн блокує рецептори аденозину.") : block)) };
  const afterEdit = reduce(state, { type: "items/reconciled", ...context(edited) });

  assert.equal(afterEdit.items[0]!.status, "pending", "a reworded paragraph still has a place for the picture");
  assert.equal(afterEdit.items[0]!.anchor.fingerprint, computeAnchorFingerprint(edited, ["p-2"]));
  assert.equal(studioOf(afterEdit, "v-1").asset?.assetId, "asset-image-1");

  const gone = reduce(afterEdit, { type: "items/reconciled", ...context(without(edited, "p-2")) });
  assert.equal(gone.items[0]!.status, "stale");
  assert.equal(studioOf(gone, "v-1").prompt, PROMPT, "the studio state is not thrown away");

  const back = reduce(gone, { type: "items/reconciled", ...context(edited) });
  assert.equal(back.items[0]!.status, "pending");
});

test("a rejected illustration takes no studio events; restored, it has its studio back", () => {
  const rejected = reduce(generatedState(), { type: "item/rejected", itemId: "v-1", at: NOW });

  assert.equal(rejected.items[0]!.status, "dismissed");
  assert.equal(isStudioItem(rejected.items[0]!), false);
  assert.equal(reviewReducer(rejected, event("v-1", { type: "field", change: { prompt: "x" } })), rejected);

  const restored = reduce(rejected, { type: "item/restored", itemId: "v-1" });
  assert.equal(restored.items[0]!.status, "pending");
  assert.equal(studioOf(restored, "v-1").asset?.assetId, "asset-image-1");
});

/* ---------- opening is free; the editor's own prompt ---------- */

test("opening the studio prepares nothing: the item gets an empty, idle studio and stays unprepared", () => {
  const state = reduce(stateWith(visualItem("v-1", "p-2")), { type: "studio/opened", itemId: "v-1", defaults: DEFAULTS });
  const studio = studioOf(state, "v-1");

  assert.deepEqual(studio.promptState, { status: "idle" });
  assert.deepEqual(studio.generation, { status: "idle" });
  assert.equal(studio.prompt, "");
  assert.equal(getStudioPhase(studio), "unprepared");
  assert.equal(canGenerate(studio), false, "nothing to generate from yet");
  assert.equal(canPreparePrompt(studio), true, "the model can be asked, by its own button");
  assert.equal(isStudioTouched(studio), false);

  // Opened again after a failed or an interrupted preparation: still nothing in flight.
  const failed = reduce(state, event("v-1", { type: "prompt/requested" }), event("v-1", { type: "prompt/failed", message: "502" }));
  const reopened = reduce(failed, { type: "studio/opened", itemId: "v-1", defaults: DEFAULTS });
  assert.equal(reopened, failed);
  assert.deepEqual(studioOf(reopened, "v-1").promptState, { status: "failed", message: "502" });
});

test("a prompt the editor wrote is enough to generate, insert and never counts as written for another style", () => {
  const own = play(createStudioData(DEFAULTS), { type: "field", change: { prompt: "Чашка кави і хвиля втоми за спиною." } });

  assert.equal(own.preparedFor, null);
  assert.equal(getStudioPhase(own), "prepared");
  assert.equal(canGenerate(own), true);
  assert.equal(isPromptMismatched(play(own, { type: "field", change: { style: "neo_brutal" } })), false, "nobody prepared it for a style");
  assert.equal(canGenerate(play(own, { type: "field", change: { prompt: "   " } })), false, "blank is not a prompt");

  const done = play(own, { type: "generation/requested", at: NOW }, { type: "generation/completed", assetId: "asset-image-5", mimeType: "image/webp", at: NOW });
  assert.equal(canInsertImage(done, "asset-image-5"), true);
  assert.deepEqual(buildFigureBlock(done, "image-1", "Кофеїнова яма"), {
    id: "image-1",
    type: "image",
    assetId: "asset-image-5",
    alt: "Кофеїнова яма",
    caption: [{ text: "" }]
  });
});

/* ---------- a rerun keeps illustrations that have work in them ---------- */

const runRecord = (runId: string, stepId: "visuals" | "final_editing" = "visuals") =>
  ({
    version: 1 as const,
    capability: "cap",
    updatedAt: NOW,
    run: { runId, stepId, runMode: "replace" as const, status: "running" as const, locale: "uk" as const, pollAfterMs: 1000 }
  }) as unknown as PersistedActiveReviewRun;

function rerun(state: V2ReviewState, incoming: V2ReviewItem[], document: EditorDocument = baseDocument, passId: "visual" | "request" = "visual") {
  return reduce(
    state,
    { type: "run/requested", passId },
    { type: "run/started", passId, runMode: "replace", record: runRecord("run-2", passId === "visual" ? "visuals" : "final_editing") },
    { type: "run/completed", passId, runMode: "replace", stepRunId: "step-run-2", items: incoming, ...context(document) }
  );
}

test("what counts as work in a studio: a prompt, a caption, an image or a request in flight", () => {
  const empty = createStudioData(DEFAULTS);

  assert.equal(isStudioTouched(undefined), false);
  assert.equal(isStudioTouched(empty), false);
  assert.equal(isStudioTouched(play(empty, { type: "field", change: { style: "neo_brutal" } })), false, "a setting alone is not work");
  assert.equal(isStudioTouched(play(empty, { type: "field", change: { caption: "Підпис" } })), true);
  assert.equal(isStudioTouched(play(empty, { type: "field", change: { prompt: "Схема" } })), true);
  assert.equal(isStudioTouched(play(empty, { type: "prompt/requested" })), true);
  assert.equal(isStudioTouched(generated()), true);
});

test("a rerun of the pass keeps the inserted illustration and the one with an image, and drops only untouched cards", () => {
  // The reviewer's probe: v-1 is in the text (figure fig-1), v-2 is pending with a generated image.
  const base = reduce(
    stateWith(visualItem("v-1", "p-1"), visualItem("v-2", "p-2"), visualItem("v-3", "p-3")),
    { type: "studio/opened", itemId: "v-1", defaults: DEFAULTS },
    event("v-1", { type: "field", change: { prompt: PROMPT } }),
    event("v-1", { type: "generation/requested", at: NOW }),
    event("v-1", { type: "generation/completed", assetId: "asset-image-1", mimeType: "image/png", at: NOW }),
    { type: "studio/opened", itemId: "v-2", defaults: DEFAULTS },
    event("v-2", { type: "field", change: { prompt: "Друга схема" } }),
    event("v-2", { type: "generation/requested", at: NOW }),
    event("v-2", { type: "generation/completed", assetId: "asset-image-2", mimeType: "image/png", at: NOW })
  );
  const { state: before, document } = inserted(base, "v-1", "p-1");

  assert.equal(isKeptOnReplace(before.items.find((entry) => entry.id === "v-1")!), true);
  assert.equal(isKeptOnReplace(before.items.find((entry) => entry.id === "v-2")!), true);
  assert.equal(isKeptOnReplace(before.items.find((entry) => entry.id === "v-3")!), false);

  // The new run suggests again for p-1 and p-2 (already taken) and something new for p-3.
  const after = rerun(before, [visualItem("n-1", "p-1"), visualItem("n-2", "p-2"), visualItem("n-3", "p-3", { title: "Нова пропозиція" })], document);

  assert.deepEqual(after.items.map((entry) => entry.id), ["v-1", "v-2", "n-3"]);
  assert.equal(findFigureItem(after, "fig-1")?.id, "v-1", "`Змінити` still opens the studio of the inserted figure");
  assert.equal(findFigureItem(after, "fig-1")?.studio?.prompt, PROMPT);
  assert.equal(studioOf(after, "v-2").asset?.assetId, "asset-image-2", "the generated image did not disappear");
  assert.equal(after.items.find((entry) => entry.id === "v-2")!.status, "pending");
  assert.equal(after.items.find((entry) => entry.id === "n-3")!.title, "Нова пропозиція", "the untouched card was replaced");
  assert.equal(after.passes.visual?.status, "done");
});

test("a rerun keeps an illustration with a request in flight or with typed text, so no answer lands in an orphan", () => {
  const base = reduce(
    stateWith(visualItem("v-1", "p-1"), visualItem("v-2", "p-2"), visualItem("v-3", "p-3")),
    { type: "studio/opened", itemId: "v-1", defaults: DEFAULTS },
    event("v-1", { type: "prompt/requested" }),
    { type: "studio/opened", itemId: "v-2", defaults: DEFAULTS },
    event("v-2", { type: "field", change: { caption: "Мій підпис" } }),
    { type: "studio/opened", itemId: "v-3", defaults: DEFAULTS }
  );
  const after = rerun(base, [visualItem("n-1", "p-1"), visualItem("n-3", "p-3")]);

  assert.deepEqual(after.items.map((entry) => entry.id), ["v-1", "v-2", "n-3"], "v-3 was only opened, never worked on");

  const answered = reduce(after, event("v-1", ready()));
  assert.equal(studioOf(answered, "v-1").prompt, PROMPT, "the answer finds its illustration");
});

test("a suggestion for the same insertion point as a kept illustration is not a second card", () => {
  const base = reduce(
    stateWith(visualItem("v-1", "p-2")),
    { type: "studio/opened", itemId: "v-1", defaults: DEFAULTS },
    event("v-1", { type: "field", change: { prompt: PROMPT } })
  );
  // Other anchored paragraphs, the same place for the picture.
  const wider = visualItem("n-1", "p-1", { anchor: { ...visualItem("x", "p-1").anchor, blockIds: ["p-1", "p-2"], fingerprint: computeAnchorFingerprint(baseDocument, ["p-1", "p-2"]) }, insertionPoint: { mode: "after", anchorBlockId: "p-2" } });
  const after = rerun(base, [wider, visualItem("n-2", "p-3")]);

  assert.deepEqual(after.items.map((entry) => entry.id), ["v-1", "n-2"]);
});

test("a rejected illustration and other kinds are replaced by a rerun as before", () => {
  const rejected = reduce(generatedState(), { type: "item/rejected", itemId: "v-1", at: NOW });
  assert.deepEqual(rerun(rejected, [visualItem("n-1", "p-3")]).items.map((entry) => entry.id), ["n-1"]);

  const rewrite = visualItem("r-1", "p-1", { recommendationType: "simplify", suggestedAction: "rewrite_text", stepId: "visuals", visualIntent: undefined });
  assert.equal(isKeptOnReplace(rewrite), false);
});

test("a new chapter request keeps its earlier illustrations the same way", () => {
  const base = reduce(
    stateWith(visualItem("q-1", "p-2", { stepId: "final_editing" }), visualItem("q-2", "p-3", { stepId: "final_editing" })),
    { type: "studio/opened", itemId: "q-1", defaults: DEFAULTS },
    event("q-1", { type: "field", change: { prompt: PROMPT } }),
    event("q-1", { type: "generation/requested", at: NOW }),
    event("q-1", { type: "generation/completed", assetId: "asset-image-1", mimeType: "image/png", at: NOW })
  );
  const after = rerun(base, [visualItem("q-new", "p-1", { stepId: "final_editing" })], baseDocument, "request");

  assert.deepEqual(after.items.map((entry) => entry.id), ["q-new", "q-1"]);
  assert.equal(studioOf(after, "q-1").asset?.assetId, "asset-image-1");
});

/* ---------- ghost figure ---------- */

const FIGURE_COPY: FigureMarkCopy = {
  label: (intent) => `Візуал · ${intent === "infographic" ? "Інфографіка" : "Ілюстрація"}`,
  action: "Відкрити студію",
  notes: { preparing: "Готую…", generating: "Генерую…", generated: "Зображення готове.", stale: "Треба згенерувати знову.", generation_failed: "Не згенеровано." }
};
const marksOf = (state: V2ReviewState) => buildItemMarks(state, { locale: "uk", getDiff: () => undefined, figure: FIGURE_COPY });

test("a pending illustration is a ghost figure after its anchor: intent label, title and the studio button", () => {
  const [mark] = marksOf(stateWith(visualItem("v-1", "p-2", { visualIntent: "illustration" })));

  assert.deepEqual(mark?.ghost, {
    type: "figure",
    anchorBlockId: "p-2",
    label: "Візуал · Ілюстрація",
    title: "Кофеїн займає місце аденозину",
    action: "Відкрити студію",
    enabled: true
  });
  assert.equal(mark?.tone, "visual");
  assert.deepEqual(mark?.blockIds, [], "the figure stands for the item; the paragraph itself is not marked");
  assert.equal(mark?.state, "pending");
});

test("the ghost figure follows the studio: chosen intent, typed caption, and a word about where the image is", () => {
  let state = reduce(
    generatedState(),
    event("v-1", { type: "field", change: { caption: "Кофеїн займає рецептор." } }),
    event("v-1", { type: "field", change: { intent: "illustration" } })
  );
  let ghost = marksOf(state)[0]?.ghost;

  assert.equal(ghost?.type === "figure" && ghost.label, "Візуал · Ілюстрація");
  assert.equal(ghost?.type === "figure" && ghost.caption, "Кофеїн займає рецептор.");
  assert.equal(ghost?.type === "figure" && ghost.note, "Треба згенерувати знову.");

  state = reduce(state, event("v-1", { type: "generation/requested", at: NOW }));
  ghost = marksOf(state)[0]?.ghost;
  assert.equal(ghost?.type === "figure" && ghost.note, "Генерую…");
  assert.equal(marksOf(state)[0]?.state, "preparing");

  state = reduce(state, event("v-1", { type: "generation/completed", assetId: "asset-image-2", mimeType: "image/png", at: NOW }));
  ghost = marksOf(state)[0]?.ghost;
  assert.equal(ghost?.type === "figure" && ghost.note, "Зображення готове.");
});

test("no ghost figure for an inserted, rejected or stale illustration, and none without words for it", () => {
  const { state } = inserted(generatedState());
  assert.deepEqual(marksOf(state), [], "the real figure is in the text now");

  assert.deepEqual(marksOf(reduce(generatedState(), { type: "item/rejected", itemId: "v-1", at: NOW })), []);

  const stale = marksOf(stateWith(visualItem("v-1", "p-2", { status: "stale" })));
  assert.equal(stale[0]?.ghost, undefined);
  assert.equal(stale[0]?.state, "stale");

  const plain = buildItemMarks(stateWith(visualItem("v-1", "p-2")), { locale: "uk", getDiff: () => undefined });
  assert.equal(plain[0]?.ghost, undefined);
  assert.deepEqual(plain[0]?.blockIds, ["p-2"]);
});

test("in quiet mode only the current illustration is expanded; the others are dim", () => {
  const state = reduce(stateWith(visualItem("v-1", "p-1"), visualItem("v-2", "p-3")), { type: "quiet/set", quiet: true });
  const marks = marksOf(state);

  assert.equal(state.focusId, "v-1");
  assert.equal(marks.find((mark) => mark.itemId === "v-1")?.dim, undefined);
  assert.equal(marks.find((mark) => mark.itemId === "v-2")?.dim, true);
});

/* ---------- quiet mode, bulk accept, run-all ---------- */

test("quiet mode never prepares or generates an illustration on its own", () => {
  const rewrite = visualItem("r-1", "p-3", { recommendationType: "simplify", suggestedAction: "rewrite_text", stepId: "clarity", visualIntent: undefined });
  const state = reduce(stateWith(visualItem("v-1", "p-1"), visualItem("v-2", "p-2"), rewrite), { type: "quiet/set", quiet: true });

  assert.equal(state.focusId, "v-1");
  assert.deepEqual(selectQuietPreparationTargets(state), [], "the current and the next item are illustrations");
  assert.deepEqual(planQuietPreparation(state, { focusedSince: 0, now: QUIET_DWELL_MS * 10, autoInFlight: 0 }), []);

  const onSecond = reduce(state, { type: "focus/moved", delta: 1 });
  assert.equal(onSecond.focusId, "v-2");
  assert.deepEqual(selectQuietPreparationTargets(onSecond), ["r-1"], "only the rewrite next to it is prepared ahead");

  assert.equal(canAcceptItem(state, "v-1"), false, "Enter cannot accept an illustration: it opens the studio");
  assert.equal(canAcceptItem(generatedState(), "v-1"), false, "also not one whose image is ready");
});

test("bulk accept never includes illustrations", () => {
  const state = reduce(generatedState(), { type: "filter/set", filter: "visual" });

  assert.equal(BULK_PASSES.has("visual"), false);
  assert.equal(selectQueue(state).length, 1);
  assert.deepEqual(selectBulkCandidates(state, ["v-1"]), [], "the pass is not a bulk pass");
  assert.deepEqual(selectBulkCandidates({ ...state, filter: "all" }, ["v-1"]), []);

  // A hand-made illustration shown under another filter is not swept up either.
  const mixed = { ...stateWith(visualItem("v-m", "p-1", { stepId: "structure" })), filter: "structure" as const };
  assert.deepEqual(selectBulkCandidates(mixed, ["v-m"]), []);
});

test("`Запустити всі` runs the illustrations pass too, before accents", () => {
  const live = new Set(["structure", "clarity", "interest", "formatting", "visual", "accent", "spell"]);

  assert.deepEqual(RUN_ALL_ORDER, ["structure", "clarity", "interest", "formatting", "visual", "accent"]);
  assert.deepEqual(planRunAll(createInitialReviewState(), live), { queue: RUN_ALL_ORDER, spell: true });

  const done = reduce(createInitialReviewState(), { type: "queue/set", passIds: ["visual"] });
  assert.deepEqual(done.queue, ["visual"], "the pass can wait in the launch queue");
});

/* ---------- persistence ---------- */

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
}

/** Writes the state into a v2 draft and reads it back, as a reload does. */
function reload(state: V2ReviewState, document: EditorDocument = baseDocument): { state: V2ReviewState; raw: string } {
  const storage = memoryStorage();
  writeV2Draft(storage, "uk", createV2Draft(document, null, serializeReviewState(state)));
  const raw = storage.getItem("orest-v2-draft-uk-v1")!;
  const draft = readV2Draft(storage, "uk")!;

  return { raw, state: reduce(createInitialReviewState(), { type: "hydrate", persisted: draft.review ?? null }, { type: "items/reconciled", ...context(draft.document) }) };
}

test("the studio state on an item survives a reload: prompt edits, caption, settings, the generated asset and staleness", () => {
  const before = reduce(
    generatedState(),
    event("v-1", { type: "field", change: { caption: "Кофеїн займає рецептор аденозину." } }),
    event("v-1", { type: "field", change: { prompt: `${PROMPT} Підписи українською.` } }),
    event("v-1", { type: "field", change: { style: "neo_brutal" } })
  );
  const { state } = reload(before);
  const studio = studioOf(state, "v-1");

  assert.deepEqual(studio, studioOf(before, "v-1"));
  assert.equal(isStudioStale(studio), true, "still marked as not matching");
  assert.equal(isPromptMismatched(studio), true);
  assert.equal(canInsertImage(studio, "asset-image-1"), false);
  assert.deepEqual(state.visualPrefs, { style: "neo_brutal", quality: "fast" });
  assert.equal(state.items[0]!.status, "pending");
});

test("the draft holds asset ids only: no image bytes, however the image arrived", () => {
  const { raw, state } = reload(generatedState());

  assert.doesNotMatch(raw, /data:image/i);
  assert.doesNotMatch(raw, /base64/i);
  assert.match(raw, /"assetId":"asset-image-1"/);
  assert.ok(raw.length < 6000, `the draft stays small (${raw.length} characters)`);
  assert.equal(studioOf(state, "v-1").asset?.assetId, "asset-image-1");
});

test("an inserted figure and its illustration survive a reload, so `Змінити` still finds the studio", () => {
  const { state: applied, document } = inserted(generatedState());
  const { state } = reload(applied, document);

  assert.equal(state.items[0]!.status, "applied");
  assert.equal(findFigureItem(state, "fig-1")?.id, "v-1");
  assert.equal(getFigureBlockId(state, "v-1"), "fig-1");
  assert.equal(findFigureItem(state, "fig-1")?.studio?.prompt, PROMPT);
});

test("nothing is in flight after a reload: a preparation is simply not prepared, a generation is interrupted", () => {
  const preparing = reduce(stateWith(visualItem("v-1", "p-2")), { type: "studio/opened", itemId: "v-1", defaults: DEFAULTS }, event("v-1", { type: "prompt/requested" }));
  const afterPrepare = studioOf(reload(preparing).state, "v-1");

  assert.deepEqual(afterPrepare.promptState, { status: "idle" });
  assert.equal(getStudioPhase(afterPrepare), "unprepared");
  assert.equal(afterPrepare.prompt, "", "nothing is filled in on its own");

  // The image request was waiting for its answer: the answer is lost, and nothing can send it again.
  const waiting = reduce(generatedState(), event("v-1", { type: "generation/requested", at: NOW }));
  const { state, raw } = reload(waiting);
  const after = studioOf(state, "v-1");

  assert.doesNotMatch(raw, /"status":"generating"/, "the draft never says a generation is running");
  assert.deepEqual(after.generation, { status: "interrupted" });
  assert.equal(getStudioPhase(after), "generation_failed");
  assert.equal(after.asset?.assetId, "asset-image-1", "the earlier image is kept");
  assert.equal(canGenerate(after), true, "it can be asked for again, by the editor");

  // A draft written by a build that kept a job reference is read the same way: no job is picked up.
  const legacy = coerceStudioData({ ...JSON.parse(JSON.stringify(after)), generation: { status: "generating", jobId: "job-7", jobStatus: "processing", startedAt: NOW, signature: "x" } });
  assert.deepEqual(legacy?.generation, { status: "interrupted" });
});

test("serializing a settled studio returns the same object; failures keep their message", () => {
  const settled = generated();
  assert.equal(serializeStudioData(settled), settled);

  const failed = play(prepared(), { type: "generation/requested", at: NOW }, { type: "generation/failed", message: "Gemini image повернув статус 429." });
  assert.deepEqual(coerceStudioData(JSON.parse(JSON.stringify(serializeStudioData(failed)))), failed);

  const promptFailed = play(createStudioData(DEFAULTS), { type: "prompt/requested" }, { type: "prompt/failed", message: "Немає ключа." });
  assert.deepEqual(coerceStudioData(JSON.parse(JSON.stringify(promptFailed))), promptFailed);
});

test("a damaged studio section never breaks the draft: the illustration simply starts over", () => {
  assert.equal(coerceStudioData(null), undefined);
  assert.equal(coerceStudioData({ intent: "infographic" }), undefined, "no prompt field");

  const repaired = coerceStudioData({ prompt: "Схема", intent: "hologram", style: "vaporwave", quality: "ultra", asset: { assetId: 5 }, generation: { status: "generating" }, promptState: { status: "preparing" } });
  assert.deepEqual(repaired, {
    intent: "infographic",
    style: DEFAULT_VISUAL_STYLE_PRESET,
    quality: DEFAULT_VISUAL_IMAGE_QUALITY,
    prompt: "Схема",
    alt: "",
    caption: "",
    preparedFor: null,
    promptState: { status: "idle" },
    asset: null,
    generation: { status: "interrupted" }
  });

  const persisted = coercePersistedReview({
    items: [{ ...visualItem("v-1", "p-2"), studio: "garbage" }, { ...visualItem("r-1", "p-1", { recommendationType: "simplify" }), studio: createStudioData(DEFAULTS) }],
    visualPrefs: { style: "vaporwave", quality: "quality" }
  })!;

  assert.equal(persisted.items.length, 2, "both items are kept");
  assert.equal("studio" in persisted.items[0]!, false);
  assert.equal("studio" in persisted.items[1]!, false, "only an illustration has a studio");
  assert.deepEqual(persisted.visualPrefs, { quality: "quality" });
  assert.deepEqual(coerceVisualPrefs(undefined), {});
});

test("a Milestone 4 draft opens as before: its visual cards have no studio yet and get one when it is opened", () => {
  // As stored by the previous milestone: a hand-made visual item and a chapter-request one, no studio fields.
  const stored = {
    passes: { clarity: { status: "done", lastRunItemCount: 1 } },
    items: [visualItem("local-item-1", "p-2", { origin: "manual", stepId: undefined }), visualItem("req-1", "p-3", { stepId: "final_editing" })],
    proposals: {},
    decisions: [],
    rejectedIdeas: [],
    activeRun: null,
    filter: "all",
    quiet: false,
    queue: []
  };
  const persisted = coercePersistedReview(JSON.parse(JSON.stringify(stored)))!;
  const state = reduce(createInitialReviewState(), { type: "hydrate", persisted }, { type: "items/reconciled", ...context() });

  assert.deepEqual(persisted.visualPrefs, {});
  assert.deepEqual(state.visualPrefs, {});
  assert.deepEqual(state.items.map((entry) => [entry.id, entry.status, entry.studio]), [
    ["local-item-1", "pending", undefined],
    ["req-1", "pending", undefined]
  ]);
  assert.equal(marksOf(state).every((mark) => mark.ghost?.type === "figure"), true, "both are ghost figures now");

  const opened = reduce(state, { type: "studio/opened", itemId: "local-item-1", defaults: resolveStudioDefaults({ intent: state.items[0]!.visualIntent, prefs: state.visualPrefs }) });
  assert.equal(getStudioPhase(studioOf(opened, "local-item-1")), "unprepared");
});

test("studio changes are written to the draft; opening the studio alone creates state worth keeping too", () => {
  assert.equal(shouldPersistAfter(event("v-1", { type: "field", change: { prompt: "x" } })), true);
  assert.equal(shouldPersistAfter({ type: "studio/opened", itemId: "v-1", defaults: DEFAULTS }), true);
});
