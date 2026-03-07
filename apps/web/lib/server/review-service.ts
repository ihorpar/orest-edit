import { createPatchId } from "../editor/patch-contract.ts";
import {
  normalizeEditorialReviewItems,
  type EditorialReviewItem,
  type EditorialCalloutKind,
  type EditorialReviewRequest,
  type EditorialReviewResponse
} from "../editor/review-contract.ts";
import { computeAnchorFingerprint, findParagraphForOffset, formatParagraphLabel, getManuscriptParagraphs, getParagraphRangeText } from "../editor/manuscript-structure.ts";
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
            enum: ["rewrite", "expand", "simplify", "list", "subsection", "callout", "visualize", "illustration"]
          },
          suggestedAction: { type: "string", enum: ["rewrite_text", "insert_text", "prepare_callout", "prepare_visual"] },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          paragraphStart: { type: "integer" },
          paragraphEnd: { type: "integer" },
          excerpt: { type: "string" },
          insertionHint: { type: "string", enum: ["replace", "before", "after", "subsection_after"] },
          calloutKind: {
            anyOf: [
              { type: "string", enum: ["quick_fact", "mini_story", "mechanism_explained", "step_by_step", "myth_vs_fact"] },
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
          "paragraphStart",
          "paragraphEnd",
          "excerpt",
          "insertionHint"
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
          paragraphStart: { type: "INTEGER" },
          paragraphEnd: { type: "INTEGER" },
          excerpt: { type: "STRING" },
          insertionHint: { type: "STRING" },
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
          "paragraphStart",
          "paragraphEnd",
          "excerpt",
          "insertionHint",
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
  droppedItemCount: number;
  droppedCalloutDraftCount: number;
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
  const textLength = request.text.length;

  if (!request.text.trim()) {
    return buildEditorialReviewResponse({
      requestId,
      reviewSessionId,
      requestedProvider: request.provider,
      requestedModelId: request.modelId,
      providerUsed: "invalid-text",
      textLength,
      changeLevel: request.changeLevel,
      items: [],
      droppedItemCount: 0,
      droppedCalloutDraftCount: 0,
      usedFallback: false,
      error: "Текст порожній. Немає що аналізувати.",
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
      textLength,
      changeLevel: request.changeLevel,
      items: result.items,
      droppedItemCount: result.droppedItemCount,
      droppedCalloutDraftCount: result.droppedCalloutDraftCount,
      usedFallback: false,
      error: buildReviewDropError(result.droppedItemCount, result.droppedCalloutDraftCount),
      generatedAt: now(),
      rawOutput: result.rawOutput
    });
  } catch (error) {
    return buildFallbackEditorialReviewResponse({
      request,
      requestId,
      reviewSessionId,
      error: error instanceof Error ? error.message : `${providerDisplayName(request.provider)} недоступний, тому показано локальний редакторський огляд.`,
      generatedAt: now(),
      rawOutput: error instanceof EditorialReviewProviderError ? error.rawOutput : undefined
    });
  }
}

function buildEditorialReviewResponse(input: {
  requestId: string;
  reviewSessionId: string;
  requestedProvider: string;
  requestedModelId: string;
  providerUsed: string;
  textLength: number;
  changeLevel: EditorialReviewRequest["changeLevel"];
  items: EditorialReviewItem[];
  droppedItemCount: number;
  droppedCalloutDraftCount: number;
  usedFallback: boolean;
  generatedAt: string;
  rawOutput?: string;
  error?: string;
}): EditorialReviewResponse {
  return {
    reviewSessionId: input.reviewSessionId,
    items: input.items,
    providerUsed: input.providerUsed,
    usedFallback: input.usedFallback,
    error: input.error,
    diagnostics: {
      requestId: input.requestId,
      reviewSessionId: input.reviewSessionId,
      requestedProvider: input.requestedProvider,
      requestedModelId: input.requestedModelId,
      textLength: input.textLength,
      changeLevel: input.changeLevel,
      returnedItemCount: input.items.length,
      droppedItemCount: input.droppedItemCount + input.droppedCalloutDraftCount,
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
  rawOutput?: string;
}): EditorialReviewResponse {
  return buildEditorialReviewResponse({
    requestId: input.requestId,
    reviewSessionId: input.reviewSessionId,
    requestedProvider: input.request.provider,
    requestedModelId: input.request.modelId,
    providerUsed: input.request.provider,
    textLength: input.request.text.length,
    changeLevel: input.request.changeLevel,
    items: createFallbackEditorialReviewItems(input.request, input.reviewSessionId),
    droppedItemCount: 0,
    droppedCalloutDraftCount: 0,
    usedFallback: true,
    error: input.error,
    generatedAt: input.generatedAt,
    rawOutput: input.rawOutput
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
    const response = await fetchImpl(openAiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: request.modelId,
        temperature: 0.2,
        instructions: buildEditorialReviewSystemPrompt(request),
        input: buildEditorialReviewUserPrompt(request.text, request.additionalInstructions),
        text: {
          format: {
            type: "json_schema",
            name: "editorial_review_v2",
            strict: true,
            schema: openAiSchema
          }
        },
        store: false
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(readProviderErrorMessage(payload) ?? `OpenAI повернув статус ${response.status}.`);
    }

    const rawOutput = readOpenAiContent(payload);

    try {
      return buildNormalizedReviewResult(request, reviewSessionId, parseEditorialReviewItems(rawOutput), "openai", rawOutput);
    } catch (error) {
      throw wrapReviewProviderError(error, rawOutput);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("OpenAI не відповів вчасно, тому показано локальний редакторський огляд.");
    }

    throw error;
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
  const endpoint = `${geminiBaseUrl}/${encodeURIComponent(request.modelId)}:generateContent`;

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
            parts: [{ text: `${buildEditorialReviewSystemPrompt(request)}\n\n${buildEditorialReviewUserPrompt(request.text, request.additionalInstructions)}` }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseJsonSchema: geminiSchema
        }
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(readGeminiErrorMessage(payload) ?? `Gemini повернув статус ${response.status}.`);
    }

    const rawOutput = readGeminiContent(payload);

    try {
      return buildNormalizedReviewResult(request, reviewSessionId, parseEditorialReviewItems(rawOutput), "gemini", rawOutput);
    } catch (error) {
      throw wrapReviewProviderError(error, rawOutput);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Gemini не відповів вчасно, тому показано локальний редакторський огляд.");
    }

    throw error;
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
    const response = await fetchImpl(anthropicEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": anthropicVersion
      },
      body: JSON.stringify({
        model: request.modelId,
        max_tokens: 1800,
        temperature: 0.2,
        system: `${buildEditorialReviewSystemPrompt(request)} Поверни лише JSON-об'єкт {"items":[...]} без markdown.`,
        messages: [{ role: "user", content: buildEditorialReviewUserPrompt(request.text, request.additionalInstructions) }]
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(readProviderErrorMessage(payload) ?? `Anthropic повернув статус ${response.status}.`);
    }

    const rawOutput = readAnthropicContent(payload);

    try {
      return buildNormalizedReviewResult(request, reviewSessionId, parseEditorialReviewItems(rawOutput), "anthropic", rawOutput);
    } catch (error) {
      throw wrapReviewProviderError(error, rawOutput);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Anthropic не відповів вчасно, тому показано локальний редакторський огляд.");
    }

    throw error;
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
    text: request.text,
    revision: request.revision,
    reviewSessionId,
    changeLevel: request.changeLevel,
    items
  });

  if (normalized.items.length === 0 || normalized.droppedCount > 0) {
    const repairedItems = repairEditorialReviewItems(request.text, items);

    if (repairedItems) {
      const repairedNormalized = normalizeEditorialReviewItems({
        text: request.text,
        revision: request.revision,
        reviewSessionId,
        changeLevel: request.changeLevel,
        items: repairedItems
      });

      if (repairedNormalized.items.length > 0) {
        const hydrated = hydrateAndFilterCalloutDrafts(repairedNormalized.items, request);

        return {
          items: hydrated.items,
          droppedItemCount: repairedNormalized.droppedCount,
          droppedCalloutDraftCount: hydrated.droppedCalloutDraftCount,
          providerUsed,
          rawOutput: clampRawOutput(rawOutput)
        };
      }
    }
  }

  if (normalized.items.length === 0) {
    throw new EditorialReviewProviderError(`${providerDisplayName(providerUsed)} повернув порожні або невалідні рекомендації.`, rawOutput);
  }

  const hydrated = hydrateAndFilterCalloutDrafts(normalized.items, request);

  return {
    items: hydrated.items,
    droppedItemCount: normalized.droppedCount,
    droppedCalloutDraftCount: hydrated.droppedCalloutDraftCount,
    providerUsed,
    rawOutput: clampRawOutput(rawOutput)
  };
}

function repairEditorialReviewItems(text: string, items: unknown): unknown[] | null {
  if (!Array.isArray(items)) {
    return null;
  }

  let changed = false;

  const repaired = items.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return candidate;
    }

    const record = { ...(candidate as Record<string, unknown>) };
    const title = firstString(record.title, record.problem, record.issue, record.heading, record.label);
    const reason = firstString(record.reason, record.explanation, record.whyItMatters, record.why, record.comment, record.rationale, record.description);
    const recommendation = firstString(
      record.recommendation,
      record.action,
      record.suggestedActionText,
      record.fix,
      record.proposal,
      record.editorAction
    );
    const recommendationType = normalizeRecommendationTypeAlias(firstString(record.recommendationType, record.type, record.kind, record.category));
    const suggestedAction = normalizeSuggestedActionAlias(firstString(record.suggestedAction, record.nextAction, record.executionMode));
    const priority = normalizePriorityAlias(firstString(record.priority, record.severity, record.level, record.importance));
    const insertionHint = normalizeInsertionHintAlias(firstString(record.insertionHint, record.insertMode, record.insertionPoint));
    const excerpt = firstString(record.excerpt, record.quote, record.snippet, record.sourceText, record.fragment);

    const paragraphStartCandidate = firstDefined(
      record.paragraphStart,
      record.fromParagraph,
      record.paragraph,
      record.paragraphIndex,
      record.anchorParagraph,
      record.sectionStart
    );
    const paragraphEndCandidate = firstDefined(
      record.paragraphEnd,
      record.toParagraph,
      record.paragraph,
      record.paragraphIndex,
      record.anchorParagraph,
      record.sectionEnd
    );

    const repairedParagraphStart = coerceReviewIndex(paragraphStartCandidate);
    const repairedParagraphEnd = coerceReviewIndex(paragraphEndCandidate);

    if (title && record.title !== title) {
      record.title = title;
      changed = true;
    }

    if (reason && record.reason !== reason) {
      record.reason = reason;
      changed = true;
    }

    if (recommendation && record.recommendation !== recommendation) {
      record.recommendation = recommendation;
      changed = true;
    }

    if (recommendationType && record.recommendationType !== recommendationType) {
      record.recommendationType = recommendationType;
      changed = true;
    }

    if (suggestedAction && record.suggestedAction !== suggestedAction) {
      record.suggestedAction = suggestedAction;
      changed = true;
    }

    if (priority && record.priority !== priority) {
      record.priority = priority;
      changed = true;
    }

    if (insertionHint && record.insertionHint !== insertionHint) {
      record.insertionHint = insertionHint;
      changed = true;
    }

    if (excerpt && record.excerpt !== excerpt) {
      record.excerpt = excerpt;
      changed = true;
    }

    if (repairedParagraphStart !== null && record.paragraphStart !== repairedParagraphStart) {
      record.paragraphStart = repairedParagraphStart;
      changed = true;
    }

    if (repairedParagraphEnd !== null && record.paragraphEnd !== repairedParagraphEnd) {
      record.paragraphEnd = repairedParagraphEnd;
      changed = true;
    }

    const hasUsableParagraphRange =
      typeof record.paragraphStart === "number" &&
      Number.isFinite(record.paragraphStart) &&
      typeof record.paragraphEnd === "number" &&
      Number.isFinite(record.paragraphEnd) &&
      record.paragraphStart <= record.paragraphEnd;

    if (!hasUsableParagraphRange) {
      const offsetStart = coerceReviewIndex(
        firstDefined(record.start, record.selectionStart, record.from, record.offsetStart, record.anchorStart, record.rangeStart)
      );
      const offsetEnd = coerceReviewIndex(
        firstDefined(record.end, record.selectionEnd, record.to, record.offsetEnd, record.anchorEnd, record.rangeEnd)
      );

      if (offsetStart !== null) {
        const paragraphStart = findParagraphForOffset(text, offsetStart);

        if (paragraphStart !== null) {
          record.paragraphStart = paragraphStart;
          changed = true;
        }
      }

      if (offsetEnd !== null) {
        const paragraphEnd = findParagraphForOffset(text, Math.max(0, offsetEnd - 1));

        if (paragraphEnd !== null) {
          record.paragraphEnd = paragraphEnd;
          changed = true;
        }
      }

      if (!(typeof record.paragraphStart === "number" && typeof record.paragraphEnd === "number")) {
        const located = excerpt ? locateExcerptInText(text, excerpt) : null;

        if (located) {
          const paragraphStart = findParagraphForOffset(text, located.start);
          const paragraphEnd = findParagraphForOffset(text, Math.max(located.start, located.end - 1));

          if (paragraphStart !== null && paragraphEnd !== null) {
            record.paragraphStart = paragraphStart;
            record.paragraphEnd = paragraphEnd;
            changed = true;
          }
        }
      }
    }

    return record;
  });

  return changed ? repaired : null;
}

