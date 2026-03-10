import { createPatchId, type PatchRequest } from "../editor/patch-contract.ts";
import {
  areParagraphIdsResolvable,
  computeAnchorFingerprint,
  getParagraphRangeText,
  resolveReviewItemSelection
} from "../editor/manuscript-structure.ts";
import type {
  EditorialCalloutKind,
  EditorialVisualIntent,
  ReviewActionDiagnostics,
  ReviewActionProposal,
  ReviewActionRequest,
  ReviewActionResponse
} from "../editor/review-contract.ts";
import { getEditorialCalloutKindLabel } from "../editor/review-contract.ts";
import { readServerEnvValue } from "./env.ts";
import { generatePatchResponse, resolveProviderApiKey } from "./patch-service.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const anthropicVersion = "2023-06-01";
const requestTimeoutMs = 45000;

const openAiCalloutSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    title: { type: "string" },
    prompt: { type: "string" },
    previewText: { type: "string" }
  },
  required: ["summary", "title", "prompt", "previewText"]
} as const;

const geminiCalloutSchema = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    title: { type: "STRING" },
    prompt: { type: "STRING" },
    previewText: { type: "STRING" }
  },
  required: ["summary", "title", "prompt", "previewText"]
} as const;

const openAiImageSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    prompt: { type: "string" },
    alt: { type: "string" },
    caption: {
      anyOf: [{ type: "string" }, { type: "null" }]
    }
  },
  required: ["summary", "prompt", "alt", "caption"]
} as const;

const geminiImageSchema = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    prompt: { type: "STRING" },
    alt: { type: "STRING" },
    caption: { type: "STRING" }
  },
  required: ["summary", "prompt", "alt"]
} as const;

type FetchLike = typeof fetch;

export interface GenerateReviewActionOptions {
  fetchImpl?: FetchLike;
  now?: () => string;
  readEnvValue?: (key: string) => string | null;
}

