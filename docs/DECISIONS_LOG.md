# DECISIONS_LOG

This file keeps only durable, active product and architecture decisions. Temporary implementation notes, superseded options, and migration-only details belong elsewhere.

## 2026-03-12

## 2026-03-13

## 2026-03-14

## 2026-04-27

### Review-card deduplication is anchor-based, not title-based
Decision: recommendation deduplication in whole-text review no longer collapses non-emphasis cards by identical `title`. Cards are deduplicated only when both anchor range and recommendation type are the same.

Reason: recurring structural cards like `Додати підзаголовок` are expected to repeat across different locations. Title-based dedup was dropping valid cards and hiding actionable edits from editors.

### Subsection cards split by explicit paragraph references and bounded ranges
Decision: subsection normalization now enforces one contiguous anchor per card at runtime by splitting explicit non-contiguous paragraph references (for example `абз. 2, 10, 15-17`) into multiple cards and chunking overly wide subsection ranges into bounded contiguous segments.

Reason: one subsection card applies one heading insertion before one anchor. Without runtime splitting, one broad card could silently apply only to the first location and lose intended structural edits.

### Review diagnostics expose drop/filter transparency in API and rail
Decision: review diagnostics now include drop reasons and per-type filter counts (`droppedItemCountsByReason`, `filteredItemCountsByType`), and the right rail shows these counters.

Reason: editors need to distinguish “model found little” from “system filtered or normalized items away” when auditing low-card runs.

### Rejected review ideas become prompt-level negative memory
Decision: when an editor rejects a recommendation, the app stores only a compact negative memory tuple: `blockIds`, `recommendationType`, and the recommendation text trimmed to 300 characters. Future full-document review runs receive the full list in a dedicated rejected-ideas prompt section, and server normalization drops new cards that overlap a rejected block with the same recommendation type.

Reason: editors should not have to reject the same local editorial move across later stages, but the memory must stay simple and avoid blocking different kinds of useful recommendations for the same paragraph.

### Custom prompt replaces the old final editing stage
Decision: the visible `Фінальна редактура` workflow stage is replaced by `Власний запит`. The persisted step id remains `final_editing` for draft/history compatibility, but the step now requires an editor instruction and may return any executable recommendation card type, including rewrites, lists, subsections, callouts, and visuals.

Reason: editors were not using a fixed final-editing pass, but they still need a flexible way to ask for a specific editorial operation while preserving the card-first, patch-first review model.

### Review-card density is automatic, not user-selected
Decision: the visible `Глибина змін` control is removed from workflow settings. Review prompts now receive an automatic soft card-density hint based on meaningful block count and character volume; the hint is explicitly not a quota or cap.

Reason: editors consistently maxed the control out, so it did not represent a useful product choice. Automatic density preserves the model guidance that prevented too-sparse runs while letting editors curate extra cards by accepting or rejecting them.

## 2026-03-19

## 2026-03-22

## 2026-03-26

### Deep callout body formatting treats short label lines as structural anchors
Decision: deep callout preview parsing now preserves standalone short label lines such as `Прихована загроза` or `Чому це важливо` as separate body paragraphs and auto-emphasizes them in bold, instead of flattening single newlines into one prose paragraph.

Reason: provider output for deep explanatory callouts uses these short labels as lightweight subsection anchors. Collapsing them during client parsing destroys the intended reading rhythm and makes the resulting callout look malformed even when the model output is structurally sound.

### Step drawer headers now expose explicit workflow state and labeled primary actions
Decision: the review drawer header no longer relies primarily on compact icon-only run controls. Each step now shows three explicit header elements: `Етап N / 8`, a visible status pill + status copy derived from shared workflow state, and a labeled primary CTA (`Запустити…` / `Оновити…`) whose wording depends on the active step and whether prior results already exist.

Reason: the editor workflow already had enough local state to describe readiness and progress, but the UI hid too much behind icon recognition and implicit behavior. Explicit header state and CTA copy improve first-run comprehension and create a reusable foundation for later UX remediation work.

### Drawer-level action feedback is now visible for both success and error states
Decision: the editor now renders one shared drawer-level feedback banner for action outcomes, and `info` feedback is treated as visible success state rather than being silently ignored.

Reason: successful actions such as apply, prepare, export, or clear were already writing `info` feedback into state, but only errors were rendered. Surfacing both outcomes restores trust and makes the existing state model useful to the operator.

### Destructive document actions now use inline confirmation, undo, and a single clear control
Decision: the top-bar destructive affordance is a single `Очистити` action. It clears manuscript text plus analysis/session artifacts, and the editor keeps an inline recovery snapshot so the user can undo the action from the in-place recovery banner.

Reason: separate clear/reset buttons were too close in meaning for the main editor audience. A single explicit clear action is easier to understand, and the existing local recovery model still preserves a safe escape hatch.

### Hover-only help is being replaced by inline context and explicit labels
Decision: critical help and control meaning should not depend on native browser `title` tooltips. For this remediation phase, step-context hints move inline, the active mini-hub step label stays visible, and icon-first controls gain explicit accessibility labels rather than relying on hidden hover text.

