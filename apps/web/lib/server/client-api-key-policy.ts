export function resolveClientProvidedApiKey(rawValue: unknown): string | undefined {
  if (process.env.NODE_ENV === "production") {
    return undefined;
  }

  if (typeof rawValue !== "string") {
    return undefined;
  }

  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
