import { GutterMarker, gutter } from "@codemirror/view";
import type { Extension, EditorState } from "@codemirror/state";
import { getManuscriptParagraphs, type ManuscriptRevisionState } from "../manuscript-structure";
import type { EditorialReviewItem } from "../review-contract";

class ParagraphMarker extends GutterMarker {
  constructor(
    private readonly label: string,
    private readonly hasReview: boolean,
    private readonly isActive: boolean
  ) {
    super();
  }

  eq(other: ParagraphMarker) {
    return this.label === other.label && this.hasReview === other.hasReview && this.isActive === other.isActive;
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-orest-paragraph-gutter-marker";
    wrapper.dataset.review = this.hasReview ? "true" : "false";
    wrapper.dataset.active = this.isActive ? "true" : "false";

    const label = document.createElement("span");
    label.className = "cm-orest-paragraph-gutter-label";
    label.textContent = this.label;
    wrapper.append(label);

    return wrapper;
  }
}

function buildParagraphLineMap(
  state: EditorState,
  text: string,
  revision: ManuscriptRevisionState,
  reviewItems: EditorialReviewItem[],
  activeReviewItem: EditorialReviewItem | null
) {
  const paragraphs = getManuscriptParagraphs(text, revision);
  const reviewCounts = new Map<string, number>();

  reviewItems.forEach((item) => {
    item.anchor.paragraphIds.forEach((paragraphId) => {
      reviewCounts.set(paragraphId, (reviewCounts.get(paragraphId) ?? 0) + 1);
    });
  });

  const activeParagraphIds = new Set(activeReviewItem?.anchor.paragraphIds ?? []);
  const lineMap = new Map<number, ParagraphMarker>();

  paragraphs.forEach((paragraph) => {
    const safePosition = Math.min(Math.max(paragraph.start, 0), state.doc.length);
    const line = state.doc.lineAt(safePosition);
    lineMap.set(
      line.from,
      new ParagraphMarker(paragraph.label, (reviewCounts.get(paragraph.id) ?? 0) > 0, activeParagraphIds.has(paragraph.id))
    );
  });

  return lineMap;
}

export function createParagraphGutter(input: {
  text: string;
  revision: ManuscriptRevisionState;
  reviewItems: EditorialReviewItem[];
  activeReviewItem: EditorialReviewItem | null;
}): Extension {
  return gutter({
    class: "cm-orest-paragraph-gutter",
    renderEmptyElements: true,
    initialSpacer() {
      return new ParagraphMarker("000", true, false);
    },
    lineMarker(view, line) {
      const lineMap = buildParagraphLineMap(view.state, input.text, input.revision, input.reviewItems, input.activeReviewItem);
      return lineMap.get(line.from) ?? null;
    }
  });
}
