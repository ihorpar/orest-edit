import { createPatchId } from "../editor/patch-contract.ts";
import {
  getEditorialCalloutKindLabel,
  REJECTED_REVIEW_RECOMMENDATION_MAX_LENGTH,
  normalizeEditorialReviewItems,
  type EditorialFactCheckRow,
  type EditorialFactCheckSource,
  type EditorialReviewItem,
  type EditorialReviewRecommendationType,
  type RejectedReviewIdea,
  type EditorialCalloutDepth,
  type EditorialCalloutKind,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  type EditorialReviewStepId,
  type EditorialStepRunMode,
  type FactCheckStatus
} from "../editor/review-contract.ts";
import { blockToPromptText, getBlockText, type Block } from "../editor/document-model.ts";
import { serializeInlineNodesToBoldMarkdown } from "../editor/inline-markup.ts";
import { deriveManuscriptRevisionState, formatParagraphLabel } from "../editor/manuscript-structure.ts";
import {
  appendBulletListPunctuationRule,
  buildOpenAiRequestModelFields,
  resolveModelProfile,
  withGeminiThinkingConfig
} from "../editor/settings.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import {
  getAnthropicSystemPromptSuffix,
  buildChunkedEmphasisFailureMessage,
  getGeminiGroundedFactCheckSystemSuffix,
  getOpenAiFactCheckSchema,
  getOpenAiFactCheckStatusEnum,
  getReviewPromptScaffold,
  getReviewServiceErrors,
  getReviewStepSpec,
  isEditorialReviewStepId,
  resolveReviewLocale,
  type ReviewStepSpec
} from "../i18n/server-prompts/review.ts";
import { buildFallbackCalloutPrompt } from "../i18n/server-prompts/review-action.ts";
import { readServerEnvValue } from "./env.ts";
import {
  isEmphasisEligibleBlock,
  planEmphasisChunks,
  type EmphasisChunkPlan
} from "./emphasis-chunk-planner.ts";
import { resolveProviderApiKey } from "./patch-service.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const anthropicVersion = "2023-06-01";
const reviewRequestTimeoutMs = 280000;
const geminiGroundedFactCheckModel = "gemini-3.5-flash-lite";
const geminiGroundedFactCheckProfile = resolveModelProfile("gemini", geminiGroundedFactCheckModel);
const groundedSourceResolveTimeoutMs = 4000;
const emphasisChunkRetryAttempts = 3;
const emphasisChunkRetryBaseDelayMs = 600;
const missingTrustedSourceExplanation = "Не знайдено надійного зовнішнього джерела. Потрібна ручна перевірка.";
const suspiciousMeasurementExplanation =
  "У твердженні є число або одиниця вимірювання, які можуть змінити медичний зміст. Перевірте діапазон, конверсію одиниць і актуальний клінічний контекст за надійним джерелом.";
const trustedFactCheckDomains = [
  "who.int",
  "cdc.gov",
  "nih.gov",
  "ncbi.nlm.nih.gov",
  "mayoclinic.org",
  "clevelandclinic.org",
  "nhs.uk",
  "aad.org",
  "eadv.org",
  "cochranelibrary.com",
  "nejm.org",
  "jamanetwork.com",
  "bmj.com",
  "thelancet.com",
  "cancer.org",
  "moz.gov.ua"
] as const;

const openAiSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          reason: { type: "string" },
          recommendation: { type: "string" },
          recommendationType: {
            type: "string",
            enum: ["rewrite", "expand", "simplify", "list", "subsection", "callout", "visual"]
          },
          suggestedAction: { type: "string", enum: ["rewrite_text", "insert_text", "prepare_callout", "prepare_visual"] },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          blockStart: { type: "integer" },
          blockEnd: { type: "integer" },
          excerpt: { type: "string" },
          insertionHint: { type: "string", enum: ["replace", "before", "after"] },
          anchorBlockId: { anyOf: [{ type: "string" }, { type: "null" }] },
          headingLevel: {
            anyOf: [
              { type: "integer", enum: [2, 3] },
              { type: "null" }
            ]
          },
          headingTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
          calloutKind: {
            anyOf: [
              { type: "string", enum: ["mechanism", "analogy", "everyday_application", "myths_vs_truth", "top_list"] },
              { type: "null" }
            ]
          },
          calloutDepth: {
            anyOf: [
              { type: "string", enum: ["brief", "deep"] },
              { type: "null" }
            ]
          },
          calloutTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
          calloutPreviewText: { anyOf: [{ type: "string" }, { type: "null" }] },
          calloutSummary: { anyOf: [{ type: "string" }, { type: "null" }] },
          calloutPrompt: { anyOf: [{ type: "string" }, { type: "null" }] },
          visualIntent: {
            anyOf: [
              { type: "string", enum: ["infographic", "illustration"] },
              { type: "null" }
            ]
          }
        },
        required: [
          "title",
          "reason",
          "recommendation",
          "recommendationType",
          "suggestedAction",
          "priority",
          "blockStart",
          "blockEnd",
          "excerpt",
          "insertionHint",
          "anchorBlockId",
          "headingLevel",
          "headingTitle",
          "calloutKind",
          "calloutDepth",
          "calloutTitle",
          "calloutPreviewText",
          "calloutSummary",
          "calloutPrompt",
          "visualIntent"
        ]
      }
    }
  },
  required: ["items"]
} as const;

const geminiSchema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          reason: { type: "STRING" },
          recommendation: { type: "STRING" },
          recommendationType: { type: "STRING" },
          suggestedAction: { type: "STRING" },
          priority: { type: "STRING" },
          blockStart: { type: "INTEGER" },
          blockEnd: { type: "INTEGER" },
          excerpt: { type: "STRING" },
          insertionHint: { type: "STRING" },
          anchorBlockId: { type: "STRING" },
          headingLevel: { type: "INTEGER" },
          headingTitle: { type: "STRING" },
          calloutKind: { type: "STRING" },
          calloutDepth: { type: "STRING" },
          calloutTitle: { type: "STRING" },
          calloutPreviewText: { type: "STRING" },
          calloutSummary: { type: "STRING" },
          calloutPrompt: { type: "STRING" },
          visualIntent: { type: "STRING" }
        },
        required: [
          "title",
          "reason",
          "recommendation",
          "recommendationType",
          "suggestedAction",
          "priority",
          "blockStart",
          "blockEnd",
          "excerpt",
          "insertionHint"
        ]
      }
    }
  },
  required: ["items"]
} as const;

const openAiEmphasisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          blockId: { type: "string" },
          excerpt: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          emphasisText: { type: "string" },
          occurrence: { anyOf: [{ type: "integer" }, { type: "null" }] }
        },
        required: ["blockId", "excerpt", "priority", "emphasisText", "occurrence"]
      }
    }
  },
  required: ["items"]
} as const;

const geminiEmphasisSchema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          blockId: { type: "STRING" },
          excerpt: { type: "STRING" },
          priority: { type: "STRING" },
          emphasisText: { type: "STRING" },
          occurrence: { type: "INTEGER" }
        },
        required: ["blockId", "excerpt", "priority", "emphasisText"]
      }
    }
  },
  required: ["items"]
} as const;

const geminiFactCheckSchema = {
  type: "OBJECT",
  properties: {
    rows: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          claim: { type: "STRING" },
          status: { type: "STRING" },
          explanation: { type: "STRING" },
          sources: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                url: { type: "STRING" },
                domain: { type: "STRING" }
              },
              required: ["title", "url", "domain"]
            }
          }
        },
        required: ["claim", "status", "explanation", "sources"]
      }
    }
  },
  required: ["rows"]
} as const;

type FetchLike = typeof fetch;
type EditorialReviewProviderResult = {
  stepId: EditorialReviewStepId;
  stepRunId: string;
  items: EditorialReviewItem[];
  factCheckRows?: EditorialFactCheckRow[];
  expertise?: string;
  droppedItemCount: number;
  droppedItemCountsByReason?: Record<string, number>;
  filteredItemCountsByType?: Partial<Record<EditorialReviewRecommendationType, number>>;
  providerUsed: string;
  rawOutput?: string;
};

type GeminiResponsePayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      groundingSupports?: Array<{
        segment?: { text?: string; startIndex?: number; endIndex?: number };
        groundingChunkIndices?: number[];
      }>;
      webSearchQueries?: string[];
    };
  }>;
  error?: { message?: string };
};

export interface GenerateEditorialReviewOptions {
  fetchImpl?: FetchLike;
  now?: () => string;
  readEnvValue?: (key: string) => string | null;
  sleepImpl?: (ms: number) => Promise<void>;
}

