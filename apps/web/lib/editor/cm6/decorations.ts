import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { AppliedDiffMarker } from "../applied-diff";
import { getMarkdownImageBlocks, moveMarkdownImageBlock } from "../markdown-editor";
import { getManuscriptParagraphs, type ManuscriptRevisionState } from "../manuscript-structure";
import { hasSelection, type PatchSelection } from "../patch-contract";
import type { EditorialReviewItem } from "../review-contract";

interface PendingDecoration {
  from: number;
  to: number;
  decoration: Decoration;
}

function addLineDecorations(
  decorations: PendingDecoration[],
  doc: { lineAt(pos: number): { from: number; to: number; number: number }; line(number: number): { from: number; to: number; number: number } },
  from: number,
  to: number,
  className: string
) {
  let line = doc.lineAt(Math.max(0, from));

  while (true) {
    decorations.push({
      from: line.from,
      to: line.from,
      decoration: Decoration.line({ attributes: { class: className } })
    });

    if (line.to >= to) {
      break;
    }

    line = doc.line(line.number + 1);
  }
}

function addCalloutDecorations(
  decorations: PendingDecoration[],
  doc: { lineAt(pos: number): { from: number; to: number; number: number }; line(number: number): { from: number; to: number; number: number } },
  paragraphStart: number,
  paragraphText: string
) {
  const lines = paragraphText.replace(/\r\n?/g, "\n").split("\n");
  let cursor = paragraphStart;

  lines.forEach((lineText, index) => {
    const line = doc.lineAt(Math.max(0, cursor));
    const lineClass = index === 0 ? "cm-orest-callout-line cm-orest-callout-line-head" : "cm-orest-callout-line cm-orest-callout-line-body";

    decorations.push({
      from: line.from,
      to: line.from,
      decoration: Decoration.line({ attributes: { class: lineClass } })
    });

    if (lineText.startsWith("> [!CALLOUT:")) {
      const titleStartOffset = lineText.indexOf("] ");

      if (titleStartOffset > 0) {
        decorations.push({
          from: cursor,
          to: cursor + titleStartOffset + 1,
          decoration: Decoration.mark({ class: "cm-orest-callout-token" })
        });

        if (cursor + titleStartOffset + 2 <= cursor + lineText.length) {
          decorations.push({
            from: cursor + titleStartOffset + 2,
            to: cursor + lineText.length,
            decoration: Decoration.mark({ class: "cm-orest-callout-title" })
          });
        }
      }
    } else if (lineText.startsWith("> ")) {
      decorations.push({
        from: cursor,
        to: cursor + 1,
        decoration: Decoration.mark({ class: "cm-orest-callout-token" })
      });

      if (lineText.length > 2) {
        decorations.push({
          from: cursor + 2,
          to: cursor + lineText.length,
          decoration: Decoration.mark({ class: "cm-orest-callout-body" })
        });
      }
    }

    cursor += lineText.length + 1;
  });
}