Reason: the app targets compact professional editing on mixed-input devices. Native tooltip discovery fails on touch and weakens accessibility, while inline context plus labeled controls preserves the compact UI without hiding essential meaning.

### The floating local panel is now a universal local-action bridge
Decision: the old mode-first local panel with separate `Швидко покращити` and `Виконати за запитом` actions is replaced by a compact four-tab bridge: `Редактор`, `Правопис`, `Врізка`, and `Візуал`. `Редактор` is the default local entry and exposes one prompt field plus explicit text intents (`rewrite`, `shorten`, `list`, `table`).

Reason: the product needs one clear local entry point for selected blocks without multiplying CTA meanings or duplicating the existing specialized executors.

### Local action routing is typed and thin
Decision: universal local requests first go through `POST /api/edit/local-action`, which returns one structured execution plan (`patch`, `spellcheck`, `callout`, `visual`, or `clarify`) and then hands off to the existing executor-specific flows.

Reason: this keeps prompt interpretation separate from actual execution, avoids inventing a heavyweight orchestrator, and preserves the current patch/spellcheck/review-proposal backends.

## 2026-03-24

### The local-action bridge is a single compact composer surface
Decision: the production local-action UI no longer renders as a separate top pill plus lower card. It now uses one compact single-surface composer with three layers: a mode-aware header, one main prompt/status area, and one contextual footer strip with the send action anchored on the right.

Reason: the split shell overemphasized tabs, duplicated chrome, and consumed too much space relative to the actual editor task. One compact surface keeps focus on the prompt while preserving mode-specific controls.

### The local composer header shows current mode only when collapsed
Decision: the collapsed local composer header shows the currently active local mode (`Правка`, `Правопис`, `Врізка`, `Візуал`). When the mode list is expanded, the trigger label switches to neutral `Режими`, while the active mode stays highlighted only inside the revealed list.

Reason: showing the current mode in both the trigger and the expanded list duplicates state and makes the header visually noisy. The collapsed/expanded label split keeps state legible without repetition.

### Explicit feature keywords may override text-mode intent inside `Редактор`
Decision: inside the universal `Редактор` tab, explicit feature keywords such as `правопис`, `врізка`, or `візуал` can reroute the request into the corresponding executor, while text-shape choices remain explicit segmented intents rather than being guessed over the user’s selected text mode.

Reason: special feature requests should feel universal, but text editing still benefits from deterministic, editor-controlled intent selection.

### Spellcheck uses a provider-agnostic fragment contract behind a local route
Decision: manual Ukrainian spellcheck is modeled as `POST /api/edit/spellcheck` with a provider-agnostic local contract. The request carries one selected text range inside one block, and the server is responsible for mapping that fragment to LanguageTool and rebasing matches back into block-local offsets.

Reason: this keeps the client stable across public-API and self-hosted LanguageTool modes, preserves the block-first editor architecture, and avoids spreading vendor-specific response shapes into UI code.

### Spellcheck v1 is block-selection driven and read-only in the floating panel
Decision: the first UI integration for spellcheck lives in the existing floating local-action panel as a separate `Правопис` mode. It checks the currently selected text blocks one block at a time and renders grouped findings in the panel, without inline underlines or one-click replacement yet.

Reason: the editor selection model is block-first, while LanguageTool returns plain-text offsets. A panel-first read-only integration gives useful validation value now without prematurely committing to multi-node inline replacement semantics.

### Spellcheck results live in the right drawer, not in the floating panel
Decision: `Правопис` stays a trigger in the floating local-action panel, but spellcheck results themselves live in a dedicated module at the top of the right drawer. Only blocks with issues or request errors are listed there; clean blocks are omitted. Inline underlines remain visible independently from the floating panel until the spellcheck state is cleared or the document revision changes.

Reason: spellcheck behaves like an inspection layer, not like a transient compose action. Keeping results in the persistent right drawer reduces clutter, preserves context while the editor navigates the manuscript, and avoids tying underlines to the lifecycle of the floating panel.

### Spellcheck is a dedicated manual step with batched LanguageTool requests
Decision: spellcheck is surfaced as its own manual step between `Форматування` and `Фінальна редактура` in the right review rail. Selected text blocks are packed into bounded multi-block chunks before hitting LanguageTool, then upstream matches are re-mapped back into block-local issues in the client.

Reason: a dedicated step matches the existing step-based drawer architecture better than a global injected module, and batching avoids the public LanguageTool API rate limits that would be hit by one-request-per-block behavior on long selections.

Update: the primary spellcheck launch now lives in the spellcheck step header as a document-wide CTA (`Проаналізувати правопис` / `Оновити аналіз`), rather than as an in-body selection-driven button.

### Inline spellcheck apply is direct and local
Decision: clicking an underlined spellcheck issue opens a small suggestion popover in the manuscript, and choosing a suggestion applies a local text-range replacement directly into the affected text block while preserving surrounding inline marks.

