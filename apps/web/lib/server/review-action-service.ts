import { createPatchId } from "../editor/patch-contract.ts";
import { computeAnchorFingerprint, type ManuscriptRevisionState } from "../editor/manuscript-structure.ts";
import { createInlineText, getBlockText, getInlineText, type Block } from "../editor/document-model.ts";
import { parseBoldMarkdownToInlineNodes, serializeInlineNodesToBoldMarkdown } from "../editor/inline-markup.ts";
import type {
  EditorialCalloutKind,
  EditorialReviewRecommendationType,
  EditorialVisualIntent,
  ReviewActionDiagnostics,
  ReviewActionProposal,
  ReviewActionRequest,
  ReviewActionResponse
} from "../editor/review-contract.ts";
import {
  getEditorialCalloutKindLabel,
  getEditorialCalloutKindTitle,
  isReplaceReviewType,
  normalizeEditorialCalloutDepth
} from "../editor/review-contract.ts";
import {
  getVisualStylePresetGuide,
  normalizeVisualStylePreset
} from "../editor/settings.ts";
import { readServerEnvValue } from "./env.ts";
import { resolveProviderApiKey } from "./patch-service.ts";
import {
  buildCalloutProviderPrompt,
  buildFallbackCalloutPrompt,
  buildFallbackImagePrompt,
  buildImageProviderPrompt,
  buildReplaceProviderPrompt,
  buildReplaceSystemPrompt,
  buildSubsectionProviderPrompt,
  getReviewActionErrors
} from "../i18n/server-prompts/review-action.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const anthropicVersion = "2023-06-01";
const requestTimeoutMs = 45000;

type FetchLike = typeof fetch;
type OpenAiResponsePayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      refusal?: string;
    }>;
  }>;
  error?: { message?: string };
  status?: string;
  incomplete_details?: { reason?: string };
};
type ReplaceProposalContentResult = {
  newBlocks: Block[];
  reason: string;
  rawOutput: string;
};

const openAiReplaceTextSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    replacements: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["replacements"]
} as const;

const geminiReplaceTextSchema = {
  type: "OBJECT",
  properties: {
    replacements: {
      type: "ARRAY",
      items: { type: "STRING" }
    }
  },
  required: ["replacements"]
} as const;

const openAiListReplaceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["items"]
} as const;

const geminiListReplaceSchema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: { type: "STRING" }
    }
  },
  required: ["items"]
} as const;

function readOpenAiResponseText(payload: OpenAiResponsePayload): string {
  const directText = payload.output_text?.trim();

  if (directText) {
    return directText;
  }

  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? "")
      .join("\n")
      .trim() ?? ""
  );
}

function describeOpenAiEmptyResponse(payload: OpenAiResponsePayload, fallbackMessage: string): string {
  const refusals = payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.refusal?.trim() ?? "")
    .filter(Boolean);

  if (refusals?.length) {
    return `OpenAI відмовився згенерувати відповідь: ${refusals.join(" ")}`;
  }

  if (payload.status === "incomplete") {
    const reason = payload.incomplete_details?.reason;
    return reason ? `${fallbackMessage} Причина: ${reason}.` : `${fallbackMessage} Відповідь incomplete.`;
  }

  return fallbackMessage;
}

export interface GenerateReviewActionOptions {
  fetchImpl?: FetchLike;
  now?: () => string;
  readEnvValue?: (key: string) => string | null;
}

export async function generateReviewAction(
  request: ReviewActionRequest,
  options: GenerateReviewActionOptions = {}
): Promise<ReviewActionResponse> {
  const normalizedRequest = normalizeReviewActionRequest(request);
  const locale = normalizedRequest.locale ?? "uk";
  const actionErrors = getReviewActionErrors(locale);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
  const requestId = createPatchId("review-action");
  const diagnosticsBase = {
    requestId,
    requestedProvider: normalizedRequest.provider,
    requestedModelId: normalizedRequest.modelId,
    reviewItemId: normalizedRequest.item.id,
    generatedAt: now()
  } satisfies Omit<ReviewActionDiagnostics, "proposalKind">;

  const staleReason = getStaleReason(
    normalizedRequest.document,
    normalizedRequest.currentRevision,
    normalizedRequest.item.anchor.blockIds,
    normalizedRequest.item.anchor.fingerprint,
    locale
  );

  if (staleReason) {
    return {
      proposal: createStaleProposal(normalizedRequest, staleReason),
      providerUsed: "stale-anchor",
      usedFallback: false,
      error: staleReason,
      diagnostics: {
        ...diagnosticsBase,
        proposalKind: "stale_anchor"
      }
    };
  }

  if (isReplaceReviewType(normalizedRequest.item.recommendationType)) {
    const apiKey = normalizedRequest.apiKey ?? resolveProviderApiKey(normalizedRequest.provider, readEnvValue);

    if (!apiKey) {
      const proposalKind = getRequestProposalKind(normalizedRequest);
      const error = actionErrors.missingApiKey(providerDisplayName(normalizedRequest.provider));

      return {
        proposal: createErrorProposal(normalizedRequest, proposalKind, error),
        providerUsed: normalizedRequest.provider,
        usedFallback: false,
        error,
        diagnostics: {
          ...diagnosticsBase,
          proposalKind
        }
      };
    }

    try {
      const replaceResult = await createReplaceProposalContent(normalizedRequest, apiKey, fetchImpl);
      const proposal = buildReplaceProposalFromBlocks(normalizedRequest, replaceResult.newBlocks, replaceResult.reason);

      return {
        proposal,
        providerUsed: getReplaceProviderUsed(normalizedRequest.item.recommendationType, normalizedRequest.provider),
        usedFallback: false,
        diagnostics: {
          ...diagnosticsBase,
          proposalKind: "text_diff",
          rawOutput: replaceResult.rawOutput
        }
      };
    } catch (error) {
      const proposalKind = getRequestProposalKind(normalizedRequest);
      const message = formatReplaceProviderErrorMessage(normalizedRequest.provider, error, locale);

      return {
        proposal: createErrorProposal(normalizedRequest, proposalKind, message),
        providerUsed: normalizedRequest.provider,
        usedFallback: false,
        error: message,
        diagnostics: {
          ...diagnosticsBase,
          proposalKind,
          rawError: formatRawError(error)
        }
      };
    }
  }

  if (normalizedRequest.item.recommendationType === "subsection") {
    const explicitDraft = parseSubsectionDraftFromRecommendation(normalizedRequest.item.recommendation);

    if (explicitDraft) {
      return {
        proposal: {
          id: createPatchId("proposal-subsection"),
          reviewItemId: normalizedRequest.item.id,
          sourceRevisionId: normalizedRequest.item.documentRevisionId,
          targetRevisionId: normalizedRequest.currentRevision.documentRevisionId,
          kind: "subsection_prompt",
          summary: normalizedRequest.item.reason,
          canApplyDirectly: true,
          subsectionDraft: {
            title: explicitDraft.title,
            lead: "",
            prompt: buildProviderPrompt(normalizedRequest, "subsection")
          }
        },
        providerUsed: "deterministic:subsection",
        usedFallback: false,
        diagnostics: {
          ...diagnosticsBase,
          proposalKind: "subsection_prompt"
        }
      };
    }
  }

  const apiKey = normalizedRequest.apiKey ?? resolveProviderApiKey(normalizedRequest.provider, readEnvValue);

  if (!apiKey) {
    const proposalKind = getRequestProposalKind(normalizedRequest);
    const error = actionErrors.missingApiKey(providerDisplayName(normalizedRequest.provider));

    return {
      proposal: createErrorProposal(normalizedRequest, proposalKind, error),
      providerUsed: normalizedRequest.provider,
      usedFallback: false,
      error,
      diagnostics: {
        ...diagnosticsBase,
        proposalKind
      }
    };
  }

  try {
    const providerResult =
      normalizedRequest.item.recommendationType === "subsection"
        ? await createSubsectionProposal(normalizedRequest, apiKey, fetchImpl)
        : normalizedRequest.item.suggestedAction === "prepare_callout"
        ? await createCalloutProposal(normalizedRequest, apiKey, fetchImpl)
        : await createImagePromptProposal(normalizedRequest, apiKey, fetchImpl);

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
    const proposalKind = getRequestProposalKind(normalizedRequest);
    const message = error instanceof Error ? error.message : actionErrors.genericFailure;

    return {
      proposal: createErrorProposal(normalizedRequest, proposalKind, message),
      providerUsed: normalizedRequest.provider,
      usedFallback: false,
      error: message,
      diagnostics: {
        ...diagnosticsBase,
        proposalKind,
        rawError: formatRawError(error)
      }
    };
  }
}

