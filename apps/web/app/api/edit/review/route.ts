import { NextResponse } from "next/server";
import { getRun, start, type Run } from "workflow/api";
import {
  type CustomRequestPlan,
  CUSTOM_REQUEST_PLAN_RECOMMENDATION_TYPES,
  type EditorialReviewRunApiResponse,
  type EditorialReviewRunIdentity,
  type EditorialReviewRunProgress,
  type EditorialReviewRunSnapshot,
  normalizeRejectedReviewIdeas,
  isDiagnosticsMode,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  type EditorialReviewItem,
  type EditorialReviewRecommendationType,
  type EditorialReviewStepId
} from "../../../../lib/editor/review-contract";
import type { ManuscriptRevisionState } from "../../../../lib/editor/manuscript-structure";
import { getDocumentTextStats } from "../../../../lib/editor/document-model";
import { normalizeModelId, normalizeProvider } from "../../../../lib/editor/settings";
import { requireApiSession } from "../../../../lib/auth/server-route-auth";
import { resolveClientProvidedApiKey } from "../../../../lib/server/client-api-key-policy";
import { REVIEW_PLAN_NAMESPACE } from "../../../../lib/server/custom-request-plan";
import {
  editorialReviewWorkflow,
  parseEditorialReviewWorkflowFailure
} from "../../../../lib/server/editorial-review-workflow";
import { planReviewChunks } from "../../../../lib/server/review-chunk-planner";
import {
  accumulateReviewPartialItemBatches,
  buildReviewChunkProgress,
  consumeWorkflowReadableBatches,
  isChunkedRecommendationStep,
  isCustomRequestPlanStep,
  latestReviewProgress,
  parseReviewItemCursor,
  REVIEW_PARTIAL_ITEMS_NAMESPACE,
  reviewRunPollAfterMs,
  sliceReviewItemsAfterCursor,
  sumChunkSourceChars
} from "../../../../lib/server/review-chunk-runtime";
import {
  assertReviewRunCapabilityConfigured,
  createReviewRunCapability,
  verifyReviewRunCapability
} from "../../../../lib/server/review-run-capability";
import { generateEditorialReview } from "../../../../lib/server/review-service";
import { logEditorialReviewEvent } from "../../../../lib/server/review-observability";
import {
  interpretCompletedEditorialReviewReturnValue,
  sanitizeExposedErrorMessage,
  toTerminalFailedRunSnapshot
} from "../../../../lib/editor/review-run-recovery";
import { isAppLocale, type AppLocale } from "../../../../lib/i18n/product-locale";
import { getApiErrors, getDefaultAppLocale, resolveQueryLocale, resolveRequestLocale, type ApiErrors } from "../../../../lib/i18n/api-errors";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authFailure = await requireApiSession(request);

  if (authFailure) {
    return normalizeReviewAuthFailure(authFailure);
  }

  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId")?.trim();
  const afterItem = parseReviewItemCursor(searchParams.get("afterItem"));
  const capability = request.headers.get("x-review-run-capability")?.trim();
  const errors = getApiErrors(resolveQueryLocale(searchParams));

  if (!runId || !capability) {
    return jsonRunError("invalid_request", errors.jobIdRequired, false, 400);
  }

  let identity: EditorialReviewRunIdentity;

  try {
    const verified = await verifyReviewRunCapability(capability, runId);

    if (!verified) {
      return jsonRunError("run_access_denied", resolveRunMessage(searchParams, "accessDenied"), false, 403);
    }

    identity = verified;
  } catch (error) {
    return jsonRunError(
      "workflow_unavailable",
      sanitizeExposedErrorMessage(toErrorMessage(error), errors.reviewResultInvalid),
      false,
      503
    );
  }

  try {
    const run = getRun<EditorialReviewResponse>(runId);

    if (!(await run.exists)) {
      return jsonRunError("run_not_found", resolveRunMessage(searchParams, "notFound"), false, 404);
    }

    const status = await run.status;
    const snapshot = await buildRunSnapshot(identity, run, status);
    const allPartialItems = await readReviewPartialItems(run);
    const partialSlice = sliceReviewItemsAfterCursor(allPartialItems, afterItem);
    const plan = await readReviewPlan(run);

    try {
      if (status === "completed") {
        const rawResult = await run.returnValue;
        const completed = interpretCompletedEditorialReviewReturnValue(rawResult, errors.reviewResultInvalid);

        if (!completed.ok) {
          logEditorialReviewEvent("run_failed", {
            runId,
            step: identity.stepId,
            provider: identity.provider,
            model: identity.modelId
          }, "error");
          return jsonRunError(
            "workflow_failed",
            completed.message,
            false,
            502,
            toTerminalFailedRunSnapshot(snapshot),
            partialSlice
          );
        }

        const result = completed.result;

        if (result.error) {
          logEditorialReviewEvent("run_provider_failed", {
            runId,
            requestId: result.diagnostics.requestId,
            step: identity.stepId,
            provider: identity.provider,
            model: identity.modelId,
            providerStatus: result.diagnostics.providerError?.status,
            providerRequestId: result.diagnostics.providerError?.requestId
          }, "error");
          return NextResponse.json<EditorialReviewRunApiResponse>(
            {
              kind: "error",
              run: snapshot,
              error: {
                code: "provider_failed",
                message: result.error,
                retryable: result.diagnostics.providerError?.retryable ?? false,
                providerStatus: result.diagnostics.providerError?.status,
                providerRequestId: result.diagnostics.providerError?.requestId,
                retryAfterMs: result.diagnostics.providerError?.retryAfterMs
              },
              ...(() => {
                const errorSlice = (allPartialItems?.length ?? 0) > 0
                  ? partialSlice
                  : sliceReviewItemsAfterCursor(result.items, afterItem);
                return {
                  items: errorSlice.items,
                  itemCursor: errorSlice.itemCursor,
                  itemCount: errorSlice.itemCount
                };
              })()
            },
            noStore(502)
          );
        }

        logEditorialReviewEvent("run_completed", {
          runId,
          requestId: result.diagnostics.requestId,
          step: identity.stepId,
          provider: identity.provider,
          model: identity.modelId,
          returnedItems: result.items.length
        });

        return NextResponse.json<EditorialReviewRunApiResponse>(
          { kind: "result", run: { ...snapshot, status: "completed" }, result },
          noStore(200)
        );
      }

      if (status === "failed") {
        const failure = await readFailedRunError(run, errors.reviewResultInvalid);
        logEditorialReviewEvent("run_failed", {
          runId,
          step: identity.stepId,
          provider: identity.provider,
          model: identity.modelId,
          providerStatus: failure.provider?.status,
          providerRequestId: failure.provider?.requestId
        }, "error");
        return NextResponse.json<EditorialReviewRunApiResponse>(
          {
            kind: "error",
            run: snapshot,
            error: {
              code: failure.provider ? "provider_failed" : "workflow_failed",
              message: failure.message,
              retryable: failure.provider?.retryable ?? false,
              providerStatus: failure.provider?.status,
              providerRequestId: failure.provider?.requestId,
              retryAfterMs: failure.provider?.retryAfterMs
            },
            items: partialSlice.items,
            itemCursor: partialSlice.itemCursor,
            itemCount: partialSlice.itemCount
          },
          noStore(500)
        );
      }

      if (status === "cancelled") {
        return NextResponse.json<EditorialReviewRunApiResponse>(
          {
            kind: "error",
            run: snapshot,
            error: {
              code: "run_cancelled",
              message: resolveRunMessage(searchParams, "cancelled"),
              retryable: false
            }
          },
          noStore(409)
        );
      }

      return NextResponse.json<EditorialReviewRunApiResponse>(
        {
          kind: "run",
          run: snapshot,
          capability,
          items: partialSlice.items,
          itemCursor: partialSlice.itemCursor,
          itemCount: partialSlice.itemCount,
          ...(plan ? { plan } : {})
        },
        noStore(200)
      );
    } catch (error) {
      return jsonRunError(
        "workflow_unavailable",
        sanitizeExposedErrorMessage(toErrorMessage(error), errors.reviewResultInvalid),
        true,
        503,
        toTerminalFailedRunSnapshot(snapshot),
        partialSlice
      );
    }
  } catch (error) {
    return jsonRunError(
      "workflow_unavailable",
      sanitizeExposedErrorMessage(toErrorMessage(error), errors.reviewResultInvalid),
      true,
      503
    );
  }
}

