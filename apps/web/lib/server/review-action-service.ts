import { createPatchId, type PatchRequest } from "../editor/patch-contract.ts";
import { computeAnchorFingerprint, type ManuscriptRevisionState } from "../editor/manuscript-structure.ts";
import { getBlockText } from "../editor/document-model.ts";
import type {
  EditorialCalloutKind,
  EditorialVisualIntent,
  ReviewActionDiagnostics,
  ReviewActionProposal,
  ReviewActionRequest,
  ReviewActionResponse
} from "../editor/review-contract.ts";
import {
  getEditorialCalloutKindDescription,
  getEditorialCalloutKindLabel,
  getEditorialCalloutKindTitle,
  isReplaceReviewType
} from "../editor/review-contract.ts";
import { readServerEnvValue } from "./env.ts";
import { generatePatchResponse, resolveProviderApiKey } from "./patch-service.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const anthropicVersion = "2023-06-01";
const requestTimeoutMs = 45000;

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

  const staleReason = getStaleReason(request.document, request.currentRevision, request.item.anchor.blockIds, request.item.anchor.fingerprint);

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

  if (request.item.recommendationType === "subsection") {
    const message = "Рекомендації типу «підрозділ» уже нормалізуються окремо, але inline-підготовка для них ще не реалізована.";

    return {
      proposal: createStaleProposal(request, message),
      providerUsed: "unsupported-subsection",
      usedFallback: false,
      error: message,
      diagnostics: {
        ...diagnosticsBase,
        proposalKind: "stale_anchor"
      }
    };
  }

  if (isReplaceReviewType(request.item.recommendationType)) {
    const patchRequest: PatchRequest = {
      document: request.document,
      targetBlockIds: request.item.anchor.blockIds,
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

    if (!operation) {
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

    return {
      proposal: {
        id: createPatchId("proposal"),
        reviewItemId: request.item.id,
        sourceRevisionId: request.item.documentRevisionId,
        targetRevisionId: request.currentRevision.documentRevisionId,
        kind: "text_diff",
        summary: operation.reason,
        canApplyDirectly: true,
        textDiff: {
          op: "replace_blocks",
          blockIds: operation.blockIds,
          oldBlocks: operation.oldBlocks,
          newBlocks: operation.newBlocks,
          reason: operation.reason
        }
      },
      providerUsed: patchResponse.providerUsed,
      usedFallback: patchResponse.usedFallback,
      error: patchResponse.error,
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
      error: error instanceof Error ? error.message : "Не вдалося підготувати чернетку.",
      diagnostics: {
        ...diagnosticsBase,
        proposalKind: fallbackProposal.kind
      }
    };
  }
}

function getStaleReason(
  document: ReviewActionRequest["document"],
  currentRevision: ManuscriptRevisionState,
  blockIds: string[],
  fingerprint: string
): string | null {
  const currentFingerprint = computeAnchorFingerprint(document, blockIds);

  if (!blockIds.every((blockId) => currentRevision.blockOrder.includes(blockId))) {
    return "Якір рекомендації вже не збігається з поточним документом.";
  }

  return currentFingerprint === fingerprint ? null : "Після змін документа ця рекомендація застаріла.";
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

function buildTextProposalPrompt(request: ReviewActionRequest): string {
  return [
    `Редакторська рекомендація: ${request.item.recommendation}`,
    `Причина: ${request.item.reason}`,
    "Формат результату: лише повна заміна вибраних блоків у форматі block editor; без markdown-розмітки (**жирного**, # заголовків, markdown-списків або code fences).",
    "Система застосовує правки цілими блоками; не пропонуй часткових змін усередині абзацу.",
    request.item.recommendationType === "expand" ? "Розкрий логіку ясніше, але не додавай нових фактів." : null,
    request.item.recommendationType === "list" ? "Поверни структурований список, якщо це робить фрагмент читабельнішим." : null,
    request.item.recommendationType === "simplify" ? "Спрости мову для широкого читача без втрати змісту." : null
  ]
    .filter(Boolean)
    .join("\n");
}

function createFallbackCalloutProposal(request: ReviewActionRequest): ReviewActionProposal {
  const excerpt = request.item.anchor.excerpt || request.item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");
  const calloutKind: EditorialCalloutKind = request.item.calloutKind ?? "mechanism";

  return {
    id: createPatchId("proposal-callout"),
    reviewItemId: request.item.id,
    sourceRevisionId: request.item.documentRevisionId,
    targetRevisionId: request.currentRevision.documentRevisionId,
    kind: "callout_prompt",
    summary: request.item.reason,
    canApplyDirectly: true,
    calloutDraft: {
      calloutKind,
      title: getEditorialCalloutKindTitle(calloutKind),
      prompt: buildFallbackCalloutPrompt(calloutKind, excerpt, request.item.recommendation),
      previewText: sanitizeCalloutText(excerpt.slice(0, 220))
    }
  };
}

function createFallbackImagePromptProposal(request: ReviewActionRequest): ReviewActionProposal {
  const excerpt = request.item.anchor.excerpt || request.item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");

  return {
    id: createPatchId("proposal-image"),
    reviewItemId: request.item.id,
    sourceRevisionId: request.item.documentRevisionId,
    targetRevisionId: request.currentRevision.documentRevisionId,
    kind: "image_prompt",
    summary: request.item.reason,
    canApplyDirectly: false,
    imageDraft: {
      visualIntent: request.item.visualIntent ?? "diagram",
      prompt: buildFallbackImagePrompt(excerpt, request.item.recommendation, request.item.visualIntent ?? "diagram"),
      alt: request.item.title,
      caption: request.item.recommendation,
      targetModel: "gemini-3.1-flash-image-preview"
    }
  };
}

async function createCalloutProposal(
  request: ReviewActionRequest,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<{ proposal: ReviewActionProposal; providerUsed: string; rawOutput?: string }> {
  const prompt = buildProviderPrompt(request, "callout");
  const result = request.provider === "gemini"
    ? await runGeminiTextPrompt(request.modelId, apiKey, prompt, fetchImpl)
    : request.provider === "anthropic"
      ? await runAnthropicTextPrompt(request.modelId, apiKey, prompt, fetchImpl)
      : await runOpenAiTextPrompt(request.modelId, apiKey, prompt, fetchImpl);
  const calloutKind = request.item.calloutKind ?? "mechanism";
  const parsed = parseCalloutDraftOutput(result, {
    title: request.item.calloutDraft?.title ?? getEditorialCalloutKindTitle(calloutKind),
    body: request.item.calloutDraft?.previewText ?? request.item.anchor.excerpt.slice(0, 220),
    summary: request.item.reason
  });

  return {
    providerUsed: request.provider,
    rawOutput: result,
    proposal: {
      id: createPatchId("proposal-callout"),
      reviewItemId: request.item.id,
      sourceRevisionId: request.item.documentRevisionId,
      targetRevisionId: request.currentRevision.documentRevisionId,
      kind: "callout_prompt",
      summary: parsed.summary,
      canApplyDirectly: true,
      calloutDraft: {
        calloutKind,
        title: parsed.title,
        prompt,
        previewText: parsed.body
      }
    }
  };
}

async function createImagePromptProposal(
  request: ReviewActionRequest,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<{ proposal: ReviewActionProposal; providerUsed: string; rawOutput?: string }> {
  const prompt = buildProviderPrompt(request, "image");
  const result = request.provider === "gemini"
    ? await runGeminiTextPrompt(request.modelId, apiKey, prompt, fetchImpl)
    : request.provider === "anthropic"
      ? await runAnthropicTextPrompt(request.modelId, apiKey, prompt, fetchImpl)
      : await runOpenAiTextPrompt(request.modelId, apiKey, prompt, fetchImpl);

  return {
    providerUsed: request.provider,
    rawOutput: result,
    proposal: {
      id: createPatchId("proposal-image"),
      reviewItemId: request.item.id,
      sourceRevisionId: request.item.documentRevisionId,
      targetRevisionId: request.currentRevision.documentRevisionId,
      kind: "image_prompt",
      summary: request.item.reason,
      canApplyDirectly: false,
      imageDraft: {
        visualIntent: request.item.visualIntent ?? "diagram",
        prompt: normalizeGeneratedImagePrompt(result),
        alt: request.item.title,
        caption: request.item.recommendation,
        targetModel: "gemini-3.1-flash-image-preview"
      }
    }
  };
}

function buildProviderPrompt(request: ReviewActionRequest, mode: "callout" | "image"): string {
  const excerpt = request.item.anchor.excerpt || request.item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");

  if (mode === "callout") {
    const calloutKind = request.item.calloutKind ?? "mechanism";
    const template = interpolatePromptTemplate(request.calloutPromptTemplate?.trim(), {
      calloutKindLabel: getEditorialCalloutKindLabel(calloutKind),
      fragment: excerpt,
      recommendation: request.item.recommendation
    });

    return [
      template,
      templateContainsPlaceholder(request.calloutPromptTemplate, "calloutKindLabel") ? null : `Тип врізки: ${getEditorialCalloutKindLabel(calloutKind)}`,
      `Що означає цей тип: ${getEditorialCalloutKindDescription(calloutKind)}`,
      templateContainsPlaceholder(request.calloutPromptTemplate, "fragment") ? null : `Фрагмент: ${excerpt}`,
      templateContainsPlaceholder(request.calloutPromptTemplate, "recommendation") ? null : `Рекомендація: ${request.item.recommendation}`,
      "Формат відповіді: поверни лише JSON-об'єкт без markdown.",
      "Схема JSON: {\"title\":\"...\",\"body\":\"...\",\"summary\":\"...\"}.",
      "title: короткий заголовок врізки (1 рядок, plain text).",
      "body: основний текст врізки у вигляді plain text для block editor; без **жирного**, списків markdown, # заголовків або code fences.",
      "summary: одне коротке речення, навіщо ця врізка саме тут."
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const visualIntent = request.item.visualIntent ?? "diagram";
  const template = interpolatePromptTemplate(request.imagePromptTemplate?.trim(), {
    visualIntent,
    fragment: excerpt,
    recommendation: request.item.recommendation
  });

  return [
    template,
    templateContainsPlaceholder(request.imagePromptTemplate, "fragment") ? null : `Фрагмент: ${excerpt}`,
    templateContainsPlaceholder(request.imagePromptTemplate, "recommendation") ? null : `Рекомендація: ${request.item.recommendation}`,
    templateContainsPlaceholder(request.imagePromptTemplate, "visualIntent") ? null : `Тип візуалу: ${visualIntent}`,
    `Пояснення visualIntent: ${getVisualIntentPromptGuidance(visualIntent)}`,
    "Формат відповіді: поверни один готовий image prompt як plain text без markdown, нумерації, секцій чи службових пояснень.",
    "Поверни текст тільки українською мовою."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function interpolatePromptTemplate(template: string | undefined, replacements: Record<string, string>): string {
  if (!template?.trim()) {
    return "";
  }

  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value.trim()),
    template.trim()
  );
}

function templateContainsPlaceholder(template: string | undefined, key: string): boolean {
  return template?.includes(`{{${key}}}`) ?? false;
}

function getVisualIntentPromptGuidance(visualIntent: EditorialVisualIntent): string {
  switch (visualIntent) {
    case "comparison":
      return "Побудуй симетричне порівняння 2 або більше станів з узгодженими ракурсами, спільним масштабом і чітко видимою відмінністю.";
    case "process":
      return "Покажи послідовність кроків або фаз у правильному порядку; зв'язки між етапами мають читатися з першого погляду.";
    case "timeline":
      return "Покажи хронологію з виразним напрямком часу та короткими етапами без зайвих сюжетних деталей.";
    case "scene":
      return "Покажи одну конкретну сцену або ситуацію, у якій головне явище легко зчитується без декоративного фону.";
    case "concept":
      return "Побудуй одну узагальнену пояснювальну ілюстрацію навколо центральної ідеї без перевантаження деталями.";
    case "diagram":
    default:
      return "Покажи схему з чіткими відношеннями між елементами; головне має читатися через форму, розташування і підписи.";
  }
}

function normalizeGeneratedImagePrompt(raw: string): string {
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[-*_]{3,}\s*$/gm, " ")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\*\*(.+?)\*\*:\s*/gm, "")
    .replace(/^\s*(Опис сцени|Стиль|Інструкція для ілюстратора|Technical Breakdown|Visual Narrative|Освітня функція візуалу|Обов'язкові елементи|Чого уникати|Анти-кліше та зайвий декор|Пояснення visualIntent)\s*:?\s*$/gim, " ")
    .replace(/^\s*Ось\s+.*$/gim, " ")
    .replace(/\$\\rightarrow\$/g, "→")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized
    .replace(/^(Prompt для генерації візуалу|Prompt для генерації|Prompt|Інструкція|Технічне завдання)\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function runOpenAiTextPrompt(modelId: string, apiKey: string, prompt: string, fetchImpl: FetchLike): Promise<string> {
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
        model: modelId,
        input: prompt
      }),
      signal: controller.signal
    });
    const payload = (await response.json()) as { output_text?: string; error?: { message?: string } };

    if (!response.ok) {
      throw new Error(payload.error?.message || "OpenAI недоступний.");
    }

    return payload.output_text?.trim() || prompt;
  } finally {
    clearTimeout(timeout);
  }
}

async function runGeminiTextPrompt(modelId: string, apiKey: string, prompt: string, fetchImpl: FetchLike): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(`${geminiBaseUrl}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      }),
      signal: controller.signal
    });
    const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };

    if (!response.ok) {
      throw new Error(payload.error?.message || "Gemini недоступний.");
    }

    return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim() || prompt;
  } finally {
    clearTimeout(timeout);
  }
}

async function runAnthropicTextPrompt(modelId: string, apiKey: string, prompt: string, fetchImpl: FetchLike): Promise<string> {
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
        model: modelId,
        max_tokens: 1200,
        system: "Поверни лише чистий текст без markdown.",
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });
    const payload = (await response.json()) as { content?: Array<{ text?: string }>; error?: { message?: string } };

    if (!response.ok) {
      throw new Error(payload.error?.message || "Anthropic недоступний.");
    }

    return payload.content?.map((part) => part.text ?? "").join("\n").trim() || prompt;
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallbackCalloutPrompt(kind: EditorialCalloutKind, fragment: string, recommendation: string): string {
  return [
    `Тип врізки: ${getEditorialCalloutKindLabel(kind)}.`,
    `Фрагмент: ${fragment}`,
    `Рекомендація: ${recommendation}`,
    "Поверни plain text без markdown, придатний для block editor."
  ].join("\n");
}

function buildFallbackImagePrompt(fragment: string, recommendation: string, visualIntent: EditorialVisualIntent): string {
  return [
    "Створи простий навчальний візуал українською мовою.",
    getVisualIntentPromptGuidance(visualIntent),
    `Спирайся тільки на цей фрагмент: ${fragment}`,
    `Редакторська ціль: ${recommendation}`,
    "Без фотореалізму, зайвого декору, медичних кліше та вигаданих фактів."
  ].join(" ");
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

function parseCalloutDraftOutput(
  rawOutput: string,
  fallback: { title: string; body: string; summary: string }
): { title: string; body: string; summary: string } {
  const parsedObject = parseLooseJsonObject(rawOutput);
  const objectTitle = parsedObject ? pickString(parsedObject, ["title", "heading", "calloutTitle", "header"]) : null;
  const objectBody = parsedObject ? pickString(parsedObject, ["body", "text", "draft", "content", "calloutText"]) : null;
  const objectSummary = parsedObject ? pickString(parsedObject, ["summary", "why", "purpose", "rationale"]) : null;

  const fallbackTitleValue = sanitizeCalloutTitle(fallback.title);
  const fallbackBodyValue = sanitizeCalloutText(fallback.body);
  const fallbackSummaryValue = sanitizeCalloutText(fallback.summary) || "Коротко поясни, чому ця врізка потрібна саме тут.";

  if (objectTitle || objectBody || objectSummary) {
    return {
      title: sanitizeCalloutTitle(objectTitle ?? fallbackTitleValue),
      body: sanitizeCalloutText(objectBody ?? fallbackBodyValue) || fallbackBodyValue,
      summary: sanitizeCalloutText(objectSummary ?? fallbackSummaryValue) || fallbackSummaryValue
    };
  }

  const plain = sanitizeCalloutText(rawOutput);
  const fromLabels = parseCalloutDraftFromLabels(plain);

  return {
    title: sanitizeCalloutTitle(fromLabels.title ?? fallbackTitleValue),
    body: sanitizeCalloutText(fromLabels.body ?? fallbackBodyValue) || fallbackBodyValue,
    summary: sanitizeCalloutText(fromLabels.summary ?? fallbackSummaryValue) || fallbackSummaryValue
  };
}

function parseLooseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    const match = /\{[\s\S]*\}/.exec(trimmed);

    if (!match) {
      return null;
    }

    try {
      const parsed = JSON.parse(match[0]) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function parseCalloutDraftFromLabels(plain: string): { title?: string; body?: string; summary?: string } {
  const lines = plain.split("\n").map((line) => line.trim()).filter(Boolean);

  let title: string | undefined;
  let summary: string | undefined;
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (!title) {
      const titleMatch = /^(?:заголовок|title)\s*[:\-]\s*(.+)$/i.exec(line);

      if (titleMatch?.[1]) {
        title = titleMatch[1].trim();
        continue;
      }
    }

    if (!summary) {
      const summaryMatch = /^(?:навіщо|summary|purpose|rationale)\s*[:\-]\s*(.+)$/i.exec(line);

      if (summaryMatch?.[1]) {
        summary = summaryMatch[1].trim();
        continue;
      }
    }

    if (!/^(?:текст|body|чернетка)\s*[:\-]\s*$/i.test(line)) {
      bodyLines.push(line);
    }
  }

  return {
    title,
    body: bodyLines.length > 0 ? bodyLines.join("\n") : undefined,
    summary
  };
}

function sanitizeCalloutTitle(value: string): string {
  const plain = sanitizeCalloutText(value).split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return plain.slice(0, 140);
}

function sanitizeCalloutText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