export class EditorialReviewProviderError extends Error {
  readonly code: "http_error" | "invalid_output" | "network_error" | "timeout" | "unknown";
  readonly retryable: boolean;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    details: {
      code: EditorialReviewProviderError["code"];
      retryable: boolean;
      status?: number;
      requestId?: string;
      retryAfterMs?: number;
    }
  ) {
    super(message);
    this.name = "EditorialReviewProviderError";
    this.code = details.code;
    this.retryable = details.retryable;
    this.status = details.status;
    this.requestId = details.requestId;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export async function generateEditorialReview(
  request: EditorialReviewRequest,
  options: GenerateEditorialReviewOptions = {}
): Promise<EditorialReviewResponse> {
  const locale = resolveReviewLocale(request);
  const stepId = resolveStepId(request);
  const stepSpec = getReviewStepSpec(stepId, locale);
  const reviewErrors = getReviewServiceErrors(locale);
  const runMode: EditorialStepRunMode = stepId === "final_editing" || request.runMode === "preserve" ? "preserve" : "replace";
  const stableProviderRequestKey = request.providerRequestKey
    ? normalizeProviderRequestKey(request.providerRequestKey)
    : undefined;
  const requestId = stableProviderRequestKey ? `review-${stableProviderRequestKey}` : createPatchId("review");
  const reviewSessionId = stableProviderRequestKey
    ? `review-session-${stableProviderRequestKey}`
    : createPatchId("review-session");
  const stepRunId = stableProviderRequestKey
    ? `step-run-${stepId}-${stableProviderRequestKey}`
    : createPatchId(`step-run-${stepId}`);
  const fetchImpl = options.fetchImpl ?? fetch;
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  const now = options.now ?? (() => new Date().toISOString());
  const blockCount = request.document.blocks.length;

  if (blockCount === 0) {
    return buildEditorialReviewResponse({
      requestId,
      reviewSessionId,
      stepId,
      stepRunId,
      runMode,
      requestedProvider: request.provider,
      requestedModelId: request.modelId,
      providerUsed: "invalid-text",
      blockCount,
      changeLevel: request.changeLevel,
      items: [],
      factCheckRows: [],
      droppedItemCount: 0,
      usedFallback: false,
      error: reviewErrors.emptyDocument,
      generatedAt: now()
    });
  }

  const apiKey = request.apiKey ?? resolveProviderApiKey(request.provider, readEnvValue);

  if (!apiKey) {
    return buildEditorialReviewResponse({
      requestId,
      reviewSessionId,
      stepId,
      stepRunId,
      runMode,
      requestedProvider: request.provider,
      requestedModelId: request.modelId,
      providerUsed: request.provider,
      blockCount,
      changeLevel: request.changeLevel,
      items: [],
      factCheckRows: [],
      expertise: undefined,
      droppedItemCount: 0,
      droppedItemCountsByReason: undefined,
      filteredItemCountsByType: undefined,
      usedFallback: false,
      error: reviewErrors.missingApiKey(providerDisplayName(request.provider)),
      generatedAt: now()
    });
  }

  try {
    const result =
      stepId === "emphasis" && !request.emphasisChunk
        ? await createChunkedEmphasisReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl, sleepImpl)
        : request.provider === "gemini"
          ? await createGeminiEditorialReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl)
          : request.provider === "anthropic"
            ? await createAnthropicEditorialReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl)
            : await createOpenAiEditorialReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl);

    return buildEditorialReviewResponse({
      requestId,
      reviewSessionId,
      stepId,
      stepRunId,
      runMode,
      requestedProvider: request.provider,
      requestedModelId: request.modelId,
      providerUsed: result.providerUsed,
      blockCount,
      changeLevel: request.changeLevel,
      items: result.items,
      factCheckRows: stepSpec.outputKind === "fact_check_rows"
        ? finalizeActionableFactCheckRows(request, result.factCheckRows ?? [])
        : result.factCheckRows ?? [],
      expertise: result.expertise,
      droppedItemCount: result.droppedItemCount,
      droppedItemCountsByReason: result.droppedItemCountsByReason,
      filteredItemCountsByType: result.filteredItemCountsByType,
      usedFallback: false,
      generatedAt: now(),
      rawOutput: result.rawOutput
    });
  } catch (error) {
    const providerError = normalizeProviderErrorDetails(error);

    return buildEditorialReviewResponse({
      requestId,
      reviewSessionId,
      stepId,
      stepRunId,
      runMode,
      requestedProvider: request.provider,
      requestedModelId: request.modelId,
      providerUsed: request.provider,
      blockCount,
      changeLevel: request.changeLevel,
      items: [],
      factCheckRows: [],
      expertise: undefined,
      droppedItemCount: 0,
      droppedItemCountsByReason: undefined,
      filteredItemCountsByType: undefined,
      usedFallback: false,
      error: error instanceof Error ? error.message : reviewErrors.providerUnavailable(providerDisplayName(request.provider)),
      providerError,
      generatedAt: now()
    });
  }
}

function normalizeProviderErrorDetails(
  error: unknown
): EditorialReviewResponse["diagnostics"]["providerError"] {
  if (error instanceof EditorialReviewProviderError) {
    return {
      code: error.code,
      retryable: error.retryable,
      status: error.status,
      requestId: error.requestId,
      retryAfterMs: error.retryAfterMs
    };
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "timeout", retryable: true };
  }

  if (error instanceof TypeError) {
    return { code: "network_error", retryable: true };
  }

  return undefined;
}

function buildEditorialReviewResponse(input: {
  requestId: string;
  reviewSessionId: string;
  stepId: EditorialReviewStepId;
  stepRunId: string;
  runMode: EditorialStepRunMode;
  requestedProvider: string;
  requestedModelId: string;
  providerUsed: string;
  blockCount: number;
  changeLevel: EditorialReviewRequest["changeLevel"];
  items: EditorialReviewItem[];
  factCheckRows: EditorialFactCheckRow[];
  expertise?: string;
  droppedItemCount: number;
  droppedItemCountsByReason?: Record<string, number>;
  filteredItemCountsByType?: Partial<Record<EditorialReviewRecommendationType, number>>;
  usedFallback: boolean;
  generatedAt: string;
  rawOutput?: string;
  error?: string;
  providerError?: EditorialReviewResponse["diagnostics"]["providerError"];
}): EditorialReviewResponse {
  return {
    reviewSessionId: input.reviewSessionId,
    stepId: input.stepId,
    stepRunId: input.stepRunId,
    runMode: input.runMode,
    items: input.items,
    factCheckRows: input.factCheckRows,
    expertise: input.expertise,
    providerUsed: input.providerUsed,
    usedFallback: input.usedFallback,
    error: input.error,
    diagnostics: {
      requestId: input.requestId,
      reviewSessionId: input.reviewSessionId,
      stepId: input.stepId,
      stepRunId: input.stepRunId,
      runMode: input.runMode,
      requestedProvider: input.requestedProvider,
      requestedModelId: input.requestedModelId,
      blockCount: input.blockCount,
      changeLevel: input.changeLevel,
      returnedItemCount: input.items.length,
      returnedFactCheckCount: input.factCheckRows.length,
      droppedItemCount: input.droppedItemCount,
      droppedItemCountsByReason: input.droppedItemCountsByReason,
      filteredItemCountsByType: input.filteredItemCountsByType,
      generatedAt: input.generatedAt,
      rawOutput: input.rawOutput,
      providerError: input.providerError
    }
  };
}

function buildFallbackEditorialReviewResponse(input: {
  request: EditorialReviewRequest;
  requestId: string;
  reviewSessionId: string;
  stepId: EditorialReviewStepId;
  stepRunId: string;
  runMode: EditorialStepRunMode;
  error: string;
  generatedAt: string;
}): EditorialReviewResponse {
  const stepSpec = getReviewStepSpec(input.stepId, input.request.locale ?? "uk");
  const rawFallbackItems =
    stepSpec.outputKind === "recommendation_cards"
      ? createFallbackEditorialReviewItems(input.request, input.reviewSessionId, input.stepId, input.stepRunId)
      : [];
  const rejectedFilteredFallback = filterRejectedReviewIdeas(rawFallbackItems, input.request.rejectedIdeas);
  const fallbackItems = rejectedFilteredFallback.items;
  const fallbackDroppedCount = rejectedFilteredFallback.droppedCount;
  const fallbackFactRows = stepSpec.outputKind === "fact_check_rows"
    ? finalizeActionableFactCheckRows(input.request, createFallbackFactCheckRows(input.request))
    : [];
  const fallbackExpertise = stepSpec.outputKind === "analysis_markdown" ? createFallbackDiagnosticsExpertise(input.request) : undefined;

  return buildEditorialReviewResponse({
    requestId: input.requestId,
    reviewSessionId: input.reviewSessionId,
    stepId: input.stepId,
    stepRunId: input.stepRunId,
    runMode: input.runMode,
    requestedProvider: input.request.provider,
    requestedModelId: input.request.modelId,
    providerUsed: `fallback:${input.request.provider}`,
    blockCount: input.request.document.blocks.length,
    changeLevel: input.request.changeLevel,
    items: fallbackItems,
    factCheckRows: fallbackFactRows,
    expertise: fallbackExpertise,
    droppedItemCount: fallbackDroppedCount,
    droppedItemCountsByReason: mergeCountMaps(
      rejectedFilteredFallback.droppedCount > 0 ? { rejected_idea_duplicate: rejectedFilteredFallback.droppedCount } : undefined
    ),
    filteredItemCountsByType: undefined,
    usedFallback: true,
    error: input.error,
    generatedAt: input.generatedAt
  });
}

