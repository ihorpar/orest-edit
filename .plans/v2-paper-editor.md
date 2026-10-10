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

- Status: Active
- Plan revision: r1 (2026-10-09)
- Canonical plan: `.plans/v2-paper-editor.md` in the main working tree. Plan owner: the orchestrator session. Executors report evidence; only the orchestrator checks off tasks.
- Current milestone: 2 — Suggestion engine and the first pass (assigned 2026-10-10, in progress). Milestone 1 accepted 2026-10-10.
- Next action: receive the Milestone 2 executor report, run the required independent review, accept or return fixes.
- Blocker: None.
- Workspace: single working tree `C:\Projects\oboz-ai\orest-edit`, branch `v2` (from `master` at `dcb52ae`). Commits to `v2` are authorized by the owner (2026-10-10); pushing is not. The orchestrator commits each milestone when it is accepted; executors still do not touch git state. Worktree exception: executors run one at a time in this tree, so no per-milestone worktrees.
- Orchestrator may decide: implementation choices, simplifications within scope, reordering independent tasks. Needs the owner: changing hard constraints or required outcomes, weakening acceptance, pushes/deploys, anything touching v1 behaviour.

## Definition of Done

- [ ] `/v2` offers the full editor in the "Папір" design: manual editing, the three tabs, every pass, quiet mode, selection composer, illustration studio, open/export.
- [ ] Every AI feature in v2 calls the existing `/api/edit/*` endpoints for real; no sample data, no synthetic fallbacks; provider errors are shown as errors.
- [ ] v1 is unchanged: `/editor` and `/settings` behave and look as before; v1 drafts are never written by v2; `npm run test -w @orest/web` still passes all pre-existing tests.
- [ ] Switching the default editor is one setting (`NEXT_PUBLIC_OREST_DEFAULT_EDITOR`), documented, with v1 as the default; each version stays reachable by URL.
- [ ] `npm run typecheck -w @orest/web`, `npm run test -w @orest/web` and `npm run build -w @orest/web` pass; new v2 logic has unit tests registered in the `test` script.
- [ ] Runtime QA with a real provider key on a real chapter covers: run a pass, accept, reject, undo, reload mid-run, quiet mode, chapter request, fragment request, generate and insert an illustration, DOCX export.
- [ ] Visual fidelity to `d1.html` confirmed by screenshots at 1440px for idle, queue, quiet mode, `Запит` and studio states; material deviations are listed and justified.
- [ ] Docs updated: `docs/CURRENT_STATE.md`, `docs/DECISIONS_LOG.md`, `docs/DEPLOYMENT.md` (switch), and a v1 retirement runbook.

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

- [ ] 2.1 `apps/web/lib/v2/api.ts`: typed client for review runs (start, poll with `afterItem`, cancel), proposals, with fail-loud error mapping; reuse `review-run-recovery.ts`, `review-run-persistence.ts`, `review-run-merge.ts` rather than re-implementing them.
- [ ] 2.2 `apps/web/lib/v2/store.ts`: a pure reducer for passes, review items, proposals, focus, filter, quiet mode and decisions, with unit tests.
- [ ] 2.3 `Правки` tab: pass rows (launcher + state + filter), summary with progress, queue cards streaming in while the `clarity` run is in flight, `Зупинити`, recovery of an in-flight run after reload.
- [ ] 2.4 Inline review: a pending item highlights its anchor range; focusing it prepares the proposal (`/api/edit/review/proposal`) and shows a word-level del/ins diff inline as editor decorations (not document content); accept applies the block replacement as one undo step; reject stores a rejected idea; edited anchors go stale via `reconcileReviewItemsWithRevision`.
- [ ] 2.5 Card ⇄ mark linking (click and hover), refine + regenerate on a card.
- [ ] 2.6 Verify: unit tests; runtime with a real key: run `Ясність`, accept, reject, undo, reload mid-run, stale card after a manual edit; a bad model id or missing key shows the real error.

