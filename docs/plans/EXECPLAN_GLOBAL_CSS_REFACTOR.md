# Execute Global CSS Refactor via Ordered Extraction and Feature Ownership

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

If `PLANS.md` is present in the repo, maintain this document in accordance with it and link back to it by path: `C:\Projects\oboz-ai\orest-edit\PLANS.md`.

## Purpose / Big Picture

The web app currently loads one root stylesheet, `C:\Projects\oboz-ai\orest-edit\apps\web\app\globals.css`, for the entire product. That file has grown into a multi-generation styling bundle with layout passes, editor systems, review systems, overlays, settings, auth, and utilities layered in source-order. The problem is no longer just file size. The real issue is ownership: styling behavior depends on remembering where later override waves appear in the file, which makes product changes slower and riskier.

After this refactor, the app should still look and behave the same in runtime, but the styling system should be understandable and maintainable. Contributors should be able to answer three questions quickly: which file owns a feature, which styles are truly global, and which areas are safe to migrate to CSS Modules later. The first implementation phase is intentionally conservative: split the stylesheet into ordered global partials without changing selectors or visual behavior. Only after that should isolated surfaces begin moving to CSS Modules.

## Progress
- [x] (2026-04-04 00:00Z) Audited `apps/web/app/globals.css` and mapped its major styling regions, coupling risks, and candidate ownership boundaries.
- [x] (2026-04-04 00:00Z) Drafted this ExecPlan in `docs/plans/EXECPLAN_GLOBAL_CSS_REFACTOR.md`.
- [x] (2026-04-04 00:00Z) Created the first bounded extraction pass by moving login-route styles into `apps/web/app/styles/auth.css` and the later settings redesign block into `apps/web/app/styles/settings.css`, then importing both from `apps/web/app/layout.tsx`.
- [x] (2026-04-04 00:00Z) Extracted `TopBar` styling into `apps/web/app/styles/layout.css`, including the later responsive topbar override block, while keeping the rest of the responsive shell in `globals.css`.
- [x] (2026-04-04 00:00Z) Consolidated base primitives into `apps/web/app/styles/foundation.css`, including tokens, reset rules, button helpers, accessibility helpers, and shared form/select/toggle styles.
- [x] (2026-04-04 00:00Z) Externalized sidebar and review-chat families into `apps/web/app/styles/sidebar.css` and `apps/web/app/styles/review-chat.css`, then removed duplicated late-stage sidebar/review-chat blocks from `apps/web/app/globals.css`.
- [x] (2026-04-04 00:00Z) Moved the legacy review drawer, review-analysis, and `step-review-prototype-*` families into `apps/web/app/styles/overlays.css`, then removed the duplicated block from `apps/web/app/globals.css`.
- [x] (2026-04-04 00:00Z) Added `apps/web/app/styles/review.css`, imported it from `apps/web/app/layout.tsx`, and moved the main review-card, detail, proposal, visual-style, and compact-card families out of `apps/web/app/globals.css`.
- [x] (2026-04-04 00:00Z) Added `apps/web/app/styles/floating.css`, imported it from `apps/web/app/layout.tsx`, and moved the full floating composer family out of `apps/web/app/globals.css`, including panel shell, bridge/local surfaces, spellcheck results, review-mode theming, and feature-owned responsive overrides.
- [x] (2026-04-04 00:00Z) Added `apps/web/app/styles/step-review.css`, imported it from `apps/web/app/layout.tsx`, and moved the step-review workspace, drawer, spellcheck, fact-check, context/config, and emphasis-module families out of `apps/web/app/globals.css`.
- [x] (2026-04-04 00:00Z) Added `apps/web/app/styles/editor.css`, imported it from `apps/web/app/layout.tsx`, and moved the editor control, block-editor surface, spellcheck/emphasis, and inline-diff editor families out of `apps/web/app/globals.css`.
- [x] (2026-04-04 00:00Z) Extended `apps/web/app/styles/editor.css` with the manuscript support and runtime/editor layer, including the manuscript toolbar helpers, selection/request-status surfaces, `cm-orest-*` runtime styles, and the inline manuscript diff/editing surface.
- [x] (2026-04-04 00:00Z) Moved the rail prompt stack/input pair into `apps/web/app/styles/sidebar.css` so the right-rail content owner now owns that small prompt surface.
- [x] (2026-04-04 00:00Z) Corrected the accidental shell/editor ownership drift from the rail extraction by moving the page shell layout rules into `apps/web/app/styles/layout.css` and the manuscript preview surfaces into `apps/web/app/styles/editor.css`, leaving `apps/web/app/styles/sidebar.css` focused on rail content.
- [x] (2026-04-04 00:00Z) Validated the extraction state with `npm run build -w @orest/web` and `npm run typecheck -w @orest/web`.
- [x] (2026-04-04 00:00Z) Manually verified extracted auth, settings, topbar, overlay, review, and sidebar slices in runtime on `/login`, `/settings`, and `/editor` between extraction passes.
- [x] (2026-04-04 00:00Z) Continued the zero-visual-change extraction pass by isolating the full step-review surface into `apps/web/app/styles/step-review.css` and removing the matching selectors from `apps/web/app/globals.css` without changing the runtime cascade.
- [x] (2026-04-04 00:00Z) Continued the zero-visual-change extraction pass by isolating the editor control, manuscript runtime, and block-editor surfaces into `apps/web/app/styles/editor.css` while keeping shared shell and overlay primitives in their current owners.
- [x] (2026-04-04 00:00Z) Continued the zero-visual-change extraction pass by moving the rail prompt stack/input pair into `apps/web/app/styles/sidebar.css`.
- [x] (2026-04-04 00:00Z) Continued the zero-visual-change extraction pass by moving the page shell layout rules into `apps/web/app/styles/layout.css` and the manuscript preview surfaces into `apps/web/app/styles/editor.css`, preserving the runtime cascade while correcting the accidental sidebar overlap from the prior pass.
- [ ] Continue the zero-visual-change extraction pass for the remaining shell-responsive and manuscript-bridge regions in `apps/web/app/globals.css` while preserving cascade behavior.
- [ ] Validate the newly extracted floating slice in runtime on `/editor`, with emphasis on desktop/mobile composer states and review-mode variants.
- [ ] Remove or isolate obvious legacy/prototype style regions only after extraction and runtime verification prove they are unused or superseded.
- [ ] Define and begin the first CSS Module migration wave for isolated surfaces such as top bar, login, and settings.

