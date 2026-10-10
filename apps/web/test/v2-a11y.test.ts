import test from "node:test";
import assert from "node:assert/strict";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { getNextRegion, getTabForKey, planAnnouncements, type V2Region } from "../lib/v2/a11y.ts";
import { getV2Copy } from "../lib/v2/copy.ts";
import { getSaveDelay, getV2HotkeyAction, isPageShortcutBlocked, LONG_DOCUMENT_SIZE, SAVE_DELAY_LONG_MS, SAVE_DELAY_MS } from "../lib/v2/hotkeys.ts";
import type { V2ReviewItem } from "../lib/v2/item-kinds.ts";
import { buildItemMarks, stabilizeMarks } from "../lib/v2/item-marks.ts";
import type { ReviewMark } from "../lib/v2/review-marks.ts";
import { createInitialReviewState, reviewReducer, selectStaleVisuals, shouldPersistAfter, type V2ReviewAction, type V2ReviewState } from "../lib/v2/store.ts";
import { createStudioData } from "../lib/v2/studio.ts";

const copy = getV2Copy("uk");
const p = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });
const document: EditorDocument = { version: 2, blocks: [p("p-1", "Перший абзац про сон."), p("p-2", "Другий абзац про каву."), p("p-3", "Третій абзац.")] };
const context = (doc: EditorDocument = document) => ({ document: doc, revision: deriveManuscriptRevisionState(doc) });

function item(id: string, blockId: string, overrides: Partial<V2ReviewItem> = {}): V2ReviewItem {
  return {
    id,
    reviewSessionId: "s",
    documentRevisionId: deriveManuscriptRevisionState(document).documentRevisionId,
    changeLevel: 5,
    title: id,
    reason: "Причина.",
    recommendation: "Що зробити.",
    recommendationType: "simplify",
    suggestedAction: "rewrite_text",
    priority: "medium",
    anchor: { blockIds: [blockId], generationBlockRange: { start: 1, end: 1 }, excerpt: "…", fingerprint: computeAnchorFingerprint(document, [blockId]) },
    insertionPoint: { mode: "replace", anchorBlockId: blockId },
    origin: "review",
    stepId: "clarity",
    stepRunId: "run",
    status: "pending",
    ...overrides
  } as V2ReviewItem;
}

const visual = (id: string, blockId: string, overrides: Partial<V2ReviewItem> = {}) =>
  item(id, blockId, {
    recommendationType: "visual",
    suggestedAction: "prepare_visual",
    stepId: "visuals",
    insertionPoint: { mode: "after", anchorBlockId: blockId },
    visualIntent: "infographic",
    ...overrides
  } as Partial<V2ReviewItem>);

function hydrated(items: V2ReviewItem[], doc: EditorDocument = document): V2ReviewState {
  const state = reviewReducer(createInitialReviewState(), {
    type: "hydrate",
    persisted: { passes: {}, items, proposals: {}, decisions: [], rejectedIdeas: [], activeRun: null, filter: "all", quiet: false }
  });
  return reviewReducer(state, { type: "items/reconciled", ...context(doc) });
}

const reduce = (state: V2ReviewState, ...actions: V2ReviewAction[]) => actions.reduce(reviewReducer, state);

/* ---------- tabs ---------- */

test("arrow keys walk the tabs and wrap; Home and End jump; other keys do nothing", () => {
  const tabs = ["overview", "edits", "ask"] as const;

  assert.equal(getTabForKey(tabs, "overview", "ArrowRight"), "edits");
  assert.equal(getTabForKey(tabs, "ask", "ArrowRight"), "overview");
  assert.equal(getTabForKey(tabs, "overview", "ArrowLeft"), "ask");
  assert.equal(getTabForKey(tabs, "edits", "Home"), "overview");
  assert.equal(getTabForKey(tabs, "edits", "End"), "ask");
  assert.equal(getTabForKey(tabs, "edits", "Enter"), null);
  assert.equal(getTabForKey(tabs, "edits", "a"), null);
});

