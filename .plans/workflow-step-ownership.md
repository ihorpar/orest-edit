# Plan: Workflow step ownership

## Why / Context

Recommendation steps in the editor menu still overlap outside Structure: Formatting can emit `subsection`, Interest can emit `rewrite`/`visual`, and the server type-filter still runs only for `structure`. Structure itself is already done — heading-insert only (H2/H3), allowlist `["subsection"]`, structure-only server gate, prompts/outline/anti-copy, UI badge — see `docs/plans/EXECPLAN_STRUCTURE_HEADINGS_ONLY.md` and commit `3848143`. This plan finishes the menu split for the **remaining** focused steps.

Out of scope: any further Structure H2/H3/prompt/UI work, Structure drawer UX, deleting `subsection` from the taxonomy, per-step OpenAI schema enums, and resurrecting the unused fallback review path (`buildFallbackEditorialReviewResponse`).

## Current State

- Status: Active
- Current milestone: 1 - Contracts and server type gate (Structure already shipped; remaining = formatting/interest allowlists + generalize filter)
- Next action: Update formatting/interest allowlists; replace the structure-only type-filter ternary so other focused steps also filter; rewrite the mixed-types review-service test
- Blocker: None
- Already done: Structure ownership (Milestone 0 below)

## Definition of Done

- [x] Structure ownership (shipped): `structure` → `subsection` only; H2/H3 insert; structure server filter; prompts/UI — do not re-implement
- [ ] Required behavior: Remaining focused steps match the contract below; server drops off-bucket types for those steps (including `emphasis`); `final_editing` keeps all types
- [ ] Verification: `node --import tsx --test apps/web/test/review-service.test.ts` (and settings tests if touched) plus `npm run typecheck -w @orest/web` pass with rewritten per-step filter assertions and updated prompt guardrail assertions
- [ ] Scope closure: UI/step prompt copy for formatting/interest/clarity/visuals; legacy `itemBelongsToStep` / `mapReviewItemsByStep` single-owner fallbacks for items without `stepId`; `docs/CURRENT_STATE.md` and `docs/DECISIONS_LOG.md` updated beyond Structure-only wording

### Target ownership contract

| Step | Allowed types | Status |
|---|---|---|
| `structure` | `subsection` | **Done** — H2/H3 insert + server gate |
| `formatting` | `list`, `callout` | Todo — remove `subsection` |
| `clarity` | `simplify`, `rewrite`, `expand` | Todo — enable server filter (`expand` shared with interest) |
| `interest` | `callout`, `expand` | Todo — remove `rewrite`, `visual` |
| `visuals` | `visual` | Todo — enable server filter |
| `emphasis` | `rewrite` (special emphasis JSON path) | Todo — include in generalized gate |
| `final_editing` | all executable types | Keep unfiltered |
| diagnostics / fact_check / spellcheck | unchanged | — |

## Milestone 0 - Structure (already implemented)

- [x] 0.1 Structure allowlist `["subsection"]` only; non-subsection cards filtered server-side for `structure`
- [x] 0.2 Subsection draft/apply supports AI-chosen `headingLevel` 2|3; insert before anchor; existing headings not edited
- [x] 0.3 Structure prompts + outline/anti-copy + UI H2/H3 badge
- [x] 0.4 Docs/plan for Structure: `docs/plans/EXECPLAN_STRUCTURE_HEADINGS_ONLY.md`, `CURRENT_STATE` / `DECISIONS_LOG` Structure entries, commit `3848143`

## Milestone 1 - Contracts and server type gate

- [ ] 1.1 In `apps/web/lib/i18n/server-prompts/review.ts`, set `formatting` to `["list", "callout"]` and `interest` to `["callout", "expand"]` (do **not** change Structure’s allowlist)
- [ ] 1.2 In `apps/web/lib/server/review-service.ts` `buildNormalizedReviewResult`, **replace** the `stepSpec.id === "structure"` ternary with: filter when `allowedRecommendationTypes` is set and `stepId !== "final_editing"` (keeps Structure behavior; extends it to clarity, formatting, interest, visuals, emphasis). Expect prompt/scaffold wording to still invite some off-bucket types until Milestone 2; server drops them.
- [ ] 1.3 Rewrite/rename `generateEditorialReview keeps mixed recommendation types visible within the originating step` in `apps/web/test/review-service.test.ts`: keep Structure’s existing filtered assertions; add clarity/formatting/interest/visuals allowed-only + `filtered_by_step_type`; assert `final_editing` keeps mixed types unfiltered; add a minimal emphasis regression. Optionally assert `getReviewStepSpec("formatting"|"interest").allowedRecommendationTypes`.
- [ ] 1.4 Verify: the rewritten review-service tests + `npm run typecheck -w @orest/web` pass. Docs may still say “only Structure filters” until Milestone 3.

