import type { EditorDocument } from "./document-model";
import type { CompareHistoryEntry } from "./change-history";
import type { PatchOperation, PatchResponseDiagnostics, PatchSelection } from "./patch-contract";
import type { ManuscriptRevisionState } from "./manuscript-structure";
import type {
  EditorialFactCheckRow,
  EditorialReviewDiagnostics,
  EditorialReviewItem,
  EditorialReviewStepId,
  EditorialStepFeedbackMap,
  EditorialStepRunHistory,
  EditorialStepRunModeMap,
  GeneratedReviewImageAsset,
  ReviewActionProposal,
  WholeTextChangeLevel
} from "./review-contract";
import { createDefaultStepFeedbackMap, createDefaultStepRunModeMap, createEmptyStepRunHistory } from "./review-contract";
import type { RequestFeedback, RequestFeedbackTone } from "./workflow-ui";

export type PersistedWorkflowStepId = EditorialReviewStepId | "spellcheck";

export const EDITOR_DRAFT_STORAGE_KEY = "orest-editor-draft-v3";
export const PREVIOUS_EDITOR_DRAFT_STORAGE_KEY = "orest-editor-draft-v2";
export const LEGACY_EDITOR_DRAFT_STORAGE_KEY = "orest-editor-draft-v1";

export interface PersistedAppliedDiffMarker {
  id: string;
  blockIds: string[];
  reason: string;
}

export interface PersistedEditorFeedback extends RequestFeedback {
  tone: RequestFeedbackTone;
}

export interface PersistedHistoryItem {
  id: string;
  timestampLabel: string;
  providerUsed: string;
  requestedProvider: string;
  requestedModelId: string;
  mode: "default" | "custom" | "review" | "proposal" | "image" | "spellcheck";
  resultCount: number;
  droppedCount: number;
  usedFallback: boolean;
  tone: "info" | "error";
  message: string;
}

export interface PersistedEditorDraftState {
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  selection: PatchSelection;
  operations: PatchOperation[];
  reviewItems: EditorialReviewItem[];
  patchDiagnostics: PatchResponseDiagnostics | null;
  reviewDiagnostics: EditorialReviewDiagnostics | null;
  reviewExpertise: string | null;
  factCheckRows: EditorialFactCheckRow[];
  activeWorkflowStep: PersistedWorkflowStepId;
  stepRunHistory: EditorialStepRunHistory;
  stepFeedback: EditorialStepFeedbackMap;
  stepRunModeByStep: EditorialStepRunModeMap;
  history: PersistedHistoryItem[];
  appliedDiffs: PersistedAppliedDiffMarker[];
  compareHistory: CompareHistoryEntry[];
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

  try {
    const previousRaw = window.localStorage.getItem(PREVIOUS_EDITOR_DRAFT_STORAGE_KEY);

    if (previousRaw && !window.localStorage.getItem(EDITOR_DRAFT_STORAGE_KEY)) {
      window.localStorage.setItem(EDITOR_DRAFT_STORAGE_KEY, previousRaw);
    }

    if (previousRaw) {
      window.localStorage.removeItem(PREVIOUS_EDITOR_DRAFT_STORAGE_KEY);
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_EDITOR_DRAFT_STORAGE_KEY);

    if (legacyRaw) {
      window.localStorage.removeItem(LEGACY_EDITOR_DRAFT_STORAGE_KEY);
    }
  } catch {
    // Ignore localStorage cleanup failures.
  }

