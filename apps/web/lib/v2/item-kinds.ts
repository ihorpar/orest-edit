import { splitCalloutDraftIntoParagraphs } from "../editor/callout-preview.ts";
import { getInlineText, type Block, type CalloutBlock, type HeadingBlock, type InlineNode } from "../editor/document-model.ts";
import { parseBoldMarkdownToInlineNodes } from "../editor/inline-markup.ts";
import {
  getEditorialCalloutKindTitle,
  normalizeEditorialCalloutDepth,
  type EditorialCalloutDepth,
  type EditorialCalloutKind,
  type EditorialHeadingLevel,
  type EditorialReviewItem
} from "../editor/review-contract.ts";
import type { SpellcheckIssueCategory } from "../editor/spellcheck-contract.ts";
import type { AppLocale } from "../i18n/product-locale.ts";

/**
 * What a suggestion does to the manuscript, and the pure helpers each kind needs. The kind decides whether a
 * model call is needed before the result can be shown, how the result is drawn, and how it is applied:
 *
 * - `replace`  rewrites the anchored blocks; needs a prepared `text_diff` proposal (clarity, lists, expand);
 * - `heading`  inserts one heading before the anchor; the title arrives with the item (structure);
 * - `accent`   makes one exact phrase bold; nothing to prepare (emphasis);
 * - `callout`  inserts a callout block next to the anchor; needs a prepared callout draft;
 * - `spell`    replaces one exact range with a chosen suggestion; comes from the spellcheck endpoint;
 * - `visual`   an illustration; wired in a later milestone.
 */
export type V2ItemKind = "replace" | "heading" | "accent" | "callout" | "spell" | "visual";

export interface TextRange {
  start: number;
  end: number;
}

/** A spelling finding carried by a queue item. Offsets are in the text of the single anchored block. */
export interface V2SpellData {
  range: TextRange;
  badText: string;
  suggestions: string[];
  /** Index of the suggestion that would be applied. */
  choice: number;
  category: SpellcheckIssueCategory;
  /** Text of the block as it was when `range` was last confirmed; edits are rebased against it. */
  blockText: string;
  /** Which occurrence of `badText` in the block this is (1-based); identifies an ignored finding on a rerun. */
  occurrence: number;
}

/** A queue item: a review item of the classic contract, or a spelling finding wearing the same shape. */
export type V2ReviewItem = EditorialReviewItem & {
  spell?: V2SpellData;
  /**
   * The callout draft on this item was written by the proposal endpoint for this item. Review runs deliver
   * callout items with a placeholder draft (kind, depth, a working title and a copy of the source fragment);
   * that is not a callout and is never drawn or inserted.
   */
  calloutPrepared?: boolean;
};

const OTHER_KIND_TYPES: ReadonlySet<string> = new Set(["subsection", "callout", "visual", "list"]);

function isAccentTarget(item: V2ReviewItem): boolean {
  return typeof item.emphasisTarget?.text === "string" && item.emphasisTarget.text.trim().length > 0;
}

export function getItemKind(item: V2ReviewItem): V2ItemKind {
  if (item.spell) {
    return "spell";
  }

  // An accent is an item that names the exact phrase to make bold. Every item of the emphasis pass is one
  // (also a damaged one without its phrase, which then has nothing to show); an item from another source
  // counts when it carries the phrase and is not a suggestion of another kind (heading, callout, image, list).
  if (item.stepId === "emphasis" || (isAccentTarget(item) && !OTHER_KIND_TYPES.has(item.recommendationType))) {
    return "accent";
  }

  switch (item.recommendationType) {
    case "subsection":
      return "heading";
    case "callout":
      return "callout";
    case "visual":
      return "visual";
    default:
      return "replace";
  }
}

/** Inline nodes parsed from the model's text, without the empty mark slots the parser leaves behind. */
function parseInline(text: string): InlineNode[] {
  return parseBoldMarkdownToInlineNodes(text)
    .filter((node) => node.text)
    .map((node) => ({
      text: node.text,
      ...(node.bold ? { bold: true as const } : {}),
      ...(node.italic ? { italic: true as const } : {}),
      ...(node.link ? { link: node.link } : {})
    }));
}

/* ---------- headings ---------- */

export function getHeadingDraft(item: V2ReviewItem): { title: string; headingLevel: EditorialHeadingLevel } | null {
  const title = item.subsectionDraft?.title?.trim();

  if (!title) {
    return null;
  }

  return { title, headingLevel: (item.subsectionDraft?.headingLevel ?? item.headingLevel) === 2 ? 2 : 3 };
}

/** The heading block an accepted structure suggestion inserts, as in the classic editor. */
export function buildHeadingBlock(item: V2ReviewItem, id: string): HeadingBlock | null {
  const draft = getHeadingDraft(item);

  if (!draft) {
    return null;
  }

  const content = parseInline(draft.title);
  return content.length > 0 ? { id, type: "heading", level: draft.headingLevel, content } : null;
}

/* ---------- callouts ---------- */

