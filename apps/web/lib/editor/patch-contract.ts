import type { Block, BlockSelection, EditorDocument, InlineNode } from "./document-model";
import {
  cloneBlock,
  cloneEditorDocument,
  createInlineText,
  getBlock,
  getBlockText,
  getContiguousBlockIds,
  getInlineText,
  hasSelectedBlocks,
  normalizeBlockSelection,
  replaceBlocksByIds
} from "./document-model";

export type PatchOperationKind = "replace_blocks";
export type PatchOperationType = "clarity" | "structure" | "terminology" | "source" | "tone";
export type RequestMode = "default" | "custom";
export type PatchSelection = BlockSelection;

export interface PatchOperation {
  id: string;
  op: PatchOperationKind;
  blockIds: string[];
  oldBlocks: Block[];
  newBlocks: Block[];
  reason: string;
  type: PatchOperationType;
  reviewContext?: {
    recommendation: string;
    reason?: string;
    paragraphLabel?: string;
    sourceReviewItemId?: string;
  };
}

export interface PatchRequest {
  document: EditorDocument;
  targetBlockIds: string[];
  mode: RequestMode;
  prompt?: string;
  provider: string;
  modelId: string;
  apiKey?: string;
  basePrompt?: string;
}

export interface PatchResponseDiagnostics {
  requestId: string;
  requestedProvider: string;
  requestedModelId: string;
  appliedMode: RequestMode;
  targetBlockCount: number;
  returnedOperationCount: number;
  droppedOperationCount: number;
  generatedAt: string;
  rawOutput?: string;
  rawError?: string;
}

export interface PatchResponse {
  operations: PatchOperation[];
  providerUsed: string;
  usedFallback: boolean;
  error?: string;
  diagnostics: PatchResponseDiagnostics;
}

export interface NormalizedPatchOperationsResult {
  operations: PatchOperation[];
  droppedCount: number;
}

export const PATCH_OPERATION_TYPES: PatchOperationType[] = ["clarity", "structure", "terminology", "source", "tone"];
export const PATCH_OPERATION_KINDS: PatchOperationKind[] = ["replace_blocks"];

export function createPatchId(prefix = "patch"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function hasSelection(selection: PatchSelection | null | undefined): boolean {
  return hasSelectedBlocks(selection);
}

export function normalizePatchSelection(document: EditorDocument, selection: PatchSelection | null | undefined): PatchSelection {
  return normalizeBlockSelection(document, selection);
}

export function getSelectedBlocks(document: EditorDocument, selection: PatchSelection): Block[] {
  return normalizePatchSelection(document, selection)
    .blockIds.map((blockId) => getBlock(document, blockId))
    .filter((block): block is Block => Boolean(block))
    .map((block) => cloneBlock(block));
}

export function getSelectedText(document: EditorDocument, selection: PatchSelection): string {
  return getSelectedBlocks(document, selection)
    .map((block) => getBlockText(block))
    .join("\n\n");
}

export function getOperationReplacementText(operation: PatchOperation): string {
  return operation.newBlocks.map((block) => getBlockText(block)).join("\n\n");
}

export function isPatchOperationApplicable(document: EditorDocument, operation: PatchOperation): boolean {
  if (operation.blockIds.length === 0) {
    return false;
  }

  const actualBlockIds = getContiguousBlockIds(document, operation.blockIds[0], operation.blockIds[operation.blockIds.length - 1]);

  if (actualBlockIds.join("|") !== operation.blockIds.join("|")) {
    return false;
  }

  return actualBlockIds.every((blockId, index) => {
    const current = getBlock(document, blockId);
    const expected = operation.oldBlocks[index];
    return Boolean(current && expected && JSON.stringify(stripIds(current)) === JSON.stringify(stripIds(expected)));
  });
}

export function getApplicablePatchOperations(document: EditorDocument, operations: PatchOperation[]): PatchOperation[] {
  return operations.filter((operation) => isPatchOperationApplicable(document, operation));
}

export function applyPatchOperation(document: EditorDocument, operation: PatchOperation): EditorDocument {
  if (!isPatchOperationApplicable(document, operation)) {
    return document;
  }

  const nextBlocks = preserveFormattingForPatch(operation.oldBlocks, operation.newBlocks);
  return replaceBlocksByIds(document, operation.blockIds, nextBlocks);
}

export function applyPatchOperations(document: EditorDocument, operations: PatchOperation[]): EditorDocument {
  return getApplicablePatchOperations(document, operations).reduce((current, operation) => applyPatchOperation(current, operation), cloneEditorDocument(document));
}

export function operationsOverlap(left: PatchOperation, right: PatchOperation): boolean {
  const leftIds = new Set(left.blockIds);
  return right.blockIds.some((blockId) => leftIds.has(blockId));
}

export function rebasePendingOperations(operations: PatchOperation[], appliedOperation: PatchOperation): PatchOperation[] {
  return operations.filter((operation) => operation.id !== appliedOperation.id && !operationsOverlap(operation, appliedOperation));
}

function normalizePatchType(type: unknown): PatchOperationType {
  return PATCH_OPERATION_TYPES.includes(type as PatchOperationType) ? (type as PatchOperationType) : "clarity";
}

function normalizeReason(reason: unknown): string | null {
  if (typeof reason !== "string") {
    return null;
  }

  const normalized = reason.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 160) : null;
}

