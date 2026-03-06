# DECISIONS_LOG

## 2026-03-05

### Product user
Decision: the product is for a book editor, not for a doctor.

Reason: the main value is simplifying dense scientific prose for broad readers, not supporting clinical decision-making.

### Core interaction model
Decision: the product is patch-first and diff-first.

Reason: trust depends on local, reviewable edits instead of full rewrites.

### UI language
Decision: the interface language is Ukrainian.

Reason: the intended editorial workflow and reading audience are Ukrainian.

### Visual baseline
Decision: `docs/sample4.html` is the reference layout direction.

Reason: it best matches the manuscript-centered editing workflow.

### Current scope exclusions
Decision: strict-medical editor mode, export-patch UI, and sources-first navigation are not part of the current MVP direction.

Reason: they distract from the first working editorial vertical slice.

### Planning document
Decision: the checklist for coding work lives inside `docs/EXECPLAN_MVP.md`.

Reason: `PLANS.md` already defines ExecPlan as the required living execution document with checkbox progress.

### First working manuscript surface
Decision: the first real editor slice uses a textarea-backed manuscript surface.

Reason: plain-text selection gives reliable absolute offsets for selection tracking, patch requests, diff review, and safe patch application without introducing contentEditable mapping complexity too early.

### Patch invalidation rule
Decision: pending patch proposals are discarded when the manuscript is edited manually.

Reason: proposals are anchored to absolute character offsets and become unsafe once the underlying text changes outside the accept/reject flow.

### Fallback behavior
Decision: the OpenAI path keeps a deterministic local fallback behind the same patch contract.

Reason: the vertical slice remains usable and testable even when the API key is missing, the model id is wrong, or the provider call fails.

### Response diagnostics
Decision: patch responses carry request diagnostics back to the client.

Reason: the editor needs to see which provider/model/mode ran and whether any provider operations were dropped, without inspecting network payloads.

### Batch apply safety
Decision: group apply only runs on operations that still match the current manuscript text.

Reason: multi-operation review is useful, but safety still depends on verifying each patch against the current text before applying it in bulk.

### Root env fallback
Decision: the server reads provider API keys from the repo-root `.env` when the settings form leaves the API-key field blank.

Reason: local development should not require copying the same secret into browser storage, and Next workspace env loading was not reliably picking up the root `.env` file by default.

### Provider normalization layer
Decision: provider-specific OpenAI, Gemini, and Anthropic request shapes are isolated inside one server-side patch service that always returns the shared patch contract.

Reason: each vendor exposes a different structured-output API, but the editor should stay provider-agnostic and keep one review/apply flow.

### Review-first right rail
Decision: the right rail is reserved for review output and collapses entirely until requests, diagnostics, or history exist.

Reason: before a request runs, the manuscript should dominate the screen and the rail should not reserve attention for an empty future state.

### Floating custom prompt
Decision: custom prompting is a floating, selection-triggered action labeled `Кастомні правки`.

Reason: custom edits should be one step away once text is selected, not hidden behind a second click in a persistent side panel.

### Whole-fragment base action
Decision: the left rail exposes a permanent `Базова правка всього фрагмента` action.

Reason: a whole-fragment action is useful, but it must state its scope explicitly so it does not blur into the local-selection workflow.

### Deployment documentation split
Decision: keep a short runtime summary in `README.md` and place detailed deployment notes in `docs/DEPLOYMENT.md`.

Reason: the README should answer quick run/deploy questions, while deployment-specific operational details need a stable dedicated document.

### Repository text normalization
Decision: enforce UTF-8 without BOM, LF line endings, and a final newline for repository text files, with `npm run check:text` as the integrity guard.

Reason: patch-based editing becomes unreliable when source files drift across BOM, CRLF, missing-final-newline, or mojibake states, especially on Windows shell workflows.

## 2026-03-06

### Selection-scoped base action
Decision: keep `Базова правка` only inside the floating selection composer.

Reason: the selection-scoped action was repeated in too many places and weakened the clarity of what exactly would be edited.

### Post-apply manuscript review mode
Decision: accepted edits render inline as manuscript diffs until the user clicks back into direct editing.

Reason: the product stays diff-first even after apply, while the underlying plain-text editor can still resume without rich-text offset drift.

### Provider repair before fallback
Decision: repair common provider drift such as selection-relative offsets and numeric-string indices before declaring a response invalid.

Reason: these responses can often be normalized safely, and dropping them straight to fallback hides usable OpenAI output from the editor.

### Floating composer collapse model
Decision: the floating selection composer keeps only prompt controls, supports a top-right fold/unfold toggle, and auto-collapses after send.