async function createOpenAiEditorialReview(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  stepRunId: string,
  stepSpec: ReviewStepSpec,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<EditorialReviewProviderResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), reviewRequestTimeoutMs);

  try {
    const locale = resolveReviewLocale(request);
    const expectsJson = stepSpec.outputKind !== "analysis_markdown";
    const profile = resolveModelProfile("openai", request.modelId);
    const body: any = {
      ...buildOpenAiRequestModelFields(profile),
      instructions: buildStepSystemPrompt(request, stepSpec, locale),
      input: buildStepUserPrompt(request, stepSpec, locale)
    };

    if (expectsJson) {
      body.text = {
        format: {
          type: "json_schema",
          name: stepSpec.outputKind === "fact_check_rows" ? "fact_check_rows" : "editorial_review",
          strict: true,
          schema:
            stepSpec.outputKind === "fact_check_rows"
              ? getOpenAiFactCheckSchema(locale)
              : stepSpec.id === "emphasis"
                ? openAiEmphasisSchema
                : openAiSchema
        }
      };
    }

    const response = await fetchImpl(openAiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(request.providerRequestKey
          ? { "X-Client-Request-Id": normalizeProviderRequestKey(request.providerRequestKey) }
          : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const rawOutput = await readProviderText(response, locale);

    if (stepSpec.outputKind === "analysis_markdown") {
      return {
        stepId: stepSpec.id,
        stepRunId,
        expertise: rawOutput,
        items: [],
        factCheckRows: [],
        droppedItemCount: 0,
        providerUsed: "openai",
        rawOutput
      };
    }

    if (stepSpec.outputKind === "fact_check_rows") {
      return {
        stepId: stepSpec.id,
        stepRunId,
        items: [],
        factCheckRows: parseFactCheckRows(rawOutput),
        droppedItemCount: 0,
        providerUsed: "openai",
        rawOutput
      };
    }

    return buildNormalizedReviewResult(request, reviewSessionId, stepRunId, stepSpec, parseEditorialReviewItems(rawOutput), "openai", rawOutput);
  } finally {
    clearTimeout(timeout);
  }
}

async function createGeminiEditorialReview(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  stepRunId: string,
  stepSpec: ReviewStepSpec,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<EditorialReviewProviderResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), reviewRequestTimeoutMs);

  try {
    if (stepSpec.outputKind === "fact_check_rows") {
      const groundedPayload = await createGeminiGroundedFactCheck(request, apiKey, fetchImpl, controller.signal);

      return {
        stepId: stepSpec.id,
        stepRunId,
        items: [],
        factCheckRows: await parseGeminiGroundedFactCheckRows(groundedPayload, fetchImpl, resolveReviewLocale(request)),
        droppedItemCount: 0,
        providerUsed: `gemini:${geminiGroundedFactCheckModel}:grounded`,
        rawOutput: extractGeminiText(groundedPayload)
      };
    }

    const locale = resolveReviewLocale(request);
    const expectsJson = stepSpec.outputKind !== "analysis_markdown";
    const profile = resolveModelProfile("gemini", request.modelId);
    const body: any = {
      systemInstruction: {
        parts: [{ text: buildStepSystemPrompt(request, stepSpec, locale) }]
      },
      contents: [{ role: "user", parts: [{ text: buildStepUserPrompt(request, stepSpec, locale) }] }],
      generationConfig: withGeminiThinkingConfig({}, profile)
    };

    if (expectsJson) {
      body.generationConfig.responseMimeType = "application/json";
      body.generationConfig.responseSchema = stepSpec.id === "emphasis" ? geminiEmphasisSchema : geminiSchema;
    }

    const response = await fetchImpl(`${geminiBaseUrl}/${profile.apiModelId}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const rawOutput = await readGeminiText(response, locale);

    if (stepSpec.outputKind === "analysis_markdown") {
      return {
        stepId: stepSpec.id,
        stepRunId,
        expertise: rawOutput,
        items: [],
        factCheckRows: [],
        droppedItemCount: 0,
        providerUsed: "gemini",
        rawOutput
      };
    }

    return buildNormalizedReviewResult(request, reviewSessionId, stepRunId, stepSpec, parseEditorialReviewItems(rawOutput), "gemini", rawOutput);
  } finally {
    clearTimeout(timeout);
  }
}

async function createGeminiGroundedFactCheck(
  request: EditorialReviewRequest,
  apiKey: string,
  fetchImpl: FetchLike,
  signal: AbortSignal
): Promise<GeminiResponsePayload> {
  const locale = resolveReviewLocale(request);
  const reviewErrors = getReviewServiceErrors(locale);
  const factCheckStep = getReviewStepSpec("fact_check", locale);

  const response = await fetchImpl(`${geminiBaseUrl}/${geminiGroundedFactCheckProfile.apiModelId}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: [
              buildStepSystemPrompt(request, factCheckStep, locale),
              getGeminiGroundedFactCheckSystemSuffix(locale, trustedFactCheckDomains)
            ].join("\n\n")
          }
        ]
      },
      contents: [{ role: "user", parts: [{ text: buildStepUserPrompt(request, factCheckStep, locale) }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: withGeminiThinkingConfig(
        {
          responseMimeType: "application/json",
          responseSchema: geminiFactCheckSchema
        },
        geminiGroundedFactCheckProfile
      )
    }),
    signal
  });

  const payload = (await response.json()) as GeminiResponsePayload;

  if (!response.ok) {
    throw createHttpProviderError(response, payload.error?.message || reviewErrors.geminiGroundingUnavailable);
  }

  return payload;
}

async function createAnthropicEditorialReview(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  stepRunId: string,
  stepSpec: ReviewStepSpec,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<EditorialReviewProviderResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), reviewRequestTimeoutMs);

  try {
    const locale = resolveReviewLocale(request);
    const systemPrompt = `${buildStepSystemPrompt(request, stepSpec, locale)} ${getAnthropicSystemPromptSuffix(stepSpec, locale)}`;

    const response = await fetchImpl(anthropicEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": anthropicVersion
      },
      body: JSON.stringify({
        model: request.modelId,
        max_tokens: 3600,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: "user", content: buildStepUserPrompt(request, stepSpec, locale) }]
      }),
      signal: controller.signal
    });

    const rawOutput = await readAnthropicText(response, locale);

    if (stepSpec.outputKind === "analysis_markdown") {
      return {
        stepId: stepSpec.id,
        stepRunId,
        expertise: rawOutput,
        items: [],
        factCheckRows: [],
        droppedItemCount: 0,
        providerUsed: "anthropic",
        rawOutput
      };
    }

    if (stepSpec.outputKind === "fact_check_rows") {
      return {
        stepId: stepSpec.id,
        stepRunId,
        items: [],
        factCheckRows: parseFactCheckRows(rawOutput),
        droppedItemCount: 0,
        providerUsed: "anthropic",
        rawOutput
      };
    }

    return buildNormalizedReviewResult(request, reviewSessionId, stepRunId, stepSpec, parseEditorialReviewItems(rawOutput), "anthropic", rawOutput);
  } finally {
    clearTimeout(timeout);
  }
}

function buildNormalizedReviewResult(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  stepRunId: string,
  stepSpec: ReviewStepSpec,
  items: unknown,
  providerUsed: string,
  rawOutput?: string
): EditorialReviewProviderResult {
  const normalized = normalizeEditorialReviewItems({
    document: request.document,
    revision: request.revision,
    reviewSessionId,
    changeLevel: request.changeLevel,
    stepId: stepSpec.id,
    stepRunId,
    items: items && typeof items === "object" && "items" in (items as Record<string, unknown>) ? (items as { items: unknown }).items : items
  });

  const allowedTypesForFilter =
    stepSpec.id === "final_editing"
      ? undefined
      : stepSpec.allowedRecommendationTypes && stepSpec.allowedRecommendationTypes.length > 0
        ? stepSpec.allowedRecommendationTypes
        : stepSpec.id === "structure"
          ? (["subsection"] as EditorialReviewRecommendationType[])
          : undefined;
  const typeFiltered = allowedTypesForFilter
    ? filterItemsByAllowedRecommendationTypes(normalized.items, allowedTypesForFilter)
    : { items: normalized.items, droppedCount: 0, filteredByType: undefined };
  const rejectedFiltered = filterRejectedReviewIdeas(typeFiltered.items, request.rejectedIdeas);
  const droppedCount = normalized.droppedCount + typeFiltered.droppedCount + rejectedFiltered.droppedCount;
  const droppedByReason = mergeCountMaps(
    normalized.droppedByReason,
    typeFiltered.droppedCount > 0 ? { filtered_by_step_type: typeFiltered.droppedCount } : undefined,
    rejectedFiltered.droppedCount > 0 ? { rejected_idea_duplicate: rejectedFiltered.droppedCount } : undefined
  );

  return {
    stepId: stepSpec.id,
    stepRunId,
    items: hydratedReviewItems(rejectedFiltered.items, request),
    factCheckRows: [],
    droppedItemCount: droppedCount,
    droppedItemCountsByReason: droppedByReason,
    filteredItemCountsByType: typeFiltered.filteredByType,
    providerUsed,
    rawOutput
  };
}

function filterItemsByAllowedRecommendationTypes(
  items: EditorialReviewItem[],
  allowedTypes: EditorialReviewRecommendationType[] | undefined
): {
  items: EditorialReviewItem[];
  droppedCount: number;
  filteredByType?: Partial<Record<EditorialReviewRecommendationType, number>>;
} {
  if (!allowedTypes || allowedTypes.length === 0) {
    return { items, droppedCount: 0 };
  }

  const allowed = new Set(allowedTypes);
  const kept: EditorialReviewItem[] = [];
  const filteredByType: Partial<Record<EditorialReviewRecommendationType, number>> = {};
  let droppedCount = 0;

  for (const item of items) {
    if (allowed.has(item.recommendationType)) {
      kept.push(item);
      continue;
    }

    droppedCount += 1;
    filteredByType[item.recommendationType] = (filteredByType[item.recommendationType] ?? 0) + 1;
  }

  return {
    items: kept,
    droppedCount,
    filteredByType: Object.keys(filteredByType).length > 0 ? filteredByType : undefined
  };
}

function filterRejectedReviewIdeas(
  items: EditorialReviewItem[],
  rejectedIdeas?: RejectedReviewIdea[]
): {
  items: EditorialReviewItem[];
  droppedCount: number;
} {
  const activeRejectedIdeas = (rejectedIdeas ?? []).filter((idea) => idea.blockIds.length > 0);

  if (activeRejectedIdeas.length === 0) {
    return { items, droppedCount: 0 };
  }

  const kept: EditorialReviewItem[] = [];
  let droppedCount = 0;

  for (const item of items) {
    const itemBlockIds = new Set(item.anchor.blockIds);
    const matchesRejectedIdea = activeRejectedIdeas.some(
      (idea) => idea.recommendationType === item.recommendationType && idea.blockIds.some((blockId) => itemBlockIds.has(blockId))
    );

    if (matchesRejectedIdea) {
      droppedCount += 1;
      continue;
    }

    kept.push(item);
  }

  return { items: kept, droppedCount };
}

