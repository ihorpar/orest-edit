import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  constantTimeEqual,
  createSessionToken,
  getConfiguredAppPassword,
  normalizePostLoginPath
} from "../../../../lib/auth/password-auth";
import { getApiErrors, getDefaultAppLocale } from "../../../../lib/i18n/api-errors";
import { isAppLocale } from "../../../../lib/i18n/product-locale";

export const runtime = "nodejs";

interface LoginRequestBody {
  password?: unknown;
  redirectTo?: unknown;
  locale?: unknown;
}

export async function POST(request: Request) {
  const configuredPassword = getConfiguredAppPassword();
  const defaultErrors = getApiErrors(getDefaultAppLocale());

  if (!configuredPassword) {
    return NextResponse.json(
      {
        error: defaultErrors.serverPasswordNotConfigured
      },
      { status: 503 }
    );
  }

  let body: LoginRequestBody;

  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json({ error: defaultErrors.invalidRequestBody }, { status: 400 });
  }

  const errors = getApiErrors(isAppLocale(body.locale) ? body.locale : getDefaultAppLocale());
  const password = typeof body.password === "string" ? body.password : "";

  if (!constantTimeEqual(password, configuredPassword)) {
    return NextResponse.json({ error: errors.invalidPassword }, { status: 401 });
  }

  const redirectTo = normalizePostLoginPath(typeof body.redirectTo === "string" ? body.redirectTo : null);
  const token = await createSessionToken(configuredPassword);
  const response = NextResponse.json({ ok: true, redirectTo }, { status: 200 });

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS
  });

  return response;
}