export async function generateReviewAction(
  request: ReviewActionRequest,
  options: GenerateReviewActionOptions = {}
): Promise<ReviewActionResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
  const requestId = createPatchId("review-action");
  const diagnosticsBase = {
    requestId,
    requestedProvider: request.provider,
    requestedModelId: request.modelId,
    reviewItemId: request.item.id,
    generatedAt: now()
  } satisfies Omit<ReviewActionDiagnostics, "proposalKind">;

  const staleReason = getStaleReason(request);

  if (staleReason) {
    return {
      proposal: createStaleProposal(request, staleReason),
      providerUsed: "stale-anchor",
      usedFallback: false,
      error: staleReason,
      diagnostics: {
        ...diagnosticsBase,
        proposalKind: "stale_anchor"
      }
    };
  }

  if (request.item.suggestedAction === "rewrite_text" || request.item.suggestedAction === "insert_text") {
    const selection = resolveReviewItemSelection(request.text, request.currentRevision, request.item);
    const selectedFragment = request.text.slice(selection.start, selection.end);

    const patchRequest: PatchRequest = {
      text: request.text,
      selectionStart: selection.start,
      selectionEnd: selection.end,
      mode: "custom",
      prompt: buildTextProposalPrompt(request),
      provider: request.provider,
      modelId: request.modelId,
      apiKey: request.apiKey,
      basePrompt: [request.basePrompt, request.reviewLevelGuide].filter(Boolean).join("\n\n")
    };

    const patchResponse = await generatePatchResponse(patchRequest, {
      fetchImpl,
      now,
      readEnvValue
    });
    const operation = patchResponse.operations[0];
    const isListRecommendation = request.item.recommendationType === "list";

    if (!operation) {
      if (isListRecommendation) {
        const fallbackReplacement = buildStructuredListFallback(selectedFragment);
        const fallbackSummary = "Структурував фрагмент у список.";
        const message = patchResponse.error ?? "Модель не повернула коректний список, тому підготовлено локальну чернетку.";

        return {
          proposal: {
            id: createPatchId("proposal"),
            reviewItemId: request.item.id,
            sourceRevisionId: request.item.documentRevisionId,
            targetRevisionId: request.currentRevision.documentRevisionId,
            kind: "text_diff",
            summary: fallbackSummary,
            canApplyDirectly: true,
            textDiff: {
              op: "replace",
              selection: {
                start: selection.start,
                end: selection.end
              },
              oldText: selectedFragment,
              replacement: fallbackReplacement,
              reason: fallbackSummary
            }
          },
          providerUsed: patchResponse.providerUsed,
          usedFallback: true,
          error: message,
          diagnostics: {
            ...diagnosticsBase,
            proposalKind: "text_diff"
          }
        };
      }

      const message = patchResponse.error ?? "Не вдалося підготувати diff для цієї рекомендації.";

      return {
        proposal: createStaleProposal(request, message),
        providerUsed: patchResponse.providerUsed,
        usedFallback: patchResponse.usedFallback,
        error: message,
        diagnostics: {
          ...diagnosticsBase,
          proposalKind: "stale_anchor"
        }
      };
    }

    const listEnforcementResult = isListRecommendation
      ? enforceStructuredListReplacement(operation.newText ?? "", operation.oldText || selectedFragment)
      : null;
    const replacement = listEnforcementResult ? listEnforcementResult.replacement : operation.newText ?? "";
    const usedListFallback = Boolean(listEnforcementResult?.usedFallback);
    const summary = usedListFallback ? "Структурував фрагмент у список." : operation.reason;
    const error = usedListFallback
      ? patchResponse.error ?? "Модель повернула неструктурований текст, тому список підготовлено локально."
      : patchResponse.error;

    return {
      proposal: {
        id: createPatchId("proposal"),
        reviewItemId: request.item.id,
        sourceRevisionId: request.item.documentRevisionId,
        targetRevisionId: request.currentRevision.documentRevisionId,
        kind: "text_diff",
        summary,
        canApplyDirectly: true,
        textDiff: {
          op: "replace",
          selection: {
            start: operation.start,
            end: operation.end
          },
          oldText: operation.oldText,
          replacement,
          reason: summary
        }
      },
      providerUsed: patchResponse.providerUsed,
      usedFallback: patchResponse.usedFallback || usedListFallback,
      error,
      diagnostics: {
        ...diagnosticsBase,
        proposalKind: "text_diff"
      }
    };
  }

  const apiKey = request.apiKey ?? resolveProviderApiKey(request.provider, readEnvValue);

  if (!apiKey) {
    const fallbackProposal =
      request.item.suggestedAction === "prepare_callout"
        ? createFallbackCalloutProposal(request)
        : createFallbackImagePromptProposal(request);

    return {
      proposal: fallbackProposal,
      providerUsed: request.provider,
      usedFallback: true,
      error: `Немає API key для ${providerDisplayName(request.provider)} у формі або .env, тому показано локальну чернетку.`,
      diagnostics: {
        ...diagnosticsBase,
        proposalKind: fallbackProposal.kind
      }
    };
  }

  try {
    const providerResult =
      request.item.suggestedAction === "prepare_callout"
        ? await createCalloutProposal(request, apiKey, fetchImpl)
        : await createImagePromptProposal(request, apiKey, fetchImpl);

    return {
      proposal: providerResult.proposal,
      providerUsed: providerResult.providerUsed,
      usedFallback: false,
      diagnostics: {
        ...diagnosticsBase,
        proposalKind: providerResult.proposal.kind,
        rawOutput: providerResult.rawOutput
      }
    };
  } catch (error) {
    const fallbackProposal =
      request.item.suggestedAction === "prepare_callout"
        ? createFallbackCalloutProposal(request)
        : createFallbackImagePromptProposal(request);

    return {
      proposal: fallbackProposal,
      providerUsed: request.provider,
      usedFallback: true,
      error: error instanceof Error ? error.message : "Не вдалося підготувати чернетку за рекомендацією.",
      diagnostics: {
        ...diagnosticsBase,
        proposalKind: fallbackProposal.kind,
        rawOutput: error instanceof ReviewActionProviderError ? error.rawOutput : undefined
      }
    };
  }
}