export async function DELETE(request: Request) {
  const authFailure = await requireApiSession(request);

  if (authFailure) {
    return normalizeReviewAuthFailure(authFailure);
  }

  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId")?.trim();
  const capability = request.headers.get("x-review-run-capability")?.trim();
  const errors = getApiErrors(resolveQueryLocale(searchParams));

  if (!runId || !capability) {
    return jsonRunError("invalid_request", errors.jobIdRequired, false, 400);
  }

  try {
    const verified = await verifyReviewRunCapability(capability, runId);

    if (!verified) {
      return jsonRunError("run_access_denied", resolveRunMessage(searchParams, "accessDenied"), false, 403);
    }

    const run = getRun<EditorialReviewResponse>(runId);

    if (await run.exists) {
      try {
        await run.cancel();
      } catch {
        // Already terminal or not cancellable; the client still drops the local poll.
      }
    }

    logEditorialReviewEvent("run_cancelled", {
      runId,
      step: verified.stepId,
      provider: verified.provider,
      model: verified.modelId
    });

    return NextResponse.json<EditorialReviewRunApiResponse>(
      {
        kind: "error",
        error: {
          code: "run_cancelled",
          message: resolveRunMessage(searchParams, "cancelled"),
          retryable: false
        }
      },
      noStore(200)
    );
  } catch (error) {
    return jsonRunError(
      "workflow_unavailable",
      sanitizeExposedErrorMessage(toErrorMessage(error), errors.reviewResultInvalid),
      true,
      503
    );
  }
}

