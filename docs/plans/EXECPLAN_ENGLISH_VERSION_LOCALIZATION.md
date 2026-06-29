# Add an English edition through product localization

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

This plan follows `PLANS.md`.

## Purpose / Big Picture

Ship an English edition of the existing Orest Edit app without cloning the repository. The result should be one application with centralized locale catalogs for UI labels, prompts, provider-facing labels, LanguageTool configuration, default settings, default visual prompt language, document export metadata, and local storage keys. The editor should default to the configured product locale but also let the user switch language in Settings.

The user-visible outcome is that an editor can choose Ukrainian or English in Settings, see the UI switch to that language, run spelling and grammar checks through the matching LanguageTool language, generate editorial recommendations in the selected language for science-pop and medical-pop manuscripts, inspect diffs before accepting changes, and export a document whose language metadata matches the selected language.

This is not a manuscript translation feature. The English edition edits English manuscripts in English. A future cross-language translation workflow should be planned separately.

## Progress

- [x] (2026-06-24 23:26-04:00) Read `docs/CURRENT_STATE.md`, `PLANS.md`, archived `docs/plans/archive/PRD_V1.md`, and the relevant app/server/editor modules.
- [x] (2026-06-24 23:26-04:00) Chose a same-repo English edition over a cloned standalone repo.
- [x] (2026-06-24 23:26-04:00) Documented the implementation plan.
- [x] (2026-06-25) Revised the plan to support centralized locale catalogs plus a user-facing Settings language switch.
- [x] (2026-06-25) Recorded concrete product decisions for language switching, locale-scoped prompts, and analysis reset behavior.
- [x] (2026-06-25) Incorporated subagent review findings about persistence split, async job locale safety, and missing file coverage.
- [x] (2026-06-25) Implemented the locale foundation, locale provider, locale catalogs, and locale-scoped storage helpers for active locale, editor settings, drafts, visual style, assets, and spellcheck dictionaries.
- [x] (2026-06-25) Moved high-traffic UI copy, workflow labels, top bar labels, login copy, and settings language-switch copy behind locale-aware helpers.
- [x] (2026-06-25) Wired locale-aware LanguageTool selection, locale-aware DOCX export metadata/default filename, locale-aware workflow labels, and stable internal fact-check statuses.
- [x] (2026-06-25) Kept provider failures fail-loud in patch/review paths and removed fallback expectations from the test surface.
- [x] (2026-06-25) Passed `npm run typecheck -w @orest/web`, the targeted localization regression suite, and `npm run test -w @orest/web`.

## Surprises & Discoveries

- Observation: `docs/PRD_V1.md` is referenced by `AGENTS.md`, but the active path is missing. The available PRD copy is archived at `docs/plans/archive/PRD_V1.md`.
  Evidence: `Get-Content -Raw docs\PRD_V1.md` failed, while `docs\plans\archive\PRD_V1.md` exists.

- Observation: Language is a product concern, not only a UI concern. Ukrainian appears in default prompts, workflow labels, review taxonomy labels, fact-check status values, paragraph labels, local-action routing, spellcheck, settings, DOCX metadata, model descriptions, provider errors, and runtime feedback.
  Evidence: `rg -n "uk-UA|DEFAULT_WORKFLOW_STEP_PROMPTS|DEFAULT_BASE_PROMPT|LanguageTool" apps\web` plus a Cyrillic text search points to `apps/web/lib/editor/settings.ts`, `apps/web/app/editor/page.tsx`, `apps/web/lib/editor/review-contract.ts`, `apps/web/lib/server/review-service.ts`, and `apps/web/lib/server/spellcheck-service.ts`.

- Observation: The repository already has a project rule to fail loud on LLM errors, but the server layer still contains synthetic fallback code that can look like model output.
  Evidence: `apps/web/lib/server/review-service.ts` has `buildFallbackEditorialReviewResponse`, `createFallbackEditorialReviewItems`, and `createFallbackDiagnosticsExpertise`; `apps/web/lib/server/patch-service.ts` has `createFallbackOperations` and local rewrite helpers.

- Observation: The current spellcheck contract is hard-coded to Ukrainian.
  Evidence: `apps/web/lib/editor/spellcheck-contract.ts` defines `SpellcheckLanguage = "uk-UA"`, `apps/web/app/api/edit/spellcheck/route.ts` rejects anything except `uk-UA`, and `apps/web/app/editor/page.tsx` posts `language: "uk-UA"`.

