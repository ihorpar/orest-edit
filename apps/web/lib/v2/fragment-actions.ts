import { sliceDocumentForBlockRange, type EditorDocument } from "../editor/document-model.ts";
import type {
  LocalActionClarifyChoice,
  LocalActionMode,
  LocalActionRouteRequest,
  LocalActionRouteResponse,
  LocalActionTextIntent
} from "../editor/local-action-router.ts";
import { buildManualReviewItem } from "../editor/manual-review-items.ts";
import { computeAnchorFingerprint, type ManuscriptRevisionState } from "../editor/manuscript-structure.ts";
import type { PatchOperation, PatchRequest, RequestMode } from "../editor/patch-contract.ts";
import type {
  EditorialCalloutDepth,
  EditorialCalloutKind,
  EditorialVisualIntent,
  ReviewActionProposal,
  VisualStylePreset
} from "../editor/review-contract.ts";
import type { EditorSettings } from "../editor/settings.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import { isAnchorContiguous, type V2ReviewItem } from "./item-kinds.ts";
import type { V2RequestOutcome } from "./store.ts";

/**
 * Requests about a selected fragment. Every action goes the way the classic editor sends it:
 * `POST /api/edit/local-action` decides which executor answers, then that executor is called
 * (`POST /api/edit/patch` for rewrites, the proposal endpoint for lists, subheadings and callouts, the
 * spellcheck endpoint for spelling). Whatever comes back becomes an ordinary queue item, so it is reviewed
 * inline and accepted like any other suggestion. Nothing here invents a result.
 */

export const LOCAL_ACTION_ENDPOINT = "/api/edit/local-action";
export const PATCH_ENDPOINT = "/api/edit/patch";

/** The quick actions of the selection composer, plus the editor's own words. */
export type FragmentActionId = "simplify" | "shorten" | "list" | "subsection" | "callout" | "visual" | "spell" | "custom";

export const FRAGMENT_QUICK_ACTIONS: ReadonlyArray<Exclude<FragmentActionId, "custom">> = [
  "simplify",
  "shorten",
  "list",
  "subsection",
  "callout",
  "visual",
  "spell"
];