function getStaleReason(request: ReviewActionRequest): string | null {
  if (!areParagraphIdsResolvable(request.currentRevision, request.item.anchor.paragraphIds)) {
    return "Фрагмент уже змінився: рекомендація більше не може надійно знайти свої абзаци.";
  }

  const currentFingerprint = computeAnchorFingerprint(
    request.currentRevision,
    request.item.anchor.paragraphIds,
    request.item.anchor.excerpt
  );

  if (currentFingerprint !== request.item.anchor.fingerprint) {
    return "Фрагмент уже змінився, тому цю рекомендацію потрібно переглянути або згенерувати заново.";
  }

  return null;
}

function createStaleProposal(request: ReviewActionRequest, staleReason: string): ReviewActionProposal {
  return {
    id: createPatchId("proposal-stale"),
    reviewItemId: request.item.id,
    sourceRevisionId: request.item.documentRevisionId,
    targetRevisionId: request.currentRevision.documentRevisionId,
    kind: "stale_anchor",
    summary: staleReason,
    canApplyDirectly: false,
    staleReason
  };
}

function createFallbackCalloutProposal(request: ReviewActionRequest): ReviewActionProposal {
  const fragment = getParagraphRangeText(request.currentRevision, request.item.anchor.paragraphIds);
  const calloutKind = request.item.calloutKind ?? "quick_fact";
  const template = request.calloutPromptTemplate ?? "";

  return {
    id: createPatchId("proposal-callout"),
    reviewItemId: request.item.id,
    sourceRevisionId: request.item.documentRevisionId,
    targetRevisionId: request.currentRevision.documentRevisionId,
    kind: "callout_prompt",
    summary: "Підготовлено локальну чернетку prompt для врізки.",
    canApplyDirectly: false,
    calloutDraft: {
      calloutKind,
      title: fallbackCalloutTitle(calloutKind),
      prompt: renderTemplate(template, {
        calloutKind,
        calloutKindLabel: getEditorialCalloutKindLabel(calloutKind),
        fragment,
        recommendation: request.item.recommendation
      }),
      previewText: request.item.recommendation
    }
  };
}

function createFallbackImagePromptProposal(request: ReviewActionRequest): ReviewActionProposal {
  const fragment = getParagraphRangeText(request.currentRevision, request.item.anchor.paragraphIds);
  const visualIntent = request.item.visualIntent ?? "concept";
  const template = request.imagePromptTemplate ?? "";
  const alt = createDefaultImageAlt(request.item.title, visualIntent);
  const caption = createDefaultImageCaption(request.item.recommendation);

  return {
    id: createPatchId("proposal-image"),
    reviewItemId: request.item.id,
    sourceRevisionId: request.item.documentRevisionId,
    targetRevisionId: request.currentRevision.documentRevisionId,
    kind: "image_prompt",
    summary: "Підготовлено локальну чернетку image prompt.",
    canApplyDirectly: false,
    imageDraft: {
      visualIntent,
      prompt: sanitizeImagePrompt(
        renderTemplate(template, {
          visualIntent,
          fragment,
          recommendation: request.item.recommendation
        })
      ),
      alt,
      caption,
      targetModel: "gemini-3.1-flash-image-preview"
    }
  };
}

