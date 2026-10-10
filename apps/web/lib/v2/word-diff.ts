import { getInlineText, type Block, type InlineNode } from "../editor/document-model.ts";

/**
 * Word-level diff for inline review. Dependency-free: tokens are words, whitespace runs and single
 * punctuation marks; the alignment is a longest common subsequence over those tokens.
 *
 * A sentence that is mostly rewritten is then shown whole — one deletion followed by one insertion — because
 * a dozen small del/ins pieces inside one sentence cannot be read. Light edits (a swapped word, a spelling
 * fix, a changed comma) keep their word-level marks.
 */

export type DiffSegmentKind = "equal" | "delete" | "insert";

export interface DiffSegment {
  kind: DiffSegmentKind;
  text: string;
}

/**
 * How one anchored block changes under a proposal.
 * - `text`: the block stays a text block; `segments` rebuild `oldText` (equal + delete) and `newText` (equal + insert).
 * - `replace`: the block changes shape (for example a paragraph becomes a list); shown as whole-block old/new.
 * - `remove`: the proposal has no block at this position.
 * - `add`: the proposal has more blocks than the anchor; `newBlock` goes after `afterBlockId`.
 */
export type BlockDiff =
  | {
      kind: "text";
      blockId: string;
      oldText: string;
      newText: string;
      /** Inline nodes of the proposed block, so inserted text can be drawn with its bold and italic. */
      newContent: InlineNode[];
      segments: DiffSegment[];
      changed: boolean;
    }
  | { kind: "replace"; blockId: string; newBlock: Block }
  | { kind: "remove"; blockId: string }
  | { kind: "add"; afterBlockId: string; newBlock: Block };

