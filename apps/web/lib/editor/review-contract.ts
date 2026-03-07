import { createPatchId } from "./patch-contract";
import {
  areParagraphIdsResolvable,
  computeAnchorFingerprint,
  formatParagraphLabel,
  getManuscriptParagraphs,
  getParagraphRangeText,
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

export interface EditorialReviewRequest {
  text: string;
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
    paragraphIds: string[];
    generationParagraphRange: {
      start: number;
      end: number;
    };
    excerpt: string;
    fingerprint: string;
  };
  insertionPoint: {
    mode: EditorialReviewInsertionHint;
    anchorParagraphId: string;
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
  status: EditorialReviewItemStatus;
}

export interface EditorialReviewDiagnostics {
  requestId: string;
  reviewSessionId: string;
  requestedProvider: string;
  requestedModelId: string;
  textLength: number;
  changeLevel: WholeTextChangeLevel;
  returnedItemCount: number;
  droppedItemCount: number;
  generatedAt: string;
  rawOutput?: string;
}

export interface EditorialReviewResponse {
  reviewSessionId: string;
  items: EditorialReviewItem[];
  providerUsed: string;
  usedFallback: boolean;
  error?: string;
  diagnostics: EditorialReviewDiagnostics;
}

export interface ReviewActionRequest {
  text: string;
  currentRevision: ManuscriptRevisionState;
  item: EditorialReviewItem;
  provider: string;
  modelId: string;
  apiKey?: string;
  basePrompt?: string;
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
    op: "replace" | "insert";
    selection: { start: number; end: number };
    oldText: string;
    replacement: string;
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

export interface ReviewImageGenerationResponse {
  asset?: GeneratedReviewImageAsset;
  providerUsed: string;
  modelId: string;
  error?: string;
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
    const dataUrl = asset.source.dataUrl.trim();
    return dataUrl || null;
  }

  if (asset.source.kind === "asset_token") {
    const token = asset.source.token.trim();
    return token || null;
  }

  const url = asset.source.url.trim();
  return url || null;
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

export function normalizeEditorialReviewItems(input: {
  text: string;
  revision: ManuscriptRevisionState;
  reviewSessionId: string;
  changeLevel: WholeTextChangeLevel;
  items: unknown;
}): { items: EditorialReviewItem[]; droppedCount: number } {
  if (!Array.isArray(input.items)) {
    return { items: [], droppedCount: 0 };
  }

  const paragraphs = getManuscriptParagraphs(input.text, input.revision);
  const normalized: EditorialReviewItem[] = [];
  let droppedCount = 0;

  for (const [index, candidate] of input.items.entries()) {
    if (!candidate || typeof candidate !== "object") {
      droppedCount += 1;
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const paragraphStart = normalizeIndex(record.paragraphStart, paragraphs.length);
    const paragraphEnd = normalizeIndex(record.paragraphEnd, paragraphs.length);
    const title = normalizeCopy(record.title, 90);
    const reason = normalizeCopy(record.reason, 420);
    const recommendation = normalizeCopy(record.recommendation, 520);
    const excerpt = normalizeExcerptCopy(record.excerpt, 360);

    if (paragraphStart === null || paragraphEnd === null || paragraphStart > paragraphEnd || !title || !reason || !recommendation) {
      droppedCount += 1;
      continue;
    }

    const paragraphRange = paragraphs.filter((paragraph) => paragraph.index >= paragraphStart && paragraph.index <= paragraphEnd);

    if (paragraphRange.length === 0) {
      droppedCount += 1;
      continue;
    }

    const paragraphIds = paragraphRange.map((paragraph) => paragraph.id);
    const derivedExcerpt = getParagraphRangeText(input.revision, paragraphIds).slice(0, 360);
    const anchorExcerpt = excerpt ?? derivedExcerpt;

    const recommendationType = normalizeRecommendationType(record.recommendationType);
    const suggestedAction = normalizeSuggestedAction(record.suggestedAction);
    const calloutKind = normalizeCalloutKind(record.calloutKind);
    const calloutDraft = normalizeCalloutDraft(record, {
      recommendation,
      recommendationType,
      suggestedAction,
      calloutKind
    });

    normalized.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id : createPatchId(`review-${index + 1}`),
      reviewSessionId: input.reviewSessionId,
      documentRevisionId: input.revision.documentRevisionId,
      changeLevel: input.changeLevel,
      title,
      reason,
      recommendation,
      recommendationType,
      suggestedAction,
      priority: normalizePriority(record.priority),
      anchor: {
        paragraphIds,
        generationParagraphRange: {
          start: paragraphStart,
          end: paragraphEnd
        },
        excerpt: anchorExcerpt,
        fingerprint: computeAnchorFingerprint(input.revision, paragraphIds, anchorExcerpt)
      },
      insertionPoint: {
        mode: normalizeInsertionHint(record.insertionHint),
        anchorParagraphId: paragraphRange[paragraphRange.length - 1]?.id ?? paragraphRange[0].id
      },
      calloutKind: calloutKind ?? (recommendationType === "callout" || suggestedAction === "prepare_callout" ? "quick_fact" : undefined),
      calloutDraft,
      visualIntent: normalizeVisualIntent(record.visualIntent),
      status: calloutDraft ? "ready" : "pending"
    });
  }

  normalized.sort((left, right) => {
    const paragraphDelta = left.anchor.generationParagraphRange.start - right.anchor.generationParagraphRange.start;
    if (paragraphDelta !== 0) {
      return paragraphDelta;
    }

    return priorityWeight(left.priority) - priorityWeight(right.priority);
  });

  const deduped: EditorialReviewItem[] = [];

  for (const item of normalized) {
    const duplicate = deduped.find(
      (candidate) =>
        candidate.title === item.title &&
        candidate.anchor.paragraphIds.join(",") === item.anchor.paragraphIds.join(",") &&
        candidate.recommendationType === item.recommendationType
    );

    if (duplicate) {
      droppedCount += 1;
      continue;
    }

    deduped.push(item);
  }

  return { items: deduped.slice(0, 8), droppedCount };
}

export function getReviewParagraphLabel(item: EditorialReviewItem, revision: ManuscriptRevisionState): string {
  const indices = item.anchor.paragraphIds
    .map((id) => revision.paragraphOrder.indexOf(id))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);

  if (indices.length === 0) {
    return `${formatParagraphLabel(item.anchor.generationParagraphRange.start)}-${formatParagraphLabel(item.anchor.generationParagraphRange.end)}`;
  }

  return `${formatParagraphLabel(indices[0] + 1)}-${formatParagraphLabel(indices[indices.length - 1] + 1)}`;
}

