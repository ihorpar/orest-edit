# Diagnostics Depth Modes (По суті / Розширена)

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

## Purpose / Big Picture

Editors need a short structural verdict by default, and a deeper outline-backed diagnosis when they ask for it. After this plan ships, the Diagnostics step offers **По суті** (default, concise) and **Розширена** (extended with a short outline). Mode changes the prompt package only; output stays `analysis_markdown`.

## Milestones

### Milestone 1: Contract, draft, prompt packs, UI

Status: Complete.

Done:

- `DiagnosticsMode` (`concise` | `extended`) on contract + `stepContext`
- Draft persistence + editor state/header select
- Mode-aware uk/en scaffold; slim shared `DEFAULT_EXPERTISE_PROMPT`
- Tests for concise/extended prompt injection, draft coerce, settings defaults
- DECISIONS_LOG + CURRENT_STATE handoff

Remaining:

- None for this milestone

Proof:

- Targeted review-service / draft-state / settings tests
- Typecheck green

## Progress

- [x] ExecPlan created
- [x] Contract + draft wiring
- [x] Mode-aware prompts + slim expertise default
- [x] Editor UI + copy
- [x] Tests + DECISIONS_LOG + CURRENT_STATE

## Surprises & Discoveries

- Existing review-service test still asserted the old 7-section rubric (map + 8–15 exemplars); updated to concise-default and extended-outline cases.
- Subagent review found stale `diagnosticsMacroMode` system text still asking for a structure map before evidence; made it mode-aware and aligned with the new rubric. Also auto-replace persisted Settings expertise prompts that still embed the old 7-section headings.

## Decision Log

- 2026-08-17: Compact `<select>` next to Run (not a toggle). Internal ids `concise` | `extended`. Concise omits outline; extended adds short outline only. No exemplar paragraphs; no dedicated subsections section.
- 2026-08-17: Settings `expertisePrompt` is tone-only; section structure comes from server scaffold so custom Settings text cannot reintroduce dropped sections.

## Outcomes & Retrospective

Shipped dual-depth diagnostics without changing the API output kind. Residual risk: users with a heavily customized old `expertisePrompt` in localStorage may still inject long format text; scaffold headings still constrain the required H2 set.