function buildEditorialReviewSystemPrompt(request: EditorialReviewRequest): string {
  return [
    request.basePrompt ?? "",
    request.reviewPrompt ?? "",
    request.reviewLevelGuide ?? "",
    `Поточний рівень глибини змін: ${request.changeLevel}.`,
    "Не роби diff і не переписуй текст одразу. Потрібно лише повернути рекомендації та тип наступної дії.",
    "Кожен item має бути прив'язаний до конкретного абзацу або групи сусідніх абзаців.",
    "Поверни від 4 до 8 найсильніших рекомендацій. Не дублюй однакові поради для сусідніх абзаців.",
    "Відсіюй дрібні косметичні зауваги. Обирай рекомендації, які реально покращують читаність, структуру, наочність або втримання уваги.",
    "Якщо фрагмент краще винести в схему, процес, порівняння чи інфографіку, використовуй recommendationType = visualize.",
    "Якщо текст варто лишити, але проситься візуальна підтримка, використовуй recommendationType = illustration.",
    "Якщо доречно додати обвіс, пам'ятай: у промптах це завжди означає врізку, інфографіку або додатковий пояснювальний блок.",
    "Callout types: quick_fact = короткий факт; mini_story = коротка сюжетна сцена; mechanism_explained = пояснення як це працює; step_by_step = покроковий розбір; myth_vs_fact = міф і факт.",
    "Для recommendationType=callout або suggestedAction=prepare_callout одразу згенеруй calloutTitle, calloutPreviewText і calloutSummary. calloutPrompt теж заповни: це prompt для потенційної регенерації врізки.",
    "calloutPreviewText має бути готовим текстом врізки (мінімум 3 речення), а не темою, не заголовком і не інструкцією для автора.",
    "Для інших recommendationType обов'язково поверни calloutTitle, calloutPreviewText, calloutSummary, calloutPrompt як null.",
    "priority має відображати редакторську цінність рекомендації, а не просто дрібну стилістичну правку.",
    "paragraphStart і paragraphEnd мають бути номерами абзаців із наведеного списку.",
    "excerpt має бути короткою дослівною цитатою з проблемного місця."
  ]
    .filter(Boolean)
    .join(" ");
}

