# DECISIONS_LOG

## 2026-03-05

### Product user
Decision: the product is for a book editor, not for a doctor.

Reason: the main value is simplifying dense scientific prose for broad readers, not supporting clinical decision-making.

### Core interaction model
Decision: the product is patch-first and diff-first.

Reason: trust depends on local, reviewable edits instead of full rewrites.

### UI language
Decision: the interface language is Ukrainian.

Reason: the intended editorial workflow and reading audience are Ukrainian.

### Visual baseline
Decision: `docs/sample4.html` is the reference layout direction.

Reason: it best matches the manuscript-centered editing workflow.

### Current scope exclusions
Decision: strict-medical editor mode, export-patch UI, and sources-first navigation are not part of the current MVP direction.

Reason: they distract from the first working editorial vertical slice.

### Planning document
Decision: the checklist for coding work lives inside `docs/EXECPLAN_MVP.md`.

Reason: `PLANS.md` already defines ExecPlan as the required living execution document with checkbox progress.

### First working manuscript surface
Decision: the first real editor slice uses a textarea-backed manuscript surface.

Reason: plain-text selection gives reliable absolute offsets for selection tracking, patch requests, diff review, and safe patch application without introducing contentEditable mapping complexity too early.

### Patch invalidation rule
Decision: pending patch proposals are discarded when the manuscript is edited manually.

Reason: proposals are anchored to absolute character offsets and become unsafe once the underlying text changes outside the accept/reject flow.

### Fallback behavior
Decision: the OpenAI path keeps a deterministic local fallback behind the same patch contract.

Reason: the vertical slice remains usable and testable even when the API key is missing, the model id is wrong, or the provider call fails.

### Response diagnostics
Decision: patch responses carry request diagnostics back to the client.

Reason: the editor needs to see which provider/model/mode ran and whether any provider operations were dropped, without inspecting network payloads.

### Batch apply safety
Decision: group apply only runs on operations that still match the current manuscript text.

Reason: multi-operation review is useful, but safety still depends on verifying each patch against the current text before applying it in bulk.

### Root env fallback
Decision: the server reads provider API keys from the repo-root `.env` when the settings form leaves the API-key field blank.

Reason: local development should not require copying the same secret into browser storage, and Next workspace env loading was not reliably picking up the root `.env` file by default.

### Provider normalization layer
Decision: provider-specific OpenAI, Gemini, and Anthropic request shapes are isolated inside one server-side patch service that always returns the shared patch contract.

Reason: each vendor exposes a different structured-output API, but the editor should stay provider-agnostic and keep one review/apply flow.

### Review-first right rail
Decision: the right rail is reserved for review output and collapses entirely until requests, diagnostics, or history exist.

Reason: before a request runs, the manuscript should dominate the screen and the rail should not reserve attention for an empty future state.

### Floating custom prompt
Decision: custom prompting is a floating, selection-triggered action labeled `Кастомні правки`.

Reason: custom edits should be one step away once text is selected, not hidden behind a second click in a persistent side panel.

### Whole-fragment base action
Decision: the left rail exposes a permanent `Базова правка всього фрагмента` action.

Reason: a whole-fragment action is useful, but it must state its scope explicitly so it does not blur into the local-selection workflow.

### Deployment documentation split
Decision: keep a short runtime summary in `README.md` and place detailed deployment notes in `docs/DEPLOYMENT.md`.

Reason: the README should answer quick run/deploy questions, while deployment-specific operational details need a stable dedicated document.