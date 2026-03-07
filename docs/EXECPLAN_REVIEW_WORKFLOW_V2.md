# Implement the two-stage whole-text review workflow with per-item execution

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

`/mnt/c/Projects/oboz-ai/orest-edit/PLANS.md` is present in this repository, so this plan is maintained in accordance with it.

## Purpose / Big Picture

The goal is to turn `Перевірити весь текст` from a simple manuscript review into a two-stage editorial workflow:

1. The model reviews the whole manuscript and returns compact, paragraph-bound recommendations.
2. The editor chooses one recommendation and clicks `Працюй!`, after which the system prepares exactly one executable proposal: either a text diff, a callout draft prompt, or an image prompt draft.

After this work, the editor will be able to set how aggressively the manuscript may change on a scale from 1 to 5, review compact recommendation cards in the right operations panel, inspect the chosen recommendation inline in the manuscript, and approve the prepared proposal before any text is inserted or any image generation starts.

This preserves the product's patch-first and diff-first trust model while making whole-text review genuinely actionable.

## Progress

- [x] (2026-03-07 01:50Z) Audited the current whole-text review contract, manuscript paragraph mapping, settings model, and UI surfaces.
- [x] (2026-03-07 01:50Z) Defined the target v2 review-item and proposal contracts in this ExecPlan.
- [x] (2026-03-07 03:10Z) Introduced stable manuscript paragraph identity and document revision tracking in editor state and normalization helpers.
- [x] (2026-03-07 03:35Z) Expanded settings to expose editable templates for whole-text review, change-level mapping, callout generation, and image-prompt generation.
- [x] (2026-03-07 04:05Z) Replaced the current whole-text review request flow with the floating-area depth selector and compact additional-instructions mode.
- [x] (2026-03-07 04:25Z) Moved whole-text recommendation cards into the right operations panel and kept proposal rendering inline in the manuscript.
- [x] (2026-03-07 04:55Z) Added per-item `Працюй!` proposal generation with approval-gated text apply, approval-gated callout insertion, and approval-gated image generation.
- [x] (2026-03-07 23:20Z) Implemented end-to-end image proposal insertion: generation now stores a typed asset reference, `Вставити зображення` explicitly inserts markdown at a deterministic anchor, and insertion participates in revision reconciliation and history/status feedback.
- [x] (2026-03-08 00:10Z) Moved generated image persistence off `localStorage` by storing browser assets in IndexedDB behind `asset:` markdown tokens, then reused the same path for toolbar upload/paste and draggable image-block repositioning inside the manuscript surface.
- [ ] (2026-03-08 00:10Z) Validation is partially complete: `npm run typecheck` passed, `npm run build` passed, targeted markdown/image tests passed, and `npm run test` still has the same 4 pre-existing failing assertions in markdown/patch tests outside this scope; `npm run check:text` was not rerun in this pass.

## Surprises & Discoveries

- Observation: the current review contract is still fundamentally index-based even though `ManuscriptParagraph` already exposes an `id` field.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/review-contract.ts` stores only `paragraphStart` and `paragraphEnd`, while `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/manuscript-structure.ts` currently derives `id` from the visible paragraph number (`paragraph-001`), which is not stable after splits or insertions.

- Observation: the existing UI architecture removed the persistent left rail, so the new recommendation list cannot be added by toggling a hidden panel back on.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/docs/CURRENT_STATE.md` explicitly records that the left editor rail was removed and whole-text review now lives in the right rail.

- Observation: the current settings model only exposes one `basePrompt`, but the new workflow needs several distinct prompt templates with different responsibilities.
  Evidence: `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/settings.ts` defines `EditorSettings` with only `provider`, `modelId`, `apiKey`, and `basePrompt`.