## Milestone 2 - Prompts, copy, and legacy grouping

- [ ] 2.1 Narrow UK/EN step prompts and card guidance for **formatting/interest only** (Structure prompts already correct — leave them): Formatting = lists/callouts only; Interest = callout+expand, no visuals/rewrites. Touch `DEFAULT_WORKFLOW_STEP_PROMPTS`, `CARD_GUIDANCE`, locale defaults if present; add/wire UK+EN `interestFocus` in `buildStepSystemPrompt`; update `formattingFocus` to drop `subsection`.
- [ ] 2.2 Update editor workflow summaries in `apps/web/lib/i18n/editor-messages/{uk,en}.ts` for formatting/interest (Formatting = lists/callouts only — drop “tables”; leave Structure summary as-is if already accurate).
- [ ] 2.3 Align legacy fallbacks in `apps/web/app/editor/page.tsx` (`mapReviewItemsByStep`, `itemBelongsToStep`) for hydrated items **without** `stepId`: remove `subsection` from formatting; primary owners when `stepId` missing (`subsection`→structure, `list`→formatting, `callout`→formatting, `expand`→clarity, `visual`→visuals, rewrite-family→clarity). No duplicate `callout`/`expand` in the no-`stepId` path.
- [ ] 2.4 Verify: update `review-service.test.ts` prompt-guardrail test(s) so Formatting forbids subhead/`subsection` language and Interest asserts no visual/rewrite ownership wording; keep Structure guardrail assertions as already green.

## Milestone 3 - Docs and closure

- [ ] 3.1 Update `docs/CURRENT_STATE.md` and `docs/DECISIONS_LOG.md`: extend beyond Structure-only — focused steps hard-filter by allowlist; exception `final_editing`; note intentional shared types (`callout`, `expand` with `stepId`)
- [ ] 3.2 Verify: targeted review-service (+ settings if touched) suite and typecheck green; mark this plan Complete and move to `.plans/done/workflow-step-ownership.md`

## Key Decisions & Unexpected Findings

- Decision: Structure is complete and out of rework scope for this plan. Reason: already shipped as heading-insert-only with its own ExecPlan and commit.
- Decision: Interest = `callout` + `expand` only (no rewrite/visual). Reason: user accepted menu split; visuals stay in Візуали, rewrites in Ясність.
- Decision: Generalize the existing Structure server type-filter to all focused recommendation steps including `emphasis`; `final_editing` stays unfiltered. Reason: prompt-only steering failed; Structure already proved hard filter works.
- Decision: `expand` is dual-owned by clarity and interest when `stepId` is present; without `stepId`, legacy grouping prefers clarity. Reason: both steps legitimately use expand, but no-`stepId` fallback must be single-owner.
- Decision: `callout` is dual-owned by formatting (presentation) and interest (applicability) when `stepId` is present; without `stepId`, legacy grouping prefers formatting. Reason: server filter is per originating run, not cross-step dedupe.
- Finding: Structure heading-only + structure-only filter already shipped (`docs/plans/EXECPLAN_STRUCTURE_HEADINGS_ONLY.md`, commit `3848143`). Evidence/impact: Milestone 0 checked off; remaining work generalizes the gate and fixes other steps only.
- Finding: OpenAI card schema still allows all `recommendationType` values globally. Evidence/impact: rely on prompt + server filter (same as Structure); do not block on per-step schema enums.
- Finding: Active test `keeps mixed recommendation types visible...` currently asserts the opposite of Milestone 1 for clarity/formatting (Structure half already correct). Evidence/impact: M1 must rewrite that test for non-Structure steps, preserving Structure assertions.
- Finding: `buildFallbackEditorialReviewResponse` bypasses the type gate but is unused (fail-loud path). Evidence/impact: leave out of scope unless re-enabled later.
- Finding: `DECISIONS_LOG` / `CURRENT_STATE` still say only Structure hard-filters. Evidence/impact: expected until Milestone 3 after M1 lands.

## Completion Summary

(Fill in when complete.)
