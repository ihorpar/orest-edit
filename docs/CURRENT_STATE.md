# CURRENT_STATE

Date: 2026-03-08
Status: Active handoff

## What exists now
- A Next.js app under `apps/web`
- Main editor screen at `/editor`
- Settings screen at `/settings`
- Settings now use a focused single-sheet layout instead of the editor's three-pane shell
- Settings now auto-validate the selected provider/model and show a green verified state only after a live provider response succeeds
- Ukrainian UI copy
- Sample4-inspired layout and typography
- Default manuscript demo now uses a long Ukrainian science-pop section about biohacking, HDL/LDL, and cardiovascular risk
- Editable manuscript surface with real text selection tracking
- Markdown formatting toolbar in the manuscript header area for bold, headings, lists, links, tables, code, and dividers
- The markdown toolbar now uses compact grouped icon-like controls with full meanings in tooltip and aria labels, so the editor chrome stays light without losing discoverability
- The markdown toolbar remains compact and grouped; it now stays sticky while scrolling, keeps reset action typography aligned with other buttons, and avoids extra explanatory header copy
- The normal manuscript editing surface now runs through CodeMirror 6 as one source-visible markdown editor with in-place syntax styling instead of a preview-vs-textarea swap
- Manuscript paragraphs now have visible padded number markers in a light gray gutter
- Inserted callouts now use the canonical Ukrainian directive syntax `::: ÃÂ²Ã‘â‚¬Ã‘â€“ÃÂ·ÃÂºÃÂ°: <Ã‘â€šÃÂ¸ÃÂ¿>` plus a separate `#` title line, and CM6 styles that source in place instead of swapping to a prettier non-source block
- Whole-text recommendation detail now renders in a synchronized side overlay instead of squeezing itself into the manuscript flow
- Image markdown stays in the manuscript source, while the selected image preview now renders in a detached side overlay so pasted/generated images do not change line geometry
- Callout recommendations now expose a `ÃÂ¢ÃÂ¸ÃÂ¿ ÃÂ²Ã‘â‚¬Ã‘â€“ÃÂ·ÃÂºÃÂ¸` selector in the side detail panel; changing the type triggers a real draft regeneration with loading feedback before the user can insert it
- Floating selection composer with manual fold/unfold control
- Whole-text review uses the same floating composer shell but now switches into a dark visual mode so `ÃÅ¸ÃÂµÃ‘â‚¬ÃÂµÃÂ²Ã‘â€“Ã‘â‚¬ÃÂ¸Ã‘â€šÃÂ¸ ÃÂ²ÃÂµÃ‘ÂÃ‘Å’ Ã‘â€šÃÂµÃÂºÃ‘ÂÃ‘â€š` reads as a distinct workflow from local chat
- The dark whole-text review composer now morphs back into the regular local-edit composer in place, with a white `Ãâ€ºÃÂ¾ÃÂºÃÂ°ÃÂ»Ã‘Å’ÃÂ½ÃÂ° ÃÂ¿Ã‘â‚¬ÃÂ°ÃÂ²ÃÂºÃÂ°` escape button and stronger mode-specific contrast
- Responsive editor shell that keeps the three-pane desktop layout but restacks utility and review panels into the center flow on tablet/mobile
- Mobile-friendly top bar, manuscript spacing, and settings layout
- Whole-text `ÃÂ ÃÂµÃÂ´ÃÂ°ÃÂºÃ‘â€šÃÂ¾Ã‘â‚¬Ã‘ÂÃ‘Å’ÃÂºÃÂ¸ÃÂ¹ ÃÂ¾ÃÂ³ÃÂ»Ã‘ÂÃÂ´` action now lives at the top of the right review rail
- Left editor rail removed; document reset now lives in the manuscript header
- Right review rail is now always visible on desktop as the permanent document-action and review area
- The top bar no longer repeats pending-review status; the idle editor state is now manuscript-first with a slim review card on the right
- Loading feedback is now contextual: the review button, right-rail loading cards, and floating prompt each show subtle in-place motion instead of a blocking editor overlay
- Patch API route at `/api/edit/patch`
- Editorial review API route at `/api/edit/review`
- Diff cards with short reasons and per-patch accept/reject actions
- Applied manuscript diffs now show removed text in plain red and let editors edit the green replacement directly inside the large review block before leaving diff mode
- Group accept/reject flow for multiple safe patch operations
- Safe patch apply flow that updates manuscript text in place
- Inline manuscript diff preview after apply, kept visible until the editor resumes direct editing
- Applied diffs now use an inline action bar placed immediately below the diff with `ÃÅ¸Ã‘â‚¬ÃÂ¸ÃÂ±Ã‘â‚¬ÃÂ°Ã‘â€šÃÂ¸ diff` and `ÃÅ¸ÃÂ¾ÃÂ²ÃÂµÃ‘â‚¬ÃÂ½Ã‘Æ’Ã‘â€šÃÂ¸Ã‘ÂÃ‘Å’ ÃÂ´ÃÂ¾ Ã‘â‚¬ÃÂµÃÂ´ÃÂ°ÃÂ³Ã‘Æ’ÃÂ²ÃÂ°ÃÂ½ÃÂ½Ã‘Â`
- Each model request is normalized into one selection-wide replace diff before review
- Floating selection composer auto-minimizes after a request is sent to the model
- Floating selection composer is now custom-only and no longer exposes a duplicate `ÃÂ¡ÃÂ¿Ã‘â‚¬ÃÂ¾Ã‘ÂÃ‘â€šÃÂ¸Ã‘â€šÃÂ¸ Ã‘â€žÃ‘â‚¬ÃÂ°ÃÂ³ÃÂ¼ÃÂµÃÂ½Ã‘â€š` action
- Whole-text editorial review returns high-level recommendations with fragment anchors, not diffs
- Whole-text editorial review now anchors to paragraph numbers plus excerpt, not global symbol offsets
- Collapsed request diagnostics and short request history in the editor rail
- Local settings persistence in browser storage
- Default editor prompts are tuned for real editorial tasks: explain terms, tighten dense prose, and normalize tone
- Real OpenAI, Gemini, and Anthropic provider adapters behind one shared patch contract
- OpenAI remains the default provider path in the current UI
- OpenAI now uses the Responses API structured-output path rather than legacy chat completions
- Gemini now uses the documented `responseMimeType` / `responseJsonSchema` structured-output path
- Deterministic local fallback when a provider key is missing or a provider call fails
- Root `.env` fallback for `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY` when the settings form key is left blank
- Settings now show provider-aware `.env` fallback copy, a show/hide API-key control, and a reset-to-defaults action
- Validation that drops malformed or overlapping provider operations before they reach the UI
- Automated tests for patch normalization, batch apply behavior, and provider env/fallback behavior
- README and `docs/DEPLOYMENT.md` document the runtime and port model explicitly
- Repo-level text safeguards now exist through `.editorconfig`, `.gitattributes`, and `npm run check:text`
- Source and docs files have been normalized to UTF-8 without BOM, LF line endings, and a final newline

