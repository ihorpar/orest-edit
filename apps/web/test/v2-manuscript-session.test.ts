import test from "node:test";
import assert from "node:assert/strict";

import type { Block, EditorDocument } from "../lib/editor/document-model.ts";
import { getEditorDraftStorageKey } from "../lib/i18n/product-locale.ts";
import {
  createV2Draft,
  getV2DraftStorageKey,
  inspectV2Draft,
  loadInitialV2Draft,
  restartUnreadableV2Draft,
  writeV2Draft,
  writeV2DraftIfUnchanged
} from "../lib/v2/draft-storage.ts";
import { buildHistoryEntry } from "../lib/v2/history.ts";
import { getV2Copy } from "../lib/v2/copy.ts";
import {
  canRestoreSnapshot,
  createRecoverySnapshot,
  describeRecoveryPromise,
  hasManuscriptContent,
  hasReviewWork,
  INITIAL_GUARD_STATE,
  manuscriptGuardReducer,
  RECOVERY_LIMIT,
  resolveManuscriptRequest,
  type ManuscriptGuardEvent,
  type ManuscriptGuardState
} from "../lib/v2/manuscript-session.ts";
import { createInitialReviewState, serializeReviewState, type V2PersistedReview } from "../lib/v2/store.ts";

const p = (id: string, text: string): Block => ({ id, type: "paragraph", content: [{ text }] });
const document: EditorDocument = { version: 2, blocks: [p("p-1", "Перший абзац."), p("p-2", "Другий абзац.")] };
const empty: EditorDocument = { version: 2, blocks: [p("p-0", "")] };
const emptyReview = (): V2PersistedReview => serializeReviewState(createInitialReviewState());
const history = [buildHistoryEntry({ id: "h-1", kind: "replace", at: "t", before: document, after: { version: 2, blocks: [p("p-1", "Інший."), p("p-2", "Другий абзац.")] } })!];

const reduce = (state: ManuscriptGuardState, ...events: ManuscriptGuardEvent[]) => events.reduce(manuscriptGuardReducer, state);

function createStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value)
  };
}

test("what counts as a manuscript worth asking about", () => {
  assert.equal(hasManuscriptContent(document), true);
  assert.equal(hasManuscriptContent(empty), false);
  assert.equal(hasManuscriptContent({ version: 2, blocks: [p("p-0", "   ")] }), false);
  assert.equal(hasManuscriptContent({ version: 2, blocks: [{ id: "i", type: "image", assetId: "a", alt: "" }] }), true);
  assert.equal(hasManuscriptContent(null), false);
  assert.equal(hasReviewWork(emptyReview(), []), false);
  assert.equal(hasReviewWork(emptyReview(), history), true);
});

test("clearing never happens on one click: the request is held until it is confirmed", () => {
  const context = { document, review: emptyReview(), history: [] };
  assert.equal(resolveManuscriptRequest({ kind: "clear" }, context), "confirm");
  // Also an empty manuscript: the question is cheap, the answer is explicit.
  assert.equal(resolveManuscriptRequest({ kind: "clear" }, { ...context, document: empty }), "confirm");
  assert.equal(resolveManuscriptRequest({ kind: "restart" }, { document: null, review: null, history: [] }), "confirm");

  const asked = reduce(INITIAL_GUARD_STATE, { type: "requested", request: { kind: "clear" } });
  assert.deepEqual(asked.pending, { kind: "clear" });
  assert.deepEqual(asked.recovery, [], "nothing has been replaced yet");

  const cancelled = reduce(asked, { type: "cancelled" });
  assert.deepEqual(cancelled, INITIAL_GUARD_STATE, "cancelling leaves everything as it was");
});

