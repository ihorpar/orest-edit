import type { Block, EditorDocument } from "../editor/document-model.ts";
import {
  computeAnchorFingerprint,
  deriveManuscriptRevisionState,
  type ManuscriptRevisionState
} from "../editor/manuscript-structure.ts";
import {
  isEditorialReviewRunApiResponse,
  isReplaceReviewType,
  normalizeEditorialCalloutDepth,
  type ChatMessage,
  type CustomRequestPlanAction,
  type DiagnosticsMode,
  type EditorialReviewItem,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  type EditorialReviewRunError,
  type EditorialReviewRunSnapshot,
  type EditorialReviewStepId,
  type EditorialStepRunMode,
  type RejectedReviewIdea,
  type ReviewActionProposal,
  type ReviewActionRequest
} from "../editor/review-contract.ts";
import { resolveReviewPollWaitMs } from "../editor/review-poll-interval.ts";
import {
  interpretReviewRunPollBody,
  isTransientReviewPollFetchError,
  resolveReviewPollFetchTimeoutMs,
  REVIEW_POLL_FETCH_MAX_RETRIES,
  sanitizeExposedErrorMessage
} from "../editor/review-run-recovery.ts";
import { sanitizeEditorSettings, type EditorSettings } from "../editor/settings.ts";
import type { SpellcheckIssue, SpellcheckRange, SpellcheckResponse } from "../editor/spellcheck-contract.ts";
import { createSpellcheckBatchChunks, getSpellcheckableBlocks, type SpellcheckBatchChunk } from "../editor/spellcheck-view-model.ts";
import {
  getEditorSettingsStorageKey,
  getLegacyEditorSettingsStorageKey,
  getProductLocaleConfig,
  type AppLocale
} from "../i18n/product-locale.ts";

/**
 * Typed client for the review endpoints the classic editor drives from `app/editor/page.tsx`:
 * `POST/GET/DELETE /api/edit/review` (durable runs) and `POST /api/edit/review/proposal`.
 *
 * Every reply is a discriminated union. A failure always carries a message a person can read: the server's
 * own text when there is one, otherwise what went wrong on the way. Nothing here invents a result.
 */

export const REVIEW_RUN_ENDPOINT = "/api/edit/review";
export const REVIEW_PROPOSAL_ENDPOINT = "/api/edit/review/proposal";
export const REVIEW_RUN_CAPABILITY_HEADER = "x-review-run-capability";

/** Client-side texts for failures the server did not describe. */
export interface ReviewApiMessages {
  /** The reply was not a review-run state at all. */
  invalid: string;
  /** The hosting platform cut the request off (non-JSON timeout page). */
  platformTimeout: string;
  /** The status check did not answer in time, several times in a row. */
  pollTimeout: string;
  /** The run belongs to another interface language. */
  wrongLocale: string;
  /** The run finished, but its result does not match what was asked for. */
  resultInvalid: string;
  /** The proposal reply could not be read. */
  proposalInvalid: string;
  /** The request never reached the server. */
  network: string;
}

export type ReviewRunFailureCode =
  | EditorialReviewRunError["code"]
  | "invalid_response"
  | "platform_failure"
  | "network_error"
  | "poll_timeout"
  | "wrong_locale"
  | "invalid_result";

type CompletedRunSnapshot = EditorialReviewRunSnapshot & { status: "completed" };

export type ReviewRunReply =
  | {
      kind: "run";
      run: EditorialReviewRunSnapshot;
      /** Signed reference that authorises later polls and the cancel call for this run. */
      capability: string;
      items: EditorialReviewItem[];
      itemCursor?: number;
      /** Planned actions of a chapter request, once it has planned them. */
      plan?: CustomRequestPlanAction[];
    }
  | { kind: "result"; run: CompletedRunSnapshot; result: EditorialReviewResponse }
  | {
      kind: "error";
      code: ReviewRunFailureCode;
      message: string;
      retryable: boolean;
      httpStatus?: number;
      run?: EditorialReviewRunSnapshot;
      items: EditorialReviewItem[];
      itemCursor?: number;
    };

export type ReviewRunOutcome =
  | { kind: "completed"; run: CompletedRunSnapshot; result: EditorialReviewResponse }
  | { kind: "failed"; code: ReviewRunFailureCode; message: string; run?: EditorialReviewRunSnapshot }
  /** This poller stopped being the owner (stopped by the editor, replaced, or another tab holds the lease). */
  | { kind: "superseded" };

