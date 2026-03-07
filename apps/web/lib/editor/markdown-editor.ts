import { clampSelection, hasSelection, type PatchSelection } from "./patch-contract";

export type MarkdownFormatAction =
  | "bold"
  | "italic"
  | "code"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "numbered-list"
  | "blockquote"
  | "link"
  | "divider"
  | "table";

export interface MarkdownEditResult {
  text: string;
  selection: PatchSelection;
}

export interface MarkdownImageBlock {
  start: number;
  end: number;
  markdown: string;
  alt: string;
  source: string;
  caption?: string;
}

const LINK_LABEL_PLACEHOLDER = "текст посилання";
const LINK_URL_PLACEHOLDER = "https://example.com";
const TABLE_TEMPLATE = ["| Колонка 1 | Колонка 2 |", "| --- | --- |", "| Значення | Значення |"].join("\n");
const IMAGE_BLOCK_PATTERN = /(^|\n\n)(!\[([^\]]*)\]\(([^)\n]+)\)(?:\n([^\n]+))?)(?=\n\n|$)/g;

export function applyMarkdownFormat(text: string, selection: PatchSelection, action: MarkdownFormatAction): MarkdownEditResult {
  switch (action) {
    case "bold":
      return wrapSelection(text, selection, "**", "**", "жирний текст");
    case "italic":
      return wrapSelection(text, selection, "*", "*", "акцент");
    case "code":
      return wrapSelection(text, selection, "`", "`", "код");
    case "heading-1":
      return toggleHeading(text, selection, 1);
    case "heading-2":
      return toggleHeading(text, selection, 2);
    case "heading-3":
      return toggleHeading(text, selection, 3);
    case "bullet-list":
      return toggleBulletList(text, selection);
    case "numbered-list":
      return toggleNumberedList(text, selection);
    case "blockquote":
      return toggleBlockquote(text, selection);
    case "link":
      return insertLink(text, selection);
    case "divider":
      return insertBlock(text, selection, "---");
    case "table":
      return insertBlock(text, selection, TABLE_TEMPLATE, true);
    default:
      return { text, selection: clampSelection(text, selection.start, selection.end) };
  }
}

function wrapSelection(
  text: string,
  selection: PatchSelection,
  prefix: string,
  suffix: string,
  placeholder: string
): MarkdownEditResult {
  const safeSelection = clampSelection(text, selection.start, selection.end);
  const selectedText = text.slice(safeSelection.start, safeSelection.end);
  const content = hasSelection(safeSelection) ? selectedText : placeholder;
  const replacement = `${prefix}${content}${suffix}`;
  const nextText = replaceRange(text, safeSelection.start, safeSelection.end, replacement);

  if (hasSelection(safeSelection)) {
    return {
      text: nextText,
      selection: {
        start: safeSelection.start + prefix.length,
        end: safeSelection.end + prefix.length
      }
    };
  }

  const contentStart = safeSelection.start + prefix.length;
  return {
    text: nextText,
    selection: {
      start: contentStart,
      end: contentStart + placeholder.length
    }
  };
}

function insertLink(text: string, selection: PatchSelection): MarkdownEditResult {
  const safeSelection = clampSelection(text, selection.start, selection.end);
  const hasText = hasSelection(safeSelection);
  const label = hasText ? text.slice(safeSelection.start, safeSelection.end) : LINK_LABEL_PLACEHOLDER;
  const replacement = `[${label}](${LINK_URL_PLACEHOLDER})`;
  const nextText = replaceRange(text, safeSelection.start, safeSelection.end, replacement);

  if (hasText) {
    const urlStart = safeSelection.start + label.length + 3;
    return {
      text: nextText,
      selection: {
        start: urlStart,
        end: urlStart + LINK_URL_PLACEHOLDER.length
      }
    };
  }

  return {
    text: nextText,
    selection: {
      start: safeSelection.start + 1,
      end: safeSelection.start + 1 + LINK_LABEL_PLACEHOLDER.length
    }
  };
}