/** What a request is about: whole blocks, in manuscript order, and the words that were selected. */
export interface FragmentScope {
  blockIds: string[];
  quote: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FragmentApiMessages {
  /** The reply could not be read at all. */
  invalid: string;
  /** The request never reached the server. */
  network: string;
  /** The model answered, but proposed no change. */
  noOperations: string;
  /** The server marked the reply as a fallback draft, which is never shown as model output. */
  fallback: string;
}

/* ---------- routing ---------- */

const DEFAULT_CALLOUT_KIND: EditorialCalloutKind = "mechanism";
const DEFAULT_CALLOUT_DEPTH: EditorialCalloutDepth = "brief";
const DEFAULT_VISUAL_INTENT: EditorialVisualIntent = "infographic";

/**
 * Body of `POST /api/edit/local-action`, with the fields the classic editor sends. A quick action names its
 * executor outright; the editor's own words are left for the router to read. `choice` is the answer to a
 * `clarify` reply and makes the same words go to the chosen executor.
 */
export function buildLocalActionRequest(input: {
  action: FragmentActionId;
  prompt?: string;
  locale: AppLocale;
  choice?: LocalActionClarifyChoice;
  /** The style new illustrations start with; sent with a request that asks for one, as in the classic editor. */
  visualStylePreset?: VisualStylePreset;
}): LocalActionRouteRequest {
  const prompt = input.action === "custom" ? (input.prompt ?? "").trim() : "";
  let explicitMode: Exclude<LocalActionMode, "auto"> | null = null;
  let preferredTextIntent: LocalActionTextIntent | null = null;

  switch (input.action) {
    case "simplify":
      explicitMode = "edit";
      preferredTextIntent = "rewrite";
      break;
    case "shorten":
      explicitMode = "edit";
      preferredTextIntent = "shorten";
      break;
    case "list":
      explicitMode = "edit";
      preferredTextIntent = "list";
      break;
    case "subsection":
      explicitMode = "edit";
      preferredTextIntent = "subsection";
      break;
    case "callout":
      explicitMode = "callout";
      break;
    case "visual":
      explicitMode = "visual";
      break;
    case "spell":
      explicitMode = "spellcheck";
      break;
    case "custom":
      if (input.choice === "patch") {
        // Without a text intent the router would ask the same question again.
        explicitMode = "edit";
        preferredTextIntent = "rewrite";
      } else if (input.choice === "callout" || input.choice === "visual") {
        explicitMode = input.choice;
      } else if (input.choice === "spellcheck") {
        explicitMode = "spellcheck";
      }
      break;
  }

  return {
    locale: input.locale,
    prompt,
    explicitMode,
    preferredTextIntent,
    calloutKind: DEFAULT_CALLOUT_KIND,
    calloutDepth: DEFAULT_CALLOUT_DEPTH,
    visualIntent: DEFAULT_VISUAL_INTENT,
    ...(input.visualStylePreset ? { visualStylePreset: input.visualStylePreset } : {})
  };
}

export type LocalActionReply = { kind: "route"; route: LocalActionRouteResponse } | { kind: "error"; message: string };

const EXECUTORS = new Set(["patch", "review", "spellcheck", "callout", "visual", "clarify"]);

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function withHttpStatus(message: string, httpStatus: number): string {
  return httpStatus >= 400 ? `${message} (HTTP ${httpStatus})` : message;
}

function readServerError(record: Record<string, unknown> | null): string | null {
  return typeof record?.error === "string" && record.error.trim() ? record.error.trim() : null;
}

export function interpretLocalActionReply(responseText: string, httpStatus: number, messages: Pick<FragmentApiMessages, "invalid">): LocalActionReply {
  const record = parseJsonRecord(responseText);
  const serverError = readServerError(record);

  if (serverError) {
    return { kind: "error", message: serverError };
  }

  if (!record || httpStatus < 200 || httpStatus >= 300 || typeof record.executor !== "string" || !EXECUTORS.has(record.executor)) {
    return { kind: "error", message: withHttpStatus(messages.invalid, httpStatus) };
  }

  if (record.executor === "clarify" && (!Array.isArray(record.choices) || record.choices.length === 0)) {
    return { kind: "error", message: messages.invalid };
  }

  if (record.executor === "review" && record.recommendationType !== "list" && record.recommendationType !== "subsection") {
    return { kind: "error", message: messages.invalid };
  }

  return { kind: "route", route: record as unknown as LocalActionRouteResponse };
}

/** What has to happen after the router answered. */
export type FragmentExecution =
  /** A rewrite through the patch endpoint; the reply already carries the replacement. */
  | { kind: "patch"; mode: RequestMode; prompt?: string; textIntent: LocalActionTextIntent }
  /** A list, a subheading, a callout or an illustration: a manual queue item and then the proposal path. */
  | {
      kind: "manual";
      recommendationType: "list" | "subsection" | "callout" | "visual";
      instruction?: string;
      calloutKind?: EditorialCalloutKind;
      calloutDepth?: EditorialCalloutDepth;
      visualIntent?: EditorialVisualIntent;
    }
  | { kind: "spellcheck" }
  /** The router could not tell what is wanted: the editor chooses, nothing is guessed. */
  | { kind: "clarify"; choices: LocalActionClarifyChoice[] };

const CLARIFY_CHOICES = new Set<LocalActionClarifyChoice>(["patch", "spellcheck", "callout", "visual"]);

export function planFragmentExecution(route: LocalActionRouteResponse): FragmentExecution {
  switch (route.executor) {
    case "patch":
      return { kind: "patch", mode: route.requestMode, prompt: route.prompt, textIntent: route.textIntent };
    case "review":
      return { kind: "manual", recommendationType: route.recommendationType, instruction: route.prompt };
    case "callout":
      return {
        kind: "manual",
        recommendationType: "callout",
        instruction: route.prompt,
        calloutKind: route.calloutKind,
        calloutDepth: route.calloutDepth
      };
    case "visual":
      return { kind: "manual", recommendationType: "visual", instruction: route.prompt, visualIntent: route.visualIntent };
    case "spellcheck":
      return { kind: "spellcheck" };
    case "clarify":
      return { kind: "clarify", choices: route.choices.filter((choice) => CLARIFY_CHOICES.has(choice)) };
  }
}

export async function requestLocalAction(
  request: LocalActionRouteRequest,
  deps: { messages: FragmentApiMessages; fetchImpl?: FetchLike; signal?: AbortSignal }
): Promise<LocalActionReply | { kind: "aborted" }> {
  try {
    const response = await (deps.fetchImpl ?? ((input, init) => fetch(input, init)))(LOCAL_ACTION_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      signal: deps.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });

    return interpretLocalActionReply(await response.text(), response.status, deps.messages);
  } catch (error) {
    return describeFetchFailure(error, deps);
  }
}

