import type { EditorialCalloutKind } from "./review-contract";

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
  return { text, ...marks };
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

export function normalizeInlineNodes(nodes: InlineNode[]): InlineNode[] {
  const normalized: InlineNode[] = [];

  for (const node of nodes) {
    const text = typeof node.text === "string" ? node.text : "";

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
      return [`[callout:${block.kind}] ${getInlineText(block.title)}`, ...block.body.map((paragraph) => getInlineText(paragraph))]
        .filter(Boolean)
        .join("\n");
    case "divider":
      return "---";
    case "table":
      return block.rows.map((row) => row.map((cell) => getInlineText(cell)).join(" | ")).join("\n");
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
