export type UndoRedoHotkeyAction = "undo" | "redo";
export type InlineFormatHotkeyCommand = "bold" | "italic";
export type EditorHotkeyAction = "open_global_replace" | "toggle_bullet_list";

type UndoRedoKeyboardEventLike = {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  code?: string;
  key?: string;
};

export function getUndoRedoHotkeyAction(event: UndoRedoKeyboardEventLike): UndoRedoHotkeyAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return null;
  }

  if (event.code === "KeyZ" && event.shiftKey) {
    return "redo";
  }

  if (event.code === "KeyY") {
    return "redo";
  }

  if (event.code === "KeyZ") {
    return "undo";
  }

  const normalizedKey = event.key?.toLowerCase();

  if (normalizedKey === "z" && event.shiftKey) {
    return "redo";
  }

  if (normalizedKey === "y") {
    return "redo";
  }

  if (normalizedKey === "z") {
    return "undo";
  }

  return null;
}

export function getInlineFormatHotkeyCommand(event: UndoRedoKeyboardEventLike): InlineFormatHotkeyCommand | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return null;
  }

  if (event.code === "KeyB") {
    return "bold";
  }

  if (event.code === "KeyI") {
    return "italic";
  }

  const normalizedKey = event.key?.toLowerCase();

  if (normalizedKey === "b") {
    return "bold";
  }

  if (normalizedKey === "i") {
    return "italic";
  }

  return null;
}

export function getEditorHotkeyAction(event: UndoRedoKeyboardEventLike): EditorHotkeyAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return null;
  }

  if (!event.shiftKey && event.code === "KeyH") {
    return "open_global_replace";
  }

  if (event.shiftKey && (event.code === "Digit8" || event.code === "NumpadMultiply")) {
    return "toggle_bullet_list";
  }

  const normalizedKey = event.key?.toLowerCase();

  if (!event.shiftKey && normalizedKey === "h") {
    return "open_global_replace";
  }

  if (event.shiftKey && (normalizedKey === "*" || normalizedKey === "8")) {
    return "toggle_bullet_list";
  }

  return null;
}