## What does not exist now
- No separate backend service
- No server-side persistence layer
- No real source retrieval or fact-check implementation
- No route-level or UI interaction test coverage yet
- No export patch flow or version history
- No hardened live Gemini contract handling yet when the model returns unusable local edits
- No CI or pre-commit wiring yet that runs `npm run check:text` automatically

## Current product direction
- User: book editor
- Task: simplify dense scientific writing into simple Ukrainian
- Editing model: local patch proposals only
- Review model: diff + accept/reject + short reason
- Visual baseline: `sample4`

## Current product decisions
- Strict medical mode is not part of the current MVP direction.
- Export patch is not part of the current MVP direction.
- Sources are not a primary navigation flow in the current MVP.
- The editor now uses CodeMirror 6 as the canonical manuscript surface for normal source editing, whole-text recommendation detail, selected-image preview, and the applied-diff review checkpoint
- Side-panel UI for recommendation detail and image preview must stay out of manuscript flow; markdown source remains the only in-flow content.
- User-facing callout labels are Ukrainian aliases (`Ã‘â€žÃÂ°ÃÂºÃ‘â€š`, `Ã‘â€“Ã‘ÂÃ‘â€šÃÂ¾Ã‘â‚¬Ã‘â€“Ã‘Â`, `ÃÂ¼ÃÂµÃ‘â€¦ÃÂ°ÃÂ½Ã‘â€“ÃÂ·ÃÂ¼`, `ÃÂ¿ÃÂ¾ÃÂºÃ‘â‚¬ÃÂ¾ÃÂºÃÂ¾ÃÂ²ÃÂ¾`, `ÃÂ¼Ã‘â€“Ã‘â€ž-Ã‘â€žÃÂ°ÃÂºÃ‘â€š`), but the transport contract still keeps the internal canonical enum values.
- Pending patch proposals are invalidated when the manuscript is edited manually.
- Patch responses now carry diagnostics so the editor can show provider/model/request status without opening dev tools.
- For local development, leaving the settings API-key field empty uses the matching provider key from the repo-root `.env` on the server.
- The settings screen is now a compact operational form, not a reused workspace shell; non-actionable side rails were removed in favor of one centered configuration sheet.
- Provider-specific API payloads are normalized on the server so the editor only consumes one patch contract.
- Provider/model validation in settings now means a real lightweight request succeeded against the chosen upstream model; green status is reserved for live success, not just for a selected preset.
- Provider normalization now repairs common model drift before fallback, including selection-relative offsets and numeric-string indices.
- Provider normalization also collapses fragmented model output into one coherent rewrite for the selected fragment.
- Editorial-review normalization now repairs common model drift too, including string offsets, aliased field names, and excerpt-only anchors.
- The right rail is the permanent document-action and review area on desktop, with whole-text review at the top and review output below it.
- Custom prompting is a floating, selection-triggered action rather than a persistent rail composer.
- The floating selection composer no longer repeats the selected text in a separate preview card; the manuscript highlight is the source of truth.
- The floating selection composer is now custom-only: no separate default-action button remains inside it.
- Whole-text review is a separate diagnostic flow, not a rewrite flow: it analyzes the full manuscript and returns editor-facing recommendations with exact text anchors.
- Whole-text review anchors against paragraph numbers and excerpt text, while local patching still uses character offsets.
- After a request is sent, the floating selection composer collapses automatically and can be reopened from its top-right toggle.
- After accept, the manuscript switches into a short review mode that shows applied edits inline as diffs until the user clicks back into editing.
- One request now maps to one coherent diff card for the selected fragment, even if the model attempted to return several local edits.
- After a patch is applied, the large manuscript diff becomes the last editorial checkpoint: the editable green replacement in that review block updates the live applied text before the editor clicks `Ãâ€œÃÂ¾Ã‘â€šÃÂ¾ÃÂ²ÃÂ¾`.
- The manuscript canvas prioritizes reading space over editor chrome, with less artificial empty height and a wider text block.
- During direct editing, the canvas switches back to the native textarea layer so selection and cursor behavior stay stable after a diff is applied and dismissed.
- Below tablet width, utility and review content no longer depend on side rails; the shell duplicates those panels into the center-column flow so the editor remains fully usable in one column.
- Deployment guidance is split between a short README summary and detailed `docs/DEPLOYMENT.md` runtime notes.
- Repository text files are treated as UTF-8 with LF line endings, and integrity is checked via `npm run check:text`.

