# Build Inline Review Execution For Multi-Block Editorial Suggestions

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

## Purpose / Big Picture

The current block-first editor can already generate whole-text review recommendations, but the execution model still does not match the intended product. Recommendations are still mostly consumed from the right rail, only text diffs have any manuscript-inline execution UI, and the manuscript does not yet behave like the anchored, in-place review surface shown in `docs/sample4.html`.

The goal of this plan is to implement the full inline review workflow that we discussed and validated. One recommendation may target one or more contiguous blocks. When the editor focuses that recommendation, the affected blocks are highlighted in the manuscript with one continuous left-side border, replace-type suggestions show the affected text in a replace-state, and one floating execution card appears below the full anchored range. The card behavior depends on the suggestion type. Replace-type suggestions operate on full blocks only. Insert-type suggestions create first-class blocks such as a subsection heading, a `callout`, or an `image`.

After this work, a Ukrainian-speaking book editor can review compact recommendations in the right rail, focus one recommendation, inspect the full affected block range in the manuscript, and execute one clear inline workflow:

- `rewrite`, `simplify`, `expand`, `list`: edit and apply a block-scoped replacement diff.
- `subsection`: insert a generated subheading before the fragment.
- `callout`: choose a callout kind, generate or regenerate a callout draft, and insert it as a first-class block.
- `visual`: edit a Ukrainian image prompt, generate or regenerate the image, and insert it below the fragment as a first-class image block.

The implementation must remain patch-first and diff-first, and every AI prompt involved in this workflow must be in Ukrainian. Generated image prompts must also be Ukrainian.

## Progress

- [x] Audit the current review execution path, inline diff overlay, callout/image block insertion, and prompt settings against this plan.
  - [x] Compared editor state and rendering paths in `page.tsx`, `BlockEditorSurface.tsx`, and right-rail components against expected sample4 behavior.
  - [x] Verified contract, prompt, and apply-path coverage in `review-contract.ts`, `review-service.ts`, `review-action-service.ts`, and `patch-contract.ts`.
- [x] Narrow the review taxonomy and contracts to the confirmed seven-type model.
  - [x] Normalized top-level types to `rewrite`, `expand`, `simplify`, `list`, `subsection`, `callout`, `visual`.
  - [x] Added legacy coercion for `visualize`/`illustration` and prior callout kinds.
  - [x] Aligned suggestedAction/insertionHint mapping by recommendation type.
- [ ] Build manuscript anchor highlighting with one continuous left border and one active inline execution card.
  - [x] Active recommendation focus state and scroll-to-anchor behavior are in place.
  - [x] Preparing state now shows one lead loader for the anchor range instead of duplicated loaders for each block.
  - [ ] Continuous left-side anchor border across the full active range is not implemented.
  - [ ] Single floating execution card below the full anchor range is not implemented.
- [ ] Rebuild `rewrite`, `simplify`, `expand`, and `list` as constrained full-block replace flows.
  - [x] Multi-block diff editing/apply is block-aware (no longer one flattened textarea repeated across blocks).
  - [x] Replace apply still runs through whole-block `replace_blocks` anchored by block IDs.
  - [ ] Replace-state manuscript rendering (red removed context + green editable replacement in one floating lane) is not implemented.
  - [ ] Block-count output constraints (`rewrite/simplify/expand` exact count, `list` never exceeding selection) are not enforced.
- [ ] Implement `subsection` as heading insertion before the first affected block.
  - [x] Contract semantics are normalized to `insert_text` + `before`.
  - [x] Unsafe fallback to generic replace diff is prevented with explicit fail-safe response.
  - [ ] Subsection proposal card (heading + optional lead) is not implemented.
  - [ ] Apply-path insertion before the first affected block is not implemented.
- [ ] Replace the current callout taxonomy and build the full choose-kind, generate, regenerate, and insert flow.
  - [x] Approved callout kinds (`mechanism`, `analogy`, `everyday_application`, `myths_vs_truth`, `top_list`) are in contract and defaults.
  - [x] Generate/regenerate and insert are working in the active recommendation detail panel.
  - [x] Inserted output is a first-class `callout` block with distinct block styling.
  - [ ] Kind switching before generation is not implemented in the execution UI.
  - [ ] Manuscript-inline callout execution card is not implemented.
