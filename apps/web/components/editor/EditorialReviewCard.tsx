import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useProductCopy, useProductLocale } from "../providers/ProductLocaleProvider";
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
  hideMeta = false,
  isHidden = false
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
  isHidden?: boolean;
}) {
  const rc = useProductCopy().editor.reviewCard;
  const sc = useProductCopy().editor.spellcheckUi;
  const { locale } = useProductLocale();
  const [isExpanded, setIsExpanded] = useState(false);
  const { label: statusLabel, tone: statusTone } = getReviewStatusPresentation(item.status, rc);
  const shouldShowStatus = item.status !== "pending";
  const rangeLabel = rangeLabelOverride ?? getReviewParagraphRangeLabel(item, revision, locale);
  const recommendationText = item.recommendation.trim();
  const titleText = item.title.trim() || recommendationText;
  const titleContent = title ?? titleText;
  const descriptionContent = description ?? recommendationText;
  const canExpand =
    typeof description === "undefined"
      ? recommendationText.length > 0 && recommendationText !== titleText
      : Boolean(descriptionContent);
  const isCompleted = item.status === "applied" || item.status === "dismissed";
  const primaryActionLabel = item.status === "ready" ? rc.openDetails : rc.prepare;

  useEffect(() => {
    if (isActive) {
      setIsExpanded(true);
    }
  }, [isActive]);

  useEffect(() => {
    if (isHidden) {
      setIsExpanded(false);
    }
  }, [isHidden]);

  return (
    <article
      className="editorial-review-card-compact"
      data-status={item.status}
      data-active={isActive ? "true" : "false"}
      data-expanded={isExpanded ? "true" : "false"}
      data-variant={variant}
      data-hidden={isHidden ? "true" : "false"}
      role={isHidden ? undefined : "button"}
      tabIndex={isHidden ? -1 : 0}
      aria-expanded={!isHidden && canExpand ? isExpanded : undefined}
      aria-hidden={isHidden || undefined}
      aria-label={rc.recommendationAria(rangeLabel)}
      onClick={isHidden ? undefined : () => onFocus(item)}
      onKeyDown={isHidden ? undefined : (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onFocus(item);
        }
      }}
    >
      <div className="err-compact-head">
        <div className="err-compact-copy">
          <h3 className="err-compact-title">{titleContent}</h3>
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
              disabled={isHidden}
              aria-label={isExpanded ? sc.collapseDetails : sc.showDetails}
              title={isExpanded ? sc.collapseDetails : sc.showDetails}
            >
              {isExpanded ? (
                <ChevronUp aria-hidden="true" width={16} height={16} />
              ) : (
                <ChevronDown aria-hidden="true" width={16} height={16} />
              )}
            </button>
          ) : null}
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
                <span className="err-compact-type">{getEditorialRecommendationTypeLabel(item.recommendationType, locale)}</span>
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
      {canExpand ? (
        <div className="err-compact-body">
          {isExpanded ? (
            <>
              <div className="err-compact-description">{descriptionContent}</div>
              <div className="err-compact-actions">
                {!isCompleted ? (
                  <>
                    <button
                      type="button"
                      className="err-compact-action-button err-compact-action-button-primary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPrepare(item);
                      }}
                      disabled={isHidden}
                    >
                      {primaryActionLabel}
                    </button>
                    <button
                      type="button"
                      className="err-compact-action-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onFocus(item);
                      }}
                      disabled={isHidden}
                    >
                      {rc.goToParagraph}
                    </button>
                    <button
                      type="button"
                      className="err-compact-text-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDismiss(item);
                      }}
                      disabled={isHidden}
                    >
                      {rc.dismiss}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="err-compact-action-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onFocus(item);
                    }}
                    disabled={isHidden}
                  >
                    {rc.goToParagraph}
                  </button>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function getReviewStatusPresentation(
  status: EditorialReviewItem["status"],
  rc: ReturnType<typeof useProductCopy>["editor"]["reviewCard"]
): {
  label: string;
  tone: "accepted" | "rejected" | "pending" | "ready" | "stale" | "preparing";
} {
  if (status === "applied") {
    return { label: rc.statusAccepted, tone: "accepted" };
  }

  if (status === "dismissed") {
    return { label: rc.statusDismissed, tone: "rejected" };
  }

  if (status === "ready") {
    return { label: rc.statusReady, tone: "ready" };
  }

  if (status === "stale") {
    return { label: rc.statusStale, tone: "stale" };
  }

  if (status === "preparing") {
    return { label: rc.statusPreparing, tone: "preparing" };
  }

  return { label: rc.statusPending, tone: "pending" };
}
