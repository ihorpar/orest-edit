# CURRENT_STATE

Date: 2026-03-16
Status: Active handoff

## What exists now
- A web-only Next.js app under `apps/web`
- Main working screen at `/editor`
- `/editor` uses a block-first rich editor surface
- Canonical editor state is `EditorDocument { version: 2, blocks[] }` with stable block IDs
- Supported block types in the editor: `paragraph`, `heading`, `bullet_list`, `ordered_list`, `image`, `callout`, `divider`, `table`
- Manual editing happens inside blocks with inline `bold`, `italic`, and `link` formatting
- `Enter` inside paragraph-like editing creates a new block
- Paragraph numbering is visible and tracks block IDs
- Local AI patch requests are block-based and send `targetBlockIds`, not character offsets
- Local patch apply semantics are whole-block replacement
- Whole-text review exists through `/api/edit/review`
- Whole-text recommendation preparation exists through `/api/edit/review/proposal`
- Whole-text review anchors resolve by block IDs and block fingerprints
- Whole-text review prompt assembly now preserves explicit image markers in document lines (`[image] alt: ...; caption: ...`) instead of flattening image blocks into plain text
- `/editor` now renders a unified step workspace shell with manuscript + draggable resizer + flyout review drawer + icon-first mini-hub (Lucide) for 8-step navigation
- `/api/edit/review` is now step-aware: request/response contracts include `stepId`, `stepRunId`, `runMode`, `stepContext`, and optional `factCheckRows`
- Step-specific Ukrainian prompts are now wired in backend for `diagnostics`, `fact_check`, `structure`, `clarity`, `interest`, `visuals`, `formatting`, and `final_editing`
- `clarity` review prompts and downstream `rewrite`/`simplify` execution prompts now explicitly forbid generic consultation/self-diagnosis boilerplate and preserve short-list rhythm unless the editor asks for a safety framing
- Diagnostics is now review-only (no direct card generation CTA); fact-check has its own explicit run action in step 2
- Fact-check table data now comes from provider-native structured output (`rows[]`) instead of UI heuristics
- Gemini fact-check now runs through grounded Google Search on `gemini-3.1-flash-lite-preview`; row sources are derived from `groundingMetadata` into structured `sources[]`, with low-trust domains filtered out
- Per-step `preserve/replace` run mode, feedback memory, and run history are now persisted in browser draft state (`orest-editor-draft-v3`)
- Whole-text review taxonomy is normalized to `rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`, and `visual`
- Legacy provider output for `visualize`, `illustration`, and old callout kinds is coerced into the current review contract
- The editor right rail shows review cards and request history
- Review cards now show dynamic Ukrainian paragraph ranges (`Абз. 0NN[-0NN]`) derived from current block order rather than raw block IDs
- Compact recommendation cards now truncate recommendation copy to two lines by default and allow per-card expand/collapse for full text
- Compact recommendation cards now default to the shorter recommendation `title`; a larger disclosure control reveals the full recommendation copy inline when needed
- Compact recommendation status chips are now fully localized in Ukrainian (`очікує`, `готово`, `погоджено`, `відхилено`, `застаріло`, `готується`)
- Compact recommendation cards are now keyboard-focusable and support `Enter`/`Space` activation while keeping click-to-focus + auto-prepare flow
- Dismissed recommendations now expose a 5-second inline undo affordance (`Повернути`) in the step drawer
- Replace diff cards now use explicit rejection semantics (`Відхилити`) instead of the ambiguous `Скасувати`, so declining a prepared recommendation moves it to the rejected state
- Active recommendation cards now include a `Доопрацювати` action with a short editor instruction field; that instruction is sent only to the current card's regenerate flow
- Post-generation AI self-explanations were removed from execution cards; active cards now keep only the original recommendation context plus the generated result
- Review-action prompt contracts no longer ask providers to generate extra post-edit `reason/summary` text for replace/callout/subsection drafts
- Recommendation-step drawers now show one recommendation queue only; the duplicate `Правки` section was removed
- Recommendation-step drawers now hide completed cards by default and expose a `Показати завершені` toggle
- Recommendation-step stats now use explicit labeled copy (`в роботі`, `погоджено`, `відхилено`) instead of compact numeric slash counters
- Step drawer headers now place `Етап N / 8` under the title and use an icon-only rerun control with tooltip copy
- Step 2 (`Перевірка фактів`) now has a dedicated table view in the flyout drawer with columns `Твердження`, `Статус`, and `Пояснення та джерела` populated from structured provider output
- Fact-check explanations now render trusted source chips separately from explanation text; when no acceptable grounded source is available, UI shows `Немає надійного джерела`
- Step 2 (`Перевірка фактів`) now also auto-generates anchored follow-up cards for non-`ok` claims (local `rewrite` or `myths_vs_truth` `callout`), so fact-check findings can be acted on directly in the manuscript
- Step run CTA (`Запустити/Оновити`) now lives in the drawer header area for diagnostics, fact-check, and recommendation steps
- The manuscript surface now highlights the active recommendation anchor range in place and renders one inline execution surface below the affected range
- Replace-type review proposals now open as one inline diff card below the highlighted range instead of replacing the manuscript blocks with loaders/placeholders
- `callout`, `visual`, and stale/preparing recommendation states now execute from the manuscript surface through one floating inline card
- Execution cards no longer render duplicated rationale/excerpt context; focus stays on editable fields and CTA actions
- Callout execution panels no longer render raw prompt text; only kind/title/body + regenerate/insert actions remain
- Visual execution panels now include editable caption and keep prompt-editable flow with generate/regenerate/insert actions
- Visual execution now supports local style presets (`minimal`, `calm_gradient`, `neo_brutal`, `modern_glass`) in both manuscript-inline visual cards and manual visual launcher
- Visual type selection is now intentionally simplified to two user-facing intents (`інфографіка`, `ілюстрація`); when `інфографіка` is selected, prompt assembly auto-picks a concrete composition subtype from the fragment context
- The last selected visual style preset now persists in browser localStorage (`orest-visual-style-v1`) and is reused for subsequent visual prompt preparation
- Visual proposal parsing now supports both JSON (`prompt` + optional `caption`/`alt`) and plain-text prompt fallback
- Replace-type review proposals now edit/apply block-by-block instead of flattening the full replacement range into one repeated textarea string
- Replace-type review preparation now enforces block-count constraints by recommendation type (`rewrite/simplify/expand` exact count, `list` capped by selected range)
- List-type review normalization now coerces paragraph-only provider responses into `bullet_list` blocks to avoid list no-op applies
- The manuscript now marks active replace-source blocks in red while the inline diff card renders only proposed replacement blocks in green (no nested old/new card frames)
- Replace-source highlighting in manuscript remains red but no longer uses strikethrough decoration
- After apply/insert actions, the editor auto-scrolls to the first changed block and highlights all affected blocks in green for 30 seconds
- Rewrite/simplify execution now strips markdown artifacts from replacement text and flags near-no-op outputs with explicit regenerate guidance
- Replace-type proposal generation (`rewrite`, `simplify`, `expand`, `list`) now runs through a dedicated lightweight proposal-content contract in `review-action-service` instead of reusing the generic nested patch-diff generator; LLMs return plain replacement content (`replacements[]` or `items[]`) and the server reconstructs final block-first `text_diff`
- Gemini `rewrite`/`simplify`/`expand` proposal generation now uses a lightweight `replacements[] + reason` schema with local block reconstruction instead of the older nested Gemini `newBlocks` contract, which avoids timeout-prone local replace requests on Flash Lite
- Inline replace proposal editors now auto-fit height to content and keep an unlabeled clean vertical stack of green blocks
- Repeated no-op regenerate attempts for the same rewrite/simplify review item now escalate warning copy with explicit instruction-quality guidance
- `subsection` recommendation preparation now returns an editable heading+optional lead draft and applies insertion before the first affected block
- Subsection preparation now has a deterministic fast-path: when recommendation text already includes explicit `Підзаголовок:` + `Текст:`, the draft is built directly from that instruction without an extra model call
- The floating `Локальна правка` panel can now launch manual AI inserts (`Врізка`, `Візуал`) from selected blocks via synthetic review items
- Manual callout/visual launches now upsert a review item before proposal preparation, preserve one active execution lane, and dedupe repeated same-selection same-type clicks
- The floating `Локальна правка` panel now uses explicit local mode switches (`Правка`, `Врізка`, `Візуал`) so each mode has one unambiguous primary action and mode-specific prompt usage
- Review-image generation endpoints already exist at `/api/edit/review/image`
- Review-image generation is now wired into the inline manuscript execution card and can insert an image block below the anchor
- Runtime proposal prompt contracts are now aligned by action type: replace uses structured block diff JSON, callout/subsection use strict JSON drafts, and image uses one downstream plain-text prompt (while parser remains backward-compatible with legacy JSON image drafts)
- Review-action request handling now normalizes and trims prompt-heavy inputs server-side (including non-replace document compaction to anchor-related blocks) to avoid oversized proposal-generation contexts
- Step run feedback for recommendation steps now reports card count for the specific step section (post-merge in preserve/replace mode), not a potentially ambiguous global count
- Image prompt assembly now supports `{{visualStyleGuide}}` and always injects style guidance, including fallback injection when placeholder is removed from template
- `top_list` callout prompt contracts now require source-bound multi-line `Назва: пояснення` entries and include two-shot examples directly in the template
- Callout parsing/sanitization is now kind-aware for `top_list`, preserving multi-line readability and normalizing entries into actionable `Назва: пояснення` lines
- Callout parsing/sanitization is now also kind-aware for `myths_vs_truth`, splitting inline `Міф:` / `Правда:` runs into separate draft lines; subsection draft leads now preserve paragraph breaks through preview and insert
- Image-prompt normalization now strips editorial wrappers (`Опис сцени`, `Пояснення visualIntent`, etc.) before downstream generation
- Replace/list recommendation range normalization now clips accidental adjacent heading spillover and surfaces a concise clipping note in recommendation reason
- Stale recommendation focus now attempts an inline anchor refresh + reproposal when block IDs still resolve; unresolved stale anchors now show explicit rerun guidance
- Inline replace previews now hide the regular block-delete `×` affordance on the red "before" block, preventing confusion with review cancel/reject actions
- Recommendation steps with no prior run now show an explicit empty-state CTA (`Згенерувати картки`) in the drawer, while the header control stays compact and switches from rerun to generate semantics/iconography before first run
- Drawer utility controls now use clearer button affordances: step run/rerun actions render as quiet secondary buttons, empty-state generate CTA uses a light blue action treatment, and `Показати завершені` now reads as a compact utility button instead of near-invisible text
- Inline diff execution now demotes rationale behind `Що зробив ШІ?`, keeping the proposed text and apply/cancel actions as the primary surface
- Inline recommendation detail cards now expose the same `Що зробив ШІ?` disclosure instead of always-on supporting explanation
- Regression suites now include inline execution-lane state coverage and subsection insert-before anchor edge cases
- Reusable browser QA command now exists at `npm run qa:inline-review -w @orest/web` (password-gated login + inline execution lane assertions + screenshot)
- The manuscript top action bar now separates document-level actions from block formatting: `Відкрити` menu on the left, `Зберегти` menu on the right, plus red clear-document icon and debug `Скинути`
- Import v1 now exists through `Відкрити`: `.txt`, `.docx`, and clipboard text/HTML are normalized into the block document model before replacing the current manuscript
- Save v1 now supports both `.docx` and `.txt` from the same `Зберегти` menu
- Browser draft persistence uses `orest-editor-draft-v3`
- `.docx` export renders directly from the block document model
- Browser-local image assets use the existing asset store
- Settings live at `/settings` and still provide provider/model/API-key configuration with live validation
- Successful connection checks on `/settings` now also persist the selected provider/model/API-key locally, so `/editor` reuses the validated connection on the next load
- In-app password auth still gates `/editor`, `/settings`, and API routes through `/login`
- A repo-native production deploy fallback now exists at `.github/workflows/vercel-production-deploy.yml` (push to `master` -> `vercel build --prod` -> `vercel deploy --prebuilt --prod`)
- Ukrainian UI copy remains the product baseline
- The visual direction is still aligned with `docs/sample4.html`

