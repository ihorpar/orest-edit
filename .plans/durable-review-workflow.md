# Plan: Durable editorial review execution

This is the living source of truth for replacing the fragile in-memory editorial review queue and optimizing the `Акценти` workload. It follows `PLANS.md` and the global `plan-build` workflow. Keep progress, decisions, findings, validation evidence, and scope changes in this file.

## Why / Context

Production editorial review runs currently fail for three related reasons: review jobs live only in a process-local `globalThis` Map, the browser can misread a job/error envelope as a finished review response, and the `Акценти` step divides a roughly 143,000-character manuscript into 41 sequential provider calls. The desired outcome is durable progress that survives Vercel instance recycling, browser reloads, navigation to another same-origin tab, and closing/reopening the browser, without adding a database the team must provision or operate. The solution must remain patch-first and diff-first, preserve document-revision safety, and fail loudly on real provider errors rather than inventing fallback AI output.

This plan covers `/api/edit/review` and the editor's review polling/resume path. The structurally similar review-image job queue is intentionally excluded from the first cut to keep the migration small; it may reuse the resulting adapter in a follow-up. Cross-device recovery and recovery after clearing browser site data are also excluded unless the user expands scope, because those require an account-linked server-side run index.

## Current State

- Status: Active
- Current milestone: 5 - Cut over safely and close operational gaps
- Next action: Deploy the current change set to Vercel and run the production cross-instance/closed-client smoke test when deployment is authorized.
- Blocker: Production smoke validation requires a deployed revision and was not authorized as part of this implementation request.
- Repository state at planning time: `master` is clean and matches `origin/master`.
- `apps/web/lib/server/review-job-service.ts` stores jobs in `globalThis.__orestEditorialReviewJobs`, so POST and GET requests handled by different Vercel instances cannot share job state.
- `apps/web/app/api/edit/review/route.ts` returns an in-memory job envelope and starts work with Next.js `after()` under `maxDuration = 300`.
- `apps/web/app/editor/page.tsx` decides whether to poll from HTTP status `202`, then checks `payload.stepId` before fully validating the response shape; this can mask the original server error as `undefined`.
- `apps/web/lib/editor/draft-state.ts` already persists the editor draft in locale-scoped `localStorage`; durable-run metadata can extend this existing mechanism without introducing IndexedDB.
- `Акценти` currently packs 18 blocks with two-block overlap. A reconstruction using the screenshot's 142,870 characters and approximately 650 blocks produced 41 requests averaging about 8,280 prompt characters each, including about 4,300 repeated instruction characters.
- The older `docs/plans/EXECPLAN_MULTI_STEP_EDITORIAL_REVIEW_WORKFLOW.md` describes the broader review UX and is not reopened by this reliability repair.

## Definition of Done