- [ ] Merge `visualize` and `illustration` into one `visual` family with visual intents and editable Ukrainian image prompts.
  - [x] Legacy `visualize`/`illustration` inputs normalize to `visual`.
  - [x] `visualIntent` is supported in the review contract and review-generation schema.
  - [x] Editable Ukrainian image prompt exists in the active recommendation detail panel.
  - [ ] Manuscript-inline `visual` execution card is not implemented.
- [ ] Wire review-image generation into the manuscript execution UI, including generate, regenerate, preview, and insert-below behavior.
  - [x] Generate/regenerate/preview/insert behavior exists in the right-rail active detail flow.
  - [x] Insert creates a first-class `image` block after the recommendation anchor.
  - [ ] Execution is still rail-first, not manuscript-inline.
- [ ] Author dedicated Ukrainian prompt factories for recommendation generation, each suggestion type, each callout kind, and visual/image generation.
  - [x] Ukrainian defaults exist for review, callout, and image prompt templates in settings.
  - [x] Runtime prompt assembly includes callout-kind description and visual-intent context.
  - [ ] Dedicated runtime prompt factories per suggestion type (`rewrite`, `simplify`, `expand`, `list`, `subsection`) are not implemented.
  - [ ] Runtime enforcement for anti-hallucination clauses is still mostly template-driven, not fully centralized as factories.
- [ ] Add tests and browser validation for the full workflow, including stale-anchor handling, block-count constraints, and Ukrainian prompt output.
  - [x] Added/updated tests for taxonomy normalization and subsection fail-safe behavior.
  - [x] Stale-anchor detection is implemented via block-ID and fingerprint checks.
  - [ ] Full workflow coverage for single inline execution lane and block-count guardrails is not implemented.
  - [ ] Browser QA pass for sample4-style inline behavior is still pending.
  - [ ] Test execution is currently blocked in this environment by `esbuild` platform mismatch (Windows binary in WSL/Linux runtime).

## Surprises & Discoveries

- Observation: the repo already has most backend primitives needed for this phase.
  Evidence: whole-text review generation, review proposal generation, first-class `callout` and `image` blocks, and review-image generation endpoints already exist in `apps/web/lib/server` and `/api/edit/review/*`.

- Observation: the largest gap is the interaction contract, not raw capability.
  Evidence: the current code can generate review items and proposal payloads, but the UI still does not provide the sample4-style manuscript-first execution path.

- Observation: stable block IDs already protect anchors better than pure paragraph numbering.
  Evidence: `apps/web/lib/editor/manuscript-structure.ts` resolves anchors by `block.id` plus fingerprint rather than visible row number alone.

- Observation: block-count churn is still the highest-risk implementation area.
  Evidence: replace normalization in `apps/web/lib/editor/patch-contract.ts` can currently emit more replacement blocks than originally selected, and only the original replaced range preserves IDs.

## Decision Log

- Decision: a review recommendation may anchor one or more contiguous blocks, but the execution UI remains singular per recommendation.
  Rationale: editorial issues often span several adjacent paragraphs, yet the editor should still see one task and one execution surface.
  Date/Author: 2026-03-11 / User-confirmed product direction

- Decision: the top-level review suggestion types are `rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`, and `visual`.
  Rationale: this set is broad enough for real editorial work while still mapping cleanly to a small number of execution UIs.
  Date/Author: 2026-03-11 / User-confirmed product direction

- Decision: `illustration` is not a separate top-level suggestion type; it is represented through `visualIntent` under `visual`.
  Rationale: the media workflow should share one UI flow while still permitting different output intents.
  Date/Author: 2026-03-11 / User-confirmed product direction

- Decision: `expand` is a replace-type suggestion, not an insertion type.
  Rationale: the editor safely supports full-block replacement; turning `expand` into insertion would create an unnecessary second behavior model.
  Date/Author: 2026-03-11 / User-confirmed product direction

- Decision: replace-type suggestions are full-block only.
  Rationale: the product currently supports full-paragraph edits only, so prompts and apply semantics must not imply phrase-level edits or character-offset diffs.
  Date/Author: 2026-03-11 / User-confirmed product direction

- Decision: `subsection` means inserting a subheading before the first affected block, optionally with a short lead paragraph.
  Rationale: subsection recommendations need one narrow, predictable behavior rather than a vague “restructure this” action.
  Date/Author: 2026-03-11 / User-confirmed product direction

