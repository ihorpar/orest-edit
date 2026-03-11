import type { Block, EditorDocument } from "./document-model";
import { insertBlocksAfter } from "./document-model";

export function insertBlocksBefore(document: EditorDocument, anchorBlockId: string | null, newBlocks: Block[]): EditorDocument {
  if (!anchorBlockId) {
    return insertBlocksAfter(document, null, newBlocks);
  }

  const anchorIndex = document.blocks.findIndex((block) => block.id === anchorBlockId);

  if (anchorIndex <= 0) {
    return insertBlocksAfter(document, null, newBlocks);
  }

  const previousBlockId = document.blocks[anchorIndex - 1]?.id ?? null;
  return insertBlocksAfter(document, previousBlockId, newBlocks);
}
