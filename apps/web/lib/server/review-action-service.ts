import { createPatchId, type PatchRequest } from "../editor/patch-contract.ts";
import { computeAnchorFingerprint, type ManuscriptRevisionState } from "../editor/manuscript-structure.ts";
import { createInlineText, getBlockText, getInlineText, type Block } from "../editor/document-model.ts";
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
  getEditorialCalloutKindDescription,
  getEditorialCalloutKindLabel,
  getEditorialCalloutKindTitle,
  isReplaceReviewType
} from "../editor/review-contract.ts";
import { getVisualStylePresetGuide, getVisualStylePresetLabel, normalizeVisualStylePreset } from "../editor/settings.ts";
import { readServerEnvValue } from "./env.ts";
import { generatePatchResponse, resolveProviderApiKey } from "./patch-service.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const anthropicVersion = "2023-06-01";
const requestTimeoutMs = 45000;

type FetchLike = typeof fetch;
type InfographicLayout = "comparison" | "process" | "timeline" | "cause_effect" | "layers" | "diagram";

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
    normalizedRequest.item.anchor.fingerprint
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
    const patchRequest: PatchRequest = {
      document: normalizedRequest.document,
      targetBlockIds: normalizedRequest.item.anchor.blockIds,
      mode: "custom",
      prompt: buildTextProposalPrompt(normalizedRequest),
      provider: normalizedRequest.provider,
      modelId: normalizedRequest.modelId,
      apiKey: normalizedRequest.apiKey,
      basePrompt: [normalizedRequest.basePrompt, normalizedRequest.reviewLevelGuide].filter(Boolean).join("\n\n")
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
        proposal: createStaleProposal(normalizedRequest, message),
        providerUsed: patchResponse.providerUsed,
        usedFallback: patchResponse.usedFallback,
        error: message,
        diagnostics: {
          ...diagnosticsBase,
          proposalKind: "stale_anchor"
        }
      };
    }

    const constrainedOperation = constrainReplaceProposalOperation(operation, request.item.recommendationType);

    if (!constrainedOperation) {
      const message = "Не вдалося нормалізувати правку до безпечного block-first формату.";

      return {
        proposal: createStaleProposal(normalizedRequest, message),
        providerUsed: patchResponse.providerUsed,
        usedFallback: true,
        error: message,
        diagnostics: {
          ...diagnosticsBase,
          proposalKind: "stale_anchor"
        }
      };
    }

    const normalizedOperation = normalizeReviewTextDiffOperation(constrainedOperation, request.item.recommendationType);
    const qualityWarning = detectReplaceNoOpWarning(
      normalizedRequest.item.recommendationType,
      normalizedOperation.oldBlocks,
      normalizedOperation.newBlocks
    );

    return {
      proposal: {
        id: createPatchId("proposal"),
        reviewItemId: normalizedRequest.item.id,
        sourceRevisionId: normalizedRequest.item.documentRevisionId,
        targetRevisionId: normalizedRequest.currentRevision.documentRevisionId,
        kind: "text_diff",
        summary: constrainedOperation.reason,
        canApplyDirectly: true,
        textDiff: {
          op: "replace_blocks",
          blockIds: normalizedOperation.blockIds,
          oldBlocks: normalizedOperation.oldBlocks,
          newBlocks: normalizedOperation.newBlocks,
          reason: normalizedOperation.reason,
          warning: qualityWarning ?? undefined
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
          summary: explicitDraft.summary,
          canApplyDirectly: true,
          subsectionDraft: {
            title: explicitDraft.title,
            lead: explicitDraft.lead,
            prompt: buildProviderPrompt(normalizedRequest, "subsection"),
            summary: explicitDraft.summary
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
    const fallbackProposal =
      normalizedRequest.item.recommendationType === "subsection"
        ? createFallbackSubsectionProposal(normalizedRequest)
        : normalizedRequest.item.suggestedAction === "prepare_callout"
        ? createFallbackCalloutProposal(normalizedRequest)
        : createFallbackImagePromptProposal(normalizedRequest);

    return {
      proposal: fallbackProposal,
      providerUsed: normalizedRequest.provider,
      usedFallback: true,
      error: `Немає API key для ${providerDisplayName(normalizedRequest.provider)} у формі або .env, тому показано локальну чернетку.`,
      diagnostics: {
        ...diagnosticsBase,
        proposalKind: fallbackProposal.kind
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
    const fallbackProposal =
      normalizedRequest.item.recommendationType === "subsection"
        ? createFallbackSubsectionProposal(normalizedRequest)
        : normalizedRequest.item.suggestedAction === "prepare_callout"
        ? createFallbackCalloutProposal(normalizedRequest)
        : createFallbackImagePromptProposal(normalizedRequest);

    return {
      proposal: fallbackProposal,
      providerUsed: normalizedRequest.provider,
      usedFallback: true,
      error: error instanceof Error ? error.message : "Не вдалося підготувати чернетку.",
      diagnostics: {
        ...diagnosticsBase,
        proposalKind: fallbackProposal.kind
      }
    };
  }
}

function normalizeReviewActionRequest(request: ReviewActionRequest): ReviewActionRequest {
  const isReplaceProposal = isReplaceReviewType(request.item.recommendationType);
  const relatedBlockIds = Array.from(
    new Set(
      [
        ...request.item.anchor.blockIds,
        request.item.insertionPoint.anchorBlockId
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  );
  const compactBlocks = relatedBlockIds.length > 0
    ? relatedBlockIds
      .map((blockId) => request.document.blocks.find((block) => block.id === blockId))
      .filter((block): block is Block => Boolean(block))
    : request.document.blocks;
  const compactDocument = isReplaceProposal
    ? request.document
    : ({
      version: request.document.version,
      blocks: compactBlocks
    } as ReviewActionRequest["document"]);
  const compactRevision = isReplaceProposal
    ? request.currentRevision
    : ({
      documentRevisionId: request.currentRevision.documentRevisionId,
      blockOrder: relatedBlockIds.length > 0 ? relatedBlockIds : request.currentRevision.blockOrder,
      blockFingerprints: Object.fromEntries(
        (relatedBlockIds.length > 0 ? relatedBlockIds : request.currentRevision.blockOrder).map((blockId) => [
          blockId,
          request.currentRevision.blockFingerprints[blockId] ?? ""
        ])
      )
    } as ManuscriptRevisionState);
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
  }

  if (request.item.visualIntent) {
    compactItem.visualIntent = request.item.visualIntent;
  }

  return {
    ...request,
    document: compactDocument,
    currentRevision: compactRevision,
    item: compactItem,
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
  const blockCount = request.item.anchor.blockIds.length;

  return [
    buildReplacePromptByType(request.item.recommendationType, blockCount),
    `Редакторська рекомендація: ${request.item.recommendation}`,
    `Причина: ${request.item.reason}`
  ]
    .filter(Boolean)
    .join("\n\n");
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
      previewText: normalizeCalloutBodyByKind(excerpt.slice(0, 220), calloutKind)
    }
  };
}

function createFallbackSubsectionProposal(request: ReviewActionRequest): ReviewActionProposal {
  const excerpt = request.item.anchor.excerpt || request.item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");
  const parsed = parseSubsectionDraftOutput(excerpt, {
    title: request.item.title,
    lead: "",
    summary: request.item.reason
  });
  const prompt = buildProviderPrompt(request, "subsection");

  return {
    id: createPatchId("proposal-subsection"),
    reviewItemId: request.item.id,
    sourceRevisionId: request.item.documentRevisionId,
    targetRevisionId: request.currentRevision.documentRevisionId,
    kind: "subsection_prompt",
    summary: parsed.summary,
    canApplyDirectly: true,
    subsectionDraft: {
      title: parsed.title,
      lead: parsed.lead,
      prompt,
      summary: parsed.summary
    }
  };
}

function createFallbackImagePromptProposal(request: ReviewActionRequest): ReviewActionProposal {
  const excerpt = request.item.anchor.excerpt || request.item.anchor.blockIds.map((blockId) => getBlockText(request.document.blocks.find((block) => block.id === blockId)!)).join("\n\n");
  const visualStylePreset = normalizeVisualStylePreset(request.visualStylePreset);
  const visualStyleGuide = getVisualStylePresetGuide(visualStylePreset);
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
      prompt: buildFallbackImagePrompt(excerpt, request.item.recommendation, visualIntent, visualStyleGuide),
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
    lead: "",
    summary: request.item.reason
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
      summary: parsed.summary,
      canApplyDirectly: true,
      subsectionDraft: {
        title: parsed.title,
        lead: parsed.lead,
        prompt,
        summary: parsed.summary
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
  const excerpt = getRequestExcerpt(request);
  const visualStylePreset = normalizeVisualStylePreset(request.visualStylePreset);
  const visualStyleGuide = getVisualStylePresetGuide(visualStylePreset);
  const visualIntent = request.item.visualIntent ?? "infographic";
  const result = request.provider === "gemini"
    ? await runGeminiTextPrompt(request.modelId, apiKey, prompt, fetchImpl)
    : request.provider === "anthropic"
      ? await runAnthropicTextPrompt(request.modelId, apiKey, prompt, fetchImpl)
      : await runOpenAiTextPrompt(request.modelId, apiKey, prompt, fetchImpl);
  const parsed = parseImageDraftOutput(result, {
    prompt: buildFallbackImagePrompt(excerpt, request.item.recommendation, visualIntent, visualStyleGuide),
    caption: request.item.recommendation,
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
  const excerpt = getRequestExcerpt(request);

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
      `Додаткове правило для типу: ${getCalloutKindGuardrail(calloutKind)}`,
      calloutKind === "top_list"
        ? "Для top_list: body має містити 3-5 рядків; кожен рядок у форматі «Назва (1-2 слова): пояснення (1 речення)»."
        : null,
      calloutKind === "top_list"
        ? "Зберігай multi-line структуру: один пункт = один рядок, не склеюй усе в один абзац."
        : null,
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

  if (mode === "subsection") {
    return [
      "Ти готуєш вставку підзаголовка перед вибраним фрагментом українського науково-популярного рукопису.",
      "Поверни лише JSON-об'єкт без markdown: {\"title\":\"...\",\"lead\":\"...\",\"summary\":\"...\"}.",
      "title: короткий і точний підзаголовок (plain text, один рядок).",
      "lead: необов'язковий короткий вступний абзац (plain text), можна порожній рядок.",
      "summary: одне речення, чому цей підзаголовок потрібен тут.",
      "Не переписуй сам фрагмент і не додавай нових фактів поза контекстом.",
      `Рекомендація: ${request.item.recommendation}`,
      `Фрагмент: ${excerpt}`
    ].join("\n\n");
  }

  const visualIntent = request.item.visualIntent ?? "infographic";
  const inferredInfographicLayout = visualIntent === "infographic"
    ? inferInfographicLayout(excerpt, request.item.recommendation)
    : null;
  const visualStylePreset = normalizeVisualStylePreset(request.visualStylePreset);
  const visualStyleGuide = getVisualStylePresetGuide(visualStylePreset);
  const template = interpolatePromptTemplate(request.imagePromptTemplate?.trim(), {
    visualIntent,
    visualStyleGuide,
    fragment: excerpt,
    recommendation: request.item.recommendation
  });

  return [
    template,
    templateContainsPlaceholder(request.imagePromptTemplate, "fragment") ? null : `Фрагмент: ${excerpt}`,
    templateContainsPlaceholder(request.imagePromptTemplate, "recommendation") ? null : `Рекомендація: ${request.item.recommendation}`,
    templateContainsPlaceholder(request.imagePromptTemplate, "visualIntent") ? null : `Тип візуалу: ${visualIntent}`,
    inferredInfographicLayout ? `Автовибраний формат інфографіки: ${getInfographicLayoutLabel(inferredInfographicLayout)}.` : null,
    templateContainsPlaceholder(request.imagePromptTemplate, "visualStyleGuide")
      ? null
      : `Обраний стиль (${getVisualStylePresetLabel(visualStylePreset)}): ${visualStyleGuide}`,
    `Додаткова вказівка щодо типу візуалу: ${getVisualIntentPromptGuidance(visualIntent, excerpt, request.item.recommendation)}`,
    "Формат відповіді: поверни рівно один готовий image prompt у plain text (один цілісний блок).",
    "Не повертай JSON, markdown, нумерацію, секції або службові пояснення.",
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

function getVisualIntentPromptGuidance(
  visualIntent: EditorialVisualIntent,
  fragment: string,
  recommendation: string
): string {
  if (visualIntent === "illustration") {
    return "Побудуй одну цілісну пояснювальну ілюстрацію або сцену без табличної сітки; головну ідею передай через композиційний центр, 1-2 ключові об'єкти й чіткий візуальний акцент.";
  }

  const layout = inferInfographicLayout(fragment, recommendation);
  return `Це інфографіка. Автовибраний формат: ${getInfographicLayoutLabel(layout)}. ${getInfographicLayoutGuidance(layout)}`;
}

function inferInfographicLayout(fragment: string, recommendation: string): InfographicLayout {
  const source = `${fragment} ${recommendation}`.toLowerCase();

  if (/(порівня|відмін|різниц|vs|versus|до\/після|before\/after|проти)/i.test(source)) {
    return "comparison";
  }

  if (/(таймлайн|хронолог|у часі|по роках|рок[ауів]?|місяц|тижд|дн(і|я)|фаза)/i.test(source)) {
    return "timeline";
  }

  if (/(крок|послідов|процес|етап|спочатку|далі|потім|шлях)/i.test(source)) {
    return "process";
  }

  if (/(причин|наслід|вплив|веде до|виклика|залеж|вісь|cause|effect)/i.test(source)) {
    return "cause_effect";
  }

  if (/(шар|зріз|рівень|епідерм|дерм|бар[’']?єр|мембран|структур)/i.test(source)) {
    return "layers";
  }

  return "diagram";
}

function getInfographicLayoutLabel(layout: InfographicLayout): string {
  switch (layout) {
    case "comparison":
      return "порівняння";
    case "process":
      return "процес";
    case "timeline":
      return "таймлайн";
    case "cause_effect":
      return "причина → наслідок";
    case "layers":
      return "шари / зріз";
    case "diagram":
    default:
      return "схема зв'язків";
  }
}

function getInfographicLayoutGuidance(layout: InfographicLayout): string {
  switch (layout) {
    case "comparison":
      return "Побудуй симетричне порівняння 2 або більше станів в одному масштабі з узгодженими ракурсами та одразу видимою відмінністю.";
    case "process":
      return "Покажи послідовність кроків або фаз у правильному напрямку; перехід між етапами має читатися з першого погляду.";
    case "timeline":
      return "Побудуй лінію часу з чітким напрямком і короткими етапами без сюжетного шуму.";
    case "cause_effect":
      return "Покажи причинно-наслідковий ланцюг із явними зв'язками між тригером, передачею сигналу й результатом.";
    case "layers":
      return "Покажи шари або зріз структури з чітким розмежуванням рівнів і мінімумом декоративних деталей.";
    case "diagram":
    default:
      return "Покажи схему з чіткими відношеннями між елементами; головне має зчитуватися через форму, розташування і підписи.";
  }
}

function buildReplacePromptByType(type: EditorialReviewRecommendationType, blockCount: number): string {
  const shared = [
    "Формат результату: лише повна заміна вибраних блоків у форматі block editor; без markdown-розмітки (**жирного**, # заголовків, markdown-списків або code fences).",
    "Система застосовує правки цілими блоками; не пропонуй часткових змін усередині абзацу.",
    "Не додавай нових фактів.",
    "Зміни мають бути відчутними на рівні формулювань, а не косметичними.",
    "Не повторюй вихідний текст дослівно.",
    "Міняй синтаксис і лексику: перероби структуру речень, не обмежуйся дрібними підстановками слів."
  ];

  if (type === "simplify") {
    return [
      "Тип правки: simplify.",
      "Спрости формулювання для широкого читача без втрати змісту.",
      "Пояснюй терміни простими словами, скорочуй перевантажені конструкції.",
      "Прибери канцеляризми, складні звороти та зайві вставні конструкції; кожне речення має стати простішим за оригінал.",
      `Поверни рівно ${blockCount} replacement blocks.`
    ]
      .concat(shared)
      .join("\n");
  }

  if (type === "expand") {
    return [
      "Тип правки: expand.",
      "Додай пояснювальні зв'язки і зроби фрагмент яснішим, але без нових фактів.",
      `Поверни рівно ${blockCount} replacement blocks.`
    ]
      .concat(shared)
      .join("\n");
  }

  if (type === "list") {
    return [
      "Тип правки: list.",
      "Переформатуй зміст у list block, коли є дискретні пункти.",
      "Кожен пункт роби у форматі «Назва: пояснення», де назва коротка (1-2 слова).",
      `Поверни від 1 до ${blockCount} replacement blocks; ніколи не перевищуй кількість вибраних блоків.`
    ]
      .concat(shared)
      .join("\n");
  }

  return [
    "Тип правки: rewrite.",
    "Перепиши фрагмент ясніше і сильніше стилістично без зміни фактичного змісту.",
    "Перебудуй синтаксис і лексику так, щоб текст читався інакше та легше.",
    "Уникай перефразування на 1-2 слова; потрібна помітна редакторська різниця в кожному блоці.",
    `Поверни рівно ${blockCount} replacement blocks.`
  ]
    .concat(shared)
    .join("\n");
}

function getCalloutKindGuardrail(kind: EditorialCalloutKind): string {
  if (kind === "analogy") {
    return "Явно познач, що це аналогія; не подавай аналогію як буквальний факт.";
  }

  if (kind === "myths_vs_truth") {
    return "Додавай лише пари «Міф/Правда», які прямо випливають із фрагмента; не вигадуй тверджень.";
  }

  if (kind === "top_list") {
    return "Подавай 3-5 пунктів у multi-line форматі «Назва: пояснення»; працюй лише з фактами фрагмента і не вигадуй нові джерела.";
  }

  return "Залишайся в межах фрагмента без вигаданих фактів чи діагнозів.";
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
      return cloneBlockWithText(oldBlock, sanitizeReplacementText(getBlockText(block)));
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
    return { ...block, content: [createInlineText(plain)] };
  }

  if (block.type === "heading") {
    return { ...block, content: [createInlineText(plain)] };
  }

  if (block.type === "bullet_list") {
    return {
      ...block,
      items: splitListItemsForBlock(plain).map((item) => [createInlineText(item)])
    };
  }

  if (block.type === "ordered_list") {
    return {
      ...block,
      items: splitListItemsForBlock(plain).map((item) => [createInlineText(item)])
    };
  }

  return {
    id: block.id,
    type: "paragraph",
    content: [createInlineText(plain)]
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
      items: block.items.map((item) => [createInlineText(sanitizeListItemText(getInlineText(item)))])
    };
  }

  if (block.type === "ordered_list") {
    return {
      ...block,
      items: block.items.map((item) => [createInlineText(sanitizeListItemText(getInlineText(item)))])
    };
  }

  if (block.type === "callout") {
    return {
      ...block,
      title: [createInlineText(sanitizeReplacementText(getInlineText(block.title)))],
      body: block.body.map((part) => [createInlineText(sanitizeReplacementText(getInlineText(part)))])
    };
  }

  return block;
}

function sanitizeListItemText(value: string): string {
  return sanitizeReplacementText(value).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

function sanitizeReplacementText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectReplaceNoOpWarning(
  recommendationType: EditorialReviewRecommendationType,
  oldBlocks: Block[],
  newBlocks: Block[]
): { code: "no_op"; message: string; similarity: number } | null {
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

    const output = payload.output_text?.trim();

    if (!output) {
      throw new Error("OpenAI повернув порожню відповідь для proposal.");
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

function buildFallbackCalloutPrompt(kind: EditorialCalloutKind, fragment: string, recommendation: string): string {
  return [
    `Тип врізки: ${getEditorialCalloutKindLabel(kind)}.`,
    `Фрагмент: ${fragment}`,
    `Рекомендація: ${recommendation}`,
    "Поверни plain text без markdown, придатний для block editor."
  ].join("\n");
}

function buildFallbackImagePrompt(
  fragment: string,
  recommendation: string,
  visualIntent: EditorialVisualIntent,
  visualStyleGuide: string
): string {
  return [
    "Створи простий навчальний візуал українською мовою.",
    getVisualIntentPromptGuidance(visualIntent, fragment, recommendation),
    `Стиль: ${visualStyleGuide}`,
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
  fallback: { title: string; body: string; summary: string },
  calloutKind: EditorialCalloutKind
): { title: string; body: string; summary: string } {
  const parsedObject = parseLooseJsonObject(rawOutput);
  const objectTitle = parsedObject ? pickString(parsedObject, ["title", "heading", "calloutTitle", "header"]) : null;
  const objectBody = parsedObject ? pickString(parsedObject, ["body", "text", "draft", "content", "calloutText"]) : null;
  const objectSummary = parsedObject ? pickString(parsedObject, ["summary", "why", "purpose", "rationale"]) : null;

  const fallbackTitleValue = sanitizeCalloutTitle(fallback.title);
  const fallbackBodyValue = normalizeCalloutBodyByKind(fallback.body, calloutKind);
  const fallbackSummaryValue = sanitizeCalloutText(fallback.summary) || "Коротко поясни, чому ця врізка потрібна саме тут.";

  if (objectTitle || objectBody || objectSummary) {
    return {
      title: sanitizeCalloutTitle(objectTitle ?? fallbackTitleValue),
      body: normalizeCalloutBodyByKind(objectBody ?? fallbackBodyValue, calloutKind) || fallbackBodyValue,
      summary: sanitizeCalloutText(objectSummary ?? fallbackSummaryValue) || fallbackSummaryValue
    };
  }

  const plain = sanitizeCalloutText(rawOutput);
  const fromLabels = parseCalloutDraftFromLabels(plain);

  return {
    title: sanitizeCalloutTitle(fromLabels.title ?? fallbackTitleValue),
    body: normalizeCalloutBodyByKind(fromLabels.body ?? fallbackBodyValue, calloutKind) || fallbackBodyValue,
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

function parseSubsectionDraftOutput(
  rawOutput: string,
  fallback: { title: string; lead: string; summary: string }
): { title: string; lead: string; summary: string } {
  const parsedObject = parseLooseJsonObject(rawOutput);
  const objectTitle = parsedObject ? pickString(parsedObject, ["title", "heading", "subheading"]) : null;
  const objectLead = parsedObject ? pickString(parsedObject, ["lead", "intro", "body", "text"]) : null;
  const objectSummary = parsedObject ? pickString(parsedObject, ["summary", "why", "purpose", "rationale"]) : null;

  const fallbackTitleValue = sanitizeCalloutTitle(fallback.title);
  const fallbackLeadValue = sanitizeCalloutText(fallback.lead);
  const fallbackSummaryValue = sanitizeCalloutText(fallback.summary) || "Пояснює, чому цей підзаголовок потрібен у цьому місці.";

  if (objectTitle || objectLead || objectSummary) {
    return {
      title: sanitizeCalloutTitle(objectTitle ?? fallbackTitleValue),
      lead: sanitizeCalloutText(objectLead ?? fallbackLeadValue),
      summary: sanitizeCalloutText(objectSummary ?? fallbackSummaryValue) || fallbackSummaryValue
    };
  }

  const plain = sanitizeCalloutText(rawOutput);
  const lines = plain.split("\n").map((line) => line.trim()).filter(Boolean);
  const title = lines[0] ?? fallbackTitleValue;
  const lead = lines.slice(1).join(" ").trim();

  return {
    title: sanitizeCalloutTitle(title || fallbackTitleValue),
    lead: sanitizeCalloutText(lead || fallbackLeadValue),
    summary: fallbackSummaryValue
  };
}

function parseSubsectionDraftFromRecommendation(value: string): { title: string; lead: string; summary: string } | null {
  const normalized = sanitizePromptInput(value, 6000);

  if (!normalized) {
    return null;
  }

  const titleMatch = /(?:^|\n|\s)(?:підзаголовок|заголовок)\s*:\s*(.+?)(?=(?:\n|\s)+(?:текст|рамка)\s*:|$)/i.exec(normalized);
  const leadMatch = /(?:^|\n|\s)(?:текст|рамка)\s*:\s*([\s\S]+)$/i.exec(normalized);

  if (!titleMatch?.[1] || !leadMatch?.[1]) {
    return null;
  }

  const title = sanitizeCalloutTitle(titleMatch[1]);
  const lead = sanitizeCalloutText(leadMatch[1]).slice(0, 1800);

  if (!title || !lead) {
    return null;
  }

  return {
    title,
    lead,
    summary: "Сформовано з явної інструкції редактора без додаткової генерації."
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
  const plain = sanitizeCalloutText(value).split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return plain.slice(0, 140);
}

function sanitizeImageCaption(value: string): string {
  return sanitizeCalloutText(value).replace(/\s+/g, " ").trim().slice(0, 220);
}

function sanitizeImageAlt(value: string): string {
  return sanitizeCalloutText(value).replace(/\s+/g, " ").trim().slice(0, 140);
}

function sanitizeCalloutText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeCalloutBodyByKind(value: string, calloutKind: EditorialCalloutKind): string {
  const plain = sanitizeCalloutText(value);

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
    .replace(/[.,;:!?]+$/g, "")
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