export function normalizePatchOperationsResult(
  document: EditorDocument,
  targetBlockIds: string[],
  operations: unknown
): NormalizedPatchOperationsResult {
  if (!Array.isArray(operations)) {
    return { operations: [], droppedCount: 0 };
  }

  const targetIds = getContiguousTargetIds(document, targetBlockIds);
  const normalized: PatchOperation[] = [];
  let droppedCount = 0;

  for (const [index, candidate] of operations.entries()) {
    if (!candidate || typeof candidate !== "object") {
      droppedCount += 1;
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const operationOldBlocks = targetIds.map((blockId) => getBlock(document, blockId)).filter((block): block is Block => Boolean(block));
    const reason = normalizeReason(record.reason) ?? "Покращено читабельність і ясність фрагмента.";
    const newBlocks = Array.isArray(record.newBlocks)
      ? normalizeUnknownBlocks(record.newBlocks)
      : normalizeLooseReplacementBlocks(record, operationOldBlocks);

    if (operationOldBlocks.length === 0 || newBlocks.length === 0) {
      droppedCount += 1;
      continue;
    }

    normalized.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id : createPatchId(`provider-${index + 1}`),
      op: "replace_blocks",
      blockIds: targetIds,
      oldBlocks: operationOldBlocks.map((block) => cloneBlock(block)),
      newBlocks,
      reason,
      type: normalizePatchType(record.type)
    });
  }

  return {
    operations: dedupePatchOperations(normalized),
    droppedCount
  };
}

export function normalizePatchOperations(document: EditorDocument, targetBlockIds: string[], operations: unknown): PatchOperation[] {
  return normalizePatchOperationsResult(document, targetBlockIds, operations).operations;
}

function dedupePatchOperations(operations: PatchOperation[]): PatchOperation[] {
  const deduped: PatchOperation[] = [];

  for (const operation of operations) {
    if (deduped.some((existing) => operationsOverlap(existing, operation))) {
      continue;
    }

    deduped.push(operation);
  }

  return deduped;
}

function stripIds(block: Block): Omit<Block, "id"> {
  const { id: _id, ...rest } = block;
  return rest;
}

function getContiguousTargetIds(document: EditorDocument, blockIds: string[]): string[] {
  if (blockIds.length === 0) {
    return [];
  }

  return getContiguousBlockIds(document, blockIds[0], blockIds[blockIds.length - 1]);
}

function normalizeUnknownBlocks(blocks: unknown[]): Block[] {
  const normalized: Block[] = [];

  for (const block of blocks) {
    const next = normalizeUnknownBlock(block);

    if (next) {
      normalized.push(next);
    }
  }

  return normalized;
}

function normalizeUnknownBlock(block: unknown): Block | null {
  if (typeof block === "string") {
    return buildParagraphBlockFromText(block);
  }

  if (!block || typeof block !== "object") {
    return null;
  }

  const record = block as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id : createPatchId("block");
  const type = record.type;
  const looseText = extractLooseReplacementText(record);

  if (type === "paragraph") {
    return { id, type, content: normalizeInlineArrayOrText(record.content ?? record.nodes ?? record.inline, record) };
  }

  if (type === "heading") {
    const level = record.level === 1 || record.level === 2 || record.level === 3 ? record.level : 2;
    return { id, type, level, content: normalizeInlineArrayOrText(record.content ?? record.nodes ?? record.inline, record) };
  }

  if (type === "bullet_list" || type === "ordered_list") {
    const items = Array.isArray(record.items) ? record.items.map((item) => normalizeInlineArray(item)).filter((item) => item.length > 0) : [];
    return items.length > 0 ? { id, type, items } : null;
  }

  if (type === "image") {
    return {
      id,
      type,
      assetId: typeof record.assetId === "string" ? record.assetId : "",
      alt: typeof record.alt === "string" ? record.alt : "",
      caption: Array.isArray(record.caption) ? normalizeInlineArray(record.caption) : undefined
    };
  }

  if (type === "callout") {
    const kind = typeof record.kind === "string" ? record.kind : "mechanism";
    const body = Array.isArray(record.body) ? record.body.map((part) => normalizeInlineArray(part)) : [];
    return {
      id,
      type,
      kind: kind as never,
      title: normalizeInlineArray(record.title),
      body
    };
  }

  if (type === "divider") {
    return { id, type };
  }

  if (type === "table") {
    const rows = Array.isArray(record.rows)
      ? record.rows.map((row) => (Array.isArray(row) ? row.map((cell) => normalizeInlineArray(cell)) : [])).filter((row) => row.length > 0)
      : [];
    return rows.length > 0 ? { id, type, rows } : null;
  }

  if (looseText) {
    return buildParagraphBlockFromText(looseText);
  }

  return null;
}