Reason: spellcheck corrections are deterministic local edits, so they should not route through the heavier diff/execution-card workflow used for AI recommendations.

### Manual editing invalidates spellcheck per changed block, not globally
Decision: when the editor manually changes the manuscript after a spellcheck run, spellcheck findings are dropped only for the changed checked block(s); findings for untouched checked blocks remain visible and actionable.

Reason: locking the whole manuscript during spellcheck is too rigid, but keeping stale offsets alive inside an edited block is unsafe. Per-block invalidation preserves momentum without showing incorrect underlines or suggestions.

### Refine feedback is an explicit regenerate step, not hidden inside apply
Decision: review execution cards separate `Уточнити`, `Перегенерувати`, and `Застосувати/Вставити` into distinct actions. Typed уточнення is sent only through regenerate; apply/insert does not implicitly re-run AI and stays blocked while there is unsent уточнення.

Reason: overloading `Застосувати` to sometimes trigger regeneration is ambiguous and unsafe in a diff-first editor. Editors need a stable rule: apply commits the currently visible result only.

## 2026-03-25

### The manuscript toolbar no longer exposes inline links
Decision: the manuscript toolbar keeps inline `bold` and `italic`, but the old inline link action is removed from the editor surface.

Reason: this product edits book/manuscript prose rather than hyperlink-heavy web copy, and the link action was providing broken value relative to the rest of the local editing surface.

### Local list intent is review-backed, not patch-backed
Decision: local `list` requests from the floating composer route into manual review items plus `/api/edit/review/proposal`, not into the generic patch executor.

Reason: list generation needs recommendation-type normalization, block-shape enforcement, regenerate flow, and a green diff surface that preserves visible bullets.

### Manual local generations bind to visible workflow steps
Decision: manual local `callout`, `visual`, and `list` generations automatically switch the right drawer to their matching workflow steps (`interest`, `visuals`, `formatting`) so the resulting cards stay visible and recoverable after dismissal.

Reason: leaving manual cards on an unrelated active step made dismissed items effectively unreachable beyond the 5-second undo affordance.

### Local spellcheck accumulates by untouched block, and local patch results open inline
Decision: repeated manual `Правопис` runs merge results by block ID so untouched earlier findings remain visible, while local `patch` executions immediately open the manuscript inline diff lane from their first `replace_blocks` result.

Reason: clearing prior spellcheck findings on every new local check breaks trust, and hiding local patch output behind background state makes `Переписати` feel broken even when the backend returns a usable draft.

### Undo and redo are manuscript-only and session-scoped
Decision: the editor keeps an undo/redo stack only for manuscript mutations in the current browser session. It covers manual edits, accepted AI replacements, direct spellcheck applies, and inserted manuscript blocks, but it does not attempt to rewind review-card state or persist a replayable command log across refresh.

Reason: the core trust problem is recovering the manuscript after an accepted or manual change. Session-scoped mutation snapshots solve that directly without introducing the complexity of durable collaborative history or coupling undo to review workflow state.

### Compare history is stored as accepted-change snapshots, not as full versioning
Decision: the `Порівняти` surface stores compact before/after snapshots only for accepted editorial changes that are meaningful to inspect later, starting with AI replace applies and direct spellcheck corrections. These compare entries persist in draft state independently from the undo/redo stack.

Reason: editors asked to verify that accepted changes did not distort meaning, which requires focused before/after evidence rather than a full document timeline. Compact compare snapshots are cheap to persist, easy to explain, and avoid overpromising “version history” before that system exists.

## 2026-03-26

### AI formatting is limited to controlled bold emphasis
Decision: generated editorial text may use controlled `bold` emphasis on short key phrases and short local label lines. The only supported transport syntax is `**...**`, which is parsed into real inline `bold` nodes in the editor. Other markdown remains unsupported and is still stripped from replace/callout/subsection text.

Reason: editors want scan-friendly emphasis, but the product is still a block editor, not a markdown authoring surface. Allowing one narrow emphasis mechanism solves the need without opening generic markdown, noisy styling, or unstable rendering rules.

### Visual prompt editing has both inline and focused surfaces
Decision: visual recommendations now keep the existing inline card for quick edits, but also expose a dedicated full-screen workspace for focused prompt/result review. The focused workspace edits the same active proposal state and remains available both before and after image generation.

Reason: editors need a place to inspect and tune long image prompts and generated assets without compressing that work into the narrow manuscript card, but splitting the state into a second draft model would create drift and trust problems.

### Generated visual previews are invalidated on prompt edits
Decision: whenever the editor changes the active visual prompt text after generation, the current generated asset is cleared immediately until generation is run again.

Reason: keeping the old image visible after a prompt change falsely suggests that the preview still matches the current prompt. Clearing the asset is the simplest honest rule and matches editor expectations.

### Visual captions are opt-in, not copied from recommendation prose
Decision: visual recommendation text must not be copied into the image caption by default; caption remains empty unless the model explicitly returns a caption or the editor types one.