export async function POST(request: Request) {
  const authFailure = await requireApiSession(request);

  if (authFailure) {
    return normalizeReviewAuthFailure(authFailure);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    const errors = getApiErrors(getDefaultAppLocale());

    return jsonRunError("invalid_request", errors.invalidRequestBody, false, 400);
  }

  const parsed = parseEditorialReviewRequest(body, getApiErrors(resolveRequestLocale(body)));

  if (!parsed.ok) {
    return jsonRunError("invalid_request", parsed.error, false, 400);
  }

  if (parsed.value.async !== false) {
    try {
      assertReviewRunCapabilityConfigured();
      const run = await start(editorialReviewWorkflow, [{ request: parsed.value }]);
      const createdAt = (await run.createdAt).toISOString();
      const identity = buildRunIdentity(parsed.value, run.runId, createdAt);
      const capability = await createReviewRunCapability(identity);
      const snapshot = await buildRunSnapshot(identity, run, await run.status);
      if (!snapshot.progress) {
        snapshot.progress = seedChunkProgress(parsed.value);
      }
      snapshot.pollAfterMs = reviewRunPollAfterMs(
        snapshot.status,
        identity.stepId,
        snapshot.progress?.totalSourceChars ?? getDocumentTextStats(parsed.value.document).charactersWithSpaces
      );

      logEditorialReviewEvent("run_started", {
        runId: run.runId,
        step: identity.stepId,
        provider: identity.provider,
        model: identity.modelId,
        runMode: identity.runMode,
        documentRevisionId: identity.documentRevisionId
      });

      return NextResponse.json<EditorialReviewRunApiResponse>(
        { kind: "run", run: snapshot, capability },
        noStore(202)
      );
    } catch (error) {
      return jsonRunError(
        "workflow_unavailable",
        sanitizeExposedErrorMessage(
          toErrorMessage(error),
          getApiErrors(resolveRequestLocale(parsed.value)).reviewResultInvalid
        ),
        true,
        503
      );
    }
  }

  const response = await generateEditorialReview(parsed.value);
  const status = response.providerUsed === "invalid-text" ? 400 : response.error ? 502 : 200;
  const createdAt = response.diagnostics.generatedAt;
  const identity = buildRunIdentity(parsed.value, `diagnostic-${response.stepRunId}`, createdAt);
  const snapshot: EditorialReviewRunSnapshot & { status: "completed" } = {
    ...identity,
    status: "completed",
    updatedAt: createdAt,
    pollAfterMs: 0
  };

  if (response.error) {
    return NextResponse.json<EditorialReviewRunApiResponse>(
      {
        kind: "error",
        run: snapshot,
        error: {
          code: "provider_failed",
          message: response.error,
          retryable: response.diagnostics.providerError?.retryable ?? false,
          providerStatus: response.diagnostics.providerError?.status,
          providerRequestId: response.diagnostics.providerError?.requestId,
          retryAfterMs: response.diagnostics.providerError?.retryAfterMs
        }
      },
      noStore(status)
    );
  }

  return NextResponse.json<EditorialReviewRunApiResponse>(
    { kind: "result", run: snapshot, result: response },
    noStore(status)
  );
}

