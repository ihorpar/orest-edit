# Make Large-Document Review Chunked, Incremental, And Apply-Safe

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

This is the active implementation plan for the current phase. It does not reopen `.plans/durable-review-workflow.md` or `docs/plans/EXECPLAN_MULTI_STEP_EDITORIAL_REVIEW_WORKFLOW.md`. Those already delivered durable Vercel Workflow runs and sequential `Акценти` chunking. This plan generalizes that engine to recommendation steps, streams completed prefix results, and lets the editor apply cards while later chunks are still running.

## Purpose / Big Picture

On a ~140k-symbol chapter, `Ясність` currently sends the whole manuscript in one provider call. The server aborts that call at 280 seconds (`reviewRequestTimeoutMs` in `apps/web/lib/server/review-service.ts`), and the drawer shows the raw `AbortError` text `This operation was aborted`. The same monolith will fail `Структура`, `Інтерес`, `Візуали`, `Форматування`, and `Власний запит` on the same files. Only `Акценти` is chunked today, and even that hides cards until the entire run finishes.

After this change, a book editor can press `Запустити` on `Ясність` for a 140k-symbol manuscript and:

- see a character-weighted progress bar and the copy `Розібрано початок розділу · 4 з 10 фрагментів` as work proceeds;
- receive recommendation cards for the already-finished prefix (first ~16k, then the next, and so on) without waiting for the tail;
- apply, prepare, or reject those prefix cards while later fragments are still running;
- keep completed cards if a later fragment times out, with a hole in the bar and a retry for that fragment only;
- never lose the run just because applying a rewrite changed `documentRevisionId`.

Anchors stay on stable `block.id` values plus text fingerprints. Visible gutter numbers (`001`, `002`) remain display-only. The run analyzes a frozen snapshot taken at start; live edits are rebased onto arriving cards by id and fingerprint.

## Milestones

### Milestone 1: Shared character-budget chunks and per-chunk card density

Status: Complete.

Done:

- Shared `planReviewChunks` in `apps/web/lib/server/review-chunk-planner.ts` with a 16,000-character cap, heading-aware packing, and a 400-block safety cap. `planEmphasisChunks` remains a wrapper.
- Chunk-scoped card density targets about 4-8 cards per 16k when `reviewChunk` / `emphasisChunk` is set.
- Recommendation-card normalization prefers explicit `blockId`; OpenAI/Gemini schemas and prompt scaffold ask for it.
- Composer-2.5 review accepted: extra tests for unknown `blockId` fallback and `blockId`+later `blockEnd` ranges; emphasis helpers now read `resolveReviewChunkScope`.

Remaining:

- None for this milestone.

Proof:

- `npm run typecheck -w @orest/web` passed.
- Targeted tests 66/66 passed after review fixes.

### Milestone 2: Durable sequential workflow with frozen snapshot, prefix stream, and holes

Status: Complete.

Done:

- Recommendation-card steps (`clarity`, `structure`, `interest`, `visuals`, `formatting`, `emphasis`, `final_editing`) run through sequential durable chunks against the start snapshot. Each chunk slices `document` but keeps the frozen `revision`.
- After each successful chunk, core items are appended to the `review-partial-items` workflow stream and character-weighted progress is published. GET `kind: "run"` returns accumulated prefix items; failed/provider-error envelopes also expose those items when present.
- After bounded retries, a failed chunk becomes a hole: prefix items stay, later chunks still run, `failedChunks` is recorded. Missing API key / 401 / 403 remain whole-run fatal.
- Provider `AbortError` maps to localized timeout copy (`OpenAI перевищив таймаут 280с.` / English equivalent), never `This operation was aborted`.
- Chunk-scoped diagnostics context is clipped to 1200 characters. Clarity-like steps get core-vs-context prompt guidance.
- Composer-2.5 review [aabb1b4e](aabb1b4e-32da-4937-ba44-8d4f05210f19): accepted P0 frozen-revision alignment and GET prefix-on-error; accepted core/context prompt and stream consume helper; rejected full-stream poll cost, duplicate sync orchestrator, chunk-local prompt indexes, and treating 400 as fatal.

