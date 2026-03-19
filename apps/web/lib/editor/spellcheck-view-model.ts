import type { EditorDocument } from "./document-model";
import { getBlock, getBlockText, isTextBlock } from "./document-model";
import { formatParagraphLabel, type ManuscriptRevisionState } from "./manuscript-structure";
import type { SpellcheckIssue } from "./spellcheck-contract";

export interface SpellcheckableBlock {
  blockId: string;
  paragraphLabel: string;
  text: string;
}

export interface SpellcheckBlockResult {
  blockId: string;
  paragraphLabel: string;
  text: string;
  issues: SpellcheckIssue[];
  error?: string;
}

export function getSpellcheckableBlocks(
  document: EditorDocument,
  revision: ManuscriptRevisionState,
  blockIds: string[]
): SpellcheckableBlock[] {
  return blockIds
    .map((blockId) => getBlock(document, blockId))
    .filter((block): block is NonNullable<typeof block> => Boolean(block))
    .filter((block) => isTextBlock(block))
    .map((block) => ({
      blockId: block.id,
      paragraphLabel: formatParagraphLabel(revision.blockOrder.indexOf(block.id) + 1),
      text: getBlockText(block)
    }))
    .filter((block) => block.text.trim().length > 0);
}

export function countSpellcheckIssues(results: SpellcheckBlockResult[]): number {
  return results.reduce((sum, result) => sum + result.issues.length, 0);
}
