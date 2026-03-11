import type { Block, EditorDocument, InlineNode } from "./document-model";
import { cloneBlock, getBlock, getBlockText } from "./document-model";
import { createPatchId } from "./patch-contract";
import {
  areParagraphIdsResolvable,
  computeAnchorFingerprint,
  formatParagraphLabel,
  getManuscriptParagraphs,
  type ManuscriptRevisionState
} from "./manuscript-structure";

export type EditorialReviewRecommendationType =
  | "rewrite"
  | "expand"
  | "simplify"
  | "list"
  | "subsection"
  | "callout"
  | "visualize"
  | "illustration";
export type EditorialReviewSuggestedAction = "rewrite_text" | "insert_text" | "prepare_callout" | "prepare_visual";
export type EditorialReviewPriority = "high" | "medium" | "low";
export type EditorialReviewInsertionHint = "replace" | "before" | "after" | "subsection_after";
export type EditorialCalloutKind = "quick_fact" | "mini_story" | "mechanism_explained" | "step_by_step" | "myth_vs_fact";
export type EditorialVisualIntent = "diagram" | "comparison" | "process" | "timeline" | "scene" | "concept";
export type EditorialReviewItemStatus = "pending" | "preparing" | "ready" | "applied" | "dismissed" | "stale";
export type WholeTextChangeLevel = 1 | 2 | 3 | 4 | 5;
export type ReviewActionProposalKind = "text_diff" | "callout_prompt" | "image_prompt" | "stale_anchor";
export type ReviewSessionStatus = "expertise" | "cards";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface EditorialReviewSession {
  sessionId: string;
  history: ChatMessage[];
  currentExpertise: string | null;
  items: EditorialReviewItem[];
  status: ReviewSessionStatus;
}

export interface EditorialReviewRequest {
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  provider: string;
  modelId: string;
  apiKey?: string;
  basePrompt?: string;
  reviewPrompt?: string;
  reviewLevelGuide?: string;
  calloutPromptTemplate?: string;
  changeLevel: WholeTextChangeLevel;
  additionalInstructions?: string;
  history?: ChatMessage[];
  currentStatus?: ReviewSessionStatus;
}

export interface EditorialReviewItem {
  id: string;
  reviewSessionId: string;
  documentRevisionId: string;
  changeLevel: WholeTextChangeLevel;
  title: string;
  reason: string;
  recommendation: string;
  recommendationType: EditorialReviewRecommendationType;
  suggestedAction: EditorialReviewSuggestedAction;
  priority: EditorialReviewPriority;
  anchor: {
    blockIds: string[];
    generationBlockRange: {
      start: number;
      end: number;
    };
    excerpt: string;
    fingerprint: string;
  };
  insertionPoint: {
    mode: EditorialReviewInsertionHint;
    anchorBlockId: string;
  };
  calloutKind?: EditorialCalloutKind;
  calloutDraft?: {
    calloutKind: EditorialCalloutKind;
    title: string;
    prompt: string;
    previewText: string;
    summary?: string;
  };
  visualIntent?: EditorialVisualIntent;
  activeProposalId?: string;
  status: EditorialReviewItemStatus;
}

export interface EditorialReviewDiagnostics {
  requestId: string;
  reviewSessionId: string;
  requestedProvider: string;
  requestedModelId: string;
  blockCount: number;
  changeLevel: WholeTextChangeLevel;
  returnedItemCount: number;
  droppedItemCount: number;
  generatedAt: string;
  rawOutput?: string;
}

export interface EditorialReviewResponse {
  reviewSessionId: string;
  items: EditorialReviewItem[];
  expertise?: string;
  providerUsed: string;
  usedFallback: boolean;
  error?: string;
  diagnostics: EditorialReviewDiagnostics;
}

export interface ReviewActionRequest {
  document: EditorDocument;
  currentRevision: ManuscriptRevisionState;
  item: EditorialReviewItem;
  provider: string;
  modelId: string;
  apiKey?: string;
  basePrompt?: string;
  reviewPrompt?: string;
  reviewLevelGuide?: string;
  calloutPromptTemplate?: string;
  imagePromptTemplate?: string;
}