Reason: recommendation prose is workflow guidance, not manuscript-ready figcaption copy, and auto-inserting it makes the manuscript look like the instruction itself was pasted into the document.

### Document-wide `Акценти` is an inline apply/reject layer, not a diff workflow
Decision: the new `Акценти` step does not prepare green diffs or use `/review/proposal`. Instead, step review returns one exact emphasis target per paragraph at most (`emphasisText` plus optional `occurrence`), the manuscript renders those targets directly as blue bold clickable overlays, and the editor accepts or rejects each suggestion in place. Model-generated justifications are not part of the contract.

Reason: this feature is closer to spellcheck than to rewrite proposals. Editors want a fast scan-and-approve emphasis pass that preserves text content, not another diff card pipeline.

### Emphasis prompts must include existing bold in the source document
Decision: when generating `Акценти`, the backend serializes current inline bold as `**...**` in the prompt-visible document text.

Reason: the model needs to see what is already emphasized so it can avoid duplicate or conflicting highlight suggestions.

### `Акценти` does not depend on diagnostics context
Decision: the `Акценти` step runs without `Діагностика` as a prerequisite and its request payload omits diagnostics/expertise-specific prompt context such as `basePrompt`, `cardsPrompt`, `expertise`, and `stepContext`.

Reason: this feature is a lightweight formatting pass over the current manuscript, not a downstream editorial-analysis stage. Sending diagnostics ballast both confuses prompt intent and creates misleading UI states when the wrong step context leaks back into feedback.

### The floating local composer is viewport-bounded and session-draggable
Decision: the local floating composer now measures against the active viewport, clamps itself fully inside visible bounds, and can be dragged to a different screen location from its top strip. The dropped position persists only for the current browser session.

Reason: tablet and mixed-input editing needs a recoverable floating surface that neither clips off-screen nor blocks the same manuscript area permanently. Session-only persistence preserves convenience without carrying stale coordinates across devices or orientations.

### Explicit local tabs outrank keyword inference
Decision: `Правка`, `Правопис`, `Врізка`, and `Візуал` are explicit user modes. Keyword detection inside `Правка` may suggest another mode, but it must not force-switch the active tab or block a manual return to `Правка`.

Reason: a tab click is direct user intent and must remain stable. Keyword inference is useful for discovery, but when it overrides the selected tab the UI becomes non-reversible and feels broken.

## 2026-04-06

### Spellcheck results now use the compact review-card language
Decision: the spellcheck rail should follow the same compact review-card language as the `Структура` and `Ясність` panels. That means flat cards, no nested inner boxes, whole-card click-to-focus, chevron-only expand/collapse, and no green status strip above the spellcheck list.

Reason: spellcheck is an inspection workflow, not a second nested card system. Reusing the established review-card hierarchy reduces visual noise and makes the rail read consistently with the rest of the workflow.

## 2026-03-16

### Gemini fact-check sources come from grounding metadata, not free-text citations
Decision: Gemini fact-check runs use Google Search grounding, and the UI renders sources only from structured `groundingMetadata` mapped into `factCheckRows[].sources[]`. Model-written explanation text is not trusted as a citation carrier.

Reason: asking the model to mention sources inside `explanation` invites hallucinated authors, URLs, and journals. Structured grounded sources are easier to validate, filter, and render safely.

### Clarity prompts forbid disclaimer injection
Decision: `clarity` recommendation prompts and downstream `rewrite`/`simplify` execution prompts must explicitly forbid generic medical disclaimers, consultation advice, and self-diagnosis boilerplate unless the editor asks for that framing.

Reason: “no new facts” was not enough. Models could still inflate local clarity edits into repetitive risk-management copy, which breaks patch-first editing and weakens scan-friendly prose.

### Replace proposals use lightweight content contracts
Decision: `review/proposal` replace-type actions do not ask providers to emit nested editor-native block JSON. Instead, providers return lightweight content contracts (`{"replacements":[...],"reason":"..."}` for `rewrite/simplify/expand`, `{"items":[...],"reason":"..."}` for `list`), and the server reconstructs the final block diff locally.

Reason: the old nested diff contract forced the LLM to serialize editor internals, increasing latency and fragility. The lighter contracts preserve block-first apply semantics, reduce timeout risk, and keep frontend response shape unchanged.

### Explicit subsection instructions bypass model generation
Decision: when a subsection recommendation already includes explicit `Підзаголовок:` and `Текст:` content, proposal generation should build the draft deterministically without calling an LLM.

Reason: this cuts unnecessary latency/cost and avoids low-quality regenerate results for already fully-specified editorial instructions.

### Review-action payloads are normalized server-side
Decision: review-action processing normalizes incoming payloads before proposal generation, including trimming prompt-heavy text fields and compacting non-replace document context to anchor-related blocks.

Reason: client payload size can drift due stale builds or legacy callers; server-side normalization keeps proposal generation predictable and efficient.

### Editor review workspace is split and resizable
Decision: `/editor` uses a unified split workspace for manuscript and review with a draggable vertical resizer, a flyout review drawer, and a pinned step mini-hub.