function buildRunIdentity(
  request: EditorialReviewRequest,
  runId: string,
  createdAt: string
): EditorialReviewRunIdentity {
  const stepId = request.stepId ?? "diagnostics";

  return {
    runId,
    documentRevisionId: request.revision.documentRevisionId,
    stepId,
    locale: request.locale ?? getDefaultAppLocale(),
    provider: request.provider,
    modelId: request.modelId,
    runMode:
      stepId === "final_editing" && request.customRequestPlanAction
        ? (request.runMode === "preserve" ? "preserve" : "replace")
        : stepId === "final_editing"
          ? "replace"
          : request.runMode === "preserve"
            ? "preserve"
            : "replace",
    createdAt
  };
}

async function buildRunSnapshot(
  identity: EditorialReviewRunIdentity,
  run: Run<EditorialReviewResponse>,
  status: EditorialReviewRunSnapshot["status"],
  sourceCharsHint = 0
): Promise<EditorialReviewRunSnapshot> {
  const updatedAt =
    (status === "completed" || status === "failed" || status === "cancelled"
      ? await run.completedAt
      : await run.startedAt) ?? (await run.createdAt);
  const progress = await readReviewProgress(run);
  const sourceChars = progress?.totalSourceChars ?? sourceCharsHint;

  return {
    ...identity,
    status,
    updatedAt: updatedAt.toISOString(),
    pollAfterMs: reviewRunPollAfterMs(status, identity.stepId, sourceChars),
    progress
  };
}

async function readFailedRunError(
  run: Run<EditorialReviewResponse>,
  invalidMessage: string
): Promise<{
  message: string;
  provider: ReturnType<typeof parseEditorialReviewWorkflowFailure>;
}> {
  try {
    await run.returnValue;
  } catch (error) {
    if (error && typeof error === "object" && "cause" in error) {
      const cause = (error as { cause?: unknown }).cause;

      if (cause instanceof Error && cause.message) {
        const parsed = parseEditorialReviewWorkflowFailure(cause.message);
        return {
          message: sanitizeExposedErrorMessage(parsed?.message ?? cause.message, invalidMessage),
          provider: parsed
        };
      }
    }

    const message = toErrorMessage(error);
    const parsed = parseEditorialReviewWorkflowFailure(message);
    return {
      message: sanitizeExposedErrorMessage(parsed?.message ?? message, invalidMessage),
      provider: parsed
    };
  }

  return { message: invalidMessage, provider: null };
}

function seedChunkProgress(request: EditorialReviewRequest): EditorialReviewRunProgress | undefined {
  if (isCustomRequestPlanStep(request.stepId)) {
    return {
      phase: "planning",
      completedChunks: 0,
      totalChunks: 1
    };
  }

  if (!isChunkedRecommendationStep(request.stepId)) {
    return undefined;
  }

  const chunks = planReviewChunks(request.document.blocks);
  if (chunks.length === 0) {
    return undefined;
  }

  return buildReviewChunkProgress({
    completedChunks: 0,
    totalChunks: chunks.length,
    completedSourceChars: 0,
    totalSourceChars: sumChunkSourceChars(chunks, chunks.length)
  });
}

