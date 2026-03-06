import {
  applyPatchOperations,
  clampSelection,
  createPatchId,
  getSelectedText,
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
const requestTimeoutMs = 20000;
const anthropicVersion = "2023-06-01";

const fallbackGlossary: Array<{
  pattern: RegExp;
  replacement: string;
  type: PatchOperationType;
  reason: string;
}> = [
  { pattern: /серцево-судинна система/gi, replacement: "система серця і судин", type: "terminology", reason: "Спростив термін для читача." },
  { pattern: /безперервно/gi, replacement: "постійно", type: "clarity", reason: "Замінив слово на простіше." },
  { pattern: /переносить/gi, replacement: "доставляє", type: "clarity", reason: "Зробив дієслово зрозумілішим." },
  { pattern: /гормональні сигнали/gi, replacement: "сигнали гормонів", type: "terminology", reason: "Спростив науковий термін." },
  { pattern: /перелік факторів ризику/gi, replacement: "список чинників ризику", type: "clarity", reason: "Полегшив складену конструкцію." },
  { pattern: /фактори ризику/gi, replacement: "чинники ризику", type: "terminology", reason: "Спростив термінологію." },
  { pattern: /абдомінальне ожиріння/gi, replacement: "жир навколо живота", type: "terminology", reason: "Пояснив медичний термін простіше." },
  { pattern: /хронічне запалення/gi, replacement: "тривале запалення", type: "terminology", reason: "Зробив термін зрозумілішим." },
  { pattern: /довгостроковий/gi, replacement: "тривалий", type: "clarity", reason: "Спростив прикметник." },
  { pattern: /серцево-судинних подій/gi, replacement: "подій із серцем і судинами", type: "terminology", reason: "Пояснив термін простішою мовою." }
];

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
          op: { type: "string", enum: ["replace", "insert", "delete"] },
          start: { type: "integer" },
          end: { type: "integer" },
          newText: { type: "string" },
          reason: { type: "string" },
          type: { type: "string", enum: ["clarity", "structure", "terminology", "source", "tone"] }
        },
        required: ["op", "start", "end", "newText", "reason", "type"]
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
          op: { type: "STRING" },
          start: { type: "INTEGER" },
          end: { type: "INTEGER" },
          newText: { type: "STRING" },
          reason: { type: "STRING" },
          type: { type: "STRING" }
        },
        required: ["op", "start", "end", "newText", "reason", "type"]
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
  const selection = clampSelection(patchRequest.text, patchRequest.selectionStart, patchRequest.selectionEnd);
  const requestId = createPatchId("request");
  const selectionLength = selection.end - selection.start;
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());

  if (selection.start === selection.end) {
    return buildPatchResponse({
      requestId,
      providerUsed: "invalid-selection",
      requestedProvider: patchRequest.provider,
      requestedModelId: patchRequest.modelId,
      mode: patchRequest.mode,
      selectionLength,
      operations: [],
      droppedOperationCount: 0,
      usedFallback: false,
      error: "Виділення порожнє. Оберіть фрагмент тексту.",
      generatedAt: now()
    });
  }

  const apiKey = patchRequest.apiKey ?? resolveProviderApiKey(patchRequest.provider, readEnvValue);

  if (!apiKey) {
    return buildFallbackPatchResponse({
      patchRequest,
      requestId,
      selectionLength,
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
      selectionLength,
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
      selectionLength,
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
  selectionLength: number;
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
      selectionLength: input.selectionLength,
      returnedOperationCount: input.operations.length,
      droppedOperationCount: input.droppedOperationCount,
      generatedAt: input.generatedAt
    }
  };
}