function normalizeReviewActionRequest(request: ReviewActionRequest): ReviewActionRequest {
  const isReplaceProposal = isReplaceReviewType(request.item.recommendationType);
  const relatedBlockIds = Array.from(
    new Set(
      (
        isReplaceProposal
          ? [...request.item.anchor.blockIds]
          : [
              ...request.item.anchor.blockIds,
              request.item.insertionPoint.anchorBlockId
            ]
      ).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  );
  const compactBlocks = relatedBlockIds.length > 0
    ? relatedBlockIds
      .map((blockId) => request.document.blocks.find((block) => block.id === blockId))
      .filter((block): block is Block => Boolean(block))
    : request.document.blocks;
  const compactDocument = {
    version: request.document.version,
    blocks: compactBlocks
  } as ReviewActionRequest["document"];
  const compactRevision = {
    documentRevisionId: request.currentRevision.documentRevisionId,
    blockOrder: relatedBlockIds.length > 0 ? relatedBlockIds : request.currentRevision.blockOrder,
    blockFingerprints: Object.fromEntries(
      (relatedBlockIds.length > 0 ? relatedBlockIds : request.currentRevision.blockOrder).map((blockId) => [
        blockId,
        request.currentRevision.blockFingerprints[blockId] ?? ""
      ])
    )
  } as ManuscriptRevisionState;
  const compactItem: ReviewActionRequest["item"] = {
    id: request.item.id,
    reviewSessionId: request.item.reviewSessionId,
    documentRevisionId: request.item.documentRevisionId,
    changeLevel: request.item.changeLevel,
    title: sanitizePromptInput(request.item.title, 220),
    reason: sanitizePromptInput(request.item.reason, 1600),
    recommendation: sanitizePromptInput(request.item.recommendation, 6000),
    recommendationType: request.item.recommendationType,
    suggestedAction: request.item.suggestedAction,
    priority: request.item.priority,
    anchor: {
      ...request.item.anchor,
      blockIds: request.item.anchor.blockIds.filter((blockId): blockId is string => typeof blockId === "string" && blockId.trim().length > 0),
      excerpt: sanitizePromptInput(request.item.anchor.excerpt, 2600),
      fingerprint: sanitizePromptInput(request.item.anchor.fingerprint, 8000)
    },
    insertionPoint: request.item.insertionPoint,
    status: request.item.status,
    origin: request.item.origin,
    stepId: request.item.stepId,
    stepRunId: request.item.stepRunId
  };

  if (request.item.calloutKind) {
    compactItem.calloutKind = request.item.calloutKind;
    compactItem.calloutDepth = normalizeEditorialCalloutDepth(request.item.calloutDepth);
  }

  if (request.item.visualIntent) {
    compactItem.visualIntent = request.item.visualIntent;
  }

  return {
    ...request,
    locale: request.locale ?? "uk",
    document: compactDocument,
    currentRevision: compactRevision,
    item: compactItem,
    editorialInstruction: sanitizeOptionalPrompt(request.editorialInstruction, 2000),
    provider: request.provider.trim(),
    modelId: request.modelId.trim(),
    apiKey: request.apiKey?.trim() || undefined,
    basePrompt: sanitizeOptionalPrompt(request.basePrompt, 4000),
    reviewLevelGuide: sanitizeOptionalPrompt(request.reviewLevelGuide, 4000),
    calloutPromptTemplate: sanitizeOptionalPrompt(request.calloutPromptTemplate, 9000),
    imagePromptTemplate: sanitizeOptionalPrompt(request.imagePromptTemplate, 12000)
  };
}

function getStaleReason(
  document: ReviewActionRequest["document"],
  currentRevision: ManuscriptRevisionState,
  blockIds: string[],
  fingerprint: string,
  locale: ReviewActionRequest["locale"] = "uk"
): string | null {
  const errors = getReviewActionErrors(locale ?? "uk");
  const currentFingerprint = computeAnchorFingerprint(document, blockIds);

  if (!blockIds.every((blockId) => currentRevision.blockOrder.includes(blockId))) {
    return errors.staleAnchorMismatch;
  }

  return currentFingerprint === fingerprint ? null : errors.staleAfterEdit;
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

function getRequestProposalKind(request: ReviewActionRequest): ReviewActionProposal["kind"] {
  if (isReplaceReviewType(request.item.recommendationType)) {
    return "text_diff";
  }

  if (request.item.recommendationType === "subsection") {
    return "subsection_prompt";
  }

  return request.item.suggestedAction === "prepare_callout" ? "callout_prompt" : "image_prompt";
}

function createErrorProposal(
  request: ReviewActionRequest,
  kind: ReviewActionProposal["kind"],
  summary: string
): ReviewActionProposal {
  return {
    id: createPatchId("proposal-error"),
    reviewItemId: request.item.id,
    sourceRevisionId: request.item.documentRevisionId,
    targetRevisionId: request.currentRevision.documentRevisionId,
    kind,
    summary,
    canApplyDirectly: false
  };
}

async function createReplaceProposalContent(
  request: ReviewActionRequest,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<ReplaceProposalContentResult> {
  const locale = request.locale ?? "uk";
  const systemPrompt = buildReplaceSystemPrompt(locale, request);
  const prompt = buildReplaceProviderPrompt(locale, request);
  const rawOutput =
    request.provider === "gemini"
      ? await runGeminiStructuredReplacePrompt(request, apiKey, systemPrompt, prompt, fetchImpl)
      : request.provider === "anthropic"
        ? await runAnthropicStructuredReplacePrompt(request, apiKey, systemPrompt, prompt, fetchImpl)
        : await runOpenAiStructuredReplacePrompt(request, apiKey, systemPrompt, prompt, fetchImpl);

  return parseReplaceProposalContent(rawOutput, request);
}

function buildReplaceProposalFromBlocks(
  request: ReviewActionRequest,
  newBlocks: Block[],
  reason: string
): ReviewActionProposal {
  const operation = buildReplaceOperation(request, newBlocks, reason);

  return {
    id: createPatchId("proposal"),
    reviewItemId: request.item.id,
    sourceRevisionId: request.item.documentRevisionId,
    targetRevisionId: request.currentRevision.documentRevisionId,
    kind: "text_diff",
    summary: request.item.reason,
    canApplyDirectly: true,
    textDiff: {
      op: "replace_blocks",
      blockIds: operation.blockIds,
      oldBlocks: operation.oldBlocks,
      newBlocks: operation.newBlocks,
      reason: operation.reason,
      warning: operation.warning ?? undefined
    }
  };
}

function buildReplaceOperation(
  request: ReviewActionRequest,
  newBlocks: Block[],
  reason: string
): NonNullable<ReviewActionProposal["textDiff"]> & { warning?: { code: "no_op"; message: string; similarity: number } } {
  const oldBlocks = getReplaceOldBlocks(request);
  const constrainedOperation = constrainReplaceProposalOperation(
    {
      op: "replace_blocks",
      blockIds: request.item.anchor.blockIds,
      oldBlocks,
      newBlocks,
      reason
    },
    request.item.recommendationType
  );

  if (!constrainedOperation) {
    throw new Error("Не вдалося нормалізувати правку до безпечного block-first формату.");
  }

  const normalizedOperation = normalizeReviewTextDiffOperation(constrainedOperation, request.item.recommendationType);
  const qualityWarning = detectReplaceNoOpWarning(
    request.item.recommendationType,
    normalizedOperation.oldBlocks,
    normalizedOperation.newBlocks,
    request.item.stepId
  );

  return {
    ...normalizedOperation,
    warning: qualityWarning ?? undefined
  };
}

function getReplaceOldBlocks(request: ReviewActionRequest): Block[] {
  return request.item.anchor.blockIds
    .map((blockId) => request.document.blocks.find((block) => block.id === blockId))
    .filter((block): block is Block => Boolean(block));
}

function formatReplaceProviderErrorMessage(provider: string, error: unknown, locale: ReviewActionRequest["locale"] = "uk"): string {
  const errors = getReviewActionErrors(locale ?? "uk");

  if (error instanceof Error && error.name === "AbortError") {
    return errors.providerTimeout(providerDisplayName(provider), Math.round(requestTimeoutMs / 1000));
  }

  if (error instanceof Error) {
    return error.message;
  }

  return errors.providerUnavailable(providerDisplayName(provider));
}

function getReplaceProviderUsed(type: EditorialReviewRecommendationType, provider: string): string {
  return `${provider}:${type === "list" ? "list_replace" : "text_replace"}`;
}

function createFallbackCalloutProposal(request: ReviewActionRequest): ReviewActionProposal {
  const locale = request.locale ?? "uk";
  const excerpt = request.item.anchor.excerpt || request.item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");
  const calloutKind: EditorialCalloutKind = request.item.calloutKind ?? "mechanism";
  const calloutDepth = normalizeEditorialCalloutDepth(request.item.calloutDepth);
  const fallbackLength = calloutDepth === "deep" ? 1200 : 220;

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
      calloutDepth,
      title: locale === "en" ? getEditorialCalloutKindLabel(calloutKind, locale) : getEditorialCalloutKindTitle(calloutKind),
      prompt: buildFallbackCalloutPrompt(locale, calloutKind, calloutDepth, excerpt, request.item.recommendation),
      previewText: normalizeCalloutBodyByKind(excerpt.slice(0, fallbackLength), calloutKind)
    }
  };
}

function createFallbackSubsectionProposal(request: ReviewActionRequest): ReviewActionProposal {
  const excerpt = request.item.anchor.excerpt || request.item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");
  const parsed = parseSubsectionDraftOutput(excerpt, {
    title: request.item.title,
    lead: ""
  });
  const prompt = buildProviderPrompt(request, "subsection");

  return {
    id: createPatchId("proposal-subsection"),
    reviewItemId: request.item.id,
    sourceRevisionId: request.item.documentRevisionId,
    targetRevisionId: request.currentRevision.documentRevisionId,
    kind: "subsection_prompt",
    summary: request.item.reason,
    canApplyDirectly: true,
    subsectionDraft: {
      title: parsed.title,
      lead: "",
      prompt
    }
  };
}

function createFallbackImagePromptProposal(request: ReviewActionRequest): ReviewActionProposal {
  const locale = request.locale ?? "uk";
  const excerpt = request.item.anchor.excerpt || request.item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");
  const visualStylePreset = normalizeVisualStylePreset(request.visualStylePreset);
  const visualStyleGuide = getVisualStylePresetGuide(visualStylePreset, locale);
  const visualIntent = request.item.visualIntent ?? "infographic";

  return {
    id: createPatchId("proposal-image"),
    reviewItemId: request.item.id,
    sourceRevisionId: request.item.documentRevisionId,
    targetRevisionId: request.currentRevision.documentRevisionId,
    kind: "image_prompt",
    summary: request.item.reason,
    canApplyDirectly: false,
    imageDraft: {
      visualIntent,
      visualStylePreset,
      prompt: buildFallbackImagePrompt(locale, excerpt, request.item.recommendation, visualIntent, visualStyleGuide),
      alt: request.item.title,
      caption: "",
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
  const locale = request.locale ?? "uk";
  const calloutDepth = normalizeEditorialCalloutDepth(request.item.calloutDepth ?? request.item.calloutDraft?.calloutDepth);
  const parsed = parseCalloutDraftOutput(result, {
    title: request.item.calloutDraft?.title ?? (locale === "en" ? getEditorialCalloutKindLabel(calloutKind, locale) : getEditorialCalloutKindTitle(calloutKind)),
    body: request.item.calloutDraft?.previewText ?? request.item.anchor.excerpt.slice(0, calloutDepth === "deep" ? 1200 : 220)
  }, calloutKind);

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
        calloutKind,
        calloutDepth,
        title: parsed.title,
        prompt,
        previewText: parsed.body
      }
    }
  };
}

