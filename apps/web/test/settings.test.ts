import test from "node:test";
import assert from "node:assert/strict";

import {
  BULLET_LIST_PUNCTUATION_RULE,
  DEFAULT_BASE_PROMPT,
  DEFAULT_CALLOUT_PROMPT_TEMPLATE,
  DEFAULT_CARDS_PROMPT,
  DEFAULT_EXPERTISE_PROMPT,
  DEFAULT_IMAGE_PROMPT_TEMPLATE,
  DEFAULT_EDITOR_SETTINGS,
  getDefaultProviderModelId,
  getVisualStylePresetGuide,
  getVisualStylePresetOptions,
  normalizeVisualStylePreset,
  writeEditorSettings,
  readEditorSettings
} from "../lib/editor/settings.ts";

test("DEFAULT_CALLOUT_PROMPT_TEMPLATE documents every supported callout kind explicitly", () => {
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /mechanism:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /analogy:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /everyday_application:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /myths_vs_truth:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /top_list:/i);
});

test("DEFAULT_CALLOUT_PROMPT_TEMPLATE hardens top_list schema with two-shot examples", () => {
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /calloutKind=top_list/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /Назва \(1-2 слова\): пояснення \(1 речення\)/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /2-shot приклади/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /Добре:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /Погано:/i);
});

test("DEFAULT_IMAGE_PROMPT_TEMPLATE documents visualStyleGuide placeholder", () => {
  assert.match(DEFAULT_IMAGE_PROMPT_TEMPLATE, /\{\{visualStyleGuide\}\}/);
});

test("default editorial prompts forbid generic disclaimer injection for clarity edits", () => {
  assert.match(DEFAULT_BASE_PROMPT, /не додавай шаблонних медичних застережень/i);
  assert.match(DEFAULT_EXPERTISE_PROMPT, /Пунктуація списків:/i);
  assert.match(DEFAULT_CARDS_PROMPT, /не використовуй картки ясності для шаблонних медичних попереджень/i);
  assert.match(DEFAULT_CARDS_PROMPT, /зберігай scan-friendly подачу/i);
  assert.match(DEFAULT_CARDS_PROMPT, /починається з малої літери/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /починається з великої літери/i);
  assert.match(BULLET_LIST_PUNCTUATION_RULE, /крапкою з комою/i);
});

test("visual style preset helpers expose all supported presets and fallback safely", () => {
  const options = getVisualStylePresetOptions().map((option) => option.value);

  assert.deepEqual(options, ["minimal", "calm_gradient", "neo_brutal", "modern_glass"]);
  assert.match(getVisualStylePresetGuide("modern_glass"), /liquid-glass/i);
  assert.equal(normalizeVisualStylePreset("neo_brutal"), "neo_brutal");
  assert.equal(normalizeVisualStylePreset("unknown-style"), "calm_gradient");
});

test("Gemini defaults to the flash-lite preset", () => {
  assert.equal(getDefaultProviderModelId("gemini"), "gemini-3.1-flash-lite-preview");
  assert.equal(DEFAULT_EDITOR_SETTINGS.modelId, "gemini-3.1-flash-lite-preview");
});

test("writeEditorSettings persists selected Gemini connection to localStorage", () => {
  const storage = new Map<string, string>();
  const originalWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        }
      }
    }
  });

  try {
    writeEditorSettings({
      ...DEFAULT_EDITOR_SETTINGS,
      provider: "gemini",
      modelId: "gemini-2.5-flash"
    });

    const restored = readEditorSettings();
    assert.equal(restored.provider, "gemini");
    assert.equal(restored.modelId, "gemini-2.5-flash");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  }
});
