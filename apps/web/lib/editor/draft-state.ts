import type { PatchOperation, PatchResponseDiagnostics, PatchSelection } from "./patch-contract";
import type { ManuscriptRevisionState } from "./manuscript-structure";
import type { EditorialReviewDiagnostics, EditorialReviewItem, GeneratedReviewImageAsset, ReviewActionProposal, WholeTextChangeLevel } from "./review-contract";

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
  mode: "default" | "custom" | "review" | "proposal" | "image";
  resultCount: number;
  droppedCount: number;
  usedFallback: boolean;
  tone: "info" | "error";
  message: string;
}

export interface PersistedEditorDraftState {
  text: string;
  revision: ManuscriptRevisionState;
  selection: PatchSelection;
  operations: PatchOperation[];
  reviewItems: EditorialReviewItem[];
  patchDiagnostics: PatchResponseDiagnostics | null;
  reviewDiagnostics: EditorialReviewDiagnostics | null;
  history: PersistedHistoryItem[];
  appliedDiffs: PersistedAppliedDiffMarker[];
  feedback: PersistedEditorFeedback | null;
  activeReviewItemId: string | null;
  activeProposal: ReviewActionProposal | null;
  reviewImageAssets: Record<string, GeneratedReviewImageAsset>;
  reviewComposer: {
    changeLevel: WholeTextChangeLevel;
    additionalInstructions: string;
  };
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

  try {
    window.localStorage.setItem(EDITOR_DRAFT_STORAGE_KEY, JSON.stringify(sanitizePersistedEditorDraftState(state)));
  } catch (error) {
    console.warn("Не вдалося зберегти editor draft у localStorage.", error);
  }
}

export function clearEditorDraftState() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(EDITOR_DRAFT_STORAGE_KEY);
}

function sanitizePersistedEditorDraftState(state: PersistedEditorDraftState): PersistedEditorDraftState {
  const reviewImageAssets = Object.fromEntries(
    Object.entries(state.reviewImageAssets).filter(([, asset]) => isPersistableEditorAsset(asset))
  );
  const activeProposal = sanitizePersistedProposal(state.activeProposal);

  return {
    ...state,
    activeProposal,
    reviewImageAssets
  };
}

function sanitizePersistedProposal(proposal: ReviewActionProposal | null): ReviewActionProposal | null {
  if (!proposal || proposal.kind !== "image_prompt" || !proposal.imageDraft?.generatedAsset) {
    return proposal;
  }

  if (isPersistableEditorAsset(proposal.imageDraft.generatedAsset)) {
    return proposal;
  }

  return {
    ...proposal,
    imageDraft: {
      ...proposal.imageDraft,
      generatedAsset: undefined
    }
  };
}

function isPersistableEditorAsset(asset: GeneratedReviewImageAsset): boolean {
  if (!asset || typeof asset !== "object") {
    return false;
  }

  const legacyDataUrl = (asset as unknown as { dataUrl?: unknown }).dataUrl;

  if (typeof legacyDataUrl === "string" && legacyDataUrl.trim()) {
    return false;
  }

  if (!asset.source || typeof asset.source !== "object") {
    return false;
  }

  return asset.source.kind !== "data_url";
}
