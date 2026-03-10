# DECISIONS_LOG

## 2026-03-10

### Callout recommendations are recoverable, not disposable
Decision: keep `callout` recommendations as `pending` when initial `calloutPreviewText` is weak, instead of dropping the item during review normalization.

Reason: anchor and editorial intent can still be valid even when first-pass draft quality is not; dropping the item removes the editor's recovery path and makes the feature appear broken.

### Callout flow is prepare-first with editable draft
Decision: side-detail primary action for `врізка` prepares/regenerates draft content, and insertion remains a separate explicit apply step from an editable title/body draft card.

Reason: this restores diff-first trust and avoids one-click insertion from unstable prefilled draft text.

### Background AI results live above route pages
Decision: patch and whole-text review requests are tracked in an app-level client activity store, not only inside `/editor` page state.

Reason: route switches to `/settings` or other pages can unmount the editor before the AI response arrives; the result must still surface through a durable top-bar indicator and editor inbox instead of disappearing.

### Review execution uses full anchored paragraph range
Decision: when preparing or focusing a whole-text recommendation, selection resolution must preserve the full `anchor.paragraphIds` range and must not shrink execution scope to an excerpt substring match.

Reason: excerpt text is contextual metadata and can represent only part of the range. Using it as the primary execution selector creates a trust-breaking mismatch (`Абзаци 036-042` shown, one paragraph actually edited).

### List recommendations require structural list output
Decision: `recommendationType = list` proposals must be list-shaped markdown (`- ` items), and non-list provider output is normalized to a deterministic bullet list fallback before apply.

Reason: list-type recommendations are structural edits. Accepting plain prose rewrites for that type produces misleading `Працюй!` results and weakens diff-first review quality.

### Vercel edge is the primary access boundary
Decision: secure the app through Vercel Deployment Protection with `Vercel Authentication`, while keeping app-level password/login flows out of scope for now.

Reason: this is the simplest reliable control for an internal editor tool and avoids shipping extra auth code paths that the product does not need.

### Minimal-maintenance bypass policy
Decision: allow one optional Protection Bypass for Automation secret for CI/E2E/monitoring and use event-based rotation only (no periodic rotation schedule).

Reason: automation still needs a deterministic path to protected deployments, but periodic rotation adds operational burden without clear benefit for this internal scope.

### Platform-level abuse guard first
Decision: use one Vercel WAF rate-limit rule on `/api/edit/*` as the first abuse/cost control.

Reason: rate limiting at the edge is lower maintenance than introducing custom app-side quota services before real abuse patterns appear.

### In-app password gate is the default access control
Decision: protect app routes with one shared password (`APP_PASSWORD`) and a signed httpOnly session cookie, with `/login` as the entry page.

Reason: Vercel Authentication blocks external clients unless they join the Vercel team, while a simple in-app password is easier for client access and still closes anonymous misuse.

### Vercel Authentication is optional hardening
Decision: keep Vercel Deployment Protection as an optional second layer, not the required primary boundary.

Reason: this keeps onboarding simple for non-technical reviewers while still allowing stricter access when the hosting plan and workflow support it.

## 2026-03-09

### Explicit serverless duration for AI routes
Decision: set `runtime = "nodejs"` and `maxDuration = 60` on all AI-related API routes used by patching, review, proposal generation, image generation, and settings validation.

Reason: hosting defaults can be shorter than AI latency, which can terminate requests before graceful fallback or structured error handling runs.

### Upstream timeout stays below route timeout
Decision: cap review-image provider timeout below the route duration ceiling (`55s` with route `60s`).

Reason: aborting upstream first gives deterministic user-facing errors and avoids hard platform timeouts.

### Async review-image job lifecycle
Decision: replace blocking review-image generation with async enqueue (`POST /api/edit/review/image`) and explicit job polling (`GET /api/edit/review/image?jobId=...`), then render queue/progress/failure states directly in review detail UI.

Reason: generated images can take longer than comfortable interactive request windows, so user trust depends on transparent in-place state rather than one opaque long request.

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

### No left rail in the editor
Decision: remove the persistent left rail from `/editor`, move draft reset into the manuscript header, and place whole-text review at the top of the right rail.

