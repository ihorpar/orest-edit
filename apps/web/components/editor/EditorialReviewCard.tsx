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

  return (
    <article className="editorial-review-card" data-type={item.recommendationType} data-priority={item.priority} data-active={isActive ? "true" : "false"}>
      <div className="editorial-review-head">
        <div className="editorial-review-meta">
          <span className="mono-ui suggestion-card-type">{typeLabels[item.recommendationType]}</span>
          <span className="mono-ui suggestion-card-lines">
            Абзаци {getReviewParagraphLabel(item, revision)}
          </span>
        </div>
        <span className="mono-ui editorial-review-severity">{priorityLabels[item.priority]}</span>
        <button type="button" className="editorial-review-card-close" onClick={() => onDismiss(item)} aria-label="Закрити рекомендацію">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2L10 10" />
            <path d="M10 2L2 10" />
          </svg>
        </button>
      </div>

      <h3 className="editorial-review-title">{item.title}</h3>
      <p className="editorial-review-summary">{item.reason}</p>
      {statusLabels[item.status] ? <p className="mono-ui editorial-review-status-chip">{statusLabels[item.status]}</p> : null}

      <div className="button-row editorial-review-card-actions">
        <Button variant="secondary" size="sm" onClick={() => onFocus(item)}>
          Перейти до фрагмента
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => (canApplyPrefilledCallout ? onApplyCallout(item) : onPrepare(item))}
          disabled={item.status === "applied" || hasCalloutDraftError}
        >
          {canApplyPrefilledCallout ? "Вставити врізку" : hasCalloutDraftError ? "Помилка врізки" : "Працюй!"}
        </Button>
      </div>
    </article>
  );
}
