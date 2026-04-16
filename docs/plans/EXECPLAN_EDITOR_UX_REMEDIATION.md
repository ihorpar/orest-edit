# Execute Editor UX Remediation for Workflow Clarity, Feedback, and Touch Safety

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

If `PLANS.md` is present in the repo, maintain this document in accordance with it and link back to it by path: `/mnt/c/Projects/oboz-ai/orest-edit/PLANS.md`.

## Purpose / Big Picture

The editor already supports the core product model: block-first manuscript editing, step-based review, local AI actions, fact-check tables, spellcheck, and diff-first recommendation application. The next implementation phase is not a feature reset. It is a UX remediation pass that makes the existing workflow explicit, predictable, and usable on both desktop and tablet-sized layouts.

After this change, a book editor using `/editor` should be able to understand, at a glance:
- what the current step is
- what action is primary right now
- whether the system is idle, running, successful, stale, empty, or failed
- what object a destructive action will affect
- how to recover from a mistake
- what the compact icon-based controls mean without relying on hover or browser `title`

The visible outcome should be a calmer, more legible editorial workstation. The manuscript remains primary, the step drawer remains secondary but informative, and the local composer remains compact. The difference is that workflow state, CTA hierarchy, touch affordance, and inline feedback become explicit enough that the product stops feeling like a powerful prototype and starts feeling like a trustworthy professional tool.

## Progress

- [x] (2026-03-26 07:00Z) Audited the live `/editor` experience against the UX guideline set and recorded concrete product issues.
- [x] (2026-03-26 07:10Z) Captured the remediation scope in `docs/PRD_EDITOR_UX_REMEDIATION_V1.md`.
- [x] (2026-03-26 07:18Z) Drafted this dedicated ExecPlan in `docs/plans/EXECPLAN_EDITOR_UX_REMEDIATION.md`.
- [x] (2026-03-26 15:32Z) Implemented a shared workflow-UI helper for feedback presentation, step CTA copy, and header status state in `apps/web/lib/editor/workflow-ui.ts`.
- [x] (2026-03-26 15:32Z) Replaced icon-only/ambiguous step-primary actions with explicit labeled header CTAs for diagnostics, fact-check, spellcheck, and recommendation steps.
- [x] (2026-03-26 16:12Z) Reworked destructive document/session actions into explicit inline confirmation and recovery flows with consequence copy, undo snapshots, and post-action recovery banners.
- [x] (2026-04-15 00:00Z) Consolidated the top-bar destructive action into a single `Очистити` control that clears manuscript text plus analysis/session artifacts, and removed the bottom-of-screen `Фокус:` status label from the block editor.
- [x] (2026-03-26 16:12Z) Removed the main hover-only help dependency from step config, surfaced active step labels directly in the mini-hub, and added explicit accessibility labels for critical icon-first editor controls.
- [ ] Raise high-frequency controls to tablet-safe hit targets and validate mixed-input behavior.
- [ ] Split shared step configuration/copy into step-specific UX modules so each step describes its actual job.
- [ ] Tighten fact-check/table scanning affordances and preserve orientation across responsive layouts.
- [x] (2026-03-26 15:32Z) Added regression coverage for the shared workflow-UI helper and validated milestone 1/2 with `npm run typecheck -w @orest/web` and `npm run test -w @orest/web` (105 passing tests).
- [ ] Validate the pass with runtime QA, touch-sized viewport checks, and updated handoff docs (completed: typecheck + unit tests + docs refresh for milestones 1-4; remaining: dedicated browser QA for destructive/recovery flows and touch behavior).

## Surprises & Discoveries

- Observation: the current editor already has most of the required workflow data, but the UI does not consistently surface it.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx` already computes spellcheck tone/labels, step run counts, completed-card counts, and multiple feedback states.

- Observation: success feedback is largely invisible even though the product sets it in state frequently.
  Evidence: `setFeedback({ tone: "info", ... })` is used throughout `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx`, but the drawer only renders feedback when `tone === "error"` near the recommendations section.

- Observation: the current step runner uses icon-only primary actions for most steps, which is efficient for repeat users but too implicit for first-run clarity.
  Evidence: diagnostics, fact-check, and recommendation steps derive `runStepButton` from compact icon buttons in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx`.

- Observation: touch affordances are below the comfort threshold for a professional tablet workflow.
  Evidence: runtime checks on an iPad-sized viewport measured step-rail icons at `40x40`, block toolbar controls at `30x30`, and row delete actions at `24x24`.

