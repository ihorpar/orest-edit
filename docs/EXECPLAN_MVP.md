# Build a working patch-first editor vertical slice

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

## Purpose / Big Picture

The immediate goal is no longer to prove that patch-first editing can work. That vertical slice now exists.

The current goal is to align the editor architecture with the actual product model: paragraph-like blocks, local AI edits scoped to those blocks, visible numbered navigation, and a docs-like editing surface that does not expose markdown syntax.

After this migration, a user can open the editor, edit the manuscript directly in rich blocks, select one contiguous block range for AI work, receive local rewrite proposals with short reasons, review block-first diffs, accept or reject them, run whole-text editorial review anchored to blocks, and export the manuscript to `.docx` from the same canonical document model.

## Progress

- [x] (2026-03-10 00:00Z) Replaced the markdown-string manuscript state with a block-first `EditorDocument` model, moved draft persistence to `orest-editor-draft-v2`, and intentionally dropped compatibility with legacy markdown drafts.
- [x] (2026-03-10 00:00Z) Replaced offset-based patch and review contracts with block-anchored APIs and whole-block replacement apply semantics.
- [x] (2026-03-10 00:00Z) Rebuilt `/editor` as a docs-like rich block surface with inline formatting, gutter-based block selection for AI actions, and first-class block insertion for image, callout, divider, and table content.
- [x] (2026-03-10 00:00Z) Moved manuscript revision tracking and review anchors to stable block IDs and block fingerprints.
- [x] (2026-03-10 00:00Z) Replaced markdown-driven DOCX export with direct export from the block document model, including headings, lists, tables, callouts, images, and inline formatting.
- [x] (2026-03-10 00:00Z) Rebuilt patch/review/apply tests around block-first contracts and removed legacy markdown/offset test paths.
- [x] (2026-03-10 00:00Z) Verified the migrated slice with `typecheck`, `test`, `build`, and an authenticated runtime smoke check against `next start`.

## Surprises & Discoveries

- Observation: once the canonical document became block-first, keeping the old markdown and CodeMirror layer alive created more migration risk than value.
  Evidence: the first contract switch broke editor state, review anchoring, tests, and export paths at once because they all still depended on offsets or markdown-specific helpers.

- Observation: whole-block replacement is the key simplifier that made the migration tractable.
  Evidence: `apps/web/lib/editor/patch-contract.ts` now applies by `blockIds` plus `oldBlocks`, which removes offset rebasing, partial-range repair, and markdown-token-aware patching from the core flow.

- Observation: the surrounding shell survived the migration better than the old editor core.
  Evidence: the right rail and request-history model mainly needed contract-shape changes, while the heavy rewrite concentrated in `apps/web/app/editor/page.tsx` and `apps/web/components/editor/BlockEditorSurface.tsx`.

- Observation: direct DOCX export became simpler after removing markdown as the editor source of truth.
  Evidence: export now reads the same block document the user edits, instead of reconstructing semantics from source markup and markdown-specific asset tokens.

## Decision Log

- Decision: the canonical manuscript state is a block-first `EditorDocument` with stable block IDs instead of a markdown string.
  Rationale: the product already reasons in paragraphs and paragraph-scoped editorial actions; block-first state aligns the editor, review flow, and AI contracts with that product reality.
  Date/Author: 2026-03-10 / Codex implementation

- Decision: AI operations are block-anchored only and replace whole selected block ranges; character-offset patching is removed from the product workflow.
  Rationale: whole-block replacement is the simplest model that keeps edits local, diff-first, and robust while enabling a docs-like rich editor surface.
  Date/Author: 2026-03-10 / Codex implementation

- Decision: markdown is removed from the editor workflow and is no longer used as the editing source, transport contract, or export format in the main product path.
  Rationale: carrying markdown as a hidden primary model would preserve complexity without user value; the new block surface can represent the needed structure directly while DOCX remains the external handoff format.
  Date/Author: 2026-03-10 / Codex implementation

- Decision: browser-local draft state is versioned and intentionally reset on the block-first migration.
  Rationale: draft compatibility would require preserving legacy offset and markdown assumptions that the new editor intentionally removes.
  Date/Author: 2026-03-10 / Codex implementation

## Outcomes & Retrospective

The latest migration replaces the markdown and offset hybrid with one coherent block-first editor slice. `/editor` is now a docs-like rich block surface, AI requests target selected blocks instead of character ranges, review anchors resolve by block IDs, and DOCX export runs directly from the same block document model the user edits.

This pass also removes the biggest remaining architecture mismatch in the repo. The old editor stack wanted one long markdown string with offset math, while the product increasingly wanted paragraph-level navigation and paragraph-scoped AI actions. After the migration, the data model now matches the product model instead of fighting it.

The implementation is intentionally opinionated. AI edits are contiguous block-range only, apply semantics are whole-block replacement, legacy browser drafts are reset, and markdown is no longer kept as a hidden canonical layer. Those constraints reduce flexibility, but they remove the instability that was blocking a docs-like editor UX.

The remaining work is now mostly hardening and polish rather than another model rewrite: richer provider normalization, stronger paste/import handling, browser interaction QA, and better non-text block proposal previews.
