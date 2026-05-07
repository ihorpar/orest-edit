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
import { appendBulletListPunctuationRule, DEFAULT_WORKFLOW_STEP_PROMPTS } from "../editor/settings.ts";
import { readServerEnvValue } from "./env.ts";
import { resolveProviderApiKey } from "./patch-service.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const anthropicVersion = "2023-06-01";
const reviewRequestTimeoutMs = 120000;
const geminiGroundedFactCheckModel = "gemini-3.1-flash-lite-preview";
const groundedSourceResolveTimeoutMs = 4000;
const emphasisChunkSize = 18;
const emphasisChunkOverlap = 2;
const emphasisChunkThreshold = 24;
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
          occurrence: { type: "integer" }
        },
        required: ["blockId", "excerpt", "priority", "emphasisText"]
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

const openAiFactCheckSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          status: { type: "string", enum: ["сумнівно", "не підтверджено"] },
          explanation: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                url: { type: "string" },
                domain: { type: "string" }
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

type StepOutputKind = "analysis_markdown" | "fact_check_rows" | "recommendation_cards";

interface ReviewStepSpec {
  id: EditorialReviewStepId;
  title: string;
  outputKind: StepOutputKind;
  cardGuidance?: string;
  allowedRecommendationTypes?: EditorialReviewRecommendationType[];
  systemInstruction: string;
}

const REVIEW_STEP_SPECS: Record<EditorialReviewStepId, ReviewStepSpec> = {
  diagnostics: {
    id: "diagnostics",
    title: "Діагностика",
    outputKind: "analysis_markdown",
    systemInstruction: DEFAULT_WORKFLOW_STEP_PROMPTS.diagnostics
  },
  fact_check: {
    id: "fact_check",
    title: "Перевірка фактів",
    outputKind: "fact_check_rows",
    systemInstruction: DEFAULT_WORKFLOW_STEP_PROMPTS.fact_check
  },
  structure: {
    id: "structure",
    title: "Структура",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["subsection", "list", "callout"],
    cardGuidance:
      "Фокус: архітектура розділу, послідовність думки, місця для підзаголовків і дроблення масивних блоків.",
    systemInstruction: DEFAULT_WORKFLOW_STEP_PROMPTS.structure
  },
  clarity: {
    id: "clarity",
    title: "Ясність",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["simplify", "rewrite", "expand"],
    cardGuidance:
      "Фокус: пояснити складне просто, прибрати перевантажені формулювання, кальки й зайву категоричність, зберегти точність без академічної перевантаженості та без шаблонних застережень.",
    systemInstruction: DEFAULT_WORKFLOW_STEP_PROMPTS.clarity
  },
  interest: {
    id: "interest",
    title: "Інтерес і застосовність",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["callout", "expand", "rewrite", "visual"],
    cardGuidance:
      "Фокус: читабельний інтерес, зв'язок із реальним життям, практичне застосування і мотивація дочитати розділ.",
    systemInstruction: DEFAULT_WORKFLOW_STEP_PROMPTS.interest
  },
  visuals: {
    id: "visuals",
    title: "Візуали",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["visual"],
    cardGuidance:
      "Фокус: де і який візуал дає найбільшу користь. Схема вважається підтипом інфографіки.",
    systemInstruction: DEFAULT_WORKFLOW_STEP_PROMPTS.visuals
  },
  formatting: {
    id: "formatting",
    title: "Форматування",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["list", "callout", "subsection"],
    cardGuidance:
      "Фокус: де потрібні списки, підзаголовки, врізки і компактні формати подачі для швидкого сканування.",
    systemInstruction: DEFAULT_WORKFLOW_STEP_PROMPTS.formatting
  },
  emphasis: {
    id: "emphasis",
    title: "Акценти",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["rewrite"],
    cardGuidance:
      "Фокус: точково виділити жирним головну тезу або ключову фразу в абзаці без переписування змісту й без візуального шуму.",
    systemInstruction: DEFAULT_WORKFLOW_STEP_PROMPTS.emphasis
  },
  final_editing: {
    id: "final_editing",
    title: "Власний запит",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["rewrite", "simplify", "expand", "list", "subsection", "callout", "visual"],
    cardGuidance:
      "Фокус: виконай власний запит редактора, але поверни результат тільки як локальні executable-картки. Якщо запит просить врізки, підзаголовки, списки, переписування або візуали, використовуй відповідні recommendationType.",
    systemInstruction: DEFAULT_WORKFLOW_STEP_PROMPTS.final_editing
  }
};

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
}