- [x] Required behavior: starting an editorial review returns a durable run identifier, and processing continues independently of the initiating HTTP request when closed-tab continuation is approved.
- [x] Required behavior: reloading `/editor`, opening another same-origin app tab, or closing and later reopening the browser reconnects to the active run and restores honest progress/result/error state.
- [x] Required behavior: results are accepted only for the exact `documentRevisionId`, locale, step, provider, model, and run mode that started the run; changed manuscripts mark old results stale and never auto-apply them.
- [x] Required behavior: no editorial review job depends on a process-local Map, and a status request handled by another process can still read the run.
- [x] Required behavior: every API response is a validated discriminated result (`run`, `result`, or `error`); missing fields never render JavaScript `undefined` to users.
- [x] Required behavior: `Акценти` uses section-aware size budgeting rather than a fixed 18-block chunk, targeting 12,000-16,000 source characters, no more than 60-80 eligible blocks, and at most one context-only block on each boundary.
- [x] Required behavior: the 142,870-character/approximately 650-block regression fixture produces approximately 9-12 chunks instead of 41, without losing block coverage or emitting duplicate boundary suggestions.
- [x] Required behavior: completed chunks remain durable; retryable 408/429/transient 5xx/high-demand/network/timeout failures retry only the failed chunk with bounded backoff, while auth/schema/invalid-output errors fail loudly and do not retry indefinitely.
- [x] Required behavior: progress reports completed/total chunks and the current retry state; partial results remain internal until the run completes, unless scope is explicitly changed.
- [x] Verification: targeted contract, route, persistence, chunking, retry, merge, stale-revision, reload, and cross-process tests pass; `npm run typecheck -w @orest/web`, `npm test -w @orest/web`, `npm run build -w @orest/web`, and `git diff --check` pass. `npm run check:text` must not gain new failures; its unrelated baseline failures are recorded below and may be cleaned up separately.
- [ ] Verification: a deployment smoke run proves that one process can start a review, another can read it, closing the initiating client does not cancel it, and the final result can be recovered without screenshots or unrequested browser automation.
- [x] Scope closure: remove the in-memory review job implementation and misleading queue-expiry copy, update `docs/CURRENT_STATE.md`, `docs/DECISIONS_LOG.md`, and `docs/DEPLOYMENT.md`, and document workflow data retention, cost, observability, and rollback behavior.

## Milestone 1 - Confirm the durable execution boundary

Status: Complete.

Done: Root-cause tracing, workload measurement, and the recommended managed-workflow boundary are documented.

Remaining: None. Production ownership/capability binding is intentionally implemented in Milestone 2 rather than copied from the development-only spike.

Proof: User decisions recorded in this plan plus a passing minimal start/step/status/output spike and captured retention/retry findings.

- [x] 1.1 Confirm whether a run must continue while every browser tab is closed, or whether preserving completed chunks and resuming on reopen is sufficient. Decision: continue while closed.
- [x] 1.2 Confirm that Vercel Workflow is acceptable as managed persistence and that manuscript chunks/provider outputs may be stored in its event history under the project's retention settings. Decision: accepted for this implementation, subject to the spike documenting retention behavior.
- [x] 1.3 Confirm that same-browser recovery is sufficient and that cross-device/account-linked run discovery remains out of scope. Decision: same-browser recovery is sufficient for this version.
- [x] 1.4 Build a minimal compatibility spike using the current Next.js 15.5 app: start one workflow, execute one durable step, read status/output by run ID from an authenticated route, and verify local build behavior. Evidence: local authenticated POST returned a non-empty `wrun_*` identifier in `pending`, authenticated GET advanced to `completed`, and returned `{ value: "workflow-compatible", durableStepCompleted: true }`.
- [x] 1.5 Verify: record the exact Workflow SDK package/configuration, run-state API, retry controls, retention behavior, plan availability, and observed build/test output in this plan before production code is designed around it. Evidence: `workflow@4.8.0`, `withWorkflow(nextConfig)`, generated flow/step/webhook routes, `start()` plus `getRun()`/`exists`/`status`/`returnValue`, three default step retries, `RetryableError.retryAfter`, `FatalError`, and `getStepMetadata().attempt`. Workflow is available with included usage on Vercel plans and uses managed Vercel storage/queues/OIDC; exact run-retention duration is platform-managed and not published as a configurable guarantee, so the product must handle an unavailable old run honestly and must not describe Workflow as permanent archival storage.

## Milestone 2 - Replace the in-memory queue with a durable review run

Status: Complete.

Done: Durable contracts, capability-bound start/status routes, typed provider failures, editor consumption, and local transport proof.

Remaining: Production cross-instance/instance-kill smoke validation is deferred to Milestone 5 because the local World is not the managed Vercel persistence backend.

Proof: Local durable start/status transport, generated production Workflow handlers, removal of active production dependence on `globalThis`, and explicit managed-Vercel cross-instance proof retained in Milestone 5.

