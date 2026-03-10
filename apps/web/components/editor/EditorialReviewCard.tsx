import type { ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import { getReviewParagraphLabel, type EditorialReviewItem } from "../../lib/editor/review-contract";
import { Button } from "../ui/Button";

const typeLabels: Record<EditorialReviewItem["recommendationType"], string> = {
  rewrite: "переписати",
  expand: "дописати",
  simplify: "спростити",
  list: "список",
  subsection: "підрозділ",
  callout: "врізка",
  visualize: "схема",
  illustration: "ілюстрація"
};

const priorityLabels: Record<EditorialReviewItem["priority"], string> = {
  high: "high",
  medium: "medium",
  low: "low"
};

export function EditorialReviewCard({
  item,
  revision,
  isActive,
  onFocus,
  onPrepare,
  onApplyCallout,
  onDismiss
}: {
  item: EditorialReviewItem;
  revision: ManuscriptRevisionState;
  isActive?: boolean;
  onFocus: (item: EditorialReviewItem) => void;
  onPrepare: (item: EditorialReviewItem) => void;
  onApplyCallout: (item: EditorialReviewItem) => void;
  onDismiss: (item: EditorialReviewItem) => void;
}) {
  const canApplyCallout = item.suggestedAction === "prepare_callout" && item.calloutDraft;
  const statusLabel = item.status === "ready" ? "ready" : item.status === "applied" ? "applied" : "pending";

  return (
    <article
      className="editorial-review-card"
      data-active={isActive ? "true" : "false"}
      data-type={item.recommendationType}
      data-priority={item.priority}
      data-status={item.status}
    >
      <div className="editorial-review-head">
        <div>
          <h3 className="editorial-review-title">{item.title}</h3>
          <div className="editorial-review-meta">
            <span className="tag-pill tag-lines">{getReviewParagraphLabel(item, revision)}</span>
            <span className="tag-pill tag-type">{typeLabels[item.recommendationType]}</span>
            <span className={`tag-pill ${item.priority === "high" ? "tag-severity-high" : item.priority === "medium" ? "tag-severity-medium" : "tag-severity-low"}`}>
              {priorityLabels[item.priority]}
            </span>
            <span className="tag-pill tag-type">{statusLabel}</span>
          </div>
        </div>
        <button type="button" className="editorial-review-card-close" onClick={() => onDismiss(item)} aria-label="Закрити рекомендацію" title="Закрити">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2L2 10" />
          </svg>
        </button>
      </div>

      <p className="suggestion-card-reason">{item.reason}</p>
      <p className="editorial-review-summary">{item.recommendation}</p>

      <div className="editorial-review-card-actions button-row">
        <Button size="sm" variant="ghost" onClick={() => onFocus(item)}>
          Фокус
        </Button>
        {canApplyCallout ? (
          <Button size="sm" variant="secondary" onClick={() => onApplyCallout(item)}>
            Вставити
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => onPrepare(item)}>
            Підготувати
          </Button>
        )}
      </div>
    </article>
  );
}