- Decision: approved callout kinds are `mechanism`, `analogy`, `everyday_application`, `myths_vs_truth`, and `top_list`.
  Rationale: these kinds fit the science-pop and medical-pop editorial workflow better than the current taxonomy.
  Date/Author: 2026-03-11 / User-confirmed product direction

- Decision: all prompts in this review workflow are Ukrainian, and generated image prompts are also Ukrainian.
  Rationale: the editor UI and editorial workflow are Ukrainian, so prompt language should not leak into English.
  Date/Author: 2026-03-11 / User-confirmed product direction

- Decision: insertion anchors are explicit by suggestion type.
  Rationale: `subsection` inserts before the first affected block; `callout` and `visual` insert after the affected range, which removes ambiguity and matches the intended manuscript flow.
  Date/Author: 2026-03-11 / User-confirmed product direction

## Outcomes & Retrospective

This plan exists because the current app already has the technical substrate for review generation, but not yet the correct product execution model. The work here is primarily about aligning contracts, prompts, UI state, and apply behavior with the editorial workflow we agreed on.

The plan is intentionally strict. It treats prompt design as part of product behavior, not as implementation detail. It also treats output-shape constraints as a core trust feature, not just a backend validation detail. The biggest implementation risk is still structural churn during replace-type apply, so the plan repeatedly centers block-count safety, stale-anchor invalidation, and single-card execution.

If implemented faithfully, this phase should remove the biggest mismatch between the current app and the intended product: the app will stop behaving like “review cards plus ad hoc proposal handling” and start behaving like a manuscript-first editorial workbench.

## Context and Orientation

The app is a web-only Next.js product under `apps/web`. The main editor route is `apps/web/app/editor/page.tsx`, which owns document state, review items, active proposal state, block insertion, and current patch/review apply flows. The manuscript surface is implemented in `apps/web/components/editor/BlockEditorSurface.tsx`. It already renders numbered rows by stable block ID and supports first-class `callout` and `image` blocks from the canonical document model in `apps/web/lib/editor/document-model.ts`.

Whole-text review types and normalization live in `apps/web/lib/editor/review-contract.ts`. Whole-text recommendation generation lives in `apps/web/lib/server/review-service.ts`. Recommendation execution lives in `apps/web/lib/server/review-action-service.ts`. Replace-type operation normalization and apply behavior live in `apps/web/lib/editor/patch-contract.ts`. Anchor resolution, revision tracking, and stale detection live in `apps/web/lib/editor/manuscript-structure.ts`. Review-image generation already exists in `apps/web/lib/server/review-image-service.ts`, `apps/web/lib/server/review-image-job-service.ts`, and `/api/edit/review/image`.

For this plan, the following terms are used consistently:

- Anchor range: the contiguous block range targeted by one review recommendation.
- Execution card: the single floating manuscript-inline card rendered below the full anchor range when a recommendation is active.
- Replace-type suggestion: `rewrite`, `simplify`, `expand`, or `list`. These replace existing anchor blocks and stay full-block only.
- Insert-type suggestion: `subsection`, `callout`, or `visual`. These insert a new block before or after the anchor range without directly rewriting the anchor blocks.
- Visual intent: a subtype within `visual`, for example `diagram`, `comparison`, `process`, `timeline`, `scene`, or `concept`.
- Full-block only: the editor only applies complete replacement blocks, never phrase-level or sentence-level surgery inside a block.

`docs/sample4.html` is the reference for the anchored-border plus floating-card composition. The goal is not literal visual duplication; the goal is to preserve the manuscript-first execution model.

## Plan of Work

### Milestone 1: Narrow The Contract Before Rebuilding UI

The first milestone tightens the taxonomy and runtime contract so every downstream UI state is predictable. `apps/web/lib/editor/review-contract.ts`, `apps/web/lib/server/review-service.ts`, and `apps/web/lib/server/review-action-service.ts` must agree on the seven top-level suggestion types, the approved callout taxonomy, the `visual` family, and the full-block-only rule for replace-type suggestions.

This milestone also removes ambiguity around action categories:

- `rewrite`, `simplify`, `expand`, `list` => replace flows
- `subsection`, `callout`, `visual` => insert flows