Reason: dense review content (especially fact-check tables) requires user-controlled space balancing without losing manuscript context.

### Step navigation is icon-first with explicit state cues
Decision: the review step rail is icon-first (Lucide), with explicit visual states for active and completed steps plus compact hover labels.

Reason: this keeps navigation compact while preserving progress clarity in a professional editorial UI.

### Fact-check is a dedicated table mode
Decision: fact-check output is presented as a dedicated table with `Твердження`, `Статус`, and `Пояснення та джерела`, not as generic edit cards.

Reason: factual verification is evaluative and source-oriented; card-style patch actions are not the right primary representation.

## 2026-03-11

### Production deploy fallback is CI-driven
Decision: keep Vercel Git integration connected, but treat GitHub Actions + Vercel CLI (`vercel build --prod` + `vercel deploy --prebuilt --prod`) as the reliable fallback production path on `master` pushes.

Reason: project-level Git auto-deploy ingestion can fail independently of repository state; CI-driven deploys remove dependence on webhook-trigger reliability while keeping Vercel runtime unchanged.

### Multi-block recommendations stay valid
Decision: whole-text review recommendations may anchor one or more contiguous blocks, but the execution UI must remain singular per recommendation.

Reason: editorial issues often span several adjacent paragraphs, yet the editor should still present one task, one anchor, and one execution card.

### Final review taxonomy for inline execution
Decision: the top-level review suggestion types are `rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`, and `visual`.

Reason: the interaction model needs a compact, behavior-oriented taxonomy.

### Visual is one family
Decision: `illustration` is not a separate top-level recommendation type; it is represented through `visualIntent` inside `visual`.

Reason: media execution should share one UI flow while still allowing different visual intents.

### Visual intent is intentionally two-level
Decision: user-facing visual intent options are limited to `infographic` and `illustration`; specific infographic composition (`comparison/process/timeline/cause-effect/layers/diagram`) is auto-inferred from fragment context during prompt assembly.

Reason: editors need low-friction controls, while prompt quality still depends on context-aware composition details.

### Expand is replace, not insert
Decision: `expand` belongs to the replace-type family and applies through full-block replacement of the selected anchor range.

Reason: this keeps prompt behavior and editor behavior aligned with the block-first model.

### Full-block-only review apply
Decision: replace-type review suggestions operate on full blocks only. Phrase-level diffs, character-offset edits, and partial-paragraph apply semantics are out of scope for this phase.

Reason: trust and implementation safety both improve when review apply stays aligned with the block editor model.

### Subsection means subheading insertion
Decision: `subsection` inserts a subheading before the first affected block and may optionally include a short lead paragraph.

Reason: subsection recommendations need one narrow, predictable behavior.

### Approved callout taxonomy
Decision: the allowed callout kinds are `mechanism`, `analogy`, `everyday_application`, `myths_vs_truth`, and `top_list`.

Reason: these kinds fit the science-pop and medical-pop editorial use case and map to distinct manuscript block treatments.

### Ukrainian prompt contracts throughout the review flow
Decision: recommendation-generation prompts, execution prompts, callout prompts, visual prompt-generation prompts, and generated image prompts are all written in Ukrainian.

Reason: the product language is Ukrainian, and prompt language should match the editing workflow.

### Visual prompt output is downstream-ready
Decision: the visual prompt factory must output one ready-to-send image-generation prompt, not a formatted spec with headings, examples, or prompt-engineering commentary.

Reason: the editor is editing the actual downstream prompt, so meta-formatting reduces reuse and increases drift between review intent and generation input.

### Visual proposal parser is dual-mode
Decision: visual proposal parsing accepts structured JSON with `prompt` plus optional `caption`/`alt`, and still accepts legacy plain-text prompt output.

Reason: providers are inconsistent; dual-mode parsing enables richer metadata without breaking existing generation flow.

### Local visual-style presets for prompt preparation
Decision: visual prompt preparation supports four local style presets (`minimal`, `calm_gradient`, `neo_brutal`, `modern_glass`) chosen in visual generation UI, with `calm_gradient` as default and browser-local persistence of the last used preset.

Reason: editors need controllable modern art direction without turning global settings into a style lock for every visual recommendation.

### modern_glass wording policy
Decision: `modern_glass` guidance may mention `liquid-glass` aesthetics, but must avoid direct brand-copy wording (for example, “as in Apple products”).

Reason: this preserves the intended visual direction while keeping prompts vendor-neutral and product-safe.

### Rewrite/simplify quality warning guardrail
Decision: rewrite/simplify proposals run normalized-text similarity checks and surface a no-op warning when output is too close to source.

Reason: near-regurgitation proposals should be explicit to the editor so regenerate can be chosen intentionally.

### Insertion anchors by suggestion type
Decision: `subsection` inserts before the first affected block, while `callout` and `visual` insert after the affected range.

Reason: each insert-type suggestion needs one unambiguous placement rule.

