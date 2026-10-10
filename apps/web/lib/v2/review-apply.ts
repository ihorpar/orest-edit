import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type Command, type Transaction } from "@tiptap/pm/state";
import { cloneBlock, type Block } from "../editor/document-model.ts";
import { readBlockText } from "./review-marks.ts";
import { blockToTiptapNode, createBlockIdForNodeType, tiptapNodeToBlock, V2_MARK } from "./tiptap-bridge.ts";

/**
 * Applying an accepted proposal to the manuscript.
 *
 * The replacement is one transaction with its history group closed on both sides (`sealHistory` after it),
 * so a single undo takes back exactly the accepted change and nothing typed before or after it.
 */

/**
 * Blocks to put in place of the anchor, with ids settled: the block at position N keeps the id of the
 * anchored block at position N (so the first block always keeps its id); extra blocks get fresh ids.
 */
export function resolveReplacementBlocks(blockIds: string[], newBlocks: Block[], createId = createBlockIdForNodeType): Block[] {
  const taken = new Set(blockIds);

  return newBlocks.map((block, index) => {
    const next = cloneBlock(block);
    const preserved = blockIds[index];

    if (preserved) {
      next.id = preserved;
      return next;
    }

    const nodeType = blockToTiptapNode(next).type ?? "paragraph";
    let id = createId(nodeType);

    while (taken.has(id)) {
      id = createId(nodeType);
    }

    taken.add(id);
    next.id = id;
    return next;
  });
}

/** Range of the anchored blocks when they are all present, in order and next to each other; otherwise null. */
export function findAnchorRange(doc: ProseMirrorNode, blockIds: string[]): { from: number; to: number } | null {
  if (blockIds.length === 0) {
    return null;
  }

  let from = -1;
  let to = -1;
  let matched = 0;
  let broken = false;

  doc.forEach((node, pos) => {
    if (broken || matched >= blockIds.length) {
      return;
    }

    if (node.attrs.id === blockIds[matched]) {
      if (matched === 0) {
        from = pos;
      }

      matched += 1;
      to = pos + node.nodeSize;
    } else if (matched > 0) {
      broken = true;
    }
  });

  return !broken && matched === blockIds.length ? { from, to } : null;
}

/** Current content of the anchored blocks, read from the editor, or null when the anchor is not intact. */
export function readAnchoredBlocks(doc: ProseMirrorNode, blockIds: string[]): Block[] | null {
  if (!findAnchorRange(doc, blockIds)) {
    return null;
  }

  const blocks: Block[] = [];

  doc.forEach((node) => {
    if (blockIds.includes(node.attrs.id)) {
      const block = tiptapNodeToBlock(node.toJSON());

      if (block) {
        blocks.push(block);
      }
    }
  });

  return blocks.length === blockIds.length ? blocks : null;
}

/**
 * Replaces the anchored blocks with `newBlocks` in one step. Fails (returns false, changes nothing) when the
 * anchored blocks are not all there in order, or the new blocks do not fit the schema.
 *
 * With `resolved`, the blocks already went through `resolveReplacementBlocks` and keep the ids they have,
 * so the caller knows exactly which blocks stand in the manuscript afterwards.
 */
export function replaceAnchoredBlocks(blockIds: string[], newBlocks: Block[], options: { resolved?: boolean } = {}): Command {
  return (state, dispatch) => {
    const range = findAnchorRange(state.doc, blockIds);

    if (!range || newBlocks.length === 0) {
      return false;
    }

    let nodes: ProseMirrorNode[];

    try {
      nodes = (options.resolved ? newBlocks : resolveReplacementBlocks(blockIds, newBlocks)).map((block) => {
        const node = state.schema.nodeFromJSON(blockToTiptapNode(block));
        node.check();
        return node;
      });
    } catch {
      return false;
    }

    if (dispatch) {
      const transaction = closeHistory(state.tr.replaceWith(range.from, range.to, nodes));
      const caret = Math.min(range.from + 1, transaction.doc.content.size);
      dispatch(transaction.setSelection(TextSelection.near(transaction.doc.resolve(caret))));
    }

    return true;
  };
}

