import type { Block, EditorDocument, InlineNode } from "../editor/document-model.ts";
import { cloneBlock, getBlock, getBlockText, selectedBlocksToPromptText } from "../editor/document-model.ts";
import {
  createPatchId,
  normalizePatchOperationsResult,
  type PatchOperation,
  type PatchOperationType,
  type PatchRequest,
  type PatchResponse
} from "../editor/patch-contract.ts";
import {
  appendBulletListPunctuationRule,
  buildOpenAiRequestModelFields,
  resolveModelProfile,
  withGeminiThinkingConfig
} from "../editor/settings.ts";
import { readServerEnvValue } from "./env.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import {
  buildGeminiPatchSystemPrompt,
  buildGeminiPatchUserPrompt,
  buildPatchSystemPrompt,
  buildPatchUserPrompt,
  getPatchUserPromptLabels
} from "../i18n/server-prompts/patch.ts";
import { getReviewActionErrors } from "../i18n/server-prompts/review-action.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const requestTimeoutMs = 60000;
const anthropicVersion = "2023-06-01";

const fallbackGlossary: Array<{
  pattern: RegExp;
  replacement: string;
  type: PatchOperationType;
  reason: string;
}> = [
  { pattern: /серцево-судинна система/gi, replacement: "система серця і судин", type: "terminology", reason: "Спростив термін для читача." },
  { pattern: /безперервно/gi, replacement: "постійно", type: "clarity", reason: "Замінив слово на простіше." },
  { pattern: /перелік факторів ризику/gi, replacement: "список чинників ризику", type: "clarity", reason: "Полегшив конструкцію." },
  { pattern: /абдомінальне ожиріння/gi, replacement: "жир навколо живота", type: "terminology", reason: "Пояснив медичний термін." },
  { pattern: /хронічне запалення/gi, replacement: "тривале запалення", type: "terminology", reason: "Зробив термін зрозумілішим." }
];

const preserveListStructurePatterns = /(спис|перел(ік|іч)|bullet|таблиц|table|скорот|стисл|ущільн|корот)/i;

const openAiSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          blockIds: {
            type: "array",
            items: { type: "string" }
          },
          newBlocks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                type: {
                  type: "string",
                  enum: ["paragraph", "heading", "bullet_list", "ordered_list", "image", "callout", "divider", "table"]
                },
                level: { type: "integer", enum: [1, 2, 3] },
                content: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      text: { type: "string" },
                      bold: { type: "boolean" },
                      italic: { type: "boolean" },
                      link: { type: "string" }
                    },
                    required: ["text"]
                  }
                },
                items: {
                  type: "array",
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        text: { type: "string" },
                        bold: { type: "boolean" },
                        italic: { type: "boolean" },
                        link: { type: "string" }
                      },
                      required: ["text"]
                    }
                  }
                },
                assetId: { type: "string" },
                alt: { type: "string" },
                caption: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      text: { type: "string" },
                      bold: { type: "boolean" },
                      italic: { type: "boolean" },
                      link: { type: "string" }
                    },
                    required: ["text"]
                  }
                },
                kind: { type: "string" },
                title: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      text: { type: "string" },
                      bold: { type: "boolean" },
                      italic: { type: "boolean" },
                      link: { type: "string" }
                    },
                    required: ["text"]
                  }
                },
                body: {
                  type: "array",
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        text: { type: "string" },
                        bold: { type: "boolean" },
                        italic: { type: "boolean" },
                        link: { type: "string" }
                      },
                      required: ["text"]
                    }
                  }
                },
                rows: {
                  type: "array",
                  items: {
                    type: "array",
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          text: { type: "string" },
                          bold: { type: "boolean" },
                          italic: { type: "boolean" },
                          link: { type: "string" }
                        },
                        required: ["text"]
                      }
                    }
                  }
                }
              },
              required: ["type"]
            }
          },
          reason: { type: "string" },
          type: { type: "string", enum: ["clarity", "structure", "terminology", "source", "tone"] }
        },
        required: ["blockIds", "newBlocks", "reason", "type"]
      }
    }
  },
  required: ["operations"]
} as const;

