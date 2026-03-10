import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  AUTH_COOKIE_NAME,
  getConfiguredAppPassword,
  verifySessionToken
} from "./password-auth";

export async function requireApiSession(): Promise<NextResponse | null> {
  const configuredPassword = getConfiguredAppPassword();

  if (!configuredPassword) {
    return NextResponse.json(
      {
        error: "Серверний пароль не налаштовано. Додайте APP_PASSWORD у змінні середовища."
      },
      { status: 503 }
    );
  }

  const cookieStore = await cookies();
  const sessionTokens = cookieStore.getAll(AUTH_COOKIE_NAME).map((cookie) => cookie.value);
  let hasSession = false;

  for (const sessionToken of sessionTokens) {
    if (await verifySessionToken(sessionToken, configuredPassword)) {
      hasSession = true;
      break;
    }
  }

  if (!hasSession) {
    return NextResponse.json({ error: "Потрібна авторизація." }, { status: 401 });
  }

  return null;
}
