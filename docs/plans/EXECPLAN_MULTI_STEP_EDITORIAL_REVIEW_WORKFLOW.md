# Build Multi-Step Editorial Review Workflow For Ukrainian Science-Pop Manuscripts

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

## Purpose / Big Picture

The current editor already supports a two-phase whole-document review flow: one long-form expertise pass and one structured recommendation-card pass. The next implementation phase must turn that generic review into a step-based editorial workflow designed for Ukrainian science-pop and medical-pop book editors, with explicit support for diagnosis, fact-checking, structure, clarity, reader interest, visuals, formatting, and final copyediting.

After this change, a user on `/editor` can run a recommended sequence of review steps in Ukrainian, return to any previous step manually, preserve or replace previous step results, and carry forward focused feedback from one step into later steps without flooding every prompt with the entire prior analysis. Some steps remain review-only and produce no action cards. Other steps generate focused cards tied to concrete blocks. Fact-checking becomes a dedicated table-like review mode with simple rows (`Твердження`, `Статус`, `Пояснення та джерела`) instead of regular patch cards.

The UI shell for this workflow must align with the reference concept in `docs/concepts/optionA_resizable.html` and the provided screenshot: a resizable split between manuscript and analysis workspace, a compact icon-based step mini-hub with explicit completed/active states, and a flyout drawer that hosts the active step content while preserving fast step navigation.

The implementation must preserve the product’s core model: patch-first, diff-first, block-anchored editing, and Ukrainian-first UX. All step prompts and prompt contracts must be authored in Ukrainian. English is allowed only where scientific terminology or standard model-facing labels genuinely require it.

## Progress

- [x] (2026-03-12 00:00Z) Drafted a new ExecPlan for the multi-step editorial review workflow in `docs/plans/EXECPLAN_MULTI_STEP_EDITORIAL_REVIEW_WORKFLOW.md`.
- [x] (2026-03-12 00:00Z) Confirmed final step taxonomy and output contracts: `Діагностика` + `Факт-чек` are review-only, downstream steps are card-generating.
- [x] (2026-03-12 00:00Z) Added step-oriented review types/contracts in `review-contract.ts` and persisted per-step memory/history/mode in `draft-state.ts`.
- [x] (2026-03-12 00:00Z) Implemented step runner in `/editor` with per-step feedback context and `preserve vs replace` run history behavior.
- [x] (2026-03-12 00:00Z) Implemented the first production slice of the step-workspace shell on `/editor`: resizer, icon-first Lucide mini-hub with active/completed states, hover popups, and flyout drawer composition aligned to `docs/concepts/optionA_resizable.html`.
- [x] (2026-03-12 00:00Z) Added fact-check UI mode in the new drawer with table output (`Твердження`, `Статус`, `Пояснення та джерела`) and provider-native structured row parsing.
- [x] (2026-03-12 00:00Z) Replaced the old `ThreePaneShell + RightOperationsRail + modal EditorialReviewDrawer` path on `/editor` with a single integrated step workspace while preserving inline manuscript execution flows.
- [x] (2026-03-12 00:00Z) Implemented provider-native fact-check contract in `review-service.ts` (`rows[]` schema) and retained explicit `[image] alt/caption` serialization.
- [x] (2026-03-12 00:00Z) Implemented step-specific Ukrainian prompt set and wired step-specific backend execution (`diagnostics`, `fact_check`, `structure`, `clarity`, `interest`, `visuals`, `formatting`, `final_editing`).
- [x] (2026-03-14 00:00Z) Tightened `clarity` recommendation/execution prompts to forbid disclaimer injection, preserve list rhythm, and keep category-softening local to wording rather than safety boilerplate.
- [ ] Validate the workflow with full runtime QA and updated handoff docs (completed: typecheck + unit tests; remaining: runtime browser QA and resolving env-specific build diagnostics).

## Surprises & Discoveries

- Observation: the current app already has a strong architectural starting point for step-based review because whole-document review is already split into `expertise` and `cards`.
  Evidence: `apps/web/lib/editor/review-contract.ts` defines `ReviewSessionStatus = "expertise" | "cards"`, and `apps/web/lib/server/review-service.ts` builds separate system and user prompts for those two modes.