function mergeCountMaps(
  ...maps: Array<Record<string, number> | undefined>
): Record<string, number> | undefined {
  const merged: Record<string, number> = {};

  for (const map of maps) {
    if (!map) {
      continue;
    }

    for (const [key, count] of Object.entries(map)) {
      if (!count) {
        continue;
      }

      merged[key] = (merged[key] ?? 0) + count;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeRecommendationTypeCounts(
  ...maps: Array<Partial<Record<EditorialReviewRecommendationType, number>> | undefined>
): Partial<Record<EditorialReviewRecommendationType, number>> | undefined {
  const merged: Partial<Record<EditorialReviewRecommendationType, number>> = {};

  for (const map of maps) {
    if (!map) {
      continue;
    }

    for (const [key, count] of Object.entries(map)) {
      if (!count) {
        continue;
      }

      const typedKey = key as EditorialReviewRecommendationType;
      merged[typedKey] = (merged[typedKey] ?? 0) + count;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function resolveStepId(request: EditorialReviewRequest): EditorialReviewStepId {
  if (request.stepId && isEditorialReviewStepId(request.stepId)) {
    return request.stepId;
  }

  if (request.currentStatus === "cards") {
    return "clarity";
  }

  return "diagnostics";
}

function buildAutomaticCardDensityGuidance(
  request: EditorialReviewRequest,
  step: ReviewStepSpec,
  locale: AppLocale
): string | null {
  if (step.outputKind !== "recommendation_cards" || step.id === "emphasis") {
    return null;
  }

  const scaffold = getReviewPromptScaffold(locale);
  const { meaningfulBlocks, totalChars } = getReviewDensityStats(request.document.blocks);

  if (meaningfulBlocks === 0 || totalChars === 0) {
    return scaffold.cardDensityEmptyDoc;
  }

  const sizeUnits = Math.max(meaningfulBlocks, Math.ceil(totalChars / 900));
  const targetCards = clampNumber(Math.round(sizeUnits / 4), 3, 40);
  const minCards = clampNumber(Math.floor(targetCards * 0.75), 3, targetCards);
  const maxCards = clampNumber(Math.ceil(targetCards * 1.45), Math.max(minCards + 2, targetCards), 50);

  return [
    scaffold.cardDensityTarget(minCards, maxCards, meaningfulBlocks, totalChars),
    scaffold.cardDensitySoftTargetTail,
    scaffold.cardDensityPreferStrongCards
  ].join(" ");
}

function getReviewDensityStats(blocks: Block[]): { meaningfulBlocks: number; totalChars: number } {
  let meaningfulBlocks = 0;
  let totalChars = 0;

  for (const block of blocks) {
    const text = getBlockText(block).replace(/\s+/g, " ").trim();

    if (!text) {
      continue;
    }

    totalChars += text.length;

    if (text.length >= 40 || block.type === "heading" || block.type === "callout" || block.type === "bullet_list" || block.type === "ordered_list") {
      meaningfulBlocks += 1;
    }
  }

  return { meaningfulBlocks, totalChars };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildStepSystemPrompt(request: EditorialReviewRequest, step: ReviewStepSpec, locale: AppLocale): string {
  const scaffold = getReviewPromptScaffold(locale);
  const stepInstruction = request.workflowStepPrompts?.[step.id]?.trim() || step.systemInstruction;
  const cardDensityGuidance = buildAutomaticCardDensityGuidance(request, step, locale);
  const emphasisCoverageGuidance = step.id === "emphasis" ? buildEmphasisCoverageGuidance(request, locale) : null;
  const emphasisChunkScope = step.id === "emphasis" ? buildEmphasisChunkScopeGuidance(request, locale) : null;
  const factCheckStatuses = getOpenAiFactCheckStatusEnum(locale).join("|");

  return [
    appendBulletListPunctuationRule(request.basePrompt, locale),
    step.outputKind === "analysis_markdown"
      ? appendBulletListPunctuationRule(request.expertisePrompt, locale)
      : appendBulletListPunctuationRule(request.cardsPrompt?.trim() || request.reviewPrompt?.trim(), locale),
    scaffold.workflowStepPrefix(step.title),
    stepInstruction,
    step.outputKind === "analysis_markdown" ? scaffold.analysisMode : scaffold.cardsMode,
    step.cardGuidance ? scaffold.stepFocusPrefix(step.cardGuidance) : null,
    cardDensityGuidance,
    step.outputKind === "analysis_markdown" ? scaffold.analysisMarkdownFormat : null,
    step.id === "diagnostics" ? scaffold.diagnosticsMacroMode : null,
    step.id === "diagnostics" ? scaffold.diagnosticsNoMicroStyle : null,
    step.id === "diagnostics" ? scaffold.diagnosticsStartHeading : null,
    step.id === "diagnostics" ? scaffold.diagnosticsNoPraiseOpening : null,
    step.id === "diagnostics" ? scaffold.diagnosticsBeStrict : null,
    step.outputKind === "fact_check_rows" ? scaffold.factCheckJsonFormat(factCheckStatuses) : null,
    step.id === "emphasis" ? scaffold.emphasisJsonFormat : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis" ? scaffold.recommendationCardsJsonFormat : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis" ? scaffold.recommendationCardsBlockIndexing : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis" ? scaffold.recommendationCardsSingleRange : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis" ? scaffold.recommendationCardsSubsectionOneAction : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis" ? scaffold.recommendationCardsSplitFragments : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis" ? scaffold.recommendationCardsCalloutKindDepth : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis" ? scaffold.recommendationCardsCalloutBriefDeep : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis" ? scaffold.recommendationCardsCalloutPreferDeep : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis" ? scaffold.recommendationCardsDeepCalloutStructure : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis" ? scaffold.recommendationCardsDeepCalloutNoHtmlHeadings : null,
    step.id === "clarity" ? scaffold.clarityScope : null,
    step.id === "clarity" ? scaffold.clarityNoStructure : null,
    step.id === "clarity" ? scaffold.clarityNoDisclaimers : null,
    step.id === "structure" ? scaffold.structureFocus : null,
    step.id === "structure" ? scaffold.structureHeadingLevels : null,
    step.id === "structure" ? scaffold.structureSubsectionSplit : null,
    step.id === "formatting" ? scaffold.formattingFocus : null,
    step.id === "interest" ? scaffold.interestFocus : null,
    step.id === "interest" ? scaffold.interestNoVisualRewrite : null,
    step.id === "emphasis" ? scaffold.emphasisNoRewrite : null,
    step.id === "emphasis" ? scaffold.emphasisBlockIdExact : null,
    emphasisCoverageGuidance,
    emphasisChunkScope,
    step.id === "emphasis" ? scaffold.emphasisNotRareExceptions : null,
    step.id === "emphasis" ? scaffold.emphasisDenseFinalPass : null,
    step.id === "emphasis" ? scaffold.emphasisNoWholeSentences : null,
    scaffold.idsInBracketsRule
  ].filter(Boolean).join("\n\n");
}

function buildStepUserPrompt(request: EditorialReviewRequest, step: ReviewStepSpec, locale: AppLocale): string {
  const scaffold = getReviewPromptScaffold(locale);
  const lines = request.document.blocks.map((block, index) =>
    scaffold.blockLinePrefix(index, formatParagraphLabel(index), block.id, getReviewPromptBlockText(block, step.id))
  );
  const historyLines = (request.history ?? []).map(
    (msg) => `${msg.role === "user" ? scaffold.historyUserRole : scaffold.historyAssistantRole}: ${msg.content}`
  );
  const diagnosticsExpertise = request.stepContext?.diagnosticsExpertise?.trim() || request.expertise?.trim();
  const diagnosticsFeedback = request.stepContext?.diagnosticsFeedback?.trim();
  const stepFeedback = request.stepContext?.currentStepFeedback?.trim() || request.stepFeedback?.trim();
  const emphasisCoverageGuidance = step.id === "emphasis" ? buildEmphasisCoverageGuidance(request, locale) : null;
  const emphasisChunkScope = step.id === "emphasis" ? buildEmphasisChunkScopeGuidance(request, locale) : null;
  const rejectedIdeasPrompt = buildRejectedIdeasPrompt(request.rejectedIdeas, request.document.blocks, locale);

  return [
    diagnosticsExpertise && step.id !== "diagnostics"
      ? `${scaffold.diagnosticsContextPrefix}\n${diagnosticsExpertise}`
      : null,
    diagnosticsFeedback && step.id !== "diagnostics"
      ? `${scaffold.diagnosticsFeedbackPrefix}\n${diagnosticsFeedback}`
      : null,
    stepFeedback ? `${scaffold.stepFeedbackPrefix(step.title)}\n${stepFeedback}` : null,
    historyLines.length > 0 ? `${scaffold.dialogueContextPrefix}\n${historyLines.join("\n")}` : null,
    request.additionalInstructions?.trim()
      ? `${scaffold.additionalInstructionsPrefix} ${request.additionalInstructions.trim()}`
      : null,
    step.id === "final_editing" && stepFeedback
      ? `${scaffold.finalEditingCustomPromptPrefix}\n${stepFeedback}`
      : null,
    step.id === "final_editing" ? scaffold.finalEditingExecuteAsCards : null,
    step.id === "diagnostics" ? scaffold.diagnosticsRubric : null,
    step.id === "diagnostics" ? scaffold.diagnosticsHeadings : null,
    step.id === "diagnostics" ? scaffold.diagnosticsSectionMap : null,
    step.id === "diagnostics" ? scaffold.diagnosticsExemplarParagraphs : null,
    step.id === "fact_check" ? scaffold.factCheckFocus : null,
    step.id === "fact_check" ? scaffold.factCheckEvidenceStandards : null,
    step.id === "fact_check" ? scaffold.factCheckExplanationRules : null,
    step.outputKind === "recommendation_cards" ? scaffold.recommendationCardsFromDiagnostics : null,
    step.outputKind === "recommendation_cards" ? scaffold.recommendationCardsCalloutDepthChoice : null,
    step.id === "clarity" ? scaffold.clarityPreserveListStructure : null,
    step.id === "emphasis" ? scaffold.emphasisCheckEachParagraph : null,
    step.id === "emphasis" ? scaffold.emphasisBlockIdRequired : null,
    step.id === "emphasis" ? scaffold.emphasisOneItemPerParagraph : null,
    emphasisCoverageGuidance ? `${scaffold.emphasisCoveragePrefix}\n${emphasisCoverageGuidance}` : null,
    emphasisChunkScope,
    step.id === "emphasis" ? scaffold.emphasisOccurrenceHint : null,
    step.id === "emphasis" ? scaffold.emphasisNotTooSparse : null,
    step.id === "emphasis" ? scaffold.emphasisSkipOnlyWhen : null,
    rejectedIdeasPrompt,
    scaffold.documentLabel,
    lines.join("\n")
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildRejectedIdeasPrompt(
  rejectedIdeas: RejectedReviewIdea[] | undefined,
  blocks: Block[],
  locale: AppLocale
): string | null {
  if (!rejectedIdeas || rejectedIdeas.length === 0) {
    return null;
  }

  const scaffold = getReviewPromptScaffold(locale);
  const blockIndexById = new Map(blocks.map((block, index) => [block.id, index]));
  const lines = rejectedIdeas.map((idea, index) => {
    const blockLabels = idea.blockIds
      .map((blockId) => {
        const blockIndex = blockIndexById.get(blockId);
        return blockIndex === undefined ? blockId : scaffold.paragraphLabel(blockIndex);
      })
      .join(", ");
    const recommendation = idea.recommendation
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, REJECTED_REVIEW_RECOMMENDATION_MAX_LENGTH);

    return scaffold.rejectedIdeaLine(index + 1, blockLabels, idea.recommendationType, recommendation);
  });

  return [scaffold.rejectedIdeasHeader, lines.join("\n"), scaffold.rejectedIdeasFooter].join("\n");
}

async function createChunkedEmphasisReview(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  stepRunId: string,
  stepSpec: ReviewStepSpec,
  apiKey: string,
  fetchImpl: FetchLike,
  sleepImpl: (ms: number) => Promise<void>
): Promise<EditorialReviewProviderResult> {
  const chunks = planEmphasisChunks(request.document.blocks);

  if (chunks.length <= 1) {
    return request.provider === "gemini"
      ? createGeminiEditorialReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl)
      : request.provider === "anthropic"
        ? createAnthropicEditorialReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl)
        : createOpenAiEditorialReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl);
  }

  const blockIndexById = new Map(request.document.blocks.map((block, index) => [block.id, index]));
  const mergedRawItems: Array<Record<string, unknown>> = [];
  let providerUsed = `${request.provider}:chunked`;
  let droppedItemCount = 0;
  let droppedByReason: Record<string, number> | undefined;
  let filteredByType: Partial<Record<EditorialReviewRecommendationType, number>> | undefined;
  const rawOutputs: string[] = [];

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const chunkDocument = {
      version: request.document.version,
      blocks: chunk.blocks
    };
    const chunkRequest: EditorialReviewRequest = {
      ...request,
      document: chunkDocument,
      revision: deriveManuscriptRevisionState(chunkDocument),
      emphasisChunk: {
        index: chunkIndex,
        total: chunks.length,
        coreBlockIds: chunk.coreBlockIds,
        contextBlockIds: chunk.contextBlockIds
      }
    };
    const chunkResult = await runChunkedEmphasisProviderRequestWithRetry({
      chunkRequest,
      reviewSessionId,
      stepRunId,
      chunkIndex,
      totalChunks: chunks.length,
      stepSpec,
      apiKey,
      fetchImpl,
      sleepImpl
    });

    providerUsed = `${chunkResult.providerUsed}:chunked`;
    droppedItemCount += chunkResult.droppedItemCount;
    droppedByReason = mergeCountMaps(droppedByReason, chunkResult.droppedItemCountsByReason);
    filteredByType = mergeRecommendationTypeCounts(filteredByType, chunkResult.filteredItemCountsByType);

    if (chunkResult.rawOutput?.trim()) {
      rawOutputs.push(`chunk ${chunkIndex + 1}/${chunks.length}\n${chunkResult.rawOutput}`);
    }

    for (const item of chunkResult.items) {
      const blockId = item.anchor.blockIds[0];
      const globalBlockStart = blockId ? blockIndexById.get(blockId) : undefined;

      if (
        item.stepId !== "emphasis"
        || item.anchor.blockIds.length !== 1
        || globalBlockStart === undefined
        || !chunk.coreBlockIds.includes(blockId)
        || !item.emphasisTarget?.text
      ) {
        continue;
      }

      mergedRawItems.push({
        blockStart: globalBlockStart,
        blockEnd: globalBlockStart,
        excerpt: item.anchor.excerpt,
        priority: item.priority,
        emphasisText: item.emphasisTarget.text,
        occurrence: item.emphasisTarget.occurrence
      });
    }
  }

  const normalized = normalizeEditorialReviewItems({
    document: request.document,
    revision: request.revision,
    reviewSessionId,
    changeLevel: request.changeLevel,
    stepId: stepSpec.id,
    stepRunId,
    items: dedupeChunkedEmphasisItems(mergedRawItems)
  });
  const rejectedFiltered = filterRejectedReviewIdeas(normalized.items, request.rejectedIdeas);
  const normalizedDropReasons = mergeCountMaps(
    normalized.droppedByReason,
    rejectedFiltered.droppedCount > 0 ? { rejected_idea_duplicate: rejectedFiltered.droppedCount } : undefined
  );

  return {
    stepId: stepSpec.id,
    stepRunId,
    items: rejectedFiltered.items,
    factCheckRows: [],
    droppedItemCount: droppedItemCount + normalized.droppedCount + rejectedFiltered.droppedCount,
    droppedItemCountsByReason: mergeCountMaps(droppedByReason, normalizedDropReasons),
    filteredItemCountsByType: filteredByType,
    providerUsed,
    rawOutput: rawOutputs.join("\n\n")
  };
}

async function runChunkedEmphasisProviderRequestWithRetry(input: {
  chunkRequest: EditorialReviewRequest;
  reviewSessionId: string;
  stepRunId: string;
  chunkIndex: number;
  totalChunks: number;
  stepSpec: ReviewStepSpec;
  apiKey: string;
  fetchImpl: FetchLike;
  sleepImpl: (ms: number) => Promise<void>;
}): Promise<EditorialReviewProviderResult> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= emphasisChunkRetryAttempts; attempt += 1) {
    try {
      return input.chunkRequest.provider === "gemini"
        ? await createGeminiEditorialReview(
          input.chunkRequest,
          input.reviewSessionId,
          `${input.stepRunId}:chunk-${input.chunkIndex + 1}`,
          input.stepSpec,
          input.apiKey,
          input.fetchImpl
        )
        : input.chunkRequest.provider === "anthropic"
          ? await createAnthropicEditorialReview(
            input.chunkRequest,
            input.reviewSessionId,
            `${input.stepRunId}:chunk-${input.chunkIndex + 1}`,
            input.stepSpec,
            input.apiKey,
            input.fetchImpl
          )
          : await createOpenAiEditorialReview(
            input.chunkRequest,
            input.reviewSessionId,
            `${input.stepRunId}:chunk-${input.chunkIndex + 1}`,
            input.stepSpec,
            input.apiKey,
            input.fetchImpl
          );
    } catch (error) {
      lastError = error;

      if (!shouldRetryChunkedEmphasisError(error) || attempt >= emphasisChunkRetryAttempts) {
        break;
      }

      const delayMs = emphasisChunkRetryBaseDelayMs * 2 ** (attempt - 1);
      await input.sleepImpl(delayMs);
    }
  }

  const locale = resolveReviewLocale(input.chunkRequest);
  throw new Error(
    buildChunkedEmphasisFailureMessage(locale, {
      error: lastError,
      chunkIndex: input.chunkIndex,
      totalChunks: input.totalChunks,
      attemptCount: emphasisChunkRetryAttempts
    })
  );
}

function shouldRetryChunkedEmphasisError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return error.name === "AbortError"
    || message.includes("failed to fetch")
    || message.includes("fetch failed")
    || message.includes("network")
    || message.includes("econnreset")
    || message.includes("socket hang up")
    || message.includes("etimedout")
    || message.includes("timed out")
    || message.includes("timeout")
    || message.includes("terminated");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function dedupeChunkedEmphasisItems(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const preferredByBlockStart = new Map<number, Record<string, unknown>>();

  for (const item of items) {
    const blockStart = typeof item.blockStart === "number" ? item.blockStart : null;

    if (blockStart === null) {
      continue;
    }

    const current = preferredByBlockStart.get(blockStart);

    if (!current || compareEmphasisCandidates(item, current) > 0) {
      preferredByBlockStart.set(blockStart, item);
    }
  }

  return Array.from(preferredByBlockStart.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, item]) => item);
}

