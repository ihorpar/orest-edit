export function logEditorialReviewEvent(
  event: string,
  details: Record<string, unknown>,
  level: "info" | "error" = "info"
): void {
  const payload = JSON.stringify({
    scope: "editorial_review",
    event,
    timestamp: new Date().toISOString(),
    ...details
  });

  if (level === "error") {
    console.error(payload);
  } else {
    console.info(payload);
  }
}
