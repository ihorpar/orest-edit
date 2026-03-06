import { createPatchId } from "../editor/patch-contract.ts";
import {
  normalizeEditorialReviewItems,
  type EditorialReviewItem,
  type EditorialReviewRequest,
  type EditorialReviewResponse
} from "../editor/review-contract.ts";
import { findParagraphForOffset, formatParagraphLabel, getManuscriptParagraphs } from "../editor/manuscript-structure.ts";
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
          explanation: { type: "string" },
          recommendation: { type: "string" },
          category: { type: "string", enum: ["clarity", "structure", "tone"] },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          paragraphStart: { type: "integer" },
          paragraphEnd: { type: "integer" },
          excerpt: { type: "string" }
        },
        required: ["title", "explanation", "recommendation", "category", "severity", "paragraphStart", "paragraphEnd", "excerpt"]
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
          explanation: { type: "STRING" },
          recommendation: { type: "STRING" },
          category: { type: "STRING" },
          severity: { type: "STRING" },
          paragraphStart: { type: "INTEGER" },
          paragraphEnd: { type: "INTEGER" },
          excerpt: { type: "STRING" }
        },
        required: ["title", "explanation", "recommendation", "category", "severity", "paragraphStart", "paragraphEnd", "excerpt"]
      }
    }
  },
  required: ["items"]
} as const;

type FetchLike = typeof fetch;
type EditorialReviewProviderResult = {
  items: EditorialReviewItem[];
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
  const fetchImpl = options.fetchImpl ?? fetch;
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
  const now = options.now ?? (() => new Date().toISOString());
  const textLength = request.text.length;

  if (!request.text.trim()) {
    return buildEditorialReviewResponse({
      requestId,
      requestedProvider: request.provider,
      requestedModelId: request.modelId,
      providerUsed: "invalid-text",
      textLength,
      items: [],
      droppedItemCount: 0,
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
      error: `Немає API key для ${providerDisplayName(request.provider)} у формі або .env, тому показано локальний редакторський огляд.`,
      generatedAt: now()
    });
  }

  try {
    const result =
      request.provider === "gemini"
        ? await createGeminiEditorialReview(request, apiKey, fetchImpl)
        : request.provider === "anthropic"
          ? await createAnthropicEditorialReview(request, apiKey, fetchImpl)
          : await createOpenAiEditorialReview(request, apiKey, fetchImpl);

    return buildEditorialReviewResponse({
      requestId,
      requestedProvider: request.provider,
      requestedModelId: request.modelId,
      providerUsed: result.providerUsed,
      textLength,
      items: result.items,
      droppedItemCount: result.droppedItemCount,
      usedFallback: false,
      error: result.droppedItemCount > 0 ? `Відкинуто ${result.droppedItemCount} невалідні рекомендації від провайдера.` : undefined,
      generatedAt: now(),
      rawOutput: result.rawOutput
    });
  } catch (error) {
    return buildFallbackEditorialReviewResponse({
      request,
      requestId,
      error: error instanceof Error ? error.message : `${providerDisplayName(request.provider)} недоступний, тому показано локальний редакторський огляд.`,
      generatedAt: now(),
      rawOutput: error instanceof EditorialReviewProviderError ? error.rawOutput : undefined
    });
  }
}