Reason: the main manuscript highlight already identifies the editing target, so duplicate selection text is noise, and the prompt window should get out of the way once review output is incoming.

### One request, one diff
Decision: each model request is normalized to one selection-wide `replace` diff before review.

Reason: fragmented model edits made one prompt look like several unrelated answers and produced awkward partial rewrites in the manuscript; one coherent diff is easier to review and safer to trust.

### Editor space over status chrome
Decision: spend manuscript-card space on readable copy, not persistent selection counters or oversized empty area.

Reason: the editor is the primary workspace, and low-value status UI should not displace the actual manuscript text.

### Native textarea wins during editing
Decision: when the editor regains focus after diff review, hide the render overlay and let the native textarea draw text, cursor, and selection by itself.

Reason: overlay-based rendering is useful for persistent highlight and diff review, but native editing behavior must stay authoritative to avoid selection artifacts and cursor drift.

### Separate manuscript review from local patching
Decision: remove the redundant `Спростити фрагмент` shortcut from the floating local editor and replace it with a separate whole-text `Редакторський огляд` flow in the left rail.

Reason: manuscript-level diagnostics are a different task from patching a selected fragment; splitting them into two explicit flows makes the UI clearer and uses the right rail for higher-value editor guidance instead of a duplicate shortcut.

### Repair review payloads before dropping them
Decision: whole-text editorial review runs a repair pass over provider items before counting them as invalid.

Reason: manuscript review is slower and more expensive than local patching, so the app should recover minor schema drift such as string indices, aliased field names, or excerpt-only anchors instead of discarding otherwise useful recommendations.

### Use OpenAI Responses API for structured outputs
Decision: OpenAI patch generation and whole-text editorial review use the Responses API structured-output flow instead of legacy chat completions.

Reason: this is closer to OpenAI's current recommended integration path for structured outputs and reduces reliance on manual extraction from `choices[].message.content`.

### Keep raw review output visible in diagnostics
Decision: `Діагностика огляду` may expose the raw provider output in a nested accordion for debugging.

Reason: when structured review items partially fail normalization, the editor needs to see the exact upstream payload to distinguish provider drift from application-level validation rules.

### Use paragraph anchors for manuscript review
Decision: whole-text `Редакторський огляд` anchors to paragraph numbers and excerpt hints rather than global character offsets.

Reason: paragraph-level references are much more stable for long-form editorial diagnostics, while exact symbol offsets remain necessary only for local diff/patch application.

### Keep one visible manuscript layer during editing
Decision: the manuscript render layer remains the only visible text layer during active editing; the textarea stays transparent and serves as the input/caret surface.

Reason: swapping to visible textarea text on focus introduced measurable baseline drift against the gutter and paragraph rendering. One visible layer keeps paragraph numbers aligned and removes trust-breaking movement in the editor.

### Keep editorial review detail in the manuscript, not the rail
Decision: editorial-review cards stay compact in the right rail, and the full recommendation opens inline under the referenced paragraph inside the manuscript.

Reason: long review rationale is hard to scan in a narrow side column and should live beside the prose it evaluates. Separating review detail from the floating local-patch composer also prevents two different editing modes from colliding.

### Persist the draft, not just the settings
Decision: the active editor session persists in browser `localStorage`, including manuscript text and review/patch progress, while the manual `Очистити` action resets only that draft state.

Reason: navigating to settings should not destroy active editorial work, but draft reset and model-settings reset are different intents and should remain separate.

### Native textarea is visible while typing, but only on matched metrics
Decision: focused editing shows the native textarea text again, while the manuscript overlay remains the visible layer only outside active typing and review modes.

Reason: caret and input fidelity require the browser's own text control to be visually authoritative during typing, but that only works once paragraph gaps and font shaping are aligned between both layers.

### Editorial review detail closes explicitly, not on selection drift
Decision: open editorial-review detail remains visible across ordinary manuscript clicks and selection changes, and closes only through dedicated close controls.

Reason: incidental selection updates are not the same as dismiss intent; collapsing the detail on every click made the review flow feel unstable and hard to trust.

### Curated model presets come before manual ids
Decision: settings expose a short provider-specific dropdown of current recommended models and keep raw model-id input behind a separate `Ввести вручну` option.

Reason: the editor benefits from opinionated defaults tied to official model catalogs, while manual ids are still necessary as an escape hatch for previews and one-off testing.

### Mobile shell uses inline utility and review panels
Decision: below tablet width, the app stops relying on fixed left/right rails and instead renders utility and review panels as inline cards inside the center column.

Reason: the desktop three-pane layout is useful on wide screens, but on mobile it wastes width and hides essential actions. Duplicating those panels into the center flow keeps the editor, review, and settings paths usable without horizontal compression.