- [x] 2.1 Added discriminated start/status/result/error contracts, effective locale and immutable run identity, plus a signed same-browser capability. Status/result reads require app auth and the capability; the capability travels in a header rather than URLs/logs.
- [x] 2.2 Implemented a durable editorial-review workflow whose input is an immutable review request and whose output is the normalized `EditorialReviewResponse` contract.
- [x] 2.3 Replaced the active `globalThis` Map/`after()` route path with Workflow start/status handling; retained `async: false` only as a diagnostic path and removed the temporary compatibility route.
- [x] 2.4 Workflow commits one returned result per step, so replay cannot duplicate merged UI suggestions or corrupt progress. Residual boundary: a model provider may receive a duplicate request if a worker dies after provider acceptance but before the step result commits; Milestone 3 adds deterministic chunk identities and provider idempotency keys where supported, but exactly-once external billing cannot be guaranteed without provider cooperation.
- [x] 2.5 Preserved status, request ID, retryability, and `Retry-After` for standard provider and grounded Gemini HTTP failures; network and timeout categories are typed.
- [x] 2.6 Exercised the real local transport: authenticated POST returned a signed capability and `pending`; authenticated GET in another request reached a terminal typed result for an intentionally empty document without a provider call. True Vercel cross-instance/instance-kill proof remains mandatory in Milestone 5.

## Milestone 3 - Optimize `Акценти` chunking and retries

Status: Complete.

Done: Replaced fixed block chunks with a deterministic section-aware planner, one Workflow step per provider chunk, typed bounded retries, progress streaming, and context-safe deterministic merge.

Remaining: None. Exactly-once external provider billing remains outside the provider contracts; stable Workflow step identity and OpenAI request correlation are used where supported.

Proof: The representative 142,870-character/650-block fixture produces approximately 10 chunks; focused planner/service/workflow tests pass, the local runtime exposed 0/3 progress and a typed fatal failure, typecheck/build pass, and the fresh milestone reviewer confirmed the one-provider-call checkpoint boundary after the fix.

- [x] 3.1 Extracted a deterministic chunk planner grouped by heading boundaries, 12,000-16,000 source-character budget, 80 eligible-block cap, and one context-only block per edge.
- [x] 3.2 Added a complete core-block coverage map and tests proving every eligible block is owned exactly once even when context overlaps.
- [x] 3.3 Executes every non-empty emphasis plan sequentially as one durable Workflow step per chunk; workflow-owned chunks explicitly bypass the service's local rechunk/retry loop.
- [x] 3.4 Typed 408/429/5xx/network/timeout failures retry with bounded exponential backoff, deterministic jitter, and `Retry-After`; progress contains actual attempt/retry time, while non-retryable output/auth failures are fatal.
- [x] 3.5 Workflow checkpoints normalized per-chunk responses and merges only core output in deterministic global block order, with duplicate boundary targets removed.
- [x] 3.6 Verified short/oversized/non-text/heading/650-block fixtures, transient and invalid-output behavior, provider failure parsing, context deduplication, real local progress/fatal transport, typecheck, production build, and fresh milestone review.

## Milestone 4 - Resume runs across reloads and tabs

Status: Complete.

Done: Active-run persistence, hydration recovery, exclusive start/poll coordination, strict runtime envelopes, stale-revision guards, cross-tab state refresh, and terminal cleanup are implemented.

Remaining: None. Recovery remains intentionally same-browser and requires intact site data.

Proof: Draft round-trip, compatibility/staleness, poll lease/handoff, exclusive Web Lock ordering, malformed envelope/item rejection, auth-envelope, route, and full 244-test suite pass; typecheck/build pass and a fresh reviewer confirmed the race fixes.

