# ExecPlan: UX Pass 2 for List Formatting, Anchor Precision, and Visual Polish

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

If `PLANS.md` is present in the repo, maintain this document in accordance with it and link back to it by path: `/mnt/c/Projects/oboz-ai/orest-edit/PLANS.md`.

## Purpose / Big Picture
Deliver a second UX pass that makes list improvements visibly meaningful, prevents accidental range bleed into neighboring headings, and tightens inline execution card polish. After this pass, a `list` action should reliably produce concise `Назва: опис` items, `врізка` drafts (especially `top_list`) should read as actionable multi-line mini-guides, the edited range should match user intent, and proposal editors should feel stable and readable without manual resizing.

## Progress
- [x] (2026-03-11 04:40Z) Captured pass-2 scope from editor feedback and screenshots in a dedicated ExecPlan.
- [x] (2026-03-11 05:02Z) Added concrete `врізка/top_list` prompt recommendations with two-shot examples and included `simplify/rewrite` anti-regurgitation track.
- [x] (2026-03-11 05:04Z) Applied immediate UX quick-fix: removed per-block labels (`Блок N`) from green replace proposals so blocks render as a clean vertical stack.
- [x] (2026-03-11 15:28Z) Implemented textarea auto-grow for green proposal editors in inline diff overlay.
- [x] (2026-03-11 15:28Z) Hardened `top_list` prompt contract with strict multi-line `Назва: пояснення` format, source-only guardrails, and embedded two-shot examples.
- [x] (2026-03-11 15:28Z) Added callout-kind-aware body normalization and insertion splitting so `top_list` survives as multi-line entries end-to-end.
- [x] (2026-03-11 15:28Z) Tightened `rewrite/simplify` anti-regurgitation guidance and added repeated no-op escalation messaging for review proposals.
- [x] (2026-03-11 15:28Z) Added local patch near-no-op detection and warning-first operator guidance with repeated-warning escalation.
- [x] (2026-03-11 15:28Z) Added replace/list range guardrails that clip adjacent heading blocks and surface a concise UI note in recommendation reason.
- [x] (2026-03-11 15:28Z) Completed validation: `typecheck`, `test` (47 passing), `build` all green.

## Surprises & Discoveries
- Observation: the screenshot message `Підготував локальну чернетку за вашим запитом.` indicates local patch/fallback behavior rather than typed review execution.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/server/patch-service.ts:221`.
- Observation: current `list` guidance is permissive (`Якщо це природно...`) and does not require `Назва: опис` structure.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/server/review-action-service.ts:565`.
- Observation: only `rewrite/simplify` receive near-no-op warnings; `list` can still look unchanged without warning.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/server/review-action-service.ts:845`.
- Observation: `simplify/rewrite` still sometimes return near-identical output in practice, especially when model drifts into conservative paraphrase.
  Evidence: editor feedback + screenshot with no-op warning and unchanged proposal blocks.
- Observation: diff proposal textarea uses fixed minimum height and manual resize; no auto-fit behavior exists.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/globals.css:5579`.
- Observation: current default callout prompt asks for plain `body` text but does not strictly require per-line actionable bullets for `top_list`.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/settings.ts:39`.
- Observation: callout sanitization strips markdown bullet/number markers globally, which can flatten list-like `врізка` drafts.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/server/review-action-service.ts:1255`.
- Observation: clipping heading spillover is safest when done during review-item normalization, before execution and highlighting states are derived.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/review-contract.ts`.
- Observation: no-op escalation is best handled client-side per review item lineage, without expanding backend response schema.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx`.

## Decision Log
- Decision: pass 2 will treat `list` as a strict formatting transformation target, not a soft preference.
  Rationale: users requested clear semantic output differences and concise scanability.
  Date/Author: 2026-03-11 / Codex (planning)
- Decision: range precision fixes apply to both local patch and review paths, because both can generate replace proposals.
  Rationale: user-observed range bleed can arise before proposal execution regardless of rail entry point.
  Date/Author: 2026-03-11 / Codex (planning)
