import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionToken,
  normalizePostLoginPath,
  verifySessionToken
} from "../lib/auth/password-auth";

test("normalizePostLoginPath keeps only safe in-app redirects", () => {
  assert.equal(normalizePostLoginPath("/editor"), "/editor");
  assert.equal(normalizePostLoginPath("/editor?tab=review"), "/editor?tab=review");
  assert.equal(normalizePostLoginPath("https://example.com"), "/editor");
  assert.equal(normalizePostLoginPath("//example.com/path"), "/editor");
  assert.equal(normalizePostLoginPath("   "), "/editor");
});

test("session token verifies and expires", async () => {
  const now = Date.now();
  const password = "test-secret";
  const token = await createSessionToken(password, now);

  assert.equal(await verifySessionToken(token, password, now + 1_000), true);
  assert.equal(await verifySessionToken(token, "wrong-secret", now + 1_000), false);
  assert.equal(await verifySessionToken("v1.0.bad", password, now + 1_000), false);
  assert.equal(await verifySessionToken(token, password, now + 60 * 60 * 24 * 14 * 1000 + 1_000), false);
});
