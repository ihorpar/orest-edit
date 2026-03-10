"use client";

import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { EditorialReviewDetail } from "../EditorialReviewDetail";
import { resolveRecommendationLaneAnchor } from "../../../lib/editor/cm6/recommendation-positions";
import type { ManuscriptRevisionState } from "../../../lib/editor/manuscript-structure";
import type { EditorialCalloutKind, EditorialReviewItem, ReviewActionProposal, ReviewImageGenerationJobStatus } from "../../../lib/editor/review-contract";

export function RecommendationLane({
  editorView,
  item,
  revision,
  proposal,
  preparing,
  imageGenerating,
  imageInserting,
  imageJobStatus,
  imageJobError,
  layoutKey,
  onClose,
  onPrepare,
  onCalloutKindChange,
  onCalloutTitleChange,
  onCalloutPreviewChange,
  onApplyText,
  onApplyCallout,
  onGenerateImage,
  onInsertImage,
  onImagePromptChange,
  onDiscardProposal,
  selectedCalloutKind,
}: {
  editorView: EditorView | null;
  item: EditorialReviewItem;
  revision: ManuscriptRevisionState;
  proposal: ReviewActionProposal | null;
  preparing?: boolean;
  imageGenerating?: boolean;
  imageInserting?: boolean;
  imageJobStatus?: ReviewImageGenerationJobStatus;
  imageJobError?: string;
  layoutKey: string;
  onClose: () => void;
  onPrepare: () => void;
  onCalloutKindChange: (kind: EditorialCalloutKind) => void;
  onCalloutTitleChange?: (title: string) => void;
  onCalloutPreviewChange?: (previewText: string) => void;
  onApplyText: () => void;
  onApplyCallout: () => void;
  onGenerateImage: () => void;
  onInsertImage: () => void;
  onImagePromptChange?: (prompt: string) => void;
  onDiscardProposal: () => void;
  selectedCalloutKind?: EditorialCalloutKind;
}) {
  const [anchorTop, setAnchorTop] = useState(0);
  const [anchorHeight, setAnchorHeight] = useState(0);

  useEffect(() => {
    function updateAnchor() {
      if (!editorView) {
        return;
      }

      const anchor = resolveRecommendationLaneAnchor(editorView, revision, item);
      setAnchorTop(anchor?.top ?? 0);
      setAnchorHeight(anchor?.height ?? 0);
    }

    updateAnchor();
    window.addEventListener("resize", updateAnchor);

    return () => {
      window.removeEventListener("resize", updateAnchor);
    };
  }, [editorView, item, layoutKey, revision]);

  return (
    <aside className="cm-orest-inline-panel cm-orest-recommendation-lane" style={{ top: anchorTop + anchorHeight + 12 }}>
      <div className="cm-orest-inline-panel-card cm-orest-recommendation-lane-card">
        <EditorialReviewDetail
          item={item}
          revision={revision}
          proposal={proposal}
          preparing={preparing}
          imageGenerating={imageGenerating}
          imageInserting={imageInserting}
          imageJobStatus={imageJobStatus}
          imageJobError={imageJobError}
          onClose={onClose}
          onPrepare={onPrepare}
          onCalloutKindChange={onCalloutKindChange}
          onCalloutTitleChange={onCalloutTitleChange}
          onCalloutPreviewChange={onCalloutPreviewChange}
          onApplyText={onApplyText}
          onApplyCallout={onApplyCallout}
          onGenerateImage={onGenerateImage}
          onInsertImage={onInsertImage}
          onImagePromptChange={onImagePromptChange}
          onDiscardProposal={onDiscardProposal}
          selectedCalloutKind={selectedCalloutKind}
        />
      </div>
    </aside>
  );
}