function compareEmphasisCandidates(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const priorityScore = (value: unknown): number => {
    switch (value) {
      case "high":
        return 3;
      case "medium":
        return 2;
      case "low":
        return 1;
      default:
        return 0;
    }
  };
  const leftPriority = priorityScore(left.priority);
  const rightPriority = priorityScore(right.priority);

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const leftLength = typeof left.emphasisText === "string" ? left.emphasisText.trim().length : 0;
  const rightLength = typeof right.emphasisText === "string" ? right.emphasisText.trim().length : 0;

  return leftLength - rightLength;
}

function buildEmphasisCoverageGuidance(request: EditorialReviewRequest, locale: AppLocale): string {
  const scaffold = getReviewPromptScaffold(locale);
  const coreBlockIds = request.emphasisChunk ? new Set(request.emphasisChunk.coreBlockIds) : null;
  const eligibleBlocks = request.document.blocks.filter((block) => {
    if (coreBlockIds && !coreBlockIds.has(block.id)) {
      return false;
    }

    return isEmphasisEligibleBlock(block) && getBlockText(block).replace(/\s+/g, " ").trim().length >= 40;
  }).length;

  const { minShare, maxShare } = getEmphasisCoverageTargets();

  const minItems = Math.max(1, Math.round(eligibleBlocks * minShare));
  const maxItems = Math.max(minItems, Math.round(eligibleBlocks * maxShare));

  return scaffold.emphasisCoverageTarget(minItems, maxItems, eligibleBlocks);
}

