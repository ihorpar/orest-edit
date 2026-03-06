# CURRENT_STATE

Date: 2026-03-05
Status: Active handoff

## What exists now
- A Next.js app under `apps/web`
- Main editor screen at `/editor`
- Settings screen at `/settings`
- Ukrainian UI copy
- Sample4-inspired layout and typography
- Editable manuscript surface with real text selection tracking
- Floating selection composer with manual fold/unfold control
- One base patch action inside the floating selection composer
- Review rail that stays collapsed until requests, diagnostics, or history exist
- Patch API route at `/api/edit/patch`
- Diff cards with short reasons and per-patch accept/reject actions
- Group accept/reject flow for multiple safe patch operations
- Safe patch apply flow that updates manuscript text in place
- Inline manuscript diff preview after apply, kept visible until the editor resumes direct editing
- Each model request is normalized into one selection-wide replace diff before review
- Floating selection composer auto-minimizes after a request is sent to the model
- Collapsed request diagnostics and short request history in the editor rail
- Local settings persistence in browser storage
- Real OpenAI, Gemini, and Anthropic provider adapters behind one shared patch contract
- OpenAI remains the default provider path in the current UI
- Deterministic local fallback when a provider key is missing or a provider call fails
- Root `.env` fallback for `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY` when the settings form key is left blank
- Validation that drops malformed or overlapping provider operations before they reach the UI
- Automated tests for patch normalization, batch apply behavior, and provider env/fallback behavior
- README and `docs/DEPLOYMENT.md` document the runtime and port model explicitly
- Repo-level text safeguards now exist through `.editorconfig`, `.gitattributes`, and `npm run check:text`
- Source and docs files have been normalized to UTF-8 without BOM, LF line endings, and a final newline

## What does not exist now
- No separate backend service
- No server-side persistence layer
- No real source retrieval or fact-check implementation
- No route-level or UI interaction test coverage yet
- No export patch flow or version history
- No hardened live Gemini contract handling yet when the model returns unusable local edits
- No CI or pre-commit wiring yet that runs `npm run check:text` automatically

## Current product direction
- User: book editor
- Task: simplify dense scientific writing into simple Ukrainian
- Editing model: local patch proposals only
- Review model: diff + accept/reject + short reason
- Visual baseline: `sample4`

## Current product decisions
- Strict medical mode is not part of the current MVP direction.
- Export patch is not part of the current MVP direction.
- Sources are not a primary navigation flow in the current MVP.
- The first working editor slice uses textarea-backed plain text so selection, request offsets, and patch apply share one coordinate system.
- Pending patch proposals are invalidated when the manuscript is edited manually.
- Patch responses now carry diagnostics so the editor can show provider/model/request status without opening dev tools.
- For local development, leaving the settings API-key field empty uses the matching provider key from the repo-root `.env` on the server.
- Provider-specific API payloads are normalized on the server so the editor only consumes one patch contract.
- Provider normalization now repairs common model drift before fallback, including selection-relative offsets and numeric-string indices.
- Provider normalization also collapses fragmented model output into one coherent rewrite for the selected fragment.
- The right rail is review-first and stays hidden until there is something to inspect.
- Custom prompting is a floating, selection-triggered action rather than a persistent rail composer.
- The floating selection composer is the only place that exposes the selection-scoped base patch action.
- The floating selection composer no longer repeats the selected text in a separate preview card; the manuscript highlight is the source of truth.
- After a request is sent, the floating selection composer collapses automatically and can be reopened from its top-right toggle.
- After accept, the manuscript switches into a short review mode that shows applied edits inline as diffs until the user clicks back into editing.
- One request now maps to one coherent diff card for the selected fragment, even if the model attempted to return several local edits.
- Deployment guidance is split between a short README summary and detailed `docs/DEPLOYMENT.md` runtime notes.
- Repository text files are treated as UTF-8 with LF line endings, and integrity is checked via `npm run check:text`.

## Highest-priority next work
1. Harden Gemini using the live failure case where the provider responded but still produced unusable local edits for the shared patch contract.
2. Live-validate Anthropic with a real key and harden provider-specific error handling from real responses.
3. Add route-level and editor interaction tests around request parsing, diff review, and accept/reject flow.
4. Wire `npm run check:text` into CI or a pre-commit hook so the text-integrity guard runs automatically.
5. Revisit richer manuscript rendering only after the patch workflow stays stable.

## Last validated state
- `npm run check:text` passed
- `npm run test` passed
- `npm run typecheck` passed
- `npm run build` passed
- runtime patch request succeeded through OpenAI with the form API key left blank
- live runtime Gemini request reached the provider via repo-root `.env`, but fell back because the returned local edits were empty or invalid for the shared patch contract
- mocked provider tests cover OpenAI, Gemini, and Anthropic request/response normalization
- OpenAI repair logic now rebases selection-relative offsets and coerces numeric-string indices before declaring provider operations invalid
- headless Chrome UI smoke run confirmed persistent selection visibility while typing in the floating prompt and inline diff rendering after apply; screenshots saved to `.tmp/ui-selection-prompt.png` and `.tmp/ui-applied-diff.png`
- headless Chrome UI smoke run confirmed the floating panel no longer renders duplicate selection context, supports manual fold/unfold, and auto-collapses after send; screenshots saved to `.tmp/ui-panel-collapsed.png` and `.tmp/ui-panel-auto-collapsed.png`
- current local Next listener is on `3001`; code and docs still treat `3000` as the default local port and `PORT` as the production contract
- a one-line README edit still failed through the native `apply_patch` tool in this session, even after repo text normalization, so shell fallback remains necessary here