const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:['’ʼ\-][\p{L}\p{N}]+)*|\s+|[^\s\p{L}\p{N}]/gu;
/** Above this many token pairs the middle of the text is shown as one replacement instead of being aligned. */
const MAX_ALIGNMENT_CELLS = 4_000_000;

/**
 * A sentence is shown as one whole deletion + insertion when at least this share of its words changed
 * (deleted words + inserted words, over the words of the old and the new sentence together)...
 */
export const SENTENCE_REWRITE_RATIO = 0.45;
/** ...and at least this many words are involved, so a single swapped word in a short sentence stays a word edit. */
export const SENTENCE_REWRITE_MIN_WORDS = 3;
/** Regardless of the share: this many separate changed places in one sentence are too fragmented to read. */
export const SENTENCE_REWRITE_FRAGMENTS = 4;

const WORD_PATTERN = /[\p{L}\p{N}]/u;
/** End of a sentence inside unchanged text: closing punctuation, optional closing quote or bracket, then whitespace. */
const SENTENCE_END_PATTERN = /[.!?…]+["»”’)\]]*(?=\s)/gu;

export function tokenizeForDiff(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? [];
}

/**
 * Diff of two texts. Equal + delete segments rebuild `oldText`; equal + insert segments rebuild `newText`.
 * With `coalesce: false` the result is the plain word-level alignment.
 */
export function diffWords(oldText: string, newText: string, options: { coalesce?: boolean } = {}): DiffSegment[] {
  const segments = alignWords(oldText, newText);
  return options.coalesce === false ? segments : coalesceRewrittenSentences(segments);
}

function alignWords(oldText: string, newText: string): DiffSegment[] {
  if (oldText === newText) {
    return oldText ? [{ kind: "equal", text: oldText }] : [];
  }

  const oldTokens = tokenizeForDiff(oldText);
  const newTokens = tokenizeForDiff(newText);

  let prefix = 0;
  const maxPrefix = Math.min(oldTokens.length, newTokens.length);

  while (prefix < maxPrefix && oldTokens[prefix] === newTokens[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;

  while (
    suffix < maxSuffix &&
    oldTokens[oldTokens.length - 1 - suffix] === newTokens[newTokens.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldMiddle = oldTokens.slice(prefix, oldTokens.length - suffix);
  const newMiddle = newTokens.slice(prefix, newTokens.length - suffix);
  const raw: DiffSegment[] = [];

  if (prefix > 0) {
    raw.push({ kind: "equal", text: oldTokens.slice(0, prefix).join("") });
  }

  raw.push(...alignTokens(oldMiddle, newMiddle));

  if (suffix > 0) {
    raw.push({ kind: "equal", text: oldTokens.slice(oldTokens.length - suffix).join("") });
  }

  return groupChanges(absorbWhitespaceBridges(mergeAdjacent(raw)));
}

function alignTokens(oldTokens: string[], newTokens: string[]): DiffSegment[] {
  const rows = oldTokens.length;
  const columns = newTokens.length;

  if (rows === 0 || columns === 0 || rows * columns > MAX_ALIGNMENT_CELLS) {
    return [
      ...(rows > 0 ? [{ kind: "delete" as const, text: oldTokens.join("") }] : []),
      ...(columns > 0 ? [{ kind: "insert" as const, text: newTokens.join("") }] : [])
    ];
  }

  // lengths[i][j] = longest common subsequence of oldTokens[i..] and newTokens[j..]
  const width = columns + 1;
  const lengths = new Uint32Array((rows + 1) * width);

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        oldTokens[i] === newTokens[j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }

  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;

  while (i < rows && j < columns) {
    if (oldTokens[i] === newTokens[j]) {
      segments.push({ kind: "equal", text: oldTokens[i]! });
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
      segments.push({ kind: "delete", text: oldTokens[i]! });
      i += 1;
    } else {
      segments.push({ kind: "insert", text: newTokens[j]! });
      j += 1;
    }
  }

  while (i < rows) {
    segments.push({ kind: "delete", text: oldTokens[i]! });
    i += 1;
  }

  while (j < columns) {
    segments.push({ kind: "insert", text: newTokens[j]! });
    j += 1;
  }

  return segments;
}

function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];

  for (const segment of segments) {
    if (!segment.text) {
      continue;
    }

    const last = merged[merged.length - 1];

    if (last && last.kind === segment.kind) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

/**
 * Whitespace that survives between two changed words belongs to the change: "A B" → "C D" reads as one
 * replaced phrase instead of two replaced words with a shared space.
 */
function absorbWhitespaceBridges(segments: DiffSegment[]): DiffSegment[] {
  const result: DiffSegment[] = [];

  for (const [index, segment] of segments.entries()) {
    const previous = segments[index - 1];
    const next = segments[index + 1];

    if (
      segment.kind === "equal" &&
      /^\s+$/.test(segment.text) &&
      previous &&
      next &&
      previous.kind !== "equal" &&
      next.kind !== "equal"
    ) {
      result.push({ kind: "delete", text: segment.text }, { kind: "insert", text: segment.text });
    } else {
      result.push(segment);
    }
  }

  return result;
}

/** Inside one run of changes all deleted text comes first, then all inserted text. */
function groupChanges(segments: DiffSegment[]): DiffSegment[] {
  const result: DiffSegment[] = [];
  let deleted = "";
  let inserted = "";

  const flush = () => {
    if (deleted) {
      result.push({ kind: "delete", text: deleted });
    }

    if (inserted) {
      result.push({ kind: "insert", text: inserted });
    }

    deleted = "";
    inserted = "";
  };

  for (const segment of segments) {
    if (segment.kind === "equal") {
      flush();
      result.push(segment);
    } else if (segment.kind === "delete") {
      deleted += segment.text;
    } else {
      inserted += segment.text;
    }
  }

  flush();
  return result;
}

function countWords(text: string): number {
  return tokenizeForDiff(text).filter((token) => WORD_PATTERN.test(token)).length;
}

/** Cuts the diff into sentences at sentence ends that lie in unchanged text (the only ends both versions share). */
function splitIntoSentences(segments: DiffSegment[]): DiffSegment[][] {
  const sentences: DiffSegment[][] = [[]];
  const current = () => sentences[sentences.length - 1]!;

  for (const segment of segments) {
    if (segment.kind !== "equal") {
      current().push(segment);
      continue;
    }

    let start = 0;

    for (const match of segment.text.matchAll(SENTENCE_END_PATTERN)) {
      const end = (match.index ?? 0) + match[0].length;
      current().push({ kind: "equal", text: segment.text.slice(start, end) });
      sentences.push([]);
      start = end;
    }

    if (start < segment.text.length) {
      current().push({ kind: "equal", text: segment.text.slice(start) });
    }
  }

  return sentences.filter((sentence) => sentence.length > 0);
}

function isMostlyRewritten(sentence: DiffSegment[]): boolean {
  let oldWords = 0;
  let newWords = 0;
  let changedWords = 0;
  let fragments = 0;
  let insideChange = false;

  for (const segment of sentence) {
    const words = countWords(segment.text);

    if (segment.kind === "equal") {
      oldWords += words;
      newWords += words;
      insideChange = false;
      continue;
    }

    if (segment.kind === "delete") {
      oldWords += words;
    } else {
      newWords += words;
    }

    changedWords += words;

    if (!insideChange) {
      fragments += 1;
      insideChange = true;
    }
  }

  if (fragments >= SENTENCE_REWRITE_FRAGMENTS) {
    return true;
  }

  return changedWords >= SENTENCE_REWRITE_MIN_WORDS && changedWords / (oldWords + newWords || 1) >= SENTENCE_REWRITE_RATIO;
}

/**
 * Replaces the word-level marks of every mostly rewritten sentence with one deletion of the old sentence and
 * one insertion of the new one. Whitespace around the sentence stays unchanged text. Rewritten sentences that
 * follow each other end up as a single deletion + insertion.
 */
export function coalesceRewrittenSentences(segments: DiffSegment[]): DiffSegment[] {
  if (!hasDiffChanges(segments)) {
    return segments;
  }

  const result: DiffSegment[] = [];

  for (const sentence of splitIntoSentences(segments)) {
    if (!hasDiffChanges(sentence) || !isMostlyRewritten(sentence)) {
      result.push(...sentence);
      continue;
    }

    const oldText = sentence.filter((segment) => segment.kind !== "insert").map((segment) => segment.text).join("");
    const newText = sentence.filter((segment) => segment.kind !== "delete").map((segment) => segment.text).join("");
    // Shared leading and trailing whitespace is not part of the sentence.
    const first = sentence[0]!;
    const last = sentence[sentence.length - 1]!;
    const lead = first.kind === "equal" ? (/^\s+/.exec(first.text)?.[0] ?? "") : "";
    const tail = last.kind === "equal" && sentence.length > 1 ? (/\s+$/.exec(last.text)?.[0] ?? "") : "";
    const oldCore = oldText.slice(lead.length, oldText.length - tail.length);
    const newCore = newText.slice(lead.length, newText.length - tail.length);

    result.push(
      { kind: "equal", text: lead },
      { kind: "delete", text: oldCore },
      { kind: "insert", text: newCore },
      { kind: "equal", text: tail }
    );
  }

  return groupChanges(absorbWhitespaceBridges(mergeAdjacent(result)));
}

export function hasDiffChanges(segments: DiffSegment[]): boolean {
  return segments.some((segment) => segment.kind !== "equal");
}

function isInlineTextBlock(block: Block): block is Extract<Block, { type: "paragraph" | "heading" }> {
  return block.type === "paragraph" || block.type === "heading";
}

function sameTextBlockShape(left: Block, right: Block): boolean {
  if (left.type === "paragraph" && right.type === "paragraph") {
    return true;
  }

  return left.type === "heading" && right.type === "heading" && left.level === right.level;
}

/**
 * Pairs the anchored blocks with the proposed ones by position. `blockIds` are the ids of the blocks in the
 * manuscript (the anchor); `oldBlocks` is the text the proposal was written against.
 */
export function diffProposalBlocks(blockIds: string[], oldBlocks: Block[], newBlocks: Block[]): BlockDiff[] {
  const diffs: BlockDiff[] = [];
  const anchorCount = Math.min(blockIds.length, oldBlocks.length);

  for (let index = 0; index < anchorCount; index += 1) {
    const blockId = blockIds[index]!;
    const oldBlock = oldBlocks[index]!;
    const newBlock = newBlocks[index];

    if (!newBlock) {
      diffs.push({ kind: "remove", blockId });
      continue;
    }

    if (isInlineTextBlock(oldBlock) && isInlineTextBlock(newBlock) && sameTextBlockShape(oldBlock, newBlock)) {
      const oldText = getInlineText(oldBlock.content);
      const newText = getInlineText(newBlock.content);
      const segments = diffWords(oldText, newText);
      diffs.push({
        kind: "text",
        blockId,
        oldText,
        newText,
        newContent: newBlock.content,
        segments,
        changed: hasDiffChanges(segments)
      });
      continue;
    }

    diffs.push({ kind: "replace", blockId, newBlock });
  }

  const lastAnchorId = blockIds[anchorCount - 1];

  if (lastAnchorId) {
    for (const newBlock of newBlocks.slice(anchorCount)) {
      diffs.push({ kind: "add", afterBlockId: lastAnchorId, newBlock });
    }
  }

  return diffs;
}

/** True when the proposal changes any text or block shape. */
export function hasBlockDiffChanges(diffs: BlockDiff[]): boolean {
  return diffs.some((diff) => diff.kind !== "text" || diff.changed);
}
