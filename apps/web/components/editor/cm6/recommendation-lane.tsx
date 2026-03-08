"use client";

import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { EditorialReviewDetail } from "../EditorialReviewDetail";
import { resolveRecommendationLaneAnchor } from "../../../lib/editor/cm6/recommendation-positions";
import type { ManuscriptRevisionState } from "../../../lib/editor/manuscript-structure";
import type { EditorialReviewItem, ReviewActionProposal } from "../../../lib/editor/review-contract";

export function RecommendationLane({
  editorView,
  item,
  revision,
  proposal,
  preparing,
  imageGenerating,
  imageInserting,
  layoutKey,
  onClose,
  onPrepare,
  onApplyText,
  onApplyCallout,
  onGenerateImage,
  onInsertImage,
  onDiscardProposal
}: {
  editorView: EditorView | null;
  item: EditorialReviewItem;
  revision: ManuscriptRevisionState;
  proposal: ReviewActionProposal | null;
  preparing?: boolean;
  imageGenerating?: boolean;
  imageInserting?: boolean;
  layoutKey: string;
  onClose: () => void;
  onPrepare: () => void;
  onApplyText: () => void;
  onApplyCallout: () => void;
  onGenerateImage: () => void;
  onInsertImage: () => void;
  onDiscardProposal: () => void;
}) {
  const [anchorTop, setAnchorTop] = useState(0);

  useEffect(() => {
    function updateAnchor() {
      if (!editorView) {
        return;
      }

      const anchor = resolveRecommendationLaneAnchor(editorView, revision, item);
      setAnchorTop(anchor?.top ?? 0);
    }

    updateAnchor();
    window.addEventListener("resize", updateAnchor);

    return () => {
      window.removeEventListener("resize", updateAnchor);
    };
  }, [editorView, item, layoutKey, revision]);

  return (
    <aside className="cm-orest-side-panel cm-orest-recommendation-lane" style={{ top: anchorTop }}>
      <div className="cm-orest-side-panel-card cm-orest-recommendation-lane-card">
        <EditorialReviewDetail
          item={item}
          revision={revision}
          proposal={proposal}
          preparing={preparing}
          imageGenerating={imageGenerating}
          imageInserting={imageInserting}
          onClose={onClose}
          onPrepare={onPrepare}
          onApplyText={onApplyText}
          onApplyCallout={onApplyCallout}
          onGenerateImage={onGenerateImage}
          onInsertImage={onInsertImage}
          onDiscardProposal={onDiscardProposal}
        />
      </div>
    </aside>
  );
}