## Milestone 3 - Remaining passes and quiet mode

Depends on: 2. Mode: proceed. Independent review: conditional (required if the store or bridge contracts change).

- [ ] 3.1 `Структура` (ghost headings from ready drafts, editable title, H2/H3), `Акценти` (inline, no proposal), `Врізки` (`interest`: ghost callout with kind and depth), `Списки` (`formatting`).
- [ ] 3.2 `Правопис` through `/api/edit/spellcheck`: underlines, suggestions, ignore, add to dictionary.
- [ ] 3.3 Bulk accept only for passes whose result is already visible (structure, accents, spelling).
- [ ] 3.4 `Запустити всі`: passes queue client-side and run one after another (the server allows one review run at a time).
- [ ] 3.5 Quiet mode: one card, dimmed marks, keyboard (Enter, Backspace/Delete, arrows), next proposal prepared ahead.
- [ ] 3.6 Verify: unit tests for new reducer paths; runtime walk through each pass and quiet mode with a real key.

## Milestone 4 - Огляд and Запит

Depends on: 3. Mode: proceed. Independent review: conditional.

- [ ] 4.1 `Огляд`: diagnostics run (concise/extended) rendered as the model's markdown, with shortcuts to launch passes; fact-check rows with sources; a finding can open its linked suggestion or be added to a persisted, copyable "Запити до автора" list.
- [ ] 4.2 `Запит` for the chapter: `final_editing` with the editor's instruction (plan → generate progress), results land in the same queue; request history with outcomes.
- [ ] 4.3 Selection composer: appears under a text selection and disappears with it; quick actions and `Свій запит` go through `/api/edit/local-action` and the existing executors; results use the same inline diff and queue.
- [ ] 4.4 Verify: runtime with a real key for diagnostics, fact-check, a chapter request and three fragment actions; idle state has nothing positioned over the manuscript.

## Milestone 5 - Illustrations

Depends on: 3 (4 for the composer entry point). Mode: proceed. Independent review: conditional.

- [ ] 5.1 `Ілюстрації` pass: cards and a ghost figure at the insertion point.
- [ ] 5.2 Studio: intent, prompt, style preset, fast/quality, caption; generate and regenerate through the proposal and `/api/edit/review/image` job flow; a changed prompt invalidates the old preview; insert as an image block via the asset store; reopen an inserted figure.
- [ ] 5.3 Verify: generate, regenerate and insert a real image; failure of the image provider shows the real error; the image survives reload and DOCX export.

## Milestone 6 - Parity, polish and handover

Depends on: 4, 5. Mode: proceed. Independent review: required (final).

- [ ] 6.1 Change history (compare `Було`/`Стало`), global replace (`Ctrl/Cmd+H`), hotkeys popup, clear-document with confirmation and recovery.
- [ ] 6.2 English copy catalog; v2 follows the app locale.
- [ ] 6.3 Responsive layout (tablet first, phone degrades gracefully), accessibility (focus, labels, reduced motion), loading/empty/error states for every tab.
- [ ] 6.4 Fidelity pass against `d1.html`; performance check on a ~140k-character chapter.
- [ ] 6.5 Docs: `docs/CURRENT_STATE.md`, `docs/DECISIONS_LOG.md`, `docs/DEPLOYMENT.md`, and `docs/V1_RETIREMENT.md` listing exactly what to flip and delete if the client chooses v2.
- [ ] 6.6 Verify: every Definition of Done item on the integrated result; a scripted browser QA (`qa:v2`) for the main flow.

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
- Deferred to 6.1: confirmation before `Відкрити` replaces the manuscript; a "discard and start over" action for an unreadable v2 draft.
- Assumption: v1 items for `structure` arrive with ready heading drafts and `emphasis` items carry exact targets (per `docs/CURRENT_STATE.md`). Resolve: confirm against real responses in Milestone 3.

## Completion Summary

_Not complete._
