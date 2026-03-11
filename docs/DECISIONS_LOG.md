# DECISIONS_LOG

This file keeps only durable, active product and architecture decisions. Temporary implementation notes, superseded options, and migration-only details belong elsewhere.

## 2026-03-11

### Multi-block recommendations stay valid
Decision: whole-text review recommendations may anchor one or more contiguous blocks, but the execution UI must remain singular per recommendation.

Reason: editorial issues often span several adjacent paragraphs, yet the editor should still present one task, one anchor, and one execution card.

### Final review taxonomy for inline execution
Decision: the top-level review suggestion types are `rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`, and `visual`.

Reason: the interaction model needs a compact, behavior-oriented taxonomy.

### Visual is one family
Decision: `illustration` is not a separate top-level recommendation type; it is represented through `visualIntent` inside `visual`.

Reason: media execution should share one UI flow while still allowing different visual intents.

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
