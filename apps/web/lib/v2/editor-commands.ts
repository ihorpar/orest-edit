import { splitBlock, toggleMark } from "@tiptap/pm/commands";
import { Fragment, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Command, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { InlineNode } from "../editor/document-model.ts";
import type { EditorialCalloutKind } from "../editor/review-contract.ts";
import { DEFAULT_CALLOUT_KIND, V2_NODE } from "./tiptap-bridge.ts";

/**
 * ProseMirror commands for the v2 manuscript. They are plain `(state, dispatch)` commands, so they run both
 * inside the Tiptap editor and headlessly in tests. Commands that change the block structure keep the id of
 * the first affected block; blocks they create get `id: null` and the block-id plugin assigns a fresh one.
 */

export type TextBlockTarget = { type: "paragraph" } | { type: "heading"; level: 1 | 2 | 3 };
export type ListNodeName = typeof V2_NODE.bulletList | typeof V2_NODE.orderedList;
export type ActiveBlockKind = "paragraph" | "heading-1" | "heading-2" | "heading-3" | "bulletList" | "orderedList" | "callout" | "other";

interface TextPosition {
  ordinal: number;
  offset: number;
}

const isListNode = (node: ProseMirrorNode) => node.type.name === V2_NODE.bulletList || node.type.name === V2_NODE.orderedList;
const isPlainTextBlock = (node: ProseMirrorNode) => node.type.name === V2_NODE.paragraph || node.type.name === V2_NODE.heading;

export function toggleMarkCommand(markName: string): Command {
  return (state, dispatch) => {
    const markType = state.schema.marks[markName];
    return markType ? toggleMark(markType)(state, dispatch) : false;
  };
}

export function isMarkActive(state: EditorState, markName: string): boolean {
  const markType = state.schema.marks[markName];

  if (!markType) {
    return false;
  }

  const { from, to, empty, $from } = state.selection;

  if (empty) {
    return Boolean(markType.isInSet(state.storedMarks ?? $from.marks()));
  }

  return state.doc.rangeHasMark(from, to, markType);
}

export function getActiveBlockKind(state: EditorState): ActiveBlockKind {
  const { $from } = state.selection;
  const block = $from.depth === 0 ? $from.nodeAfter : $from.node(1);

  if (!block) {
    return "other";
  }

  switch (block.type.name) {
    case V2_NODE.paragraph:
      return "paragraph";
    case V2_NODE.heading:
      return block.attrs.level === 2 ? "heading-2" : block.attrs.level === 3 ? "heading-3" : "heading-1";
    case V2_NODE.bulletList:
      return "bulletList";
    case V2_NODE.orderedList:
      return "orderedList";
    case V2_NODE.callout:
      return "callout";
    default:
      return "other";
  }
}

/** Turns the selected paragraphs, headings and list items into paragraphs or headings of one level. */
export function setTextBlockType(target: TextBlockTarget): Command {
  return (state, dispatch) => {
    const { schema } = state;
    const range = getSelectedBlockRange(state);
    const blocks = getBlocksInRange(state.doc, range);

    if (!blocks.some(({ node }) => isPlainTextBlock(node) || isListNode(node))) {
      return false;
    }

    if (!dispatch) {
      return true;
    }

    const targetType = target.type === "heading" ? schema.nodes[V2_NODE.heading]! : schema.nodes[V2_NODE.paragraph]!;
    const targetAttrs = (id: string | null) => (target.type === "heading" ? { id, level: target.level } : { id });
    const selection = captureSelection(state);
    const transaction = state.tr;

    for (const { node, pos } of blocks.slice().reverse()) {
      if (isPlainTextBlock(node)) {
        transaction.setNodeMarkup(pos, targetType, targetAttrs(node.attrs.id));
      } else if (isListNode(node)) {
        const textBlocks: ProseMirrorNode[] = [];
        node.forEach((item, _offset, index) => {
          textBlocks.push(targetType.create(targetAttrs(index === 0 ? node.attrs.id : null), item.content));
        });
        transaction.replaceWith(pos, pos + node.nodeSize, textBlocks);
      }
    }

    restoreSelection(transaction, selection);
    dispatch(transaction.scrollIntoView());
    return true;
  };
}

/**
 * Wraps the selected paragraphs/headings into one list (one item per block), switches the type of a list of
 * the other kind, or — when everything selected is already a list of this kind — unwraps it into paragraphs.
 */
export function toggleList(listName: ListNodeName): Command {
  return (state, dispatch) => {
    const { schema } = state;
    const listType = schema.nodes[listName]!;
    const itemType = schema.nodes[V2_NODE.listItem]!;
    const paragraphType = schema.nodes[V2_NODE.paragraph]!;
    const range = getSelectedBlockRange(state);
    const blocks = getBlocksInRange(state.doc, range);

    if (!blocks.some(({ node }) => isPlainTextBlock(node) || isListNode(node))) {
      return false;
    }

    if (!dispatch) {
      return true;
    }

    const unwrap = blocks.every(({ node }) => node.type === listType);
    const replacement: ProseMirrorNode[] = [];
    let run: { id: string | null; items: ProseMirrorNode[] } | null = null;

    const flushRun = () => {
      if (run) {
        replacement.push(listType.create({ id: run.id }, run.items));
        run = null;
      }
    };

    for (const { node } of blocks) {
      if (unwrap) {
        node.forEach((item, _offset, index) => {
          replacement.push(paragraphType.create({ id: index === 0 ? node.attrs.id : null }, item.content));
        });
        continue;
      }

      if (!isPlainTextBlock(node) && !isListNode(node)) {
        flushRun();
        replacement.push(node);
        continue;
      }

      const items: ProseMirrorNode[] = [];

      if (isListNode(node)) {
        node.forEach((item) => items.push(item));
      } else {
        items.push(itemType.create(null, node.content));
      }

      if (run) {
        run.items.push(...items);
      } else {
        run = { id: node.attrs.id ?? null, items };
      }
    }

    flushRun();

    const first = blocks[0]!;
    const last = blocks[blocks.length - 1]!;
    const selection = captureSelection(state);
    const transaction = state.tr.replaceWith(first.pos, last.pos + last.node.nodeSize, replacement);

    restoreSelection(transaction, selection);
    dispatch(transaction.scrollIntoView());
    return true;
  };
}

export const handleEnter: Command = (state, dispatch) => {
  const { selection } = state;

  if (!(selection instanceof TextSelection)) {
    return false;
  }

  const { $from, empty } = selection;
  const parent = $from.parent;

  if (!parent.isTextblock) {
    return false;
  }

  if (parent.type.name === V2_NODE.listItem && empty && parent.content.size === 0) {
    return exitEmptyListItem(state, dispatch);
  }

  if (parent.type.name === V2_NODE.calloutTitle) {
    return handleEnterInCalloutTitle(state, dispatch);
  }

  if (parent.type.name === V2_NODE.calloutBody && empty && parent.content.size === 0 && $from.index(1) === $from.node(1).childCount - 1) {
    return exitEmptyCalloutBody(state, dispatch);
  }

  return splitBlock(state, dispatch);
};

export const handleBackspace: Command = (state, dispatch) => {
  const { selection } = state;

  if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parentOffset !== 0) {
    return false;
  }

  const { $from } = selection;
  const parent = $from.parent;

  if (parent.type.name === V2_NODE.listItem && $from.index(1) === 0) {
    return liftFirstListItem(state, dispatch);
  }

  // A divider, image or table above is selected first; the next Backspace deletes it.
  if ($from.depth === 1 && parent.content.size > 0 && $from.index(0) > 0) {
    const previous = state.doc.child($from.index(0) - 1);

    if (previous.isAtom) {
      if (dispatch) {
        dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $from.before(1) - previous.nodeSize)).scrollIntoView());
      }

      return true;
    }
  }

  if (parent.type.name === V2_NODE.calloutTitle) {
    const callout = $from.node(1);

    if (callout.textContent.length > 0) {
      return true;
    }

    if (dispatch) {
      const pos = $from.before(1);
      const paragraph = state.schema.nodes[V2_NODE.paragraph]!.create({ id: callout.attrs.id });
      const transaction = state.tr.replaceWith(pos, pos + callout.nodeSize, paragraph);
      dispatch(transaction.setSelection(TextSelection.create(transaction.doc, pos + 1)).scrollIntoView());
    }

    return true;
  }

  if (parent.type.name === V2_NODE.calloutBody && $from.index(1) === 1) {
    if (parent.content.size > 0) {
      return true;
    }

    if (dispatch) {
      const bodyPos = $from.before(2);
      const transaction = state.tr.delete(bodyPos, bodyPos + parent.nodeSize);
      dispatch(transaction.setSelection(TextSelection.create(transaction.doc, bodyPos - 1)).scrollIntoView());
    }

    return true;
  }

  return false;
};