- Decision: `top_list` callout drafts must prefer actionable multi-line `Назва: пояснення` entries over neutral prose.
  Rationale: current output feels flat and non-operational for editorial use; structure improves scannability and usability.
  Date/Author: 2026-03-11 / Codex (planning)
- Decision: pass 2 includes anti-regurgitation tightening for `simplify/rewrite` prompts and checks, not only warning display.
  Rationale: warning-only behavior is transparent but not sufficient when operators repeatedly get no-op drafts.
  Date/Author: 2026-03-11 / Codex (planning)

## Outcomes & Retrospective
Implemented and validated:
- Green diff proposal textareas now auto-fit content on mount and input; no manual drag required.
- `Врізка/top_list` contract now enforces actionable multi-line `Назва: пояснення` output with source-bound constraints and two-shot in-template examples.
- Callout cleanup no longer strips numeric-leading factual lines globally; numeric prose is preserved.
- Review no-op flow now escalates on repeated no-op for the same recommendation item with explicit guidance to strengthen instructions.
- Local patch flow now warns on near-no-op outputs and escalates messaging on repeated near-no-op for the same selection+mode key.
- Replace/list recommendations now clip accidental adjacent heading blocks during normalization and append a concise clipping note for operator visibility.

Validation:
- `npm run typecheck -w @orest/web` passed.
- `npm run test -w @orest/web` passed (47/47).
- `npm run build -w @orest/web` passed.

## Context and Orientation
The same manuscript can be edited through two generation paths:

1. Local patch path (floating `Локальна правка`) resolves target IDs from current selection and sends them to `/api/edit/patch`.
   Relevant files:
   - `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/editor/page.tsx`
   - `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/server/patch-service.ts`

2. Review recommendation path (typed items such as `list`) generates proposals via `/api/edit/review/proposal`.
   Relevant files:
   - `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/server/review-service.ts`
   - `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/server/review-action-service.ts`
   - `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/review-contract.ts`

Inline replace proposal rendering lives in:
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/editor/BlockDiffOverlay.tsx`
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/globals.css`

## Plan of Work
Pass 2 will be implemented in seven milestones.

Milestone A: proposal editor ergonomics.
Add autosize behavior for green proposal textareas so height follows content at mount and on input changes.

Milestone B: list output contract hardening.
Strengthen `list` prompts to require concise `Назва: опис` items and reject generic prose. Add a normalization fallback that converts weak paragraph/list output into this shape using punctuation and clause heuristics.

Milestone C: list quality guardrails.
Extend no-op/weak-change detection to `list` proposals with list-aware similarity/shape checks (for example: unchanged sentence copies, missing colon structure, item count too low for the source excerpt), and surface targeted warnings in the inline card.

Milestone D: anchor precision.
Add range/selection safeguards so list rewrites do not unintentionally absorb neighboring structural headings when source selection semantics imply content-only paragraphs.

Milestone E: visual execution-card polish.
Reduce visual noise in inline cards by softening frame/separator density, improving ghost-button contrast, and de-emphasizing non-primary controls near active apply flows.

Milestone F: `врізка` output quality.
Strengthen callout prompt contracts and parser/sanitizer behavior so `top_list` drafts become multi-line practical guidance in the form `Коротка назва: 1 речення пояснення`. Keep fact fidelity constraints explicit: no invented sources; include additional sources only when they are present in the source fragment.

Milestone G: `simplify/rewrite` anti-regurgitation.
Strengthen generation contracts to require tangible rephrasing, add stricter weak-delta detection (for both review and local patch where applicable), and surface operator guidance that is specific to the failure mode.

## Concrete Steps
Run from `/mnt/c/Projects/oboz-ai/orest-edit`:

1. `npm run typecheck -w @orest/web`
2. `npm run test -w @orest/web`
3. `npm run build -w @orest/web`
4. `APP_PASSWORD=@orest0krat npm run dev -w @orest/web -- --hostname 127.0.0.1 --port 3100`
5. In another terminal: `APP_PASSWORD=@orest0krat npm run qa:inline-review -w @orest/web`

Expected result: typecheck/tests/build pass, runtime QA passes, manual list scenario demonstrates `Назва: опис` output with correct block range and autosized proposal editor, and manual `врізка/top_list` scenario demonstrates 3-5 actionable multi-line entries without flattening into one paragraph.

