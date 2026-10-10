import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Command } from "@tiptap/pm/state";
import { V2_NODE } from "./tiptap-bridge.ts";

/**
 * Find and replace over the whole manuscript (`Ctrl/Cmd+H`).
 *
 * The search is an exact, case-sensitive match, as in the classic editor. It reads paragraphs, headings,
 * list items and callouts; figures (captions) and tables are left alone. A match never spans two blocks or
 * a line break. All replacements are ONE transaction with its history group closed, so one undo takes them
 * all back; block ids and the formatting around each match are kept.
 */

export interface TextMatch {
  /** Document positions of the match. */
  from: number;
  to: number;
  /** Id of the top-level block the match is in. */
  blockId: string | null;
}

const SKIPPED_BLOCKS: ReadonlySet<string> = new Set([V2_NODE.image, V2_NODE.table, V2_NODE.divider]);

/** Stands for a non-text inline node (a line break); nothing typed into the search field can equal it. */
const INLINE_NODE_PLACEHOLDER = "￼";

/** Text of a textblock with every non-text inline node as a placeholder, so offsets are positions. */
function readTextblock(node: ProseMirrorNode): string {
  let text = "";

  node.forEach((child) => {
    text += child.isText ? child.text ?? "" : INLINE_NODE_PLACEHOLDER.repeat(child.nodeSize);
  });

  return text;
}

/** Every match of `query` in the manuscript, in document order. An empty query matches nothing. */
export function findTextMatches(doc: ProseMirrorNode, query: string): TextMatch[] {
  if (!query || query.includes(INLINE_NODE_PLACEHOLDER)) {
    return [];
  }

  const matches: TextMatch[] = [];

  doc.forEach((block, blockPos) => {
    if (SKIPPED_BLOCKS.has(block.type.name)) {
      return;
    }

    const blockId = typeof block.attrs.id === "string" && block.attrs.id ? block.attrs.id : null;
    const visit = (node: ProseMirrorNode, pos: number) => {
      if (!node.isTextblock) {
        node.forEach((child, offset) => visit(child, pos + 1 + offset));
        return;
      }

      const text = readTextblock(node);
      let index = text.indexOf(query);

      while (index !== -1) {
        matches.push({ from: pos + 1 + index, to: pos + 1 + index + query.length, blockId });
        index = text.indexOf(query, index + query.length);
      }
    };

    visit(block, blockPos);
  });

  return matches;
}

export function countTextMatches(doc: ProseMirrorNode, query: string): number {
  return findTextMatches(doc, query).length;
}

export interface ReplaceOutcome {
  /** How many matches were replaced. */
  count: number;
  /** Top-level blocks whose text changed. */
  blockIds: string[];
}

/**
 * Replaces every match of `query` with `replacement` (which may be empty) in one undo step. Fails (returns
 * false, changes nothing) when there is nothing to replace or the replacement is the same as the query.
 * `onDone` reports what was replaced.
 */
export function replaceAllText(query: string, replacement: string, onDone?: (outcome: ReplaceOutcome) => void): Command {
  return (state, dispatch) => {
    if (!query || query === replacement) {
      return false;
    }

    const matches = findTextMatches(state.doc, query);

    if (matches.length === 0) {
      return false;
    }

    if (dispatch) {
      const transaction = state.tr;

      // From the end, so earlier positions stay valid.
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index]!;

        if (replacement) {
          // The replacement wears the formatting of the first replaced character.
          const marks = transaction.doc.nodeAt(match.from)?.marks ?? [];
          transaction.replaceWith(match.from, match.to, state.schema.text(replacement, marks));
        } else {
          transaction.delete(match.from, match.to);
        }
      }

      dispatch(closeHistory(transaction));

      const blockIds: string[] = [];

      for (const match of matches) {
        if (match.blockId && !blockIds.includes(match.blockId)) {
          blockIds.push(match.blockId);
        }
      }

      onDone?.({ count: matches.length, blockIds });
    }

    return true;
  };
}

/** What the replace dialog says under its fields. */
export type ReplaceStatus =
  | { kind: "empty" }
  | { kind: "none" }
  | { kind: "same"; count: number }
  | { kind: "ready"; count: number };

export function getReplaceStatus(count: number, query: string, replacement: string): ReplaceStatus {
  if (!query) {
    return { kind: "empty" };
  }

  if (count === 0) {
    return { kind: "none" };
  }

  return query === replacement ? { kind: "same", count } : { kind: "ready", count };
}
