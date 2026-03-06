import type { PatchOperation, PatchResponseDiagnostics, PatchSelection } from "./patch-contract";
import type { EditorialReviewDiagnostics, EditorialReviewItem } from "./review-contract";

export const EDITOR_DRAFT_STORAGE_KEY = "orest-editor-draft-v1";

export interface PersistedAppliedDiffMarker {
  id: string;
  start: number;
  end: number;
  oldText: string;
  newText?: string;
  reason: string;
}

export interface PersistedEditorFeedback {
  message: string;
  tone: "info" | "error";
}

export interface PersistedHistoryItem {
  id: string;
  timestampLabel: string;
  providerUsed: string;
  requestedProvider: string;
  requestedModelId: string;
  mode: "default" | "custom" | "review";
  resultCount: number;
  droppedCount: number;
  usedFallback: boolean;
  tone: "info" | "error";
  message: string;
}

export interface PersistedEditorDraftState {
  text: string;
  selection: PatchSelection;
  operations: PatchOperation[];
  reviewItems: EditorialReviewItem[];
  patchDiagnostics: PatchResponseDiagnostics | null;
  reviewDiagnostics: EditorialReviewDiagnostics | null;
  history: PersistedHistoryItem[];
  appliedDiffs: PersistedAppliedDiffMarker[];
  feedback: PersistedEditorFeedback | null;
  activeReviewItemId: string | null;
}

export function readEditorDraftState(): PersistedEditorDraftState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(EDITOR_DRAFT_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedEditorDraftState;

    if (!parsed || typeof parsed !== "object" || typeof parsed.text !== "string") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeEditorDraftState(state: PersistedEditorDraftState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(EDITOR_DRAFT_STORAGE_KEY, JSON.stringify(state));
}

export function clearEditorDraftState() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(EDITOR_DRAFT_STORAGE_KEY);
}
