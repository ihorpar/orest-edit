import { createPatchId, type PatchSelection } from "./patch-contract";
import type { EditorialReviewItem } from "./review-contract";

export interface ManuscriptParagraphSnapshot {
  text: string;
  start: number;
  end: number;
}

export interface ManuscriptRevisionState {
  documentRevisionId: string;
  textHash: string;
  paragraphOrder: string[];
  paragraphsById: Record<string, ManuscriptParagraphSnapshot>;
}

export interface ManuscriptParagraph extends ManuscriptParagraphSnapshot {
  index: number;
  id: string;
  label: string;
}

interface RawParagraph {
  start: number;
  end: number;
  text: string;
}

export function deriveManuscriptRevisionState(
  text: string,
  previousState?: ManuscriptRevisionState | null
): ManuscriptRevisionState {
  const rawParagraphs = extractRawParagraphs(text);
  const textHash = hashText(text);

  if (previousState && previousState.textHash === textHash) {
    return previousState;
  }

  const previousParagraphs = previousState
    ? previousState.paragraphOrder.map((id) => ({
        id,
        normalizedText: normalizeParagraphText(previousState.paragraphsById[id]?.text ?? "")
      }))
    : [];
  const nextNormalizedTexts = rawParagraphs.map((paragraph) => normalizeParagraphText(paragraph.text));
  const matchedPairs = previousParagraphs.length > 0 ? computeStableParagraphMatches(previousParagraphs, nextNormalizedTexts) : new Map<number, string>();

  const paragraphOrder: string[] = [];
  const paragraphsById: Record<string, ManuscriptParagraphSnapshot> = {};

  rawParagraphs.forEach((paragraph, index) => {
    const id = matchedPairs.get(index) ?? createPatchId("paragraph");
    paragraphOrder.push(id);
    paragraphsById[id] = {
      text: paragraph.text,
      start: paragraph.start,
      end: paragraph.end
    };
  });

  return {
    documentRevisionId: createPatchId("revision"),
    textHash,
    paragraphOrder,
    paragraphsById
  };
}

export function getManuscriptParagraphs(text: string, revisionState?: ManuscriptRevisionState | null): ManuscriptParagraph[] {
  const rawParagraphs = extractRawParagraphs(text);

  if (revisionState && revisionState.textHash === hashText(text) && revisionState.paragraphOrder.length === rawParagraphs.length) {
    return revisionState.paragraphOrder.map((id, index) => ({
      index: index + 1,
      id,
      label: formatParagraphLabel(index + 1),
      start: revisionState.paragraphsById[id]?.start ?? rawParagraphs[index]?.start ?? 0,
      end: revisionState.paragraphsById[id]?.end ?? rawParagraphs[index]?.end ?? 0,
      text: revisionState.paragraphsById[id]?.text ?? rawParagraphs[index]?.text ?? ""
    }));
  }

  return rawParagraphs.map((paragraph, index) => ({
    index: index + 1,
    id: `paragraph-${formatParagraphLabel(index + 1)}`,
    label: formatParagraphLabel(index + 1),
    start: paragraph.start,
    end: paragraph.end,
    text: paragraph.text
  }));
}

export function resolveReviewSelection(
  text: string,
  paragraphStart: number,
  paragraphEnd: number,
  excerpt?: string,
  revisionState?: ManuscriptRevisionState | null
): PatchSelection {
  const paragraphs = getManuscriptParagraphs(text, revisionState);
  const startParagraph = paragraphs.find((paragraph) => paragraph.index === paragraphStart);
  const endParagraph = paragraphs.find((paragraph) => paragraph.index === paragraphEnd);

  if (!startParagraph || !endParagraph) {
    return { start: 0, end: 0 };
  }

  return resolveRangeSelection(text, startParagraph.start, endParagraph.end, excerpt);
}

export function resolveReviewItemSelection(
  text: string,
  revisionState: ManuscriptRevisionState,
  item: Pick<EditorialReviewItem, "anchor">
): PatchSelection {
  const paragraphs = item.anchor.paragraphIds
    .map((id) => revisionState.paragraphsById[id])
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);

  if (paragraphs.length === 0) {
    return { start: 0, end: 0 };
  }

  return resolveRangeSelection(text, paragraphs[0].start, paragraphs[paragraphs.length - 1].end, item.anchor.excerpt);
}

export function areParagraphIdsResolvable(revisionState: ManuscriptRevisionState, paragraphIds: string[]): boolean {
  return paragraphIds.length > 0 && paragraphIds.every((id) => Boolean(revisionState.paragraphsById[id]));
}