export async function generateEditorialReview(
  request: EditorialReviewRequest,
  options: GenerateEditorialReviewOptions = {}
): Promise<EditorialReviewResponse> {
  const stepId = resolveStepId(request);
  const stepSpec = REVIEW_STEP_SPECS[stepId];
  const runMode: EditorialStepRunMode = request.runMode === "preserve" ? "preserve" : "replace";
  const requestId = createPatchId("review");
  const reviewSessionId = createPatchId("review-session");
  const stepRunId = createPatchId(`step-run-${stepId}`);
  const fetchImpl = options.fetchImpl ?? fetch;
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
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
      error: "Документ порожній. Немає що аналізувати.",
      generatedAt: now()
    });
  }

  const apiKey = request.apiKey ?? resolveProviderApiKey(request.provider, readEnvValue);

  if (!apiKey) {
    return buildFallbackEditorialReviewResponse({
      request,
      requestId,
      reviewSessionId,
      stepId,
      stepRunId,
      runMode,
      error: `Немає API key для ${providerDisplayName(request.provider)} у формі або .env, тому показано локальний редакторський огляд.`,
      generatedAt: now()
    });
  }

  try {
    const result =
      stepId === "emphasis"
        ? await createChunkedEmphasisReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl)
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
    return buildFallbackEditorialReviewResponse({
      request,
      requestId,
      reviewSessionId,
      stepId,
      stepRunId,
      runMode,
      error: error instanceof Error ? error.message : `${providerDisplayName(request.provider)} недоступний, тому показано локальний редакторський огляд.`,
      generatedAt: now()
    });
  }
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
      rawOutput: input.rawOutput
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
  const stepSpec = REVIEW_STEP_SPECS[input.stepId];
  const rawFallbackItems =
    stepSpec.outputKind === "recommendation_cards"
      ? createFallbackEditorialReviewItems(input.request, input.reviewSessionId, input.stepId, input.stepRunId)
      : [];
  const filteredFallback = filterStepItems(rawFallbackItems, stepSpec.allowedRecommendationTypes);
  const rejectedFilteredFallback = filterRejectedReviewIdeas(filteredFallback.items, input.request.rejectedIdeas);
  const fallbackItems = rejectedFilteredFallback.items;
  const fallbackDroppedCount = filteredFallback.droppedCount + rejectedFilteredFallback.droppedCount;
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
      filteredFallback.droppedCount > 0 ? { filtered_by_step_type: filteredFallback.droppedCount } : undefined,
      rejectedFilteredFallback.droppedCount > 0 ? { rejected_idea_duplicate: rejectedFilteredFallback.droppedCount } : undefined
    ),
    filteredItemCountsByType: filteredFallback.droppedByType,
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
    const expectsJson = stepSpec.outputKind !== "analysis_markdown";
    const body: any = {
      model: request.modelId,
      instructions: buildStepSystemPrompt(request, stepSpec),
      input: buildStepUserPrompt(request, stepSpec)
    };

    if (expectsJson) {
      body.text = {
        format: {
          type: "json_schema",
          name: stepSpec.outputKind === "fact_check_rows" ? "fact_check_rows" : "editorial_review",
          strict: true,
          schema:
            stepSpec.outputKind === "fact_check_rows"
              ? openAiFactCheckSchema
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
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const rawOutput = await readProviderText(response);

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
        factCheckRows: await parseGeminiGroundedFactCheckRows(groundedPayload, fetchImpl),
        droppedItemCount: 0,
        providerUsed: `gemini:${geminiGroundedFactCheckModel}:grounded`,
        rawOutput: extractGeminiText(groundedPayload)
      };
    }

    const expectsJson = stepSpec.outputKind !== "analysis_markdown";
    const body: any = {
      systemInstruction: {
        parts: [{ text: buildStepSystemPrompt(request, stepSpec) }]
      },
      contents: [{ role: "user", parts: [{ text: buildStepUserPrompt(request, stepSpec) }] }],
      generationConfig: {
        temperature: 0.2
      }
    };

    if (expectsJson) {
      body.generationConfig.responseMimeType = "application/json";
      body.generationConfig.responseSchema = stepSpec.id === "emphasis" ? geminiEmphasisSchema : geminiSchema;
    }

    const response = await fetchImpl(`${geminiBaseUrl}/${request.modelId}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const rawOutput = await readGeminiText(response);

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
  const response = await fetchImpl(`${geminiBaseUrl}/${geminiGroundedFactCheckModel}:generateContent`, {
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
              buildStepSystemPrompt(request, REVIEW_STEP_SPECS.fact_check),
              "Працюй лише як фактчекер. Не вставляй URL, DOI або назви джерел у поле explanation.",
              "Формуй web search queries англійською мовою, навіть якщо вхідний текст українською.",
              `Використовуй лише надійні медичні джерела: ${trustedFactCheckDomains.join(", ")}.`,
              "Якщо для твердження не знайдено надійного джерела з цього списку, залишай sources порожнім масивом.",
              "Поверни лише JSON за схемою rows[]."
            ].join("\n\n")
          }
        ]
      },
      contents: [{ role: "user", parts: [{ text: buildStepUserPrompt(request, REVIEW_STEP_SPECS.fact_check) }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: geminiFactCheckSchema
      }
    }),
    signal
  });

  const payload = (await response.json()) as GeminiResponsePayload;

  if (!response.ok) {
    throw new Error(payload.error?.message || "Gemini grounding недоступний.");
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
    const systemPrompt =
      stepSpec.outputKind === "analysis_markdown"
        ? `${buildStepSystemPrompt(request, stepSpec)} Дай розлогий критичний аналіз тексту.`
        : stepSpec.id === "emphasis"
          ? `${buildStepSystemPrompt(request, stepSpec)} Поверни лише JSON-об'єкт без markdown, без reason/title/recommendation і без будь-яких пояснень поза JSON.`
          : `${buildStepSystemPrompt(request, stepSpec)} Поверни лише JSON-об'єкт без markdown і без пояснень поза JSON.`;

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
        messages: [{ role: "user", content: buildStepUserPrompt(request, stepSpec) }]
      }),
      signal: controller.signal
    });

    const rawOutput = await readAnthropicText(response);

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

  const filtered = filterStepItems(normalized.items, stepSpec.allowedRecommendationTypes);
  const rejectedFiltered = filterRejectedReviewIdeas(filtered.items, request.rejectedIdeas);
  const droppedCount = normalized.droppedCount + filtered.droppedCount + rejectedFiltered.droppedCount;
  const droppedByReason = mergeCountMaps(
    normalized.droppedByReason,
    filtered.droppedCount > 0 ? { filtered_by_step_type: filtered.droppedCount } : undefined,
    rejectedFiltered.droppedCount > 0 ? { rejected_idea_duplicate: rejectedFiltered.droppedCount } : undefined
  );

  return {
    stepId: stepSpec.id,
    stepRunId,
    items: hydratedReviewItems(rejectedFiltered.items, request),
    factCheckRows: [],
    droppedItemCount: droppedCount,
    droppedItemCountsByReason: droppedByReason,
    filteredItemCountsByType: filtered.droppedByType,
    providerUsed,
    rawOutput
  };
}