test("opening over a manuscript asks first; opening into an empty one does not", () => {
  const open = { kind: "open", source: "file" } as const;

  assert.equal(resolveManuscriptRequest(open, { document, review: emptyReview(), history: [] }), "confirm");
  assert.equal(resolveManuscriptRequest(open, { document: empty, review: emptyReview(), history: [] }), "proceed");
  // An empty page with work beside it (history, reports) still asks.
  assert.equal(resolveManuscriptRequest(open, { document: empty, review: emptyReview(), history }), "confirm");
  assert.equal(resolveManuscriptRequest({ kind: "open", source: "clipboard" }, { document, review: null, history: [] }), "confirm");
});

const snap = (id: string, overrides: Partial<Parameters<typeof createRecoverySnapshot>[0]> = {}) =>
  createRecoverySnapshot({
    id,
    reason: "clear",
    locale: "uk",
    draftKey: getV2DraftStorageKey("uk"),
    document,
    sourceName: "Розділ.docx",
    review: emptyReview(),
    history,
    at: "2026-10-09T10:00:00.000Z",
    ...overrides
  });

test("a confirmed clear or open leaves a snapshot for the session, and bringing it back takes it off the list", () => {
  const snapshot = snap("r-1")!;
  let state = reduce(INITIAL_GUARD_STATE, { type: "requested", request: { kind: "clear" } }, { type: "confirmed" });
  assert.equal(state.pending, null);

  state = reduce(state, { type: "replaced", snapshot });
  assert.equal(state.recovery[0]?.sourceName, "Розділ.docx");
  assert.deepEqual(state.recovery[0]?.document, document);
  assert.notEqual(state.recovery[0]?.document, document, "the snapshot is a copy, not the live document");
  assert.equal(state.recovery[0]?.history.length, 1);

  // A later replacement with nothing worth keeping does not throw the snapshot away.
  state = reduce(state, { type: "replaced", snapshot: null });
  assert.equal(state.recovery.length, 1);

  assert.equal(reduce(state, { type: "restored", id: "unknown" }), state);
  state = reduce(state, { type: "restored", id: "r-1" });
  assert.deepEqual(state.recovery, []);
});

test("the session keeps the last three replaced manuscripts, newest first: a second clear does not lose the first", () => {
  const real = snap("r-real", { at: "2026-10-09T10:00:00.000Z" })!;
  const word = snap("r-word", { document: { version: 2, blocks: [p("p-1", "слово")] }, history: [], at: "2026-10-09T10:01:00.000Z" })!;
  let state = reduce(INITIAL_GUARD_STATE, { type: "replaced", snapshot: real }, { type: "replaced", snapshot: word });

  assert.deepEqual(state.recovery.map((entry) => entry.id), ["r-word", "r-real"], "the real manuscript is still there after the second clear");

  state = reduce(state, { type: "replaced", snapshot: snap("r-3")! }, { type: "replaced", snapshot: snap("r-4")! });
  assert.deepEqual(state.recovery.map((entry) => entry.id), ["r-4", "r-3", "r-word"], "only the oldest leaves when a fourth arrives");
  assert.equal(state.recovery.length, RECOVERY_LIMIT);

  // Any of the three can be brought back, not only the newest.
  state = reduce(state, { type: "restored", id: "r-3" });
  assert.deepEqual(state.recovery.map((entry) => entry.id), ["r-4", "r-word"]);
});

