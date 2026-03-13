import type { ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import {
  getEditorialRecommendationTypeLabel,
  getReviewParagraphRangeLabel,
  type EditorialReviewItem
} from "../../lib/editor/review-contract";

export function EditorialReviewCard({
  item,
  revision,
  isActive,
  onFocus,
  onPrepare,
  onApplyCallout,
  onDismiss,
  isLoading
}: {
  item: EditorialReviewItem;
  revision: ManuscriptRevisionState;
  isActive?: boolean;
  onFocus: (item: EditorialReviewItem) => void;
  onPrepare: (item: EditorialReviewItem) => void;
  onApplyCallout: (item: EditorialReviewItem) => void;
  onDismiss: (item: EditorialReviewItem) => void;
  isLoading?: boolean;
}) {
  const { label: statusLabel, tone: statusTone } = getReviewStatusPresentation(item.status);
  const rangeLabel = getReviewParagraphRangeLabel(item, revision);

  return (
    <article
      className="editorial-review-card-compact"
      data-status={item.status}
      data-active={isActive ? "true" : "false"}
      onClick={() => onFocus(item)}
    >
      <div className="err-compact-head">
        <h3 className="err-compact-title">{item.recommendation}</h3>
        <button
          type="button"
          className="editorial-review-card-close"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(item);
          }}
          aria-label="Закрити"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" width="12" height="12">
            <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" fill="none" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
      <div className="err-compact-footer">
        <div className="err-compact-range">{rangeLabel}</div>
        <div className="err-compact-meta">
          {isLoading ? (
            <span className="loading-inline-dots"><span></span><span></span><span></span></span>
          ) : (
            <>
              <span className="err-compact-type">{getEditorialRecommendationTypeLabel(item.recommendationType)}</span>
              <span className="err-compact-separator">•</span>
              <span className="err-compact-status" data-tone={statusTone}>
                {statusLabel}
              </span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function getReviewStatusPresentation(status: EditorialReviewItem["status"]): {
  label: "accepted" | "rejected" | "pending" | "ready" | "stale" | "preparing";
  tone: "accepted" | "rejected" | "pending" | "ready" | "stale" | "preparing";
} {
  if (status === "applied") {
    return { label: "accepted", tone: "accepted" };
  }

  if (status === "dismissed") {
    return { label: "rejected", tone: "rejected" };
  }

  if (status === "ready") {
    return { label: "ready", tone: "ready" };
  }

  if (status === "stale") {
    return { label: "stale", tone: "stale" };
  }

  if (status === "preparing") {
    return { label: "preparing", tone: "preparing" };
  }

  return { label: "pending", tone: "pending" };
}
