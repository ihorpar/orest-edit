import { getManuscriptParagraphs } from "./manuscript-structure";
import { createPatchId } from "./patch-contract";

export type EditorialReviewCategory = "clarity" | "structure" | "tone";
export type EditorialReviewSeverity = "high" | "medium" | "low";

export interface EditorialReviewRequest {
  text: string;
  provider: string;
  modelId: string;
  apiKey?: string;
  basePrompt?: string;
}

export interface EditorialReviewItem {
  id: string;
  category: EditorialReviewCategory;
  severity: EditorialReviewSeverity;
  title: string;
  explanation: string;
  recommendation: string;
  paragraphStart: number;
  paragraphEnd: number;
  excerpt: string;
}

export interface EditorialReviewDiagnostics {
  requestId: string;
  requestedProvider: string;
  requestedModelId: string;
  textLength: number;
  returnedItemCount: number;
  droppedItemCount: number;
  generatedAt: string;
  rawOutput?: string;
}

export interface EditorialReviewResponse {
  items: EditorialReviewItem[];
  providerUsed: string;
  usedFallback: boolean;
  error?: string;
  diagnostics: EditorialReviewDiagnostics;
}

const REVIEW_CATEGORIES: EditorialReviewCategory[] = ["clarity", "structure", "tone"];
const REVIEW_SEVERITIES: EditorialReviewSeverity[] = ["high", "medium", "low"];

export function normalizeEditorialReviewItems(text: string, items: unknown): { items: EditorialReviewItem[]; droppedCount: number } {
  if (!Array.isArray(items)) {
    return { items: [], droppedCount: 0 };
  }

  const paragraphs = getManuscriptParagraphs(text);
  const normalized: EditorialReviewItem[] = [];
  let droppedCount = 0;

  for (const [index, candidate] of items.entries()) {
    if (!candidate || typeof candidate !== "object") {
      droppedCount += 1;
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const paragraphStart = normalizeIndex(record.paragraphStart, paragraphs.length);
    const paragraphEnd = normalizeIndex(record.paragraphEnd, paragraphs.length);
    const title = normalizeCopy(record.title, 80);
    const explanation = normalizeCopy(record.explanation, 900);
    const recommendation = normalizeCopy(record.recommendation, 900);
    const excerpt = normalizeExcerptCopy(record.excerpt, 360);

    if (paragraphStart === null || paragraphEnd === null || paragraphStart > paragraphEnd || !title || !explanation || !recommendation) {
      droppedCount += 1;
      continue;
    }

    const paragraphRange = paragraphs.filter((paragraph) => paragraph.index >= paragraphStart && paragraph.index <= paragraphEnd);
    const derivedExcerpt = paragraphRange
      .map((paragraph) => paragraph.text)
      .join(" ")
      .trim()
      .replace(/\s+/g, " ");

    if (!derivedExcerpt) {
      droppedCount += 1;
      continue;
    }

    normalized.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id : createPatchId(`review-${index + 1}`),
      category: normalizeCategory(record.category),
      severity: normalizeSeverity(record.severity),
      title,
      explanation,
      recommendation,
      paragraphStart,
      paragraphEnd,
      excerpt: (excerpt ?? derivedExcerpt).slice(0, 360)
    });
  }

  normalized.sort((left, right) => left.paragraphStart - right.paragraphStart || left.paragraphEnd - right.paragraphEnd);

  const deduped: EditorialReviewItem[] = [];

  for (const item of normalized) {
    const previous = deduped[deduped.length - 1];

    if (
      previous &&
      previous.paragraphStart === item.paragraphStart &&
      previous.paragraphEnd === item.paragraphEnd &&
      previous.title === item.title
    ) {
      droppedCount += 1;
      continue;
    }

    deduped.push(item);
  }

  return { items: deduped.slice(0, 8), droppedCount };
}

function normalizeCategory(value: unknown): EditorialReviewCategory {
  return REVIEW_CATEGORIES.includes(value as EditorialReviewCategory) ? (value as EditorialReviewCategory) : "clarity";
}

function normalizeSeverity(value: unknown): EditorialReviewSeverity {
  return REVIEW_SEVERITIES.includes(value as EditorialReviewSeverity) ? (value as EditorialReviewSeverity) : "medium";
}

function normalizeIndex(value: unknown, textLength: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  return normalized >= 0 && normalized <= textLength ? normalized : null;
}

function normalizeCopy(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeExcerptCopy(value: unknown, maxLength: number): string | null {
  const normalized = normalizeCopy(value, maxLength);

  if (!normalized) {
    return null;
  }

  return normalized.replace(/^["«]+|["»]+$/g, "").trim();
}
