import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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
  const [isExpanded, setIsExpanded] = useState(false);
  const { label: statusLabel, tone: statusTone } = getReviewStatusPresentation(item.status);
  const rangeLabel = getReviewParagraphRangeLabel(item, revision);
  const canExpand = item.recommendation.trim().length > 120;

  return (
    <article
      className="editorial-review-card-compact"
      data-status={item.status}
      data-active={isActive ? "true" : "false"}
      data-expanded={isExpanded ? "true" : "false"}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={`Рекомендація: ${rangeLabel}`}
      onClick={() => onFocus(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocus(item);
        }
      }}
    >
      <div className="err-compact-head">
        <h3 className="err-compact-title">{item.recommendation}</h3>
        <div className="err-compact-controls">
          {canExpand ? (
            <button
              type="button"
              className="editorial-review-card-expand"
              onClick={(event) => {
                event.stopPropagation();
                setIsExpanded((current) => !current);
              }}
              aria-label={isExpanded ? "Згорнути" : "Розгорнути"}
              title={isExpanded ? "Згорнути" : "Розгорнути"}
            >
              {isExpanded ? (
                <ChevronUp aria-hidden="true" width={12} height={12} />
              ) : (
                <ChevronDown aria-hidden="true" width={12} height={12} />
              )}
            </button>
          ) : null}
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
  label: "погоджено" | "відхилено" | "очікує" | "готово" | "застаріло" | "готується";
  tone: "accepted" | "rejected" | "pending" | "ready" | "stale" | "preparing";
} {
  if (status === "applied") {
    return { label: "погоджено", tone: "accepted" };
  }

  if (status === "dismissed") {
    return { label: "відхилено", tone: "rejected" };
  }

  if (status === "ready") {
    return { label: "готово", tone: "ready" };
  }

  if (status === "stale") {
    return { label: "застаріло", tone: "stale" };
  }

  if (status === "preparing") {
    return { label: "готується", tone: "preparing" };
  }

  return { label: "очікує", tone: "pending" };
}
