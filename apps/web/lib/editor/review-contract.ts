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
  | "visual";
export type EditorialReviewSuggestedAction = "rewrite_text" | "insert_text" | "prepare_callout" | "prepare_visual";
export type EditorialReviewPriority = "high" | "medium" | "low";
export type EditorialReviewInsertionHint = "replace" | "before" | "after";
export type EditorialCalloutKind = "mechanism" | "analogy" | "everyday_application" | "myths_vs_truth" | "top_list";
export type EditorialVisualIntent = "diagram" | "comparison" | "process" | "timeline" | "scene" | "concept";
export type EditorialReviewItemStatus = "pending" | "preparing" | "ready" | "applied" | "dismissed" | "stale";
export type EditorialReviewItemOrigin = "review" | "manual";
export type WholeTextChangeLevel = 1 | 2 | 3 | 4 | 5;
export type ReviewActionProposalKind = "text_diff" | "subsection_prompt" | "callout_prompt" | "image_prompt" | "stale_anchor";
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
  subsectionDraft?: {
    title: string;
    lead?: string;
    prompt: string;
    summary?: string;
  };
  visualIntent?: EditorialVisualIntent;
  origin?: EditorialReviewItemOrigin;
  manualRequest?: {
    source: "floating_local_bar";
    createdAt: string;
  };
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
    warning?: {
      code: "no_op";
      message: string;
      similarity: number;
    };
  };
  calloutDraft?: {
    calloutKind: EditorialCalloutKind;
    title: string;
    prompt: string;
    previewText?: string;
  };
  subsectionDraft?: {
    title: string;
    lead?: string;
    prompt: string;
    summary?: string;
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
  "visual"
];
const REVIEW_SUGGESTED_ACTIONS: EditorialReviewSuggestedAction[] = [
  "rewrite_text",
  "insert_text",
  "prepare_callout",
  "prepare_visual"
];
const REVIEW_PRIORITIES: EditorialReviewPriority[] = ["high", "medium", "low"];
const REVIEW_INSERTION_HINTS: EditorialReviewInsertionHint[] = ["replace", "before", "after"];
const REVIEW_CALLOUT_KINDS: EditorialCalloutKind[] = [
  "mechanism",
  "analogy",
  "everyday_application",
  "myths_vs_truth",
  "top_list"
];
const REVIEW_VISUAL_INTENTS: EditorialVisualIntent[] = ["diagram", "comparison", "process", "timeline", "scene", "concept"];
const REVIEW_RECOMMENDATION_TYPE_LABELS: Record<EditorialReviewRecommendationType, string> = {
  rewrite: "переписати",
  expand: "дописати",
  simplify: "спростити",
  list: "список",
  subsection: "підрозділ",
  callout: "врізка",
  visual: "візуал"
};
const CALLOUT_KIND_LABELS: Record<EditorialCalloutKind, string> = {
  mechanism: "механізм",
  analogy: "аналогія",
  everyday_application: "у побуті",
  myths_vs_truth: "міфи й правда",
  top_list: "список"
};
const CALLOUT_KIND_TITLE_LABELS: Record<EditorialCalloutKind, string> = {
  mechanism: "Як це працює",
  analogy: "Аналогія",
  everyday_application: "У повсякденні",
  myths_vs_truth: "Міфи й правда",
  top_list: "Ключові пункти"
};
const CALLOUT_KIND_DESCRIPTIONS: Record<EditorialCalloutKind, string> = {
  mechanism: "Пояснити причинно-наслідковий механізм простими кроками без лекційного тону.",
  analogy: "Подати ідею через зрозумілу аналогію та явно не видавати її за буквальний факт.",
  everyday_application: "Показати, як явище проявляється в повсякденному житті читача.",
  myths_vs_truth: "Подати короткі пари «Міф / Правда» лише для тверджень, що прямо випливають із фрагмента.",
  top_list: "Зібрати 3-5 коротких пунктів лише тоді, коли матеріал природно підтримує дискретний перелік."
};
const VISUAL_INTENT_LABELS: Record<EditorialVisualIntent, string> = {
  diagram: "схема",
  comparison: "порівняння",
  process: "процес",
  timeline: "таймлайн",
  scene: "сцена",
  concept: "концепт"
};

const LEGACY_RECOMMENDATION_TYPE_MAP: Record<string, EditorialReviewRecommendationType> = {
  visualize: "visual",
  illustration: "visual"
};

const LEGACY_CALLOUT_KIND_MAP: Record<string, EditorialCalloutKind> = {
  quick_fact: "mechanism",
  mini_story: "analogy",
  mechanism_explained: "mechanism",
  step_by_step: "top_list",
  myth_vs_fact: "myths_vs_truth"
};

export function getEditorialCalloutKindOptions(): Array<{ value: EditorialCalloutKind; label: string }> {
  return REVIEW_CALLOUT_KINDS.map((value) => ({ value, label: CALLOUT_KIND_LABELS[value] }));
}

export function getEditorialVisualIntentOptions(): Array<{ value: EditorialVisualIntent; label: string }> {
  return REVIEW_VISUAL_INTENTS.map((value) => ({ value, label: VISUAL_INTENT_LABELS[value] }));
}

export function getEditorialVisualIntentLabel(intent: EditorialVisualIntent): string {
  return VISUAL_INTENT_LABELS[intent];
}

export function getEditorialCalloutKindLabel(kind: EditorialCalloutKind): string {
  return CALLOUT_KIND_LABELS[kind];
}

export function getEditorialCalloutKindTitle(kind: EditorialCalloutKind): string {
  return CALLOUT_KIND_TITLE_LABELS[kind];
}

export function getEditorialCalloutKindDescription(kind: EditorialCalloutKind): string {
  return CALLOUT_KIND_DESCRIPTIONS[kind];
}