test("the confirmation promises exactly what will be recoverable", () => {
  const empty = INITIAL_GUARD_STATE;
  const full = reduce(empty, { type: "replaced", snapshot: snap("r-1")! }, { type: "replaced", snapshot: snap("r-2")! }, { type: "replaced", snapshot: snap("r-3")! });

  assert.deepEqual(describeRecoveryPromise({ kind: "clear" }, empty, true), { kind: "kept" });
  assert.deepEqual(describeRecoveryPromise({ kind: "open", source: "file" }, empty, true), { kind: "kept" });
  // The stored draft could not be shown: nothing is kept, and nothing is promised.
  assert.deepEqual(describeRecoveryPromise({ kind: "open", source: "file" }, empty, false), { kind: "none" });
  assert.deepEqual(describeRecoveryPromise({ kind: "restart" }, empty, true), { kind: "none" });

  const promise = describeRecoveryPromise({ kind: "clear" }, full, true);
  assert.equal(promise.kind, "kept_drops_oldest");
  assert.equal(promise.kind === "kept_drops_oldest" ? promise.dropped.id : null, "r-1", "the one that will be lost is named");

  for (const copy of [getV2Copy("uk"), getV2Copy("en")]) {
    assert.ok(copy.confirm.recoveryKept.length > 20 && copy.confirm.recoveryNone.length > 20);
    assert.notEqual(copy.confirm.recoveryKept, copy.confirm.recoveryNone);
    assert.match(copy.confirm.recoveryDropsOldest("12:30"), /12:30/);
  }
});

test("a snapshot goes back only into the language and the draft it was taken from", () => {
  const ukrainian = snap("r-uk")!;
  const english = snap("r-en", { locale: "en", draftKey: getV2DraftStorageKey("en") })!;

  assert.equal(canRestoreSnapshot(ukrainian, { locale: "uk", draftKey: getV2DraftStorageKey("uk") }), true);
  assert.equal(canRestoreSnapshot(ukrainian, { locale: "en", draftKey: getV2DraftStorageKey("en") }), false, "a Ukrainian manuscript is never written into the English draft");
  assert.equal(canRestoreSnapshot(english, { locale: "uk", draftKey: getV2DraftStorageKey("uk") }), false);
  assert.equal(canRestoreSnapshot(ukrainian, { locale: "uk", draftKey: "another-key" }), false);
});

test("when the workspace reloads for another language, nothing held for the old draft stays", () => {
  const state = reduce(INITIAL_GUARD_STATE, { type: "replaced", snapshot: snap("r-1")! }, { type: "requested", request: { kind: "clear" } });

  assert.deepEqual(reduce(state, { type: "reset" }), INITIAL_GUARD_STATE, "the pending question and the snapshots are gone");
  assert.equal(reduce(INITIAL_GUARD_STATE, { type: "reset" }), INITIAL_GUARD_STATE);
});

test("an empty manuscript with no work beside it leaves no snapshot", () => {
  assert.equal(snap("r-0", { document: empty, sourceName: null, history: [] }), null);
});

test("a snapshot never carries a run: bringing a document back cannot start or resume a paid call", () => {
  const review: V2PersistedReview = {
    ...emptyReview(),
    passes: { clarity: { status: "running" }, structure: { status: "done", lastRunItemCount: 2 } },
    steps: { diagnostics: { status: "running" } },
    queue: ["interest", "accent"],
    activeRun: { run: { runId: "run-1" } } as unknown as V2PersistedReview["activeRun"]
  };
  const snapshot = snap("r-run", { reason: "open", review, history: [] })!;

  assert.equal(snapshot.review.activeRun, null);
  assert.deepEqual(snapshot.review.queue ?? [], []);
  assert.equal(snapshot.review.passes.clarity?.status, "idle");
  assert.equal(snapshot.review.passes.structure?.status, "done");
  assert.equal(snapshot.review.steps?.diagnostics?.status, "idle");
  assert.equal(snapshot.review.quiet, false);
  assert.equal(snapshot.locale, "uk");
  assert.equal(review.activeRun !== null, true, "the live state is not touched");
});

test("a draft that still carries the retired `assets` list opens, and the list is not written back", () => {
  const key = getV2DraftStorageKey("uk");
  const storage = createStorage({ [key]: JSON.stringify({ ...createV2Draft(document, "Розділ.docx"), assets: ["asset-old-1", "asset-old-2"] }) });
  const read = inspectV2Draft(storage, "uk");

  assert.equal(read.status, "ok");
  assert.equal(read.status === "ok" ? "assets" in read.draft : true, false, "the field is ignored");
  assert.equal(read.status === "ok" ? read.draft.sourceName : null, "Розділ.docx");

  const before = storage.store.get(key);
  loadInitialV2Draft(storage, "uk");
  assert.equal(storage.store.get(key), before, "opening the page writes nothing to the draft");
});

