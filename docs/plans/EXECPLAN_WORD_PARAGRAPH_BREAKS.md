# Export Word paragraphs without extra manuscript blocks

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

If PLANS.md is present in the repo, maintain this document in accordance with it and link back to it by path (`PLANS.md`).

## Purpose / Big Picture

Science-pop editors export to Word and expect Enter-style paragraph marks (¶), not Shift+Enter line breaks (↵). AI rewrites and callouts currently store extra lines as `\n` inside one manuscript block. This plan keeps rewrite/simplify/expand as 1:1 block replaces, but:

- DOCX export turns remaining `\n` into real Word paragraphs (`<w:p>`).
- Callout insert splits prose into existing `callout.body[]` parts.
- Enter inside a callout body creates another `body[]` part, not a new manuscript block.

After this change, a rewrite that contains `**Важливе застереження**` plus following sentences still occupies one editor paragraph number, but Word Show/Hide shows ¶ and paragraph spacing applies.

## Milestones

### Milestone 1: Split inline newlines into Word paragraphs

Status: Complete.

Done:

- Added `splitInlineNodesByNewlines` in `apps/web/lib/editor/document-model.ts`.
- DOCX export emits extra `<w:p>` for `\n` in paragraph, heading, callout, caption, table cell, and list item text.
- `apps/web/test/docx-export.test.ts` now asserts no `<w:br/>` for those cases.

Remaining:

- None.

Proof:

- `node --import tsx --test apps/web/test/docx-export.test.ts` passed on 2026-08-17.

### Milestone 2: Canonicalize callout body without new manuscript blocks

Status: Complete.

Done:

- `parseCalloutDraftFromLabels` keeps blank lines.
- Consecutive finished prose lines become separate `body[]` parts; wrapped lowercase continuations still join.
- Deep-callout prompts ask for a blank line between paragraphs.

Remaining:

- None.

Proof:

- `apps/web/test/callout-preview.test.ts` and the labeled-callout review-action test passed on 2026-08-17.

### Milestone 3: Enter in a callout creates a body paragraph

Status: Complete.

Done:

- `splitCalloutBodyAtOffset` splits one `body[]` part; Enter in a callout body uses it.
- Callout title still has no Enter handler.

Remaining:

- None.

Proof:

- `splitCalloutBodyAtOffset` unit test in `apps/web/test/document-model.test.ts` passed on 2026-08-17.

## Progress

- [x] (2026-08-17) ExecPlan, `docs/DECISIONS_LOG.md`, and `docs/CURRENT_STATE.md` updated.
- [x] (2026-08-17) DOCX export splits `\n` into `<w:p>`.
- [x] (2026-08-17) Callout draft/body splitting preserves paragraph breaks.
- [x] (2026-08-17) Callout body Enter splits `body[]`.
- [x] (2026-08-17) Targeted tests and `npm run typecheck -w @orest/web` passed.

## Surprises & Discoveries

- Observation: a short unfinished first line can look like a section label (`isCalloutSectionHeadingText` allows up to 6 words), so wrap-join tests need a longer first line.
  Evidence: `Порушення ліпідного обміну починається` was split as a bold label until the fixture used a longer wrap.

## Decision Log

- Decision: do not turn rewrite/simplify/expand `\n` into extra manuscript `paragraph` blocks.
  Rationale: exact-count replace, review anchors, fingerprints, and `Абз. N` labels stay stable.
  Date/Author: 2026-08-17 / implementation

- Decision: Word export maps remaining `\n` to `<w:p>`, not `<w:br/>`.
  Rationale: the product is a book editor, not a verse tool; Shift+Enter can remain in the editor and still become ¶ on export.
  Date/Author: 2026-08-17 / implementation

- Decision: callout internal paragraphs live in `callout.body[][]`, never as extra top-level blocks.
  Rationale: the nested model already exists; exploding a callout would shift manuscript numbering.
  Date/Author: 2026-08-17 / implementation

## Outcomes & Retrospective

