import type { PatchSelection } from "./patch-contract";

export interface ManuscriptParagraph {
  index: number;
  start: number;
  end: number;
  text: string;
  id: string;
  label: string;
}

export function getManuscriptParagraphs(text: string): ManuscriptParagraph[] {
  const paragraphs: ManuscriptParagraph[] = [];
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

export function resolveReviewSelection(
  text: string,
  paragraphStart: number,
  paragraphEnd: number,
  excerpt?: string
): PatchSelection {
  const paragraphs = getManuscriptParagraphs(text);
  const startParagraph = paragraphs.find((paragraph) => paragraph.index === paragraphStart);
  const endParagraph = paragraphs.find((paragraph) => paragraph.index === paragraphEnd);

  if (!startParagraph || !endParagraph) {
    return { start: 0, end: 0 };
  }

  const rangeStart = startParagraph.start;
  const rangeEnd = endParagraph.end;
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

export function findParagraphForOffset(text: string, offset: number): number | null {
  const paragraphs = getManuscriptParagraphs(text);
  const match = paragraphs.find((paragraph) => offset >= paragraph.start && offset <= paragraph.end);
  return match?.index ?? null;
}

export function formatParagraphLabel(index: number): string {
  return String(index).padStart(3, "0");
}

function pushParagraph(paragraphs: ManuscriptParagraph[], text: string, rawStart: number, rawEnd: number) {
  const segment = text.slice(rawStart, rawEnd);
  const trimmed = segment.trim();

  if (!trimmed) {
    return;
  }

  const leadingWhitespaceLength = segment.match(/^\s*/)?.[0].length ?? 0;
  const trailingWhitespaceLength = segment.match(/\s*$/)?.[0].length ?? 0;
  const start = rawStart + leadingWhitespaceLength;
  const end = rawEnd - trailingWhitespaceLength;
  const index = paragraphs.length + 1;

  paragraphs.push({
    index,
    start,
    end,
    text: text.slice(start, end),
    id: `paragraph-${formatParagraphLabel(index)}`,
    label: formatParagraphLabel(index)
  });
}

function normalizeExcerpt(excerpt?: string): string | null {
  if (!excerpt) {
    return null;
  }

  const normalized = excerpt.trim().replace(/^["«]+|["»]+$/g, "").replace(/\s+/g, " ");
  return normalized || null;
}