Remaining:

- None for this milestone.

Proof:

- Targeted tests 78/78 passed, including abort timeout copy, prefix-keep-on-later-timeout, hole merge with later chunks, GET-shaped prefix envelope, and snapshot `documentRevisionId` alignment.
- `npm run typecheck -w @orest/web` passed.

### Milestone 3: Apply prefix cards while the tail is still running

Status: Complete.

Done:

- `isRunCompatibleWithEditor` no longer requires equal `documentRevisionId`. Compatibility is same locale plus manuscript identity (`snapshotBlockIds` overlap; empty document is incompatible).
- `replace` clears that step's cards (and a matching active proposal) at 202 start, then `mergeIncomingReviewItems` accumulates poll prefix in document order and rebases with `reconcileReviewItemsWithRevision`.
- `applyEditorialReviewResult` no longer stale-cancels the whole run when live revision changes. Partial merge does not write history; terminal apply still does.
- `Очистити` / import via `replaceEditorSession` cancels the active run. Applied prefix status is kept when later chunks arrive.
- Composer-2.5 review [5524270b](5524270b-ec1a-4e44-86d8-2e4ff0daea05): accepted snapshot-overlap tests, draft round-trip, proposal clear on replace, sync result clear, and duplicate-reset cleanup. Rejected treating missing `snapshotBlockIds` as incompatible (pre-M3 drafts). Deferred in-flight empty copy to M4.

Remaining:

- None for this milestone.

Proof:

- Persistence: live rewrite with overlapping snapshot ids stays compatible; empty live ids and zero overlap do not.
- Rebase: unchanged block stays pending; changed or deleted block becomes `stale`.
- Merge: replace clear is step-scoped; prefix cards accumulate in document order; applied status survives later incoming chunks.
- `npm run typecheck -w @orest/web` passed.

### Milestone 4: Progress bar, prefix copy, and fragment retry

Status: Complete.

Done:

- Header progress bar uses `completedSourceChars / totalSourceChars` (chunk-count fallback). Track is blue (`#dbeafe`); fill is teal (`#0f766e`), not apply-highlight green.
- Copy is `Розібрано початок розділу · N з M фрагментів` / `Parsed the start of the chapter · N of M fragments`.
- `Повторити цей фрагмент` starts a preserve run over the hole's core blocks plus one neighbor on each side. In-flight parent runs disable retry. Successful retry removes that hole without wiping sibling holes.
- Composer-2.5 review [798aa098](798aa098-8d97-4b9e-8493-f750550a3815): no P0; accepted hole-list lifecycle on fragment retry and button index labels. Rejected treating ±1 context as a bug and re-disabling accept-all during flight.

Remaining:

- None for this milestone.

Proof:

- Copy catalogs in `uk.ts` / `en.ts`.
- `review-run-progress.test.ts`: 20% of 32k/160k; slice of `p3` keeps `p2,p3,p4`.
- Manual QA checklist (no screenshots unless requested):
  1. Open `/editor` with a long chapter, run `Ясність`.
  2. Confirm the header bar fills by characters and the copy uses fragment counts, not `Акценти`.
  3. Confirm prefix cards appear before the tail finishes and can be prepared/applied.
  4. If a fragment fails, confirm a hole retry button; after the parent run ends, retry in preserve mode without clearing earlier cards.
  5. Confirm apply-highlight green in the manuscript is visually distinct from the teal progress fill.

### Milestone 5: Handoff docs and verification closeout

Status: Complete.

Done:

- `docs/CURRENT_STATE.md`, `docs/DECISIONS_LOG.md`, and `docs/DEPLOYMENT.md` updated for chunked recommendation steps, prefix GET items, apply-while-running identity, and leftover monolithic diagnostics/fact-check.
- `apps/web/package.json` test script now includes `review-chunk-runtime`, `review-run-merge`, and `review-run-progress`. Stale Luna price-label assertion aligned with `priceTier: 1`.

