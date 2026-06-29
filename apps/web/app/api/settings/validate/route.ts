import { NextResponse } from "next/server";
import { normalizeModelId, normalizeProvider, validateModelId, type SettingsValidationResult } from "../../../../lib/editor/settings";
import { requireApiSession } from "../../../../lib/auth/server-route-auth";
import { resolveClientProvidedApiKey } from "../../../../lib/server/client-api-key-policy";
import { validateSettingsModel } from "../../../../lib/server/settings-validation";
import { getApiErrors, getDefaultAppLocale, resolveRequestLocale } from "../../../../lib/i18n/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

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

    return NextResponse.json<SettingsValidationResult>(
      {
        provider: "openai",
        modelId: "",
        state: "model_error",
        keySource: "missing",
        message: errors.invalidRequestBody,
        validatedAt: new Date().toISOString()
      },
      { status: 400 }
    );
  }

  const errors = getApiErrors(resolveRequestLocale(body));

  if (!body || typeof body !== "object") {
    return NextResponse.json<SettingsValidationResult>(
      {
        provider: "openai",
        modelId: "",
        state: "model_error",
        keySource: "missing",
        message: errors.requestMustBeJsonObject,
        validatedAt: new Date().toISOString()
      },
      { status: 400 }
    );
  }

  const record = body as Record<string, unknown>;
  const provider = normalizeProvider(typeof record.provider === "string" ? record.provider : "openai");
  const modelId = normalizeModelId(provider, typeof record.modelId === "string" ? record.modelId : "");

  if (validateModelId(modelId) !== "valid") {
    return NextResponse.json<SettingsValidationResult>(
      {
        provider,
        modelId,
        state: "model_error",
        keySource: "missing",
        message: errors.invalidModelIdFormat,
        validatedAt: new Date().toISOString()
      },
      { status: 400 }
    );
  }

  const response = await validateSettingsModel({
    provider,
    modelId,
    apiKey: resolveClientProvidedApiKey(record.apiKey)
  });

  return NextResponse.json<SettingsValidationResult>(response, {
    status: response.state === "valid" ? 200 : response.state === "missing_key" ? 400 : 502
  });
}
