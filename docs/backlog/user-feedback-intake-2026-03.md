# User Feedback Intake 2026-03

Status: in progress  
Owner: Codex intake pass  
Purpose: convert raw user feedback into grounded issues, split into ready fixes, feature discussions, and items that still need clarification.

## Grounding notes

- This document is based on the current web app under `apps/web`, not only on the raw feedback.
- Some requested behaviors already exist partially, but sometimes in a narrower or less discoverable form than the user expects.
- The current editor already works on the live in-memory document for review, local patch, spellcheck, and proposal generation requests. The main remaining risk is stale cards from older runs, not a systematic "always uses original text" bug.

## Triage snapshot

- Ready to implement: 9 issues
- Feature discussion needed: 4 issues
- Needs clarification: 1 issue

## Execution epics

### Epic 1: Editor interaction stability

- Covers:
  `UF-010`, `UF-011`, `UF-012`
- Why these belong together:
  All three are manuscript-surface interaction failures around focus, selection, caret stability, and scroll behavior. They should be fixed and validated together in runtime.
- Status:
  Implementation-ready.
- Tasks:
  Reproduce the non-sticky toolbar behavior in the real manuscript scroll container.
  Fix sticky positioning and verify interaction with the top app bar, manuscript padding, and z-index.
  Reproduce caret jump while editing spellcheck-highlighted text.
  Reduce or eliminate unnecessary `contentEditable` DOM rewrites when spellcheck markup is active.
  Improve caret/selection preservation when DOM rewrites cannot be avoided.
  Preserve selected text range when clicking toolbar formatting buttons, then restore it before `bold`, `italic`, or `createLink`.
  Add regression coverage for toolbar formatting on selection and editing highlighted spellcheck text.
  Run runtime QA on desktop and tablet-sized viewport.

### Epic 2: List workflow overhaul

- Covers:
  `UF-001`, `UF-002`, `UF-009`
- Why these belong together:
  The user sees one “list workflow”, but today generation, preview, and manual editing are split across separate implementations. Partial fixes would still leave the workflow feeling broken.
- Status:
  Implementation-ready.
- Tasks:
  Add a dedicated local AI list-generation path instead of routing `list` through generic patch.
  Reuse the structured list generation logic from `review-action-service`.
  Ensure local AI list output becomes a real `bullet_list` block.
  Update `BlockDiffOverlay` to render list proposals as visible bullets/numbers with editable items.
  Make list toolbar actions reversible and predictable, including toggle-off behavior.
  Improve list-to-paragraph conversion and reduce lossy round-trips in `toListBlock(...)`.
  Revisit `Backspace` behavior at the start of list items.
  Add coverage for local list routing, list preview rendering, and list enter/exit behavior.

### Epic 3: Review recovery and trust

- Covers:
  `UF-003`, `UF-004`
- Why these belong together:
  Both issues are about operator trust in AI recommendations: can they recover from mistakes, and can they trust recommendations to be based on the current document.
- Status:
  Implementation-ready.
- Tasks:
  Add a durable reopen/rerun path for dismissed cards beyond the 5-second undo toast.
  Decide whether reopen restores the last prepared proposal or always triggers fresh generation.
  Audit all AI entry points to confirm they use the current document state.
  Add regression tests proving modified text is used after manual edits.
  Improve stale-card messaging so outdated recommendations read as intentionally stale, not silently wrong.
  Cover replace, callout, and visual card recovery flows in tests.

### Epic 4: Manual callout editing parity

- Covers:
  `UF-013`
- Why this stays separate:
  It is related to trust and recovery, but implementation is isolated to manuscript callout editing and should not block broader review-system work.
- Status:
  Implementation-ready.
- Tasks:
  Add a `kind` selector to manuscript callout blocks.
  Decide whether top-toolbar insert should use last-selected kind instead of always `mechanism`.
  Keep title defaults aligned with selected kind without overwriting user-edited titles unexpectedly.
  Add regression coverage for manual insert -> kind switch -> continued editing.

### Epic 5: Change history and reversibility model

- Covers:
  `UF-005`, `UF-014`
- Why these belong together:
  Accepted-change comparison and undo both depend on the same storage and action model: what mutations/snapshots are preserved, for how long, and where they surface in the UI.
- Status:
  Decision-first, then implementation.
- Decisions needed:
  Should compare be per accepted card, per changed block, or a document-level history feature?
  Should undo cover only manuscript mutations, or also review-card state changes?
  Is undo one-step only or full undo/redo history?
  What transaction boundaries apply to typing, AI apply, spellcheck apply, formatting, and block insert/delete?
  Does any of this persist across refresh?
