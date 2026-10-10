import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { getEditorDraftStorageKey } from "../lib/i18n/product-locale.ts";
import {
  createV2Draft,
  getV2DraftStorageKey,
  hasV2DraftChangedElsewhere,
  inspectV2Draft,
  loadInitialV2Draft,
  readV1DraftDocument,
  readV2Draft,
  writeV2Draft,
  writeV2DraftIfUnchanged,
  type V2InitialDraft
} from "../lib/v2/draft-storage.ts";

class RecordingStorage {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.writes.push(key);
    this.values.set(key, value);
  }
}

const v1Document: EditorDocument = {
  version: 2,
  blocks: [
    { id: "h-1", type: "heading", level: 1, content: [{ text: "Розділ" }] },
    { id: "p-1", type: "paragraph", content: [{ text: "Текст із v1." }] }
  ]
};

const paragraphDocument = (text: string): EditorDocument => ({
  version: 2,
  blocks: [{ id: "p-9", type: "paragraph", content: [{ text }] }]
});

function v1DraftJson(document: EditorDocument = v1Document): string {
  return JSON.stringify({ document, reviewItems: [{ id: "item-1" }], activeWorkflowStep: "clarity", history: [] });
}

function ready(initial: V2InitialDraft): Extract<V2InitialDraft, { status: "ready" }> {
  assert.equal(initial.status, "ready");
  return initial as Extract<V2InitialDraft, { status: "ready" }>;
}

test("v2 uses its own locale-scoped key, different from every v1 key", () => {
  assert.equal(getV2DraftStorageKey("uk"), "orest-v2-draft-uk-v1");
  assert.equal(getV2DraftStorageKey("en"), "orest-v2-draft-en-v1");
  assert.notEqual(getV2DraftStorageKey("uk"), getEditorDraftStorageKey("uk"));
});

test("without any draft v2 starts with one empty paragraph and writes nothing", () => {
  const storage = new RecordingStorage();
  const initial = ready(loadInitialV2Draft(storage, "uk"));

  assert.equal(initial.source, "empty");
  assert.equal(initial.persisted, false);
  assert.equal(initial.draft.document.blocks.length, 1);
  assert.equal(initial.draft.document.blocks[0]!.type, "paragraph");
  assert.deepStrictEqual(storage.writes, []);
});

test("the v1 document is copied once and the v1 draft is left byte-identical", () => {
  const storage = new RecordingStorage();
  const v1Key = getEditorDraftStorageKey("uk");
  const v1Raw = v1DraftJson();
  storage.values.set(v1Key, v1Raw);

  const first = ready(loadInitialV2Draft(storage, "uk"));
  assert.equal(first.source, "v1");
  assert.equal(first.persisted, true);
  assert.deepStrictEqual(first.draft.document, v1Document);
  assert.deepStrictEqual(storage.writes, [getV2DraftStorageKey("uk")]);
  assert.equal(storage.values.get(v1Key), v1Raw);

  const stored = JSON.parse(storage.values.get(getV2DraftStorageKey("uk"))!) as Record<string, unknown>;
  assert.deepStrictEqual(Object.keys(stored).sort(), ["document", "sourceName", "updatedAt", "version"]);

  // v2 moves on; a later change of the v1 draft must not be copied again.
  writeV2Draft(storage, "uk", createV2Draft(paragraphDocument("Правка у v2")));
  storage.values.set(v1Key, v1DraftJson({ version: 2, blocks: [{ id: "p-5", type: "paragraph", content: [{ text: "Нове у v1" }] }] }));
  const v1RawAfter = storage.values.get(v1Key);

  const second = ready(loadInitialV2Draft(storage, "uk"));
  assert.equal(second.source, "v2");
  assert.deepStrictEqual(second.draft.document, paragraphDocument("Правка у v2"));
  assert.equal(storage.values.get(v1Key), v1RawAfter);
  assert.ok(storage.writes.every((key) => key === getV2DraftStorageKey("uk")), "only the v2 key is ever written");
});

