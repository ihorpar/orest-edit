import { constantTimeEqual, getConfiguredAppPassword } from "../auth/password-auth.ts";
import type { EditorialReviewRunIdentity } from "../editor/review-contract.ts";

const capabilityVersion = "v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ReviewRunCapabilityPayload extends EditorialReviewRunIdentity {
  version: typeof capabilityVersion;
  nonce: string;
}

export function assertReviewRunCapabilityConfigured(
  readEnvValue: (key: string) => string | undefined = (key) => process.env[key]
): void {
  resolveCapabilitySecret(readEnvValue);
}

export async function createReviewRunCapability(
  identity: EditorialReviewRunIdentity,
  readEnvValue: (key: string) => string | undefined = (key) => process.env[key]
): Promise<string> {
  const payload: ReviewRunCapabilityPayload = {
    ...identity,
    version: capabilityVersion,
    nonce: createNonce()
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await signCapability(encodedPayload, resolveCapabilitySecret(readEnvValue));

  return `${encodedPayload}.${signature}`;
}

export async function verifyReviewRunCapability(
  capability: string,
  expectedRunId: string,
  readEnvValue: (key: string) => string | undefined = (key) => process.env[key]
): Promise<ReviewRunCapabilityPayload | null> {
  const [encodedPayload, suppliedSignature, extra] = capability.split(".");

  if (!encodedPayload || !suppliedSignature || extra) {
    return null;
  }

  const expectedSignature = await signCapability(encodedPayload, resolveCapabilitySecret(readEnvValue));

  if (!constantTimeEqual(suppliedSignature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(encodedPayload))) as Partial<ReviewRunCapabilityPayload>;

    if (
      payload.version !== capabilityVersion ||
      payload.runId !== expectedRunId ||
      typeof payload.nonce !== "string" ||
      typeof payload.documentRevisionId !== "string" ||
      typeof payload.stepId !== "string" ||
      typeof payload.provider !== "string" ||
      typeof payload.modelId !== "string" ||
      typeof payload.runMode !== "string" ||
      typeof payload.createdAt !== "string"
    ) {
      return null;
    }

    return payload as ReviewRunCapabilityPayload;
  } catch {
    return null;
  }
}

function resolveCapabilitySecret(readEnvValue: (key: string) => string | undefined): string {
  const dedicatedSecret = readEnvValue("REVIEW_RUN_CAPABILITY_SECRET")?.trim();

  if (dedicatedSecret) {
    return dedicatedSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("REVIEW_RUN_CAPABILITY_SECRET is not configured.");
  }

  const appPassword = getConfiguredAppPassword();

  if (!appPassword) {
    throw new Error("Review run capability secret is not configured.");
  }

  return appPassword;
}

async function signCapability(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

  return toBase64Url(new Uint8Array(signature));
}

function createNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