async function createSubsectionProposal(
  request: ReviewActionRequest,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<{ proposal: ReviewActionProposal; providerUsed: string; rawOutput?: string }> {
  const prompt = buildProviderPrompt(request, "subsection");
  const result = request.provider === "gemini"
    ? await runGeminiTextPrompt(request.modelId, apiKey, prompt, fetchImpl)
    : request.provider === "anthropic"
      ? await runAnthropicTextPrompt(request.modelId, apiKey, prompt, fetchImpl)
      : await runOpenAiTextPrompt(request.modelId, apiKey, prompt, fetchImpl);
  const parsed = parseSubsectionDraftOutput(result, {
    title: request.item.title,
    lead: ""
  });

  return {
    providerUsed: request.provider,
    rawOutput: result,
    proposal: {
      id: createPatchId("proposal-subsection"),
      reviewItemId: request.item.id,
      sourceRevisionId: request.item.documentRevisionId,
      targetRevisionId: request.currentRevision.documentRevisionId,
      kind: "subsection_prompt",
      summary: request.item.reason,
      canApplyDirectly: true,
      subsectionDraft: {
        title: parsed.title,
        lead: "",
        prompt
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
  const locale = request.locale ?? "uk";
  const excerpt = getRequestExcerpt(request);
  const visualStylePreset = normalizeVisualStylePreset(request.visualStylePreset);
  const visualStyleGuide = getVisualStylePresetGuide(visualStylePreset, locale);
  const visualIntent = request.item.visualIntent ?? "infographic";
  const result = request.provider === "gemini"
    ? await runGeminiTextPrompt(request.modelId, apiKey, prompt, fetchImpl)
    : request.provider === "anthropic"
      ? await runAnthropicTextPrompt(request.modelId, apiKey, prompt, fetchImpl)
      : await runOpenAiTextPrompt(request.modelId, apiKey, prompt, fetchImpl);
  const parsed = parseImageDraftOutput(result, {
    prompt: buildFallbackImagePrompt(locale, excerpt, request.item.recommendation, visualIntent, visualStyleGuide),
    caption: "",
    alt: request.item.title
  });

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
        visualIntent,
        visualStylePreset,
        prompt: parsed.prompt,
        alt: parsed.alt,
        caption: parsed.caption,
        targetModel: "gemini-3.1-flash-image-preview"
      }
    }
  };
}

function buildProviderPrompt(request: ReviewActionRequest, mode: "callout" | "image" | "subsection"): string {
  const locale = request.locale ?? "uk";
  const excerpt = getRequestExcerpt(request);

  if (mode === "callout") {
    return buildCalloutProviderPrompt(locale, {
      excerpt,
      calloutKind: request.item.calloutKind ?? "mechanism",
      calloutDepth: normalizeEditorialCalloutDepth(request.item.calloutDepth ?? request.item.calloutDraft?.calloutDepth),
      recommendation: request.item.recommendation,
      editorialInstruction: request.editorialInstruction,
      calloutPromptTemplate: request.calloutPromptTemplate
    });
  }

  if (mode === "subsection") {
    return buildSubsectionProviderPrompt(locale, {
      excerpt,
      recommendation: request.item.recommendation,
      editorialInstruction: request.editorialInstruction
    });
  }

  return buildImageProviderPrompt(locale, {
    excerpt,
    recommendation: request.item.recommendation,
    visualIntent: request.item.visualIntent ?? "infographic",
    visualStylePreset: normalizeVisualStylePreset(request.visualStylePreset),
    editorialInstruction: request.editorialInstruction,
    imagePromptTemplate: request.imagePromptTemplate
  });
}

function constrainReplaceProposalOperation(
  operation: ReviewActionProposal["textDiff"],
  recommendationType: EditorialReviewRecommendationType
): ReviewActionProposal["textDiff"] | null {
  if (!operation) {
    return null;
  }

  const targetCount = operation.blockIds.length;

  if (targetCount === 0) {
    return null;
  }

  let nextNewBlocks = operation.newBlocks.slice();

  if (recommendationType === "list") {
    if (nextNewBlocks.length > targetCount) {
      nextNewBlocks = foldOverflowBlocks(nextNewBlocks, targetCount);
    }
  } else {
    nextNewBlocks = normalizeBlocksToExactCount(nextNewBlocks, operation.oldBlocks, targetCount);
  }

  if (nextNewBlocks.length === 0 || nextNewBlocks.length > targetCount) {
    return null;
  }

  return {
    ...operation,
    newBlocks: nextNewBlocks
  };
}

function normalizeReviewTextDiffOperation(
  operation: NonNullable<ReviewActionProposal["textDiff"]>,
  recommendationType: EditorialReviewRecommendationType
): NonNullable<ReviewActionProposal["textDiff"]> {
  if (recommendationType === "list") {
    const sanitized = operation.newBlocks.map((block) => sanitizeReplacementBlock(block));

    return {
      ...operation,
      newBlocks: ensureListRecommendationStructure(sanitized, operation.oldBlocks)
    };
  }

  const strictTypePreservation = recommendationType === "rewrite" || recommendationType === "simplify" || recommendationType === "expand";
  const normalizedNewBlocks = operation.newBlocks.map((block, index) => {
    const oldBlock = operation.oldBlocks[index];

    if (strictTypePreservation && oldBlock) {
      return cloneBlockWithText(oldBlock, sanitizeReplacementText(getBlockTextWithBoldMarkdown(block)));
    }

    return sanitizeReplacementBlock(block);
  });

  return {
    ...operation,
    newBlocks: normalizedNewBlocks
  };
}

function ensureListRecommendationStructure(newBlocks: Block[], oldBlocks: Block[]): Block[] {
  if (newBlocks.some((block) => block.type === "bullet_list" || block.type === "ordered_list")) {
    return newBlocks;
  }

  const listSource = newBlocks.map((block) => getBlockText(block)).join("\n").trim() || oldBlocks.map((block) => getBlockText(block)).join("\n").trim();
  const items = splitListItemsForBlock(listSource);

  if (items.length === 0) {
    return newBlocks;
  }

  const firstId = newBlocks[0]?.id ?? oldBlocks[0]?.id ?? createPatchId("block");

  return [
    {
      id: firstId,
      type: "bullet_list",
      items: items.map((item) => [createInlineText(item)])
    }
  ];
}

function normalizeBlocksToExactCount(newBlocks: Block[], oldBlocks: Block[], targetCount: number): Block[] {
  if (newBlocks.length === targetCount) {
    return newBlocks;
  }

  if (newBlocks.length > targetCount) {
    return foldOverflowBlocks(newBlocks, targetCount);
  }

  const padded = newBlocks.slice();

  for (let index = padded.length; index < targetCount; index += 1) {
    const fallback = oldBlocks[index] ?? oldBlocks[oldBlocks.length - 1];
    padded.push(fallback ? cloneBlockWithText(fallback, getBlockText(fallback)) : { id: createPatchId("block"), type: "paragraph", content: [createInlineText("")] });
  }

  return padded;
}

function foldOverflowBlocks(newBlocks: Block[], maxCount: number): Block[] {
  if (newBlocks.length <= maxCount || maxCount <= 0) {
    return newBlocks.slice(0, Math.max(0, maxCount));
  }

  const kept = newBlocks.slice(0, maxCount);
  const overflowText = newBlocks
    .slice(maxCount)
    .map((block) => getBlockText(block).trim())
    .filter(Boolean)
    .join("\n\n");

  if (!overflowText) {
    return kept;
  }

  const lastIndex = kept.length - 1;
  const last = kept[lastIndex];
  const lastText = getBlockText(last).trim();
  const merged = [lastText, overflowText].filter(Boolean).join("\n\n");
  kept[lastIndex] = cloneBlockWithText(last, merged);

  return kept;
}

function cloneBlockWithText(block: Block, text: string): Block {
  const plain = text.replace(/\r\n?/g, "\n");

  if (block.type === "paragraph") {
    return { ...block, content: parseBoldMarkdownToInlineNodes(plain) };
  }

  if (block.type === "heading") {
    return { ...block, content: parseBoldMarkdownToInlineNodes(plain) };
  }

  if (block.type === "bullet_list") {
    return {
      ...block,
      items: splitListItemsForBlock(plain).map((item) => parseBoldMarkdownToInlineNodes(item))
    };
  }

  if (block.type === "ordered_list") {
    return {
      ...block,
      items: splitListItemsForBlock(plain).map((item) => parseBoldMarkdownToInlineNodes(item))
    };
  }

  return {
    id: block.id,
    type: "paragraph",
    content: parseBoldMarkdownToInlineNodes(plain)
  };
}

function splitListItemsForBlock(text: string): string[] {
  const lineItems = text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => sanitizeListItemText(line))
    .filter(Boolean);

  if (lineItems.length > 1) {
    return lineItems;
  }

  const sentenceItems = text
    .replace(/\r\n?/g, " ")
    .split(/(?<=[.!?;])\s+/)
    .map((line) => sanitizeListItemText(line))
    .filter(Boolean);

  if (sentenceItems.length > 1) {
    return sentenceItems;
  }

  return lineItems.length > 0 ? lineItems : [""];
}

