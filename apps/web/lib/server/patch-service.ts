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
import { appendBulletListPunctuationRule } from "../editor/settings.ts";
import { readServerEnvValue } from "./env.ts";

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

    if (result.operations.length === 0 && result.droppedOperationCount > 0) {
      return buildFallbackPatchResponse({
        patchRequest,
        requestId,
        targetBlockCount: targetBlocks.length,
        error: "Провайдер не повернув придатний diff, тому застосовано безпечну локальну правку.",
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
      error: result.droppedOperationCount > 0 ? `Частину відповіді провайдера відкинуто як невалідну.` : undefined,
      generatedAt: now(),
      rawOutput: result.rawOutput
    });
  } catch (error) {
    return buildFallbackPatchResponse({
      patchRequest,
      requestId,
      targetBlockCount: targetBlocks.length,
      error: formatProviderErrorMessage(patchRequest.provider, error),
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
    const response = await fetchImpl(`${geminiBaseUrl}/${request.modelId}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildGeminiSystemPrompt(request.basePrompt) }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildGeminiUserPrompt(request) }]
          }
        ],
        generationConfig: {
          temperature: request.mode === "custom" ? 0.25 : 0.15,
          responseMimeType: "application/json",
          responseSchema: geminiSchema
        }
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
        system: `${buildSystemPrompt(request.basePrompt)} Поверни лише JSON-об'єкт {"operations":[...]} без markdown.`,
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
  patchRequest: PatchRequest;
  requestId: string;
  targetBlockCount: number;
  error: string;
  generatedAt: string;
  rawOutput?: string;
  rawError?: string;
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
    generatedAt: input.generatedAt,
    rawOutput: input.rawOutput,
    rawError: input.rawError
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

function buildSystemPrompt(basePrompt?: string): string {
  return [
    appendBulletListPunctuationRule(basePrompt),
    "Ти редагуєш український науково-популярний рукопис.",
    "Працюй тільки в межах виділених блоків.",
    "Поверни JSON з однією операцією replace_blocks.",
    "newBlocks має містити готові rich-text blocks без markdown-синтаксису.",
    "Можна дуже ощадно використовувати bold:true для коротких змістових акцентів у ключових словах або коротких фразах.",
    "Не виділяй жирним цілі речення, абзаци або весь блок.",
    "Якщо редактор просить форму вірша, короткі рядки або строфи, дозволено повертати перенос рядка всередині одного текстового блока через символ \\n; не розбивай такий результат на кілька блоків без окремої вказівки.",
    "Роби відчутне переформулювання: міняй синтаксис і лексику, не повертай майже ідентичний текст."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildGeminiSystemPrompt(basePrompt?: string): string {
  return [
    appendBulletListPunctuationRule(basePrompt),
    "Ти редагуєш український науково-популярний рукопис.",
    "Працюй тільки в межах виділених блоків.",
    "Поверни JSON з однією операцією replace_blocks у масиві operations.",
    "Не повертай rich-text blocks, newBlocks, markdown, HTML або вкладений JSON усередині рядків.",
    "Поле operations[0].replacements має містити по одному plain-text replacement для кожного виділеного блока в тому самому порядку, що й targetBlockIds.",
    "У replacement strings дозволено рідкісний **жирний** для коротких змістових акцентів, але не для цілих речень або абзаців.",
    "Якщо редактор просить форму вірша, короткі рядки або строфи, дозволено повертати перенос рядка всередині одного replacement string через символ \\n; не розбивай такий результат на кілька blocks без окремої вказівки.",
    "Залишай відповідь українською мовою.",
    "Роби відчутне переформулювання: міняй синтаксис і лексику, не повертай майже ідентичний текст."
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
    "Критично: результат має помітно відрізнятися від оригіналу на рівні формулювань, але без вигаданих фактів.",
    `targetBlockIds: ${JSON.stringify(request.targetBlockIds)}`,
    "Контекст поруч:",
    context,
    "Вибрані блоки:",
    targetText,
    'Поверни JSON: {"operations":[{"blockIds":[...],"newBlocks":[...],"reason":"...","type":"clarity"}]}'
  ].join("\n\n");
}

function buildGeminiUserPrompt(request: PatchRequest): string {
  const targetText = selectedBlocksToPromptText(request.document, request.targetBlockIds);
  const context = buildNeighborContext(request.document, request.targetBlockIds);

  return [
    "Ось вибрані блоки для локальної правки.",
    request.mode === "custom" && request.prompt?.trim() ? `Додаткова інструкція: ${request.prompt.trim()}` : "Завдання: зроби текст яснішим і природнішим.",
    "Критично: результат має помітно відрізнятися від оригіналу на рівні формулювань, але без вигаданих фактів.",
    `targetBlockIds: ${JSON.stringify(request.targetBlockIds)}`,
    "Контекст поруч:",
    context,
    "Вибрані блоки:",
    targetText,
    "Формат відповіді:",
    '{"operations":[{"blockIds":["p1"],"replacements":["Переписаний текст для блока p1."],"reason":"Коротко поясни редакторську зміну.","type":"clarity"}]}',
    "Правила:",
    "- operations має містити рівно одну операцію.",
    "- replacements.length має дорівнювати кількості targetBlockIds.",
    "- Кожен елемент replacements є plain text для відповідного блока; дозволено лише рідкісний **жирний** для коротких змістових акцентів.",
    "- Якщо потрібні внутрішні рядки в межах одного блока, використовуй символ \\n всередині replacement string.",
    "- Не повертай ключ newBlocks."
  ].join("\n\n");
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

function formatProviderErrorMessage(provider: string, error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return `${providerDisplayName(provider)} перевищив таймаут ${Math.round(requestTimeoutMs / 1000)}с, тому показано локальну fallback-правку.`;
  }

  if (
    error instanceof TypeError ||
    (error instanceof Error && /fetch failed|network|econnreset|enotfound|eai_again/i.test(error.message))
  ) {
    return `${providerDisplayName(provider)} недоступний або мережа не відповідає, тому показано локальну fallback-правку.`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return `${providerDisplayName(provider)} недоступний, тому показано локальну fallback-правку.`;
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
