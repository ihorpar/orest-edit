import type { EditorView } from "@codemirror/view";
import type { ManuscriptRevisionState } from "../manuscript-structure";
import type { EditorialReviewItem } from "../review-contract";

export interface RecommendationLaneAnchor {
  top: number;
  height: number;
}

export function resolveOffsetLaneAnchor(view: EditorView, start: number, end = start): RecommendationLaneAnchor {
  const firstBlock = view.lineBlockAt(start);
  const lastBlock = view.lineBlockAt(end);

  return {
    top: firstBlock.top,
    height: Math.max(lastBlock.bottom - firstBlock.top, firstBlock.height)
  };
}

export function resolveRecommendationLaneAnchor(
  view: EditorView,
  revision: ManuscriptRevisionState,
  item: EditorialReviewItem
): RecommendationLaneAnchor | null {
  const anchoredParagraphs = item.anchor.paragraphIds
    .map((id) => revision.paragraphsById[id])
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);

  if (anchoredParagraphs.length === 0) {
    return null;
  }

  return resolveOffsetLaneAnchor(view, anchoredParagraphs[0].start, anchoredParagraphs[anchoredParagraphs.length - 1].end);
}
