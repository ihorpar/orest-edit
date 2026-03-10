import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_COOKIE_NAME,
  normalizePostLoginPath,
  verifySessionToken
} from "./lib/auth/password-auth";

const PUBLIC_PATHS = new Set<string>(["/login", "/api/auth/login", "/api/auth/logout"]);

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const configuredPassword = process.env.APP_PASSWORD?.trim();

  if (!configuredPassword) {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.next();
    }

    if (pathname === "/api/auth/login") {
      return NextResponse.json(
        {
          error: "Серверний пароль не налаштовано. Додайте APP_PASSWORD у змінні середовища."
        },
        { status: 503 }
      );
    }

    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "Серверний пароль не налаштовано. Додайте APP_PASSWORD у змінні середовища."
        },
        { status: 503 }
      );
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "missing_password");
    return NextResponse.redirect(loginUrl);
  }

  const sessionToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const hasSession = await verifySessionToken(sessionToken, configuredPassword);

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/login" && hasSession) {
      const redirectCandidate = request.nextUrl.searchParams.get("next");
      const redirectTo = normalizePostLoginPath(redirectCandidate);
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }

    return NextResponse.next();
  }

  if (hasSession) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Потрібна авторизація." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"]
};