## Highest-priority next work
1. Add route-level and editor interaction coverage around CM6 typing, image-preview overlay behavior, recommendation-lane positioning, and diff review.
2. Harden Gemini using the live failure case where the provider responded but still produced unusable local edits for the shared patch contract.
3. Live-validate Anthropic with a real key and harden provider-specific error handling from real responses.
4. Remove dead legacy editor code now that CM6 owns direct editing and diff review.
5. Add a more robust browser-driven screenshot harness for seeded CM6 states instead of relying on manual screenshots plus a default headless capture.

## Last validated state
- `npm run check:text` passed
- `npm run typecheck` passed
- `npm run build` passed
- `npm run test` still fails in four pre-existing service/selection tests unrelated to the CM6 surface: two `applyMarkdownFormat` selection-range expectations in `test/patch-contract.test.ts` and two provider-normalization expectations in `test/patch-service.test.ts`
- Windows headless Chrome captured the live `/editor` surface after the CM6 migration in `.tmp/cm6-editor-default.png`
- runtime patch request succeeded through OpenAI with the form API key left blank
- live runtime Gemini request reached the provider via repo-root `.env`, but fell back because the returned local edits were empty or invalid for the shared patch contract
- mocked provider tests cover OpenAI, Gemini, and Anthropic request/response normalization
- OpenAI repair logic now rebases selection-relative offsets and coerces numeric-string indices before declaring provider operations invalid
- headless Chrome UI smoke run confirmed persistent selection visibility while typing in the floating prompt and inline diff rendering after apply; screenshots saved to `.tmp/ui-selection-prompt.png` and `.tmp/ui-applied-diff.png`
- headless Chrome UI smoke run confirmed the floating panel no longer renders duplicate selection context, supports manual fold/unfold, and auto-collapses after send; screenshots saved to `.tmp/ui-panel-collapsed.png` and `.tmp/ui-panel-auto-collapsed.png`
- headless Chrome UI smoke run confirmed the review rail is now 420px wide, the applied-diff footer renders immediately below the inline diff, and direct editing hides the render overlay again after returning from diff review; screenshots saved to `.tmp/ui-right-rail-wide.png`, `.tmp/ui-review-footer-bottom.png`, and `.tmp/ui-inline-review-footer.png`
- headless Chrome UI smoke run confirmed whole-text review output in the right rail and jump-to-fragment behavior back into the manuscript; screenshots saved to `.tmp/ui-editorial-review.png` and `.tmp/ui-editorial-review-focus.png`
- `Ãâ€Ã‘â€“ÃÂ°ÃÂ³ÃÂ½ÃÂ¾Ã‘ÂÃ‘â€šÃÂ¸ÃÂºÃÂ° ÃÂ¾ÃÂ³ÃÂ»Ã‘ÂÃÂ´Ã‘Æ’` can now show raw provider output in a nested accordion for review debugging
- headless Chrome UI smoke run confirmed visible paragraph numbers in the manuscript gutter and paragraph-anchored review jump behavior; screenshots saved to `.tmp/ui-paragraph-numbers.png` and `.tmp/ui-paragraph-review-focus.png`
- The manuscript canvas no longer swaps visible text layers on focus; the render layer remains authoritative while the transparent textarea only handles caret and selection, which prevents paragraph-number drift after click/focus.
- The manuscript serif switched from Playfair Display to Lora for better Ukrainian readability, and the redundant left-rail note `ÃÅ¾ÃÂ³ÃÂ»Ã‘ÂÃÂ´ ÃÂ½ÃÂµ ÃÂ·ÃÂ¼Ã‘â€“ÃÂ½Ã‘Å½Ã‘â€ Ã‘â€šÃÂµÃÂºÃ‘ÂÃ‘â€š Ã‘â€“ ÃÂ½ÃÂµ Ã‘ÂÃ‘â€šÃÂ²ÃÂ¾Ã‘â‚¬Ã‘Å½Ã‘â€ diff.` was removed.
- Windows headless Chrome captured the refreshed manuscript typography and gutter state in `.tmp/ui-editor-font-refresh.png`.
- Editorial review cards are now intentionally compact; the full recommendation opens inline under the referenced paragraph inside the manuscript instead of overloading the right rail with dense copy.
- Jumping to a review item no longer opens `Ãâ€ºÃÂ¾ÃÂºÃÂ°ÃÂ»Ã‘Å’ÃÂ½ÃÂ° ÃÂ¿Ã‘â‚¬ÃÂ°ÃÂ²ÃÂºÃÂ°`; the floating local-patch panel stays suppressed while an editorial-review detail is active.
- The editor now persists the current draft in browser `localStorage`, including manuscript text, selection, pending local patches, whole-text review state, applied diff-review state, diagnostics, and request history, so switching between `/editor` and `/settings` no longer resets the session.
- The top navigation label changed from `ÃÂ Ã‘Æ’ÃÂºÃÂ¾ÃÂ¿ÃÂ¸Ã‘Â` to `ÃÂ ÃÂµÃÂ´ÃÂ°ÃÂºÃ‘â€šÃÂ¾Ã‘â‚¬`, and the draft-reset action now lives in the manuscript header without wiping saved model settings.
- The editor no longer uses a persistent left rail; manuscript-level reset moved into the manuscript header, and whole-text review moved to the top of the right rail.
- The top bar no longer shows a duplicate pending-review badge, and the idle right rail now narrows to a compact review-action card until actual review or patch content exists.
- AI processing uses local animated feedback in the button, right rail, and floating prompt instead of a global spinner overlay.
- The editor typing layer now uses one shared metric system for both the manuscript overlay and the native textarea, and focused editing reveals the native textarea text again. This fixes caret/input desync caused by paragraph spacing and font-shaping differences between the two layers.
- Editorial-review detail stays open during normal manuscript clicks and selection changes; it now closes only through explicit close controls, with a top-right close icon instead of the old text button.
- Settings now offer provider-specific model presets plus a fourth `Ãâ€™ÃÂ²ÃÂµÃ‘ÂÃ‘â€šÃÂ¸ ÃÂ²Ã‘â‚¬Ã‘Æ’Ã‘â€¡ÃÂ½Ã‘Æ’` path. The defaults were refreshed to current catalog picks: OpenAI `gpt-5.4`, Anthropic `claude-opus-4-6`, and Google `gemini-3.1-pro-preview`.
- The settings page now validates the current OpenAI model successfully through repo-root `.env` fallback and surfaces the success state inline in the sheet header and model field.
- The review-detail panel now has its own top stacking layer inside the manuscript frame, so editor text no longer renders on top of it and the close controls remain clickable.
- The custom prompt composer now sits centered at the bottom of the editor in a chat-style layout. It opens as a single-line input by default, then auto-grows up to a bounded multi-line height as the user types.
- The app root `/` now redirects straight to `/editor`; the old welcome screen was removed so the browser always lands in the working editor first.
- Windows headless Chrome verified the responsive editor and settings layouts at desktop and narrow mobile widths; screenshots saved to `.tmp/editor-responsive-desktop.png`, `.tmp/editor-responsive-mobile.png`, and `.tmp/settings-responsive-mobile.png`.
- Windows headless Chrome captured the redesigned settings sheet at desktop and mobile widths in `.tmp/settings-redesign-desktop.png` and `.tmp/settings-redesign-mobile.png`.
- `npm run typecheck` passed after removing the editor left rail and redistributing document-level actions.
- `npm run build` passed after the same layout pass.
- Windows headless Chrome captured the editor without the left rail, with `ÃÅ¾Ã‘â€¡ÃÂ¸Ã‘ÂÃ‘â€šÃÂ¸Ã‘â€šÃÂ¸ ÃÂ²Ã‘ÂÃÂµ` in the manuscript header and `ÃÅ¸ÃÂµÃ‘â‚¬ÃÂµÃÂ²Ã‘â€“Ã‘â‚¬ÃÂ¸Ã‘â€šÃÂ¸ ÃÂ²ÃÂµÃ‘ÂÃ‘Å’ Ã‘â€šÃÂµÃÂºÃ‘ÂÃ‘â€š` at the top of the right rail, in `.tmp/editor-right-rail-layout.png`.
- `npm run typecheck` passed after removing the top-bar pending badge, tightening the manuscript header, and slimming the idle right rail.
- `npm run build` passed after the same polish pass.
- Windows headless Chrome captured the polished idle editor with the slim right review card and `ÃÂ¡ÃÂºÃÂ¸ÃÂ½Ã‘Æ’Ã‘â€šÃÂ¸ Ã‘â€¡ÃÂµÃ‘â‚¬ÃÂ½ÃÂµÃ‘â€šÃÂºÃ‘Æ’` header action in `.tmp/editor-idle-polish.png`.
- `npm run typecheck` passed after adding contextual loading indicators for AI processing.
- `npm run build` passed after the same loading-state pass.
- Windows headless Chrome captured the idle editor after the loading-state polish in `.tmp/editor-loading-polish-idle.png`; the captured frame verifies the resting layout, while the loading animation itself was validated in code and build output rather than through a frozen in-flight screenshot.
- `npm run typecheck` passed after adding markdown toolbar helpers, markdown preview rendering, and source-vs-preview editor states.
- `npm run build` passed after the same markdown-editor pass.
- Linux Playwright smoke run confirmed the formatted idle markdown preview and the focused raw-markdown source view after injecting a markdown draft into local storage; screenshots saved to `.tmp/editor-markdown-preview.png` and `.tmp/editor-markdown-source.png`.
- Product analysis on 2026-03-07 confirmed the preview-vs-source manuscript swap created click/caret drift in long documents; that path has now been replaced for normal editing by the CM6 source-first editor.
- `npm run typecheck` passed after moving diff editability into the large manuscript review block and removing strikethrough from deleted text.
- Windows headless Chrome captured the large manuscript diff with plain red removed text and an editable green replacement field in `.tmp/ui-big-diff-editable.png`.
- `npm run typecheck` passed after migrating inserted callouts to the new `::: ÃÂ²Ã‘â‚¬Ã‘â€“ÃÂ·ÃÂºÃÂ°` syntax, wiring type-regeneration in the side review panel, and de-emphasizing technical image source tokens in CM6.
- `npm run build` passed after the same callout/source-visual cleanup pass.
- `npm run test` still reports the same 4 pre-existing failures in `test/patch-contract.test.ts` and `test/patch-service.test.ts`; this callout pass did not change those areas.
- Screenshot\ automation\ for\ this\ pass\ is\ currently\ blocked\ in\ the\ Linux\ environment\ because\ Playwright's\ Chromium\ binary\ cannot\ launch\ without\ `libnspr4\.so`;\ build/typecheck/test\ were\ run\ successfully,\ but\ no\ new\ browser\ screenshot\ could\ be\ captured\ in\ this\ session\.\r\n-\ Windows\ headless\ Chrome\ captured\ the\ plain-language\ markdown\ toolbar\ redesign\ in\ `\.tmp/editor-toolbar-plain-language\.png`\.
- Windows headless Chrome captured the plain-language markdown toolbar redesign in `.tmp/editor-toolbar-plain-language.png`.
- `npm run typecheck` passed after rolling back the verbose toolbar header copy/chips and adding sticky behavior.
- `npm run build` currently fails in this environment with `PageNotFoundError: Cannot find module for page: /_document`; toolbar runtime validation used dev mode plus screenshot instead.
- Windows headless Chrome captured the rollback toolbar fix in `.tmp/editor-toolbar-rollback-fix.png`.
- `npm run test` is currently not runnable in this environment because the workspace Node binary rejects the script's `--experimental-strip-types` flag.
- current local Next listener is on `3001`; code and docs still treat `3000` as the default local port and `PORT` as the production contract
- a one-line README edit still failed through the native `apply_patch` tool in this session, even after repo text normalization, so shell fallback remains necessary here