test("drafts are separate per locale", () => {
  const storage = new RecordingStorage();
  storage.values.set(getEditorDraftStorageKey("uk"), v1DraftJson());

  assert.equal(ready(loadInitialV2Draft(storage, "en")).source, "empty");
  assert.equal(readV1DraftDocument(storage, "en"), null);
  assert.equal(ready(loadInitialV2Draft(storage, "uk")).source, "v1");
  assert.equal(readV2Draft(storage, "en"), null);
});

test("a legacy un-suffixed v1 draft is read for the Ukrainian locale without being migrated", () => {
  const storage = new RecordingStorage();
  storage.values.set("orest-editor-draft-v3", v1DraftJson());

  assert.deepStrictEqual(readV1DraftDocument(storage, "uk"), v1Document);
  assert.equal(storage.values.has(getEditorDraftStorageKey("uk")), false);
  assert.deepStrictEqual(storage.writes, []);
});

test("a v2 draft round-trips with its source name", () => {
  const storage = new RecordingStorage();
  const draft = createV2Draft(v1Document, "Розділ 3.docx");

  writeV2Draft(storage, "uk", draft);
  assert.deepStrictEqual(readV2Draft(storage, "uk"), draft);
  assert.deepStrictEqual(inspectV2Draft(storage, "uk"), { status: "ok", draft });
  assert.deepStrictEqual(inspectV2Draft(storage, "en"), { status: "absent" });
});

for (const [label, raw] of [
  ["corrupt JSON", "{not json"],
  ["an unknown draft version", JSON.stringify({ version: 2, document: v1Document, updatedAt: "2026-01-01T00:00:00.000Z" })],
  ["a document of another model version", JSON.stringify({ version: 1, document: { version: 1, blocks: [] } })],
  ["an empty value", ""]
] as const) {
  test(`an unreadable v2 draft (${label}) is reported and never replaced by the v1 copy or an empty document`, () => {
    const storage = new RecordingStorage();
    storage.values.set(getV2DraftStorageKey("uk"), raw);
    storage.values.set(getEditorDraftStorageKey("uk"), v1DraftJson());

    assert.deepStrictEqual(inspectV2Draft(storage, "uk"), { status: "unreadable" });
    assert.equal(readV2Draft(storage, "uk"), null);
    assert.deepStrictEqual(loadInitialV2Draft(storage, "uk"), { status: "unreadable" });
    assert.deepStrictEqual(storage.writes, []);
    assert.equal(storage.values.get(getV2DraftStorageKey("uk")), raw);

    // An autosave attempt from a tab that still thinks it owns the draft is refused as well.
    assert.deepStrictEqual(writeV2DraftIfUnchanged(storage, "uk", createV2Draft(paragraphDocument("x")), null), { status: "conflict" });
    assert.equal(storage.values.get(getV2DraftStorageKey("uk")), raw);
  });
}

test("a broken v1 draft is ignored without touching it", () => {
  const storage = new RecordingStorage();
  storage.values.set(getEditorDraftStorageKey("uk"), "{not json");

  assert.equal(readV1DraftDocument(storage, "uk"), null);
  assert.equal(ready(loadInitialV2Draft(storage, "uk")).source, "empty");
  assert.deepStrictEqual(storage.writes, []);
});

test("a tab saves over the draft it last read or wrote, and each save gets a new updatedAt", () => {
  const storage = new RecordingStorage();

  assert.equal(hasV2DraftChangedElsewhere(storage, "uk", null), false);
  const first = writeV2DraftIfUnchanged(storage, "uk", createV2Draft(paragraphDocument("один")), null);
  assert.equal(first.status, "written");

  const firstStamp = first.status === "written" ? first.updatedAt : "";
  assert.equal(readV2Draft(storage, "uk")!.updatedAt, firstStamp);
  assert.equal(hasV2DraftChangedElsewhere(storage, "uk", firstStamp), false);

  // Same clock tick: the stamp must still change, or another tab could not see the save.
  const second = writeV2DraftIfUnchanged(storage, "uk", { ...createV2Draft(paragraphDocument("два")), updatedAt: firstStamp }, firstStamp);
  assert.equal(second.status, "written");
  assert.notEqual(second.status === "written" ? second.updatedAt : firstStamp, firstStamp);
  assert.deepStrictEqual(readV2Draft(storage, "uk")!.document, paragraphDocument("два"));
});

