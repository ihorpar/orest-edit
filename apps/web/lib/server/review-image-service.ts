import type { ReviewImageGenerationRequest, ReviewImageGenerationResponse } from "../editor/review-contract.ts";
import {
  DEFAULT_VISUAL_IMAGE_QUALITY,
  getVisualImageQualityProfile,
  normalizeVisualImageQuality
} from "../editor/settings.ts";
import { createPatchId } from "../editor/patch-contract.ts";
import { readServerEnvValue } from "./env.ts";

const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const requestTimeoutMs = 55000;

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
  const profile = getVisualImageQualityProfile(normalizeVisualImageQuality(request.imageQuality, DEFAULT_VISUAL_IMAGE_QUALITY));

  if (!request.prompt.trim()) {
    return {
      providerUsed: "gemini",
      modelId: profile.modelId,
      error: "Порожній image prompt."
    };
  }

  if (!apiKey) {
    return {
      providerUsed: "gemini",
      modelId: profile.modelId,
      error: "Немає GEMINI_API_KEY для генерації зображення."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const endpoint = `${geminiBaseUrl}/${encodeURIComponent(profile.modelId)}:generateContent`;
  const generationConfig: Record<string, unknown> = {
    responseModalities: ["IMAGE"],
    imageConfig: {
      aspectRatio: "4:3",
      imageSize: profile.imageSize
    }
  };

  if (profile.thinkingLevel) {
    generationConfig.thinkingConfig = {
      thinkingLevel: profile.thinkingLevel
    };
  }

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
        generationConfig
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      return {
        providerUsed: "gemini",
        modelId: profile.modelId,
        error: readGeminiErrorMessage(payload) ?? `Gemini image повернув статус ${response.status}.`
      };
    }

    const asset = readGeminiImageAsset(payload);

    if (!asset) {
      return {
        providerUsed: "gemini",
        modelId: profile.modelId,
        error: buildMissingImageError(payload)
      };
    }

    return {
      providerUsed: "gemini",
      modelId: profile.modelId,
      asset
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        providerUsed: "gemini",
        modelId: profile.modelId,
        error: "Gemini не відповів вчасно під час генерації зображення."
      };
    }

    return {
      providerUsed: "gemini",
      modelId: profile.modelId,
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

function buildMissingImageError(payload: Record<string, unknown>): string {
  const details: string[] = [];

  const promptFeedback = payload.promptFeedback;

  if (promptFeedback && typeof promptFeedback === "object") {
    const blockReason = (promptFeedback as Record<string, unknown>).blockReason;

    if (typeof blockReason === "string" && blockReason.trim()) {
      details.push(`blockReason=${blockReason.trim()}`);
    }
  }

  const candidates = payload.candidates;
  const firstCandidate = Array.isArray(candidates) && candidates.length > 0 && candidates[0] && typeof candidates[0] === "object"
    ? (candidates[0] as Record<string, unknown>)
    : null;

  if (firstCandidate) {
    const finishReason = firstCandidate.finishReason;

    if (typeof finishReason === "string" && finishReason.trim()) {
      details.push(`finishReason=${finishReason.trim()}`);
    }
  }

  const responseText = extractCandidateText(firstCandidate);

  if (responseText) {
    details.push(`text="${responseText}"`);
  }

  if (details.length === 0) {
    return "Gemini не повернув зображення у відповіді.";
  }

  return `Gemini не повернув зображення у відповіді. Деталі: ${details.join("; ")}.`;
}

function extractCandidateText(candidate: Record<string, unknown> | null): string | null {
  if (!candidate) {
    return null;
  }

  const content = candidate.content;

  if (!content || typeof content !== "object") {
    return null;
  }

  const parts = (content as Record<string, unknown>).parts;

  if (!Array.isArray(parts) || parts.length === 0) {
    return null;
  }

  const text = parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const value = (part as Record<string, unknown>).text;
      return typeof value === "string" ? value : "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  return text.slice(0, 160);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