export interface ReviewActionProposal {
  id: string;
  reviewItemId: string;
  sourceRevisionId: string;
  targetRevisionId: string;
  kind: ReviewActionProposalKind;
  summary: string;
  canApplyDirectly: boolean;
  textDiff?: {
    op: "replace_blocks";
    blockIds: string[];
    oldBlocks: Block[];
    newBlocks: Block[];
    reason: string;
  };
  calloutDraft?: {
    calloutKind: EditorialCalloutKind;
    title: string;
    prompt: string;
    previewText?: string;
  };
  imageDraft?: {
    visualIntent: EditorialVisualIntent;
    prompt: string;
    alt: string;
    caption?: string;
    targetModel: "gemini-3.1-flash-image-preview";
    generatedAsset?: GeneratedReviewImageAsset;
    generation?: {
      jobId: string;
      status: ReviewImageGenerationJobStatus;
      requestedAt: string;
      updatedAt: string;
      error?: string;
    };
  };
  staleReason?: string;
}

export interface ReviewActionResponse {
  proposal: ReviewActionProposal;
  providerUsed: string;
  usedFallback: boolean;
  error?: string;
  diagnostics: ReviewActionDiagnostics;
}

export interface ReviewActionDiagnostics {
  requestId: string;
  requestedProvider: string;
  requestedModelId: string;
  reviewItemId: string;
  proposalKind: ReviewActionProposalKind;
  generatedAt: string;
  rawOutput?: string;
}

export interface ReviewImageGenerationRequest {
  prompt: string;
  apiKey?: string;
  async?: boolean;
}

export type ReviewImageAssetSource =
  | { kind: "data_url"; dataUrl: string }
  | { kind: "remote_url"; url: string }
  | { kind: "asset_token"; token: string };

export interface GeneratedReviewImageAsset {
  assetId: string;
  mimeType: string;
  source: ReviewImageAssetSource;
}

export type ReviewImageGenerationJobStatus = "queued" | "processing" | "completed" | "failed";

export interface ReviewImageGenerationJob {
  id: string;
  status: ReviewImageGenerationJobStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  pollAfterMs: number;
}

export interface ReviewImageGenerationResponse {
  asset?: GeneratedReviewImageAsset;
  providerUsed: string;
  modelId: string;
  job?: ReviewImageGenerationJob;
  error?: string;
}

const REVIEW_RECOMMENDATION_TYPES: EditorialReviewRecommendationType[] = [
  "rewrite",
  "expand",
  "simplify",
  "list",
  "subsection",
  "callout",
  "visualize",
  "illustration"
];
const REVIEW_SUGGESTED_ACTIONS: EditorialReviewSuggestedAction[] = [
  "rewrite_text",
  "insert_text",
  "prepare_callout",
  "prepare_visual"
];
const REVIEW_PRIORITIES: EditorialReviewPriority[] = ["high", "medium", "low"];
const REVIEW_INSERTION_HINTS: EditorialReviewInsertionHint[] = ["replace", "before", "after", "subsection_after"];
const REVIEW_CALLOUT_KINDS: EditorialCalloutKind[] = [
  "quick_fact",
  "mini_story",
  "mechanism_explained",
  "step_by_step",
  "myth_vs_fact"
];
const REVIEW_VISUAL_INTENTS: EditorialVisualIntent[] = ["diagram", "comparison", "process", "timeline", "scene", "concept"];
const CALLOUT_KIND_LABELS: Record<EditorialCalloutKind, string> = {
  quick_fact: "факт",
  mini_story: "історія",
  mechanism_explained: "механізм",
  step_by_step: "покроково",
  myth_vs_fact: "міф-факт"
};
const CALLOUT_KIND_TITLE_LABELS: Record<EditorialCalloutKind, string> = {
  quick_fact: "Короткий факт",
  mini_story: "Мініісторія",
  mechanism_explained: "Як це працює",
  step_by_step: "Покроково",
  myth_vs_fact: "Міф і факт"
};

