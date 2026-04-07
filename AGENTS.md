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
- When the user asks for a new plan, create a new ExecPlan file under `docs/plans/` instead of rewriting the current active plan.
- Keep one clearly identified active plan file for the current implementation phase. Update an existing ExecPlan only when continuing that same plan.
- Archive superseded or completed plans under `docs/plans/archive/`.
- `docs/EXECPLAN_MVP.md` may remain the current active implementation checklist, but it is not the only allowed ExecPlan filename.
- When doing substantial implementation work against an active plan, update that plan's `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` sections.
- If you make or confirm a durable product or architecture decision, record it in `docs/DECISIONS_LOG.md`.
- Use `docs/CURRENT_STATE.md` as the current handoff snapshot before making changes.
- Use `docs/PRD_V1.md` for scope and product constraints, not as a task checklist.

## Tech and workflow notes
- Current implementation is a web-only Next.js app in `apps/web`.
- There is no active backend implementation in the current reset state.
- After UI updates, validate the UI result in runtime; capture screenshots ONLY when explicitly requested. Do not take screenshots unless user asks you to.
- Treat `docs/CURRENT_STATE.md` as the first handoff document before making changes.

### Playwright screenshots
- Use the `playwright-interactive` workflow for browser screenshots.
- Keep a dev server running in a persistent terminal session, then open the app at `http://127.0.0.1:3000` rather than `localhost`.
- For protected pages, prefer a direct `POST /api/auth/login` with `APP_PASSWORD` from `.env` or `.env.local`, then reuse the returned `orest_app_session` cookie in the browser context.
- Do not rely on login form redirect timing when the goal is a screenshot; load the authenticated page only after the session cookie is in place.
- Capture the initial viewport with `page.screenshot({ path, type: "png", fullPage: false })` unless a full-page shot is explicitly required.
- Before sharing a screenshot, verify the rendered viewport with a numeric check and open the saved image to confirm there is no clipping or blank state.

## Documentation discipline
- Keep `AGENTS.md` focused on durable project rules and context.
- Keep temporary scope decisions and active priorities in `docs/CURRENT_STATE.md` or the current active ExecPlan under `docs/plans/` (or `docs/EXECPLAN_MVP.md` if that is the active plan).
- If you change scope, UX direction, or validated behavior, update the relevant docs in `docs/` in the same task.