function filterStepItems(
  items: EditorialReviewItem[],
  allowedRecommendationTypes?: EditorialReviewRecommendationType[]
): {
  items: EditorialReviewItem[];
  droppedCount: number;
  droppedByType: Partial<Record<EditorialReviewRecommendationType, number>>;
} {
  if (!allowedRecommendationTypes || allowedRecommendationTypes.length === 0) {
    return {
      items,
      droppedCount: 0,
      droppedByType: {}
    };
  }

  const allowed = new Set(allowedRecommendationTypes);
  const kept: EditorialReviewItem[] = [];
  const droppedByType: Partial<Record<EditorialReviewRecommendationType, number>> = {};
  let droppedCount = 0;

  for (const item of items) {
    if (allowed.has(item.recommendationType)) {
      kept.push(item);
      continue;
    }

    droppedCount += 1;
    droppedByType[item.recommendationType] = (droppedByType[item.recommendationType] ?? 0) + 1;
  }

  return {
    items: kept,
    droppedCount,
    droppedByType
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
  if (request.stepId && request.stepId in REVIEW_STEP_SPECS) {
    return request.stepId;
  }

  if (request.currentStatus === "cards") {
    return "clarity";
  }

  return "diagnostics";
}

function buildAutomaticCardDensityGuidance(request: EditorialReviewRequest, step: ReviewStepSpec): string | null {
  if (step.outputKind !== "recommendation_cards" || step.id === "emphasis") {
    return null;
  }

  const { meaningfulBlocks, totalChars } = getReviewDensityStats(request.document.blocks);

  if (meaningfulBlocks === 0 || totalChars === 0) {
    return "Орієнтир за кількістю карток: документ майже порожній, тому поверни картки лише якщо є реальна локальна дія.";
  }

  const sizeUnits = Math.max(meaningfulBlocks, Math.ceil(totalChars / 900));
  const targetCards = clampNumber(Math.round(sizeUnits / 4), 3, 40);
  const minCards = clampNumber(Math.floor(targetCards * 0.75), 3, targetCards);
  const maxCards = clampNumber(Math.ceil(targetCards * 1.45), Math.max(minCards + 2, targetCards), 50);

  return [
    `М'який орієнтир за кількістю карток: приблизно ${minCards}-${maxCards} на ${meaningfulBlocks} змістовних блоків і ${totalChars} знаків.`,
    "Це не квота і не максимум. Якщо корисних локальних дій більше, поверни більше карток; якщо сильних дій менше, не добирай слабкі або дубльовані ідеї.",
    "Краще дати редактору трохи більше сильних карток, ніж промовчати про корисні правки, бо частину карток редактор відхилить."
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

function buildStepSystemPrompt(request: EditorialReviewRequest, step: ReviewStepSpec): string {
  const stepInstruction = request.workflowStepPrompts?.[step.id]?.trim() || step.systemInstruction;
  const cardDensityGuidance = buildAutomaticCardDensityGuidance(request, step);
  const emphasisCoverageGuidance = step.id === "emphasis" ? buildEmphasisCoverageGuidance(request) : null;

  return [
    appendBulletListPunctuationRule(request.basePrompt),
    step.outputKind === "analysis_markdown"
      ? appendBulletListPunctuationRule(request.expertisePrompt)
      : appendBulletListPunctuationRule(request.cardsPrompt?.trim() || request.reviewPrompt?.trim()),
    `Крок workflow: ${step.title}.`,
    stepInstruction,
    step.outputKind === "analysis_markdown"
      ? "Режим роботи: повний редакторський діагноз без карток дій."
      : "Режим роботи: повний редакторський прохід у межах цього етапу. Поверни всі сильні локальні рекомендації, які справді допоможуть редактору.",
    step.cardGuidance ? `Окремий фокус кроку: ${step.cardGuidance}` : null,
    cardDensityGuidance,
    step.outputKind === "analysis_markdown"
      ? "Формат відповіді: Markdown, українською мовою, з посиланнями на абзаци у вигляді «абз. NNN»."
      : null,
    step.id === "diagnostics"
      ? "Працюй у режимі макродіагностики великого розділу: спочатку карта структури й читацького маршруту, потім абзаци як докази системних проблем."
      : null,
    step.id === "diagnostics"
      ? "Для діагностики не підміняй структурний аналіз набором точкових стилістичних зауваг. Локальні фрази використовуй лише як докази макропроблем."
      : null,
    step.id === "diagnostics"
      ? "Починай відповідь відразу з заголовка «## Головний діагноз розділу». Не починай з фраз на кшталт «Ось діагностика», «Нижче аналіз» або загальних ввідних реверансів."
      : null,
    step.id === "diagnostics"
      ? "Не відкривай відповідь похвалою. Якщо текст місцями сильний, назви це коротко лише після того, як уже сформулював головний діагноз і ключові ризики."
      : null,
    step.id === "diagnostics"
      ? "Будь жорсткішим за замовчуванням: шукай слабку архітектуру розділу, дублювання, провисання логіки, втрату читацького маршруту, редакторську млявість, псевдонауковий або рекламний підтекст і зайві бокові блоки."
      : null,
    step.outputKind === "fact_check_rows"
      ? "Формат відповіді: JSON {\"rows\":[{\"claim\":\"...\",\"status\":\"сумнівно|не підтверджено\",\"explanation\":\"...\",\"sources\":[]}]} без markdown. Якщо немає проблемних або сумнівних тверджень, поверни {\"rows\":[]}. Ніколи не повертай рядки зі статусом ok."
      : null,
    step.id === "emphasis"
      ? "Формат відповіді: JSON {\"items\":[{\"blockId\":\"точний id блока з документа\",\"excerpt\":\"...\",\"priority\":\"high|medium|low\",\"emphasisText\":\"точний підрядок із документа\",\"occurrence\":1}]}. Не повертай title, reason, recommendation або будь-які пояснення."
      : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis"
      ? "Формат відповіді: JSON {\"items\":[...]} за контрактом рекомендацій. Не додавай будь-який текст поза JSON."
      : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis"
      ? "Для blockStart і blockEnd використовуй нульову нумерацію рядків документа. Не згадуй block id у title/reason/recommendation."
      : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis"
      ? "Одна картка має охоплювати лише один суцільний діапазон абзаців без розривів."
      : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis"
      ? "Якщо одна проблема є в несуміжних місцях (наприклад 2, 10, 15-17), повертай кілька карток: по одній на кожен окремий суцільний фрагмент."
      : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis"
      ? "Для recommendationType='callout' обов'язково обери calloutKind і calloutDepth. calloutDepth може бути 'brief' або 'deep'; обирай профіль, який найкраще підходить до контексту статті та фрагмента."
      : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis"
      ? "calloutDepth='brief' означає коротку врізку для швидкого пояснення в 1-2 коротких абзацах. calloutDepth='deep' означає глибокий розбір питання у 3-6 докладних абзацах з внутрішньою структурою."
      : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis"
      ? "Не обирай brief за замовчуванням. Якщо фрагмент щільний, пояснювальний, вводить механізм, причинно-наслідковий ланцюг, практичні наслідки або потребує розгортання контексту, віддавай перевагу deep."
      : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis"
      ? "Для deep-callout вимагай структуровану подачу: не суцільне полотно, а 3-6 абзаців із активним використанням **жирного**. Перед частиною абзаців мають з'являтися короткі **якорі-підзаголовки** з 1-3 слів окремим рядком, а всередині тексту - **ключові думки**. Якщо є природне перерахування причин, кроків, наслідків або прикладів, передбач один короткий список."
      : null,
    step.outputKind === "recommendation_cards" && step.id !== "emphasis"
      ? "Для deep-callout не використовуй #, ## або HTML-заголовки. Підзаголовки мають бути оформлені тільки як короткі жирні рядки на кшталт **Чому це важливо**."
      : null,
    step.id === "clarity"
      ? "Для кроку «Ясність» пропонуй лише мовні й локально-структурні правки: спрощення, ущільнення, локальне пом'якшення категоричності, пояснення термінів простішими словами, виправлення кальок і незграбних конструкцій."
      : null,
    step.id === "clarity"
      ? "Для «Ясність» не пропонуй підзаголовки, врізки, таблиці або зміни макроструктури. Працюй лише в межах simplify/rewrite/expand."
      : null,
    step.id === "clarity"
      ? "Не пропонуй шаблонних застережень про консультацію з лікарем, самодіагностику, «варто перевірити стан» або інших повторюваних пересторог, якщо цього прямо не просить редактор і цього немає у фрагменті."
      : null,
    step.id === "structure"
      ? "Для «Структура» не витрачай картки на мікролексичні або пунктуаційні правки. Фокус: підзаголовки, сегментація, послідовність блоків, врізки й списки як елементи архітектури читання."
      : null,
    step.id === "structure"
      ? "Якщо один великий блок треба розбити на кілька майбутніх підрозділів, поверни кілька окремих subsection-карток: одна картка = один конкретний підзаголовок перед одним місцем вставки."
      : null,
    step.id === "formatting"
      ? "Для «Форматування» фокусуйся на форматі подачі (list/subsection/callout). Не пропонуй мовне переписування абзаців як окремий тип правки."
      : null,
    step.id === "emphasis"
      ? "Для кроку «Акценти» не переписуй текст і не генеруй редакторських пояснень. Повертай лише точні підрядки, які варто виділити жирним."
      : null,
    step.id === "emphasis"
      ? "Для кожного item поверни blockId рівно в тому вигляді, як він показаний у квадратних дужках біля відповідного рядка документа."
      : null,
    emphasisCoverageGuidance,
    step.id === "emphasis"
      ? "Це не режим рідкісних винятків. Багато змістовних абзаців можуть потребувати акценту; пропускай лише справді службові, тривіальні або вже достатньо добре підсвічені абзаци."
      : null,
    step.id === "emphasis"
      ? "Працюй як щільний фінальний прохід: майже кожен змістовний абзац із самостійною тезою має отримати один короткий акцент, якщо він ще не виділений жирним."
      : null,
    step.id === "emphasis"
      ? "Заборонено виділяти цілі речення, більшу частину абзацу, перші слова абзацу без смислової ваги або декоративні фрази. Мета - короткі смислові вузли, а не форматувальний шум."
      : null,
    "IDs у квадратних дужках призначені лише для прив'язки і не мають з'являтися в user-facing тексті."
  ].filter(Boolean).join("\n\n");
}

function buildStepUserPrompt(request: EditorialReviewRequest, step: ReviewStepSpec): string {
  const lines = request.document.blocks.map(
    (block, index) => `${index}. абз. ${formatParagraphLabel(index)} [${block.id}] ${getReviewPromptBlockText(block, step.id)}`
  );
  const historyLines = (request.history ?? []).map((msg) => `${msg.role === "user" ? "КОРИСТУВАЧ" : "АСИСТЕНТ"}: ${msg.content}`);
  const diagnosticsExpertise = request.stepContext?.diagnosticsExpertise?.trim() || request.expertise?.trim();
  const diagnosticsFeedback = request.stepContext?.diagnosticsFeedback?.trim();
  const stepFeedback = request.stepContext?.currentStepFeedback?.trim() || request.stepFeedback?.trim();
  const emphasisCoverageGuidance = step.id === "emphasis" ? buildEmphasisCoverageGuidance(request) : null;
  const rejectedIdeasPrompt = buildRejectedIdeasPrompt(request.rejectedIdeas, request.document.blocks);

  return [
    diagnosticsExpertise && step.id !== "diagnostics" ? `Контекст діагностики:\n${diagnosticsExpertise}` : null,
    diagnosticsFeedback && step.id !== "diagnostics" ? `Фідбек користувача до діагностики:\n${diagnosticsFeedback}` : null,
    stepFeedback ? `Фідбек користувача для кроку «${step.title}»:\n${stepFeedback}` : null,
    historyLines.length > 0 ? `Релевантний контекст діалогу:\n${historyLines.join("\n")}` : null,
    request.additionalInstructions?.trim() ? `Додаткові інструкції редактора: ${request.additionalInstructions.trim()}` : null,
    step.id === "final_editing" && stepFeedback
      ? `Власний запит редактора для цього запуску:\n${stepFeedback}`
      : null,
    step.id === "final_editing"
      ? "Виконай саме власний запит редактора, але не редагуй документ напряму. Поверни результат як набір локальних карток за стандартним recommendation-card контрактом."
      : null,
    step.id === "diagnostics"
      ? "Зроби сувору макродіагностику за рубрикою: головний діагноз розділу, карта розділу, ключові структурні проблеми, де потрібні підрозділи, що зайве або дубльоване, показові абзаци і пріоритетний план перебудови."
      : null,
    step.id === "diagnostics"
      ? "Використовуй саме такі markdown-заголовки другого рівня: «## Головний діагноз розділу», «## Карта розділу», «## Ключові структурні проблеми», «## Де потрібні підрозділи», «## Що зайве або дубльоване», «## Показові абзаци», «## Пріоритетний план перебудови»."
      : null,
    step.id === "diagnostics"
      ? "У блоці «Карта розділу» покрий увесь документ великими смисловими зонами без пропусків; кожен абзац має належати рівно одній зоні."
      : null,
    step.id === "diagnostics"
      ? "У блоці «Показові абзаци» розбирай 8-15 найпоказовіших абзаців як докази великих проблем. Для кожного абзацу поясни, яку саме системну поломку він доводить."
      : null,
    step.id === "fact_check"
      ? "Не перевіряй і не перераховуй усе підряд. Твоя задача - знайти тільки твердження, які редактор має поставити під сумнів: застаріла або радянська медична рамка, слабка доказовість, надто категоричний причинно-наслідковий висновок, лікувальна або профілактична обіцянка, конкретні числа, відсотки, дозування, тривалість, ризики, лабораторні пороги або підозрілі одиниці вимірювання. Коректні або несуттєві твердження пропускай мовчки."
      : null,
    step.id === "fact_check"
      ? "Оцінюй за стандартами сучасної доказової медицини: актуальні клінічні настанови, систематичні огляди, баланс користі й шкоди, якість доказів, невизначеність. Не покладайся на авторитетність тону рукопису."
      : null,
    step.id === "fact_check"
      ? "Для кожного рядка поясни, що саме насторожує і яку перевірку треба зробити. Не вигадуй джерела, DOI, авторів, роки або URL і не вставляй посилання всередину explanation."
      : null,
    step.outputKind === "recommendation_cards"
      ? "На основі діагностики і фідбеку підготуй локальні картки змін саме для цього кроку. Не переписуй документ цілком."
      : null,
    step.outputKind === "recommendation_cards"
      ? "Якщо пропонуєш врізку, самостійно обери calloutDepth='brief' або calloutDepth='deep' відповідно до контексту статті та фрагмента."
      : null,
    step.id === "clarity"
      ? "Якщо фрагмент уже подано як перелік або серію коротких пунктів, збережи короткі окремі пункти; не роздувай кожен рядок у довгий абзац."
      : null,
    step.id === "emphasis"
      ? "Перевір кожен абзац документа по черзі. Якщо акцент справді покращує діагональне читання, повертай item; якщо ні - просто пропускай абзац."
      : null,
    step.id === "emphasis"
      ? "У кожному item обов'язково поверни blockId саме того рядка, де міститься emphasisText. Не використовуй сусідній blockId навіть якщо абзаци тематично схожі."
      : null,
    step.id === "emphasis"
      ? "Для кроку «Акценти» створюй не більше одного item на абзац. У emphasisText повертай точний підрядок із документа без перефразування, без нового змісту і без уже наявного жирного виділення."
      : null,
    emphasisCoverageGuidance ? `Орієнтир покриття:\n${emphasisCoverageGuidance}` : null,
    step.id === "emphasis"
      ? "Якщо той самий exact substring трапляється в абзаці кілька разів, додай occurrence: 1, 2, 3... щоб позначити потрібний збіг."
      : null,
    step.id === "emphasis"
      ? "Не будь надто скупим: якщо в абзаці є чітка теза, висновок, причинно-наслідковий вузол, практичний висновок або сильний контраст, який справді варто зчитати за 10-15 секунд, повертай item."
      : null,
    step.id === "emphasis"
      ? "Пропускай змістовний абзац лише тоді, коли в ньому немає жодної самостійної тези або він уже має достатньо жирного виділення. Не обмежуйся кількома найочевиднішими місцями."
      : null,
    rejectedIdeasPrompt,
    "Документ:",
    lines.join("\n")
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildRejectedIdeasPrompt(rejectedIdeas: RejectedReviewIdea[] | undefined, blocks: Block[]): string | null {
  if (!rejectedIdeas || rejectedIdeas.length === 0) {
    return null;
  }

  const blockIndexById = new Map(blocks.map((block, index) => [block.id, index]));
  const lines = rejectedIdeas.map((idea, index) => {
    const blockLabels = idea.blockIds
      .map((blockId) => {
        const blockIndex = blockIndexById.get(blockId);
        return blockIndex === undefined ? blockId : `абз. ${formatParagraphLabel(blockIndex)}`;
      })
      .join(", ");
    const recommendation = idea.recommendation
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, REJECTED_REVIEW_RECOMMENDATION_MAX_LENGTH);

    return `${index + 1}. Блоки: ${blockLabels}; тип: ${idea.recommendationType}; рекомендація: ${recommendation}`;
  });

  return [
    "Ідеї, які редактор уже відхилив:",
    lines.join("\n"),
    "Не повторюй ці ідеї як нові рекомендації. Не пропонуй той самий зміст іншими словами. Можеш повернутися до цих блоків лише якщо пропозиція має інший recommendationType або вирішує іншу проблему."
  ].join("\n");
}

async function createChunkedEmphasisReview(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  stepRunId: string,
  stepSpec: ReviewStepSpec,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<EditorialReviewProviderResult> {
  if (request.document.blocks.length <= emphasisChunkThreshold) {
    return request.provider === "gemini"
      ? createGeminiEditorialReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl)
      : request.provider === "anthropic"
        ? createAnthropicEditorialReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl)
        : createOpenAiEditorialReview(request, reviewSessionId, stepRunId, stepSpec, apiKey, fetchImpl);
  }

  const chunks = createDocumentChunks(request.document.blocks, emphasisChunkSize, emphasisChunkOverlap);
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
      revision: deriveManuscriptRevisionState(chunkDocument)
    };
    const chunkResult =
      request.provider === "gemini"
        ? await createGeminiEditorialReview(chunkRequest, reviewSessionId, `${stepRunId}:chunk-${chunkIndex + 1}`, stepSpec, apiKey, fetchImpl)
        : request.provider === "anthropic"
          ? await createAnthropicEditorialReview(chunkRequest, reviewSessionId, `${stepRunId}:chunk-${chunkIndex + 1}`, stepSpec, apiKey, fetchImpl)
          : await createOpenAiEditorialReview(chunkRequest, reviewSessionId, `${stepRunId}:chunk-${chunkIndex + 1}`, stepSpec, apiKey, fetchImpl);

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
  const filtered = filterStepItems(normalized.items, stepSpec.allowedRecommendationTypes);
  const rejectedFiltered = filterRejectedReviewIdeas(filtered.items, request.rejectedIdeas);
  const normalizedDropReasons = mergeCountMaps(
    normalized.droppedByReason,
    filtered.droppedCount > 0 ? { filtered_by_step_type: filtered.droppedCount } : undefined,
    rejectedFiltered.droppedCount > 0 ? { rejected_idea_duplicate: rejectedFiltered.droppedCount } : undefined
  );

  return {
    stepId: stepSpec.id,
    stepRunId,
    items: rejectedFiltered.items,
    factCheckRows: [],
    droppedItemCount: droppedItemCount + normalized.droppedCount + filtered.droppedCount + rejectedFiltered.droppedCount,
    droppedItemCountsByReason: mergeCountMaps(droppedByReason, normalizedDropReasons),
    filteredItemCountsByType: mergeRecommendationTypeCounts(filteredByType, filtered.droppedByType),
    providerUsed,
    rawOutput: rawOutputs.join("\n\n")
  };
}

function createDocumentChunks(blocks: Block[], chunkSize: number, overlap: number): Array<{ start: number; end: number; blocks: Block[] }> {
  if (blocks.length === 0) {
    return [];
  }

  const chunks: Array<{ start: number; end: number; blocks: Block[] }> = [];
  const step = Math.max(1, chunkSize - overlap);

  for (let start = 0; start < blocks.length; start += step) {
    const end = Math.min(blocks.length, start + chunkSize);
    chunks.push({ start, end, blocks: blocks.slice(start, end) });

    if (end >= blocks.length) {
      break;
    }
  }

  return chunks;
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

function buildEmphasisCoverageGuidance(request: EditorialReviewRequest): string {
  const eligibleBlocks = request.document.blocks.filter((block) => {
    if (block.type !== "paragraph" && block.type !== "heading") {
      return false;
    }

    return getBlockText(block).replace(/\s+/g, " ").trim().length >= 40;
  }).length;

  const { minShare, maxShare } = getEmphasisCoverageTargets();

  const minItems = Math.max(1, Math.round(eligibleBlocks * minShare));
  const maxItems = Math.max(minItems, Math.round(eligibleBlocks * maxShare));

  return `М'який орієнтир для цього документа: приблизно ${minItems}-${maxItems} акцентів на ${eligibleBlocks} змістовних абзаців/заголовків. Це не жорстка квота, але слід покривати значну частину змістовного тексту, а не повертати лише поодинокі акценти. Краще повернути доречний короткий акцент для кожного сильного абзацу, ніж залишити добрі тези без виділення.`;
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
  fetchImpl: FetchLike
): Promise<EditorialFactCheckRow[]> {
  const rawOutput = extractGeminiText(payload);

  if (!rawOutput) {
    throw new Error("Gemini не повернув текст для grounded fact-check.");
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
      status: "сумнівно",
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
  if (value === "ok" || value === "сумнівно" || value === "не підтверджено") {
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
    return "сумнівно";
  }

  if (normalized === "не підтверджено" || normalized === "непідтверджено" || normalized === "unverified") {
    return "не підтверджено";
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
      status: "не підтверджено",
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
          calloutPrompt: buildFallbackCalloutPrompt("mechanism", fallbackDepth, nextText, "Пояснити механізм простими словами."),
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
        title: getEditorialCalloutKindLabel(kind),
        prompt: buildFallbackCalloutPrompt(kind, depth, excerpt, item.recommendation),
        previewText: excerpt.slice(0, depth === "deep" ? 1200 : 180),
        summary: item.reason
      }
    };
  });
}

function buildFallbackCalloutPrompt(kind: EditorialCalloutKind, depth: EditorialCalloutDepth, fragment: string, recommendation: string): string {
  return [
    `Тип врізки: ${getEditorialCalloutKindLabel(kind)}.`,
    `Глибина врізки: ${depth === "deep" ? "deep / докладно" : "brief / стисло"}.`,
    `Фрагмент: ${fragment}`,
    `Редакторська задача: ${recommendation}`
  ].join("\n");
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

async function readProviderText(response: Response): Promise<string> {
  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "OpenAI недоступний.");
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const content = payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n").trim();

  if (!content) {
    throw new Error("OpenAI не повернув коректний JSON.");
  }

  return content;
}

async function readGeminiText(response: Response): Promise<string> {
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Gemini недоступний.");
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();

  if (!text) {
    throw new Error("Gemini не повернув коректний JSON.");
  }

  return text;
}

async function readAnthropicText(response: Response): Promise<string> {
  const payload = (await response.json()) as {
    content?: Array<{ text?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Anthropic недоступний.");
  }

  const text = payload.content?.map((part) => part.text ?? "").join("\n").trim();

  if (!text) {
    throw new Error("Anthropic не повернув коректний JSON.");
  }

  return text;
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