export function getParagraphRangeForIds(
  revisionState: ManuscriptRevisionState,
  paragraphIds: string[]
): { start: number; end: number } | null {
  const indices = paragraphIds
    .map((id) => revisionState.paragraphOrder.indexOf(id))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);

  if (indices.length === 0) {
    return null;
  }

  return {
    start: indices[0] + 1,
    end: indices[indices.length - 1] + 1
  };
}

export function getParagraphRangeText(revisionState: ManuscriptRevisionState, paragraphIds: string[]): string {
  return paragraphIds
    .map((id) => revisionState.paragraphsById[id]?.text ?? "")
    .filter(Boolean)
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");
}

export function computeAnchorFingerprint(revisionState: ManuscriptRevisionState, paragraphIds: string[], excerpt?: string): string {
  return hashText(`${getParagraphRangeText(revisionState, paragraphIds)}||${normalizeParagraphText(excerpt ?? "")}`);
}

export function findParagraphForOffset(text: string, offset: number, revisionState?: ManuscriptRevisionState | null): number | null {
  const paragraphs = getManuscriptParagraphs(text, revisionState);
  const match = paragraphs.find((paragraph) => offset >= paragraph.start && offset <= paragraph.end);
  return match?.index ?? null;
}

export function formatParagraphLabel(index: number): string {
  return String(index).padStart(3, "0");
}

export function hashText(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return Math.abs(hash >>> 0).toString(36);
}

function extractRawParagraphs(text: string): RawParagraph[] {
  const paragraphs: RawParagraph[] = [];
  const regex = /\n\s*\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    pushParagraph(paragraphs, text, cursor, match.index);
    cursor = match.index + match[0].length;
  }

  pushParagraph(paragraphs, text, cursor, text.length);
  return paragraphs;
}

function pushParagraph(paragraphs: RawParagraph[], text: string, rawStart: number, rawEnd: number) {
  const segment = text.slice(rawStart, rawEnd);
  const trimmed = segment.trim();

  if (!trimmed) {
    return;
  }

  const leadingWhitespaceLength = segment.match(/^\s*/)?.[0].length ?? 0;
  const trailingWhitespaceLength = segment.match(/\s*$/)?.[0].length ?? 0;
  const start = rawStart + leadingWhitespaceLength;
  const end = rawEnd - trailingWhitespaceLength;

  paragraphs.push({
    start,
    end,
    text: text.slice(start, end)
  });
}

function resolveRangeSelection(text: string, rangeStart: number, rangeEnd: number, excerpt?: string): PatchSelection {
  const normalizedExcerpt = normalizeExcerpt(excerpt);

  if (normalizedExcerpt) {
    const directIndex = text.slice(rangeStart, rangeEnd).indexOf(normalizedExcerpt);

    if (directIndex !== -1) {
      return {
        start: rangeStart + directIndex,
        end: rangeStart + directIndex + normalizedExcerpt.length
      };
    }
  }

  return {
    start: rangeStart,
    end: rangeEnd
  };
}

function computeStableParagraphMatches(
  previousParagraphs: Array<{ id: string; normalizedText: string }>,
  nextNormalizedTexts: string[]
): Map<number, string> {
  const matrix = Array.from({ length: previousParagraphs.length + 1 }, () => Array(nextNormalizedTexts.length + 1).fill(0));

  for (let previousIndex = previousParagraphs.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let nextIndex = nextNormalizedTexts.length - 1; nextIndex >= 0; nextIndex -= 1) {
      if (previousParagraphs[previousIndex]?.normalizedText && previousParagraphs[previousIndex]?.normalizedText === nextNormalizedTexts[nextIndex]) {
        matrix[previousIndex][nextIndex] = matrix[previousIndex + 1][nextIndex + 1] + 1;
      } else {
        matrix[previousIndex][nextIndex] = Math.max(matrix[previousIndex + 1][nextIndex], matrix[previousIndex][nextIndex + 1]);
      }
    }
  }

  const matches = new Map<number, string>();
  let previousIndex = 0;
  let nextIndex = 0;

  while (previousIndex < previousParagraphs.length && nextIndex < nextNormalizedTexts.length) {
    if (
      previousParagraphs[previousIndex]?.normalizedText &&
      previousParagraphs[previousIndex]?.normalizedText === nextNormalizedTexts[nextIndex]
    ) {
      matches.set(nextIndex, previousParagraphs[previousIndex].id);
      previousIndex += 1;
      nextIndex += 1;
      continue;
    }

    if (matrix[previousIndex + 1][nextIndex] >= matrix[previousIndex][nextIndex + 1]) {
      previousIndex += 1;
    } else {
      nextIndex += 1;
    }
  }

  return matches;
}

function normalizeExcerpt(excerpt?: string): string | null {
  if (!excerpt) {
    return null;
  }

  const normalized = excerpt.trim().replace(/^["«]+|["»]+$/g, "").replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeParagraphText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