const geminiSchema = {
  type: "OBJECT",
  properties: {
    operations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          blockIds: { type: "ARRAY", items: { type: "STRING" } },
          replacements: { type: "ARRAY", items: { type: "STRING" } },
          reason: { type: "STRING" },
          type: { type: "STRING", enum: ["clarity", "structure", "terminology", "source", "tone"] }
        },
        required: ["blockIds", "replacements", "reason", "type"]
      }
    }
  },
  required: ["operations"]
} as const;

type FetchLike = typeof fetch;
type ProviderGenerationResult = {
  operations: PatchOperation[];
  droppedOperationCount: number;
  providerUsed: string;
  rawOutput?: string;
};

type ProviderTextResult = {
  text: string;
  rawResponse: string;
};

class ProviderRequestError extends Error {
  rawResponse?: string;

  constructor(message: string, rawResponse?: string) {
    super(message);
    this.name = "ProviderRequestError";
    this.rawResponse = rawResponse;
  }
}

export interface GeneratePatchResponseOptions {
  fetchImpl?: FetchLike;
  now?: () => string;
  readEnvValue?: (key: string) => string | null;
}

export async function generatePatchResponse(
  patchRequest: PatchRequest,
  options: GeneratePatchResponseOptions = {}
): Promise<PatchResponse> {
  const requestId = createPatchId("request");
  const targetBlocks = patchRequest.targetBlockIds
    .map((blockId) => getBlock(patchRequest.document, blockId))
    .filter((block): block is Block => Boolean(block));
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const locale: AppLocale = patchRequest.locale ?? "uk";
  const promptLabels = getPatchUserPromptLabels(locale);
  const actionErrors = getReviewActionErrors(locale);

  if (targetBlocks.length === 0) {
    return buildPatchResponse({
      requestId,
      providerUsed: "invalid-selection",
      requestedProvider: patchRequest.provider,
      requestedModelId: patchRequest.modelId,
      mode: patchRequest.mode,
      targetBlockCount: 0,
      operations: [],
      droppedOperationCount: 0,
      usedFallback: false,
      error: promptLabels.emptySelection,
      generatedAt: now()
    });
  }

  const apiKey = patchRequest.apiKey ?? resolveProviderApiKey(patchRequest.provider, readEnvValue);

  if (!apiKey) {
    return buildPatchErrorResponse({
      requestId,
      requestedProvider: patchRequest.provider,
      requestedModelId: patchRequest.modelId,
      mode: patchRequest.mode,
      targetBlockCount: targetBlocks.length,
      providerUsed: patchRequest.provider,
      error: actionErrors.missingApiKey(providerDisplayName(patchRequest.provider)),
      generatedAt: now()
    });
  }

  try {
    const result = await createProviderOperations(patchRequest, apiKey, fetchImpl);

    if (result.operations.length === 0 && result.droppedOperationCount > 0) {
      return buildPatchErrorResponse({
        requestId,
        requestedProvider: patchRequest.provider,
        requestedModelId: patchRequest.modelId,
        mode: patchRequest.mode,
        targetBlockCount: targetBlocks.length,
        providerUsed: result.providerUsed,
        error: promptLabels.invalidProvider,
        generatedAt: now(),
        rawOutput: result.rawOutput
      });
    }

    return buildPatchResponse({
      requestId,
      providerUsed: result.providerUsed,
      requestedProvider: patchRequest.provider,
      requestedModelId: patchRequest.modelId,
      mode: patchRequest.mode,
      targetBlockCount: targetBlocks.length,
      operations: result.operations,
      droppedOperationCount: result.droppedOperationCount,
      usedFallback: false,
      error: result.droppedOperationCount > 0 ? promptLabels.droppedOps : undefined,
      generatedAt: now(),
      rawOutput: result.rawOutput
    });
  } catch (error) {
    return buildPatchErrorResponse({
      requestId,
      requestedProvider: patchRequest.provider,
      requestedModelId: patchRequest.modelId,
      mode: patchRequest.mode,
      targetBlockCount: targetBlocks.length,
      providerUsed: patchRequest.provider,
      error: formatProviderErrorMessage(patchRequest.provider, error, locale),
      generatedAt: now(),
      rawError: formatRawError(error)
    });
  }
}

