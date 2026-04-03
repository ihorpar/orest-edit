# DECISIONS_LOG

This file keeps only durable, active product and architecture decisions. Temporary implementation notes, superseded options, and migration-only details belong elsewhere.

## 2026-03-12

## 2026-03-13

## 2026-03-14

## 2026-03-19

## 2026-03-22

## 2026-03-26

### Step drawer headers now expose explicit workflow state and labeled primary actions
Decision: the review drawer header no longer relies primarily on compact icon-only run controls. Each step now shows three explicit header elements: `Етап N / 8`, a visible status pill + status copy derived from shared workflow state, and a labeled primary CTA (`Запустити…` / `Оновити…`) whose wording depends on the active step and whether prior results already exist.

Reason: the editor workflow already had enough local state to describe readiness and progress, but the UI hid too much behind icon recognition and implicit behavior. Explicit header state and CTA copy improve first-run comprehension and create a reusable foundation for later UX remediation work.

### Drawer-level action feedback is now visible for both success and error states
Decision: the editor now renders one shared drawer-level feedback banner for action outcomes, and `info` feedback is treated as visible success state rather than being silently ignored.

Reason: successful actions such as apply, prepare, export, or clear were already writing `info` feedback into state, but only errors were rendered. Surfacing both outcomes restores trust and makes the existing state model useful to the operator.

### Destructive document actions now use inline confirmation and session-local undo
Decision: `Очистити текст` and `Скинути сесію` no longer execute immediately. The editor now shows inline consequence copy before execution and stores a full local session snapshot so the user can undo the destructive action from an in-place recovery banner.

Reason: these controls affect trust-sensitive manuscript state, but the current app can still recover them locally without a modal workflow or server persistence. Inline confirmation keeps scope legible at the point of action, and undo is a better trust pattern than immediate irreversible execution.

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

### AI formatting is limited to sparse bold emphasis
Decision: generated editorial text may use only sparse `bold` emphasis on short key phrases. The only supported transport syntax is `**...**`, which is parsed into real inline `bold` nodes in the editor. Other markdown remains unsupported and is still stripped from replace/callout/subsection text.

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
Decision: the new `Акценти` step does not prepare green diffs or use `/review/proposal`. Instead, step review returns one exact quoted phrase per paragraph at most, the manuscript renders those phrases directly as blue bold clickable overlays, and the editor accepts or rejects each suggestion in place.

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
