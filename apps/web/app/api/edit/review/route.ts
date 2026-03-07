import { NextResponse } from "next/server";
import type { EditorialReviewRequest, EditorialReviewResponse } from "../../../../lib/editor/review-contract";
import type { ManuscriptRevisionState } from "../../../../lib/editor/manuscript-structure";
import { normalizeModelId, normalizeProvider } from "../../../../lib/editor/settings";
import { generateEditorialReview } from "../../../../lib/server/review-service";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json<EditorialReviewResponse>(
      {
        reviewSessionId: "review-session-invalid-json",
        items: [],
        providerUsed: "invalid-request",
        usedFallback: false,
        error: "Некоректне тіло запиту.",
        diagnostics: {
          requestId: "review-invalid-json",
          reviewSessionId: "review-session-invalid-json",
          requestedProvider: "unknown",
          requestedModelId: "unknown",
          textLength: 0,
          changeLevel: 3,
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
        reviewSessionId: "review-session-invalid-body",
        items: [],
        providerUsed: "invalid-request",
        usedFallback: false,
        error: parsed.error,
        diagnostics: {
          requestId: "review-invalid-body",
          reviewSessionId: "review-session-invalid-body",
          requestedProvider: "unknown",
          requestedModelId: "unknown",
          textLength: 0,
          changeLevel: 3,
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
  const revision = record.revision as ManuscriptRevisionState | undefined;

  if (!revision || typeof revision !== "object" || typeof revision.documentRevisionId !== "string" || !Array.isArray(revision.paragraphOrder)) {
    return { ok: false, error: "Потрібно передати поточний revision рукопису." };
  }

  const changeLevel = typeof record.changeLevel === "number" ? Math.max(1, Math.min(5, Math.floor(record.changeLevel))) : 3;

  return {
    ok: true,
    value: {
      text: record.text,
      revision,
      provider,
      modelId,
      apiKey: typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined,
      basePrompt: typeof record.basePrompt === "string" && record.basePrompt.trim() ? record.basePrompt.trim() : undefined,
      reviewPrompt: typeof record.reviewPrompt === "string" && record.reviewPrompt.trim() ? record.reviewPrompt.trim() : undefined,
      reviewLevelGuide: typeof record.reviewLevelGuide === "string" && record.reviewLevelGuide.trim() ? record.reviewLevelGuide.trim() : undefined,
      calloutPromptTemplate:
        typeof record.calloutPromptTemplate === "string" && record.calloutPromptTemplate.trim() ? record.calloutPromptTemplate.trim() : undefined,
      changeLevel: changeLevel as EditorialReviewRequest["changeLevel"],
      additionalInstructions:
        typeof record.additionalInstructions === "string" && record.additionalInstructions.trim() ? record.additionalInstructions.trim() : undefined
    }
  };
}