function describeFetchFailure(
  error: unknown,
  deps: { messages: FragmentApiMessages; signal?: AbortSignal }
): { kind: "error"; message: string } | { kind: "aborted" } {
  if (deps.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
    return { kind: "aborted" };
  }

  const detail = error instanceof Error ? error.message.trim() : "";
  return { kind: "error", message: detail ? `${deps.messages.network} ${detail}` : deps.messages.network };
}

/* ---------- patch ---------- */

/**
 * Body of `POST /api/edit/patch`, as the classic editor builds it: the selected blocks with one neighbour on
 * each side for context, and the ids of the blocks that may be replaced.
 */
export function buildPatchRequest(input: {
  document: EditorDocument;
  blockIds: string[];
  mode: RequestMode;
  prompt?: string;
  settings: Pick<EditorSettings, "provider" | "modelId" | "basePrompt">;
  locale: AppLocale;
}): PatchRequest {
  return {
    document: sliceDocumentForBlockRange(input.document, input.blockIds, { before: 1, after: 1 }),
    targetBlockIds: input.blockIds,
    mode: input.mode,
    prompt: input.mode === "custom" ? (input.prompt ?? "").trim() : undefined,
    provider: input.settings.provider,
    modelId: input.settings.modelId,
    basePrompt: input.settings.basePrompt,
    locale: input.locale
  };
}

export type PatchReply = { kind: "operations"; operations: PatchOperation[] } | { kind: "error"; message: string };

function isPatchOperation(value: unknown): value is PatchOperation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const operation = value as Partial<PatchOperation>;
  return (
    operation.op === "replace_blocks" &&
    typeof operation.id === "string" &&
    Array.isArray(operation.blockIds) &&
    operation.blockIds.length > 0 &&
    operation.blockIds.every((blockId) => typeof blockId === "string") &&
    Array.isArray(operation.oldBlocks) &&
    Array.isArray(operation.newBlocks) &&
    operation.newBlocks.length > 0
  );
}

/**
 * Reads a patch reply. Anything but real operations from the model is an error with the server's own words:
 * an error field, a failed status, a fallback draft, or no operation at all.
 */
export function interpretPatchReply(responseText: string, httpStatus: number, messages: FragmentApiMessages): PatchReply {
  const record = parseJsonRecord(responseText);
  const serverError = readServerError(record);

  if (serverError) {
    return { kind: "error", message: serverError };
  }

  if (!record || httpStatus < 200 || httpStatus >= 300 || !Array.isArray(record.operations)) {
    return { kind: "error", message: withHttpStatus(messages.invalid, httpStatus) };
  }

  if (record.usedFallback === true) {
    return { kind: "error", message: messages.fallback };
  }

  const operations = record.operations.filter(isPatchOperation);

  if (operations.length === 0) {
    return { kind: "error", message: record.operations.length > 0 ? messages.invalid : messages.noOperations };
  }

  return { kind: "operations", operations };
}