Remaining:

- None for this milestone.

Proof:

- `npm run typecheck -w @orest/web` passed (2026-08-12).
- `npm run test -w @orest/web` passed 283/283 (2026-08-12).
- `npm run build -w @orest/web` passed (Next.js 15.5.12, compiled successfully).
- Composer-2.5 review [450924a5](450924a5-33bd-4173-9311-c4192ef4ea68): accepted DECISIONS_LOG supersession (revision identity, 400-block cap), teal progress wording, completed-plan pointer, Context refresh, and pre-M3 snapshot fallback in CURRENT_STATE. Rejected committing untracked files in this task. Deferred a dedicated GET prefix `items` route test.

## Progress

- [x] (2026-08-12 17:48Z) Recorded the product decisions from the large-file timeout discussion and drafted this ExecPlan.
- [x] (2026-08-12 18:20Z) Milestone 1: shared planner, per-chunk density, `blockId`-first anchors. Reviewer [cabfa65f](cabfa65f-1bdd-44d2-8e8b-5006931b1a14): no P0; accepted fallback/range tests and chunk-scope helper unification; deferred context-block merge filter and document slicing to M2.
- [x] (2026-08-12 19:10Z) Milestone 2: sequential durable chunks, prefix stream, holes, localized timeout. Reviewer [aabb1b4e](aabb1b4e-32da-4937-ba44-8d4f05210f19): P0 frozen `documentRevisionId` (accepted); GET prefix on failed runs (accepted); core/context prompt (accepted); rejected poll-cost rewrite, unifying sync/workflow orchestrators, and treating 400 as fatal.
- [x] (2026-08-12 19:40Z) Milestone 3: apply-while-running rebase; drop whole-run revision kill switch. Reviewer [5524270b](5524270b-ec1a-4e44-86d8-2e4ff0daea05): accepted snapshot-overlap tests and replace-start proposal clear; rejected missing-snapshot incompatibility; deferred in-flight empty copy to M4.
- [x] (2026-08-12 20:10Z) Milestone 4: character-weighted progress bar, prefix copy, fragment retry. Reviewer [798aa098](798aa098-8d97-4b9e-8493-f750550a3815): no P0; accepted hole-list lifecycle on fragment retry.
- [x] (2026-08-12 20:40Z) Milestone 5: handoff docs; typecheck pass; test 283/283; production build pass. Added missing chunk/merge/progress tests to the npm script; aligned Luna price-label assertion with `settings.ts`. Reviewer [450924a5](450924a5-33bd-4173-9311-c4192ef4ea68): accepted DECISIONS_LOG/CURRENT_STATE hygiene; rejected commit-now; deferred GET prefix route test.

## Surprises & Discoveries

- Observation: the numbers `001`…`100` in the manuscript gutter are `formatParagraphLabel(blockIndex)` in `apps/web/lib/editor/manuscript-structure.ts`, not block ids. Canonical ids are already unique strings from `createBlockId()` in `apps/web/lib/editor/document-model.ts` (`p-k3f9a2x1` for live inserts; sample text may use `p-1`).
  Evidence: `replaceBlocksByIds` preserves those ids across rewrite. Review cards already store `anchor.blockIds`. The fragile part is Clarity's provider schema, which still prefers integer `blockStart`/`blockEnd`.

- Observation: `Акценти` already has sequential durable chunks and a progress stream, but partial cards stay internal until the run completes.
  Evidence: `.plans/durable-review-workflow.md` required "partial results remain internal until the run completes". `editorialReviewWorkflow` only chunk-loops when `stepId === "emphasis"`. GET `kind: "run"` currently carries progress counts, not items.

- Observation: applying any manuscript edit changes `documentRevisionId`, and the editor then refuses the whole review result as stale.
  Evidence: `isRunCompatibleWithEditor` and `applyEditorialReviewResult` in `apps/web/app/editor/page.tsx` compare the live revision to the run's `documentRevisionId`. That is incompatible with apply-while-running.

