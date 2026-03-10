import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "../../lib/auth/password-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });

  return response;
}
