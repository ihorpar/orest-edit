# PRD Editor UX Remediation V1

Date: 2026-03-26
Status: Draft

## Problem Statement

The current editor already exposes the core manuscript-plus-review workflow, but several UX patterns reduce clarity, trust, and efficiency during real editorial work.

Editors can reach the right features, yet they still have to infer too much:
- the primary action for a step is sometimes an unlabeled icon instead of an obvious CTA
- successful actions often do not produce visible confirmation in place
- destructive actions can execute immediately without strong consequence cues or undo
- key controls still depend on hover, `title`, or icon recognition
- fact-check and review settings reuse shared copy that does not always match the active task
- tablet interaction remains too small and too mouse-oriented for a touch-first professional workflow

This creates friction in the main job of the product: helping a book editor move through a manuscript confidently, stage by stage, while always understanding what is active, what changed, what is safe, and what to do next.

## Solution

Refine the current editor workflow so that the interface is explicit, touch-safe, and trustworthy without changing the core product model.

From the editor's perspective, the improved product should:
- show one obvious primary action per step
- surface success, pending, and failure states inline where the action happened
- treat destructive actions with clear consequence messaging and reversible flows when possible
- replace hover-only or `title`-only guidance with visible labels, styled tooltips, or inline help
- keep controls close to the manuscript fragment, step, or table they affect
- make touch and mixed-input usage reliable on tablet-sized layouts
- use step-specific copy so each surface describes the job it is actually doing

The result should feel less like a prototype with advanced controls exposed everywhere, and more like a deliberate editorial workstation that supports the editor's mental model from first run through repetitive daily use.

## User Stories

1. As a book editor, I want the main action for each review step to be visually obvious, so that I never have to guess how to start the next stage.
2. As a book editor, I want diagnostic, fact-check, spellcheck, and recommendation steps to use copy that matches their specific job, so that the interface does not confuse one workflow with another.
3. As a book editor, I want controls to appear near the manuscript, drawer, or table they affect, so that cause and effect stay clear while I work.
4. As a book editor, I want local actions on a selected fragment to feel anchored to that fragment, so that I stay oriented when switching between reading and editing.
5. As a book editor, I want the selected paragraph or range to remain visibly active while local controls are open, so that I always know what will be changed.
6. As a book editor, I want the UI to show what state is active right now, so that I can distinguish between not started, running, finished, stale, and failed work.
7. As a book editor, I want success feedback to appear inline after applying a change, so that I do not have to infer whether the system actually completed the action.
8. As a book editor, I want pending work to show a visible in-place status, so that the interface never looks frozen or ambiguous during AI operations.
9. As a book editor, I want destructive actions to state their consequence clearly, so that I can understand what data will be lost before I trigger them.
10. As a book editor, I want reversible destructive actions to offer undo, so that I can recover quickly from accidental clicks.
11. As a book editor, I want the interface to avoid hidden hover-only actions, so that it still works when I am using touch or mixed input.
12. As a book editor, I want icon-only controls to have accessible visible meaning, so that I do not have to memorize the entire icon language of the product.
13. As a screen reader user, I want every actionable control to expose a clear label, so that I can understand the action and its object without depending on sight or hover.
14. As a keyboard user, I want all core editing and review actions to expose visible focus and understandable activation targets, so that I can complete the core workflow without a mouse.
15. As a tablet user, I want key controls to have generous hit targets, so that I can use the app reliably on an iPad-sized device.
16. As a tablet user, I want navigation labels and essential hints to remain available without hover, so that touch input does not degrade my ability to move through steps.
17. As a book editor, I want the step rail to preserve orientation on narrower layouts, so that moving between manuscript and review stages does not feel like teleportation.
18. As a book editor, I want the fact-check table to support scanning and comparison, so that I can evaluate claims without opening each item separately.
19. As a book editor, I want fact-check metadata, sources, and statuses to remain readable and stable while I review evidence, so that I can make quick trust judgments.
20. As a book editor, I want recommendation counts and completion state to remain visible and accurate, so that I can track progress through a step without guesswork.
21. As a book editor, I want empty states and zero-result states to communicate different meanings, so that I can tell the difference between “nothing has run yet” and “the step found nothing actionable.”
22. As a book editor, I want settings and advanced controls to stay secondary to the manuscript and current task, so that I can focus on editing rather than interface management.
23. As a book editor, I want repeated workflows to preserve sensible defaults and prior choices, so that the second and tenth runs are faster than the first.
24. As a book editor, I want helper text to explain effect rather than teach the product, so that the UI stays compact and task-focused.
25. As a book editor, I want each concept to use one stable term, so that the drawer, manuscript, and local composer do not describe the same thing in conflicting language.
26. As a book editor, I want placeholder text to supplement a control rather than replace its label, so that empty inputs still remain understandable.
27. As a book editor, I want inline error messages to tell me what happened and what to do next, so that I can recover quickly without trial and error.
28. As a product team member, I want the editor UX to align with the project’s patch-first and diff-first principles, so that remediation improves clarity without changing the core product identity.
29. As a QA engineer, I want the core workflow states to be explicit and testable, so that regressions in feedback, navigation, and action clarity can be caught automatically.
30. As a design reviewer, I want the final workflow to reflect the project’s Ukrainian-first editorial context and `sample4` quality bar, so that UX polish supports the intended product direction.