### Manual insert launcher stays in the existing local panel
Decision: manual AI insert generation for `callout` and `visual` runs from the existing floating `Локальна правка` panel and requires an explicit block selection.

Reason: this preserves manuscript-first interaction, reuses the same inline execution lane, and avoids splitting similar actions across a separate AI panel.

### Local panel uses explicit action modes
Decision: local selection actions in `Локальна правка` are mode-first (`Правка`, `Врізка`, `Візуал`) with one primary CTA per mode and mode-scoped prompt fields.

Reason: this removes ambiguity about which action consumes the current prompt and reduces operator errors caused by mixed CTA meanings.

### List recommendations must stay list-shaped
Decision: `list` recommendation apply flow enforces list block output during normalization, even if provider output arrives as paragraphs.

Reason: list suggestions should never silently degrade into paragraph replacements; shape enforcement preserves intent and visible UX difference.

### Replace diff reads from manuscript to proposal
Decision: replace execution keeps source content in manuscript red anchor highlights and renders only proposed editable blocks in the inline card.

Reason: this removes duplicated nested old/new cards and keeps comparison flow clear: source in context, proposal below.

### Apply actions reveal their result in-place
Decision: after apply/insert, the editor auto-scrolls to the first changed block and highlights all changed blocks for 30 seconds.

Reason: users need immediate spatial confirmation of what changed, especially when edits land outside the current viewport.

### top_list callout contract is strict multi-line
Decision: `calloutKind=top_list` output must be source-bound multi-line entries in `Назва: пояснення` format, reinforced with two-shot prompt examples and kind-aware normalization.

Reason: flat one-paragraph drafts were not actionable enough for editorial workflows.

### Repeated no-op proposals escalate in UI messaging
Decision: `rewrite/simplify` no-op warnings remain warning-first, but consecutive no-op generations for the same review item escalate with explicit guidance to strengthen instructions.

Reason: repeated near-identical outputs are typically prompt/flow quality issues and need clear operator direction.

### Replace/list ranges clip accidental heading spillover
Decision: review normalization clips leading/trailing heading blocks from replace-type ranges when mixed with prose content and appends a clipping note to recommendation reason.

Reason: this prevents accidental inclusion of adjacent structural headings while preserving intentional heading-only ranges.

### Execution cards hide duplicated context text
Decision: recommendation execution cards do not render repeated recommendation/reason/excerpt context blocks; cards prioritize editable fields, placement note, status, and CTA actions.

Reason: the manuscript already highlights the source range, so repeated context in cards adds visual noise and weakens action clarity.

### Diagnostics is review-only and does not auto-generate cards
Decision: `Діагностика` runs only narrative analysis; card generation is removed from this step and moved to explicit downstream step execution.

Reason: separating review-only diagnosis from action generation reduces cognitive overload and keeps the workflow sequential and predictable.

### Fact-check uses provider-native structured rows
Decision: fact-check output contract is explicit `rows[]` with `Твердження`, `Статус`, `Пояснення та джерела`, produced directly by model schema contracts (not UI text heuristics).

Reason: structured output is more reliable, easier to validate, and keeps fact-check UX consistent across providers.

### Per-step preserve/replace run mode is persisted locally
Decision: each workflow step has persisted run mode (`preserve` or `replace`) and local step-run history in draft state.

Reason: editors need explicit control between overwriting previous analysis and keeping comparative runs within the same manuscript session.

## 2026-03-14

### Document-level actions live above the editor toolbar
Decision: manuscript-level actions are separated from block formatting controls in a dedicated top action bar: `Відкрити` on the left, `Зберегти` on the right, with explicit clear-document and debug reset actions.

Reason: opening, saving, clearing, and resetting operate on the whole manuscript and should not visually compete with inline block formatting tools.

### Import normalizes external content into the block document model
Decision: import v1 accepts `.txt`, `.docx`, and clipboard text/HTML, and always normalizes incoming content into `EditorDocument.blocks` before replacing the current manuscript.

Reason: the editor is block-first internally, so external content must converge into the same canonical model to keep patch, review, selection, and export behavior coherent.

## 2026-03-10

## 2026-03-26

### Gemini local patch output stays shallow and is reconstructed server-side
Decision: local floating-composer patch requests (`Переписати` / clarity-style rewrites) use a Gemini structured-output contract that returns plain per-block replacement strings (`replacements[]`) plus short metadata, and the server reconstructs final block-first patch operations instead of asking Gemini to emit nested `newBlocks` rich-text AST directly.

Reason: Gemini structured output is materially more reliable with shallow schemas than with deep block-object payloads. Server-side reconstruction keeps the UI contract block-first while avoiding malformed `{}`-heavy responses and unnecessary fallback rewrites.

### Block-first canonical editor model
Decision: the canonical manuscript state is a block-first `EditorDocument` with stable block IDs; patch and review actions are block-anchored and replace whole selected block ranges; markdown is removed from the main editor workflow.

Reason: the product operates on paragraph-level editorial decisions, so block-first state aligns the editor, AI contracts, and navigation model while removing offset fragility.

