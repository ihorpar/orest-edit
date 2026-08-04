import assert from "node:assert/strict";
import test from "node:test";
import type { EditorialReviewRunIdentity } from "../lib/editor/review-contract.ts";
import {
  createReviewRunCapability,
  verifyReviewRunCapability
} from "../lib/server/review-run-capability.ts";

const identity: EditorialReviewRunIdentity = {
  runId: "wrun_test",
  documentRevisionId: "revision-1",
  stepId: "emphasis",
  locale: "uk",
  provider: "gemini",
  modelId: "gemini-3.6-flash",
  runMode: "replace",
  createdAt: "2026-08-04T12:00:00.000Z"
};

const readSecret = (key: string) => key === "REVIEW_RUN_CAPABILITY_SECRET" ? "capability-secret" : undefined;

test("review run capability round-trips the signed run identity", async () => {
  const capability = await createReviewRunCapability(identity, readSecret);
  const verified = await verifyReviewRunCapability(capability, identity.runId, readSecret);

  assert.ok(verified);
  assert.equal(verified.runId, identity.runId);
  assert.equal(verified.documentRevisionId, identity.documentRevisionId);
  assert.equal(verified.stepId, identity.stepId);
  assert.equal(verified.provider, identity.provider);
  assert.ok(verified.nonce);
});

test("review run capability rejects a different run and tampering", async () => {
  const capability = await createReviewRunCapability(identity, readSecret);

  assert.equal(await verifyReviewRunCapability(capability, "wrun_other", readSecret), null);

  const [payload, signature] = capability.split(".");
  const tampered = `${payload.slice(0, -1)}A.${signature}`;
  assert.equal(await verifyReviewRunCapability(tampered, identity.runId, readSecret), null);
});