- Observation: local draft persistence now stores step-run memory (`reviewExpertise`, `factCheckRows`, per-step feedback, run mode, run history) in addition to cards/diagnostics.
  Evidence: `apps/web/lib/editor/draft-state.ts` now persists `stepRunHistory`, `stepFeedback`, `stepRunModeByStep`, `reviewExpertise`, `factCheckRows`, and `activeWorkflowStep`.

- Observation: image blocks already expose enough textual metadata for analysis without sending the image binary itself.
  Evidence: `apps/web/lib/editor/document-model.ts` serializes image blocks through `alt` and `caption`, and `blockToPromptText()` already has a distinct `[image] alt: ...; caption: ...` representation that can be reused for review prompts.

- Observation: current visual generation already distinguishes user-facing `інфографіка` vs `ілюстрація`, while choosing an infographic subtype internally.
  Evidence: `apps/web/lib/editor/review-contract.ts` limits `EditorialVisualIntent` to `infographic | illustration`, and `apps/web/lib/server/review-action-service.ts` infers `comparison`, `process`, `timeline`, `cause_effect`, `layers`, or `diagram`.

- Observation: the concept file already encodes key UX behaviors needed for dense step outputs such as fact-check tables.
  Evidence: `docs/concepts/optionA_resizable.html` includes a draggable splitter, constrained drawer widths, horizontal table scrolling in narrow widths, a fixed mini-hub, and icon state styling for active/completed steps.

- Observation: replacing `ThreePaneShell` with an integrated workspace on `/editor` can preserve current review execution behavior without touching `BlockEditorSurface` contracts.
  Evidence: `apps/web/app/editor/page.tsx` now renders `StepReviewWorkspaceShell` while still wiring existing review callbacks (`prepare`, `apply`, `dismiss`, inline proposal editing) into `BlockEditorSurface`.

- Observation: provider-native fact-check rows are now enforced through model JSON schemas for OpenAI/Gemini and JSON parsing for Anthropic, eliminating UI-side heuristic extraction.
  Evidence: `apps/web/lib/server/review-service.ts` now defines `openAiFactCheckSchema` / `geminiFactCheckSchema` and returns `factCheckRows` directly in `EditorialReviewResponse`.

- Observation: diagnostics no longer generates recommendation cards directly; CTA now advances user into fact-check where execution is explicit.
  Evidence: `apps/web/app/editor/page.tsx` diagnostics section now triggers only `requestWorkflowStep("diagnostics")` and offers `До факт-чеку` CTA, while fact-check has its own run button.

- Observation: production build currently fails with generic webpack termination in this environment while `typecheck` and test suites pass.
  Evidence: `npm run typecheck -w @orest/web` passes; `npm run test -w @orest/web` passes; `npm run build -w @orest/web` exits with `Build failed because of webpack errors` without surfaced stacktrace.

- Observation: `clarity` prompts were permissive enough to let models "solve" categorical medical phrasing by appending generic consultation/self-diagnosis warnings instead of editing the local wording.
  Evidence: the previous `clarity` step spec in `apps/web/lib/server/review-service.ts` and replace prompt assembly in `apps/web/lib/server/review-action-service.ts` prohibited new facts but did not explicitly ban disclaimer boilerplate or require preservation of short-list rhythm.

## Decision Log

- Decision: keep the new review flow as one recommended sequence of discrete steps rather than one giant prompt that returns narrative analysis, fact-check rows, and action cards at once.
  Rationale: this reduces user overload, keeps prompts narrower, and matches the existing `expertise -> cards` architecture.
  Date/Author: 2026-03-12 / Codex

- Decision: treat `Діагностика` as review-only and `Факт-чек` as a dedicated review table rather than normal recommendation cards.
  Rationale: both steps are primarily evaluative and should not force edit proposals before the editor has aligned on direction.
  Date/Author: 2026-03-12 / Codex

