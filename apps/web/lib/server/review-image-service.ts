import type { ReviewImageGenerationRequest, ReviewImageGenerationResponse } from "../editor/review-contract.ts";
import { createPatchId } from "../editor/patch-contract.ts";
import { readServerEnvValue } from "./env.ts";

const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const geminiImageModel = "gemini-3.1-flash-image-preview";
const requestTimeoutMs = 90000;

type FetchLike = typeof fetch;

export interface GenerateReviewImageOptions {
  fetchImpl?: FetchLike;
  readEnvValue?: (key: string) => string | null;
}

export async function generateReviewImage(
  request: ReviewImageGenerationRequest,
  options: GenerateReviewImageOptions = {}
): Promise<ReviewImageGenerationResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
  const apiKey = request.apiKey ?? readEnvValue("GEMINI_API_KEY");

  if (!request.prompt.trim()) {
    return {
      providerUsed: "gemini",
      modelId: geminiImageModel,
      error: "Порожній image prompt."
    };
  }

  if (!apiKey) {
    return {
      providerUsed: "gemini",
      modelId: geminiImageModel,
      error: "Немає GEMINI_API_KEY для генерації зображення."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const endpoint = `${geminiBaseUrl}/${encodeURIComponent(geminiImageModel)}:generateContent`;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: request.prompt }]
          }
        ],
        generationConfig: {
          responseModalities: ["Image"],
          imageConfig: {
            aspectRatio: "4:3",
            imageSize: "2K"
          }
        }
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      return {
        providerUsed: "gemini",
        modelId: geminiImageModel,
        error: readGeminiErrorMessage(payload) ?? `Gemini image preview повернув статус ${response.status}.`
      };
    }

    const asset = readGeminiImageAsset(payload);

    if (!asset) {
      return {
        providerUsed: "gemini",
        modelId: geminiImageModel,
        error: "Gemini не повернув зображення у відповіді."
      };
    }

    return {
      providerUsed: "gemini",
      modelId: geminiImageModel,
      asset
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        providerUsed: "gemini",
        modelId: geminiImageModel,
        error: "Gemini не відповів вчасно під час генерації зображення."
      };
    }

    return {
      providerUsed: "gemini",
      modelId: geminiImageModel,
      error: error instanceof Error ? error.message : "Не вдалося згенерувати зображення."
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readGeminiImageAsset(payload: Record<string, unknown>) {
  const candidates = payload.candidates;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const content = (candidate as Record<string, unknown>).content;

    if (!content || typeof content !== "object") {
      continue;
    }

    const parts = (content as Record<string, unknown>).parts;

    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const inlineData = (part as Record<string, unknown>).inlineData;

      if (!inlineData || typeof inlineData !== "object") {
        continue;
      }

      const mimeType = typeof (inlineData as Record<string, unknown>).mimeType === "string" ? String((inlineData as Record<string, unknown>).mimeType) : "";
      const data = typeof (inlineData as Record<string, unknown>).data === "string" ? String((inlineData as Record<string, unknown>).data) : "";

      if (mimeType && data) {
        return {
          assetId: createPatchId("asset-image"),
          mimeType,
          source: {
            kind: "data_url" as const,
            dataUrl: `data:${mimeType};base64,${data}`
          }
        };
      }
    }
  }

  return null;
}

function readGeminiErrorMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;

  if (!error || typeof error !== "object") {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