## What does not exist now
- No separate backend service
- No server-side persistence layer
- No markdown editing workflow in the main product path
- No character-offset patch flow
- No CI-integrated full browser E2E suite yet for the block editor (current coverage is a local scripted QA command)
- No hardened provider normalization yet for arbitrary mixed block output from real models
- No full fidelity Word/paste import yet for tracked changes, comments, footnotes, embedded images, or shapes
- No export patch flow or document version history
- No manual launcher for `subsection` in the floating panel yet (manual v1 covers only `callout` and `visual`)
- No full runtime browser QA pass yet for the complete 8-step workflow after step-aware contract migration

## Current product direction
- User: book editor
- Task: simplify dense scientific writing into simple Ukrainian while preserving meaning and author intent
- Editing model: patch-first and diff-first
- Visual baseline: `sample4`

## Current product decisions already reflected in code
- The canonical editor model is block-first; markdown is not part of the main editing workflow
- AI operations are block-anchored and replace whole selected block ranges, not character offsets
- The editor surface is a docs-like rich block editor, not a source-visible markdown editor
- DOCX remains the external handoff/export format
- Existing browser-local drafts were intentionally reset by the v2 migration
- The first-class inline formatting set in v1 is limited to `bold`, `italic`, and `link`
- `callout` is already a first-class block type
- `image` is already a first-class block type

