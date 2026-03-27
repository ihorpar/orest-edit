export type UndoRedoHotkeyAction = "undo" | "redo";
export type InlineFormatHotkeyCommand = "bold" | "italic";

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