## Surprises & Discoveries
- Observation: the stylesheet is large because it contains multiple historical redesign waves, not just many active components.
  Evidence: `apps/web/app/globals.css` contains explicit pass markers such as `Simplified editor layout overrides`, `Interaction cleanup pass`, `Utility rail pass`, `Responsive shell overhaul`, `Settings redesign`, and `Editorial Review Chat Overhaul`.

- Observation: the main coupling risk is repeated redefinition of the same selectors across distant sections.
  Evidence: audit findings identified repeated definitions or override clusters for `.editor-layout`, `.floating-panel`, `.editorial-review-card`, `.editorial-review-detail`, and related responsive variants inside `apps/web/app/globals.css`.

- Observation: the codebase already has strong feature ownership signals in React, even though the CSS is still centralized.
  Evidence: `TopBar.tsx`, `FloatingComposerPanel.tsx`, `BlockEditorSurface.tsx`, `StepReviewWorkspaceShell.tsx`, `RightOperationsRail.tsx`, `login/page.tsx`, and `settings/page.tsx` all align with distinct class families found in `apps/web/app/globals.css`.

- Observation: responsive behavior is fragmented by repeated breakpoint clusters rather than being owned cleanly by feature files.
  Evidence: the audit found the `1220px` breakpoint repeated several times in different parts of `apps/web/app/globals.css`, often affecting overlapping selectors.