export type ProposalReply =
  | { kind: "text_diff"; proposal: ReviewActionProposal & { textDiff: NonNullable<ReviewActionProposal["textDiff"]> } }
  /** Subsection, callout and image drafts; used by later passes. */
  | { kind: "draft"; proposal: ReviewActionProposal }
  | { kind: "stale_anchor"; message: string; proposal: ReviewActionProposal }
  | { kind: "error"; message: string; httpStatus?: number };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/* ---------- settings (read-only) ---------- */

/**
 * Reads the provider, model and prompts the classic editor saved, without writing anything back.
 * `readEditorSettings` from `lib/editor/settings.ts` is not used here because it can persist a migration.
 */
export function readEditorSettingsReadOnly(storage: Pick<Storage, "getItem">, locale: AppLocale): EditorSettings {
  const raw =
    storage.getItem(getEditorSettingsStorageKey(locale)) ??
    (locale === "uk" ? storage.getItem(getLegacyEditorSettingsStorageKey()) : null);

  if (!raw) {
    return sanitizeEditorSettings(null, locale);
  }

  try {
    return sanitizeEditorSettings(JSON.parse(raw) as Partial<EditorSettings>, locale);
  } catch {
    return sanitizeEditorSettings(null, locale);
  }
}

/* ---------- request builders ---------- */

export interface ReviewRunRequestInput {
  document: EditorDocument;
  settings: EditorSettings;
  locale: AppLocale;
  stepId: EditorialReviewStepId;
  runMode: EditorialStepRunMode;
  rejectedIdeas: RejectedReviewIdea[];
  /** Diagnostics text, when the chapter overview has been run. */
  expertise?: string | null;
  /** How detailed the diagnostics report should be; read only by the diagnostics step. */
  diagnosticsMode?: DiagnosticsMode;
  /** The editor's own instruction; the chapter request (`final_editing`) cannot run without one. */
  instruction?: string;
  /** One planned action of an earlier chapter request to generate again (sent in `preserve` mode). */
  planAction?: CustomRequestPlanAction & { index: number };
  /** Id and time of the history message that carries the instruction; injected in tests. */
  messageStamp?: { id: string; timestamp: string };
}

/**
 * Same fields the classic editor sends for a workflow step; the revision is compact (order and id only).
 *
 * Diagnostics text travels the way the classic editor sends it: as `expertise` and
 * `stepContext.diagnosticsExpertise` to every step except diagnostics itself (which gets its mode instead)
 * and accents (whose request carries no step context at all).
 */
