import type { ManuscriptRevisionState } from "./manuscript-structure";
import { resolveReviewImageAssetUrl, type EditorialReviewItem, type GeneratedReviewImageAsset } from "./review-contract";

interface ResolvedInsertionAnchor {
  index: number;
  paragraphId: string;
}

export interface InsertReviewImageMarkdownRequest {
  text: string;
  revision: ManuscriptRevisionState;
  item: Pick<EditorialReviewItem, "anchor" | "insertionPoint">;
  alt: string;
  caption?: string;
  asset: GeneratedReviewImageAsset;
}

export interface InsertReviewImageMarkdownResult {
  ok: boolean;
  text: string;
  inserted: boolean;
  insertedBlock: string;
  insertionIndex: number;
  cursorOffset: number;
  reason?: string;
}

export function insertReviewImageMarkdown(request: InsertReviewImageMarkdownRequest): InsertReviewImageMarkdownResult {
  const anchor = resolveInsertionAnchor(request.revision, request.item);

  if (!anchor) {
    return {
      ok: false,
      inserted: false,
      text: request.text,
      insertedBlock: "",
      insertionIndex: -1,
      cursorOffset: -1,
      reason: "Не знайдено стабільний anchor для вставки зображення."
    };
  }

  const markdownBlock = buildReviewImageMarkdownBlock(request.alt, request.caption, request.asset);

  if (!markdownBlock) {
    return {
      ok: false,
      inserted: false,
      text: request.text,
      insertedBlock: "",
      insertionIndex: anchor.index,
      cursorOffset: anchor.index,
      reason: "Не вдалося зібрати markdown-блок зображення."
    };
  }

  const nearAnchor = request.text.slice(Math.max(0, anchor.index - markdownBlock.length - 10), Math.min(request.text.length, anchor.index + markdownBlock.length + 10));

  if (nearAnchor.includes(markdownBlock)) {
    return {
      ok: true,
      inserted: false,
      text: request.text,
      insertedBlock: markdownBlock,
      insertionIndex: anchor.index,
      cursorOffset: anchor.index
    };
  }

  const insertedText = insertStandaloneMarkdownBlock(request.text, anchor.index, markdownBlock);
  const insertedIndex = insertedText.indexOf(markdownBlock, Math.max(0, anchor.index - 4));
  const cursorOffset = insertedIndex >= 0 ? insertedIndex + markdownBlock.length : anchor.index + markdownBlock.length;

  return {
    ok: true,
    inserted: true,
    text: insertedText,
    insertedBlock: markdownBlock,
    insertionIndex: insertedIndex >= 0 ? insertedIndex : anchor.index,
    cursorOffset
  };
}

export function buildReviewImageMarkdownBlock(alt: string, caption: string | undefined, asset: GeneratedReviewImageAsset): string | null {
  const sourceUrl = resolveReviewImageAssetUrl(asset);

  if (!sourceUrl) {
    return null;
  }

  const safeAlt = sanitizeAltText(alt);
  const safeCaption = sanitizeCaption(caption);
  const lines = [`![${safeAlt}](${sourceUrl})`];

  if (safeCaption) {
    lines.push(safeCaption);
  }

  return lines.join("\n");
}

function resolveInsertionAnchor(
  revision: ManuscriptRevisionState,
  item: Pick<EditorialReviewItem, "anchor" | "insertionPoint">
): ResolvedInsertionAnchor | null {
  const insertionAnchorId =
    item.insertionPoint.anchorParagraphId ||
    item.anchor.paragraphIds[item.anchor.paragraphIds.length - 1] ||
    item.anchor.paragraphIds[0];
  const insertionAnchorParagraph = insertionAnchorId ? revision.paragraphsById[insertionAnchorId] : undefined;
  const anchoredParagraphs = item.anchor.paragraphIds
    .map((id) => ({ id, paragraph: revision.paragraphsById[id] }))
    .filter((entry): entry is { id: string; paragraph: NonNullable<typeof entry.paragraph> } => Boolean(entry.paragraph))
    .sort((left, right) => left.paragraph.start - right.paragraph.start);

  if (!insertionAnchorParagraph && anchoredParagraphs.length === 0) {
    return null;
  }

  if (item.insertionPoint.mode === "before" && insertionAnchorParagraph) {
    return { index: insertionAnchorParagraph.start, paragraphId: insertionAnchorId };
  }

  if (item.insertionPoint.mode === "replace" && anchoredParagraphs.length > 0) {
    return {
      index: anchoredParagraphs[anchoredParagraphs.length - 1].paragraph.end,
      paragraphId: anchoredParagraphs[anchoredParagraphs.length - 1].id
    };
  }

  if (insertionAnchorParagraph) {
    return { index: insertionAnchorParagraph.end, paragraphId: insertionAnchorId };
  }

  return {
    index: anchoredParagraphs[anchoredParagraphs.length - 1].paragraph.end,
    paragraphId: anchoredParagraphs[anchoredParagraphs.length - 1].id
  };
}

function sanitizeAltText(value: string): string {
  const normalized = value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .trim();

  return normalized || "Чернеткова ілюстрація";
}

function sanitizeCaption(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function insertStandaloneMarkdownBlock(text: string, insertionIndex: number, block: string): string {
  const before = text.slice(0, insertionIndex);
  const after = text.slice(insertionIndex);
  const prefix =
    before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const suffix =
    after.length === 0 ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";

  return `${before}${prefix}${block}${suffix}${after}`;
}
