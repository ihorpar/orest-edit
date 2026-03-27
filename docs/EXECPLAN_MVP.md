# Build Inline Review Execution For Multi-Block Editorial Suggestions

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

## Purpose / Big Picture

The block-first editor vertical slice already exists, but the current whole-text review execution model does not match the intended product. Recommendations can be generated, but they are still executed mostly through the right rail, proposal handling is uneven across suggestion types, and the manuscript does not yet behave like the anchored, in-place review surface shown in `docs/sample4.html`.

The next phase turns whole-text review into a manuscript-first workflow. A recommendation may target one or more contiguous blocks, those affected blocks are highlighted in the editor with one continuous left-side border, one floating execution card appears below the full affected range, and the card behavior depends on the suggestion type. Replace-type suggestions stay full-paragraph only. Insert-type suggestions create first-class blocks such as `callout`, `image`, or a new subsection heading. All AI prompts involved in review, proposal generation, callout drafting, and image prompt generation must be written in Ukrainian, and generated image prompts must also be Ukrainian.

After this change, a Ukrainian-speaking book editor can run whole-text review, click a recommendation in the right rail, inspect the full affected range in the manuscript, review one clear inline execution card, edit the proposed replacement or prompt, and explicitly apply or insert the result without collapsing the document into unstable block churn.

## Progress

- [x] (2026-03-10 00:00Z) Replaced the markdown-string manuscript state with a block-first `EditorDocument` model, moved draft persistence to `orest-editor-draft-v2`, and intentionally dropped compatibility with legacy markdown drafts.
- [x] (2026-03-10 00:00Z) Replaced offset-based patch and review contracts with block-anchored APIs and whole-block replacement apply semantics.
- [x] (2026-03-10 00:00Z) Rebuilt `/editor` as a docs-like rich block surface with inline formatting, gutter-based block selection for AI actions, and first-class block insertion for image, callout, divider, and table content.
- [x] (2026-03-10 00:00Z) Moved manuscript revision tracking and review anchors to stable block IDs and block fingerprints.
- [x] (2026-03-10 00:00Z) Replaced markdown-driven DOCX export with direct export from the block document model, including headings, lists, tables, callouts, images, and inline formatting.
- [x] (2026-03-10 00:00Z) Rebuilt patch/review/apply tests around block-first contracts and removed legacy markdown/offset test paths.
- [x] (2026-03-10 00:00Z) Verified the migrated slice with `typecheck`, `test`, `build`, and an authenticated runtime smoke check against `next start`.
- [x] (2026-03-11 00:00Z) Fixed the in-editor preparing state so a single pending review card shows one loader row instead of duplicating across the full anchor range.
- [x] (2026-03-11 00:00Z) Reframed the next implementation phase around inline manuscript execution, full-paragraph-only replace suggestions, the new callout taxonomy, and Ukrainian prompt contracts.
- [x] (2026-03-11 00:00Z) Hardened whole-text review taxonomy to the seven-type model, added legacy-to-current normalization for `visualize`/`illustration` and old callout kinds, and made `subsection` preparation fail safely until its dedicated inline flow lands.
- [x] (2026-03-11 00:00Z) Fixed the broken multi-block review diff editor so proposal editing/apply stays block-aware instead of flattening the whole range into one repeated string.
- [x] (2026-03-11 00:00Z) Added an active recommendation detail panel in the right rail so `callout` and `visual` recommendations can be prepared, inspected, and applied without relying on unfinished manuscript-inline cards.
- [x] (2026-03-11 00:00Z) Expanded callout prompt contracts with explicit per-kind behavior text in both settings defaults and runtime provider prompt assembly.
- [x] (2026-03-11 00:00Z) Replaced rail-first execution with manuscript-first anchor highlighting, one inline execution surface below the affected range, and dynamic Ukrainian paragraph labels on cards/details.
- [x] (2026-03-11 00:00Z) Reworked `rewrite`, `simplify`, `expand`, and `list` into constrained full-block replace flows with recommendation-type block-count guardrails.
- [x] (2026-03-11 00:00Z) Implemented `subsection` as a dedicated inline insertion flow with editable heading/lead draft and insert-before-anchor apply path.
- [x] (2026-03-11 00:00Z) Replaced the current callout taxonomy with the approved five kinds and built generate/regenerate plus explicit insert flow.
- [x] (2026-03-11 00:00Z) Merged `visualize` and `illustration` into one `visual` family and wired editable Ukrainian image prompts, generation, regeneration, and image block insertion below the affected range.
- [x] (2026-03-11 00:00Z) Added callout kind switching plus editable title/body in the manuscript-inline execution card, and hardened callout/image prompts to require editor-compatible plain-text output.
- [x] (2026-03-11 00:00Z) Fixed insertion anchor fallback so `after` insertions default to the last block in the anchor range when provider payload omits `anchorBlockId`.
- [x] (2026-03-11 00:00Z) Added dedicated Ukrainian runtime prompt factories for replace-type actions and subsection insertion, plus stronger per-kind anti-hallucination guardrails for callouts.
- [x] (2026-03-11 00:00Z) Added dedicated regression tests for single inline execution lane state resolution and subsection insert-before anchor edge cases.
- [x] (2026-03-11 00:00Z) Resolved local `esbuild` platform mismatch and restored green `npm test -w @orest/web` execution in this workspace.
- [x] (2026-03-11 00:00Z) Added reusable browser QA command `npm run qa:inline-review -w @orest/web` and validated password-gated inline execution flow (single-lane anchors + manual `callout`/`visual`).
- [x] (2026-03-11 00:00Z) Completed callout/visual/rewrite-simplify UX pass: hidden callout prompt UI, visual caption parsing+editing, insertion-context labels, collapsible rationale section, no-op warning state for rewrite/simplify, and markdown-leakage cleanup in replace normalization.
- [x] (2026-03-25 00:00Z) Hardened manuscript-toolbar interaction so inline formatting preserves range selection, list toggles can exit back to paragraphs, and focused spellcheck wrappers no longer force needless active-editor DOM rewrites.
- [x] (2026-03-25 00:00Z) Switched local `list` intent to the review-backed proposal flow, restored visible bullet prefixes in the green diff editor, and added manual-list router/item regression coverage.
- [x] (2026-03-25 00:00Z) Restored review-card recovery for manual local generation by binding manual cards to visible workflow steps and exposing rerun from completed-card views after dismissal.
- [x] (2026-03-25 00:00Z) Removed the broken inline link affordance, added local send-button spinner states, preserved spellcheck findings across separate untouched-block runs, surfaced local patch results inline, and taught fallback list rewrites to produce a visible paragraph draft.
- [x] (2026-03-25 00:00Z) Added session-scoped manuscript undo/redo plus persisted accepted-change compare snapshots, with top-bar controls, keyboard shortcuts, and a focused `Було` / `Стало` compare dialog.
- [x] (2026-03-25 00:00Z) Fixed the destructive empty-list-item `Enter` path so exiting a list no longer wipes the entire block, and normalized provider fetch failures to a user-facing fallback message instead of raw `fetch failed`.
- [x] (2026-03-26 00:00Z) Added a narrow AI-formatting policy: proposals may carry sparse `**bold**` emphasis, the diff/apply path preserves those markers, and accepted content lands as real inline `bold` in the manuscript.
- [x] (2026-03-26 00:00Z) Added a focused full-screen visual workspace for prompt/result review, kept it bound to the same active visual proposal state as the inline card, and invalidated stale generated previews whenever the prompt text changes.
- [x] (2026-03-26 00:00Z) Hardened the floating local composer for tablet/mixed-input use: it now clamps itself inside the visible viewport, keeps its body scrollable instead of clipping, and supports draggable repositioning with session-local position persistence.
- [x] (2026-03-26 00:00Z) Changed local-composer mode precedence so explicit `Правка` tab selection beats keyword inference; feature keywords now surface as a non-blocking suggested top pill inside `Правка` instead of force-switching tabs.
- [x] (2026-03-26 00:00Z) Implemented the `Акценти` pass as an inline manuscript layer: exact quoted phrases render as blue bold clickable overlays, accept applies real inline `bold`, reject dismisses the suggestion, and the right drawer lists emphasis items without opening a diff flow.