- Observation: slicing a chunk document and also re-deriving `revision` from that slice stamps cards with a chunk-local `documentRevisionId`. Terminal apply then rejects the whole result.
  Evidence: Composer-2.5 M2 review. Fix: keep the frozen snapshot revision on chunk requests and remap items with `alignReviewItemsToSnapshot`.

- Observation: `npm run test -w @orest/web` did not include `review-chunk-runtime`, `review-run-merge`, or `review-run-progress`. The suite also had a stale Luna price-label assertion (`$$` vs source `priceTier: 1` / `$`).
  Evidence: M5 closeout. Added the three files to `apps/web/package.json` and aligned the settings test with `settings.ts`.

## Decision Log

- Decision: v1 chunks by a hard 16,000 source-character budget with any number of blocks, preferring H2/H3 boundaries, not a fixed block count. A single block longer than 16k is its own chunk.
  Rationale: this is the packing rule that already made the 142k `Акценти` fixture ~10 calls instead of 41, and it matches the editor's "first 25% of the document" mental model.
  Date/Author: 2026-08-12 / user + agent

- Decision: execute chunks sequentially in document order. Do not parallelize in this plan.
  Rationale: one editor, not an RPM problem. Sequential order makes the prefix reveal honest. Parallelism would finish the tail sooner but would require buffering out-of-order results; that is a later optimization.
  Date/Author: 2026-08-12 / user + agent

- Decision: show completed prefix cards as soon as each chunk finishes, including after reload via the workflow partial stream. Browser storage still holds only the signed run reference, not chunk payloads.
  Rationale: waiting for 10 sequential calls recreates the black-box wait. Workflow already checkpoints per step; the missing piece is exposing those checkpoints to GET/poll.
  Date/Author: 2026-08-12 / user + agent

- Decision: editors may apply/prepare/reject prefix cards while the tail is running (option 2). The remaining chunks keep analyzing the frozen start snapshot. Live rebase uses `block.id` + fingerprint, not whole-document `documentRevisionId`.
  Rationale: a rewrite in paragraph 5 must not invalidate analysis of paragraph 400. Unique block ids already survive reorder; fingerprints catch content change, split, merge, and delete.
  Date/Author: 2026-08-12 / user + agent

- Decision: do not migrate block ids to UUIDs in this plan. Canonical ids are already unique. Gutter numbers stay positional labels.
  Rationale: UUID hygiene does not enable apply-while-running. The kill switch is run-level revision matching and integer provider anchors.
  Date/Author: 2026-08-12 / user + agent

- Decision: per-chunk soft density is about 4-8 strong cards per 16k, not a quota, and not the current whole-document 3-50 guide.
  Rationale: 10 chunks times 40 cards would flood the drawer.
  Date/Author: 2026-08-12 / user + agent

- Decision: a failed chunk after bounded retries becomes a hole. Keep the prefix, continue later chunks, and offer `Повторити цей фрагмент` as a scoped preserve rerun of that fragment's core ids.
  Rationale: all-or-nothing abort is what the 140k Clarity screenshot already feels like. Prefix work must survive a single Sol timeout.
  Date/Author: 2026-08-12 / user + agent

- Decision: progress copy is `Розібрано початок розділу · N з M фрагментів`. The bar is character-weighted. In-flight track is blue/neutral; completed prefix fill is teal (`#0f766e`), not manuscript apply-highlight green.
  Rationale: agreed UX. Apply-highlight green during work would look like accepted edits.
  Date/Author: 2026-08-12 / user + agent

- Decision: this plan's primary user-facing target is `clarity`. The same engine must also run `structure`, `interest`, `visuals`, `formatting`, `final_editing`, and incremental reveal for `emphasis`. `diagnostics` and `fact_check` stay whole-document in this plan.
  Rationale: the screenshot is Clarity, but the monolith timeout is shared by every recommendation-card step. Diagnostics is a macro chapter diagnosis and needs a separate design. Fact-check is a grounded table, not local cards.
  Date/Author: 2026-08-12 / agent (scope boundary; user can widen later)

