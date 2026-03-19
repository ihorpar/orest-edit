# DECISIONS_LOG

This file keeps only durable, active product and architecture decisions. Temporary implementation notes, superseded options, and migration-only details belong elsewhere.

## 2026-03-12

## 2026-03-13

## 2026-03-14

## 2026-03-19

### Refine feedback is an explicit regenerate step, not hidden inside apply
Decision: review execution cards separate `Уточнити`, `Перегенерувати`, and `Застосувати/Вставити` into distinct actions. Typed уточнення is sent only through regenerate; apply/insert does not implicitly re-run AI and stays blocked while there is unsent уточнення.

Reason: overloading `Застосувати` to sometimes trigger regeneration is ambiguous and unsafe in a diff-first editor. Editors need a stable rule: apply commits the currently visible result only.

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