test("a draft saved by another tab is detected and not overwritten", () => {
  const storage = new RecordingStorage();
  const mine = writeV2DraftIfUnchanged(storage, "uk", createV2Draft(paragraphDocument("моя версія")), null);
  const myStamp = mine.status === "written" ? mine.updatedAt : "";

  // Another tab saves.
  const theirs = { ...createV2Draft(paragraphDocument("версія з іншої вкладки")), updatedAt: "2031-05-05T10:00:00.000Z" };
  writeV2Draft(storage, "uk", theirs);
  const rawTheirs = storage.values.get(getV2DraftStorageKey("uk"));

  assert.equal(hasV2DraftChangedElsewhere(storage, "uk", myStamp), true);
  assert.deepStrictEqual(writeV2DraftIfUnchanged(storage, "uk", createV2Draft(paragraphDocument("запізніла правка")), myStamp), {
    status: "conflict"
  });
  assert.equal(storage.values.get(getV2DraftStorageKey("uk")), rawTheirs);

  // After a reload the tab knows the new stamp and may save again.
  const reloaded = ready(loadInitialV2Draft(storage, "uk"));
  assert.equal(writeV2DraftIfUnchanged(storage, "uk", createV2Draft(paragraphDocument("далі")), reloaded.draft.updatedAt).status, "written");
});

test("a tab that started empty does not overwrite a draft another tab created meanwhile", () => {
  const storage = new RecordingStorage();
  const initial = ready(loadInitialV2Draft(storage, "uk"));
  assert.equal(initial.persisted, false);

  writeV2Draft(storage, "uk", createV2Draft(paragraphDocument("створено в іншій вкладці")));
  const raw = storage.values.get(getV2DraftStorageKey("uk"));

  assert.equal(hasV2DraftChangedElsewhere(storage, "uk", null), true);
  assert.equal(writeV2DraftIfUnchanged(storage, "uk", createV2Draft(paragraphDocument("x")), null).status, "conflict");
  assert.equal(storage.values.get(getV2DraftStorageKey("uk")), raw);
});

test("a draft key that was removed is not a conflict", () => {
  const storage = new RecordingStorage();
  const first = writeV2DraftIfUnchanged(storage, "uk", createV2Draft(paragraphDocument("один")), null);
  const stamp = first.status === "written" ? first.updatedAt : "";

  storage.values.delete(getV2DraftStorageKey("uk"));
  assert.equal(hasV2DraftChangedElsewhere(storage, "uk", stamp), false);
  assert.equal(writeV2DraftIfUnchanged(storage, "uk", createV2Draft(paragraphDocument("знову")), stamp).status, "written");
});

/* ---------- review section (Milestone 2) ---------- */

const reviewItem = {
  id: "item-1",
  reviewSessionId: "session-1",
  documentRevisionId: "rev-1",
  changeLevel: 5,
  title: "Спростити",
  reason: "Складно.",
  recommendation: "Переписати простіше.",
  recommendationType: "simplify",
  suggestedAction: "rewrite_text",
  priority: "medium",
  anchor: { blockIds: ["p-9"], generationBlockRange: { start: 0, end: 0 }, excerpt: "…", fingerprint: "paragraph:Текст." },
  insertionPoint: { mode: "replace", anchorBlockId: "p-9" },
  stepId: "clarity",
  status: "ready"
} as const;

test("a draft saved before the suggestion engine existed opens unchanged, without a review section", () => {
  const storage = new RecordingStorage();
  // Exactly the shape Milestone 1 wrote.
  storage.values.set(
    getV2DraftStorageKey("uk"),
    JSON.stringify({ version: 1, document: paragraphDocument("Текст із першої версії."), sourceName: "розділ.docx", updatedAt: "2026-10-09T10:00:00.000Z" })
  );

  const initial = ready(loadInitialV2Draft(storage, "uk"));
  assert.equal(initial.source, "v2");
  assert.deepEqual(initial.draft.document, paragraphDocument("Текст із першої версії."));
  assert.equal(initial.draft.sourceName, "розділ.docx");
  assert.equal(initial.draft.updatedAt, "2026-10-09T10:00:00.000Z");
  assert.equal("review" in initial.draft, false);
  assert.deepEqual(storage.writes, []);
  assert.equal("review" in createV2Draft(paragraphDocument("x")), false);
});