- Observation: queued review and image jobs currently do not store locale, so a result generated before a locale switch can still land in the wrong runtime session.
  Evidence: `apps/web/lib/server/review-job-service.ts` and `apps/web/lib/server/review-image-job-service.ts` store job status and responses, but no locale field.

- Observation: current persisted draft state mixes manuscript content with locale-bound analysis and visible localized feedback/history strings.
  Evidence: `apps/web/lib/editor/draft-state.ts` stores `document`, `reviewItems`, `factCheckRows`, `history`, `feedback`, and other derived analysis state in one persisted object.

- Observation: the current implementation pass landed the locale foundation and helper contracts, but the live `/editor` runtime still does not fully consume them. Draft persistence, spellcheck language/dictionary selection, async job locale guards, and large parts of editor/settings copy remain hardwired to the Ukrainian path.
  Evidence: subagent code review on 2026-06-28 pointed to `apps/web/app/editor/page.tsx`, `apps/web/lib/editor/spellcheck-dictionary.ts`, `apps/web/app/api/edit/review/proposal/route.ts`, and `apps/web/app/settings/page.tsx` as the main incomplete runtime surfaces.

## Decision Log

- Decision: Do not clone the repo for the English app. Keep one source tree with centralized locale catalogs and a runtime app language setting. Deployment configuration may still provide the initial default, for example `NEXT_PUBLIC_OREST_APP_LOCALE=en`, but the user can change language in Settings.
  Rationale: The editor core is complex and highly stateful: block editing, diff application, review jobs, inline proposal execution, spellcheck underlines, image jobs, import/export, history, and settings already share the same behavior. Cloning would duplicate this behavior and make fixes drift. A runtime locale gives one shared code path while still supporting English and Ukrainian editorial workflows.
  Date/Author: 2026-06-24 / Codex

- Decision: The first English release should include an in-app language selector in Settings, backed by locale-scoped settings/drafts/dictionaries. Switching language keeps the current manuscript visible, uses locale-scoped prompt templates, and clears the entire locale-bound analysis layer instead of switching to a different saved draft automatically.
  Rationale: This keeps the interaction predictable. The editor does not lose the current manuscript, but the app also avoids showing stale review, spellcheck, or prompt state from the previous locale.
  Date/Author: 2026-06-25 / Codex

- Decision: Keep internal action enums stable and English-like, and localize labels around them.
  Rationale: Values like `rewrite`, `simplify`, `callout`, `visual`, `brief`, and `deep` are already good internal identifiers. User-facing strings and provider-facing labels should move to locale catalogs. Existing Ukrainian persisted values and provider outputs must remain accepted during normalization.
  Date/Author: 2026-06-24 / Codex

- Decision: English spellcheck in v1 is only `en-US`.
  Rationale: This keeps the first locale switch simple and avoids inventing a second English variant surface before it is needed.
  Date/Author: 2026-06-24 / Codex

- Decision: Deployment env is only the initial locale default. After the first explicit user choice, the persisted active locale wins.
  Rationale: This matches the intended product behavior of a real runtime language switch rather than a deploy-bound edition selector.
  Date/Author: 2026-06-25 / Codex

- Decision: Custom prompt templates are stored separately per locale.
  Rationale: English custom prompts and Ukrainian custom prompts should not overwrite each other or silently leak across workflows.
  Date/Author: 2026-06-25 / Codex

## Outcomes & Retrospective

Implemented in the current workspace:

- one repo with a locale foundation under `apps/web/lib/i18n/`
- a Settings language switch with persisted active locale
- locale-scoped settings/draft/job payload support
- locale-aware spellcheck contract (`uk-UA`, `en-US`) and DOCX export metadata
- stable internal fact-check statuses (`ok`, `questionable`, `unsupported`)
- green `typecheck` and full `@orest/web` test suite

Follow-up work still worth doing in a later pass:

- complete the remaining editor/settings string sweep so secondary surfaces do not leak Ukrainian copy in English mode
- finish locale-aware prompt text inside all server prompt builders, especially `patch-service.ts` and `review-action-service.ts`
- wire locale-scoped spellcheck dictionaries and locale-switch manuscript/session reset behavior all the way through the live `/editor` runtime

