import type { EditorialCalloutDepth, EditorialCalloutKind } from "./review-contract";

export type InlineNode = { text: string; bold?: true; italic?: true; link?: string };

export type ParagraphBlock = { id: string; type: "paragraph"; content: InlineNode[] };
export type HeadingBlock = { id: string; type: "heading"; level: 1 | 2 | 3; content: InlineNode[] };
export type BulletListBlock = { id: string; type: "bullet_list"; items: InlineNode[][] };
export type OrderedListBlock = { id: string; type: "ordered_list"; items: InlineNode[][] };
export type ImageBlock = { id: string; type: "image"; assetId: string; alt: string; caption?: InlineNode[] };
export type CalloutBlock = {
  id: string;
  type: "callout";
  kind: EditorialCalloutKind;
  depth?: EditorialCalloutDepth;
  title: InlineNode[];
  body: InlineNode[][];
};
export type DividerBlock = { id: string; type: "divider" };
export type TableBlock = { id: string; type: "table"; rows: InlineNode[][][] };

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | BulletListBlock
  | OrderedListBlock
  | ImageBlock
  | CalloutBlock
  | DividerBlock
  | TableBlock;

export interface EditorDocument {
  version: 2;
  blocks: Block[];
}

export interface MergeTextBlockResult {
  document: EditorDocument;
  focusBlockId: string;
  focusOffset: number;
}

export interface BlockSelection {
  blockIds: string[];
  anchorBlockId: string | null;
  focusBlockId: string | null;
}

export const EMPTY_BLOCK_SELECTION: BlockSelection = {
  blockIds: [],
  anchorBlockId: null,
  focusBlockId: null
};

export function createInlineText(text: string, marks: Omit<InlineNode, "text"> = {}): InlineNode {
  return { text: sanitizeEditorText(text), ...marks };
}

