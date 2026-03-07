import test from "node:test";
import assert from "node:assert/strict";

import { deriveManuscriptRevisionState, computeAnchorFingerprint } from "../lib/editor/manuscript-structure.ts";
import { insertReviewImageMarkdown } from "../lib/editor/review-image-insertion.ts";
import { reconcileReviewItemsWithRevision, resolveReviewImageAssetUrl, type EditorialReviewItem } from "../lib/editor/review-contract.ts";
import { generateReviewAction } from "../lib/server/review-action-service.ts";

function createReviewItem(text: string, mode: EditorialReviewItem["insertionPoint"]["mode"] = "after"): {
  item: EditorialReviewItem;
  revision: ReturnType<typeof deriveManuscriptRevisionState>;
} {
  const revision = deriveManuscriptRevisionState(text);
  const paragraphId = revision.paragraphOrder[0];
  const paragraph = revision.paragraphsById[paragraphId];
  const excerpt = paragraph?.text.slice(0, 80) ?? "";

  return {
    revision,
    item: {
      id: "review-item-1",
      reviewSessionId: "session-1",
      documentRevisionId: revision.documentRevisionId,
      changeLevel: 3,
      title: "Додати ілюстрацію",
      reason: "Фрагмент складно уявити без візуалізації.",
      recommendation: "Показати ключове порівняння у схемі.",
      recommendationType: "visualize",
      suggestedAction: "prepare_visual",
      priority: "medium",
      anchor: {
        paragraphIds: [paragraphId],
        generationParagraphRange: { start: 1, end: 1 },
        excerpt,
        fingerprint: computeAnchorFingerprint(revision, [paragraphId], excerpt)
      },
      insertionPoint: {
        mode,
        anchorParagraphId: paragraphId
      },
      visualIntent: "comparison",
      status: "ready"
    }
  };
}

test("insertReviewImageMarkdown inserts markdown image and supports review reconciliation", () => {
  const text = "Перший абзац із поясненням.";
  const { item, revision } = createReviewItem(text, "after");

  const insertion = insertReviewImageMarkdown({
    text,
    revision,
    item,
    alt: "Порівняння факторів ризику",
    caption: "Схема для швидкого читання.",
    asset: {
      assetId: "asset-1",
      mimeType: "image/png",
      source: { kind: "data_url", dataUrl: "data:image/png;base64,ZmFrZQ==" }
    }
  });

  assert.equal(insertion.ok, true);
  assert.equal(insertion.inserted, true);
  assert.match(insertion.text, /!\[Порівняння факторів ризику\]\(data:image\/png;base64,ZmFrZQ==\)/);
  assert.match(insertion.text, /Схема для швидкого читання\./);

  const nextRevision = deriveManuscriptRevisionState(insertion.text, revision);
  const reconciled = reconcileReviewItemsWithRevision([item], nextRevision, item.id);
  assert.equal(reconciled[0]?.status, "applied");
});