function sanitizeReplacementBlock(block: Block): Block {
  if (block.type === "paragraph" || block.type === "heading") {
    return cloneBlockWithText(block, sanitizeReplacementText(getBlockText(block)));
  }

  if (block.type === "bullet_list") {
    return {
      ...block,
      items: block.items.map((item) => parseBoldMarkdownToInlineNodes(sanitizeListItemText(getInlineText(item))))
    };
  }

  if (block.type === "ordered_list") {
    return {
      ...block,
      items: block.items.map((item) => parseBoldMarkdownToInlineNodes(sanitizeListItemText(getInlineText(item))))
    };
  }

  if (block.type === "callout") {
    return {
      ...block,
      title: parseBoldMarkdownToInlineNodes(sanitizeReplacementText(getInlineText(block.title))),
      body: block.body.map((part) => parseBoldMarkdownToInlineNodes(sanitizeReplacementText(getInlineText(part))))
    };
  }

  return block;
}

function sanitizeListItemText(value: string): string {
  return sanitizeReplacementText(value).replace(/^\s*(?:[-•]|\d+[.)]|\*(?!\*))\s*/, "").trim();
}

function sanitizeReplacementText(value: string): string {
  return protectBoldMarkdown(value)
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\uE000([\s\S]+?)\uE001/g, "**$1**")
    .trim();
}