- Observation: the fact-check step currently reuses configuration primitives that describe downstream recommendation behavior rather than fact verification.
  Evidence: the fact-check settings area still renders shared `reviewModeSummary` and 1-5 level controls in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx`.

- Observation: the step mini-hub is compact and effective on desktop, but its labels disappear entirely in narrow layouts because hover tooltips are disabled.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/globals.css` hides `.step-review-mini-hub-tooltip` inside the mobile/tablet breakpoint.

- Observation: the local composer is functionally tied to the current selection, but visually detached from it because it is fixed to the bottom center of the viewport.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/editor/FloatingComposerPanel.tsx` renders the panel separately, and `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/globals.css` positions `.floating-bridge-shell` fixed at the viewport bottom.

- Observation: milestone 1 and 2 could be implemented without backend changes because the editor already had enough local state to derive user-visible step status and CTA semantics.
  Evidence: the new `apps/web/lib/editor/workflow-ui.ts` module consumes existing `page.tsx` state such as `reviewExpertise`, `factCheckRows`, `stepRunHistory`, `spellcheckMeta`, and `feedback`.

- Observation: reversible destructive actions can be implemented entirely in local editor state because the editor already persists a broad session snapshot model for draft continuity.
  Evidence: milestone 3 now captures and restores document, selection, workflow, spellcheck, and compare/session state directly inside `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx` without backend changes.

- Observation: milestone 4 mostly required changing where meaning is exposed, not inventing new interaction components.
  Evidence: the shipped changes rely on inline helper copy, visible active-step labels, and explicit `aria-label` coverage across icon-first controls rather than on a new tooltip system.

## Decision Log

- Decision: this remediation will preserve the current manuscript-left and review-right shell rather than replace it with a new information architecture.
  Rationale: the current shell already matches the product’s dense editorial workflow; the problem is clarity and affordance quality, not the existence of the split itself.
  Date/Author: 2026-03-26 / Codex

- Decision: each workflow step must expose one explicit primary action, even if a compact rerun icon is retained as a secondary affordance later.
  Rationale: predictable CTA placement is a core usability issue in the current audit and must be addressed directly.
  Date/Author: 2026-03-26 / Codex

- Decision: the remediation should create one shared UX state vocabulary across steps instead of patching each module independently.
  Rationale: idle/pending/success/stale/empty/zero-result/error distinctions recur across diagnostics, fact-check, spellcheck, local actions, and recommendations; treating them separately will recreate inconsistency.
  Date/Author: 2026-03-26 / Codex

- Decision: critical interactions must not depend on native `title` tooltips or hover discovery.
  Rationale: the product explicitly targets iPad-like editorial usage, and the current audit found several essential meanings that disappear without hover.
  Date/Author: 2026-03-26 / Codex

- Decision: destructive actions should prefer inline consequence clarity and undo/recovery over heavy confirmation modals where the action is reversible.
  Rationale: this aligns with the product’s trust goals and the UX guideline set provided for the audit.
  Date/Author: 2026-03-26 / Codex

- Decision: milestone 1 and 2 should land through a small shared view-model helper instead of another large `/editor`-local condition tree.
  Rationale: the UX remediation needs reusable state semantics; embedding more CTA/status logic directly in `page.tsx` would make later milestones harder to evolve and test.
  Date/Author: 2026-03-26 / Codex

- Decision: clear-document and reset-session actions will use inline confirmation panels plus local undo snapshots, not immediate execution or blocking modal flows.
  Rationale: both actions affect trust-sensitive editor state, but they are still safely reversible inside the current browser session. Inline confirmation keeps scope and consequence visible, while undo avoids forcing the user through extra modal friction.
  Date/Author: 2026-03-26 / Codex

- Decision: the top-bar destructive affordance should collapse into a single `Очистити` action that clears manuscript text and analysis/session artifacts.
  Rationale: separate clear/reset buttons were too close in meaning for the editor's primary audience, and the broader reset behavior is already reversible through the inline recovery snapshot.
  Date/Author: 2026-04-15 / Codex

- Decision: the block editor status strip should summarize selection state only and omit a standalone focus paragraph label.
  Rationale: the focus readout added visual noise at the bottom of the manuscript canvas without helping the main task, while paragraph-level targeting already remains available through the block surface and review cards.
  Date/Author: 2026-04-15 / Codex

- Decision: milestone 4 will treat accessibility labels and inline copy as the primary fallback for icon-first controls rather than adding a broad custom tooltip system.
  Rationale: the product already leans compact and icon-first. The immediate issue was hidden meaning on touch and hover-only help, which can be reduced materially by surfacing critical context inline and ensuring icon-only controls have explicit labels for assistive tech.
  Date/Author: 2026-03-26 / Codex

## Outcomes & Retrospective

Milestones 1 through 4 are complete.

Implemented:
- a shared `workflow-ui` helper now derives step CTA labels, header status state, and visible feedback presentation from existing editor state
- the step drawer header now shows explicit labeled primary actions instead of mostly icon-only run controls
- the step drawer now renders inline feedback for success and error outcomes, fixing the prior “info state exists but is invisible” gap
- destructive document/session actions now require inline confirmation, explain scope and consequence, and expose one-click session-local undo after execution
- the top-bar destructive action is now a single `Очистити` control that clears text plus analysis/session artifacts, and the block editor no longer shows a separate bottom `Фокус:` label
- step configuration help no longer depends on hover-only info icons, the active step label stays visible in the mini-hub, and critical editor icon controls now carry explicit accessibility labels
- the web test suite now includes focused coverage for the new workflow-UI helper

Remaining gaps:
- touch-target sizing and mixed-input ergonomics still need a dedicated milestone 5 pass
- fact-check still reuses shared configuration copy that should be split in a later milestone

Validation completed so far:
- `npm run typecheck -w @orest/web`
- `npm run test -w @orest/web`

Still not completed in this pass:
- dedicated browser QA for the new destructive/recovery flows
- touch-sized runtime validation after the accessibility/help cleanup

## Context and Orientation

The relevant product surface is the web editor at `/editor`, implemented in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx`.