- Observation: a staged extraction can work safely even before the full style directory exists, as long as the moved slice has low overlap with later selectors.
  Evidence: moving `auth` and the late `settings redesign` region into `apps/web/app/styles/auth.css` and `apps/web/app/styles/settings.css` kept `npm run typecheck -w @orest/web` and `npm run build -w @orest/web` green.

- Observation: `TopBar` is a good early extraction target because it has one base cluster and one later override cluster, with little overlap with editor-state styling.
  Evidence: `apps/web/app/globals.css` defined the topbar family in an early block and then again in the later `Responsive shell overhaul` block; moving both into `apps/web/app/styles/layout.css` still kept build validation green.

- Observation: the existing scaffold can drift into duplicate ownership if partials are added before the corresponding `globals.css` subtraction is finished.
  Evidence: during this pass, `sidebar.css`, `review-chat.css`, `overlays.css`, and `utilities.css` were already present and imported before all duplicated blocks were removed from `apps/web/app/globals.css`, so the work had to shift from pure extraction into consolidation.

- Observation: `npm run typecheck -w @orest/web` can fail transiently when `.next/types` has not been freshly regenerated in the current environment.
  Evidence: TypeScript reported missing `.next/types/...` files until `npm run build -w @orest/web` completed; rerunning typecheck immediately after the successful build passed cleanly.

- Observation: some partials initially inherited selectors that were also still declared in other extracted files, so ownership cleanup had to follow immediately after extraction.
  Evidence: `.review-sidebar-body` existed in both `apps/web/app/styles/review-chat.css` and the moved review-drawer block; consolidation left that selector owned by `apps/web/app/styles/overlays.css` only.

- Observation: a broad rail extraction can accidentally pull shell/editor chrome into the wrong partial, so the next pass may need to redistribute selectors across sibling owners before the globals file is reduced.
  Evidence: the rail extraction temporarily moved `editor-layout`, `left-pane`, `right-pane`, `center-pane`, and manuscript preview selectors into `apps/web/app/styles/sidebar.css`; those selectors were then corrected into `apps/web/app/styles/layout.css` and `apps/web/app/styles/editor.css`.

- Observation: review ownership is now mostly centralized, but a few review-specific responsive tweaks still live inside broader shell media-query blocks in `globals.css`.
  Evidence: selectors such as `.manuscript-review-detail-anchor`, `.editorial-review-head`, `.editorial-review-detail-head`, and `.suggestion-card-top` still appear inside existing responsive shell queries even after the main `review.css` extraction.

- Observation: the floating composer is one coherent feature owner in React, but some of its low-level primitives are still shared with the review drawer.
  Evidence: `FloatingComposerPanel.tsx` owns the `floating-panel*`, `floating-review*`, and `floating-bridge-*` families, while selectors such as `.panel-toggle`, `.floating-textarea`, and `.floating-textarea-shell` are also reused by `EditorialReviewDrawer.tsx`, so they can be extracted only as root-imported global CSS rather than as bridge-only ownership.

- Observation: the step-review workspace has a clean feature boundary, but its mobile overrides were mixed into a shared shell media query.
  Evidence: the `step-review-*` family could move together into `apps/web/app/styles/step-review.css`, while the `@media (max-width: 900px)` block in `apps/web/app/globals.css` originally mixed step-review rules with `.editor-page-shell` and `.block-editor-row`.

- Observation: the editor interaction layer is cohesive enough for its own partial, but the compare/visual modal family still fits better under overlays.
  Evidence: editor controls, spellcheck/emphasis popovers, the block editor surface, and inline diff editors now live in `apps/web/app/styles/editor.css`, while `global-replace`, `change-compare`, and `visual-workspace` selectors remain owned by `apps/web/app/styles/overlays.css`.