## Surprises & Discoveries

- Observation: the current whole-text review UI is rail-first, not manuscript-first.
  Evidence: `apps/web/components/editor/EditorialReviewCard.tsx` only renders compact cards in the right rail, while `apps/web/components/editor/BlockDiffOverlay.tsx` is the only inline execution UI and is only used for `text_diff`.

- Observation: the current multi-block diff apply path is structurally unsafe.
  Evidence: `apps/web/components/editor/BlockDiffOverlay.tsx` merges all replacement blocks into one textarea, and `apps/web/app/editor/page.tsx` currently writes the same edited string back into every paragraph/heading block in the proposal.

- Observation: anchors are not purely based on block order, but excessive replacement block churn still creates stale neighboring suggestions.
  Evidence: `apps/web/lib/editor/manuscript-structure.ts` uses stable `block.id` plus fingerprint for anchor resolution, yet `apps/web/lib/editor/patch-contract.ts` can build more replacement blocks than were originally selected and `apps/web/lib/editor/document-model.ts` only preserves existing IDs for the replaced range.

- Observation: a first-class review-image backend already exists, but the manuscript UI does not expose it yet.
  Evidence: `apps/web/lib/server/review-image-service.ts`, `apps/web/lib/server/review-image-job-service.ts`, and `/api/edit/review/image` exist, while `apps/web/app/editor/page.tsx` currently only shows a feedback message after preparing an `image_prompt`.

- Observation: `docs/sample4.html` already demonstrates the correct composition pattern for this phase.
  Evidence: the sample shows one anchored selection and one floating patch card, not a stack of duplicated placeholders or a right-rail-only execution flow.

- Observation: the previous `esbuild` platform mismatch is fixed for this workspace.
  Evidence: `npm test -w @orest/web` now runs all suites successfully after installing `@esbuild/linux-x64`.

- Observation: browser QA is now scriptable and repeatable from the repo.
  Evidence: `apps/web/scripts/qa-inline-review.mjs` executes login, selection, manual generation, and single-lane assertions; command is exposed as `npm run qa:inline-review -w @orest/web`.
- Observation: preserving DOM node ranges is not enough for toolbar formatting inside `contentEditable`.
  Evidence: runtime QA on 2026-03-25 showed `execCommand("bold")` still collapsed selection after click until toolbar actions switched to `mousedown` execution with cached text-offset restoration.
- Observation: manual local review items were already grouped into workflow steps, but the drawer did not switch to those steps automatically.
  Evidence: `mapReviewItemsByStep(...)` in `apps/web/app/editor/page.tsx` grouped manual `list` items under `formatting`, yet the UI stayed on the previous step, making dismissed cards unreachable in practice.

- Observation: the first post-migration diff editor was structurally incompatible with multi-block review replacements.
  Evidence: `apps/web/components/editor/BlockDiffOverlay.tsx` used one textarea for all replacement blocks and `apps/web/app/editor/page.tsx` wrote that single edited string back into every block of the proposal.