- Tasks after decision:
  Introduce a real mutation history stack for document-changing actions.
  Persist before/after snapshots for accepted AI diffs where needed.
  Expose compare UI for accepted edits.
  Add undo affordance and optional keyboard shortcut.
  Add tests for undo/compare on AI apply, spellcheck apply, formatting, and block insertion.

### Epic 6: AI-generated formatting policy

- Covers:
  `UF-006`
- Why this stays separate:
  This is not just UI work. It changes prompt/schema contracts, normalization, and editorial policy.
- Status:
  Decision-first, then implementation.
- Decisions needed:
  Where is AI-created bold allowed: paragraph rewrites, lists, callouts, subsection leads?
  Should emphasis come from structured provider output or safe post-processing?
  What guardrails prevent over-highlighting?
- Tasks after decision:
  Extend schemas/prompts to allow inline marks where approved.
  Preserve generated bold through normalization and apply.
  Verify editing remains stable after AI-created emphasis.
  Add regression tests for inline bold output.

### Epic 7: Visual prompt workflow

- Covers:
  `UF-007`, `UF-008`
- Why these belong together:
  The “full-screen prompt editor” request and the vague “window to inspect generated output” request are likely the same product gap viewed from different angles.
- Status:
  Clarify product shape first, then implement.
- Decisions needed:
  Is the focused view mainly for prompt text, generated image, or both?
  Should it be a modal, drawer expansion, or dedicated pane?
  Should prompt drafts persist beyond the active proposal lifecycle?
  Does editing the prompt invalidate an already generated image?
- Tasks after decision:
  Add focused visual prompt editor/review UI.
  Persist visual prompt state beyond only `activeProposal`.
  Support reopening and editing prompt drafts across the card lifecycle.
  Add tests for prepare -> edit -> regenerate visual flow.

### Recommended sequence

- Phase 1:
  `Epic 1`
- Phase 2:
  `Epic 2`
- Phase 3:
  `Epic 3`, `Epic 4`
- Phase 4:
  decide `Epic 5`, `Epic 6`, `Epic 7`
- Phase 5:
  implement approved scope from `Epic 5`, `Epic 6`, `Epic 7`

## Unexpected findings

- The toolbar already has sticky CSS; the reported disappearing-toolbar problem looks like a runtime/layout bug, not a missing feature.
- The product already has a very narrow undo only for dismissed review cards, but no general editor undo.
- `PersistedAppliedDiffMarker` / `appliedDiffs` still exists in persisted draft state, but it is not wired to any working undo flow.
- The app already sends the current document to review/patch/proposal endpoints. The real weakness is stale-card handling and user perception, not a simple “everything reads the original manuscript” implementation bug.
- Manual callout insertion and AI callout generation use two separate UX paths. Only the AI review path supports changing callout kind after creation.

## Intake buckets

### Ready to implement

#### UF-001: AI list action is underpowered in the local editor flow

- Raw feedback:
  Важко користуватися функцією булет-поінтів, у неї немає ШІ логіки.
- Current codebase grounding:
  The editor has two different list paths:
  manual list formatting in the main toolbar, and an AI local action `Зробити списком`.
  The local AI route currently maps `list` to the generic patch endpoint via `apps/web/lib/editor/local-action-router.ts`, not to the stronger dedicated `recommendationType === "list"` review-action flow in `apps/web/lib/server/review-action-service.ts`.
- Why this is likely real:
  The local list action does not have a dedicated structured list-generation pipeline, so the user can reasonably experience it as "just a text rewrite with list-ish wording".
- Suggested classification:
  Ready fix.
- Task breakdown:
  Add a dedicated local-action execution path for AI list generation instead of routing `list` through the generic patch flow.
  Reuse or extract the existing structured list-generation logic from `review-action-service`.
  Add regression tests for local `list` intent so it returns a real `bullet_list` block.
  Review the UI labels so users can distinguish manual list formatting from AI list generation.

#### UF-002: Generated lists do not render as lists in the green proposal surface

- Raw feedback:
  Згенеровані буллет-поінти в "зеленому порівнянні" не показуються як буллет-поінти.
- Evidence from screenshot:
  The accepted/proposed green area shows plain lines, not rendered bullets.
- Current codebase grounding:
  `apps/web/components/editor/BlockDiffOverlay.tsx` renders proposal blocks as plain textareas using `getBlockText(block)`.
  For `bullet_list` and `ordered_list`, the block is flattened to text, then re-split only on apply.