The current editor has four major UX zones:

1. Top-level app and document actions:
   - top navigation and logout in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/layout/TopBar.tsx`
   - document import/export/reset controls rendered from `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx`

2. Manuscript editing surface:
   - block toolbar, paragraph gutter selection, row actions, inline diff anchors, and spellcheck underlines in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/editor/BlockEditorSurface.tsx`

3. Local action composer:
   - compact floating panel for `Правка`, `Правопис`, `Врізка`, and `Візуал` in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/editor/FloatingComposerPanel.tsx`

4. Step workspace and review drawer:
   - manuscript/drawer shell and icon mini-hub in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/layout/StepReviewWorkspaceShell.tsx`
   - per-step content, CTA logic, counters, fact-check table, spellcheck module, and card lists in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx`

The styling for these surfaces is centralized in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/globals.css`.

Terms used in this plan:

- Primary action: the main CTA a user should take next in the current step or surface.
- UX state model: the shared set of states the UI can expose, including idle, pending, success, stale, empty, zero-result, and error.
- Empty state: nothing has been run or created yet.
- Zero-result state: a run completed, but current conditions produced no findings.
- Stale state: the UI still shows earlier analysis, but the manuscript changed enough that the result should no longer be trusted.
- Local composer: the floating, selection-aware panel for local text actions, spellcheck, callout generation, and visual generation.
- Mini-hub: the narrow icon-first step navigation rail beside the drawer.
- Touch-safe: sized and spaced so controls can be activated reliably on an iPad-sized device without mouse precision.

The existing product constraints from `/mnt/c/Projects/oboz-ai/orest-edit/docs/PRD_V1.md` still apply:
- patch-first, not full-document rewrite by default
- diff-first review and application behavior
- localized Ukrainian UI
- manuscript remains the primary surface

This plan is informed by the UX remediation PRD in `/mnt/c/Projects/oboz-ai/orest-edit/docs/PRD_EDITOR_UX_REMEDIATION_V1.md`.

## Plan of Work

### Milestone 1: Define and centralize the shared UX state and feedback model

Start by identifying every user-visible state already computed in `/editor` and consolidating it into a shared vocabulary that can be rendered consistently across step modules and local actions. This work should avoid changing backend contracts first. The main goal is to stop duplicating similar states in ad hoc ways across diagnostics, fact-check, spellcheck, and recommendation steps.

This milestone likely requires extracting presentation-state helpers from `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx` into a view-model style module under `apps/web/lib/editor/`. That module should define stable state descriptors for:
- step run status
- local action status
- feedback tone and placement
- empty versus zero-result semantics
- stale-result semantics after manuscript change

Visible result: each step and local surface can render the same kinds of feedback and status copy without inventing unique one-off states.

### Milestone 2: Make primary actions explicit and step-specific

Replace or augment compact icon-only run controls so each step has one obvious primary CTA with clear labeling. Diagnostics, fact-check, spellcheck, and downstream recommendation steps should each describe their own next action in Ukrainian. If a rerun-only icon remains, it must become secondary, not the only visible primary affordance.

This work belongs primarily in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx` and the button styling in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/globals.css`. It may require a small reusable step-header action component so the CTA hierarchy stays consistent across step types.

Visible result: a new user can land on any step and understand what to click next without decoding the meaning of a refresh icon.

