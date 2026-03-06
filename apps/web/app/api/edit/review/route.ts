import { NextResponse } from "next/server";
import type { EditorialReviewRequest, EditorialReviewResponse } from "../../../../lib/editor/review-contract";
import { normalizeModelId, normalizeProvider } from "../../../../lib/editor/settings";
import { generateEditorialReview } from "../../../../lib/server/review-service";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json<EditorialReviewResponse>(
      {
        items: [],
        providerUsed: "invalid-request",
        usedFallback: false,
        error: "Некоректне тіло запиту.",
        diagnostics: {
          requestId: "review-invalid-json",
          requestedProvider: "unknown",
          requestedModelId: "unknown",
          textLength: 0,
          returnedItemCount: 0,
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
        items: [],
        providerUsed: "invalid-request",
        usedFallback: false,
        error: parsed.error,
        diagnostics: {
          requestId: "review-invalid-body",
          requestedProvider: "unknown",
          requestedModelId: "unknown",
          textLength: 0,
          returnedItemCount: 0,
          droppedItemCount: 0,
          generatedAt: new Date().toISOString()
        }
      },
      { status: 400 }
    );
  }

  const response = await generateEditorialReview(parsed.value);
  const status = response.providerUsed === "invalid-text" ? 400 : 200;

  return NextResponse.json<EditorialReviewResponse>(response, { status });
}

function parseEditorialReviewRequest(body: unknown): { ok: true; value: EditorialReviewRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Запит має бути JSON-об'єктом." };
  }

  const record = body as Record<string, unknown>;

  if (typeof record.text !== "string") {
    return { ok: false, error: "Поле text є обов'язковим." };
  }

  const provider = normalizeProvider(typeof record.provider === "string" ? record.provider : "openai");
  const modelId = normalizeModelId(provider, typeof record.modelId === "string" ? record.modelId : "");

  return {
    ok: true,
    value: {
      text: record.text,
      provider,
      modelId,
      apiKey: typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined,
      basePrompt: typeof record.basePrompt === "string" && record.basePrompt.trim() ? record.basePrompt.trim() : undefined
    }
  };
}