At the end of this milestone, recommendation payloads, proposal payloads, and prompt builders should all use the same language and shape.

### Milestone 2: Establish One Active Inline Review Execution Lane

The second milestone reshapes editor page state around one active review execution lane. The right rail remains the inbox. Clicking a recommendation should no longer just “focus and maybe prepare”. It should establish:

- the active recommendation id
- the full anchor range block IDs
- the anchor start and end row positions
- the active execution mode
- the prepared execution payload for that one recommendation

The manuscript surface must be able to render one continuous left-side border across the full anchor range and exactly one floating execution card below the last block in the range.

### Milestone 3: Replace-Type Execution Flows

The third milestone rebuilds `rewrite`, `simplify`, `expand`, and `list` around one consistent replace workflow.

Expected behavior:

- affected blocks are visibly in replace-review state
- affected manuscript text in the anchor range is shown in red replace-review state
- one floating card shows the proposed replacement with editable green add-text and visible removed text
- applying uses the edited content if the editor changed it in the card
- replacement remains full-block only
- replace output must not exceed the selected block-count ceiling

This milestone must also fix the current unsafe multi-block apply behavior where one textarea string can be written back into multiple blocks incorrectly.

The intended default rule is:

- `rewrite`, `simplify`, `expand` preserve selected block count exactly
- `list` may reduce to one structured list block or preserve the selected count, but must never exceed the selected count
- soft line breaks stay inside the block; they must not silently become extra blocks

### Milestone 4: Subsection Insertion Flow

The fourth milestone introduces the first insert-type flow that is not callout/image based.

Expected behavior:

- focusing a `subsection` recommendation highlights the anchor range
- the execution card shows a proposed subheading and optional short lead
- applying inserts the heading before the first affected block
- the original anchor blocks are not silently rewritten as part of this flow

This is the narrow definition we agreed on and should not drift into general restructuring.

### Milestone 5: Callout Flow With Approved Taxonomy

The fifth milestone replaces the current callout taxonomy and flow.

Expected behavior:

- `callout` cards expose exactly five kinds:
  - `mechanism`
  - `analogy`
  - `everyday_application`
  - `myths_vs_truth`
  - `top_list`
- the editor can switch kinds before generation
- the editor can generate and regenerate
- the generated content remains explicitly editable before insertion
- applying inserts a first-class `callout` block after the affected range
- inserted callouts render with distinct block styling and formatting, not as plain paragraph text

This milestone must also include kind-specific anti-hallucination rules, especially for `analogy` and `myths_vs_truth`.

### Milestone 6: Visual Flow With Ukrainian Prompts And Image Generation

The sixth milestone merges `visualize` and `illustration` into one `visual` execution family and wires the existing review-image backend into the manuscript UI.

Expected behavior:

- the execution card exposes an editable Ukrainian image-generation prompt
- the prompt is generated in Ukrainian and remains editable in Ukrainian
- the editor can generate and regenerate the image
- the editor can preview the generated image before insertion
- applying inserts an `image` block after the affected range

This milestone must also define how `visualIntent` is selected and displayed inside the execution card.

### Milestone 7: Prompt Factories As First-Class Product Work

The seventh milestone formalizes prompt work. The plan requires explicit Ukrainian prompt factories rather than vague settings strings. Each suggestion type and each callout kind needs a dedicated task with a stable contract and acceptance criteria.

This milestone is not optional polish. It is core product behavior.

### Milestone 8: Validation, Staleness, And QA

The final milestone adds test and QA coverage for the interaction contract:

- anchor-range continuity
- single-card execution
- stale suggestion invalidation after overlapping apply
- block-count safety for replace flows
- insertion anchors by type
- Ukrainian-only prompts and generated image prompts
- anti-hallucination constraints in callout generation

## Prompt Workstreams

The prompt work is part of the implementation, not an appendix. Each of the following requires its own prompt factory task and integration task.

### Recommendation Generation Prompt

Task: author the Ukrainian whole-text review prompt that returns anchored recommendations in structured JSON using the seven-type taxonomy.

