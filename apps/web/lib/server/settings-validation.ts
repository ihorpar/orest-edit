import { getProviderEnvKey, type ProviderId, type SettingsKeySource, type SettingsValidationResult } from "../editor/settings.ts";
import { readServerEnvValue } from "./env.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const anthropicVersion = "2023-06-01";
const requestTimeoutMs = 12000;

type FetchLike = typeof fetch;

export interface ValidateSettingsModelInput {
  provider: ProviderId;
  modelId: string;
  apiKey?: string;
}

export interface ValidateSettingsModelOptions {
  fetchImpl?: FetchLike;
  now?: () => string;
  readEnvValue?: (key: string) => string | null;
}

export async function validateSettingsModel(
  input: ValidateSettingsModelInput,
  options: ValidateSettingsModelOptions = {}
): Promise<SettingsValidationResult> {
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const envKey = getProviderEnvKey(input.provider);
  const trimmedApiKey = input.apiKey?.trim();
  const resolvedApiKey = trimmedApiKey || readEnvValue(envKey);
  const keySource: SettingsKeySource = trimmedApiKey ? "api_key" : resolvedApiKey ? "env" : "missing";

  if (!resolvedApiKey) {
    return {
      provider: input.provider,
      modelId: input.modelId,
      state: "missing_key",
      keySource,
      message: `Немає ключа в полі або \`${envKey}\` у .env.`,
      validatedAt: now()
    };
  }

  try {
    if (input.provider === "gemini") {
      await pingGeminiModel(input.modelId, resolvedApiKey, fetchImpl);
    } else if (input.provider === "anthropic") {
      await pingAnthropicModel(input.modelId, resolvedApiKey, fetchImpl);
    } else {
      await pingOpenAiModel(input.modelId, resolvedApiKey, fetchImpl);
    }

    return {
      provider: input.provider,
      modelId: input.modelId,
      state: "valid",
      keySource,
      message: keySource === "env" ? `Модель відповідає через \`${envKey}\` із .env.` : "Модель відповідає коректно.",
      validatedAt: now()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося перевірити модель.";
    const lowered = message.toLowerCase();
    const state =
      lowered.includes("401") ||
      lowered.includes("403") ||
      lowered.includes("api key") ||
      lowered.includes("unauthorized") ||
      lowered.includes("permission")
        ? "auth_error"
        : lowered.includes("model") || lowered.includes("404") || lowered.includes("400")
          ? "model_error"
          : "network_error";

    return {
      provider: input.provider,
      modelId: input.modelId,
      state,
      keySource,
      message,
      validatedAt: now()
    };
  }
}

async function pingOpenAiModel(modelId: string, apiKey: string, fetchImpl: FetchLike) {
  const response = await fetchWithTimeout(
    fetchImpl,
    openAiEndpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        input: "Reply with OK.",
        instructions: "Reply with exactly OK.",
        temperature: 0,
        max_output_tokens: 16,
        store: false
      })
    },
    "OpenAI"
  );

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(readProviderErrorMessage(payload) ?? `OpenAI повернув статус ${response.status}.`);
  }
}

async function pingGeminiModel(modelId: string, apiKey: string, fetchImpl: FetchLike) {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${geminiBaseUrl}/${encodeURIComponent(modelId)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: "Reply with exactly OK." }]
          }
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8
        }
      })
    },
    "Gemini"
  );

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(readGeminiErrorMessage(payload) ?? `Gemini повернув статус ${response.status}.`);
  }
}

async function pingAnthropicModel(modelId: string, apiKey: string, fetchImpl: FetchLike) {
  const response = await fetchWithTimeout(
    fetchImpl,
    anthropicEndpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": anthropicVersion
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 12,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: "Reply with exactly OK."
          }
        ]
      })
    },
    "Anthropic"
  );

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(readProviderErrorMessage(payload) ?? `Anthropic повернув статус ${response.status}.`);
  }
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, providerLabel: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${providerLabel} не відповів вчасно.`);
    }

    throw new Error(`${providerLabel} недоступний або мережа не відповідає.`);
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}

function readProviderErrorMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;

  if (!error || typeof error !== "object") {
    return null;
  }

  return typeof (error as Record<string, unknown>).message === "string" ? ((error as Record<string, unknown>).message as string) : null;
}

function readGeminiErrorMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;

  if (!error || typeof error !== "object") {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
}