- Observation: the manuscript runtime/editor layer is now split from the shell while leaving the layout bridge selectors in `globals.css`.
  Evidence: the manuscript toolbar helpers, selection/request-status surfaces, `cm-orest-*` runtime rules, and inline manuscript diff editor now live in `apps/web/app/styles/editor.css`, while shell-coupled selectors such as `.manuscript-page` and mixed `editor-layout` media queries remain global.

## Decision Log
- Decision: the first refactor phase will split `apps/web/app/globals.css` into ordered global partials rather than convert the app directly to CSS Modules.
  Rationale: the current stylesheet contains source-order-dependent overrides. A direct module migration would add too much risk before ownership and cascade order are stabilized.
  Date/Author: 2026-04-04 / Codex

- Decision: feature-specific responsive rules should move with their owning feature partials rather than into one new monolithic `responsive.css`.
  Rationale: centralizing all responsive code would preserve the current sprawl in a different file and make ownership less clear.
  Date/Author: 2026-04-04 / Codex

- Decision: the first CSS Module migration wave will target isolated surfaces only, specifically top bar, login, settings, and other low-coupling UI islands.
  Rationale: the editor surface, floating composer, and step review workspace are state-heavy and cross-coupled; they should remain global until the extraction pass lands and the real boundaries are verified.
  Date/Author: 2026-04-04 / Codex

- Decision: the first implementation slice should import new partials after `globals.css` rather than attempting a full import-order rewrite immediately.
  Rationale: the repo still depends on `globals.css` for the bulk of source-order-sensitive behavior. Importing bounded low-coupling slices after `globals.css` lets extraction begin without destabilizing the editor/layout cascade.
  Date/Author: 2026-04-04 / Codex

- Decision: when a partial already exists and is imported, the safer next step is to remove the duplicated block from `globals.css` rather than recreate the same selectors in a second new file.
  Rationale: consolidation reduces ambiguity faster than continuing to add parallel owners for the same selector family.
  Date/Author: 2026-04-04 / Codex

- Decision: the legacy review drawer and `step-review-prototype-*` families should live in `apps/web/app/styles/overlays.css` until runtime proves they can be deleted entirely.
  Rationale: they behave like cross-feature overlay surfaces today, and isolating them there removes confusion from `globals.css` without prematurely deleting potentially active UI.
  Date/Author: 2026-04-04 / Codex

## Outcomes & Retrospective

Implementation now has a real partial-style scaffold under `apps/web/app/styles/`. The validated owners include `foundation.css`, `auth.css`, `layout.css`, `settings.css`, `review.css`, `floating.css`, `step-review.css`, `editor.css`, `review-chat.css`, `sidebar.css`, and `overlays.css`, all imported from `apps/web/app/layout.tsx`. `apps/web/app/globals.css` has been materially reduced by removing extracted auth, settings, topbar, sidebar, review-chat, review-drawer, review-analysis, `step-review-prototype-*`, the main review-card/detail/proposal/compact-card blocks, the full floating composer family, the entire step-review workspace/drawer/fact/spellcheck/emphasis cluster, the editor control/block-editor/inline-diff slices, and the rail prompt stack/input pair while preserving shell and remaining manuscript-facing regions in place. The app now passes production build and typecheck after the extraction. Remaining gaps include runtime verification for the newly extracted floating slice, cleanup of the remaining review-specific responsive tweaks still embedded in shell media queries, and extraction of the more coupled manuscript/rendering and sidebar/rail regions.
Implementation now has a real partial-style scaffold under `apps/web/app/styles/`. The validated owners include `foundation.css`, `auth.css`, `layout.css`, `settings.css`, `review.css`, `floating.css`, `step-review.css`, `editor.css`, `review-chat.css`, `sidebar.css`, and `overlays.css`, all imported from `apps/web/app/layout.tsx`. `apps/web/app/globals.css` has been materially reduced by removing extracted auth, settings, topbar, sidebar, review-chat, review-drawer, review-analysis, `step-review-prototype-*`, the main review-card/detail/proposal/compact-card blocks, the full floating composer family, the entire step-review workspace/drawer/fact/spellcheck/emphasis cluster, the editor control/block-editor/inline-diff slices, and the rail prompt stack/input pair while preserving shell and remaining manuscript-facing regions in place. The app now passes production build and typecheck after the extraction, including the later correction that moved the shell layout rules into `layout.css` and the manuscript preview surfaces into `editor.css`. Remaining gaps include runtime verification for the newly extracted floating slice, cleanup of the remaining review-specific responsive tweaks still embedded in shell media queries, and extraction of the more coupled manuscript/rendering and sidebar/rail regions.