Draft prompt shape:

    Ти робиш редакторський огляд українського науково-популярного рукопису.
    Працюй як книжковий редактор, а не як автор.
    Пропонуй тільки локальні зміни з високою редакторською цінністю.
    Одна рекомендація може охоплювати один або кілька суміжних блоків.
    Дозволені recommendationType: rewrite, simplify, expand, list, subsection, callout, visual.
    Для callout обов'язково вкажи calloutKind: mechanism, analogy, everyday_application, myths_vs_truth, top_list.
    Для visual обов'язково вкажи visualIntent: diagram, comparison, process, timeline, scene, concept.
    Для replace-типів не пропонуй часткові правки всередині абзацу; система працює тільки цілими блоками.
    Не додавай зовнішніх фактів.
    Поверни тільки JSON.

### `rewrite` Prompt

Task: author the Ukrainian replace prompt for local editorial rewriting that preserves meaning and preserves selected block count exactly.

Draft prompt shape:

    Ти готуєш локальну редакторську заміну для вибраних блоків українського рукопису.
    Тип правки: rewrite.
    Перепиши текст ясніше, сильніше стилістично і природніше для читача.
    Не змінюй фактичний зміст і не додавай нових фактів.
    Працюй тільки з вибраними блоками.
    Збережи кількість блоків: {{blockCount}}.
    Поверни повну заміну для кожного блоку.

### `simplify` Prompt

Task: author the Ukrainian replace prompt for simplification aimed at broad-reader clarity.

Draft prompt shape:

    Ти спрощуєш вибрані блоки українського науково-популярного тексту.
    Тип правки: simplify.
    Зроби текст простішим, зрозумілішим і легшим для читання.
    Не спрощуй зміст до неточності і не додавай нових фактів.
    Працюй тільки з вибраними блоками.
    Збережи кількість блоків: {{blockCount}}.
    Поверни повну заміну блоків.

### `expand` Prompt

Task: author the Ukrainian replace prompt for expansion-by-replacement.

Draft prompt shape:

    Ти розширюєш вибрані блоки українського рукопису, але робиш це через повну заміну тих самих блоків.
    Тип правки: expand.
    Додай пояснювальні зв'язки, розшифруй стислий зміст і зроби фрагмент самодостатнішим.
    Не додавай нових фактів поза тим, що вже випливає з фрагмента.
    Працюй тільки з вибраними блоками.
    Збережи кількість блоків: {{blockCount}}.
    Поверни повну заміну блоків.

### `list` Prompt

Task: author the Ukrainian replace prompt for converting dense prose into structured list output.

Draft prompt shape:

    Ти перетворюєш вибраний фрагмент на структурований список.
    Тип правки: list.
    Якщо список справді покращує читабельність, поверни один list block або іншу заміну, яка не перевищує {{blockCount}} блоків.
    Не залишай суцільну прозу, якщо матеріал природно читається списком.
    Не додавай нових фактів.
    Поверни тільки структуровану заміну для системи.

### `subsection` Prompt

Task: author the Ukrainian insertion prompt for subsection proposals.

Draft prompt shape:

    Ти готуєш вставку підзаголовка перед вибраним фрагментом українського рукопису.
    Тип правки: subsection.
    Запропонуй короткий, точний підзаголовок.
    За потреби додай один короткий lead-абзац після підзаголовка.
    Не переписуй сам вибраний фрагмент і не додавай нових фактів.
    Поверни тільки heading і, якщо потрібно, lead.

### `callout` Prompt Family

Task: author one Ukrainian base prompt and one kind-specific clause for each approved callout kind.

Base prompt:

    Ти готуєш чернетку врізки для українського науково-популярного рукопису.
    Працюй тільки з фрагментом і редакторською рекомендацією.
    Не додавай нових фактів поза текстом.
    Поверни короткий заголовок, текст врізки і коротке пояснення, навіщо вона тут.
    Мова відповіді: тільки українська.

`mechanism` clause:

    Тип врізки: mechanism.
    Поясни механізм дії простим причинно-наслідковим ланцюгом.
    Не переходь у режим підручникової лекції.

`analogy` clause:

    Тип врізки: analogy.
    Побудуй аналогію, яка допомагає зрозуміти ідею.
    Явно познач її як аналогію, а не як буквальний факт.
    Не вводь нові наукові твердження.

`everyday_application` clause:

    Тип врізки: everyday_application.
    Покажи, як описане явище проявляється в повсякденному житті.
    Спирайся тільки на зміст фрагмента.

