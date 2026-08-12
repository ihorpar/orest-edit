import type { AppLocale } from "../i18n/product-locale.ts";
import type { EditorialReviewRunSnapshot } from "./review-contract.ts";
import type { PersistedActiveReviewRun } from "./draft-state.ts";
import { manuscriptSharesIdentity } from "./review-run-merge.ts";

const pollLeasePrefix = "orest-review-run-poll-lease-v1:";
const startLockPrefix = "orest-review-run-start-v1:";

interface PollLease {
  ownerId: string;
  expiresAt: number;
}

export function createPersistedActiveReviewRun(
  run: EditorialReviewRunSnapshot,
  capability: string,
  stale = false,
  snapshotBlockIds?: string[]
): PersistedActiveReviewRun {
  return {
    version: 1,
    run,
    capability,
    updatedAt: new Date().toISOString(),
    stale,
    snapshotBlockIds
  };
}

export function isRunTerminal(run: EditorialReviewRunSnapshot): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "cancelled";
}

export function isRunCompatibleWithEditor(input: {
  record: PersistedActiveReviewRun;
  locale: AppLocale;
  liveBlockIds: string[];
}): boolean {
  return input.record.run.locale === input.locale &&
    manuscriptSharesIdentity(input.liveBlockIds, input.record.snapshotBlockIds);
}

export async function withReviewRunStartLock<T>(locale: AppLocale, callback: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`${startLockPrefix}${locale}`, { mode: "exclusive" }, callback);
  }

  // Web Locks is available in the supported Chromium app browsers. This fallback keeps
  // non-browser tests and unusual engines functional, but does not claim cross-tab atomicity.
  return callback();
}

export function getReviewRunPollLeaseStorageKey(runId: string): string {
  return `${pollLeasePrefix}${runId}`;
}

export function tryAcquireReviewRunPollLease(input: {
  runId: string;
  ownerId: string;
  now?: number;
  ttlMs?: number;
}): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? 6_000;
  const key = getReviewRunPollLeaseStorageKey(input.runId);
  const current = readPollLease(key);

  if (current && current.ownerId !== input.ownerId && current.expiresAt > now) {
    return false;
  }

  const next: PollLease = { ownerId: input.ownerId, expiresAt: now + ttlMs };
  window.localStorage.setItem(key, JSON.stringify(next));
  const confirmed = readPollLease(key);
  return confirmed?.ownerId === input.ownerId && confirmed.expiresAt === next.expiresAt;
}

export function releaseReviewRunPollLease(runId: string, ownerId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const key = getReviewRunPollLeaseStorageKey(runId);
  const current = readPollLease(key);

  if (current?.ownerId === ownerId) {
    window.localStorage.removeItem(key);
  }
}

function readPollLease(key: string): PollLease | null {
  try {
    const raw = window.localStorage.getItem(key);

    if (!raw) {
      return null;
    }

    const value = JSON.parse(raw) as Partial<PollLease>;
    return typeof value.ownerId === "string" && typeof value.expiresAt === "number"
      ? { ownerId: value.ownerId, expiresAt: value.expiresAt }
      : null;
  } catch {
    return null;
  }
}