function toggleHeading(text: string, selection: PatchSelection, level: 1 | 2 | 3): MarkdownEditResult {
  return mapSelectedLines(text, selection, (line) => {
    if (!line.trim()) {
      return line;
    }

    const stripped = line.replace(/^#{1,6}\s+/, "");
    const prefix = `${"#".repeat(level)} `;
    return line.startsWith(prefix) ? stripped : `${prefix}${stripped}`;
  });
}

function toggleBulletList(text: string, selection: PatchSelection): MarkdownEditResult {
  return toggleLinePrefix(text, selection, /^-\s+/, () => "- ");
}

function toggleNumberedList(text: string, selection: PatchSelection): MarkdownEditResult {
  return toggleLinePrefix(text, selection, /^\d+\.\s+/, (_, index) => `${index + 1}. `);
}

function toggleBlockquote(text: string, selection: PatchSelection): MarkdownEditResult {
  return toggleLinePrefix(text, selection, /^>\s+/, () => "> ");
}

function toggleLinePrefix(
  text: string,
  selection: PatchSelection,
  matcher: RegExp,
  createPrefix: (line: string, index: number) => string
): MarkdownEditResult {
  const range = getSelectedLineRange(text, selection);
  const block = text.slice(range.start, range.end);
  const lines = block.split("\n");
  const nonEmpty = lines.filter((line) => line.trim());
  const shouldRemove = nonEmpty.length > 0 && nonEmpty.every((line) => matcher.test(line));

  const nextBlock = lines
    .map((line, index) => {
      if (!line.trim()) {
        return line;
      }

      if (shouldRemove) {
        return line.replace(matcher, "");
      }

      return `${createPrefix(line, index)}${line}`;
    })
    .join("\n");

  return {
    text: replaceRange(text, range.start, range.end, nextBlock),
    selection: {
      start: range.start,
      end: range.start + nextBlock.length
    }
  };
}

function mapSelectedLines(
  text: string,
  selection: PatchSelection,
  transformLine: (line: string, index: number) => string
): MarkdownEditResult {
  const range = getSelectedLineRange(text, selection);
  const block = text.slice(range.start, range.end);
  const nextBlock = block
    .split("\n")
    .map((line, index) => transformLine(line, index))
    .join("\n");

  return {
    text: replaceRange(text, range.start, range.end, nextBlock),
    selection: {
      start: range.start,
      end: range.start + nextBlock.length
    }
  };
}

function insertBlock(text: string, selection: PatchSelection, block: string, selectBlock = false): MarkdownEditResult {
  const safeSelection = clampSelection(text, selection.start, selection.end);
  const insertionPoint = hasSelection(safeSelection) ? safeSelection.end : safeSelection.start;
  const prefix = getBlockPrefix(text, insertionPoint);
  const suffix = getBlockSuffix(text, insertionPoint);
  const replacement = `${prefix}${block}${suffix}`;
  const nextText = replaceRange(text, insertionPoint, insertionPoint, replacement);
  const blockStart = insertionPoint + prefix.length;
  const blockEnd = blockStart + block.length;

  return {
    text: nextText,
    selection: selectBlock ? { start: blockStart, end: blockEnd } : { start: blockEnd, end: blockEnd }
  };
}

export function insertMarkdownImageBlock(
  text: string,
  selection: PatchSelection,
  input: {
    alt: string;
    source: string;
    caption?: string;
  }
): MarkdownEditResult {
  const safeAlt = input.alt.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim() || "Зображення";
  const safeCaption = input.caption?.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const block = [`![${safeAlt}](${input.source.trim()})`, safeCaption].filter(Boolean).join("\n");

  return insertBlock(text, selection, block);
}

export function getMarkdownImageBlocks(text: string): MarkdownImageBlock[] {
  const blocks: MarkdownImageBlock[] = [];

  for (const match of text.matchAll(IMAGE_BLOCK_PATTERN)) {
    const prefix = match[1] ?? "";
    const markdown = match[2] ?? "";
    const alt = match[3] ?? "";
    const source = match[4] ?? "";
    const caption = match[5]?.trim() || undefined;
    const start = (match.index ?? 0) + prefix.length;
    const end = start + markdown.length;

    blocks.push({
      start,
      end,
      markdown,
      alt,
      source,
      caption
    });
  }

  return blocks;
}

export function moveMarkdownImageBlock(
  text: string,
  block: MarkdownImageBlock,
  targetIndex: number
): MarkdownEditResult {
  if (targetIndex >= block.start && targetIndex <= block.end) {
    return {
      text,
      selection: { start: block.end, end: block.end }
    };
  }

  const removalRange = getStandaloneBlockRemovalRange(text, block.start, block.end);
  const withoutBlock = normalizeStandaloneSpacing(`${text.slice(0, removalRange.start)}${text.slice(removalRange.end)}`);
  const adjustedTargetIndex = targetIndex > removalRange.end ? targetIndex - (removalRange.end - removalRange.start) : targetIndex;
  const inserted = insertBlock(withoutBlock, { start: adjustedTargetIndex, end: adjustedTargetIndex }, block.markdown);
  const nextBlocks = getMarkdownImageBlocks(inserted.text);
  const movedBlock = nextBlocks.find((candidate) => candidate.markdown === block.markdown);

  if (!movedBlock) {
    return inserted;
  }

  return {
    text: inserted.text,
    selection: {
      start: movedBlock.end,
      end: movedBlock.end
    }
  };
}

function getSelectedLineRange(text: string, selection: PatchSelection) {
  const safeSelection = clampSelection(text, selection.start, selection.end);
  const start = findLineStart(text, safeSelection.start);
  const anchorEnd = hasSelection(safeSelection) ? Math.max(safeSelection.start, safeSelection.end - 1) : safeSelection.end;
  const end = findLineEnd(text, anchorEnd);

  return { start, end };
}

function findLineStart(text: string, offset: number) {
  const index = text.lastIndexOf("\n", Math.max(0, offset - 1));
  return index === -1 ? 0 : index + 1;
}

function findLineEnd(text: string, offset: number) {
  const index = text.indexOf("\n", offset);
  return index === -1 ? text.length : index;
}

function getBlockPrefix(text: string, offset: number) {
  if (offset === 0) {
    return "";
  }

  if (text.slice(Math.max(0, offset - 2), offset) === "\n\n") {
    return "";
  }

  return text[offset - 1] === "\n" ? "\n" : "\n\n";
}

function getBlockSuffix(text: string, offset: number) {
  if (offset >= text.length) {
    return "";
  }

  if (text.slice(offset, offset + 2) === "\n\n") {
    return "";
  }

  return text[offset] === "\n" ? "\n" : "\n\n";
}

function replaceRange(text: string, start: number, end: number, replacement: string) {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function getStandaloneBlockRemovalRange(text: string, start: number, end: number) {
  let rangeStart = start;
  let rangeEnd = end;

  if (text.slice(Math.max(0, start - 2), start) === "\n\n") {
    rangeStart = Math.max(0, start - 2);
  } else if (start > 0 && text[start - 1] === "\n") {
    rangeStart = start - 1;
  }

  if (text.slice(end, end + 2) === "\n\n") {
    rangeEnd = end + 2;
  } else if (end < text.length && text[end] === "\n") {
    rangeEnd = end + 1;
  }

  return { start: rangeStart, end: rangeEnd };
}

function normalizeStandaloneSpacing(text: string) {
  return text.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
}