export const insertHardBreak: Command = (state, dispatch) => {
  const hardBreak = state.schema.nodes[V2_NODE.hardBreak];

  if (!hardBreak || !state.selection.$from.parent.isTextblock) {
    return false;
  }

  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
  }

  return true;
};

/** Inserts an empty callout after the block that holds the cursor and puts the cursor in its title. */
export function insertCallout(kind: EditorialCalloutKind = DEFAULT_CALLOUT_KIND): Command {
  return (state, dispatch) => {
    const { schema } = state;
    const callout = schema.nodes[V2_NODE.callout]!.create({ id: null, kind }, [
      schema.nodes[V2_NODE.calloutTitle]!.create(),
      schema.nodes[V2_NODE.calloutBody]!.create()
    ]);

    if (dispatch) {
      const pos = getInsertPositionAfterSelection(state);
      const transaction = state.tr.insert(pos, callout);
      dispatch(transaction.setSelection(TextSelection.create(transaction.doc, pos + 2)).scrollIntoView());
    }

    return true;
  };
}

export function insertImage(input: { assetId: string; alt: string; caption?: InlineNode[] }): Command {
  return (state, dispatch) => {
    const image = state.schema.nodes[V2_NODE.image]!.create({
      id: null,
      assetId: input.assetId,
      alt: input.alt,
      caption: input.caption ?? [{ text: "" }]
    });

    if (dispatch) {
      dispatch(state.tr.insert(getInsertPositionAfterSelection(state), image).scrollIntoView());
    }

    return true;
  };
}

