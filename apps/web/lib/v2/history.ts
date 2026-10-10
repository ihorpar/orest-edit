import { cloneBlock, type Block, type EditorDocument } from "../editor/document-model.ts";

/**
 * Change history of a v2 draft: one entry per accepted change, with the blocks as they were and as they
 * became. It is a record for reading (`Було` / `Стало`), not an undo stack: undo is the editor's own.
 *
 * Only changes applied by an explicit accept are logged: a suggestion of any kind, a bulk accept (one
 * entry), an illustration inserted, replaced or removed, a caption, a global replace. Typing is never logged.
 */

export type V2HistoryKind =
  | "replace"
  | "heading"
  | "accent"
  | "callout"
  | "spell"
  | "visual"
  | "visualReplace"
  | "visualRemove"
  | "caption"
  | "bulk"
  | "globalReplace";

const KINDS: ReadonlySet<string> = new Set<V2HistoryKind>([
  "replace",
  "heading",
  "accent",
  "callout",
  "spell",
  "visual",
  "visualReplace",
  "visualRemove",
  "caption",
  "bulk",
  "globalReplace"
]);

/** Where the change stands, kept as numbers so the label follows the interface language. */
export type V2HistoryWhere =
  /** Paragraph numbers as the gutter showed them when the change was made. */
  | { type: "paragraphs"; first: number; last: number }
  | { type: "heading" }
  | { type: "block" };

export interface V2HistoryEntry {
  id: string;
  kind: V2HistoryKind;
  /** ISO time of the accept. */
  at: string;
  where: V2HistoryWhere;
  /** The pass or source the change came from (a pass id, `fact`, `request`), when it has one. */
  source?: string;
  /** How many suggestions (bulk accept) or matches (global replace) the entry covers. */
  count?: number;
  /** Search and replacement text of a global replace. */
  find?: string;
  replacement?: string;
  /** The changed blocks as they were; empty when the change only added blocks. */
  before: Block[];
  /** The changed blocks as they became; empty when the change only removed blocks. */
  after: Block[];
  /** Changed blocks left out of `before`/`after` because the entry would be too large. */
  omitted?: number;
}

/** Most entries a draft keeps. */
export const HISTORY_LIMIT = 50;
/** Most blocks one entry keeps on each side; a bulk change over a long chapter stays readable and small. */
export const HISTORY_ENTRY_BLOCK_LIMIT = 40;
/** Rough budget, in characters of JSON, for the whole history inside the stored draft. */
export const HISTORY_CHAR_BUDGET = 400_000;

export interface DocumentChange {
  before: Block[];
  after: Block[];
}

/**
 * The blocks that differ between two versions of the manuscript: on the `before` side those that changed
 * or disappeared, on the `after` side those that changed or appeared, each in document order.
 */
export function diffDocuments(before: EditorDocument, after: EditorDocument): DocumentChange {
  const beforeById = new Map(before.blocks.map((block) => [block.id, JSON.stringify(block)]));
  const afterById = new Map(after.blocks.map((block) => [block.id, JSON.stringify(block)]));

  return {
    before: before.blocks.filter((block) => afterById.get(block.id) !== beforeById.get(block.id)),
    after: after.blocks.filter((block) => beforeById.get(block.id) !== afterById.get(block.id))
  };
}

function paragraphNumbers(document: EditorDocument): Map<string, number> {
  const numbers = new Map<string, number>();
  let count = 0;

  for (const block of document.blocks) {
    if (block.type === "paragraph") {
      count += 1;
      numbers.set(block.id, count);
    }
  }

  return numbers;
}

/**
 * Where a change stands: the paragraph numbers of the changed blocks; for a change that only added blocks,
 * the paragraph the new block stands next to.
 */
export function locateChange(change: DocumentChange, before: EditorDocument, after: EditorDocument): V2HistoryWhere {
  const fromBefore = change.before.length > 0;
  const document = fromBefore ? before : after;
  const blocks = fromBefore ? change.before : change.after;
  const numbers = paragraphNumbers(document);
  const found = blocks.map((block) => numbers.get(block.id)).filter((value): value is number => value !== undefined);

  if (found.length > 0) {
    return { type: "paragraphs", first: Math.min(...found), last: Math.max(...found) };
  }

  // A heading, callout or figure: named by the paragraph that follows it, or the one before it at the end.
  const ids = new Set(blocks.map((block) => block.id));
  const lastIndex = document.blocks.reduce((result, block, index) => (ids.has(block.id) ? index : result), -1);
  const firstIndex = document.blocks.findIndex((block) => ids.has(block.id));
  const next = document.blocks.slice(lastIndex + 1).find((block) => block.type === "paragraph");
  const previous = document.blocks
    .slice(0, Math.max(firstIndex, 0))
    .reverse()
    .find((block) => block.type === "paragraph");
  const neighbour = next ?? previous;
  const number = neighbour ? numbers.get(neighbour.id) : undefined;

  if (number !== undefined) {
    return { type: "paragraphs", first: number, last: number };
  }

  return blocks[0]?.type === "heading" ? { type: "heading" } : { type: "block" };
}

export interface HistoryEntryInput {
  id: string;
  kind: V2HistoryKind;
  at: string;
  before: EditorDocument;
  after: EditorDocument;
  source?: string | null;
  count?: number;
  find?: string;
  replacement?: string;
}

