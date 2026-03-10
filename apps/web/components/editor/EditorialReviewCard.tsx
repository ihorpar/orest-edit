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
  visualize: "візуалізувати",
  illustration: "ілюстрація"
};

const priorityLabels: Record<EditorialReviewItem["priority"], string> = {
  high: "високий пріоритет",
  medium: "середній пріоритет",
  low: "низький пріоритет"
};

const statusLabels: Partial<Record<EditorialReviewItem["status"], string>> = {
  ready: "чернетка готова",
  applied: "застосовано",
  stale: "потрібен перегляд"
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
  const canApplyPrefilledCallout = item.recommendationType === "callout" && Boolean(item.calloutDraft?.previewText);
  const hasCalloutDraftError = item.recommendationType === "callout" && !item.calloutDraft?.previewText;
  const actionButtonStyle = { textTransform: "none", letterSpacing: "0.02em" } as const;

  return (
    <article
      className="editorial-review-card"
      data-type={item.recommendationType}
      data-priority={item.priority}
      data-active={isActive ? "true" : "false"}
      data-status={item.status}
    >
      {item.status === "applied" ? (
        <div className="editorial-review-card-applied-row" onClick={() => onFocus(item)}>
          <div className="editorial-review-applied-mark">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2.5 6.5L4.5 8.5L9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="mono-ui tag-pill tag-applied">Готово</span>
          <h4 className="editorial-review-card-applied-title">{item.title}</h4>
        </div>
      ) : (
        <>
          <div className="editorial-review-head">
            <div className="editorial-review-meta">
              <span className="tag-pill tag-type">{typeLabels[item.recommendationType]}</span>
              <span className={`tag-pill tag-severity-${item.priority}`}>{priorityLabels[item.priority]}</span>
              <span className="tag-lines">Абзаци {getReviewParagraphLabel(item, revision)}</span>
            </div>
            <button
              type="button"
              className="editorial-review-card-close"
              onClick={() => onDismiss(item)}
              aria-label="Закрити рекомендацію"
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2L10 10" />
                <path d="M10 2L2 10" />
              </svg>
            </button>
          </div>

          <h3 className="editorial-review-title">{item.title}</h3>
          {statusLabels[item.status] ? (
            <p className="mono-ui editorial-review-status-chip">{statusLabels[item.status]}</p>
          ) : null}

          <div className="button-row editorial-review-card-actions">
            <Button variant="secondary" size="sm" onClick={() => onFocus(item)} style={actionButtonStyle}>
              Перейти до фрагмента
            </Button>
          </div>
        </>
      )}
    </article>
  );
}