High-priority unfinished items confirmed by subagent review on 2026-06-28:

- `/editor` still reads/writes draft state without passing locale, so locale-scoped persistence and locale-bound analysis reset are not complete
- spellcheck runtime still behaves as Ukrainian-first: request language, history labels, and IndexedDB dictionary usage are not fully locale-aware
- async review/image job polling does not yet reject stale results from a previous locale
- proposal/review/patch prompt builders still contain Ukrainian-only prompt text in several server paths
- the Settings page and core editor workspace still need a full English copy sweep

## Context and Orientation

The app is a Next.js workspace under `apps/web`. The main editor route is `apps/web/app/editor/page.tsx`. It owns the workflow step rail, local composer, spellcheck orchestration, request feedback, step state, review execution, and a large amount of Ukrainian copy.

Default AI behavior and model settings live in `apps/web/lib/editor/settings.ts`. This file currently contains Ukrainian default prompts: `DEFAULT_BASE_PROMPT`, `DEFAULT_EXPERTISE_PROMPT`, `DEFAULT_CARDS_PROMPT`, `DEFAULT_REVIEW_LEVEL_GUIDE`, `DEFAULT_WORKFLOW_STEP_PROMPTS`, `DEFAULT_CALLOUT_PROMPT_TEMPLATE`, and `DEFAULT_IMAGE_PROMPT_TEMPLATE`. It also defines `EDITOR_SETTINGS_STORAGE_KEY`, `VISUAL_STYLE_PRESET_STORAGE_KEY`, provider model descriptions, and visual style labels/guides.

Workflow and review contracts live in `apps/web/lib/editor/review-contract.ts`. The internal recommendation types are already English identifiers, but labels, callout kind titles, visual intent labels, fact-check status strings, paragraph labels, and paragraph-reference parsing are Ukrainian-specific in places.

The server review flow lives in `apps/web/lib/server/review-service.ts`. It defines `REVIEW_STEP_SPECS`, step titles, card guidance, system prompt assembly, user prompt assembly, fact-check status normalization, grounded source behavior, fallback review item generation, and fallback diagnostics generation.

Local proposal generation lives in `apps/web/lib/server/review-action-service.ts`. It builds replace, callout, subsection, and image prompts, parses model output, and includes fallback prompt/body generation for callout and image flows.

Patch generation lives in `apps/web/lib/server/patch-service.ts`. It creates local patch operations through OpenAI, Gemini, or Anthropic and still contains local fallback rewrite logic.

Spellcheck contracts and routing live in `apps/web/lib/editor/spellcheck-contract.ts`, `apps/web/lib/editor/spellcheck-view-model.ts`, `apps/web/lib/editor/spellcheck-dictionary.ts`, `apps/web/lib/server/spellcheck-service.ts`, and `apps/web/app/api/edit/spellcheck/route.ts`. The current contract accepts only `uk-UA`, posts to LanguageTool, maps offsets back to block-local issues, and stores ignored words in an IndexedDB database named `orest-spellcheck-dictionary-v1`.

DOCX export lives in `apps/web/lib/editor/docx-export.ts`. It currently uses a Ukrainian default filename base and document language metadata `uk-UA`.

Persistent browser state lives in `apps/web/lib/editor/draft-state.ts`, `apps/web/lib/editor/settings.ts`, `apps/web/lib/editor/spellcheck-dictionary.ts`, and `apps/web/lib/editor/asset-store.ts`. The important keys are `orest-editor-draft-v3`, `orest-editor-settings-v1`, `orest-visual-style-v1`, `orest-spellcheck-dictionary-v1`, and `orest-editor-assets-v1`.

Queued async state also matters. `apps/web/lib/server/review-job-service.ts` and `apps/web/lib/server/review-image-job-service.ts` hold in-memory jobs that can complete after the user changes locale, so locale must become part of queued job state and client-side poll/apply guards.

## Plan of Work

Introduce a small product-locale foundation before translating strings. Add `apps/web/lib/i18n/product-locale.ts` with `AppLocale = "uk" | "en"`, `DEFAULT_APP_LOCALE`, `getConfiguredAppLocale()`, `getActiveAppLocale()`, `writeActiveAppLocale(locale)`, `getLocaleStorageSuffix(locale)`, and a map from locale to spellcheck language, document language, display locale, paragraph label, default filename base, and product copy.

