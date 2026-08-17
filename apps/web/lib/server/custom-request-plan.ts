import type { Block, EditorDocument } from "../editor/document-model.ts";
import { getBlockText } from "../editor/document-model.ts";
import { formatParagraphLabel } from "../editor/manuscript-structure.ts";
import {
  CUSTOM_REQUEST_PLAN_MAX_ACTIONS,
  CUSTOM_REQUEST_PLAN_RECOMMENDATION_TYPES,
  normalizeCustomRequestPlan,
  type CustomRequestPlan,
  type CustomRequestPlanAction,
  type EditorialReviewRequest
} from "../editor/review-contract.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import { getReviewPromptScaffold } from "../i18n/server-prompts/review.ts";
import { sliceDocumentForFragmentRetry } from "../editor/review-run-progress.ts";

/**
 * Packing rule for the chapter-level custom-request plan call:
 * 1. Always include every heading as an outline line: `H{level} [blockId] text`.
 * 2. Split the manuscript into sections at H2 boundaries (content before the first H2 is its own section).
 * 3. From each section, take up to CUSTOM_REQUEST_PLAN_SAMPLES_PER_SECTION sample content blocks
 *    (paragraph / list / callout / table), preferring first, middle, and last meaningful blocks.
 * 4. Truncate each sample to CUSTOM_REQUEST_PLAN_SAMPLE_CHARS and format as `абз. NNN [blockId] text`.
 * 5. If outline + samples exceed CUSTOM_REQUEST_PLAN_PACK_BUDGET_CHARS, drop sample lines from the
 *    end of the document first; never drop the outline. Prefer outline + section samples over the
 *    full ~140k body.
 */
export const CUSTOM_REQUEST_PLAN_PACK_BUDGET_CHARS = 24_000;
export const CUSTOM_REQUEST_PLAN_SAMPLE_CHARS = 160;
export const CUSTOM_REQUEST_PLAN_SAMPLES_PER_SECTION = 3;

export const REVIEW_PLAN_NAMESPACE = "review-plan";

export interface CustomRequestPlanPack {
  outlineText: string;
  samplesText: string;
  packedText: string;
  outlineLineCount: number;
  sampleLineCount: number;
  truncated: boolean;
}

export function buildCustomRequestGenerateSystemPrompt(locale: AppLocale): string {
  const scaffold = getReviewPromptScaffold(locale);
  return [
    scaffold.customRequestGenerateRole,
    scaffold.customRequestGenerateJsonFormat,
    scaffold.customRequestGenerateSeedRule,
    scaffold.customRequestGenerateOneCardRule,
    scaffold.idsInBracketsRule
  ].join("\n");
}

export function buildCustomRequestGenerateUserPrompt(input: {
  request: EditorialReviewRequest;
  action: CustomRequestPlanAction;
  customPrompt: string;
  locale: AppLocale;
}): string {
  const scaffold = getReviewPromptScaffold(input.locale);
  const scopedDocument = sliceDocumentForFragmentRetry(input.request.document, {
    coreBlockIds: [input.action.blockId]
  }) ?? input.request.document;
  const lines = scopedDocument.blocks.map((block, index) => {
    const absoluteIndex = input.request.document.blocks.findIndex((entry) => entry.id === block.id);
    const label = formatParagraphLabel(absoluteIndex >= 0 ? absoluteIndex : index);
    return `${index + 1}. абз. ${label} [${block.id}] ${getBlockText(block).replace(/\s+/g, " ").trim()}`;
  });

  return [
    scaffold.finalEditingCustomPromptPrefix,
    input.customPrompt.trim(),
    "",
    "Planned action:",
    JSON.stringify({
      blockId: input.action.blockId,
      recommendationType: input.action.recommendationType,
      title: input.action.title,
      recommendation: input.action.recommendation,
      priority: input.action.priority
    }),
    "",
    scaffold.documentLabel,
    lines.join("\n")
  ].join("\n");
}

export function mergePlanActionIntoProviderItem(
  rawItem: unknown,
  action: CustomRequestPlanAction
): Record<string, unknown> {
  const record = rawItem && typeof rawItem === "object" ? { ...(rawItem as Record<string, unknown>) } : {};
  return {
    ...record,
    blockId: action.blockId,
    recommendationType: action.recommendationType,
    title: typeof record.title === "string" && record.title.trim() ? record.title : action.title,
    recommendation:
      typeof record.recommendation === "string" && record.recommendation.trim()
        ? record.recommendation
        : action.recommendation,
    priority: record.priority === "high" || record.priority === "low" || record.priority === "medium"
      ? record.priority
      : action.priority,
    reason:
      typeof record.reason === "string" && record.reason.trim()
        ? record.reason
        : action.recommendation
  };
}