function buildEditorialReviewUserPrompt(text: string, additionalInstructions?: string): string {
  const numberedParagraphs = getManuscriptParagraphs(text)
    .map((paragraph) => `[${formatParagraphLabel(paragraph.index)}] ${paragraph.text}`)
    .join("\n\n");

  return [
    "Зроби редакторський review цього тексту.",
    additionalInstructions ? `Додаткові інструкції редактора: ${additionalInstructions}` : "",
    "Поверни лише рекомендації у JSON-об'єкті.",
    "Нижче текст, розбитий на пронумеровані абзаци. Посилайся лише на ці номери.",
    numberedParagraphs
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseEditorialReviewItems(content: string): unknown {
  const parsed = JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
  return parsed.items;
}

export function createFallbackEditorialReviewItems(request: EditorialReviewRequest, reviewSessionId: string): EditorialReviewItem[] {
  const items: Array<Omit<EditorialReviewItem, "id">> = [];
  const paragraphs = getManuscriptParagraphs(request.text, request.revision);
  const text = request.text;

  const jargonMatch = /(ліпопротеїн|атеросклеротичн|абдомінальн|ультраоброблен|маловиражен|серцево-судинн)/i.exec(text);

  if (jargonMatch) {
    const paragraphIndex = findParagraphForOffset(text, jargonMatch.index, request.revision);

    if (paragraphIndex !== null) {
      const paragraph = paragraphs.find((entry) => entry.index === paragraphIndex);

      if (paragraph) {
        const paragraphIds = [paragraph.id];
        const excerpt = paragraph.text.slice(0, 220);
        items.push({
          reviewSessionId,
          documentRevisionId: request.revision.documentRevisionId,
          changeLevel: request.changeLevel,
          title: "Термінологія тисне на читача",
          reason: "У цьому місці медичні або наукові терміни йдуть надто щільно і не мають людської розшифровки.",
          recommendation: "Спростити подачу термінів і дати читачеві короткий побутовий місток до значення.",
          recommendationType: "simplify",
          suggestedAction: "rewrite_text",
          priority: "high",
          anchor: {
            paragraphIds,
            generationParagraphRange: { start: paragraph.index, end: paragraph.index },
            excerpt,
            fingerprint: computeAnchorFingerprint(request.revision, paragraphIds, excerpt)
          },
          insertionPoint: {
            mode: "replace",
            anchorParagraphId: paragraph.id
          },
          status: "pending"
        });
      }
    }
  }

  const longParagraph = paragraphs.find((paragraph) => paragraph.text.length > 650);

  if (longParagraph) {
    const paragraphIds = [longParagraph.id];
    const excerpt = longParagraph.text.slice(0, 220);
    items.push({
      reviewSessionId,
      documentRevisionId: request.revision.documentRevisionId,
      changeLevel: request.changeLevel,
      title: "Абзац проситься в список",
      reason: "Один блок несе кілька смислових кроків одразу, тому читачеві важко тримати логіку й акценти.",
      recommendation: "Переформатувати фрагмент у структурований список або розбити його на коротші смислові кроки.",
      recommendationType: "list",
      suggestedAction: "rewrite_text",
      priority: "medium",
      anchor: {
        paragraphIds,
        generationParagraphRange: { start: longParagraph.index, end: longParagraph.index },
        excerpt,
        fingerprint: computeAnchorFingerprint(request.revision, paragraphIds, excerpt)
      },
      insertionPoint: {
        mode: "replace",
        anchorParagraphId: longParagraph.id
      },
      status: "pending"
    });
  }

  const visualParagraph = paragraphs.find((paragraph) => /\b\d{2,}|\bHDL\b|\bLDL\b|відсот|порівнян|крок/i.test(paragraph.text));

  if (visualParagraph) {
    const paragraphIds = [visualParagraph.id];
    const excerpt = visualParagraph.text.slice(0, 220);
    items.push({
      reviewSessionId,
      documentRevisionId: request.revision.documentRevisionId,
      changeLevel: request.changeLevel,
      title: "Проситься візуалізація",
      reason: "Тут є порівняння, механізм або група фактів, які легше сприйняти не суцільним текстом, а наочно.",
      recommendation: "Візуалізувати цей фрагмент як просту схему або інфографіку, не замінюючи весь текст повністю.",
      recommendationType: "visualize",
      suggestedAction: "prepare_visual",
      priority: "medium",
      anchor: {
        paragraphIds,
        generationParagraphRange: { start: visualParagraph.index, end: visualParagraph.index },
        excerpt,
        fingerprint: computeAnchorFingerprint(request.revision, paragraphIds, excerpt)
      },
      insertionPoint: {
        mode: "after",
        anchorParagraphId: visualParagraph.id
      },
      visualIntent: "comparison",
      status: "pending"
    });
  }

  if (items.length === 0) {
    const firstParagraph = paragraphs[0];

    if (firstParagraph) {
      const paragraphIds = [firstParagraph.id];
      const excerpt = firstParagraph.text.slice(0, 220);
      items.push({
        reviewSessionId,
        documentRevisionId: request.revision.documentRevisionId,
        changeLevel: request.changeLevel,
        title: "Підсилити вступне пояснення",
        reason: "Критичних проблем не знайдено, але вступ можна зробити більш конкретним і корисним для читача.",
        recommendation: "Додати одну-дві фрази, які простіше пояснюють ключову тезу без додавання нових фактів.",
        recommendationType: "simplify",
        suggestedAction: "rewrite_text",
        priority: "low",
        anchor: {
          paragraphIds,
          generationParagraphRange: { start: firstParagraph.index, end: firstParagraph.index },
          excerpt,
          fingerprint: computeAnchorFingerprint(request.revision, paragraphIds, excerpt)
        },
        insertionPoint: {
          mode: "after",
          anchorParagraphId: firstParagraph.id
        },
        status: "pending"
      });
    }
  }

  return items.slice(0, 6).map((item, index) => ({
    ...item,
    id: createPatchId(`review-fallback-${index + 1}`)
  }));
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

class EditorialReviewProviderError extends Error {
  constructor(
    message: string,
    readonly rawOutput?: string
  ) {
    super(message);
  }
}

function wrapReviewProviderError(error: unknown, rawOutput?: string): Error {
  if (error instanceof EditorialReviewProviderError) {
    return error;
  }

  if (error instanceof Error) {
    return new EditorialReviewProviderError(error.message, rawOutput);
  }

  return new EditorialReviewProviderError("Провайдер повернув невалідний редакторський огляд.", rawOutput);
}

function clampRawOutput(rawOutput?: string): string | undefined {
  if (!rawOutput) {
    return undefined;
  }

  const normalized = rawOutput.trim();
  return normalized ? normalized.slice(0, 12000) : undefined;
}

function firstDefined<T>(...values: T[]): T | undefined {
  return values.find((value) => value !== undefined && value !== null);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function normalizeRecommendationTypeAlias(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.includes("visual") || normalized.includes("інфограф") || normalized.includes("схем")) {
    return "visualize";
  }

  if (normalized.includes("illustr") || normalized.includes("ілюстр")) {
    return "illustration";
  }

  if (normalized.includes("callout") || normalized.includes("вріз")) {
    return "callout";
  }

  if (normalized.includes("subsection") || normalized.includes("підрозд")) {
    return "subsection";
  }

  if (normalized.includes("list") || normalized.includes("спис")) {
    return "list";
  }

  if (normalized.includes("expand") || normalized.includes("допис")) {
    return "expand";
  }

  if (normalized.includes("simpl")) {
    return "simplify";
  }

  return "rewrite";
}

function normalizeSuggestedActionAlias(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.includes("callout") || normalized.includes("вріз")) {
    return "prepare_callout";
  }

  if (normalized.includes("visual") || normalized.includes("image") || normalized.includes("illustr")) {
    return "prepare_visual";
  }

  if (normalized.includes("insert") || normalized.includes("допис")) {
    return "insert_text";
  }

  return "rewrite_text";
}

function normalizePriorityAlias(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.includes("high") || normalized.includes("висок")) {
    return "high";
  }

  if (normalized.includes("low") || normalized.includes("низьк")) {
    return "low";
  }

  return "medium";
}

function normalizeInsertionHintAlias(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.includes("subsection") || normalized.includes("підроз")) {
    return "subsection_after";
  }

  if (normalized.includes("before") || normalized.includes("перед")) {
    return "before";
  }

  if (normalized.includes("after") || normalized.includes("після")) {
    return "after";
  }

  return "replace";
}