- [x] 4.1 Extended `PersistedEditorDraftState` with a validated small run/capability/status record; browser storage contains no chunk or provider output copy.
- [x] 4.2 Hydration reconnects pending/running work and can recover a terminal success before cleanup; duplicate start checks run both before and inside the start lock.
- [x] 4.3 Storage events synchronize progress/result state, a renewable per-run lease hands polling between tabs, and an origin-wide exclusive Web Lock serializes recheck + POST + synchronous persistence.
- [x] 4.4 Every run/result/error response is runtime validated, including item, fact-check, progress, and consumed diagnostics shapes; original auth/provider/workflow messages surface before identity checks.
- [x] 4.5 Result application requires the exact revision, locale, step, provider, model, and run mode; changed manuscripts mark the retained record stale and never apply its result.
- [x] 4.6 Verified draft reload/close-reopen primitives, lease handoff, exclusive start ordering, locale/revision compatibility, discriminated auth failure, malformed result rejection, terminal success/error cleanup, full tests, typecheck, build, and fresh milestone review.

## Milestone 5 - Cut over safely and close operational gaps

Status: Implementation complete; production smoke pending.

Done: The legacy queue is removed, durable-run tests and structured run/step/outcome logs are in place, user-facing copy and operational documentation are updated, and local tests/typecheck/build validation passes.

Remaining: Deploy the change set and prove managed-Vercel cross-instance recovery plus closed-client continuation with a non-sensitive production fixture.

Proof: No active review Map reference remains; the full 246-test suite, typecheck, production build (8 durable steps/1 workflow), and `git diff --check` pass. `check:text` contains only the documented repository baseline. Managed-production recovery is not yet claimed.

- [x] 5.1 Remove `apps/web/lib/server/review-job-service.ts`, its `globalThis` state, and tests that prove only same-process behavior; replace them with durable-run tests.
- [x] 5.2 Add structured logs keyed by workflow run ID, review request ID, step, provider/model, chunk index, attempt, duration, provider status, and final outcome without logging API keys.
- [x] 5.3 Replace "queue not found or expired" copy with precise run-not-found, unauthorized, stale, retrying, incomplete, and provider-failure messages in Ukrainian and English.
- [x] 5.4 Update deployment and handoff documentation, including managed workflow persistence, data retention, usage-based cost, operational inspection, rollback, and the intentionally deferred review-image queue.
- [ ] 5.5 Run the full verification commands and a production smoke test using a large non-sensitive fixture; record exact evidence and any provider request IDs here.
- [ ] 5.6 Verify: no active review code references `__orestEditorialReviewJobs`; production can recover one completed run after the initiating tab and function instance are gone.

## Progress

