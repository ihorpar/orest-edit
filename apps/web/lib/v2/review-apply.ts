import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type Command } from "@tiptap/pm/state";
import { cloneBlock, type Block } from "../editor/document-model.ts";
import { blockToTiptapNode, createBlockIdForNodeType, tiptapNodeToBlock } from "./tiptap-bridge.ts";

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
 */
export function replaceAnchoredBlocks(blockIds: string[], newBlocks: Block[]): Command {
  return (state, dispatch) => {
    const range = findAnchorRange(state.doc, blockIds);

    if (!range || newBlocks.length === 0) {
      return false;
    }

    let nodes: ProseMirrorNode[];

    try {
      nodes = resolveReplacementBlocks(blockIds, newBlocks).map((block) => {
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
