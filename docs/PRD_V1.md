# PRD V1

Date: 2026-03-05
Status: Active

## 1. Product summary
Build an AI editor for book editors working on science-pop and medical-pop manuscripts.

The system behaves like a code editor for prose:
- it does not rewrite the entire chapter by default
- it proposes local edits only
- it shows diff before acceptance
- it explains each change briefly

## 2. Primary user
A book editor who receives dense manuscript drafts and needs to turn them into simple, readable Ukrainian without losing meaning.

This is not a product for doctors and not a clinical workflow tool.

## 3. Core problems
1. Dense scientific prose is hard to read.
2. Generic LLMs tend to over-rewrite and flatten author voice.
3. Editors need visible, reversible changes to trust the tool.
4. Editors need fast ways to simplify terms, shorten text, and clarify logic.
5. Editors need a default editorial mode plus custom requests for special cases.

## 4. Product goals
- Reduce time spent editing a chapter.
- Improve clarity and readability for a broad Ukrainian-speaking audience.
- Preserve meaning while simplifying language.
- Keep the editor in control through local, reviewable changes.

## 5. Non-goals for current MVP
- Full chapter rewrite as default behavior.
- Doctor-facing medical compliance workflow.
- Strict medical mode in the editor UI.
- Export patch flow.
- Full source library as a top-level feature.
- Version history and collaboration system.

## 6. Core jobs to be done
1. Improve a selected paragraph according to the default editorial policy.
2. Simplify a selected sentence or term on request.
3. Shorten a passage without losing meaning.
4. Explain a technical term for a broad audience.
5. Run a custom request from a floating panel without leaving the editor.

## 7. MVP scope
- Chapter text input and display.
- Fragment selection target.
- Default editorial action.
- Custom request panel.
- Patch-style output only.
- Diff rendering for additions and deletions.
- Accept/reject per proposed change.
- Short explanation for each change.
- Settings for provider, model id, API key, and editorial prompt.

## 8. Product constraints
- Never rewrite the whole chapter unless explicitly requested.
- Keep changes local to the selected fragment.
- Every change must include a short reason.
- Preserve meaning over style novelty.
- Prefer simple Ukrainian over dense academic phrasing.

## 9. UX principles
- The manuscript stays central.
- The editor always sees what changed.
- The editor can reject any suggestion quickly.
- Secondary controls must not overpower the reading surface.
- Settings are secondary; the editor screen is primary.

## 10. Success criteria
- The user can select a fragment and receive only local proposals.
- Each proposal includes a visible diff and a short reason.
- The UI stays understandable without medical domain training.
- The interface language is Ukrainian.

## 11. Current implementation note
The current build is a web-first prototype with static/mock edit operations. Real provider and backend wiring are still pending.