### Milestone 3: Fix feedback and destructive-action trust patterns

Implement one visible inline feedback region that can render success and error outcomes, not only failures. Apply it to local edit actions, spellcheck apply actions, import/export actions, and session/document clearing.

In the same milestone, rework destructive-action UX:
- `Очистити лише текст документа` must describe what it clears and what it preserves
- `Скинути` must describe that it resets the broader local session
- reversible actions should offer inline undo or equivalent fast recovery where technically safe

This work is centered in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx`, with possible support helpers in `apps/web/lib/editor/` if destructive actions need structured metadata.

Visible result: successful actions no longer disappear silently, and destructive actions feel controlled rather than risky.

### Milestone 4: Remove hover-only and `title`-only dependencies from critical interactions

Audit the toolbar, mini-hub, row actions, context help, and compact controls so the user can understand them without native browser tooltips. The remediation pattern should differ by context:
- visible labels for primary or high-risk actions
- styled product tooltips for secondary hints
- inline disclosure or helper copy when the user needs input-format guidance

Do not add verbose educational copy. The project rule is still that the app should stay concise and effect-focused.

This milestone will touch:
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/editor/BlockEditorSurface.tsx`
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/layout/StepReviewWorkspaceShell.tsx`
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/editor/FloatingComposerPanel.tsx`
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/globals.css`

Visible result: critical meaning survives without hover on desktop and remains available on touch devices.

### Milestone 5: Raise touch affordance quality for tablet and mixed-input use

Increase hit targets and spacing for high-frequency controls. Prioritize:
- mini-hub step buttons
- block toolbar buttons
- row-level actions such as delete
- local composer mode tabs and send controls
- drawer control chips and compact buttons

The work must also address hover-only reveal patterns. Row actions hidden until hover should gain a reliable touch fallback or always-visible mode when selection/focus is active. Responsive layout rules should preserve orientation rather than merely stacking content.

Visible result: the core editing and review workflow can be completed on an iPad-sized viewport without requiring precision taps or mouse-only discovery.

### Milestone 6: Split shared step configuration into step-specific UX modules

The current drawer reuses too much generic review configuration across very different step types. Extract the configuration rows, labels, help, and summary copy so diagnostics, fact-check, spellcheck, and card-generating steps each describe their own job.

Fact-check is the highest-priority example. Its settings panel should no longer mention card-oriented review summaries or generic recommendation framing if the current user task is claim verification.

This milestone likely requires either:
- step-specific drawer subcomponents under `apps/web/components/layout/`, or
- a step-config renderer module under `apps/web/lib/editor/` plus small presentation components

Visible result: the drawer never describes the wrong kind of work for the active step.

### Milestone 7: Improve fact-check/table scanability and responsive orientation

Keep the dedicated fact-check table model, but refine its comparison affordances. Evaluate sticky headers, row stability, better empty/zero-result messaging, and stronger spatial linkage back to the manuscript when a row requires follow-up.

At smaller widths, preserve navigation clarity when the drawer moves below the manuscript and the mini-hub becomes bottom-oriented. Essential step labels or active-state cues must remain understandable without hover.

Visible result: fact-check becomes easier to scan quickly, and the responsive layout remains oriented instead of becoming a stack of disconnected regions.

### Milestone 8: Re-anchor the local composer to selection context without bloating it

The current composer works, but it feels visually detached from the selected manuscript range. Improve the sense of locality by either:
- moving the composer closer to the active selection when feasible
- strengthening visual linkage between selection and composer
- adding explicit non-placeholder labels and context copy so the user can see what the composer will act on

This milestone must preserve the compact single-surface composer direction already adopted in the project. The remediation is about clarity, not returning to a larger mode-heavy shell.

Visible result: selecting text and invoking local actions feels directly connected to that text.

## Concrete Steps

Run all commands from `/mnt/c/Projects/oboz-ai/orest-edit`.

1. Baseline quality checks before starting:
   `npm run typecheck -w @orest/web`

   Expected result:
   - TypeScript completes with no errors.

2. Run focused unit coverage before and after each milestone batch:
   `npm run test -w @orest/web`

   Expected result:
   - Existing editor, review, local-action, and spellcheck suites pass.

3. Start a local dev server for runtime UX validation:
   `npm run dev -w @orest/web -- --hostname 127.0.0.1 --port 3100`

   Expected result:
   - Next.js starts on `http://127.0.0.1:3100`.

4. Authenticate through the app or directly through the login route:
   `curl -s -X POST http://127.0.0.1:3100/api/auth/login -H 'content-type: application/json' --data '{"password":"@orest0krat"}' -D -`

   Expected result:
   - Response is `200 OK` and sets `orest_app_session`.

