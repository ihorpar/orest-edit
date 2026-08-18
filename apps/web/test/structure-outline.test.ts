import test from "node:test";
import assert from "node:assert/strict";

import type { EditorDocument } from "../lib/editor/document-model.ts";
import type { EditorialReviewItem } from "../lib/editor/review-contract.ts";
import { buildStructureOutlineTree, listSubsectionManuscriptPreviewItems, applyAllStructureSubheadings } from "../lib/editor/structure-outline.ts";

function createDocument(): EditorDocument {
  return {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 1, content: [{ text: "Схильність і діатези" }] },
      { id: "h2a", type: "heading", level: 2, content: [{ text: "Що таке діатез" }] },
      { id: "h3a", type: "heading", level: 3, content: [{ text: "Спадковість і середовище" }] },
      { id: "p18", type: "paragraph", content: [{ text: "Три типи діатезів." }] },
      { id: "h2b", type: "heading", level: 2, content: [{ text: "Алергічна предиспозиція" }] },
      { id: "p32", type: "paragraph", content: [{ text: "Практичне розпізнавання." }] },
      { id: "h3b", type: "heading", level: 3, content: [{ text: "Ранні періоди розвитку" }] }
    ]
  };
}

function createSubsectionItem(partial: Partial<EditorialReviewItem> & Pick<EditorialReviewItem, "id" | "insertionPoint">): EditorialReviewItem {
  return {
    id: partial.id,
    reviewSessionId: "session",
    documentRevisionId: "rev",
    changeLevel: 3,
    title: partial.title ?? "Картка",
    reason: partial.reason ?? "reason",
    recommendation: partial.recommendation ?? "recommendation",
    recommendationType: "subsection",
    suggestedAction: "insert_text",
    priority: "medium",
    anchor: {
      blockIds: [partial.insertionPoint.anchorBlockId],
      generationBlockRange: { start: 0, end: 0 },
      excerpt: "excerpt",
      fingerprint: "fp"
    },
    insertionPoint: partial.insertionPoint,
    origin: "review",
    stepId: "structure",
    status: partial.status ?? "ready",
    headingLevel: partial.headingLevel,
    subsectionDraft: partial.subsectionDraft
  };
}

test("buildStructureOutlineTree nests existing headings and inserts proposed before anchors", () => {
  const document = createDocument();
  const items = [
    createSubsectionItem({
      id: "prop-1",
      insertionPoint: { mode: "before", anchorBlockId: "p18" },
      headingLevel: 3,
      subsectionDraft: { title: "Три моделі предиспозицій", headingLevel: 3, prompt: "" }
    }),
    createSubsectionItem({
      id: "prop-2",
      insertionPoint: { mode: "before", anchorBlockId: "p32" },
      headingLevel: 2,
      subsectionDraft: { title: "Що справді оцінюють на практиці", headingLevel: 2, prompt: "" }
    })
  ];

  const tree = buildStructureOutlineTree({
    document,
    items,
    untitledLabel: "Без назви",
    emptyRootLabel: "План розділу"
  });

  assert.equal(tree.rootTitle, "Схильність і діатези");
  assert.equal(tree.proposedCount, 2);
  assert.equal(tree.nodes.length, 3);
  assert.equal(tree.nodes[0]?.title, "Що таке діатез");
  assert.equal(tree.nodes[0]?.children[0]?.title, "Спадковість і середовище");
  assert.equal(tree.nodes[0]?.children[1]?.kind, "proposed");
  assert.equal(tree.nodes[0]?.children[1]?.level, 3);
  assert.equal(tree.nodes[0]?.children[1]?.title, "Три моделі предиспозицій");
  assert.equal(tree.nodes[1]?.title, "Алергічна предиспозиція");
  assert.equal(tree.nodes[1]?.children[0]?.title, "Ранні періоди розвитку");
  assert.equal(tree.nodes[2]?.kind, "proposed");
  assert.equal(tree.nodes[2]?.level, 2);
  assert.equal(tree.nodes[2]?.title, "Що справді оцінюють на практиці");
});

test("buildStructureOutlineTree nests proposed H3 under proposed H2 at the same section", () => {
  const document = createDocument();
  const items = [
    createSubsectionItem({
      id: "prop-h2",
      insertionPoint: { mode: "before", anchorBlockId: "p18" },
      headingLevel: 2,
      subsectionDraft: { title: "Новий смисловий розділ", headingLevel: 2, prompt: "" }
    }),
    createSubsectionItem({
      id: "prop-h3",
      insertionPoint: { mode: "before", anchorBlockId: "p18" },
      headingLevel: 3,
      subsectionDraft: { title: "Уточнення всередині розділу", headingLevel: 3, prompt: "" }
    })
  ];

  const tree = buildStructureOutlineTree({ document, items });
  const proposedH2 = tree.nodes.find((node) => node.id === "prop-h2");
  assert.ok(proposedH2);
  assert.equal(proposedH2?.level, 2);
  assert.equal(proposedH2?.kind, "proposed");
  assert.equal(proposedH2?.children[0]?.id, "prop-h3");
  assert.equal(proposedH2?.children[0]?.level, 3);
});