/** Replaces the whole manuscript in one undoable step. */
export function replaceDocumentContent(content: Fragment | ProseMirrorNode[]): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const transaction = state.tr.replaceWith(0, state.doc.content.size, content);
      dispatch(transaction.setSelection(TextSelection.atStart(transaction.doc)).scrollIntoView());
    }

    return true;
  };
}

export function createDocumentNode(schema: Schema, json: unknown): ProseMirrorNode {
  const node = schema.nodeFromJSON(json);
  node.check();
  return node;
}

function handleEnterInCalloutTitle(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
  const { $from, $to, empty } = state.selection;
  const callout = $from.node(1);

  if (!empty || $to.parentOffset !== $from.parent.content.size) {
    return true;
  }

  if (callout.childCount === 1) {
    return splitBlock(state, dispatch);
  }

  if (dispatch) {
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.after(2) + 1)).scrollIntoView());
  }

  return true;
}

function exitEmptyCalloutBody(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
  if (dispatch) {
    const { $from } = state.selection;
    const bodyPos = $from.before(2);
    const transaction = state.tr.delete(bodyPos, bodyPos + $from.parent.nodeSize);
    const afterCallout = transaction.mapping.map($from.after(1));

    transaction.insert(afterCallout, state.schema.nodes[V2_NODE.paragraph]!.create({ id: null }));
    dispatch(transaction.setSelection(TextSelection.create(transaction.doc, afterCallout + 1)).scrollIntoView());
  }

  return true;
}

function exitEmptyListItem(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
  const { $from } = state.selection;
  const list = $from.node(1);
  const listPos = $from.before(1);
  const index = $from.index(1);

  if (!dispatch) {
    return true;
  }

  const paragraphType = state.schema.nodes[V2_NODE.paragraph]!;
  const before: ProseMirrorNode[] = [];
  const after: ProseMirrorNode[] = [];

  list.forEach((item, _offset, itemIndex) => {
    if (itemIndex < index) {
      before.push(item);
    } else if (itemIndex > index) {
      after.push(item);
    }
  });

  const replacement: ProseMirrorNode[] = [];
  let paragraphPos = listPos;

  if (before.length > 0) {
    const beforeList = list.type.create({ id: list.attrs.id }, before);
    replacement.push(beforeList);
    paragraphPos += beforeList.nodeSize;
  }

  const keepsListId = before.length === 0 && after.length === 0;
  replacement.push(paragraphType.create({ id: keepsListId ? list.attrs.id : null }));

  if (after.length > 0) {
    replacement.push(list.type.create({ id: before.length === 0 ? list.attrs.id : null }, after));
  }

  const transaction = state.tr.replaceWith(listPos, listPos + list.nodeSize, replacement);
  dispatch(transaction.setSelection(TextSelection.create(transaction.doc, paragraphPos + 1)).scrollIntoView());
  return true;
}