## Validation and Acceptance
Acceptance criteria:
- Green proposal textareas auto-expand to fit all lines without manual drag.
- `list` proposals produce itemized `Назва: опис` text with concise titles (1-2 words) in most cases and show explicit warning when generation quality is weak.
- Applying list proposals no longer includes adjacent heading blocks unless they were explicitly selected.
- UI remains consistent with prior pass (flat manuscript red source + green proposal card, no nested old/new card frames).
- Inline visual card has reduced chrome noise, clearer secondary CTA visibility, and less distracting nearby row controls.
- `врізка` (`top_list`) drafts are multi-line, actionable, and consistently structured as concise title + practical explanation.
- `simplify/rewrite` drafts show measurable phrasing change from source or are clearly flagged with stronger actionable recovery guidance.

Test coverage additions:
- `review-action-service` tests for list shape enforcement and list no-op/weak warnings.
- Selection/range tests around heading adjacency.
- Optional UI behavior test for autosize logic (component-level).
- `review-action-service` tests for callout `top_list` draft structure and sanitizer behavior that preserves multi-line readability.
- Regression coverage for anti-regurgitation behavior in both review-action and local patch generation paths.

## Idempotence and Recovery
All steps are additive and safe to rerun. If a heuristic harms list quality, gate it behind a narrow condition and keep a direct rollback path by reverting only the new normalization/warning helpers while retaining tests and docs.

## Artifacts and Notes
User-observed defects to reproduce:
- proposal editor does not auto-fit content height;
- list output can be semantically unchanged;
- adjacent heading inclusion in replace range (`Сухість шкіри` case).
- `врізка` output is flat/non-actionable and poorly structured for list-style practical guidance.
- `simplify/rewrite` still occasionally produce near-identical content.

## Interfaces and Dependencies
Expected touched interfaces:
- `buildReplacePromptByType(type, blockCount)` in `review-action-service.ts` for strict list format rules.
- list normalization helpers in `review-action-service.ts` (shape enforcement + warnings).
- selection/range guard logic in `page.tsx` and/or review normalization in `review-contract.ts`.
- textarea rendering logic in `BlockDiffOverlay.tsx` with supporting CSS in `globals.css`.
- `DEFAULT_CALLOUT_PROMPT_TEMPLATE` in `settings.ts` for stronger `top_list` structure constraints.
- callout parsing/sanitization (`parseCalloutDraftOutput`, `sanitizeCalloutText`) in `review-action-service.ts` for multi-line readability and actionable formatting.
- `buildReplacePromptByType` in `review-action-service.ts` and prompt guardrails in `patch-service.ts` for anti-regurgitation constraints.

## Prompt Draft: `Врізка / top_list`
Recommended additions for callout contract:

    Для calloutKind=top_list (обов'язково):
    - body = 3-5 пунктів, кожен пункт окремим абзацом (без суцільного тексту).
    - Формат кожного пункту: "<Назва (1-2 слова)>: <практичне пояснення одним реченням>".
    - Пиши для редакторської користі: коротко, конкретно, без загальних фраз.
    - Не вигадуй нових джерел/сполук; використовуй лише факти з фрагмента.
    - Якщо у фрагменті менше 3 валідних пунктів, не добудовуй фантазіями: поверни стільки, скільки підтверджено.

Two-shot examples to include in prompt:

    Приклад 1 (добре):
    {
      "title": "Де шукати сенолітики",
      "body": "Цибуля: поширене джерело кверцетину.\n\nЯблука: також містять кверцетин і підходять для щоденного раціону.\n\nПолуниця: містить фізетин.\n\nКаперси: один із харчових продуктів з високим вмістом кверцетину.",
      "summary": "Дає читачеві практичний список джерел сенолітиків без виходу за межі фрагмента."
    }

    Приклад 2 (погано):
    {
      "title": "Практичний гід",
      "body": "Цибуля (джерело кверцетину). Яблука (джерело кверцетину). Полуниця (джерело фізетину).",
      "summary": "Список продуктів."
    }

    Чому погано: один абзац, повторювані шаблони, низька практична цінність, плоска подача.
