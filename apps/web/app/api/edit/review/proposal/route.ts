import { NextResponse } from "next/server";
import type { ReviewActionRequest, ReviewActionResponse } from "../../../../../lib/editor/review-contract";
import { normalizeModelId, normalizeProvider } from "../../../../../lib/editor/settings";
import { generateReviewAction } from "../../../../../lib/server/review-action-service";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ReviewActionResponse>(
      {
        proposal: {
          id: "proposal-invalid-json",
          reviewItemId: "unknown",
          sourceRevisionId: "unknown",
          targetRevisionId: "unknown",
          kind: "stale_anchor",
          summary: "Некоректне тіло запиту.",
          canApplyDirectly: false,
          staleReason: "Некоректне тіло запиту."
        },
        providerUsed: "invalid-request",
        usedFallback: false,
        error: "Некоректне тіло запиту.",
        diagnostics: {
          requestId: "proposal-invalid-json",
          requestedProvider: "unknown",
          requestedModelId: "unknown",
          reviewItemId: "unknown",
          proposalKind: "stale_anchor",
          generatedAt: new Date().toISOString()
        }
      },
      { status: 400 }
    );
  }

  const parsed = parseProposalRequest(body);

  if (!parsed.ok) {
    return NextResponse.json<ReviewActionResponse>(
      {
        proposal: {
          id: "proposal-invalid-body",
          reviewItemId: "unknown",
          sourceRevisionId: "unknown",
          targetRevisionId: "unknown",
          kind: "stale_anchor",
          summary: parsed.error,
          canApplyDirectly: false,
          staleReason: parsed.error
        },
        providerUsed: "invalid-request",
        usedFallback: false,
        error: parsed.error,
        diagnostics: {
          requestId: "proposal-invalid-body",
          requestedProvider: "unknown",
          requestedModelId: "unknown",
          reviewItemId: "unknown",
          proposalKind: "stale_anchor",
          generatedAt: new Date().toISOString()
        }
      },
      { status: 400 }
    );
  }

  const response = await generateReviewAction(parsed.value);
  const status = response.proposal.kind === "stale_anchor" ? 409 : 200;

  return NextResponse.json<ReviewActionResponse>(response, { status });
}

function parseProposalRequest(body: unknown): { ok: true; value: ReviewActionRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Запит має бути JSON-об'єктом." };
  }

  const record = body as Record<string, unknown>;

  if (typeof record.text !== "string") {
    return { ok: false, error: "Поле text є обов'язковим." };
  }

  if (!record.currentRevision || typeof record.currentRevision !== "object") {
    return { ok: false, error: "Потрібно передати currentRevision." };
  }

  if (!record.item || typeof record.item !== "object") {
    return { ok: false, error: "Потрібно передати review item." };
  }

  const provider = normalizeProvider(typeof record.provider === "string" ? record.provider : "openai");
  const modelId = normalizeModelId(provider, typeof record.modelId === "string" ? record.modelId : "");

  return {
    ok: true,
    value: {
      text: record.text,
      currentRevision: record.currentRevision as ReviewActionRequest["currentRevision"],
      item: record.item as ReviewActionRequest["item"],
      provider,
      modelId,
      apiKey: typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined,
      basePrompt: typeof record.basePrompt === "string" && record.basePrompt.trim() ? record.basePrompt.trim() : undefined,
      reviewLevelGuide: typeof record.reviewLevelGuide === "string" && record.reviewLevelGuide.trim() ? record.reviewLevelGuide.trim() : undefined,
      calloutPromptTemplate:
        typeof record.calloutPromptTemplate === "string" && record.calloutPromptTemplate.trim() ? record.calloutPromptTemplate.trim() : undefined,
      imagePromptTemplate:
        typeof record.imagePromptTemplate === "string" && record.imagePromptTemplate.trim() ? record.imagePromptTemplate.trim() : undefined
    }
  };
}
