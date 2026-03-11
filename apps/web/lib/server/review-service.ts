import { createPatchId } from "../editor/patch-contract.ts";
import {
  getEditorialCalloutKindLabel,
  normalizeEditorialReviewItems,
  type EditorialReviewItem,
  type EditorialCalloutKind,
  type EditorialReviewRequest,
  type EditorialReviewResponse
} from "../editor/review-contract.ts";
import { getBlockText } from "../editor/document-model.ts";
import { formatParagraphLabel } from "../editor/manuscript-structure.ts";
import { readServerEnvValue } from "./env.ts";
import { resolveProviderApiKey } from "./patch-service.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const anthropicVersion = "2023-06-01";
const reviewRequestTimeoutMs = 45000;

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
              { type: "string", enum: ["diagram", "comparison", "process", "timeline", "scene", "concept"] },
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

type FetchLike = typeof fetch;
type EditorialReviewProviderResult = {
  items: EditorialReviewItem[];
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
  const requestId = createPatchId("review");
  const reviewSessionId = createPatchId("review-session");
  const fetchImpl = options.fetchImpl ?? fetch;
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
  const now = options.now ?? (() => new Date().toISOString());
  const blockCount = request.document.blocks.length;

  if (blockCount === 0) {
    return buildEditorialReviewResponse({
      requestId,
      reviewSessionId,
      requestedProvider: request.provider,
      requestedModelId: request.modelId,
      providerUsed: "invalid-text",
      blockCount,
      changeLevel: request.changeLevel,
      items: [],
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
      error: `Немає API key для ${providerDisplayName(request.provider)} у формі або .env, тому показано локальний редакторський огляд.`,
      generatedAt: now()
    });
  }

  try {
    const result =
      request.provider === "gemini"
        ? await createGeminiEditorialReview(request, reviewSessionId, apiKey, fetchImpl)
        : request.provider === "anthropic"
          ? await createAnthropicEditorialReview(request, reviewSessionId, apiKey, fetchImpl)
          : await createOpenAiEditorialReview(request, reviewSessionId, apiKey, fetchImpl);

    return buildEditorialReviewResponse({
      requestId,
      reviewSessionId,
      requestedProvider: request.provider,
      requestedModelId: request.modelId,
      providerUsed: result.providerUsed,
      blockCount,
      changeLevel: request.changeLevel,
      items: result.items,
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
      error: error instanceof Error ? error.message : `${providerDisplayName(request.provider)} недоступний, тому показано локальний редакторський огляд.`,
      generatedAt: now()
    });
  }
}