- [x] (2026-08-04) Traced the production errors to provider overload handling, process-local job state, response-envelope masking, and over-fragmented emphasis chunking.
- [x] (2026-08-04) Measured a representative 142,870-character/650-block emphasis run through the current prompt builder: 41 chunks, approximately 8,280 prompt characters per full request, and approximately 4,300 repeated instruction characters per request.
- [x] (2026-08-04) Confirmed that editor draft state already uses locale-scoped `localStorage`, so only a durable run reference needs new client persistence.
- [x] (2026-08-04) Reviewed the existing multi-step workflow plan and kept this reliability initiative independent.
- [x] (2026-08-04) Re-read the new plan and ran `git diff --check` successfully; captured the pre-existing repository-wide text-integrity failures without modifying unrelated files.
- [x] (2026-08-04) Applied the plan's recommended defaults after the user authorized implementation: continue with tabs closed, use Vercel Workflow managed persistence, and keep recovery same-browser only.
- [x] (2026-08-04) Added `workflow@4.8.0`, configured the Next.js integration, excluded generated Workflow handlers from auth middleware, and externalized `xdg-app-paths` to avoid a Windows production-build bundling failure.
- [x] (2026-08-04) Proved the authenticated local start/status/output path: one run advanced from `pending` to `completed` and returned the exact durable-step output; `npm run typecheck -w @orest/web` and `npm run build -w @orest/web` passed.
- [x] (2026-08-04) Reviewed Milestone 1 with a fresh agent. Accepted: record missing proof, guard the spike from production triggering, and require a browser-scoped capability in Milestone 2. Rejected as already satisfied by recorded runtime evidence: adding a second automated transport test solely for the temporary spike route; production workflow route tests remain required in Milestone 2.
- [x] (2026-08-04) Replaced the active review `globalThis` Map/`after()` path with `editorialReviewWorkflow`, discriminated run/result/error envelopes, a production-required signing secret, capability-bound reads, typed provider failures, and runtime response validation.
- [x] (2026-08-04) Exercised the real local production workflow route without a provider call: POST returned `pending` plus run ID/capability; GET returned a completed typed error for the empty document. Targeted review tests (59), typecheck, and production build passed.
- [x] (2026-08-04) Reviewed Milestone 2 with a fresh agent. Accepted and fixed: migrated the editor off the old `jobId` protocol immediately, preserved effective locale, covered grounded Gemini metadata, kept capabilities out of URLs, and recorded transport proof. Deferred by design: same-browser duplicate-start prevention belongs with persisted active-run coordination in Milestone 4. Rejected as an impossible absolute guarantee: Workflow cannot ensure exactly-once external provider billing across a crash after provider acceptance; deterministic checkpoints/merge and provider idempotency support are the enforceable controls.
- [x] (2026-08-04) Replaced 18-block overlap with the 12,000-16,000-character/80-block planner; the representative 650-block fixture now produces approximately 10 chunks with complete one-owner core coverage.
- [x] (2026-08-04) Added sequential durable chunk steps, typed retry/fatal handling, progress streams, stable provider request identity, deterministic core-only merge, and focused workflow/merge tests. A real local run reported 0/3 attempt 1 before returning the original fatal provider state.
- [x] (2026-08-04) Reviewed Milestone 3 with a fresh agent. Accepted and fixed: workflow-owned chunks could re-enter the local rechunk loop. Closed at the documented provider boundary: stable Workflow step identity and OpenAI `X-Client-Request-Id` aid correlation, but current provider contracts do not guarantee request deduplication or exactly-once billing.
- [x] (2026-08-04) Persisted the signed active-run reference in the locale draft, added hydration recovery, progress display, stale-result quarantine, cross-tab storage refresh, and gated terminal cleanup.
- [x] (2026-08-04) Added one-tab polling leases and an exclusive Web Lock around active-run recheck, start POST, and synchronous persistence; this closes the two-tab duplicate-start window in supported app browsers.
- [x] (2026-08-04) Reviewed Milestone 4 with a fresh agent. Accepted and fixed: start serialization, failed-terminal cleanup, deep result validation, and auth failure normalization. Full web tests (244), typecheck, and production build passed before the review; 21 focused tests and typecheck passed after the final fixes.
- [x] (2026-08-04) Removed the legacy review queue implementation/test and all active `__orestEditorialReviewJobs` references; added durable workflow, capability, persistence, route, and coordination coverage instead.
- [x] (2026-08-04) Added structured API/workflow logs without manuscript content, API keys, or capabilities. Workflow step and terminal outcome events now include the Workflow run ID independently of client polling; provider request/status and chunk/attempt metadata are emitted where available.
- [x] (2026-08-04) Replaced misleading queue-expiry and English-heavy run copy, updated `docs/CURRENT_STATE.md`, `docs/DECISIONS_LOG.md`, and `docs/DEPLOYMENT.md`, and documented retention, cost, inspection, rollback, signing-secret, and deferred image-queue behavior.
- [x] (2026-08-04) Completed local Milestone 5 validation: 246 tests, typecheck, production build (8 steps/1 workflow), and `git diff --check` pass. `npm run check:text` reports only the recorded baseline after generated Workflow handlers were excluded from text-integrity scanning.
- [x] (2026-08-04) Reviewed Milestone 5 with a fresh agent. Accepted and fixed: terminal workflow outcome logs must not depend on a browser GET, every workflow event needs its run ID, and two remaining Ukrainian fallbacks must not expose English `review` wording. The reviewer confirmed no other actionable local closure issue.
- [ ] Run the managed-production cross-instance/closed-client smoke after deployment authorization; do not mark Milestone 5 or the plan complete until this evidence is recorded.