Use deployment configuration only as the initial/default selector. `NEXT_PUBLIC_OREST_APP_LOCALE=en` should make a fresh browser session start in English, but after the first explicit user choice the active locale stored in browser state wins. Request payloads for review, proposal, patch, spellcheck, and image routes must include `locale`, so server behavior follows the user's current selection rather than relying on process configuration.

Split default settings and prompts by locale. Keep the existing Ukrainian prompt content intact, but move it into a Ukrainian catalog. Add a new English catalog with equivalent editorial intent: edit English science-pop and medical-pop manuscripts into clear, readable English; preserve meaning and author intent; keep edits local; show diff-first changes; avoid generic medical disclaimers unless requested or present in the source. The English default image prompt must instruct image models to produce English labels when labels are needed. User-edited prompt templates must be stored per locale so switching language does not overwrite custom Ukrainian prompts with English defaults or the reverse.

Move UI strings out of `apps/web/app/editor/page.tsx`, `apps/web/app/settings/page.tsx`, `apps/web/app/login/page.tsx`, `apps/web/components/layout/*.tsx`, `apps/web/components/editor/*.tsx`, and `apps/web/lib/editor/workflow-ui.ts` into locale-aware catalogs where practical. Do this incrementally, starting with high-traffic strings: workflow steps, step summaries, primary CTA labels, status chips, spellcheck card labels, compare/history labels, local composer modes, settings labels, login page text, top bar labels, and destructive action dialogs.

Keep UI component APIs simple. Do not introduce a heavy i18n framework unless the codebase clearly needs it. A typed catalog imported through a small hook such as `useProductLocaleCopy()` is enough for this two-locale product.

Make storage locale-specific. Replace fixed keys with helpers:

    getActiveLocaleStorageKey() -> orest-active-locale-v1
    getEditorSettingsStorageKey(locale) -> orest-editor-settings-en-v1 or orest-editor-settings-uk-v1
    getEditorDraftStorageKey(locale) -> orest-editor-draft-en-v1 or orest-editor-draft-uk-v3
    getVisualStylePresetStorageKey(locale) -> orest-visual-style-en-v1 or orest-visual-style-uk-v1
    getSpellcheckDictionaryDbName(locale) -> orest-spellcheck-dictionary-en-v1 or orest-spellcheck-dictionary-uk-v1

For Ukrainian, either continue reading existing keys first or migrate existing values into the new `uk` keys on first load. For English, never read Ukrainian drafts/settings by accident. If implementation starts while users have active Ukrainian drafts, preserve backward compatibility by reading old Ukrainian keys and writing the locale-suffixed key after sanitization. The active locale key should be global, but drafts, prompt settings, visual style preference, and spellcheck dictionary should be locale-scoped.

Make persistence architecture explicit instead of relying on the current all-in-one draft blob. The implementation should preserve the current manuscript in memory across locale switches while treating derived review/spellcheck/history/feedback state as locale-bound. The safest implementation path is:

    keep current document + revision in memory during the switch
    load target-locale settings/prompts only
    clear locale-bound derived fields before the next persist
    never auto-load another locale's saved draft during the switch

Classify state clearly in the implementation plan:

    global manuscript state: document, revision, current visible manuscript content
    locale-bound persisted state: review results, fact-check rows, step feedback/history labels, compare/history copy, prompt templates, spellcheck dictionary
    locale-bound ephemeral state: AI activity messages, request feedback banners, transient job notifications, in-flight locale-specific analysis
    global safe-to-share UI state: panel position and similar non-linguistic chrome where appropriate

Add a language selector to `apps/web/app/settings/page.tsx`. The selector should write the active app locale, dispatch a locale-updated browser event, reload or rehydrate locale-scoped settings, and make the rest of the app render from the selected catalog. When switching language while a manuscript is open, the app should keep the current document visible, preserve manuscript content, and clear the entire locale-bound analysis layer after confirmation rather than auto-opening another locale's draft.