- Decision: author all prompts in Ukrainian, allowing English only for unavoidable scientific terms, product-internal enum names, or provider-required labels.
  Rationale: the editor UI, manuscript language, and target user mental model are Ukrainian-first; mixed-language prompts should be the exception, not the default.
  Date/Author: 2026-03-12 / Codex

- Decision: keep `схема` as a user-facing infographic subtype label and rename internal `cause_effect` to user-facing `причини та наслідки`.
  Rationale: `схема` is acceptable and broad enough for editors, while `причини та наслідки` is clearer than the symbolic arrow phrasing in user-facing UI.
  Date/Author: 2026-03-12 / Codex

- Decision: use the `optionA_resizable` shell as the baseline interaction pattern for the new multi-step workspace.
  Rationale: the pattern solves the main UX risks for long analyses and wide fact-check tables while keeping step navigation compact and always available.
  Date/Author: 2026-03-12 / Codex

- Decision: keep the step navigation icon-first with Lucide icons and explicit state affordances (completed, active, hover label).
  Rationale: this matches the requested professional-editor visual language and keeps the step rail compact without sacrificing clarity.
  Date/Author: 2026-03-12 / Codex

- Decision: ship the UI-shell integration first and map existing review outputs into step views before introducing new step-specific backend prompt contracts.
  Rationale: this de-risks UX integration and keeps current recommendation execution working while step-specific model contracts are introduced incrementally.
  Date/Author: 2026-03-12 / Codex

- Decision: require explicit user-triggered execution per step; diagnostics does not auto-generate cards.
  Rationale: this keeps cognitive load predictable and avoids mixing review-only and action outputs in one pass.
  Date/Author: 2026-03-12 / Codex

- Decision: preserve/replace behavior is implemented as a formal per-step run mode persisted in local draft state.
  Rationale: editors can keep prior runs for comparison or intentionally overwrite prior results without losing control of context flow.
  Date/Author: 2026-03-12 / Codex

- Decision: `clarity`/`rewrite`/`simplify` prompts must explicitly forbid generic medical disclaimers and keep category-softening local to wording changes.
  Rationale: otherwise models tend to replace editorial clarity with risk-management boilerplate, which violates patch-first editing and degrades list readability.
  Date/Author: 2026-03-14 / Codex

## Outcomes & Retrospective

Implemented full step-aware execution for editorial review on `/editor`: each step runs independently with its own prompt contract, diagnostics context propagation, and persisted `preserve/replace` run mode. Diagnostics is now review-only with explicit CTA to fact-check; fact-check returns structured provider-native rows; downstream steps generate step-tagged recommendation cards tied to existing execution lane behavior.

`Clarity` prompt contracts are now materially tighter: recommendation generation distinguishes wording work from safety boilerplate, and replace prompts explicitly forbid template warnings like “зверніться до лікаря”, “самодіагностика”, or “варто перевірити стан” unless the editor asked for them. Prompt guidance now also preserves short list rhythm instead of rewarding mini-paragraph expansion for each item.

Step memory and persistence are now formalized in contracts (`EditorialReviewStepId`, step contexts, fact-check row type, run snapshots) and local draft state (`reviewExpertise`, `factCheckRows`, per-step feedback, run mode, run history, active step). Image blocks continue to be passed as explicit `[image] alt/caption` markers in prompt assembly.

What remains: runtime browser QA pass for full workflow interactions and investigation of environment-specific webpack build failure where `next build` stops with generic `Build failed because of webpack errors` and no stacktrace.

## Context and Orientation

The current app is a Next.js web editor under `apps/web`. The main editor screen lives in `apps/web/app/editor/page.tsx`. The canonical manuscript model is `EditorDocument` in `apps/web/lib/editor/document-model.ts`, where each paragraph-like unit is a first-class block with a stable block ID. Whole-document review already exists through `/api/edit/review`, backed by `apps/web/lib/server/review-service.ts`. Review recommendations use block-anchored contracts from `apps/web/lib/editor/review-contract.ts`. Recommendation execution lives in `apps/web/lib/server/review-action-service.ts`.