/** Closes the current history group, so whatever is typed next is undone separately. */
export const sealHistory: Command = (state, dispatch) => {
  if (dispatch) {
    dispatch(closeHistory(state.tr).setMeta("addToHistory", false));
  }

  return true;
};

/**
 * A change an accepted suggestion makes without replacing whole blocks.
 * - `insert`: new blocks before or after an existing block; the blocks carry their final, unused ids;
 * - `bold`: bold over an exact text range of a paragraph or heading;
 * - `text`: an exact text range replaced with other text, keeping the formatting at that place.
 * `expected` is the text the range must read as right now; anything else and nothing is applied.
 */
export type ReviewEdit =
  | { type: "insert"; anchorBlockId: string; side: "before" | "after"; blocks: Block[] }
  | { type: "bold"; blockId: string; start: number; end: number; expected: string }
  | { type: "text"; blockId: string; start: number; end: number; expected: string; text: string };

/**
 * Applies several edits as ONE transaction with its history group closed, so one undo takes all of them
 * back and nothing else. All edits are checked first; if any does not fit the manuscript as it is now, the
 * command fails and changes nothing.
 */
export function applyReviewEdits(edits: ReviewEdit[]): Command {
  return (state, dispatch) => {
    if (edits.length === 0) {
      return false;
    }

    const blocks = new Map<string, { node: ProseMirrorNode; pos: number }>();

    state.doc.forEach((node, pos) => {
      if (typeof node.attrs.id === "string" && node.attrs.id) {
        blocks.set(node.attrs.id, { node, pos });
      }
    });

    const bold = state.schema.marks[V2_MARK.bold];
    const insertedIds = new Set<string>();
    const touched = new Map<string, Array<{ start: number; end: number }>>();
    const planned: Array<(transaction: Transaction) => void> = [];

    for (const edit of edits) {
      if (edit.type === "insert") {
        const anchor = blocks.get(edit.anchorBlockId);

        if (!anchor || edit.blocks.length === 0) {
          return false;
        }

        let nodes: ProseMirrorNode[];

        try {
          nodes = edit.blocks.map((block) => {
            if (!block.id || blocks.has(block.id) || insertedIds.has(block.id)) {
              throw new Error("block id is missing or taken");
            }

            insertedIds.add(block.id);
            const node = state.schema.nodeFromJSON(blockToTiptapNode(block));
            node.check();
            return node;
          });
        } catch {
          return false;
        }

        const before = edit.side === "before";
        const position = before ? anchor.pos : anchor.pos + anchor.node.nodeSize;
        // Stays next to its own anchor when another edit inserts at the same boundary.
        planned.push((transaction) => transaction.insert(transaction.mapping.map(position, before ? 1 : -1), nodes));
        continue;
      }

      const entry = blocks.get(edit.blockId);

      if (
        !entry ||
        !entry.node.isTextblock ||
        edit.start < 0 ||
        edit.end <= edit.start ||
        readBlockText(entry.node).slice(edit.start, edit.end) !== edit.expected
      ) {
        return false;
      }

      // Two edits over the same text cannot both be what was shown; the caller plans around that.
      const ranges = touched.get(edit.blockId) ?? [];

      if (ranges.some((range) => edit.start < range.end && range.start < edit.end)) {
        return false;
      }

      ranges.push({ start: edit.start, end: edit.end });
      touched.set(edit.blockId, ranges);

      const from = entry.pos + 1 + edit.start;
      const to = entry.pos + 1 + edit.end;

      if (edit.type === "bold") {
        if (!bold) {
          return false;
        }

        planned.push((transaction) => transaction.addMark(transaction.mapping.map(from, 1), transaction.mapping.map(to, -1), bold.create()));
      } else {
        if (!edit.text) {
          return false;
        }

        const text = edit.text;
        planned.push((transaction) => transaction.insertText(text, transaction.mapping.map(from, 1), transaction.mapping.map(to, -1)));
      }
    }

    if (dispatch) {
      const transaction = state.tr;
      planned.forEach((applyEdit) => applyEdit(transaction));

      if (!transaction.docChanged) {
        return false;
      }

      dispatch(closeHistory(transaction));
    }

    return true;
  };
}
