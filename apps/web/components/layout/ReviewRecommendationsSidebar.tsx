import type { ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import type { EditorialReviewItem } from "../../lib/editor/review-contract";
import { EditorialReviewCard } from "../editor/EditorialReviewCard";
import { useProductCopy } from "../providers/ProductLocaleProvider";

export function ReviewRecommendationsSidebar({
  revision,
  reviewItems,
  reviewLoading,
  activeReviewItemId,
  onFocusReviewItem,
  onPrepareReviewItem,
  onDismissReviewItem
}: {
  revision: ManuscriptRevisionState;
  reviewItems: EditorialReviewItem[];
  reviewLoading?: boolean;
  activeReviewItemId?: string | null;
  onFocusReviewItem: (item: EditorialReviewItem) => void;
  onPrepareReviewItem: (item: EditorialReviewItem) => void;
  onDismissReviewItem: (item: EditorialReviewItem) => void;
}) {
  const copy = useProductCopy();
  const sidebar = copy.editor.reviewSidebar;

  return (
    <div className="review-sidebar">
      <div className="review-sidebar-head">
        <div>
          <p className="mono-ui operations-title">{sidebar.kicker}</p>
          <h2 className="review-sidebar-title">{sidebar.title}</h2>
        </div>
        {reviewItems.length > 0 ? <span className="mono-ui suggestion-card-lines">{sidebar.recommendationCount(reviewItems.length)}</span> : null}
      </div>

      {reviewLoading ? (
        <div className="operations-empty loading-state-card" role="status" aria-live="polite">
          <span className="loading-inline-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="mono-ui">{sidebar.loading}</span>
        </div>
      ) : null}

      {!reviewLoading && reviewItems.length === 0 ? (
        <div className="operations-empty">
          <p className="editor-note-copy">{sidebar.empty}</p>
        </div>
      ) : null}

      <div className="operations-stack operations-stack-compact">
        {reviewItems.map((item) => (
          <EditorialReviewCard
            key={item.id}
            item={item}
            revision={revision}
            isActive={item.id === activeReviewItemId}
            onFocus={onFocusReviewItem}
            onPrepare={onPrepareReviewItem}
            onApplyCallout={onPrepareReviewItem}
            onDismiss={onDismissReviewItem}
          />
        ))}
      </div>
    </div>
  );
}
