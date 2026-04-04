# ExecPlan: UX Refresh for Callout, Visual, Rewrite/Simplify Execution

Date: 2026-03-11  
Status: Completed (2026-03-11)

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

## Summary

This plan refined manuscript-side execution for three recommendation families:

1. `callout` (`врізка`) -> remove prompt-centric UI and keep action-first editing.
2. `visual` (`візуал`) -> keep raw prompt editable, add AI-prepopulated caption input, reduce pre-action copy noise, and unify typography/layout.
3. `rewrite` + `simplify` -> improve execution clarity, normalize markdown artifacts to block-editor plain text, remove red strikethrough from old text, and reassess prompt + end-to-end flow quality.

## Objectives and Success Criteria

- Execution cards are action-first and visually consistent across callout/visual/rewrite/simplify.
- `callout` no longer exposes raw prompt in UI.
- `visual` keeps editable raw prompt and exposes editable `caption` prefilled by AI when possible.
- `rewrite`/`simplify` no longer leak markdown formatting into block-editor content.
- Replace diff old text stays red without strikethrough.
- Regressions cover proposal parsing and manuscript execution behaviors.

## Progress

- [x] (2026-03-11) Updated manuscript-side execution card layout:
  - long context moved under collapsible `Чому це запропоновано`,
  - insertion context line added near insert actions,
  - `text_diff` cards now expose explicit `Перегенерувати` action.
- [x] (2026-03-11) Removed callout `Prompt` rendering from execution panel while preserving regenerate backend flow.
- [x] (2026-03-11) Added visual caption workflow:
  - parser accepts JSON `prompt` + optional `caption`/`alt`,
  - plain-text fallback remains supported,
  - caption is editable in UI and used on image block insert.
- [x] (2026-03-11) Reworked rewrite/simplify normalization path:
  - markdown syntax is stripped from replacement text,
  - rewrite/simplify/expand preserve original block shapes to avoid markdown-induced type drift,
  - replace flow computes and surfaces no-op warnings for near-unchanged outputs.
- [x] (2026-03-11) Follow-up UX corrections from editor feedback:
  - `list` proposals now coerce paragraph-only provider output into `bullet_list` blocks,
  - replace execution card now renders only proposed (green) editable blocks without nested bordered old/new cards,
  - callout/visual draft fields share one typography/input treatment,
  - visual CTA hierarchy now prioritizes `Згенерувати` until an asset exists.
- [x] (2026-03-11) Applied-change reveal behavior added:
  - after `Застосувати`/insert actions, manuscript scrolls to changed content,
  - affected block(s) are highlighted in green for 30 seconds.
- [x] (2026-03-11) Removed manuscript replace strikethrough while preserving red anchor highlighting.
- [x] (2026-03-11) Added/updated regression tests in `apps/web/test/review-action-service.test.ts` for:
  - visual JSON parser + fallback behavior,
  - rewrite markdown artifact stripping,
  - rewrite/simplify no-op warning signaling,
  - list proposal coercion when provider returns paragraph blocks.
- [x] (2026-03-11) Validation completed:
  - `npm run typecheck -w @orest/web`,
  - `npm run test -w @orest/web` (43/43 pass),
  - `npm run build -w @orest/web`,
  - runtime QA via `APP_PASSWORD=@orest0krat npm run qa:inline-review -w @orest/web` against local dev server.

## Surprises & Discoveries

- The runtime QA script requires a running app at `http://127.0.0.1:3100`; running QA without a dev server fails with `ERR_CONNECTION_REFUSED`.
- Visual prompt contracts can be tightened to prefer JSON-with-caption without breaking legacy plain-text responses if the parser remains permissive.
- No-op rewrite detection needs to happen after normalization, otherwise markdown-only deltas can be misclassified as meaningful edits.
- List-type provider responses frequently arrive as paragraphs; normalization must coerce structure to keep list actions visibly distinct and trustworthy.

## Decision Log

- Decision: For `rewrite`/`simplify` no-op or near-regurgitation outputs, surface a warning in the execution panel and keep regeneration manual.
  Rationale: explicit operator control preserves patch-first trust and avoids unreviewed loops.
  Date/Author: 2026-03-11 / Codex implementation

- Decision: Visual proposal parsing now supports both structured JSON (`prompt`, optional `caption`, optional `alt`) and plain-text fallback.
  Rationale: enables richer AI output while staying backward-compatible with current providers.
  Date/Author: 2026-03-11 / Codex implementation

- Decision: Replace-type markdown cleanup is enforced in review-action normalization before publishing manuscript diffs.
  Rationale: prevents markdown artifacts (`#`, `-`, emphasis markers) from leaking into block-editor content.
  Date/Author: 2026-03-11 / Codex implementation

- Decision: `list` recommendations enforce list structure during normalization, even when provider returns paragraph blocks.
  Rationale: prevents semantic no-op applies where the user requested a list but receives paragraph-shaped output.
  Date/Author: 2026-03-11 / Codex implementation

- Decision: replace-source content stays in manuscript red anchors while the inline execution card renders only proposed green editable blocks.
  Rationale: removes duplicated “card-in-card” framing and keeps diff reading direction unambiguous.
  Date/Author: 2026-03-11 / Codex implementation

- Decision: apply/insert actions auto-scroll to the first changed block and temporarily highlight affected blocks.
  Rationale: improves post-apply orientation, especially when edits land outside the current viewport.
  Date/Author: 2026-03-11 / Codex implementation

## Outcomes & Retrospective

Execution UX for callout/visual/rewrite/simplify is now aligned with the plan goals. Callout panels are action-first and no longer expose raw prompt text. Visual execution keeps editable prompt, includes editable caption, and now prioritizes `Згенерувати` before insert becomes available. Rewrite/simplify proposals normalize away markdown artifacts and expose a no-op warning state when output is effectively unchanged. Replace execution now avoids nested old/new cards by rendering only proposed green blocks inline while manuscript anchors remain red.

Prompt/flow reassessment was implemented in runtime contracts: replace prompts now explicitly require tangible phrasing changes and avoid near-verbatim rewrites, visual prompts support structured response mode, list recommendations coerce to real list blocks when needed, and no-op quality guardrails are enforced at proposal normalization time. Post-apply reveal behavior now scrolls and highlights changed content for 30 seconds.