/* ---------- parts of the page ---------- */

test("F6 moves between the text, the panel and the message, skipping what is not there", () => {
  const all = new Set<V2Region>(["manuscript", "panel", "toast"]);
  const noToast = new Set<V2Region>(["manuscript", "panel"]);

  assert.equal(getNextRegion("manuscript", all), "panel");
  assert.equal(getNextRegion("panel", all), "toast");
  assert.equal(getNextRegion("toast", all), "manuscript");
  assert.equal(getNextRegion("panel", noToast), "manuscript");
  assert.equal(getNextRegion("manuscript", all, true), "toast");
  assert.equal(getNextRegion(null, all), "manuscript");
  assert.equal(getNextRegion(null, all, true), "toast");
  assert.equal(getNextRegion("toast", noToast), "manuscript", "from a part that has gone, to the first one");
  assert.equal(getNextRegion("panel", new Set()), null);
});

/* ---------- page shortcuts ---------- */

const key = (init: Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...init
});

test("the page shortcuts", () => {
  assert.equal(getV2HotkeyAction(key({ key: "h", code: "KeyH", ctrlKey: true })), "replace");
  assert.equal(getV2HotkeyAction(key({ key: "h", code: "KeyH", metaKey: true })), "replace");
  // A Ukrainian layout: the key at H's place types «р».
  assert.equal(getV2HotkeyAction(key({ key: "р", code: "KeyH", ctrlKey: true })), "replace");
  assert.equal(getV2HotkeyAction(key({ key: "h", code: "KeyH" })), null);
  assert.equal(getV2HotkeyAction(key({ key: "h", code: "KeyH", ctrlKey: true, shiftKey: true })), null);
  assert.equal(getV2HotkeyAction(key({ key: "/", code: "Slash", ctrlKey: true })), "hotkeys");
  assert.equal(getV2HotkeyAction(key({ key: ".", code: "Slash", ctrlKey: true })), "hotkeys");
  assert.equal(getV2HotkeyAction(key({ key: "/", code: "Slash" })), null);
  assert.equal(getV2HotkeyAction(key({ key: "F6" })), "region-next");
  assert.equal(getV2HotkeyAction(key({ key: "F6", shiftKey: true })), "region-previous");
  assert.equal(getV2HotkeyAction(key({ key: "F6", ctrlKey: true })), null);
  assert.equal(getV2HotkeyAction(key({ key: "F10", altKey: true })), "composer");
  assert.equal(getV2HotkeyAction(key({ key: "F10" })), null);
});

/* ---------- announcements ---------- */

test("a pass that finishes or fails is announced once; progress and a stop by the editor are not", () => {
  const running = reduce(hydrated([item("k-1", "p-1"), item("k-2", "p-2")]), { type: "run/requested", passId: "clarity" });
  assert.deepEqual(planAnnouncements(running, running, copy), []);

  const done: V2ReviewState = { ...running, passes: { clarity: { status: "done", lastRunItemCount: 2 } } };
  assert.deepEqual(planAnnouncements(running, done, copy), ["«Ясність»: готово, 2 пропозиції."]);
  assert.deepEqual(planAnnouncements(done, done, copy), []);
  assert.deepEqual(planAnnouncements(done, { ...done, hoverId: "k-1" }, copy), [], "a later change says nothing again");

  const failed: V2ReviewState = { ...running, passes: { clarity: { status: "failed", error: "Провайдер недоступний." } } };
  assert.deepEqual(planAnnouncements(running, failed, copy), ["«Ясність»: не завершено, сталася помилка."]);

  const stopped: V2ReviewState = { ...running, passes: { clarity: { status: "idle", stopped: true } } };
  assert.deepEqual(planAnnouncements(running, stopped, copy), []);

  const progress: V2ReviewState = { ...running, passes: { clarity: { status: "running", progress: { completed: 1, total: 4, percent: 25 } } } };
  assert.deepEqual(planAnnouncements(running, progress, copy), []);

  const none: V2ReviewState = { ...running, items: [], passes: { clarity: { status: "done", lastRunItemCount: 0 } } };
  assert.deepEqual(planAnnouncements(running, none, getV2Copy("en")), ["Clarity: done, no suggestions."]);
});