test("an unreadable v2 draft can be started over, and only an unreadable one", () => {
  const key = getV2DraftStorageKey("uk");
  const storage = createStorage({ [key]: "{not json", [getEditorDraftStorageKey("uk")]: JSON.stringify({ document }) });
  const v1Before = storage.store.get(getEditorDraftStorageKey("uk"));

  assert.equal(loadInitialV2Draft(storage, "uk").status, "unreadable");
  assert.equal(storage.store.get(key), "{not json", "opening the page changes nothing");

  const result = restartUnreadableV2Draft(storage, "uk");
  assert.equal(result.status, "restarted");

  const loaded = loadInitialV2Draft(storage, "uk");
  assert.equal(loaded.status, "ready");
  assert.equal(loaded.status === "ready" ? loaded.source : null, "v2", "the new empty draft is a v2 draft: the classic text is not copied in again");
  assert.equal(loaded.status === "ready" ? hasManuscriptContent(loaded.draft.document) : null, false);
  assert.equal(storage.store.get(getEditorDraftStorageKey("uk")), v1Before, "the classic draft is untouched");
});

test("starting over leaves a readable or absent draft alone", () => {
  const key = getV2DraftStorageKey("uk");
  const storage = createStorage();
  assert.deepEqual(restartUnreadableV2Draft(storage, "uk"), { status: "not_needed" });
  assert.equal(storage.store.has(key), false);

  writeV2Draft(storage, "uk", createV2Draft(document, "Розділ.docx"));
  const stored = storage.store.get(key);
  assert.deepEqual(restartUnreadableV2Draft(storage, "uk"), { status: "not_needed" });
  assert.equal(storage.store.get(key), stored, "a draft another tab repaired meanwhile is never thrown away");

  // An unknown version is unreadable too, and each language has its own draft.
  storage.store.set(getV2DraftStorageKey("en"), JSON.stringify({ version: 99 }));
  assert.equal(restartUnreadableV2Draft(storage, "en").status, "restarted");
  assert.equal(storage.store.get(key), stored);
  assert.equal(inspectV2Draft(storage, "en").status, "ok");
});

test("a save that knows the exact text it wrote last skips re-reading the stored draft, and still sees another tab", () => {
  const storage = createStorage();
  let parses = 0;
  const counting = {
    getItem: (key: string) => storage.getItem(key),
    setItem: (key: string, value: string) => storage.setItem(key, value)
  };
  const realParse = JSON.parse;
  JSON.parse = ((text: string, ...rest: []) => {
    parses += 1;
    return realParse(text, ...rest);
  }) as typeof JSON.parse;

  try {
    const first = writeV2DraftIfUnchanged(counting, "uk", createV2Draft(document), null);
    assert.equal(first.status, "written");
    const raw = first.status === "written" ? first.raw : "";
    assert.equal(storage.store.get(getV2DraftStorageKey("uk")), raw);

    parses = 0;
    const second = writeV2DraftIfUnchanged(counting, "uk", createV2Draft(document), first.status === "written" ? first.updatedAt : null, raw);
    assert.equal(second.status, "written");
    assert.equal(parses, 0, "the stored draft was not parsed again");

    // Another tab wrote in between: the text differs, the full check runs and reports the conflict.
    storage.store.set(getV2DraftStorageKey("uk"), JSON.stringify({ ...createV2Draft(document), updatedAt: "2031-01-01T00:00:00.000Z" }));
    const third = writeV2DraftIfUnchanged(counting, "uk", createV2Draft(document), second.status === "written" ? second.updatedAt : null, second.status === "written" ? second.raw : null);
    assert.equal(third.status, "conflict");
  } finally {
    JSON.parse = realParse;
  }
});