export function getEditorialCalloutKindOptions(): Array<{ value: EditorialCalloutKind; label: string }> {
  return REVIEW_CALLOUT_KINDS.map((value) => ({ value, label: CALLOUT_KIND_LABELS[value] }));
}

export function getEditorialCalloutKindLabel(kind: EditorialCalloutKind): string {
  return CALLOUT_KIND_LABELS[kind];
}

export function getEditorialCalloutKindTitle(kind: EditorialCalloutKind): string {
  return CALLOUT_KIND_TITLE_LABELS[kind];
}

export function parseEditorialCalloutKindLabel(value: string): EditorialCalloutKind | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  const entry = Object.entries(CALLOUT_KIND_LABELS).find(([, label]) => label === normalized);
  return (entry?.[0] as EditorialCalloutKind | undefined) ?? null;
}

export function resolveReviewImageAssetUrl(asset: GeneratedReviewImageAsset): string | null {
  const legacyDataUrl = (asset as unknown as { dataUrl?: unknown }).dataUrl;

  if (typeof legacyDataUrl === "string" && legacyDataUrl.trim()) {
    return legacyDataUrl.trim();
  }

  if (!asset.source || typeof asset.source !== "object") {
    return null;
  }

  if (asset.source.kind === "data_url") {
    return asset.source.dataUrl.trim() || null;
  }

  if (asset.source.kind === "asset_token") {
    return asset.source.token.trim() || null;
  }

  return asset.source.url.trim() || null;
}

export function normalizeEditorialReviewItems(input: {
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  reviewSessionId: string;
  changeLevel: WholeTextChangeLevel;
  items: unknown;
}): { items: EditorialReviewItem[]; droppedCount: number } {
  if (!Array.isArray(input.items)) {
    return { items: [], droppedCount: 0 };
  }

  const paragraphs = getManuscriptParagraphs(input.document, input.revision);
  const normalized: EditorialReviewItem[] = [];
  let droppedCount = 0;

  for (const [index, candidate] of input.items.entries()) {
    if (!candidate || typeof candidate !== "object") {
      droppedCount += 1;
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const blockStart = normalizeIndex(record.blockStart ?? record.paragraphStart, paragraphs.length);
    const blockEnd = normalizeIndex(record.blockEnd ?? record.paragraphEnd, paragraphs.length);
    const title = normalizeCopy(record.title, 90);
    const reason = normalizeCopy(record.reason, 420);
    const recommendation = normalizeCopy(record.recommendation, 420);

    if (blockStart === null || blockEnd === null || !title || !reason || !recommendation) {
      droppedCount += 1;
      continue;
    }

    const start = Math.min(blockStart, blockEnd);
    const end = Math.max(blockStart, blockEnd);
    const blockIds = paragraphs.slice(start, end + 1).map((paragraph) => paragraph.id);
    const excerpt = normalizeCopy(record.excerpt, 420) ?? blockIds.map((blockId) => getBlockText(getBlock(input.document, blockId)!)).join("\n\n");
    const insertionAnchor = blockIds[0];

    if (!insertionAnchor) {
      droppedCount += 1;
      continue;
    }

    normalized.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id : createPatchId(`review-item-${index + 1}`),
      reviewSessionId: input.reviewSessionId,
      documentRevisionId: input.revision.documentRevisionId,
      changeLevel: input.changeLevel,
      title,
      reason,
      recommendation,
      recommendationType: normalizeRecommendationType(record.recommendationType),
      suggestedAction: normalizeSuggestedAction(record.suggestedAction),
      priority: normalizePriority(record.priority),
      anchor: {
        blockIds,
        generationBlockRange: { start, end },
        excerpt,
        fingerprint: computeAnchorFingerprint(input.document, blockIds)
      },
      insertionPoint: {
        mode: normalizeInsertionHint(record.insertionHint),
        anchorBlockId: typeof record.anchorBlockId === "string" && record.anchorBlockId.trim() ? record.anchorBlockId : insertionAnchor
      },
      calloutKind: normalizeCalloutKind(record.calloutKind),
      calloutDraft: normalizeCalloutDraft(record),
      visualIntent: normalizeVisualIntent(record.visualIntent),
      status: "pending"
    });
  }

  const deduped: EditorialReviewItem[] = [];

  for (const item of normalized.sort((left, right) => priorityWeight(left.priority) - priorityWeight(right.priority))) {
    if (
      deduped.some(
        (existing) =>
          existing.title === item.title ||
          (existing.anchor.blockIds.join("|") === item.anchor.blockIds.join("|") && existing.recommendationType === item.recommendationType)
      )
    ) {
      droppedCount += 1;
      continue;
    }

    deduped.push(item);
  }

  return { items: deduped, droppedCount };
}

