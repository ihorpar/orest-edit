import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createPersistedActiveReviewRun,
  isRunCompatibleWithEditor,
  isReviewRunPollLeasedByOther,
  releaseReviewRunPollLease,
  tryAcquireReviewRunPollLease,
  withReviewRunStartLock
} from "../lib/editor/review-run-persistence.ts";
import { manuscriptSharesIdentity } from "../lib/editor/review-run-merge.ts";
import type { EditorialReviewRunSnapshot } from "../lib/editor/review-contract.ts";

class TestLocalStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function installWindow() {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: new TestLocalStorage() },
    configurable: true
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "navigator");
});

function run(overrides: Partial<EditorialReviewRunSnapshot> = {}): EditorialReviewRunSnapshot {
  return {
    runId: "wrun_test",
    documentRevisionId: "revision-1",
    stepId: "emphasis",
    locale: "uk",
    provider: "openai",
    modelId: "gpt-5.6-luna",
    runMode: "replace",
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:01.000Z",
    status: "running",
    pollAfterMs: 1000,
    progress: { completedChunks: 2, totalChunks: 10 },
    ...overrides
  };
}

test("active review record retains only the durable run reference and capability", () => {
  const record = createPersistedActiveReviewRun(run(), "signed-capability");

  assert.equal(record.run.runId, "wrun_test");
  assert.equal(record.capability, "signed-capability");
  assert.equal(record.stale, false);
  assert.equal(record.itemCursor, undefined);
  assert.equal(
    createPersistedActiveReviewRun(run(), "signed-capability", false, ["p1"], 42).itemCursor,
    42
  );
  assert.equal(isRunCompatibleWithEditor({ record, locale: "uk", liveBlockIds: ["p1"] }), true);
  assert.equal(isRunCompatibleWithEditor({
    record: createPersistedActiveReviewRun(run({ documentRevisionId: "revision-2" }), "signed-capability"),
    locale: "uk",
    liveBlockIds: ["p1"]
  }), true);
  assert.equal(isRunCompatibleWithEditor({ record, locale: "en", liveBlockIds: ["p1"] }), false);
  assert.equal(isRunCompatibleWithEditor({ record, locale: "uk", liveBlockIds: [] }), false);
  assert.equal(isRunCompatibleWithEditor({
    record: createPersistedActiveReviewRun(run(), "signed-capability", false, ["p1", "p2"]),
    locale: "uk",
    liveBlockIds: ["other"]
  }), false);
});

test("isRunCompatibleWithEditor stays true after a live rewrite when snapshot block ids still overlap", () => {
  const record = createPersistedActiveReviewRun(run(), "signed-capability", false, ["p1", "p2", "p3"]);

  assert.equal(isRunCompatibleWithEditor({
    record,
    locale: "uk",
    liveBlockIds: ["p1", "p2-rewritten", "p3"]
  }), true);
  assert.equal(manuscriptSharesIdentity(["p1", "p2"], ["p1", "p2", "p3"]), true);
  assert.equal(manuscriptSharesIdentity(["x"], ["p1", "p2"]), false);
  assert.equal(manuscriptSharesIdentity([], ["p1"]), false);
});

test("poll lease allows one tab, renews its owner, and hands off after expiry", () => {
  installWindow();

  assert.equal(tryAcquireReviewRunPollLease({ runId: "wrun_test", ownerId: "tab-a", now: 1000, ttlMs: 5000 }), true);
  assert.equal(tryAcquireReviewRunPollLease({ runId: "wrun_test", ownerId: "tab-b", now: 2000, ttlMs: 5000 }), false);
  assert.equal(tryAcquireReviewRunPollLease({ runId: "wrun_test", ownerId: "tab-a", now: 3000, ttlMs: 5000 }), true);
  assert.equal(tryAcquireReviewRunPollLease({ runId: "wrun_test", ownerId: "tab-b", now: 9000, ttlMs: 5000 }), true);

  releaseReviewRunPollLease("wrun_test", "tab-a");
  assert.equal(tryAcquireReviewRunPollLease({ runId: "wrun_test", ownerId: "tab-a", now: 9001, ttlMs: 5000 }), false);
  releaseReviewRunPollLease("wrun_test", "tab-b");
  assert.equal(tryAcquireReviewRunPollLease({ runId: "wrun_test", ownerId: "tab-a", now: 9002, ttlMs: 5000 }), true);
});

test("review starts use one exclusive same-origin Web Lock", async () => {
  const events: string[] = [];
  const lockNames: string[] = [];
  let tail = Promise.resolve<unknown>(undefined);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request: (name: string, _options: unknown, callback: () => Promise<unknown>) => {
          lockNames.push(name);
          const current = tail.then(callback);
          tail = current.then(() => undefined);
          return current;
        }
      }
    }
  });

  const first = withReviewRunStartLock("uk", async () => {
    events.push("first:start");
    await Promise.resolve();
    events.push("first:end");
  });
  const second = withReviewRunStartLock("uk", async () => {
    events.push("second:start");
    events.push("second:end");
  });
  await Promise.all([first, second]);

  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  assert.equal(lockNames[0], lockNames[1]);
});

test("isReviewRunPollLeasedByOther detects an active foreign poll lease", () => {
  installWindow();

  const runId = "wrun-foreign";
  const ownerId = "tab-a";
  const foreignOwnerId = "tab-b";
  const now = Date.now();

  assert.equal(isReviewRunPollLeasedByOther({ runId, ownerId, now }), false);
  assert.equal(tryAcquireReviewRunPollLease({ runId, ownerId, now, ttlMs: 6_000 }), true);
  assert.equal(isReviewRunPollLeasedByOther({ runId, ownerId: foreignOwnerId, now }), true);
  assert.equal(isReviewRunPollLeasedByOther({ runId, ownerId, now }), false);
});
