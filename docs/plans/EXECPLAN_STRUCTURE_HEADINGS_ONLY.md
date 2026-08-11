# Structure step: H2/H3 insert only

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

If PLANS.md is present in the repo, maintain this document in accordance with it and link back to it by path.

## Purpose / Big Picture

The Structure workflow step becomes a single-purpose tool: insert new H2 or H3 subheads so editors can scan the chapter more easily. It no longer proposes lists, callouts, or rewrites, and it never edits existing headings. After implementation, running Структура returns only subsection insert cards; preparing a card yields a title plus AI-chosen level; applying inserts a new heading block before the anchor.

## Milestones

### Milestone 1: Contract, prompts, server gate, UI
Status: Complete.

Done:
- Added `headingLevel: 2 | 3` to subsection items/drafts and apply path.
- Structure allows only `subsection`; server filters other types for that step only.
- Review/proposal prompts require H2/H3 choice, outline context, anti-copy, no edit of existing headings.
- Subsection anchors shift past leading existing headings.
- Structure UI copy and read-only H2/H3 badge.

Remaining:
- None for this milestone.

Proof:
- Targeted tests in `review-contract`, `review-service`, `review-action-service`.
- Typecheck on `@orest/web`.

## Progress
- [x] (2026-08-11) Contract + apply `headingLevel`
- [x] (2026-08-11) Structure type gate (structure-only)
- [x] (2026-08-11) Review/proposal prompts + outline
- [x] (2026-08-11) Subsection insert anchor guard
- [x] (2026-08-11) Structure UI badge + copy
- [x] (2026-08-11) Tests + CURRENT_STATE + DECISIONS_LOG
- [x] (2026-08-11) Ready `headingTitle` with cards; focus opens manuscript preview without re-prepare

## Surprises & Discoveries
- Global allowed-type filtering would regress the intentional “mixed types stay visible” policy for other steps; the type gate was therefore limited to `structure` only.
- Subsection request compaction previously dropped neighboring headings, so outline injection saw an empty plan; compact payloads now keep H2/H3 blocks alongside the anchor for Structure proposals.
- Subsection proposal requests compact the document to anchor blocks, which previously dropped existing headings from the outline prompt; compaction now keeps H2/H3 headings alongside the anchor for Structure proposals.
- «Відкрити деталі» previously always called prepare (or focus auto-prepared pending cards), so ready cards still showed «ШІ готує цю рекомендацію…» and looked like title regeneration.

## Decision Log
- (2026-08-11) Structure = insert-only H2/H3; AI chooses level; no editor level toggle; existing headings are never renamed or releveled in this step.
- (2026-08-11) Lists/callouts remain owned by Formatting/Interest, not Structure.
- (2026-08-11) Review returns `headingTitle` with Structure cards; hydrate draft + ready status so manuscript preview uses that title without a second LLM call.

## Outcomes & Retrospective
- Structure is a focused heading-insert tool with harder server filtering and clearer prompts. Remaining risk is model quality of titles; outline + anti-copy rules reduce copycat headings but do not eliminate them. Ready titles with cards remove the false “regenerating” UX on open-details.