export async function requestPatch(
  request: PatchRequest,
  deps: { messages: FragmentApiMessages; fetchImpl?: FetchLike; signal?: AbortSignal }
): Promise<PatchReply | { kind: "aborted" }> {
  try {
    const response = await (deps.fetchImpl ?? ((input, init) => fetch(input, init)))(PATCH_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      signal: deps.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });

    return interpretPatchReply(await response.text(), response.status, deps.messages);
  } catch (error) {
    return describeFetchFailure(error, deps);
  }
}

/* ---------- results as queue items ---------- */

export interface FragmentItemCopy {
  /** Card title, e.g. the name of the quick action. */
  title: string;
  /** What was asked, in words (the instruction sent, or the name of the quick action). */
  recommendation: string;
  /** Shown as the reason when the model gave none. */
  reasonFallback: string;
}

export type PatchItemResult =
  | { kind: "item"; item: V2ReviewItem; proposal: ReviewActionProposal }
  /** The operation cannot be shown against this manuscript (unknown or scattered blocks). */
  | { kind: "unusable" };

/**
 * One patch operation as a queue item with its prepared proposal: the same shape a rewrite suggestion has
 * after `Показати правку`, so it is drawn as an inline diff and accepted through the same path.
 */
export function buildPatchItem(input: {
  operation: PatchOperation;
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  textIntent: LocalActionTextIntent;
  copy: FragmentItemCopy;
  itemId: string;
  now?: string;
}): PatchItemResult {
  const { operation, document, revision } = input;
  const known = new Set(document.blocks.map((block) => block.id));

  if (!operation.blockIds.every((blockId) => known.has(blockId)) || !isAnchorContiguous(revision.blockOrder, operation.blockIds)) {
    return { kind: "unusable" };
  }

  const start = revision.blockOrder.indexOf(operation.blockIds[0]!);
  const reason = operation.reason?.trim() || input.copy.reasonFallback;
  const item: V2ReviewItem = {
    id: input.itemId,
    reviewSessionId: `local-${input.itemId}`,
    documentRevisionId: revision.documentRevisionId,
    changeLevel: 5,
    title: input.copy.title,
    reason,
    recommendation: input.copy.recommendation,
    recommendationType: input.textIntent === "rewrite" ? "rewrite" : "simplify",
    suggestedAction: "rewrite_text",
    priority: "medium",
    anchor: {
      blockIds: operation.blockIds,
      generationBlockRange: { start, end: start + operation.blockIds.length - 1 },
      excerpt: "",
      fingerprint: computeAnchorFingerprint(document, operation.blockIds)
    },
    insertionPoint: { mode: "replace", anchorBlockId: operation.blockIds[0]! },
    origin: "manual",
    manualRequest: { source: "floating_local_bar", createdAt: input.now ?? new Date().toISOString() },
    activeProposalId: operation.id,
    status: "ready"
  };

  // Same shape as the classic editor's `buildLocalPatchProposal`.
  const proposal: ReviewActionProposal = {
    id: operation.id,
    reviewItemId: item.id,
    sourceRevisionId: revision.documentRevisionId,
    targetRevisionId: revision.documentRevisionId,
    kind: "text_diff",
    summary: reason,
    canApplyDirectly: true,
    textDiff: {
      op: "replace_blocks",
      blockIds: operation.blockIds,
      oldBlocks: operation.oldBlocks,
      newBlocks: operation.newBlocks,
      reason
    }
  };

  return { kind: "item", item, proposal };
}

/**
 * The manual queue item behind `Списком`, `Підзаголовок`, `Врізка` and `Ілюстрація`, built with the classic
 * editor's own helper so the proposal endpoint receives what it expects. It carries no review step: a rerun
 * of a pass never removes what the editor asked for by hand.
 */
