# Plan: Workflow step ownership

## Why / Context

Recommendation steps in the editor menu still overlap outside Structure: Formatting can emit `subsection`, Interest can emit `rewrite`/`visual`, and the server type-filter still runs only for `structure`. Structure itself is already done — heading-insert only (H2/H3), allowlist `["subsection"]`, structure-only server gate, prompts/outline/anti-copy, UI badge — see `docs/plans/EXECPLAN_STRUCTURE_HEADINGS_ONLY.md` and commit `3848143`. This plan finishes the menu split for the **remaining** focused steps.

Out of scope: any further Structure H2/H3/prompt/UI work, Structure drawer UX, deleting `subsection` from the taxonomy, per-step OpenAI schema enums, and resurrecting the unused fallback review path (`buildFallbackEditorialReviewResponse`).

## Current State

- Status: Complete
- Current milestone: 3 - Docs and closure
- Next action: None
- Blocker: None
- Already done: Milestones 0–3

## Definition of Done

- [x] Structure ownership (shipped): `structure` → `subsection` only; H2/H3 insert; structure server filter; prompts/UI — do not re-implement
- [x] Required behavior: Remaining focused steps match the contract below; server drops off-bucket types for those steps (including `emphasis`); `final_editing` keeps all types
- [x] Verification: `node --import tsx --test apps/web/test/review-service.test.ts apps/web/test/manual-review-items.test.ts` (44/44) plus `npm run typecheck -w @orest/web` pass
- [x] Scope closure: UI/step prompt copy for formatting/interest; legacy single-owner fallbacks; manual `stepId`; `docs/CURRENT_STATE.md` and `docs/DECISIONS_LOG.md` updated

### Target ownership contract

| Step | Allowed types | Status |
|---|---|---|
| `structure` | `subsection` | Done |
| `formatting` | `list`, `callout` | Done |
| `clarity` | `simplify`, `rewrite`, `expand` | Done |
| `interest` | `callout`, `expand` | Done |
| `visuals` | `visual` | Done |
| `emphasis` | `rewrite` (special emphasis JSON path) | Done |
| `final_editing` | all executable types | Unfiltered |
| diagnostics / fact_check / spellcheck | unchanged | — |

## Milestone 0 - Structure (already implemented)

- [x] 0.1 Structure allowlist `["subsection"]` only; non-subsection cards filtered server-side for `structure`
- [x] 0.2 Subsection draft/apply supports AI-chosen `headingLevel` 2|3; insert before anchor; existing headings not edited
- [x] 0.3 Structure prompts + outline/anti-copy + UI H2/H3 badge
- [x] 0.4 Docs/plan for Structure: `docs/plans/EXECPLAN_STRUCTURE_HEADINGS_ONLY.md`, `CURRENT_STATE` / `DECISIONS_LOG` Structure entries, commit `3848143`

## Milestone 1 - Contracts and server type gate

- [x] 1.1 formatting/interest allowlists updated
- [x] 1.2 Generalized type filter with Structure fail-safe; `final_editing` exempt
- [x] 1.3 Rewrote mixed-types test for per-step filtering + emphasis regression
- [x] 1.4 Verify: review-service 38/38 + typecheck green

## Milestone 2 - Prompts, copy, and legacy grouping

- [x] 2.1 formatting/interest prompts + interestFocus wiring
- [x] 2.2 UI summaries updated
- [x] 2.3 Legacy no-stepId single-owner routing; manual items set `stepId`
- [x] 2.4 Verify: prompt guardrails + manual-review-items + typecheck green

## Milestone 3 - Docs and closure

- [x] 3.1 CURRENT_STATE + DECISIONS_LOG updated; 2026-05-25 mixed-types marked superseded
- [x] 3.2 Verify suite + typecheck; plan moved to `.plans/done/workflow-step-ownership.md`

## Key Decisions & Unexpected Findings

- Decision: Structure is complete and out of rework scope for this plan.
- Decision: Interest = `callout` + `expand` only (no rewrite/visual).
- Decision: Generalize Structure server type-filter to all focused steps including `emphasis`; `final_editing` unfiltered.
- Decision: Dual-owned `callout`/`expand` when `stepId` present; no-`stepId` single-owner fallbacks.
- Finding: Manual callouts lacked `stepId` and vanished from Interest after single-owner fallbacks — fixed by setting `stepId` on manual inserts.
- Finding: Emphasis production schemas omit `recommendationType` (defaults to rewrite); gate is a safety net.

## Completion Summary

Implemented menu ownership for focused recommendation steps beyond Structure: allowlists + generalized server filter, narrowed formatting/interest prompts and copy, single-owner legacy grouping with manual `stepId` preservation, and docs/decision updates. Verified with review-service + manual-review-items tests (44/44) and `npm run typecheck -w @orest/web`. Residual risks: shared `callout`/`expand` across steps when `stepId` is set (by design); global OpenAI schema still allows all types (filter + prompts enforce ownership); unrelated settings Luna price-label test failure remains outside this plan.
