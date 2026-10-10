import type { EditorDocument } from "../editor/document-model.ts";

export interface WhereLabelCopy {
  whereParagraph: (label: string) => string;
  whereHeading: string;
  whereBlock: string;
  whereGone: string;
}

/**
 * "абз. 3", "абз. 3–4", "заголовок": where a set of blocks stands in the manuscript. The paragraph numbers
 * are the ones shown in the manuscript gutter (paragraph blocks only, counted from 1).
 */
export function createBlocksWhereLabel(document: EditorDocument | null, text: WhereLabelCopy): (blockIds: string[]) => string {
  const paragraphNumber = new Map<string, number>();
  const blockType = new Map<string, string>();
  let count = 0;

  for (const block of document?.blocks ?? []) {
    blockType.set(block.id, block.type);

    if (block.type === "paragraph") {
      count += 1;
      paragraphNumber.set(block.id, count);
    }
  }

  return (blockIds) => {
    if (blockIds.length === 0 || !blockIds.every((blockId) => blockType.has(blockId))) {
      return text.whereGone;
    }

    const numbers = blockIds.map((blockId) => paragraphNumber.get(blockId)).filter((value): value is number => value !== undefined);

    if (numbers.length === 0) {
      return blockType.get(blockIds[0]!) === "heading" ? text.whereHeading : text.whereBlock;
    }

    const first = Math.min(...numbers);
    const last = Math.max(...numbers);
    return text.whereParagraph(first === last ? String(first) : `${first}–${last}`);
  };
}
