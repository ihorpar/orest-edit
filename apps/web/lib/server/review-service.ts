import { createPatchId } from "../editor/patch-contract.ts";
import {
  getEditorialCalloutKindLabel,
  normalizeEditorialReviewItems,
  type EditorialFactCheckRow,
  type EditorialReviewItem,
  type EditorialReviewRecommendationType,
  type EditorialCalloutKind,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  type EditorialReviewStepId,
  type EditorialStepRunMode,
  type FactCheckStatus
} from "../editor/review-contract.ts";
import { blockToPromptText, getBlockText, type Block } from "../editor/document-model.ts";
import { formatParagraphLabel } from "../editor/manuscript-structure.ts";
import { CHANGE_LEVEL_GUIDANCE } from "../editor/settings.ts";
import { readServerEnvValue } from "./env.ts";
import { resolveProviderApiKey } from "./patch-service.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const anthropicVersion = "2023-06-01";
const reviewRequestTimeoutMs = 120000;

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
          status: { type: "string", enum: ["ok", "сумнівно", "не підтверджено"] },
          explanation: { type: "string" }
        },
        required: ["claim", "status", "explanation"]
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
          explanation: { type: "STRING" }
        },
        required: ["claim", "status", "explanation"]
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
    systemInstruction:
      "Зроби розгорнуту редакторську діагностику рукопису: загальна картина, логіка аргументації, ризикові місця, і поблочний розбір. Це review-only крок, без карток дій."
  },
  fact_check: {
    id: "fact_check",
    title: "Перевірка фактів",
    outputKind: "fact_check_rows",
    systemInstruction:
      "Ти працюєш як науковий фактчекер. Повертай лише структуровані рядки таблиці, без редакторських карток."
  },
  structure: {
    id: "structure",
    title: "Структура",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["subsection", "list", "rewrite", "callout"],
    cardGuidance:
      "Фокус: архітектура розділу, послідовність думки, місця для підзаголовків і дроблення масивних блоків.",
    systemInstruction:
      "Оціни та покращ структуру розділу: де додати підзаголовки, де розділити блоки, де корисні локальні врізки."
  },
  clarity: {
    id: "clarity",
    title: "Ясність",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["simplify", "rewrite", "expand", "list"],
    cardGuidance:
      "Фокус: пояснити складне просто, прибрати перевантажені формулювання, кальки й зайву категоричність, зберегти точність без академічної перевантаженості та без шаблонних застережень.",
    systemInstruction:
      "Працюй як редактор ясності: спрощуй формулювання, прибирай канцеляризм, знижуй зайву категоричність і зберігай структуру подачі. Не перетворюй локальні правки на медичні дисклеймери чи поради звернутися до лікаря."
  },
  interest: {
    id: "interest",
    title: "Інтерес і застосовність",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["callout", "expand", "rewrite", "visual"],
    cardGuidance:
      "Фокус: читабельний інтерес, зв'язок із реальним життям, практичне застосування і мотивація дочитати розділ.",
    systemInstruction:
      "Підсилюй інтерес і застосовність: шукай місця, де читачеві потрібні побутові приклади, практичні кроки або виразні візуальні опори."
  },
  visuals: {
    id: "visuals",
    title: "Візуали",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["visual"],
    cardGuidance:
      "Фокус: де і який візуал дає найбільшу користь. Схема вважається підтипом інфографіки.",
    systemInstruction:
      "Генеруй лише рекомендації для візуалів: ілюстрація або інфографіка (включно зі схемою як підтипом інфографіки)."
  },
  formatting: {
    id: "formatting",
    title: "Форматування",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["list", "callout", "subsection", "rewrite"],
    cardGuidance:
      "Фокус: де потрібні списки, таблиці, врізки і компактні формати подачі для швидкого сканування.",
    systemInstruction:
      "Переформатовуй подачу: шукай місця для списків, врізок, табличного або блочного оформлення без повного переписування розділу."
  },
  final_editing: {
    id: "final_editing",
    title: "Фінальна редактура",
    outputKind: "recommendation_cards",
    allowedRecommendationTypes: ["rewrite", "simplify", "list"],
    cardGuidance:
      "Фокус: правопис, пунктуація, термінологічна послідовність, дрібні стилістичні шорсткості перед фінальним проходом.",
    systemInstruction:
      "Проведи фінальну редактуру: виправ орфографію, пунктуацію, стилістичні неузгодженості та дрібні мовні збої."
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
  providerUsed: string;
  rawOutput?: string;
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
      request.provider === "gemini"
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
      factCheckRows: result.factCheckRows ?? [],
      expertise: result.expertise,
      droppedItemCount: result.droppedItemCount,
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
  const fallbackItems = filterStepItems(rawFallbackItems, stepSpec.allowedRecommendationTypes);
  const fallbackDroppedCount = rawFallbackItems.length - fallbackItems.length;
  const fallbackFactRows = stepSpec.outputKind === "fact_check_rows" ? createFallbackFactCheckRows(input.request) : [];
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
      temperature: 0.2,
      instructions: buildStepSystemPrompt(request, stepSpec),
      input: buildStepUserPrompt(request, stepSpec)
    };

    if (expectsJson) {
      body.text = {
        format: {
          type: "json_schema",
          name: stepSpec.outputKind === "fact_check_rows" ? "fact_check_rows" : "editorial_review",
          strict: true,
          schema: stepSpec.outputKind === "fact_check_rows" ? openAiFactCheckSchema : openAiSchema
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
      body.generationConfig.responseSchema = stepSpec.outputKind === "fact_check_rows" ? geminiFactCheckSchema : geminiSchema;
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

    if (stepSpec.outputKind === "fact_check_rows") {
      return {
        stepId: stepSpec.id,
        stepRunId,
        items: [],
        factCheckRows: parseFactCheckRows(rawOutput),
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

  const filteredItems = filterStepItems(normalized.items, stepSpec.allowedRecommendationTypes);
  const droppedCount = normalized.droppedCount + (normalized.items.length - filteredItems.length);

  return {
    stepId: stepSpec.id,
    stepRunId,
    items: hydratedReviewItems(filteredItems, request),
    factCheckRows: [],
    droppedItemCount: droppedCount,
    providerUsed,
    rawOutput
  };
}

function filterStepItems(
  items: EditorialReviewItem[],
  allowedRecommendationTypes?: EditorialReviewRecommendationType[]
): EditorialReviewItem[] {
  if (!allowedRecommendationTypes || allowedRecommendationTypes.length === 0) {
    return items;
  }

  return items.filter((item) => allowedRecommendationTypes.includes(item.recommendationType));
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

function buildStepSystemPrompt(request: EditorialReviewRequest, step: ReviewStepSpec): string {
  const levelGuidance = CHANGE_LEVEL_GUIDANCE[request.changeLevel];
  const blockCount = request.document.blocks.length;
  const targetCards =
    step.outputKind === "recommendation_cards" ? Math.max(2, Math.round(blockCount / levelGuidance.blocksPerCard)) : null;

  return [
    request.basePrompt?.trim(),
    step.outputKind === "analysis_markdown" ? request.expertisePrompt?.trim() : request.cardsPrompt?.trim() || request.reviewPrompt?.trim(),
    request.reviewLevelGuide?.trim(),
    `Крок workflow: ${step.title}.`,
    step.systemInstruction,
    `Рівень змін: ${request.changeLevel}/5. ${step.outputKind === "analysis_markdown" ? levelGuidance.expertiseTone : levelGuidance.cardsGuidance}`,
    step.cardGuidance ? `Окремий фокус кроку: ${step.cardGuidance}` : null,
    targetCards ? `Орієнтир за кількістю карток: приблизно ${targetCards}, але тільки реальні проблеми.` : null,
    step.outputKind === "analysis_markdown"
      ? "Формат відповіді: Markdown, українською мовою, з посиланнями на абзаци у вигляді «абз. NNN»."
      : null,
    step.outputKind === "fact_check_rows"
      ? "Формат відповіді: JSON {\"rows\":[{\"claim\":\"...\",\"status\":\"ok|сумнівно|не підтверджено\",\"explanation\":\"...\"}]} без markdown."
      : null,
    step.outputKind === "recommendation_cards"
      ? "Формат відповіді: JSON {\"items\":[...]} за контрактом рекомендацій. Не додавай будь-який текст поза JSON."
      : null,
    step.outputKind === "recommendation_cards"
      ? "Для blockStart і blockEnd використовуй нульову нумерацію рядків документа. Не згадуй block id у title/reason/recommendation."
      : null,
    step.id === "clarity"
      ? "Для кроку «Ясність» пропонуй лише мовні й локально-структурні правки: спрощення, ущільнення, локальне пом'якшення категоричності, пояснення термінів простішими словами, виправлення кальок і незграбних конструкцій."
      : null,
    step.id === "clarity"
      ? "Не пропонуй шаблонних застережень про консультацію з лікарем, самодіагностику, «варто перевірити стан» або інших повторюваних пересторог, якщо цього прямо не просить редактор і цього немає у фрагменті."
      : null,
    "IDs у квадратних дужках призначені лише для прив'язки і не мають з'являтися в user-facing тексті."
  ].filter(Boolean).join("\n\n");
}

function buildStepUserPrompt(request: EditorialReviewRequest, step: ReviewStepSpec): string {
  const lines = request.document.blocks.map(
    (block, index) => `${index}. абз. ${formatParagraphLabel(index)} [${block.id}] ${getReviewPromptBlockText(block)}`
  );
  const historyLines = (request.history ?? []).map((msg) => `${msg.role === "user" ? "КОРИСТУВАЧ" : "АСИСТЕНТ"}: ${msg.content}`);
  const diagnosticsExpertise = request.stepContext?.diagnosticsExpertise?.trim() || request.expertise?.trim();
  const diagnosticsFeedback = request.stepContext?.diagnosticsFeedback?.trim();
  const stepFeedback = request.stepContext?.currentStepFeedback?.trim() || request.stepFeedback?.trim();

  return [
    diagnosticsExpertise && step.id !== "diagnostics" ? `Контекст діагностики:\n${diagnosticsExpertise}` : null,
    diagnosticsFeedback && step.id !== "diagnostics" ? `Фідбек користувача до діагностики:\n${diagnosticsFeedback}` : null,
    stepFeedback ? `Фідбек користувача для кроку «${step.title}»:\n${stepFeedback}` : null,
    historyLines.length > 0 ? `Релевантний контекст діалогу:\n${historyLines.join("\n")}` : null,
    `Рівень змін: ${request.changeLevel}/5.`,
    request.additionalInstructions?.trim() ? `Додаткові інструкції редактора: ${request.additionalInstructions.trim()}` : null,
    step.id === "diagnostics"
      ? "Зроби детальну діагностику: загальний огляд, сильні/слабкі місця, поблочний розбір із посиланням на «абз. NNN»."
      : null,
    step.id === "fact_check"
      ? "Перевір кожне наукове або медично значуще твердження. Для спірних фактів пояснюй, що саме викликає сумнів, у полі explanation. Якщо релевантне джерело відоме, коротко згадай його прямо в explanation (автор/організація, рік)."
      : null,
    step.outputKind === "recommendation_cards"
      ? "На основі діагностики і фідбеку підготуй локальні картки змін саме для цього кроку. Не переписуй документ цілком."
      : null,
    step.id === "clarity"
      ? "Якщо фрагмент уже подано як перелік або серію коротких пунктів, збережи короткі окремі пункти; не роздувай кожен рядок у довгий абзац."
      : null,
    "Документ:",
    lines.join("\n")
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getReviewPromptBlockText(block: Block): string {
  if (block.type === "image") {
    return blockToPromptText(block);
  }

  return getBlockText(block);
}

function parseEditorialReviewItems(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = /\{[\s\S]*\}/.exec(content);
    return match ? JSON.parse(match[0]) : { items: [] };
  }
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

    if (!claim || !explanation || !status) {
      continue;
    }

    normalized.push({
      claim,
      status,
      explanation
    });
  }

  if (normalized.length === 0) {
    throw new Error("Модель не повернула валідних рядків факт-чеку.");
  }

  return normalized;
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
        "Потрібна окрема перевірка джерел: наведіть першоджерело (автори, рік, журнал або офіційний гайдлайн) перед редакторським затвердженням."
    });
  });

  if (rows.length > 0) {
    return rows;
  }

  return [
    {
      claim: "Явних перевірюваних тверджень із числовими або науковими маркерами не знайдено автоматичним fallback.",
      status: "ok",
      explanation: "Для повного факт-чеку запустіть крок із доступним AI-провайдером."
    }
  ];
}

export function createFallbackEditorialReviewItems(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  stepId: EditorialReviewStepId,
  stepRunId: string
): EditorialReviewItem[] {
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
          calloutTitle: "Як це працює",
          calloutPreviewText: nextText.slice(0, 160),
          calloutSummary: "Підсилити пояснення окремою врізкою.",
          calloutPrompt: buildFallbackCalloutPrompt("mechanism", nextText, "Пояснити механізм простими словами."),
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

function hydratedReviewItems(items: EditorialReviewItem[], request: EditorialReviewRequest): EditorialReviewItem[] {
  return items.map((item) => {
    if (item.recommendationType !== "callout" || item.suggestedAction !== "prepare_callout" || item.calloutDraft) {
      return item;
    }

    const excerpt = item.anchor.excerpt || item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");
    const kind: EditorialCalloutKind = item.calloutKind ?? "mechanism";

    return {
      ...item,
      calloutKind: kind,
      calloutDraft: {
        calloutKind: kind,
        title: getEditorialCalloutKindLabel(kind),
        prompt: buildFallbackCalloutPrompt(kind, excerpt, item.recommendation),
        previewText: excerpt.slice(0, 180),
        summary: item.reason
      }
    };
  });
}

function buildFallbackCalloutPrompt(kind: EditorialCalloutKind, fragment: string, recommendation: string): string {
  return [
    `Тип врізки: ${getEditorialCalloutKindLabel(kind)}.`,
    `Фрагмент: ${fragment}`,
    `Редакторська задача: ${recommendation}`
  ].join("\n");
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