function protectBoldMarkdown(value: string): string {
  return value.replace(/\*\*([\s\S]+?)\*\*/g, "\uE000$1\uE001");
}

function detectReplaceNoOpWarning(
  recommendationType: EditorialReviewRecommendationType,
  oldBlocks: Block[],
  newBlocks: Block[],
  stepId?: ReviewActionRequest["item"]["stepId"]
): { code: "no_op"; message: string; similarity: number } | null {
  if (stepId === "emphasis") {
    return null;
  }

  if (recommendationType !== "rewrite" && recommendationType !== "simplify") {
    return null;
  }

  const source = canonicalizeBlocksForComparison(oldBlocks);
  const candidate = canonicalizeBlocksForComparison(newBlocks);

  if (!source || !candidate) {
    return null;
  }

  const similarity = computeDiceSimilarity(source, candidate);

  if (similarity < 0.94) {
    return null;
  }

  return {
    code: "no_op",
    message: "Чернетка майже не змінює текст. Перегенеруйте, щоб отримати виразнішу правку.",
    similarity
  };
}

function canonicalizeBlocksForComparison(blocks: Block[]): string {
  return blocks
    .map((block) => sanitizeReplacementText(getBlockText(block)).toLowerCase())
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function computeDiceSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  if (left.length < 2 || right.length < 2) {
    return 0;
  }

  const leftPairs = createBigramCounts(left);
  const rightPairs = createBigramCounts(right);
  let overlap = 0;
  let leftCount = 0;
  let rightCount = 0;

  for (const value of leftPairs.values()) {
    leftCount += value;
  }

  for (const value of rightPairs.values()) {
    rightCount += value;
  }

  for (const [pair, leftValue] of leftPairs.entries()) {
    const rightValue = rightPairs.get(pair) ?? 0;
    overlap += Math.min(leftValue, rightValue);
  }

  if (leftCount === 0 || rightCount === 0) {
    return 0;
  }

  return (2 * overlap) / (leftCount + rightCount);
}

function createBigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();

  for (let index = 0; index < value.length - 1; index += 1) {
    const pair = value.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }

  return counts;
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
    .replace(
      /(Опис сцени|Стиль|Інструкція для ілюстратора|Technical Breakdown|Visual Narrative|Освітня функція візуалу|Обов'язкові елементи|Чого уникати|Анти-кліше та зайвий декор|Пояснення visualIntent)\s*:?\s*/gim,
      ""
    )
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

function parseImageDraftOutput(
  rawOutput: string,
  fallback: { prompt: string; caption: string; alt: string }
): { prompt: string; caption: string; alt: string } {
  const parsedObject = parseLooseJsonObject(rawOutput);
  const objectPrompt = parsedObject ? pickString(parsedObject, ["prompt", "imagePrompt", "promptText", "text", "content"]) : null;
  const objectCaption = parsedObject ? pickString(parsedObject, ["caption", "imageCaption", "figcaption"]) : null;
  const objectAlt = parsedObject ? pickString(parsedObject, ["alt", "altText", "alt_text"]) : null;

  const fallbackPromptValue = normalizeGeneratedImagePrompt(fallback.prompt) || fallback.prompt.trim();
  const fallbackCaptionValue = sanitizeImageCaption(fallback.caption);
  const fallbackAltValue = sanitizeImageAlt(fallback.alt);

  if (objectPrompt || objectCaption || objectAlt) {
    return {
      prompt: normalizeGeneratedImagePrompt(objectPrompt ?? fallbackPromptValue) || fallbackPromptValue,
      caption: sanitizeImageCaption(objectCaption ?? fallbackCaptionValue),
      alt: sanitizeImageAlt(objectAlt ?? fallbackAltValue)
    };
  }

  const plainPrompt = normalizeGeneratedImagePrompt(rawOutput);

  return {
    prompt: plainPrompt || fallbackPromptValue,
    caption: fallbackCaptionValue,
    alt: fallbackAltValue
  };
}

function parseReplaceProposalContent(rawOutput: string, request: ReviewActionRequest): ReplaceProposalContentResult {
  const oldBlocks = getReplaceOldBlocks(request);
  const parsedObject = parseLooseJsonObject(rawOutput);
  const reason = sanitizePromptInput(request.item.reason, 1600) || "Оновив локальне формулювання.";

  if (request.item.recommendationType === "list") {
    const newBlocks =
      parseListReplaceBlocks(parsedObject, oldBlocks) ??
      parseLegacyReplaceBlocks(parsedObject, oldBlocks) ??
      buildListBlocksFromPlainText(rawOutput, oldBlocks);

    if (newBlocks.length === 0) {
      throw new Error("Провайдер не повернув придатний list draft.");
    }

    return { newBlocks, reason, rawOutput };
  }

  const newBlocks =
    parseTextReplaceBlocks(parsedObject, oldBlocks) ??
    parseLegacyReplaceBlocks(parsedObject, oldBlocks) ??
    buildTextBlocksFromPlainText(rawOutput, oldBlocks);

  if (newBlocks.length === 0) {
    throw new Error("Провайдер не повернув придатний replace draft.");
  }

  return { newBlocks, reason, rawOutput };
}

function parseTextReplaceBlocks(record: Record<string, unknown> | null, oldBlocks: Block[]): Block[] | null {
  if (!Array.isArray(record?.replacements)) {
    return null;
  }

  const replacements = record.replacements
    .map((value) => (typeof value === "string" ? sanitizeReplacementText(value) : ""))
    .filter(Boolean);

  if (replacements.length === 0) {
    return null;
  }

  return normalizeTextReplacementBlocks(replacements, oldBlocks);
}

function parseListReplaceBlocks(record: Record<string, unknown> | null, oldBlocks: Block[]): Block[] | null {
  if (!Array.isArray(record?.items)) {
    return null;
  }

  const items = record.items
    .map((value) => (typeof value === "string" ? sanitizeListItemText(value) : ""))
    .filter(Boolean);

  if (items.length === 0) {
    return null;
  }

  return [buildBulletListBlock(items, oldBlocks[0]?.id)];
}

function parseLegacyReplaceBlocks(record: Record<string, unknown> | null, oldBlocks: Block[]): Block[] | null {
  if (!Array.isArray(record?.operations)) {
    return null;
  }

  const firstOperation = record.operations[0];

  if (!firstOperation || typeof firstOperation !== "object") {
    return null;
  }

  const candidateBlocks = (firstOperation as Record<string, unknown>).newBlocks;

  if (!Array.isArray(candidateBlocks)) {
    return null;
  }

  const normalized = coerceProviderBlocks(candidateBlocks, oldBlocks);
  return normalized.length > 0 ? normalized : null;
}

function buildTextBlocksFromPlainText(rawOutput: string, oldBlocks: Block[]): Block[] {
  if (oldBlocks.length === 0) {
    return [];
  }

  const cleaned = sanitizeReplacementText(rawOutput);

  if (!cleaned) {
    return [];
  }

  return normalizeTextReplacementBlocks([cleaned], oldBlocks);
}

function buildListBlocksFromPlainText(rawOutput: string, oldBlocks: Block[]): Block[] {
  const items = splitListItemsForBlock(rawOutput);
  return items.length > 0 ? [buildBulletListBlock(items, oldBlocks[0]?.id)] : [];
}

function normalizeTextReplacementBlocks(replacements: string[], oldBlocks: Block[]): Block[] {
  const padded = replacements.slice(0, oldBlocks.length);

  for (let index = padded.length; index < oldBlocks.length; index += 1) {
    padded.push(getBlockText(oldBlocks[index] ?? oldBlocks[oldBlocks.length - 1]));
  }

  return oldBlocks.map((block, index) => cloneBlockWithText(block, padded[index] ?? getBlockText(block)));
}

function buildBulletListBlock(items: string[], id?: string): Block {
  return {
    id: id ?? createPatchId("block"),
    type: "bullet_list",
    items: items.map((item) => parseBoldMarkdownToInlineNodes(item))
  };
}

function coerceProviderBlocks(candidates: unknown[], oldBlocks: Block[]): Block[] {
  const normalized: Block[] = [];

  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "paragraph";
    const fallbackId = oldBlocks[index]?.id ?? createPatchId("block");

    if (type === "bullet_list" || type === "ordered_list") {
      const items = Array.isArray(record.items)
        ? record.items
            .map((item) =>
              Array.isArray(item)
                ? item.map((node) => (node && typeof node === "object" && typeof (node as Record<string, unknown>).text === "string"
                    ? sanitizeListItemText(String((node as Record<string, unknown>).text))
                    : ""))
                    .join("")
                : ""
            )
            .map((item) => sanitizeListItemText(item))
            .filter(Boolean)
        : [];

      if (items.length > 0) {
        normalized.push({
          id: fallbackId,
          type,
          items: items.map((item) => parseBoldMarkdownToInlineNodes(item))
        } as Block);
      }

      continue;
    }

    const contentText = Array.isArray(record.content)
      ? record.content
          .map((node) =>
            node && typeof node === "object" && typeof (node as Record<string, unknown>).text === "string"
              ? String((node as Record<string, unknown>).text)
              : ""
          )
          .join("")
      : typeof record.text === "string"
        ? record.text
        : "";

    if (!contentText.trim()) {
      continue;
    }

    normalized.push({
      id: fallbackId,
      type: type === "heading" ? "heading" : "paragraph",
      ...(type === "heading" ? { level: 2 as const } : {}),
      content: parseBoldMarkdownToInlineNodes(sanitizeReplacementText(contentText))
    } as Block);
  }

  return normalized;
}