test("the review section round-trips through the stored draft", () => {
  const storage = new RecordingStorage();
  const review = {
    passes: { clarity: { status: "running" as const, progress: { completed: 1, total: 3, percent: 33 } } },
    items: [reviewItem as never],
    proposals: {
      "item-1": {
        id: "proposal-1",
        reviewItemId: "item-1",
        sourceRevisionId: "rev-1",
        targetRevisionId: "rev-1",
        kind: "text_diff" as const,
        summary: "Спрощено",
        canApplyDirectly: true,
        textDiff: {
          op: "replace_blocks" as const,
          blockIds: ["p-9"],
          oldBlocks: paragraphDocument("Текст.").blocks,
          newBlocks: paragraphDocument("Простий текст.").blocks,
          reason: "Простіше."
        }
      }
    },
    decisions: [{ itemId: "item-0", passId: "clarity" as const, outcome: "rejected" as const, at: "2026-10-10T10:00:00.000Z" }],
    rejectedIdeas: [{ blockIds: ["p-9"], recommendationType: "rewrite" as const, recommendation: "Не треба" }],
    activeRun: {
      version: 1 as const,
      capability: "signed-capability",
      updatedAt: "2026-10-10T10:00:01.000Z",
      stale: false,
      snapshotBlockIds: ["p-9"],
      itemCursor: 4,
      run: {
        runId: "run-1",
        documentRevisionId: "rev-1",
        stepId: "clarity" as const,
        locale: "uk" as const,
        provider: "openai",
        modelId: "gpt-6-luna",
        runMode: "replace" as const,
        createdAt: "2026-10-10T10:00:00.000Z",
        status: "running" as const,
        updatedAt: "2026-10-10T10:00:01.000Z",
        pollAfterMs: 1000,
        progress: { completedChunks: 1, totalChunks: 3 }
      }
    },
    filter: "clarity" as const,
    quiet: true
  };

  writeV2Draft(storage, "uk", createV2Draft(paragraphDocument("Текст."), "розділ.docx", review));
  const stored = readV2Draft(storage, "uk");

  assert.ok(stored?.review);
  assert.deepEqual(stored.review.items, review.items);
  assert.deepEqual(stored.review.proposals, review.proposals);
  assert.deepEqual(stored.review.decisions, review.decisions);
  assert.deepEqual(stored.review.rejectedIdeas, review.rejectedIdeas);
  assert.deepEqual(stored.review.activeRun, review.activeRun);
  assert.equal(stored.review.passes.clarity?.status, "running");
  assert.deepEqual(stored.review.passes.clarity?.progress, { completed: 1, total: 3, percent: 33 });
  assert.equal(stored.review.filter, "clarity");
  assert.equal(stored.review.quiet, true);
  assert.deepEqual(stored.document, paragraphDocument("Текст."));
});

test("a damaged review section does not make the draft unreadable", () => {
  const storage = new RecordingStorage();
  storage.values.set(
    getV2DraftStorageKey("uk"),
    JSON.stringify({ version: 1, document: paragraphDocument("Текст."), sourceName: null, updatedAt: "2026-10-10T10:00:00.000Z", review: { items: "broken", activeRun: 5 } })
  );

  const inspection = inspectV2Draft(storage, "uk");
  assert.equal(inspection.status, "ok");
  assert.deepEqual(inspection.status === "ok" && inspection.draft.review?.items, []);
  assert.equal(inspection.status === "ok" && inspection.draft.review?.activeRun, null);

  storage.values.set(
    getV2DraftStorageKey("uk"),
    JSON.stringify({ version: 1, document: paragraphDocument("Текст."), sourceName: null, updatedAt: "2026-10-10T10:00:00.000Z", review: "nope" })
  );
  const plain = readV2Draft(storage, "uk");
  assert.equal(plain !== null && "review" in plain, false);
});
