import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { createBlockIdForNodeType } from "./tiptap-bridge.ts";

export const blockIdPluginKey = new PluginKey("v2BlockIds");

/**
 * Keeps `attrs.id` unique and present on every top-level block.
 *
 * ProseMirror copies attributes when a block is split, and copied HTML carries `data-block-id`, so the same
 * id can show up on several blocks. The block that held the id before the transaction keeps it (its old
 * position is mapped through the transaction), wherever the copy was pasted. Only a split may move the id:
 * when the original is left as an empty text block and the block right after it carries the same id and has
 * the text, the id follows the text. Every other duplicate, and every block without an id, gets a fresh one.
 *
 * The fix is appended to the originating transaction, so one undo step reverts both.
 */
export function createBlockIdPlugin(createId: (nodeType: string) => string = createBlockIdForNodeType): Plugin {
  return new Plugin({
    key: blockIdPluginKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const origins = new Map<string, number>();

      oldState.doc.forEach((node, pos) => {
        const id = readBlockId(node);

        if (id && !origins.has(id)) {
          origins.set(
            id,
            transactions.reduce((mapped, transaction) => transaction.mapping.map(mapped, 1), pos)
          );
        }
      });

      const transaction = newState.tr;
      return ensureUniqueBlockIds(newState.doc, transaction, createId, origins) ? transaction : null;
    }
  });
}

/**
 * Adds `setNodeAttribute` steps for every top-level block whose id is missing or duplicated.
 * `origins` maps an id to the position, in `doc`, of the block that owned it before the change.
 */
export function ensureUniqueBlockIds(
  doc: ProseMirrorNode,
  transaction: Transaction,
  createId: (nodeType: string) => string = createBlockIdForNodeType,
  origins: ReadonlyMap<string, number> = new Map()
): boolean {
  const entries: Array<{ node: ProseMirrorNode; pos: number; id: string | null }> = [];
  const groups = new Map<string, number[]>();

  doc.forEach((node, pos) => {
    const id = readBlockId(node);
    entries.push({ node, pos, id });

    if (id) {
      const group = groups.get(id);

      if (group) {
        group.push(entries.length - 1);
      } else {
        groups.set(id, [entries.length - 1]);
      }
    }
  });

  const keepers = new Set<number>();

  for (const [id, group] of groups) {
    if (group.length === 1) {
      keepers.add(group[0]!);
      continue;
    }

    const originPos = origins.get(id);
    const origin = originPos === undefined ? undefined : group.find((index) => entries[index]!.pos === originPos);

    if (origin === undefined) {
      // No block owned this id before (for example two pasted copies): the first one with text keeps it.
      keepers.add(group.find((index) => !isEmptyTextBlock(entries[index]!.node)) ?? group[0]!);
      continue;
    }

    const next = origin + 1;
    const isSplitWithTextBelow =
      isEmptyTextBlock(entries[origin]!.node) &&
      group.includes(next) &&
      entries[next]!.node.isTextblock &&
      !isEmptyTextBlock(entries[next]!.node);

    keepers.add(isSplitWithTextBelow ? next : origin);
  }

  const usedIds = new Set(groups.keys());
  let changed = false;

  for (const [index, entry] of entries.entries()) {
    if (entry.id && keepers.has(index)) {
      continue;
    }

    let nextId = createId(entry.node.type.name);

    while (usedIds.has(nextId)) {
      nextId = createId(entry.node.type.name);
    }

    usedIds.add(nextId);
    transaction.setNodeAttribute(entry.pos, "id", nextId);
    changed = true;
  }

  return changed;
}

export function getTopLevelBlockIds(doc: ProseMirrorNode): Array<string | null> {
  const ids: Array<string | null> = [];
  doc.forEach((node) => ids.push(readBlockId(node)));
  return ids;
}

/** Position of the top-level block with this id, or -1. */
export function findBlockPosition(doc: ProseMirrorNode, blockId: string): number {
  let found = -1;

  doc.forEach((node, pos) => {
    if (found < 0 && node.attrs.id === blockId) {
      found = pos;
    }
  });

  return found;
}

function readBlockId(node: ProseMirrorNode): string | null {
  return typeof node.attrs.id === "string" && node.attrs.id ? node.attrs.id : null;
}

function isEmptyTextBlock(node: ProseMirrorNode): boolean {
  return node.isTextblock && node.content.size === 0;
}