test("buildStructureOutlineTree skips applied proposals and hides dismissed unless showCompleted", () => {
  const document = createDocument();
  const items = [
    createSubsectionItem({
      id: "applied",
      status: "applied",
      insertionPoint: { mode: "before", anchorBlockId: "p18" },
      subsectionDraft: { title: "Already in", headingLevel: 3, prompt: "" }
    }),
    createSubsectionItem({
      id: "dismissed",
      status: "dismissed",
      insertionPoint: { mode: "before", anchorBlockId: "p32" },
      subsectionDraft: { title: "Rejected", headingLevel: 3, prompt: "" }
    })
  ];

  const hidden = buildStructureOutlineTree({ document, items, showCompleted: false });
  assert.equal(hidden.proposedCount, 0);

  const shown = buildStructureOutlineTree({ document, items, showCompleted: true });
  assert.equal(shown.proposedCount, 1);
  assert.equal(shown.nodes.some((node) => node.kind === "proposed" && node.title === "Rejected")
    || shown.nodes.some((node) => node.children.some((child) => child.title === "Rejected")), true);
});

test("listSubsectionManuscriptPreviewItems keeps ready and preparing, drops applied/dismissed", () => {
  const items = [
    createSubsectionItem({
      id: "ready",
      status: "ready",
      insertionPoint: { mode: "before", anchorBlockId: "p18" },
      subsectionDraft: { title: "Ready title", headingLevel: 3, prompt: "" }
    }),
    createSubsectionItem({
      id: "pending-no-draft",
      status: "pending",
      insertionPoint: { mode: "before", anchorBlockId: "p18" }
    }),
    createSubsectionItem({
      id: "preparing",
      status: "preparing",
      insertionPoint: { mode: "before", anchorBlockId: "p32" }
    }),
    createSubsectionItem({
      id: "applied",
      status: "applied",
      insertionPoint: { mode: "before", anchorBlockId: "p18" },
      subsectionDraft: { title: "Applied", headingLevel: 3, prompt: "" }
    }),
    createSubsectionItem({
      id: "dismissed",
      status: "dismissed",
      insertionPoint: { mode: "before", anchorBlockId: "p18" },
      subsectionDraft: { title: "Dismissed", headingLevel: 3, prompt: "" }
    })
  ];

  const visible = listSubsectionManuscriptPreviewItems(items).map((item) => item.id);
  assert.deepEqual(visible, ["ready", "preparing"]);
});

test("applyAllStructureSubheadings inserts H2 before H3 at the same anchor in document order", () => {
  const document = createDocument();
  const items = [
    createSubsectionItem({
      id: "later-h3",
      insertionPoint: { mode: "before", anchorBlockId: "p32" },
      headingLevel: 3,
      subsectionDraft: { title: "Пізніший H3", headingLevel: 3, prompt: "" }
    }),
    createSubsectionItem({
      id: "early-h2",
      insertionPoint: { mode: "before", anchorBlockId: "p18" },
      headingLevel: 2,
      subsectionDraft: { title: "Ранній H2", headingLevel: 2, prompt: "" }
    }),
    createSubsectionItem({
      id: "early-h3",
      insertionPoint: { mode: "before", anchorBlockId: "p18" },
      headingLevel: 3,
      subsectionDraft: { title: "Ранній H3", headingLevel: 3, prompt: "" }
    })
  ];

  const result = applyAllStructureSubheadings(document, items);
  assert.deepEqual(result.appliedItemIds, ["early-h2", "early-h3", "later-h3"]);
  assert.equal(result.insertedBlockIds.length, 3);

  const ids = result.document.blocks.map((block) => block.id);
  const p18 = ids.indexOf("p18");
  const p32 = ids.indexOf("p32");
  assert.equal(result.document.blocks[p18 - 2]?.type, "heading");
  assert.equal((result.document.blocks[p18 - 2] as { level: number }).level, 2);
  assert.equal(result.document.blocks[p18 - 1]?.type, "heading");
  assert.equal((result.document.blocks[p18 - 1] as { level: number }).level, 3);
  assert.equal(result.document.blocks[p32 - 1]?.type, "heading");
  assert.equal((result.document.blocks[p32 - 1] as { level: number }).level, 3);
});
