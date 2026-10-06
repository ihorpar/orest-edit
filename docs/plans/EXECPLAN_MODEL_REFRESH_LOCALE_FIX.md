# Model refresh to GPT-6 / Gemini 3.8 / Claude 5.5 plus app-language switch fix

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

If PLANS.md is present in the repo, maintain this document in accordance with it and link back to it by path.

## Purpose / Big Picture

After this change the editor offers current-generation provider models that are cheaper and stronger than the July 2026 set, saved outdated model ids migrate automatically to their successors, and the app-language selector in Settings reliably switches the UI between Ukrainian and English. The user can observe this by opening Settings, picking a model preset from the new GPT-6 / Gemini 3.8 / Claude 5.5 lineup, and switching the app language to English without the selector getting stuck.

## Milestones

### Milestone 1: Provider presets and automatic migration to new models

Status: Complete.

Done:
- OpenAI, Gemini, and Anthropic presets, defaults, legacy remap, and English locale descriptions updated.
- Unconditional Luna force-migration replaced with a conditional retired-id remap preserving provider choice.
- Copy placeholders, eval script default, and settings test suite updated; typecheck clean and 339/339 web tests pass.

Remaining:
- None.

Proof:
- npm run test -w @orest/web passes (339/339), including rewritten settings.test.ts assertions for gpt-6-luna, gpt-6.1-sol, gemini-3.8-flash, claude-opus-5-5, and claude-sonnet-5-5.
- Playwright runtime QA verified the new presets render per provider with no retired ids.

### Milestone 2: App-language switch works uk to en and back

Status: Complete.

Done:
- Controlled Select cancel path resets the visible value on dismissed confirm; no-op selections ignored; switched message uses the new locale copy.
- Runtime check: uk default, dismiss resets to uk with selector still functional, accept renders English with document.lang=en, switch back renders Ukrainian.

Remaining:
- None.

Proof:
- Playwright runtime QA against local dev server passed 12/12 checks, including the cancel-path regression check and an English Settings screenshot.

## Progress

- [x] (2026-10-06) Rewrote provider presets, defaults, legacy map, and migration in settings.ts.
- [x] (2026-10-06) Refreshed English provider descriptions in settings-locale-defaults.ts.
- [x] (2026-10-06) Updated model placeholders in uk/en copy catalogs and the eval script default.
- [x] (2026-10-06) Rewrote affected settings.test.ts assertions; typecheck clean and full web suite passes 339/339.
- [x] (2026-10-06) Fixed the language Select cancel/reset path and switched message locale.
- [x] (2026-10-06) Validated Settings page behavior in Playwright runtime QA (12/12) and recorded decisions in docs/DECISIONS_LOG.md and docs/CURRENT_STATE.md.

## Surprises & Discoveries

- Observation: the language Select is controlled by locale state, but the cancel branch returns early without resetting the native select element, so after one dismissed confirm the visible option and the stored locale disagree and further changes stop firing onChange.
  Evidence: apps/web/app/settings/page.tsx onChange handler with window.confirm and early return; Playwright cancel-path check confirmed the stuck value before the fix logic.
- Observation: Playwright login clicks raced React hydration on the dev server, so the QA script needed a settle wait plus submit retries before the submit handler was attached.
  Evidence: login-api stayed silent until a 5s post-render wait was added; after that login-api returned 200 and navigation succeeded.

## Decision Log

- Decision: OpenAI lineup becomes gpt-6.1-sol (strong workhorse, high reasoning), gpt-6-luna (efficient default, high reasoning), and gpt-6-luna-low (low-reasoning alias of gpt-6-luna); GPT-6 Astra is deliberately not added to keep the three-preset structure.
  Rationale: GPT-6.1 Sol (2026-10-02) and GPT-6 Luna (2026-09-22) are the current cheaper and stronger successors of GPT-5.6 Sol and Luna at $2/$10 and $0.10/$0.50 per million tokens.
  Date/Author: 2026-10-06.
- Decision: Gemini smart preset moves from gemini-3.7-flash to gemini-3.8-flash (GA 2026-09-28); the cheap gemini-3.5-flash-lite preset stays because it is still the stable low-latency tier.
  Rationale: provider docs list 3.8 Flash as the most intelligent workhorse with gains over 3.7 Flash, while 3.5 Flash-Lite remains stable since July 2026.
  Date/Author: 2026-10-06.
- Decision: Anthropic presets become claude-opus-5-5 and claude-sonnet-5-5 with claude-haiku-4-5 kept until Haiku 5.5 ships.
  Rationale: Opus 5.5 (2026-09-22) and Sonnet 5.5 (2026-09-28) are cheaper per task and stronger than the 4.6 generation; Haiku 5.5 is announced but not shipped.
  Date/Author: 2026-10-06.
- Decision: model migration preserves provider choice and only remaps retired ids instead of forcing every user back to OpenAI.
  Rationale: repeating the unconditional Luna force-migration would yank editors who deliberately chose Gemini or Anthropic after the first migration.
  Date/Author: 2026-10-06.

## Outcomes & Retrospective