`myths_vs_truth` clause:

    Тип врізки: myths_vs_truth.
    Подай матеріал як короткі пари "Міф" / "Правда".
    Кожна пара має прямо випливати з фрагмента.
    Не вигадуй популярні міфи, яких немає в тексті.

`top_list` clause:

    Тип врізки: top_list.
    Збери 3-5 коротких пунктів, якщо фрагмент реально підтримує дискретний перелік.
    Якщо ні, поверни врізку без штучного рейтингу.

### `visual` Prompt

Task: author the Ukrainian visual prompt factory that produces an editable image-generation brief for the execution card.

Draft prompt shape:

    Ти готуєш український prompt для генерації чернеткової ілюстрації, схеми або іншого навчального візуалу.
    Працюй тільки з фрагментом і редакторською рекомендацією.
    Вкажи:
    1. що саме показати;
    2. яку освітню функцію має виконати візуал;
    3. які елементи обов'язкові;
    4. яких візуальних кліше треба уникати;
    5. який visualIntent обрано.
    Мова фінального prompt: тільки українська, без англіцизмів.
    Поверни тільки готовий prompt.

### Generated Image Prompt Contract

Task: enforce that the final prompt shown to the editor and sent to generation remains Ukrainian.

Acceptance shape:

    - only Ukrainian text
    - no English style keywords
    - no prompt-engineering boilerplate
    - concise educational brief
    - concrete anti-cliche guidance

## Concrete Steps

All commands below run from `/mnt/c/Projects/oboz-ai/orest-edit` unless another working directory is stated.

1. Inspect and tighten the review contracts.

       sed -n '1,280p' apps/web/lib/editor/review-contract.ts
       sed -n '1,320p' apps/web/lib/server/review-service.ts
       sed -n '1,360p' apps/web/lib/server/review-action-service.ts

2. Rebuild editor execution state around one active recommendation lane.

       sed -n '1,760p' apps/web/app/editor/page.tsx
       sed -n '560,760p' apps/web/components/editor/BlockEditorSurface.tsx

3. Tighten replace normalization and insertion helpers.

       sed -n '1,460p' apps/web/lib/editor/patch-contract.ts
       sed -n '250,340p' apps/web/lib/editor/document-model.ts
       sed -n '1,160p' apps/web/lib/editor/manuscript-structure.ts

4. Build or replace inline review card components and styles.

       sed -n '1,260p' docs/sample4.html
       sed -n '1,260p' apps/web/components/editor/BlockDiffOverlay.tsx
       sed -n '4970,5565p' apps/web/app/globals.css

5. Wire callout and visual/image execution flows into the manuscript.

       rg -n "image_prompt|callout_prompt|review/image|generatedAsset" apps/web -S

6. Add or update tests.

       ls apps/web/test
       sed -n '1,240p' apps/web/test/review-service.test.ts

7. Validate the integrated app.

       npm run typecheck -w @orest/web
       npm test -w @orest/web
       npm run build -w @orest/web

8. Run authenticated runtime QA when implementation exists.

       APP_PASSWORD=test-secret npm run dev -w @orest/web

## Validation and Acceptance

The work is complete only when all of the following are true.

1. Whole-text recommendations may target one or more contiguous blocks, and focusing a recommendation highlights the full anchor range in the manuscript with one continuous left-side border.

2. The manuscript renders exactly one active floating execution card below the full affected range.

3. Replace-type suggestions (`rewrite`, `simplify`, `expand`, `list`) operate on full blocks only. No phrase-level or character-offset apply path exists in this flow.

4. Replace-type suggestions show the affected anchor blocks in replace-review state and render visible removed/add text in the execution card rather than multiplying placeholders across the range.
   The anchor-range manuscript text is visually red for the replace state, and proposed replacement text in the card is green and editable.

5. Applying a replace-type suggestion never emits more blocks than the selected anchor range permits.

6. `rewrite`, `simplify`, and `expand` preserve selected block count exactly.

7. `list` may normalize to one structured list block or preserve selected block count, but it must never exceed the selected count.

8. `subsection` inserts a subheading before the first affected block and may optionally insert one short lead paragraph.

9. `callout` execution cards expose exactly five kinds: `mechanism`, `analogy`, `everyday_application`, `myths_vs_truth`, and `top_list`.

10. `callout` generation is explicit. The editor can choose a kind, generate, regenerate, edit the result, and insert a first-class `callout` block after the affected range.
    The inserted callout renders with distinct callout styling and formatting.

