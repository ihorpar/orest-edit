import type { InlineNode } from "./document-model.ts";
import { parseBoldMarkdownToInlineNodes } from "./inline-markup.ts";
import type { EditorialCalloutKind } from "./review-contract.ts";

const CALLOUT_BULLET_RE = /^[-*•]\s+/u;
const CALLOUT_NUMBERED_RE = /^\d+[.)]\s+/u;

export function splitCalloutDraftIntoParagraphs(text: string, kind: EditorialCalloutKind): InlineNode[][] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const parts =
    kind === "top_list" || kind === "myths_vs_truth"
      ? normalized
          .split("\n")
          .map((part) => normalizeCalloutListLine(part.trim()))
          .filter(Boolean)
      : splitStructuredCalloutBody(normalized);

  return (parts.length > 0 ? parts : [""]).map((part) => parseBoldMarkdownToInlineNodes(part));
}

export function isCalloutSectionHeadingText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const withoutBoldMarkers = trimmed.replace(/\*\*/g, "").trim();
  if (!withoutBoldMarkers || isCalloutListLine(withoutBoldMarkers)) {
    return false;
  }

  const normalized = withoutBoldMarkers.replace(/[.:]\s*$/u, "").trim();
  if (!normalized || /[,;!?]/u.test(normalized) || normalized.includes("\n")) {
    return false;
  }

  const words = normalized.split(/\s+/u).filter(Boolean);
  if (words.length === 0 || words.length > 6 || normalized.length > 72) {
    return false;
  }

  return /^\p{Lu}/u.test(normalized);
}

function splitStructuredCalloutBody(text: string): string[] {
  const paragraphs: string[] = [];
  const lines = text.split("\n");
  let currentParagraphLines: string[] = [];

  const flushParagraph = () => {
    if (currentParagraphLines.length === 0) {
      return;
    }

    const paragraph = currentParagraphLines.join(" ").replace(/\s+/g, " ").trim();
    currentParagraphLines = [];

    if (paragraph) {
      paragraphs.push(paragraph);
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";

    if (!line) {
      flushParagraph();
      continue;
    }

    if (isCalloutListLine(line)) {
      flushParagraph();
      paragraphs.push(normalizeCalloutListLine(line));
      continue;
    }

    const nextNonEmptyLine = getNextNonEmptyLine(lines, index + 1);
    if (currentParagraphLines.length === 0 && isStandaloneCalloutSectionHeading(line, nextNonEmptyLine)) {
      flushParagraph();
      paragraphs.push(emphasizeCalloutSectionHeading(line));
      continue;
    }

    currentParagraphLines.push(line);
  }

  flushParagraph();
  return paragraphs;
}

function getNextNonEmptyLine(lines: string[], startIndex: number): string | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const candidate = lines[index]?.trim() ?? "";
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function isStandaloneCalloutSectionHeading(line: string, nextNonEmptyLine: string | null): boolean {
  if (!nextNonEmptyLine) {
    return false;
  }

  return isCalloutSectionHeadingText(line);
}

function emphasizeCalloutSectionHeading(line: string): string {
  const trimmed = line.trim();
  return trimmed.includes("**") ? trimmed : `**${trimmed}**`;
}

function isCalloutListLine(line: string): boolean {
  return CALLOUT_BULLET_RE.test(line) || CALLOUT_NUMBERED_RE.test(line);
}

function normalizeCalloutListLine(line: string): string {
  if (CALLOUT_NUMBERED_RE.test(line)) {
    return line.replace(/^(\d+)[)]\s+/u, "$1. ").trim();
  }

  if (CALLOUT_BULLET_RE.test(line)) {
    return line.replace(CALLOUT_BULLET_RE, "• ").trim();
  }

  return line.trim();
}