### Patch-first and diff-first workflow
Decision: the editor remains patch-first and diff-first.

Reason: trust depends on visible, local, reviewable changes rather than automatic full rewrites.

### Ukrainian interface language
Decision: the interface language is Ukrainian.

Reason: the intended editorial workflow and reading audience are Ukrainian.

### Visual baseline
Decision: `docs/sample4.html` is the reference layout direction.

Reason: it best matches the manuscript-centered editing workflow.

### DOCX is the handoff format
Decision: DOCX remains the external handoff/export format.

Reason: the editor is block-first internally, but manuscript handoff still needs a familiar document format.

### Callout and image are first-class blocks
Decision: `callout` and `image` remain first-class block types in the canonical document model.

Reason: these content types need explicit structure, styling, insertion rules, and export behavior rather than paragraph-level hacks.

## 2026-04-04

### Global CSS refactoring should start with ordered partial extraction, not a full styling rewrite
Decision: the web app should move away from one monolithic `apps/web/app/globals.css` by first splitting it into ordered global partials under `apps/web/app/styles/`, preserving selector names and cascade order. CSS Modules should be introduced later only for low-coupling islands such as top bar, login, and settings.

Reason: the current stylesheet mixes multiple generations of layout and feature overrides. A direct rewrite into CSS Modules or a new styling system would create unnecessary regression risk before ownership boundaries and cascade order are stabilized.

## 2026-04-07

### Document-wide emphasis runs are chunked, not monolithic
Decision: the `Акценти` review pass runs in overlapping server-side chunks for larger documents, then merges normalized emphasis targets back into one document-level result set with global anchors.

Reason: emphasis is a span-selection task with high recall requirements. Chunking keeps prompts small enough for stronger per-paragraph attention while preserving one coherent manuscript-level inline UI.

### Emphasis anchors are block-id keyed and repaired server-side
Decision: `Акценти` provider contracts prefer explicit `blockId` for each suggestion, and normalization attempts a local repair when the phrase is valid but the returned block appears to be a wrong nearby paragraph.

Reason: the phrase itself is the stable payload; paragraph attribution is the fragile part. Validating and repairing anchors before they reach the UI reduces dropped accents during bulk apply.

### Emphasis stays reviewable but supports one-click bulk apply
Decision: `Акценти` remains an explicit accept/reject workflow, but the drawer now exposes `Прийняти всі`, which applies all actionable accents in one mutation, creates one compare/history entry, and stays undoable with the normal manuscript undo stack.

Reason: formatting-only changes are low-risk enough for bulk acceptance, but still editorial enough that silent auto-apply would remove too much operator control.

## 2026-04-15

### Level 5 `Акценти` is a dense final emphasis pass
Decision: at change level 5, the `Акценти` pass should target near-complete coverage of meaningful paragraphs with self-contained theses, not just a handful of highest-salience phrases. The step still returns at most one exact short phrase per paragraph and must avoid full-sentence, decorative, or already-bold spans.

Reason: editors use level 5 when they want a strong scanability pass. Sparse output at that setting made the feature feel underpowered even though bulk apply remains reviewable and undoable.

### Bulk accent apply is available from the active step header
Decision: when actionable `Акценти` suggestions exist, the active step header exposes a prominent `Прийняти всі` button in addition to the list-level utility action.

Reason: users expect a single-click accept-all path immediately after the feature produces accents, without hunting in the result list controls.

### Diagnostics uses a strict editorial-risk rubric
Decision: `Діагностика` remains review-only, but its default prompt now requires an editorial verdict, critical risks with severity/evidence/reader harm/local action, a dimension-by-dimension problem map, selective block analysis, and prioritized next workflow steps.

Reason: the earlier diagnostics prompt asked for a detailed review but did not force depth. Editors need a sharper diagnostic layer that separates systemic problems from polish, names medical/scientific risk, and produces useful context for downstream workflow steps.

### Diagnostics is optimized for macro-structure before local critique
Decision: the diagnostics prompt now runs in macro-diagnosis mode for long sections: first the main structural failure and a full map of the chapter, then systemic problems, missing subsection boundaries, redundant or removable material, representative paragraph evidence, and only then the restructuring plan.

Reason: the previous stricter prompt still produced polished local criticism more readily than true chapter-level diagnosis. For long manuscripts, editors need composition analysis and structural operations (`скоротити`, `об'єднати`, `розбити`, `переставити`, `винести`, `видалити`) before micro-level wording critique.

### Diagnostics markdown is rendered as GFM without content post-processing
Decision: diagnostics output in the drawer is rendered with GFM markdown support, but the UI does not rewrite or strip model prose after generation.

Reason: markdown table support is a rendering concern; removing or rewriting intro lines in UI code is brittle and can silently delete meaningful analysis. Diagnostics tone and structure should be fixed in prompt contracts, not by heuristic post-processing.

