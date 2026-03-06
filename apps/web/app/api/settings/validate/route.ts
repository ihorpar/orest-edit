import { NextResponse } from "next/server";
import { normalizeModelId, normalizeProvider, validateModelId, type SettingsValidationResult } from "../../../../lib/editor/settings";
import { validateSettingsModel } from "../../../../lib/server/settings-validation";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json<SettingsValidationResult>(
      {
        provider: "openai",
        modelId: "",
        state: "model_error",
        keySource: "missing",
        message: "Некоректне тіло запиту.",
        validatedAt: new Date().toISOString()
      },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json<SettingsValidationResult>(
      {
        provider: "openai",
        modelId: "",
        state: "model_error",
        keySource: "missing",
        message: "Запит має бути JSON-об'єктом.",
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
        message: "Model id має невалідний формат.",
        validatedAt: new Date().toISOString()
      },
      { status: 400 }
    );
  }

  const response = await validateSettingsModel({
    provider,
    modelId,
    apiKey: typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined
  });

  return NextResponse.json<SettingsValidationResult>(response, {
    status: response.state === "valid" ? 200 : response.state === "missing_key" ? 400 : 502
  });
}
