# Plan: Orest Edit v2 — "Три вкладки" editor on a parallel `/v2` route

## Why / Context

The current editor (`/editor`) grew into an 8-step workflow with a drawer of cards, a floating 4-tab composer and four different ways of showing AI changes. The product owner wants a v2 with roughly the same features but a much simpler interaction model, and chose the "Папір" prototype as the design to build. v2 must ship **next to** v1: the client will compare both, and only if the client prefers v2 will v1 be retired. So v1 stays exactly as it is, and v2 is a separate route in the same Next.js app that reuses the existing server APIs.

Hard constraints (from `AGENTS.md` and the owner):

- v1 (`/editor`, `/settings`, all `/api/*` behaviour, prompts, v1 browser drafts) must keep working unchanged. v2 changes to shared files are additive only.
- Patch-first, diff-first, a short reason on every change, edits local to the fragment.
- Fail loud: on any provider/API error, timeout, missing key or empty/invalid output, show the real error state. Never render synthetic AI output.
- UI language is Ukrainian (an English catalog is added in Milestone 6).
- No monospace fonts in the v2 UI.
- Nothing floats over the manuscript while idle; the composer exists only while text is selected.

Required outcomes: the three zones (`Огляд` read-only understanding, `Правки` one queue for every pass, `Запит` the editor's own instruction for the chapter or a selected fragment); every pass has a visible, labelled launcher with state; image generation is first-class; quiet mode walks the queue one suggestion at a time.

Preference: stay as close to the prototype's layout, typography, colours and interactions as production wiring allows.

Exclusions: deleting or refactoring v1; changing server prompts or API contracts; server-side persistence; multi-chapter projects; DOCX tracked-changes export.

### Prototype reference (do not edit these files)

- `docs/concepts/v2/d1.html` — the chosen design ("Папір", near-white palette). Styles: `docs/concepts/v2/ed.css` (base) + the `<style>` block in `d1.html` (overrides). Behaviour: `docs/concepts/v2/ed.js`. Sample data and shared pieces (marks, visual studio): `docs/concepts/v2/shared.js`, `docs/concepts/v2/shared.css`.
- Snapshot: uncommitted working-tree files as of 2026-10-09. Serve with `python -m http.server 4173 --bind 127.0.0.1` from `docs/concepts/v2/` and open `http://127.0.0.1:4173/d1.html` (opening via `file://` does not run scripts).
- Mock boundaries — these are prototype conveniences, **not** production contracts: all suggestions are fixed sample data; every diff is visible instantly; diagnostics is a structured list of five findings; the manuscript is not editable; image "generation" is a labelled placeholder; free-text requests always error.

## Current State

- Status: Complete (implementation complete, accepted and integrated on branch `v2`; NOT pushed, NOT deployed; owner's intent review pending)
- Plan revision: r1 (2026-10-09), closed 2026-10-10
- Canonical plan: `.plans/done/v2-paper-editor.md`. Plan owner: the orchestrator session.
- Current milestone: none — all six milestones accepted and committed on `v2`.
- Next action (owner): look at `/v2` next to `/editor`, decide on the open items in the Completion Summary, then push/deploy when ready.
- Open owner decisions: fixing the shared server issues listed in `docs/V1_RETIREMENT.md` (first of all `/api/edit/patch` failing on OpenAI); whether the darker tertiary text is acceptable; when to show the client.
- Blocker: None.
- Workspace: single working tree `C:\Projects\oboz-ai\orest-edit`, branch `v2` (from `master` at `dcb52ae`). Commits to `v2` are authorized by the owner (2026-10-10); pushing is not. The orchestrator commits each milestone when it is accepted; executors still do not touch git state. Worktree exception: executors run one at a time in this tree, so no per-milestone worktrees.
- Orchestrator may decide: implementation choices, simplifications within scope, reordering independent tasks. Needs the owner: changing hard constraints or required outcomes, weakening acceptance, pushes/deploys, anything touching v1 behaviour.

## Definition of Done

- [x] `/v2` offers the full editor in the "Папір" design: manual editing, the three tabs, every pass, quiet mode, selection composer, illustration studio, open/export.
- [x] Every AI feature in v2 calls the existing `/api/edit/*` endpoints for real; no sample data, no synthetic fallbacks; provider errors are shown as errors.
- [x] v1 is unchanged: `/editor` and `/settings` behave and look as before; v1 drafts are never written by v2; `npm run test -w @orest/web` still passes all pre-existing tests.
- [x] Switching the default editor is one setting (`NEXT_PUBLIC_OREST_DEFAULT_EDITOR`), documented, with v1 as the default; each version stays reachable by URL.
- [x] `npm run typecheck -w @orest/web`, `npm run test -w @orest/web` and `npm run build -w @orest/web` pass; new v2 logic has unit tests registered in the `test` script.
- [x] Runtime QA with a real provider key on a real chapter covers: run a pass, accept, reject, undo, reload mid-run, quiet mode, chapter request, fragment request, generate and insert an illustration, DOCX export.
- [x] Visual fidelity to `d1.html` confirmed by screenshots at 1440px for idle, queue, quiet mode, `Запит` and studio states; material deviations are listed and justified.
- [x] Docs updated: `docs/CURRENT_STATE.md`, `docs/DECISIONS_LOG.md`, `docs/DEPLOYMENT.md` (switch), and a v1 retirement runbook.

## Milestone 1 - Foundation and editor engine

Depends on: nothing. Mode: proceed. Independent review: required (foundation; the document bridge is the main technical risk).

- [x] 1.1 Add the `/v2` route with its own layout under `apps/web/app/v2/`, fonts via `next/font` (Golos Text for UI, Source Serif 4 for the manuscript), and styles scoped with CSS Modules so nothing leaks into or from v1's global CSS. Build the static shell from the prototype: header, formatting toolbar, paper sheet, right panel with three tabs (tab bodies may be empty states).
- [x] 1.2 Add Tiptap (ProseMirror) as the v2 editor. Write `apps/web/lib/v2/tiptap-bridge.ts` converting `EditorDocument` ⇄ Tiptap JSON for all eight block types (`paragraph`, `heading`, `bullet_list`, `ordered_list`, `image`, `callout`, `divider`, `table`) with inline `bold`/`italic`, keeping every block's `id` stable through edits, splits and merges (new blocks get `createBlockId()`).
- [x] 1.3 Manual editing works: typing, Enter/Backspace/Shift+Enter, bold/italic, paragraph/H1–H3, bullet and ordered lists, callout and image blocks render, undo/redo; paragraph numbers in the gutter; toolbar buttons are live; word and paragraph stats.
- [x] 1.4 v2 draft persistence in its own key (`orest-v2-draft-{locale}-v1`). If no v2 draft exists and a v1 draft does, copy only its `document` once (read-only access to the v1 key).
- [x] 1.5 `Відкрити` (.docx, .txt, clipboard) and export (.docx, .txt) through the existing `lib/editor/import.ts` and `lib/editor/docx-export.ts`.
- [x] 1.6 Default-editor switch: `apps/web/app/page.tsx` redirects to `/v2` when `NEXT_PUBLIC_OREST_DEFAULT_EDITOR=v2`, otherwise `/editor`. v2 header has a link back to the classic version. No v1 UI changes.
- [x] 1.7 Verify: bridge round-trip unit tests for every block type and for split/merge id stability; typecheck, full test suite, build; runtime: `/v2` edit → reload keeps the text, DOCX import/export round-trip, `/editor` before/after screenshots identical, `/v2` idle screenshot compared with `d1.html` at 1440px.

Accepted 2026-10-10. Evidence: orchestrator re-ran typecheck (pass) and the test suite (407/407, 67 in `apps/web/test/v2-*.test.ts`) and compared a 1440px screenshot of `/v2` with `d1.html`; executor ran build, edit/reload, import/export, v1-draft copy with a byte-identical v1 key, `/editor` DOM fingerprint before/after, and the redirect switch; independent review found one should-fix (paste above the source stole the original block id) and five smaller issues, all fixed and re-tested. Not verified by eye: the multi-tab conflict notice and unreadable-draft error styling; Backspace-before-atom with a real key press.

Stop rule: if stable block ids cannot be kept through Tiptap editing, report `Blocked` with evidence instead of working around it; the fallback (hosting v1's `BlockEditorSurface` inside the v2 shell) is the orchestrator's decision.

## Milestone 2 - Suggestion engine and the first pass end to end (Ясність)

Depends on: 1. Mode: proceed. Independent review: required (core state machine everything else builds on).

- [x] 2.1 `apps/web/lib/v2/api.ts`: typed client for review runs (start, poll with `afterItem`, cancel), proposals, with fail-loud error mapping; reuse `review-run-recovery.ts`, `review-run-persistence.ts`, `review-run-merge.ts` rather than re-implementing them.
- [x] 2.2 `apps/web/lib/v2/store.ts`: a pure reducer for passes, review items, proposals, focus, filter, quiet mode and decisions, with unit tests.
- [x] 2.3 `Правки` tab: pass rows (launcher + state + filter), summary with progress, queue cards streaming in while the `clarity` run is in flight, `Зупинити`, recovery of an in-flight run after reload.
- [x] 2.4 Inline review: a pending item highlights its anchor range; focusing it prepares the proposal (`/api/edit/review/proposal`) and shows a word-level del/ins diff inline as editor decorations (not document content); accept applies the block replacement as one undo step; reject stores a rejected idea; edited anchors go stale via `reconcileReviewItemsWithRevision`.
- [x] 2.5 Card ⇄ mark linking (click and hover), refine + regenerate on a card.
- [x] 2.6 Verify: unit tests; runtime with a real key: run `Ясність`, accept, reject, undo, reload mid-run, stale card after a manual edit; a bad model id or missing key shows the real error.

Accepted 2026-10-10. Evidence: orchestrator re-ran typecheck (pass) and the suite (513/513) and checked real-keystroke typing on `/v2` after the text-sanitizer plugin; executor ran build and real-backend QA on a six-paragraph sample (run, streamed cards, prepare on card action, inline diff, accept + one-step undo with stable ids, reject, refine + regenerate, stale on manual edit, stop, reload recovery, real provider error shown); independent review found a diff-first blocker (invisible characters from pasted text made a ready proposal acceptable with no diff drawn) plus four defects, all fixed and unit-tested. Real calls spent: 5 runs, 4 proposals. Not verified at runtime: incremental streaming on a multi-chunk chapter, the mismatch/empty card states, failed-regenerate display, rerun-keeps-cards, cross-tab lease handover.

## Milestone 3 - Remaining passes and quiet mode

Depends on: 2. Mode: proceed. Independent review: conditional (required if the store or bridge contracts change).

- [x] 3.1 `Структура` (ghost headings from ready drafts, editable title, H2/H3), `Акценти` (inline, no proposal), `Врізки` (`interest`: ghost callout with kind and depth), `Списки` (`formatting`).
- [x] 3.2 `Правопис` through `/api/edit/spellcheck`: underlines, suggestions, ignore, add to dictionary.
- [x] 3.3 Bulk accept only for passes whose result is already visible (structure, accents, spelling).
- [x] 3.4 `Запустити всі`: passes queue client-side and run one after another (the server allows one review run at a time).
- [x] 3.5 Quiet mode: one card, dimmed marks, keyboard (Enter, Backspace/Delete, arrows), next proposal prepared ahead.
- [x] 3.6 Verify: unit tests for new reducer paths; runtime walk through each pass and quiet mode with a real key.

Accepted 2026-10-10. Evidence: orchestrator re-ran typecheck (pass) and the suite (600/600); executor ran build and real-backend QA on the six-paragraph sample (queue with reload in the middle, ghost heading insert/undo/edit, accents single and bulk with one undo, callout prepare/re-prepare/insert, list diff and accept with undo/redo, spellcheck fix/ignore/dictionary, quiet mode with real keys, paused queue after reload, reject + restore); independent review found no path that changes the manuscript unseen and five should-fix defects (unbounded and on-reload paid preparation in quiet mode, key repeat, ghost input re-creation, dead-end accept on a torn anchor, overlapping bulk edits), all fixed and unit-tested. Real calls spent: 5 review runs, 5 proposals. Open risk for 6.4 QA: one unexplained re-creation of the ghost heading input about a second after typing into an emptied title (not reproduced in three further attempts). Not verified at runtime: quiet-mode dwell/cap with real rewrite items, a failed pass inside the queue, `Зупинити всі`, `Продовжити чергу`, callout kind change, multi-suggestion spelling chooser, physically held keys.

## Milestone 4 - Огляд and Запит

Depends on: 3. Mode: proceed. Independent review: conditional.

- [x] 4.1 `Огляд`: diagnostics run (concise/extended) rendered as the model's markdown, with shortcuts to launch passes; fact-check rows with sources; a finding can open its linked suggestion or be added to a persisted, copyable "Запити до автора" list.
- [x] 4.2 `Запит` for the chapter: `final_editing` with the editor's instruction (plan → generate progress), results land in the same queue; request history with outcomes.
- [x] 4.3 Selection composer: appears under a text selection and disappears with it; quick actions and `Свій запит` go through `/api/edit/local-action` and the existing executors; results use the same inline diff and queue.
- [x] 4.4 Verify: runtime with a real key for diagnostics, fact-check, a chapter request and three fragment actions; idle state has nothing positioned over the manuscript.

Accepted 2026-10-10. Evidence: orchestrator re-ran typecheck (pass) and the suite (703/703) and checked `Огляд` idle and the composer under a real drag selection by screenshot; executor ran build and real-backend QA on the six-paragraph sample (diagnostics report, pass shortcut carrying `expertise`, fact-check with reload mid-run and a sourced finding for the planted false claim, `До правки`, author queries with copy, chapter request planning → generating → 6 cards, composer quick action with inline diff, accept + one undo, `Свій запит` scope, zero requests after reload, a real provider failure shown verbatim); independent review found no unseen-change or unprompted-cost path and three should-fix defects (stuck fragment request after rejecting a preparing card, stale holes retried with a new instruction, remote images rendered from model markdown), all fixed and unit-tested in a no-network round. Real calls spent: 1 diagnostics, 1 fact-check, 1 chapter request, 1 pass run, 1 proposal, 4 fragment requests. Not verified at runtime: the fix round itself (unit tests and reading only), extended diagnostics, a GFM table in a real report, the empty fact-check state, holes and per-action retry, stop/cancel, `Списком`/`Підзаголовок`/`Коротше`, a clarify answer. Cosmetic issue for 6.4: the diagnostics starter text wraps narrowly beside the mode switch.

## Milestone 5 - Illustrations

Depends on: 3 (4 for the composer entry point). Mode: proceed. Independent review: conditional.

- [x] 5.1 `Ілюстрації` pass: cards and a ghost figure at the insertion point.
- [x] 5.2 Studio: intent, prompt, style preset, fast/quality, caption; generate and regenerate through the proposal and `/api/edit/review/image` job flow; a changed prompt invalidates the old preview; insert as an image block via the asset store; reopen an inserted figure.
- [x] 5.3 Verify: generate, regenerate and insert a real image; failure of the image provider shows the real error; the image survives reload and DOCX export.

Accepted 2026-10-10. Evidence: orchestrator re-ran typecheck (pass) and the suite (787/787); executor ran build and real-backend QA (pass run with four visual cards and ghost figures, prompt preparation, prompt/caption editing, real image generation, stale state after a style change, `Оновити промпт` + regenerate, insert with one undo and redo, `Змінити` with replace and caption save, reload with zero requests, DOCX export containing the image, free studio open, own prompt, synchronous generation, modal keys with real key presses, cancel, broken-image state); independent review found no unseen-insert or unprompted-cost path and four should-fix defects (async job path unreliable on the in-memory server job store, poller limits, reruns deleting worked-on illustrations, modal losing keys when focus left the overlay), all fixed. Real calls spent: 1 pass run, 4 prompt preparations, 5 image generations (all fast). Not verified at runtime: the 75 s timeout, a provider-side generation failure, image-source rejections, rerun-keeps-illustrations (unit tests only), visual cards from a chapter request, `Якісно`, `Запустити всі` including visuals; DOCX export and `Замінити в тексті` were not re-run after the fix round.

## Milestone 6 - Parity, polish and handover

Depends on: 4, 5. Mode: proceed. Independent review: required (final).

- [x] 6.1 Change history (compare `Було`/`Стало`), global replace (`Ctrl/Cmd+H`), hotkeys popup, clear-document with confirmation and recovery.
- [x] 6.2 English copy catalog; v2 follows the app locale.
- [x] 6.3 Responsive layout (tablet first, phone degrades gracefully), accessibility (focus, labels, reduced motion), loading/empty/error states for every tab.
- [x] 6.4 Fidelity pass against `d1.html`; performance check on a ~140k-character chapter.
- [x] 6.5 Docs: `docs/CURRENT_STATE.md`, `docs/DECISIONS_LOG.md`, `docs/DEPLOYMENT.md`, and `docs/V1_RETIREMENT.md` listing exactly what to flip and delete if the client chooses v2.
- [x] 6.6 Verify: every Definition of Done item on the integrated result; a scripted browser QA (`qa:v2`) for the main flow.

Accepted 2026-10-10. Evidence: orchestrator re-ran typecheck (pass), the suite (843/843) and a production build (pass; `/v2` 194 kB, `/editor` 62.4 kB route size), confirmed `git diff` is empty for every v1 folder, and looked at `/v2` idle at 1440px; executor ran real-key QA of every 6.1 feature, English end to end, tablet and phone walkthroughs without horizontal scroll, a keyboard-only walkthrough, reduced-motion and contrast audits, 140k-character measurements (production build: no long task in any scenario), a real `Структура` run on a 40k chapter showing cards arriving incrementally across polls, and `qa:v2` (16/16 free, 17/17 with the paid flag); `/editor` byte-identical by screenshot against a HEAD copy; final independent review found no blocker and five should-fix defects, all resolved (the automatic asset cleanup was removed outright). Real calls spent: 2 `Структура` runs, plus an estimated 3–5 short validation pings sent unintentionally by the classic `/settings` page during QA. Not verified at runtime: history entries for illustration insert/replace, the live region with a real screen reader, the `blocked === "content"` open-file promise, a damaged history entry in the dialog.

## Key Decisions & Unexpected Findings

- Decision (owner, 2026-10-09): build v2 from the "Папір" prototype (`d1.html`) and keep v1 alongside until the client chooses. Reason: the client compares both. Tradeoff: two editors to keep alive for a while.
- Decision (orchestrator): v2 is a route in the same app, not a new repo or branch deployment. Reason: reuses auth, settings, APIs and the Workflow runtime; retirement is a redirect flip plus deletions. Tradeoff: v1's global CSS is loaded on `/v2`, so v2 styles must be scoped.
- Decision (orchestrator): Tiptap/ProseMirror for the manuscript. Reason: v1's hand-rolled `contentEditable` surface is the source of the caret, selection and list bugs in the user-feedback backlog, and inline diff decorations are native to ProseMirror. Tradeoff: a new dependency and a bridge to `EditorDocument`; validated first in Milestone 1 with a stop rule.
- Decision (orchestrator): separate v2 draft storage with a one-time copy of the v1 document. Reason: v1 drafts must never be corrupted by v2.
- Deviation from the prototype: proposals are prepared on focus (plus the next one in quiet mode), not all at once. Reason: each replace-type diff is a separate model call (`/api/edit/review/proposal`); preparing 100 eagerly would be slow and costly. Until prepared, a card shows the recommendation and the highlighted anchor.
- Deviation from the prototype: diagnostics is shown as the model's markdown, not as five typed findings. Reason: the server returns prose; structuring it means changing prompts/contracts, which is excluded. Pass shortcuts sit beside the report instead of under each finding.
- Deviation from the prototype: bulk accept is limited to passes whose result is already visible. Reason: diff-first.
- Finding: all client fetch logic for the AI endpoints lives inside `apps/web/app/editor/page.tsx` (8,000 lines); there is no reusable client. v2 writes its own thin client and reuses only the pure helpers in `apps/web/lib/editor/`.
- Finding: `apps/web/middleware.ts` gates every non-public path, so `/v2` is password-protected without changes.
- Finding: the `test` script in `apps/web/package.json` lists test files explicitly; new tests must be added to that list.
- Finding: `docs/sample4.html`, named in `AGENTS.md` as the visual baseline, is not in the repository. v2's baseline is `docs/concepts/v2/d1.html`.
- Decision (orchestrator, 2026-10-10): v2 stores new image assets in the IndexedDB store `orest-editor-assets-v1` that v1 also uses. Reason: `docx-export.ts` and copied v1 documents read from it; writes are additive with random ids. v2 still never writes v1 localStorage draft keys.
- Finding: the default-editor switch is build-time (`NEXT_PUBLIC_*` is inlined, `/` is prerendered); flipping it needs a rebuild. Document in `docs/DEPLOYMENT.md` (6.5).
- Finding: existing DOCX export → import does not preserve headings or callouts (they return as paragraphs); this is in v1's `lib/editor` libraries and affects v1 equally. Out of scope unless the owner asks.
- Finding (M1 interfaces later milestones rely on): block id lives in `attrs.id` / `data-block-id`; `findBlockPosition`, `getTopLevelBlockIds` in `apps/web/lib/v2/block-ids.ts`; `ManuscriptEditor` ref handle `getEditor/getDocument/replaceDocument/run`; decorations hook in `createEditingExtension` (`apps/web/lib/v2/tiptap-extensions.ts`); all draft writes go through `writeV2DraftIfUnchanged` and respect the workspace `blocked` gate; `tiptapToDocument` throws on a block without an id.
- Decision (orchestrator, 2026-10-10): a proposal is prepared only by an explicit action on its card (`Показати правку`, Enter, re-prepare, regenerate). Clicking a mark or a card only focuses. Reason: every proposal is a paid model call and a caret click into a marked paragraph was triggering one.
- Decision (orchestrator, 2026-10-10): accept is impossible unless the diff is actually drawn (`isReviewDiffDrawn`); every later accept path, including bulk accept, must honour the equivalent "result is visible" check. Reason: diff-first.
- Decision (orchestrator, 2026-10-10): inline diffs coalesce a mostly rewritten sentence into one deletion + one insertion (thresholds in `apps/web/lib/v2/word-diff.ts`); light edits stay word-level. Reason: readability and prototype fidelity.
- Decision (orchestrator, 2026-10-10): a rerun keeps the pass's undecided cards until the new run produces items or completes successfully. Reason: a failed or stopped rerun must not empty the queue. Differs from v1.
- Decision (orchestrator, 2026-10-10): `Ясність` runs without diagnostics text until Milestone 4 supplies `expertise` (v1 requires diagnostics first; the server does not).
- Finding: text is sanitised on entry to the editor (`apps/web/lib/v2/text-sanitizer.ts`) so the ProseMirror document and the bridge output always agree.
- Finding: an empty `APP_PASSWORD` opens pages in dev but the AI routes answer 503; real-backend QA needs a process-only password and a login through `/api/auth/login`.
- Finding (M2 interfaces): `apps/web/lib/v2/api.ts` (runs, proposals), `store.ts` (pure reducer; `PASS_STEP_ID`, `selectQueue`, `quiet/set`, `replaceOnResult`), `review-marks.ts` (`ReviewMark`, `ins-block` widgets for ghost blocks), `review-apply.ts` (`replaceAnchoredBlocks`, `sealHistory`), `components/v2/useReviewEngine.ts` (`runPass`, `focusItem`, `showItem`, `prepareItem`, `acceptItem`), `EditsTab.tsx` (`LIVE_PASSES`).
- Carried into Milestone 3: non-replace item kinds (ready subsection drafts, emphasis targets, callout drafts) in the engine and in draft persistence; runs for steps without a pass row; redo detection for proposals with fewer `newBlocks` than anchors; pruning stored proposals; draft write frequency during polling.
- Decision (orchestrator, 2026-10-10): `Списки` (`formatting`) is a seventh pass row for v1 parity; `Ілюстрації` stays greyed until Milestone 5.
- Decision (orchestrator, 2026-10-10): quiet mode may auto-prepare the current item (after a 500 ms dwell) and the next one, at most two in flight; the quiet flag is not persisted; failed preparations are never auto-retried. Reason: the mode exists to walk the queue quickly, but nothing may spend model calls on reload or on held arrow keys.
- Decision (orchestrator, 2026-10-10): a queue restored from a draft is paused until `Продовжити чергу`; only a run that was in flight resumes. Reason: no paid runs without an action.
- Decision (orchestrator, 2026-10-10): reject offers `Повернути` in a toast and removes the rejected idea it added.
- Finding: callout items delivered by a review run look ready but their draft text is a copy of the source paragraph or a teaser; v2 treats only drafts from the proposal endpoint as prepared (`calloutPrepared`).
- Finding: v1's `mergeIncomingReviewItems` keeps one item per type and anchor, dropping all but the first accent in a paragraph; v2 merges emphasis items by phrase.
- Finding: emphasis items arrive with an empty `reason`; cards fall back to the recommendation or a fixed pass-level reason.
- Finding: running `next build` beside the dev server breaks the dev API (500s); build only with the dev server stopped.
- Finding (M3 interfaces): `apps/web/lib/v2/item-kinds.ts` (`getItemKind`, `needsProposalCall`), `item-marks.ts` (`buildItemMarks`), `accept-plan.ts` (`planBulkAccept`), `spell-items.ts`; `ReviewGhost` in `review-marks.ts`; `applyReviewEdits` in `review-apply.ts`; store `queue`/`queuePaused`, `planQuietPreparation`, `item/restored`; engine `notify(tone, message, { label, run })`.
- Carried into Milestone 4: run state keyed by step rather than pass (diagnostics, fact_check, final_editing have no pass row; a persisted run of such a step is currently dropped silently on reload); a label/tone source for items without a pass; an action that inserts a single manual/local item into the queue; `getItemKind` identifies accents only by `stepId === "emphasis"`.
- INCIDENT (2026-10-10): the Milestone 4 executor cleared localStorage, sessionStorage and three IndexedDB stores for `http://127.0.0.1:3000` in the built-in browser pane during cleanup, without a snapshot. Repo unaffected; the owner was told. Standing rule for all executors from now on: never clear browser storage or delete databases on any origin; snapshot the keys you will change before QA and restore only those; do QA on one stated origin.
- Finding (server, shared with v1, NOT fixed — owner decision pending): `POST /api/edit/patch` fails on OpenAI, the default provider, with 502 `Invalid schema for response_format 'patch_operations' … Missing 'bold'`, so fragment rewrites (`Простіше`, `Коротше`, free text) fail on default settings in v1 and v2. v2 shows the error verbatim. The fix belongs in `apps/web/lib/server/patch-service.ts`.
- Finding (server, shared with v1, not fixed): the Ukrainian clarify pattern in `apps/web/lib/editor/local-action-router.ts` uses `` around Cyrillic and never matches, so `clarify` is effectively English-only.
- Finding: in dev the pane may redirect `127.0.0.1:3000` to `localhost:3000` after login; they are different origins with separate storage.
- Decision (orchestrator, 2026-10-10): model markdown never renders images; only http(s) links become anchors (`apps/web/components/v2/ReportMarkdown.tsx`).
- Decision (orchestrator, 2026-10-10): rewrite-type fragment actions refuse a scope containing a non-text block (image, table, divider, callout) instead of sending it. Reason: a paragraph answer would be drawn as deleting that block.
- Decision (orchestrator, 2026-10-10): a chapter-request retry always uses the instruction its plan was made for (`planInstruction`).
- Finding (M4 interfaces): `V2RunId` (passes + `diagnostics` | `fact_check` | `request`), `launchRun`, `state.steps/overview/request`, `item/added`, `getItemSource`; `apps/web/lib/v2/overview.ts`, `fragment-actions.ts` (`buildFragmentManualItem`, `executeFragment` in the engine), `selection-scope.ts`, `toast.ts` (areas), `focus-scroll.ts`; components `OverviewTab.tsx`, `AskTab.tsx`, `SelectionComposer.tsx`, `ReportMarkdown.tsx`.
- Carried into Milestone 5: the manual `visual` item (no `stepId`, `visualIntent: "infographic"`) and chapter-request `visual` cards already reach the queue with a disabled placeholder (`kind === "visual"` branch of `ReviewCard` in `EditsTab.tsx`); `visual` is mapped but not in `LIVE_PASSES`; the router request sends no `visualStylePreset`; remove the `copy.ask.visualPending` toast.
- Decision (orchestrator, 2026-10-10): images are generated with one synchronous POST, as v1 does; the async job path is not used. Reason: the server's image job store is an in-memory map per function instance, so a poll can miss the job on Vercel. Tradeoff: a generation in flight at reload becomes `interrupted` and is not resumed. (The orchestrator's Milestone 5 brief originally asked for the job path; that was a mistake.)
- Decision (orchestrator, 2026-10-10): opening the studio is free; the prompt is prepared only by `Підготувати промпт` or written by the editor.
- Decision (orchestrator, 2026-10-10): a replace run keeps illustration items that are inserted or have a prompt, caption, asset or request in flight.
- Decision (orchestrator, 2026-10-10): image sources from responses are restricted to png/jpeg/webp, 20 MB, https with no credentials, and never overwrite an existing asset record.
- Finding (server, shared with v1, not fixed): `createImagePromptProposal` in `apps/web/lib/server/review-action-service.ts` substitutes a stand-in prompt when the model's output is unusable; v2 can detect only the fully empty case.
- Finding: `Скасувати` during generation only stops waiting; the server has no cancel, so the call may still be billed (the UI says so).
- Finding (M5 interfaces): `apps/web/lib/v2/studio.ts` (state machine, `isStudioTouched`), `visual-api.ts` (`generateImage`, limits), `figure-apply.ts`, `components/v2/VisualStudio.tsx`; `item.studio`, `visualPrefs`, `findFigureItem`, `isKeptOnReplace` in the store; QA hooks `data-studio*`, `data-sg-studio`, `data-figure-edit`, `data-card-state`.
- Carried into Milestone 6: unreferenced image assets are never deleted (decide a safe cleanup or document it); per-keystroke store work while typing in the studio (measure in 6.4); toast buttons unreachable by keyboard while the studio is open; touched-but-stale illustration cards accumulate until rejected; studio responsive layout under 800 px untested; no live-region announcement when an image completes.
- Decision (orchestrator, 2026-10-10): v2 never deletes image asset records. An automatic cleanup was built and removed after review: it could delete images that a recovery snapshot or another tab still needed. Unreferenced images stay in the browser's asset store; a safe cleanup is an open item in `docs/V1_RETIREMENT.md`.
- Decision (orchestrator, 2026-10-10): the session keeps the last three replaced/cleared manuscripts for recovery, bound to their locale; confirmations state exactly what will be recoverable.
- Decision (orchestrator, 2026-10-10): tertiary text and four tint tones are darker than the prototype to meet WCAG AA (owner may overrule).
- Finding: the ghost-heading input re-creation from Milestone 3 was caused by `item/headingEdited` falling back to H3 when the title was empty; fixed in Milestone 6.
- Finding: the classic `/settings` page sends a real model check 500 ms after it opens; `qa:v2` answers that request locally.
- Deferred to 6.3: a keyboard path to the selection composer and to fragment scope.
- Deferred to 6.1: confirmation before `Відкрити` replaces the manuscript; a "discard and start over" action for an unreadable v2 draft.
- Assumption: v1 items for `structure` arrive with ready heading drafts and `emphasis` items carry exact targets (per `docs/CURRENT_STATE.md`). Resolve: confirm against real responses in Milestone 3.

## Completion Summary

What changed: a second editor at `/v2` in the "Папір" design, built in six milestones on branch `v2` (commits `9b1cc67`, `d7f871d`, `e3b97bc`, `128e80a` and the Milestone 6 commit, on top of the prototype and plan commits). It has a Tiptap manuscript bridged to `EditorDocument` with stable block ids; three tabs (`Огляд`, `Правки`, `Запит`); seven passes with a launch queue, inline word-level diffs, ghost headings/callouts/figures, bulk accept where the result is visible, quiet mode; diagnostics, fact-check and author queries; chapter and fragment requests with a selection composer; an illustration studio with real generation; change history, global replace, hotkeys, confirmations with three-level recovery; Ukrainian and English; tablet/phone layouts and keyboard paths. v1 (`/editor`, `/settings`, server, prompts, drafts) is unchanged; the default editor is switched by `NEXT_PUBLIC_OREST_DEFAULT_EDITOR` at build time.

How it was verified: every milestone was implemented by a fresh executor, reviewed independently (blocking and should-fix findings fixed before acceptance), and cross-checked by the orchestrator (typecheck, full suite, screenshots). Final state: typecheck pass, 843/843 tests (503 of them v2), production build pass, `qa:v2` 16/16. Real-backend QA across milestones covered each pass, accept/reject/undo, reload mid-run, quiet mode, diagnostics, fact-check, chapter and fragment requests, image generation and insert, DOCX export with an image.

Left outside the plan or open:
- Not pushed and not deployed.
- Shared server issues found and deliberately not fixed (they affect v1 equally; listed in `docs/V1_RETIREMENT.md`): `/api/edit/patch` fails on OpenAI, the default provider, so fragment rewrites fail on default settings; the Ukrainian clarify pattern never matches; a stand-in image prompt is substituted silently; the image job store is in-memory.
- Known v2 limits: proposals are prepared per card on explicit action; diagnostics is prose, not typed findings; bulk accept only for structure, accents and spelling; unreferenced images are never cleaned up; cancelling an image generation does not stop billing; real-backend QA used a six-paragraph sample and a 40k synthetic chapter, not an author's real 140k chapter.
- Deviations from the prototype are listed per milestone above and in `docs/CURRENT_STATE.md`.
- Incident: a Milestone 4 executor wiped the built-in browser pane's storage for `127.0.0.1:3000`; the repository was not affected.
