import { NextResponse } from "next/server";
import type { ReviewImageGenerationRequest, ReviewImageGenerationResponse } from "../../../../../lib/editor/review-contract";
import { generateReviewImage } from "../../../../../lib/server/review-image-service";

export async function POST(request: Request) {
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
      apiKey: typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined
    }
  };
}
