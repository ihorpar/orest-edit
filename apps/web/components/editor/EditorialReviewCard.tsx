import { useState, type ReactNode } from "react";
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
  isLoading,
  variant = "default",
  title,
  description,
  rangeLabelOverride,
  hideMeta = false
}: {
  item: EditorialReviewItem;
  revision: ManuscriptRevisionState;
  isActive?: boolean;
  onFocus: (item: EditorialReviewItem) => void;
  onPrepare: (item: EditorialReviewItem) => void;
  onApplyCallout: (item: EditorialReviewItem) => void;
  onDismiss: (item: EditorialReviewItem) => void;
  isLoading?: boolean;
  variant?: "default" | "emphasis";
  title?: ReactNode;
  description?: ReactNode;
  rangeLabelOverride?: string;
  hideMeta?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { label: statusLabel, tone: statusTone } = getReviewStatusPresentation(item.status);
  const shouldShowStatus = item.status !== "pending";
  const rangeLabel = rangeLabelOverride ?? getReviewParagraphRangeLabel(item, revision);
  const recommendationText = item.recommendation.trim();
  const titleText = item.title.trim() || recommendationText;
  const titleContent = title ?? titleText;
  const descriptionContent = description ?? recommendationText;
  const canExpand =
    typeof description === "undefined"
      ? recommendationText.length > 0 && recommendationText !== titleText
      : Boolean(descriptionContent);

  return (
    <article
      className="editorial-review-card-compact"
      data-status={item.status}
      data-active={isActive ? "true" : "false"}
      data-expanded={isExpanded ? "true" : "false"}
      data-variant={variant}
      role="button"
      tabIndex={0}
      aria-expanded={canExpand ? isExpanded : undefined}
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
        <div className="err-compact-copy">
          <h3 className="err-compact-title">{titleContent}</h3>
          {canExpand && isExpanded ? <div className="err-compact-description">{descriptionContent}</div> : null}
        </div>
        <div className="err-compact-controls">
          {canExpand ? (
            <button
              type="button"
              className="editorial-review-card-expand"
              onClick={(event) => {
                event.stopPropagation();
                setIsExpanded((current) => !current);
              }}
              aria-label={isExpanded ? "Згорнути деталі" : "Показати деталі"}
              title={isExpanded ? "Згорнути деталі" : "Показати деталі"}
            >
              {isExpanded ? (
                <ChevronUp aria-hidden="true" width={16} height={16} />
              ) : (
                <ChevronDown aria-hidden="true" width={16} height={16} />
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
            aria-label="Відхилити рекомендацію"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true" width="12" height="12">
              <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" fill="none" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>
      <div className="err-compact-footer">
        <div className="err-compact-range">{rangeLabel}</div>
        {!hideMeta ? (
          <div className="err-compact-meta">
            {isLoading ? (
              <span className="loading-inline-dots"><span></span><span></span><span></span></span>
            ) : (
              <>
                <span className="err-compact-type">{getEditorialRecommendationTypeLabel(item.recommendationType)}</span>
                {shouldShowStatus ? (
                  <>
                    <span className="err-compact-separator">•</span>
                    <span className="err-compact-status" data-tone={statusTone}>
                      {statusLabel}
                    </span>
                  </>
                ) : null}
              </>
            )}
          </div>
        ) : null}
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