Several current implementation details matter directly to this plan:

`reviewExpertise` is long-form Markdown analysis shown in `Діагностика`. `factCheckRows` represent structured fact-check output rows. `reviewItems` are structured block-anchored recommendations for card-generating steps. The app now persists per-step run history and feedback in browser local storage through `apps/web/lib/editor/draft-state.ts`, including preserve/replace run mode semantics.

The existing recommendation taxonomy is still oriented around edit execution: `rewrite`, `expand`, `simplify`, `list`, `subsection`, `callout`, and `visual`. This plan does not replace that execution taxonomy. Instead, it introduces a new outer layer: editorial review steps. A step decides what kind of review to run, what prompt contract to use, whether the output is review-only or review-plus-cards, and how much context from prior steps is passed forward.

For this plan, the following terms are used consistently:

- Step: one editorial review pass such as `Діагностика` or `Ясність`.
- Review-only step: a step that returns narrative analysis or table rows, but no executable recommendation cards.
- Card-generating step: a step that can return block-anchored recommendation cards that the existing editor execution flows can consume.
- Step memory: local browser-stored structured memory about prior step runs, user feedback, and accepted/rejected directions.
- Step run: one execution of a step against one document revision, with a stored result and metadata.
- Fact-check row: a non-card output row with columns `Твердження`, `Статус`, and `Пояснення та джерела`.
- Infographic subtype: a user-facing choice for an infographic composition such as `авто`, `порівняння`, `процес`, `таймлайн`, `причини та наслідки`, or `схема`.
- Resizer: the draggable vertical splitter between manuscript viewport and review workspace.
- Mini-hub: the narrow icon rail used for step navigation and state display.
- Flyout drawer: the expanded active-step panel adjacent to the mini-hub that contains detailed step content.

The target step order for this implementation is:

1. `Діагностика`
2. `Факт-чек`
3. `Структура`
4. `Ясність`
5. `Інтерес і застосовність`
6. `Візуали`
7. `Форматування`
8. `Фінальна редактура`

The recommended order must be visible in the product, but the user must also be able to jump back to any prior step and rerun it manually.

The target UI behavior for that order is:

- the manuscript remains the primary reading surface;
- step content is shown in a flyout review workspace;
- the user can resize manuscript vs review width with a visible drag handle;
- the mini-hub remains pinned and usable while the drawer content changes by active step;
- icon states are semantically consistent: completed steps show success state, active step is visually elevated, and hover reveals compact step labels.

## Plan of Work

### Milestone 1: Define the step model and the persistence model before touching the UI

Start by extending the review domain model so the app can represent step-based analysis explicitly instead of overloading the current `expertise/cards` booleans. `apps/web/lib/editor/review-contract.ts` should define stable step identifiers, step result kinds, fact-check row contracts, step run metadata, and user feedback structures. `apps/web/lib/editor/draft-state.ts` should then persist enough data to survive refreshes and support reruns: the current result per step, recent previous runs, user feedback per step, and a staleness marker tied to `documentRevisionId`.

This milestone must also decide which step outputs stay outside the existing recommendation-card pipeline. `Діагностика` and `Факт-чек` should not be forced into `EditorialReviewItem[]`; instead, they should have dedicated result types and persistence entries. Card-generating steps should still be able to reuse `EditorialReviewItem[]` and the existing execution lane.

The result of this milestone is a coherent step-oriented contract that later React and server changes can target without inventing ad hoc shape changes in multiple places.

### Milestone 2: Build focused context propagation instead of dumping all previous analysis into every prompt

Once step contracts exist, implement a step memory builder in the review request pipeline. The core rule is that later steps should inherit only the relevant summary and editor feedback from earlier steps. For example, `Структура` should see structure-related findings and accepted/rejected structure directions; `Ясність` should see clarity-related findings; `Візуали` should see only visual cues and visual preferences. `Факт-чек` should remain mostly independent of subjective editorial feedback, except for optional strictness controls.

