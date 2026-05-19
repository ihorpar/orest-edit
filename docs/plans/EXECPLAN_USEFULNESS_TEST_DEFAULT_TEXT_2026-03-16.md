# Usefulness Test of AI Features on Default Manuscript

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

If PLANS.md is present in the repo, maintain this document in accordance with it and link back to it by path.

## Purpose / Big Picture
Run a practical usefulness test of all AI features in the app except image generation, using the built-in default manuscript text. The output should tell a product/editorial team which features produce genuinely helpful results, where outputs are noisy or risky, and what to improve first.

## Progress
- [x] (2026-03-16 22:57Z) Read handoff and constraints in `docs/CURRENT_STATE.md` and `AGENTS.md`.
- [x] (2026-03-16 22:58Z) Identified canonical default manuscript source in `apps/web/lib/editor/default-manuscript.ts`.
- [x] (2026-03-16 22:58Z) Identified AI feature surface and contracts from `apps/web/lib/server/review-service.ts` and `apps/web/lib/server/review-action-service.ts`.
- [x] (2026-03-17 03:21Z) Executed full review-step run (8 steps) on default manuscript and collected outputs to `tmp/usefulness-review-outputs.json`.
- [x] (2026-03-17 03:22Z) Executed proposal-generation actions for non-image recommendation types (`rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`) and collected outputs to `tmp/usefulness-action-outputs.json`.
- [x] (2026-03-17 03:23Z) Produced sub-agent usefulness scoring and prioritized improvements in `tmp/usefulness-evaluation-subagent.json`.
- [x] (2026-03-17 03:24Z) Finalized consolidated usefulness analysis for user feedback.

## Surprises & Discoveries
- Observation: The default manuscript is long and heterogeneous (narrative + symptom lists + nutrition/biохакінг blocks), which is useful for stress-testing multiple recommendation types.
  Evidence: `apps/web/lib/editor/default-manuscript.ts` spans many sections (`Вступ`, `Перекладаємо мову шкіри`, `Біохакінг шкіри`, etc.).
- Observation: All executed AI paths succeeded without provider fallback in this run.
  Evidence: `usedFallback=false` across step and action artifacts in `tmp/usefulness-review-outputs.json` and `tmp/usefulness-action-outputs.json`.
- Observation: Recommendation density is high and partially duplicative across `clarity`, `formatting`, and `final_editing`.
  Evidence: Similar tone-softening recommendations recur across these steps in sampled card titles/reasons.

## Decision Log
- Decision: Include the `visuals` review step but exclude image generation endpoint calls.
  Rationale: User asked to run all AI features except image generation; visual recommendation quality is still part of editorial usefulness.
  Date/Author: 2026-03-16 / Codex
- Decision: Use sub-agents for execution in parallel (review-step run vs action-generation run) and aggregate centrally.
  Rationale: Matches user request and shortens cycle time while keeping each subtask bounded.
  Date/Author: 2026-03-16 / Codex
- Decision: Use provider/model defaults (`gemini` + `gemini-3.5-flash`) and environment keys from `.env`.
  Rationale: This reflects current product defaults and user instruction to use `.env` keys.
  Date/Author: 2026-03-17 / Codex

## Outcomes & Retrospective
The requested usefulness test was completed end-to-end with sub-agents and real provider calls. All 8 review steps ran successfully; fact-check returned grounded rows; recommendation steps generated actionable cards; and all targeted non-image action-generation types produced proposals without fallback in this run.

Main gap discovered is UX/actionability alignment: diagnostics and fact-check provide weaker direct editing utility compared with structure/clarity/final-editing flows, and card duplication across steps increases cognitive load. The resulting prioritized improvements focus on stronger action linkage for diagnostics/fact-check and deduplication across overlapping recommendation steps.

## Context and Orientation
The app is a web-only Next.js project in `apps/web` with AI operations exposed primarily through two server modules:
- `apps/web/lib/server/review-service.ts`: generates step-based review outputs (`diagnostics`, `fact_check`, `structure`, `clarity`, `interest`, `visuals`, `formatting`, `final_editing`).
- `apps/web/lib/server/review-action-service.ts`: generates actionable proposals (replace/list/subsection/callout/image drafts) for specific recommendation cards.

The default manuscript under test is `DEFAULT_MANUSCRIPT_TEXT` in `apps/web/lib/editor/default-manuscript.ts`.

API keys are loaded from `.env` (not committed outputs), so runs use real providers if available.

## Plan of Work
First, build a runtime-compatible document + revision state from the default manuscript and execute each review step with stable settings to gather comparable outputs. Second, select representative recommendation cards by type (rewrite/simplify/expand/list/subsection/callout/visual where applicable) and run proposal generation for all non-image actions. Third, apply one rubric across all outputs: editorial usefulness, meaning preservation, actionability, specificity, noise level, and risk of misleading/overclaiming language. Finally, produce prioritized product feedback.

## Concrete Steps
From repo root `/mnt/c/Projects/oboz-ai/orest-edit`:

1) Run a script that imports `generateEditorialReview` and executes all 8 review steps on the default manuscript.

2) Run a script that imports `generateReviewAction`, feeds selected review items, and executes non-image proposal generation paths.

3) Aggregate outputs and score each feature on a 1-5 usefulness scale with concise rationale.

## Validation and Acceptance
Acceptance criteria:
- Every review step returns either valid output (`expertise`, `factCheckRows`, or `items`) or a captured fallback/error for analysis.
- For recommendation-based steps, at least one actionable non-image recommendation path is tested via proposal generation where available.
- Final report includes:
  - per-feature usefulness score (1-5),
  - what helped,
  - what was noisy/risky,
  - top prioritized improvements.

## Idempotence and Recovery
Runs are read-only against local source files and only call provider APIs. If provider calls fail, rerun with same scripts; failures are recorded as part of usefulness constraints. No database or filesystem mutation is required except optional temporary result files.

## Artifacts and Notes
Artifacts will be captured as:
- `tmp/usefulness-review-outputs.json`
- `tmp/usefulness-action-outputs.json`

## Interfaces and Dependencies
Expected interfaces used:
- `generateEditorialReview(request)` from `apps/web/lib/server/review-service.ts`
- `generateReviewAction(request)` from `apps/web/lib/server/review-action-service.ts`
- `DEFAULT_MANUSCRIPT_TEXT` and parsing helpers from editor model modules.

Provider dependencies:
- `.env` keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`) resolved by existing server helpers.