test("a prepared edit and a failed preparation are announced", () => {
  const base = hydrated([item("k-1", "p-1")]);
  const preparing = reduce(base, { type: "proposal/requested", item: base.items[0]! });
  assert.deepEqual(planAnnouncements(base, preparing, copy), []);

  const failed = reduce(preparing, { type: "proposal/failed", itemId: "k-1", message: "Помилка сервера." });
  assert.deepEqual(planAnnouncements(preparing, failed, copy), [copy.a11y.live.proposalFailed]);

  const ready: V2ReviewState = {
    ...preparing,
    proposals: { "k-1": { status: "ready", noOpStreak: 0, proposal: { id: "pr-1" } as never } }
  };
  assert.deepEqual(planAnnouncements(preparing, ready, copy), [copy.a11y.live.proposalReady]);
});

test("an image that completes or fails and a prompt that arrives are announced; typing in the studio and the seconds counter are not", () => {
  const studio = createStudioData({ intent: "infographic", style: "minimal" as never, quality: "fast" as never });
  const withStudio = (change: Partial<typeof studio>): V2ReviewState => ({ ...hydrated([]), items: [{ ...visual("v-1", "p-1"), studio: { ...studio, ...change } }] });

  const typing = withStudio({ prompt: "Схема" });
  assert.deepEqual(planAnnouncements(withStudio({}), typing, copy), []);

  const generating = withStudio({ prompt: "Схема", generation: { status: "generating", startedAt: "t", signature: "s" } });
  assert.deepEqual(planAnnouncements(typing, generating, copy), []);

  const ready = withStudio({ prompt: "Схема", generation: { status: "idle" }, asset: { assetId: "a-1", mimeType: "image/png", signature: "s", at: "t" } });
  assert.deepEqual(planAnnouncements(generating, ready, copy), [copy.a11y.live.imageReady]);
  assert.deepEqual(planAnnouncements(ready, ready, copy), []);

  const failed = withStudio({ prompt: "Схема", generation: { status: "failed", message: "Модель недоступна." } });
  assert.deepEqual(planAnnouncements(generating, failed, copy), [copy.a11y.live.imageFailed]);

  const cancelled = withStudio({ prompt: "Схема", generation: { status: "cancelled" } });
  assert.deepEqual(planAnnouncements(generating, cancelled, copy), []);

  const preparing = withStudio({ promptState: { status: "preparing" } });
  const prepared = withStudio({ prompt: "Готовий промпт", preparedFor: { intent: "infographic", style: "minimal" as never }, promptState: { status: "idle" } });
  assert.deepEqual(planAnnouncements(preparing, prepared, copy), [copy.a11y.live.promptReady]);
  assert.deepEqual(planAnnouncements(preparing, withStudio({ promptState: { status: "idle" } }), copy), [], "a cancelled preparation is silent");
  assert.deepEqual(planAnnouncements(preparing, withStudio({ promptState: { status: "failed", message: "x" } }), copy), [copy.a11y.live.promptFailed]);
});

/* ---------- stale illustrations have a way out ---------- */