export function getCalloutOptions(item: V2ReviewItem): { calloutKind: EditorialCalloutKind; calloutDepth: EditorialCalloutDepth } {
  return {
    calloutKind: item.calloutDraft?.calloutKind ?? item.calloutKind ?? "mechanism",
    calloutDepth: normalizeEditorialCalloutDepth(item.calloutDraft?.calloutDepth ?? item.calloutDepth)
  };
}

export function hasCalloutDraft(item: V2ReviewItem): boolean {
  return item.calloutPrepared === true && Boolean(item.calloutDraft?.previewText?.trim());
}

/** The callout block a prepared draft inserts, as in the classic editor (`applyReviewCallout`). */
export function buildCalloutBlock(item: V2ReviewItem, locale: AppLocale, id: string): CalloutBlock | null {
  const draft = item.calloutDraft;

  if (!draft || !hasCalloutDraft(item)) {
    return null;
  }

  const title = parseInline(draft.title?.trim() || getEditorialCalloutKindTitle(draft.calloutKind, locale));
  const body = splitCalloutDraftIntoParagraphs(draft.previewText, draft.calloutKind)
    .filter((paragraph) => getInlineText(paragraph).trim())
    .map((paragraph) =>
      paragraph
        .filter((node) => node.text)
        .map((node) => ({ text: node.text, ...(node.bold ? { bold: true as const } : {}), ...(node.italic ? { italic: true as const } : {}) }))
    );

  if (body.length === 0) {
    return null;
  }

  return {
    id,
    type: "callout",
    kind: draft.calloutKind,
    depth: normalizeEditorialCalloutDepth(draft.calloutDepth),
    title,
    body
  };
}

/* ---------- inline targets (accents, spelling) ---------- */

export function getTextBlockContent(block: Block | null | undefined): InlineNode[] | null {
  return block && (block.type === "paragraph" || block.type === "heading") ? block.content : null;
}

