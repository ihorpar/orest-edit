import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** The selected part of the manuscript, as a request about a fragment sees it. */
export interface SelectionScope {
  /** Every top-level block the selection touches, first to last, with whatever stands between them. */
  blockIds: string[];
  /** The selected words. */
  quote: string;
  from: number;
  to: number;
}

interface SelectionLike {
  from: number;
  to: number;
  empty: boolean;
}

/**
 * Maps a text selection to the whole blocks it touches. A request about a fragment always works with whole
 * blocks (that is what the patch and proposal endpoints replace), so a selection of three words still
 * scopes its paragraph.
 *
 * A block counts as touched only when some of its text is inside the selection: a triple click that runs to
 * the very start of the next paragraph does not pull that paragraph in. Returns null when nothing readable
 * is selected or a touched block has no id.
 */
export function getSelectionScope(doc: ProseMirrorNode, selection: SelectionLike): SelectionScope | null {
  if (selection.empty || selection.to <= selection.from) {
    return null;
  }

  const blocks: Array<{ id: string | null; touched: boolean }> = [];

  doc.forEach((node, offset) => {
    const start = offset;
    const end = offset + node.nodeSize;
    const from = Math.max(selection.from, start);
    const to = Math.min(selection.to, end);
    const touched = from < to && doc.textBetween(from, to, " ", " ").trim().length > 0;
    const id = typeof node.attrs.id === "string" && node.attrs.id ? node.attrs.id : null;
    blocks.push({ id, touched });
  });

  const first = blocks.findIndex((block) => block.touched);

  if (first < 0) {
    return null;
  }

  let last = first;

  for (let index = blocks.length - 1; index > first; index -= 1) {
    if (blocks[index]!.touched) {
      last = index;
      break;
    }
  }

  const span = blocks.slice(first, last + 1);

  if (span.some((block) => block.id === null)) {
    return null;
  }

  const quote = doc.textBetween(selection.from, selection.to, "\n", " ").replace(/[ \t]+/g, " ").trim();

  if (!quote) {
    return null;
  }

  return { blockIds: span.map((block) => block.id!), quote, from: selection.from, to: selection.to };
}
