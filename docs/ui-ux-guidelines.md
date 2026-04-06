# Oboz CMS UI/UX Guidelines

This document defines the default UI and interaction standards for Oboz CMS. It is meant to guide product design, implementation, and review across editor, retrieval, SEO, translation, export, and admin surfaces.

Use this document for broad product decisions and UI reviews. Keep product-specific architecture decisions as is.
## How To Use This Document

Treat the sections in `Non-Negotiables` as default rules unless there is a clear local reason to break them. Treat the sections in `Strong Defaults` as the expected baseline for most screens. Treat the sections in `Context-Dependent Patterns` as tools to apply when the interface needs them, not as mandatory decoration.

When a screen feels confusing, optimize in this order:

1. Orientation
2. Confidence
3. Speed

## Non-Negotiables

### 1. Put Controls Where They Act

- Put controls next to the content they affect.
- Search controls belong near retrieval and results.
- Writing controls belong near generation and output.
- Local actions should not require travel to the top of the screen or a distant panel.
- Do not split one workflow across distant regions unless the separation is meaningful and obvious.

### 2. Keep State Visible And Trustworthy

- Show current state inline at the point of interaction.
- Users should always be able to tell what is selected, filtered, loading, stale, saved, or blocked.
- After an important action, show what changed in the UI itself, not only in a toast.
- Do not silently discard generated outputs when upstream inputs change. Mark them as stale when possible.
- Disabled controls must explain why they are disabled.

### 3. Preserve A Single Mental Model

- If multiple views represent the same underlying data, selection, filtering, and status must stay in sync.
- Similar actions should behave similarly across screens.
- Do not rename the same concept across views. If it is a `source`, keep calling it a `source`.
- Do not introduce a new interaction grammar on one screen unless it solves a real local problem.

### 4. Design For Recovery

- Prevent irreversible mistakes when possible.
- If prevention adds too much friction, make recovery obvious and safe.
- Error messages must be calm, specific, and actionable.
- Preserve user work through failures whenever possible.
- Tell users what is safe to retry, what was preserved, and what still needs attention.

### 5. Accessibility Is Interaction Quality

- Color must never be the only carrier of meaning.
- Focus states must be visible and intentional.
- Hover must never be the only way to discover or trigger an action.
- Screen-reader labels must reflect user meaning, not implementation details.
- Respect reduced-motion preferences without removing necessary feedback entirely.

## Strong Defaults

### Information Architecture

- Group controls by user intent, not by implementation layer.
- Keep `find`, `choose`, `edit`, and `publish` actions in their own logical zones.
- Primary actions should sit near the content they transform.
- Destructive actions should be separated from primary actions, but not hidden.

### Feedback And Status

- Show loading, syncing, saving, filtering, and errors while they are happening.
- Prefer specific feedback over generic success states.
- Empty states should answer three questions:
  what happened,
  why it happened,
  what the user can do next.
- If users need to compare options, keep those options visible at the same time whenever possible.

### Dense Data And Comparison

- Make selection affordances explicit in tables and dense lists.
- Keep scan anchors stable with sticky headers and, where useful, sticky first columns.
- Preserve orientation during sorting, filtering, and refresh.
- Right-align numeric values and keep units visible.
- Highlight changed rows or cells subtly when live updates can reorder content.

### Progressive Disclosure

- Start with the minimum interface needed for the main task.
- Keep advanced tooling nearby, but not loud by default.
- Collapse diagnostics and expert controls unless they are part of the core workflow.
- Do not hide important decisions behind `Advanced` if they materially change outcomes.

### Interaction And Motion

- Clickable things must look clickable.
- Draggable things must look draggable.
- Editable things must look editable.
- Motion should clarify structure and state changes, not decorate the screen.
- Drawers and panels should use real enter and exit motion rather than abrupt mount and unmount behavior.
- Buttons should provide tactile feedback without visual noise.
- Do not reflow or auto-format in ways that steal focus or move the cursor while the user is typing.

### Visual Hierarchy And Framing

- Use spacing, typography, alignment, and contrast before adding more borders or containers.
- Add a border, card, or panel only when it creates a meaningful level of separation.
- Avoid nested cards unless each layer has a distinct job.
- If everything is framed, nothing feels important.
- Prefer one strong selection cue over several weaker ones that repeat the same state.
- Final review, export, and publish screens should feel calmer and more conclusive than setup screens.

