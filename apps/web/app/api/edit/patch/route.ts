import { NextResponse } from "next/server";
import type { PatchRequest, PatchResponse } from "../../../../lib/editor/patch-contract";
import { normalizeModelId, normalizeProvider } from "../../../../lib/editor/settings";
import { generatePatchResponse } from "../../../../lib/server/patch-service";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json<PatchResponse>(
      {
        operations: [],
        providerUsed: "invalid-request",
        usedFallback: false,
        error: "Некоректне тіло запиту.",
        diagnostics: {
          requestId: "request-invalid-json",
          requestedProvider: "unknown",
          requestedModelId: "unknown",
          appliedMode: "default",
          selectionLength: 0,
          returnedOperationCount: 0,
          droppedOperationCount: 0,
          generatedAt: new Date().toISOString()
        }
      },
      { status: 400 }
    );
  }

  const parsed = parsePatchRequest(body);

  if (!parsed.ok) {
    return NextResponse.json<PatchResponse>(
      {
        operations: [],
        providerUsed: "invalid-request",
        usedFallback: false,
        error: parsed.error,
        diagnostics: {
          requestId: "request-invalid-body",
          requestedProvider: "unknown",
          requestedModelId: "unknown",
          appliedMode: "default",
          selectionLength: 0,
          returnedOperationCount: 0,
          droppedOperationCount: 0,
          generatedAt: new Date().toISOString()
        }
      },
      { status: 400 }
    );
  }

  const response = await generatePatchResponse(parsed.value);
  const status = response.providerUsed === "invalid-selection" ? 400 : 200;

  return NextResponse.json<PatchResponse>(response, { status });
}

function parsePatchRequest(body: unknown): { ok: true; value: PatchRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Запит має бути JSON-об'єктом." };
  }

  const record = body as Record<string, unknown>;

  if (typeof record.text !== "string") {
    return { ok: false, error: "Поле text є обов'язковим." };
  }

  if (typeof record.selectionStart !== "number" || typeof record.selectionEnd !== "number") {
    return { ok: false, error: "Потрібно передати selectionStart і selectionEnd." };
  }

  const provider = normalizeProvider(typeof record.provider === "string" ? record.provider : "openai");
  const modelId = normalizeModelId(provider, typeof record.modelId === "string" ? record.modelId : "");

  return {
    ok: true,
    value: {
      text: record.text,
      selectionStart: record.selectionStart,
      selectionEnd: record.selectionEnd,
      mode: record.mode === "custom" ? "custom" : "default",
      prompt: typeof record.prompt === "string" ? record.prompt.trim() : undefined,
      provider,
      modelId,
      apiKey: typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined,
      basePrompt: typeof record.basePrompt === "string" && record.basePrompt.trim() ? record.basePrompt.trim() : undefined
    }
  };
}