## Context and Orientation

The relevant application is the Next.js web app under `C:\Projects\oboz-ai\orest-edit\apps\web`. The root layout imports the shared stylesheet set from `C:\Projects\oboz-ai\orest-edit\apps\web\app\layout.tsx`. The current import sequence is:

    import "./styles/foundation.css";
    import "./globals.css";
    import "./styles/auth.css";
    import "./styles/layout.css";
    import "./styles/review.css";
    import "./styles/floating.css";
    import "./styles/step-review.css";
    import "./styles/overlays.css";
    import "./styles/review-chat.css";
    import "./styles/sidebar.css";
    import "./styles/settings.css";

The stylesheet being refactored is:

    C:\Projects\oboz-ai\orest-edit\apps\web\app\globals.css

The major React owners that already imply future style boundaries are:

    C:\Projects\oboz-ai\orest-edit\apps\web\components\layout\TopBar.tsx
    C:\Projects\oboz-ai\orest-edit\apps\web\components\editor\FloatingComposerPanel.tsx
    C:\Projects\oboz-ai\orest-edit\apps\web\components\editor\BlockEditorSurface.tsx
    C:\Projects\oboz-ai\orest-edit\apps\web\components\layout\StepReviewWorkspaceShell.tsx
    C:\Projects\oboz-ai\orest-edit\apps\web\components\layout\RightOperationsRail.tsx
    C:\Projects\oboz-ai\orest-edit\apps\web\app\login\page.tsx
    C:\Projects\oboz-ai\orest-edit\apps\web\app\settings\page.tsx

Terms used in this plan:

Global partial: a plain CSS file imported from the app root that still participates in the global cascade.

Extraction pass: moving selectors from `globals.css` into smaller files without changing selector names or intended behavior.

Ownership map: the mapping between selectors and the feature, component, or route that should control them.

Low-coupling island: a UI surface whose styles mostly affect one component or route and do not depend heavily on far-away override ordering.

High-coupling surface: a UI surface with many stateful selectors, shared class names, or repeated override waves, making it risky to modularize early.

## Extraction Map

The extraction map below is the target shape for phase one. The line ranges are approximate guidance from the audit, not a mandate to preserve exact source blocks forever.

`foundation.css` should own tokens, reset rules, global typography helpers, accessibility helpers, generic button/loading utilities, and shared motion rules. This includes the top-of-file `:root` token set, base element reset behavior, `.app-shell`, `.mono-ui`, `.button-*`, shared keyframes, `prefers-reduced-motion` handling, `.sr-only`, and any truly generic loading-dot helpers currently scattered later in the file.

`layout.css` should own app-shell and route-shell structure that remains global even after extraction. This includes `.topbar*`, `.nav-*`, brand styles, `.editor-layout`, pane containers, baseline sidebar structure, and shell-level responsive adjustments that affect the whole page frame rather than one feature. The repeated layout passes must remain in the same relative order during the first extraction.

`auth.css` should own the login route styles currently grouped around the auth page region. These styles appear isolated enough to become one route-level partial quickly and then later a CSS Module candidate if desired.