This work belongs primarily in `apps/web/lib/server/review-service.ts`, with helper utilities extracted into a new module if needed, for example `apps/web/lib/editor/review-step-memory.ts`. The memory builder must compress prior results into short, category-specific prompt inserts rather than passing entire previous markdown analyses. It must also distinguish between:

- accepted directions,
- rejected directions,
- unresolved disagreements,
- reusable step summaries,
- stale step runs that should not be trusted after document edits.

The result of this milestone is a predictable and bounded prompt context model that improves coherence without blowing up token usage.

### Milestone 3: Author a complete Ukrainian prompt suite for each step and each output mode

Prompt work is a first-class milestone, not a follow-up. The repo currently has generic expertise and card prompts in `apps/web/lib/editor/settings.ts`. This change requires a dedicated Ukrainian prompt set for the new step taxonomy. Prompts must be authored in Ukrainian because the target manuscript language, UI language, and editorial judgments are Ukrainian-first. English should appear only for unavoidable scientific terms or stable technical labels that must remain unchanged.

At minimum, create or refactor prompt factories for:

- `Діагностика` review-only prompt
- `Факт-чек` review-only prompt with table-row output contract
- `Структура` review prompt and optional card-generation prompt
- `Ясність` review prompt and card-generation prompt
- `Інтерес і застосовність` review prompt and card-generation prompt
- `Візуали` card-generation prompt, including explicit infographic subtype handling
- `Форматування` review and card-generation prompt
- `Фінальна редактура` review-only or constrained correction-card prompt, depending on implementation choice

This milestone must also improve the prompt-writing discipline around book-scale Ukrainian science-pop editing:

- require block-linked references in Ukrainian paragraph labels,
- preserve uncertainty instead of overclaiming,
- avoid importing outside facts except where the fact-check step explicitly requires external verification behavior,
- treat image captions as part of the document context,
- keep execution-card prompts separate from review-step prompts.

The result of this milestone is a prompt system detailed enough that implementation quality does not depend on one generic “review prompt” blob.

### Milestone 4: Implement step runners, rerun behavior, and local history management

With the contracts and prompts in place, modify `apps/web/app/editor/page.tsx` and the relevant editor components so each step can be run, rerun, resumed, replaced, or archived locally. The minimum user behaviors are:

- run a step,
- see the current result,
- leave feedback on that step,
- rerun the same step with that feedback,
- decide whether to preserve the previous run or replace it,
- revisit previous steps later,
- detect when a step result is stale because the manuscript changed.

This milestone will likely require extracting the current whole-text review state in `page.tsx` into a more structured step-based reducer or controller module. The implementation may stay local-state-based, but it must avoid scattering step logic through many independent `useState` variables if that makes rerun/archive/replace semantics fragile.

The result of this milestone is one coherent step runner that makes multi-run editorial analysis understandable and resilient.

### Milestone 5: Implement the step workspace shell and visual state system

Implement the UI shell aligned with `docs/concepts/optionA_resizable.html` and the provided screenshot.

This includes:

- a resizable split layout between manuscript and review workspace with bounded min/max widths;
- a fixed mini-hub using Lucide icons instead of emoji labels;
- explicit icon states for `completed`, `active`, and `idle`;
- compact dark hover popups for step names on the narrow rail;
- a flyout drawer that hosts active-step content while the mini-hub remains pinned.

For consistency with current product rules, all user-facing UI text in this shell must be Ukrainian. Any helper hints should remain concise and avoid explanatory filler copy.

The result of this milestone is a usable, dense-information workspace that can handle long analyses and fact-check tables without collapsing manuscript readability.

### Milestone 6: Implement dedicated outputs for fact-checking and image-aware review serialization

The fact-check step needs a dedicated output shape and display mode. It should produce simple rows with these user-facing columns:

- `Твердження`
- `Статус`
- `Пояснення та джерела`

The internal contract should still preserve machine-readable fields for status and provenance, but the UI must stay simple and table-like. The valid statuses should stay compact and human-readable, for example `ok`, `сумнівно`, and `не підтверджено`.

