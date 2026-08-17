# Custom Request Plan Then Generate

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

This plan supersedes the failed regex card-quota approach and the soft “0–2 cards per fragment” mitigation for `Власний запит` (`final_editing`). Chunked waves of 3 from `docs/plans/EXECPLAN_PARALLEL_REVIEW_CHUNKS.md` remain for other recommendation steps (`clarity`, `formatting`, and so on). This plan changes only how **custom-request** runs produce cards on large manuscripts.

## Purpose / Big Picture

Today `Власний запит` reuses the same 16k fragment engine as Clarity. The editor’s free-text request is copied into every fragment. A request like “propose 10 callouts” is therefore attempted ten times per fragment. Soft prompt wording cannot guarantee a chapter total, and parsing numbers out of Ukrainian/English prose is unsafe (misspellings, “пункт 10”, “топ 5”).

After this plan ships, a custom-request run on a long chapter:

1. builds one **chapter-level action plan** (anchors + recommendation types) from an outline-oriented view of the manuscript plus the free-text request;
2. **generates** executable recommendation cards only for those planned anchors (in parallel waves of 3);
3. streams cards as generate steps finish, without requiring a regex-extracted quota.

Requests may ask for callouts, lists, rewrites, subsections, visuals, or a mix. They may name a count or name none. When no count is given, the planner chooses a bounded set of strong local actions. Exact “always N cards” is out of scope unless a later UI count field is added; this plan does not add that field.

## Milestones

### Milestone 1: Chapter-level action plan for `final_editing`

Status: Complete.

Done:

- Strict plan contract + `normalizeCustomRequestPlan` in `apps/web/lib/editor/review-contract.ts` (allowlist types, unknown `blockId` drop, ceiling 20, short seeds).
- Outline + section-sample packing and plan prompts in `apps/web/lib/server/custom-request-plan.ts` + `server-prompts/review.ts`.
- Sync + durable plan entry: `createCustomRequestPlanReview` / `executeCustomRequestPlanStep`; `final_editing` removed from character-budget chunk waves.
- Planning progress copy + plan-ready editor messaging (empty cards after a valid plan are not treated as zero-result).
- Unit tests in `review-custom-request-plan.test.ts` and updated `review-service.test.ts`.

Remaining:

- None for this milestone (generate is Milestone 2).

Proof:

- `npm run typecheck -w @orest/web` and `npm run test -w @orest/web` green after M1.
- Plan-only `final_editing` returns `plan.actions` with live snapshot ids and `items: []`.

### Milestone 2: Generate cards from the plan and wire the editor

Status: Complete.

Done:

- Sync and durable generate-from-plan: waves of 3 via `REVIEW_CHUNK_CONCURRENCY`; each action becomes one card; seeds force `blockId`/type.
- Streaming partial items + `phase: "generating"` progress; failed actions are holes with preserve retry via `customRequestPlanAction`.
- Editor progress copy, planActions retained on step run history, route parses `reviewChunk` / `customRequestPlanAction`.
- Docs: CURRENT_STATE, DECISIONS_LOG, DEPLOYMENT.

Remaining:

- None for this milestone.

Proof:

- Concurrency test: 4 planned actions → max 3 in-flight generate calls.
- Plan+generate tests return cards whose types follow the plan; empty plans still fail loud.

### Milestone 3: One generate call and non-blocking poll

Status: Complete.

Done:

- Full custom-request generate is one provider call + one durable workflow step (`executeCustomRequestGenerateAllStep`), with packed local slices around planned anchors.
- GET poll reads already-written workflow stream chunks via `getTailIndex()` instead of waiting for stream close.
- Single-action `customRequestPlanAction` retry remains for missing cards.
- Tests: two provider calls for four planned actions; generate-all prompt includes every seed.

Remaining:

- None for this milestone.

Proof:

- `generateEditorialReview generates planned custom-request cards in one provider call` asserts `callCount === 2`.
- `consumeAvailableReadableBatches reads existing chunks without waiting for close`.

## Progress