async function createCalloutProposal(
  request: ReviewActionRequest,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<{ proposal: ReviewActionProposal; providerUsed: string; rawOutput?: string }> {
  const fragment = getParagraphRangeText(request.currentRevision, request.item.anchor.paragraphIds);
  const instruction = buildCalloutPromptInstruction(request, fragment);
  const providerResult =
    request.provider === "gemini"
      ? await createGeminiJsonDraft(request, apiKey, fetchImpl, instruction, geminiCalloutSchema)
      : request.provider === "anthropic"
        ? await createAnthropicJsonDraft(request, apiKey, fetchImpl, instruction)
        : await createOpenAiJsonDraft(request, apiKey, fetchImpl, instruction, openAiCalloutSchema, "callout_draft");

  const record = parseJsonObject(providerResult.rawOutput);

  return {
    providerUsed: providerResult.providerUsed,
    rawOutput: providerResult.rawOutput,
    proposal: {
      id: createPatchId("proposal-callout"),
      reviewItemId: request.item.id,
      sourceRevisionId: request.item.documentRevisionId,
      targetRevisionId: request.currentRevision.documentRevisionId,
      kind: "callout_prompt",
      summary: normalizeString(record.summary, 180) ?? "Підготовлено чернетку врізки.",
      canApplyDirectly: false,
      calloutDraft: {
        calloutKind: request.item.calloutKind ?? "quick_fact",
        title: normalizeString(record.title, 80) ?? fallbackCalloutTitle(request.item.calloutKind ?? "quick_fact"),
        prompt: normalizeString(record.prompt, 2400) ?? instruction,
        previewText: normalizeString(record.previewText, 900) ?? request.item.recommendation
      }
    }
  };
}

async function createImagePromptProposal(
  request: ReviewActionRequest,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<{ proposal: ReviewActionProposal; providerUsed: string; rawOutput?: string }> {
  const fragment = getParagraphRangeText(request.currentRevision, request.item.anchor.paragraphIds);
  const instruction = buildImagePromptInstruction(request, fragment);
  const providerResult =
    request.provider === "gemini"
      ? await createGeminiJsonDraft(request, apiKey, fetchImpl, instruction, geminiImageSchema)
      : request.provider === "anthropic"
        ? await createAnthropicJsonDraft(request, apiKey, fetchImpl, instruction)
        : await createOpenAiJsonDraft(request, apiKey, fetchImpl, instruction, openAiImageSchema, "image_prompt_draft");

  const record = parseJsonObject(providerResult.rawOutput);
  const visualIntent = request.item.visualIntent ?? "concept";
  const providerPrompt = normalizeString(record.prompt, 2400);
  const defaultAlt = createDefaultImageAlt(request.item.title, visualIntent);
  const defaultCaption = createDefaultImageCaption(request.item.recommendation);
  const defaultPrompt = buildDefaultUkrainianImagePrompt(visualIntent, fragment, request.item.recommendation);
  const resolvedPrompt = sanitizeImagePrompt(providerPrompt && looksLikeUkrainianPrompt(providerPrompt) ? providerPrompt : defaultPrompt);

  return {
    providerUsed: providerResult.providerUsed,
    rawOutput: providerResult.rawOutput,
    proposal: {
      id: createPatchId("proposal-image"),
      reviewItemId: request.item.id,
      sourceRevisionId: request.item.documentRevisionId,
      targetRevisionId: request.currentRevision.documentRevisionId,
      kind: "image_prompt",
      summary: normalizeString(record.summary, 180) ?? "Підготовлено чернетку image prompt.",
      canApplyDirectly: false,
      imageDraft: {
        visualIntent,
        prompt: resolvedPrompt,
        alt: normalizeImageAlt(record.alt) ?? defaultAlt,
        caption: normalizeCaption(record.caption) ?? defaultCaption,
        targetModel: "gemini-3.1-flash-image-preview"
      }
    }
  };
}

async function createOpenAiJsonDraft(
  request: ReviewActionRequest,
  apiKey: string,
  fetchImpl: FetchLike,
  instruction: string,
  schema: object,
  schemaName: string
): Promise<{ providerUsed: string; rawOutput: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(openAiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: request.modelId,
        temperature: 0.4,
        instructions: [request.basePrompt ?? "", request.reviewLevelGuide ?? ""].filter(Boolean).join(" "),
        input: instruction,
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema
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

    return {
      providerUsed: "openai",
      rawOutput: readOpenAiContent(payload)
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("OpenAI не відповів вчасно під час підготовки чернетки.");
    }

    throw wrapReviewActionProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function createGeminiJsonDraft(
  request: ReviewActionRequest,
  apiKey: string,
  fetchImpl: FetchLike,
  instruction: string,
  schema: object
): Promise<{ providerUsed: string; rawOutput: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const endpoint = `${geminiBaseUrl}/${encodeURIComponent(request.modelId)}:generateContent`;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instruction }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseJsonSchema: schema
        }
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(readProviderErrorMessage(payload) ?? `Gemini повернув статус ${response.status}.`);
    }

    return {
      providerUsed: "gemini",
      rawOutput: readGeminiContent(payload)
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Gemini не відповів вчасно під час підготовки чернетки.");
    }

    throw wrapReviewActionProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

async function createAnthropicJsonDraft(
  request: ReviewActionRequest,
  apiKey: string,
  fetchImpl: FetchLike,
  instruction: string
): Promise<{ providerUsed: string; rawOutput: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

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
        max_tokens: 1200,
        temperature: 0.4,
        system: `${request.basePrompt ?? ""} ${request.reviewLevelGuide ?? ""} Поверни лише JSON-об'єкт без markdown.`,
        messages: [{ role: "user", content: instruction }]
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(readProviderErrorMessage(payload) ?? `Anthropic повернув статус ${response.status}.`);
    }

    return {
      providerUsed: "anthropic",
      rawOutput: readAnthropicContent(payload)
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Anthropic не відповів вчасно під час підготовки чернетки.");
    }

    throw wrapReviewActionProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function buildTextProposalPrompt(request: ReviewActionRequest): string {
  if (request.item.recommendationType === "list") {
    return [
      "Підготуй одну локальну правку для вибраного фрагмента у форматі markdown-списку.",
      `Тип рекомендації: ${request.item.recommendationType}.`,
      `Наступна дія: ${request.item.suggestedAction}.`,
      `Причина: ${request.item.reason}`,
      `Рекомендація: ${request.item.recommendation}`,
      "Охопи весь фрагмент, а не один випадковий підпункт.",
      "Поверни щонайменше 2 пункти списку.",
      "Якщо є заголовок markdown (### ...), залиш його окремим рядком без маркера '- '.",
      "Кожен пункт має бути окремим рядком у форматі: '- Коротка ідея — опис'.",
      "Коротка ідея має бути лаконічною: 1-3 слова.",
      "Не об'єднуй кілька пунктів в один рядок і не повертай суцільний абзац без переносів.",
      "Збережи факти, причинно-наслідкові зв'язки та авторський намір."
    ].join(" ");
  }

  return [
    "Підготуй одну локальну редакторську зміну для вибраного фрагмента.",
    `Тип рекомендації: ${request.item.recommendationType}.`,
    `Наступна дія: ${request.item.suggestedAction}.`,
    `Причина: ${request.item.reason}`,
    `Рекомендація: ${request.item.recommendation}`,
    "Зміна має бути локальною, без виходу за межі цього фрагмента.",
    request.item.suggestedAction === "insert_text"
      ? "Розшир фрагмент так, щоб новий матеріал органічно вбудувався в наявний текст."
      : "Перепиши або спрости саме цей фрагмент, не додаючи нових фактів.",
    "Збережи авторський намір і наукову точність."
  ].join(" ");
}

function enforceStructuredListReplacement(
  candidate: string,
  source: string
): { replacement: string; usedFallback: boolean } {
  const normalizedCandidate = normalizeStructuredListDraft(candidate);

  if (normalizedCandidate && looksLikeStructuredList(normalizedCandidate)) {
    return { replacement: normalizedCandidate, usedFallback: false };
  }

  return {
    replacement: buildStructuredListFallback(source),
    usedFallback: true
  };
}

function looksLikeStructuredList(value: string): boolean {
  if (!value) {
    return false;
  }

  const normalizedLines = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (normalizedLines.length < 2) {
    return false;
  }

  const contentLines = normalizedLines.filter((line, index) => !(index === 0 && isHeadingLine(line)));
  const listLines = contentLines.filter((line) => Boolean(parseListLine(line)));

  if (listLines.length < 2 || listLines.length !== contentLines.length) {
    return false;
  }

  return listLines.every((line) => {
    const content = parseListLine(line)?.content ?? "";
    return looksLikeIdeaDescriptionItem(content);
  });
}

function buildStructuredListFallback(source: string): string {
  const normalized = source.replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    return "- Ключова думка — Уточнити головний пункт.\n- Пояснення — Додати коротку причину.";
  }

  const rawLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const { heading, contentLines } = extractHeadingAndBody(rawLines);
  const extractedSegments = extractListSegments(contentLines);
  const normalizedItems = extractedSegments
    .map((segment) => formatIdeaDescriptionListItem(segment))
    .filter((item): item is string => Boolean(item));
  const uniqueItems = dedupeListItems(normalizedItems).slice(0, 8);

  if (uniqueItems.length < 2) {
    return heading
      ? `${heading}\n- Ключова думка — Уточнити головний пункт.\n- Пояснення — Додати коротку причину.`
      : "- Ключова думка — Уточнити головний пункт.\n- Пояснення — Додати коротку причину.";
  }

  return [heading, ...uniqueItems.map((item) => `- ${item}`)].filter(Boolean).join("\n");
}

function normalizeStructuredListDraft(candidate: string): string | null {
  const normalized = candidate.replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    return null;
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return null;
  }

  const { heading, contentLines } = extractHeadingAndBody(lines);
  const extractedSegments = extractListSegments(contentLines);
  const normalizedItems = extractedSegments
    .map((segment) => formatIdeaDescriptionListItem(segment))
    .filter((item): item is string => Boolean(item));
  const uniqueItems = dedupeListItems(normalizedItems).slice(0, 8);

  if (uniqueItems.length < 2) {
    return null;
  }

  return [heading, ...uniqueItems.map((item) => `- ${item}`)].filter(Boolean).join("\n");
}