  const raw = window.localStorage.getItem(EDITOR_DRAFT_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedEditorDraftState;

    if (!parsed || typeof parsed !== "object" || !parsed.document || parsed.document.version !== 2 || !Array.isArray(parsed.document.blocks)) {
      return null;
    }

    const defaultFeedback = createDefaultStepFeedbackMap();
    const defaultRunModes = createDefaultStepRunModeMap("replace");
    const defaultRunHistory = createEmptyStepRunHistory();
    const activeWorkflowStep = isStepId(parsed.activeWorkflowStep) ? parsed.activeWorkflowStep : "diagnostics";

    return {
      ...parsed,
      reviewExpertise: typeof parsed.reviewExpertise === "string" ? parsed.reviewExpertise : null,
      factCheckRows: Array.isArray(parsed.factCheckRows) ? parsed.factCheckRows : [],
      activeWorkflowStep,
      stepRunHistory: coerceStepRunHistory(parsed.stepRunHistory, defaultRunHistory),
      stepFeedback: coerceStepFeedback(parsed.stepFeedback, defaultFeedback),
      stepRunModeByStep: coerceStepRunModes(parsed.stepRunModeByStep, defaultRunModes),
      compareHistory: Array.isArray(parsed.compareHistory) ? parsed.compareHistory : []
    };
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

function isStepId(value: unknown): value is PersistedWorkflowStepId {
  return (
    value === "diagnostics" ||
    value === "fact_check" ||
    value === "structure" ||
    value === "clarity" ||
    value === "interest" ||
    value === "visuals" ||
    value === "formatting" ||
    value === "emphasis" ||
    value === "spellcheck" ||
    value === "final_editing"
  );
}

function coerceStepRunHistory(value: unknown, fallback: EditorialStepRunHistory): EditorialStepRunHistory {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Partial<EditorialStepRunHistory>;
  return {
    diagnostics: Array.isArray(record.diagnostics) ? record.diagnostics : fallback.diagnostics,
    fact_check: Array.isArray(record.fact_check) ? record.fact_check : fallback.fact_check,
    structure: Array.isArray(record.structure) ? record.structure : fallback.structure,
    clarity: Array.isArray(record.clarity) ? record.clarity : fallback.clarity,
    interest: Array.isArray(record.interest) ? record.interest : fallback.interest,
    visuals: Array.isArray(record.visuals) ? record.visuals : fallback.visuals,
    formatting: Array.isArray(record.formatting) ? record.formatting : fallback.formatting,
    emphasis: Array.isArray(record.emphasis) ? record.emphasis : fallback.emphasis,
    final_editing: Array.isArray(record.final_editing) ? record.final_editing : fallback.final_editing
  };
}

function coerceStepFeedback(value: unknown, fallback: EditorialStepFeedbackMap): EditorialStepFeedbackMap {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Partial<EditorialStepFeedbackMap>;
  return {
    diagnostics: typeof record.diagnostics === "string" ? record.diagnostics : fallback.diagnostics,
    fact_check: typeof record.fact_check === "string" ? record.fact_check : fallback.fact_check,
    structure: typeof record.structure === "string" ? record.structure : fallback.structure,
    clarity: typeof record.clarity === "string" ? record.clarity : fallback.clarity,
    interest: typeof record.interest === "string" ? record.interest : fallback.interest,
    visuals: typeof record.visuals === "string" ? record.visuals : fallback.visuals,
    formatting: typeof record.formatting === "string" ? record.formatting : fallback.formatting,
    emphasis: typeof record.emphasis === "string" ? record.emphasis : fallback.emphasis,
    final_editing: typeof record.final_editing === "string" ? record.final_editing : fallback.final_editing
  };
}

function coerceStepRunModes(value: unknown, fallback: EditorialStepRunModeMap): EditorialStepRunModeMap {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Partial<EditorialStepRunModeMap>;
  const normalize = (entry: unknown, defaultValue: "preserve" | "replace") =>
    entry === "preserve" || entry === "replace" ? entry : defaultValue;

  return {
    diagnostics: normalize(record.diagnostics, fallback.diagnostics),
    fact_check: normalize(record.fact_check, fallback.fact_check),
    structure: normalize(record.structure, fallback.structure),
    clarity: normalize(record.clarity, fallback.clarity),
    interest: normalize(record.interest, fallback.interest),
    visuals: normalize(record.visuals, fallback.visuals),
    formatting: normalize(record.formatting, fallback.formatting),
    emphasis: normalize(record.emphasis, fallback.emphasis),
    final_editing: normalize(record.final_editing, fallback.final_editing)
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
