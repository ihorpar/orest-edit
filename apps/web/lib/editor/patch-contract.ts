export type PatchOperationKind = "replace" | "insert" | "delete";
export type PatchOperationType = "clarity" | "structure" | "terminology" | "source" | "tone";
export type RequestMode = "default" | "custom";

export interface PatchSelection {
  start: number;
  end: number;
}

export interface PatchOperation {
  id: string;
  op: PatchOperationKind;
  start: number;
  end: number;
  oldText: string;
  newText?: string;
  reason: string;
  type: PatchOperationType;
}

export interface PatchRequest {
  text: string;
  selectionStart: number;
  selectionEnd: number;
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
  selectionLength: number;
  returnedOperationCount: number;
  droppedOperationCount: number;
  generatedAt: string;
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
export const PATCH_OPERATION_KINDS: PatchOperationKind[] = ["replace", "insert", "delete"];

export function createPatchId(prefix = "patch"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clampSelection(text: string, start: number, end: number): PatchSelection {
  const safeStart = Number.isFinite(start) ? Math.max(0, Math.min(text.length, Math.floor(start))) : 0;
  const safeEnd = Number.isFinite(end) ? Math.max(0, Math.min(text.length, Math.floor(end))) : safeStart;

  return safeStart <= safeEnd ? { start: safeStart, end: safeEnd } : { start: safeEnd, end: safeStart };
}

export function hasSelection(selection: PatchSelection): boolean {
  return selection.end > selection.start;
}

export function getSelectedText(text: string, selection: PatchSelection): string {
  return text.slice(selection.start, selection.end);
}

export function getOperationReplacementText(operation: PatchOperation): string {
  if (operation.op === "delete") {
    return "";
  }

  return operation.newText ?? "";
}

export function isPatchOperationApplicable(text: string, operation: PatchOperation): boolean {
  return text.slice(operation.start, operation.end) === operation.oldText;
}

export function getApplicablePatchOperations(text: string, operations: PatchOperation[]): PatchOperation[] {
  return operations.filter((operation) => isPatchOperationApplicable(text, operation));
}

export function applyPatchOperation(text: string, operation: PatchOperation): string {
  return text.slice(0, operation.start) + getOperationReplacementText(operation) + text.slice(operation.end);
}

export function applyPatchOperations(text: string, operations: PatchOperation[]): string {
  const applicable = getApplicablePatchOperations(text, operations)
    .slice()
    .sort((left, right) => right.start - left.start || right.end - left.end);

  return applicable.reduce((current, operation) => applyPatchOperation(current, operation), text);
}

export function operationsOverlap(left: PatchOperation, right: PatchOperation): boolean {
  return left.start < right.end && right.start < left.end;
}

export function rebasePendingOperations(operations: PatchOperation[], appliedOperation: PatchOperation): PatchOperation[] {
  const delta = getOperationReplacementText(appliedOperation).length - (appliedOperation.end - appliedOperation.start);

  return operations.flatMap((operation) => {
    if (operation.id === appliedOperation.id) {
      return [];
    }

    if (operationsOverlap(operation, appliedOperation)) {
      return [];
    }

    if (operation.start >= appliedOperation.end) {
      return [
        {
          ...operation,
          start: operation.start + delta,
          end: operation.end + delta
        }
      ];
    }

    return [operation];
  });
}

function normalizePatchType(type: unknown): PatchOperationType {
  return PATCH_OPERATION_TYPES.includes(type as PatchOperationType) ? (type as PatchOperationType) : "clarity";
}

function normalizePatchKind(kind: unknown): PatchOperationKind | null {
  return PATCH_OPERATION_KINDS.includes(kind as PatchOperationKind) ? (kind as PatchOperationKind) : null;
}

function normalizeReason(reason: unknown): string | null {
  if (typeof reason !== "string") {
    return null;
  }

  const trimmed = reason.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 120) : null;
}

function normalizeNewText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizePatchOperationsResult(
  text: string,
  selection: PatchSelection,
  operations: unknown
): NormalizedPatchOperationsResult {
  if (!Array.isArray(operations)) {
    return { operations: [], droppedCount: 0 };
  }

  const normalized: PatchOperation[] = [];
  let droppedCount = 0;

  for (const [index, candidate] of operations.entries()) {
    if (!candidate || typeof candidate !== "object") {
      droppedCount += 1;
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const op = normalizePatchKind(record.op);
    const reason = normalizeReason(record.reason);
    const start = typeof record.start === "number" ? Math.floor(record.start) : NaN;
    const end = typeof record.end === "number" ? Math.floor(record.end) : NaN;

    if (!op || !reason || !Number.isFinite(start) || !Number.isFinite(end)) {
      droppedCount += 1;
      continue;
    }

    if (start < selection.start || end > selection.end || start > end) {
      droppedCount += 1;
      continue;
    }

    if (op === "insert" ? start !== end : start === end) {
      droppedCount += 1;
      continue;
    }

    const oldText = text.slice(start, end);
    const newText = normalizeNewText(record.newText);

    if (op !== "delete" && typeof newText !== "string") {
      droppedCount += 1;
      continue;
    }

    if (op === "replace" && newText === oldText) {
      droppedCount += 1;
      continue;
    }

    if (op === "insert" && !newText) {
      droppedCount += 1;
      continue;
    }

    const operation: PatchOperation = {
      id: typeof record.id === "string" && record.id.trim() ? record.id : createPatchId(`provider-${index + 1}`),
      op,
      start,
      end,
      oldText,
      reason,
      type: normalizePatchType(record.type)
    };

    if (typeof newText === "string") {
      operation.newText = newText;
    }

    normalized.push(operation);
  }

  normalized.sort((left, right) => left.start - right.start || left.end - right.end);

  const deduped: PatchOperation[] = [];

  for (const operation of normalized) {
    const previous = deduped[deduped.length - 1];

    if (previous && operationsOverlap(previous, operation)) {
      droppedCount += 1;
      continue;
    }

    deduped.push(operation);
  }

  return { operations: deduped, droppedCount };
}

export function normalizePatchOperations(
  text: string,
  selection: PatchSelection,
  operations: unknown
): PatchOperation[] {
  return normalizePatchOperationsResult(text, selection, operations).operations;
}
