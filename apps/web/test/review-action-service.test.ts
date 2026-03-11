import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../lib/editor/manuscript-structure.ts";
import { generateReviewAction } from "../lib/server/review-action-service.ts";
import type { ReviewActionRequest } from "../lib/editor/review-contract.ts";

function createRequest(): ReviewActionRequest {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 2, content: [{ text: "Розділ" }] },
      { id: "p1", type: "paragraph", content: [{ text: "Щільний абзац, який просить кращої локальної структури." }] },
      { id: "p2", type: "paragraph", content: [{ text: "Другий абзац продовжує ту саму думку." }] }
    ]
  };
  const revision = deriveManuscriptRevisionState(document);

  return {
    document,
    currentRevision: revision,
    provider: "openai",
    modelId: "gpt-5.4",
    item: {
      id: "review-subsection-1",
      reviewSessionId: "review-session-1",
      documentRevisionId: revision.documentRevisionId,
      changeLevel: 3,
      title: "Додати підзаголовок",
      reason: "Фрагмент варто локально структурувати.",
      recommendation: "Перед фрагментом потрібен короткий підзаголовок.",
      recommendationType: "subsection",
      suggestedAction: "insert_text",
      priority: "medium",
      anchor: {
        blockIds: ["p1", "p2"],
        generationBlockRange: { start: 1, end: 2 },
        excerpt: "Щільний абзац",
        fingerprint: computeAnchorFingerprint(document, ["p1", "p2"])
      },
      insertionPoint: {
        mode: "before",
        anchorBlockId: "p1"
      },
      status: "pending"
    }
  };
}

test("generateReviewAction fails safely for subsection until inline insertion flow exists", async () => {
  const request = createRequest();

  const response = await generateReviewAction(request);

  assert.equal(response.proposal.kind, "stale_anchor");
  assert.equal(response.usedFallback, false);
  assert.match(response.error ?? "", /inline-підготовка/i);
});
