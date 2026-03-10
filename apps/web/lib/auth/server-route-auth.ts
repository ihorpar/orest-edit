import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  getConfiguredAppPassword,
  verifySessionToken
} from "./password-auth";

export async function requireApiSession(request: Request): Promise<NextResponse | null> {
  const configuredPassword = getConfiguredAppPassword();

  if (!configuredPassword) {
    return NextResponse.json(
      {
        error: "Серверний пароль не налаштовано. Додайте APP_PASSWORD у змінні середовища."
      },
      { status: 503 }
    );
  }

  const sessionTokens = readCookieValues(request.headers.get("cookie"), AUTH_COOKIE_NAME);
  let hasSession = false;

  for (const sessionToken of sessionTokens) {
    if (await verifySessionToken(sessionToken, configuredPassword)) {
      hasSession = true;
      break;
    }
  }

  if (!hasSession) {
    return NextResponse.json(
      {
        error: "Потрібна авторизація.",
        code: "invalid_session"
      },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  return null;
}

function readCookieValues(cookieHeader: string | null, name: string): string[] {
  if (!cookieHeader) {
    return [];
  }

  const values: string[] = [];

  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const cookieName = pair.slice(0, separatorIndex).trim();

    if (cookieName !== name) {
      continue;
    }

    const rawValue = pair.slice(separatorIndex + 1).trim();

    if (!rawValue) {
      continue;
    }

    try {
      values.push(decodeURIComponent(rawValue));
    } catch {
      values.push(rawValue);
    }
  }

  return values;
}
