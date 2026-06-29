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
import type { AppLocale } from "../i18n/product-locale";
import { formatParagraphRangeLabel } from "../i18n/product-locale";

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
export type EditorialCalloutDepth = "brief" | "deep";
export type EditorialVisualIntent = "infographic" | "illustration";
export type VisualStylePreset = "minimal" | "calm_gradient" | "neo_brutal" | "modern_glass";
export type EditorialReviewItemStatus = "pending" | "preparing" | "ready" | "applied" | "dismissed" | "stale";
export type EditorialReviewItemOrigin = "review" | "manual";
export type WholeTextChangeLevel = 1 | 2 | 3 | 4 | 5;
export type ReviewActionProposalKind = "text_diff" | "subsection_prompt" | "callout_prompt" | "image_prompt" | "stale_anchor";
export type ReviewSessionStatus = "expertise" | "cards";
export type EditorialReviewStepId =
  | "diagnostics"
  | "fact_check"
  | "structure"
  | "clarity"
  | "interest"
  | "visuals"
  | "formatting"
  | "emphasis"
  | "final_editing";
export type EditorialStepRunMode = "preserve" | "replace";
export type FactCheckStatus = "ok" | "questionable" | "unsupported";

export const REJECTED_REVIEW_RECOMMENDATION_MAX_LENGTH = 300;

export interface EditorialFactCheckSource {
  title: string;
  url: string;
  domain: string;
}

export interface EditorialFactCheckRow {
  claim: string;
  status: FactCheckStatus;
  explanation: string;
  sources: EditorialFactCheckSource[];
}

export interface EditorialStepContext {
  diagnosticsExpertise?: string;
  diagnosticsFeedback?: string;
  currentStepFeedback?: string;
}

export interface EditorialEmphasisTarget {
  text: string;
  occurrence?: number;
}

export interface EditorialStepRunSnapshot {
  id: string;
  stepId: EditorialReviewStepId;
  runMode: EditorialStepRunMode;
  createdAt: string;
  documentRevisionId: string;
  feedback?: string;
  expertise?: string | null;
  factCheckRows?: EditorialFactCheckRow[];
  itemIds?: string[];
}

export type EditorialStepRunHistory = Record<EditorialReviewStepId, EditorialStepRunSnapshot[]>;
export type EditorialStepFeedbackMap = Record<EditorialReviewStepId, string>;
export type EditorialStepRunModeMap = Record<EditorialReviewStepId, EditorialStepRunMode>;

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

export interface RejectedReviewIdea {
  blockIds: string[];
  recommendationType: EditorialReviewRecommendationType;
  recommendation: string;
}

export interface EditorialReviewRequest {
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  locale?: AppLocale;
  provider: string;
  modelId: string;
  apiKey?: string;
  async?: boolean;
  basePrompt?: string;
  /** @deprecated Use expertisePrompt + cardsPrompt instead */
  reviewPrompt?: string;
  expertisePrompt?: string;
  cardsPrompt?: string;
  reviewLevelGuide?: string;
  workflowStepPrompts?: Partial<Record<EditorialReviewStepId, string>>;
  calloutPromptTemplate?: string;
  changeLevel: WholeTextChangeLevel;
  additionalInstructions?: string;
  history?: ChatMessage[];
  currentStatus?: ReviewSessionStatus;
  stepId?: EditorialReviewStepId;
  runMode?: EditorialStepRunMode;
  stepContext?: EditorialStepContext;
  stepFeedback?: string;
  /** Expertise text from stage 1 — fed into card generation in stage 2 */
  expertise?: string;
  rejectedIdeas?: RejectedReviewIdea[];
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
  calloutDepth?: EditorialCalloutDepth;
  calloutDraft?: {
    calloutKind: EditorialCalloutKind;
    calloutDepth: EditorialCalloutDepth;
    title: string;
    prompt: string;
    previewText: string;
  };
  subsectionDraft?: {
    title: string;
    lead?: string;
    prompt: string;
  };
  visualIntent?: EditorialVisualIntent;
  emphasisTarget?: EditorialEmphasisTarget;
  origin?: EditorialReviewItemOrigin;
  manualRequest?: {
    source: "floating_local_bar";
    createdAt: string;
  };
  stepId?: EditorialReviewStepId;
  stepRunId?: string;
  activeProposalId?: string;
  status: EditorialReviewItemStatus;
}