async function runOpenAiStructuredReplacePrompt(
  request: ReviewActionRequest,
  apiKey: string,
  systemPrompt: string,
  prompt: string,
  fetchImpl: FetchLike
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const schema = request.item.recommendationType === "list" ? openAiListReplaceSchema : openAiReplaceTextSchema;
    const response = await fetchImpl(openAiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: request.modelId,
        instructions: systemPrompt,
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: request.item.recommendationType === "list" ? "replace_list" : "replace_text",
            strict: true,
            schema
          }
        }
      }),
      signal: controller.signal
    });
    const payload = (await response.json()) as OpenAiResponsePayload;

    if (!response.ok) {
      throw new Error(payload.error?.message || "OpenAI недоступний.");
    }

    const output = readOpenAiResponseText(payload);

    if (!output) {
      throw new Error(describeOpenAiEmptyResponse(payload, "OpenAI повернув порожню відповідь для локальної правки."));
    }

    return output;
  } finally {
    clearTimeout(timeout);
  }
}

async function runGeminiStructuredReplacePrompt(
  request: ReviewActionRequest,
  apiKey: string,
  systemPrompt: string,
  prompt: string,
  fetchImpl: FetchLike
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const schema = request.item.recommendationType === "list" ? geminiListReplaceSchema : geminiReplaceTextSchema;
    const response = await fetchImpl(`${geminiBaseUrl}/${request.modelId}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: schema
        }
      }),
      signal: controller.signal
    });
    const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };

    if (!response.ok) {
      throw new Error(payload.error?.message || "Gemini недоступний.");
    }

    const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();

    if (!output) {
      throw new Error("Gemini повернув порожню відповідь для локальної правки.");
    }

    return output;
  } finally {
    clearTimeout(timeout);
  }
}

async function runAnthropicStructuredReplacePrompt(
  request: ReviewActionRequest,
  apiKey: string,
  systemPrompt: string,
  prompt: string,
  fetchImpl: FetchLike
): Promise<string> {
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
        system: `${systemPrompt}\n\nПоверни лише JSON без пояснень поза JSON. Якщо prompt дозволяє **жирний** або прості списки всередині текстових полів, зберігай їх; інший markdown не додавай.`,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });
    const payload = (await response.json()) as { content?: Array<{ text?: string }>; error?: { message?: string } };

    if (!response.ok) {
      throw new Error(payload.error?.message || "Anthropic недоступний.");
    }

    const output = payload.content?.map((part) => part.text ?? "").join("\n").trim();

    if (!output) {
      throw new Error("Anthropic повернув порожню відповідь для локальної правки.");
    }

    return output;
  } finally {
    clearTimeout(timeout);
  }
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
    const payload = (await response.json()) as OpenAiResponsePayload;

    if (!response.ok) {
      throw new Error(payload.error?.message || "OpenAI недоступний.");
    }

    const output = readOpenAiResponseText(payload);

    if (!output) {
      throw new Error(describeOpenAiEmptyResponse(payload, "OpenAI повернув порожню відповідь для proposal."));
    }

    return output;
  } finally {
    clearTimeout(timeout);
  }
}

async function runGeminiTextPrompt(modelId: string, apiKey: string, prompt: string, fetchImpl: FetchLike): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(`${geminiBaseUrl}/${modelId}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
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

    const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();

    if (!output) {
      throw new Error("Gemini повернув порожню відповідь для proposal.");
    }

    return output;
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
        system: "Дотримуйся формату відповіді, заданого в повідомленні користувача. Не додавай markdown чи пояснення поза цим форматом.",
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });
    const payload = (await response.json()) as { content?: Array<{ text?: string }>; error?: { message?: string } };

    if (!response.ok) {
      throw new Error(payload.error?.message || "Anthropic недоступний.");
    }

    const output = payload.content?.map((part) => part.text ?? "").join("\n").trim();

    if (!output) {
      throw new Error("Anthropic повернув порожню відповідь для proposal.");
    }

    return output;
  } finally {
    clearTimeout(timeout);
  }
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

