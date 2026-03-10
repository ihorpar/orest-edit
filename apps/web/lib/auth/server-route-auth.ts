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

  const cookieHeader = request.headers.get("cookie");
  const sessionToken = readCookieValue(cookieHeader, AUTH_COOKIE_NAME);
  const hasSession = await verifySessionToken(sessionToken, configuredPassword);

  if (!hasSession) {
    return NextResponse.json({ error: "Потрібна авторизація." }, { status: 401 });
  }

  return null;
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const pairs = cookieHeader.split(";");

  for (const pair of pairs) {
    const [rawName, ...rawValue] = pair.trim().split("=");

    if (rawName !== name) {
      continue;
    }

    const value = rawValue.join("=");
    return value ? decodeURIComponent(value) : null;
  }

  return null;
}
