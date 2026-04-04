import test from "node:test";
import assert from "node:assert/strict";

import { getEditorHotkeyAction, getInlineFormatHotkeyCommand, getUndoRedoHotkeyAction } from "../lib/editor/keyboard-shortcuts.ts";

test("getUndoRedoHotkeyAction matches undo and redo by physical key code", () => {
  assert.equal(
    getUndoRedoHotkeyAction({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: "KeyZ", key: "я" }),
    "undo"
  );
  assert.equal(
    getUndoRedoHotkeyAction({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, code: "KeyZ", key: "Я" }),
    "redo"
  );
  assert.equal(
    getUndoRedoHotkeyAction({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: "KeyY", key: "н" }),
    "redo"
  );
});

test("getUndoRedoHotkeyAction falls back to latin key matching when code is unavailable", () => {
  assert.equal(
    getUndoRedoHotkeyAction({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: "z" }),
    "undo"
  );
  assert.equal(
    getUndoRedoHotkeyAction({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: true, key: "Z" }),
    "redo"
  );
  assert.equal(
    getUndoRedoHotkeyAction({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: "y" }),
    "redo"
  );
});

test("getUndoRedoHotkeyAction ignores unrelated or alt-modified shortcuts", () => {
  assert.equal(
    getUndoRedoHotkeyAction({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, code: "KeyZ", key: "я" }),
    null
  );
  assert.equal(
    getUndoRedoHotkeyAction({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: "KeyZ", key: "z" }),
    null
  );
  assert.equal(
    getUndoRedoHotkeyAction({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: "KeyX", key: "ч" }),
    null
  );
});

test("getInlineFormatHotkeyCommand matches bold and italic by physical key code", () => {
  assert.equal(
    getInlineFormatHotkeyCommand({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: "KeyB", key: "и" }),
    "bold"
  );
  assert.equal(
    getInlineFormatHotkeyCommand({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: "KeyI", key: "ш" }),
    "italic"
  );
});

test("getInlineFormatHotkeyCommand falls back to latin key matching when code is unavailable", () => {
  assert.equal(
    getInlineFormatHotkeyCommand({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: "b" }),
    "bold"
  );
  assert.equal(
    getInlineFormatHotkeyCommand({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: "I" }),
    "italic"
  );
});

test("getInlineFormatHotkeyCommand ignores shifted or unrelated shortcuts", () => {
  assert.equal(
    getInlineFormatHotkeyCommand({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, code: "KeyB", key: "B" }),
    null
  );
  assert.equal(
    getInlineFormatHotkeyCommand({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: "KeyU", key: "г" }),
    null
  );
});

test("getEditorHotkeyAction matches global replace by physical key code and latin fallback", () => {
  assert.equal(
    getEditorHotkeyAction({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: "KeyH", key: "р" }),
    "open_global_replace"
  );
  assert.equal(
    getEditorHotkeyAction({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: "h" }),
    "open_global_replace"
  );
});

test("getEditorHotkeyAction ignores shifted, alt-modified, and unrelated shortcuts", () => {
  assert.equal(
    getEditorHotkeyAction({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, code: "KeyH", key: "H" }),
    null
  );
  assert.equal(
    getEditorHotkeyAction({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, code: "KeyH", key: "р" }),
    null
  );
  assert.equal(
    getEditorHotkeyAction({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: "KeyJ", key: "о" }),
    null
  );
});