- Observation: replacing manuscript rows with loaders while a recommendation is preparing breaks both continuity and trust.
  Evidence: `apps/web/components/editor/BlockEditorSurface.tsx` previously returned `null` for most anchored blocks and replaced the lead block with a dashed loader, which visually looked like empty blocks being inserted into the document.

- Observation: paragraph numbers must stay a UI-layer projection, not part of the persisted review anchor.
  Evidence: anchor correctness still depends on stable block IDs and fingerprints in `apps/web/lib/editor/manuscript-structure.ts`, but user-facing ranges need to be recomputed from current `revision.blockOrder` after every accepted edit.

- Observation: provider payloads can omit `anchorBlockId`, which made `after` insertions drift to the first anchored block under fallback behavior.
  Evidence: `apps/web/lib/editor/review-contract.ts` now resolves default insertion anchors by insertion mode (`after` => last block, `before` => first block).

- Observation: enforcing replace block-count constraints at review-action normalization avoids breaking generic local patch behavior while still protecting review execution anchors.
  Evidence: `apps/web/lib/server/review-action-service.ts` now normalizes overflow/underflow output by recommendation type before publishing `text_diff`.

- Observation: local `patch` requests were still updating only background patch state, while the manuscript surface renders replace drafts from `activeProposal`.
  Evidence: runtime QA on 2026-03-25 showed `Переписати` returning `replace_blocks` from `/api/edit/patch` with no visible result until the first local patch operation was promoted into the inline diff lane in `apps/web/app/editor/page.tsx`.
- Observation: “undo” and “compare previous text” are related trust needs, but they should not share the same storage model.
  Evidence: manuscript recovery needs cheap in-memory mutation snapshots for immediate reversal, while accepted-change inspection needs durable before/after evidence that survives refresh in browser draft state.
- Observation: list editing needs a separate “exit list” path, not the same conversion behavior as deleting a whole list block.
  Evidence: handling `Enter` on an empty list item by replacing the whole block with a paragraph caused the entire list content to disappear when the editor created a trailing empty bullet and pressed `Enter` again.
- Observation: the request for “AI bold accents” is mostly a transport problem, not a rendering primitive problem.
  Evidence: the editor model already supports inline `bold`, but review/prompt contracts, sanitizers, and diff editors were flattening generated text to plain strings before apply.
- Observation: the customer’s “highlight key theses” request maps much closer to spellcheck interaction than to rewrite proposal execution.
  Evidence: once the requirement was narrowed to “inline blue bold + click accept/reject + no diff”, the existing step-card/proposal flow became the wrong abstraction; the manuscript already had one proven inline-inspection pattern through spellcheck popovers.
- Observation: the visual workflow already had most of the data plumbing; Epic 7 was primarily a state-sharing and surface-layout problem.
  Evidence: `ReviewRecommendationDetail.tsx` already exposed editable prompt/caption/style/intent plus generate/apply handlers, so the new focused workspace could reuse the same proposal callbacks instead of introducing a second visual draft model.
- Observation: the reported iPad panel failure was not reproducible as a total render loss in headless tablet emulation; the more credible root cause was viewport-relative placement without runtime clamping.
  Evidence: authenticated Playwright checks at `1032x1376` and `1024x600` rendered the composer, but the old implementation still relied on one fixed bottom-center transform with no drag affordance, no resize clamping, and no internal overflow fallback.
- Observation: the original `Правка` tab was not actually an explicit user mode.
  Evidence: `handleModeSelect("edit")` mapped back to `localActionMode === "auto"`, and `localSurfaceMode` then re-derived the visible tab from `localActionRoute.executor`, so keywords like `правопис` could immediately pull the UI back out of `Правка` after a manual click.

## Decision Log

- Decision: whole-text recommendations may anchor one or more contiguous blocks, but the execution UI remains singular per recommendation.
  Rationale: editorial problems often span several adjacent paragraphs, yet the UI must still read as one task, one anchor, and one execution card.
  Date/Author: 2026-03-11 / Product direction confirmed with user

- Decision: the top-level review suggestion types are `rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`, and `visual`.
  Rationale: this set is broad enough for editorial work while keeping execution behavior comprehensible; `illustration` is treated as `visualIntent`, not a top-level type.
  Date/Author: 2026-03-11 / Product direction confirmed with user

- Decision: `expand` is a replace-type suggestion, not an insertion type.
  Rationale: the current editor safely supports whole-block replacement; keeping `expand` inside replace semantics avoids a second ambiguous insertion flow.
  Date/Author: 2026-03-11 / Product direction confirmed with user

- Decision: replace-type suggestions are full-block only. No phrase-level diffs, no character-offset patches, and no partial-paragraph apply states are part of this MVP.
  Rationale: the editor model is block-first and trust depends on visible, whole-paragraph replacement rather than brittle inline surgery.
  Date/Author: 2026-03-11 / Product direction confirmed with user

- Decision: `subsection` inserts a subheading before the first affected block and may optionally include a short lead paragraph in the proposal card.
  Rationale: subsection recommendations are valuable, but they need a narrow, predictable behavior rather than a vague “restructure” action.
  Date/Author: 2026-03-11 / Product direction confirmed with user

- Decision: approved callout kinds are `mechanism`, `analogy`, `everyday_application`, `myths_vs_truth`, and `top_list`.
  Rationale: these callout modes are editorially useful for science-pop and medical-pop manuscripts without drifting into generic marketing or social content patterns.
  Date/Author: 2026-03-11 / Product direction confirmed with user

- Decision: all AI prompts in this flow are Ukrainian, and generated image prompts must also be Ukrainian.
  Rationale: the editor UI is Ukrainian, the editorial workflow is Ukrainian, and English prompt leakage would reduce trust and editing ergonomics.
  Date/Author: 2026-03-11 / Product direction confirmed with user

