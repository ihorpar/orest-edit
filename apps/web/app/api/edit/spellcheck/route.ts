import { NextResponse } from "next/server";
import { requireApiSession } from "../../../../lib/auth/server-route-auth";
import {
  getSpellcheckSelectedText,
  isValidSpellcheckRange,
  type SpellcheckRequest,
  type SpellcheckResponse
} from "../../../../lib/editor/spellcheck-contract";
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
    return NextResponse.json<SpellcheckResponse>(buildInvalidResponse("Некоректне тіло запиту.", "spellcheck-invalid-json"), { status: 400 });
  }

  const parsed = parseSpellcheckRequest(body);

  if (!parsed.ok) {
    return NextResponse.json<SpellcheckResponse>(buildInvalidResponse(parsed.error, "spellcheck-invalid-body"), { status: 400 });
  }

  const response = await generateSpellcheckResponse(parsed.value);
  const status = response.error && response.issues.length === 0 ? 422 : 200;

  return NextResponse.json<SpellcheckResponse>(response, { status });
}

function parseSpellcheckRequest(body: unknown): { ok: true; value: SpellcheckRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Запит має бути JSON-об'єктом." };
  }

  const record = body as Record<string, unknown>;

  if (typeof record.documentRevisionId !== "string" || !record.documentRevisionId.trim()) {
    return { ok: false, error: "Потрібно передати documentRevisionId." };
  }

  if (record.language !== "uk-UA") {
    return { ok: false, error: "Наразі підтримується лише мова uk-UA." };
  }

  if (record.provider !== "languagetool_public" && record.provider !== "languagetool_self_hosted") {
    return { ok: false, error: "Непідтримуваний spellcheck provider." };
  }

  if (record.trigger !== "manual") {
    return { ok: false, error: "У v1 підтримується лише manual spellcheck." };
  }

  if (!record.selection || typeof record.selection !== "object") {
    return { ok: false, error: "Потрібно передати selection." };
  }

  const selection = record.selection as Record<string, unknown>;

  if (typeof selection.blockId !== "string" || !selection.blockId.trim()) {
    return { ok: false, error: "Потрібно передати selection.blockId." };
  }

  if (typeof selection.text !== "string" || !selection.text.length) {
    return { ok: false, error: "Потрібно передати selection.text." };
  }

  if (!selection.range || typeof selection.range !== "object") {
    return { ok: false, error: "Потрібно передати selection.range." };
  }

  const range = selection.range as Record<string, unknown>;
  const normalizedRange = {
    start: typeof range.start === "number" ? Math.floor(range.start) : Number.NaN,
    end: typeof range.end === "number" ? Math.floor(range.end) : Number.NaN
  };

  if (!isValidSpellcheckRange(normalizedRange, selection.text)) {
    return { ok: false, error: "Некоректний selection.range для переданого тексту." };
  }

  const parsed: SpellcheckRequest = {
    documentRevisionId: record.documentRevisionId.trim(),
    language: "uk-UA",
    provider: record.provider,
    trigger: "manual",
    selection: {
      blockId: selection.blockId.trim(),
      text: selection.text,
      range: normalizedRange
    }
  };

  if (!getSpellcheckSelectedText(parsed.selection).trim()) {
    return { ok: false, error: "Виділений фрагмент порожній. Оберіть текст без порожнього пробілу." };
  }

  return { ok: true, value: parsed };
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
