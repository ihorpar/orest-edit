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

  if (!jobId) {
    return NextResponse.json<ReviewImageGenerationResponse>(
      {
        providerUsed: "gemini",
        modelId: "gemini-3.1-flash-image-preview",
        error: "Потрібно передати jobId."
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const job = readReviewImageJob(jobId);

  if (!job) {
    return NextResponse.json<ReviewImageGenerationResponse>(
      {
        providerUsed: "gemini",
        modelId: "gemini-3.1-flash-image-preview",
        error: "Чергу генерації не знайдено або вона вже протермінована."
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
    return NextResponse.json<ReviewImageGenerationResponse>(
      {
        providerUsed: "gemini",
        modelId: "gemini-3.1-flash-image-preview",
        error: "Некоректне тіло запиту."
      },
      { status: 400 }
    );
  }

  const parsed = parseImageRequest(body);

  if (!parsed.ok) {
    return NextResponse.json<ReviewImageGenerationResponse>(
      {
        providerUsed: "gemini",
        modelId: "gemini-3.1-flash-image-preview",
        error: parsed.error
      },
      { status: 400 }
    );
  }

  if (parsed.value.async) {
    const job = createQueuedReviewImageJob();

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
        modelId: "gemini-3.1-flash-image-preview",
        job
      },
      { status: 202 }
    );
  }

  const response = await generateReviewImage(parsed.value);
  const status = response.asset ? 200 : 400;
  return NextResponse.json<ReviewImageGenerationResponse>(response, { status });
}

function parseImageRequest(body: unknown): { ok: true; value: ReviewImageGenerationRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Запит має бути JSON-об'єктом." };
  }

  const record = body as Record<string, unknown>;

  if (typeof record.prompt !== "string") {
    return { ok: false, error: "Поле prompt є обов'язковим." };
  }

  return {
    ok: true,
    value: {
      prompt: record.prompt,
      apiKey: resolveClientProvidedApiKey(record.apiKey),
      async: record.async === true
    }
  };
}
