# Build a working patch-first editor vertical slice

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`C:\Projects\oboz-ai\orest-edit\PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

## Purpose / Big Picture

The immediate goal is to turn the current UI prototype into the first working product slice.

After this work, a user can open the editor, edit manuscript text directly, select a fragment, send either the default edit action or a custom request, receive local patch proposals with short reasons, review them as a diff, and accept or reject them.

This is the smallest outcome that makes the product real. It still deliberately avoids broad scope such as source workflows, strict-medical controls, or export flows.

## Progress

- [x] (2026-03-05 00:00Z) Rebuilt the project as a web-only Next.js app in `apps/web`.
- [x] (2026-03-05 00:00Z) Implemented the current sample4-based editor UI and `/settings` screen in Ukrainian.
- [x] (2026-03-05 21:42Z) Built real text selection tracking in the editor surface.
- [x] (2026-03-05 21:42Z) Bound selection state to the floating custom request panel and right-side operations rail.
- [x] (2026-03-05 21:42Z) Replaced mock patch data with a real patch state model in the client.
- [x] (2026-03-05 21:42Z) Defined a stable patch request and response contract for one working provider path.
- [x] (2026-03-05 21:42Z) Implemented one API path for patch generation inside the Next.js app.
- [x] (2026-03-05 21:42Z) Integrated the first real provider adapter, starting with OpenAI.
- [x] (2026-03-05 21:42Z) Validated and normalized provider model IDs from settings.
- [x] (2026-03-05 21:42Z) Applied accepted patch operations back into manuscript text safely.
- [x] (2026-03-05 21:42Z) Persisted settings locally and restored them on reload.
- [x] (2026-03-05 21:42Z) Added happy-path and failure-state validation for the vertical slice.
- [x] (2026-03-05 22:05Z) Fixed local env defaulting so the server reads `OPENAI_API_KEY` from the repo-root `.env` when the form key is blank.
- [x] (2026-03-05 22:10Z) Hardened multi-operation validation and added safe batch accept/reject handling.
- [x] (2026-03-05 22:10Z) Added request diagnostics and short request history to the editor rail.
- [x] (2026-03-05 22:10Z) Removed screenshot artifacts after visual verification at the user's request.
- [x] (2026-03-05 22:30Z) Added automated tests for patch normalization, batch apply behavior, and provider env/fallback behavior.
- [x] (2026-03-05 22:30Z) Replaced fallback-only Gemini and Anthropic branches with real provider adapters behind the shared patch contract.
- [x] (2026-03-05 22:33Z) Simplified the editor UI by consolidating request actions into one rail composer, reducing duplicate selection context, and collapsing diagnostics/history by default.
- [x] (2026-03-05 23:05Z) Reworked the editor into a review-first layout with a utility left rail, explicit whole-fragment base action, wider manuscript, and selection-triggered floating custom prompt.
- [x] (2026-03-05 23:15Z) Updated README and added deployment docs to clarify the runtime contract, `PORT` usage, and the local `3000` to `3001` fallback behavior.
- [x] (2026-03-05 23:15Z) Live-validated the Gemini env-key path and confirmed the current adapter reaches the provider but still falls back when Gemini returns unusable local edits.
- [x] (2026-03-05 23:40Z) Added repo-level UTF-8 and LF safeguards with `.editorconfig`, `.gitattributes`, and `npm run check:text`.
- [x] (2026-03-05 23:40Z) Normalized tracked source and docs files to UTF-8 without BOM, LF line endings, and a final newline.
- [x] (2026-03-06 00:20Z) Reworked the editor canvas so selection stays visible while the floating prompt is focused, consolidated the base patch action into that composer, and rendered accepted edits inline as manuscript diffs until editing resumes.
- [x] (2026-03-06 00:35Z) Hardened provider normalization so OpenAI responses with selection-relative offsets or numeric-string indices are repaired before the app falls back to deterministic local edits.
- [x] (2026-03-06 00:50Z) Simplified the floating selection composer by removing duplicated selection copy, adding a fold/unfold toggle, and auto-collapsing the panel after a request is sent.
- [x] (2026-03-06 01:05Z) Changed patch normalization so one model request becomes one coherent selection-wide diff instead of several fragmented local operations.
- [x] (2026-03-06 01:20Z) Reclaimed editor space by removing low-value canvas status chrome, widened the manuscript area, replaced the demo copy with a longer Ukrainian HDL/LDL biohacking section, and rewrote default prompts around real editor use cases.
- [x] (2026-03-06 01:35Z) Widened the review rail, moved post-apply diff actions to the bottom of the manuscript flow, added an explicit `Прибрати diff` action, and switched the editor back to the native textarea layer during active editing to remove selection/cursor artifacts.
- [x] (2026-03-06 02:25Z) Tightened the inline review layout so applied-diff actions sit immediately below the diff block instead of floating with extra manuscript spacing.
- [x] (2026-03-06 03:00Z) Replaced the duplicated `Спростити фрагмент` action with a new whole-text `Редакторський огляд` flow, including a dedicated API route, right-rail recommendation cards, and jump-to-fragment anchors back into the manuscript.
- [x] (2026-03-06 03:20Z) Hardened editorial-review normalization so partially malformed provider recommendations are repaired before they are dropped.
- [x] (2026-03-06 03:35Z) Migrated OpenAI patch and editorial-review generation to the recommended Responses API structured-output path.
- [x] (2026-03-06 03:55Z) Migrated Gemini structured-output requests to the documented config keys and exposed raw review-provider output in diagnostics for debugging.
- [x] (2026-03-06 04:20Z) Refactored whole-text review to paragraph anchors with excerpt hints and added visible manuscript paragraph numbers in a padded gutter.
- [x] (2026-03-06 04:40Z) Removed the focus-time text-layer swap that made paragraph numbers drift on click, switched the manuscript serif to Lora, and dropped the redundant left-rail helper note for editorial review.
- [x] (2026-03-06 05:05Z) Split editorial review into compact rail cards plus an inline manuscript detail panel, and stopped review navigation from auto-opening the floating local-patch composer.
- [x] (2026-03-06 05:25Z) Persisted the active editor draft across route changes with browser `localStorage`, added an explicit `Очистити` reset action, and renamed the top-nav manuscript entry to `Редактор`.
- [x] (2026-03-06 05:40Z) Realigned manuscript overlay and textarea metrics, then restored native textarea rendering on focus so caret placement and typed text match the visible insertion point again.
- [x] (2026-03-06 05:50Z) Stopped editorial-review detail from auto-closing on ordinary text clicks and replaced the header close label with a compact close icon.
- [x] (2026-03-06 06:10Z) Replaced free-form model defaults in settings with provider-specific preset dropdowns plus a manual-entry option, and refreshed fallback defaults to current model catalogs.
- [x] (2026-03-06 06:20Z) Raised editorial-review detail above the textarea layer so manuscript text no longer bleeds through the panel and close controls remain interactive.
- [x] (2026-03-06 06:35Z) Reworked the floating custom-prompt panel into a centered chat-style composer with single-line default height and bounded auto-grow behavior.
- [x] (2026-03-06 06:45Z) Removed the standalone welcome screen and made `/` redirect directly into `/editor`.
- [x] (2026-03-06 08:05Z) Made the app responsive by restacking utility/review panels into the center flow on tablet/mobile, tightening the manuscript and floating-composer layouts, and validating desktop/mobile screenshots.

## Surprises & Discoveries

- Observation: the current UI was visually close enough to `sample4` that the main blocker was behavior, not design.
  Evidence: the working editor flow remains aligned with the sample4 layout while adding diagnostics and batch actions in `apps/web/app/globals.css` and `apps/web/components/layout/RightOperationsRail.tsx`.

- Observation: absolute-offset patch proposals become stale immediately after manual manuscript edits.
  Evidence: the working editor clears pending operations on manual text changes in `apps/web/app/editor/page.tsx`.

- Observation: a deterministic local fallback is necessary even with a real OpenAI path because local setups often start without a valid API key or model.
  Evidence: `apps/web/app/api/edit/patch/route.ts` returns `usedFallback: true` plus a visible error message when the OpenAI path is unavailable.

- Observation: the fallback path also benefits from multi-operation output, because it lets editors review term-level changes instead of one large replacement block.
  Evidence: the fallback generator now emits up to three non-overlapping local operations inside `apps/web/lib/server/patch-service.ts`.

- Observation: Next workspace execution was not reliably exposing the repo-root `.env` to the app server.
  Evidence: the route initially treated the root `.env` key as missing until a server-side root-env reader was added in `apps/web/lib/server/env.ts`.

- Observation: OpenAI, Gemini, and Anthropic cannot share one structured-output request body even though the editor expects one patch contract.
  Evidence: `apps/web/lib/server/patch-service.ts` uses OpenAI `response_format.json_schema`, Gemini `generationConfig.response_schema`, and Anthropic `messages` plus system JSON instructions before normalizing back to the shared patch contract.

- Observation: native Node test execution in this workspace required explicit `.ts` imports plus `allowImportingTsExtensions` to exercise the same server code used by the app.
  Evidence: the automated tests run directly against `apps/web/lib/server/patch-service.ts` through `apps/web/test/*.test.ts`, and the workspace enables this in `apps/web/tsconfig.json`.

- Observation: a live Gemini call can clear auth and transport checks but still fail the shared patch contract by returning empty or unusable local edits.
  Evidence: a real request sent through `/api/edit/patch` with `GEMINI_API_KEY` in the repo-root `.env` reached Gemini, then returned `usedFallback: true` because the resulting local operations were empty or invalid for normalization.

- Observation: a pure `textarea` editor keeps offset math simple, but the browser drops the visible highlight as soon as focus moves into the floating prompt.
  Evidence: before the UI pass, selecting text and typing into `apps/web/components/editor/FloatingPromptPanel.tsx` removed the native highlight even though `apps/web/app/editor/page.tsx` still held the selection in state.

- Observation: inline post-apply diffs and direct text editing cannot share one visual layer without desynchronizing cursor layout.
  Evidence: the accepted diff markup in `apps/web/components/editor/EditorCanvas.tsx` renders longer than the applied plain text, so the manuscript now enters a short review mode until the user clicks back into editing.

- Observation: providers can obey the requested JSON shape but still return offsets relative to the selected fragment instead of absolute manuscript indices.
  Evidence: the hardening pass added a repair stage in `apps/web/lib/server/patch-service.ts` because those responses were previously normalized to zero operations and incorrectly surfaced as fallback-only failures.

- Observation: once the manuscript itself shows a stable highlight, repeating the selected text inside both the canvas header and the floating composer adds noise instead of confidence.
  Evidence: the latest UI pass removed the duplicate selection blocks from `apps/web/components/editor/EditorCanvas.tsx` and `apps/web/components/editor/FloatingPromptPanel.tsx`, while the highlight remained visible in the manuscript.

- Observation: fragmented provider operations make one simplification request look random even when each individual offset is technically valid.
  Evidence: the reported LDL/HDL example produced several adjacent operations from one prompt, which then rendered as an incoherent chain in review and inline diff mode.

- Observation: the editor still wasted vertical space after the selection UX pass because the canvas kept a large artificial minimum height plus a low-value status row.
  Evidence: the screenshot after selection showed a mostly empty lower half of the manuscript card with only a `Виділено … символів` counter left in view.

- Observation: keeping the render overlay visible during direct editing creates double-layer text artifacts after returning from diff review.
  Evidence: the reported screenshot showed corrupted selection and cursor placement because the render layer and textarea text were effectively competing in the same visual slot.

- Observation: a generic `Спростити фрагмент` button inside the local composer did not communicate a distinct user intent once quick prompts and the submit field already existed.
  Evidence: in the current floating-panel UI, that button reused the same underlying simplification path and read as a redundant magic action rather than a separate editing mode.

- Observation: whole-text review responses can be semantically usable even when providers drift on field names or emit stringified offsets.
  Evidence: the reported review screenshot showed valid cards alongside `Відкинуто 3 невалідні рекомендації від провайдера.`, which pointed to partially recoverable payloads rather than a full fallback path.

- Observation: our previous OpenAI integration still used legacy chat completions even though the current OpenAI structured-output guidance centers on the Responses API.
  Evidence: both `apps/web/lib/server/patch-service.ts` and `apps/web/lib/server/review-service.ts` previously posted `response_format.json_schema` to `/v1/chat/completions` and manually parsed `choices[0].message.content`.

- Observation: Gemini documentation expects camelCase structured-output config fields in REST requests, not the snake_case keys we were sending.
  Evidence: the official guide shows `generationConfig.responseMimeType` and `generationConfig.responseJsonSchema`, while our older implementation still used `response_mime_type` and `response_schema`.

- Observation: global character offsets are a poor anchor model for whole-manuscript editorial review even when structured outputs are valid JSON.
  Evidence: the reported OpenAI review payload returned sensible recommendations but impossible `end` values beyond the manuscript length, which caused most cards to be dropped despite a semantically useful response.

- Observation: making the native textarea text visible on focus reintroduced a subtle baseline mismatch against the manuscript render layer.
  Evidence: by paragraph five the gutter number and visible copy no longer shared the same vertical rhythm after a click, because the UI was effectively swapping between two text renderers with slightly different metrics.

- Observation: the right rail is a poor place for full editorial rationale and action text; long recommendations become visually dense before they become useful.
  Evidence: the reported screenshots showed cards with truncated advice, clipped excerpts, and repeated quote punctuation, making the review harder to scan than the manuscript itself.

- Observation: route changes inside the Next app were remounting the editor page back to its initial manuscript state because only settings had browser persistence.
  Evidence: switching from `/editor` to `/settings` and back restored `DEFAULT_MANUSCRIPT_TEXT` and cleared pending patch/review state, which made active editing sessions effectively disposable.

- Observation: even after the earlier focus-layer fix, the editor still had cursor/input drift because the overlay paragraphs and the hidden textarea did not share the same line-gap and shaping metrics.
  Evidence: by paragraph five, clicking near one word inserted text much earlier in the line, which indicated that click hit-testing and visible text layout were being computed against different flows.

- Observation: editorial-review detail was overreacting to selection changes and disappeared on ordinary clicks inside the manuscript.
  Evidence: because `handleSelectionChange()` nulled the active review item, any click that updated selection also collapsed the open review detail even when the user had not asked to close it.

- Observation: a free-form model field is too error-prone for normal usage now that each provider exposes a small set of clearly better current choices.
  Evidence: the product had drifted to outdated defaults like `gpt-5.2`, while the official catalogs already promote newer front-line options and deprecate some earlier preview names.

- Observation: editorial-review detail still sat inside a lower stacking context than the textarea, so focused editor text could visually and interactively cut through the panel.
  Evidence: clicking the open detail caused manuscript text to overlap the card and made the `X` / `Закрити розбір` controls unclickable because the textarea layer remained on top.

- Observation: the right-docked floating prompt felt detached from the manuscript and opened too large because it started with a long prefilled multi-line prompt.
  Evidence: the old panel always appeared as a sidebar-style box near the lower-right corner, which fought the center of attention instead of behaving like a focused composer for the selected fragment.

- Observation: the dedicated landing page added one extra click before the user reached the only screen that matters for normal work.
  Evidence: the root route still opened a static welcome panel with two links even though the editor is the default working surface of the product.

- Observation: the responsive behavior had become hard to predict because `globals.css` redefined the same shell and breakpoint rules several times across later polish passes.
  Evidence: `apps/web/app/globals.css` contained multiple competing `@media (max-width: 1220px)` blocks and repeated `.editor-layout` definitions before the final responsive override pass unified the mobile behavior.

- Observation: Playwright CLI was available in this environment, but the bundled Linux browser could not launch because the system lacked `libnspr4`.
  Evidence: the screenshot attempt failed with `chrome-headless-shell: error while loading shared libraries: libnspr4.so`, so Windows `chrome.exe --headless` was used instead for desktop/mobile screenshot validation.

- Observation: this repository had widespread text-format drift across source and docs, including BOM, CRLF, and missing-final-newline differences.
  Evidence: the first `npm run check:text` pass reported dozens of files with BOM or line-ending drift before the normalization pass rewrote them to UTF-8 without BOM and LF line endings.

- Observation: the native `apply_patch` tool still failed on a one-line README edit even after text normalization, which points to a tool-path issue in this session rather than a remaining repository-format issue.
  Evidence: a direct `apply_patch` attempt against `README.md` failed silently, but the same one-line change succeeded immediately through an explicit UTF-8 rewrite.

## Decision Log

- Decision: keep the executable task checklist inside `docs/EXECPLAN_MVP.md`, not in a separate task file.
  Rationale: `PLANS.md` already defines ExecPlan as the living execution document and requires a checkbox-based Progress section.
  Date/Author: 2026-03-05 / Codex + User

- Decision: build the first working version as a single Next.js application before introducing a separate backend.
  Rationale: this is the fastest path to a real end-to-end editing flow and avoids premature architectural split.
  Date/Author: 2026-03-05 / Codex recommendation

- Decision: treat OpenAI as the first provider integration and add Gemini and Anthropic later behind the same contract.
  Rationale: one working path is more valuable than three partial integrations.
  Date/Author: 2026-03-05 / Codex recommendation

- Decision: use a textarea-backed manuscript surface for the first real slice.
  Rationale: it keeps selection tracking, API offsets, diff proposals, and patch application on a single plain-text coordinate system.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: invalidate pending proposals when the manuscript text changes manually.
  Rationale: offset-based proposals are otherwise unsafe to apply after user edits.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: keep a deterministic local fallback behind the OpenAI path.
  Rationale: the vertical slice stays demonstrable when provider credentials are missing or the model call fails.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: include request diagnostics in the patch response and expose them in the editor rail.
  Rationale: editors need to understand what ran and whether any provider operations were discarded.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: allow batch accept/reject only after re-checking every operation against the current manuscript text.
  Rationale: multi-operation review improves throughput, but stale offset-based patches should never be applied in bulk.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: read `OPENAI_API_KEY` from the repo-root `.env` when the settings form key is blank.
  Rationale: local development should not require copying the same secret into browser storage, and the workspace server was not reliably picking up the root `.env` file by default.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: isolate provider-specific OpenAI, Gemini, and Anthropic payload shapes inside one server-side patch service that always returns the shared editor contract.
  Rationale: each vendor exposes a different structured-output API, but the UI should stay provider-agnostic and keep one review/apply path.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: keep the selection-scoped base patch action only inside the floating selection composer.
  Rationale: repeating `Базова правка` across the left rail, canvas footer, and floating panel diluted scope and made the primary action harder to trust.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: after accept, show applied edits inline in the manuscript until the user clicks back into direct editing.
  Rationale: the editor stays diff-first after apply, but the plain-text editing model still resumes cleanly once the user is ready to continue.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: try a narrow server-side repair pass for provider operations before declaring them invalid and falling back.
  Rationale: relative offsets and stringified indices are common model drift, and they can often be recovered safely without weakening the patch-first contract.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: keep the floating selection composer collapsible and auto-minimize it immediately after send.
  Rationale: after the request is in flight, the editor should return attention to the manuscript and right-side review output, not leave a large prompt panel open by default.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: collapse every provider response into one selection-wide `replace` operation before it reaches the review UI.
  Rationale: one user request should produce one understandable diff; fragmented micro-edits are harder to trust and can create awkward partial rewrites even when offsets are valid.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: use the remaining canvas area for manuscript text instead of persistent selection counters or oversized empty space.
  Rationale: the core product value is reading and patching prose, so the editor should privilege line length and visible copy over status chrome.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: keep applied-diff controls inside a footer directly below the inline diff, and hide the render layer whenever the native textarea is focused.
  Rationale: review actions should stay attached to the reviewed text, and live editing must defer to the native text control to avoid cursor and selection drift.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: replace the redundant local default-action button with a separate whole-text `Редакторський огляд` flow in the left rail.
  Rationale: fragment editing and manuscript diagnostics are different jobs; a dedicated review flow is easier to trust than a vague “simplify fragment” shortcut and uses the UI space more productively.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: run a repair pass over editorial-review items before dropping malformed provider output.
  Rationale: whole-text review is expensive and often returns useful content with only minor schema drift, so the app should recover string offsets, aliased fields, and excerpt-anchored spans before surfacing dropped-count noise.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: migrate OpenAI structured outputs to the Responses API path and parse `output/output_text` instead of legacy chat-completions content.
  Rationale: this matches OpenAI's current recommended integration path more closely and should reduce OpenAI-specific schema drift caused by the older request/response shape.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: expose raw whole-text review output inside diagnostics and align Gemini REST structured-output requests with the documented field names.
  Rationale: malformed review cards are much easier to debug when the original provider payload is visible, and Gemini should follow the current documented contract instead of relying on older alias fields.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: whole-text review uses paragraph-number anchors plus excerpt text, while local patching stays on exact character offsets.
  Rationale: paragraph anchors are more reliable for manuscript-level diagnostics and still let the UI jump the editor to the right region without trusting hallucinated global symbol ranges.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: keep one visible manuscript text layer during editing, and use the textarea only as an invisible input surface with a visible caret.
  Rationale: this preserves stable paragraph/gutter alignment while still keeping native selection, keyboard input, and offset math simple.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: use the right rail for compact editorial-review navigation and open the full recommendation inline under the targeted manuscript paragraph.
  Rationale: the rail should stay scannable, while the full editorial reasoning belongs next to the actual prose it discusses; this also avoids conflating review navigation with local patch composition.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: persist the active editor draft in `localStorage`, but keep `Очистити` scoped to the draft session rather than to global model settings.
  Rationale: users expect route changes not to destroy manuscript work-in-progress, but clearing the working draft should not wipe provider/model configuration they intentionally saved in settings.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: use shared typography metrics for the overlay and textarea, and show the native textarea text again while the editor is focused.
  Rationale: native text input must be the authoritative visible layer during typing, but only after its metrics match the overlay closely enough to avoid paragraph-number jumps or caret drift.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: editorial-review detail closes only through explicit close controls, not through incidental manuscript selection changes.
  Rationale: opening a review detail is an intentional navigation action, so it should remain stable until the user explicitly dismisses it.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: model selection should default to curated provider-specific presets, with manual entry demoted to an explicit fourth option.
  Rationale: most users should start from a short, high-signal list of current models that fit this editor's workload, while power users still retain manual override for niche previews or internal ids.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: editorial-review detail must render in a higher stacking layer than the active textarea.
  Rationale: when review detail is open, it becomes the foreground task; underlying editor text must not bleed through visually or intercept close interactions.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: place the custom local-patch composer at the bottom center and let it auto-grow from one line instead of opening as a prefilled multi-line side panel.
  Rationale: this makes the prompt flow feel closer to intentional message composition, keeps the manuscript visually primary, and avoids wasting space before the user actually types a longer instruction.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: route `/` should redirect directly to `/editor`.
  Rationale: the product is editor-first, so an extra welcome screen only slows down entry into the main workflow without adding meaningful orientation.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: below tablet width, render utility and review content as inline cards inside the center column instead of relying on fixed left/right rails.
  Rationale: the three-pane desktop shell reads well on wide screens, but on mobile it compresses the manuscript and hides key actions. Duplicating those panels into the main flow preserves the full workflow in one column without sacrificing the desktop layout.
  Date/Author: 2026-03-06 / Codex implementation

- Decision: enforce UTF-8 without BOM, LF line endings, and a final newline for tracked text files, and validate that state with `npm run check:text`.
  Rationale: patch-based editing is much more reliable when repository text files stay in one predictable format, especially on Windows shell tooling.
  Date/Author: 2026-03-05 / Codex implementation

## Outcomes & Retrospective

The prototype is now a working editor slice instead of a static mock. Selection is real, requests use a stable patch contract, proposals return through an API route, each patch carries a short reason, accept updates the manuscript text, reject removes only the proposal, and saved settings are restored from local storage.

The follow-up passes hardened that slice instead of widening it prematurely. The app now validates provider operations more explicitly, supports grouped accept/reject for multiple safe operations, gives editors immediate diagnostics plus short request history in the right rail, and reads provider keys from the repo-root `.env` when the form key is blank.

The provider pass closed the next two biggest gaps without widening product scope. The server now has real OpenAI, Gemini, and Anthropic adapters behind one patch contract, and the workspace has automated tests for patch normalization, batch apply behavior, and provider env/fallback logic.

The deployment-docs pass removed ambiguity around runtime ports. The repo now documents that deployment should follow the platform-provided `PORT`, that the codebase itself does not hardcode a runtime port, and that seeing `3001` locally is just Next falling forward when `3000` was already occupied.

The repo-hygiene pass tightened the text layer that patch-based editing depends on. The repository now has explicit UTF-8 and LF defaults, a text-integrity check at `npm run check:text`, and normalized tracked source and docs files so shell and patch tooling start from a consistent baseline.

The latest UI pass fixed the last trust gap in the editor flow itself. Selection now remains visually anchored while the floating prompt has focus, the base patch action appears only once in the selection composer, and accepted edits stay visible inline as manuscript diffs until the editor explicitly resumes typing.

The latest provider-hardening pass reduced false fallback cases on the main OpenAI path. The server now retries normalization after repairing common model drift such as selection-relative offsets and numeric-string indices, so valid local edits survive more often instead of being discarded wholesale.

The latest floating-panel refinement reduced visual duplication in the editor. The manuscript highlight is now the only selection preview, the prompt window can be folded manually from the top-right corner, and it auto-collapses after send so review output gets attention immediately.

The latest patch-normalization pass also fixed the main review-quality issue in the editor flow. The server now asks for one full-fragment rewrite and still collapses any fragmented model output into one coherent selection-wide diff before the UI renders it.

The latest content-and-layout pass made the demo closer to the actual target workflow. The manuscript now opens on a longer Ukrainian section about biohacking and HDL/LDL, the default system and local prompts are tuned to real editorial tasks, and the canvas spends more of the screen on readable text instead of low-signal status UI.

The latest typography-and-focus pass removed one of the last visual trust issues in the editor. Clicking back into the manuscript no longer swaps to a second visible text layer, so paragraph numbers stay locked to the paragraph baseline, the serif copy reads more cleanly in Ukrainian, and the editorial-review rail no longer wastes space on a note that repeated obvious behavior.

The latest editorial-review pass made the recommendation UI more legible. The rail now works as a compact index of issues, while the full `Що не працює / Що зробити` breakdown opens directly under the relevant paragraph in the manuscript, and that jump no longer triggers the floating local-patch panel.

The latest responsive pass made the existing workflow usable on smaller screens instead of only technically reachable there. The desktop three-pane shell remains intact, but tablet/mobile now restack utility and review content into the center flow, the top bar wraps cleanly, the manuscript gutter and page padding scale down, the floating prompt behaves like a bottom sheet, and the settings screen no longer overflows at narrow widths.

The latest persistence pass removed a major session-trust problem. Editors can now move between the editor and settings without losing the manuscript, pending local diffs, or review state, and can still intentionally reset the workspace with a single `Очистити` action in the left rail.

The latest caret-alignment pass addressed a deeper editing trust issue. The editor now uses one metric system for both text layers and reveals the native textarea while focused, so typed characters land where the visible caret suggests instead of drifting earlier in the paragraph.

The latest settings pass reduced model-selection ambiguity. Each provider now exposes a short curated list of current models that fit patch-first editorial work, and manual model ids remain available only when the user explicitly chooses `Ввести вручну`.

The latest review-flow pass tightened the last rough edges in the manuscript area. The right rail now has materially more room for one full-fragment diff, the accepted-diff action bar sits at the bottom of that diff instead of floating at the top of the page, `Прибрати diff` lets the user dismiss review markup without re-entering typing mode, and active editing now returns to a single native text layer to prevent visual artifacts.

The latest layout polish closed the remaining spacing issue in post-apply review. Accepted-diff actions now render directly under the inline diff block instead of drifting lower in the manuscript flow, which keeps review decisions visually attached to the exact changed text.

The latest product pass also made the split between local editing and manuscript diagnostics much clearer. The floating selection panel is now only for explicit custom local edits, while a new whole-text `Редакторський огляд` flow scans the manuscript, surfaces editor-facing recommendations in the right rail, and can jump straight back to the relevant fragment for a local fix.

The latest anchor-model pass removed the most brittle part of whole-text review. Recommendations now target numbered manuscript paragraphs with excerpt hints instead of full-document symbol offsets, and the manuscript itself now shows those paragraph numbers in a light gutter so the visual language matches the review cards.

The main remaining gaps are live non-OpenAI validation and higher-level coverage rather than core product behavior. Gemini needs contract hardening from real responses, Anthropic still needs real-key validation in this environment, there is not yet route-level or UI test coverage for the review flow, and the new text-integrity check is not yet wired into CI or a pre-commit hook.

## Context and Orientation

The working directory is `C:\Projects\oboz-ai\orest-edit`.

Current key files:
- `C:\Projects\oboz-ai\orest-edit\AGENTS.md`
- `C:\Projects\oboz-ai\orest-edit\docs\PRD_V1.md`
- `C:\Projects\oboz-ai\orest-edit\docs\CURRENT_STATE.md`
- `C:\Projects\oboz-ai\orest-edit\docs\EXECPLAN_MVP.md`
- `C:\Projects\oboz-ai\orest-edit\docs\DECISIONS_LOG.md`
- `C:\Projects\oboz-ai\orest-edit\apps\web\app\editor\page.tsx`
- `C:\Projects\oboz-ai\orest-edit\apps\web\components\editor\EditorCanvas.tsx`
- `C:\Projects\oboz-ai\orest-edit\apps\web\components\editor\RequestComposerCard.tsx`
- `C:\Projects\oboz-ai\orest-edit\apps\web\components\layout\RightOperationsRail.tsx`
- `C:\Projects\oboz-ai\orest-edit\apps\web\app\api\edit\patch\route.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\lib\editor\patch-contract.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\lib\editor\settings.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\lib\server\env.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\lib\server\patch-service.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\test\patch-contract.test.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\test\patch-service.test.ts`
- `C:\Projects\oboz-ai\orest-edit\.editorconfig`
- `C:\Projects\oboz-ai\orest-edit\.gitattributes`
- `C:\Projects\oboz-ai\orest-edit\scripts\check-text-integrity.mjs`

Important product context:
- user = book editor, not doctor
- UI language = Ukrainian
- visual baseline = `docs/sample4.html`
- product behavior = patch-first and diff-first
- current implementation = single Next.js app with OpenAI defaulting, Gemini/Anthropic adapters, local fallback, and repo-level text normalization guards

## Plan of Work

The work proceeded in one narrow product lane.

First, the fake editor selection was replaced with real user selection tracking inside a manuscript surface that keeps plain-text offsets stable.

Second, the old mock operation model was replaced with a real client patch state driven by a request/response cycle and a shared contract.

Third, a single API entry point was added inside the Next.js app. The route accepts manuscript text, selection range, mode, and prompt, then returns validated patch operations with reasons.

Fourth, one real provider path was connected through OpenAI. The route validates responses and falls back to a deterministic local patch generator when credentials or provider calls fail.

Fifth, patch acceptance was made real: accepting an operation updates the manuscript text and rebases or discards remaining proposals safely.

Sixth, hardening passes added response diagnostics, short request history, grouped accept/reject for safe multi-operation batches, and root-env loading for provider keys.

Seventh, real Gemini and Anthropic adapters were added behind the same server patch contract using each provider's current structured-output API shape.

Eighth, automated tests were added for patch normalization, batch apply behavior, and provider env/fallback logic.

Ninth, repo-level text hygiene was hardened through explicit UTF-8 and LF defaults, a text-integrity script, and normalization of tracked source and docs files.

## Concrete Steps

All commands were run from:

    C:\Projects\oboz-ai\orest-edit

Key implementation and validation commands:

    npm run check:text
    npm run test
    npm run typecheck
    npm run build

Runtime validation commands used for the env-default path:

    $env:PORT=<temporary-port>; npm run start
    curl.exe -X POST http://127.0.0.1:<temporary-port>/api/edit/patch ...

## Validation and Acceptance

The vertical slice is successful and validated against the original acceptance criteria.

Behavioral acceptance achieved:
- the user can select a real text fragment in the editor
- the unified request composer knows which fragment is targeted
- submitting a request returns only local patch operations
- each patch operation includes a short reason
- the right rail shows the returned operations
- accepting an operation updates the manuscript text
- rejecting an operation removes the proposal without changing text
- the app handles missing API key or provider failure with a visible non-crashing fallback/error state
- the app shows diagnostics for the last request and keeps a short in-memory request history
- multi-operation batches can be accepted or rejected safely
- leaving the settings API-key field blank still allows a real provider request when the matching env key exists in the repo-root `.env`
- OpenAI, Gemini, and Anthropic each have a real adapter behind the same patch contract
- automated tests cover patch normalization, batch apply behavior, and provider env/fallback logic
- repo text files are checked for BOM, CRLF, missing-final-newline drift, and obvious mojibake markers through `npm run check:text`

Validation commands run:

    npm run check:text
    npm run test
    npm run typecheck
    npm run build

Runtime validation:
- confirmed `/api/edit/patch` returned `usedFallback: false` for an OpenAI request sent without a form API key, using the root `.env` path
- confirmed provider adapter tests normalize OpenAI, Gemini, and Anthropic responses through the same patch contract
- confirmed a live Gemini request reached the provider through the repo-root `.env` key path, then fell back because the returned local edits were empty or invalid for normalization
- confirmed the current repository text baseline now passes `npm run check:text`
- confirmed a one-line README edit still failed through the native `apply_patch` tool in this session, while the same change succeeded via an explicit UTF-8 rewrite

## Idempotence and Recovery

The implementation remains safe to rerun incrementally. The editor UI, API route, settings persistence, and repo-level text safeguards are additive inside the existing Next.js app.

If a provider path is unavailable, the editor continues to function through the local fallback behind the same patch contract. If the manuscript changes manually, pending proposals are dropped instead of risking unsafe application to stale offsets. Group accept also re-checks every pending operation against the current text before applying it. If the browser field for the API key is blank, the server checks the appropriate server env value before falling back.

If shell-based edits are required in this environment, the repository now has explicit guardrails to catch encoding and line-ending drift before those changes are committed.

## Artifacts and Notes

Useful implementation artifacts maintained in code:
- shared patch contract and batch helpers in `C:\Projects\oboz-ai\orest-edit\apps\web\lib\editor\patch-contract.ts`
- patch API diagnostics and fallback behavior in `C:\Projects\oboz-ai\orest-edit\apps\web\app\api\edit\patch\route.ts`
- request history and grouped actions in `C:\Projects\oboz-ai\orest-edit\apps\web\app\editor\page.tsx`
- shared multi-provider patch service in `C:\Projects\oboz-ai\orest-edit\apps\web\lib\server\patch-service.ts`
- root-env reader for local server defaults in `C:\Projects\oboz-ai\orest-edit\apps\web\lib\server\env.ts`
- repository text-integrity guard in `C:\Projects\oboz-ai\orest-edit\scripts\check-text-integrity.mjs`

Representative patch API behavior:
- request carries full manuscript text, absolute selection offsets, mode, prompt, provider, model id, API key, and base prompt
- response carries validated local operations, `providerUsed`, `usedFallback`, optional `error`, and `diagnostics`
- when the browser omits `apiKey`, the server checks provider env keys before falling back
- provider-specific request bodies differ, but OpenAI, Gemini, and Anthropic all normalize back to the same local patch response

## Interfaces and Dependencies

The app ends with a stable patch contract in:

    apps/web/lib/editor/patch-contract.ts

with the working shape:

    type PatchOperation = {
      id: string;
      op: "replace" | "insert" | "delete";
      start: number;
      end: number;
      oldText: string;
      newText?: string;
      reason: string;
      type: "clarity" | "structure" | "terminology" | "source" | "tone";
    };

and response diagnostics equivalent to:

    type PatchResponseDiagnostics = {
      requestId: string;
      requestedProvider: string;
      requestedModelId: string;
      appliedMode: "default" | "custom";
      selectionLength: number;
      returnedOperationCount: number;
      droppedOperationCount: number;
      generatedAt: string;
    };

The first API path lives at:

    apps/web/app/api/edit/patch/route.ts

and accepts the working request contract described in the plan, plus an optional `basePrompt` so editor settings can shape the provider request.

The real provider dependencies include OpenAI, Gemini, and Anthropic behind the shared `apps/web/lib/server/patch-service.ts` contract. OpenAI remains the default provider in the current UI, and server env lookup supports `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY`.

The repo-level text dependencies now include:
- `.editorconfig` for default UTF-8 and LF behavior
- `.gitattributes` for Git-level text normalization expectations
- `scripts/check-text-integrity.mjs` for BOM, CRLF, final-newline, and mojibake checks
