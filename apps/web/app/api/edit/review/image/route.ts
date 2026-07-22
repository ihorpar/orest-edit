import { after, NextResponse } from "next/server";
import type { ReviewImageGenerationRequest, ReviewImageGenerationResponse } from "../../../../../lib/editor/review-contract";
import { requireApiSession } from "../../../../../lib/auth/server-route-auth";
import { resolveClientProvidedApiKey } from "../../../../../lib/server/client-api-key-policy";
import {
  buildReviewImageJobResponse,
  createQueuedReviewImageJob,
  processQueuedReviewImageJob,
  readReviewImageJob
} from "../../../../../lib/server/review-image-job-service";
import { generateReviewImage } from "../../../../../lib/server/review-image-service";
import {
  DEFAULT_VISUAL_IMAGE_QUALITY,
  getVisualImageQualityProfile,
  normalizeVisualImageQuality
} from "../../../../../lib/editor/settings";
import { isAppLocale, type AppLocale } from "../../../../../lib/i18n/product-locale";
import { getApiErrors, getDefaultAppLocale, resolveQueryLocale, resolveRequestLocale, type ApiErrors } from "../../../../../lib/i18n/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authFailure = await requireApiSession(request);

  if (authFailure) {
    return authFailure;
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId")?.trim();
  const errors = getApiErrors(resolveQueryLocale(searchParams));
  const fallbackModelId = getVisualImageQualityProfile(DEFAULT_VISUAL_IMAGE_QUALITY).modelId;

  if (!jobId) {
    return NextResponse.json<ReviewImageGenerationResponse>(
      {
        providerUsed: "gemini",
        modelId: fallbackModelId,
        error: errors.jobIdRequired
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const job = readReviewImageJob(jobId);

  if (!job) {
    return NextResponse.json<ReviewImageGenerationResponse>(
      {
        providerUsed: "gemini",
        modelId: fallbackModelId,
        error: errors.imageJobNotFound
      },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json<ReviewImageGenerationResponse>(buildReviewImageJobResponse(job), {
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
    const errors = getApiErrors(getDefaultAppLocale());
    const fallbackModelId = getVisualImageQualityProfile(DEFAULT_VISUAL_IMAGE_QUALITY).modelId;

    return NextResponse.json<ReviewImageGenerationResponse>(
      {
        providerUsed: "gemini",
        modelId: fallbackModelId,
        error: errors.invalidRequestBody
      },
      { status: 400 }
    );
  }

  const parsed = parseImageRequest(body, getApiErrors(resolveRequestLocale(body)));

  if (!parsed.ok) {
    return NextResponse.json<ReviewImageGenerationResponse>(
      {
        providerUsed: "gemini",
        modelId: getVisualImageQualityProfile(DEFAULT_VISUAL_IMAGE_QUALITY).modelId,
        error: parsed.error
      },
      { status: 400 }
    );
  }

  if (parsed.value.async) {
    const job = createQueuedReviewImageJob({
      locale: parsed.value.locale,
      imageQuality: parsed.value.imageQuality
    });

    after(async () => {
      try {
        await processQueuedReviewImageJob(job.id, parsed.value);
      } catch (error) {
        console.error("Не вдалося завершити review-image job.", error);
      }
    });

    return NextResponse.json<ReviewImageGenerationResponse>(
      {
        providerUsed: "gemini",
        modelId: getVisualImageQualityProfile(normalizeVisualImageQuality(parsed.value.imageQuality)).modelId,
        job
      },
      { status: 202 }
    );
  }

  const response = await generateReviewImage(parsed.value);
  const status = response.asset ? 200 : 400;
  return NextResponse.json<ReviewImageGenerationResponse>(response, { status });
}

function parseImageRequest(
  body: unknown,
  errors: ApiErrors
): { ok: true; value: ReviewImageGenerationRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: errors.requestMustBeJsonObject };
  }

  const record = body as Record<string, unknown>;

  if (typeof record.prompt !== "string") {
    return { ok: false, error: errors.promptRequired };
  }

  return {
    ok: true,
    value: {
      prompt: record.prompt,
      locale: parseAppLocale(record.locale),
      apiKey: resolveClientProvidedApiKey(record.apiKey),
      async: record.async === true,
      imageQuality: normalizeVisualImageQuality(record.imageQuality)
    }
  };
}

function parseAppLocale(value: unknown): AppLocale | undefined {
  return isAppLocale(value) ? value : undefined;
}