test("illustrations that lost their place are dismissed in one step, without becoming rejected ideas", () => {
  const withoutP2: EditorDocument = { version: 2, blocks: document.blocks.filter((block) => block.id !== "p-2") };
  const touched = createStudioData({ intent: "infographic", style: "minimal" as never, quality: "fast" as never });
  let state = hydrated([visual("v-1", "p-2", { studio: { ...touched, prompt: "Схема" } }), visual("v-2", "p-2"), visual("v-3", "p-3"), item("k-1", "p-2")], document);
  state = reduce(state, { type: "items/reconciled", ...context(withoutP2) });

  assert.deepEqual(selectStaleVisuals(state).map((entry) => entry.id), ["v-1", "v-2"]);

  const dismissed = reduce(state, { type: "items/staleDismissed", at: "2026-10-09T10:00:00.000Z" });
  assert.deepEqual(selectStaleVisuals(dismissed), []);
  assert.equal(dismissed.items.find((entry) => entry.id === "v-1")!.status, "dismissed");
  assert.equal(dismissed.items.find((entry) => entry.id === "v-2")!.status, "dismissed");
  assert.equal(dismissed.items.find((entry) => entry.id === "v-3")!.status, "pending", "an illustration that still has its place stays");
  assert.equal(dismissed.items.find((entry) => entry.id === "k-1")!.status, "stale", "other kinds are not touched");
  assert.deepEqual(dismissed.rejectedIdeas, [], "the model is not told these ideas were rejected");
  assert.equal(dismissed.decisions.filter((decision) => decision.outcome === "rejected").length, 2);
  assert.equal(shouldPersistAfter({ type: "items/staleDismissed", at: "t" }), true);
  assert.equal(reduce(dismissed, { type: "items/staleDismissed", at: "t" }), dismissed, "nothing left to dismiss");

  // The whole batch can be taken back: each card returns as it was, with what its studio held.
  const restored = reduce(dismissed, { type: "item/restored", itemId: "v-1" }, { type: "item/restored", itemId: "v-2" });
  assert.deepEqual(selectStaleVisuals(restored).map((entry) => entry.id), ["v-1", "v-2"]);
  assert.equal(restored.items.find((entry) => entry.id === "v-1")!.studio?.prompt, "Схема", "the prompt came back with the card");
  assert.equal(restored.decisions.filter((decision) => decision.outcome === "rejected").length, 0);
  assert.deepEqual(restored.rejectedIdeas, []);
});

test("no page shortcut acts while a modal dialog is open or the key was pressed inside a dialog", () => {
  const outside = { closest: () => null };
  const insideDialog = { closest: (selector: string) => (selector.includes("dialog") ? {} : null) };
  const open = { modalOpen: false, studioOpen: false, dialogInDocument: false, target: outside };

  assert.equal(isPageShortcutBlocked(open), false);
  assert.equal(isPageShortcutBlocked({ ...open, target: null }), false);
  assert.equal(isPageShortcutBlocked({ ...open, modalOpen: true }), true, "history, replace, hotkeys, a confirmation");
  assert.equal(isPageShortcutBlocked({ ...open, studioOpen: true }), true);
  assert.equal(isPageShortcutBlocked({ ...open, dialogInDocument: true }), true, "a dialog the page state does not know about");
  assert.equal(isPageShortcutBlocked({ ...open, target: insideDialog }), true);
});

/* ---------- performance helpers ---------- */