Update review contracts for localized display while keeping stable internal data. Convert fact-check status handling to prefer stable internal statuses such as `ok`, `questionable`, and `unsupported`, while continuing to normalize existing Ukrainian localized values from older data and model output. Add localized labels for each status. Update paragraph-range helpers to return the Ukrainian paragraph prefix in Ukrainian mode and `Para. 001` in English mode, and update paragraph-reference parsing to accept both Ukrainian forms and English forms such as `para.`, `paragraph`, and `p.`.

Update local-action routing. `apps/web/lib/editor/local-action-router.ts` should accept `locale` and use localized text intent labels, action labels, clarify messages, keyword detection, and generated patch instructions. English detection should recognize commands like `spell`, `grammar`, `rewrite`, `shorten`, `make a list`, `heading`, `callout`, `sidebar`, `visual`, `image`, `diagram`, and `infographic`. Ukrainian detection should keep the current patterns.

Update LanguageTool. Extend `SpellcheckLanguage` to include `uk-UA` and `en-US`. The editor should send the locale's spellcheck language rather than hard-coded `uk-UA`. The spellcheck route should validate language against locale. The dictionary normalizer should use `toLocaleLowerCase(locale.displayLocale)` rather than `uk-UA`. The view model should format paragraph labels through a locale helper.

Update DOCX export. Use locale-specific default file names, document language metadata, and any visible export labels. For English, the default filename base should be `Manuscript` and the language metadata should be `en-US`.

Update date and number formatting. Replace hard-coded `new Intl.DateTimeFormat("uk-UA", ...)` and `new Intl.NumberFormat("uk-UA")` with locale config. English should use `en-US` unless a future regional setting is added.

Add async locale safety for queued jobs. Review jobs and image jobs must persist `locale` in their queued state and public job responses. Client polling/apply logic must ignore, invalidate, or surface-as-stale any completed job whose locale no longer matches the active locale.

Tighten fact-check status migration. The current contract uses localized values directly, so the implementation must migrate to internal stable status enums, normalize legacy Ukrainian values on read and on provider-output parse, and map display labels from locale catalogs.

Remove or hard-disable synthetic AI fallbacks. In `apps/web/lib/server/patch-service.ts`, provider/API errors, missing keys, empty output, invalid JSON, and invalid operations should return an error with zero operations. In `apps/web/lib/server/review-service.ts`, failed review calls should return zero items, zero fact rows, no synthetic diagnostics, and a visible error. Existing fallback helper functions can be deleted if tests no longer use them, or retained only under an explicit test-only flag that is unavailable in production. This satisfies the project rule that LLM errors must fail loud.

Audit proposal fallbacks separately. `review-action-service.ts` has fallback prompt/body builders used when parsing provider output or when creating manual prompt shells. Keep deterministic UI scaffolding where it cannot be mistaken for model output, but do not show synthetic prose as a successful AI draft after provider failure. Error proposals should carry the actual provider error and block apply/insert.

Update tests alongside each layer. Add a locale-focused test file if useful, for example `apps/web/test/product-locale.test.ts`, and extend existing tests for settings, spellcheck route/service, review contract, local-action router, docx export, workflow UI, patch service, review service, and review action service.

Update docs. Add the durable architecture decision to `docs/DECISIONS_LOG.md`, update `docs/CURRENT_STATE.md` after implementation, and revise `docs/spellcheck_api_contract.md` from "uk-UA fixed in v1" to "locale-selected language with uk-UA and en-US supported."

## Concrete Steps

1. Add locale foundation.

   Working directory:

       C:\Projects\oboz-ai\orest-edit

   Create:

       apps/web/lib/i18n/product-locale.ts
       apps/web/lib/i18n/copy/uk.ts
       apps/web/lib/i18n/copy/en.ts

   The first module should expose typed helpers for configured/default locale, active runtime locale, storage suffixes, display locale, spellcheck language, DOCX language, paragraph labels, and default filename base.

2. Split settings and prompt defaults.

   Refactor `apps/web/lib/editor/settings.ts` so the exported default settings can be resolved by locale:

       getDefaultEditorSettings(locale: AppLocale): EditorSettings
       sanitizeEditorSettings(candidate, locale): EditorSettings
       readEditorSettings(locale): EditorSettings
       writeEditorSettings(settings, locale): EditorSettings

   Preserve legacy `DEFAULT_EDITOR_SETTINGS` as Ukrainian or replace imports in one pass. Add `DEFAULT_EDITOR_SETTINGS_BY_LOCALE`.

