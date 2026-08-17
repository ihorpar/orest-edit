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
  DEFAULT_WORKFLOW_STEP_PROMPTS,
  getDefaultProviderModelId,
  getForcedDefaultLunaMigrationStorageKey,
  getModelPresetOptionLabel,
  getProviderModelPresets,
  getVisualImageQualityProfile,
  getVisualStylePresetGuide,
  getVisualStylePresetOptions,
  normalizeModelId,
  normalizeVisualImageQuality,
  normalizeVisualStylePreset,
  resolveModelProfile,
  writeEditorSettings,
  readEditorSettings
} from "../lib/editor/settings.ts";
import { validateSettingsModel } from "../lib/server/settings-validation.ts";
import { getEditorSettingsStorageKey } from "../lib/i18n/product-locale.ts";

test("DEFAULT_CALLOUT_PROMPT_TEMPLATE documents every supported callout kind explicitly", () => {
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /mechanism:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /analogy:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /everyday_application:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /myths_vs_truth:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /top_list:/i);
});

test("DEFAULT_CALLOUT_PROMPT_TEMPLATE hardens top_list schema with two-shot examples", () => {
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /calloutKind=top_list/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /Коротка назва: пояснення/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /2-shot приклади/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /Добре:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /Погано:/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /читацьку рамку|цьому абзаці/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /Перекомпонувати цей фрагмент/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /непідкріплені медтвердження/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /Одне речення-переказ/i);
});

test("DEFAULT_IMAGE_PROMPT_TEMPLATE documents visualStyleGuide placeholder", () => {
  assert.match(DEFAULT_IMAGE_PROMPT_TEMPLATE, /\{\{visualStyleGuide\}\}/);
});

test("default editorial prompts forbid generic disclaimer injection for clarity edits", () => {
  assert.match(DEFAULT_BASE_PROMPT, /не додавай шаблонних медичних застережень/i);
  assert.match(DEFAULT_EXPERTISE_PROMPT, /Пунктуація списків:/i);
  assert.match(DEFAULT_EXPERTISE_PROMPT, /Працюй у режимі макродіагностики великого розділу/);
  assert.match(DEFAULT_EXPERTISE_PROMPT, /Починай відповідь відразу з заголовка «## Головний діагноз розділу»/);
  assert.match(DEFAULT_EXPERTISE_PROMPT, /не починай із похвали/i);
  assert.match(DEFAULT_EXPERTISE_PROMPT, /Поділи весь документ на великі смислові зони без пропусків/i);
  assert.match(DEFAULT_EXPERTISE_PROMPT, /Що зайве або дубльоване/);
  assert.match(DEFAULT_CARDS_PROMPT, /шаблонних медичних дисклеймерів/i);
  assert.match(DEFAULT_CARDS_PROMPT, /починається з малої літери/i);
  assert.match(DEFAULT_CALLOUT_PROMPT_TEMPLATE, /починається з великої літери/i);
  assert.match(BULLET_LIST_PUNCTUATION_RULE, /крапкою з комою/i);
});

test("default cards prompt keeps a compact callout contract without prepare-time drafting rules", () => {
  assert.match(DEFAULT_CARDS_PROMPT, /deep/i);
  assert.match(DEFAULT_CARDS_PROMPT, /brief/i);
  assert.match(DEFAULT_CARDS_PROMPT, /глобальну рамку/i);
  assert.match(DEFAULT_CARDS_PROMPT, /локальне винесення/i);
  assert.doesNotMatch(DEFAULT_CARDS_PROMPT, /prepare_callout/i);
  assert.doesNotMatch(DEFAULT_CARDS_PROMPT, /якорі-підзаголовки/i);
});

test("visual style preset helpers expose all supported presets and fallback safely", () => {
  const options = getVisualStylePresetOptions().map((option) => option.value);

  assert.deepEqual(options, ["minimal", "calm_gradient", "neo_brutal", "modern_glass"]);
  assert.match(getVisualStylePresetGuide("modern_glass"), /liquid-glass/i);
  assert.equal(normalizeVisualStylePreset("neo_brutal"), "neo_brutal");
  assert.equal(normalizeVisualStylePreset("unknown-style"), "calm_gradient");
});

test("Gemini provider default stays flash-lite; app default is OpenAI Luna", () => {
  assert.equal(getDefaultProviderModelId("gemini"), "gemini-3.5-flash-lite");
  assert.equal(getDefaultProviderModelId("openai"), "gpt-5.6-luna");
  assert.equal(DEFAULT_EDITOR_SETTINGS.provider, "openai");
  assert.equal(DEFAULT_EDITOR_SETTINGS.modelId, "gpt-5.6-luna");
});

test("OpenAI model presets only expose current GPT-5.6 Sol and Luna options", () => {
  assert.deepEqual(
    getProviderModelPresets("openai").map((preset) => preset.id),
    ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-luna-low"]
  );
});

test("model presets expose compact labels with smartness and price metadata", () => {
  const openAiLabels = getProviderModelPresets("openai").map((preset) => getModelPresetOptionLabel(preset));
  const geminiLabels = getProviderModelPresets("gemini").map((preset) => getModelPresetOptionLabel(preset));

  assert.deepEqual(openAiLabels, [
    "GPT-5.6 Sol [💡 10/10 | $$$$]",
    "GPT-5.6 Luna [💡 8/10 | $]",
    "GPT-5.6 Luna (low) [💡 6/10 | $]"
  ]);
  assert.equal(geminiLabels.length, 2);
  assert.match(geminiLabels[0] ?? "", /^Gemini 3\.7 Flash /);
  assert.match(geminiLabels[1] ?? "", /^Gemini 3\.5 Flash-Lite /);
  assert.ok(geminiLabels.every((label) => !/preview/i.test(label)));
});

test("OpenAI settings validation sends reasoning effort and does not send temperature", async () => {
  let requestBody: Record<string, unknown> | undefined;

  const result = await validateSettingsModel(
    {
      provider: "openai",
      modelId: "gpt-5.6-sol",
      apiKey: "openai-key"
    },
    {
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return new Response(JSON.stringify({ output_text: "OK" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      },
      now: () => "2026-05-07T12:00:00.000Z"
    }
  );

  assert.equal(result.state, "valid");
  assert.equal(requestBody?.model, "gpt-5.6-sol");
  assert.deepEqual(requestBody?.reasoning, { effort: "medium" });
  assert.equal("temperature" in (requestBody ?? {}), false);
});

test("legacy model ids remap to current presets", () => {
  assert.equal(normalizeModelId("openai", "gpt-5.4"), "gpt-5.6-luna");
  assert.equal(normalizeModelId("openai", "gpt-5.4-mini"), "gpt-5.6-luna-low");
  assert.equal(normalizeModelId("openai", "gpt-5.5"), "gpt-5.6-sol");
  assert.equal(normalizeModelId("gemini", "gemini-3.1-pro-preview"), "gemini-3.7-flash");
  assert.equal(normalizeModelId("gemini", "gemini-3.5-flash"), "gemini-3.7-flash");
  assert.equal(normalizeModelId("gemini", "gemini-3.6-flash"), "gemini-3.7-flash");
  assert.equal(normalizeModelId("gemini", "gemini-3.1-flash-lite-preview"), "gemini-3.5-flash-lite");
});

test("luna-low preset resolves to gpt-5.6-luna with low reasoning", () => {
  const profile = resolveModelProfile("openai", "gpt-5.6-luna-low");
  assert.equal(profile.apiModelId, "gpt-5.6-luna");
  assert.equal(profile.openaiReasoningEffort, "low");
});

test("default editor settings surface every workflow step prompt", () => {
  assert.deepEqual(Object.keys(DEFAULT_EDITOR_SETTINGS.workflowStepPrompts).sort(), Object.keys(DEFAULT_WORKFLOW_STEP_PROMPTS).sort());
  assert.match(DEFAULT_EDITOR_SETTINGS.workflowStepPrompts.fact_check, /фактчекер/i);
  assert.match(DEFAULT_EDITOR_SETTINGS.workflowStepPrompts.emphasis, /смислових акцентів/i);
});

test("visual image quality profiles expose fast lite and quality flash models", () => {
  assert.equal(getVisualImageQualityProfile("fast").modelId, "gemini-3.1-flash-lite-image");
  assert.equal(getVisualImageQualityProfile("fast").imageSize, "1K");
  assert.equal(getVisualImageQualityProfile("fast").thinkingLevel, "minimal");
  assert.equal(getVisualImageQualityProfile("quality").modelId, "gemini-3.1-flash-image");
  assert.equal(getVisualImageQualityProfile("quality").imageSize, "2K");
  assert.equal(normalizeVisualImageQuality("broken"), "fast");
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
      modelId: "gemini-2.5-flash",
      apiKey: "gemini-key"
    });

    const restored = readEditorSettings();
    assert.equal(restored.provider, "gemini");
    assert.equal(restored.modelId, "gemini-2.5-flash");
    assert.equal(restored.apiKey, "gemini-key");
    assert.equal(restored.apiKeys.gemini, "gemini-key");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  }
});

