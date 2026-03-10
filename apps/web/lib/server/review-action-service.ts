import { createPatchId, type PatchRequest } from "../editor/patch-contract.ts";
import { computeAnchorFingerprint, type ManuscriptRevisionState } from "../editor/manuscript-structure.ts";
import { getBlockText } from "../editor/document-model.ts";
import type {
  EditorialCalloutKind,
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

  if (request.item.suggestedAction === "rewrite_text" || request.item.suggestedAction === "insert_text") {
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
    request.item.recommendationType === "list" ? "Поверни структурований список, якщо це робить фрагмент читабельнішим." : null,
    request.item.suggestedAction === "insert_text" ? "Можна додати короткий пояснювальний блок, але працюй локально біля вибраних абзаців." : null
  ]
    .filter(Boolean)
    .join("\n");
}

function createFallbackCalloutProposal(request: ReviewActionRequest): ReviewActionProposal {
  const excerpt = request.item.anchor.excerpt || request.item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");
  const calloutKind: EditorialCalloutKind = request.item.calloutKind ?? "quick_fact";

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
      title: getEditorialCalloutKindLabel(calloutKind),
      prompt: buildFallbackCalloutPrompt(calloutKind, excerpt, request.item.recommendation),
      previewText: excerpt.slice(0, 180)
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
      prompt: buildFallbackImagePrompt(excerpt, request.item.recommendation),
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

  return {
    providerUsed: request.provider,
    rawOutput: result,
    proposal: {
      id: createPatchId("proposal-callout"),
      reviewItemId: request.item.id,
      sourceRevisionId: request.item.documentRevisionId,
      targetRevisionId: request.currentRevision.documentRevisionId,
      kind: "callout_prompt",
      summary: request.item.reason,
      canApplyDirectly: true,
      calloutDraft: {
        calloutKind: request.item.calloutKind ?? "quick_fact",
        title: request.item.calloutDraft?.title ?? getEditorialCalloutKindLabel(request.item.calloutKind ?? "quick_fact"),
        prompt: result,
        previewText: request.item.anchor.excerpt.slice(0, 180)
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
        prompt: result,
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
    return [
      request.calloutPromptTemplate?.trim(),
      `Тип врізки: ${getEditorialCalloutKindLabel(request.item.calloutKind ?? "quick_fact")}`,
      `Фрагмент: ${excerpt}`,
      `Рекомендація: ${request.item.recommendation}`
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    request.imagePromptTemplate?.trim(),
    `Фрагмент: ${excerpt}`,
    `Рекомендація: ${request.item.recommendation}`,
    `Visual intent: ${request.item.visualIntent ?? "diagram"}`
  ]
    .filter(Boolean)
    .join("\n\n");
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
    `Рекомендація: ${recommendation}`
  ].join("\n");
}

function buildFallbackImagePrompt(fragment: string, recommendation: string): string {
  return [`Показати ключову ідею фрагмента.`, `Фрагмент: ${fragment}`, `Редакторська ціль: ${recommendation}`].join("\n");
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