`settings.css` should own the modern settings page block around the later `Settings redesign` region. This is one of the cleanest extraction candidates because its naming is cohesive and route-scoped.

`review.css` should own editorial review cards, detail views, compare surfaces, evidence cards, compact editorial cards, and related proposal/detail UI that remains global for now. This includes `editorial-review-*`, `suggestion-card*`, `evidence-*`, `change-compare-*`, and proposal-detail styles currently split across early and late regions.

`floating.css` should own the floating composer shell and its related interaction states, including `.floating-panel*`, `.floating-bridge-*`, floating local sections, and their feature-specific responsive rules. This area must preserve order because its shell and internals are currently defined in separate waves.

`editor.css` should own manuscript rendering, block editor rows, block toolbar, block callouts, block images, inline editor states, spellcheck underlines, emphasis highlights, and nearby editor-only overlays. This includes `.manuscript-*`, `.block-*`, `.block-editor-*`, `.spellcheck-*`, and `.emphasis-*`.

`step-review.css` should own the large workspace and drawer system, especially the `step-review-*` family, editor toasts that are only used there, context/config rows, fact-check table presentation, spellcheck module presentation, and feature-owned responsive rules. This appears to be the largest coherent feature block in the file.

`sidebar.css` should own right-rail and note-card systems such as `.review-sidebar-*`, `.request-history-*`, `.rail-*`, `.editor-note-*`, operation-note cards, sidebar toggle rows, compact note cards, and similar supporting sidebar surfaces. Some of these may later move closer to `RightOperationsRail.tsx`.

`overlays.css` should own dialogs and overlays that are cross-feature rather than component-local, including destructive/reset dialogs, compare backdrops, visual workspace modal shell, block diff overlay, review drawer overlay, and any still-active shared modal wrappers.

`utilities.css` should remain intentionally small. It should hold only generic helpers that are clearly cross-feature and not better owned elsewhere. If a utility is primarily used by one feature, it should stay with that feature file instead.

The following style families should be treated as early CSS Module candidates after phase one proves stable:

    topbar / nav / brand
    auth
    settings
    compact note-card islands
    low-level UI primitives where class ownership is already local

The following style families should remain global until after the extraction pass:

    manuscript
    block editor
    floating composer
    step review workspace
    review recommendation detail and proposal surfaces

## Plan of Work

Milestone 1 establishes the extraction scaffold without changing UI behavior. Create a new directory at `apps/web/app/styles/` and add the partial files listed in the extraction map. Update `apps/web/app/layout.tsx` to import those partials in a deliberate order. During this milestone, selectors should move with minimal editing, and repeated override sections should keep their relative order even if the resulting split is not yet perfectly pure. The goal is a clean ownership scaffold, not immediate deduplication.

Milestone 2 stabilizes the cascade and documents any mixed-ownership sections. As selectors are moved, annotate in this ExecPlan which files still contain compromise groupings because of source-order dependence. If a style family spans multiple historical waves, keep it together in one partial rather than splitting it prematurely. The output of this milestone is a maintainable global-partial system with unchanged runtime behavior.

Milestone 3 verifies the extraction against real product surfaces. Validate `/editor`, `/settings`, and `/login` in runtime and by static checks. Focus especially on the manuscript shell, floating composer, right drawer, compare dialog, review cards, settings layout, and login route. Record any regressions as ownership mistakes rather than patching them ad hoc.

Milestone 4 performs a dead-code and legacy-style review. Investigate prototype or legacy-looking families, especially the review drawer overlay and `step-review-prototype-*` regions near the bottom of the old file. If they are unused, delete them in a follow-up patch. If they are still active, move them into an explicitly named legacy partial so they stop confusing current ownership.

Milestone 5 begins selective CSS Module migration. Start only with low-coupling islands: top bar, login page, settings page, and similar small route or component surfaces. The success criterion is not “zero global CSS,” but a hybrid model in which truly global structure remains global and local UI islands own their own styling.