async function readReviewProgress(
  run: Run<EditorialReviewResponse>
): Promise<EditorialReviewRunProgress | undefined> {
  const stream = run.getReadable<EditorialReviewRunProgress>({
    namespace: "review-progress"
  });
  const batches = await consumeWorkflowReadableBatches(stream, { waitForClose: false });
  return latestReviewProgress(batches);
}

async function readReviewPlan(
  run: Run<EditorialReviewResponse>
): Promise<CustomRequestPlan | undefined> {
  const stream = run.getReadable<CustomRequestPlan>({
    namespace: REVIEW_PLAN_NAMESPACE
  });
  const batches = await consumeWorkflowReadableBatches(stream, { waitForClose: false });
  for (let index = batches.length - 1; index >= 0; index -= 1) {
    const batch = batches[index];
    if (batch && typeof batch === "object" && Array.isArray((batch as CustomRequestPlan).actions)) {
      return batch as CustomRequestPlan;
    }
  }
  return undefined;
}

async function readReviewPartialItems(
  run: Run<EditorialReviewResponse>
): Promise<EditorialReviewItem[] | undefined> {
  const stream = run.getReadable<EditorialReviewItem[]>({
    namespace: REVIEW_PARTIAL_ITEMS_NAMESPACE
  });
  const batches = await consumeWorkflowReadableBatches(stream, { waitForClose: false });
  const items = accumulateReviewPartialItemBatches(
    batches.filter((batch): batch is EditorialReviewItem[] => Array.isArray(batch) && batch.length > 0)
  );

  return items.length > 0 ? items : undefined;
}

function jsonRunError(
  code: Extract<EditorialReviewRunApiResponse, { kind: "error" }>["error"]["code"],
  message: string,
  retryable: boolean,
  status: number,
  run?: EditorialReviewRunSnapshot,
  itemSlice?: {
    items?: EditorialReviewItem[];
    itemCursor: number;
    itemCount: number;
  }
) {
  return NextResponse.json<EditorialReviewRunApiResponse>(
    {
      kind: "error",
      error: { code, message, retryable },
      ...(run ? { run } : {}),
      ...(itemSlice?.items && itemSlice.items.length > 0 ? { items: itemSlice.items } : {}),
      ...(itemSlice ? { itemCursor: itemSlice.itemCursor, itemCount: itemSlice.itemCount } : {})
    },
    noStore(status)
  );
}

async function normalizeReviewAuthFailure(response: NextResponse) {
  let message = response.status === 401 ? "Authentication is required." : "Server authentication is unavailable.";

  try {
    const body = await response.clone().json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      message = body.error;
    }
  } catch {
    // Preserve the explicit fallback message in the discriminated envelope.
  }

  return jsonRunError(
    response.status === 401 ? "authentication_required" : "workflow_unavailable",
    message,
    response.status >= 500,
    response.status
  );
}

function noStore(status: number) {
  return { status, headers: { "Cache-Control": "no-store" } };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Workflow is unavailable.";
}

function resolveRunMessage(
  searchParams: URLSearchParams,
  key: "accessDenied" | "notFound" | "cancelled"
): string {
  const locale = resolveQueryLocale(searchParams);
  const messages = locale === "en"
    ? {
        accessDenied: "This review run cannot be opened from this browser.",
        notFound: "The review run was not found or is no longer retained.",
        cancelled: "The review run was cancelled."
      }
    : {
        accessDenied: "Цей запуск перевірки не можна відкрити в цьому браузері.",
        notFound: "Запуск перевірки не знайдено або його дані вже не зберігаються.",
        cancelled: "Запуск перевірки скасовано."
      };

  return messages[key];
}

