import type { EditorDocument } from "./document-model";
import { getBlockText } from "./document-model";
import type { EditorialHeadingLevel, EditorialReviewItem } from "./review-contract";

export type StructureOutlineKind = "existing" | "proposed";

export type StructureOutlineEntry = {
  kind: StructureOutlineKind;
  id: string;
  title: string;
  level: EditorialHeadingLevel;
  blockId?: string;
  reviewItemId?: string;
  status?: EditorialReviewItem["status"];
  /** Document order index for existing headings; anchor index for proposals. */
  orderIndex: number;
};

export type StructureOutlineNode = StructureOutlineEntry & {
  children: StructureOutlineNode[];
};

export type StructureOutlineTreeModel = {
  rootTitle: string;
  nodes: StructureOutlineNode[];
  proposedCount: number;
};

function resolveProposedTitle(item: EditorialReviewItem, fallbackUntitled: string): string {
  return (
    item.subsectionDraft?.title?.trim()
    || item.title.trim()
    || item.recommendation.trim()
    || fallbackUntitled
  );
}

function resolveProposedLevel(item: EditorialReviewItem): EditorialHeadingLevel {
  return item.subsectionDraft?.headingLevel ?? item.headingLevel ?? 3;
}

function shouldIncludeProposedItem(item: EditorialReviewItem, showCompleted: boolean): boolean {
  if (item.recommendationType !== "subsection") {
    return false;
  }

  if (item.status === "applied") {
    return false;
  }

  if (item.status === "dismissed") {
    return showCompleted;
  }

  return true;
}

function toNode(entry: StructureOutlineEntry): StructureOutlineNode {
  return { ...entry, children: [] };
}

function insertOrdered(list: StructureOutlineNode[], node: StructureOutlineNode): void {
  const index = list.findIndex((entry) => entry.orderIndex > node.orderIndex);
  if (index === -1) {
    list.push(node);
    return;
  }
  list.splice(index, 0, node);
}

/**
 * Build a nested H2/H3 outline: existing manuscript headings plus Structure proposals
 * inserted before their anchor blocks. Proposed H2 sit at root (same indent as existing H2);
 * proposed H3 nest under the nearest preceding H2 (existing or proposed).
 */
export function buildStructureOutlineTree(input: {
  document: EditorDocument;
  items: EditorialReviewItem[];
  showCompleted?: boolean;
  untitledLabel?: string;
  emptyRootLabel?: string;
}): StructureOutlineTreeModel {
  const untitledLabel = input.untitledLabel ?? "Untitled";
  const emptyRootLabel = input.emptyRootLabel ?? untitledLabel;
  const showCompleted = input.showCompleted ?? false;

  const blockIndexById = new Map<string, number>();
  input.document.blocks.forEach((block, index) => {
    blockIndexById.set(block.id, index);
  });

  const existingEntries: StructureOutlineEntry[] = [];
  let rootTitle = emptyRootLabel;

  input.document.blocks.forEach((block, index) => {
    if (block.type !== "heading") {
      return;
    }

    const title = getBlockText(block).trim() || untitledLabel;

    if (block.level === 1 && rootTitle === emptyRootLabel) {
      rootTitle = title;
      return;
    }

    if (block.level !== 2 && block.level !== 3) {
      return;
    }

    existingEntries.push({
      kind: "existing",
      id: block.id,
      title,
      level: block.level,
      blockId: block.id,
      orderIndex: index
    });
  });

  const roots: StructureOutlineNode[] = [];
  const h2Nodes: StructureOutlineNode[] = [];
  let currentH2: StructureOutlineNode | null = null;

  for (const entry of existingEntries) {
    const node = toNode(entry);
    if (entry.level === 2) {
      roots.push(node);
      h2Nodes.push(node);
      currentH2 = node;
      continue;
    }

    if (currentH2) {
      currentH2.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const proposals: EditorialReviewItem[] = [];
  for (const item of input.items) {
    if (shouldIncludeProposedItem(item, showCompleted)) {
      proposals.push(item);
    }
  }

  proposals.sort((left, right) => {
    const leftIndex = blockIndexById.get(left.insertionPoint?.anchorBlockId ?? "") ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = blockIndexById.get(right.insertionPoint?.anchorBlockId ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    // Place proposed H2 before H3 at the same anchor so H3 can nest under that H2.
    const leftLevel = resolveProposedLevel(left);
    const rightLevel = resolveProposedLevel(right);
    if (leftLevel !== rightLevel) {
      return leftLevel - rightLevel;
    }
    return left.id.localeCompare(right.id);
  });

  for (const item of proposals) {
    const anchorId = item.insertionPoint?.anchorBlockId?.trim() || "";
    const orderIndex = blockIndexById.get(anchorId) ?? Number.MAX_SAFE_INTEGER - 1;
    const level = resolveProposedLevel(item);
    const node = toNode({
      kind: "proposed",
      id: item.id,
      title: resolveProposedTitle(item, untitledLabel),
      level,
      reviewItemId: item.id,
      status: item.status,
      orderIndex
    });

    if (level === 2) {
      insertOrdered(roots, node);
      insertOrdered(h2Nodes, node);
      continue;
    }

    let parent: StructureOutlineNode | null = null;
    for (const h2 of h2Nodes) {
      if (h2.orderIndex <= orderIndex) {
        parent = h2;
      }
    }

    if (parent) {
      insertOrdered(parent.children, node);
    } else {
      insertOrdered(roots, node);
    }
  }

  const proposedCount = proposals.length;

  return { rootTitle, nodes: roots, proposedCount };
}

/**
 * Subsection items that should appear as manuscript ghosts:
 * ready titles always; preparing items even before a title arrives.
 */
export function listSubsectionManuscriptPreviewItems(items: EditorialReviewItem[]): EditorialReviewItem[] {
  return items.filter((item) => {
    if (item.recommendationType !== "subsection") {
      return false;
    }

    if (item.status === "applied" || item.status === "dismissed") {
      return false;
    }

    if (item.status === "preparing") {
      return true;
    }

    return Boolean(item.subsectionDraft?.title?.trim());
  });
}