export function sanitizeEditorText(text: string): string {
  return text
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

export function createBlockId(prefix = "block", suffix?: string): string {
  if (suffix) {
    return `${prefix}-${suffix}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyParagraphBlock(id = createBlockId("p")): ParagraphBlock {
  return {
    id,
    type: "paragraph",
    content: [createInlineText("")]
  };
}

export function cloneInlineNodes(nodes: InlineNode[]): InlineNode[] {
  return nodes.map((node) => ({ ...node }));
}

export function cloneBlock(block: Block): Block {
  switch (block.type) {
    case "paragraph":
      return { ...block, content: cloneInlineNodes(block.content) };
    case "heading":
      return { ...block, content: cloneInlineNodes(block.content) };
    case "bullet_list":
    case "ordered_list":
      return { ...block, items: block.items.map((item) => cloneInlineNodes(item)) };
    case "image":
      return { ...block, caption: block.caption ? cloneInlineNodes(block.caption) : undefined };
    case "callout":
      return {
        ...block,
        title: cloneInlineNodes(block.title),
        body: block.body.map((paragraph) => cloneInlineNodes(paragraph))
      };
    case "divider":
      return { ...block };
    case "table":
      return {
        ...block,
        rows: block.rows.map((row) => row.map((cell) => cloneInlineNodes(cell)))
      };
  }
}

export function cloneEditorDocument(document: EditorDocument): EditorDocument {
  return {
    version: 2,
    blocks: document.blocks.map((block) => cloneBlock(block))
  };
}

export function sanitizeEditorDocumentText(document: EditorDocument): EditorDocument {
  let changed = false;

  const sanitizeInlineNodes = (nodes: InlineNode[] | undefined): InlineNode[] => {
    const hasSourceNodes = Array.isArray(nodes);
    const source = hasSourceNodes ? nodes : [createInlineText("")];
    const sanitized = source.map((node) => ({
      ...(node && typeof node === "object" ? node : {}),
      text: sanitizeEditorText(typeof node?.text === "string" ? node.text : "")
    }));
    const textChanged = sanitized.some((node, index) => node.text !== source[index]?.text);

    if (!hasSourceNodes || sanitized.some((node, index) => node !== source[index] && source[index] == null)) {
      changed = true;
      return normalizeInlineNodes(sanitized);
    }

    if (!textChanged) {
      return source;
    }

    changed = true;
    return normalizeInlineNodes(sanitized);
  };

  const sanitizeText = (text: string): string => {
    const nextText = sanitizeEditorText(text);

    if (nextText !== text) {
      changed = true;
    }

    return nextText;
  };

  const blocks = document.blocks.map((block) => {
    switch (block.type) {
      case "paragraph":
        return { ...block, content: sanitizeInlineNodes(block.content) };
      case "heading":
        return { ...block, content: sanitizeInlineNodes(block.content) };
      case "bullet_list":
      case "ordered_list":
        return { ...block, items: block.items.map((item) => sanitizeInlineNodes(item)) };
      case "image":
        return {
          ...block,
          alt: sanitizeText(block.alt),
          caption: block.caption ? sanitizeInlineNodes(block.caption) : undefined
        };
      case "callout":
        return {
          ...block,
          title: sanitizeInlineNodes(block.title),
          body: block.body.map((paragraph) => sanitizeInlineNodes(paragraph))
        };
      case "table":
        return {
          ...block,
          rows: block.rows.map((row) => row.map((cell) => sanitizeInlineNodes(cell)))
        };
      case "divider":
        return { ...block };
    }
  });

  return changed ? { version: 2, blocks } : document;
}

export function sliceDocumentForBlockRange(
  document: EditorDocument,
  targetBlockIds: string[],
  options?: { before?: number; after?: number }
): EditorDocument {
  if (targetBlockIds.length === 0) {
    return cloneEditorDocument(document);
  }

  const startIndex = getBlockIndex(document, targetBlockIds[0]);
  const endIndex = getBlockIndex(document, targetBlockIds[targetBlockIds.length - 1]);

  if (startIndex < 0 || endIndex < 0) {
    return cloneEditorDocument(document);
  }

  const before = Math.max(0, options?.before ?? 0);
  const after = Math.max(0, options?.after ?? 0);
  const from = Math.max(0, Math.min(startIndex, endIndex) - before);
  const to = Math.min(document.blocks.length, Math.max(startIndex, endIndex) + after + 1);

  return {
    version: 2,
    blocks: document.blocks.slice(from, to).map((block) => cloneBlock(block))
  };
}

export function countTextOccurrencesInDocument(document: EditorDocument, searchText: string): number {
  if (!searchText) {
    return 0;
  }

  return document.blocks.reduce((total, block) => total + countTextOccurrencesInBlock(block, searchText), 0);
}

export function replaceTextInDocument(
  document: EditorDocument,
  searchText: string,
  replacementText: string
): { document: EditorDocument; replacementCount: number; changedBlockIds: string[] } {
  if (!searchText) {
    return {
      document: cloneEditorDocument(document),
      replacementCount: 0,
      changedBlockIds: []
    };
  }

  const changedBlockIds: string[] = [];
  let replacementCount = 0;
  const nextBlocks = document.blocks.map((block) => {
    const result = replaceTextInBlock(block, searchText, replacementText);
    replacementCount += result.replacementCount;

    if (result.replacementCount > 0) {
      changedBlockIds.push(block.id);
    }

    return result.block;
  });

  return {
    document: {
      version: 2,
      blocks: nextBlocks
    },
    replacementCount,
    changedBlockIds
  };
}

export function normalizeInlineNodes(nodes: InlineNode[]): InlineNode[] {
  const normalized: InlineNode[] = [];

  for (const node of nodes) {
    const text = sanitizeEditorText(typeof node.text === "string" ? node.text : "");

    if (!text && normalized.length > 0) {
      continue;
    }

    const previous = normalized[normalized.length - 1];

    if (
      previous &&
      previous.bold === node.bold &&
      previous.italic === node.italic &&
      previous.link === node.link
    ) {
      previous.text += text;
      continue;
    }

    normalized.push({
      text,
      bold: node.bold ? true : undefined,
      italic: node.italic ? true : undefined,
      link: typeof node.link === "string" && node.link.trim() ? node.link.trim() : undefined
    });
  }

  if (normalized.length === 0) {
    return [createInlineText("")];
  }

  return normalized;
}

export function getInlineText(nodes: InlineNode[] | undefined): string {
  return (nodes ?? []).map((node) => node.text).join("");
}

export function getBlockText(block: Block): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return getInlineText(block.content);
    case "bullet_list":
    case "ordered_list":
      return block.items.map((item) => getInlineText(item)).join("\n");
    case "image":
      return [block.alt, getInlineText(block.caption)].filter(Boolean).join("\n");
    case "callout":
      return [getInlineText(block.title), ...block.body.map((part) => getInlineText(part))].filter(Boolean).join("\n");
    case "divider":
      return "";
    case "table":
      return block.rows.map((row) => row.map((cell) => getInlineText(cell)).join(" | ")).join("\n");
  }
}

function countTextOccurrencesInBlock(block: Block, searchText: string): number {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return countTextOccurrencesInInlineNodes(block.content, searchText);
    case "bullet_list":
    case "ordered_list":
      return block.items.reduce((total, item) => total + countTextOccurrencesInInlineNodes(item, searchText), 0);
    case "image":
      return countLiteralOccurrences(block.alt, searchText) + countTextOccurrencesInInlineNodes(block.caption ?? [], searchText);
    case "callout":
      return countTextOccurrencesInInlineNodes(block.title, searchText)
        + block.body.reduce((total, paragraph) => total + countTextOccurrencesInInlineNodes(paragraph, searchText), 0);
    case "divider":
      return 0;
    case "table":
      return block.rows.reduce(
        (rowTotal, row) => rowTotal + row.reduce((cellTotal, cell) => cellTotal + countTextOccurrencesInInlineNodes(cell, searchText), 0),
        0
      );
  }
}

function replaceTextInBlock(block: Block, searchText: string, replacementText: string): { block: Block; replacementCount: number } {
  switch (block.type) {
    case "paragraph": {
      const result = replaceTextInInlineNodes(block.content, searchText, replacementText);
      return { block: result.replacementCount > 0 ? { ...block, content: result.nodes } : block, replacementCount: result.replacementCount };
    }
    case "heading": {
      const result = replaceTextInInlineNodes(block.content, searchText, replacementText);
      return { block: result.replacementCount > 0 ? { ...block, content: result.nodes } : block, replacementCount: result.replacementCount };
    }
    case "bullet_list": {
      let replacementCount = 0;
      const nextItems = block.items.map((item) => {
        const result = replaceTextInInlineNodes(item, searchText, replacementText);
        replacementCount += result.replacementCount;
        return result.nodes;
      });
      return { block: replacementCount > 0 ? { ...block, items: nextItems } : block, replacementCount };
    }
    case "ordered_list": {
      let replacementCount = 0;
      const nextItems = block.items.map((item) => {
        const result = replaceTextInInlineNodes(item, searchText, replacementText);
        replacementCount += result.replacementCount;
        return result.nodes;
      });
      return { block: replacementCount > 0 ? { ...block, items: nextItems } : block, replacementCount };
    }
    case "image": {
      const altResult = replaceLiteralText(block.alt, searchText, replacementText);
      const captionResult = replaceTextInInlineNodes(block.caption ?? [], searchText, replacementText);
      const replacementCount = altResult.replacementCount + captionResult.replacementCount;

      if (replacementCount === 0) {
        return { block, replacementCount: 0 };
      }

      return {
        block: {
          ...block,
          alt: altResult.text,
          caption: block.caption ? captionResult.nodes : block.caption
        },
        replacementCount
      };
    }
    case "callout": {
      const titleResult = replaceTextInInlineNodes(block.title, searchText, replacementText);
      let replacementCount = titleResult.replacementCount;
      const nextBody = block.body.map((paragraph) => {
        const result = replaceTextInInlineNodes(paragraph, searchText, replacementText);
        replacementCount += result.replacementCount;
        return result.nodes;
      });

      return {
        block: replacementCount > 0 ? { ...block, title: titleResult.nodes, body: nextBody } : block,
        replacementCount
      };
    }
    case "divider":
      return { block, replacementCount: 0 };
    case "table": {
      let replacementCount = 0;
      const nextRows = block.rows.map((row) =>
        row.map((cell) => {
          const result = replaceTextInInlineNodes(cell, searchText, replacementText);
          replacementCount += result.replacementCount;
          return result.nodes;
        })
      );

      return {
        block: replacementCount > 0 ? { ...block, rows: nextRows } : block,
        replacementCount
      };
    }
  }
}

function countTextOccurrencesInInlineNodes(nodes: InlineNode[], searchText: string): number {
  return nodes.reduce((total, node) => total + countLiteralOccurrences(node.text, searchText), 0);
}

function replaceTextInInlineNodes(
  nodes: InlineNode[],
  searchText: string,
  replacementText: string
): { nodes: InlineNode[]; replacementCount: number } {
  let replacementCount = 0;
  const nextNodes = nodes.map((node) => {
    const result = replaceLiteralText(node.text, searchText, replacementText);
    replacementCount += result.replacementCount;
    return result.replacementCount > 0 ? { ...node, text: result.text } : node;
  });

  return {
    nodes: replacementCount > 0 ? normalizeInlineNodes(nextNodes) : cloneInlineNodes(nodes),
    replacementCount
  };
}

function replaceLiteralText(text: string, searchText: string, replacementText: string): { text: string; replacementCount: number } {
  const replacementCount = countLiteralOccurrences(text, searchText);

  if (replacementCount === 0) {
    return { text, replacementCount: 0 };
  }

  return {
    text: text.split(searchText).join(replacementText),
    replacementCount
  };
}

function countLiteralOccurrences(text: string, searchText: string): number {
  if (!searchText) {
    return 0;
  }

  let count = 0;
  let index = 0;

  while (index <= text.length - searchText.length) {
    const nextIndex = text.indexOf(searchText, index);

    if (nextIndex < 0) {
      break;
    }

    count += 1;
    index = nextIndex + searchText.length;
  }

  return count;
}

export function isTextBlock(block: Block): block is ParagraphBlock | HeadingBlock {
  return block.type === "paragraph" || block.type === "heading";
}

export function isListBlock(block: Block): block is BulletListBlock | OrderedListBlock {
  return block.type === "bullet_list" || block.type === "ordered_list";
}

export function getBlockIndex(document: EditorDocument, blockId: string | null | undefined): number {
  if (!blockId) {
    return -1;
  }

  return document.blocks.findIndex((block) => block.id === blockId);
}

export function getBlock(document: EditorDocument, blockId: string | null | undefined): Block | null {
  const index = getBlockIndex(document, blockId);
  return index >= 0 ? document.blocks[index] : null;
}

export function normalizeBlockSelection(document: EditorDocument, selection: BlockSelection | null | undefined): BlockSelection {
  if (!selection) {
    return EMPTY_BLOCK_SELECTION;
  }

  const allowedIds = new Set(document.blocks.map((block) => block.id));
  const blockIds = selection.blockIds.filter((id) => allowedIds.has(id));
  const anchorBlockId = selection.anchorBlockId && allowedIds.has(selection.anchorBlockId) ? selection.anchorBlockId : blockIds[0] ?? null;
  const focusBlockId = selection.focusBlockId && allowedIds.has(selection.focusBlockId) ? selection.focusBlockId : blockIds[blockIds.length - 1] ?? null;

   if (blockIds.length === 0 && anchorBlockId && focusBlockId) {
    const contiguousBlockIds = getContiguousBlockIds(document, anchorBlockId, focusBlockId);

    return {
      blockIds: contiguousBlockIds,
      anchorBlockId: contiguousBlockIds[0] ?? null,
      focusBlockId: contiguousBlockIds[contiguousBlockIds.length - 1] ?? null
    };
  }

  if (blockIds.length === 0) {
    return EMPTY_BLOCK_SELECTION;
  }

  const contiguousBlockIds = getContiguousBlockIds(document, anchorBlockId ?? blockIds[0], focusBlockId ?? blockIds[blockIds.length - 1]);

  return {
    blockIds: contiguousBlockIds,
    anchorBlockId: contiguousBlockIds[0] ?? null,
    focusBlockId: contiguousBlockIds[contiguousBlockIds.length - 1] ?? null
  };
}

export function hasSelectedBlocks(selection: BlockSelection | null | undefined): boolean {
  return Boolean(selection?.blockIds.length);
}

export function getContiguousBlockIds(document: EditorDocument, startBlockId: string, endBlockId: string): string[] {
  const startIndex = getBlockIndex(document, startBlockId);
  const endIndex = getBlockIndex(document, endBlockId);

  if (startIndex < 0 || endIndex < 0) {
    return [];
  }

  const from = Math.min(startIndex, endIndex);
  const to = Math.max(startIndex, endIndex);
  return document.blocks.slice(from, to + 1).map((block) => block.id);
}

export function getSelectedBlocks(document: EditorDocument, selection: BlockSelection | null | undefined): Block[] {
  const normalized = normalizeBlockSelection(document, selection);
  return normalized.blockIds.map((blockId) => getBlock(document, blockId)).filter((block): block is Block => Boolean(block));
}

export function documentToPlainText(document: EditorDocument): string {
  return document.blocks
    .map((block) => blockToPromptText(block))
    .filter(Boolean)
    .join("\n\n");
}

export interface DocumentTextStats {
  words: number;
  charactersWithSpaces: number;
}

export function getDocumentTextStats(document: EditorDocument): DocumentTextStats {
  const text = document.blocks
    .map((block) => blockToVisibleText(block))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return {
      words: 0,
      charactersWithSpaces: 0
    };
  }

  return {
    words: Array.from(text.matchAll(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu)).length,
    charactersWithSpaces: text.length
  };
}

export function convertBlockToListBlock(block: Block, type: "bullet_list" | "ordered_list"): BulletListBlock | OrderedListBlock {
  const sourceItems =
    block.type === "bullet_list" || block.type === "ordered_list"
      ? block.items.map((item) => sanitizeListItemInlineNodes(item))
      : splitInlineNodesIntoListItems(blockToEditableInlineNodes(block));

  return {
    id: block.id,
    type,
    items: sourceItems.length > 0 ? sourceItems : [[createInlineText("")]]
  };
}

export function convertBlockToParagraphBlock(block: Block): ParagraphBlock {
  return {
    id: block.id,
    type: "paragraph",
    content: normalizeInlineNodes(blockToEditableInlineNodes(block))
  };
}

export function convertBlockToHeadingBlock(block: Block, level: 1 | 2 | 3): HeadingBlock {
  return {
    id: block.id,
    type: "heading",
    level,
    content: normalizeInlineNodes(blockToEditableInlineNodes(block))
  };
}

function splitInlineNodesIntoListItems(nodes: InlineNode[]): InlineNode[][] {
  const items: InlineNode[][] = [];
  let current: InlineNode[] = [];

  const pushCurrent = () => {
    const item = sanitizeListItemInlineNodes(current);
    current = [];

    if (item.some((node) => node.text.trim())) {
      items.push(item);
    }
  };

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex]!;
    const text = node.text ?? "";

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]!;
      const nextChar = text[index + 1] ?? "";

      if (char === "\n") {
        pushCurrent();
        while (text[index + 1] === "\n") {
          index += 1;
        }
        continue;
      }

      current.push({ ...node, text: char });

      if (/[.;!?]/u.test(char) && /\s/u.test(nextChar) && !/^\s*\d+[.)]$/u.test(getInlineText(current))) {
        pushCurrent();

        while (/\s/u.test(text[index + 1] ?? "")) {
          index += 1;
        }
      }
    }
  }

  pushCurrent();
  return items;
}

function blockToEditableInlineNodes(block: Block): InlineNode[] {
  if (block.type === "paragraph" || block.type === "heading") {
    return block.content;
  }

  if (block.type === "bullet_list" || block.type === "ordered_list") {
    return block.items.flatMap((item, index) => (index === 0 ? item : [createInlineText("\n"), ...item]));
  }

  return [createInlineText(blockToVisibleText(block))];
}

function sanitizeListItemInlineNodes(nodes: InlineNode[]): InlineNode[] {
  const trimmed = trimInlineNodes(nodes);
  const text = getInlineText(trimmed);
  const markerMatch = /^\s*(?:[-*•]|\d+[.)])\s+/u.exec(text);
  const withoutMarker = markerMatch ? removeInlinePrefix(trimmed, markerMatch[0].length) : trimmed;
  return normalizeInlineNodes(trimInlineNodes(withoutMarker));
}

function trimInlineNodes(nodes: InlineNode[]): InlineNode[] {
  const normalized = normalizeInlineNodes(nodes);
  const text = getInlineText(normalized);
  const leadingLength = text.length - text.trimStart().length;
  const trailingLength = text.length - text.trimEnd().length;
  const withoutLeading = removeInlinePrefix(normalized, leadingLength);
  return removeInlineSuffix(withoutLeading, trailingLength);
}

function removeInlinePrefix(nodes: InlineNode[], length: number): InlineNode[] {
  if (length <= 0) {
    return nodes;
  }

  let remaining = length;
  const result: InlineNode[] = [];

  for (const node of nodes) {
    if (remaining >= node.text.length) {
      remaining -= node.text.length;
      continue;
    }

    result.push({
      ...node,
      text: node.text.slice(remaining)
    });
    remaining = 0;
  }

  return result;
}

function removeInlineSuffix(nodes: InlineNode[], length: number): InlineNode[] {
  if (length <= 0) {
    return nodes;
  }

  let remaining = length;
  const result: InlineNode[] = [];

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;

    if (remaining >= node.text.length) {
      remaining -= node.text.length;
      continue;
    }

    result.unshift({
      ...node,
      text: node.text.slice(0, node.text.length - remaining)
    });
    remaining = 0;
  }

  return result;
}

export function selectedBlocksToPromptText(document: EditorDocument, blockIds: string[]): string {
  return blockIds
    .map((blockId) => getBlock(document, blockId))
    .filter((block): block is Block => Boolean(block))
    .map((block) => blockToPromptText(block))
    .filter(Boolean)
    .join("\n\n");
}

export function blockToPromptText(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return getInlineText(block.content);
    case "heading":
      return `${"#".repeat(block.level)} ${getInlineText(block.content)}`.trim();
    case "bullet_list":
      return block.items.map((item) => `- ${getInlineText(item)}`).join("\n");
    case "ordered_list":
      return block.items.map((item, index) => `${index + 1}. ${getInlineText(item)}`).join("\n");
    case "image":
      return `[image] alt: ${block.alt}${block.caption ? `; caption: ${getInlineText(block.caption)}` : ""}`;
    case "callout":
      return [`[callout:${block.kind}:${block.depth ?? "brief"}] ${getInlineText(block.title)}`, ...block.body.map((paragraph) => getInlineText(paragraph))]
        .filter(Boolean)
        .join("\n");
    case "divider":
      return "---";
    case "table":
      return block.rows.map((row) => row.map((cell) => getInlineText(cell)).join(" | ")).join("\n");
  }
}

function blockToVisibleText(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return getInlineText(block.content);
    case "heading":
      return getInlineText(block.content);
    case "bullet_list":
    case "ordered_list":
      return block.items.map((item) => getInlineText(item)).join(" ");
    case "image":
      return [block.alt, block.caption ? getInlineText(block.caption) : ""].filter(Boolean).join(" ");
    case "callout":
      return [getInlineText(block.title), ...block.body.map((paragraph) => getInlineText(paragraph))].filter(Boolean).join(" ");
    case "divider":
      return "";
    case "table":
      return block.rows.map((row) => row.map((cell) => getInlineText(cell)).join(" ")).join(" ");
  }
}

export function replaceBlocksByIds(document: EditorDocument, blockIds: string[], newBlocks: Block[]): EditorDocument {
  if (blockIds.length === 0) {
    return document;
  }

  const startIndex = getBlockIndex(document, blockIds[0]);
  const endIndex = getBlockIndex(document, blockIds[blockIds.length - 1]);

  if (startIndex < 0 || endIndex < 0) {
    return document;
  }

  const preservedIds = blockIds.slice();
  const normalizedNewBlocks = newBlocks.map((block, index) => {
    const next = cloneBlock(block);
    next.id = preservedIds[index] ?? next.id ?? createBlockId("block");
    return next;
  });

  return {
    version: 2,
    blocks: [...document.blocks.slice(0, startIndex), ...normalizedNewBlocks, ...document.blocks.slice(endIndex + 1)]
  };
}

export function insertBlocksAfter(document: EditorDocument, anchorBlockId: string | null, newBlocks: Block[]): EditorDocument {
  if (newBlocks.length === 0) {
    return document;
  }

  if (!anchorBlockId) {
    return {
      version: 2,
      blocks: [...newBlocks.map((block) => cloneBlock(block)), ...document.blocks]
    };
  }

  const anchorIndex = getBlockIndex(document, anchorBlockId);

  if (anchorIndex < 0) {
    return {
      version: 2,
      blocks: [...document.blocks, ...newBlocks.map((block) => cloneBlock(block))]
    };
  }

  return {
    version: 2,
    blocks: [...document.blocks.slice(0, anchorIndex + 1), ...newBlocks.map((block) => cloneBlock(block)), ...document.blocks.slice(anchorIndex + 1)]
  };
}

export function removeBlocksByIds(document: EditorDocument, blockIds: string[]): EditorDocument {
  if (blockIds.length === 0) {
    return document;
  }

  const blocked = new Set(blockIds);
  const blocks = document.blocks.filter((block) => !blocked.has(block.id));
  return {
    version: 2,
    blocks: blocks.length > 0 ? blocks : [createEmptyParagraphBlock()]
  };
}

export function mergeTextBlockIntoPrevious(document: EditorDocument, blockId: string): MergeTextBlockResult | null {
  const blockIndex = getBlockIndex(document, blockId);

  if (blockIndex <= 0) {
    return null;
  }

  const previousBlock = document.blocks[blockIndex - 1];
  const currentBlock = document.blocks[blockIndex];

  if (
    !previousBlock ||
    !currentBlock ||
    !isTextBlock(previousBlock) ||
    !isTextBlock(currentBlock) ||
    previousBlock.type !== currentBlock.type
  ) {
    return null;
  }

  const focusOffset = getInlineText(previousBlock.content).length;
  const mergedPreviousBlock = {
    ...previousBlock,
    content: normalizeInlineNodes([...cloneInlineNodes(previousBlock.content), ...cloneInlineNodes(currentBlock.content)])
  };
  const nextBlocks = [...document.blocks];
  nextBlocks[blockIndex - 1] = mergedPreviousBlock;
  nextBlocks.splice(blockIndex, 1);

  return {
    document: {
      version: 2,
      blocks: nextBlocks
    },
    focusBlockId: previousBlock.id,
    focusOffset
  };
}

export function ensureDocumentHasBlocks(document: EditorDocument): EditorDocument {
  if (document.blocks.length > 0) {
    return document;
  }

  return {
    version: 2,
    blocks: [createEmptyParagraphBlock()]
  };
}