function parseEditorialReviewRequest(
  body: unknown,
  errors: ApiErrors
): { ok: true; value: EditorialReviewRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: errors.requestMustBeJsonObject };
  }

  const record = body as Record<string, unknown>;

  if (!record.document || typeof record.document !== "object") {
    return { ok: false, error: errors.documentRequired };
  }

  const provider = normalizeProvider(typeof record.provider === "string" ? record.provider : "openai");
  const modelId = normalizeModelId(provider, typeof record.modelId === "string" ? record.modelId : "");
  const revision = record.revision as ManuscriptRevisionState | undefined;

  if (!revision || typeof revision !== "object" || typeof revision.documentRevisionId !== "string" || !Array.isArray(revision.blockOrder)) {
    return { ok: false, error: errors.manuscriptRevisionRequired };
  }

  const changeLevel = typeof record.changeLevel === "number" ? Math.max(1, Math.min(5, Math.floor(record.changeLevel))) : 5;

  return {
    ok: true,
    value: {
      document: record.document as EditorialReviewRequest["document"],
      revision,
      locale: parseAppLocale(record.locale),
      provider,
      modelId,
      apiKey: resolveClientProvidedApiKey(record.apiKey),
      async: record.async !== false,
      basePrompt: typeof record.basePrompt === "string" && record.basePrompt.trim() ? record.basePrompt.trim() : undefined,
      reviewPrompt: typeof record.reviewPrompt === "string" && record.reviewPrompt.trim() ? record.reviewPrompt.trim() : undefined,
      expertisePrompt: typeof record.expertisePrompt === "string" && record.expertisePrompt.trim() ? record.expertisePrompt.trim() : undefined,
      cardsPrompt: typeof record.cardsPrompt === "string" && record.cardsPrompt.trim() ? record.cardsPrompt.trim() : undefined,
      reviewLevelGuide: typeof record.reviewLevelGuide === "string" && record.reviewLevelGuide.trim() ? record.reviewLevelGuide.trim() : undefined,
      workflowStepPrompts: parseWorkflowStepPrompts(record.workflowStepPrompts),
      calloutPromptTemplate:
        typeof record.calloutPromptTemplate === "string" && record.calloutPromptTemplate.trim() ? record.calloutPromptTemplate.trim() : undefined,
      changeLevel: changeLevel as EditorialReviewRequest["changeLevel"],
      additionalInstructions:
        typeof record.additionalInstructions === "string" && record.additionalInstructions.trim() ? record.additionalInstructions.trim() : undefined,
      history: Array.isArray(record.history) ? (record.history as any[]) : undefined,
      currentStatus: (record.currentStatus === "expertise" || record.currentStatus === "cards") ? record.currentStatus : undefined,
      stepId: parseStepId(record.stepId),
      runMode: record.runMode === "preserve" || record.runMode === "replace" ? record.runMode : undefined,
      stepFeedback: typeof record.stepFeedback === "string" && record.stepFeedback.trim() ? record.stepFeedback.trim() : undefined,
      stepContext:
        record.stepContext && typeof record.stepContext === "object"
          ? {
            diagnosticsExpertise:
              typeof (record.stepContext as Record<string, unknown>).diagnosticsExpertise === "string" &&
                (record.stepContext as Record<string, unknown>).diagnosticsExpertise?.toString().trim()
                ? String((record.stepContext as Record<string, unknown>).diagnosticsExpertise).trim()
                : undefined,
            diagnosticsFeedback:
              typeof (record.stepContext as Record<string, unknown>).diagnosticsFeedback === "string" &&
                (record.stepContext as Record<string, unknown>).diagnosticsFeedback?.toString().trim()
                ? String((record.stepContext as Record<string, unknown>).diagnosticsFeedback).trim()
                : undefined,
            currentStepFeedback:
              typeof (record.stepContext as Record<string, unknown>).currentStepFeedback === "string" &&
                (record.stepContext as Record<string, unknown>).currentStepFeedback?.toString().trim()
                ? String((record.stepContext as Record<string, unknown>).currentStepFeedback).trim()
                : undefined,
            diagnosticsMode: (() => {
              const mode = (record.stepContext as Record<string, unknown>).diagnosticsMode;
              return isDiagnosticsMode(mode) ? mode : undefined;
            })()
          }
          : undefined,
      expertise: typeof record.expertise === "string" && record.expertise.trim() ? record.expertise.trim() : undefined,
      rejectedIdeas: normalizeRejectedReviewIdeas(record.rejectedIdeas),
      reviewChunk: parseReviewChunkScope(record.reviewChunk),
      customRequestPlanAction: parseCustomRequestPlanAction(record.customRequestPlanAction),
      customRequestPlan: parseCustomRequestPlan(record.customRequestPlan),
      customRequestPlanOnly: record.customRequestPlanOnly === true
    }
  };
}