function formatRawError(error: unknown): string | undefined {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error == null) {
    return undefined;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function parseCalloutDraftOutput(
  rawOutput: string,
  fallback: { title: string; body: string },
  calloutKind: EditorialCalloutKind
): { title: string; body: string } {
  const parsedObject = parseLooseJsonObject(rawOutput);
  const objectTitle = parsedObject ? pickString(parsedObject, ["title", "heading", "calloutTitle", "header"]) : null;
  const objectBody = parsedObject ? pickString(parsedObject, ["body", "text", "draft", "content", "calloutText"]) : null;

  const fallbackTitleValue = sanitizeCalloutTitle(fallback.title);
  const fallbackBodyValue = normalizeCalloutBodyByKind(fallback.body, calloutKind);

  if (objectTitle || objectBody) {
    return {
      title: sanitizeCalloutTitle(objectTitle ?? fallbackTitleValue),
      body: normalizeCalloutBodyByKind(objectBody ?? fallbackBodyValue, calloutKind) || fallbackBodyValue
    };
  }

  const plain = sanitizeCalloutText(rawOutput);
  const fromLabels = parseCalloutDraftFromLabels(plain);

  return {
    title: sanitizeCalloutTitle(fromLabels.title ?? fallbackTitleValue),
    body: normalizeCalloutBodyByKind(fromLabels.body ?? fallbackBodyValue, calloutKind) || fallbackBodyValue
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

function parseCalloutDraftFromLabels(plain: string): { title?: string; body?: string } {
  const lines = plain.split("\n").map((line) => line.trim()).filter(Boolean);

  let title: string | undefined;
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (!title) {
      const titleMatch = /^(?:заголовок|title)\s*[:\-]\s*(.+)$/i.exec(line);

      if (titleMatch?.[1]) {
        title = titleMatch[1].trim();
        continue;
      }
    }

    if (!/^(?:текст|body|чернетка)\s*[:\-]\s*$/i.test(line)) {
      bodyLines.push(line);
    }
  }

  return {
    title,
    body: bodyLines.length > 0 ? bodyLines.join("\n") : undefined
  };
}

function parseSubsectionDraftOutput(
  rawOutput: string,
  fallback: { title: string; lead: string }
): { title: string; lead: string } {
  const parsedObject = parseLooseJsonObject(rawOutput);
  const objectTitle = parsedObject ? pickString(parsedObject, ["title", "heading", "subheading"]) : null;

  const fallbackTitleValue = sanitizeCalloutTitle(fallback.title);

  if (objectTitle) {
    return {
      title: sanitizeCalloutTitle(objectTitle ?? fallbackTitleValue),
      lead: ""
    };
  }

  const plain = sanitizeCalloutText(rawOutput);
  const lines = plain.split("\n").map((line) => line.trimEnd());
  const titleLineIndex = lines.findIndex((line) => line.trim());
  const title = titleLineIndex >= 0 ? lines[titleLineIndex]!.trim() : fallbackTitleValue;

  return {
    title: sanitizeCalloutTitle(title || fallbackTitleValue),
    lead: ""
  };
}

function parseSubsectionDraftFromRecommendation(value: string): { title: string; lead: string } | null {
  const normalized = sanitizePromptInput(value, 6000);

  if (!normalized) {
    return null;
  }

  const titleMatch = /(?:^|\n|\s)(?:підзаголовок|заголовок)\s*:\s*(.+?)(?=(?:\n|\s)+(?:текст|рамка)\s*:|$)/i.exec(normalized);
  if (!titleMatch?.[1]) {
    return null;
  }

  const title = sanitizeCalloutTitle(titleMatch[1]);

  if (!title) {
    return null;
  }

  return {
    title,
    lead: ""
  };
}

function sanitizeOptionalPrompt(value: string | undefined, maxLength: number): string | undefined {
  if (!value || typeof value !== "string") {
    return undefined;
  }

  const normalized = sanitizePromptInput(value, maxLength);
  return normalized || undefined;
}

function sanitizePromptInput(value: string, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

function sanitizeCalloutTitle(value: string): string {
  const plain = sanitizeCalloutText(value).replace(/\*\*(.*?)\*\*/g, "$1").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return plain.slice(0, 140);
}

function sanitizeImageCaption(value: string): string {
  return sanitizeCalloutText(value).replace(/\s+/g, " ").trim().slice(0, 220);
}

function sanitizeImageAlt(value: string): string {
  return sanitizeCalloutText(value).replace(/\s+/g, " ").trim().slice(0, 140);
}

function sanitizeCalloutText(value: string): string {
  return protectBoldMarkdown(value)
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/__(.*?)__/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\uE000([\s\S]+?)\uE001/g, "**$1**")
    .trim();
}

function getBlockTextWithBoldMarkdown(block: Block): string {
  if (block.type === "paragraph" || block.type === "heading") {
    return serializeInlineNodesToBoldMarkdown(block.content);
  }

  if (block.type === "bullet_list" || block.type === "ordered_list") {
    return block.items.map((item) => serializeInlineNodesToBoldMarkdown(item)).join("\n");
  }

  if (block.type === "callout") {
    return [serializeInlineNodesToBoldMarkdown(block.title), ...block.body.map((part) => serializeInlineNodesToBoldMarkdown(part))]
      .filter(Boolean)
      .join("\n");
  }

  return getBlockText(block);
}

function normalizeCalloutBodyByKind(value: string, calloutKind: EditorialCalloutKind): string {
  const plain = sanitizeCalloutText(value);

  if (calloutKind === "myths_vs_truth") {
    const normalizedPairs = normalizeMythsVsTruthPairs(plain);
    return normalizedPairs.length > 0 ? normalizedPairs.join("\n") : plain;
  }

  if (calloutKind !== "top_list") {
    return plain;
  }

  const normalizedLines = plain
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeTopListLine(line))
    .filter(Boolean);

  if (normalizedLines.length === 0) {
    return plain;
  }

  return normalizedLines.join("\n");
}

function normalizeMythsVsTruthPairs(value: string): string[] {
  const normalized = value
    .replace(/\s*(Міф\s*:)/gi, "\n$1")
    .replace(/\s*(Правда\s*:)/gi, "\n$1")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const pairs: string[] = [];

  for (const line of normalized) {
    if (/^Міф\s*:/i.test(line) || /^Правда\s*:/i.test(line)) {
      pairs.push(line.replace(/\s+/g, " ").trim());
      continue;
    }

    const lastIndex = pairs.length - 1;

    if (lastIndex >= 0) {
      pairs[lastIndex] = `${pairs[lastIndex]} ${line}`.replace(/\s+/g, " ").trim();
    } else {
      pairs.push(line.replace(/\s+/g, " ").trim());
    }
  }

  return pairs;
}

function normalizeTopListLine(line: string): string {
  const stripped = line
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/^\s*\d{1,2}[.)]\s+/, "")
    .trim();

  if (!stripped) {
    return "";
  }

  const colonMatch = /^([^:]{1,48}):\s*(.+)$/.exec(stripped);

  if (colonMatch?.[1] && colonMatch[2]) {
    return `${collapseTopListTitle(colonMatch[1])}: ${normalizeTopListDescription(colonMatch[2])}`;
  }

  const dashMatch = /^(.{1,48}?)\s*[—-]\s*(.+)$/.exec(stripped);

  if (dashMatch?.[1] && dashMatch[2]) {
    return `${collapseTopListTitle(dashMatch[1])}: ${normalizeTopListDescription(dashMatch[2])}`;
  }

  const bracketMatch = /^(.{1,48}?)\s*\((.+)\)$/.exec(stripped);

  if (bracketMatch?.[1] && bracketMatch[2]) {
    return `${collapseTopListTitle(bracketMatch[1])}: ${normalizeTopListDescription(bracketMatch[2])}`;
  }

  const words = stripped.split(/\s+/);
  const title = collapseTopListTitle(words.slice(0, 2).join(" "));
  const description = normalizeTopListDescription(stripped.slice(title.length).replace(/^[,;:.\-–—\s]+/, ""));
  return description ? `${title}: ${description}` : stripped;
}

function collapseTopListTitle(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
}

function normalizeTopListDescription(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function getRequestExcerpt(request: ReviewActionRequest): string {
  return (
    request.item.anchor.excerpt ||
    request.item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n")
  );
}