5. Validate the following runtime scenarios in a browser:
   - Diagnostics step shows one obvious primary CTA.
   - Fact-check step shows step-specific configuration and correct empty-state copy.
   - Spellcheck shows idle, pending, success, and stale states distinctly.
   - Clearing document/session shows visible inline consequence/success feedback.
   - Step mini-hub remains understandable on desktop and on an iPad-sized viewport.
   - Local composer remains compact but clearly linked to the active selection.

6. Optional automated runtime pass after implementation:
   `APP_PASSWORD=@orest0krat npm run qa:inline-review -w @orest/web -- --url=http://127.0.0.1:3100 --no-screenshot`

   Expected result:
   - Existing workflow QA still passes after the UX remediation.

## Validation and Acceptance

The change is successful when all of the following are true:

- Every workflow step has one visible primary action that matches the active task in Ukrainian.
- Success and error outcomes are both rendered in-place where the user acted, not only in hidden state.
- Destructive actions clearly identify their consequence and expose a fast recovery path when reversible.
- Critical controls do not require browser `title` tooltips or hover-only discovery to be understood.
- Desktop and iPad-sized layouts both expose the core workflow without precision-target failures.
- Fact-check configuration and status copy describe fact verification rather than generic recommendation generation.
- Empty states and zero-result states are distinct in the drawer surfaces where they matter.
- The local composer remains compact while making scope and selection impact obvious.
- Keyboard focus remains visible across the remediated controls.

Minimum validation commands:
- `npm run typecheck -w @orest/web`
- `npm run test -w @orest/web`

Preferred additional validation:
- runtime browser check at desktop width
- runtime browser check at iPad-sized width
- existing inline-review QA if the updated UX still follows the covered workflow paths

## Idempotence and Recovery

This plan should be implemented in additive, testable slices. Each milestone can be landed independently if it leaves the user-facing workflow in a coherent state.

Safe retry guidance:
- keep shared UX state/view-model work additive first, then migrate one surface at a time
- do not remove old copy/state rendering until the replacement is visible and validated
- keep step-specific config extraction behind stable props so the main `/editor` page can be updated incrementally
- prefer CSS and component refactors that can be reverted per surface rather than one monolithic stylesheet rewrite

Rollback guidance:
- if a touch-target or CTA refactor breaks layout, revert that surface’s component and CSS block together
- if state-model extraction introduces regressions, temporarily route the affected surface back to the existing inline logic while preserving tests and docs

## Artifacts and Notes

Initial audit findings that motivated this plan:
- icon-only step-primary actions make first-run behavior ambiguous
- success feedback is set in state but not rendered consistently
- `Очистити` and `Скинути` execute with weak trust cues
- fact-check settings reuse copy from recommendation-generation flows
- mini-hub labels disappear on touch-sized layouts
- toolbar and row controls depend too heavily on hover and `title`
- touch targets are too small for a tablet-first professional workflow

Related documents:
- PRD: `/mnt/c/Projects/oboz-ai/orest-edit/docs/PRD_EDITOR_UX_REMEDIATION_V1.md`
- product constraints: `/mnt/c/Projects/oboz-ai/orest-edit/docs/PRD_V1.md`
- current handoff: `/mnt/c/Projects/oboz-ai/orest-edit/docs/CURRENT_STATE.md`

This plan intentionally stays inside the existing product architecture. It is not permission to redesign the editor into a different app.

## Interfaces and Dependencies

By the end of this work, the implementation should expose stable interfaces or modules for the following responsibilities:

- A shared editor UX state/view-model helper under `apps/web/lib/editor/` that can derive visible statuses and feedback descriptors for steps and local actions.
- A reusable step-header CTA pattern that can render explicit primary actions with consistent state handling.
- A reusable inline feedback surface that can render success and error outcomes in Ukrainian.
- Step-specific configuration/rendering helpers so diagnostics, fact-check, spellcheck, and card-generating review steps no longer rely on one generic settings block.
- Touch-safe styling tokens or shared CSS patterns for compact action controls across toolbar, mini-hub, local composer, and row actions.
- A tooltip/help pattern that does not depend on native browser `title` for essential product meaning.

The affected implementation will likely depend on these existing surfaces:
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx`
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/editor/BlockEditorSurface.tsx`
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/editor/FloatingComposerPanel.tsx`
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/layout/StepReviewWorkspaceShell.tsx`
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/globals.css`

Revision note:
- 2026-03-26: created from the UX remediation PRD so the audit can be executed as an implementation phase rather than remain a recommendations document.