Reason: the left rail had no durable job, duplicated status already visible in the top bar and review rail, and spent permanent space on passive copy instead of editing or review actions.

### No duplicate pending status in the top bar
Decision: remove the editor's pending-review badge from the top bar and let the idle desktop right rail render as a narrower review-action state.

Reason: the badge repeated information without enabling any action, and the full-width empty review rail felt unfinished when it had no diagnostics, history, or review output yet.

### Contextual AI loading feedback
Decision: show AI processing with subtle local animation in the relevant button or panel instead of a blocking page-level spinner.

Reason: manuscript reading should stay uninterrupted during requests, and the clearest loading feedback is attached to the place where the result will appear: the review button, right rail, or floating prompt.

### Settings page is a compact operational sheet
Decision: `/settings` should use one centered configuration sheet with inline status cards instead of reusing the editor's side rails.

Reason: settings is an operational form, not a workspace. The old three-pane shell spent width on explanatory chrome, clipped the heading, and diluted the main task with redundant side content.

### Green model status requires a live upstream response
Decision: changing provider or model in settings triggers a lightweight live validation request, and green status appears only after that request succeeds against the selected upstream model.

Reason: a selected preset is not the same thing as a working connection. The settings screen must distinguish between “chosen”, “checking”, “valid”, “missing key”, and real provider/model failures.

### Markdown stays source-first
Decision: manuscript editing remains raw markdown in the textarea, and the formatted markdown view appears only in idle preview states.

Reason: the patch-first workflow still depends on exact character offsets in one canonical source string, so a full rich-text editor would add unnecessary DOM-to-source mapping risk.

## 2026-03-08

### Canonical callout syntax
Decision: inserted `Врізка` blocks use one canonical Ukrainian directive syntax in the manuscript source: `::: врізка: <тип>`, followed by a separate `#` title line, body text, and closing `:::`.

Reason: this keeps the editor source-first and geometry-safe while removing the old code-like blockquote marker syntax from the manuscript flow.

### Callout type changes require regeneration
Decision: changing the suggested `Тип врізки` in the side recommendation detail triggers a real draft regeneration with loading state instead of silently relabeling the existing draft.

Reason: the callout label and callout content must stay semantically aligned; a dropdown that only changes metadata would create editorial drift and break trust.

## 2026-03-07

### Two-stage whole-text review
Decision: `Перевірити весь текст` will produce recommendations first and only prepare one executable proposal after the editor clicks `Працюй!` on a specific recommendation.

Reason: whole-text review should stay diagnostic and diff-first; the system must not silently rewrite or generate assets for the whole manuscript in one step.

### Stable review anchors
Decision: whole-text recommendations must resolve to stable paragraph identities plus a document revision snapshot, while visible paragraph numbers remain display-only.

Reason: paragraph numbering changes after splits, insertions, and deletions, so unresolved recommendations cannot safely depend on numeric labels alone.

### Review layout split
Decision: compact whole-text recommendation cards live in the right operations panel, while the selected recommendation detail and prepared proposal remain inline in the manuscript.

Reason: this matches the current right-rail layout direction, keeps diagnostics/history close to recommendations, and still keeps approval at the manuscript anchor.

### Editable review templates
Decision: the whole-text review prompt, level-1..5 mapping, callout prompt template, and image-prompt template will all be editable in Settings.

Reason: consistency depends on explicit, inspectable templates rather than hidden prompt text, especially once recommendation types and change depth become part of the product contract.

### Reuse the patch pipeline for text proposals
Decision: when `Працюй!` prepares a text-oriented proposal from a whole-text recommendation, it reuses the existing structured patch-generation path instead of introducing a second text-diff engine.

Reason: one local text-diff pipeline is easier to harden, easier to review, and keeps `prepare` + `apply` behavior aligned with the existing patch-first workflow.

### Generated review images stay asset-only for now
Decision: Gemini-generated draft images are preview/download assets and are not inserted into the manuscript automatically.

Reason: the current editor still treats markdown text as the canonical source and does not yet have a safe image-embedding contract.