- Observation: image insertion is not yet a safe assumption in the current editor.
  Evidence: the existing editor state and review/apply path in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/draft-state.ts` and `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/patch-contract.ts` contain only text-oriented operations and diff markers.

- Observation: fallback whole-text recommendations initially marked themselves stale as soon as the editor clicked `Працюй!`.
  Evidence: the first smoke run showed `POST /api/edit/review/proposal 409` immediately after a fallback review because `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/server/review-service.ts` had stored fallback anchor fingerprints as the whole-document hash instead of the anchored paragraph-range fingerprint.

- Observation: loading older drafts from `localStorage` can crash if runtime code assumes only the latest image-asset shape.
  Evidence: after switching `generatedAsset` to `{ assetId, source }`, older persisted objects with legacy `dataUrl` triggered a client-side exception until `resolveReviewImageAssetUrl()` added backward compatibility for the legacy field.

- Observation: persisting generated image binaries inside the draft snapshot blows through browser `localStorage` quota almost immediately.
  Evidence: generating a review image reproduced `QuotaExceededError` on `orest-editor-draft-v1` until the client stopped serializing `data:` URLs in draft state and moved assets into IndexedDB-backed blob storage.

## Decision Log

- Decision: whole-text review will be a two-stage workflow: `recommend` first, then `prepare/apply one item` second.
  Rationale: this preserves diff-first trust and prevents the model from silently changing large parts of the manuscript.
  Date/Author: 2026-03-07 / Codex + User

- Decision: visible paragraph numbers are display-only; recommendation anchors must resolve to stable paragraph IDs plus a document revision snapshot.
  Rationale: paragraph numbering changes after splits, insertions, or deletions, so recommendation replay cannot depend on display indices.
  Date/Author: 2026-03-07 / Codex + User

- Decision: whole-text recommendation cards live in the right operations panel, while the prepared proposal remains inline in the manuscript.
  Rationale: this preserves current layout direction, keeps recommendations near review diagnostics/history, and still keeps editorial approval beside the referenced text.
  Date/Author: 2026-03-07 / Codex + User

- Decision: review/action prompt templates and the level-1..5 behavior mapping must be editable in Settings.
  Rationale: consistency depends on detailed, inspectable prompt templates rather than hidden hardcoded instructions.
  Date/Author: 2026-03-07 / Codex + User

- Decision: batch hygiene will be driven primarily by the LLM prompt, with a thin server-side cap and dedupe retained as a safety rail.
  Rationale: thinking models can rank and prune better than rigid heuristics, but the UI still needs a hard upper bound if a provider drifts.
  Date/Author: 2026-03-07 / Codex recommendation

- Decision: text-oriented whole-text recommendations reuse the existing patch-generation pipeline to prepare one diff proposal per item.
  Rationale: this keeps local rewrite proposals on the same structured-output and safe-apply path as ordinary fragment patching instead of inventing a second text-diff engine.
  Date/Author: 2026-03-07 / Codex implementation

- Decision: image insertion is explicitly user-gated (`Згенерувати чернетку` then `Вставити зображення`) and is never automatic.
  Rationale: patch-first/diff-first trust depends on explicit consent before mutating manuscript source, especially for non-text assets.
  Date/Author: 2026-03-07 / Codex implementation

- Decision: manuscript markdown stores `asset:` tokens for browser-local images, while draft/apply state keeps a typed `{ assetId, source }` reference that can later point to uploaded or remote URLs.
  Rationale: `asset:` tokens keep markdown deterministic and reversible without serializing binary payloads into draft state, and the typed source model still preserves a migration path toward real uploaded assets later.
  Date/Author: 2026-03-07 / Codex implementation

## Outcomes & Retrospective

The workflow is now implemented end to end in the web app. The editor can open whole-text review in the floating composer, choose a change-depth level, receive paragraph-bound recommendations in the right operations panel, open them inline in the manuscript, and prepare one proposal at a time through `Працюй!`.

Image proposals now follow the same trust model as text/callout actions: the editor generates a draft image first, then explicitly inserts a markdown image block (`![alt](source)` plus optional caption) near the recommendation anchor. The actual markdown source now uses lightweight `asset:` tokens instead of inline `data:` payloads, so generation no longer exhausts `localStorage` quota and the same asset path also powers manual upload/paste plus drag-and-drop repositioning of standalone image blocks in the manuscript surface.

The main remaining gaps are validation cleanup and final test stabilization. The runtime test blocker is removed (`npm run test` executes through `node --import tsx --test`), but 4 test assertions still fail and `npm run check:text` still reports pre-existing text-integrity issues in non-product files.

## Context and Orientation

The current whole-text review flow already exists, but it is intentionally shallow:

- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/api/edit/review/route.ts` accepts one whole-manuscript review request and returns `EditorialReviewResponse`.
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/server/review-service.ts` calls OpenAI via the Responses API structured-output path, Gemini via `responseJsonSchema`, and Anthropic via JSON-only instructions, then normalizes the result.
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/review-contract.ts` currently keeps review items minimal: category, severity, title, explanation, recommendation, paragraph range, and excerpt.
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/layout/RightOperationsRail.tsx` renders the review trigger and compact cards in the right rail.
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/components/editor/EditorialReviewDetail.tsx` renders the full review detail inline in the manuscript.
- `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/settings.ts` and `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/app/settings/page.tsx` currently expose only one model-facing editor prompt.