export function resolveProviderApiKey(provider: string, readEnvValue: (key: string) => string | null): string | null {
  const envKey = provider === "gemini" ? "GEMINI_API_KEY" : provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  return readEnvValue(envKey);
}

export function buildPatchResponse(input: {
  requestId: string;
  providerUsed: string;
  requestedProvider: string;
  requestedModelId: string;
  mode: PatchRequest["mode"];
  targetBlockCount: number;
  operations: PatchOperation[];
  droppedOperationCount: number;
  usedFallback: boolean;
  generatedAt: string;
  error?: string;
  rawOutput?: string;
  rawError?: string;
}): PatchResponse {
  return {
    operations: input.operations,
    providerUsed: input.providerUsed,
    usedFallback: input.usedFallback,
    error: input.error,
    diagnostics: {
      requestId: input.requestId,
      requestedProvider: input.requestedProvider,
      requestedModelId: input.requestedModelId,
      appliedMode: input.mode,
      targetBlockCount: input.targetBlockCount,
      returnedOperationCount: input.operations.length,
      droppedOperationCount: input.droppedOperationCount,
      generatedAt: input.generatedAt,
      rawOutput: input.rawOutput,
      rawError: input.rawError
    }
  };
}

export function createFallbackOperations(request: PatchRequest): PatchOperation[] {
  const targetBlocks = request.targetBlockIds
    .map((blockId) => getBlock(request.document, blockId))
    .filter((block): block is Block => Boolean(block));
  const oldBlocks = targetBlocks.map((block) => cloneBlock(block));
  const rewrittenBlocks = targetBlocks.map((block) => rewriteBlockFallback(block, request.prompt));
  const type = inferCombinedType(oldBlocks);

  return [
    {
      id: createPatchId("fallback"),
      op: "replace_blocks",
      blockIds: request.targetBlockIds,
      oldBlocks,
      newBlocks: rewrittenBlocks,
      reason: request.prompt?.trim() ? "Підготував локальну чернетку за вашим запитом." : inferCombinedReason(oldBlocks),
      type
    }
  ];
}

async function createProviderOperations(request: PatchRequest, apiKey: string, fetchImpl: FetchLike): Promise<ProviderGenerationResult> {
  if (request.provider === "gemini") {
    return createGeminiOperations(request, apiKey, fetchImpl);
  }

  if (request.provider === "anthropic") {
    return createAnthropicOperations(request, apiKey, fetchImpl);
  }

  return createOpenAiOperations(request, apiKey, fetchImpl);
}

