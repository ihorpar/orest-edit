# CURRENT_STATE

Date: 2026-03-11
Status: Active handoff

## What exists now
- A web-only Next.js app under `apps/web`
- Main working screen at `/editor`
- `/editor` uses a block-first rich editor surface
- Canonical editor state is `EditorDocument { version: 2, blocks[] }` with stable block IDs
- Supported block types in the editor: `paragraph`, `heading`, `bullet_list`, `ordered_list`, `image`, `callout`, `divider`, `table`
- Manual editing happens inside blocks with inline `bold`, `italic`, and `link` formatting
- `Enter` inside paragraph-like editing creates a new block
- Paragraph numbering is visible and tracks block IDs
- Local AI patch requests are block-based and send `targetBlockIds`, not character offsets
- Local patch apply semantics are whole-block replacement
- Whole-text review exists through `/api/edit/review`
- Whole-text recommendation preparation exists through `/api/edit/review/proposal`
- Whole-text review anchors resolve by block IDs and block fingerprints
- Whole-text review taxonomy is normalized to `rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`, and `visual`
- Legacy provider output for `visualize`, `illustration`, and old callout kinds is coerced into the current review contract
- The editor right rail shows review cards and request history
- Review cards now show dynamic Ukrainian paragraph ranges (`Абз. 0NN[-0NN]`) derived from current block order rather than raw block IDs
- The manuscript surface now highlights the active recommendation anchor range in place and renders one inline execution surface below the affected range
- Replace-type review proposals now open as one inline diff card below the highlighted range instead of replacing the manuscript blocks with loaders/placeholders
- `callout`, `visual`, and stale/preparing recommendation states now execute from the manuscript surface through one floating inline card
- Replace-type review proposals now edit/apply block-by-block instead of flattening the full replacement range into one repeated textarea string
- Review-image generation endpoints already exist at `/api/edit/review/image`
- Review-image generation is now wired into the inline manuscript execution card and can insert an image block below the anchor
- Browser draft persistence uses `orest-editor-draft-v2`
- `.docx` export renders directly from the block document model
- Browser-local image assets use the existing asset store
- Settings live at `/settings` and still provide provider/model/API-key configuration with live validation
- In-app password auth still gates `/editor`, `/settings`, and API routes through `/login`
- Ukrainian UI copy remains the product baseline
- The visual direction is still aligned with `docs/sample4.html`

## What does not exist now
- No separate backend service
- No server-side persistence layer
- No markdown editing workflow in the main product path
- No character-offset patch flow
- No browser interaction E2E coverage yet for the block editor
- No hardened provider normalization yet for arbitrary mixed block output from real models
- No full clipboard/Word paste pipeline for complex rich-text imports
- No export patch flow or document version history
- No finalized browser QA yet for the sample4-style anchor highlight continuity and inline card placement
- No dedicated inline execution UI for `subsection` yet
- No hard output-shape guard yet for replace-type review suggestions to keep them within the selected block-count ceiling
- No finalized Ukrainian prompt contract yet for whole-text recommendation generation, replace-type execution, callout generation, or visual/image generation

## Current product direction
- User: book editor
- Task: simplify dense scientific writing into simple Ukrainian while preserving meaning and author intent
- Editing model: patch-first and diff-first
- Visual baseline: `sample4`

## Current product decisions already reflected in code
- The canonical editor model is block-first; markdown is not part of the main editing workflow
- AI operations are block-anchored and replace whole selected block ranges, not character offsets
- The editor surface is a docs-like rich block editor, not a source-visible markdown editor
- DOCX remains the external handoff/export format
- Existing browser-local drafts were intentionally reset by the v2 migration
- The first-class inline formatting set in v1 is limited to `bold`, `italic`, and `link`
- `callout` is already a first-class block type
- `image` is already a first-class block type

## Highest-priority next work
1. Enforce output-shape constraints for replace-type review suggestions so they do not exceed the selected block-count ceiling.
2. Implement the dedicated inline `subsection` insertion card before the anchor range.
3. Tighten Ukrainian prompt contracts further so review prose avoids stale hard-coded paragraph references.
4. Add regression coverage and browser QA for anchor continuity, stale suggestion invalidation, callout/image insertion anchors, and Ukrainian prompt output.
5. Harden the right-rail cards and manuscript card styling to fully match the `sample4` interaction quality.

## Last validated state
- `npm run typecheck -w @orest/web` passed on 2026-03-11 after the inline anchor-highlight and manuscript execution-card refactor
- `npm run build -w @orest/web` passed on 2026-03-11 after the inline anchor-highlight and manuscript execution-card refactor
- `npm test -w @orest/web` remains blocked in this environment because `tsx` resolves a Windows `esbuild` binary while the workspace is running under Linux/WSL
- Runtime smoke check was last confirmed against `next start` with `APP_PASSWORD=test-secret`; unauthenticated `/editor` redirected to `/login` and `/login` returned HTTP 200
- Interactive browser QA was not run in this validation pass because the referenced Playwright interactive tooling was not available in the current tool environment
