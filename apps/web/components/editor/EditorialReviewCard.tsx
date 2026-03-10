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
      className="editorial-review-card-compact"
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
      <div className="err-compact-meta">
        {typeLabels[item.recommendationType]} • {statusLabel}
      </div>
    </article>
  );
}
