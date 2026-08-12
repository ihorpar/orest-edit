import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "../lib/editor/document-model.ts";
import { planEmphasisChunks, planReviewChunks } from "../lib/server/review-chunk-planner.ts";

test("planEmphasisChunks covers every eligible block exactly once", () => {
  const blocks: Block[] = [
    { id: "h1", type: "heading", level: 2, content: [{ text: "Section" }] },
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `p${index + 1}`,
      type: "paragraph" as const,
      content: [{ text: "x".repeat(1_500) }]
    }))
  ];
  const chunks = planEmphasisChunks(blocks);
  const coreIds = chunks.flatMap((chunk) => chunk.coreBlockIds);

  assert.deepEqual(coreIds, Array.from({ length: 12 }, (_, index) => `p${index + 1}`));
  assert.equal(new Set(coreIds).size, coreIds.length);
  assert.ok(chunks.every((chunk) => chunk.sourceChars <= 16_000 || chunk.coreBlockIds.length === 1));
});

test("planEmphasisChunks uses headings as section-aware context", () => {
  const blocks: Block[] = [
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `a${index}`,
      type: "paragraph" as const,
      content: [{ text: "a".repeat(1_600) }]
    })),
    { id: "h2", type: "heading", level: 2, content: [{ text: "Next section" }] },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `b${index}`,
      type: "paragraph" as const,
      content: [{ text: "b".repeat(1_600) }]
    }))
  ];
  const chunks = planEmphasisChunks(blocks);

  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].contextBlockIds.includes("h2"));
  assert.ok(chunks[1].contextBlockIds.includes("h2"));
  assert.ok(chunks[0].coreBlockIds.every((id) => id.startsWith("a")));
  assert.ok(chunks[1].coreBlockIds.every((id) => id.startsWith("b")));
});

test("planEmphasisChunks keeps one oversized block and skips non-text blocks", () => {
  const chunks = planEmphasisChunks([
    { id: "divider", type: "divider" },
    { id: "image", type: "image", assetId: "asset", alt: "diagram" },
    { id: "large", type: "paragraph", content: [{ text: "z".repeat(20_000) }] }
  ]);

  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0].coreBlockIds, ["large"]);
  assert.equal(chunks[0].sourceChars, 20_000);
});

test("planEmphasisChunks reduces the representative manuscript to about ten chunks", () => {
  const blocks: Block[] = [];

  for (let section = 0; section < 10; section += 1) {
    blocks.push({ id: `h${section}`, type: "heading", level: 2, content: [{ text: `Section ${section}` }] });
    for (let paragraph = 0; paragraph < 65; paragraph += 1) {
      blocks.push({
        id: `p${section}-${paragraph}`,
        type: "paragraph",
        content: [{ text: `${section}-${paragraph} ${"т".repeat(215)}` }]
      });
    }
  }

  const chunks = planEmphasisChunks(blocks);
  const allCoreIds = chunks.flatMap((chunk) => chunk.coreBlockIds);

  assert.ok(chunks.length >= 9 && chunks.length <= 12, `expected 9-12 chunks, received ${chunks.length}`);
  assert.equal(allCoreIds.length, 650);
  assert.equal(new Set(allCoreIds).size, 650);
  assert.ok(chunks.every((chunk) => chunk.sourceChars <= 16_000 || chunk.coreBlockIds.length === 1));
});

test("planReviewChunks packs by character budget even when block count exceeds 80", () => {
  const blocks: Block[] = Array.from({ length: 120 }, (_, index) => ({
    id: `tiny-${index}`,
    type: "paragraph" as const,
    content: [{ text: "n".repeat(80) }]
  }));
  const chunks = planReviewChunks(blocks);
  const allCoreIds = chunks.flatMap((chunk) => chunk.coreBlockIds);

  assert.equal(allCoreIds.length, 120);
  assert.equal(new Set(allCoreIds).size, 120);
  assert.ok(chunks.length <= 2, `expected character-first packing, received ${chunks.length} chunks`);
  assert.ok(chunks.some((chunk) => chunk.coreBlockIds.length > 80));
  assert.ok(chunks.every((chunk) => chunk.sourceChars <= 16_000));
});

test("planReviewChunks matches planEmphasisChunks for the representative fixture", () => {
  const blocks: Block[] = [];

  for (let section = 0; section < 10; section += 1) {
    blocks.push({ id: `h${section}`, type: "heading", level: 2, content: [{ text: `Section ${section}` }] });
    for (let paragraph = 0; paragraph < 65; paragraph += 1) {
      blocks.push({
        id: `p${section}-${paragraph}`,
        type: "paragraph",
        content: [{ text: `${section}-${paragraph} ${"т".repeat(215)}` }]
      });
    }
  }

  assert.deepEqual(planReviewChunks(blocks), planEmphasisChunks(blocks));
});
