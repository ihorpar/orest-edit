import type { EditorialReviewItem } from "../../lib/editor/review-contract";
import { formatParagraphLabel } from "../../lib/editor/manuscript-structure";
import { Button } from "../ui/Button";

const categoryLabels: Record<EditorialReviewItem["category"], string> = {
  clarity: "ясність",
  structure: "структура",
  tone: "тон"
};

const severityLabels: Record<EditorialReviewItem["severity"], string> = {
  high: "високий пріоритет",
  medium: "середній пріоритет",
  low: "низький пріоритет"
};

export function EditorialReviewDetail({
  item,
  onClose
}: {
  item: EditorialReviewItem;
  onClose: () => void;
}) {
  return (
    <aside className="editorial-review-detail" data-category={item.category} data-severity={item.severity}>
      <div className="editorial-review-detail-head">
        <div className="editorial-review-detail-meta">
          <span className="mono-ui suggestion-card-type">{categoryLabels[item.category]}</span>
          <span className="mono-ui editorial-review-severity">{severityLabels[item.severity]}</span>
          <span className="mono-ui suggestion-card-lines">
            Абзаци {formatParagraphLabel(item.paragraphStart)}-{formatParagraphLabel(item.paragraphEnd)}
          </span>
        </div>
        <button type="button" className="editorial-review-detail-close" onClick={onClose} aria-label="Закрити розбір">
          <svg viewBox="0 0 12 12" aria-hidden="true" className="editorial-review-detail-close-icon">
            <path d="M2 2L10 10" />
            <path d="M10 2L2 10" />
          </svg>
        </button>
      </div>

      <h3 className="editorial-review-detail-title">{item.title}</h3>

      <div className="editorial-review-detail-body">
        <div className="editorial-review-detail-block">
          <p className="mono-ui editorial-review-detail-label">Що не працює</p>
          <p className="editorial-review-detail-copy">{item.explanation}</p>
        </div>

        <div className="editorial-review-detail-block">
          <p className="mono-ui editorial-review-detail-label">Що зробити</p>
          <p className="editorial-review-detail-copy editorial-review-detail-action">{item.recommendation}</p>
        </div>

        <div className="editorial-review-detail-block">
          <p className="mono-ui editorial-review-detail-label">Фрагмент</p>
          <p className="editorial-review-detail-excerpt">{item.excerpt}</p>
        </div>
      </div>

      <div className="editorial-review-detail-actions">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Закрити розбір
        </Button>
      </div>
    </aside>
  );
}
