import { getEditorHotkeyAction } from "../editor/keyboard-shortcuts.ts";

/**
 * Page-level shortcuts of v2. Editing shortcuts (bold, italic, undo, redo, line break) belong to the
 * manuscript editor's own keymap; quiet mode and the studio handle their keys themselves.
 */

export type V2HotkeyAction =
  /** `Ctrl/Cmd+H`: find and replace. */
  | "replace"
  /** `Ctrl/Cmd+/`: the list of shortcuts. */
  | "hotkeys"
  /** `F6` / `Shift+F6`: next or previous part of the page. */
  | "region-next"
  | "region-previous"
  /** `Alt+F10`: the actions for the selected text. */
  | "composer";

interface KeyLike {
  key?: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function getV2HotkeyAction(event: KeyLike): V2HotkeyAction | null {
  if (event.key === "F6" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return event.shiftKey ? "region-previous" : "region-next";
  }

  if (event.key === "F10" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    return "composer";
  }

  if (getEditorHotkeyAction(event) === "open_global_replace") {
    return "replace";
  }

  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.code === "Slash" || event.key === "/")) {
    return "hotkeys";
  }

  return null;
}

/**
 * True when a key pressed on the page must not act as a page-level shortcut: a modal dialog is open (the
 * studio, `Історія`, find and replace, the hotkeys list, a confirmation), or the key was pressed inside a
 * dialog. This covers every page shortcut alike: the quiet-mode keys (accept, reject, move), `F6`,
 * `Alt+F10`, `Ctrl/Cmd+H`, `Ctrl/Cmd+/`. Editing keys (undo, redo) belong to the manuscript, which is inert
 * behind a modal.
 */
export function isPageShortcutBlocked(input: {
  /** A dialog of the page is open, as the page's own state knows it. */
  modalOpen: boolean;
  /** The studio is open. */
  studioOpen: boolean;
  /** Any `<dialog open>` is in the document, as the browser knows it. */
  dialogInDocument: boolean;
  /** The element the key was pressed on. */
  target: { closest?: (selector: string) => unknown } | null;
}): boolean {
  if (input.modalOpen || input.studioOpen || input.dialogInDocument) {
    return true;
  }

  return Boolean(input.target && typeof input.target.closest === "function" && input.target.closest('dialog, [role="dialog"], [role="alertdialog"]'));
}

/** Autosave waits longer on a long chapter, where reading and storing the whole draft costs more. */
export const SAVE_DELAY_MS = 400;
export const SAVE_DELAY_LONG_MS = 900;
export const LONG_DOCUMENT_SIZE = 60_000;

/** `size` is the size of the ProseMirror document (close to its character count). */
export function getSaveDelay(size: number): number {
  return size >= LONG_DOCUMENT_SIZE ? SAVE_DELAY_LONG_MS : SAVE_DELAY_MS;
}