3. Add the Settings language selector.

   Update `apps/web/app/settings/page.tsx` with a Ukrainian/English selector. Store the active locale in `orest-active-locale-v1`, dispatch an app-level event such as `orest-app-locale-updated`, and reload locale-scoped settings after the switch.

   The switch must make it obvious that it changes UI, prompt defaults, LanguageTool language, and export language. It should not imply that it translates the current manuscript. On confirm, keep the current manuscript, preserve its text, and clear the locale-bound analysis layer.

4. Localize UI copy in the main surfaces.

   Start with `apps/web/app/editor/page.tsx`, `apps/web/lib/editor/workflow-ui.ts`, `apps/web/app/settings/page.tsx`, `apps/web/app/login/page.tsx`, `apps/web/app/sources/page.tsx`, `apps/web/components/layout/TopBar.tsx`, `apps/web/components/editor/FloatingComposerPanel.tsx`, `apps/web/components/editor/EditorialReviewCard.tsx`, `apps/web/components/layout/ReviewRecommendationDetail.tsx`, `apps/web/components/layout/RightOperationsRail.tsx`, `apps/web/components/layout/EditorialReviewDrawer.tsx`, `apps/web/components/layout/ReviewRecommendationsSidebar.tsx`, and `apps/web/components/providers/AiActivityProvider.tsx`.

   Keep icons and existing layout behavior.

   Add one repo-wide localized-copy sweep pass near the end of implementation so we do not ship isolated Ukrainian leaks from secondary routes or providers after the main editor screens are translated.

5. Localize review contracts and prompt assembly.

   Update `apps/web/lib/editor/review-contract.ts`, `apps/web/lib/server/review-service.ts`, `apps/web/lib/server/review-action-service.ts`, `apps/web/lib/editor/manual-review-items.ts`, and `apps/web/lib/editor/manuscript-structure.ts` to accept locale and use localized labels, card guidance, status labels, callout labels, visual labels, fact-check labels, and paragraph references.

   Keep structured output enums stable. Provider prompts may mention localized display labels, but JSON enum values should remain internal English identifiers.

   Migrate fact-check status to internal stable values only, normalize legacy Ukrainian values during persisted-state reads and provider-output parsing, and render status labels through locale catalogs.

6. Localize patch and local-action prompts.

   Update `apps/web/lib/editor/local-action-router.ts` and `apps/web/lib/server/patch-service.ts` so generated instructions are English in English mode and Ukrainian in Ukrainian mode.

   Ensure patch requests include locale and that provider prompts still require local, diff-first, patch-first edits.

7. Make spellcheck locale-aware.

   Update `apps/web/lib/editor/spellcheck-contract.ts`, `apps/web/app/api/edit/spellcheck/route.ts`, `apps/web/lib/server/spellcheck-service.ts`, `apps/web/lib/editor/spellcheck-view-model.ts`, `apps/web/lib/editor/spellcheck-dictionary.ts`, and the spellcheck call site in `apps/web/app/editor/page.tsx`.

   English mode should post `language: "en-US"` to LanguageTool.

   Ensure spellcheck paragraph labels and category/severity labels come from locale-aware helpers rather than embedded Ukrainian strings.

8. Make persistence and export locale-aware.

   Update `apps/web/lib/editor/draft-state.ts`, `apps/web/lib/editor/settings.ts`, `apps/web/lib/editor/spellcheck-dictionary.ts`, `apps/web/lib/editor/asset-store.ts` if asset isolation is needed, `apps/web/lib/editor/docx-export.ts`, and the top bar/export code.

   English local storage must not load the Ukrainian draft. Ukrainian existing drafts must remain readable.

   Add explicit tests around `readEditorDraftState` / `writeEditorDraftState` and the locale switch algorithm so the app preserves the current manuscript while clearing locale-bound derived state.

9. Add async locale safety for background jobs.

   Update `apps/web/lib/server/review-job-service.ts`, `apps/web/lib/server/review-image-job-service.ts`, client polling logic in `apps/web/app/editor/page.tsx`, and any related review-image consumers so queued jobs store locale and completed jobs are ignored or marked stale if their locale does not match the active app locale.

