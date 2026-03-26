import type { BulletListBlock, EditorDocument, OrderedListBlock } from "./document-model.ts";
import { createBlockId, createEmptyParagraphBlock, getBlock, getBlockIndex } from "./document-model.ts";

export interface ExitListItemResult {
  document: EditorDocument;
  focusBlockId: string;
}

export function exitListItemToParagraph(
  document: EditorDocument,
  blockId: string,
  itemIndex: number
): ExitListItemResult | null {
  const block = getBlock(document, blockId);

  if (!block || (block.type !== "bullet_list" && block.type !== "ordered_list")) {
    return null;
  }

  return buildExitListItemResult(document, block, itemIndex);
}

function buildExitListItemResult(
  document: EditorDocument,
  block: BulletListBlock | OrderedListBlock,
  itemIndex: number
): ExitListItemResult {
  if (block.items.length <= 1) {
    return {
      document: {
        version: 2,
        blocks: document.blocks.map((entry) =>
          entry.id === block.id ? createEmptyParagraphBlock(block.id) : entry
        )
      },
      focusBlockId: block.id
    };
  }

  const nextParagraph = createEmptyParagraphBlock();
  const trimmedIndex = Math.max(0, Math.min(itemIndex, block.items.length - 1));
  const beforeItems = block.items.slice(0, trimmedIndex);
  const afterItems = block.items.slice(trimmedIndex + 1);
  const blockIndex = getBlockIndex(document, block.id);
  const nextBlocks = [...document.blocks];
  const replacementBlocks: Array<BulletListBlock | OrderedListBlock | ReturnType<typeof createEmptyParagraphBlock>> = [];

  if (beforeItems.length > 0) {
    replacementBlocks.push({
      ...block,
      items: beforeItems
    });
  }

  replacementBlocks.push(nextParagraph);

  if (afterItems.length > 0) {
    replacementBlocks.push({
      ...block,
      id: beforeItems.length > 0 ? createBlockId(block.type === "bullet_list" ? "bullet" : "ordered") : block.id,
      items: afterItems
    });
  }

  nextBlocks.splice(blockIndex, 1, ...replacementBlocks);

  return {
    document: {
      version: 2,
      blocks: nextBlocks
    },
    focusBlockId: nextParagraph.id
  };
}