- Decision: insertion anchors are explicit by type: `subsection` inserts before the first affected block, while `callout` and `visual` insert after the affected range.
  Rationale: this removes ambiguity in both UI copy and apply behavior, and it matches the intended “below the fragment” behavior for visual aids.
  Date/Author: 2026-03-11 / Codex implementation plan

- Decision: until the dedicated inline subsection card exists, subsection recommendations must fail safely during proposal preparation instead of degrading into block-replace diff generation.
  Rationale: a false replace diff would violate the new contract and make the taxonomy migration unsafe; a visible “not yet implemented” preparation result is safer and easier to validate.
  Date/Author: 2026-03-11 / Codex implementation

- Decision: user-facing review references use dynamic Ukrainian paragraph labels, while model/runtime anchoring continues to use stable block IDs.
  Rationale: paragraph numbers change after edits, but block IDs must remain the durable reference for anchor resolution and stale detection.
  Date/Author: 2026-03-11 / Product direction confirmed with user

- Decision: when recommendation payloads omit `anchorBlockId`, fallback insertion anchors must be derived from insertion mode, not always from the first block.
  Rationale: this prevents `callout`/`visual` inserts from landing mid-range and preserves predictable block ordering for neighboring recommendations.
  Date/Author: 2026-03-11 / Codex implementation

- Decision: `subsection` recommendations now prepare and execute as a first-class `subsection_prompt` flow with editable heading/lead draft and insert-before apply semantics.
  Rationale: this replaces the earlier temporary fail-safe behavior and aligns runtime execution with the agreed UX contract.
  Date/Author: 2026-03-11 / Codex implementation

- Decision: rewrite/simplify quality guardrails are enforced during review-action normalization (markdown cleanup + near-no-op detection), and no-op outputs surface as explicit warnings with manual regenerate.
  Rationale: quality checks must happen on normalized block-editor text to avoid false confidence from markdown-only deltas and to keep patch-first review trustworthy.
  Date/Author: 2026-03-11 / Codex implementation

- Decision: visual prompt proposals accept dual-mode provider output: preferred JSON (`prompt`, optional `caption`, optional `alt`) with plain-text fallback.
  Rationale: this allows richer media metadata when available while preserving backward compatibility with current provider behavior.
  Date/Author: 2026-03-11 / Codex implementation
- Decision: local `list` intent now uses the review/proposal pipeline rather than the generic patch executor, and manual local generations auto-select the workflow step that surfaces their cards in the right drawer.
  Rationale: list output needs review-backed normalization and visible diff editing, while dismissed manual cards must remain recoverable after the undo timeout expires.
  Date/Author: 2026-03-25 / Codex implementation

- Decision: undo/redo is implemented as a manuscript-only in-session mutation history, while `Порівняти` persists compact before/after snapshots for accepted editorial changes.
  Rationale: these features answer different user jobs. Undo must be fast and local to the current editing session; compare must remain available later as trust evidence without pretending to be full revision control.
  Date/Author: 2026-03-25 / Codex implementation

- Decision: generated editorial text may use only sparse `**bold**` markers as the single supported formatting transport across proposal parsing and diff editing.
  Rationale: this keeps the AI-formatting feature useful but narrow. The manuscript receives real inline bold after apply, while the proposal editor can still remain text-based without becoming a general markdown surface.
  Date/Author: 2026-03-26 / Codex implementation
- Decision: the new `Акценти` step is implemented as an inline suggestion layer rather than a proposal/diff flow, and it must receive current manuscript bold in the review prompt.
  Rationale: editors are approving or rejecting emphasis-only changes on top of unchanged prose. Showing those suggestions directly in the manuscript is faster and more legible than generating another green diff card, and prompt-visible existing bold prevents duplicate recommendations.
  Date/Author: 2026-03-26 / Codex implementation
- Decision: visual prompt editing now has two synchronized surfaces: the inline manuscript card for quick edits and a full-screen workspace for focused review of prompt plus generated result.
  Rationale: editors asked for a larger dedicated place to inspect “what got generated” and to tune infographic prompts before or after generation, but duplicating proposal state would create drift between surfaces.
  Date/Author: 2026-03-26 / Codex implementation
- Decision: changing the visual prompt text clears the current generated asset until the image is regenerated.
  Rationale: a previously generated image should never be presented as if it still corresponds to an edited prompt.
  Date/Author: 2026-03-26 / Codex implementation
- Decision: the local floating composer is now viewport-bounded and user-draggable, with position persisted only for the current browser session.
  Rationale: touch/tablet editing needs a recoverable panel that never clips off-screen or blocks the same manuscript region forever, but persisting cross-session panel placement would create stale positions across different devices and orientations.
  Date/Author: 2026-03-26 / Codex implementation
- Decision: explicit local-tab selection now outranks keyword inference, and feature-keyword detection inside `Правка` is rendered as a suggestion rather than a forced mode switch.
  Rationale: mode tabs are explicit user intent. A tab click must be reversible and stable, while keyword inference should help discovery without making the interface argue with the editor.
  Date/Author: 2026-03-26 / Codex implementation

## Outcomes & Retrospective

The first implementation milestone is now complete. The runtime contract no longer exposes `visualize` or `illustration` as top-level review types, the approved callout taxonomy is reflected in shared types and defaults, review prompts now describe the seven-type model, and normalization explicitly coerces legacy provider output into the current contract. The editor also now defaults newly inserted callout blocks to the approved taxonomy, and subsection preparation no longer risks generating an invalid replace diff.

Validation is complete for this phase. `npm run typecheck -w @orest/web`, `npm run build -w @orest/web`, `npm run test -w @orest/web`, and `npm run qa:inline-review -w @orest/web` pass in this workspace.