11. `visual` execution cards expose an editable Ukrainian image prompt, allow generation and regeneration, preview the result, and insert a first-class `image` block after the affected range.

12. `illustration` no longer appears as a top-level recommendation type in review results.

13. All recommendation-generation prompts, execution prompts, callout prompts, and generated image prompts in this workflow are Ukrainian.

14. `analogy` and `myths_vs_truth` are explicitly anti-hallucination constrained: analogies must be labeled as analogies, myths/truth pairs must be traceable to source text, and neither flow may invent external claims.

15. If an applied change touches blocks used by another pending recommendation, that recommendation becomes stale and is blocked from blind apply.

16. The right rail remains the inbox, but execution happens beside the manuscript fragment, not only in the rail.

## Idempotence and Recovery

This plan changes contracts, prompts, UI state, and apply behavior. Implementation should stay safe under retries:

- keep block IDs authoritative and never rebuild the entire manuscript solely from plain text during review apply
- treat invalid replace output as a normalization or error case, not something to apply opportunistically
- make generation non-destructive until the editor clicks apply/insert
- preserve review-image generation state so refresh does not silently discard in-progress visual work
- if a recommendation cannot be trusted after an overlapping apply, mark it stale rather than guessing a new anchor
- rerunning typecheck, tests, and build should remain safe after each milestone

## Artifacts and Notes

Type-to-behavior mapping for implementation:

- `rewrite`: replace selected blocks; preserve block count exactly
- `simplify`: replace selected blocks; preserve block count exactly
- `expand`: replace selected blocks; preserve block count exactly
- `list`: replace selected blocks with structured list output; never exceed selected block count
- multiline text inside a replace result becomes soft line breaks inside existing replacement blocks, not uncontrolled extra blocks
- `subsection`: insert heading before first affected block; optional short lead
- `callout`: choose kind, generate/regenerate, insert `callout` block after affected range
- `visual`: edit Ukrainian prompt, generate/regenerate image, insert `image` block after affected range

Working anti-hallucination rules:

- `rewrite`, `simplify`, `expand`, `list`: no new facts
- `subsection`: may frame existing content, not add new claims
- `mechanism`: explain only the mechanism already present in the fragment
- `analogy`: analogy must be clearly labeled and must not smuggle in new scientific claims
- `everyday_application`: tie to everyday life only when supported by the fragment
- `myths_vs_truth`: every pair must be derivable from the fragment
- `top_list`: only produce a discrete ranked or numbered set when the fragment supports it
- `visual`: the prompt may clarify presentation, but must not invent scientific content missing from the fragment

## Interfaces and Dependencies

The implementation should end with these stable expectations.

- `apps/web/lib/editor/review-contract.ts`
  - `EditorialReviewRecommendationType` = `rewrite | simplify | expand | list | subsection | callout | visual`
  - `EditorialCalloutKind` = `mechanism | analogy | everyday_application | myths_vs_truth | top_list`
  - `EditorialVisualIntent` remains a subordinate subtype under `visual`

- `apps/web/lib/server/review-service.ts`
  - one Ukrainian recommendation-generation prompt factory
  - one structured-output schema enforcing the seven-type taxonomy

- `apps/web/lib/server/review-action-service.ts`
  - dedicated prompt factories for `rewrite`, `simplify`, `expand`, `list`, `subsection`, `callout`, and `visual`
  - callout prompt clauses keyed by the five approved callout kinds
  - visual prompt generation that returns Ukrainian output only

- `apps/web/app/editor/page.tsx`
  - one active inline review execution lane
  - explicit stale handling for overlapping recommendations
  - explicit insert-before / insert-after behavior by suggestion type

- `apps/web/components/editor/BlockEditorSurface.tsx`
  - anchor-range highlight metadata
  - one floating execution card mount below the active range
  - no duplicated loading or proposal UI across the same anchor range

- `apps/web/lib/editor/patch-contract.ts`
  - replace-type normalization that respects the block-count ceiling and never silently expands beyond the allowed replacement shape

Note updated 2026-03-11: this standalone plan was created specifically for the inline review workflow discussed with the user. It is separate from `docs/EXECPLAN_MVP.md` on purpose and should be treated as an independent execution plan for this feature set.
