# CURRENT_STATE

Date: 2026-03-11
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
- Whole-text review taxonomy is now normalized to `rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`, and `visual`
- Legacy provider output for `visualize`, `illustration`, and the pre-reset callout kinds is now coerced into the current review contract
- The editor right rail remains the permanent review/action area on desktop
- The app still supports provider-backed local patching and whole-text review through `/api/edit/patch`, `/api/edit/review`, and `/api/edit/review/proposal`
- Review-image generation endpoints already exist at `/api/edit/review/image`, but they are not yet wired into the manuscript execution UI
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
- No sample4-style continuous anchor highlight for whole-text recommendations yet
- No single floating inline execution card below the full affected block range yet
- No dedicated inline execution UI for `subsection`, `callout`, or `visual` recommendations yet
- No executable subsection insertion flow yet; subsection recommendations currently normalize correctly but proposal preparation exits safely until the dedicated inline card is built
- No hard output-shape guard yet for replace-type review suggestions to keep them full-block and within the selected block-count ceiling
- No finalized Ukrainian prompt contract yet for whole-text recommendation generation, replace-type suggestions, callout generation, or visual/image generation

## Current product direction
- User: book editor
- Task: simplify dense scientific writing into simple Ukrainian while preserving meaning and author intent
- Editing model: patch-first and diff-first
- Review model: visible proposals with short reasons and explicit accept/reject
- Visual baseline: `sample4`
- Current target review interaction: recommendation inbox in the right rail, manuscript-first execution inline

## Current product decisions
- Strict medical mode is out of scope for the current MVP
- The canonical editor model is block-first; markdown is no longer part of the main editing workflow
- AI operations are block-anchored and replace whole selected block ranges, not character offsets
- The editor surface is a docs-like rich block editor, not a source-visible markdown editor
- DOCX remains the external handoff/export format
- Existing browser-local drafts and pending operations are intentionally reset by the v2 migration
- Custom prompting remains selection-triggered, but AI selection is contiguous block-range only in v1
- The first-class inline formatting set in v1 is limited to `bold`, `italic`, and `link`
- Whole-text recommendations may anchor one or more contiguous blocks, but execution UI should stay singular per recommendation
- Replace-type review suggestions are `rewrite`, `simplify`, `expand`, and `list`; they are full-block only
- `expand` is a replace-type suggestion, not an insertion flow
- Insert-type review suggestions are `subsection`, `callout`, and `visual`
- `subsection` means “insert a subheading before the first affected block”, optionally with a short lead
- `visual` is the top-level media family; illustration variants live under `visualIntent`, not as a separate top-level suggestion type
- Approved callout kinds are `mechanism`, `analogy`, `everyday_application`, `myths_vs_truth`, and `top_list`
- AI prompts for review, proposal generation, callouts, and generated image prompts should all be Ukrainian

## Highest-priority next work
1. Rebuild whole-text review execution around sample4-style anchored highlighting and one floating inline card below the affected range.
2. Narrow review taxonomy and runtime contracts to `rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`, and `visual`.
3. Enforce full-block output-shape constraints for replace-type suggestions so they do not exceed the selected block-count ceiling.
4. Implement dedicated inline execution flows for `subsection`, `callout`, and `visual`, including explicit insert-before / insert-after semantics.
5. Author and integrate Ukrainian prompt contracts for recommendation generation, each suggestion type, each callout kind, and visual/image generation.
6. Add regression coverage and browser QA for anchor continuity, stale suggestion invalidation, block-count safety, and Ukrainian prompt output.

## Last validated state
- `npm run typecheck -w @orest/web` passed on 2026-03-11 after normalizing the whole-text review taxonomy to the seven-type model
- `npm run build -w @orest/web` passed on 2026-03-11 after normalizing the whole-text review taxonomy to the seven-type model
- `npm test -w @orest/web` is currently blocked in this environment because `tsx` resolves a Windows `esbuild` binary (`@esbuild/win32-x64`) while the workspace is running under Linux/WSL and needs `@esbuild/linux-x64`
- Runtime smoke check passed against `next start` with `APP_PASSWORD=test-secret`; authenticated `/editor` returned HTTP 200 and rendered the new block editor shell
- Interactive browser QA was not run in this session because the Playwright interactive tooling referenced in local skills was not available in the current tool environment