function parseReviewChunkScope(value: unknown): EditorialReviewRequest["reviewChunk"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.index !== "number" ||
    typeof record.total !== "number" ||
    !Array.isArray(record.coreBlockIds) ||
    !record.coreBlockIds.every((blockId) => typeof blockId === "string")
  ) {
    return undefined;
  }

  return {
    index: record.index,
    total: record.total,
    coreBlockIds: record.coreBlockIds as string[],
    contextBlockIds: Array.isArray(record.contextBlockIds)
      ? record.contextBlockIds.filter((blockId): blockId is string => typeof blockId === "string")
      : []
  };
}

function parseCustomRequestPlanAction(value: unknown): EditorialReviewRequest["customRequestPlanAction"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const recommendationType = typeof record.recommendationType === "string"
    ? record.recommendationType.trim()
    : "";
  if (
    typeof record.blockId !== "string" ||
    !CUSTOM_REQUEST_PLAN_RECOMMENDATION_TYPES.includes(recommendationType as EditorialReviewRecommendationType) ||
    typeof record.title !== "string" ||
    typeof record.recommendation !== "string"
  ) {
    return undefined;
  }

  return {
    blockId: record.blockId.trim(),
    recommendationType: recommendationType as EditorialReviewRecommendationType,
    title: record.title.trim(),
    recommendation: record.recommendation.trim(),
    priority: record.priority === "high" || record.priority === "low" ? record.priority : "medium",
    index: typeof record.index === "number" ? record.index : undefined
  };
}

function parseCustomRequestPlan(value: unknown): EditorialReviewRequest["customRequestPlan"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.actions)) {
    return undefined;
  }

  const actions = record.actions
    .map((action) => parseCustomRequestPlanAction(action))
    .filter((action): action is NonNullable<EditorialReviewRequest["customRequestPlanAction"]> => Boolean(action))
    .map(({ index: _index, ...action }) => action);

  if (actions.length === 0) {
    return undefined;
  }

  return {
    actions,
    documentRevisionId: typeof record.documentRevisionId === "string" ? record.documentRevisionId : undefined,
    stepRunId: typeof record.stepRunId === "string" ? record.stepRunId : undefined
  };
}

function parseAppLocale(value: unknown): AppLocale | undefined {
  return isAppLocale(value) ? value : undefined;
}

function parseWorkflowStepPrompts(value: unknown): EditorialReviewRequest["workflowStepPrompts"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const stepIds: EditorialReviewStepId[] = [
    "diagnostics",
    "fact_check",
    "structure",
    "clarity",
    "interest",
    "visuals",
    "formatting",
    "emphasis",
    "final_editing"
  ];
  const parsed = stepIds.reduce((result, stepId) => {
    const prompt = record[stepId];

    if (typeof prompt === "string" && prompt.trim()) {
      result[stepId] = prompt.trim();
    }

    return result;
  }, {} as NonNullable<EditorialReviewRequest["workflowStepPrompts"]>);

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseStepId(value: unknown): EditorialReviewStepId | undefined {
  if (
    value === "diagnostics" ||
    value === "fact_check" ||
    value === "structure" ||
    value === "clarity" ||
    value === "interest" ||
    value === "visuals" ||
    value === "formatting" ||
    value === "emphasis" ||
    value === "final_editing"
  ) {
    return value;
  }

  return undefined;
}