## Outcomes & Retrospective

On a ~140k-symbol chapter, `Ясність` and the other recommendation-card steps now run as sequential 16k character chunks instead of one 280s provider call. The editor sees prefix cards and a character-weighted bar (`Розібрано початок розділу · N з M фрагментів`) while the tail still runs, can apply those cards without cancelling the run, and keeps prefix work if a later fragment times out. Abort text is a localized timeout.

Still monolithic: `Діагностика` and `Перевірка фактів`. Sequential wall-clock for ~10 chunks is the accepted tradeoff versus a single abort; parallelism is out of scope.

Residual risks: fragment retry while a parent run is in flight is disabled; a 1-chunk retry run temporarily replaces header progress with `1 з 1`; missing `snapshotBlockIds` on pre-M3 persisted drafts falls back to “any non-empty manuscript.”

## Context and Orientation

Written at plan start. Shipped behavior is in Outcomes & Retrospective and the milestone Done sections.

The product is a web-only Next.js app in `apps/web`. There is no application database. Editorial review starts a Vercel Workflow from `POST /api/edit/review` (`apps/web/app/api/edit/review/route.ts`, `maxDuration = 300`) and the editor polls `GET /api/edit/review?runId=...` with a signed capability header.

A recommendation card is an `EditorialReviewItem` in `apps/web/lib/editor/review-contract.ts`. It already has `anchor.blockIds`, `anchor.fingerprint`, and `status` including `stale`. `reconcileReviewItemsWithRevision` marks a card stale when ids do not resolve or the fingerprint no longer matches live text.

A chunk is a contiguous pack of manuscript blocks whose core source text is at most 16,000 characters, plus at most one context-only neighbor block on each side. Core blocks are owned by exactly one chunk. Context blocks may overlap and must not emit cards.

A frozen snapshot is the `EditorialReviewRequest.document` captured when the workflow starts. Later chunks must slice that snapshot, not the editor's live document after applies.

A hole is a chunk that exhausted retries without a valid item list. The run may still complete. Progress must list failed chunk indexes and their core block ids so the UI can retry that range.

Key files (at plan start; shipped names in milestone Done):

- `apps/web/lib/server/review-chunk-planner.ts` — shared 12-16k heading-aware planner; `planEmphasisChunks` is a wrapper.
- `apps/web/lib/server/editorial-review-workflow.ts` — recommendation-card steps enter the sequential chunk loop.
- `apps/web/lib/server/review-service.ts` — 280s `AbortController`; per-chunk density; localized abort timeout.
- `apps/web/app/editor/page.tsx` — start/poll/prefix merge; apply-while-running rebase.
- `apps/web/lib/editor/review-run-persistence.ts` — compatibility is locale plus snapshot-block overlap, not equal `documentRevisionId`.
- `apps/web/lib/i18n/editor-messages/uk.ts` — progress copy `Розібрано початок розділу · N з M фрагментів`.

Out of scope for this plan: UUID block-id migration; parallel chunk workers; chunking diagnostics or fact-check; cross-device run recovery; raising the 280s timeout as the primary fix; inventing fallback cards when a provider fails.

Known leftover risk: `Діагностика` and `Перевірка фактів` remain one-shot on 140k and can still abort. Record that explicitly in CURRENT_STATE when this plan ships; do not silently claim all eight steps are safe.

## Plan of Work

Start in the planner and contracts so UI work has a stable payload. Generalize `planEmphasisChunks` into a shared `planReviewChunks` (keep the old name as a thin wrapper if that reduces churn). Eligible blocks for recommendation steps are text-bearing blocks used by that step's allowlist; headings should participate as section boundaries even when they are not card targets. Keep `maxSourceChars = 16_000`, `minSourceChars = 12_000`, `targetSourceChars = 14_000`. Drop or raise the 80-block cap so packing is character-first; keep a high safety cap only for pathological tiny-block imports.