In the same milestone, update prompt serialization so image blocks are clearly marked as images in whole-document review input. Instead of flattening an image caption into undifferentiated text, reuse or adapt the existing block representation from `blockToPromptText()` so prompts see forms like `[image] alt: ...; caption: ...`.

The result of this milestone is a cleaner fact-check experience and more accurate context for structure, clarity, and visual analysis.

### Milestone 7: Integrate the new steps with the existing card execution system

Card-generating steps must ultimately feed the existing patch/callout/visual/subsection execution flows rather than creating an entirely parallel system. This milestone maps the outer step layer onto the inner recommendation taxonomy:

- `Структура` may emit `subsection`, `list`, `rewrite`, or `callout`.
- `Ясність` may emit `simplify`, `rewrite`, `expand`, or `list`.
- `Інтерес і застосовність` may emit `callout`, `expand`, `rewrite`, or `visual`.
- `Візуали` primarily emits `visual`.
- `Форматування` may emit `list`, `callout`, `subsection`, `visual`, and later `table` if the product grows a dedicated review type for that.

This milestone must preserve today’s block-anchored safety rules, range guards, and execution-lane behavior. It should not reintroduce whole-document rewrites or free-form suggestion payloads.

The result of this milestone is that the new step model drives the existing manuscript execution surface instead of bypassing it.

### Milestone 8: Validate behavior, update docs, and record product decisions

Finish by expanding tests and runtime QA so this new workflow can be trusted. Add unit coverage for step contracts, prompt-memory building, rerun/replace persistence semantics, stale-step detection, and fact-check parsing/normalization. Extend runtime QA to cover at least one review-only step, one fact-check step, and one card-generating step.

If implementation confirms durable product behavior changes, update `docs/CURRENT_STATE.md` and record durable architecture or product decisions in `docs/DECISIONS_LOG.md`. This plan file must also be updated with real implementation progress, discoveries, and outcomes as work proceeds.

The result of this milestone is a shippable, documented feature rather than an untracked prototype.

## Concrete Steps

All commands below assume the working directory is `/mnt/c/Projects/oboz-ai/orest-edit`.

1. Inspect the current review contracts and persistence:

    sed -n '1,260p' apps/web/lib/editor/review-contract.ts
    sed -n '1,240p' apps/web/lib/editor/draft-state.ts
    sed -n '330,430p' apps/web/app/editor/page.tsx

   Expected outcome: confirm where `expertise`, `cards`, local history, and review state are currently stored.

2. Add step-domain types and persistence fields:

    npm run typecheck -w @orest/web

   Expected outcome: type errors point only to places still using the legacy review model.

3. Implement server-side step prompt builders and memory compression helpers:

    npm run test -w @orest/web -- review-service

   Expected outcome: step prompt builder and normalization tests pass.

4. Implement page/controller state and step rerun behavior:

    npm run test -w @orest/web -- review-execution-lane

   Expected outcome: step transitions, replacement, and stale-state handling are covered.

5. Implement step-workspace shell (resizer + mini-hub + flyout drawer):

    npm run typecheck -w @orest/web

   Expected outcome: shell state types compile and no existing editor interactions regress.

6. Implement fact-check mode and image-aware serialization:

    npm run test -w @orest/web -- review-contract

   Expected outcome: fact-check rows normalize correctly and image blocks are serialized with explicit markers.

7. Validate the integrated editor:

    npm run typecheck -w @orest/web
    npm run build -w @orest/web
    npm run test -w @orest/web
    npm run qa:inline-review -w @orest/web

   Expected outcome: typecheck, build, unit tests, and browser QA all pass without regressing the existing inline execution flow.

## Validation and Acceptance

The implementation is acceptable only if all of the following are true:

The editor exposes the eight-step review sequence in Ukrainian and allows manual return to any previous step. Running `Діагностика` produces a detailed Ukrainian analysis that is at least as informative as the current expertise output and does not automatically generate recommendation cards. Running `Факт-чек` produces table-like rows with `Твердження`, `Статус`, and `Пояснення та джерела`, not regular edit cards. Running a card-generating step such as `Ясність` or `Візуали` can still produce executable block-anchored recommendation cards that reuse the current execution lane.

