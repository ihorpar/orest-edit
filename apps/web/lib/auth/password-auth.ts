const TOKEN_VERSION = "v1";

export const AUTH_COOKIE_NAME = "orest_app_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export function getConfiguredAppPassword(): string | null {
  const value = process.env.APP_PASSWORD?.trim();
  return value && value.length > 0 ? value : null;
}

export function normalizePostLoginPath(candidate: string | null | undefined, fallback = "/editor"): string {
  if (typeof candidate !== "string") {
    return fallback;
  }

  const trimmed = candidate.trim();

  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return fallback;
  }

  return trimmed;
}

export async function createSessionToken(password: string, now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + AUTH_SESSION_MAX_AGE_SECONDS;
  const payload = `${TOKEN_VERSION}.${expiresAt}`;
  const signature = await signPayload(payload, password);

  return `${payload}.${signature}`;
}

export async function verifySessionToken(token: string | null | undefined, password: string, now = Date.now()): Promise<boolean> {
  if (!token) {
    return false;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [version, expiresAtRaw, signature] = parts;

  if (version !== TOKEN_VERSION) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);

  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(now / 1000)) {
    return false;
  }

  const payload = `${version}.${expiresAtRaw}`;
  const expectedSignature = await signPayload(payload, password);

  return constantTimeEqual(signature, expectedSignature);
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(new Uint8Array(signature));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const encoder = new TextEncoder();