function liftFirstListItem(state: EditorState, dispatch?: (transaction: Transaction) => void): boolean {
  const { $from } = state.selection;
  const list = $from.node(1);
  const listPos = $from.before(1);

  if (!dispatch) {
    return true;
  }

  const rest: ProseMirrorNode[] = [];
  list.forEach((item, _offset, index) => {
    if (index > 0) {
      rest.push(item);
    }
  });

  const paragraph = state.schema.nodes[V2_NODE.paragraph]!.create({ id: rest.length === 0 ? list.attrs.id : null }, list.firstChild!.content);
  const replacement = rest.length > 0 ? [paragraph, list.type.create({ id: list.attrs.id }, rest)] : [paragraph];
  const transaction = state.tr.replaceWith(listPos, listPos + list.nodeSize, replacement);

  dispatch(transaction.setSelection(TextSelection.create(transaction.doc, listPos + 1)).scrollIntoView());
  return true;
}

function getInsertPositionAfterSelection(state: EditorState): number {
  const { $to } = state.selection;
  return $to.depth === 0 ? $to.pos : $to.after(1);
}

function getSelectedBlockRange(state: EditorState): { start: number; end: number } {
  const { $from, $to } = state.selection;
  const lastIndex = Math.max(0, state.doc.childCount - 1);
  const start = Math.min($from.index(0), lastIndex);
  const end = $to.depth === 0 ? Math.max(start, $to.index(0) - 1) : $to.index(0);

  return { start, end: Math.min(Math.max(start, end), lastIndex) };
}

function getBlocksInRange(doc: ProseMirrorNode, range: { start: number; end: number }): Array<{ node: ProseMirrorNode; pos: number }> {
  const blocks: Array<{ node: ProseMirrorNode; pos: number }> = [];

  doc.forEach((node, pos, index) => {
    if (index >= range.start && index <= range.end) {
      blocks.push({ node, pos });
    }
  });

  return blocks;
}

// Wrapping and unwrapping keep the number and order of text blocks, so a cursor is restored by the ordinal
// of its text block and the offset inside it.
function captureSelection(state: EditorState): { anchor: TextPosition; head: TextPosition } | null {
  if (!(state.selection instanceof TextSelection)) {
    return null;
  }

  const anchor = captureTextPosition(state.doc, state.selection.anchor);
  const head = captureTextPosition(state.doc, state.selection.head);
  return anchor && head ? { anchor, head } : null;
}

function restoreSelection(transaction: Transaction, selection: { anchor: TextPosition; head: TextPosition } | null) {
  if (!selection) {
    return;
  }

  const anchor = resolveTextPosition(transaction.doc, selection.anchor);
  const head = resolveTextPosition(transaction.doc, selection.head);

  if (anchor !== null && head !== null) {
    transaction.setSelection(TextSelection.create(transaction.doc, anchor, head));
  }
}

function captureTextPosition(doc: ProseMirrorNode, pos: number): TextPosition | null {
  const $pos = doc.resolve(pos);

  if (!$pos.parent.isTextblock) {
    return null;
  }

  const start = $pos.start();
  let ordinal = -1;
  let found = false;

  doc.descendants((node, nodePos) => {
    if (found) {
      return false;
    }

    if (node.isTextblock) {
      ordinal += 1;
      found = nodePos + 1 === start;
      return false;
    }

    return true;
  });

  return found ? { ordinal, offset: $pos.parentOffset } : null;
}

function resolveTextPosition(doc: ProseMirrorNode, position: TextPosition): number | null {
  let ordinal = -1;
  let resolved: number | null = null;

  doc.descendants((node, nodePos) => {
    if (resolved !== null) {
      return false;
    }

    if (node.isTextblock) {
      ordinal += 1;

      if (ordinal === position.ordinal) {
        resolved = nodePos + 1 + Math.min(position.offset, node.content.size);
      }

      return false;
    }

    return true;
  });

  return resolved;
}
