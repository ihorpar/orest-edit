# Parallel Review Chunks And Slimmer Prompts

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

This plan continues large-document review work after `docs/plans/EXECPLAN_INCREMENTAL_CHUNKED_REVIEW.md`. That plan shipped sequential 16k chunks and explicitly deferred parallelism.

## Purpose / Big Picture

On a ~140k-character chapter, recommendation steps currently wait for about eight provider calls in a line. A fast model does not help because fragment 5 cannot start until 1–4 finish. After this change, the same chunks run in waves of three, so wall-clock tracks the slowest call in each wave rather than the sum of every call. Review prompts also stop shipping the full shared cards catalog and callout-prepare rules to steps that cannot use them, so each fragment request is smaller.

Editors still see cards as fragments finish. Cards stay sorted by manuscript order. Holes and fragment retry stay as they are. Diagnostics and fact-check stay one-shot.

## Milestones

### Milestone 1: Three-wide fragment waves

Status: Complete.

Done:

- Shared `mapInWaves` helper with `REVIEW_CHUNK_CONCURRENCY = 3` in `apps/web/lib/server/review-chunk-runtime.ts`.
- Durable workflow runs chunks with `Promise.all` in document-order waves and publishes progress after each wave.
- Sync `createChunkedRecommendationReview` and `createChunkedEmphasisReview` use the same cap.

Remaining:

- None for this milestone.

Proof:

- `mapInWaves` overlap test.
- `generateEditorialReview` four-chunk Clarity overlap test expects max in-flight 3.

### Milestone 2: Slim review prompts

Status: Complete.

Done:

- Focused allowlisted steps no longer inject `cardsPrompt`.
- Callout/subsection ballast is gated on the step allowlist.
- Deep-callout drafting rules were removed from review card generation; a short kind/depth + global/local line remains for callout steps.
- Default mixed-type `DEFAULT_CARDS_PROMPT` was shortened for `Власний запит`.

Remaining:

- None for this milestone.

Proof:

- Prompt tests: Clarity/Structure omit callout-prepare catalog; Formatting keeps a short callout job line without deep-structure drafting.

### Milestone 3: Handoff docs

Status: Complete.

Done:

- `docs/CURRENT_STATE.md`, `docs/DECISIONS_LOG.md`, and `docs/DEPLOYMENT.md` describe 3-wide waves and slimmer focused-step prompts.

Remaining:

- None for this milestone.

Proof:

- Those files.

## Progress

- [x] (2026-08-17) Drafted this plan and implemented waves + prompt slimming.
- [x] Milestone 1: 3-wide waves in workflow and sync paths.
- [x] Milestone 2: slim review prompt assembly.
- [x] Milestone 3: handoff docs.

## Surprises & Discoveries

- Observation: the production path already slices each fragment in `executeReviewChunkStep` before `generateEditorialReview`, so parallelism belongs at the chunk loop, not inside a single provider call.
- Observation: per-step `completedChunks + 1` progress writes would race inside a wave and all report 1. Progress is now published from the parent after the wave settles.

## Decision Log

- Decision: concurrency is a hard cap of 3, in document-order waves (chunks 1–3, then 4–6, then 7–8).
  Rationale: bounded provider pressure, and “start of the chapter” progress remains honest because earlier waves still finish before later ones start.
  Date/Author: 2026-08-17 / user + agent

- Decision: focused allowlisted steps do not receive `cardsPrompt`. Callout body-structure rules stay in proposal/prepare, not in review card generation.
  Rationale: the shared catalog lists every type and deep-callout drafting rules, which bloat Clarity/Structure/Visuals and slow JSON generation.
  Date/Author: 2026-08-17 / user + agent

## Outcomes & Retrospective

Recommendation-card steps now start three fragments at a time. On an 8-fragment Formatting run that previously waited 1+2+…+8, wall-clock is about three waves. Focused-step prompts no longer carry the mixed-type catalog or callout-prepare drafting rules.

Still monolithic: `Діагностика` and `Перевірка фактів`. Luna still uses high reasoning unless the editor picks Luna (low).

## Context and Orientation

Recommendation-card steps pack the manuscript with `planReviewChunks` in `apps/web/lib/server/review-chunk-planner.ts` (12–16k characters). The durable loop is `editorialReviewWorkflow` in `apps/web/lib/server/editorial-review-workflow.ts`. The debug sync loop is `createChunkedRecommendationReview` / `createChunkedEmphasisReview` in `apps/web/lib/server/review-service.ts`. Prompt assembly is `buildStepSystemPrompt` / `buildStepUserPrompt` in the same file, with copy in `apps/web/lib/i18n/server-prompts/review.ts`.