### Large manuscript diff is the editable review checkpoint
Decision: the editable green replacement lives in the large manuscript diff-review block shown after apply, not in the smaller rail card. Editing that field updates the already-applied manuscript text and the visible diff marker together.

Reason: the main editorial comparison happens in the large canvas diff, and keeping editability there avoids adding two competing edit points for the same patch while keeping the rail card lightweight.

### Explicit image insertion gating
Decision: review-generated images are inserted into manuscript source only through an explicit `Вставити зображення` action that appears after successful generation.

Reason: the editor's trust model requires explicit user intent before any source mutation; image generation alone must remain non-destructive.

### Manuscript image embedding strategy (v1)
Decision: v1 manuscript markdown stores `asset:` tokens for browser-local images inside the image block (`![alt](source)`), while keeping the source field generic enough for later remote URLs.

Reason: `asset:` tokens keep markdown deterministic and reversible without serializing binary image payloads into the persisted draft, which avoids `localStorage` quota failures and still preserves a clean migration path toward uploaded assets later.

### Image asset reference model
Decision: generated review images and manually inserted editor images both use a typed reference shape (`assetId` + `source`) backed by a minimal IndexedDB asset registry in the browser.

Reason: one asset path removes duplication between generated and manual images, keeps draft state small enough to persist safely, and preserves a clean migration path to uploaded/remote asset URLs later without changing proposal semantics.

### Manuscript editor migration target
Decision: the next manuscript-surface migration target is CodeMirror 6, used as one source-visible markdown editor with in-place syntax decoration rather than a preview-vs-textarea swap.

Reason: the current markdown preview/raw-edit split causes click and caret drift because the user sees one layout and edits against another. CodeMirror keeps one canonical string while still allowing gutters, decorations, widgets, and stable coordinate-based overlays.

### Recommendation card placement model
Decision: persistent whole-text recommendation cards should render in a synchronized lane beside the manuscript editor, not as inline blocks inside markdown source.

Reason: recommendation cards need to stay visually tied to highlighted paragraph ranges without altering manuscript flow, offset mapping, or click targets. A synchronized side lane matches the desired Google Docs-style interaction more safely.

### Side overlays stay out of manuscript flow
Decision: recommendation detail and selected image previews must render as detached side overlays, while markdown source remains the only in-flow manuscript content.

Reason: once tall rich previews participate in manuscript flow, they reintroduce cursor-hit mismatch and width compression. Keeping side UI out of flow preserves one trustworthy source geometry for typing.

## 2026-03-08

### Callout pre-generation model
Decision: `Врізка` content is generated during the initial whole-text review response, and applying a callout is terminal for that recommendation (insert + close detail + remove card).

Reason: callouts are append-style editorial aids, so they should be ready immediately without a second generation loop; auto-removing the applied recommendation keeps the queue accurate and prevents duplicate insertions.

### Callout strict-quality policy
Decision: if model output for `Врізка` is topic-level, instruction-like, or otherwise not a usable explanatory block, the recommendation is dropped and surfaced as an explicit review error; no server template prose is injected.

Reason: placeholder fallback copy hides generation failures and undermines editorial trust. For this workflow, a visible failure is preferable to silently inserting low-quality synthetic text.

## 2026-03-08 - Toolbar should stay compact and symbol-first

- Status: Accepted
- Context: The toolbar needed to become clearer without turning into a bulky block of labeled cards.
- Decision: Use compact symbol-led controls, keep them grouped, and rely on tooltip plus aria labels for full explanation.
- Consequences: The toolbar stays visually light and fast to scan while still remaining understandable for less technical editors once hover/focus guidance is available.

## 2026-03-10

### Browser-side DOCX export
Decision: implement manuscript export as browser-side `.docx` generation with a toolbar action in `/editor`, mapping markdown to polished DOCX structure and resolving images client-side.

Reason: local manuscript images are stored as browser `asset:` tokens in IndexedDB, so browser-side export is the safest way to embed those assets without introducing an upload backend or leaking binary payloads through server routes.

### Export scope wording
Decision: keep `export patch flow` out of MVP scope while allowing polished manuscript `.docx` export.

Reason: patch export and revision-history workflows remain separate product scope decisions; current export only targets final manuscript handoff to Word/Google Docs.