export function buildEditorDecorations(input: {
  appliedDiffs?: AppliedDiffMarker[];
  text: string;
  revision: ManuscriptRevisionState;
  selection: PatchSelection;
  reviewItems: EditorialReviewItem[];
  activeReviewItem: EditorialReviewItem | null;
  showPersistentSelection: boolean;
  onMoveImageBlock: (blockMarkdown: string, direction: "up" | "down") => void;
  state: { doc: { length: number; lineAt(pos: number): { from: number; to: number; number: number }; line(number: number): { from: number; to: number; number: number } } };
}): DecorationSet {
  const decorations: PendingDecoration[] = [];
  const doc = input.state.doc;
  const appliedDiffs = input.appliedDiffs ?? [];

  if (input.showPersistentSelection && hasSelection(input.selection)) {
    decorations.push({
      from: input.selection.start,
      to: input.selection.end,
      decoration: Decoration.mark({ class: "cm-orest-selection-preview" })
    });
  }

  const paragraphs = getManuscriptParagraphs(input.text, input.revision);
  const activeParagraphIds = new Set(input.activeReviewItem?.anchor.paragraphIds ?? []);

  paragraphs.forEach((paragraph) => {
    const lines = paragraph.text.split("\n").map((line) => line.trim()).filter(Boolean);
    const isTableParagraph = lines.length >= 2 && lines.every((line) => line.startsWith("|"));
    const isCalloutParagraph = paragraph.text.startsWith("> [!CALLOUT:");

    if (activeParagraphIds.has(paragraph.id)) {
      addLineDecorations(decorations, doc, paragraph.start, paragraph.end, "cm-orest-review-line");
    }

    if (isTableParagraph) {
      addLineDecorations(decorations, doc, paragraph.start, paragraph.end, "cm-orest-table-line");
    }

    if (isCalloutParagraph) {
      addCalloutDecorations(decorations, doc, paragraph.start, paragraph.text);
    }
  });

  appliedDiffs.forEach((diff) => {
    if (diff.start < diff.end) {
      decorations.push({
        from: diff.start,
        to: diff.end,
        decoration: Decoration.mark({ class: "cm-orest-applied-diff-mark" })
      });
    }

    addLineDecorations(decorations, doc, diff.start, Math.max(diff.end, diff.start + 1), "cm-orest-applied-diff-line");
  });

  const imageBlocks = getMarkdownImageBlocks(input.text);

  imageBlocks.forEach((block) => {
    addLineDecorations(decorations, doc, block.start, block.end, "cm-orest-image-source-line");
  });

  const tree = syntaxTree(input.state as never);
  const cursor = tree.cursor();

  do {
    switch (cursor.name) {
      case "ATXHeading1":
      case "ATXHeading2":
      case "ATXHeading3": {
        const level = cursor.name === "ATXHeading1" ? 1 : cursor.name === "ATXHeading2" ? 2 : 3;
        decorations.push({
          from: cursor.from,
          to: cursor.from,
          decoration: Decoration.line({ attributes: { class: `cm-orest-heading-line cm-orest-heading-line-${level}` } })
        });
        break;
      }
      case "HeaderMark":
        decorations.push({
          from: cursor.from,
          to: cursor.to,
          decoration: Decoration.mark({ class: "cm-orest-md-token cm-orest-heading-token" })
        });
        break;
      case "StrongEmphasis":
        if (cursor.to - cursor.from > 4) {
          decorations.push({
            from: cursor.from + 2,
            to: cursor.to - 2,
            decoration: Decoration.mark({ class: "cm-orest-strong-content" })
          });
        }
        break;
      case "Emphasis":
        if (cursor.to - cursor.from > 2) {
          decorations.push({
            from: cursor.from + 1,
            to: cursor.to - 1,
            decoration: Decoration.mark({ class: "cm-orest-emphasis-content" })
          });
        }
        break;
      case "EmphasisMark":
        decorations.push({
          from: cursor.from,
          to: cursor.to,
          decoration: Decoration.mark({ class: "cm-orest-md-token" })
        });
        break;
      case "LinkMark":
        decorations.push({
          from: cursor.from,
          to: cursor.to,
          decoration: Decoration.mark({ class: "cm-orest-md-token" })
        });
        break;
      case "QuoteMark":
        decorations.push({
          from: cursor.from,
          to: cursor.to,
          decoration: Decoration.mark({ class: "cm-orest-md-token cm-orest-quote-token" })
        });
        break;
      default:
        break;
    }
  } while (cursor.next());

  decorations.sort((left, right) => {
    if (left.from !== right.from) {
      return left.from - right.from;
    }

    const leftStartSide = (left.decoration as Decoration & { startSide?: number }).startSide ?? 0;
    const rightStartSide = (right.decoration as Decoration & { startSide?: number }).startSide ?? 0;

    if (leftStartSide !== rightStartSide) {
      return leftStartSide - rightStartSide;
    }

    if (left.to !== right.to) {
      return left.to - right.to;
    }

    const leftEndSide = (left.decoration as Decoration & { endSide?: number }).endSide ?? 0;
    const rightEndSide = (right.decoration as Decoration & { endSide?: number }).endSide ?? 0;
    return leftEndSide - rightEndSide;
  });

  const builder = new RangeSetBuilder<Decoration>();
  decorations.forEach((entry) => {
    builder.add(entry.from, entry.to, entry.decoration);
  });

  return builder.finish();
}

export function moveImageBlockWithinDocument(input: {
  text: string;
  revision: ManuscriptRevisionState;
  blockMarkdown: string;
  direction: "up" | "down";
}): { text: string; selection: PatchSelection } | null {
  const imageBlock = getMarkdownImageBlocks(input.text).find((block) => block.markdown === input.blockMarkdown);

  if (!imageBlock) {
    return null;
  }

  const paragraphs = getManuscriptParagraphs(input.text, input.revision);
  const paragraphIndex = paragraphs.findIndex((paragraph) => paragraph.start === imageBlock.start && paragraph.end === imageBlock.end);

  if (paragraphIndex === -1) {
    return null;
  }

  if (input.direction === "up") {
    const targetParagraph = paragraphs[paragraphIndex - 1];

    if (!targetParagraph) {
      return null;
    }

    return moveMarkdownImageBlock(input.text, imageBlock, targetParagraph.start);
  }

  const targetParagraph = paragraphs[paragraphIndex + 1];

  if (!targetParagraph) {
    return null;
  }

  return moveMarkdownImageBlock(input.text, imageBlock, targetParagraph.end);
}