export function getReviewParagraphLabel(item: EditorialReviewItem, revision: ManuscriptRevisionState): string {
  const firstBlockId = item.anchor.blockIds[0];
  const index = revision.blockOrder.indexOf(firstBlockId);
  return index >= 0 ? formatParagraphLabel(index) : "?";
}

export function reconcileReviewItemsWithRevision(
  items: EditorialReviewItem[],
  document: EditorDocument,
  revision: ManuscriptRevisionState
): EditorialReviewItem[] {
  return items.map((item) => {
    const isResolvable = areParagraphIdsResolvable(revision, item.anchor.blockIds);
    const nextFingerprint = isResolvable ? computeAnchorFingerprint(document, item.anchor.blockIds) : item.anchor.fingerprint;
    const isStale = !isResolvable || nextFingerprint !== item.anchor.fingerprint;

    if (!isStale) {
      return item;
    }

    return {
      ...item,
      status: item.status === "applied" || item.status === "dismissed" ? item.status : "stale"
    };
  });
}

function normalizeRecommendationType(value: unknown): EditorialReviewRecommendationType {
  return REVIEW_RECOMMENDATION_TYPES.includes(value as EditorialReviewRecommendationType) ? (value as EditorialReviewRecommendationType) : "rewrite";
}

function normalizeSuggestedAction(value: unknown): EditorialReviewSuggestedAction {
  return REVIEW_SUGGESTED_ACTIONS.includes(value as EditorialReviewSuggestedAction) ? (value as EditorialReviewSuggestedAction) : "rewrite_text";
}

function normalizePriority(value: unknown): EditorialReviewPriority {
  return REVIEW_PRIORITIES.includes(value as EditorialReviewPriority) ? (value as EditorialReviewPriority) : "medium";
}

function normalizeInsertionHint(value: unknown): EditorialReviewInsertionHint {
  return REVIEW_INSERTION_HINTS.includes(value as EditorialReviewInsertionHint) ? (value as EditorialReviewInsertionHint) : "replace";
}

function normalizeCalloutKind(value: unknown): EditorialCalloutKind | undefined {
  return REVIEW_CALLOUT_KINDS.includes(value as EditorialCalloutKind) ? (value as EditorialCalloutKind) : undefined;
}

function normalizeVisualIntent(value: unknown): EditorialVisualIntent | undefined {
  return REVIEW_VISUAL_INTENTS.includes(value as EditorialVisualIntent) ? (value as EditorialVisualIntent) : undefined;
}

function normalizeCalloutDraft(record: Record<string, unknown>): EditorialReviewItem["calloutDraft"] | undefined {
  const kind = normalizeCalloutKind(record.calloutKind);
  const title = normalizeCopy(record.calloutTitle, 90);
  const prompt = normalizeCopy(record.calloutPrompt, 600);
  const previewText = normalizeCopy(record.calloutPreviewText, 600);
  const summary = normalizeCopy(record.calloutSummary, 220);

  if (!kind || !title || !prompt || !previewText) {
    return undefined;
  }

  return {
    calloutKind: kind,
    title,
    prompt,
    previewText,
    summary: summary ?? undefined
  };
}

function normalizeCopy(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeIndex(value: unknown, length: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const index = Math.max(0, Math.min(length - 1, Math.floor(value)));
  return Number.isFinite(index) ? index : null;
}

function priorityWeight(priority: EditorialReviewPriority): number {
  return priority === "high" ? 0 : priority === "medium" ? 1 : 2;
}
