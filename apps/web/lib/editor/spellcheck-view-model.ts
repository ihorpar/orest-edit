import type { EditorDocument } from "./document-model";
import { getBlock, getBlockText, isTextBlock } from "./document-model";
import { formatParagraphLabel, type ManuscriptRevisionState } from "./manuscript-structure";
import type { SpellcheckIssue, SpellcheckIssueCategory, SpellcheckIssueSeverity } from "./spellcheck-contract";

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

export interface SpellcheckSummaryMeta {
  checkedBlockCount: number;
  issueCount: number;
  skippedCount: number;
  errorCount: number;
}

export interface SpellcheckBatchPart {
  blockId: string;
  paragraphLabel: string;
  text: string;
  textStart: number;
  textEnd: number;
}

export interface SpellcheckBatchChunk {
  chunkId: string;
  text: string;
  parts: SpellcheckBatchPart[];
}

const SPELLCHECK_BATCH_SEPARATOR = "\n\n";
const DEFAULT_SPELLCHECK_BATCH_MAX_CHARS = 12_000;

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
      paragraphLabel: formatParagraphLabel(revision.blockOrder.indexOf(block.id)),
      text: getBlockText(block)
    }))
    .filter((block) => block.text.trim().length > 0);
}

export function createSpellcheckBatchChunks(
  blocks: SpellcheckableBlock[],
  maxChars = DEFAULT_SPELLCHECK_BATCH_MAX_CHARS
): SpellcheckBatchChunk[] {
  const chunks: SpellcheckBatchChunk[] = [];
  let currentParts: SpellcheckBatchPart[] = [];
  let currentText = "";
  let currentIndex = 0;

  function flushCurrentChunk() {
    if (currentParts.length === 0) {
      return;
    }

    chunks.push({
      chunkId: `spellcheck-chunk-${chunks.length + 1}`,
      text: currentText,
      parts: currentParts
    });
    currentParts = [];
    currentText = "";
    currentIndex = 0;
  }

  for (const block of blocks) {
    const separator = currentParts.length > 0 ? SPELLCHECK_BATCH_SEPARATOR : "";
    const nextLength = currentText.length + separator.length + block.text.length;

    if (currentParts.length > 0 && nextLength > maxChars) {
      flushCurrentChunk();
    }

    const appliedSeparator = currentParts.length > 0 ? SPELLCHECK_BATCH_SEPARATOR : "";
    const textStart = currentIndex + appliedSeparator.length;
    const textEnd = textStart + block.text.length;

    currentText += `${appliedSeparator}${block.text}`;
    currentParts.push({
      blockId: block.blockId,
      paragraphLabel: block.paragraphLabel,
      text: block.text,
      textStart,
      textEnd
    });
    currentIndex = textEnd;
  }

  flushCurrentChunk();
  return chunks;
}

export function countSpellcheckIssues(results: SpellcheckBlockResult[]): number {
  return results.reduce((sum, result) => sum + result.issues.length, 0);
}

export function formatSpellcheckParagraphLabel(label: string): string {
  return `Абз. ${label}`;
}

export function getSpellcheckCategoryLabel(category: SpellcheckIssueCategory): string {
  switch (category) {
    case "misspelling":
      return "Орфографія";
    case "typography":
      return "Типографіка";
    case "grammar":
      return "Граматика";
    case "style":
      return "Стиль";
    default:
      return "Інше";
  }
}

export function getSpellcheckSeverityLabel(severity: SpellcheckIssueSeverity): string {
  switch (severity) {
    case "error":
      return "помилка";
    case "warning":
      return "увага";
    case "suggestion":
      return "порада";
    default:
      return "увага";
  }
}