function extractHeadingAndBody(lines: string[]): { heading: string | null; contentLines: string[] } {
  if (lines.length === 0) {
    return { heading: null, contentLines: [] };
  }

  const firstLine = lines[0];
  const firstLineWithoutListMarker = parseListLine(firstLine)?.content ?? firstLine;

  if (!isHeadingLine(firstLineWithoutListMarker)) {
    return { heading: null, contentLines: lines };
  }

  const headingMatch = firstLineWithoutListMarker.trim().match(/^(#{1,6})\s*(.+)$/u);

  if (!headingMatch) {
    return { heading: null, contentLines: lines };
  }

  const heading = `${headingMatch[1]} ${headingMatch[2]?.trim() ?? ""}`.trim();
  return { heading, contentLines: lines.slice(1) };
}

function extractListSegments(lines: string[]): string[] {
  const segments: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    const parsedListLine = parseListLine(trimmedLine);

    if (parsedListLine) {
      if (parsedListLine.content) {
        segments.push(parsedListLine.content);
      }
      continue;
    }

    if (segments.length === 0) {
      segments.push(trimmedLine);
      continue;
    }

    segments[segments.length - 1] = `${segments[segments.length - 1]} ${trimmedLine}`.trim();
  }

  return segments.flatMap((segment) => splitTextIntoSegments(segment));
}

function splitTextIntoSegments(value: string): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const sentenceItems = normalized
    .split(/(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceItems.length >= 2) {
    return sentenceItems;
  }

  const clauseItems = normalized
    .split(/;\s+|,\s+(?=[А-ЯІЇЄҐA-Z])/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (clauseItems.length >= 2) {
    return clauseItems;
  }

  return [normalized];
}

function formatIdeaDescriptionListItem(value: string): string | null {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*+]\s+/u, "")
    .replace(/^#{1,6}\s+/u, "");

  if (!normalized) {
    return null;
  }

  const structuredMatch = normalized.match(/^(.{1,56}?)(?:\s*[—-]\s+|:\s+)(.+)$/u);

  if (structuredMatch) {
    const lead = normalizeListLead(structuredMatch[1] ?? "");
    const description = ensureSentenceEnding(structuredMatch[2] ?? "");

    if (lead && description) {
      return `${lead} — ${description}`;
    }
  }

  const lead = deriveListLead(normalized);
  let description = ensureSentenceEnding(normalized);
  const leadPrefix = new RegExp(`^${escapeRegExp(lead)}(?:\\s*[—:-]\\s*)?`, "iu");

  if (leadPrefix.test(description)) {
    const remainder = description.replace(leadPrefix, "").trim();

    if (remainder.length >= 8) {
      description = ensureSentenceEnding(remainder);
    }
  }

  return `${lead} — ${description}`;
}

function deriveListLead(value: string): string {
  const stopWords = new Set(["і", "й", "та", "у", "в", "на", "за", "до", "з", "із", "від", "про", "для", "при", "як", "що", "це"]);
  const words = value
    .replace(/[«»"“”()]/g, " ")
    .split(/\s+/u)
    .map((token) => token.replace(/^[^A-Za-zА-Яа-яІіЇїЄєҐґ0-9]+|[^A-Za-zА-Яа-яІіЇїЄєҐґ0-9]+$/gu, ""))
    .filter(Boolean);

  if (words.length === 0) {
    return "Пункт";
  }

  let startIndex = 0;

  while (startIndex < words.length && stopWords.has(words[startIndex].toLowerCase())) {
    startIndex += 1;
  }

  const pickedWords = words.slice(startIndex, startIndex + 2);
  const fallbackWords = words.slice(0, 2);
  return normalizeListLead((pickedWords.length > 0 ? pickedWords : fallbackWords).join(" "));
}

function normalizeListLead(value: string): string {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[—:,-]+$/u, "")
    .slice(0, 56);

  if (!normalized) {
    return "Пункт";
  }

  return normalized[0]?.toUpperCase() + normalized.slice(1);
}

function ensureSentenceEnding(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Уточнити деталі.";
  }

  return /[.!?…]$/u.test(normalized) ? normalized : `${normalized}.`;
}

function dedupeListItems(items: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const item of items) {
    const key = item.trim().toLowerCase();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item.trim());
  }

  return unique;
}