## Highest-priority next work
1. Expand browser QA scenarios beyond the current inline manual `callout`/`visual` path (stale anchors, subsection insert flow, dense-card interactions).
2. Add CI wiring for `qa:inline-review` in an environment with Playwright browser dependencies preinstalled.
3. Harden right-rail/manuscript visual polish further to match `sample4` interaction quality under dense recommendation sets.

## Last validated state
- `npm run typecheck -w @orest/web` passed on 2026-03-11 after pass-2 updates (top_list hardening, no-op escalation, range clipping, autosize diff editors)
- `npm run build -w @orest/web` passed on 2026-03-11 after pass-2 updates (top_list hardening, no-op escalation, range clipping, autosize diff editors)
- `npm run test -w @orest/web` passed on 2026-03-11 (47 tests), including new coverage for top_list normalization, numeric-line preservation in callout cleanup, range clipping, and callout template hardening
- Runtime smoke check with password gate succeeded on 2026-03-11 (`/editor` redirected to `/login` before auth)
- `npm run qa:inline-review -w @orest/web` passed on 2026-03-11 using `APP_PASSWORD=@orest0krat` + local dev server on `http://127.0.0.1:3100`; validated login gate, multi-block anchor highlighting, and single inline card execution for manual `callout` and `visual`
- `npm run typecheck -w @orest/web` passed on 2026-03-12 after step-aware review contract migration (separate step prompts, fact-check rows contract, per-step run persistence)
- `npm run test -w @orest/web` passed on 2026-03-12 after step-aware review contract migration (13/13 suites, including review-service structured fact-check coverage)
- `npm run typecheck -w @orest/web` passed on 2026-03-12 after step feedback + fact-check CTA placement update
- `npm run test -w @orest/web` passed on 2026-03-12 after step feedback + fact-check CTA placement update (13/13 suites)
- `npm run typecheck -w @orest/web` passed on 2026-03-13 after Gemini replace-path simplification for `rewrite/simplify/expand`
- `npm run test -w @orest/web` passed on 2026-03-13 after replace-proposal architecture simplification (70/70 tests), including lightweight OpenAI/Gemini replace-schema checks and existing frontend-adjacent apply/execution-lane coverage
- `npm run typecheck -w @orest/web` passed on 2026-03-14 after compact-card UX pass (2-line clamp + expand, localized statuses, keyboard activation, stale refresh path, dismiss undo)
- `npm run test -w @orest/web` passed on 2026-03-14 after tightening `clarity` anti-disclaimer prompt guardrails and adding regression coverage
- `npm run typecheck -w @orest/web` passed on 2026-03-14 after drawer simplification pass (single recommendation queue, hide-completed toggle, labeled stats, lighter inline explanation surfaces)
- `npm run typecheck -w @orest/web` passed on 2026-03-14 after top action bar import/export pass (`Відкрити`, `Зберегти`, clear-document icon, `.docx/.txt` + clipboard/file import)
- `npm run test -w @orest/web` passed on 2026-03-14 after top action bar import/export pass (75/75 tests), including new `.txt` and `.docx` import coverage
- `npm run test -w @orest/web` passed on 2026-03-14 after callout/subsection formatting pass, including new coverage for `myths_vs_truth` line splitting and subsection lead paragraph preservation
- `npm run build -w @orest/web` passed on 2026-03-14 after top action bar import/export pass (`Відкрити`, `Зберегти`, clear-document icon, `.docx/.txt` + clipboard/file import)
- `npm run typecheck -w @orest/web` passed on 2026-03-16 after reject/doopрацювати review-card pass
- `node --import tsx --test test/review-action-service.test.ts` passed on 2026-03-16 after wiring per-card editorial refine instructions into proposal prompts
- `npm run typecheck -w @orest/web` passed on 2026-03-16 after grounded Gemini fact-check source integration
- `node --import tsx --test test/review-service.test.ts` passed on 2026-03-16 after grounded Gemini fact-check source integration
- `npm run typecheck -w @orest/web` passed on 2026-03-16 after removing post-generation explanation UI and slimming review-action prompt schemas
- `node --import tsx --test test/review-action-service.test.ts test/review-contract.test.ts test/review-execution-lane.test.ts` passed on 2026-03-16 after removing post-generation explanation UI and slimming review-action prompt schemas
- `npm run typecheck -w @orest/web` passed on 2026-03-17 after linking `fact_check` rows to anchored `rewrite/callout` review cards in the step drawer
- Live Gemini check on 2026-03-13: the provided one-block `rewrite` payload returned a real `text_diff` in about 1.3s via `generateReviewAction` with `gemini-3.1-flash-lite-preview`; the prior nested-schema path timed out after about 62s on the same payload
- `npm run build -w @orest/web` failed on 2026-03-12 with generic `Build failed because of webpack errors` in this environment (no stacktrace surfaced in command output)