Both milestones are complete. Settings now offers GPT-6.1 Sol, GPT-6 Luna, GPT-6 Luna low, Gemini 3.8 Flash, Gemini 3.5 Flash-Lite, Claude Opus 5.5, Claude Sonnet 5.5, and Claude Haiku 4.5, with retired ids auto-remapping and provider choice preserved. The app-language selector survives dismissed confirms and switches uk to en and back, verified by 12/12 Playwright runtime checks plus an English Settings screenshot. Remaining gap: Haiku 5.5 is not yet a preset because Anthropic has not shipped it; revisit when it launches. Lesson: controlled selects with confirm dialogs must reset the native element on cancel, and dev-server QA scripts must wait past hydration before submitting forms.

## SubAgent Code Review follow-up (2026-10-06)

An independent review pass reported one moderate inconsistency plus low-severity nits; all were cross-checked and resolved: the Anthropic validation ping now normalizes retired ids like the OpenAI/Gemini pings (with a new regression test); the migration raw-read uses the same whitespace canonicalization as `normalizeModelId`; the stale `gpt-5.6-luna` alias comment, the Sol description naming the excluded Astra, and the inaccurate reasoning-effort decision wording were corrected; dead Luna-migration scaffolding was removed. Rejected as intentional/by design: confirm dialog in the current locale, preset price/smartness tiers as documented editorial judgment, and Anthropic defaulting to Opus (pre-existing posture). Deferred: an in-repo automated regression test for the selector cancel path (no React test harness in the repo; covered by the 12/12 runtime QA). Final validation after fixes: typecheck clean, 340/340 web tests pass.

## Context and Orientation

The canonical editor model is block-first and patch-first; AI operations are block-anchored whole-block replacements. Provider and model selection lives in apps/web/lib/editor/settings.ts (PROVIDER_MODEL_PRESETS, DEFAULT_PROVIDER_MODEL_IDS, LEGACY_MODEL_ID_MAP, FORCED_DEFAULT_MODEL_ID, readEditorSettings, writeEditorSettings, sanitizeEditorSettings, resolveModelProfile, buildOpenAiRequestModelFields). English default prompts and provider descriptions live in apps/web/lib/editor/settings-locale-defaults.ts. UI copy lives in apps/web/lib/i18n/copy/uk.ts and en.ts. The app-language selector lives in apps/web/app/settings/page.tsx and state lives in apps/web/components/providers/ProductLocaleProvider.tsx backed by apps/web/lib/i18n/product-locale.ts. Server routes call resolveModelProfile and normalizeModelId in apps/web/lib/server/settings-validation.ts, patch-service.ts, review-service.ts, and review-action-service.ts, so remapping there automatically fixes in-flight requests. Tests live in apps/web/test/settings.test.ts with opaque modelId usage across other suites.

## Plan of Work

Prose description of the sequence of edits and additions. First update the preset tables, default ids, forced default id, reasoning effort type, legacy map, and migration helpers in settings.ts, then refresh English descriptions in settings-locale-defaults.ts. Next update the model placeholder copy, the eval script default, and the settings tests. Then fix the language Select handler so cancel resets event.target.value and the switched message uses the new locale copy. Finally run typecheck plus the full test suite and update docs/DECISIONS_LOG.md and docs/CURRENT_STATE.md.

## Concrete Steps

Exact commands to run (with working directory C:\Projects\oboz-ai\orest-edit). Include short expected outputs for comparison.

    npm run typecheck -w @orest/web

Expected: clean TypeScript with no errors.

    npm run test -w @orest/web

Expected: all node:test suites pass, including the rewritten settings tests.

## Validation and Acceptance

Behavioral acceptance: Settings shows GPT-6.1 Sol, GPT-6 Luna, GPT-6 Luna low, Gemini 3.8 Flash, Gemini 3.5 Flash-Lite, Claude Opus 5.5, Claude Sonnet 5.5, and Claude Haiku 4.5; a stored gpt-5.6-luna normalizes to gpt-6-luna; a stored gemini-3.7-flash normalizes to gemini-3.8-flash; stored claude 4.6 ids normalize to 5.5; switching app language to English renders English copy and switching back renders Ukrainian, including after a dismissed confirm. Test commands and expected results are listed above.

## Idempotence and Recovery

All edits are additive replacements of constant tables plus a conditional migration guarded by a new per-locale localStorage flag, so rerunning settings reads keeps already-migrated values stable. Rollback restores the previous preset tables and legacy map in settings.ts and settings-locale-defaults.ts plus the previous unconditional Luna migration flag.

## Artifacts and Notes

Concise transcripts, diffs, or snippets as indented examples.

## Interfaces and Dependencies

Provider model selection keeps stable function names and paths: getProviderModelPresets, getDefaultProviderModelId, normalizeModelId, resolveModelProfile, buildOpenAiRequestModelFields, readEditorSettings, writeEditorSettings, and sanitizeEditorSettings in apps/web/lib/editor/settings.ts. OpenAiReasoningEffort gains xhigh, max, and none alongside low, medium, and high. Migration keeps per-locale localStorage flags in apps/web/lib/i18n/product-locale.ts.