function parseListLine(line: string): { marker: string; content: string } | null {
  const match = line.trim().match(/^([-*+]|\d+[.)])\s+(.+)$/u);

  if (!match) {
    return null;
  }

  return {
    marker: match[1] ?? "-",
    content: (match[2] ?? "").trim()
  };
}

function isHeadingLine(value: string): boolean {
  return /^#{1,6}\s+\S/u.test(value.trim());
}

function looksLikeIdeaDescriptionItem(value: string): boolean {
  if (!value || isHeadingLine(value)) {
    return false;
  }

  const match = value.trim().match(/^(.{1,56}?)(?:\s+—\s+|:\s+)(\S.+)$/u);

  if (!match) {
    return false;
  }

  const leadWordCount = (match[1] ?? "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
  const descriptionLength = (match[2] ?? "").trim().length;
  return leadWordCount >= 1 && leadWordCount <= 4 && descriptionLength >= 6;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCalloutPromptInstruction(request: ReviewActionRequest, fragment: string): string {
  const calloutKind = request.item.calloutKind ?? "quick_fact";
  const template = request.calloutPromptTemplate ?? "";

  return renderTemplate(template, {
    calloutKind,
    calloutKindLabel: getEditorialCalloutKindLabel(calloutKind),
    fragment,
    recommendation: request.item.recommendation
  });
}

function buildImagePromptInstruction(request: ReviewActionRequest, fragment: string): string {
  const visualIntent = request.item.visualIntent ?? "concept";
  const template = request.imagePromptTemplate ?? "";

  const rendered = renderTemplate(template, {
    visualIntent,
    fragment,
    recommendation: request.item.recommendation
  });

  return `${rendered}\n\nОбов'язкова вимога: поле prompt у відповіді має бути виключно українською мовою, без англомовних фраз.`;
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

function parseJsonObject(rawOutput: string): Record<string, unknown> {
  return JSON.parse(extractJsonObject(rawOutput)) as Record<string, unknown>;
}

function normalizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeImageAlt(value: unknown): string | null {
  const normalized = normalizeString(value, 120);

  if (!normalized) {
    return null;
  }

  return normalized.replace(/\s+/g, " ").replace(/[\r\n]+/g, " ").trim() || null;
}

function normalizeCaption(value: unknown): string | null {
  const normalized = normalizeString(value, 240);

  if (!normalized) {
    return null;
  }

  return normalized.replace(/\s+/g, " ").replace(/[\r\n]+/g, " ").trim() || null;
}

function createDefaultImageAlt(title: string, visualIntent: EditorialVisualIntent): string {
  const cleanedTitle = title.replace(/\s+/g, " ").trim();

  if (!cleanedTitle) {
    return `Чернеткова ${visualIntent} ілюстрація`;
  }

  return cleanedTitle.slice(0, 120);
}

function createDefaultImageCaption(recommendation: string): string | undefined {
  const cleanedRecommendation = recommendation.replace(/\s+/g, " ").trim();

  if (!cleanedRecommendation) {
    return undefined;
  }

  return cleanedRecommendation.slice(0, 240);
}

function buildDefaultUkrainianImagePrompt(visualIntent: EditorialVisualIntent, fragment: string, recommendation: string): string {
  const cleanedRecommendation = recommendation.replace(/\s+/g, " ").trim();
  const cleanedFragment = fragment.replace(/\s+/g, " ").trim();

  return [
    `Тип візуалу: ${visualIntent}.`,
    "Стиль: мінімалістичний, простий, 2D, без зайвого декору.",
    `Що показати: ${cleanedRecommendation || "Поясни ключову ідею фрагмента на простій схемі."}`,
    `Контекст фрагмента: ${cleanedFragment || "Орієнтуйся на виділений уривок рукопису."}`,
    "Обов'язково: чітке розділення головних елементів, навчальна функція, чистий фон.",
    "Уникати: фотореалізму, складних текстур, декоративних рамок, зайвих об'єктів."
  ]
    .join(" ")
    .slice(0, 2400);
}

function sanitizeImagePrompt(prompt: string): string {
  return prompt
    .replace(/^\s*Чернетка візуалізації для ілюстратора\.\s*/iu, "")
    .trim()
    .slice(0, 2400);
}

function looksLikeUkrainianPrompt(prompt: string): boolean {
  const normalized = prompt.trim();

  if (!normalized) {
    return false;
  }

  const cyrillicChars = normalized.match(/[А-Яа-яІіЇїЄєҐґ]/g)?.length ?? 0;

  if (cyrillicChars === 0) {
    return false;
  }

  const latinWords = normalized.match(/\b[A-Za-z]{3,}\b/g)?.length ?? 0;
  const cyrillicWords = normalized.match(/\b[А-Яа-яІіЇїЄєҐґ]{2,}\b/g)?.length ?? 0;

  if (cyrillicWords === 0) {
    return false;
  }

  return cyrillicWords >= latinWords;
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

class ReviewActionProviderError extends Error {
  constructor(
    message: string,
    readonly rawOutput?: string
  ) {
    super(message);
  }
}

function wrapReviewActionProviderError(error: unknown, rawOutput?: string): Error {
  if (error instanceof ReviewActionProviderError) {
    return error;
  }

  if (error instanceof Error) {
    return new ReviewActionProviderError(error.message, rawOutput);
  }

  return new ReviewActionProviderError("Провайдер повернув невалідну чернетку дії.", rawOutput);
}

function readProviderErrorMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;

  if (!error || typeof error !== "object") {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
}

function readOpenAiContent(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = payload.output;

  if (!Array.isArray(output)) {
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

          return typeof (part as Record<string, unknown>).text === "string" ? String((part as Record<string, unknown>).text) : "";
        })
        .join("");
    })
    .join("")
    .trim();

  if (!text) {
    throw new Error("OpenAI повернув порожню відповідь.");
  }

  return text;
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
    throw new Error("Провайдер не повернув JSON-об'єкт.");
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