The new workflow changes both data modeling and layout:

- The `Перевірити весь текст` trigger still starts from the existing document-level action entry point.
- Clicking it should open the existing floating composer in a whole-text-review mode rather than a local-selection patch mode.
- In that mode, the floating area must show the `1..5` change-depth scale, the mandatory promise/description under the chosen level, and a compact `Додаткові інструкції` field with shortcut chips hidden.
- The resulting recommendation list should render in the right operations panel and reuse existing compact-card components as much as possible.
- The manuscript remains the place where the selected recommendation detail, prepared diff, and prepared prompts appear.

## Plan of Work

Start by separating manuscript structure from display numbering. The editor needs a stable paragraph graph, not just a raw string split by blank lines. Introduce a revision-aware manuscript structure layer that assigns durable paragraph IDs, preserves them across no-op reflows, and defines how IDs evolve when a paragraph is split or merged. The visible `001`, `002`, `003` labels should become pure render-time projections from the current ordered paragraph list.

Once paragraph identity is stable, replace the current whole-text review contract with a v2 contract. The model-facing schema should still ask the LLM for paragraph numbers, because the model cannot know internal paragraph IDs. The server normalization layer must then resolve those numbers into paragraph IDs, attach the current `documentRevisionId`, compute a text fingerprint for the anchored text, and store recommendation metadata such as `recommendationType`, `suggestedAction`, `calloutType`, `visualTarget`, and `priority`.

After the review-item contract exists, add a second proposal contract for `Працюй!`. This must not reuse the current patch route directly, because the prepared output can be either a text diff, a callout prompt draft, or an image prompt draft. The proposal route must accept a specific review item plus the current document revision, re-resolve the anchor against current paragraph IDs, and either return a prepared proposal or mark the item stale when the anchor can no longer be trusted.

Only then should the UI be rebuilt. The floating composer needs a whole-text-review mode with the depth scale and extra instructions. The compact recommendation list should render in the right operations panel. Clicking a recommendation focuses the anchored text in the manuscript and shows inline detail. Clicking `Працюй!` on that item triggers proposal preparation. Text proposals render as diff previews that must be explicitly applied. Visual and callout proposals render as prompt drafts that must be explicitly confirmed before generation or insertion. If image insertion is still unsupported, image generation ends at an asset-ready state rather than mutating the manuscript.

Finally, expand Settings so the editor can inspect and edit the new templates: whole-text review system prompt, change-level mapping block, recommendation-type definitions, callout-generation prompt, and image-prompt template. The implementation must keep using structured outputs. Prompt edits should affect future requests but must not silently mutate already generated review items or proposals.

## Concrete Steps

Run these commands from `/mnt/c/Projects/oboz-ai/orest-edit` while implementing:

1. Inspect and update the paragraph structure and review contracts.
   `sed -n '1,240p' apps/web/lib/editor/manuscript-structure.ts`
   `sed -n '1,260p' apps/web/lib/editor/review-contract.ts`
   `sed -n '1,380p' apps/web/lib/server/review-service.ts`

2. Extend persistent editor state for revision tracking, review sessions, and prepared proposals.
   `sed -n '1,260p' apps/web/lib/editor/draft-state.ts`
   `sed -n '1,320p' apps/web/app/editor/page.tsx`

3. Add the new prompt-template settings model and UI.
   `sed -n '1,260p' apps/web/lib/editor/settings.ts`
   `sed -n '296,420p' apps/web/app/settings/page.tsx`

4. Rework review layout and proposal rendering surfaces.
   `sed -n '1,260p' apps/web/components/layout/RightOperationsRail.tsx`
   `sed -n '1,260p' apps/web/components/editor/EditorialReviewCard.tsx`
   `sed -n '1,260p' apps/web/components/editor/EditorialReviewDetail.tsx`
   `sed -n '1,420p' apps/web/components/editor/FloatingPromptPanel.tsx`
   `sed -n '1,420p' apps/web/components/editor/EditorCanvas.tsx`

5. Add dedicated server routes for proposal preparation and optional generation kickoff.
   `sed -n '1,220p' apps/web/app/api/edit/review/route.ts`
   `sed -n '1,260p' apps/web/app/api/edit/patch/route.ts`

6. Validate behavior and screenshots.
   `npm run typecheck`
   `npm run build`
   `npm run check:text`
   `npm run test`
   Headless browser smoke steps should capture the whole-text-review modal state, right-panel recommendations, inline text proposal, inline image-prompt preview, and stale-anchor fallback state.