function buildEditorialReviewResponse(input: {
  requestId: string;
  reviewSessionId: string;
  requestedProvider: string;
  requestedModelId: string;
  providerUsed: string;
  blockCount: number;
  changeLevel: EditorialReviewRequest["changeLevel"];
  items: EditorialReviewItem[];
  expertise?: string;
  droppedItemCount: number;
  usedFallback: boolean;
  generatedAt: string;
  rawOutput?: string;
  error?: string;
}): EditorialReviewResponse {
  return {
    reviewSessionId: input.reviewSessionId,
    items: input.items,
    expertise: input.expertise,
    providerUsed: input.providerUsed,
    usedFallback: input.usedFallback,
    error: input.error,
    diagnostics: {
      requestId: input.requestId,
      reviewSessionId: input.reviewSessionId,
      requestedProvider: input.requestedProvider,
      requestedModelId: input.requestedModelId,
      blockCount: input.blockCount,
      changeLevel: input.changeLevel,
      returnedItemCount: input.items.length,
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
  error: string;
  generatedAt: string;
}): EditorialReviewResponse {
  return buildEditorialReviewResponse({
    requestId: input.requestId,
    reviewSessionId: input.reviewSessionId,
    requestedProvider: input.request.provider,
    requestedModelId: input.request.modelId,
    providerUsed: `fallback:${input.request.provider}`,
    blockCount: input.request.document.blocks.length,
    changeLevel: input.request.changeLevel,
    items: createFallbackEditorialReviewItems(input.request, input.reviewSessionId),
    droppedItemCount: 0,
    usedFallback: true,
    error: input.error,
    generatedAt: input.generatedAt
  });
}

async function createOpenAiEditorialReview(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<EditorialReviewProviderResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), reviewRequestTimeoutMs);

  try {
    const isExpertise = request.currentStatus === "expertise" || !request.currentStatus;
    const body: any = {
      model: request.modelId,
      temperature: 0.2,
      instructions: buildEditorialReviewSystemPrompt(request),
      input: buildEditorialReviewUserPrompt(request)
    };

    if (!isExpertise) {
      body.text = {
        format: {
          type: "json_schema",
          name: "editorial_review",
          strict: true,
          schema: openAiSchema
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

    if (isExpertise) {
      return { expertise: rawOutput, items: [], droppedItemCount: 0, providerUsed: "openai", rawOutput };
    }

    return buildNormalizedReviewResult(request, reviewSessionId, parseEditorialReviewItems(rawOutput), "openai", rawOutput);
  } finally {
    clearTimeout(timeout);
  }
}

async function createGeminiEditorialReview(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<EditorialReviewProviderResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), reviewRequestTimeoutMs);

  try {
    const isExpertise = request.currentStatus === "expertise" || !request.currentStatus;
    const body: any = {
      systemInstruction: {
        parts: [{ text: buildEditorialReviewSystemPrompt(request) }]
      },
      contents: [{ role: "user", parts: [{ text: buildEditorialReviewUserPrompt(request) }] }],
      generationConfig: {
        temperature: 0.2
      }
    };

    if (!isExpertise) {
      body.generationConfig.responseMimeType = "application/json";
      body.generationConfig.responseSchema = geminiSchema;
    }

    const response = await fetchImpl(`${geminiBaseUrl}/${request.modelId}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const rawOutput = await readGeminiText(response);

    if (isExpertise) {
      return { expertise: rawOutput, items: [], droppedItemCount: 0, providerUsed: "gemini", rawOutput };
    }

    return buildNormalizedReviewResult(request, reviewSessionId, parseEditorialReviewItems(rawOutput), "gemini", rawOutput);
  } finally {
    clearTimeout(timeout);
  }
}

async function createAnthropicEditorialReview(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<EditorialReviewProviderResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), reviewRequestTimeoutMs);

  try {
    const isExpertise = request.currentStatus === "expertise" || !request.currentStatus;
    const systemPrompt = isExpertise
      ? `${buildEditorialReviewSystemPrompt(request)} Роби розлогий критичний аналіз тексту.`
      : `${buildEditorialReviewSystemPrompt(request)} Поверни лише JSON-об'єкт {"items":[...]} без markdown.`;

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
        messages: [{ role: "user", content: buildEditorialReviewUserPrompt(request) }]
      }),
      signal: controller.signal
    });

    const rawOutput = await readAnthropicText(response);

    if (isExpertise) {
      return { expertise: rawOutput, items: [], droppedItemCount: 0, providerUsed: "anthropic", rawOutput };
    }

    return buildNormalizedReviewResult(request, reviewSessionId, parseEditorialReviewItems(rawOutput), "anthropic", rawOutput);
  } finally {
    clearTimeout(timeout);
  }
}

function buildNormalizedReviewResult(
  request: EditorialReviewRequest,
  reviewSessionId: string,
  items: unknown,
  providerUsed: string,
  rawOutput?: string
): EditorialReviewProviderResult {
  const normalized = normalizeEditorialReviewItems({
    document: request.document,
    revision: request.revision,
    reviewSessionId,
    changeLevel: request.changeLevel,
    items: items && typeof items === "object" && "items" in (items as Record<string, unknown>) ? (items as { items: unknown }).items : items
  });

  if (normalized.items.length === 0) {
    throw new Error(`${providerDisplayName(providerUsed)} повернув порожні або невалідні рекомендації.`);
  }

  return {
    items: hydratedReviewItems(normalized.items, request),
    droppedItemCount: normalized.droppedCount,
    providerUsed,
    rawOutput
  };
}