function normalizeInlineArray(value: unknown): InlineNode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const nodes: InlineNode[] = [];

  for (const node of value) {
    if (!node || typeof node !== "object") {
      continue;
    }

    const record = node as Record<string, unknown>;
    nodes.push({
      text: typeof record.text === "string" ? record.text : "",
      bold: record.bold ? true : undefined,
      italic: record.italic ? true : undefined,
      link: typeof record.link === "string" && record.link.trim() ? record.link.trim() : undefined
    });
  }

  return nodes.length > 0 ? nodes : [];
}

function normalizeInlineArrayFromTextFields(record: Record<string, unknown>): InlineNode[] {
  const text = extractLooseReplacementText(record);
  return text ? [createInlineText(text)] : [createInlineText("")];
}

function normalizeInlineArrayOrText(value: unknown, record: Record<string, unknown>): InlineNode[] {
  const normalized = normalizeInlineArray(value);
  return normalized.length > 0 ? normalized : normalizeInlineArrayFromTextFields(record);
}

function normalizeLooseReplacementBlocks(record: Record<string, unknown>, oldBlocks: Block[]): Block[] {
  const text = extractLooseReplacementText(record);

  if (!text) {
    return [];
  }

  return buildBlocksFromPlainText(text, oldBlocks);
}

function extractLooseReplacementText(record: Record<string, unknown>): string | null {
  const candidates = [record.newText, record.replacement, record.rewrittenText, record.replacementText, record.text, record.content];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const normalized = candidate.trim();

      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function buildBlocksFromPlainText(text: string, oldBlocks: Block[]): Block[] {
  const normalizedText = text.replace(/\r\n?/g, "\n").trim();

  if (!normalizedText) {
    return oldBlocks.length > 0 ? oldBlocks.map((block) => buildLikeBlock(block, "")) : [buildParagraphBlockFromText("")];
  }

  if (looksLikeBulletList(normalizedText)) {
    return [
      {
        id: createPatchId("block"),
        type: "bullet_list",
        items: normalizedText
          .split(/\n+/)
          .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
          .filter(Boolean)
          .map((line) => [createInlineText(line)])
      }
    ];
  }

  if (looksLikeOrderedList(normalizedText)) {
    return [
      {
        id: createPatchId("block"),
        type: "ordered_list",
        items: normalizedText
          .split(/\n+/)
          .map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim())
          .filter(Boolean)
          .map((line) => [createInlineText(line)])
      }
    ];
  }

  const paragraphs = normalizedText.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);

  if (oldBlocks.length === 1 && paragraphs.length === 1) {
    return [buildLikeBlock(oldBlocks[0], paragraphs[0])];
  }

  return paragraphs.map((paragraph, index) => buildLikeBlock(oldBlocks[index], paragraph));
}

function buildLikeBlock(oldBlock: Block | undefined, text: string): Block {
  if (oldBlock?.type === "heading") {
    return { id: createPatchId("block"), type: "heading", level: oldBlock.level, content: [createInlineText(text)] };
  }

  if (oldBlock?.type === "bullet_list") {
    return {
      id: createPatchId("block"),
      type: "bullet_list",
      items: text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => [createInlineText(line)])
    };
  }

  if (oldBlock?.type === "ordered_list") {
    return {
      id: createPatchId("block"),
      type: "ordered_list",
      items: text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => [createInlineText(line)])
    };
  }

  return buildParagraphBlockFromText(text);
}

function buildParagraphBlockFromText(text: string): Block {
  return {
    id: createPatchId("block"),
    type: "paragraph",
    content: [createInlineText(text)]
  };
}

function looksLikeBulletList(text: string): boolean {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 1 && lines.every((line) => /^[-•*]\s+/.test(line));
}