The review execution path is now materially safer than before this bugfix pass. Multi-block replace proposals no longer collapse into one repeated string during inline editing, the manuscript no longer creates fake empty placeholder blocks while AI is preparing a recommendation, and `callout`/`visual` execution now happens from one manuscript-side pendant card below the highlighted anchor range. `Subsection` execution is now also live: recommendation preparation yields an editable heading/lead draft, and apply inserts it before the first affected block. Replace-type proposals now enforce recommendation-specific block-count constraints so anchor stability is preserved (`rewrite/simplify/expand` exact count, `list` capped by selection size). Prompt contracts are now centralized and explicit about plain-text editor-compatible output, with per-kind callout guardrails. Browser QA for inline execution is now codified as a repeatable command rather than an ad-hoc manual check.

The 2026-03-25 follow-up pass tightened the manual editing surface rather than the model contract. Toolbar formatting now preserves the selected inline range instead of jumping to block start, list toggles can return cleanly to paragraphs, focused spellcheck-marked blocks no longer get their DOM replaced on every wrapper-only render, and manually inserted callouts now expose a kind selector directly in the manuscript. Local `list` intent also now runs through the review-backed proposal flow, which keeps the green diff editor visibly bullet-shaped and preserves regenerate/apply semantics. Finally, manual local cards now switch the drawer to a step that actually shows them, so dismissed cards remain recoverable through `Показати завершені` and `Підготувати знову`.

The second 2026-03-25 follow-up pass closed the local-composer QA loop. The manuscript toolbar no longer exposes a broken inline link action, manual callouts now use one compact inline kind select without the duplicate chip label, local `Правопис` and `Переписати` sends show an explicit in-button spinner, repeated spellcheck runs keep earlier untouched underlines alive by merging results per block, and local patch responses now open the inline diff lane immediately. On the fallback path, list rewrites no longer degrade into identical list clones: the server collapses standalone list blocks into a visible paragraph draft so the editor still receives a reviewable result.

The Epic 5 follow-up pass added the first explicit reversibility layer on top of the block editor. Manuscript mutations now register session-scoped undo/redo snapshots with top-bar controls and keyboard shortcuts, so editors can back out of manual edits, direct spellcheck applies, accepted AI replacements, and inserted blocks without refreshing the document. Separately, accepted AI text changes and direct spellcheck corrections now persist compact `Було` / `Стало` compare snapshots in draft state and expose them through a focused compare dialog. This gives the editor a lightweight way to inspect meaning-preserving changes later without claiming full document version history.

The latest stability pass closed two sharp edges from manual QA. Empty trailing bullets now exit the list safely by removing only the empty item and inserting a new empty paragraph after the list, rather than replacing the whole list block. On the provider side, raw undici-style `fetch failed` exceptions are now normalized into a user-facing “provider unavailable or network not responding” fallback message, while raw diagnostics still keep the underlying error for debugging.

The Epic 6 pass added a narrow formatting layer for AI-generated editorial text without reopening markdown as an editing mode. Replace proposals, local patch loose-text normalization, callout drafts, subsection leads, and the inline diff editor now preserve sparse `**...**` emphasis markers end-to-end. Unsupported markdown is still stripped. In practice, this means the proposal/edit transport remains text-based, but once the editor applies a change, the manuscript renders true inline bold on the emphasized phrase.

The Epic 7 pass turned visual prompt editing into a two-surface workflow instead of a cramped inline-only card. Visual recommendations still prepare and apply through the manuscript execution lane, but they now also expose a full-screen workspace with a large prompt editor, focused preview area, caption/intent/style controls, and the same generate/insert actions before or after image generation. The key behavioral rule is that prompt edits invalidate the current generated asset immediately, so the UI never claims that an old preview still matches a changed prompt. Runtime QA on 2026-03-26 validated the manual local `Візуал` path end-to-end: creating a visual card from selected blocks, opening the focused workspace, editing prompt text there, syncing it back to the inline card, generating an image in the focused workspace, and clearing the preview again after subsequent prompt edits.

The latest 2026-03-26 UX fix tightened the floating local composer itself. The panel no longer depends on one fragile bottom-center fixed transform: it measures against the active viewport, clamps itself inside visible bounds on resize/orientation changes, keeps overflow inside the panel body instead of cutting off controls, and can now be dragged to a different screen position from its top strip. Session-scoped position persistence means the panel stays where the editor dropped it during the current editing session without leaking that placement across devices. Runtime QA validated the behavior at iPad-like viewports (`1032x1376` and `1024x600`): the panel stayed fully on-screen, clamped to the viewport edges when dragged aggressively, and restored its last in-session position after reload.

The follow-up local-composer UX fix made `Правка` a real explicit mode instead of a thin alias for “auto”. Feature keywords like `правопис` still get recognized, but in `Правка` they now highlight the matching top pill as a suggestion instead of inserting a separate inline prompt row or hijacking the active tab. Runtime QA confirmed the expected sequence: typing `правопис` kept the composer in `Правка`, highlighted `Правопис` as the suggested pill, switching tabs stayed fully manual, and tapping `Правка` again remained stable even with the same text still present.

The latest 2026-03-26 emphasis pass added a second inline-inspection layer alongside spellcheck. `Акценти` now works as a document-wide emphasis review step that keeps prose unchanged, asks the model for one exact quoted phrase per paragraph at most, and renders those phrases directly in the manuscript as blue bold clickable overlays. Clicking an overlay opens a compact `Погодити / Відхилити` popover; accept applies real inline `bold` and writes compare history, while reject dismisses only that suggestion. The right drawer uses its own emphasis list rather than compact proposal cards, and prompt assembly now serializes existing manuscript bold with `**...**` so the model can avoid duplicating current emphasis. Runtime QA on 2026-03-26 validated the staged inline flow against `http://127.0.0.1:3005`: highlight rendering, popover open, accept, reject, and right-drawer item listing/focus all worked.