- Why this is likely real:
  The proposal editor loses list presentation during preview, even when the underlying proposal block is a list block.
- Suggested classification:
  Ready fix.
- Task breakdown:
  Render list proposals with actual list UI in the diff overlay instead of flattening everything into plain textareas.
  Preserve editability for list items without dropping bullet/number visuals.
  Add a UI regression test for replace proposals containing `bullet_list`.

#### UF-003: Rejected cards are not safely recoverable beyond the short undo window

- Raw feedback:
  Якщо помилково відхилено, чи можна повторно запустити картку?
- Current codebase grounding:
  There is a 5-second undo toast (`Повернути`) after dismiss.
  Dismissed cards can be shown again via `Показати завершені`.
  But replace-type cards do not expose a clear rerun/reopen action from the dismissed state, and visual proposals lose their active prompt/proposal state once dismissed/applied.
- Why this is likely real:
  Recovery exists only partially and is not durable enough for real editorial review.
- Suggested classification:
  Ready fix.
- Task breakdown:
  Add an explicit `Reopen` or `Run again` action for dismissed cards.
  Decide whether reopening restores the last prepared proposal or triggers a fresh generation.
  Keep this available beyond the 5-second undo window.
  Add tests for dismissed -> reopened flows for replace and visual cards.

#### UF-004: Current-document scanning needs explicit hardening and tests

- Raw feedback:
  Важливо впевнетися, що УСІ функції сканують не первинний текст, а вже модифікований.
- Current codebase grounding:
  Whole-text review sends the current `document` and current `revision`.
  Local patch sends the current `document`.
  Proposal generation sends a compact document built from current blocks.
  `reconcileReviewItemsWithRevision` marks cards stale when anchor fingerprints no longer match the current document.
- Why this is only partially an issue:
  The architecture already targets the live document, but the product still needs stronger guarantees and tests because stale cards can look like "AI re-read the old text".
- Suggested classification:
  Ready fix.
- Task breakdown:
  Audit every AI entry point and document the current-document invariant.
  Add regression tests proving that local patch, step review, and proposal generation use modified text after an edit.
  Improve stale-card messaging so users understand when a rerun is required because the document changed.

### Feature discussion needed

#### UF-005: Compare an accepted edit with the previous text later

- Raw feedback:
  Час від часу хочуть порівняти правку з попереднім текстом, щоб зрозуміти, чи правка не виявилася хибною.
- Current codebase grounding:
  Before apply, the user can see the old anchored text in the manuscript and the proposed replacement below it.
  After apply, the accepted proposal is cleared and the old text is no longer kept in a user-facing compare history.
  Request history keeps run metadata, not accepted before/after content.
- Product shape:
  This is a real missing capability, but it needs a product decision on scope.
- Discussion points:
  Should compare be available only for the latest accepted change, per card, or as full version history?
  Should it live inline in the manuscript, in card history, or in a global change log?
  How long should pre-change content be retained in local storage?
- Task breakdown after decision:
  Persist accepted before/after snapshots.
  Add a compare entry point from accepted cards or changed blocks.
  Define retention and cleanup rules.

#### UF-006: AI-generated content should be able to add bold emphasis

- Raw feedback:
  Згенерований ШІ контент має також використовувати виділення жирним шрифтом для акцентів.
- Current codebase grounding:
  The editor data model supports inline bold.
  But the main review replace flow currently asks providers for plain text replacements and rebuilds blocks with `createInlineText(...)`.
  Callout/subsection drafts are also plain text fields.
  Some prompts explicitly forbid markdown bold.
- Why this is a feature, not a small toggle:
  Supporting AI-created emphasis means changing prompt contracts, normalization, storage, editing UI expectations, and safety rules for when emphasis is allowed.
- Discussion points:
  Should bold be allowed only in callouts and lists, or also in plain paragraph rewrites?
  Should the model return structured inline marks, or should we post-process emphasis heuristically?
  What is the editorial policy for overuse of emphasis?
- Task breakdown after decision:
  Extend relevant provider schemas to allow inline marks.
  Update normalization so generated bold survives apply.
  Add tests for bold preservation and editing after apply.

#### UF-007: Full-screen review/edit mode for visual prompts

- Raw feedback:
  Інколи хочеться переглянути ТЗ (промпт) на створення інфографіки, розгорнути його на увесь екран та відредагувати, до чи після генерації.