## Surprises & Discoveries

- Finding: the current deployment guide already warns that the in-memory review queue can disappear on Vercel recycle. Evidence/impact: this is a known architectural limitation now reached in ordinary production usage, not a rare TTL edge case.
- Finding: the current route tests enqueue and read jobs in the same Node process. Evidence/impact: 38 targeted review tests pass while the production cross-instance failure remains untested.
- Finding: the UI draft is stored in `localStorage`, not IndexedDB. Evidence/impact: use the existing draft migration/sanitization path for tiny run metadata; introducing another browser store would add unnecessary complexity.
- Finding: fixed prompt text is repeated enough that 41 small chunks send more instruction characters than the original manuscript contains. Evidence/impact: reducing round trips improves reliability, latency, and cost without approaching model context limits aggressively.
- Finding: the current retry formatter reports the configured maximum of three attempts even when a high-demand error is classified as non-retryable after the first call. Evidence/impact: retries must be based on typed status and diagnostics must report actual attempts.
- Finding: `npm run check:text` already fails on unrelated tracked CRLF/BOM/missing-newline issues, including the current editor/review service and generated evaluation artifacts. Evidence/impact: compare against this 2026-08-04 baseline and do not normalize unrelated files as part of the reliability patch; `git diff --check` passed for this plan.
- Finding: Workflow's generated internal requests were initially consumed by the repository middleware, leaving local runs pending with a detached `ArrayBuffer` transport failure. Evidence/impact: `/.well-known/workflow/*` must remain outside the middleware matcher; after exclusion, the same start/status spike completed.
- Finding: the Workflow SDK's Vercel OIDC dependency reaches `xdg-app-paths`, which Next bundled with an empty `process.argv` during Windows page-data collection. Evidence/impact: keeping `xdg-app-paths` in `serverExternalPackages` made the production build pass without patching dependencies.
- Finding: Vercel Workflow run retention is managed by the platform and no configurable exact duration was found in the current official Workflow documentation. Evidence/impact: active and recent run recovery is the supported product promise; old missing runs must fail clearly, and permanent history would require a separate durable store later.
- Finding: a Workflow-owned chunk originally called the general emphasis service, which could re-plan boundary context into nested non-durable calls. Evidence/impact: `emphasisChunk` now forces exactly one provider call, leaving Workflow as the sole owner of chunk retries and checkpoints.
- Finding: current OpenAI Responses, Gemini generateContent, and Anthropic Messages contracts do not document an idempotency mechanism that guarantees request deduplication. Evidence/impact: use a stable Workflow step key and supported OpenAI client request correlation, but retain the honest crash-after-provider-acceptance billing boundary.
- Finding: a polling-only lease cannot prevent two tabs from issuing start POSTs in the same pre-persistence window. Evidence/impact: the supported browser path now uses an exclusive same-origin Web Lock that holds through recheck, POST, and synchronous run-record persistence.
- Finding: generic auth middleware responses violated the review route's new discriminated contract. Evidence/impact: both review methods now normalize 401/5xx auth failures so recovery shows the original message and preserves a 401 run for post-login continuation.
- Finding: terminal workflow completion/failure originally became observable only when a browser later polled the status route. Evidence/impact: a final durable outcome step now logs completion or failure with the Workflow run ID, so abandoned/closed-browser runs remain operationally diagnosable.

## Key Decisions & Unexpected Findings