test("writeEditorSettings preserves provider-specific API keys when switching providers", () => {
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
      modelId: "gemini-3.5-flash-lite",
      apiKey: "gemini-key",
      apiKeys: {
        gemini: "gemini-key"
      }
    });

    writeEditorSettings({
      ...readEditorSettings(),
      provider: "openai",
      modelId: "gpt-5.6-sol",
      apiKey: "openai-key"
    });

    const restored = readEditorSettings();
    assert.equal(restored.provider, "openai");
    assert.equal(restored.apiKey, "openai-key");
    assert.equal(restored.apiKeys.openai, "openai-key");
    assert.equal(restored.apiKeys.gemini, "gemini-key");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  }
});

test("one-time Luna migration overwrites prior model then later changes persist", () => {
  const storage = new Map<string, string>();
  const originalWindow = globalThis.window;
  const settingsKey = getEditorSettingsStorageKey("uk");

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
    storage.set(
      settingsKey,
      JSON.stringify({
        ...DEFAULT_EDITOR_SETTINGS,
        provider: "gemini",
        modelId: "gemini-3.7-flash",
        apiKey: "gemini-key",
        apiKeys: {
          gemini: "gemini-key",
          openai: "openai-key"
        }
      })
    );

    assert.equal(storage.get(getForcedDefaultLunaMigrationStorageKey("uk")), undefined);

    const migrated = readEditorSettings("uk");
    assert.equal(migrated.provider, "openai");
    assert.equal(migrated.modelId, "gpt-5.6-luna");
    assert.equal(migrated.apiKey, "openai-key");
    assert.equal(migrated.apiKeys.gemini, "gemini-key");
    assert.equal(storage.get(getForcedDefaultLunaMigrationStorageKey("uk")), "1");

    writeEditorSettings({
      ...migrated,
      provider: "gemini",
      modelId: "gemini-3.7-flash",
      apiKey: "gemini-key"
    });

    const restored = readEditorSettings("uk");
    assert.equal(restored.provider, "gemini");
    assert.equal(restored.modelId, "gemini-3.7-flash");
    assert.equal(restored.apiKey, "gemini-key");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  }
});