## Context and Orientation

The current application is a Next.js web app under `apps/web`. The central editor route is `apps/web/app/editor/page.tsx`, which holds document state, review items, active proposal state, and the current apply flows for callouts and images. The manuscript surface lives in `apps/web/components/editor/BlockEditorSurface.tsx`. It renders numbered rows by block ID and already supports first-class `callout` and `image` blocks.

Whole-text review contract types live in `apps/web/lib/editor/review-contract.ts`. This file currently defines recommendation types, callout kinds, visual intents, and proposal shapes. Whole-text recommendation generation lives in `apps/web/lib/server/review-service.ts`. Recommendation execution lives in `apps/web/lib/server/review-action-service.ts`, which currently branches into text diff, callout prompt, or image prompt flows. Replace operations and normalization logic live in `apps/web/lib/editor/patch-contract.ts`. Stable anchor resolution and stale detection live in `apps/web/lib/editor/manuscript-structure.ts`.

For this plan, the following terms are used consistently:

- Anchor range: the contiguous block range targeted by one review recommendation.
- Execution card: the single floating card rendered below the full anchor range when a recommendation is focused.
- Replace-type suggestion: `rewrite`, `simplify`, `expand`, or `list`. These replace existing selected blocks and stay full-paragraph only.
- Insert-type suggestion: `subsection`, `callout`, or `visual`. These add a new block before or after the anchor range without rewriting the anchor blocks directly.
- Visual intent: a subtype inside `visual`, for example `diagram`, `comparison`, `process`, `timeline`, `scene`, or `concept`.
- Callout block: the first-class `callout` block already present in `apps/web/lib/editor/document-model.ts`.

`docs/sample4.html` is the visual reference for the anchored border and floating patch card behavior. The goal is not to copy the sample literally, but to preserve its manuscript-first execution model.

## Plan of Work

The work begins by tightening the contract, not the UI. `apps/web/lib/editor/review-contract.ts`, `apps/web/lib/server/review-service.ts`, and `apps/web/lib/server/review-action-service.ts` need to agree on one taxonomy, one set of callout kinds, one visual family, and one set of apply semantics before any editor rendering changes are safe.

Once the contract is narrow enough, the editor page state needs one clear concept of an active review execution lane: which recommendation is focused, which block IDs form its anchor range, where the execution card should render, and which type-specific payload is currently loaded. The right rail remains the inbox and focus mechanism. The manuscript becomes the execution surface.

After that, the inline execution UI can be rebuilt around one card rendered once, below the last block in the anchor range. Replace-type suggestions share one text execution card with type-specific copy and constraints. `subsection` gets its own insertion card. `callout` gets an editable kind selector and explicit generate/regenerate controls. `visual` gets an editable Ukrainian prompt, image generation controls, image preview state, and explicit “insert below” behavior.

In parallel, prompt work must become first-class implementation work rather than a generic settings string. Each review and execution path needs a dedicated Ukrainian prompt factory with an explicit output contract. This plan treats prompt authoring as a separate milestone because the product behavior depends on it as much as on the React code.

The final phase adds regression coverage and runtime QA for the interaction model: range highlight continuity, single-card rendering, stale suggestion invalidation, block-count safety, insertion anchors, and Ukrainian output guarantees.

## Prompt Workstreams

The prompt work is part of the implementation, not a postscript. The repo should end with dedicated prompt factory tasks for each of the following.

### Recommendation Generation Prompt

Task: author the Ukrainian whole-text review prompt that returns anchored recommendations in structured JSON using the seven-type taxonomy.

Draft prompt shape:

    Ти робиш редакторський огляд українського науково-популярного рукопису.
    Працюй як книжковий редактор, а не як автор.
    Пропонуй лише локальні зміни з високою цінністю.
    Одна рекомендація може охоплювати один або кілька суміжних блоків.
    Дозволені типи recommendationType: rewrite, simplify, expand, list, subsection, callout, visual.
    Для callout обов'язково вкажи calloutKind: mechanism, analogy, everyday_application, myths_vs_truth, top_list.
    Для visual обов'язково вкажи visualIntent: diagram, comparison, process, timeline, scene, concept.
    Для replace-типів не пропонуй часткові правки всередині абзацу; система працює тільки цілими блоками.
    Не додавай зовнішніх фактів.
    Поверни тільки JSON.

### `rewrite` Prompt

Task: author the Ukrainian replace prompt for a local editorial rewrite that preserves meaning and preserves the selected block count exactly.

Draft prompt shape:

    Ти готуєш локальну редакторську заміну для вибраних блоків українського рукопису.
    Тип правки: rewrite.
    Перепиши текст ясніше і сильніше стилістично, але не змінюй фактичний зміст.
    Працюй тільки з вибраними блоками.
    Поверни повну заміну для кожного блоку.
    Збережи кількість блоків: {{blockCount}}.
    Не додавай нових фактів і не переходь на рівень речень усередині абзацу.
    Поверни тільки структуру відповіді, яку очікує система.

### `simplify` Prompt

Task: author the Ukrainian replace prompt for simplification aimed at a broad reader while preserving author intent.

Draft prompt shape:

    Ти спрощуєш вибрані блоки українського науково-популярного тексту.
    Тип правки: simplify.
    Зроби текст простішим, зрозумілішим і легшим для читання.
    Пояснюй складні формулювання простими словами, але не спрощуй зміст до неточності.
    Працюй тільки з вибраними блоками.
    Збережи кількість блоків: {{blockCount}}.
    Не додавай нових фактів.
    Поверни тільки повну заміну блоків.

