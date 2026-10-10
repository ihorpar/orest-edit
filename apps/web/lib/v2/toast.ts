/**
 * The one message at the bottom of the editor. A pure reducer, so the rules are testable:
 *
 * - a new message always replaces the one on screen;
 * - an error stays until it is closed, replaced, or the action it reported succeeds on a retry
 *   (`resolved` with the same area);
 * - anything that is not an error goes away by itself (`expired`).
 */

/** What a message is about; an error is taken down when the same area reports success. */
export type V2ToastArea = "fragment" | "run" | "accept" | "draft" | "file" | "overview";

export interface V2Toast {
  tone: "info" | "error";
  message: string;
  area?: V2ToastArea;
  action?: { label: string; run: () => void };
}

export type V2ToastEvent =
  | { type: "show"; toast: V2Toast }
  /** The action of this area went through: an error it reported earlier is no longer true. */
  | { type: "resolved"; area: V2ToastArea }
  /** The timer of a message ran out. Errors have no timer and ignore it. */
  | { type: "expired" }
  | { type: "dismissed" };

export function toastReducer(current: V2Toast | null, event: V2ToastEvent): V2Toast | null {
  switch (event.type) {
    case "show":
      return event.toast;
    case "resolved":
      return current && current.tone === "error" && current.area === event.area ? null : current;
    case "expired":
      return current && current.tone === "error" ? current : null;
    case "dismissed":
      return null;
  }
}

/** True when the message should be taken down by a timer. */
export function isSelfDismissing(toast: V2Toast | null): boolean {
  return toast !== null && toast.tone !== "error";
}