test("insertReviewImageMarkdown respects insertion anchor mode", () => {
  const text = "Перший абзац.\n\nДругий абзац.";
  const revision = deriveManuscriptRevisionState(text);
  const firstParagraphId = revision.paragraphOrder[0];
  const secondParagraphId = revision.paragraphOrder[1];

  const baseItem: Omit<EditorialReviewItem, "anchor" | "insertionPoint"> = {
    id: "review-item-2",
    reviewSessionId: "session-1",
    documentRevisionId: revision.documentRevisionId,
    changeLevel: 3,
    title: "Ілюстрація",
    reason: "Потрібно спростити сприйняття.",
    recommendation: "Додати схему.",
    recommendationType: "illustration",
    suggestedAction: "prepare_visual",
    priority: "low",
    status: "pending"
  };

  const beforeItem: EditorialReviewItem = {
    ...baseItem,
    anchor: {
      paragraphIds: [secondParagraphId],
      generationParagraphRange: { start: 2, end: 2 },
      excerpt: "Другий абзац.",
      fingerprint: computeAnchorFingerprint(revision, [secondParagraphId], "Другий абзац.")
    },
    insertionPoint: {
      mode: "before",
      anchorParagraphId: secondParagraphId
    }
  };

  const beforeInsert = insertReviewImageMarkdown({
    text,
    revision,
    item: beforeItem,
    alt: "Схема",
    asset: {
      assetId: "asset-before",
      mimeType: "image/png",
      source: { kind: "data_url", dataUrl: "data:image/png;base64,YWJj" }
    }
  });

  assert.equal(beforeInsert.ok, true);
  assert.equal(beforeInsert.inserted, true);
  const secondStart = revision.paragraphsById[secondParagraphId].start;
  assert.ok(beforeInsert.insertionIndex <= secondStart);

  const afterItem: EditorialReviewItem = {
    ...baseItem,
    anchor: {
      paragraphIds: [firstParagraphId],
      generationParagraphRange: { start: 1, end: 1 },
      excerpt: "Перший абзац.",
      fingerprint: computeAnchorFingerprint(revision, [firstParagraphId], "Перший абзац.")
    },
    insertionPoint: {
      mode: "after",
      anchorParagraphId: firstParagraphId
    }
  };

  const afterInsert = insertReviewImageMarkdown({
    text,
    revision,
    item: afterItem,
    alt: "Після абзацу",
    asset: {
      assetId: "asset-after",
      mimeType: "image/png",
      source: { kind: "data_url", dataUrl: "data:image/png;base64,ZGVm" }
    }
  });

  assert.equal(afterInsert.ok, true);
  assert.equal(afterInsert.inserted, true);
  const firstEnd = revision.paragraphsById[firstParagraphId].end;
  assert.ok(afterInsert.insertionIndex >= firstEnd);
});

test("generateReviewAction returns stale_anchor for outdated fingerprint", async () => {
  const originalText = "Початковий абзац для ілюстрації.";
  const { item, revision } = createReviewItem(originalText, "after");
  const changedText = "Початковий абзац для ілюстрації з новим уточненням.";
  const changedRevision = deriveManuscriptRevisionState(changedText, revision);

  const response = await generateReviewAction({
    text: changedText,
    currentRevision: changedRevision,
    item,
    provider: "openai",
    modelId: "gpt-5.4"
  });

  assert.equal(response.proposal.kind, "stale_anchor");
  assert.equal(response.usedFallback, false);
  assert.match(response.error ?? "", /змінився|застаріл/i);
});

test("insertReviewImageMarkdown is idempotent for duplicate insertion attempts", () => {
  const text = "Один абзац для тесту.";
  const { item, revision } = createReviewItem(text, "after");
  const asset = {
    assetId: "asset-dup",
    mimeType: "image/png",
    source: { kind: "data_url" as const, dataUrl: "data:image/png;base64,cXV4" }
  };

  const firstInsert = insertReviewImageMarkdown({
    text,
    revision,
    item,
    alt: "Повторна вставка",
    asset
  });
  assert.equal(firstInsert.ok, true);
  assert.equal(firstInsert.inserted, true);

  const secondRevision = deriveManuscriptRevisionState(firstInsert.text, revision);
  const secondInsert = insertReviewImageMarkdown({
    text: firstInsert.text,
    revision: secondRevision,
    item,
    alt: "Повторна вставка",
    asset
  });

  assert.equal(secondInsert.ok, true);
  assert.equal(secondInsert.inserted, false);
  assert.equal(secondInsert.text, firstInsert.text);
});

test("resolveReviewImageAssetUrl supports legacy dataUrl shape from older drafts", () => {
  const legacyAsset = {
    assetId: "legacy-1",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,bGVnYWN5"
  } as unknown as Parameters<typeof resolveReviewImageAssetUrl>[0];

  const url = resolveReviewImageAssetUrl(legacyAsset);
  assert.equal(url, "data:image/png;base64,bGVnYWN5");
});
