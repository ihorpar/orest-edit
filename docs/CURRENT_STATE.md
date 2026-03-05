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
- One-click base patch action beside the active selection state
- Floating `Кастомні правки` panel that appears when text is selected
- Review rail that stays collapsed until requests, diagnostics, or history exist
- Patch API route at `/api/edit/patch`
- Diff cards with short reasons and per-patch accept/reject actions
- Group accept/reject flow for multiple safe patch operations
- Safe patch apply flow that updates manuscript text in place
- Collapsed request diagnostics and short request history in the editor rail
- Local settings persistence in browser storage
- Real OpenAI, Gemini, and Anthropic provider adapters behind one shared patch contract
- OpenAI remains the default provider path in the current UI
- Deterministic local fallback when a provider key is missing or a provider call fails
- Root `.env` fallback for `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY` when the settings form key is left blank
- Validation that drops malformed or overlapping provider operations before they reach the UI
- Automated tests for patch normalization, batch apply behavior, and provider env/fallback behavior
- README and `docs/DEPLOYMENT.md` now document the runtime and port model explicitly

## What does not exist now
- No separate backend service
- No server-side persistence layer
- No real source retrieval or fact-check implementation
- No route-level or UI interaction test coverage yet
- No export patch flow or version history
- No hardened live Gemini contract handling yet when the model returns unusable local edits

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
- The right rail is review-first and stays hidden until there is something to inspect.
- Custom prompting is a floating, selection-triggered action rather than a persistent rail composer.
- Deployment guidance is split between a short README summary and detailed `docs/DEPLOYMENT.md` runtime notes.

## Highest-priority next work
1. Harden Gemini using the live failure case where the provider responded but still produced unusable local edits for the shared patch contract.
2. Live-validate Anthropic with a real key and harden provider-specific error handling from real responses.
3. Add route-level and editor interaction tests around request parsing, diff review, and accept/reject flow.
4. Revisit richer manuscript rendering only after the patch workflow stays stable.

## Last validated state
- `npm run test` passed
- `npm run typecheck` passed
- `npm run build` passed
- runtime patch request succeeded through OpenAI with the form API key left blank
- live runtime Gemini request reached the provider via repo-root `.env`, but fell back because the returned local edits were empty or invalid for the shared patch contract
- mocked provider tests cover OpenAI, Gemini, and Anthropic request/response normalization
- current local Next listener is on `3001`; code and docs still treat `3000` as the default local port and `PORT` as the production contract