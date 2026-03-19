import {
  createSpellcheckIssueId,
  getSpellcheckSelectedText,
  type SpellcheckIssue,
  type SpellcheckIssueCategory,
  type SpellcheckIssueSeverity,
  type SpellcheckProvider,
  type SpellcheckRequest,
  type SpellcheckResponse
} from "../editor/spellcheck-contract.ts";
import { readServerEnvValue } from "./env.ts";

const languageToolPublicEndpoint = "https://api.languagetool.org/v2/check";
const defaultSelfHostedPath = "/v2/check";
const spellcheckRequestTimeoutMs = 15000;
const publicApiMaxTextLength = 20_000;
const selfHostedMaxTextLength = 50_000;

type FetchLike = typeof fetch;

interface LanguageToolResponse {
  matches?: LanguageToolMatch[];
}

interface LanguageToolMatch {
  message?: string;
  shortMessage?: string;
  offset?: number;
  length?: number;
  replacements?: Array<{ value?: string }>;
  rule?: {
    id?: string;
    issueType?: string;
    category?: {
      id?: string;
      name?: string;
    };
  };
}

export interface GenerateSpellcheckResponseOptions {
  fetchImpl?: FetchLike;
  now?: () => string;
  readEnvValue?: (key: string) => string | null;
}

export async function generateSpellcheckResponse(
  request: SpellcheckRequest,
  options: GenerateSpellcheckResponseOptions = {}
): Promise<SpellcheckResponse> {
  const requestId = createSpellcheckIssueId("spellcheck-request");
  const now = options.now ?? (() => new Date().toISOString());
  const fetchImpl = options.fetchImpl ?? fetch;
  const readEnvValue = options.readEnvValue ?? readServerEnvValue;
  const selectedText = getSpellcheckSelectedText(request.selection);
  const generatedAt = now();

  if (!selectedText.trim()) {
    return buildSpellcheckResponse({
      request,
      requestId,
      providerUsed: request.provider,
      selectedTextLength: selectedText.length,
      issues: [],
      truncated: false,
      generatedAt,
      error: "Виділений фрагмент порожній. Оберіть текст у межах одного абзацу."
    });
  }

  const maxTextLength = request.provider === "languagetool_public" ? publicApiMaxTextLength : selfHostedMaxTextLength;

  if (selectedText.length > maxTextLength) {
    return buildSpellcheckResponse({
      request,
      requestId,
      providerUsed: request.provider,
      selectedTextLength: selectedText.length,
      issues: [],
      truncated: false,
      generatedAt,
      error:
        request.provider === "languagetool_public"
          ? "Виділений фрагмент завеликий для публічного LanguageTool API. Скоротіть перевірку до 20 000 символів."
          : "Виділений фрагмент завеликий. Скоротіть перевірку до 50 000 символів."
    });
  }

  const endpoint = resolveLanguageToolEndpoint(request.provider, readEnvValue);

  if (!endpoint) {
    return buildSpellcheckResponse({
      request,
      requestId,
      providerUsed: request.provider,
      selectedTextLength: selectedText.length,
      issues: [],
      truncated: false,
      generatedAt,
      error: "Не задано адресу self-hosted LanguageTool. Додайте LANGUAGETOOL_BASE_URL у змінні середовища."
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), spellcheckRequestTimeoutMs);
  const startedAt = Date.now();

  try {
    const body = new URLSearchParams({
      language: request.language,
      text: selectedText
    });

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: body.toString(),
      signal: controller.signal
    });

    const rawText = await response.text();
    let payload: LanguageToolResponse = {};

    try {
      payload = rawText ? (JSON.parse(rawText) as LanguageToolResponse) : {};
    } catch {
      return buildSpellcheckResponse({
        request,
        requestId,
        providerUsed: request.provider,
        selectedTextLength: selectedText.length,
        issues: [],
        truncated: false,
        generatedAt,
        upstreamLatencyMs: Date.now() - startedAt,
        error: "Не вдалося перевірити правопис через LanguageTool.",
        rawError: rawText || `HTTP ${response.status}`
      });
    }

    if (!response.ok) {
      return buildSpellcheckResponse({
        request,
        requestId,
        providerUsed: request.provider,
        selectedTextLength: selectedText.length,
        issues: [],
        truncated: false,
        generatedAt,
        upstreamLatencyMs: Date.now() - startedAt,
        error: "Не вдалося перевірити правопис через LanguageTool.",
        rawError: rawText || `HTTP ${response.status}`
      });
    }

    const issues = normalizeLanguageToolMatches(payload.matches ?? [], request);

    return buildSpellcheckResponse({
      request,
      requestId,
      providerUsed: request.provider,
      selectedTextLength: selectedText.length,
      issues,
      truncated: false,
      generatedAt,
      upstreamLatencyMs: Date.now() - startedAt
    });
  } catch (error) {
    return buildSpellcheckResponse({
      request,
      requestId,
      providerUsed: request.provider,
      selectedTextLength: selectedText.length,
      issues: [],
      truncated: false,
      generatedAt,
      upstreamLatencyMs: Date.now() - startedAt,
      error: formatSpellcheckError(error),
      rawError: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildSpellcheckResponse(input: {
  request: SpellcheckRequest;
  requestId: string;
  providerUsed: SpellcheckProvider;
  selectedTextLength: number;
  issues: SpellcheckIssue[];
  truncated: boolean;
  generatedAt: string;
  upstreamLatencyMs?: number;
  error?: string;
  rawError?: string;
}): SpellcheckResponse {
  return {
    documentRevisionId: input.request.documentRevisionId,
    providerUsed: input.providerUsed,
    language: input.request.language,
    selection: input.request.selection,
    issues: input.issues,
    error: input.error,
    diagnostics: {
      requestId: input.requestId,
      requestedProvider: input.request.provider,
      providerUsed: input.providerUsed,
      language: input.request.language,
      trigger: input.request.trigger,
      selectionBlockId: input.request.selection.blockId,
      selectedTextLength: input.selectedTextLength,
      issueCount: input.issues.length,
      truncated: input.truncated,
      generatedAt: input.generatedAt,
      upstreamLatencyMs: input.upstreamLatencyMs,
      rawError: input.rawError
    }
  };
}

function resolveLanguageToolEndpoint(provider: SpellcheckProvider, readEnvValue: (key: string) => string | null): string | null {
  if (provider === "languagetool_public") {
    return languageToolPublicEndpoint;
  }

  const configuredBaseUrl = readEnvValue("LANGUAGETOOL_BASE_URL")?.trim();

  if (!configuredBaseUrl) {
    return null;
  }

  if (configuredBaseUrl.endsWith("/v2/check")) {
    return configuredBaseUrl;
  }

  return `${configuredBaseUrl.replace(/\/+$/, "")}${defaultSelfHostedPath}`;
}

function normalizeLanguageToolMatches(matches: LanguageToolMatch[], request: SpellcheckRequest): SpellcheckIssue[] {
  const blockText = request.selection.text;
  const fragmentStart = request.selection.range.start;
  const fragmentEnd = request.selection.range.end;

  const normalized = matches
    .map((match) => normalizeLanguageToolMatch(match, blockText, fragmentStart, fragmentEnd))
    .filter((issue): issue is SpellcheckIssue => Boolean(issue));

  normalized.sort((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
  return normalized;
}

function normalizeLanguageToolMatch(
  match: LanguageToolMatch,
  blockText: string,
  fragmentStart: number,
  fragmentEnd: number
): SpellcheckIssue | null {
  const offset = typeof match.offset === "number" ? match.offset : -1;
  const length = typeof match.length === "number" ? match.length : 0;

  if (offset < 0 || length <= 0) {
    return null;
  }

  const start = fragmentStart + offset;
  const end = start + length;

  if (start < fragmentStart || end > fragmentEnd || end > blockText.length) {
    return null;
  }

  const badText = blockText.slice(start, end);

  if (!badText) {
    return null;
  }

  return {
    id: createSpellcheckIssueId(),
    ruleId: match.rule?.id?.trim() || "unknown_rule",
    category: mapIssueCategory(match.rule?.id, match.rule?.issueType, match.rule?.category?.id, match.rule?.category?.name),
    severity: mapIssueSeverity(match.rule?.id, match.rule?.issueType, match.rule?.category?.id, match.rule?.category?.name),
    message: match.message?.trim() || "Можлива мовна помилка.",
    shortMessage: match.shortMessage?.trim() || undefined,
    range: { start, end },
    badText,
    suggestions: (match.replacements ?? [])
      .map((replacement) => replacement.value?.trim())
      .filter((value): value is string => Boolean(value))
      .slice(0, 5)
      .map((value) => ({ value }))
  };
}

function mapIssueCategory(
  ruleId: string | undefined,
  issueType: string | undefined,
  categoryId: string | undefined,
  categoryName: string | undefined
): SpellcheckIssueCategory {
  const rule = (ruleId ?? "").toLowerCase();
  const value = `${issueType ?? ""} ${categoryId ?? ""} ${categoryName ?? ""}`.toLowerCase();

  if (rule.includes("whitespace")) {
    return "typography";
  }

  if (rule.includes("comma") || rule.includes("punct") || rule === "chy_chy") {
    return "grammar";
  }

  if (value.includes("misspelling") || value.includes("spelling") || value.includes("typo")) {
    return "misspelling";
  }

  if (value.includes("typographical") || value.includes("typography") || value.includes("casing")) {
    return "typography";
  }

  if (value.includes("grammar")) {
    return "grammar";
  }

  if (value.includes("style") || value.includes("register") || value.includes("redund")) {
    return "style";
  }

  return "unknown";
}

function mapIssueSeverity(
  ruleId: string | undefined,
  issueType: string | undefined,
  categoryId: string | undefined,
  categoryName: string | undefined
): SpellcheckIssueSeverity {
  const category = mapIssueCategory(ruleId, issueType, categoryId, categoryName);

  if (category === "misspelling" || category === "grammar") {
    return "error";
  }

  if (category === "style") {
    return "suggestion";
  }

  return "warning";
}

function formatSpellcheckError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "LanguageTool не відповів вчасно. Спробуйте ще раз.";
  }

  if (error instanceof Error && error.message.trim()) {
    return `Не вдалося перевірити правопис: ${error.message.trim()}`;
  }

  return "Не вдалося перевірити правопис.";
}