function hydrateAndFilterCalloutDrafts(
  items: EditorialReviewItem[],
  request: EditorialReviewRequest
): { items: EditorialReviewItem[]; droppedCalloutDraftCount: number } {
  const hydratedItems: EditorialReviewItem[] = [];
  let droppedCalloutDraftCount = 0;

  for (const item of items) {
    if (item.recommendationType !== "callout" && item.suggestedAction !== "prepare_callout") {
      hydratedItems.push(item);
      continue;
    }

    const calloutKind = item.calloutKind ?? "quick_fact";
    const fragment = getParagraphRangeText(request.revision, item.anchor.paragraphIds);
    const promptFromTemplate = renderTemplate(request.calloutPromptTemplate ?? "", {
      calloutKind,
      fragment,
      recommendation: item.recommendation
    });
    const prompt =
      promptFromTemplate ||
      [
        `Тип врізки: ${calloutKind}.`,
        fragment ? `Фрагмент: ${fragment}` : "",
        `Рекомендація: ${item.recommendation}`,
        "Сформуй коротку врізку українською без додавання нових фактів."
      ]
        .filter(Boolean)
        .join("\n");
    const candidatePreview = item.calloutDraft?.previewText?.trim() ?? "";
    if (!isUsableCalloutPreview(candidatePreview)) {
      droppedCalloutDraftCount += 1;
      continue;
    }

    hydratedItems.push({
      ...item,
      calloutKind,
      status: "ready",
      calloutDraft: {
        calloutKind,
        title: item.calloutDraft?.title?.trim() || fallbackCalloutTitle(calloutKind),
        previewText: candidatePreview,
        summary: item.calloutDraft?.summary?.trim() || "Врізка згенерована під час первинного огляду.",
        prompt: item.calloutDraft?.prompt?.trim() || prompt
      }
    });
  }

  return {
    items: hydratedItems,
    droppedCalloutDraftCount
  };
}