export function reconcileReviewItemsWithRevision(
  items: EditorialReviewItem[],
  revision: ManuscriptRevisionState,
  appliedItemId?: string
): EditorialReviewItem[] {
  return items.map((item) => {
    if (item.id === appliedItemId) {
      return {
        ...item,
        status: "applied"
      };
    }

    if (item.status === "dismissed" || item.status === "applied") {
      return item;
    }

    if (!areParagraphIdsResolvable(revision, item.anchor.paragraphIds)) {
      return {
        ...item,
        status: "stale"
      };
    }

    const nextFingerprint = computeAnchorFingerprint(revision, item.anchor.paragraphIds, item.anchor.excerpt);

    return {
      ...item,
      status: nextFingerprint === item.anchor.fingerprint ? (item.status === "ready" ? "ready" : "pending") : "stale"
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

function normalizeCalloutDraft(
  record: Record<string, unknown>,
  context: {
    recommendation: string;
    recommendationType: EditorialReviewRecommendationType;
    suggestedAction: EditorialReviewSuggestedAction;
    calloutKind?: EditorialCalloutKind;
  }
): EditorialReviewItem["calloutDraft"] | undefined {
  if (context.recommendationType !== "callout" && context.suggestedAction !== "prepare_callout") {
    return undefined;
  }

  const calloutKind = context.calloutKind ?? "quick_fact";
  const title =
    normalizeCopy(firstString(record.calloutTitle, record.calloutHeading, record.calloutHeadline, record.calloutLabel), 80) ??
    fallbackCalloutTitle(calloutKind);
  const previewText =
    normalizeCopy(firstString(record.calloutPreviewText, record.calloutText, record.calloutBody, record.calloutDraft), 900) ?? context.recommendation;
  const prompt = normalizePromptCopy(firstString(record.calloutPrompt, record.calloutGenerationPrompt, record.prompt), 2400) ?? "";
  const summary = normalizeCopy(firstString(record.calloutSummary, record.calloutWhy, record.calloutReason), 180) ?? undefined;

  return {
    calloutKind,
    title,
    prompt,
    previewText,
    summary
  };
}

function normalizeVisualIntent(value: unknown): EditorialVisualIntent | undefined {
  return REVIEW_VISUAL_INTENTS.includes(value as EditorialVisualIntent) ? (value as EditorialVisualIntent) : undefined;
}

function normalizeIndex(value: unknown, paragraphCount: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  return normalized >= 1 && normalized <= paragraphCount ? normalized : null;
}

function normalizeCopy(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizePromptCopy(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeExcerptCopy(value: unknown, maxLength: number): string | null {
  const normalized = normalizeCopy(value, maxLength);

  if (!normalized) {
    return null;
  }

  return normalized.replace(/^["«]+|["»]+$/g, "").trim();
}

function priorityWeight(priority: EditorialReviewPriority): number {
  if (priority === "high") {
    return 0;
  }

  if (priority === "medium") {
    return 1;
  }

  return 2;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function fallbackCalloutTitle(kind: EditorialCalloutKind): string {
  if (kind === "mini_story") {
    return "Мініісторія";
  }

  if (kind === "mechanism_explained") {
    return "Як це працює";
  }

  if (kind === "step_by_step") {
    return "Покроково";
  }

  if (kind === "myth_vs_fact") {
    return "Міф і факт";
  }

  return "Короткий факт";
}