export interface EditorialReviewDiagnostics {
  requestId: string;
  reviewSessionId: string;
  stepId: EditorialReviewStepId;
  stepRunId: string;
  runMode: EditorialStepRunMode;
  requestedProvider: string;
  requestedModelId: string;
  blockCount: number;
  changeLevel: WholeTextChangeLevel;
  returnedItemCount: number;
  returnedFactCheckCount: number;
  droppedItemCount: number;
  droppedItemCountsByReason?: Record<string, number>;
  filteredItemCountsByType?: Partial<Record<EditorialReviewRecommendationType, number>>;
  generatedAt: string;
  rawOutput?: string;
}

export interface EditorialReviewResponse {
  reviewSessionId: string;
  stepId: EditorialReviewStepId;
  stepRunId: string;
  runMode: EditorialStepRunMode;
  items: EditorialReviewItem[];
  factCheckRows?: EditorialFactCheckRow[];
  expertise?: string;
  providerUsed: string;
  usedFallback: boolean;
  job?: EditorialReviewJob;
  error?: string;
  diagnostics: EditorialReviewDiagnostics;
}

export type EditorialReviewJobStatus = "queued" | "processing" | "completed" | "failed";

export interface EditorialReviewJob {
  id: string;
  locale?: AppLocale;
  status: EditorialReviewJobStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  pollAfterMs: number;
}

export type EditorialReviewJobResponse = Partial<EditorialReviewResponse> & {
  job: EditorialReviewJob;
  error?: string;
};

export interface ReviewActionRequest {
  document: EditorDocument;
  currentRevision: ManuscriptRevisionState;
  locale?: AppLocale;
  item: EditorialReviewItem;
  editorialInstruction?: string;
  provider: string;
  modelId: string;
  apiKey?: string;
  basePrompt?: string;
  /** @deprecated Use expertisePrompt + cardsPrompt instead */
  reviewPrompt?: string;
  expertisePrompt?: string;
  cardsPrompt?: string;
  reviewLevelGuide?: string;
  calloutPromptTemplate?: string;
  imagePromptTemplate?: string;
  visualStylePreset?: VisualStylePreset;
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
    calloutDepth: EditorialCalloutDepth;
    title: string;
    prompt: string;
    previewText?: string;
  };
  subsectionDraft?: {
    title: string;
    lead?: string;
    prompt: string;
  };
  imageDraft?: {
    visualIntent: EditorialVisualIntent;
    visualStylePreset?: VisualStylePreset;
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
  rawError?: string;
}

