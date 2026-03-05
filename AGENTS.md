# Project Agent Notes

## Vision
This product is an AI editor for book editors working on science-pop and medical-pop manuscripts.

It is not a doctor tool and not a clinical workflow product.

The main job is to turn dense scientific language into simple, readable Ukrainian while preserving meaning and author intent.

## Core product constraints
- Patch-first: do not rewrite the whole chapter unless explicitly requested.
- Diff-first: all proposed changes must be visible before acceptance.
- Every change must include a short reason.
- Keep edits local to the selected fragment.
- UI language is Ukrainian.
- Preferred visual baseline is `docs/sample4.html`.

## Planning workflow
- Use `PLANS.md` as the rulebook for writing and maintaining execution plans.
- Use `docs/EXECPLAN_MVP.md` as the living implementation checklist.
- When doing substantial implementation work, update the `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` sections in `docs/EXECPLAN_MVP.md`.
- If you make or confirm a durable product or architecture decision, record it in `docs/DECISIONS_LOG.md`.
- Use `docs/CURRENT_STATE.md` as the current handoff snapshot before making changes.
- Use `docs/PRD_V1.md` for scope and product constraints, not as a task checklist.

## Tech and workflow notes
- Current implementation is a web-only Next.js app in `apps/web`.
- There is no active backend implementation in the current reset state.
- After UI updates, make a screenshot and check it to confirm the result matches intent.
- Treat `docs/CURRENT_STATE.md` as the first handoff document before making changes.

## Documentation discipline
- Keep `AGENTS.md` focused on durable project rules and context.
- Keep temporary scope decisions and active priorities in `docs/CURRENT_STATE.md` or `docs/EXECPLAN_MVP.md`.
- If you change scope, UX direction, or validated behavior, update the relevant docs in `docs/` in the same task.