- Current codebase grounding:
  Before generation, the visual request can be typed in the floating composer.
  After preparation, the generated image prompt is editable inline in `ReviewRecommendationDetail`.
  There is no full-screen editor.
  The prepared image prompt is not persisted on the review item itself, so after apply/dismiss it is not reliably reviewable later.
- Why this is a real gap:
  The user already can edit prompts, but not in a focused review mode and not durably across the card lifecycle.
- Discussion points:
  Should this be a modal, a drawer expansion, or a dedicated prompt editor view?
  Should prompt history be stored per visual card?
  Should post-generation prompt edits invalidate the generated asset automatically?
- Task breakdown after decision:
  Add focused prompt editor UI.
  Persist prompt draft on the item, not only on the active proposal object.
  Define pre-generation and post-generation edit behavior.

### Needs clarification

#### UF-008: "Need a window to look at what got generated"

- Raw feedback:
  Потрібно вікно «глянути, що там нагенерувалося».
- Why this is unclear:
  It may refer to at least four different things:
  replace diff preview,
  callout/subsection generated draft,
  visual prompt text,
  generated image preview itself.
- Current codebase grounding:
  The app already shows inline generation surfaces for replace, callout, subsection, visual prompt, and generated image preview.
  What is missing is a focused, dedicated preview mode.
- Suggested classification:
  Needs clarification before implementation.
- Clarification prompts for later discussion:
  Which generated artifact needs the separate window most often?
  Is the goal better readability, side-by-side compare, full-screen editing, or approval workflow?
  Should the window be reusable across text, prompt, and image outputs?

## Source batches

### Batch 1

- Source date inferred from screenshots: 2026-03-25.
- Included feedback items: 1-7 from the first user dump.
- Screenshots supplied in chat:
  one showing a list recommendation where the green proposal preview loses bullet formatting,
  one showing a callout card workflow around `Міфи про детокс`.

### Batch 2

- Included feedback items: 8-10 from the second user dump.

#### UF-009: Structural list formatting is hard to remove or exit cleanly

- Raw feedback:
  Часто не можна прибрати булет поінти, або 1,2,3 в структурних списках.
- Current codebase grounding:
  The main toolbar can convert a selected block to `paragraph`, `heading`, `bullet_list`, or `ordered_list` in `apps/web/components/editor/BlockEditorSurface.tsx`.
  But list buttons are one-way transforms, not toggles.
  Inside a list, `Backspace` only exits the list when the current item is already empty; otherwise it does nothing special.
  `toListBlock(...)` also rewrites content by splitting on newlines and punctuation, which can make list round-trips lossy.
- Why this is likely real:
  The current list UX is technically possible to escape through the paragraph button or empty-item backspace, but it is not robust or intuitive. A user can reasonably experience this as "cannot remove bullets/numbering".
- Suggested classification:
  Ready fix.
- Task breakdown:
  Make list toolbar actions true toggles when the current block is already the same list type.
  Improve list-to-paragraph conversion so it is predictable and does not feel destructive.
  Revisit backspace behavior at the start of a list item so exiting a list matches editor expectations.
  Add regression tests for bullet-list -> paragraph and ordered-list -> paragraph flows.

#### UF-010: Formatting toolbar does not stay accessible while scrolling the manuscript

- Raw feedback:
  Вгорі не фіксується меню, тобто, якщо я хочу в середині тексту натиснути Болт, заголовок і т.д., то це не працює, бо меню «зникає» з початком тексту.
- Current codebase grounding:
  The block toolbar already has `position: sticky; top: 0; z-index: 10;` in `apps/web/app/globals.css`.
  The manuscript column itself scrolls inside `.step-review-manuscript { overflow-y: auto; }`.
- Why this is likely real:
  This is not a missing sticky rule. It is likely a runtime/layout issue with the current scroll container setup, browser behavior, or insufficient sticky offset/z-index in the real editor shell.
- Suggested classification:
  Ready fix.
- Task breakdown:
  Reproduce the toolbar behavior in runtime, especially on tablet/iPad Safari-like conditions if possible.
  Fix the manuscript toolbar so it remains visible during manuscript scroll.
  Verify that sticky positioning works together with the top app bar and manuscript padding.
  Add a runtime QA check for toolbar persistence during scroll.

#### UF-011: Editing inside spellcheck-highlighted text can jump the caret to the wrong place

- Raw feedback:
  при перевірці правопису - коли наводиш курсор на помилку і починаєш правити, курсор вилітає на зовсім інший розділ - на початок абзацу.
