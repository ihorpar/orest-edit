import { NextResponse } from "next/server";
import { requireApiSession } from "../../../../lib/auth/server-route-auth";
import {
  getSpellcheckSelectedText,
  isValidSpellcheckRange,
  type SpellcheckRequest,
  type SpellcheckResponse
} from "../../../../lib/editor/spellcheck-contract";
import { isAppLocale, type AppLocale } from "../../../../lib/i18n/product-locale";
import { getApiErrors, getDefaultAppLocale, resolveRequestLocale, type ApiErrors } from "../../../../lib/i18n/api-errors";
import { generateSpellcheckResponse } from "../../../../lib/server/spellcheck-service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const authFailure = await requireApiSession(request);

  if (authFailure) {
    return authFailure;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    const errors = getApiErrors(getDefaultAppLocale());
    return NextResponse.json<SpellcheckResponse>(buildInvalidResponse(errors.invalidRequestBody, "spellcheck-invalid-json"), { status: 400 });
  }

  const parsed = parseSpellcheckRequest(body, getApiErrors(resolveRequestLocale(body)));

  if (!parsed.ok) {
    return NextResponse.json<SpellcheckResponse>(buildInvalidResponse(parsed.error, "spellcheck-invalid-body"), { status: 400 });
  }

  const response = await generateSpellcheckResponse(parsed.value);
  const status = response.error && response.issues.length === 0 ? 422 : 200;

  return NextResponse.json<SpellcheckResponse>(response, { status });
}

function parseSpellcheckRequest(body: unknown, errors: ApiErrors): { ok: true; value: SpellcheckRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: errors.requestMustBeJsonObject };
  }

  const record = body as Record<string, unknown>;

  if (typeof record.documentRevisionId !== "string" || !record.documentRevisionId.trim()) {
    return { ok: false, error: errors.documentRevisionIdRequired };
  }

  if (record.language !== "uk-UA" && record.language !== "en-US") {
    return { ok: false, error: "Only uk-UA and en-US are supported in v1." };
  }

  if (record.provider !== "languagetool_public" && record.provider !== "languagetool_self_hosted") {
    return { ok: false, error: errors.unsupportedSpellcheckProvider };
  }

  if (record.trigger !== "manual") {
    return { ok: false, error: errors.manualSpellcheckOnly };
  }

  if (!record.selection || typeof record.selection !== "object") {
    return { ok: false, error: errors.selectionRequired };
  }

  const selection = record.selection as Record<string, unknown>;

  if (typeof selection.blockId !== "string" || !selection.blockId.trim()) {
    return { ok: false, error: errors.selectionBlockIdRequired };
  }

  if (typeof selection.text !== "string" || !selection.text.length) {
    return { ok: false, error: errors.selectionTextRequired };
  }

  if (!selection.range || typeof selection.range !== "object") {
    return { ok: false, error: errors.selectionRangeRequired };
  }

  const range = selection.range as Record<string, unknown>;
  const normalizedRange = {
    start: typeof range.start === "number" ? Math.floor(range.start) : Number.NaN,
    end: typeof range.end === "number" ? Math.floor(range.end) : Number.NaN
  };

  if (!isValidSpellcheckRange(normalizedRange, selection.text)) {
    return { ok: false, error: errors.invalidSelectionRange };
  }

  const parsed: SpellcheckRequest = {
    documentRevisionId: record.documentRevisionId.trim(),
    locale: parseAppLocale(record.locale),
    language: record.language,
    provider: record.provider,
    trigger: "manual",
    selection: {
      blockId: selection.blockId.trim(),
      text: selection.text,
      range: normalizedRange
    }
  };

  if (!getSpellcheckSelectedText(parsed.selection).trim()) {
    return { ok: false, error: errors.emptySelectionFragment };
  }

  return { ok: true, value: parsed };
}

function parseAppLocale(value: unknown): AppLocale | undefined {
  return isAppLocale(value) ? value : undefined;
}

function buildInvalidResponse(error: string, requestId: string): SpellcheckResponse {
  return {
    documentRevisionId: "invalid-request",
    providerUsed: "languagetool_public",
    language: "uk-UA",
    selection: {
      blockId: "unknown",
      text: "",
      range: {
        start: 0,
        end: 0
      }
    },
    issues: [],
    error,
    diagnostics: {
      requestId,
      requestedProvider: "languagetool_public",
      providerUsed: "languagetool_public",
      language: "uk-UA",
      trigger: "manual",
      selectionBlockId: "unknown",
      selectedTextLength: 0,
      issueCount: 0,
      truncated: false,
      generatedAt: new Date().toISOString()
    }
  };
}
