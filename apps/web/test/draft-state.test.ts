import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  clearLocaleBoundEditorDraftState,
  EDITOR_DRAFT_STORAGE_KEY,
  readEditorDraftState,
  writeEditorDraftState,
  type PersistedEditorDraftState
} from "../lib/editor/draft-state.ts";
import { EMPTY_BLOCK_SELECTION, type EditorDocument } from "../lib/editor/document-model.ts";
import { getEditorDraftStorageKey } from "../lib/i18n/product-locale";
import { deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { createDefaultStepFeedbackMap, createDefaultStepRunModeMap, createEmptyStepRunHistory } from "../lib/editor/review-contract.ts";

class TestLocalStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

function installWindow() {
  const localStorage = new TestLocalStorage();
  Object.defineProperty(globalThis, "window", {
    value: { localStorage },
    configurable: true
  });
  return localStorage;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

function buildDraft(document: EditorDocument): PersistedEditorDraftState {
  return {
    document,
    revision: deriveManuscriptRevisionState(document),
    selection: EMPTY_BLOCK_SELECTION,
    operations: [],
    reviewItems: [],
    patchDiagnostics: null,
    reviewDiagnostics: null,
    reviewExpertise: null,
    rejectedReviewIdeas: [],
    factCheckRows: [],
    activeWorkflowStep: "diagnostics",
    stepRunHistory: createEmptyStepRunHistory(),
    stepFeedback: createDefaultStepFeedbackMap(),
    stepRunModeByStep: createDefaultStepRunModeMap("replace"),
    history: [],
    appliedDiffs: [],
    compareHistory: [],
    feedback: null,
    activeReviewItemId: null,
    activeProposal: null,
    reviewImageAssets: {},
    activeReviewRun: null,
    reviewComposer: { changeLevel: 3, additionalInstructions: "" }
  };
}

test("readEditorDraftState repairs hidden imported characters without dropping draft state", () => {
  const localStorage = installWindow();
  const dirtyDocument: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p-1", type: "paragraph", content: [{ text: "у\u00a0кумулятивному\u200b ефекті" }] }
    ]
  };

  localStorage.setItem(
    EDITOR_DRAFT_STORAGE_KEY,
    JSON.stringify({
      ...buildDraft(dirtyDocument),
      activeReviewItemId: "review-1",
      compareHistory: [
        {
          id: "compare-1",
          kind: "manual_edit",
          label: "Зміна",
          timestampLabel: "12:00",
          blockIds: ["p-1"],
          beforeBlocks: dirtyDocument.blocks,
          afterBlocks: dirtyDocument.blocks
        }
      ]
    })
  );

  const draft = readEditorDraftState();
  const paragraph = draft?.document.blocks[0];

  assert.ok(draft);
  assert.equal(paragraph?.type === "paragraph" ? paragraph.content[0]?.text : "", "у кумулятивному ефекті");
  assert.equal(draft.activeReviewItemId, "review-1");
  assert.equal(draft.compareHistory.length, 1);
});

test("writeEditorDraftState persists sanitized document text", () => {
  const localStorage = installWindow();
  const dirtyDocument: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p-1", type: "paragraph", content: [{ text: "A\u202fB\ufeff" }] }
    ]
  };

  writeEditorDraftState(buildDraft(dirtyDocument));

  const raw = localStorage.getItem(getEditorDraftStorageKey("uk")) ?? localStorage.getItem(EDITOR_DRAFT_STORAGE_KEY);
  assert.ok(raw);
  const parsed = JSON.parse(raw) as PersistedEditorDraftState;
  const paragraph = parsed.document.blocks[0];
  assert.equal(paragraph?.type === "paragraph" ? paragraph.content[0]?.text : "", "A B");
});

test("draft persistence round-trips and locale reset clears the durable review reference", () => {
  installWindow();
  const document: EditorDocument = {
    version: 2,
    blocks: [{ id: "p-1", type: "paragraph", content: [{ text: "Текст рукопису" }] }]
  };
  const draft = buildDraft(document);
  draft.activeReviewRun = {
    version: 1,
    capability: "signed-capability",
    updatedAt: "2026-08-04T12:00:01.000Z",
    stale: false,
    run: {
      runId: "wrun_test",
      documentRevisionId: draft.revision.documentRevisionId,
      stepId: "emphasis",
      locale: "uk",
      provider: "openai",
      modelId: "gpt-5.6-luna",
      runMode: "replace",
      createdAt: "2026-08-04T12:00:00.000Z",
      updatedAt: "2026-08-04T12:00:01.000Z",
      status: "running",
      pollAfterMs: 1000,
      progress: { completedChunks: 2, totalChunks: 10, attempt: 1 }
    }
  };

  writeEditorDraftState(draft, "uk");
  const restored = readEditorDraftState("uk");

  assert.equal(restored?.activeReviewRun?.run.runId, "wrun_test");
  assert.deepEqual(restored?.activeReviewRun?.run.progress, { completedChunks: 2, totalChunks: 10, attempt: 1 });
  assert.equal(clearLocaleBoundEditorDraftState(restored!).activeReviewRun, null);
});