/** The entry for a change between two versions of the manuscript, or null when nothing changed. */
export function buildHistoryEntry(input: HistoryEntryInput): V2HistoryEntry | null {
  const change = diffDocuments(input.before, input.after);

  if (change.before.length === 0 && change.after.length === 0) {
    return null;
  }

  const omitted = Math.max(change.before.length, change.after.length) - HISTORY_ENTRY_BLOCK_LIMIT;

  return {
    id: input.id,
    kind: input.kind,
    at: input.at,
    where: locateChange(change, input.before, input.after),
    ...(input.source ? { source: input.source } : {}),
    ...(input.count !== undefined ? { count: input.count } : {}),
    ...(input.find !== undefined ? { find: input.find } : {}),
    ...(input.replacement !== undefined ? { replacement: input.replacement } : {}),
    before: change.before.slice(0, HISTORY_ENTRY_BLOCK_LIMIT).map(cloneBlock),
    after: change.after.slice(0, HISTORY_ENTRY_BLOCK_LIMIT).map(cloneBlock),
    ...(omitted > 0 ? { omitted } : {})
  };
}

/** Adds an entry (newest last) and keeps the list within the entry limit and the size budget. */
export function pushHistoryEntry(
  history: V2HistoryEntry[],
  entry: V2HistoryEntry,
  limits: { entries?: number; chars?: number } = {}
): V2HistoryEntry[] {
  return trimHistory([...history, entry], limits);
}

/** Drops the oldest entries until the list fits; the newest entry is always kept. */
export function trimHistory(history: V2HistoryEntry[], limits: { entries?: number; chars?: number } = {}): V2HistoryEntry[] {
  const maxEntries = limits.entries ?? HISTORY_LIMIT;
  const maxChars = limits.chars ?? HISTORY_CHAR_BUDGET;
  let result = history.length > maxEntries ? history.slice(history.length - maxEntries) : history;
  const sizes = result.map((entry) => JSON.stringify(entry).length);
  let total = sizes.reduce((sum, size) => sum + size, 0);
  let start = 0;

  while (total > maxChars && start < result.length - 1) {
    total -= sizes[start]!;
    start += 1;
  }

  if (start > 0) {
    result = result.slice(start);
  }

  return result;
}

/** Reads a stored history; anything that is not a well-formed entry is left out. */
export function coerceHistory(value: unknown): V2HistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: V2HistoryEntry[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const entry = raw as Partial<V2HistoryEntry>;
    const where = coerceWhere(entry.where);

    if (
      typeof entry.id !== "string" ||
      typeof entry.kind !== "string" ||
      !KINDS.has(entry.kind) ||
      typeof entry.at !== "string" ||
      !where ||
      !isBlockList(entry.before) ||
      !isBlockList(entry.after)
    ) {
      continue;
    }

    entries.push({
      id: entry.id,
      kind: entry.kind,
      at: entry.at,
      where,
      ...(typeof entry.source === "string" && entry.source ? { source: entry.source } : {}),
      ...(typeof entry.count === "number" && Number.isFinite(entry.count) ? { count: entry.count } : {}),
      ...(typeof entry.find === "string" ? { find: entry.find } : {}),
      ...(typeof entry.replacement === "string" ? { replacement: entry.replacement } : {}),
      before: entry.before,
      after: entry.after,
      ...(typeof entry.omitted === "number" && entry.omitted > 0 ? { omitted: entry.omitted } : {})
    });
  }

  return trimHistory(entries);
}

function coerceWhere(value: unknown): V2HistoryWhere | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const where = value as { type?: unknown; first?: unknown; last?: unknown };

  if (where.type === "heading" || where.type === "block") {
    return { type: where.type };
  }

  if (where.type === "paragraphs" && Number.isInteger(where.first) && Number.isInteger(where.last)) {
    return { type: "paragraphs", first: where.first as number, last: where.last as number };
  }

  return null;
}

function isInlineList(value: unknown): boolean {
  return Array.isArray(value) && value.every((node) => node !== null && typeof node === "object" && typeof (node as { text?: unknown }).text === "string");
}

const isInlineListList = (value: unknown): boolean => Array.isArray(value) && value.every(isInlineList);

/**
 * True when a stored block has every field its type is read by (the shapes of `document-model.ts`). The
 * history is shown straight from storage, so a block that fails this is never handed to the dialog.
 */
export function isWellFormedBlock(value: unknown): value is Block {
  if (!value || typeof value !== "object") {
    return false;
  }

  const block = value as Record<string, unknown>;

  if (typeof block.id !== "string" || !block.id) {
    return false;
  }

  switch (block.type) {
    case "paragraph":
      return isInlineList(block.content);
    case "heading":
      return isInlineList(block.content) && (block.level === 1 || block.level === 2 || block.level === 3);
    case "bullet_list":
    case "ordered_list":
      return isInlineListList(block.items);
    case "image":
      return typeof block.assetId === "string" && typeof block.alt === "string" && (block.caption === undefined || isInlineList(block.caption));
    case "callout":
      return typeof block.kind === "string" && isInlineList(block.title) && isInlineListList(block.body);
    case "divider":
      return true;
    case "table":
      return Array.isArray(block.rows) && block.rows.every(isInlineListList);
    default:
      return false;
  }
}

/** A damaged block anywhere in the list makes the whole entry unreadable: it is dropped, not half shown. */
function isBlockList(value: unknown): value is Block[] {
  return Array.isArray(value) && value.every(isWellFormedBlock);
}

export interface HistoryWhereCopy {
  whereParagraph: (label: string) => string;
  whereHeading: string;
  whereBlock: string;
}

/** "абз. 3", "абз. 3–4", "заголовок". */
export function formatHistoryWhere(where: V2HistoryWhere, copy: HistoryWhereCopy): string {
  if (where.type === "paragraphs") {
    return copy.whereParagraph(where.first === where.last ? String(where.first) : `${where.first}–${where.last}`);
  }

  return where.type === "heading" ? copy.whereHeading : copy.whereBlock;
}
