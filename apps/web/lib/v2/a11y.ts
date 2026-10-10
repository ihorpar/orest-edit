import type { V2Copy } from "./copy.ts";
import { getItemPassId, isOpenItem, type V2PassId, type V2ReviewState, type V2StepRunId } from "./store.ts";

/**
 * Keyboard and screen-reader rules of the v2 interface, as pure functions.
 */

/** Tab to move to for a key pressed on a tab of a tablist; null when the key does not move. */
export function getTabForKey<T>(tabs: readonly T[], current: T, key: string): T | null {
  const index = tabs.indexOf(current);

  if (index === -1 || tabs.length === 0) {
    return null;
  }

  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return tabs[(index + 1) % tabs.length]!;
    case "ArrowLeft":
    case "ArrowUp":
      return tabs[(index - 1 + tabs.length) % tabs.length]!;
    case "Home":
      return tabs[0]!;
    case "End":
      return tabs[tabs.length - 1]!;
    default:
      return null;
  }
}

/** Parts of the page `F6` walks through. A part that is not on screen is skipped. */
export type V2Region = "manuscript" | "panel" | "toast";

export const REGION_ORDER: readonly V2Region[] = ["manuscript", "panel", "toast"];

export function getNextRegion(current: V2Region | null, available: ReadonlySet<V2Region>, backwards = false): V2Region | null {
  const order = REGION_ORDER.filter((region) => available.has(region));

  if (order.length === 0) {
    return null;
  }

  const index = current ? order.indexOf(current) : -1;

  if (index === -1) {
    return backwards ? order[order.length - 1]! : order[0]!;
  }

  return order[(index + (backwards ? order.length - 1 : 1)) % order.length]!;
}

const STEP_IDS: V2StepRunId[] = ["diagnostics", "fact_check", "request"];

/**
 * What a screen reader is told when the state of the suggestion engine changes: a pass or a step that
 * finished or failed, an edit that became ready or failed, an image or a prompt that completed or failed.
 * Nothing else is announced: not progress, not polling, not typing, not the studio's seconds counter.
 */
export function planAnnouncements(previous: V2ReviewState, next: V2ReviewState, copy: V2Copy): string[] {
  if (previous === next) {
    return [];
  }

  const live = copy.a11y.live;
  const messages: string[] = [];

  for (const pass of copy.edits.passList) {
    const before = previous.passes[pass.id as V2PassId];
    const after = next.passes[pass.id as V2PassId];

    if (before?.status !== "running" || !after || after.status === "running" || after.stopped) {
      continue;
    }

    if (after.status === "done") {
      const count = next.items.filter((item) => isOpenItem(item) && getItemPassId(item) === pass.id).length;
      messages.push(live.passDone(pass.name, count));
    } else if (after.status === "failed") {
      messages.push(live.passFailed(pass.name));
    }
  }

  for (const stepId of STEP_IDS) {
    const before = previous.steps[stepId];
    const after = next.steps[stepId];

    if (before?.status !== "running" || !after || after.status === "running" || after.stopped) {
      continue;
    }

    const name = copy.overview.runNames[stepId];

    if (after.status === "done") {
      const count = stepId === "request" ? next.items.filter((item) => isOpenItem(item) && item.stepId === "final_editing").length : 0;
      messages.push(stepId === "request" ? live.passDone(name, count) : `${name}: ${copy.edits.done}.`);
    } else if (after.status === "failed") {
      messages.push(live.passFailed(name));
    }
  }

  let proposalReady = false;
  let proposalFailed = false;

  for (const [itemId, before] of Object.entries(previous.proposals)) {
    if (before.status !== "preparing") {
      continue;
    }

    const after = next.proposals[itemId];

    if (after?.status === "ready") {
      // A regeneration that failed keeps the earlier proposal on screen and says why.
      proposalFailed ||= Boolean(after.error);
      proposalReady ||= !after.error;
    } else if (after?.status === "failed") {
      proposalFailed = true;
    }
  }

  if (proposalReady) {
    messages.push(live.proposalReady);
  }

  if (proposalFailed) {
    messages.push(live.proposalFailed);
  }

  const studios = new Map(previous.items.filter((item) => item.studio).map((item) => [item.id, item.studio!]));

  for (const item of next.items) {
    const before = studios.get(item.id);
    const after = item.studio;

    if (!before || !after || before === after) {
      continue;
    }

    if (before.generation.status === "generating" && after.generation.status !== "generating") {
      if (after.generation.status === "failed") {
        messages.push(live.imageFailed);
      } else if (after.generation.status === "idle" && after.asset && after.asset.assetId !== before.asset?.assetId) {
        messages.push(live.imageReady);
      }
    }

    if (before.promptState.status === "preparing" && after.promptState.status !== "preparing") {
      if (after.promptState.status === "failed") {
        messages.push(live.promptFailed);
      } else if (after.prompt !== before.prompt || after.preparedFor !== before.preparedFor) {
        // A cancelled preparation leaves the prompt as it was and is not announced.
        messages.push(live.promptReady);
      }
    }
  }

  return messages;
}