## Concrete Steps

Work from `C:\Projects\oboz-ai\orest-edit`.

Audit and locate current imports:

    Get-Content apps/web/app/layout.tsx
    Get-Content apps/web/app/globals.css -First 240

Create the partial-style directory and files during implementation:

    New-Item -ItemType Directory -Force apps/web/app/styles

Update the root layout imports so the order is explicit. The exact list may evolve, but the initial sequence should resemble:

    ./styles/foundation.css
    ./styles/layout.css
    ./styles/auth.css
    ./styles/settings.css
    ./styles/review.css
    ./styles/floating.css
    ./styles/step-review.css
    ./styles/editor.css
    ./styles/sidebar.css
    ./styles/overlays.css
    ./styles/utilities.css

Then remove or reduce `globals.css` only after all selectors have been moved and runtime parity is verified.

Validation commands after extraction:

    npm run typecheck -w @orest/web
    npm run build -w @orest/web

If a dev server is used for runtime QA:

    npm run dev -w @orest/web

Then manually verify:

    http://127.0.0.1:3000/login
    http://127.0.0.1:3000/settings
    http://127.0.0.1:3000/editor

## Validation and Acceptance

The extraction pass is successful when all of the following are true:

The app no longer relies on one monolithic `apps/web/app/globals.css` file for all styles. Instead, the root layout imports a set of ordered partials from `apps/web/app/styles/`.

The UI on `/editor`, `/settings`, and `/login` is visually unchanged in normal use. In particular, the editor shell, manuscript column, right drawer, floating composer, top bar, compare dialog, review cards, and settings form must still render and behave as before.

Static validation succeeds:

    npm run typecheck -w @orest/web
    npm run build -w @orest/web

The resulting file structure makes ownership obvious enough that a contributor can identify the correct partial for a styling change without scanning thousands of lines.

The first post-extraction map for CSS Module candidates is documented in this ExecPlan and reflected in implementation notes or follow-up tasks.

## Idempotence and Recovery

This refactor should be performed as an additive extraction, not as a destructive rewrite. Keep the original `globals.css` intact until the new partial imports are in place and validated. Move selectors in bounded groups and validate between groups when possible. If a regression appears, restore the last known-good import order first before changing selectors.

Do not mix cleanup, renaming, selector deletion, and module migration into the same first extraction pass unless a dead selector is proven unused. The safe rollback is to revert the partial-import change and return temporarily to the original `globals.css` import.

## Artifacts and Notes

Useful audit findings to preserve during implementation:

    globals.css size observed during audit: about 10,396 lines / 194 KB
    repeated breakpoint cluster: 1220px appears several times in overlapping regions
    repeated high-risk families: editor-layout, floating-panel, editorial-review-card, editorial-review-detail

Representative current ownership anchors:

    TopBar.tsx -> topbar / nav / brand
    FloatingComposerPanel.tsx -> floating-panel / floating-bridge
    BlockEditorSurface.tsx -> manuscript / block / spellcheck / emphasis
    StepReviewWorkspaceShell.tsx -> step-review
    RightOperationsRail.tsx -> rail / request-history / editor-note

## Interfaces and Dependencies

At the end of the first implementation phase, the following repository interfaces should exist:

`apps/web/app/layout.tsx` imports multiple CSS partials from `apps/web/app/styles/` in a deliberate and documented order.

`apps/web/app/styles/` contains at least the following files, even if some remain small initially:

    foundation.css
    layout.css
    auth.css
    settings.css
    review.css
    floating.css
    editor.css
    step-review.css
    sidebar.css
    overlays.css
    utilities.css

`apps/web/app/globals.css` is either removed entirely or reduced to a temporary compatibility shim that clearly delegates to the new partial structure. A compatibility shim is acceptable during transition, but the long-term owner should be the new style directory rather than one ever-growing root file.