## Implementation Decisions

- Keep the existing manuscript-left, review-right workspace as the foundation rather than redesigning the app into a different navigation model.
- Standardize each workflow step around one explicit primary CTA with step-specific labeling, while preserving secondary rerun or configuration controls.
- Separate interaction states into a shared UX state model that distinguishes idle, pending, success, stale, empty, zero-result, and error.
- Introduce a consistent inline feedback surface for all action outcomes, not only errors.
- Treat destructive actions as a dedicated UX pattern with explicit object/consequence copy and reversible handling where feasible.
- Refactor shared step configuration into step-specific modules so diagnostics, fact-check, spellcheck, and recommendation steps can each describe their own job correctly.
- Keep the local composer as a compact surface, but make its relationship to the active manuscript range more explicit through placement, anchoring cues, labeling, or both.
- Replace `title`-dependent affordances with first-class UI patterns: visible labels for critical actions, styled tooltips for secondary hints, and inline helper copy only where input format is otherwise ambiguous.
- Normalize navigation affordances across desktop and tablet so essential labels and state survive the loss of hover.
- Raise touch targets across high-frequency controls, especially step navigation, toolbar actions, and row-level actions.
- Preserve the current fact-check table representation, but improve it for scanability and comparison rather than reverting to card-based output.
- Reuse one vocabulary set for key editorial concepts across drawer, toolbar, and local composer.
- Prefer progressive disclosure for advanced settings, but keep current-state summaries visible without requiring the editor to open a details panel first.
- Maintain the current patch-first and diff-first editorial architecture; this PRD is about workflow clarity, not changing review semantics or AI output contracts.

## Testing Decisions

- A good test should validate user-visible behavior and state transitions, not implementation details such as internal component structure.
- Test the workflow-step header behavior, especially whether the correct primary action is visible and labeled for each step.
- Test the shared feedback pattern for success, pending, stale, and error cases.
- Test destructive-action UX for visible consequence copy and undo or recovery behavior where required.
- Test accessibility labels for icon-only and compact controls in the toolbar, step rail, and local composer.
- Test responsive behavior at desktop and tablet widths, with emphasis on non-hover navigation and touch-sized hit targets.
- Test fact-check configuration copy and state summaries to ensure they reflect the active step rather than a shared generic review model.
- Test local-selection workflows so selected range state and composer state remain synchronized.
- Test empty versus zero-result states for fact-check, spellcheck, and recommendation steps.
- Prior art for these tests should come from existing editor and review coverage in the repo, especially tests around review execution lanes, local-action routing, manual review items, spellcheck view models, and QA-style workflow checks.

## Out of Scope

- Replacing the manuscript-plus-drawer workspace with a brand-new information architecture.
- Changing the underlying patch, review, spellcheck, or fact-check backend contracts unless needed to expose clearer UI state.
- Introducing collaboration, comments, multiplayer editing, or version-control-style history features.
- Building a new design system from scratch.
- Rewriting the entire editor interaction model away from block-first editing.
- Broad visual restyling unrelated to the workflow and state-clarity issues identified in the audit.
- Expanding the source library, backend admin tools, or non-editor surfaces beyond what is necessary to support the UX remediation work.

## Further Notes

- This PRD is a remediation phase for the existing editor, not a greenfield redesign.
- The target quality bar should match the product constraints in `PRD_V1` and the visual/interaction intent implied by `sample4.html`.
- The most important outcome is trust: editors should always know what action is available, what object it applies to, what state the system is in, and how to recover from mistakes.
- The implementation should optimize the second run of a workflow, not only first-time discoverability.
- If this PRD is accepted, the next artifact should be an execution plan that breaks the remediation into vertical slices: shared feedback/state model, step CTA pass, touch/accessibility pass, local composer anchoring pass, and fact-check/table refinement pass.