- [x] (2026-08-17) Drafted this ExecPlan after rejecting regex quotas and soft per-fragment caps as insufficient for exact or stable chapter totals.
- [x] (2026-08-17) Milestone 1: chapter-level plan contract + durable plan step + plan-ready UX.
- [x] (2026-08-17) Milestone 2: generate-from-plan, editor progress, docs.
- [x] (2026-08-17) Milestone 3: one generate call for the whole plan; non-blocking GET poll.
- [x] (2026-08-17) Poll recovery: 12s client GET timeout, bury persisted run on poll/JSON/platform failure, `Зупинити` DELETE-cancels the workflow without clearing the manuscript.

## Surprises & Discoveries

- Observation: copying the custom request into each 16k fragment multiplies any absolute quantity in the prose by the fragment count. Soft “0–2 per fragment” cannot sum to a stable chapter total and will under-deliver when some fragments return 0.
- Observation: regex/NLP extraction of counts fails on Ukrainian morphology and false positives (“пункт 10”, “топ 5”, “2 врізки про топ 5”).
- Observation: M1 plan-only success with `items: []` was initially shown as “no recommendations” / zero-result in the editor until feedback and workspace status branched on `plan.actions`.
- Observation: per-action hole retry required honoring `preserve` when `customRequestPlanAction` is set, and retaining full `planActions` across single-action responses.
- Observation: production `FUNCTION_INVOCATION_TIMEOUT` on GET `review?runId=` was the poller waiting for open workflow streams to close, not the model taking 5 minutes. Per-card durable steps still made generate slower than one text pass.

## Decision Log

- Decision: `final_editing` uses plan → generate; other recommendation steps keep character-budget waves of 3.
  Rationale: only custom request systematically carries chapter-wide instructions that must not be re-executed per fragment.
  Date/Author: 2026-08-17 / user + agent

- Decision: no regex (or similar) count parsing in v1. Optional explicit UI count is deferred.
  Rationale: free-text numbers are ambiguous; plan prompt + hard ceiling handle “no number” and “has a number” without brittle extraction.
  Date/Author: 2026-08-17 / user + agent

- Decision: plan output is anchors + types + short seeds, not full deep-callout/visual payloads.
  Rationale: keeps the plan call small and fail-loud; generate reuses existing type-specific executors.
  Date/Author: 2026-08-17 / user + agent

- Decision: M1 ships plan-ready editor messaging instead of leaving empty-items as zero-result.
  Rationale: empty cards after a valid plan are expected until Milestone 2 generate.
  Date/Author: 2026-08-17 / agent (plan-implement review)

- Decision: single-action generate retries may use `runMode: preserve`; full custom-request runs stay `replace`.
  Rationale: hole retry must not clear sibling cards or fail runMode validation.
  Date/Author: 2026-08-17 / agent (plan-implement review)

- Decision: generate all planned custom-request cards in one LLM call / one durable step; GET poll must not wait for stream close.
  Rationale: N Vercel steps for N cards made a fast model feel like a 5-minute chapter scan. Custom request is two text passes: plan, then cards.
  Date/Author: 2026-08-17 / user + agent

## Outcomes & Retrospective

Shipped plan → one generate call for `final_editing`. Residual risks: weak plan anchors when outline/samples miss a good site; one generate timeout fails the whole card set (single-action retry still exists); free-text “exactly N” is still soft without a UI count field.
## Context and Orientation

Product: web-only Next.js app in `apps/web`. Editorial review starts from `POST /api/edit/review` and durable work lives in `apps/web/lib/server/editorial-review-workflow.ts`. Recommendation chunking lives in `apps/web/lib/server/review-chunk-planner.ts` and `apps/web/lib/server/review-service.ts`. Step id `final_editing` is shown as `Власний запит`. Cards are `EditorialReviewItem` in `apps/web/lib/editor/review-contract.ts`.

A **plan** is a validated list of intended local actions for one custom-request run. A **generate** step turns the whole plan into recommendation cards the editor can prepare/apply, in one provider call. A single planned action can still be regenerated on retry.

Out of scope for this plan: UI count field; changing Clarity/Formatting chunking; chunking diagnostics/fact-check; exact guaranteed N without a structured count input.
