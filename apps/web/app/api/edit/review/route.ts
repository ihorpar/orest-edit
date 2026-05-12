import { after, NextResponse } from "next/server";
import {
  type EditorialReviewJobResponse,
  normalizeRejectedReviewIdeas,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  type EditorialReviewStepId
} from "../../../../lib/editor/review-contract";
import type { ManuscriptRevisionState } from "../../../../lib/editor/manuscript-structure";
import { normalizeModelId, normalizeProvider } from "../../../../lib/editor/settings";
import { requireApiSession } from "../../../../lib/auth/server-route-auth";
import { resolveClientProvidedApiKey } from "../../../../lib/server/client-api-key-policy";
import {
  buildEditorialReviewJobResponse,
  createQueuedEditorialReviewJob,
  processQueuedEditorialReviewJob,
  readEditorialReviewJob
} from "../../../../lib/server/review-job-service";
import { generateEditorialReview } from "../../../../lib/server/review-service";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authFailure = await requireApiSession(request);

  if (authFailure) {
    return authFailure;
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId")?.trim();

  if (!jobId) {
    return NextResponse.json<EditorialReviewJobResponse>(
      {
        job: buildMissingEditorialReviewJob(),
        error: "Потрібно передати jobId."
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const job = readEditorialReviewJob(jobId);

  if (!job) {
    return NextResponse.json<EditorialReviewJobResponse>(
      {
        job: buildMissingEditorialReviewJob(jobId),
        error: "Чергу review не знайдено або вона вже протермінована. Запустіть крок ще раз."
      },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const payload = buildEditorialReviewJobResponse(job);
  const status =
    job.status === "failed"
      ? 500
      : job.status === "completed" && "error" in payload && payload.error
        ? 502
        : 200;

  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  const authFailure = await requireApiSession(request);

  if (authFailure) {
    return authFailure;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json<EditorialReviewResponse>(
      {
        reviewSessionId: "review-session-invalid-json",
        stepId: "diagnostics",
        stepRunId: "step-run-invalid-json",
        runMode: "replace",
        items: [],
        factCheckRows: [],
        providerUsed: "invalid-request",
        usedFallback: false,
        error: "Некоректне тіло запиту.",
        diagnostics: {
          requestId: "review-invalid-json",
          reviewSessionId: "review-session-invalid-json",
          stepId: "diagnostics",
          stepRunId: "step-run-invalid-json",
          runMode: "replace",
          requestedProvider: "unknown",
          requestedModelId: "unknown",
          blockCount: 0,
          changeLevel: 5,
          returnedItemCount: 0,
          returnedFactCheckCount: 0,
          droppedItemCount: 0,
          generatedAt: new Date().toISOString()
        }
      },
      { status: 400 }
    );
  }

  const parsed = parseEditorialReviewRequest(body);

  if (!parsed.ok) {
    return NextResponse.json<EditorialReviewResponse>(
      {
        reviewSessionId: "review-session-invalid-body",
        stepId: "diagnostics",
        stepRunId: "step-run-invalid-body",
        runMode: "replace",
        items: [],
        factCheckRows: [],
        providerUsed: "invalid-request",
        usedFallback: false,
        error: parsed.error,
        diagnostics: {
          requestId: "review-invalid-body",
          reviewSessionId: "review-session-invalid-body",
          stepId: "diagnostics",
          stepRunId: "step-run-invalid-body",
          runMode: "replace",
          requestedProvider: "unknown",
          requestedModelId: "unknown",
          blockCount: 0,
          changeLevel: 5,
          returnedItemCount: 0,
          returnedFactCheckCount: 0,
          droppedItemCount: 0,
          generatedAt: new Date().toISOString()
        }
      },
      { status: 400 }
    );
  }

  if (parsed.value.async !== false) {
    const job = createQueuedEditorialReviewJob();

    scheduleAfter(async () => {
      try {
        await processQueuedEditorialReviewJob(job.id, parsed.value);
      } catch (error) {
        console.error("Не вдалося завершити editorial review job.", error);
      }
    });

    return NextResponse.json<EditorialReviewJobResponse>({ job }, { status: 202 });
  }

  const response = await generateEditorialReview(parsed.value);
  const status = response.providerUsed === "invalid-text" ? 400 : response.error ? 502 : 200;

  return NextResponse.json<EditorialReviewResponse>(response, { status });
}

function scheduleAfter(task: () => Promise<void>) {
  try {
    after(task);
  } catch (error) {
    if (error instanceof Error && error.message.includes("outside a request scope")) {
      void task();
      return;
    }

    throw error;
  }
}

function buildMissingEditorialReviewJob(id = "review-job-missing"): EditorialReviewJobResponse["job"] {
  const timestamp = new Date().toISOString();

  return {
    id,
    status: "failed",
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp,
    pollAfterMs: 0
  };
}

function parseEditorialReviewRequest(body: unknown): { ok: true; value: EditorialReviewRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Запит має бути JSON-об'єктом." };
  }

  const record = body as Record<string, unknown>;

  if (!record.document || typeof record.document !== "object") {
    return { ok: false, error: "Поле document є обов'язковим." };
  }

  const provider = normalizeProvider(typeof record.provider === "string" ? record.provider : "openai");
  const modelId = normalizeModelId(provider, typeof record.modelId === "string" ? record.modelId : "");
  const revision = record.revision as ManuscriptRevisionState | undefined;

  if (!revision || typeof revision !== "object" || typeof revision.documentRevisionId !== "string" || !Array.isArray(revision.blockOrder)) {
    return { ok: false, error: "Потрібно передати поточний revision рукопису." };
  }

  const changeLevel = typeof record.changeLevel === "number" ? Math.max(1, Math.min(5, Math.floor(record.changeLevel))) : 5;

  return {
    ok: true,
    value: {
      document: record.document as EditorialReviewRequest["document"],
      revision,
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
                : undefined
          }
          : undefined,
      expertise: typeof record.expertise === "string" && record.expertise.trim() ? record.expertise.trim() : undefined,
      rejectedIdeas: normalizeRejectedReviewIdeas(record.rejectedIdeas)
    }
  };
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
