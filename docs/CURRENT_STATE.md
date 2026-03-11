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
- Execution cards now collapse rationale/excerpt into `Чому це запропоновано` details and keep action fields primary
- Callout execution panels no longer render raw prompt text; only kind/title/body + regenerate/insert actions remain
- Visual execution panels now include editable caption and keep prompt-editable flow with generate/regenerate/insert actions
- Visual proposal parsing now supports both JSON (`prompt` + optional `caption`/`alt`) and plain-text prompt fallback
- Replace-type review proposals now edit/apply block-by-block instead of flattening the full replacement range into one repeated textarea string
- Replace-type review preparation now enforces block-count constraints by recommendation type (`rewrite/simplify/expand` exact count, `list` capped by selected range)
- The manuscript now marks active replace-source blocks in red while proposed replacement stays editable in green inside the inline diff card
- Replace-source highlighting in manuscript remains red but no longer uses strikethrough decoration
- Rewrite/simplify execution now strips markdown artifacts from replacement text and flags near-no-op outputs with explicit regenerate guidance
- `subsection` recommendation preparation now returns an editable heading+optional lead draft and applies insertion before the first affected block
- The floating `Локальна правка` panel can now launch manual AI inserts (`Врізка`, `Візуал`) from selected blocks via synthetic review items
- Manual callout/visual launches now upsert a review item before proposal preparation, preserve one active execution lane, and dedupe repeated same-selection same-type clicks
- The floating `Локальна правка` panel now uses explicit local mode switches (`Правка`, `Врізка`, `Візуал`) so each mode has one unambiguous primary action and mode-specific prompt usage
- Review-image generation endpoints already exist at `/api/edit/review/image`
- Review-image generation is now wired into the inline manuscript execution card and can insert an image block below the anchor
- Runtime prompt factories now explicitly enforce plain-text, block-editor-compatible output for replace/callout/subsection/image proposal preparation
- Image-prompt normalization now strips editorial wrappers (`Опис сцени`, `Пояснення visualIntent`, etc.) before downstream generation
- Regression suites now include inline execution-lane state coverage and subsection insert-before anchor edge cases
- Reusable browser QA command now exists at `npm run qa:inline-review -w @orest/web` (password-gated login + inline execution lane assertions + screenshot)
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
- No CI-integrated full browser E2E suite yet for the block editor (current coverage is a local scripted QA command)
- No hardened provider normalization yet for arbitrary mixed block output from real models
- No full clipboard/Word paste pipeline for complex rich-text imports
- No export patch flow or document version history
- No manual launcher for `subsection` in the floating panel yet (manual v1 covers only `callout` and `visual`)

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
1. Expand browser QA scenarios beyond the current inline manual `callout`/`visual` path (stale anchors, subsection insert flow, dense-card interactions).
2. Add CI wiring for `qa:inline-review` in an environment with Playwright browser dependencies preinstalled.
3. Harden right-rail/manuscript visual polish further to match `sample4` interaction quality under dense recommendation sets.

## Last validated state
- `npm run typecheck -w @orest/web` passed on 2026-03-11 after inline-lane regression helpers/tests were added
- `npm run build -w @orest/web` passed on 2026-03-11 after inline-lane regression helpers/tests were added
- `npm run test -w @orest/web` passed on 2026-03-11 (41 tests), including new `review-action-service` coverage for visual JSON caption parsing, rewrite markdown cleanup, and no-op warning signaling
- Runtime smoke check with password gate succeeded on 2026-03-11 (`/editor` redirected to `/login` before auth)
- `npm run qa:inline-review -w @orest/web` passed on 2026-03-11 using `APP_PASSWORD=@orest0krat` + local dev server on `http://127.0.0.1:3100`; validated login gate, multi-block anchor highlighting, and single inline card execution for manual `callout` and `visual`