export function mergeDurableEmphasisChunkResponses(
  request: EditorialReviewRequest,
  chunks: EmphasisChunkPlan[],
  responses: EditorialReviewResponse[],
  generatedAt = new Date().toISOString()
): EditorialReviewResponse {
  const reviewSessionId = createPatchId("review-session");
  const stepRunId = createPatchId("step-run-emphasis");
  const requestId = createPatchId("review");
  const blockIndexById = new Map(request.document.blocks.map((block, index) => [block.id, index]));
  const mergedRawItems: Array<Record<string, unknown>> = [];
  let droppedItemCount = 0;
  let droppedByReason: Record<string, number> | undefined;
  let filteredByType: Partial<Record<EditorialReviewRecommendationType, number>> | undefined;

  responses.forEach((response, chunkIndex) => {
    const chunk = chunks[chunkIndex];
    const coreIds = new Set(chunk.coreBlockIds);
    droppedItemCount += response.diagnostics.droppedItemCount;
    droppedByReason = mergeCountMaps(droppedByReason, response.diagnostics.droppedItemCountsByReason);
    filteredByType = mergeRecommendationTypeCounts(filteredByType, response.diagnostics.filteredItemCountsByType);

    for (const item of response.items) {
      const blockId = item.anchor.blockIds[0];
      const blockStart = blockId ? blockIndexById.get(blockId) : undefined;

      if (
        !blockId ||
        !coreIds.has(blockId) ||
        item.anchor.blockIds.length !== 1 ||
        blockStart === undefined ||
        !item.emphasisTarget?.text
      ) {
        continue;
      }

      mergedRawItems.push({
        blockStart,
        blockEnd: blockStart,
        excerpt: item.anchor.excerpt,
        priority: item.priority,
        emphasisText: item.emphasisTarget.text,
        occurrence: item.emphasisTarget.occurrence
      });
    }
  });

  const normalized = normalizeEditorialReviewItems({
    document: request.document,
    revision: request.revision,
    reviewSessionId,
    changeLevel: request.changeLevel,
    stepId: "emphasis",
    stepRunId,
    items: dedupeChunkedEmphasisItems(mergedRawItems)
  });
  const rejectedFiltered = filterRejectedReviewIdeas(normalized.items, request.rejectedIdeas);
  const normalizedDropReasons = mergeCountMaps(
    normalized.droppedByReason,
    rejectedFiltered.droppedCount > 0 ? { rejected_idea_duplicate: rejectedFiltered.droppedCount } : undefined
  );

  return buildEditorialReviewResponse({
    requestId,
    reviewSessionId,
    stepId: "emphasis",
    stepRunId,
    runMode: request.runMode === "preserve" ? "preserve" : "replace",
    requestedProvider: request.provider,
    requestedModelId: request.modelId,
    providerUsed: `${responses.at(-1)?.providerUsed ?? request.provider}:chunked`,
    blockCount: request.document.blocks.length,
    changeLevel: request.changeLevel,
    items: rejectedFiltered.items,
    factCheckRows: [],
    droppedItemCount: droppedItemCount + normalized.droppedCount + rejectedFiltered.droppedCount,
    droppedItemCountsByReason: mergeCountMaps(droppedByReason, normalizedDropReasons),
    filteredItemCountsByType: filteredByType,
    usedFallback: false,
    generatedAt,
    rawOutput: responses
      .map((response, index) => response.diagnostics.rawOutput?.trim()
        ? `chunk ${index + 1}/${responses.length}\n${response.diagnostics.rawOutput}`
        : null)
      .filter(Boolean)
      .join("\n\n")
  });
}

function buildEmphasisChunkScopeGuidance(request: EditorialReviewRequest, locale: AppLocale): string | null {
  const chunk = request.emphasisChunk;

  if (!chunk) {
    return null;
  }

  const coreIds = chunk.coreBlockIds.join(", ");
  const contextIds = chunk.contextBlockIds.join(", ");

  if (locale === "en") {
    return [
      `Chunk ${chunk.index + 1}/${chunk.total}. Return emphasis items only for these core blockId values: ${coreIds}.`,
      contextIds ? `These blocks are context only; never return items for them: ${contextIds}.` : null
    ].filter(Boolean).join("\n");
  }

  return [
    `Чанк ${chunk.index + 1}/${chunk.total}. Повертай акценти лише для основних blockId: ${coreIds}.`,
    contextIds ? `Ці блоки подано лише як контекст; не повертай для них акценти: ${contextIds}.` : null
  ].filter(Boolean).join("\n");
}

function getEmphasisCoverageTargets(): { minShare: number; maxShare: number } {
  return { minShare: 0.85, maxShare: 1 };
}

function getReviewPromptBlockText(block: Block, stepId?: EditorialReviewStepId): string {
  if (stepId === "emphasis") {
    return blockToPromptTextWithInlineBold(block);
  }

  return blockToPromptText(block);
}

function inlineNodesToPromptText(nodes: Array<{ text: string; bold?: true }>): string {
  return serializeInlineNodesToBoldMarkdown(nodes).trim();
}

function blockToPromptTextWithInlineBold(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return inlineNodesToPromptText(block.content);
    case "heading":
      return `${"#".repeat(block.level)} ${inlineNodesToPromptText(block.content)}`.trim();
    case "bullet_list":
      return block.items.map((item) => `- ${inlineNodesToPromptText(item)}`).join("\n");
    case "ordered_list":
      return block.items.map((item, index) => `${index + 1}. ${inlineNodesToPromptText(item)}`).join("\n");
    case "image":
      return `[image] alt: ${block.alt}${block.caption ? `; caption: ${inlineNodesToPromptText(block.caption)}` : ""}`;
    case "callout":
      return [`[callout:${block.kind}:${block.depth ?? "brief"}] ${inlineNodesToPromptText(block.title)}`, ...block.body.map((paragraph) => inlineNodesToPromptText(paragraph))]
        .filter(Boolean)
        .join("\n");
    case "divider":
      return "---";
    case "table":
      return block.rows.map((row) => row.map((cell) => inlineNodesToPromptText(cell)).join(" | ")).join("\n");
  }
}

function parseEditorialReviewItems(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = /\{[\s\S]*\}/.exec(content);
    return match ? JSON.parse(match[0]) : { items: [] };
  }
}

function extractGeminiText(payload: GeminiResponsePayload): string {
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim() ?? "";
}

async function parseGeminiGroundedFactCheckRows(
  payload: GeminiResponsePayload,
  fetchImpl: FetchLike,
  locale: AppLocale
): Promise<EditorialFactCheckRow[]> {
  const reviewErrors = getReviewServiceErrors(locale);
  const rawOutput = extractGeminiText(payload);

  if (!rawOutput) {
    throw new Error(reviewErrors.geminiGroundedFactCheckEmpty);
  }

  const rows = parseFactCheckRows(rawOutput);
  const groundingMetadata = payload.candidates?.[0]?.groundingMetadata;
  const chunks = groundingMetadata?.groundingChunks ?? [];
  const supports = groundingMetadata?.groundingSupports ?? [];

  if (chunks.length === 0 || supports.length === 0) {
    return rows;
  }

  const sourceByChunkIndex = await buildGroundedSourceMap(chunks, fetchImpl);

  return rows.map((row) =>
    finalizeFactCheckRow({
      ...row,
      sources: mergeFactCheckSources(row.sources, collectSourcesForFactRow(row, rawOutput, supports, sourceByChunkIndex))
    })
  );
}

function parseFactCheckRows(content: string): EditorialFactCheckRow[] {
  const parsed = parseEditorialReviewItems(content);
  const rows = parsed && typeof parsed === "object" && "rows" in (parsed as Record<string, unknown>)
    ? (parsed as { rows: unknown }).rows
    : [];

  if (!Array.isArray(rows)) {
    throw new Error("Не вдалося розпізнати структурований факт-чек.");
  }

  const normalized: EditorialFactCheckRow[] = [];

  for (const entry of rows) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const claim = normalizeRowText(record.claim, 360);
    const explanation = normalizeRowText(record.explanation, 1200);
    const status = normalizeFactCheckStatus(record.status);

    if (!claim || !explanation || !status || status === "ok") {
      continue;
    }

    normalized.push({
      claim,
      status,
      explanation,
      sources: normalizeFactCheckSources(record.sources)
    });
  }


  return normalized;
}

function finalizeActionableFactCheckRows(
  request: EditorialReviewRequest,
  providerRows: EditorialFactCheckRow[]
): EditorialFactCheckRow[] {
  const uniqueRows = new Map<string, EditorialFactCheckRow>();

  for (const row of [...providerRows, ...createMeasurementSuspicionRows(request)]) {
    if (row.status === "ok") {
      continue;
    }

    const key = row.claim.toLowerCase().replace(/\s+/g, " ").slice(0, 180);

    if (!uniqueRows.has(key)) {
      uniqueRows.set(key, finalizeFactCheckRow(row));
    }
  }

  return Array.from(uniqueRows.values()).slice(0, 18);
}

