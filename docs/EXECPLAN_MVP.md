# Build a working patch-first editor vertical slice

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`C:\Projects\oboz-ai\orest-edit\PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

## Purpose / Big Picture

The immediate goal is to turn the current UI prototype into the first working product slice.

After this work, a user can open the editor, edit manuscript text directly, select a fragment, send either the default edit action or a custom request, receive local patch proposals with short reasons, review them as a diff, and accept or reject them.

This is the smallest outcome that makes the product real. It still deliberately avoids broad scope such as source workflows, strict-medical controls, or export flows.

## Progress

- [x] (2026-03-05 00:00Z) Rebuilt the project as a web-only Next.js app in `apps/web`.
- [x] (2026-03-05 00:00Z) Implemented the current sample4-based editor UI and `/settings` screen in Ukrainian.
- [x] (2026-03-05 21:42Z) Built real text selection tracking in the editor surface.
- [x] (2026-03-05 21:42Z) Bound selection state to the floating custom request panel and right-side operations rail.
- [x] (2026-03-05 21:42Z) Replaced mock patch data with a real patch state model in the client.
- [x] (2026-03-05 21:42Z) Defined a stable patch request and response contract for one working provider path.
- [x] (2026-03-05 21:42Z) Implemented one API path for patch generation inside the Next.js app.
- [x] (2026-03-05 21:42Z) Integrated the first real provider adapter, starting with OpenAI.
- [x] (2026-03-05 21:42Z) Validated and normalized provider model IDs from settings.
- [x] (2026-03-05 21:42Z) Applied accepted patch operations back into manuscript text safely.
- [x] (2026-03-05 21:42Z) Persisted settings locally and restored them on reload.
- [x] (2026-03-05 21:42Z) Added happy-path and failure-state validation for the vertical slice.
- [x] (2026-03-05 22:10Z) Hardened multi-operation validation and added safe batch accept/reject handling.
- [x] (2026-03-05 22:10Z) Added request diagnostics and short request history to the editor rail.
- [x] (2026-03-05 22:33Z) Simplified the editor UI by consolidating request actions into one rail composer, reducing duplicate selection context, and collapsing diagnostics/history by default.
- [x] (2026-03-05 23:05Z) Reworked the editor again into a review-first layout with a utility left rail, explicit whole-fragment base action, wider manuscript, and selection-triggered floating custom prompt.
- [x] (2026-03-05 23:15Z) Updated README and added deployment docs to clarify the runtime contract, `PORT` usage, and the local `3000` to `3001` fallback behavior.
- [x] (2026-03-05 23:15Z) Live-validated the Gemini env-key path and confirmed the current adapter reaches the provider but still falls back when Gemini returns unusable local edits.
- [x] (2026-03-05 22:10Z) Removed screenshot artifacts after visual verification at the user's request.
- [x] (2026-03-05 22:05Z) Fixed local env defaulting so the server reads `OPENAI_API_KEY` from the repo-root `.env` when the form key is blank.
- [x] (2026-03-05 22:05Z) Removed the stale extra local server on `3001` and returned the app to a single canonical local port.
- [x] (2026-03-05 22:30Z) Added automated tests for patch normalization, batch apply behavior, and provider env/fallback behavior.
- [x] (2026-03-05 22:30Z) Replaced fallback-only Gemini and Anthropic branches with real provider adapters behind the shared patch contract.

## Surprises & Discoveries

- Observation: the current UI was visually close enough to `sample4` that the main blocker was behavior, not design.
  Evidence: the working editor flow remains aligned with the sample4 layout while adding diagnostics and batch actions in `apps/web/app/globals.css` and `apps/web/components/layout/RightOperationsRail.tsx`.

- Observation: absolute-offset patch proposals become stale immediately after manual manuscript edits.
  Evidence: the working editor clears pending operations on manual text changes in `apps/web/app/editor/page.tsx`.

- Observation: a deterministic local fallback is necessary even with a real OpenAI path because local setups often start without a valid API key or model.
  Evidence: `apps/web/app/api/edit/patch/route.ts` returns `usedFallback: true` plus a visible error message when the OpenAI path is unavailable.

- Observation: the fallback path also benefits from multi-operation output, because it lets editors review term-level changes instead of one large replacement block.
  Evidence: the fallback generator now emits up to three non-overlapping local operations inside `apps/web/lib/server/patch-service.ts`.

- Observation: Next workspace execution was not reliably exposing the repo-root `.env` to the app server.
  Evidence: the route initially treated the root `.env` key as missing until a server-side root-env reader was added in `apps/web/lib/server/env.ts`.

- Observation: OpenAI, Gemini, and Anthropic cannot share one structured-output request body even though the editor expects one patch contract.
  Evidence: `apps/web/lib/server/patch-service.ts` now uses OpenAI `response_format.json_schema`, Gemini `generationConfig.response_schema`, and Anthropic `messages` plus `system` JSON instructions before normalizing back to the shared patch contract.

- Observation: native Node test execution in this workspace required explicit `.ts` imports plus `allowImportingTsExtensions` to exercise the same server code used by the app.
  Evidence: the automated tests run directly against `apps/web/lib/server/patch-service.ts` through `apps/web/test/*.test.ts`, and the workspace now enables this in `apps/web/tsconfig.json`.

- Observation: a live Gemini call can clear auth and transport checks but still fail the shared patch contract by returning empty or unusable local edits.
  Evidence: a real request sent through `/api/edit/patch` with `GEMINI_API_KEY` in the repo-root `.env` reached Gemini, then returned `usedFallback: true` because the resulting local operations were empty or invalid for normalization.

## Decision Log

- Decision: keep the executable task checklist inside `docs/EXECPLAN_MVP.md`, not in a separate task file.
  Rationale: `PLANS.md` already defines ExecPlan as the living execution document and requires a checkbox-based Progress section.
  Date/Author: 2026-03-05 / Codex + User

- Decision: build the first working version as a single Next.js application before introducing a separate backend.
  Rationale: this is the fastest path to a real end-to-end editing flow and avoids premature architectural split.
  Date/Author: 2026-03-05 / Codex recommendation

- Decision: treat OpenAI as the first provider integration and add Gemini and Anthropic later behind the same contract.
  Rationale: one working path is more valuable than three partial integrations.
  Date/Author: 2026-03-05 / Codex recommendation

- Decision: use a textarea-backed manuscript surface for the first real slice.
  Rationale: it keeps selection tracking, API offsets, diff proposals, and patch application on a single plain-text coordinate system.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: invalidate pending proposals when the manuscript text changes manually.
  Rationale: offset-based proposals are otherwise unsafe to apply after user edits.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: keep a deterministic local fallback behind the OpenAI path.
  Rationale: the vertical slice stays demonstrable when provider credentials are missing or the model call fails.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: include request diagnostics in the patch response and expose them in the editor rail.
  Rationale: editors need to understand what ran and whether any provider operations were discarded.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: allow batch accept/reject only after re-checking every operation against the current manuscript text.
  Rationale: multi-operation review improves throughput, but stale offset-based patches should never be applied in bulk.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: read `OPENAI_API_KEY` from the repo-root `.env` when the settings form key is blank.
  Rationale: local development should not require copying the same secret into browser storage, and the workspace server was not reliably picking up the root `.env` file by default.
  Date/Author: 2026-03-05 / Codex implementation

- Decision: isolate provider-specific OpenAI, Gemini, and Anthropic payload shapes inside one server-side patch service that always returns the shared editor contract.
  Rationale: each vendor exposes a different structured-output API, but the UI should stay provider-agnostic and keep one review/apply path.
  Date/Author: 2026-03-05 / Codex implementation

## Outcomes & Retrospective

The prototype is now a working editor slice instead of a static mock. Selection is real, requests use a stable patch contract, proposals return through an API route, each patch carries a short reason, accept updates the manuscript text, reject removes only the proposal, and saved settings are restored from local storage.

The follow-up pass hardened that slice instead of widening it prematurely. The app now validates provider operations more explicitly, supports grouped accept/reject for multiple safe operations, and gives editors immediate diagnostics plus short request history in the right rail.

The next pass removed a real local-development friction point: the app now uses the repo-root OpenAI key by default when the browser form leaves the key blank, and the duplicate local server state was cleaned up so there is a single local port again.

The current pass closed the next two biggest gaps without widening product scope. The server now has real OpenAI, Gemini, and Anthropic adapters behind one patch contract, and the workspace has automated tests for patch normalization, batch apply behavior, and provider env/fallback logic.

The UI simplification pass then reduced screen noise without changing the core editing model. The request flow first moved into one right-rail composer, then tightened further into a review-first layout: the idle right rail disappears, the left rail now holds an explicit whole-fragment base action, the manuscript page is wider, and custom prompting appears as a floating selection-triggered panel. Screenshots in `.tmp/editor-ui-clean.png` and `.tmp/editor-ui-wide-dev.png` confirmed the calmer default state.

The deployment-docs pass then removed ambiguity around runtime ports. The repo now documents that deployment should follow the platform-provided `PORT`, that the codebase itself does not hardcode a runtime port, and that seeing `3001` locally is just Next falling forward when `3000` was already occupied.

Live Gemini validation also exposed the next hardening target more clearly: the key path works and the request reaches Gemini, but the current prompt and normalization path still allow provider responses that fail the local patch contract and trigger fallback.

The main remaining gaps are live non-OpenAI validation and higher-level coverage rather than core product behavior. Gemini needs contract hardening from real responses, Anthropic still needs real-key validation in this environment, and there is not yet route-level or end-to-end UI test coverage for the review flow.

## Context and Orientation

The working directory is `C:\Projects\oboz-ai\orest-edit`.

Current key files:
- `C:\Projects\oboz-ai\orest-edit\AGENTS.md`
- `C:\Projects\oboz-ai\orest-edit\docs\PRD_V1.md`
- `C:\Projects\oboz-ai\orest-edit\docs\CURRENT_STATE.md`
- `C:\Projects\oboz-ai\orest-edit\docs\EXECPLAN_MVP.md`
- `C:\Projects\oboz-ai\orest-edit\docs\DECISIONS_LOG.md`
- `C:\Projects\oboz-ai\orest-edit\apps\web\app\editor\page.tsx`
- `C:\Projects\oboz-ai\orest-edit\apps\web\components\editor\EditorCanvas.tsx`
- `C:\Projects\oboz-ai\orest-edit\apps\web\components\editor\RequestComposerCard.tsx`
- `C:\Projects\oboz-ai\orest-edit\apps\web\components\layout\RightOperationsRail.tsx`
- `C:\Projects\oboz-ai\orest-edit\apps\web\app\api\edit\patch\route.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\lib\editor\patch-contract.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\lib\editor\settings.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\lib\server\env.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\lib\server\patch-service.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\test\patch-contract.test.ts`
- `C:\Projects\oboz-ai\orest-edit\apps\web\test\patch-service.test.ts`

Important product context:
- user = book editor, not doctor
- UI language = Ukrainian
- visual baseline = `docs/sample4.html`
- product behavior = patch-first and diff-first
- current implementation = single Next.js app with OpenAI defaulting, Gemini/Anthropic adapters, and local fallback

In this repository, a patch means a local text operation such as replace, insert, or delete, scoped to a selected fragment. A diff means the user sees the exact textual change before accepting it.

## Plan of Work

The work proceeded in one narrow product lane.

First, the fake editor selection was replaced with real user selection tracking inside a manuscript surface that keeps plain-text offsets stable.

Second, the old mock operation model was replaced with a real client patch state driven by a request/response cycle and a shared contract.

Third, a single API entry point was added inside the Next.js app. The route accepts manuscript text, selection range, mode, and prompt, then returns validated patch operations with reasons.

Fourth, one real provider path was connected through OpenAI. The route validates responses and falls back to a deterministic local patch generator when credentials or provider calls fail.

Fifth, patch acceptance was made real: accepting an operation updates the manuscript text and rebases or discards remaining proposals safely.

Sixth, a hardening pass added response diagnostics, short request history, and grouped accept/reject for safe multi-operation batches.

Seventh, local env loading was hardened so the server can use the repo-root OpenAI key without requiring browser-stored secrets.

Eighth, real Gemini and Anthropic adapters were added behind the same server patch contract using each provider's current structured-output API shape.

Ninth, automated tests were added for patch normalization, batch apply behavior, and provider env/fallback logic.

Finally, provider settings were persisted locally and the vertical slice was validated end to end with both success and fallback/error states.

## Concrete Steps

All commands were run from:

    C:\Projects\oboz-ai\orest-edit

Key implementation and validation commands:

    npm run test
    npm run typecheck
    npm run build

Runtime validation commands used for the env-default path:

    $env:PORT=<temporary-port>; npm run start
    curl.exe -X POST http://127.0.0.1:<temporary-port>/api/edit/patch ...

## Validation and Acceptance

The vertical slice is successful and validated against the original acceptance criteria.

Behavioral acceptance achieved:
- the user can select a real text fragment in the editor
- the unified request composer knows which fragment is targeted
- submitting a request returns only local patch operations
- each patch operation includes a short reason
- the right rail shows the returned operations
- accepting an operation updates the manuscript text
- rejecting an operation removes the proposal without changing text
- the app handles missing API key or provider failure with a visible non-crashing fallback/error state
- the app shows diagnostics for the last request and keeps a short in-memory request history
- multi-operation batches can be accepted or rejected safely
- leaving the settings API-key field blank still allows a real OpenAI request when `OPENAI_API_KEY` exists in the repo-root `.env`
- OpenAI, Gemini, and Anthropic now each have a real adapter behind the same patch contract
- automated tests cover patch normalization, batch apply behavior, and provider env/fallback logic

Validation commands run:

    npm run test
    npm run typecheck
    npm run build

Runtime validation:
- confirmed only port `3000` remained active during the earlier single-port cleanup after removing the stale `3001` server
- confirmed `/api/edit/patch` returned `usedFallback: false` for an OpenAI request sent without a form API key, using the root `.env` path
- confirmed provider adapter tests normalize OpenAI, Gemini, and Anthropic responses through the same patch contract
- confirmed a live Gemini request reached the provider through the repo-root `.env` key path, then fell back because the returned local edits were empty or invalid for normalization
- captured and reviewed `.tmp/editor-ui.png` from a temporary local production run during the simplification pass
## Idempotence and Recovery

The implementation remains safe to rerun incrementally. The editor UI, API route, and settings persistence are additive inside the existing Next.js app.

If a provider path is unavailable, the editor continues to function through the local fallback behind the same patch contract. If the manuscript changes manually, pending proposals are dropped instead of risking unsafe application to stale offsets. Group accept also re-checks every pending operation against the current text before applying it. If the browser field for the API key is blank, the server now checks the appropriate server env value before falling back.

## Artifacts and Notes

Useful implementation artifacts maintained in code:
- shared patch contract and batch helpers in `C:\Projects\oboz-ai\orest-edit\apps\web\lib\editor\patch-contract.ts`
- patch API diagnostics and fallback behavior in `C:\Projects\oboz-ai\orest-edit\apps\web\app\api\edit\patch\route.ts`
- request history and grouped actions in `C:\Projects\oboz-ai\orest-edit\apps\web\app\editor\page.tsx`
- shared multi-provider patch service in `C:\Projects\oboz-ai\orest-edit\apps\web\lib\server\patch-service.ts`
- root-env reader for local server defaults in `C:\Projects\oboz-ai\orest-edit\apps\web\lib\server\env.ts`

Representative patch API behavior:
- request carries full manuscript text, absolute selection offsets, mode, prompt, provider, model id, API key, and base prompt
- response carries validated local operations, `providerUsed`, `usedFallback`, optional `error`, and `diagnostics`
- when the browser omits `apiKey`, the server checks provider env keys before falling back
- provider-specific request bodies differ, but OpenAI, Gemini, and Anthropic all normalize back to the same local patch response

## Interfaces and Dependencies

The app now ends with a stable patch contract in:

    apps/web/lib/editor/patch-contract.ts

with the working shape:

    type PatchOperation = {
      id: string;
      op: "replace" | "insert" | "delete";
      start: number;
      end: number;
      oldText: string;
      newText?: string;
      reason: string;
      type: "clarity" | "structure" | "terminology" | "source" | "tone";
    };

and response diagnostics equivalent to:

    type PatchResponseDiagnostics = {
      requestId: string;
      requestedProvider: string;
      requestedModelId: string;
      appliedMode: "default" | "custom";
      selectionLength: number;
      returnedOperationCount: number;
      droppedOperationCount: number;
      generatedAt: string;
    };

The first API path lives at:

    apps/web/app/api/edit/patch/route.ts

and accepts the working request contract described in the plan, plus an optional `basePrompt` so editor settings can shape the provider request.

The real provider dependencies now include OpenAI, Gemini, and Anthropic behind the shared `apps/web/lib/server/patch-service.ts` contract. OpenAI remains the default provider in the current UI, and server env lookup supports `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY`.

Revision note (2026-03-05): updated this plan after adding real Gemini and Anthropic adapters, adding automated tests for the patch contract and provider path, and validating the workspace again with `npm run test`, `npm run typecheck`, and `npm run build`.