export function buildFragmentManualItem(input: {
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  blockIds: string[];
  recommendationType: "list" | "subsection" | "callout" | "visual";
  instruction?: string;
  calloutKind?: EditorialCalloutKind;
  calloutDepth?: EditorialCalloutDepth;
  visualIntent?: EditorialVisualIntent;
  copy: Pick<FragmentItemCopy, "title"> & { reason: string };
  now?: string;
}): V2ReviewItem {
  const item = buildManualReviewItem({
    document: input.document,
    revision: input.revision,
    blockIds: input.blockIds,
    changeLevel: 5,
    recommendationType: input.recommendationType,
    calloutKind: input.calloutKind,
    calloutDepth: input.calloutDepth,
    visualIntent: input.visualIntent,
    manualInstruction: input.instruction,
    now: input.now
  });

  // The helper's own title and reason name a panel of the classic editor; the card says it in v2's words.
  return { ...item, title: input.copy.title, reason: input.copy.reason };
}

/* ---------- guards and settlements ---------- */

/** Blocks a rewrite may replace: running text. An image, a table, a divider or a callout is never rewritten. */
const REWRITABLE_BLOCK_TYPES: ReadonlySet<string> = new Set(["paragraph", "heading", "bullet_list", "ordered_list"]);

/**
 * The blocks of a scope that a rewrite must not touch. A rewrite replaces its whole scope with what the
 * model returns; with an image or a table inside, a one-paragraph answer would be a drawn, acceptable diff
 * that deletes it. Such a request is not sent at all. Requests that only insert next to the fragment
 * (subheading, callout, illustration) are not affected and keep any scope.
 */
export function findUnrewritableBlocks(document: EditorDocument, blockIds: string[]): string[] {
  const types = new Map(document.blocks.map((block) => [block.id, block.type as string]));
  return blockIds.filter((blockId) => !REWRITABLE_BLOCK_TYPES.has(types.get(blockId) ?? ""));
}

/** True for the executions that replace the scoped blocks with the model's text. */
export function isRewriteExecution(execution: FragmentExecution): boolean {
  return execution.kind === "patch" || (execution.kind === "manual" && execution.recommendationType === "list");
}

/**
 * How a fragment request ends once the preparation of its item has ended, or null when it must not be
 * settled from here (the run was replaced or cancelled by its own button, which settles it itself).
 *
 * A preparation that was given up from elsewhere (the card was rejected while the model was answering)
 * ends the request as stopped: it must never stay "running".
 */
export function resolvePrepareSettlement(
  outcome: { kind: "ready" } | { kind: "failed"; message: string } | { kind: "cancelled" } | { kind: "skipped" },
  isCurrentRun: boolean,
  fallbackError: string
): V2RequestOutcome | null {
  if (!isCurrentRun) {
    return null;
  }

  switch (outcome.kind) {
    case "ready":
      return { kind: "done", count: 1 };
    case "failed":
      return { kind: "error", message: outcome.message || fallbackError };
    case "cancelled":
      return { kind: "stopped" };
    case "skipped":
      return { kind: "error", message: fallbackError };
  }
}

/**
 * What a fragment spellcheck may touch: only the blocks whose batch the service answered. Findings in a
 * block that was not checked stay as they were, and the failures are reported, never dropped.
 */
export function planSpellMerge(
  scopeBlockIds: string[],
  reply: { checkedBlockIds: string[]; failures: string[] }
): { blockIds: string[]; warnings: string[] } {
  const answered = new Set(reply.checkedBlockIds);
  return {
    blockIds: scopeBlockIds.filter((blockId) => answered.has(blockId)),
    warnings: Array.from(new Set(reply.failures.filter((message) => message.trim().length > 0)))
  };
}

/** True when every block of the scope still stands in the manuscript, in order and with nothing between. */
export function isScopeIntact(scope: FragmentScope, revision: ManuscriptRevisionState): boolean {
  return scope.blockIds.length > 0 && isAnchorContiguous(revision.blockOrder, scope.blockIds);
}

/** A short quote of the selected words for the scope chip and the history. */
export function shortenQuote(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit).replace(/\s+\S*$/, "")}…` : flat;
}