- Current codebase grounding:
  Spellcheck issues are rendered by wrapping text fragments in `.spellcheck-underline` spans inside `contentEditable`.
  On each HTML change, `EditableRichText` may rewrite `element.innerHTML = html` and then restore the caret by plain text offset.
  This logic lives in `apps/web/components/editor/BlockEditorSurface.tsx`.
- Why this is likely real:
  Rewriting DOM under `contentEditable`, especially with temporary underline wrappers, is a classic cause of caret jumps. The current restore path is offset-based and may not be stable enough while spellcheck markup is changing.
- Suggested classification:
  Ready fix.
- Task breakdown:
  Reproduce the caret-jump bug while editing highlighted text.
  Stabilize spellcheck underline rendering so normal typing does not rewrite the editable DOM on every change.
  If DOM rewriting remains necessary, improve caret preservation beyond the current text-offset approach.
  Add regression coverage for editing text with active spellcheck underlines.

#### UF-012: Applying inline formatting from the toolbar drops the text selection and moves caret to the start

- Raw feedback:
  если в абзаце выделить часть текста, и затем нажать на кнопку `<bold>` (или любое другое форматирование), то курсор возвращается в самое начало абзаца.
- Current codebase grounding:
  In `apps/web/components/editor/BlockEditorSurface.tsx`, `handleFormatCommand()` finds the active editable, calls `element.focus()`, and then runs `document.execCommand(...)`.
  There is no explicit save/restore of the current DOM selection range before the toolbar button steals focus.
- Why this is likely real:
  Clicking the toolbar button moves focus away from the contenteditable selection. Without restoring the original range, the browser applies formatting at a collapsed caret or resets selection unexpectedly, which matches the reported behavior.
- Suggested classification:
  Ready fix.
- Task breakdown:
  Preserve the active text selection when the user clicks an inline-format toolbar button.
  Restore the saved DOM range before executing `bold`, `italic`, or `link`.
  Verify that formatting applies to the selected fragment instead of collapsing to the paragraph start.
  Add regression coverage for selection-based inline formatting.

#### UF-013: Manually inserted callouts from the top toolbar are locked to default `mechanism` type

- Raw feedback:
  При вставке врезки вручную через верхнее меню - создаётся дефолтный тип "механизм", но его уже нельзя поменять.
- Current codebase grounding:
  The top manuscript toolbar inserts a callout block with hard-coded `kind: "mechanism"` in `apps/web/components/editor/BlockEditorSurface.tsx`.
  The regular `EditableCalloutBlock` editor shows the current kind label, title, and body, but exposes no control to change `block.kind` after insertion.
  Kind switching currently exists only in the AI review proposal detail flow, not for directly inserted manuscript callout blocks.
- Why this is likely real:
  The direct insertion path creates a real callout block, but the manuscript editor has no subsequent affordance to change its type. That makes the inserted default effectively permanent.
- Suggested classification:
  Ready fix.
- Task breakdown:
  Add a kind selector for existing callout blocks in the manuscript editor.
  Decide whether the top toolbar should insert the last-used callout kind instead of always `mechanism`.
  Keep title defaults aligned with the selected kind when appropriate, without overwriting user-edited titles unexpectedly.
  Add regression coverage for manual callout insertion and post-insert kind switching.

### Batch 3

- Included feedback items: final item 13 from the last user dump.

#### UF-014: Add a general “undo last action” capability

- Raw feedback:
  варто зробити кнопку скасування останньої дії, аби повернутися до попереднього кроку.
- Current codebase grounding:
  The app has no general undo/redo stack for editor actions.
  The only explicit undo is the 5-second dismiss undo for review cards.
  `apps/web/lib/editor/draft-state.ts` still defines `PersistedAppliedDiffMarker` / `appliedDiffs`, but there is no live feature using it.
- Why this is not a tiny bug fix:
  The scope of “last action” is product-defining:
  typing edits,
  toolbar formatting,
  block insertion/deletion,
  applying AI diffs,
  spellcheck suggestion accepts,
  manual callout/visual insertion,
  maybe even step-run side effects.
- Suggested classification:
  Feature discussion needed.
- Discussion points:
  Should undo cover only manuscript mutations, or also review-card state changes?
  Do we need only one-step undo, or real undo/redo history?
  Should typing be grouped into transactions, separate from AI/apply actions?
  Do we persist undo history across refresh or keep it in memory only?
- Task breakdown after decision:
  Define the action model and transaction boundaries.
  Introduce a real mutation history stack for document-changing actions.
  Add UI affordance and keyboard shortcuts if desired.
  Cover AI apply, spellcheck apply, block insertion/deletion, and formatting with undo tests.