Expected outputs:

- `npm run typecheck` exits `0`.
- `npm run build` exits `0`.
- `npm run check:text` exits `0`.
- `npm run test` should cover contract normalization, stale-anchor rebasing, prompt-template serialization, and proposal gating. If the current Node limitation still blocks tests, record the failure exactly in this plan and validate the affected paths with targeted route-level smoke checks instead.

## Validation and Acceptance

The feature is complete when all of the following are observable:

- Clicking `Перевірити весь текст` opens a floating whole-text-review mode with:
  the bold question after `AI Chat`, the `1..5` depth scale, default selected level `3`, a non-bold promise/description under the selected level, and a `Додаткові інструкції` field without shortcut chips.

- Submitting a whole-text review returns compact cards in the right operations panel.

- Each compact card shows the current paragraph labels, but the underlying anchor survives edits that renumber later paragraphs.

- Clicking a card opens the full recommendation inline beside the manuscript fragment and exposes `Працюй!`.

- Clicking `Працюй!` prepares exactly one proposal for that recommendation.
  For text-oriented actions, the prepared result is an approval-gated diff.
  For `Візуалізувати` and `Підсилити ілюстрацією`, the prepared result is an approval-gated image prompt draft.
  For `Додати врізку`, the prepared result is an approval-gated callout prompt draft.

- Approving a text proposal updates the manuscript and re-resolves all remaining recommendations against current paragraph IDs.

- If an unresolved recommendation can no longer be trusted after earlier edits, the UI marks it stale and blocks blind apply.

- Settings expose editable templates for:
  base editor prompt, whole-text review prompt, change-depth mapping, callout prompt, and image prompt.

- OpenAI whole-text review and proposal preparation still use the Responses API structured-output path.

- Gemini whole-text review and proposal preparation still use `responseJsonSchema`.

- Recommendation-type definitions are spelled out explicitly in the prompt templates so the model is told what `Переписати`, `Доповнити`, `Візуалізувати`, `Підсилити ілюстрацією`, and `Додати врізку` mean.

## Idempotence and Recovery

Plan implementation so any request can be retried safely:

- Review generation must produce a new `reviewSessionId` and bind all returned items to the current `documentRevisionId`.
- Proposal preparation must verify that the item's source revision and paragraph IDs still resolve in the latest draft state before returning a proposal.
- Applying a text proposal must bump `documentRevisionId`, update paragraph identity mappings, and either re-resolve or stale-mark the remaining recommendations.
- Image and callout preparation must be non-destructive until a separate explicit confirmation step fires.
- If the editor refreshes the page mid-flow, persisted draft state must restore the latest review session, unresolved items, and prepared-but-not-applied proposal.

## Artifacts and Notes

The implementation should add or evolve these user-visible artifacts:

- A whole-text-review floating composer mode with depth scale and extra instructions.
- Right-panel recommendation cards in the operations rail.
- An inline manuscript recommendation detail with `Працюй!`.
- An inline proposal surface for:
  text diff preview,
  callout prompt draft,
  image prompt draft,
  stale-anchor warning.

The change-depth copy requested by the user should be treated as the starting UI language:

- `1. Легкий марафет`
- `2. Трохи підчистити`
- `3. Добряче пройтись`
- `4. Розібрати на гвинтики`
- `5. Згорів сарай — гори хата`

## Interfaces and Dependencies

The implementation must end with two explicit contracts: one for recommendations, one for prepared proposals. Use stable TypeScript names in `/mnt/c/Projects/oboz-ai/orest-edit/apps/web/lib/editor/review-contract.ts` or successor files.

Model-facing structured-output schema for the recommendation pass:

    type ProviderRecommendationType =
      | "rewrite"
      | "expand"
      | "simplify"
      | "list"
      | "subsection"
      | "callout"
      | "visualize"
      | "illustration";

    type ProviderSuggestedAction =
      | "rewrite_text"
      | "insert_text"
      | "prepare_callout"
      | "prepare_visual";

    type ProviderCalloutKind =
      | "quick_fact"
      | "mini_story"
      | "mechanism_explained"
      | "step_by_step"
      | "myth_vs_fact";

    interface ProviderReviewItemV2 {
      title: string;
      reason: string;
      recommendation: string;
      recommendationType: ProviderRecommendationType;
      suggestedAction: ProviderSuggestedAction;
      priority: "high" | "medium" | "low";
      paragraphStart: number;
      paragraphEnd: number;
      excerpt: string;
      insertionHint: "replace" | "before" | "after" | "subsection_after";
      calloutKind?: ProviderCalloutKind;
      visualIntent?: "diagram" | "comparison" | "process" | "timeline" | "scene" | "concept";
    }