export function createFallbackOperations(request: PatchRequest): PatchOperation[] {
  const selection = clampSelection(request.text, request.selectionStart, request.selectionEnd);
  const selectedText = getSelectedText(request.text, selection);
  const matches = collectFallbackTermOperations(selectedText, selection.start);
  const rewrittenText = matches.length > 0 ? rewriteSelectionWithOperations(selectedText, selection.start, matches) : createFallbackRewrite(selectedText, request.prompt);

  return [
    {
      id: createPatchId("fallback"),
      op: "replace",
      start: selection.start,
      end: selection.end,
      oldText: selectedText,
      newText: rewrittenText,
      reason: inferCombinedReason(matches, request),
      type: inferCombinedType(matches, request)
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
  const selection = clampSelection(request.text, request.selectionStart, request.selectionEnd);
  const selectedText = getSelectedText(request.text, selection);
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
        input: buildUserPrompt(request, selectedText),
        text: {
          format: {
            type: "json_schema",
            name: "patch_operations",
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

    return buildNormalizedResult(request, selection, parseProviderOperations(readOpenAiContent(payload)), "openai");
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("OpenAI не відповів вчасно, тому показано локальну fallback-правку.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createGeminiOperations(request: PatchRequest, apiKey: string, fetchImpl: FetchLike): Promise<ProviderGenerationResult> {
  const selection = clampSelection(request.text, request.selectionStart, request.selectionEnd);
  const selectedText = getSelectedText(request.text, selection);
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
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${buildSystemPrompt(request.basePrompt)}\n\n${buildUserPrompt(request, selectedText)}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: request.mode === "custom" ? 0.4 : 0.2,
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

    return buildNormalizedResult(request, selection, parseProviderOperations(readGeminiContent(payload)), "gemini");
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Gemini не відповів вчасно, тому показано локальну fallback-правку.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createAnthropicOperations(request: PatchRequest, apiKey: string, fetchImpl: FetchLike): Promise<ProviderGenerationResult> {
  const selection = clampSelection(request.text, request.selectionStart, request.selectionEnd);
  const selectedText = getSelectedText(request.text, selection);
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
        temperature: request.mode === "custom" ? 0.4 : 0.2,
        system: `${buildSystemPrompt(request.basePrompt)} Поверни лише JSON-об'єкт {"operations":[...]} без markdown.`,
        messages: [
          {
            role: "user",
            content: buildUserPrompt(request, selectedText)
          }
        ]
      }),
      signal: controller.signal
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(readProviderErrorMessage(payload) ?? `Anthropic повернув статус ${response.status}.`);
    }

    return buildNormalizedResult(request, selection, parseProviderOperations(readAnthropicContent(payload)), "anthropic");
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Anthropic не відповів вчасно, тому показано локальну fallback-правку.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildNormalizedResult(
  request: PatchRequest,
  selection: { start: number; end: number },
  operations: unknown,
  providerUsed: string
): ProviderGenerationResult {
  const normalized = normalizePatchOperationsResult(request.text, selection, operations);

  if (normalized.operations.length === 0) {
    const repairedOperations = repairProviderOperations(operations, selection);

    if (repairedOperations) {
      const repairedNormalized = normalizePatchOperationsResult(request.text, selection, repairedOperations);

      if (repairedNormalized.operations.length > 0) {
        return {
          operations: [collapseOperationsToSingleRewrite(request, selection, repairedNormalized.operations)],
          droppedOperationCount: repairedNormalized.droppedCount,
          providerUsed
        };
      }
    }
  }

  if (normalized.operations.length === 0) {
    throw new Error(`${providerDisplayName(providerUsed)} повернув порожні або невалідні локальні правки.`);
  }

  return {
    operations: [collapseOperationsToSingleRewrite(request, selection, normalized.operations)],
    droppedOperationCount: normalized.droppedCount,
    providerUsed
  };
}

function buildFallbackPatchResponse(input: {
  patchRequest: PatchRequest;
  requestId: string;
  selectionLength: number;
  error: string;
  generatedAt: string;
}): PatchResponse {
  return buildPatchResponse({
    requestId: input.requestId,
    providerUsed: input.patchRequest.provider,
    requestedProvider: input.patchRequest.provider,
    requestedModelId: input.patchRequest.modelId,
    mode: input.patchRequest.mode,
    selectionLength: input.selectionLength,
    operations: createFallbackOperations(input.patchRequest),
    droppedOperationCount: 0,
    usedFallback: true,
    error: input.error,
    generatedAt: input.generatedAt
  });
}

export function buildSystemPrompt(basePrompt?: string): string {
  return [
    basePrompt ?? "Спрости складну наукову мову до зрозумілої української.",
    "Ти допомагаєш книжковому редактору, а не лікарю.",
    "Працюй лише в межах виділеного фрагмента. Не переписуй увесь розділ.",
    "Поверни рівно одну локальну правку.",
    "Це має бути одна операція replace, яка охоплює весь виділений фрагмент.",
    "Кожна операція повинна містити op, start, end, newText, reason і type.",
    "start та end мають бути абсолютними індексами в межах виділення.",
    "reason пиши коротко, українською, не більше 12 слів.",
    "Дозволені type: clarity, structure, terminology, source, tone.",
    "Дозволені op: replace, insert, delete.",
    "Не дроби відповідь на кілька правок."
  ].join(" ");
}

export function buildUserPrompt(request: PatchRequest, selectedText: string): string {
  const task = request.mode === "custom" && request.prompt ? request.prompt : "Спрости виділений фрагмент без втрати змісту.";

  return [
    `Завдання: ${task}`,
    `Абсолютне виділення: ${request.selectionStart}-${request.selectionEnd}`,
    `Виділений фрагмент: ${selectedText}`,
    "Повний текст нижче потрібен лише для контексту.",
    request.text
  ].join("\n\n");
}

function parseProviderOperations(content: string): unknown {
  const parsed = JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
  return parsed.operations;
}

function readProviderErrorMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;

  if (!error || typeof error !== "object") {
    return null;
  }

  return typeof (error as Record<string, unknown>).message === "string" ? ((error as Record<string, unknown>).message as string) : null;
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

function readGeminiErrorMessage(payload: Record<string, unknown>): string | null {
  const error = payload.error;

  if (!error || typeof error !== "object") {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : null;
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
    throw new Error("Провайдер не повернув JSON-об'єкт із правками.");
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function repairProviderOperations(operations: unknown, selection: { start: number; end: number }): unknown[] | null {
  if (!Array.isArray(operations)) {
    return null;
  }

  const selectionLength = selection.end - selection.start;
  let changed = false;

  const repaired = operations.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return candidate;
    }

    const record = { ...(candidate as Record<string, unknown>) };
    const start = coerceIndex(record.start);
    const end = coerceIndex(record.end);

    if (start !== record.start && start !== null) {
      record.start = start;
      changed = true;
    }

    if (end !== record.end && end !== null) {
      record.end = end;
      changed = true;
    }

    if (typeof record.op === "string") {
      const normalizedOp = record.op.trim().toLowerCase();

      if (normalizedOp !== record.op) {
        record.op = normalizedOp;
        changed = true;
      }
    }

    if (typeof record.newText !== "string") {
      const replacement = typeof record.replacement === "string" ? record.replacement : typeof record.text === "string" ? record.text : null;

      if (replacement !== null) {
        record.newText = replacement;
        changed = true;
      }
    }

    if (typeof record.reason !== "string" && typeof record.comment === "string") {
      record.reason = record.comment;
      changed = true;
    }

    if (typeof record.type !== "string" && typeof record.category === "string") {
      record.type = record.category;
      changed = true;
    }

    if (typeof record.start === "number" && typeof record.end === "number") {
      const appearsRelative =
        record.start >= 0 &&
        record.end >= record.start &&
        record.end <= selectionLength &&
        (record.start < selection.start || record.end > selection.end);

      if (appearsRelative) {
        record.start = record.start + selection.start;
        record.end = record.end + selection.start;
        changed = true;
      }
    }

    return record;
  });

  return changed ? repaired : null;
}

function collapseOperationsToSingleRewrite(
  request: PatchRequest,
  selection: { start: number; end: number },
  operations: PatchOperation[]
): PatchOperation {
  const selectedText = getSelectedText(request.text, selection);
  const rewrittenText =
    operations.length === 1 && operations[0]?.op === "replace" && operations[0].start === selection.start && operations[0].end === selection.end
      ? (operations[0].newText ?? selectedText)
      : rewriteSelectionWithOperations(selectedText, selection.start, operations);

  return {
    id: operations[0]?.id ?? createPatchId("provider"),
    op: "replace",
    start: selection.start,
    end: selection.end,
    oldText: selectedText,
    newText: rewrittenText,
    reason: inferCombinedReason(operations, request),
    type: inferCombinedType(operations, request)
  };
}

function rewriteSelectionWithOperations(selectedText: string, absoluteSelectionStart: number, operations: PatchOperation[]): string {
  const localOperations = operations.map((operation) => ({
    ...operation,
    start: operation.start - absoluteSelectionStart,
    end: operation.end - absoluteSelectionStart
  }));

  return applyPatchOperations(selectedText, localOperations);
}

function coerceIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }

  return Number.parseInt(trimmed, 10);
}

function collectFallbackTermOperations(selectedText: string, absoluteStart: number): PatchOperation[] {
  const operations: PatchOperation[] = [];

  for (const entry of fallbackGlossary) {
    const regex = new RegExp(entry.pattern.source, entry.pattern.flags);
    let match: RegExpExecArray | null = regex.exec(selectedText);

    while (match) {
      const start = absoluteStart + match.index;
      const end = start + match[0].length;

      operations.push({
        id: createPatchId("fallback"),
        op: "replace",
        start,
        end,
        oldText: match[0],
        newText: entry.replacement,
        reason: entry.reason,
        type: entry.type
      });

      match = regex.exec(selectedText);
    }
  }

  return operations
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .filter((operation, index, items) => {
      const previous = items[index - 1];
      return !previous || previous.end <= operation.start;
    });
}

function createFallbackRewrite(selectedText: string, prompt?: string): string {
  const original = selectedText.replace(/\s+/g, " ").trim();
  let rewritten = original;
  const loweredPrompt = (prompt ?? "").toLowerCase();

  if (/(поясн|термін|читач)/i.test(loweredPrompt)) {
    rewritten = rewritten.replace(/\bLDL\b/g, '"поганий" холестерин LDL');
    rewritten = rewritten.replace(/\bHDL\b/g, '"добрий" холестерин HDL');
  }

  if (/(скорот|коротш)/i.test(loweredPrompt)) {
    rewritten = rewritten.replace(/\bсаме\b/gi, "");
    rewritten = rewritten.replace(/\s{2,}/g, " ");
  }

  rewritten = rewritten.replace(/,\s*але\s/gi, ". Але ");
  rewritten = rewritten.replace(/,\s*а\s/gi, ". А ");
  rewritten = rewritten.replace(/\s+([,.])/g, "$1").trim();

  if (rewritten !== original) {
    return rewritten;
  }

  if (original.includes(", ")) {
    return original.replace(", ", ". ");
  }

  return `${original} Тобто без зайвого ускладнення.`;
}

function inferFallbackType(prompt?: string): PatchOperationType {
  const loweredPrompt = (prompt ?? "").toLowerCase();

  if (/(поясн|термін|читач)/i.test(loweredPrompt)) {
    return "terminology";
  }

  if (/(скорот|структур|реченн)/i.test(loweredPrompt)) {
    return "structure";
  }

  return "clarity";
}

function inferFallbackReason(prompt?: string): string {
  const loweredPrompt = (prompt ?? "").toLowerCase();

  if (/(поясн|термін|читач)/i.test(loweredPrompt)) {
    return "Пояснив термін простішою мовою.";
  }

  if (/(скорот|коротш)/i.test(loweredPrompt)) {
    return "Скоротив перевантажену конструкцію.";
  }

  return "Спростив фразу без втрати змісту.";
}

function inferCombinedType(operations: PatchOperation[], request: PatchRequest): PatchOperationType {
  if (operations.length === 1) {
    return operations[0]?.type ?? inferFallbackType(request.prompt);
  }

  const uniqueTypes = [...new Set(operations.map((operation) => operation.type))];
  return uniqueTypes.length === 1 ? uniqueTypes[0] : inferFallbackType(request.prompt);
}

function inferCombinedReason(operations: PatchOperation[], request: PatchRequest): string {
  if (operations.length === 1) {
    return operations[0]?.reason ?? inferFallbackReason(request.prompt);
  }

  if (request.mode === "custom" && request.prompt) {
    const loweredPrompt = request.prompt.toLowerCase();

    if (/(скорот|коротш)/i.test(loweredPrompt)) {
      return "Спростив і скоротив фрагмент.";
    }

    if (/(поясн|термін|читач)/i.test(loweredPrompt)) {
      return "Пояснив фрагмент простіше.";
    }
  }

  return "Спростив і узгодив фрагмент.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
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