function buildEditorialReviewSystemPrompt(request: EditorialReviewRequest): string {
  const isExpertise = request.currentStatus === "expertise" || !request.currentStatus;

  const basePrompts = [
    request.basePrompt?.trim(),
    request.reviewPrompt?.trim(),
    request.reviewLevelGuide?.trim(),
    "Ти робиш редакторський review всього документа."
  ];

  if (isExpertise) {
    basePrompts.push(
      "Зараз етап ЕКСПЕРТИЗИ. Твоє завдання — проаналізувати текст загалом, вказати на структурні, логічні та стилістичні проблеми.",
      "Зверни особливу увагу на кастомні інструкції користувача.",
      "Відповідай у форматі Markdown. Будь професійним, але лаконічним редактором.",
      "Якщо посилаєшся на фрагмент, використовуй лише формат «абз. NNN». Не показуй raw block id."
    );
  } else {
    basePrompts.push(
      "Зараз етап ГЕНЕРАЦІЇ ПРАВОК. На основі попереднього аналізу та діалогу з користувачем, запропонуй конкретні локальні зміни.",
      "Кожна рекомендація має бути прив'язана до одного або кількох суміжних абзаців.",
      "Доступні типи (recommendationType): 'rewrite', 'expand', 'simplify', 'list', 'subsection', 'callout', 'visual'.",
      "replace-типи ('rewrite', 'expand', 'simplify', 'list') мають suggestedAction='rewrite_text' та insertionHint='replace'.",
      "Тип 'subsection' має suggestedAction='insert_text' та insertionHint='before'.",
      "Тип 'callout' має suggestedAction='prepare_callout' та insertionHint='after'.",
      "Тип 'visual' має suggestedAction='prepare_visual' та insertionHint='after'.",
      "Для callout дозволені лише calloutKind: mechanism, analogy, everyday_application, myths_vs_truth, top_list.",
      "Для visual дозволені visualIntent: diagram, comparison, process, timeline, scene, concept.",
      "Для blockStart і blockEnd використовуй нульову нумерацію рядків документа, подану на початку кожного рядка.",
      "У полях title, reason і recommendation не згадуй raw block id, коди чи жорстко зашиті номери абзаців. UI покаже діапазон окремо.",
      "Не переписуй весь документ. Пропонуй лише локальні дії з високою цінністю."
    );
  }

  basePrompts.push(
    "IDs у квадратних дужках призначені лише для внутрішньої прив'язки.",
    "У user-facing тексті не показуй raw id."
  );

  return basePrompts.filter(Boolean).join("\n\n");
}

function buildEditorialReviewUserPrompt(request: EditorialReviewRequest): string {
  const lines = request.document.blocks.map(
    (block, index) => `${index}. абз. ${formatParagraphLabel(index)} [${block.id}] ${getBlockText(block)}`
  );
  const historyLines = (request.history ?? []).map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`);

  return [
    historyLines.length > 0 ? `Контекст діалогу:\n${historyLines.join("\n")}` : null,
    `Рівень змін: ${request.changeLevel}/5.`,
    request.additionalInstructions?.trim() ? `Додаткові інструкції користувача: ${request.additionalInstructions.trim()}` : null,
    "Оціни документ по блоках. Поверни лише найцінніші рекомендації.",
    "Документ:",
    lines.join("\n")
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseEditorialReviewItems(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = /\{[\s\S]*\}/.exec(content);
    return match ? JSON.parse(match[0]) : { items: [] };
  }
}

export function createFallbackEditorialReviewItems(request: EditorialReviewRequest, reviewSessionId: string): EditorialReviewItem[] {
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
