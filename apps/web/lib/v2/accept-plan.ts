import { getInlineText, type Block, type EditorDocument } from "../editor/document-model.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import {
  buildCalloutBlock,
  buildHeadingBlock,
  getAccentPhrase,
  getItemKind,
  getSpellReplacement,
  getTextBlockContent,
  isInlineRangeBold,
  resolveAccentRange,
  type V2ReviewItem
} from "./item-kinds.ts";
import type { ReviewEdit } from "./review-apply.ts";
import { blockToTiptapNode, createBlockIdForNodeType } from "./tiptap-bridge.ts";

/**
 * What accepting a suggestion that carries its own result does to the manuscript: one edit for
 * `applyReviewEdits`, built from the document as it reads right now. Rewrites (`replace`) are not planned
 * here; they go through `replaceAnchoredBlocks` with their prepared proposal.
 */
export interface AcceptPlan {
  itemId: string;
  edit: ReviewEdit;
  /** Ids of the blocks the edit inserts, so undo and redo of the acceptance can be recognised. */
  insertedBlockIds?: string[];
}

export interface AcceptPlanOptions {
  locale: AppLocale;
  /** Ids that must not be given to a new block (ids planned earlier in the same bulk). */
  takenIds?: Set<string>;
  createId?: (nodeType: string) => string;
}

function createFreshId(block: Block, document: EditorDocument, options: AcceptPlanOptions): string {
  const createId = options.createId ?? createBlockIdForNodeType;
  const nodeType = blockToTiptapNode(block).type ?? "paragraph";
  const taken = options.takenIds ?? new Set<string>();
  let id = createId(nodeType);
  let attempts = 0;

  while ((taken.has(id) || document.blocks.some((entry) => entry.id === id)) && attempts < 50) {
    id = createId(nodeType);
    attempts += 1;
  }

  taken.add(id);
  return id;
}

/** The edit for one item, or null when the manuscript no longer has what the item points at. */
export function planAccept(item: V2ReviewItem, document: EditorDocument, options: AcceptPlanOptions): AcceptPlan | null {
  const kind = getItemKind(item);

  if (kind === "heading" || kind === "callout") {
    const anchorBlockId = item.insertionPoint.anchorBlockId;

    if (!document.blocks.some((block) => block.id === anchorBlockId)) {
      return null;
    }

    const draft = kind === "heading" ? buildHeadingBlock(item, "") : buildCalloutBlock(item, options.locale, "");

    if (!draft) {
      return null;
    }

    const block: Block = { ...draft, id: createFreshId(draft, document, options) };
    // A heading always goes before its anchor; a callout follows the item's insertion mode.
    const side = kind === "heading" || item.insertionPoint.mode === "before" ? "before" : "after";

    return { itemId: item.id, edit: { type: "insert", anchorBlockId, side, blocks: [block] }, insertedBlockIds: [block.id] };
  }

  if (kind !== "accent" && kind !== "spell") {
    return null;
  }

  const blockId = item.anchor.blockIds[0];
  const content = getTextBlockContent(document.blocks.find((block) => block.id === blockId));

  if (!blockId || !content) {
    return null;
  }

  const text = getInlineText(content);

  if (kind === "accent") {
    const range = resolveAccentRange(text, item);

    if (!range || isInlineRangeBold(content, range.start, range.end)) {
      return null;
    }

    return { itemId: item.id, edit: { type: "bold", blockId, start: range.start, end: range.end, expected: getAccentPhrase(item) } };
  }

  const spell = item.spell;
  const replacement = getSpellReplacement(item);

  if (!spell || !replacement || text.slice(spell.range.start, spell.range.end) !== spell.badText) {
    return null;
  }

  return {
    itemId: item.id,
    edit: { type: "text", blockId, start: spell.range.start, end: spell.range.end, expected: spell.badText, text: replacement }
  };
}

/**
 * Plans for several items at once; items that cannot be planned are left out and reported in `skipped`.
 * So is an item whose range overlaps one planned before it in the same block (two findings on one word):
 * only the first can be applied as shown, the other stays open.
 */
export function planBulkAccept(
  items: V2ReviewItem[],
  document: EditorDocument,
  options: AcceptPlanOptions
): { plans: AcceptPlan[]; skipped: string[] } {
  const takenIds = options.takenIds ?? new Set<string>();
  const plans: AcceptPlan[] = [];
  const skipped: string[] = [];

  for (const item of items) {
    const plan = planAccept(item, document, { ...options, takenIds });
    const edit = plan?.edit;
    const overlaps =
      edit !== undefined &&
      edit.type !== "insert" &&
      plans.some(
        (earlier) =>
          earlier.edit.type !== "insert" && earlier.edit.blockId === edit.blockId && edit.start < earlier.edit.end && earlier.edit.start < edit.end
      );

    if (plan && !overlaps) {
      plans.push(plan);
    } else {
      skipped.push(item.id);
    }
  }

  return { plans, skipped };
}
