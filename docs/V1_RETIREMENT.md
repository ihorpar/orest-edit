# V1_RETIREMENT

Runbook for making the v2 editor (`/v2`) the default and, later, removing the classic editor (`/editor`). Written 2026-10-10 against branch `v2`. Nothing here has been executed. Do the two phases separately: phase 1 is reversible by a rebuild, phase 2 is not.

## Phase 1 — make v2 the default (reversible)

1. Set `NEXT_PUBLIC_OREST_DEFAULT_EDITOR=v2` in the build environment (Vercel project env for Production, or the shell that runs `npm run build`).
2. Rebuild and redeploy. The value is inlined at build time and `/` is prerendered, so changing the variable without a rebuild does nothing.
3. Verify: `/` redirects to `/v2`; `/editor` still opens by URL; `/v2` header still links to `Класична версія`.

Rollback: unset the variable (or set it to anything other than `v2`), rebuild, redeploy.

## Phase 2 — remove v1

### 2.1 Draft migration (before deleting anything)

- v2 copies the classic document into its own draft automatically, once per locale, the first time `/v2` is opened with no v2 draft (`loadInitialV2Draft` in `apps/web/lib/v2/draft-storage.ts`). Only the `document` is copied: classic review cards, diagnostics, spellcheck state and compare history are not.
- A user who already has a v2 draft keeps it; the classic draft is not merged in. To bring a classic manuscript into v2 afterwards, export it from `/editor` as `.docx`/`.txt` and use `Відкрити` in v2.
- Keys read for the copy (never written by v2): `orest-editor-draft-{uk|en}-v3`, and for Ukrainian the legacy `orest-editor-draft-v3`, `-v2`, `-v1`.
- Keep the read-only copy code in place for at least one release after `/editor` is removed, so late visitors still get their text. After that, `readV1DraftDocument` and the `source: "v1"` branch can go. Do not add code that deletes the classic keys from users' browsers.
- Images referenced by copied documents stay in IndexedDB `orest-editor-assets-v1`; v2 uses the same store.

### 2.2 Shared modules v2 depends on — these must stay

How these lists were made: a throwaway import-graph script walked every `import`/`export … from` in `apps/web` on commit `128e80a` plus the Milestone 6 working tree, with every file under `app/` except `app/editor` and `app/sources`, `middleware.ts` and `next.config.ts` as entry points. A file is "kept" when an entry point reaches it, also through a type-only import. The script also listed, for each stylesheet imported by `app/layout.tsx`, the class names that only that stylesheet defines and that a kept page uses. Re-run such a check before deleting; the compiler is the final authority.

- Server: everything under `apps/web/app/api/`, `apps/web/lib/server/`, `apps/web/lib/auth/`, `apps/web/middleware.ts`, `apps/web/lib/i18n/server-prompts/`, `apps/web/lib/i18n/api-errors.ts`, the Workflow runtime.
- Pages: `apps/web/app/login`, `apps/web/app/logout`, `apps/web/app/settings`, `apps/web/app/layout.tsx`. v2 has no settings UI of its own; the settings page uses `components/layout/TopBar.tsx`, `components/ui/{Button,Input,Select,StatusDot,Textarea}.tsx`, `lib/editor/settings.ts`, `lib/editor/review-contract.ts`, `lib/i18n/copy*` and `lib/i18n/editor-messages`.
- Providers: `components/providers/AppProviders.tsx` and `ProductLocaleProvider.tsx`.
- `apps/web/lib/editor/` modules reached from the kept entry points (26): `asset-store`, `callout-preview`, `change-history`, `document-model`, `docx-export`, `draft-state`, `import`, `import-feedback`, `inline-markup`, `keyboard-shortcuts`, `local-action-router`, `manual-review-items`, `manuscript-structure`, `patch-contract`, `review-contract`, `review-poll-interval`, `review-run-merge`, `review-run-persistence`, `review-run-progress`, `review-run-recovery`, `settings`, `settings-locale-defaults`, `spellcheck-contract`, `spellcheck-dictionary`, `spellcheck-view-model`, `workflow-ui`.
  - `change-history` and `workflow-ui` look classic-only but are not: `draft-state.ts` (imported by v2) imports types from both, and `import-feedback.ts` (used at runtime by `components/v2/V2Workspace.tsx`) imports `workflow-ui`. They can go only after those types and helpers are moved into the modules that need them, as a separate change.