The workspace layout supports user-controlled width balancing between manuscript and analysis via a drag resizer. The step mini-hub is icon-first (Lucide), stays pinned, and exposes clear states: completed steps show success highlighting, the active step is visually elevated, and hover on narrow rail reveals readable step labels via popup. The flyout drawer contains active-step content without hiding the mini-hub.

Later steps use only focused prior context rather than the full previous analysis blob. User feedback on a step can affect reruns of that step and relevant downstream steps. Re-running a step lets the app either preserve the previous local result or replace it. If the document changes materially, older step runs are marked stale rather than silently treated as current.

Whole-document review prompts include image block metadata in explicit `[image] alt: ...; caption: ...` form. All newly introduced review prompts are written in Ukrainian, with English terms used only where unavoidable.

The following commands must succeed:

    npm run typecheck -w @orest/web
    npm run build -w @orest/web
    npm run test -w @orest/web
    npm run qa:inline-review -w @orest/web

Expected outputs include a successful Next.js production build, green unit tests, and a passing authenticated browser QA run that confirms the manuscript execution lane still works.

## Idempotence and Recovery

This work must be implemented additively and safely. The new step model should coexist with the existing review execution taxonomy until migration is complete. Persisted local storage should use versioned keys or migration-aware shapes so old drafts do not break the editor. If a step-specific UI path is incomplete, the app should fail safely by hiding that mode or falling back to read-only output rather than generating malformed cards.

Rerunning a step must never delete prior results implicitly. Replacement should be an explicit action. Preservation should default to local storage only; no server persistence is assumed in this repo. If a prompt contract change breaks provider parsing, the UI should surface a readable fallback or draft result instead of crashing the review drawer or manuscript surface.

## Artifacts and Notes

Relevant current files:

    apps/web/app/editor/page.tsx
    apps/web/lib/editor/review-contract.ts
    apps/web/lib/editor/draft-state.ts
    apps/web/lib/editor/settings.ts
    apps/web/lib/server/review-service.ts
    apps/web/lib/server/review-action-service.ts
    apps/web/lib/editor/document-model.ts
    docs/concepts/optionA_resizable.html
    docs/CURRENT_STATE.md
    docs/DECISIONS_LOG.md

Suggested future implementation notes to capture here as work proceeds:

    - Example step run JSON shape
    - Example fact-check normalized row
    - Example compressed step memory passed into a later prompt
    - Example stale-step marker after a manuscript edit
    - Screenshot parity notes against the approved step-workspace concept

## Interfaces and Dependencies

At the end of implementation, the repo should contain stable interfaces for:

- a step identifier enum or union under `apps/web/lib/editor/review-contract.ts`;
- a persisted step-run model under `apps/web/lib/editor/draft-state.ts`;
- a fact-check row model under `apps/web/lib/editor/review-contract.ts`;
- a step-memory builder that maps prior runs and user feedback into prompt-ready summaries;
- step-specific prompt builders in `apps/web/lib/server/review-service.ts` or a new adjacent prompt module;
- page-level state and handlers in `apps/web/app/editor/page.tsx` that can run, rerun, preserve, replace, and mark stale per-step results;
- UI components for review-only step output, fact-check rows, and card-generating step output without breaking the existing manuscript execution lane.
- a resizable step-workspace shell with mini-hub, flyout drawer, and step icon states consistent with `docs/concepts/optionA_resizable.html`.

The existing dependencies remain the same: Next.js app routing, browser local storage for draft persistence, provider-backed review generation in `/api/edit/review`, and block-anchored execution through the current patch/review action services.

Revision note (2026-03-12): created this new ExecPlan to cover the proposed multi-step review workflow instead of modifying the currently active inline-execution plan, because this is a new implementation phase with different product behavior and prompt architecture.

Revision note (2026-03-12): updated the plan to include the approved UX/UI concept baseline from `docs/concepts/optionA_resizable.html` and the screenshot-driven requirements for resizer, icon-first mini-hub states, tooltip popups, and flyout drawer behavior.