Normalized app-domain contract after server normalization:

    interface ReviewItemV2 {
      id: string;
      reviewSessionId: string;
      documentRevisionId: string;
      changeLevel: 1 | 2 | 3 | 4 | 5;
      title: string;
      reason: string;
      recommendation: string;
      recommendationType: "rewrite" | "expand" | "simplify" | "list" | "subsection" | "callout" | "visualize" | "illustration";
      suggestedAction: "rewrite_text" | "insert_text" | "prepare_callout" | "prepare_visual";
      priority: "high" | "medium" | "low";
      anchor: {
        paragraphIds: string[];
        generationParagraphRange: { start: number; end: number };
        excerpt: string;
        fingerprint: string;
      };
      insertionPoint: {
        mode: "replace" | "before" | "after" | "subsection_after";
        anchorParagraphId: string;
      };
      calloutKind?: "quick_fact" | "mini_story" | "mechanism_explained" | "step_by_step" | "myth_vs_fact";
      visualIntent?: "diagram" | "comparison" | "process" | "timeline" | "scene" | "concept";
      status: "pending" | "preparing" | "ready" | "applied" | "dismissed" | "stale";
    }

Prepared proposal contract for `Працюй!`:

    interface ReviewActionProposal {
      id: string;
      reviewItemId: string;
      sourceRevisionId: string;
      targetRevisionId: string;
      kind: "text_diff" | "callout_prompt" | "image_prompt" | "stale_anchor";
      summary: string;
      canApplyDirectly: boolean;
      textDiff?: {
        selection: { start: number; end: number };
        replacement: string;
        reason: string;
      };
      calloutDraft?: {
        calloutKind: "quick_fact" | "mini_story" | "mechanism_explained" | "step_by_step" | "myth_vs_fact";
        title: string;
        prompt: string;
      };
      imageDraft?: {
        visualIntent: "diagram" | "comparison" | "process" | "timeline" | "scene" | "concept";
        prompt: string;
        targetModel: "gemini-3.1-flash-image-preview";
      };
      staleReason?: string;
    }

Required support types:

    interface ManuscriptRevisionState {
      documentRevisionId: string;
      paragraphOrder: string[];
      paragraphsById: Record<string, { text: string; start: number; end: number }>;
    }

Prompt requirements:

- Recommendation-type definitions must be explicit in the whole-text review prompt template.
- Level `1..5` behavior must be described concretely, not only named.
- `Обвіс` may appear in UI copy, but prompts must always expand it into `врізка, інфографіка або додатковий пояснювальний блок`.
- The image-prompt template must enforce `мінімалістичний, простий, чернетка для ілюстратора`.

Plan change note: initial version created on 2026-03-07 to scope the new whole-text review workflow before implementation starts.

#### Reference code for gemini image generation
```
import {
  GoogleGenAI,
} from '@google/genai';
import mime from 'mime';
import { writeFile } from 'fs';

function saveBinaryFile(fileName: string, content: Buffer) {
  writeFile(fileName, content, 'utf8', (err) => {
    if (err) {
      console.error(`Error writing file ${fileName}:`, err);
      return;
    }
    console.log(`File ${fileName} saved to file system.`);
  });
}

async function main() {
  const ai = new GoogleGenAI({
    apiKey: process.env['GEMINI_API_KEY'],
  });
  const config = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.HIGH,
    },
    imageConfig: {
      aspectRatio: "4:3",
      imageSize: "2K",
      personGeneration: "",
    },
    responseModalities: [
        'IMAGE',
    ],
  };
  const model = 'gemini-3.1-flash-image-preview';
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `INSERT_INPUT_HERE`,
        },
      ],
    },
  ];

  const response = await ai.models.generateContentStream({
    model,
    config,
    contents,
  });
  let fileIndex = 0;
  for await (const chunk of response) {
    if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
      continue;
    }
    if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
      const fileName = `ENTER_FILE_NAME_${fileIndex++}`;
      const inlineData = chunk.candidates[0].content.parts[0].inlineData;
      const fileExtension = mime.getExtension(inlineData.mimeType || '');
      const buffer = Buffer.from(inlineData.data || '', 'base64');
      saveBinaryFile(`${fileName}.${fileExtension}`, buffer);
    }
    else {
      console.log(chunk.text);
    }
  }
}

main();
```