export interface ReviewImageGenerationRequest {
  prompt: string;
  locale?: AppLocale;
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
  locale?: AppLocale;
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
const REVIEW_CALLOUT_DEPTHS: EditorialCalloutDepth[] = ["brief", "deep"];
const REVIEW_VISUAL_INTENTS: EditorialVisualIntent[] = ["infographic", "illustration"];
const REVIEW_RECOMMENDATION_TYPE_LABELS_EN: Record<EditorialReviewRecommendationType, string> = {
  rewrite: "rewrite",
  expand: "expand",
  simplify: "simplify",
  list: "list",
  subsection: "subsection",
  callout: "callout",
  visual: "visual"
};
const REVIEW_RECOMMENDATION_TYPE_LABELS: Record<EditorialReviewRecommendationType, string> = {
  rewrite: "переписати",
  expand: "дописати",
  simplify: "спростити",
  list: "список",
  subsection: "підрозділ",
  callout: "врізка",
  visual: "візуал"
};
export const EDITORIAL_REVIEW_STEP_IDS: EditorialReviewStepId[] = [
  "diagnostics",
  "fact_check",
  "structure",
  "clarity",
  "interest",
  "visuals",
  "formatting",
  "emphasis",
  "final_editing"
];
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
const CALLOUT_KIND_DESCRIPTIONS_EN: Record<EditorialCalloutKind, string> = {
  mechanism: "Explain the cause-and-effect mechanism in simple steps without a lecture tone.",
  analogy: "Present the idea through a clear analogy and explicitly do not present it as a literal fact.",
  everyday_application: "Show how the phenomenon appears in the reader's everyday life.",
  myths_vs_truth: "Present short Myth/Truth pairs only for claims that directly follow from the fragment.",
  top_list: "Collect 3-5 short points only when the material naturally supports a discrete list."
};
const CALLOUT_DEPTH_LABELS: Record<EditorialCalloutDepth, string> = {
  brief: "Стисло",
  deep: "Докладно"
};
const CALLOUT_DEPTH_DESCRIPTIONS: Record<EditorialCalloutDepth, string> = {
  brief: "Коротка врізка у поточному стилі.",
  deep: "Глибокий розбір у 3-6 докладних абзацах; може поєднувати текст і списки."
};
const CALLOUT_DEPTH_DESCRIPTIONS_EN: Record<EditorialCalloutDepth, string> = {
  brief: "A short callout in the current style.",
  deep: "An in-depth breakdown in 3-6 detailed paragraphs; may combine text and lists."
};
const VISUAL_INTENT_LABELS: Record<EditorialVisualIntent, string> = {
  infographic: "інфографіка",
  illustration: "ілюстрація"
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
const LEGACY_VISUAL_INTENT_MAP: Record<string, EditorialVisualIntent> = {
  diagram: "infographic",
  comparison: "infographic",
  process: "infographic",
  timeline: "infographic",
  scene: "illustration",
  concept: "illustration",
  schema: "infographic",
  infographic: "infographic",
  info_graphic: "infographic",
  illustration: "illustration",
  illustrative: "illustration",
  "інфографіка": "infographic",
  "ілюстрація": "illustration",
  "иллюстрация": "illustration"
};

export function getEditorialCalloutKindOptions(locale: AppLocale = "uk"): Array<{ value: EditorialCalloutKind; label: string }> {
  return REVIEW_CALLOUT_KINDS.map((value) => ({ value, label: getEditorialCalloutKindLabel(value, locale) }));
}

export function getEditorialCalloutDepthOptions(locale: AppLocale = "uk"): Array<{ value: EditorialCalloutDepth; label: string }> {
  return REVIEW_CALLOUT_DEPTHS.map((value) => ({ value, label: getEditorialCalloutDepthLabel(value, locale) }));
}

export function createEmptyStepRunHistory(): EditorialStepRunHistory {
  return {
    diagnostics: [],
    fact_check: [],
    structure: [],
    clarity: [],
    interest: [],
    visuals: [],
    formatting: [],
    emphasis: [],
    final_editing: []
  };
}

export function createDefaultStepFeedbackMap(): EditorialStepFeedbackMap {
  return {
    diagnostics: "",
    fact_check: "",
    structure: "",
    clarity: "",
    interest: "",
    visuals: "",
    formatting: "",
    emphasis: "",
    final_editing: ""
  };
}

export function createDefaultStepRunModeMap(defaultMode: EditorialStepRunMode = "replace"): EditorialStepRunModeMap {
  return {
    diagnostics: defaultMode,
    fact_check: defaultMode,
    structure: defaultMode,
    clarity: defaultMode,
    interest: defaultMode,
    visuals: defaultMode,
    formatting: defaultMode,
    emphasis: defaultMode,
    final_editing: defaultMode
  };
}

export function getEditorialVisualIntentOptions(locale: AppLocale = "uk"): Array<{ value: EditorialVisualIntent; label: string }> {
  return REVIEW_VISUAL_INTENTS.map((value) => ({ value, label: getEditorialVisualIntentLabel(value, locale) }));
}

export function getEditorialVisualIntentLabel(intent: EditorialVisualIntent, locale: AppLocale = "uk"): string {
  if (locale === "en") {
    return intent === "infographic" ? "infographic" : "illustration";
  }

  return VISUAL_INTENT_LABELS[intent];
}

export function getEditorialCalloutKindLabel(kind: EditorialCalloutKind, locale: AppLocale = "uk"): string {
  if (locale === "en") {
    switch (kind) {
      case "mechanism":
        return "mechanism";
      case "analogy":
        return "analogy";
      case "everyday_application":
        return "everyday life";
      case "myths_vs_truth":
        return "myths vs truth";
      case "top_list":
        return "list";
    }
  }

  return CALLOUT_KIND_LABELS[kind];
}

export function getEditorialCalloutKindTitle(kind: EditorialCalloutKind): string {
  return CALLOUT_KIND_TITLE_LABELS[kind];
}

export function getEditorialCalloutKindDescription(kind: EditorialCalloutKind, locale: AppLocale = "uk"): string {
  if (locale === "en") {
    return CALLOUT_KIND_DESCRIPTIONS_EN[kind];
  }

  return CALLOUT_KIND_DESCRIPTIONS[kind];
}

export function getEditorialCalloutDepthLabel(depth: EditorialCalloutDepth, locale: AppLocale = "uk"): string {
  if (locale === "en") {
    return depth === "deep" ? "Detailed" : "Brief";
  }

  return CALLOUT_DEPTH_LABELS[depth];
}

export function getEditorialCalloutDepthDescription(depth: EditorialCalloutDepth, locale: AppLocale = "uk"): string {
  if (locale === "en") {
    return CALLOUT_DEPTH_DESCRIPTIONS_EN[depth];
  }

  return CALLOUT_DEPTH_DESCRIPTIONS[depth];
}

export function normalizeEditorialCalloutDepth(value: unknown): EditorialCalloutDepth {
  return parseEditorialCalloutDepth(value) ?? "brief";
}

export function getEditorialRecommendationTypeLabel(type: EditorialReviewRecommendationType, locale: AppLocale = "uk"): string {
  if (locale === "en") {
    return REVIEW_RECOMMENDATION_TYPE_LABELS_EN[type];
  }

  return REVIEW_RECOMMENDATION_TYPE_LABELS[type];
}

export function getCalloutKindGuardrail(kind: EditorialCalloutKind, locale: AppLocale = "uk"): string {
  if (locale === "en") {
    if (kind === "analogy") {
      return "Clearly mark this as an analogy; do not present the analogy as a literal fact.";
    }

    if (kind === "myths_vs_truth") {
      return "Add only Myth/Truth pairs that directly follow from the fragment; do not invent claims.";
    }

    if (kind === "top_list") {
      return "Present 3-5 points in a multi-line Name: explanation format; stay within the fragment facts and do not invent new sources.";
    }

    return "Stay within the fragment without invented facts or diagnoses.";
  }

  if (kind === "analogy") {
    return "Явно познач, що це аналогія; не подавай аналогію як буквальний факт.";
  }

  if (kind === "myths_vs_truth") {
    return "Додавай лише пари «Міф/Правда», які прямо випливають із фрагмента; не вигадуй тверджень.";
  }

  if (kind === "top_list") {
    return "Подавай 3-5 пунктів у multi-line форматі «Назва: пояснення»; працюй лише з фактами фрагмента і не вигадуй нові джерела.";
  }

  return "Залишайся в межах фрагмента без вигаданих фактів чи діагнозів.";
}

export function parseEditorialCalloutKindLabel(value: string): EditorialCalloutKind | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  const entry = Object.entries(CALLOUT_KIND_LABELS).find(([, label]) => label.trim().toLowerCase().replace(/\s+/g, "-") === normalized)
    ?? Object.entries({
      mechanism: "mechanism",
      analogy: "analogy",
      everyday_application: "everyday-life",
      myths_vs_truth: "myths-vs-truth",
      top_list: "list"
    } satisfies Record<EditorialCalloutKind, string>).find(([, label]) => label === normalized);
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
  stepId?: EditorialReviewStepId;
  stepRunId?: string;
  items: unknown;
}): { items: EditorialReviewItem[]; droppedCount: number; droppedByReason: Record<string, number> } {
  if (!Array.isArray(input.items)) {
    return { items: [], droppedCount: 0, droppedByReason: {} };
  }

  const paragraphs = getManuscriptParagraphs(input.document, input.revision);
  const normalized: EditorialReviewItem[] = [];
  let droppedCount = 0;
  const droppedByReason: Record<string, number> = {};
  const markDropped = (reason: string) => {
    droppedCount += 1;
    droppedByReason[reason] = (droppedByReason[reason] ?? 0) + 1;
  };

  for (const [index, candidate] of input.items.entries()) {
    if (!candidate || typeof candidate !== "object") {
      markDropped("invalid_item_shape");
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const isEmphasisStep = input.stepId === "emphasis";
    const emphasisTarget = isEmphasisStep ? normalizeEmphasisTarget(record) : undefined;
    const resolvedEmphasisAnchor = isEmphasisStep
      ? resolveEmphasisAnchorIndex(input.document, paragraphs, record, emphasisTarget)
      : null;
    const rawBlockStart =
      isEmphasisStep && resolvedEmphasisAnchor !== null
        ? resolvedEmphasisAnchor
        : normalizeIndex(record.blockStart ?? record.paragraphStart, paragraphs.length);
    const title = isEmphasisStep ? buildEmphasisTitle(emphasisTarget?.text) : normalizeCopy(record.title, 90);
    const reason = isEmphasisStep ? "" : normalizeCopy(record.reason, 420);
    const recommendation = isEmphasisStep ? buildEmphasisRecommendation(emphasisTarget?.text) : normalizeCopy(record.recommendation, 420);
    const recommendationType = normalizeRecommendationType(record.recommendationType);

    if (
      rawBlockStart === null ||
      !title ||
      !recommendation ||
      (!isEmphasisStep && !reason) ||
      (isEmphasisStep && !emphasisTarget)
    ) {
      markDropped("missing_required_fields");
      continue;
    }

    const rawBlockEnd = isEmphasisStep ? rawBlockStart : normalizeIndex(record.blockEnd ?? record.paragraphEnd, paragraphs.length);

    if (rawBlockEnd === null) {
      markDropped("missing_required_fields");
      continue;
    }

    const baseRange = {
      start: Math.min(rawBlockStart, rawBlockEnd),
      end: Math.max(rawBlockStart, rawBlockEnd)
    };
    const candidateRanges = resolveCardRanges(record, baseRange, recommendationType, paragraphs.length);
    const ranges = candidateRanges.length > 0 ? candidateRanges : [baseRange];
    let acceptedForRecord = 0;

    for (const [rangeIndex, range] of ranges.entries()) {
      const guardedRange = applyReplaceRangeGuard(paragraphs, range, recommendationType);
      const blockIds = paragraphs.slice(guardedRange.start, guardedRange.end + 1).map((paragraph) => paragraph.id);

      if (blockIds.length === 0) {
        markDropped("empty_anchor_range");
        continue;
      }

      const fallbackExcerpt = blockIds.map((blockId) => getBlockText(getBlock(input.document, blockId)!)).join("\n\n");
      const excerpt = guardedRange.clipped ? fallbackExcerpt : normalizeCopy(record.excerpt, 420) ?? fallbackExcerpt;
      const insertionMode = normalizeInsertionHint(recommendationType, record.insertionHint);
      const insertionAnchor = resolveInsertionAnchor(blockIds, insertionMode);

      if (!insertionAnchor) {
        markDropped("missing_insertion_anchor");
        continue;
      }

      const requestedAnchorBlockId =
        typeof record.anchorBlockId === "string" && record.anchorBlockId.trim() ? record.anchorBlockId.trim() : null;

      const calloutDepth = recommendationType === "callout" ? normalizeCalloutDepthForRecord(record) : undefined;

      acceptedForRecord += 1;

      normalized.push({
        id:
          typeof record.id === "string" && record.id.trim()
            ? ranges.length > 1
              ? `${record.id}::${rangeIndex + 1}`
              : record.id
            : createPatchId(`review-item-${index + 1}-${rangeIndex + 1}`),
        reviewSessionId: input.reviewSessionId,
        documentRevisionId: input.revision.documentRevisionId,
        changeLevel: input.changeLevel,
        title,
        reason: guardedRange.clipped ? appendRangeClipNote(reason ?? "") : (reason ?? ""),
        recommendation,
        recommendationType,
        suggestedAction: normalizeSuggestedAction(recommendationType, record.suggestedAction),
        priority: normalizePriority(record.priority),
        anchor: {
          blockIds,
          generationBlockRange: { start: guardedRange.start, end: guardedRange.end },
          excerpt,
          fingerprint: computeAnchorFingerprint(input.document, blockIds)
        },
        insertionPoint: {
          mode: insertionMode,
          anchorBlockId: requestedAnchorBlockId && getBlock(input.document, requestedAnchorBlockId) ? requestedAnchorBlockId : insertionAnchor
        },
        calloutKind: normalizeCalloutKind(record.calloutKind),
        calloutDepth,
        calloutDraft: normalizeCalloutDraft(record, calloutDepth),
        visualIntent: normalizeVisualIntent(record.visualIntent),
        emphasisTarget,
        origin: "review",
        stepId: input.stepId,
        stepRunId: input.stepRunId,
        status: "pending"
      });
    }

    if (acceptedForRecord === 0) {
      markDropped("record_produced_no_valid_ranges");
    }
  }

  const deduped: EditorialReviewItem[] = [];

  for (const item of normalized.sort((left, right) => priorityWeight(left.priority) - priorityWeight(right.priority))) {
    if (
      deduped.some(
        (existing) =>
          (existing.anchor.blockIds.join("|") === item.anchor.blockIds.join("|") && existing.recommendationType === item.recommendationType)
      )
    ) {
      markDropped("duplicate_anchor_type");
      continue;
    }

    deduped.push(item);
  }

  return { items: deduped, droppedCount, droppedByReason };
}

export function normalizeRejectedReviewIdeas(value: unknown): RejectedReviewIdea[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: RejectedReviewIdea[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const blockIds = Array.isArray(record.blockIds)
      ? Array.from(
          new Set(
            record.blockIds
              .map((blockId) => (typeof blockId === "string" ? blockId.trim() : ""))
              .filter(Boolean)
          )
        )
      : [];
    const recommendationType = normalizeRecommendationType(record.recommendationType);
    const recommendation = normalizeCopy(record.recommendation, REJECTED_REVIEW_RECOMMENDATION_MAX_LENGTH);

    if (blockIds.length === 0 || !recommendation) {
      continue;
    }

    const key = `${recommendationType}:${blockIds.join("|")}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({
      blockIds,
      recommendationType,
      recommendation
    });
  }

  return normalized;
}

function resolveCardRanges(
  record: Record<string, unknown>,
  baseRange: { start: number; end: number },
  recommendationType: EditorialReviewRecommendationType,
  paragraphCount: number
): Array<{ start: number; end: number }> {
  if (recommendationType !== "subsection") {
    return [baseRange];
  }

  const parsedFromText = extractParagraphRangesFromCopy([
    typeof record.recommendation === "string" ? record.recommendation : "",
    typeof record.reason === "string" ? record.reason : "",
    typeof record.title === "string" ? record.title : ""
  ], paragraphCount);

  const normalizedRanges = parsedFromText.length > 0 ? parsedFromText : [baseRange];
  const expanded: Array<{ start: number; end: number }> = [];

  for (const range of normalizedRanges) {
    const chunked = splitLongRange(range, 3);
    expanded.push(...chunked);
  }

  return expanded.length > 0 ? expanded : [baseRange];
}

function extractParagraphRangesFromCopy(values: string[], paragraphCount: number): Array<{ start: number; end: number }> {
  if (paragraphCount <= 0) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  const markerRegex = /(?:абз\.?|параграф(?:и|ів)?|п\.|para(?:graph)?s?\.?)\s*([0-9,\s\-–]+)/gi;

  for (const value of values) {
    if (!value) {
      continue;
    }

    let match: RegExpExecArray | null;
    while ((match = markerRegex.exec(value)) !== null) {
      const list = match[1] ?? "";
      const tokens = list
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean);

      for (const token of tokens) {
        const rangeMatch = /^(\d{1,4})\s*[-–]\s*(\d{1,4})$/.exec(token);

        if (rangeMatch) {
          const from = clampParagraphIndex(Number.parseInt(rangeMatch[1] ?? "", 10) - 1, paragraphCount);
          const to = clampParagraphIndex(Number.parseInt(rangeMatch[2] ?? "", 10) - 1, paragraphCount);

          if (from !== null && to !== null) {
            ranges.push({ start: Math.min(from, to), end: Math.max(from, to) });
          }
          continue;
        }

        const singleMatch = /^(\d{1,4})$/.exec(token);

        if (singleMatch) {
          const index = clampParagraphIndex(Number.parseInt(singleMatch[1] ?? "", 10) - 1, paragraphCount);

          if (index !== null) {
            ranges.push({ start: index, end: index });
          }
        }
      }
    }
  }

  if (ranges.length === 0) {
    return [];
  }

  const indexed = new Set<number>();
  for (const range of ranges) {
    for (let index = range.start; index <= range.end; index += 1) {
      indexed.add(index);
    }
  }

  const sorted = Array.from(indexed).sort((left, right) => left - right);
  const merged: Array<{ start: number; end: number }> = [];

  for (const index of sorted) {
    const current = merged[merged.length - 1];

    if (!current || index > current.end + 1) {
      merged.push({ start: index, end: index });
      continue;
    }

    current.end = index;
  }

  return merged;
}

function splitLongRange(range: { start: number; end: number }, maxLength: number): Array<{ start: number; end: number }> {
  const safeMaxLength = Math.max(1, Math.floor(maxLength));
  const length = range.end - range.start + 1;

  if (length <= safeMaxLength) {
    return [range];
  }

  const chunks: Array<{ start: number; end: number }> = [];

  for (let start = range.start; start <= range.end; start += safeMaxLength) {
    chunks.push({
      start,
      end: Math.min(range.end, start + safeMaxLength - 1)
    });
  }

  return chunks;
}

function clampParagraphIndex(value: number, paragraphCount: number): number | null {
  if (!Number.isFinite(value) || paragraphCount <= 0) {
    return null;
  }

  if (value < 0) {
    return 0;
  }

  if (value >= paragraphCount) {
    return paragraphCount - 1;
  }

  return value;
}

export function getReviewParagraphLabel(item: EditorialReviewItem, revision: ManuscriptRevisionState): string {
  const firstBlockId = item.anchor.blockIds[0];
  const index = revision.blockOrder.indexOf(firstBlockId);
  return index >= 0 ? formatParagraphLabel(index) : "?";
}

export function getReviewParagraphRangeLabel(item: EditorialReviewItem, revision: ManuscriptRevisionState, locale: AppLocale = "uk"): string {
  const indexes = item.anchor.blockIds
    .map((blockId) => revision.blockOrder.indexOf(blockId))
    .filter((index) => index >= 0);

  if (indexes.length === 0) {
    return formatParagraphRangeLabel(locale, "?");
  }

  const start = formatParagraphLabel(Math.min(...indexes));
  const end = formatParagraphLabel(Math.max(...indexes));

  return formatParagraphRangeLabel(locale, start, end);
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
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");

  if (REVIEW_VISUAL_INTENTS.includes(normalized as EditorialVisualIntent)) {
    return normalized as EditorialVisualIntent;
  }

  return LEGACY_VISUAL_INTENT_MAP[normalized];
}

function normalizeEmphasisTarget(record: Record<string, unknown>): EditorialEmphasisTarget | undefined {
  const rawText =
    normalizeCopy(record.emphasisText, 180)
    ?? normalizeCopy(record.phrase, 180)
    ?? extractEmphasisTargetFromCopy(record.recommendation)
    ?? extractEmphasisTargetFromCopy(record.title);

  if (!rawText) {
    return undefined;
  }

  const occurrenceValue = record.occurrence ?? record.emphasisOccurrence;
  const occurrence =
    typeof occurrenceValue === "number" && Number.isInteger(occurrenceValue) && occurrenceValue > 1
      ? occurrenceValue
      : typeof occurrenceValue === "string" && /^\d+$/.test(occurrenceValue) && Number.parseInt(occurrenceValue, 10) > 1
        ? Number.parseInt(occurrenceValue, 10)
        : undefined;

  return occurrence ? { text: rawText, occurrence } : { text: rawText };
}

function resolveEmphasisAnchorIndex(
  document: EditorDocument,
  paragraphs: ReturnType<typeof getManuscriptParagraphs>,
  record: Record<string, unknown>,
  emphasisTarget?: EditorialEmphasisTarget
): number | null {
  if (!emphasisTarget?.text) {
    return null;
  }

  const requestedBlockId = normalizeRequestedBlockId(record.blockId ?? record.anchorBlockId);
  const requestedIndexFromId =
    requestedBlockId
      ? paragraphs.findIndex((paragraph) => paragraph.id === requestedBlockId)
      : -1;
  const requestedIndexFromNumber = normalizeIndex(record.blockStart ?? record.paragraphStart, paragraphs.length);
  const requestedIndex = requestedIndexFromId >= 0 ? requestedIndexFromId : requestedIndexFromNumber;

  if (requestedIndex !== null && blockContainsEmphasisTarget(paragraphs[requestedIndex]?.text ?? "", emphasisTarget)) {
    return requestedIndex;
  }

  const matchingIndexes = paragraphs
    .map((paragraph, index) => (blockContainsEmphasisTarget(paragraph.text, emphasisTarget) ? index : -1))
    .filter((index) => index >= 0);

  if (matchingIndexes.length === 0) {
    return requestedIndex;
  }

  if (matchingIndexes.length === 1) {
    return matchingIndexes[0] ?? requestedIndex;
  }

  const normalizedExcerpt = normalizeCopy(record.excerpt, 420);
  const excerptMatchedIndexes = normalizedExcerpt
    ? matchingIndexes.filter((index) => {
        const blockText = getBlockText(getBlock(document, paragraphs[index]?.id)!).replace(/\s+/g, " ").trim();
        return blockText.includes(normalizedExcerpt) || normalizedExcerpt.includes(blockText);
      })
    : [];

  if (excerptMatchedIndexes.length === 1) {
    return excerptMatchedIndexes[0] ?? requestedIndex;
  }

  if (requestedIndex !== null) {
    const nearbyMatch = matchingIndexes
      .map((index) => ({ index, distance: Math.abs(index - requestedIndex) }))
      .sort((left, right) => left.distance - right.distance)[0];

    if (nearbyMatch && nearbyMatch.distance <= 2) {
      return nearbyMatch.index;
    }
  }

  return requestedIndex;
}

function normalizeRequestedBlockId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function blockContainsEmphasisTarget(text: string, emphasisTarget: EditorialEmphasisTarget): boolean {
  const occurrence = Math.max(1, emphasisTarget.occurrence ?? 1);
  return findOccurrenceRange(text, emphasisTarget.text, occurrence) !== null;
}

function findOccurrenceRange(text: string, phrase: string, occurrence: number): { start: number; end: number } | null {
  if (!phrase) {
    return null;
  }

  let searchFrom = 0;

  for (let current = 1; current <= occurrence; current += 1) {
    const start = text.indexOf(phrase, searchFrom);

    if (start < 0) {
      return null;
    }

    if (current === occurrence) {
      return { start, end: start + phrase.length };
    }

    searchFrom = start + 1;
  }

  return null;
}

function extractEmphasisTargetFromCopy(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const quoteMatch = value.match(/["'`«“](.+?)["'`»”]/u);
  const markdownMatch = value.match(/\*\*(.+?)\*\*/u);
  const candidate = quoteMatch?.[1] ?? markdownMatch?.[1] ?? value;
  const normalized = trimWrappedQuotes(candidate.replace(/\s+/g, " ").trim());
  return normalized || undefined;
}

function buildEmphasisTitle(value?: string): string {
  const text = trimToLength((value ?? "").trim(), 72);
  return text ? `Акцент: «${text}»` : "";
}

function buildEmphasisRecommendation(value?: string): string {
  const text = trimWrappedQuotes((value ?? "").trim());
  return text ? `Виділити жирним: «${text}».` : "";
}

function trimWrappedQuotes(value: string): string {
  return value
    .replace(/^["'`«“”„]+/u, "")
    .replace(/["'`»“”„]+$/u, "")
    .trim();
}

function trimToLength(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function parseEditorialCalloutDepth(value: unknown): EditorialCalloutDepth | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[_\s-]+/g, " ");

  if (!normalized) {
    return null;
  }

  if (
    normalized === "deep" ||
    normalized === "deep dive" ||
    normalized === "докладно" ||
    normalized === "детально" ||
    normalized === "глибоко" ||
    /\bdeep\b/.test(normalized) ||
    /докладн|детальн|глибок|розгорнут/.test(normalized)
  ) {
    return "deep";
  }

  if (
    normalized === "brief" ||
    normalized === "short" ||
    normalized === "стисло" ||
    normalized === "коротко" ||
    /стисл|коротк|brief|short/.test(normalized)
  ) {
    return "brief";
  }

  return null;
}

function normalizeCalloutDepthForRecord(record: Record<string, unknown>): EditorialCalloutDepth {
  const explicit = parseEditorialCalloutDepth(record.calloutDepth);

  if (explicit === "deep" || hasDeepCalloutIntent(record)) {
    return "deep";
  }

  return explicit ?? "brief";
}

function hasDeepCalloutIntent(record: Record<string, unknown>): boolean {
  const text = [
    record.title,
    record.reason,
    record.recommendation,
    record.calloutTitle,
    record.calloutPrompt,
    record.calloutSummary
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return /глибок|докладн|детальн|розгорнут|\bdeep\b/.test(text);
}

function normalizeCalloutDraft(
  record: Record<string, unknown>,
  resolvedDepth?: EditorialCalloutDepth
): EditorialReviewItem["calloutDraft"] | undefined {
  const kind = normalizeCalloutKind(record.calloutKind);
  const depth = resolvedDepth ?? normalizeCalloutDepthForRecord(record);
  const title = normalizeCopy(record.calloutTitle, 90);
  const prompt = normalizeCopy(record.calloutPrompt, 600);
  const previewText = normalizeCopy(record.calloutPreviewText, depth === "deep" ? 2600 : 600);

  if (!kind || !title || !prompt || !previewText) {
    return undefined;
  }

  return {
    calloutKind: kind,
    calloutDepth: depth,
    title,
    prompt,
    previewText
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

function applyReplaceRangeGuard(
  paragraphs: ReturnType<typeof getManuscriptParagraphs>,
  range: { start: number; end: number },
  recommendationType: EditorialReviewRecommendationType
): { start: number; end: number; clipped: boolean } {
  if (!isReplaceReviewType(recommendationType)) {
    return { ...range, clipped: false };
  }

  const hasNonHeading = paragraphs.slice(range.start, range.end + 1).some((paragraph) => paragraph.type !== "heading");

  if (!hasNonHeading) {
    return { ...range, clipped: false };
  }

  let nextStart = range.start;
  let nextEnd = range.end;
  let clipped = false;

  while (nextStart < nextEnd && paragraphs[nextStart]?.type === "heading") {
    nextStart += 1;
    clipped = true;
  }

  while (nextEnd > nextStart && paragraphs[nextEnd]?.type === "heading") {
    nextEnd -= 1;
    clipped = true;
  }

  return { start: nextStart, end: nextEnd, clipped };
}

function appendRangeClipNote(reason: string): string {
  const note = "Діапазон автоматично обрізано, щоб не захопити сусідній заголовок.";

  if (reason.includes(note)) {
    return reason;
  }

  return `${reason} ${note}`.slice(0, 420);
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