Word now receives real paragraph marks for in-block newlines without growing the manuscript block list. Callout insert and Enter use `body[]`. Remaining gap: the editor still renders leftover `\n` as `<br>` inside a single manuscript paragraph, so gutter numbers can still disagree with Word paragraph count after a 1:1 rewrite.

## Context and Orientation

Canonical manuscript state is `EditorDocument` in `apps/web/lib/editor/document-model.ts`. A `paragraph` block is the unit of review anchors and gutter numbers. Callouts already store multiple inner paragraphs as `body: InlineNode[][]`. Lists store items as `items: InlineNode[][]`.

AI replace (`apps/web/lib/server/review-action-service.ts`) keeps exact selected block count for rewrite/simplify/expand and folds overflow with `\n\n` into the last block. `parseBoldMarkdownToInlineNodes` preserves those newlines. DOCX export in `apps/web/lib/editor/docx-export.ts` currently turns each `\n` into `new TextRun({ break: 1 })`, which Word shows as ↵.

Callout insert uses `splitCalloutDraftIntoParagraphs` in `apps/web/lib/editor/callout-preview.ts`. Consecutive non-empty lines are joined with a space, and `parseCalloutDraftFromLabels` drops blank lines, so deep callout prose often lands as one `body[]` part.

## Plan of Work

Add `splitInlineNodesByNewlines` next to `normalizeInlineNodes` in `apps/web/lib/editor/document-model.ts`. Rewrite `renderBlock` / `renderCalloutBlock` / `renderTableBlock` / image captions in `apps/web/lib/editor/docx-export.ts` so each newline segment becomes a `Paragraph`. Leave list structure as list paragraphs.

In `callout-preview.ts`, flush consecutive finished prose lines instead of joining them. In `parseCalloutDraftFromLabels`, keep empty lines. Tweak deep-callout prompt copy in `apps/web/lib/i18n/server-prompts/review-action.ts`.

Add `splitCalloutBodyAtOffset` in the document model and wire Enter on callout body in `apps/web/components/editor/BlockEditorSurface.tsx`.

## Concrete Steps

Working directory: `C:\Projects\oboz-ai\orest-edit`.

    node --import tsx --test apps/web/test/docx-export.test.ts apps/web/test/callout-preview.test.ts apps/web/test/document-model.test.ts apps/web/test/review-action-service.test.ts
    npm run typecheck -w @orest/web

Expected: tests pass; typecheck exits 0.

## Validation and Acceptance

- One manuscript paragraph that contains `**Важливе застереження**\nДля більшості...` exports as two or more Word `<w:p>` with no `<w:br/>`.
- A mechanism callout draft with a short label line plus two finished sentences becomes three `body[]` parts on insert.
- Enter in a callout body field inserts another `body[]` part; the callout remains one manuscript block.
- Rewrite/simplify/expand still replace exactly the selected block count.

## Idempotence and Recovery

All edits are additive around existing helpers. If export tests fail, restore `renderInlineNodes` line-break behavior only for the failing surface. Callout splitter changes are confined to `mechanism` / `analogy` / `everyday_application`; `top_list` and `myths_vs_truth` stay one-line-one-part.

## Artifacts and Notes

Word ¶ is `<w:p>`. Word ↵ is `<w:br/>`. Editor Shift+Enter still inserts `\n` / `<br>` inside a block; export now treats that as a paragraph break.

## Interfaces and Dependencies

    splitInlineNodesByNewlines(nodes: InlineNode[]): InlineNode[][]
    splitInlineNodesAtOffset(nodes: InlineNode[], offset: number): [InlineNode[], InlineNode[]]
    splitCalloutBodyAtOffset(block: CalloutBlock, paragraphIndex: number, offset: number): { block: CalloutBlock; nextParagraphIndex: number } | null

These live in `apps/web/lib/editor/document-model.ts`. DOCX rendering continues to use the `docx` package already imported by `apps/web/lib/editor/docx-export.ts`.