### `expand` Prompt

Task: author the Ukrainian replace prompt for expansion-by-replacement. This must add clarity without becoming an insertion workflow.

Draft prompt shape:

    Ти розширюєш вибрані блоки українського рукопису, але робиш це через повну заміну тих самих блоків.
    Тип правки: expand.
    Додай пояснювальні зв'язки, розшифруй стислий зміст і зроби фрагмент самодостатнішим.
    Не додавай нових фактів поза тим, що вже випливає з фрагмента.
    Працюй тільки з вибраними блоками.
    Збережи кількість блоків: {{blockCount}}.
    Поверни тільки повну заміну блоків.

### `list` Prompt

Task: author the Ukrainian replace prompt for converting dense prose into a structured list while respecting the block-count ceiling.

Draft prompt shape:

    Ти перетворюєш вибраний фрагмент на структурований список.
    Тип правки: list.
    Якщо список справді покращує читабельність, поверни один list block або іншу заміну, яка не перевищує {{blockCount}} блоків.
    Не залишай суцільний абзац, якщо матеріал природно читається списком.
    Не додавай нових фактів.
    Поверни тільки структуровану заміну для системи.

### `subsection` Prompt

Task: author the Ukrainian insertion prompt for subsection proposals.

Draft prompt shape:

    Ти готуєш вставку підзаголовка перед вибраним фрагментом українського рукопису.
    Тип правки: subsection.
    Запропонуй короткий, точний підзаголовок.
    За потреби додай один короткий lead-абзац після підзаголовка.
    Не переписуй сам вибраний фрагмент.
    Не додавай нових фактів.
    Поверни тільки heading і, якщо потрібно, lead.

### `callout` Prompt Family

Task: author one Ukrainian base prompt and one kind-specific clause for each allowed callout kind.

Base prompt:

    Ти готуєш чернетку врізки для українського науково-популярного рукопису.
    Працюй тільки з наведеним фрагментом і редакторською рекомендацією.
    Не додавай нових фактів поза текстом.
    Поверни короткий заголовок, текст врізки і коротке пояснення, навіщо вона тут.
    Мова відповіді: тільки українська.

`mechanism` clause:

    Тип врізки: mechanism.
    Поясни механізм дії простим причинно-наслідковим ланцюгом.
    Не переходь у підручникову лекцію.

`analogy` clause:

    Тип врізки: analogy.
    Побудуй аналогію, яка допомагає зрозуміти ідею.
    Явно подай її як аналогію, а не як буквальний факт.
    Не вводь нові наукові твердження.

`everyday_application` clause:

    Тип врізки: everyday_application.
    Покажи, як описане явище проявляється в повсякденному житті.
    Спирайся тільки на зміст фрагмента.

`myths_vs_truth` clause:

    Тип врізки: myths_vs_truth.
    Подай матеріал як короткі пари "Міф" / "Правда".
    Кожна пара має прямо випливати з фрагмента.
    Не вигадуй популярні міфи, яких немає в тексті.

`top_list` clause:

    Тип врізки: top_list.
    Збери 3-5 коротких пунктів, якщо фрагмент реально підтримує дискретний перелік.
    Якщо ні, поверни врізку без штучного рейтингу.

### `visual` Prompt

Task: author the Ukrainian prompt factory that prepares an editable image-generation prompt for the `visual` family.

Draft prompt shape:

    Ти готуєш український prompt для генерації чернеткової ілюстрації або схеми.
    Мета: допомогти книжковому редактору і ілюстратору швидко зрозуміти, що саме треба показати.
    Працюй тільки з фрагментом і редакторською рекомендацією.
    Вкажи:
    1. що саме зобразити;
    2. яку освітню функцію має виконати візуал;
    3. які елементи обов'язкові;
    4. яких візуальних кліше треба уникати;
    5. який тип visualIntent обрано.
    Мова фінального prompt: тільки українська, без англіцизмів.
    Поверни тільки готовий prompt.

### Downstream Image Prompt Contract

Task: enforce that the final prompt shown to the user and sent to image generation remains Ukrainian.

Acceptance shape:

    - only Ukrainian text
    - no English style keywords
    - no prompt-engineering boilerplate for the user
    - concise but concrete educational brief
    - explicit anti-cliche guidance

## Concrete Steps

All commands below run from `/mnt/c/Projects/oboz-ai/orest-edit` unless another working directory is stated.

1. Update the type and prompt contracts.

       sed -n '1,260p' apps/web/lib/editor/review-contract.ts
       sed -n '1,260p' apps/web/lib/server/review-service.ts
       sed -n '1,360p' apps/web/lib/server/review-action-service.ts

2. Rebuild the editor execution state around one active inline review card.

       sed -n '1,760p' apps/web/app/editor/page.tsx
       sed -n '560,760p' apps/web/components/editor/BlockEditorSurface.tsx

3. Tighten replace-type output normalization and insertion helpers.

       sed -n '1,460p' apps/web/lib/editor/patch-contract.ts
       sed -n '250,340p' apps/web/lib/editor/document-model.ts
       sed -n '1,160p' apps/web/lib/editor/manuscript-structure.ts

4. Implement and review the new inline card components and styles against `docs/sample4.html`.

       sed -n '1,260p' docs/sample4.html
       sed -n '4970,5565p' apps/web/app/globals.css

5. Add or update tests for review normalization, review action generation, and manuscript apply semantics.

       ls apps/web/test
       sed -n '1,220p' apps/web/test/review-service.test.ts

6. Validate the final integrated behavior.

       npm run typecheck -w @orest/web
       npm test -w @orest/web
       npm run build -w @orest/web