async function createOpenAiOperations(request: PatchRequest, apiKey: string, fetchImpl: FetchLike): Promise<ProviderGenerationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const profile = resolveModelProfile("openai", request.modelId);
    const response = await fetchImpl(openAiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        ...buildOpenAiRequestModelFields(profile),
        instructions: buildSystemPrompt(request),
        input: buildUserPrompt(request),
        text: {
          format: {
            type: "json_schema",
            name: "patch_operations",
            strict: true,
            schema: openAiSchema
          }
        }
      }),
      signal: controller.signal
    });

    const providerResult = await readProviderText(response);
    const parsed = parsePatchOperations(providerResult.text);

    const normalized = normalizePatchOperationsResult(request.document, request.targetBlockIds, parsed.operations);

    return {
      operations: normalized.operations,
      droppedOperationCount: normalized.droppedCount,
      providerUsed: "openai",
      rawOutput: providerResult.text
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function createGeminiOperations(request: PatchRequest, apiKey: string, fetchImpl: FetchLike): Promise<ProviderGenerationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const profile = resolveModelProfile("gemini", request.modelId);
    const response = await fetchImpl(`${geminiBaseUrl}/${profile.apiModelId}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildGeminiSystemPrompt(request) }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildGeminiUserPrompt(request) }]
          }
        ],
        generationConfig: withGeminiThinkingConfig(
          {
            responseMimeType: "application/json",
            responseSchema: geminiSchema
          },
          profile
        )
      }),
      signal: controller.signal
    });

    const providerResult = await readGeminiText(response);
    const parsed = parsePatchOperations(providerResult.text);
    const normalized = normalizePatchOperationsResult(request.document, request.targetBlockIds, parsed.operations);

    return {
      operations: normalized.operations,
      droppedOperationCount: normalized.droppedCount,
      providerUsed: "gemini",
      rawOutput: providerResult.text
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function createAnthropicOperations(request: PatchRequest, apiKey: string, fetchImpl: FetchLike): Promise<ProviderGenerationResult> {
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
        max_tokens: 2400,
        temperature: request.mode === "custom" ? 0.4 : 0.2,
        system: buildAnthropicSystemPrompt(request),
        messages: [{ role: "user", content: buildUserPrompt(request) }]
      }),
      signal: controller.signal
    });

    const providerResult = await readAnthropicText(response);
    const parsed = parsePatchOperations(providerResult.text);
    const normalized = normalizePatchOperationsResult(request.document, request.targetBlockIds, parsed.operations);

    return {
      operations: normalized.operations,
      droppedOperationCount: normalized.droppedCount,
      providerUsed: "anthropic",
      rawOutput: providerResult.text
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallbackPatchResponse(input: {
  requestId: string;
  requestedProvider: string;
  requestedModelId: string;
  mode: PatchRequest["mode"];
  targetBlockCount: number;
  providerUsed: string;
  error: string;
  generatedAt: string;
  rawOutput?: string;
  rawError?: string;
}): PatchResponse {
  return buildPatchResponse({
    requestId: input.requestId,
    providerUsed: input.providerUsed,
    requestedProvider: input.requestedProvider,
    requestedModelId: input.requestedModelId,
    mode: input.mode,
    targetBlockCount: input.targetBlockCount,
    operations: [],
    droppedOperationCount: 0,
    usedFallback: false,
    error: input.error,
    generatedAt: input.generatedAt,
    rawOutput: input.rawOutput,
    rawError: input.rawError
  });
}

function buildPatchErrorResponse(input: {
  requestId: string;
  requestedProvider: string;
  requestedModelId: string;
  mode: PatchRequest["mode"];
  targetBlockCount: number;
  providerUsed: string;
  error: string;
  generatedAt: string;
  rawOutput?: string;
  rawError?: string;
}): PatchResponse {
  return buildFallbackPatchResponse(input);
}

function rewriteBlockFallback(block: Block, prompt?: string): Block {
  if (block.type === "paragraph") {
    return {
      id: block.id,
      type: "paragraph",
      content: [createTextNode(rewriteTextFallback(getBlockText(block), prompt))]
    };
  }

  if (block.type === "heading") {
    return {
      id: block.id,
      type: "heading",
      level: block.level,
      content: [createTextNode(rewriteTextFallback(getBlockText(block), prompt))]
    };
  }

  if (block.type === "bullet_list") {
    if (shouldCollapseListFallback(prompt)) {
      return {
        id: block.id,
        type: "paragraph",
        content: [createTextNode(rewriteTextFallback(collapseListItemsToSentence(block.items), prompt))]
      };
    }

    return {
      id: block.id,
      type: "bullet_list",
      items: block.items.map((item) => [createTextNode(rewriteTextFallback(item.map((node) => node.text).join(""), prompt))])
    };
  }

  if (block.type === "ordered_list") {
    if (shouldCollapseListFallback(prompt)) {
      return {
        id: block.id,
        type: "paragraph",
        content: [createTextNode(rewriteTextFallback(collapseListItemsToSentence(block.items), prompt))]
      };
    }

    return {
      id: block.id,
      type: "ordered_list",
      items: block.items.map((item) => [createTextNode(rewriteTextFallback(item.map((node) => node.text).join(""), prompt))])
    };
  }

  if (block.type === "callout") {
    return {
      id: block.id,
      type: "callout",
      kind: block.kind,
      depth: block.depth ?? "brief",
      title: [createTextNode(rewriteTextFallback(block.title.map((node) => node.text).join(""), prompt))],
      body: block.body.map((part) => [createTextNode(rewriteTextFallback(part.map((node) => node.text).join(""), prompt))])
    };
  }

  if (block.type === "table") {
    return {
      id: block.id,
      type: "table",
      rows: block.rows.map((row) => row.map((cell) => [createTextNode(rewriteTextFallback(cell.map((node) => node.text).join(""), prompt))]))
    };
  }

  if (block.type === "image" && block.caption) {
    return {
      id: block.id,
      type: "image",
      assetId: block.assetId,
      alt: block.alt,
      caption: [createTextNode(rewriteTextFallback(block.caption.map((node) => node.text).join(""), prompt))]
    };
  }

  return cloneBlock(block);
}

function rewriteTextFallback(text: string, prompt?: string): string {
  let next = text;

  for (const entry of fallbackGlossary) {
    next = next.replace(entry.pattern, entry.replacement);
  }

  if (prompt?.trim()) {
    if (prompt.toLowerCase().includes("спис")) {
      return next
        .split(/[.;]\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => `• ${part}`)
        .join("\n");
    }

    if (prompt.toLowerCase().includes("корот")) {
      const sentences = next.split(/(?<=[.!?])\s+/).filter(Boolean);
      return sentences.slice(0, Math.max(1, Math.ceil(sentences.length * 0.7))).join(" ");
    }
  }

  return next;
}

function shouldCollapseListFallback(prompt?: string): boolean {
  const trimmedPrompt = prompt?.trim();

  if (!trimmedPrompt) {
    return true;
  }

  return !preserveListStructurePatterns.test(trimmedPrompt);
}

function collapseListItemsToSentence(items: InlineNode[][]): string {
  const parts = items
    .map((item) => item.map((node) => node.text).join("").trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return `${parts[0]}.`;
  }

  if (parts.length === 2) {
    return `${parts[0]} та ${parts[1]}.`;
  }

  return `${parts.slice(0, -1).join(", ")} та ${parts.at(-1)}.`;
}

function inferCombinedReason(blocks: Block[]): string {
  const text = blocks.map((block) => getBlockText(block)).join(" ");
  const match = fallbackGlossary.find((entry) => entry.pattern.test(text));
  return match?.reason ?? "Підготував локальну зрозумілішу версію фрагмента.";
}

function inferCombinedType(blocks: Block[]): PatchOperationType {
  const text = blocks.map((block) => getBlockText(block)).join(" ");
  const match = fallbackGlossary.find((entry) => entry.pattern.test(text));
  return match?.type ?? "clarity";
}

function createTextNode(text: string): InlineNode {
  return { text };
}

function buildSystemPrompt(request: PatchRequest): string {
  return buildPatchSystemPrompt(request.locale ?? "uk", request.basePrompt);
}

function buildGeminiSystemPrompt(request: PatchRequest): string {
  return buildGeminiPatchSystemPrompt(request.locale ?? "uk", request.basePrompt);
}

function buildAnthropicSystemPrompt(request: PatchRequest): string {
  const locale = request.locale ?? "uk";
  const suffix =
    locale === "en"
      ? ' Return only a JSON object {"operations":[...]} with no explanations outside JSON. If the prompt allows **bold** in text fields, preserve it; do not add other markdown.'
      : ' Поверни лише JSON-об\'єкт {"operations":[...]} без пояснень поза JSON. Якщо prompt дозволяє **жирний** у текстових полях, зберігай його; інший markdown не додавай.';
  return `${buildPatchSystemPrompt(locale, request.basePrompt)}${suffix}`;
}

function buildUserPrompt(request: PatchRequest): string {
  const locale = request.locale ?? "uk";
  const context = buildNeighborContext(request.document, request.targetBlockIds);
  const targetText = selectedBlocksToPromptText(request.document, request.targetBlockIds);
  return buildPatchUserPrompt(locale, {
    mode: request.mode,
    prompt: request.prompt,
    targetBlockIds: request.targetBlockIds,
    context,
    targetText
  });
}

function buildGeminiUserPrompt(request: PatchRequest): string {
  const locale = request.locale ?? "uk";
  const context = buildNeighborContext(request.document, request.targetBlockIds);
  const targetText = selectedBlocksToPromptText(request.document, request.targetBlockIds);
  return buildGeminiPatchUserPrompt(locale, {
    mode: request.mode,
    prompt: request.prompt,
    targetBlockIds: request.targetBlockIds,
    context,
    targetText
  });
}

function buildNeighborContext(document: EditorDocument, targetBlockIds: string[]): string {
  const blocks = document.blocks;
  const startIndex = blocks.findIndex((block) => block.id === targetBlockIds[0]);
  const endIndex = blocks.findIndex((block) => block.id === targetBlockIds[targetBlockIds.length - 1]);
  const contextBlocks = blocks.slice(Math.max(0, startIndex - 1), Math.min(blocks.length, endIndex + 2));
  return contextBlocks.map((block) => `${block.id}: ${getBlockText(block)}`).join("\n");
}

async function readProviderText(response: Response): Promise<ProviderTextResult> {
  const rawResponse = await response.text();
  const payload = parseJsonObject(rawResponse) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new ProviderRequestError(payload?.error?.message || "OpenAI недоступний.", rawResponse);
  }

  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return { text: payload.output_text, rawResponse };
  }

  const content = payload?.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n").trim();

  if (!content) {
    throw new ProviderRequestError("OpenAI не повернув коректний JSON.", rawResponse);
  }

  return { text: content, rawResponse };
}

async function readGeminiText(response: Response): Promise<ProviderTextResult> {
  const rawResponse = await response.text();
  const payload = parseJsonObject(rawResponse) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new ProviderRequestError(payload?.error?.message || "Gemini недоступний.", rawResponse);
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();

  if (!text) {
    throw new ProviderRequestError("Gemini не повернув коректний JSON.", rawResponse);
  }

  return { text, rawResponse };
}

async function readAnthropicText(response: Response): Promise<ProviderTextResult> {
  const rawResponse = await response.text();
  const payload = parseJsonObject(rawResponse) as {
    content?: Array<{ text?: string }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new ProviderRequestError(payload?.error?.message || "Anthropic недоступний.", rawResponse);
  }

  const text = payload?.content?.map((part) => part.text ?? "").join("\n").trim();

  if (!text) {
    throw new ProviderRequestError("Anthropic не повернув коректний JSON.", rawResponse);
  }

  return { text, rawResponse };
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function formatRawError(error: unknown): string | undefined {
  if (error instanceof ProviderRequestError) {
    return error.rawResponse || `${error.name}: ${error.message}`;
  }

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

function formatProviderErrorMessage(provider: string, error: unknown, locale: AppLocale): string {
  const errors = getReviewActionErrors(locale);
  const providerName = providerDisplayName(provider);

  if (error instanceof Error && error.name === "AbortError") {
    return errors.providerTimeout(providerName, Math.round(requestTimeoutMs / 1000));
  }

  if (
    error instanceof TypeError ||
    (error instanceof Error && /fetch failed|network|econnreset|enotfound|eai_again/i.test(error.message))
  ) {
    return errors.providerNetworkError(providerName);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return errors.providerUnavailable(providerName);
}

function parsePatchOperations(content: string): { operations: unknown } {
  try {
    return JSON.parse(content) as { operations: unknown };
  } catch {
    const match = /\{[\s\S]*\}/.exec(content);

    if (!match) {
      return { operations: [] };
    }

    return JSON.parse(match[0]) as { operations: unknown };
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
