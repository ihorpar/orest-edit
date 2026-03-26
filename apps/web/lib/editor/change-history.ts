import type { Block, BlockSelection, EditorDocument } from "./document-model";
import { cloneBlock, cloneEditorDocument } from "./document-model";
import type { SpellcheckBlockResult, SpellcheckSummaryMeta } from "./spellcheck-view-model";

export type EditorMutationKind = "manual_edit" | "spellcheck_apply" | "ai_apply" | "insert_block";

export interface EditorSpellcheckSnapshot {
  results: SpellcheckBlockResult[];
  meta: SpellcheckSummaryMeta | null;
  summary: string | null;
  secondarySummary: string | null;
  invalidatedCount: number;
}

export interface EditorMutationSnapshot {
  document: EditorDocument;
  selection: BlockSelection;
  focusedBlockId: string | null;
  spellcheck?: EditorSpellcheckSnapshot;
}

export interface EditorMutationEntry {
  id: string;
  kind: EditorMutationKind;
  label: string;
  timestamp: number;
  timestampLabel: string;
  blockIds: string[];
  before: EditorMutationSnapshot;
  after: EditorMutationSnapshot;
  mergeKey?: string;
}

export interface CompareHistoryEntry {
  id: string;
  kind: EditorMutationKind;
  label: string;
  timestampLabel: string;
  blockIds: string[];
  beforeBlocks: Block[];
  afterBlocks: Block[];
}

export function createMutationSnapshot(input: EditorMutationSnapshot): EditorMutationSnapshot {
  return {
    document: cloneEditorDocument(input.document),
    selection: cloneSelection(input.selection),
    focusedBlockId: input.focusedBlockId,
    spellcheck: input.spellcheck ? cloneSpellcheckSnapshot(input.spellcheck) : undefined
  };
}

export function createMutationEntry(input: {
  id: string;
  kind: EditorMutationKind;
  label: string;
  timestamp: number;
  timestampLabel: string;
  blockIds: string[];
  before: EditorMutationSnapshot;
  after: EditorMutationSnapshot;
  mergeKey?: string;
}): EditorMutationEntry {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    timestamp: input.timestamp,
    timestampLabel: input.timestampLabel,
    blockIds: [...input.blockIds],
    before: createMutationSnapshot(input.before),
    after: createMutationSnapshot(input.after),
    mergeKey: input.mergeKey
  };
}

export function pushMutationEntry(
  history: EditorMutationEntry[],
  nextEntry: EditorMutationEntry,
  options?: { maxEntries?: number; mergeWindowMs?: number }
): EditorMutationEntry[] {
  const maxEntries = options?.maxEntries ?? 50;
  const mergeWindowMs = options?.mergeWindowMs ?? 1200;
  const previousEntry = history.at(-1);

  if (
    previousEntry &&
    previousEntry.mergeKey &&
    nextEntry.mergeKey &&
    previousEntry.mergeKey === nextEntry.mergeKey &&
    nextEntry.timestamp - previousEntry.timestamp <= mergeWindowMs
  ) {
    return [
      ...history.slice(0, -1),
      {
        ...previousEntry,
        timestamp: nextEntry.timestamp,
        timestampLabel: nextEntry.timestampLabel,
        after: createMutationSnapshot(nextEntry.after)
      }
    ];
  }

  return [...history.slice(Math.max(0, history.length - (maxEntries - 1))), nextEntry];
}

export function createCompareHistoryEntry(input: {
  id: string;
  kind: EditorMutationKind;
  label: string;
  timestampLabel: string;
  blockIds: string[];
  beforeBlocks: Block[];
  afterBlocks: Block[];
}): CompareHistoryEntry {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    timestampLabel: input.timestampLabel,
    blockIds: [...input.blockIds],
    beforeBlocks: input.beforeBlocks.map((block) => cloneBlock(block)),
    afterBlocks: input.afterBlocks.map((block) => cloneBlock(block))
  };
}

function cloneSelection(selection: BlockSelection): BlockSelection {
  return {
    blockIds: [...selection.blockIds],
    anchorBlockId: selection.anchorBlockId,
    focusBlockId: selection.focusBlockId
  };
}

function cloneSpellcheckSnapshot(spellcheck: EditorSpellcheckSnapshot): EditorSpellcheckSnapshot {
  return {
    results: spellcheck.results.map((result) => ({
      ...result,
      issues: result.issues.map((issue) => ({
        ...issue,
        range: {
          start: issue.range.start,
          end: issue.range.end
        },
        suggestions: issue.suggestions.map((suggestion) => ({ ...suggestion }))
      }))
    })),
    meta: spellcheck.meta ? { ...spellcheck.meta } : null,
    summary: spellcheck.summary,
    secondarySummary: spellcheck.secondarySummary,
    invalidatedCount: spellcheck.invalidatedCount
  };
}