7. Run authenticated runtime QA once implementation exists.

       APP_PASSWORD=test-secret npm run dev -w @orest/web

## Validation and Acceptance

The implementation is accepted only when the following behaviors are all true.

1. A whole-text recommendation may anchor one or more contiguous blocks, and focusing it highlights the full anchor range in the manuscript with one continuous left-side border.

2. The manuscript shows one floating execution card below the full affected range, not one card per block.

3. Replace-type suggestions (`rewrite`, `simplify`, `expand`, `list`) never operate at phrase level. They replace full blocks only.

4. For replace-type suggestions, the editor surface communicates the current anchor range as the affected text, and replace-focused states use red highlighting for the affected manuscript text rather than creating several detached placeholders.

5. Applying a replace-type suggestion does not emit more blocks than the selected anchor range allows. The working target is exact selected block count for `rewrite`, `simplify`, and `expand`, with `list` allowed to normalize to one list block.

6. `subsection` inserts a heading before the first affected block and never silently rewrites the anchor range.

7. `callout` execution cards let the editor choose among exactly five callout kinds: `mechanism`, `analogy`, `everyday_application`, `myths_vs_truth`, and `top_list`.

8. `callout` generation is explicit. The editor can generate or regenerate the chosen kind before insertion, and insertion creates a first-class `callout` block.

9. `visual` execution cards expose an editable Ukrainian image prompt, allow generation and regeneration, and can insert a first-class `image` block below the affected range.

10. `illustration` no longer appears as a top-level suggestion type in review results; it is represented through `visualIntent`.

11. All prompt templates for recommendation generation, replace-type execution, subsection insertion, callout generation, and visual prompt generation are Ukrainian. The generated prompt shown for image generation is also Ukrainian.

12. Analogy and myths/truth callout flows are explicitly anti-hallucination constrained: no fabricated facts, no invented myths, and no unlabeled analogies presented as literal claims.

13. When an accepted change touches blocks used by another pending suggestion, that other suggestion is marked stale instead of silently applying against invalid anchors.

## Idempotence and Recovery

This phase changes contracts, prompts, UI state, and styles. To keep implementation safe:

- keep block IDs authoritative and never rebuild the whole document solely from plain text for review apply flows;
- preserve current behavior behind type-safe adapters until the new inline execution card flow is complete;
- if a provider returns replace output that violates the block-count rule, normalize it deterministically or surface a non-destructive error instead of applying it;
- prefer additive component changes over editing existing files in place without a stable fallback path;
- rerunning the test and build commands above should be safe at any point after each milestone.

If the inline execution UI becomes unstable during implementation, the safe rollback path is to disable the new inline lane behind a page-state flag while keeping the narrowed review contract and Ukrainian prompt factories intact.

## Artifacts and Notes

Type-to-behavior mapping to preserve during implementation:

- `rewrite`: replace selected blocks; preserve block count exactly.
- `simplify`: replace selected blocks; preserve block count exactly.
- `expand`: replace selected blocks; preserve block count exactly.
- `list`: replace selected blocks with structured list output; never exceed selected block count.
- `subsection`: insert heading before first affected block; optional short lead.
- `callout`: generate/regenerate a first-class `callout` block and insert after affected range.
- `visual`: generate/regenerate an editable Ukrainian image prompt, then insert an `image` block after affected range.

Working anti-hallucination rules:

- `rewrite`, `simplify`, `expand`, `list`: no new facts.
- `subsection`: name and frame existing content; no new claims.
- `mechanism`: explain only the mechanism already present in the fragment.
- `analogy`: must read as analogy, not as factual extension.
- `everyday_application`: tie to everyday life only when the fragment supports it.
- `myths_vs_truth`: every pair must be traceable to the fragment.
- `top_list`: only produce a ranked or numbered set when the fragment supports discrete items.
- `visual`: the prompt may clarify what to show, but must not invent scientific content missing from the fragment.

## Interfaces and Dependencies

The implementation should end with the following stable interface expectations.

- `apps/web/lib/editor/review-contract.ts`
  - `EditorialReviewRecommendationType` narrowed to `rewrite | simplify | expand | list | subsection | callout | visual`
  - `EditorialCalloutKind` narrowed to `mechanism | analogy | everyday_application | myths_vs_truth | top_list`
  - `EditorialVisualIntent` remains a subordinate subtype of `visual`
  - proposal shapes support one active inline execution card per recommendation

- `apps/web/lib/server/review-service.ts`
  - one Ukrainian recommendation-generation prompt factory
  - one structured-output schema that enforces the seven-type taxonomy

- `apps/web/lib/server/review-action-service.ts`
  - dedicated prompt factories for `rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`, and `visual`
  - callout prompt clauses keyed by the five approved callout kinds
  - visual prompt generation that returns a Ukrainian prompt only

- `apps/web/app/editor/page.tsx`
  - state for one active review execution lane
  - explicit stale handling for overlapping recommendations
  - explicit insert-before / insert-after logic by recommendation type

- `apps/web/components/editor/BlockEditorSurface.tsx`
  - anchored range highlight metadata
  - one floating execution card mount below the active range
  - no duplicated loading or proposal rows across the same recommendation range

- `apps/web/lib/editor/patch-contract.ts`
  - replace-type normalization that respects the block-count ceiling and does not silently expand beyond the anchor range

Note updated 2026-03-11: this ExecPlan was rewritten after product review clarified that multi-block recommendations are valid, replace-type suggestions must stay full-paragraph only, `expand` is a replace flow, `subsection` means “insert subheading before the fragment”, `visual` is the top-level media family, the approved callout taxonomy changed, and all prompts in this workflow must be Ukrainian.
