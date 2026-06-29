import { NextResponse } from "next/server";
import { requireApiSession } from "../../../../lib/auth/server-route-auth";
import {
  inferLocalActionRoute,
  type LocalActionMode,
  type LocalActionRouteRequest,
  type LocalActionRouteResponse,
  type LocalActionTextIntent
} from "../../../../lib/editor/local-action-router";
import { normalizeVisualStylePreset } from "../../../../lib/editor/settings";
import { isAppLocale, type AppLocale } from "../../../../lib/i18n/product-locale";
import { getApiErrors, getDefaultAppLocale, resolveRequestLocale, type ApiErrors } from "../../../../lib/i18n/api-errors";

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
    return NextResponse.json<{ error: string }>({ error: errors.invalidRequestBody }, { status: 400 });
  }

  const parsed = parseLocalActionRequest(body, getApiErrors(resolveRequestLocale(body)));

  if (!parsed.ok) {
    return NextResponse.json<{ error: string }>({ error: parsed.error }, { status: 400 });
  }

  return NextResponse.json<LocalActionRouteResponse>(inferLocalActionRoute(parsed.value));
}

function parseLocalActionRequest(
  body: unknown,
  errors: ApiErrors
): { ok: true; value: LocalActionRouteRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: errors.requestMustBeJsonObject };
  }

  const record = body as Record<string, unknown>;
  const explicitMode = parseExplicitMode(record.explicitMode);
  const preferredTextIntent = parseTextIntent(record.preferredTextIntent);

  if (record.prompt !== undefined && typeof record.prompt !== "string") {
    return { ok: false, error: errors.promptMustBeString };
  }

  return {
    ok: true,
    value: {
      locale: parseAppLocale(record.locale),
      prompt: typeof record.prompt === "string" ? record.prompt : "",
      explicitMode,
      preferredTextIntent,
      calloutKind: typeof record.calloutKind === "string" ? record.calloutKind as LocalActionRouteRequest["calloutKind"] : undefined,
      calloutDepth: typeof record.calloutDepth === "string" ? record.calloutDepth as LocalActionRouteRequest["calloutDepth"] : undefined,
      visualIntent: typeof record.visualIntent === "string" ? record.visualIntent as LocalActionRouteRequest["visualIntent"] : undefined,
      visualStylePreset:
        typeof record.visualStylePreset === "string" ? normalizeVisualStylePreset(record.visualStylePreset) : undefined
    }
  };
}

function parseAppLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : "uk";
}

function parseExplicitMode(value: unknown): Exclude<LocalActionMode, "auto"> | null {
  return value === "edit" || value === "spellcheck" || value === "callout" || value === "visual" ? value : null;
}

function parseTextIntent(value: unknown): LocalActionTextIntent | null {
  return value === "rewrite" || value === "shorten" || value === "list" || value === "subsection" ? value : null;
}