export function buildReviewRunRequest(input: ReviewRunRequestInput): EditorialReviewRequest {
  const { document, settings, locale, stepId, runMode } = input;
  const fullRevision = deriveManuscriptRevisionState(document);
  const revision: ManuscriptRevisionState = {
    documentRevisionId: fullRevision.documentRevisionId,
    blockOrder: fullRevision.blockOrder,
    blockFingerprints: {}
  };
  const cardsPrompt = settings.cardsPrompt.trim() || settings.reviewPrompt.trim() || undefined;
  const expertise = input.expertise?.trim() || undefined;

  if (stepId === "emphasis") {
    return {
      document,
      revision,
      provider: settings.provider,
      modelId: settings.modelId,
      locale,
      async: true,
      basePrompt: settings.basePrompt,
      cardsPrompt,
      workflowStepPrompts: settings.workflowStepPrompts,
      changeLevel: 5,
      additionalInstructions: "",
      stepId,
      runMode,
      rejectedIdeas: input.rejectedIdeas
    };
  }

  const isDiagnostics = stepId === "diagnostics";
  const instruction = input.instruction?.trim() || undefined;
  const history: ChatMessage[] | undefined = instruction
    ? [
        {
          id: input.messageStamp?.id ?? `chat-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          role: "user",
          content: `[${stepId}] ${instruction}`,
          timestamp: input.messageStamp?.timestamp ?? new Date().toISOString()
        }
      ]
    : undefined;

  return {
    document,
    revision,
    provider: settings.provider,
    modelId: settings.modelId,
    locale,
    async: true,
    basePrompt: settings.basePrompt,
    expertisePrompt: isDiagnostics ? settings.expertisePrompt.trim() || settings.reviewPrompt.trim() || undefined : undefined,
    cardsPrompt: isDiagnostics ? undefined : cardsPrompt,
    workflowStepPrompts: settings.workflowStepPrompts,
    changeLevel: 5,
    additionalInstructions: "",
    stepId,
    runMode,
    ...(history ? { history, stepFeedback: instruction } : {}),
    stepContext: isDiagnostics
      ? { diagnosticsMode: input.diagnosticsMode ?? "concise" }
      : { diagnosticsExpertise: expertise, ...(instruction ? { currentStepFeedback: instruction } : {}) },
    expertise: isDiagnostics ? undefined : expertise,
    rejectedIdeas: input.rejectedIdeas,
    ...(input.planAction ? { customRequestPlanAction: input.planAction } : {})
  };
}

export interface ProposalRequestInput {
  document: EditorDocument;
  item: EditorialReviewItem;
  settings: EditorSettings;
  locale: AppLocale;
  editorialInstruction?: string;
}

/** Compact proposal request: only the anchored blocks travel, as in the classic editor. */
export function buildProposalRequest(input: ProposalRequestInput): ReviewActionRequest {
  const { document, item, settings, locale } = input;
  const revision = deriveManuscriptRevisionState(document);
  const isReplace = isReplaceReviewType(item.recommendationType);
  const compactItem: ReviewActionRequest["item"] = {
    id: item.id,
    reviewSessionId: item.reviewSessionId,
    documentRevisionId: item.documentRevisionId,
    changeLevel: item.changeLevel,
    title: item.title,
    reason: item.reason,
    recommendation: item.recommendation,
    recommendationType: item.recommendationType,
    suggestedAction: item.suggestedAction,
    priority: item.priority,
    anchor: item.anchor,
    insertionPoint: item.insertionPoint,
    status: item.status
  };

  if (item.calloutKind) {
    compactItem.calloutKind = item.calloutKind;
    compactItem.calloutDepth = normalizeEditorialCalloutDepth(item.calloutDepth);
  }

  if (item.visualIntent) {
    compactItem.visualIntent = item.visualIntent;
  }

  const relatedBlockIds = Array.from(
    new Set(
      (isReplace ? [...item.anchor.blockIds] : [...item.anchor.blockIds, item.insertionPoint.anchorBlockId]).filter(
        (value): value is string => Boolean(value)
      )
    )
  );
  const relatedBlocks = relatedBlockIds
    .map((blockId) => document.blocks.find((block) => block.id === blockId))
    .filter((block): block is Block => Boolean(block));

  const request: ReviewActionRequest = {
    document: { version: 2, blocks: relatedBlocks },
    currentRevision: {
      documentRevisionId: revision.documentRevisionId,
      blockOrder: relatedBlockIds,
      blockFingerprints: Object.fromEntries(
        relatedBlockIds.map((blockId) => [blockId, revision.blockFingerprints[blockId] ?? ""])
      )
    },
    item: compactItem,
    editorialInstruction: input.editorialInstruction?.trim() || undefined,
    provider: settings.provider,
    modelId: settings.modelId,
    locale
  };

  if (isReplace) {
    return { ...request, basePrompt: settings.basePrompt };
  }

  if (item.suggestedAction === "prepare_callout") {
    return { ...request, calloutPromptTemplate: settings.calloutPromptTemplate };
  }

  if (item.suggestedAction === "prepare_visual") {
    return { ...request, imagePromptTemplate: settings.imagePromptTemplate };
  }

  return request;
}

/**
 * A stale item can be prepared again when every anchored block still exists: it is sent with the current
 * fingerprint of those blocks. Returns null when a block is gone and the suggestion has nothing to attach to.
 */
export function refreshItemAnchor(item: EditorialReviewItem, document: EditorDocument): EditorialReviewItem | null {
  const known = new Set(document.blocks.map((block) => block.id));

  if (item.anchor.blockIds.length === 0 || !item.anchor.blockIds.every((blockId) => known.has(blockId))) {
    return null;
  }

  return {
    ...item,
    status: "pending",
    activeProposalId: undefined,
    anchor: { ...item.anchor, fingerprint: computeAnchorFingerprint(document, item.anchor.blockIds) }
  };
}

/* ---------- reply interpretation ---------- */

export function interpretReviewRunReply(responseText: string, httpStatus: number, messages: ReviewApiMessages): ReviewRunReply {
  const parsed = interpretReviewRunPollBody(responseText, {
    invalid: messages.invalid,
    platformTimeout: messages.platformTimeout
  });

  if (!parsed.ok) {
    const isPlatform = parsed.message === messages.platformTimeout;

    return {
      kind: "error",
      code: isPlatform ? "platform_failure" : "invalid_response",
      message: withHttpStatus(parsed.message, httpStatus),
      retryable: isPlatform,
      httpStatus,
      items: []
    };
  }

  const payload = parsed.payload;

  if (!isEditorialReviewRunApiResponse(payload)) {
    // The auth gate and some proxies answer `{ "error": "..." }` instead of the run envelope.
    const plainError =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? ((payload as { error: string }).error.trim() || null)
        : null;

    return {
      kind: "error",
      code: "invalid_response",
      message: plainError ?? withHttpStatus(messages.invalid, httpStatus),
      retryable: false,
      httpStatus,
      items: []
    };
  }

  if (payload.kind === "error") {
    return {
      kind: "error",
      code: payload.error.code,
      message: sanitizeExposedErrorMessage(payload.error.message, messages.resultInvalid),
      retryable: payload.error.retryable,
      httpStatus,
      run: payload.run,
      items: payload.items ?? [],
      itemCursor: payload.itemCursor
    };
  }

  if (payload.kind === "result") {
    return { kind: "result", run: payload.run, result: payload.result };
  }

  return {
    kind: "run",
    run: payload.run,
    capability: payload.capability,
    items: payload.items ?? [],
    itemCursor: payload.itemCursor,
    ...(payload.plan && Array.isArray(payload.plan.actions) && payload.plan.actions.length > 0 ? { plan: payload.plan.actions } : {})
  };
}

/** Next `afterItem` cursor: the server's count when it reports one, otherwise the items received so far. */
export function advanceItemCursor(current: number, reply: ReviewRunReply): number {
  if (reply.kind === "result") {
    return current;
  }

  if (typeof reply.itemCursor === "number" && reply.itemCursor >= current) {
    return reply.itemCursor;
  }

  return current + reply.items.length;
}

/**
 * Checks that a completed run answers the request that started it. Returns the problem, or null.
 */
export function validateCompletedReviewResult(
  result: EditorialReviewResponse,
  expected: Pick<EditorialReviewRunSnapshot, "stepId" | "runMode" | "provider" | "modelId" | "documentRevisionId">,
  messages: Pick<ReviewApiMessages, "resultInvalid">
): string | null {
  if (
    result.stepId !== expected.stepId ||
    result.runMode !== expected.runMode ||
    result.diagnostics.requestedProvider !== expected.provider ||
    result.diagnostics.requestedModelId !== expected.modelId ||
    result.diagnostics.stepId !== result.stepId ||
    result.diagnostics.stepRunId !== result.stepRunId ||
    result.items.some((item) => item.documentRevisionId !== expected.documentRevisionId)
  ) {
    return messages.resultInvalid;
  }

  return null;
}

export function interpretProposalReply(responseText: string, httpStatus: number, messages: ReviewApiMessages): ProposalReply {
  let payload: unknown;

  try {
    payload = JSON.parse(responseText) as unknown;
  } catch {
    return { kind: "error", message: withHttpStatus(messages.proposalInvalid, httpStatus), httpStatus };
  }

  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const serverError = typeof record?.error === "string" && record.error.trim() ? record.error.trim() : null;
  const proposal = record?.proposal as ReviewActionProposal | undefined;

  if (!proposal || typeof proposal !== "object" || typeof proposal.kind !== "string") {
    return { kind: "error", message: serverError ?? withHttpStatus(messages.proposalInvalid, httpStatus), httpStatus };
  }

  if (proposal.kind === "stale_anchor") {
    return {
      kind: "stale_anchor",
      message: proposal.staleReason?.trim() || serverError || proposal.summary || messages.proposalInvalid,
      proposal
    };
  }

  if (serverError) {
    return { kind: "error", message: serverError, httpStatus };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    return { kind: "error", message: withHttpStatus(messages.proposalInvalid, httpStatus), httpStatus };
  }

  if (proposal.kind === "text_diff") {
    const textDiff = proposal.textDiff;

    if (
      !textDiff ||
      !Array.isArray(textDiff.blockIds) ||
      textDiff.blockIds.length === 0 ||
      !Array.isArray(textDiff.oldBlocks) ||
      !Array.isArray(textDiff.newBlocks) ||
      textDiff.newBlocks.length === 0
    ) {
      return { kind: "error", message: messages.proposalInvalid, httpStatus };
    }

    return { kind: "text_diff", proposal: { ...proposal, textDiff } };
  }

  return { kind: "draft", proposal };
}

function withHttpStatus(message: string, httpStatus: number): string {
  return httpStatus >= 400 ? `${message} (HTTP ${httpStatus})` : message;
}

function describeNetworkError(error: unknown, messages: ReviewApiMessages): string {
  const detail = error instanceof Error ? error.message.trim() : "";
  return detail ? `${messages.network} ${detail}` : messages.network;
}

/* ---------- calls ---------- */

export interface ReviewApiDeps {
  messages: ReviewApiMessages;
  fetchImpl?: FetchLike;
}

function resolveFetch(deps: ReviewApiDeps): FetchLike {
  return deps.fetchImpl ?? ((input, init) => fetch(input, init));
}

export async function startReviewRun(request: EditorialReviewRequest, deps: ReviewApiDeps): Promise<ReviewRunReply> {
  let response: Response;
  let text: string;

  try {
    response = await resolveFetch(deps)(REVIEW_RUN_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    text = await response.text();
  } catch (error) {
    return {
      kind: "error",
      code: "network_error",
      message: describeNetworkError(error, deps.messages),
      retryable: true,
      items: []
    };
  }

  return interpretReviewRunReply(text, response.status, deps.messages);
}

export interface ReviewRunReference {
  runId: string;
  capability: string;
  locale: AppLocale;
}

/** One status check. Throws on a network failure or an abort, so the poller can tell them apart and retry. */
export async function fetchReviewRun(
  reference: ReviewRunReference & { afterItem: number; signal?: AbortSignal },
  deps: ReviewApiDeps
): Promise<ReviewRunReply> {
  const query = `runId=${encodeURIComponent(reference.runId)}&locale=${encodeURIComponent(reference.locale)}&afterItem=${encodeURIComponent(String(reference.afterItem))}`;
  const response = await resolveFetch(deps)(`${REVIEW_RUN_ENDPOINT}?${query}`, {
    method: "GET",
    credentials: "same-origin",
    signal: reference.signal,
    headers: {
      "Cache-Control": "no-store",
      [REVIEW_RUN_CAPABILITY_HEADER]: reference.capability
    }
  });

  return interpretReviewRunReply(await response.text(), response.status, deps.messages);
}

export type CancelReviewRunReply = { kind: "cancelled" } | { kind: "error"; message: string };

export async function cancelReviewRun(reference: ReviewRunReference, deps: ReviewApiDeps): Promise<CancelReviewRunReply> {
  try {
    const response = await resolveFetch(deps)(
      `${REVIEW_RUN_ENDPOINT}?runId=${encodeURIComponent(reference.runId)}&locale=${encodeURIComponent(reference.locale)}`,
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: { [REVIEW_RUN_CAPABILITY_HEADER]: reference.capability }
      }
    );
    const reply = interpretReviewRunReply(await response.text(), response.status, deps.messages);

    if (reply.kind === "error" && reply.code === "run_cancelled") {
      return { kind: "cancelled" };
    }

    return { kind: "error", message: reply.kind === "error" ? reply.message : deps.messages.invalid };
  } catch (error) {
    return { kind: "error", message: describeNetworkError(error, deps.messages) };
  }
}

export async function prepareProposal(
  request: ReviewActionRequest,
  deps: ReviewApiDeps & { signal?: AbortSignal }
): Promise<ProposalReply> {
  let response: Response;
  let text: string;

  try {
    response = await resolveFetch(deps)(REVIEW_PROPOSAL_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      signal: deps.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    text = await response.text();
  } catch (error) {
    return { kind: "error", message: describeNetworkError(error, deps.messages) };
  }

  return interpretProposalReply(text, response.status, deps.messages);
}

/* ---------- polling ---------- */

export interface ReviewRunSnapshotUpdate {
  run: EditorialReviewRunSnapshot;
  capability: string;
  /** Items that arrived since the previous snapshot. */
  items: EditorialReviewItem[];
  itemCursor: number;
  plan?: CustomRequestPlanAction[];
}

export interface PollReviewRunOptions extends ReviewApiDeps {
  run: EditorialReviewRunSnapshot;
  capability: string;
  locale: AppLocale;
  /** Cursor to resume from after a reload; 0 for a fresh run. */
  itemCursor?: number;
  /** Size of the manuscript, used for the poll interval and the per-request timeout. */
  getSourceChars: () => number;
  /** False once the editor stopped or replaced this poller. */
  isCurrent: () => boolean;
  /** Cross-tab poll lease (`tryAcquireReviewRunPollLease`); false means another tab polls this run. */
  acquireLease: (runId: string) => boolean;
  onSnapshot: (update: ReviewRunSnapshotUpdate) => void;
  /** Lets the owner abort the request that is in flight. */
  onRequest?: (controller: AbortController | null) => void;
  wait?: (ms: number) => Promise<void>;
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls a run until it completes, fails or this poller is superseded. Streamed items are handed to
 * `onSnapshot` as they arrive, with the cursor to persist for recovery.
 */
export async function pollReviewRun(options: PollReviewRunOptions): Promise<ReviewRunOutcome> {
  const wait = options.wait ?? defaultWait;
  let run = options.run;
  let capability = options.capability;
  let itemCursor = Math.max(0, Math.floor(options.itemCursor ?? 0));

  while (true) {
    if (!options.isCurrent() || !options.acquireLease(run.runId)) {
      return { kind: "superseded" };
    }

    if (run.locale !== options.locale) {
      return { kind: "failed", code: "wrong_locale", message: options.messages.wrongLocale, run };
    }

    await wait(resolveReviewPollWaitMs(run.pollAfterMs, options.getSourceChars()));

    if (!options.isCurrent()) {
      return { kind: "superseded" };
    }

    const timeoutMs = resolveReviewPollFetchTimeoutMs(options.getSourceChars());
    let reply: ReviewRunReply | null = null;

    for (let attempt = 1; attempt <= REVIEW_POLL_FETCH_MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      options.onRequest?.(controller);

      try {
        reply = await fetchReviewRun(
          { runId: run.runId, capability, locale: options.locale, afterItem: itemCursor, signal: controller.signal },
          options
        );
        break;
      } catch (error) {
        if (!options.isCurrent()) {
          return { kind: "superseded" };
        }

        if (isTransientReviewPollFetchError(error) && attempt < REVIEW_POLL_FETCH_MAX_RETRIES) {
          continue;
        }

        const isAbort = error instanceof Error && error.name === "AbortError";

        return isAbort
          ? { kind: "failed", code: "poll_timeout", message: options.messages.pollTimeout, run }
          : { kind: "failed", code: "network_error", message: describeNetworkError(error, options.messages), run };
      } finally {
        clearTimeout(timer);
        options.onRequest?.(null);
      }
    }

    if (!options.isCurrent()) {
      return { kind: "superseded" };
    }

    if (!reply) {
      return { kind: "failed", code: "poll_timeout", message: options.messages.pollTimeout, run };
    }

    itemCursor = advanceItemCursor(itemCursor, reply);

    if (reply.kind === "error") {
      if (reply.run) {
        options.onSnapshot({ run: reply.run, capability, items: reply.items, itemCursor });
      }

      return { kind: "failed", code: reply.code, message: reply.message, run: reply.run ?? run };
    }

    if (reply.run.locale !== options.locale) {
      return { kind: "failed", code: "wrong_locale", message: options.messages.wrongLocale, run: reply.run };
    }

    if (reply.kind === "result") {
      return { kind: "completed", run: reply.run, result: reply.result };
    }

    run = reply.run;
    capability = reply.capability;
    options.onSnapshot({ run, capability, items: reply.items, itemCursor, ...(reply.plan ? { plan: reply.plan } : {}) });
  }
}

/* ---------- spellcheck ---------- */

export const SPELLCHECK_ENDPOINT = "/api/edit/spellcheck";

export interface SpellcheckApiMessages {
  /** The reply could not be read as a spellcheck result. */
  invalid: string;
  /** The request never reached the server. */
  network: string;
}

/** One finding, with offsets inside the text of its own block. */
export interface SpellFinding {
  blockId: string;
  /** Text of the block the offsets refer to. */
  blockText: string;
  range: SpellcheckRange;
  badText: string;
  suggestions: string[];
  message: string;
  category: SpellcheckIssue["category"];
  ruleId: string;
}

export type SpellcheckReply =
  | {
      kind: "ok";
      findings: SpellFinding[];
      checkedBlocks: number;
      /** Ids of the blocks whose batch the service answered; nothing is known about the others. */
      checkedBlockIds: string[];
      /** Messages of the batches the service could not check; the rest of the result is real. */
      failures: string[];
    }
  | { kind: "error"; message: string }
  | { kind: "aborted" };

/**
 * Moves the findings of one batch (several blocks joined into one text) back to their blocks. A finding
 * that does not lie inside a single block, or whose range does not read as a word of that block, is dropped.
 */
export function mapSpellcheckIssuesToBlocks(chunk: SpellcheckBatchChunk, issues: SpellcheckIssue[]): SpellFinding[] {
  const findings: SpellFinding[] = [];

  for (const issue of issues) {
    const range = issue?.range;

    if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.end <= range.start) {
      continue;
    }

    const owner = chunk.parts.find((part) => range.start >= part.textStart && range.end <= part.textEnd);

    if (!owner) {
      continue;
    }

    const start = range.start - owner.textStart;
    const end = range.end - owner.textStart;
    const suggestions = Array.from(
      new Set(
        (Array.isArray(issue.suggestions) ? issue.suggestions : [])
          .map((suggestion) => (typeof suggestion?.value === "string" ? suggestion.value : ""))
          .filter((value) => value.length > 0)
      )
    );

    findings.push({
      blockId: owner.blockId,
      blockText: owner.text,
      range: { start, end },
      badText: owner.text.slice(start, end),
      suggestions,
      message: typeof issue.message === "string" ? issue.message : "",
      category: issue.category ?? "unknown",
      ruleId: typeof issue.ruleId === "string" ? issue.ruleId : ""
    });
  }

  return findings;
}

export interface SpellcheckRunInput {
  document: EditorDocument;
  locale: AppLocale;
  signal?: AbortSignal;
  /** Check these blocks only (a fragment request); every paragraph and heading when absent. */
  blockIds?: string[];
}

/**
 * Checks every paragraph and heading through `POST /api/edit/spellcheck`, batched into a few requests as in
 * the classic editor. A batch the service could not check is reported in `failures`; when no batch could be
 * checked the whole call is an error. Nothing is ever reported as "no mistakes" without an answer.
 */
export async function runSpellcheck(
  input: SpellcheckRunInput,
  deps: { messages: SpellcheckApiMessages; fetchImpl?: FetchLike }
): Promise<SpellcheckReply> {
  const { document, locale } = input;
  const revision = deriveManuscriptRevisionState(document);
  const targets = getSpellcheckableBlocks(document, revision, input.blockIds ?? revision.blockOrder);
  const chunks = createSpellcheckBatchChunks(targets);
  const doFetch = deps.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const findings: SpellFinding[] = [];
  const failures: string[] = [];
  const checkedBlockIds: string[] = [];
  let checked = 0;

  for (const chunk of chunks) {
    let status = 0;
    let text: string;

    try {
      const response = await doFetch(SPELLCHECK_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        signal: input.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          documentRevisionId: revision.documentRevisionId,
          language: getProductLocaleConfig(locale).spellcheckLanguage,
          provider: "languagetool_public",
          trigger: "manual",
          selection: { blockId: chunk.chunkId, text: chunk.text, range: { start: 0, end: chunk.text.length } }
        })
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        return { kind: "aborted" };
      }

      const detail = error instanceof Error ? error.message.trim() : "";
      failures.push(detail ? `${deps.messages.network} ${detail}` : deps.messages.network);
      continue;
    }

    let payload: Partial<SpellcheckResponse> | null = null;

    try {
      const parsed = JSON.parse(text) as unknown;
      payload = parsed && typeof parsed === "object" ? (parsed as Partial<SpellcheckResponse>) : null;
    } catch {
      payload = null;
    }

    const serverError = typeof payload?.error === "string" && payload.error.trim() ? payload.error.trim() : null;

    if (serverError) {
      failures.push(serverError);
      continue;
    }

    if (!payload || !Array.isArray(payload.issues) || status < 200 || status >= 300) {
      failures.push(withHttpStatus(deps.messages.invalid, status));
      continue;
    }

    checked += chunk.parts.length;
    checkedBlockIds.push(...chunk.parts.map((part) => part.blockId));
    findings.push(...mapSpellcheckIssuesToBlocks(chunk, payload.issues));
  }

  if (chunks.length > 0 && checked === 0) {
    return { kind: "error", message: failures[0] ?? deps.messages.invalid };
  }

  return { kind: "ok", findings, checkedBlocks: checked, checkedBlockIds, failures };
}
