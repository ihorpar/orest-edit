import type { Block, BlockSelection, EditorDocument } from "./document-model";
import { getBlock, getBlockText, getContiguousBlockIds } from "./document-model";
import type { EditorialReviewItem } from "./review-contract";

export interface ManuscriptRevisionState {
  documentRevisionId: string;
  blockOrder: string[];
  blockFingerprints: Record<string, string>;
}

export interface ManuscriptParagraph {
  id: string;
  blockIndex: number;
  label: string;
  fingerprint: string;
  type: Block["type"];
  text: string;
}

export function deriveManuscriptRevisionState(document: EditorDocument): ManuscriptRevisionState {
  const blockOrder = document.blocks.map((block) => block.id);
  const blockFingerprints = Object.fromEntries(
    document.blocks.map((block) => [block.id, computeBlockFingerprint(block)])
  );

  return {
    documentRevisionId: computeDocumentRevisionId(blockOrder, blockFingerprints),
    blockOrder,
    blockFingerprints
  };
}

export function getManuscriptParagraphs(document: EditorDocument, revision: ManuscriptRevisionState): ManuscriptParagraph[] {
  return revision.blockOrder
    .map((blockId, blockIndex) => {
      const block = getBlock(document, blockId);

      if (!block) {
        return null;
      }

      return {
        id: block.id,
        blockIndex,
        label: formatParagraphLabel(blockIndex),
        fingerprint: revision.blockFingerprints[block.id] ?? computeBlockFingerprint(block),
        type: block.type,
        text: getBlockText(block)
      } satisfies ManuscriptParagraph;
    })
    .filter((block): block is ManuscriptParagraph => Boolean(block));
}

export function getParagraphRangeText(document: EditorDocument, revision: ManuscriptRevisionState, start: number, end: number): string {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(revision.blockOrder.length - 1, Math.max(start, end));

  return revision.blockOrder
    .slice(from, to + 1)
    .map((blockId) => getBlock(document, blockId))
    .filter((block): block is Block => Boolean(block))
    .map((block) => getBlockText(block))
    .join("\n\n");
}

export function computeAnchorFingerprint(document: EditorDocument, blockIds: string[]): string {
  return blockIds
    .map((blockId) => getBlock(document, blockId))
    .filter((block): block is Block => Boolean(block))
    .map((block) => computeBlockFingerprint(block))
    .join("|");
}

export function areParagraphIdsResolvable(revision: ManuscriptRevisionState, blockIds: string[]): boolean {
  const allowed = new Set(revision.blockOrder);
  return blockIds.length > 0 && blockIds.every((blockId) => allowed.has(blockId));
}

export function resolveReviewItemSelection(
  document: EditorDocument,
  revision: ManuscriptRevisionState,
  item: Pick<EditorialReviewItem, "anchor">
): BlockSelection {
  const blockIds = item.anchor.blockIds.filter((blockId) => revision.blockOrder.includes(blockId));

  if (blockIds.length === 0) {
    return {
      blockIds: [],
      anchorBlockId: null,
      focusBlockId: null
    };
  }

  const contiguous = getContiguousBlockIds(document, blockIds[0], blockIds[blockIds.length - 1]);
  return {
    blockIds: contiguous,
    anchorBlockId: contiguous[0] ?? null,
    focusBlockId: contiguous[contiguous.length - 1] ?? null
  };
}

export function formatParagraphLabel(blockIndex: number): string {
  return String(blockIndex + 1).padStart(3, "0");
}

export function computeBlockFingerprint(block: Block): string {
  return `${block.type}:${getBlockText(block).trim()}`;
}

export function computeDocumentRevisionId(blockOrder: string[], blockFingerprints: Record<string, string>): string {
  const fingerprint = blockOrder.map((blockId) => `${blockId}:${blockFingerprints[blockId] ?? ""}`).join("|");
  let hash = 0;

  for (let index = 0; index < fingerprint.length; index += 1) {
    hash = (hash * 31 + fingerprint.charCodeAt(index)) >>> 0;
  }

  return `rev-${hash.toString(16)}`;
}