function isUsableCalloutPreview(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized || normalized.length < 140) {
    return false;
  }

  if (/[?]\s*$/.test(normalized) || /:\s*$/.test(normalized)) {
    return false;
  }

  if (/\b(додати|додай|напиши|підготуй|зроби|встав)\b/i.test(normalized)) {
    return false;
  }

  const sentenceCount = normalized.split(/[.!?]+/).map((entry) => entry.trim()).filter(Boolean).length;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  return sentenceCount >= 2 && wordCount >= 24;
}

function fallbackCalloutTitle(kind: EditorialCalloutKind): string {
  if (kind === "mini_story") {
    return "Мініісторія";
  }

  if (kind === "mechanism_explained") {
    return "Як це працює";
  }

  if (kind === "step_by_step") {
    return "Покроково";
  }

  if (kind === "myth_vs_fact") {
    return "Міф і факт";
  }

  return "Короткий факт";
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((current, [key, value]) => current.replaceAll(`{{${key}}}`, value), template);
}

function buildReviewDropError(droppedItemCount: number, droppedCalloutDraftCount: number): string | undefined {
  const messages: string[] = [];

  if (droppedItemCount > 0) {
    messages.push(`Відкинуто ${droppedItemCount} невалідні рекомендації від провайдера.`);
  }

  if (droppedCalloutDraftCount > 0) {
    messages.push(
      `Відкинуто ${droppedCalloutDraftCount} рекомендацій типу «врізка»: модель не повернула придатний пояснювальний текст.`
    );
  }

  return messages.length > 0 ? messages.join(" ") : undefined;
}

function coerceReviewIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const coerced = Number(value.trim());
    return Number.isFinite(coerced) ? Math.floor(coerced) : null;
  }

  return null;
}

function locateExcerptInText(text: string, excerpt: string): { start: number; end: number } | null {
  const normalizedExcerpt = excerpt.trim().replace(/^["«]+|["»]+$/g, "").replace(/\s+/g, " ");

  if (!normalizedExcerpt) {
    return null;
  }

  const directIndex = text.indexOf(normalizedExcerpt);

  if (directIndex !== -1) {
    return { start: directIndex, end: directIndex + normalizedExcerpt.length };
  }

  const compactText = text.replace(/\s+/g, " ");
  const compactIndex = compactText.indexOf(normalizedExcerpt);

  if (compactIndex === -1) {
    return null;
  }

  let originalStart = -1;
  let compactCursor = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const isWhitespace = /\s/.test(char);

    if (isWhitespace) {
      if (index > 0 && !/\s/.test(text[index - 1])) {
        compactCursor += 1;
      }
    } else {
      if (compactCursor === compactIndex && originalStart === -1) {
        originalStart = index;
      }

      compactCursor += 1;
    }
  }

  if (originalStart === -1) {
    return null;
  }

  return { start: originalStart, end: Math.min(text.length, originalStart + normalizedExcerpt.length) };
}

function readProviderErrorMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;

  if (!error || typeof error !== "object") {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
}

function readGeminiErrorMessage(payload: Record<string, unknown>): string | null {
  return readProviderErrorMessage(payload);
}

function readOpenAiContent(payload: Record<string, unknown>): string {
  const output = payload.output;

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (!Array.isArray(output) || output.length === 0) {
    throw new Error("OpenAI не повернув output.");
  }

  const text = output
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      const content = (item as Record<string, unknown>).content;

      if (!Array.isArray(content)) {
        return "";
      }

      return content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }

          const record = part as Record<string, unknown>;
          if (record.type === "output_text" && typeof record.text === "string") {
            return record.text;
          }

          return typeof record.text === "string" ? record.text : "";
        })
        .join("");
    })
    .join("")
    .trim();

  if (text) {
    return text;
  }

  throw new Error("OpenAI повернув output у неочікуваному форматі.");
}

function readGeminiContent(payload: Record<string, unknown>): string {
  const candidates = payload.candidates;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("Gemini не повернув candidates.");
  }

  const content = (candidates[0] as Record<string, unknown>).content;

  if (!content || typeof content !== "object") {
    throw new Error("Gemini не повернув content.");
  }

  const parts = (content as Record<string, unknown>).parts;

  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error("Gemini не повернув parts.");
  }

  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

function readAnthropicContent(payload: Record<string, unknown>): string {
  const content = payload.content;

  if (!Array.isArray(content) || content.length === 0) {
    throw new Error("Anthropic не повернув content.");
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim();

  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("Провайдер не повернув JSON-об'єкт із рекомендаціями.");
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