function buildEditorialReviewResponse(input: {
  requestId: string;
  requestedProvider: string;
  requestedModelId: string;
  providerUsed: string;
  textLength: number;
  items: EditorialReviewItem[];
  droppedItemCount: number;
  usedFallback: boolean;
  generatedAt: string;
  rawOutput?: string;
  error?: string;
}): EditorialReviewResponse {
  return {
    items: input.items,
    providerUsed: input.providerUsed,
    usedFallback: input.usedFallback,
    error: input.error,
    diagnostics: {
      requestId: input.requestId,
      requestedProvider: input.requestedProvider,
      requestedModelId: input.requestedModelId,
      textLength: input.textLength,
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
  error: string;
  generatedAt: string;
  rawOutput?: string;
}): EditorialReviewResponse {
  return buildEditorialReviewResponse({
    requestId: input.requestId,
    requestedProvider: input.request.provider,
    requestedModelId: input.request.modelId,
    providerUsed: input.request.provider,
    textLength: input.request.text.length,
    items: createFallbackEditorialReviewItems(input.request.text),
    droppedItemCount: 0,
    usedFallback: true,
    error: input.error,
    generatedAt: input.generatedAt,
    rawOutput: input.rawOutput
  });
}

async function createOpenAiEditorialReview(request: EditorialReviewRequest, apiKey: string, fetchImpl: FetchLike): Promise<EditorialReviewProviderResult> {
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
        instructions: buildEditorialReviewSystemPrompt(request.basePrompt),
        input: buildEditorialReviewUserPrompt(request.text),
        text: {
          format: {
            type: "json_schema",
            name: "editorial_review",
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
      return buildNormalizedReviewResult(request.text, parseEditorialReviewItems(rawOutput), "openai", rawOutput);
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

async function createGeminiEditorialReview(request: EditorialReviewRequest, apiKey: string, fetchImpl: FetchLike): Promise<EditorialReviewProviderResult> {
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
            parts: [{ text: `${buildEditorialReviewSystemPrompt(request.basePrompt)}\n\n${buildEditorialReviewUserPrompt(request.text)}` }]
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
      return buildNormalizedReviewResult(request.text, parseEditorialReviewItems(rawOutput), "gemini", rawOutput);
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

async function createAnthropicEditorialReview(request: EditorialReviewRequest, apiKey: string, fetchImpl: FetchLike): Promise<EditorialReviewProviderResult> {
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
        max_tokens: 1400,
        temperature: 0.2,
        system: `${buildEditorialReviewSystemPrompt(request.basePrompt)} Поверни лише JSON-об'єкт {"items":[...]} без markdown.`,
        messages: [{ role: "user", content: buildEditorialReviewUserPrompt(request.text) }]
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(readProviderErrorMessage(payload) ?? `Anthropic повернув статус ${response.status}.`);
    }

    const rawOutput = readAnthropicContent(payload);

    try {
      return buildNormalizedReviewResult(request.text, parseEditorialReviewItems(rawOutput), "anthropic", rawOutput);
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

function buildNormalizedReviewResult(text: string, items: unknown, providerUsed: string, rawOutput?: string): EditorialReviewProviderResult {
  const normalized = normalizeEditorialReviewItems(text, items);

  if (normalized.items.length === 0 || normalized.droppedCount > 0) {
    const repairedItems = repairEditorialReviewItems(text, items);

    if (repairedItems) {
      const repairedNormalized = normalizeEditorialReviewItems(text, repairedItems);

      if (repairedNormalized.items.length > 0) {
        return {
          items: repairedNormalized.items,
          droppedItemCount: repairedNormalized.droppedCount,
          providerUsed,
          rawOutput: clampRawOutput(rawOutput)
        };
      }
    }
  }

  if (normalized.items.length === 0) {
    throw new EditorialReviewProviderError(`${providerDisplayName(providerUsed)} повернув порожні або невалідні рекомендації.`, rawOutput);
  }

  return {
    items: normalized.items,
    droppedItemCount: normalized.droppedCount,
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

    if (repairedParagraphStart !== null && record.paragraphStart !== repairedParagraphStart) {
      record.paragraphStart = repairedParagraphStart;
      changed = true;
    }

    if (repairedParagraphEnd !== null && record.paragraphEnd !== repairedParagraphEnd) {
      record.paragraphEnd = repairedParagraphEnd;
      changed = true;
    }

    const title = firstString(record.title, record.problem, record.issue, record.heading, record.label);
    const explanation = firstString(
      record.explanation,
      record.whyItMatters,
      record.why,
      record.comment,
      record.rationale,
      record.description
    );
    const recommendation = firstString(
      record.recommendation,
      record.action,
      record.suggestedAction,
      record.fix,
      record.proposal,
      record.editorAction
    );
    const category = firstString(record.category, record.type, record.dimension, record.kind);
    const severity = firstString(record.severity, record.priority, record.level, record.importance);
    const excerpt = firstString(record.excerpt, record.quote, record.snippet, record.sourceText, record.fragment);

    if (title && record.title !== title) {
      record.title = title;
      changed = true;
    }

    if (explanation && record.explanation !== explanation) {
      record.explanation = explanation;
      changed = true;
    }

    if (recommendation && record.recommendation !== recommendation) {
      record.recommendation = recommendation;
      changed = true;
    }

    if (excerpt && record.excerpt !== excerpt) {
      record.excerpt = excerpt;
      changed = true;
    }

    if (category && record.category !== category) {
      record.category = normalizeReviewCategoryAlias(category);
      changed = true;
    }

    if (severity && record.severity !== severity) {
      record.severity = normalizeReviewSeverityAlias(severity);
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

function buildEditorialReviewSystemPrompt(basePrompt?: string): string {
  return [
    "Ти досвідчений редактор української науково-популярної рукописи.",
    "Не переписуй текст і не пропонуй diff.",
    "Потрібен лише редакторський огляд усього тексту: 3-6 найважливіших рекомендацій.",
    "Кожна рекомендація має показати конкретну проблему, чому вона заважає читачеві, і що варто зробити редактору.",
    "Шукай лише реальні редакторські проблеми: ясність, структура, тон і доказовість.",
    "Уникай дрібних стилістичних прискіпувань.",
    "Поверни JSON-об'єкт з масивом items.",
    "У кожному item обов'язково дай title, explanation, recommendation, category, severity, paragraphStart, paragraphEnd, excerpt.",
    "paragraphStart та paragraphEnd мають бути номерами абзаців із наведеного нижче списку.",
    "excerpt має бути короткою дослівною цитатою з проблемного місця.",
    "title пиши коротко, українською, до 8 слів.",
    "severity має бути high, medium або low.",
    "category має бути clarity, structure або tone.",
    basePrompt ? `Контекст редакторських пріоритетів: ${basePrompt}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function buildEditorialReviewUserPrompt(text: string): string {
  const numberedParagraphs = getManuscriptParagraphs(text)
    .map((paragraph) => `[${formatParagraphLabel(paragraph.index)}] ${paragraph.text}`)
    .join("\n\n");

  return [
    "Зроби редакторський огляд цього тексту.",
    "Поверни лише рекомендації для редактора, без переписування фрагментів.",
    "Нижче текст, розбитий на пронумеровані абзаци.",
    "Посилайся лише на ці номери абзаців.",
    numberedParagraphs
  ].join("\n\n");
}

function parseEditorialReviewItems(content: string): unknown {
  const parsed = JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
  return parsed.items;
}

export function createFallbackEditorialReviewItems(text: string): EditorialReviewItem[] {
  const items: EditorialReviewItem[] = [];
  const paragraphs = getManuscriptParagraphs(text);

  const jargonMatch = /(ліпопротеїн|атеросклеротичн|абдомінальн|ультраоброблен|маловиражен|серцево-судинн)/i.exec(text);

  if (jargonMatch) {
    const paragraphIndex = findParagraphForOffset(text, jargonMatch.index);

    if (paragraphIndex !== null) {
      items.push(
        createFallbackItem({
          category: "clarity",
          severity: "high",
          title: "Перевантажений термінологією фрагмент",
          explanation: "У цьому місці читач натрапляє на щільний медичний словник без достатнього людського пояснення.",
          recommendation: "Додайте коротке побутове пояснення терміна або розбийте пояснення на два простіші речення.",
          paragraphStart: paragraphIndex,
          paragraphEnd: paragraphIndex,
          excerpt: text.slice(jargonMatch.index, Math.min(text.length, jargonMatch.index + 220)).trim().replace(/\s+/g, " ")
        })
      );
    }
  }

  const longParagraph = paragraphs.find((paragraph) => paragraph.text.length > 650);

  if (longParagraph) {
    items.push(
      createFallbackItem({
        category: "structure",
        severity: "medium",
        title: "Абзац тримає забагато думок",
        explanation: "Один великий блок одночасно пояснює механізм, застереження і висновок, тому читачеві складніше втримати логіку.",
        recommendation: "Розбийте цей абзац на менші смислові кроки: пояснення, наслідок і редакторський висновок.",
        paragraphStart: longParagraph.index,
        paragraphEnd: longParagraph.index,
        excerpt: longParagraph.text.slice(0, 220)
      })
    );
  }

  const toneMatch = /(магічн|оптимізаці|без збоїв|достатньо|чарівн|миттєво|ідеальн)/i.exec(text);

  if (toneMatch) {
    const paragraphIndex = findParagraphForOffset(text, toneMatch.index);

    if (paragraphIndex !== null) {
      items.push(
        createFallbackItem({
          category: "tone",
          severity: "medium",
          title: "Ризик занадто обіцянкового тону",
          explanation: "Тут текст легко зчитується як обіцянка швидкого контролю над здоров'ям, а не як зважене пояснення.",
          recommendation: "Зменште категоричність і підкресліть умовність або контекст замість ефектного формулювання.",
          paragraphStart: paragraphIndex,
          paragraphEnd: paragraphIndex,
          excerpt: text.slice(toneMatch.index, Math.min(text.length, toneMatch.index + 220)).trim().replace(/\s+/g, " ")
        })
      );
    }
  }

  if (items.length === 0) {
    const firstParagraph = paragraphs[0];

    if (firstParagraph) {
      items.push(
        createFallbackItem({
          category: "clarity",
          severity: "low",
          title: "Перевірити вступ на ясність",
          explanation: "Критичних редакторських збоїв не знайдено, але вступ усе ще варто переглянути на щільність і ритм.",
          recommendation: "Переконайтеся, що перший абзац швидко формулює головну тезу без зайвого вступного розгону.",
          paragraphStart: firstParagraph.index,
          paragraphEnd: firstParagraph.index,
          excerpt: firstParagraph.text.slice(0, 220)
        })
      );
    }
  }

  return items.slice(0, 6);
}

function createFallbackItem(
  item: Omit<EditorialReviewItem, "id">
): EditorialReviewItem {
  return {
    ...item,
    id: createPatchId("review-fallback")
  };
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

function normalizeReviewCategoryAlias(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("struct")) {
    return "structure";
  }

  if (normalized.includes("tone") || normalized.includes("тон")) {
    return "tone";
  }

  return "clarity";
}

function normalizeReviewSeverityAlias(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("high") || normalized.includes("висок")) {
    return "high";
  }

  if (normalized.includes("low") || normalized.includes("низьк")) {
    return "low";
  }

  return "medium";
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

  // Approximate the compact-space index back to original text coordinates.
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
  const error = payload.error;

  if (!error || typeof error !== "object") {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
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

          if (typeof record.text === "string") {
            return record.text;
          }

          return "";
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