export function getEditorialRecommendationTypeLabel(type: EditorialReviewRecommendationType): string {
  return REVIEW_RECOMMENDATION_TYPE_LABELS[type];
}

export function parseEditorialCalloutKindLabel(value: string): EditorialCalloutKind | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  const entry = Object.entries(CALLOUT_KIND_LABELS).find(([, label]) => label.trim().toLowerCase().replace(/\s+/g, "-") === normalized);
  return (entry?.[0] as EditorialCalloutKind | undefined) ?? null;
}

export function getSuggestedActionForRecommendationType(type: EditorialReviewRecommendationType): EditorialReviewSuggestedAction {
  if (type === "callout") {
    return "prepare_callout";
  }

  if (type === "visual") {
    return "prepare_visual";
  }

  if (type === "subsection") {
    return "insert_text";
  }

  return "rewrite_text";
}

export function getInsertionHintForRecommendationType(type: EditorialReviewRecommendationType): EditorialReviewInsertionHint {
  if (type === "subsection") {
    return "before";
  }

  if (type === "callout" || type === "visual") {
    return "after";
  }

  return "replace";
}

export function isReplaceReviewType(type: EditorialReviewRecommendationType): boolean {
  return getSuggestedActionForRecommendationType(type) === "rewrite_text";
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
    const recommendationType = normalizeRecommendationType(record.recommendationType);
    const insertionMode = normalizeInsertionHint(recommendationType, record.insertionHint);
    const insertionAnchor = resolveInsertionAnchor(blockIds, insertionMode);

    if (!insertionAnchor) {
      droppedCount += 1;
      continue;
    }

    const requestedAnchorBlockId =
      typeof record.anchorBlockId === "string" && record.anchorBlockId.trim() ? record.anchorBlockId.trim() : null;

    normalized.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id : createPatchId(`review-item-${index + 1}`),
      reviewSessionId: input.reviewSessionId,
      documentRevisionId: input.revision.documentRevisionId,
      changeLevel: input.changeLevel,
      title,
      reason,
      recommendation,
      recommendationType,
      suggestedAction: normalizeSuggestedAction(recommendationType, record.suggestedAction),
      priority: normalizePriority(record.priority),
      anchor: {
        blockIds,
        generationBlockRange: { start, end },
        excerpt,
        fingerprint: computeAnchorFingerprint(input.document, blockIds)
      },
      insertionPoint: {
        mode: insertionMode,
        anchorBlockId: requestedAnchorBlockId && getBlock(input.document, requestedAnchorBlockId) ? requestedAnchorBlockId : insertionAnchor
      },
      calloutKind: normalizeCalloutKind(record.calloutKind),
      calloutDraft: normalizeCalloutDraft(record),
      visualIntent: normalizeVisualIntent(record.visualIntent),
      origin: "review",
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

export function getReviewParagraphRangeLabel(item: EditorialReviewItem, revision: ManuscriptRevisionState): string {
  const indexes = item.anchor.blockIds
    .map((blockId) => revision.blockOrder.indexOf(blockId))
    .filter((index) => index >= 0);

  if (indexes.length === 0) {
    return "Абз. ?";
  }

  const start = formatParagraphLabel(Math.min(...indexes));
  const end = formatParagraphLabel(Math.max(...indexes));

  return start === end ? `Абз. ${start}` : `Абз. ${start}-${end}`;
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
  if (typeof value === "string") {
    const normalized = value.trim();

    if (REVIEW_RECOMMENDATION_TYPES.includes(normalized as EditorialReviewRecommendationType)) {
      return normalized as EditorialReviewRecommendationType;
    }

    if (normalized in LEGACY_RECOMMENDATION_TYPE_MAP) {
      return LEGACY_RECOMMENDATION_TYPE_MAP[normalized];
    }
  }

  return "rewrite";
}

function normalizeSuggestedAction(recommendationType: unknown, value: unknown): EditorialReviewSuggestedAction {
  const normalizedType = normalizeRecommendationType(recommendationType);
  const expected = getSuggestedActionForRecommendationType(normalizedType);

  if (value === expected) {
    return expected;
  }

  return REVIEW_SUGGESTED_ACTIONS.includes(value as EditorialReviewSuggestedAction) ? expected : expected;
}

function normalizePriority(value: unknown): EditorialReviewPriority {
  return REVIEW_PRIORITIES.includes(value as EditorialReviewPriority) ? (value as EditorialReviewPriority) : "medium";
}

function normalizeInsertionHint(recommendationType: unknown, value: unknown): EditorialReviewInsertionHint {
  const normalizedType = normalizeRecommendationType(recommendationType);
  const expected = getInsertionHintForRecommendationType(normalizedType);

  if (value === expected) {
    return expected;
  }

  if (value === "subsection_after") {
    return expected;
  }

  return REVIEW_INSERTION_HINTS.includes(value as EditorialReviewInsertionHint) ? expected : expected;
}

function normalizeCalloutKind(value: unknown): EditorialCalloutKind | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();

  if (REVIEW_CALLOUT_KINDS.includes(normalized as EditorialCalloutKind)) {
    return normalized as EditorialCalloutKind;
  }

  return LEGACY_CALLOUT_KIND_MAP[normalized];
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

function resolveInsertionAnchor(blockIds: string[], insertionMode: EditorialReviewInsertionHint): string {
  if (insertionMode === "after") {
    return blockIds[blockIds.length - 1] ?? blockIds[0] ?? "";
  }

  return blockIds[0] ?? "";
}

function priorityWeight(priority: EditorialReviewPriority): number {
  return priority === "high" ? 0 : priority === "medium" ? 1 : 2;
}
