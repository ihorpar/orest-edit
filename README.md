# Orest Edit MVP

AI editor for book editors who turn dense scientific and medical popular-science prose into simple Ukrainian.

## Product direction

This is not a doctor tool and not a clinical decision tool.

The primary user is a book editor working on science-pop manuscripts. The job is to improve clarity, simplify terminology, preserve meaning, and keep edits local and reviewable.

Core product rules:
- patch-first, never full chapter rewrite by default
- diff-first, every change must be visible before acceptance
- every edit needs a short reason
- keep edits local to the selected fragment
- UI language is Ukrainian
- visual baseline is `docs/sample4.html`

## Current app state

Implemented now:
- Next.js web app in `apps/web`
- `/editor` screen with real text selection, local patch requests, diff review, and accept/reject flow
- `/settings` screen for provider, model id, API key, and editorial prompt
- shared patch contract across OpenAI, Gemini, and Anthropic adapters
- deterministic local fallback when a provider key is missing or a provider response cannot be applied safely
- automated tests for patch normalization, batch apply behavior, and provider env/fallback behavior

Still missing or not hardened yet:
- separate backend service and persistence
- real fact-checking and source retrieval
- route-level and end-to-end UI test coverage
- hardened live Gemini/Anthropic behavior from real provider responses

## Local run

```bash
npm run dev
```

Notes:
- locally, Next uses port `3000` by default
- if `3000` is already occupied, Next may move to `3001` automatically
- that local fallback does not mean the app is configured to deploy on both ports

## Deployment

Short version:
- production should use the platform-provided `PORT`
- this repo does not hardcode a runtime port in app code or Next config
- root start command is `npm run start`
- detailed deployment notes live in `docs/DEPLOYMENT.md`

## Docs map

- `docs/PRD_V1.md`: product scope and constraints
- `docs/EXECPLAN_MVP.md`: current implementation plan
- `docs/CURRENT_STATE.md`: latest handoff snapshot for agents
- `docs/DEPLOYMENT.md`: deployment and runtime notes
- `scripts/check-text-integrity.mjs`: UTF-8, LF, and mojibake guard

## Working rule for agents

Before making product or UI changes, read:
1. `AGENTS.md`
2. `docs/CURRENT_STATE.md`
3. the relevant doc in `docs/`