Extend `EditorialReviewRequest` with a generic chunk scope (reuse `emphasisChunk` or rename to `reviewChunk` with `index`, `total`, `coreBlockIds`, `contextBlockIds`). `buildAutomaticCardDensityGuidance` must use the chunk's blocks when a chunk scope is present, with a soft 4-8 target and a hard local ceiling well below 50.

Update OpenAI/Gemini/Anthropic recommendation schemas and prompt scaffold so Clarity-like steps ask for `blockId` (the bracketed id in the prompt line) and treat `blockStart` as fallback. Normalization must map through the chunk document's real ids, then the merge step must keep only core-owned cards, in global block order, deduped by `blockIds` + `recommendationType`.

In `editorialReviewWorkflow`, any step whose `outputKind` is recommendation cards (including `emphasis` and `final_editing`) uses the chunk loop. After each successful chunk step, write progress (`completedChunks`, `totalChunks`, `completedSourceChars`, `totalSourceChars`, `failedChunks`) and append items to a `review-partial-items` workflow readable. GET already tails `review-progress`; it must also return accumulated partial items on `kind: "run"` without waiting for workflow completion.

Chunk error policy: retryable provider/timeout/network errors retry that chunk with the existing bounded backoff. After retries are exhausted, or on invalid output for that chunk, record a hole and continue. Missing API key or auth failure is fatal for the whole run, but already-streamed prefix items remain readable. `generateEditorialReview` must map `AbortError` through `getReviewServiceErrors` timeout copy, matching `patch-service.ts`.

Do not inject the full diagnostics markdown into every chunk. If downstream context is required, pass a short truncated summary once per chunk or omit it for chunked Clarity; repeating a long diagnostics essay ten times recreates timeout risk.

On the client, when a `replace` run returns 202, clear that step's cards immediately and show the empty-running state. Each poll that carries new partial items should rebase and append in document order, without requiring `currentRevisionRef === run.documentRevisionId`. Compatibility for resume becomes: same locale, same `runId`/capability, manuscript still contains enough of the snapshot's block ids to be the same document identity (not a cleared/replaced manuscript). A full `Очистити` or file import still stale-cancels the run.

`applyEditorialReviewResult` should split into a partial merge path used during `running` and a terminal path that records history once. Prefix apply uses the existing proposal/apply pipeline; it mutates the live document and fingerprints. Arriving tail cards call `reconcileReviewItemsWithRevision` against live state.

UI: put the bar in the active step drawer header near the existing status pill. Percent = completed core chars / total core chars, including holes as not-completed. Copy uses fragment counts as agreed. Retry sends `POST /api/edit/review` with `runMode: "preserve"`, `stepId` unchanged, and a document sliced to that hole's core blocks plus context, or an explicit `retryChunk` scope. It must not clear already-accepted or still-valid prefix cards.

Finally update handoff docs and run the verification commands from the workspace root with `-w @orest/web`.

## Concrete Steps

Working directory for all commands: `C:\Projects\oboz-ai\orest-edit`.

After Milestone 1:

    npm run typecheck -w @orest/web
    node --import tsx --test apps/web/test/emphasis-chunk-planner.test.ts apps/web/test/review-contract.test.ts apps/web/test/review-service.test.ts

Expect the existing fixture test to keep ~9-12 chunks, plus new assertions for recommendation-step packing and per-chunk density.

After Milestone 2:

    node --import tsx --test apps/web/test/editorial-review-workflow.test.ts apps/web/test/review-route.test.ts apps/web/test/review-service.test.ts

Expect a running GET envelope to include partial items, and an abort to produce a timeout message.

After Milestone 3:

    node --import tsx --test apps/web/test/review-run-persistence.test.ts apps/web/test/review-contract.test.ts