### Copy And Cognitive Load

- Use copy to reduce decision cost, not to sound clever.
- Prefer concrete verbs over abstract nouns.
- Keep terminology consistent across states and views.
- Show constraints, dependencies, and selections instead of forcing recall.
- Labels should carry the meaning. Placeholders and helper text should only support them.
- Remove helper text that only repeats visible context.
- If an interaction can be made self-evident, prefer that over teaching it with microcopy.
- Use one empty state per empty section instead of repeating the same empty message per field.

### Icons And Labels

- Use text-only labels for primary, high-stakes, or unfamiliar actions where clarity matters more than compactness.
- Use icon-plus-text for navigation, utilities, and medium-importance actions that benefit from both scan speed and clarity.
- Use icon-only controls for common secondary actions when space is tight and the meaning is widely recognized.
- Icon-only controls must still have accessible names and touch-safe discoverability.
- In dense repeated layouts, prefer a lightweight icon affordance over repeating instructional text like `Click to copy`.
- If the whole row or surface is the interaction target, the visible affordance can be lighter because the structure already explains the action.

## Context-Dependent Patterns

### Tooltips And Help

- Do not rely on native browser `title` tooltips for essential product UI.
- Use tooltips for clarification, not for instructions the interface depends on.
- Any critical hover hint must also work on touch.
- Put help at the point of confusion, not in a separate documentation graveyard.
- Prefer examples over abstract wording when the expected format may be ambiguous.

### Touch, Tablet, And Mixed Input

- Assume touch-first, keyboard-possible, hover-optional on tablet layouts.
- Keep hit targets generous and spacing forgiving.
- Never make hover the only path to discovery.
- Provide both touch-friendly and keyboard-accessible paths for context actions and bulk actions.
- Small slips should not trigger destructive or high-cost actions.

### Optimistic And Asynchronous UI

- Optimistic UI must feel reversible and trustworthy.
- If the UI implies that work is complete, the system must actually be in a safe saved state.
- Prefer partial readiness over blank waiting when useful content can appear early.
- Small delays feel much worse when the interface provides no continuity or explanation.

## Oboz CMS Product Rules

- Retrieval and search flows must remain debuggable by default.
- Editor-triggered retrieval should surface visible diagnostics for raw hit counts, generated queries, top candidate links, kept results, and warnings.
- Product UI must never leak raw machine strings, stack traces, markup tokens, or internal formatting.
- Keep product language consistent and localized.
- Search controls belong near search results. Writing controls belong near generation and output.
- Drawers and panels should use real enter and exit motion.
- Shared product state rendered in multiple views must reuse one state model.

## Common Anti-Patterns

- Detached control bars that act on content far away
- Hover-only discovery for important actions
- Silent invalidation of generated content
- Success toasts without visible changed state
- Dense tables with row-click behavior but no explicit selection affordance
- Generic errors that do not tell the user what they can retry
- Hidden business logic in labels
- Visual emphasis that relies on color alone
- Abrupt drawers, modals, and panels with no exit motion
- Cards inside cards inside cards without distinct meaning
- Repeated state labels, subtitles, or badges that all say the same thing
- Instructional badges that explain interactions the layout itself should make obvious

## UI Review Checklist

Use this checklist during implementation and review:

- Can the user tell what screen they are on, what they can do here, and what is happening now?
- Are controls placed next to the content they affect?
- Is current state visible inline: selected, active, stale, loading, disabled, saved?
- Does the UI preserve orientation during refresh, filtering, and generation?
- Are primary actions obvious and destructive actions safely separated?
- Are errors actionable, specific, and calm?
- Are hover-only actions also accessible via touch and keyboard?
- Are icon-only controls labeled accessibly?
- Do drawers, panels, and modals animate in and out cleanly?
- Does the interface preserve user work through failures and retries?
- Is terminology consistent across this flow?
- Is advanced tooling available without competing with the main workflow?

## Decision Heuristics

- Every visible element should answer one of three questions:
  what is this,
  what can I do here,
  what is happening now.
- If users make the same mistake twice, the interface is under-explaining or over-assuming.
- If a control needs a paragraph to justify its existence, it likely belongs elsewhere or needs redesign.