- Decision: use Vercel Workflow as the durable execution layer rather than a user-operated database or low-level queue. Reason: the work is stateful and multi-step, and managed workflow persistence is the smallest architecture that can continue after the browser and initiating function disappear. Date/author: 2026-08-04 / user authorization applied to recommended defaults.
- Decision: recovery is guaranteed only within the same browser profile through the persisted run ID. Reason: cross-device discovery requires durable user identity and a server-side run index, which conflicts with the lean/no-database goal. Date/author: 2026-08-04 / user authorization applied to recommended defaults.
- Decision: reuse the existing locale-scoped editor draft `localStorage` for active-run metadata. Reason: the record is small and already participates in draft migration, reset, and locale behavior.
- Decision: target 12,000-16,000 source characters and 60-80 eligible blocks per emphasis chunk, with context-only boundaries. Reason: this should reduce the measured large manuscript from 41 calls to about 9-12 while keeping structured output bounded.
- Decision: persist partial chunk results but expose only progress until the merged run is complete. Reason: the editor should not present an incomplete set of accents as a successful final analysis; a failed run may offer explicit retry/resume rather than synthetic fallback.
- Decision: keep review-image jobs outside the initial migration. Reason: the reported failures are editorial review failures, and migrating one workflow first limits risk; the durable adapter should be reusable later.
- Decision: the compatibility route is development-only and must be removed after the production review route replaces it. Reason: leaving an unconditional authenticated Workflow trigger deployed would permit pointless queue/storage consumption and would establish an unsafe ownership pattern.
- Decision: production status/result reads require a browser-held capability in addition to the shared app session and run ID. Reason: an authenticated user who learns another run ID must not be able to retrieve that manuscript output.
- Decision: execute emphasis chunks sequentially for the first durable release. Reason: it keeps provider pressure bounded and makes progress/retry behavior simple; two-wide batches are unnecessary to meet the measured 41-to-10 request reduction.
- Decision: clear successful run metadata only after the result step is present in persisted editor history; clear failed/cancelled/provider-error terminal records immediately after surfacing the error. Reason: this preserves close-at-completion recovery without re-polling dead terminal failures on every reopen.

## Idempotence and Recovery

Workflow input must be immutable and keyed by run ID plus document revision. Chunk steps must produce deterministic outputs for one chunk identity, and merge must sort/deduplicate by global block and exact emphasis target so an at-least-once retry cannot duplicate suggestions. Starting a new run for the same step must either reconnect to the matching active run or explicitly supersede it; it must not silently launch two billable copies from separate tabs.

A failed retryable chunk remains resumable from its last durable checkpoint. A fatal provider/schema/auth error terminates the run with the original details and preserves completed internal checkpoints for diagnosis, but the UI must not label the overall review complete. Rollback should restore the previous synchronous diagnostic path only for short/manual debugging; it must not re-enable the process-local production queue.

## Validation Commands

Run from `C:\Projects\oboz-ai\orest-edit`:

    node --import tsx --test apps/web/test/review-service.test.ts apps/web/test/review-route.test.ts
    npm run typecheck -w @orest/web
    npm test -w @orest/web
    npm run check:text
    npm run build -w @orest/web

Add targeted test files/commands for the workflow adapter, chunk planner, browser run persistence, and isolated-process start/status integration as their filenames stabilize. Runtime validation must not use Chrome/Edge or capture screenshots unless the user explicitly requests it.

At plan creation, `npm run check:text` reported only pre-existing failures in `.vercel/project.json`, selected editor/style/review source files, generated evaluation reports, SVG assets, and `tmp/*.json`; it reported no failure for this plan. Treat that output as baseline unless a separate cleanup is authorized.

## Completion Summary

Not complete. Local implementation and verification are complete, but managed-production cross-instance and closed-tab recovery evidence remains required. At completion, summarize the durable execution mechanism, measured chunk-count/latency change, cross-instance and closed-tab recovery evidence, provider retry behavior, full test/build results, deployment smoke evidence, and anything intentionally deferred.
