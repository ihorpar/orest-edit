# CURRENT_STATE

Date: 2026-03-10
Status: Active handoff

## What exists now
- A web-only Next.js app under `apps/web`
- Main working screen at `/editor`
- `/editor` now uses a block-first rich editor surface rather than a markdown-first source editor
- Canonical editor state is `EditorDocument { version: 2, blocks[] }` with stable block IDs
- Supported block types in the current editor: `paragraph`, `heading`, `bullet_list`, `ordered_list`, `image`, `callout`, `divider`, `table`
- Manual editing happens inside blocks with inline `bold`, `italic`, and `link` formatting
- AI actions are block-based only; local patch requests send `targetBlockIds`, never character offsets
- AI patch apply semantics are whole-block replacement; accepted edits replace the selected block range
- Paragraph numbering remains visible for navigation and now tracks block IDs instead of markdown paragraphs
- Whole-text review anchors to block IDs and proposes block-scoped actions instead of offset-scoped edits
- `Працюй!` for whole-text review keeps the full anchored block range instead of collapsing to excerpt matches
- The editor right rail remains the permanent review/action area on desktop
- The app still supports provider-backed local patching and whole-text review through `/api/edit/patch`, `/api/edit/review`, and `/api/edit/review/proposal`
- Browser draft persistence now uses `orest-editor-draft-v2`; legacy markdown draft state is intentionally discarded on load
- `.docx` export now renders directly from the block document model rather than from markdown
- Browser-local image assets continue to use the existing asset store; inserting media now creates first-class `image` blocks
- Settings live at `/settings` and still provide provider/model/API-key configuration with live validation
- In-app password auth still gates `/editor`, `/settings`, and API routes through `/login`
- Ukrainian UI copy remains the product baseline
- The visual direction is still aligned with `docs/sample4.html`

## What does not exist now
- No separate backend service
- No server-side persistence layer
- No markdown editing workflow in the main product path
- No character-offset patch flow
- No browser interaction E2E coverage yet for the new block editor
- No hardened provider normalization yet for arbitrary mixed block output from real models
- No full clipboard/Word paste pipeline for complex rich-text imports
- No export patch flow or document version history

## Current product direction
- User: book editor
- Task: simplify dense scientific writing into simple Ukrainian while preserving meaning and author intent
- Editing model: patch-first and diff-first
- Review model: visible proposals with short reasons and explicit accept/reject
- Visual baseline: `sample4`

## Current product decisions
- Strict medical mode is out of scope for the current MVP
- The canonical editor model is block-first; markdown is no longer part of the main editing workflow
- AI operations are block-anchored and replace whole selected block ranges, not character offsets
- The editor surface is a docs-like rich block editor, not a source-visible markdown editor
- DOCX remains the external handoff/export format
- Existing browser-local drafts and pending operations are intentionally reset by the v2 migration
- Custom prompting remains selection-triggered, but AI selection is contiguous block-range only in v1
- The first-class inline formatting set in v1 is limited to `bold`, `italic`, and `link`

## Highest-priority next work
1. Add browser-driven interaction QA for block selection, inline formatting, and review proposal flows.
2. Harden provider normalization for richer returned block mixes, especially `callout`, `table`, and `image`.
3. Improve HTML/plain-text paste parsing so multi-paragraph content maps cleanly into block structures.
4. Expand review proposal UI for non-text block previews and richer apply states.
5. Add regression coverage for draft invalidation, block-range apply, and block-first review actions.

## Last validated state
- `npm run typecheck -w @orest/web` passed after the block-first editor migration
- `npm test -w @orest/web` passed after replacing markdown/offset tests with block-first contract, service, and export coverage
- `npm run build -w @orest/web` passed after switching `/editor` to the new rich block surface and block-based AI contracts
- Runtime smoke check passed against `next start` with `APP_PASSWORD=test-secret`; authenticated `/editor` returned HTTP 200 and rendered the new block editor shell
- Interactive browser QA was not run in this session because the Playwright interactive tooling referenced in local skills was not available in the current tool environment