function createMeasurementSuspicionRows(request: EditorialReviewRequest): EditorialFactCheckRow[] {
  const rows: EditorialFactCheckRow[] = [];

  for (const block of request.document.blocks) {
    if (rows.length >= 8) {
      break;
    }

    const text = getReviewPromptBlockText(block).replace(/\s+/g, " ").trim();
    const excerpt = findSuspiciousMeasurementExcerpt(text);

    if (!excerpt) {
      continue;
    }

    rows.push({
      claim: excerpt,
      status: "questionable",
      explanation: suspiciousMeasurementExplanation,
      sources: []
    });
  }

  return rows;
}

function findSuspiciousMeasurementExcerpt(text: string): string | null {
  if (!text || text.length < 24) {
    return null;
  }

  const sentences = text.match(/[^.!?;:]+(?:[.!?;:]|$)/g) ?? [text];
  const measurementPattern = /(?:\d+(?:[,.]\d+)?\s*(?:%|відсотк\w*|мг\/дл|ммоль\/л|мг|мкг|г|мл|л|МО|IU|ккал|мм\s*рт\.?\s*ст\.?|°C|градус\w*|доб\w*|дн\w*|тижн\w*|місяц\w*|рок\w*)|(?:артеріальн\w*|тиск|глюкоз\w*|холестерин\w*|вітамін\w*|доз\w*|ризик\w*|летальн\w*|смертн\w*|ефективн\w*|знижує|підвищує)[^.!?]{0,90}\d)/i;
  const matched = sentences.find((sentence) => measurementPattern.test(sentence));

  return matched ? normalizeRowText(matched, 360) : null;
}

function normalizeFactCheckSources(value: unknown): EditorialFactCheckSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: EditorialFactCheckSource[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const title = normalizeRowText(record.title, 160);
    const url = normalizeUrl(record.url);
    const domain = normalizeDomain(safeHostname(url ?? ""));

    if (!title || !url || !domain) {
      continue;
    }

    if (!isAllowedGroundedDomain(domain)) {
      continue;
    }

    normalized.push({ title, url, domain });
  }

  return dedupeFactCheckSources(normalized);
}

function finalizeFactCheckRow(row: EditorialFactCheckRow): EditorialFactCheckRow {
  if (row.status === "ok" || row.sources.length > 0 || row.explanation === suspiciousMeasurementExplanation) {
    return row;
  }

  return {
    ...row,
    explanation: missingTrustedSourceExplanation
  };
}

function normalizeFactCheckStatus(value: unknown): FactCheckStatus | null {
  if (value === "ok" || value === "questionable" || value === "unsupported") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "ok" || normalized === "підтверджено" || normalized === "підтверджено джерелами") {
    return "ok";
  }

  if (normalized === "сумнівно" || normalized === "questionable") {
    return "questionable";
  }

  if (normalized === "не підтверджено" || normalized === "непідтверджено" || normalized === "unverified") {
    return "unsupported";
  }

  return null;
}

function normalizeRowText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function normalizeDomain(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/^www\./, "");
  return normalized || null;
}

async function buildGroundedSourceMap(
  chunks: Array<{ web?: { uri?: string; title?: string } }>,
  fetchImpl: FetchLike
): Promise<Map<number, EditorialFactCheckSource>> {
  const entries = await Promise.all(
    chunks.map(async (chunk, index) => {
      const title = normalizeRowText(chunk.web?.title, 160);
      const sourceUrl = normalizeUrl(chunk.web?.uri);

      if (!title || !sourceUrl) {
        return null;
      }

      const resolvedUrl = await resolveGroundedSourceUrl(sourceUrl, fetchImpl);
      const domain = normalizeDomain(safeHostname(resolvedUrl));

      if (!domain || !isAllowedGroundedDomain(domain)) {
        return null;
      }

      return [index, { title, url: resolvedUrl, domain }] as const;
    })
  );

  return new Map(entries.filter(Boolean) as Array<readonly [number, EditorialFactCheckSource]>);
}

async function resolveGroundedSourceUrl(url: string, fetchImpl: FetchLike): Promise<string> {
  if (!url.includes("vertexaisearch.cloud.google.com/grounding-api-redirect/")) {
    return url;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), groundedSourceResolveTimeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal
    });

    return normalizeUrl(response.headers.get("location")) ?? url;
  } catch {
    return url;
  } finally {
    clearTimeout(timeout);
  }
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isAllowedGroundedDomain(domain: string): boolean {
  return trustedFactCheckDomains.some(
    (trustedDomain) => domain === trustedDomain || domain.endsWith(`.${trustedDomain}`)
  );
}

function collectSourcesForFactRow(
  row: EditorialFactCheckRow,
  rawOutput: string,
  supports: Array<{
    segment?: { text?: string; startIndex?: number; endIndex?: number };
    groundingChunkIndices?: number[];
  }>,
  sourceByChunkIndex: Map<number, EditorialFactCheckSource>
): EditorialFactCheckSource[] {
  const startIndex = rawOutput.indexOf(row.claim);
  const explanationIndex = rawOutput.indexOf(row.explanation, startIndex >= 0 ? startIndex : 0);
  const rowStart = startIndex >= 0 ? startIndex : explanationIndex;
  const rowEnd = explanationIndex >= 0 ? explanationIndex + row.explanation.length : rowStart + row.claim.length;

  if (rowStart < 0 || rowEnd < 0) {
    return [];
  }

  const matchedSources: EditorialFactCheckSource[] = [];

  for (const support of supports) {
    const supportStart =
      typeof support.segment?.startIndex === "number"
        ? support.segment.startIndex
        : support.segment?.text
          ? rawOutput.indexOf(support.segment.text)
          : -1;
    const supportEnd =
      typeof support.segment?.endIndex === "number"
        ? support.segment.endIndex
        : supportStart >= 0 && support.segment?.text
          ? supportStart + support.segment.text.length
          : -1;

    if (supportStart < 0 || supportEnd < 0 || supportEnd <= rowStart || supportStart >= rowEnd) {
      continue;
    }

    for (const chunkIndex of support.groundingChunkIndices ?? []) {
      const source = sourceByChunkIndex.get(chunkIndex);

      if (source) {
        matchedSources.push(source);
      }
    }
  }

  return dedupeFactCheckSources(matchedSources).slice(0, 3);
}

function dedupeFactCheckSources(sources: EditorialFactCheckSource[]): EditorialFactCheckSource[] {
  const unique = new Map<string, EditorialFactCheckSource>();

  for (const source of sources) {
    unique.set(source.url, source);
  }

  return Array.from(unique.values());
}

function mergeFactCheckSources(
  parsedSources: EditorialFactCheckSource[],
  groundedSources: EditorialFactCheckSource[]
): EditorialFactCheckSource[] {
  if (groundedSources.length === 0) {
    return parsedSources;
  }

  return dedupeFactCheckSources([...groundedSources, ...parsedSources]);
}

function createFallbackDiagnosticsExpertise(request: EditorialReviewRequest): string {
  const paragraphs = request.document.blocks
    .map((block, index) => ({ block, index, text: getReviewPromptBlockText(block).trim() }))
    .filter((entry) => entry.text);
  const dense = paragraphs.filter((entry) => entry.text.length > 360).slice(0, 6);
  const longSentences = paragraphs.filter((entry) => (entry.text.match(/[.!?]/g)?.length ?? 0) <= 2 && entry.text.length > 220).slice(0, 4);

  const denseLines = dense.length > 0
    ? dense.map((entry) => `- абз. ${formatParagraphLabel(entry.index)}: перевантажений блок, варто дробити.`).join("\n")
    : "- Критичних перевантажень не виявлено автоматичним fallback-аналізом.";
  const clarityLines = longSentences.length > 0
    ? longSentences.map((entry) => `- абз. ${formatParagraphLabel(entry.index)}: складна синтаксична конструкція, спростити формулювання.`).join("\n")
    : "- Явних синтаксичних перевантажень fallback не виявив.";

  return [
    "### 1. Загальний огляд",
    "Fallback-діагностика сформована локально, бо провайдер недоступний. Це чернетковий огляд для старту наступних кроків.",
    "",
    "### 2. Детальний аналіз",
    "**Щільність викладу**",
    denseLines,
    "",
    "**Ясність формулювань**",
    clarityLines,
    "",
    "### 3. Резюме рекомендованих змін",
    "1. Розбити щільні абзаци на коротші смислові блоки.",
    "2. Перевести складні речення у прості конструкції з чіткою логікою.",
    "3. Після підтвердження діагностики перейти до окремого кроку факт-чеку."
  ].join("\n");
}

function createFallbackFactCheckRows(request: EditorialReviewRequest): EditorialFactCheckRow[] {
  const rows: EditorialFactCheckRow[] = [];

  request.document.blocks.forEach((block) => {
    const text = getReviewPromptBlockText(block).replace(/\s+/g, " ").trim();
    if (!text || text.length < 40 || rows.length >= 12) {
      return;
    }

    if (!/\d|%|рок|дослідж|мета-аналіз|клініч|ефект|ризик|знижує|підвищує/i.test(text)) {
      return;
    }

    rows.push({
      claim: text.slice(0, 280),
      status: "unsupported",
      explanation:
        "Потрібна окрема перевірка джерел: наведіть першоджерело (автори, рік, журнал або офіційний гайдлайн) перед редакторським затвердженням.",
      sources: []
    });
  });

  return rows;
}