### Callout depth is a first-class profile
Decision: callouts now have a first-class `calloutDepth` profile with allowed values `brief` and `deep`, separate from `calloutKind`. The model may choose the profile during card generation, manual callout workflows can set it explicitly, and proposal prompts preserve it through regeneration and insertion. `deep` asks for a 3-6 paragraph deep dive into the issue and may combine prose with lists; it is not framed as a rare fallback.

Reason: callout kind answers what shape the sidebar content has, while depth answers how much editorial explanation the manuscript needs. Keeping these axes separate lets end users request and receive richer deep dives without overloading the existing kind taxonomy or steering the model away from depth when the source context supports it.

### Deep callouts may use lightweight internal structure
Decision: deep callouts keep the same UI shell as other callouts, but their body format may use short `**bold**` anchors inside paragraphs plus one short bullet or numbered list when that helps readability. Server-side normalization must preserve those markers instead of stripping them out, and inserted manuscript callouts should render list lines with readable indentation.

Reason: the product does not need a second visual component for “deep” callouts, but longer explanatory blocks become unreadable if every deep dive is flattened into plain uninterrupted prose. Allowing a narrow set of structure markers improves scanability without turning callouts into full markdown articles.

### Dense explanatory callouts should default toward deep
Decision: recommendation-card prompts and fallback review hydration should not treat `brief` as the default callout depth. For dense explanatory fragments, mechanism-heavy passages, causal chains, and contexts that need unpacking, the system should prefer `deep`; `brief` remains for quick side notes and compact clarifications.

Reason: editors were consistently seeing `brief` even when the reading problem clearly called for a fuller explanation. Making the depth choice explicit and biased toward `deep` in those contexts better matches the product goal and user expectations.

### Callout depth normalization may recover semantic deep intent
Decision: review-item normalization should recover `calloutDepth='deep'` when provider output is inconsistent but the title, reason, recommendation, or callout prompt clearly asks for a deep/detailed callout (`глибоку врізку`, `докладно`, `deep dive`, etc.). The recovered depth is also applied to any hydrated callout draft so UI selectors and generated drafts stay aligned.

Reason: real model output can contradict itself: a card may ask for a deep dive in prose while the structured `calloutDepth` field is missing, localized, or incorrectly set to `brief`. The UI should reflect the editorial intent rather than blindly preserving the bad enum value.

### Deep callouts should actively use bold for composition
Decision: deep callout prompts now require active use of `**bold**` both for short 1-3 word subheads on their own lines and for key ideas inside paragraphs. These subheads must not use markdown headings (`#`, `##`) or HTML heading tags.

Reason: allowing bold as an optional flourish produced timid formatting. Editors want deep callouts that scan well at a glance, and short bold subheads plus internal emphasis create that reading rhythm without introducing a second UI treatment.

### Manuscript-generating actions should use bold for scanability
Decision: manuscript-generating execution prompts (`rewrite`, `simplify`, `expand`, `list`, `subsection`, and local patch rewrites) should actively ask for `**bold**` on key ideas and on short local heading/label lines when such lines appear in the replacement text. The expected density is explicit: every meaningful paragraph, replacement block, or list item should receive at least one short bold emphasis, and long or multi-thesis passages may receive 2-3 short emphases. Prompts must still forbid markdown headings (`#`, `##`), HTML headings, arbitrary markdown, whole-sentence bolding, full-paragraph bolding, and full-list-item bolding.

Reason: these actions produce actual manuscript prose, not just side material. If the editor asks the AI to make dense text clearer, the result should also be easier to scan, using the same controlled bold mechanism that now works well for deep callouts. Blanket "no markdown" wording is too easy for models to interpret as "never use `**bold**`", so prompts should instead ban only other markdown.

### Fact-check reports only red flags, not confirmations
Date: 2026-04-29

Decision: the fact-check step must return only medically or scientifically questionable claims: outdated framing, weak evidence, overclaims, suspicious numbers, dosages, thresholds, durations, risks, or measurement units. Correct or unremarkable claims are omitted; an empty table means no separate red flags were found in that run.

Reason: editors need fact-check to focus attention on claims that may need evidence-based verification, especially in manuscripts shaped by older Soviet/post-Soviet health advice. Showing `ok` rows creates false reassurance and clutters the review surface.

### Structure uses an outline map over existing action cards
Date: 2026-04-29

Decision: the `Структура` step should present a chapter outline grouped by manuscript headings and attached structure actions, while preserving `EditorialReviewItem` cards as the only executable units for apply/regenerate/dismiss.

Reason: editors need to see the reading route before deciding on local structure edits, but one broad structural problem can require several separate heading/list/callout insertions. Keeping each insertion as a card preserves the patch-first execution model and avoids a risky whole-outline apply operation.

## 2026-05-07

### Provider keys are server-only in production
Decision: browser clients must not send provider API keys in runtime AI request payloads. In production, server routes ignore any client-provided `apiKey` and use only server environment keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`).

Reason: sending provider secrets from the frontend exposes them in browser tooling and increases leak risk. The app already has server-side route boundaries and Vercel environment configuration, so server-only key resolution is the correct security boundary.