function looksLikeOrderedList(text: string): boolean {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 1 && lines.every((line) => /^\d+[.)]\s+/.test(line));
}

function preserveFormattingForPatch(oldBlocks: Block[], newBlocks: Block[]): Block[] {
  return newBlocks.map((block, index) => preserveFormattingForBlock(oldBlocks[index], block));
}

function preserveFormattingForBlock(oldBlock: Block | undefined, newBlock: Block): Block {
  if (!oldBlock) {
    return cloneBlock(newBlock);
  }

  if (oldBlock.type === "paragraph" && newBlock.type === "paragraph") {
    return {
      id: newBlock.id,
      type: "paragraph",
      content: preserveInlineFormatting(oldBlock.content, newBlock.content)
    };
  }

  if (oldBlock.type === "heading" && newBlock.type === "heading") {
    return {
      id: newBlock.id,
      type: "heading",
      level: newBlock.level,
      content: preserveInlineFormatting(oldBlock.content, newBlock.content)
    };
  }

  if (oldBlock.type === "bullet_list" && newBlock.type === "bullet_list") {
    return {
      id: newBlock.id,
      type: "bullet_list",
      items: newBlock.items.map((item, itemIndex) => preserveInlineFormatting(oldBlock.items[itemIndex] ?? [], item))
    };
  }

  if (oldBlock.type === "ordered_list" && newBlock.type === "ordered_list") {
    return {
      id: newBlock.id,
      type: "ordered_list",
      items: newBlock.items.map((item, itemIndex) => preserveInlineFormatting(oldBlock.items[itemIndex] ?? [], item))
    };
  }

  if (oldBlock.type === "callout" && newBlock.type === "callout") {
    return {
      id: newBlock.id,
      type: "callout",
      kind: newBlock.kind,
      title: preserveInlineFormatting(oldBlock.title, newBlock.title),
      body: newBlock.body.map((part, partIndex) => preserveInlineFormatting(oldBlock.body[partIndex] ?? [], part))
    };
  }

  if (oldBlock.type === "table" && newBlock.type === "table") {
    return {
      id: newBlock.id,
      type: "table",
      rows: newBlock.rows.map((row, rowIndex) =>
        row.map((cell, cellIndex) => preserveInlineFormatting(oldBlock.rows[rowIndex]?.[cellIndex] ?? [], cell))
      )
    };
  }

  if (oldBlock.type === "image" && newBlock.type === "image" && newBlock.caption) {
    return {
      id: newBlock.id,
      type: "image",
      assetId: newBlock.assetId,
      alt: newBlock.alt,
      caption: preserveInlineFormatting(oldBlock.caption ?? [], newBlock.caption)
    };
  }

  return cloneBlock(newBlock);
}

export function preserveInlineFormatting(oldNodes: InlineNode[], newNodes: InlineNode[]): InlineNode[] {
  const oldSegments = oldNodes
    .filter((node) => node.bold || node.italic || node.link)
    .map((node) => ({
      text: normalizeComparableText(node.text),
      marks: {
        bold: node.bold ? true : undefined,
        italic: node.italic ? true : undefined,
        link: node.link
      }
    }))
    .filter((segment) => segment.text.length > 0)
    .sort((left, right) => right.text.length - left.text.length);

  const rawText = getInlineText(newNodes);
  const assignedRanges: Array<{ start: number; end: number; marks: Omit<InlineNode, "text"> }> = [];

  for (const segment of oldSegments) {
    let searchFrom = 0;

    while (searchFrom <= rawText.length) {
      const index = rawText.indexOf(segment.text, searchFrom);

      if (index < 0) {
        break;
      }

      const end = index + segment.text.length;

      if (!assignedRanges.some((range) => !(end <= range.start || index >= range.end))) {
        assignedRanges.push({ start: index, end, marks: segment.marks as Omit<InlineNode, "text"> });
        break;
      }

      searchFrom = index + segment.text.length;
    }
  }

  assignedRanges.sort((left, right) => left.start - right.start || left.end - right.end);

  if (assignedRanges.length === 0) {
    return newNodes.map((node) => ({ text: node.text }));
  }

  const result: InlineNode[] = [];
  let cursor = 0;

  for (const range of assignedRanges) {
    if (range.start > cursor) {
      result.push({ text: rawText.slice(cursor, range.start) });
    }

    result.push({
      text: rawText.slice(range.start, range.end),
      ...range.marks
    });
    cursor = range.end;
  }

  if (cursor < rawText.length) {
    result.push({ text: rawText.slice(cursor) });
  }

  return result;
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