function trimWrappedQuotes(value: string): string {
  return value
    .replace(/^["'`«“”„]+/u, "")
    .replace(/["'`»“”„]+$/u, "")
    .trim();
}

/** The exact phrase an accent suggestion wants bold, or "" when the item carries none. */
export function getAccentPhrase(item: V2ReviewItem): string {
  return trimWrappedQuotes((item.emphasisTarget?.text ?? "").trim());
}

export function getAccentOccurrence(item: V2ReviewItem): number {
  const occurrence = item.emphasisTarget?.occurrence;
  return typeof occurrence === "number" && Number.isFinite(occurrence) ? Math.max(1, Math.floor(occurrence)) : 1;
}

/** Range of the N-th (1-based) occurrence of `phrase` in `text`; occurrences may overlap, as in the classic editor. */
export function findOccurrenceRange(text: string, phrase: string, occurrence = 1): TextRange | null {
  if (!phrase) {
    return null;
  }

  let searchFrom = 0;

  for (let current = 1; current <= occurrence; current += 1) {
    const start = text.indexOf(phrase, searchFrom);

    if (start < 0) {
      return null;
    }

    if (current === occurrence) {
      return { start, end: start + phrase.length };
    }

    searchFrom = start + 1;
  }

  return null;
}

export function resolveAccentRange(text: string, item: V2ReviewItem): TextRange | null {
  return findOccurrenceRange(text, getAccentPhrase(item), getAccentOccurrence(item));
}

/** True when every character of the range is bold already. An empty range is not bold. */
export function isInlineRangeBold(nodes: InlineNode[], start: number, end: number): boolean {
  if (end <= start) {
    return false;
  }

  let consumed = 0;
  let covered = 0;

  for (const node of nodes) {
    const nodeStart = consumed;
    const nodeEnd = nodeStart + node.text.length;
    consumed = nodeEnd;

    const from = Math.max(start, nodeStart);
    const to = Math.min(end, nodeEnd);

    if (from >= to) {
      continue;
    }

    if (!node.bold) {
      return false;
    }

    covered += to - from;
  }

  return covered === end - start;
}

const WORD_CHAR = /[\p{L}\p{N}'’ʼ-]/u;

function isWordChar(char: string | undefined): boolean {
  return Boolean(char && WORD_CHAR.test(char));
}

function countOccurrencesBefore(text: string, phrase: string, start: number): number {
  let count = 0;
  let index = text.indexOf(phrase);

  while (index >= 0 && index < start) {
    count += 1;
    index = text.indexOf(phrase, index + 1);
  }

  return count;
}

/** 1-based ordinal of the occurrence of `phrase` that starts at `start`. */
export function getOccurrenceAt(text: string, phrase: string, start: number): number {
  return countOccurrencesBefore(text, phrase, start) + 1;
}

/**
 * Moves a spelling finding to where its word is after the block was edited.
 *
 * The edit is taken as one changed region between the old and the new text. A finding entirely before or
 * after that region keeps pointing at the same word (shifted when needed). A finding the edit touched, or
 * whose word has grown a letter on either side, cannot be trusted any more: null, and the item goes stale.
 * When the regions overlap only because several places changed at once (a bulk fix), the word is looked up
 * by its ordinal among identical words, and accepted only when that is unambiguous.
 */
export function rebaseSpellRange(spell: V2SpellData, nextText: string): V2SpellData | null {
  const previousText = spell.blockText;

  if (nextText === previousText) {
    return previousText.slice(spell.range.start, spell.range.end) === spell.badText ? spell : null;
  }

  const { start, end } = spell.range;
  const limit = Math.min(previousText.length, nextText.length);
  let prefix = 0;

  while (prefix < limit && previousText[prefix] === nextText[prefix]) {
    prefix += 1;
  }

  let suffix = 0;

  while (
    suffix < limit - prefix &&
    previousText[previousText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const editStart = prefix;
  const editEnd = previousText.length - suffix;
  const delta = nextText.length - previousText.length;
  let candidate: TextRange | null = null;

  if (editEnd <= start) {
    candidate = { start: start + delta, end: end + delta };
  } else if (editStart >= end) {
    candidate = { start, end };
  } else {
    const before = countBoundedOccurrences(previousText, spell.badText);
    const after = listBoundedOccurrences(nextText, spell.badText);
    const ordinal = listBoundedOccurrences(previousText, spell.badText).indexOf(start);

    if (ordinal >= 0 && after.length === before && after[ordinal] !== undefined) {
      candidate = { start: after[ordinal]!, end: after[ordinal]! + spell.badText.length };
    }
  }

  if (!candidate || nextText.slice(candidate.start, candidate.end) !== spell.badText) {
    return null;
  }

  // The word must still be the same word: no letter may have joined it on either side.
  if (
    isWordChar(nextText[candidate.start - 1]) !== isWordChar(previousText[start - 1]) ||
    isWordChar(nextText[candidate.end]) !== isWordChar(previousText[end])
  ) {
    return null;
  }

  return {
    ...spell,
    range: candidate,
    blockText: nextText,
    occurrence: getOccurrenceAt(nextText, spell.badText, candidate.start)
  };
}

function listBoundedOccurrences(text: string, phrase: string): number[] {
  const found: number[] = [];

  if (!phrase) {
    return found;
  }

  let index = text.indexOf(phrase);

  while (index >= 0) {
    if (!isWordChar(text[index - 1]) && !isWordChar(text[index + phrase.length])) {
      found.push(index);
    }

    index = text.indexOf(phrase, index + 1);
  }

  return found;
}

function countBoundedOccurrences(text: string, phrase: string): number {
  return listBoundedOccurrences(text, phrase).length;
}

export function getSpellReplacement(item: V2ReviewItem): string | null {
  const spell = item.spell;

  if (!spell) {
    return null;
  }

  const value = spell.suggestions[spell.choice] ?? spell.suggestions[0];
  return typeof value === "string" && value !== spell.badText ? value : null;
}

/** Identity of a spelling finding across runs: the same word at the same place in the same block. */
export function getSpellKey(item: V2ReviewItem): string {
  return item.spell ? `${item.anchor.blockIds[0] ?? ""}|${item.spell.badText}|${item.spell.occurrence}` : "";
}

/** True when the blocks stand in the manuscript in this order with nothing between them. */
export function isAnchorContiguous(blockOrder: string[], blockIds: string[]): boolean {
  if (blockIds.length <= 1) {
    return blockIds.length === 1 ? blockOrder.includes(blockIds[0]!) : false;
  }

  const first = blockOrder.indexOf(blockIds[0]!);
  return first >= 0 && blockIds.every((blockId, index) => blockOrder[first + index] === blockId);
}

/** True when any occurrence of the phrase in the inline nodes is bold in full. */
export function hasBoldOccurrence(nodes: InlineNode[], phrase: string): boolean {
  if (!phrase) {
    return false;
  }

  const text = getInlineText(nodes);
  let index = text.indexOf(phrase);

  while (index >= 0) {
    if (isInlineRangeBold(nodes, index, index + phrase.length)) {
      return true;
    }

    index = text.indexOf(phrase, index + 1);
  }

  return false;
}

/* ---------- what a kind needs before its result can be shown ---------- */

/** True when the item's result can be drawn from what the item itself carries, with no proposal call. */
export function hasLocalResult(item: V2ReviewItem): boolean {
  switch (getItemKind(item)) {
    case "heading":
      return getHeadingDraft(item) !== null;
    case "accent":
      return getAccentPhrase(item).length > 0;
    case "callout":
      return hasCalloutDraft(item);
    case "spell":
      return true;
    default:
      return false;
  }
}

/** True when showing the item's result takes a call to the proposal endpoint. */
export function needsProposalCall(item: V2ReviewItem): boolean {
  const kind = getItemKind(item);

  if (kind === "replace") {
    return true;
  }

  if (kind === "heading") {
    // Only a heading that never had a title. One whose title the editor emptied is waiting for typing, not
    // for the model: a reply would overwrite what is being typed.
    return !item.subsectionDraft;
  }

  return kind === "callout" && !hasLocalResult(item);
}