export function packCustomRequestPlanDocument(document: EditorDocument): CustomRequestPlanPack {
  const outlineLines: string[] = [];
  const sampleCandidates: Array<{ sectionOrder: number; line: string }> = [];

  for (const [index, block] of document.blocks.entries()) {
    if (block.type === "heading") {
      const text = getBlockText(block).replace(/\s+/g, " ").trim();
      outlineLines.push(`H${block.level} [${block.id}] ${text}`);
    }
  }

  const sections = splitBlocksIntoH2Sections(document.blocks);
  for (const [sectionOrder, section] of sections.entries()) {
    const meaningful = section
      .map((entry) => entry)
      .filter((entry) => isSampleableBlock(entry.block) && getBlockText(entry.block).trim().length >= 24);

    if (meaningful.length === 0) {
      continue;
    }

    const picks = pickSectionSampleIndexes(meaningful.length, CUSTOM_REQUEST_PLAN_SAMPLES_PER_SECTION);
    for (const pick of picks) {
      const entry = meaningful[pick];
      const text = truncateSample(getBlockText(entry.block), CUSTOM_REQUEST_PLAN_SAMPLE_CHARS);
      sampleCandidates.push({
        sectionOrder,
        line: `абз. ${formatParagraphLabel(entry.index)} [${entry.block.id}] ${text}`
      });
    }
  }

  const outlineText = outlineLines.join("\n");
  const budgetForSamples = Math.max(0, CUSTOM_REQUEST_PLAN_PACK_BUDGET_CHARS - outlineText.length - 64);
  const keptSamples: string[] = [];
  let used = 0;
  let truncated = false;

  for (const candidate of sampleCandidates) {
    const nextCost = candidate.line.length + (keptSamples.length > 0 ? 1 : 0);
    if (used + nextCost > budgetForSamples) {
      truncated = true;
      break;
    }
    keptSamples.push(candidate.line);
    used += nextCost;
  }

  const samplesText = keptSamples.join("\n");
  const packedText = [
    outlineText ? `OUTLINE\n${outlineText}` : "OUTLINE\n(none)",
    samplesText ? `SAMPLES\n${samplesText}` : "SAMPLES\n(none)"
  ].join("\n\n");

  return {
    outlineText,
    samplesText,
    packedText,
    outlineLineCount: outlineLines.length,
    sampleLineCount: keptSamples.length,
    truncated
  };
}

export function buildCustomRequestPlanSystemPrompt(locale: AppLocale): string {
  const scaffold = getReviewPromptScaffold(locale);
  const types = CUSTOM_REQUEST_PLAN_RECOMMENDATION_TYPES.join(", ");

  return [
    scaffold.customRequestPlanRole,
    scaffold.customRequestPlanJsonFormat(types),
    scaffold.customRequestPlanAnchorRule,
    scaffold.customRequestPlanSeedRule,
    scaffold.customRequestPlanVolumeRule(CUSTOM_REQUEST_PLAN_MAX_ACTIONS),
    scaffold.customRequestPlanNoCardsRule,
    scaffold.idsInBracketsRule
  ].join("\n");
}

export function buildCustomRequestPlanUserPrompt(input: {
  request: EditorialReviewRequest;
  customPrompt: string;
  locale: AppLocale;
  pack?: CustomRequestPlanPack;
}): string {
  const scaffold = getReviewPromptScaffold(input.locale);
  const pack = input.pack ?? packCustomRequestPlanDocument(input.request.document);

  return [
    scaffold.finalEditingCustomPromptPrefix,
    input.customPrompt.trim(),
    "",
    scaffold.customRequestPlanDocumentPrefix,
    pack.packedText
  ].join("\n");
}

export function parseCustomRequestPlanPayload(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = /\{[\s\S]*\}/.exec(content);
    if (!match) {
      return { actions: [] };
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return { actions: [] };
    }
  }
}

export function buildValidatedCustomRequestPlan(input: {
  raw: unknown;
  document: EditorDocument;
  documentRevisionId?: string;
  stepRunId?: string;
}): CustomRequestPlan {
  return normalizeCustomRequestPlan({
    raw: input.raw,
    document: input.document,
    documentRevisionId: input.documentRevisionId,
    stepRunId: input.stepRunId
  }).plan;
}

export const openAiCustomRequestPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          blockId: { type: "string" },
          recommendationType: {
            type: "string",
            enum: [...CUSTOM_REQUEST_PLAN_RECOMMENDATION_TYPES]
          },
          title: { type: "string" },
          recommendation: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] }
        },
        required: ["blockId", "recommendationType", "title", "recommendation", "priority"]
      }
    }
  },
  required: ["actions"]
} as const;

export const geminiCustomRequestPlanSchema = {
  type: "OBJECT",
  properties: {
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          blockId: { type: "STRING" },
          recommendationType: { type: "STRING" },
          title: { type: "STRING" },
          recommendation: { type: "STRING" },
          priority: { type: "STRING" }
        },
        required: ["blockId", "recommendationType", "title", "recommendation", "priority"]
      }
    }
  },
  required: ["actions"]
} as const;

function splitBlocksIntoH2Sections(blocks: Block[]): Array<Array<{ index: number; block: Block }>> {
  const sections: Array<Array<{ index: number; block: Block }>> = [];
  let current: Array<{ index: number; block: Block }> = [];

  for (const [index, block] of blocks.entries()) {
    if (block.type === "heading" && block.level <= 2 && current.length > 0) {
      sections.push(current);
      current = [];
    }
    current.push({ index, block });
  }

  if (current.length > 0) {
    sections.push(current);
  }

  return sections;
}

function isSampleableBlock(block: Block): boolean {
  return block.type === "paragraph" ||
    block.type === "bullet_list" ||
    block.type === "ordered_list" ||
    block.type === "callout" ||
    block.type === "table";
}

function pickSectionSampleIndexes(length: number, maxSamples: number): number[] {
  if (length <= maxSamples) {
    return Array.from({ length }, (_, index) => index);
  }

  if (maxSamples === 1) {
    return [0];
  }

  if (maxSamples === 2) {
    return [0, length - 1];
  }

  return [0, Math.floor((length - 1) / 2), length - 1];
}

function truncateSample(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