- `apps/web/lib/i18n/product-locale.ts`, `lib/i18n/editor-messages/*` (v2 uses the import/export messages).
- Endpoints v2 calls: the model-backed `/api/edit/review` (+ `/proposal`, `/image`), `/api/edit/patch`, `/api/edit/spellcheck`, and `/api/edit/local-action`, which is plain routing logic and calls no model.

### 2.3 v1-only code — candidates for deletion

Delete in this order and run `npm run typecheck -w @orest/web` after each group.

1. Routes: `apps/web/app/editor/page.tsx` (about 8,000 lines) and `apps/web/app/sources/page.tsx`.
2. Components nothing else reaches: all of `apps/web/components/editor/` (`BlockDiffOverlay`, `BlockEditorSurface`, `EditorialReviewCard`, `FloatingComposerPanel`, `OperationCard`, `ResolvedEditorImage`, `StructureOutlineTree`, `VisualSelectionControls`); in `components/layout/` everything except `TopBar.tsx` (`EditorialReviewDrawer`, `ReviewRecommendationDetail`, `ReviewRecommendationsSidebar`, `RightOperationsRail`, `StepReviewWorkspaceShell`, `ThreePaneShell`); `components/ui/{Badge,Card,Divider,Panel,Toggle}.tsx`; `components/providers/AiActivityProvider.tsx` (nothing imports it even today).
3. `apps/web/lib/editor/` modules nothing else reaches: `ai-activity` (imported only by `RightOperationsRail` and `AiActivityProvider`), `default-manuscript`, `expertise-markdown`, `list-editing`, `review-apply`, `review-execution-lane`, `structure-outline`, `view-model`. Also `lib/ui/tokens.ts` and `lib/ui/variants.ts`.
4. Styles imported by `apps/web/app/layout.tsx` in which no class is both defined only there and used by a kept page: `styles/review.css`, `floating.css`, `step-review.css`, `overlays.css`, `review-chat.css`, `sidebar.css`. `styles/editor.css` can go only after its `.save-note` rule is moved to `styles/settings.css`: it is the only definition of that class and `app/settings/page.tsx` uses it. Keep `foundation.css`, `globals.css`, `auth.css`, `layout.css`, `settings.css`. The check covers class names only; compare `/settings` and `/login` before and after by screenshot, because element and attribute selectors in a deleted sheet are not covered.
5. Tests that die with the modules above (remove them from the `test` script of `apps/web/package.json`): `test/list-editing.test.ts`, `test/review-apply.test.ts`, `test/review-execution-lane.test.ts`, `test/structure-outline.test.ts`. `test/change-history.test.ts` and `test/workflow-ui.test.ts` stay, with their modules. Keep every server, contract, import/export and `v2-*` test.
6. Scripts: `apps/web/scripts/qa-inline-review.mjs` and the `qa:inline-review` npm script (it drives `/editor`). `qa:v2` replaces it.
7. Redirect: make `apps/web/app/page.tsx` redirect to `/v2` unconditionally and drop `NEXT_PUBLIC_OREST_DEFAULT_EDITOR`; optionally add a redirect from `/editor` to `/v2`. Remove the `Класична версія` link from `components/v2/V2Workspace.tsx` (header and `Ще` menu) and the `classic`/`classicTitle` strings from both catalogs.
8. Docs: move the classic sections of `docs/CURRENT_STATE.md` to an archive, update `AGENTS.md` (`docs/sample4.html` is named as the visual baseline but is not in the repository; the v2 baseline is `docs/concepts/v2/d1.html`).

### 2.4 What v2 inherits from v1's global CSS and must take over

v2 styles are a CSS module scoped under `.root` (`components/v2/v2.module.css`), but the root layout still loads the classic global stylesheets on `/v2`. Before removing them, give v2 its own equivalents:

- `box-sizing: border-box` for all elements (`styles/foundation.css`). v2 has no reset of its own; without it paddings on inputs, buttons, the sheet and the panel add to their widths.
- `body` margin reset and base `font`/`line-height`/colour (v2 sets its own font and colour on `.root`, but the page background outside `.root` and the zero body margin come from the globals).
- Default resets for `button`, `input`, `textarea`, `a` (font inheritance, colour) where v2 relies on them; check the header, the toolbar, the studio fields and the dialogs.
- The three classic fonts (`Inter`, `IBM Plex Mono`, `Lora`) loaded in `app/layout.tsx` are not used by v2 (it loads `Golos Text` and `Source Serif 4` in `app/v2/layout.tsx`); they can be dropped once the settings and login pages no longer need them. v2 must never use a monospace font.
- Native `<dialog>` and `::backdrop` are styled by v2 itself; nothing to take over.

Do this as its own change with before/after screenshots of every v2 state at 1440, 820 and 390 px.

### 2.5 Verify afterwards

- `npm run typecheck -w @orest/web`, `npm run test -w @orest/web`, `npm run build -w @orest/web`.
- `npm run qa:v2 -w @orest/web` against the built app, then once with `QA_V2_PAID=1`.
- `/`, `/v2`, `/settings`, `/login` load; `/editor` is gone or redirects.
- A browser profile that holds only a classic draft opens `/v2` with that document; a profile with both keeps its v2 draft.
- An image inserted by the classic editor still shows in v2 and in a DOCX export.
- English: switch on `/settings`, check `/v2`, switch back.
- No request to `/api/edit/*` on load or reload of `/v2`.

## Open issues shared by both versions

These live in shared code and affect v1 and v2 equally; decide on each before or during retirement.

Fixed on 2026-10-10 (shared code, so both versions benefit):

- **Patch schema failure on OpenAI.** `POST /api/edit/patch` was rejected by OpenAI with `Invalid schema for response_format 'patch_operations' … Missing 'bold'`, so fragment rewrites (`Простіше`, `Коротше`, free text) failed on the default provider. Strict structured output requires every property to be listed in `required`; the nested rich-text schema did not. OpenAI now uses the same lightweight contract as Gemini (replacement strings, blocks rebuilt on the server) in `apps/web/lib/server/patch-service.ts`. Verified with a real request.
- **Ukrainian clarify pattern.** `\b` is ASCII-only in JavaScript and never matched around Cyrillic, so the fragment router's `clarify` answer was English-only. Fixed in `apps/web/lib/editor/local-action-router.ts`.
- **Stand-in image prompt.** The image prompt endpoint substituted its own prompt when the model's output was unusable. It now returns an error instead (`parseImageDraftOutput` in `apps/web/lib/server/review-action-service.ts`).
- **Headings lost on DOCX export → import.** Import did not recognise the heading styles the app's own export writes (`HeadingOne/Two/Three`). Fixed in `apps/web/lib/editor/import.ts`.

Still open:

1. **Callouts lost on DOCX export → import.** A callout comes back as plain paragraphs; import has no notion of the exported callout styles.
2. **In-memory image job store.** The asynchronous image job path keeps jobs in a per-instance map, so a poll can miss its job on serverless hosting. v2 (like v1) uses one synchronous request instead; a generation in flight at reload is reported as interrupted and not resumed.
3. **Settings page pings the model on every open.** `/settings` calls `/api/settings/validate` when it loads, which sends a small real request (up to 16 output tokens) to the chosen provider. Automated checks that open `/settings` should answer that request themselves, as `qa:v2` does.
4. **Unreferenced images are never deleted.** v2 (like v1) only adds records to IndexedDB `orest-editor-assets-v1`; images of rejected or regenerated illustrations and of replaced documents stay there. An automatic cleanup was built and removed in Milestone 6 because it could delete an image that an in-memory recovery snapshot or another tab's undo history still needed. A safe cleanup needs an owner decision and a design that knows about every holder of an image: all drafts of both versions and languages, every open tab's recovery snapshots and undo history (for example a cross-tab lease or a manual "free up space" action that runs with one tab open).