10. Remove synthetic provider fallbacks.

   Update `apps/web/lib/server/patch-service.ts` and `apps/web/lib/server/review-service.ts` so failed AI calls return errors with no generated operations/items. Update any tests that expected fallback output to expect loud error state instead.

11. Update tests.

   Run targeted tests after each milestone:

       npm run typecheck -w @orest/web
       node --import tsx --test apps/web/test/settings.test.ts apps/web/test/spellcheck-route.test.ts apps/web/test/spellcheck-service.test.ts apps/web/test/spellcheck-dictionary.test.ts
       node --import tsx --test apps/web/test/local-action-router.test.ts apps/web/test/review-contract.test.ts apps/web/test/review-service.test.ts apps/web/test/review-action-service.test.ts apps/web/test/patch-service.test.ts
       node --import tsx --test apps/web/test/review-job-service.test.ts apps/web/test/review-image-job-service.test.ts apps/web/test/draft-state.test.ts
       node --import tsx --test apps/web/test/docx-export.test.ts apps/web/test/workflow-ui.test.ts
       npm run test -w @orest/web

12. Runtime validation.

    Start the dev server:

        $env:NEXT_PUBLIC_OREST_APP_LOCALE="en"; $env:OREST_APP_LOCALE="en"; npm run dev -w @orest/web -- --hostname 127.0.0.1 --port 3000

    Open `http://127.0.0.1:3000/editor`. If login is enabled, authenticate through `POST /api/auth/login` with `APP_PASSWORD` from `.env` or `.env.local` as the project notes describe.

    Validate without screenshots unless explicitly requested:

    - English login/settings/editor UI renders by default when configured.
    - Switching language in Settings updates the settings page, top bar, editor workflow rail, local composer, and visible status labels.
    - Local composer modes and CTAs are English.
    - Spellcheck request payload uses `en-US`.
    - LanguageTool errors are visible in English.
    - A provider missing-key state shows an error and no synthetic draft.
    - A review request returns English recommendations when a provider key is configured.
    - Ukrainian mode still renders Ukrainian when selected in Settings or configured as default.
    - Switching locale keeps the current manuscript text visible.
    - Switching locale clears review, spellcheck, and other locale-bound analysis state.
    - Switching locale while a review job is still processing does not inject old-locale results into the current session.
    - Settings model descriptions, validation messages, and login/auth errors render in the selected locale.

## Validation and Acceptance

The change is accepted when all of the following are true:

- With English selected in Settings, the editor, settings, login, local composer, workflow steps, status banners, spellcheck cards, compare/history labels, and export affordances are English.
- With Ukrainian selected in Settings, the existing Ukrainian app still behaves as before.
- Changing language in Settings persists across refresh and reloads locale-scoped settings/prompts without overwriting the other locale's custom settings.
- Switching locale keeps the current manuscript content visible rather than auto-switching to another locale's saved draft.
- English default prompts instruct providers to edit English science-pop and medical-pop manuscripts into clear, readable English while preserving meaning, author intent, patch-first behavior, diff-first review, and short reasons.
- Ukrainian default prompts remain intact.
- Spellcheck sends `en-US` in English mode and `uk-UA` in Ukrainian mode, and server validation accepts only those two language values in v1.
- English and Ukrainian local drafts/settings/dictionaries do not overwrite each other.
- English and Ukrainian custom prompt templates do not overwrite each other.
- Switching language clears or invalidates the full locale-bound analysis layer produced under the previous locale, while preserving the manuscript itself.
- No persisted Ukrainian status/history/feedback copy reappears after switching to English.
- DOCX export uses English defaults in English mode and Ukrainian defaults in Ukrainian mode.
- Queued review/image jobs from the previous locale do not rehydrate visible results into the active locale session.
- Provider errors, missing keys, invalid/empty output, and timeouts surface as errors with no synthetic successful AI operations, review cards, diagnostics, or local drafts.
- `npm run typecheck -w @orest/web` passes.
- `npm run test -w @orest/web` passes.
- A no-screenshot runtime smoke confirms both locale configurations can load the editor.

Expected test evidence should look like:

    npm run typecheck -w @orest/web
    # exits 0

    npm run test -w @orest/web
    # all test files pass

## Idempotence and Recovery