test("marks that say the same are the same array, so the editor does not redraw them", () => {
  const state = hydrated([item("k-1", "p-1"), visual("v-1", "p-2"), item("a-1", "p-3", { stepId: "emphasis", recommendationType: "rewrite", emphasisTarget: { text: "абзац", occurrence: 1 } } as Partial<V2ReviewItem>)]);
  const options = { locale: "uk" as const, getDiff: () => undefined };
  const first = buildItemMarks(state, options);
  const again = buildItemMarks(state, options);

  assert.notEqual(first, again);
  assert.equal(stabilizeMarks(first, again), first, "an identical rebuild keeps the previous array");
  assert.equal(stabilizeMarks(first, first), first);

  // A key typed in the studio, a refine instruction: the state changes, the marks do not.
  const typed = reduce(state, { type: "instruction/set", itemId: "k-1", text: "коротше" });
  assert.equal(stabilizeMarks(first, buildItemMarks(typed, options)), first);

  // Focus, hover and a decision do change them.
  const focused = buildItemMarks(reduce(state, { type: "focus/set", itemId: "k-1" }), options);
  assert.equal(stabilizeMarks(first, focused), focused);
  const hovered = buildItemMarks(reduce(state, { type: "hover/set", itemId: "v-1" }), options);
  assert.equal(stabilizeMarks(first, hovered), hovered);
  const fewer = buildItemMarks(reduce(state, { type: "item/rejected", itemId: "k-1", at: "t" }), options);
  assert.equal(stabilizeMarks(first, fewer), fewer);

  const withDiff = (diff: ReviewMark["diff"]): ReviewMark[] => first.map((mark, index) => (index === 0 ? { ...mark, diff } : mark));
  const diff = [{ kind: "remove", blockId: "p-1" }] as ReviewMark["diff"];
  assert.equal(stabilizeMarks(withDiff(diff), withDiff(diff)).length, first.length);
  assert.notEqual(stabilizeMarks(first, withDiff(diff)), first, "a prepared diff is a change");
});

test("a long chapter is saved less often than a short one", () => {
  assert.equal(getSaveDelay(0), SAVE_DELAY_MS);
  assert.equal(getSaveDelay(LONG_DOCUMENT_SIZE - 1), SAVE_DELAY_MS);
  assert.equal(getSaveDelay(LONG_DOCUMENT_SIZE), SAVE_DELAY_LONG_MS);
  assert.equal(getSaveDelay(140_000), SAVE_DELAY_LONG_MS);
  assert.ok(SAVE_DELAY_LONG_MS > SAVE_DELAY_MS && SAVE_DELAY_LONG_MS <= 1500, "long enough to skip typing pauses, short enough not to lose work");
});

/* ---------- the ghost heading keeps its level and its input while a new title is typed ---------- */

test("typing a new title into an emptied ghost heading keeps its level, so the input being typed in is not re-created", () => {
  const heading = item("s-1", "p-2", {
    recommendationType: "subsection",
    stepId: "structure",
    insertionPoint: { mode: "before", anchorBlockId: "p-2" },
    headingLevel: 2,
    subsectionDraft: { title: "Як кофеїн обманює мозок", headingLevel: 2, prompt: "" },
    status: "ready"
  } as Partial<V2ReviewItem>);
  const options = { locale: "uk" as const, getDiff: () => undefined };
  const ghostOf = (state: V2ReviewState) => buildItemMarks(state, options).find((mark) => mark.itemId === "s-1")?.ghost;
  let state = reduce(hydrated([heading]), { type: "focus/set", itemId: "s-1" });

  assert.deepEqual([ghostOf(state)?.type, (ghostOf(state) as { level?: number }).level], ["heading", 2]);

  state = reduce(state, { type: "item/headingEdited", itemId: "s-1", title: "" });
  assert.equal((ghostOf(state) as { level?: number; editable?: boolean }).level, 2, "emptied: still H2, still editable");
  assert.equal((ghostOf(state) as { editable?: boolean }).editable, true);

  state = reduce(state, { type: "item/headingEdited", itemId: "s-1", title: "Н" });
  assert.equal(state.items[0]!.subsectionDraft?.headingLevel, 2, "the first letter of the new title does not flip the level");
  assert.equal(state.items[0]!.headingLevel, 2);
  assert.equal((ghostOf(state) as { level?: number }).level, 2);

  // The level changes only when the editor asks for it.
  state = reduce(state, { type: "item/headingEdited", itemId: "s-1", headingLevel: 3 });
  assert.equal((ghostOf(state) as { level?: number }).level, 3);
  state = reduce(state, { type: "item/headingEdited", itemId: "s-1", title: "" }, { type: "item/headingEdited", itemId: "s-1", title: "Нова" });
  assert.equal(state.items[0]!.subsectionDraft?.headingLevel, 3);
});