Expect `isRunCompatibleWithEditor` to remain true after a live revision change for the same run, and stale status only on cards whose fingerprint diverged.

After Milestone 4-5:

    npm run typecheck -w @orest/web
    npm run test -w @orest/web
    npm run build -w @orest/web

Expect all three to pass. Do not take screenshots unless explicitly requested. Runtime provider smoke on a large non-sensitive fixture is optional and must be recorded here when authorized.

## Validation and Acceptance

The change is done when all of the following are true.

A 140k-symbol Clarity run no longer depends on one 280s provider call. It creates about ten sequential durable chunks.

While the run is in progress, the drawer shows prefix cards for finished fragments and a character-weighted bar with `Розібрано початок розділу · N з M фрагментів`.

The editor can open, prepare, apply, or reject a prefix `simplify`/`rewrite` card before the tail finishes. Applying it does not cancel polling and does not stale unrelated later cards.

If fragment 3 fails after retries, fragments 1-2 stay visible, the bar shows a hole, later fragments still run, and `Повторити цей фрагмент` can refill only that hole in preserve mode.

Provider abort text is a localized timeout, never `This operation was aborted`.

`diagnostics` and `fact_check` are documented as still monolithic.

Commands that must pass: `npm run typecheck -w @orest/web`, `npm run test -w @orest/web`, `npm run build -w @orest/web`.

## Idempotence and Recovery

Planner and merge functions must be pure: same blocks in, same chunks and same core ownership out. Workflow step identity stays stable so a retried chunk does not duplicate cards; merge dedupes by `blockIds` + `recommendationType`.

If implementation lands halfway, the old monolith path may remain for unmigrated steps. Ship behind the chunk loop only for steps whose planner coverage tests pass. Do not leave Clarity on the monolith once its loop exists.

Reload mid-run reconnects through the existing signed capability and must re-read the partial item stream, not a browser copy of cards. Clearing site data still loses recovery, as today.

A scoped fragment retry is a new workflow run in preserve mode. It must not use `replace` and must not clear prefix cards.

Rollback is reverting this plan's files; there is no database migration. Block id format is unchanged, so drafts remain readable.

## Artifacts and Notes

Current abort path (must disappear from user-facing Clarity errors):

    reviewRequestTimeoutMs = 280000
    setTimeout(() => controller.abort(), reviewRequestTimeoutMs)
    error: error instanceof Error ? error.message : ...

Current whole-run kill switch (must not apply to in-flight prefix apply):

    isRunCompatibleWithEditor: run.documentRevisionId === live.documentRevisionId
    applyEditorialReviewResult: live revision !== sourceRevisionId -> reviewRunStale

Target progress payload shape (names may be adjusted, fields must exist):

    completedChunks, totalChunks
    completedSourceChars, totalSourceChars
    failedChunks: [{ index, coreBlockIds, message }]
    items: EditorialReviewItem[]  // accumulated successful prefix, on kind:"run"

## Interfaces and Dependencies

No new npm dependencies. Reuse `workflow` `getWritable` / `getReadable` the way `review-progress` already works.

Planner (final names may wrap the current emphasis exports):

    planReviewChunks(blocks, options?) -> ReviewChunkPlan[]
    ReviewChunkPlan: index, startBlockIndex, endBlockIndex, sourceChars, coreBlockIds, contextBlockIds, blocks

Progress:

    EditorialReviewRunProgress gains completedSourceChars, totalSourceChars, and failedChunks.
    Running GET responses expose accumulated items for the active step.

Compatibility:

    isRunCompatibleWithEditor no longer requires equal documentRevisionId for an in-flight run of the same locale and runId. It must still reject a different locale, a different step, or a replaced/cleared manuscript.

Retry:

    A hole retry request is a normal EditorialReviewRequest with runMode "preserve", the same stepId, and a document/chunk scope limited to that hole's core ids plus context.

UI copy keys live in `apps/web/lib/i18n/editor-messages/uk.ts` and `en.ts`, not as inline Ukrainian/English strings in components.
