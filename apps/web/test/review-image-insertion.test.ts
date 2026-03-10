import test from "node:test";
import assert from "node:assert/strict";

import { deriveManuscriptRevisionState, computeAnchorFingerprint, resolveReviewItemSelection } from "../lib/editor/manuscript-structure.ts";
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

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createOpenAiResponsesPayload(body: unknown) {
  return {
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(body)
          }
        ]
      }
    ]
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

test("insertReviewImageMarkdown always inserts below targeted area", () => {
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
  const secondEnd = revision.paragraphsById[secondParagraphId].end;
  assert.ok(beforeInsert.insertionIndex >= secondEnd);

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

test("generateReviewAction sends an OpenAI image schema whose required fields match declared properties", async () => {
  const text = "Початковий абзац для ілюстрації.";
  const { item, revision } = createReviewItem(text, "after");
  let requestBody: Record<string, unknown> | undefined;

  const response = await generateReviewAction(
    {
      text,
      currentRevision: revision,
      item,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "sk-image-test",
      imagePromptTemplate: "Тип: {{visualIntent}}. Фрагмент: {{fragment}}. Рекомендація: {{recommendation}}."
    },
    {
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return createJsonResponse(
          createOpenAiResponsesPayload({
            summary: "Підготовлено чернетку image prompt.",
            prompt: "Покажи порівняння у вигляді простої схеми.",
            alt: "Схема порівняння факторів ризику",
            caption: null
          })
        );
      }
    }
  );

  assert.equal(response.usedFallback, false);
  assert.ok(requestBody);
  const schema = ((requestBody.text as Record<string, unknown>).format as Record<string, unknown>).schema as {
    properties: Record<string, unknown>;
    required: string[];
  };

  assert.deepEqual([...schema.required].sort(), [...Object.keys(schema.properties)].sort());
});

test("generateReviewAction falls back to Ukrainian image prompt when provider returns English prompt", async () => {
  const text = "Початковий абзац для ілюстрації.";
  const { item, revision } = createReviewItem(text, "after");

  const response = await generateReviewAction(
    {
      text,
      currentRevision: revision,
      item,
      provider: "openai",
      modelId: "gpt-5.4",
      apiKey: "sk-image-test",
      imagePromptTemplate: "Тип: {{visualIntent}}. Фрагмент: {{fragment}}. Рекомендація: {{recommendation}}."
    },
    {
      fetchImpl: async () =>
        createJsonResponse(
          createOpenAiResponsesPayload({
            summary: "Підготовлено чернетку image prompt.",
            prompt: "Minimalist medical infographic draft, comparison grid layout.",
            alt: "Схема порівняння факторів ризику",
            caption: null
          })
        )
    }
  );

  assert.equal(response.proposal.kind, "image_prompt");
  const prompt = response.proposal.kind === "image_prompt" ? response.proposal.imageDraft?.prompt ?? "" : "";
  assert.ok(prompt.length > 0);
  assert.match(prompt, /[А-Яа-яІіЇїЄєҐґ]/);
  assert.doesNotMatch(prompt, /\bMinimalist\b/);
  assert.doesNotMatch(prompt, /Чернетка візуалізації для ілюстратора\./i);
});

test("resolveReviewItemSelection keeps full anchored paragraph span even when excerpt is shorter", () => {
  const text = "Абзац 1: перший пункт.\n\nАбзац 2: другий пункт.\n\nАбзац 3: поза межами рекомендації.";
  const revision = deriveManuscriptRevisionState(text);
  const firstId = revision.paragraphOrder[0];
  const secondId = revision.paragraphOrder[1];
  const first = revision.paragraphsById[firstId];
  const second = revision.paragraphsById[secondId];

  assert.ok(first);
  assert.ok(second);

  const selection = resolveReviewItemSelection(text, revision, {
    anchor: {
      paragraphIds: [firstId, secondId],
      generationParagraphRange: { start: 1, end: 2 },
      excerpt: "Абзац 2: другий пункт.",
      fingerprint: computeAnchorFingerprint(revision, [firstId, secondId], "Абзац 2: другий пункт.")
    }
  });

  assert.equal(selection.start, first.start);
  assert.equal(selection.end, second.end);
});

test("generateReviewAction enforces markdown list output for list recommendations", async () => {
  const text = "Перша ознака вказує на дефіцит. Друга ознака вказує на запалення. Третя ознака вказує на стрес.";
  const revision = deriveManuscriptRevisionState(text);
  const paragraphId = revision.paragraphOrder[0];
  const excerpt = "Друга ознака вказує на запалення.";

  const item: EditorialReviewItem = {
    id: "review-list-1",
    reviewSessionId: "session-1",
    documentRevisionId: revision.documentRevisionId,
    changeLevel: 3,
    title: "Перетворити на список",
    reason: "Тут три сигнали в одному потоці.",
    recommendation: "Подати як структурований список.",
    recommendationType: "list",
    suggestedAction: "rewrite_text",
    priority: "medium",
    anchor: {
      paragraphIds: [paragraphId],
      generationParagraphRange: { start: 1, end: 1 },
      excerpt,
      fingerprint: computeAnchorFingerprint(revision, [paragraphId], excerpt)
    },
    insertionPoint: {
      mode: "replace",
      anchorParagraphId: paragraphId
    },
    status: "pending"
  };

  const response = await generateReviewAction(
    {
      text,
      currentRevision: revision,
      item,
      provider: "openai",
      modelId: "gpt-5.4"
    },
    {
      readEnvValue: () => null
    }
  );

  assert.equal(response.proposal.kind, "text_diff");
  assert.equal(response.usedFallback, true);

  const replacement = response.proposal.kind === "text_diff" ? response.proposal.textDiff?.replacement ?? "" : "";
  const listLines = replacement
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));

  assert.ok(listLines.length >= 2);
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