Locale catalog changes are additive and can be retried safely. Keep Ukrainian defaults in their original content while moving them, then add English equivalents. This makes review easier and keeps fallback rollback simple.

Storage migration must be conservative. Read old Ukrainian keys, write new Ukrainian keys, and never delete old keys until a later cleanup plan. English keys should be new, so retrying migration is harmless. The active locale key can be rewritten freely, but locale-scoped drafts/settings/dictionaries should not be deleted by switching.

If a milestone creates too large a diff, pause after the locale foundation plus settings/prompt split. The app should still run in Ukrainian mode at that point. Then localize UI surfaces in separate commits.

If runtime validation finds mixed-language copy, use targeted `rg -n -P "\p{Cyrillic}" apps/web` and inspect only files that should be English-facing. Do not remove Ukrainian catalogs or tests.

If provider behavior regresses, first verify that request payloads include the locale and that server prompt assembly uses the same locale. Then inspect `rawOutput` diagnostics in tests or local logs without printing API keys.

## Artifacts and Notes

Research commands used to build this plan:

    rg --files
    rg -n "LanguageTool|language|uk-UA|Ukrainian|locale|spellcheck" apps\web docs
    rg -n -P "\p{Cyrillic}" apps\web\lib apps\web\components apps\web\app --glob "*.ts" --glob "*.tsx"
    rg -n "DEFAULT_|WORKFLOW_STEPS|SpellcheckLanguage|uk-UA|FactCheckStatus|EDITOR_SETTINGS_STORAGE_KEY|DRAFT_STATE_STORAGE_KEY" apps\web\lib apps\web\app apps\web\components
    rg -n "fallback|buildFallback|createFallback|missing|error|unavailable" apps\web\lib\server

Important files found:

    apps/web/app/editor/page.tsx
    apps/web/app/settings/page.tsx
    apps/web/app/login/page.tsx
    apps/web/lib/editor/settings.ts
    apps/web/lib/editor/review-contract.ts
    apps/web/lib/editor/local-action-router.ts
    apps/web/lib/editor/manual-review-items.ts
    apps/web/lib/editor/spellcheck-contract.ts
    apps/web/lib/editor/spellcheck-view-model.ts
    apps/web/lib/editor/spellcheck-dictionary.ts
    apps/web/lib/editor/docx-export.ts
    apps/web/lib/editor/draft-state.ts
    apps/web/lib/server/patch-service.ts
    apps/web/lib/server/review-service.ts
    apps/web/lib/server/review-action-service.ts
    apps/web/lib/server/spellcheck-service.ts
    apps/web/app/api/edit/spellcheck/route.ts
    docs/spellcheck_api_contract.md
    docs/DECISIONS_LOG.md

## Interfaces and Dependencies

Add these core interfaces:

    export type AppLocale = "uk" | "en";

    export interface ProductLocaleConfig {
      appLocale: AppLocale;
      displayLocale: "uk-UA" | "en-US";
      spellcheckLanguage: "uk-UA" | "en-US";
      docxLanguage: "uk-UA" | "en-US";
      storageSuffix: "uk" | "en";
      defaultFileNameBase: string;
      paragraphShortLabel: string;
    }

    export function getConfiguredAppLocale(): AppLocale;
    export function readActiveAppLocale(): AppLocale;
    export function writeActiveAppLocale(locale: AppLocale): void;
    export function getProductLocaleConfig(locale?: AppLocale): ProductLocaleConfig;
    export function getActiveLocaleStorageKey(): string;
    export function getEditorSettingsStorageKey(locale: AppLocale): string;
    export function getEditorDraftStorageKey(locale: AppLocale): string;
    export function formatParagraphRangeLabel(locale: AppLocale, startIndex: number, endIndex?: number): string;

Extend request interfaces:

    PatchRequest.locale?: AppLocale
    EditorialReviewRequest.locale?: AppLocale
    ReviewActionRequest.locale?: AppLocale
    ReviewImageGenerationRequest.locale?: AppLocale
    SpellcheckRequest.locale?: AppLocale

Keep existing route paths unchanged:

    POST /api/edit/patch
    POST /api/edit/review
    POST /api/edit/review/proposal
    POST /api/edit/review/image
    POST /api/edit/spellcheck
    POST /api/edit/local-action

No new external dependency is required for the first implementation.