export function createFallbackEditorialReviewItems(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  stepId: EditorialReviewStepId,
  stepRunId: string
): EditorialReviewItem[] {
  if (stepId === "emphasis") {
    return createFallbackEmphasisReviewItems(request, reviewSessionId, stepRunId);
  }

  const items: Array<Record<string, unknown>> = [];

  request.document.blocks.forEach((block, index) => {
    const text = getBlockText(block).trim();

    if (!text) {
      return;
    }

    if (block.type === "paragraph" && text.length > 420) {
      items.push({
        title: "Розвантажити абзац",
        reason: "Абзац занадто щільний і втрачає темп читання.",
        recommendation: "Скоротити або розбити абзац на 2-3 простіші блоки.",
        recommendationType: "rewrite",
        suggestedAction: "rewrite_text",
        priority: "high",
        blockStart: index,
        blockEnd: index,
        excerpt: text.slice(0, 280),
        insertionHint: "replace",
        anchorBlockId: block.id,
        calloutKind: null,
        calloutDepth: null,
        calloutTitle: null,
        calloutPreviewText: null,
        calloutSummary: null,
        calloutPrompt: null,
        visualIntent: null
      });
    }

    if (block.type === "paragraph" && text.includes(":") && text.length > 220) {
      items.push({
        title: "Перетворити перелік на список",
        reason: "У блоці є перелічення, але воно сховане всередині суцільного абзацу.",
        recommendation: "Показати перелік списком для швидкого сканування.",
        recommendationType: "list",
        suggestedAction: "rewrite_text",
        priority: "medium",
        blockStart: index,
        blockEnd: index,
        excerpt: text.slice(0, 280),
        insertionHint: "replace",
        anchorBlockId: block.id,
        calloutKind: null,
        calloutDepth: null,
        calloutTitle: null,
        calloutPreviewText: null,
        calloutSummary: null,
        calloutPrompt: null,
        visualIntent: null
      });
    }

    if (block.type === "heading" && index + 1 < request.document.blocks.length) {
      const nextBlock = request.document.blocks[index + 1];
      const nextText = getBlockText(nextBlock).trim();

      if (nextBlock.type === "paragraph" && nextText.length > 260) {
        const fallbackDepth = inferCalloutDepth(nextText, "mechanism", "Пояснити механізм простими словами.");
        items.push({
          title: "Додати пояснювальну врізку",
          reason: "Після підзаголовка йде щільний пояснювальний шматок без швидкого входу для читача.",
          recommendation: "Винести один механізм або факт у callout.",
          recommendationType: "callout",
          suggestedAction: "prepare_callout",
          priority: "medium",
          blockStart: index + 1,
          blockEnd: index + 1,
          excerpt: nextText.slice(0, 280),
          insertionHint: "after",
          anchorBlockId: nextBlock.id,
          calloutKind: "mechanism",
          calloutDepth: fallbackDepth,
          calloutTitle: "Як це працює",
          calloutPreviewText: nextText.slice(0, fallbackDepth === "deep" ? 420 : 160),
          calloutSummary: "Підсилити пояснення окремою врізкою.",
          calloutPrompt: buildFallbackCalloutPrompt(resolveReviewLocale(request), "mechanism", fallbackDepth, nextText, "Пояснити механізм простими словами."),
          visualIntent: null
        });
      }
    }
  });

  return normalizeEditorialReviewItems({
    document: request.document,
    revision: request.revision,
    reviewSessionId,
    changeLevel: request.changeLevel,
    stepId,
    stepRunId,
    items
  }).items;
}

function createFallbackEmphasisReviewItems(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  stepRunId: string
): EditorialReviewItem[] {
  const items: Array<Record<string, unknown>> = [];
  const eligibleParagraphCount = request.document.blocks.filter((block) => {
    if (block.type !== "paragraph") {
      return false;
    }

    const text = getBlockText(block).replace(/\s+/g, " ").trim();
    return text.length >= 90 && text.length <= 520 && !/[•·]/.test(text) && !/:\s*$/.test(text);
  }).length;
  const { maxShare } = getEmphasisCoverageTargets();
  const maxFallbackItems = Math.max(8, Math.ceil(eligibleParagraphCount * maxShare));

  request.document.blocks.forEach((block, index) => {
    if (items.length >= maxFallbackItems || block.type !== "paragraph") {
      return;
    }

    const text = getBlockText(block).replace(/\s+/g, " ").trim();
    const phrase = pickFallbackEmphasisPhrase(block.content, text);

    if (text.length < 90 || text.length > 520 || !phrase) {
      return;
    }

    if (/[•·]/.test(text) || /:\s*$/.test(text)) {
      return;
    }

    items.push({
      blockStart: index,
      blockEnd: index,
      excerpt: text.slice(0, 280),
      priority: "medium",
      emphasisText: phrase,
      occurrence: 1
    });
  });

  return normalizeEditorialReviewItems({
    document: request.document,
    revision: request.revision,
    reviewSessionId,
    changeLevel: request.changeLevel,
    stepId: "emphasis",
    stepRunId,
    items
  }).items;
}

function pickFallbackEmphasisPhrase(
  nodes: Array<{ text: string; bold?: true }>,
  plainText: string
): string | null {
  const normalizedText = plainText.replace(/\s+/g, " ").trim();

  if (!normalizedText) {
    return null;
  }

  const existingBoldSegments = nodes
    .filter((node) => node.bold)
    .map((node) => node.text.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  const clauses = normalizedText
    .split(/[.!?]\s+|:\s+|;\s+|,\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const words = clause.split(/\s+/).filter(Boolean);

    if (clause.length < 18 || clause.length > 110 || words.length < 3 || words.length > 10) {
      continue;
    }

    const loweredClause = clause.toLowerCase();

    if (existingBoldSegments.some((segment) => segment === loweredClause || segment.includes(loweredClause))) {
      continue;
    }

    if (normalizedText.includes(clause)) {
      return clause;
    }
  }

  const fallbackWords = normalizedText.split(/\s+/).filter(Boolean).slice(0, 6);

  if (fallbackWords.length >= 3) {
    const fallbackClause = fallbackWords.join(" ").replace(/[,:;]+$/u, "").trim();
    const loweredFallbackClause = fallbackClause.toLowerCase();

    if (
      fallbackClause.length >= 18 &&
      !existingBoldSegments.some((segment) => segment === loweredFallbackClause || segment.includes(loweredFallbackClause))
    ) {
      return fallbackClause;
    }
  }

  return null;
}

function hydratedReviewItems(items: EditorialReviewItem[], request: EditorialReviewRequest): EditorialReviewItem[] {
  const locale = resolveReviewLocale(request);

  return items.map((item) => {
    if (item.recommendationType !== "callout" || item.suggestedAction !== "prepare_callout" || item.calloutDraft) {
      return item;
    }

    const excerpt = item.anchor.excerpt || item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");
    const kind: EditorialCalloutKind = item.calloutKind ?? "mechanism";
    const depth: EditorialCalloutDepth = item.calloutDepth ?? inferCalloutDepth(excerpt, kind, item.recommendation);

    return {
      ...item,
      calloutKind: kind,
      calloutDepth: depth,
      calloutDraft: {
        calloutKind: kind,
        calloutDepth: depth,
        title: getEditorialCalloutKindLabel(kind, locale),
        prompt: buildFallbackCalloutPrompt(locale, kind, depth, excerpt, item.recommendation),
        previewText: excerpt.slice(0, depth === "deep" ? 1200 : 180),
        summary: item.reason
      }
    };
  });
}

function inferCalloutDepth(
  excerpt: string,
  kind: EditorialCalloutKind,
  recommendation: string
): EditorialCalloutDepth {
  const normalizedExcerpt = excerpt.replace(/\s+/g, " ").trim();
  const normalizedRecommendation = recommendation.toLowerCase();

  if (kind === "top_list" || kind === "myths_vs_truth") {
    return "brief";
  }

  if (
    normalizedExcerpt.length >= 420 ||
    /\b(поясн|розкрий|розгор|механізм|чому|як саме|наслід|контекст|практичн)/i.test(normalizedRecommendation)
  ) {
    return "deep";
  }

  return "brief";
}

async function readProviderText(response: Response, locale: AppLocale): Promise<string> {
  const reviewErrors = getReviewServiceErrors(locale);
  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw createHttpProviderError(response, payload.error?.message || reviewErrors.providerUnavailable("OpenAI"));
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const content = payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n").trim();

  if (!content) {
    throw new EditorialReviewProviderError(reviewErrors.invalidProviderJson("OpenAI"), {
      code: "invalid_output",
      retryable: false
    });
  }

  return content;
}

async function readGeminiText(response: Response, locale: AppLocale): Promise<string> {
  const reviewErrors = getReviewServiceErrors(locale);
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw createHttpProviderError(response, payload.error?.message || reviewErrors.providerUnavailable("Gemini"));
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();

  if (!text) {
    throw new EditorialReviewProviderError(reviewErrors.invalidProviderJson("Gemini"), {
      code: "invalid_output",
      retryable: false
    });
  }

  return text;
}

async function readAnthropicText(response: Response, locale: AppLocale): Promise<string> {
  const reviewErrors = getReviewServiceErrors(locale);
  const payload = (await response.json()) as {
    content?: Array<{ text?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw createHttpProviderError(response, payload.error?.message || reviewErrors.providerUnavailable("Anthropic"));
  }

  const text = payload.content?.map((part) => part.text ?? "").join("\n").trim();

  if (!text) {
    throw new EditorialReviewProviderError(reviewErrors.invalidProviderJson("Anthropic"), {
      code: "invalid_output",
      retryable: false
    });
  }

  return text;
}

function createHttpProviderError(response: Response, message: string): EditorialReviewProviderError {
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    response.headers.get("x-goog-request-id") ??
    response.headers.get("anthropic-request-id") ??
    undefined;

  return new EditorialReviewProviderError(message, {
    code: "http_error",
    retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    status: response.status,
    requestId,
    retryAfterMs
  });
}

function normalizeProviderRequestKey(value: string): string {
  const normalized = value
    .replace(/[^\x21-\x7E]/g, "-")
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .slice(0, 200);

  return normalized || "workflow-step";
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const dateMs = Date.parse(value);

  if (!Number.isFinite(dateMs)) {
    return undefined;
  }

  return Math.max(0, dateMs - Date.now());
}

function providerDisplayName(provider: string): string {
  if (provider === "gemini") {
    return "Gemini";
  }

  if (provider === "anthropic") {
    return "Anthropic";
  }

  return "OpenAI";
}
