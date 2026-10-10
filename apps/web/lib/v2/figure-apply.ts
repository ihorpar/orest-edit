import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Command } from "@tiptap/pm/state";
import type { InlineNode } from "../editor/document-model.ts";
import { V2_NODE } from "./tiptap-bridge.ts";

/**
 * Changes to a figure that is already in the manuscript. Each is ONE transaction with its history group
 * closed, so a single undo takes back exactly that change; the block keeps its id.
 */

export interface FigureContent {
  assetId: string;
  alt: string;
  /** Caption as plain text. */
  caption: string;
}

function findImage(doc: ProseMirrorNode, blockId: string): { node: ProseMirrorNode; pos: number } | null {
  let found: { node: ProseMirrorNode; pos: number } | null = null;

  doc.forEach((node, pos) => {
    if (!found && node.type.name === V2_NODE.image && node.attrs.id === blockId) {
      found = { node, pos };
    }
  });

  return found;
}

function readCaption(node: ProseMirrorNode): string {
  const caption = node.attrs.caption as InlineNode[] | null;
  return Array.isArray(caption) ? caption.map((part) => part.text).join("") : "";
}

/** The image block with this id as it is in the editor right now, or null when there is none. */
export function readFigure(doc: ProseMirrorNode, blockId: string): FigureContent | null {
  const entry = findImage(doc, blockId);

  return entry
    ? { assetId: String(entry.node.attrs.assetId ?? ""), alt: String(entry.node.attrs.alt ?? ""), caption: readCaption(entry.node) }
    : null;
}

/**
 * Replaces the image and/or the caption of a figure in place. Fails (returns false, changes nothing) when
 * the block is not an image in the manuscript, or when nothing would change.
 */
export function updateFigure(blockId: string, change: Partial<FigureContent>): Command {
  return (state, dispatch) => {
    const entry = findImage(state.doc, blockId);

    if (!entry) {
      return false;
    }

    const current = readFigure(state.doc, blockId)!;
    const assetId = change.assetId ?? current.assetId;
    const alt = change.alt ?? current.alt;
    const caption = change.caption ?? current.caption;

    if (!assetId || (assetId === current.assetId && alt === current.alt && caption === current.caption)) {
      return false;
    }

    if (dispatch) {
      dispatch(
        closeHistory(
          state.tr.setNodeMarkup(entry.pos, undefined, {
            ...entry.node.attrs,
            assetId,
            alt,
            caption: [{ text: caption }]
          })
        )
      );
    }

    return true;
  };
}

/** Takes a figure out of the manuscript. Fails when it is not there, or when it is the only block. */
export function removeFigure(blockId: string): Command {
  return (state, dispatch) => {
    const entry = findImage(state.doc, blockId);

    if (!entry || state.doc.childCount <= 1) {
      return false;
    }

    if (dispatch) {
      dispatch(closeHistory(state.tr.delete(entry.pos, entry.pos + entry.node.nodeSize)));
    }

    return true;
  };
}
