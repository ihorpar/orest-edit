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
import { readServerEnvValue } from "./env.ts";

const openAiEndpoint = "https://api.openai.com/v1/responses";
const anthropicEndpoint = "https://api.anthropic.com/v1/messages";
const geminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
const requestTimeoutMs = 30000;
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

const openAiSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          blockIds: {
            type: "array",
            items: { type: "string" }
          },
          newBlocks: {
            type: "array",
            items: { type: "object" }
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
          newBlocks: { type: "ARRAY", items: { type: "OBJECT" } },
          reason: { type: "STRING" },
          type: { type: "STRING" }
        },
        required: ["blockIds", "newBlocks", "reason", "type"]
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
};

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
      error: "Виділення порожнє. Оберіть один або кілька абзаців.",
      generatedAt: now()
    });
  }

  const apiKey = patchRequest.apiKey ?? resolveProviderApiKey(patchRequest.provider, readEnvValue);

  if (!apiKey) {
    return buildFallbackPatchResponse({
      patchRequest,
      requestId,
      targetBlockCount: targetBlocks.length,
      error: `Немає ${providerDisplayName(patchRequest.provider)} API key у формі або .env, тому показано локальну fallback-правку.`,
      generatedAt: now()
    });
  }

  try {
    const result = await createProviderOperations(patchRequest, apiKey, fetchImpl);

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
      error: result.droppedOperationCount > 0 ? `Відкинуто ${result.droppedOperationCount} невалідні правки від провайдера.` : undefined,
      generatedAt: now()
    });
  } catch (error) {
    return buildFallbackPatchResponse({
      patchRequest,
      requestId,
      targetBlockCount: targetBlocks.length,
      error: error instanceof Error ? error.message : `${providerDisplayName(patchRequest.provider)} недоступний, тому показано локальну fallback-правку.`,
      generatedAt: now()
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
      generatedAt: input.generatedAt
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
    const response = await fetchImpl(openAiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: request.modelId,
        temperature: request.mode === "custom" ? 0.4 : 0.2,
        instructions: buildSystemPrompt(request.basePrompt),
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

    const rawOutput = await readProviderText(response);
    const parsed = parsePatchOperations(rawOutput);

    const normalized = normalizePatchOperationsResult(request.document, request.targetBlockIds, parsed.operations);

    return {
      operations: normalized.operations,
      droppedOperationCount: normalized.droppedCount,
      providerUsed: "openai"
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function createGeminiOperations(request: PatchRequest, apiKey: string, fetchImpl: FetchLike): Promise<ProviderGenerationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(`${geminiBaseUrl}/${request.modelId}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildSystemPrompt(request.basePrompt) }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildUserPrompt(request) }]
          }
        ],
        generationConfig: {
          temperature: request.mode === "custom" ? 0.4 : 0.2,
          responseMimeType: "application/json",
          responseSchema: geminiSchema
        }
      }),
      signal: controller.signal
    });

    const rawOutput = await readGeminiText(response);
    const parsed = parsePatchOperations(rawOutput);
    const normalized = normalizePatchOperationsResult(request.document, request.targetBlockIds, parsed.operations);

    return {
      operations: normalized.operations,
      droppedOperationCount: normalized.droppedCount,
      providerUsed: "gemini"
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
        system: `${buildSystemPrompt(request.basePrompt)} Поверни лише JSON-об'єкт {"operations":[...]} без markdown.`,
        messages: [{ role: "user", content: buildUserPrompt(request) }]
      }),
      signal: controller.signal
    });

    const rawOutput = await readAnthropicText(response);
    const parsed = parsePatchOperations(rawOutput);
    const normalized = normalizePatchOperationsResult(request.document, request.targetBlockIds, parsed.operations);

    return {
      operations: normalized.operations,
      droppedOperationCount: normalized.droppedCount,
      providerUsed: "anthropic"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallbackPatchResponse(input: {
  patchRequest: PatchRequest;
  requestId: string;
  targetBlockCount: number;
  error: string;
  generatedAt: string;
}): PatchResponse {
  return buildPatchResponse({
    requestId: input.requestId,
    providerUsed: `fallback:${input.patchRequest.provider}`,
    requestedProvider: input.patchRequest.provider,
    requestedModelId: input.patchRequest.modelId,
    mode: input.patchRequest.mode,
    targetBlockCount: input.targetBlockCount,
    operations: createFallbackOperations(input.patchRequest),
    droppedOperationCount: 0,
    usedFallback: true,
    error: input.error,
    generatedAt: input.generatedAt
  });
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
    return {
      id: block.id,
      type: "bullet_list",
      items: block.items.map((item) => [createTextNode(rewriteTextFallback(item.map((node) => node.text).join(""), prompt))])
    };
  }

  if (block.type === "ordered_list") {
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

function buildSystemPrompt(basePrompt?: string): string {
  return [
    basePrompt?.trim(),
    "Ти редагуєш український науково-популярний рукопис.",
    "Працюй тільки в межах виділених блоків.",
    "Поверни JSON з однією операцією replace_blocks.",
    "newBlocks має містити готові rich-text blocks без markdown-синтаксису."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildUserPrompt(request: PatchRequest): string {
  const targetText = selectedBlocksToPromptText(request.document, request.targetBlockIds);
  const context = buildNeighborContext(request.document, request.targetBlockIds);

  return [
    "Ось вибрані блоки для локальної правки.",
    request.mode === "custom" && request.prompt?.trim() ? `Додаткова інструкція: ${request.prompt.trim()}` : "Завдання: зроби текст яснішим і природнішим.",
    `targetBlockIds: ${JSON.stringify(request.targetBlockIds)}`,
    "Контекст поруч:",
    context,
    "Вибрані блоки:",
    targetText,
    'Поверни JSON: {"operations":[{"blockIds":[...],"newBlocks":[...],"reason":"...","type":"clarity"}]}'
  ].join("\n\n");
}

function buildNeighborContext(document: EditorDocument, targetBlockIds: string[]): string {
  const blocks = document.blocks;
  const startIndex = blocks.findIndex((block) => block.id === targetBlockIds[0]);
  const endIndex = blocks.findIndex((block) => block.id === targetBlockIds[targetBlockIds.length - 1]);
  const contextBlocks = blocks.slice(Math.max(0, startIndex - 1), Math.min(blocks.length, endIndex + 2));
  return contextBlocks.map((block) => `${block.id}: ${getBlockText(block)}`).join("\n");
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
