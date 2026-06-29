import assert from "node:assert/strict";
import test from "node:test";
import { buildImportFeedback } from "../lib/editor/import-feedback.ts";

test("buildImportFeedback returns English clipboard import message", () => {
  const feedback = buildImportFeedback("clipboard_text", [], "en");

  assert.equal(feedback.tone, "info");
  assert.match(feedback.message, /Clipboard text imported/i);
  assert.doesNotMatch(feedback.message, /[А-Яа-яІіЇїЄєҐґ]/);
});

test("buildImportFeedback localizes import warnings", () => {
  const feedback = buildImportFeedback("clipboard_html", ["clipboard_image_unsupported"], "en");

  assert.match(feedback.message, /Clipboard content imported/i);
  assert.match(feedback.message, /Clipboard images are not imported yet/i);
});
