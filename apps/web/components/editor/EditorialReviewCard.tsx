import { formatParagraphLabel } from "../../lib/editor/manuscript-structure";
import type { EditorialReviewItem } from "../../lib/editor/review-contract";
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

export function EditorialReviewCard({
  item,
  onFocus
}: {
  item: EditorialReviewItem;
  onFocus: (item: EditorialReviewItem) => void;
}) {
  return (
    <article className="editorial-review-card" data-category={item.category} data-severity={item.severity}>
      <div className="editorial-review-head">
        <div className="editorial-review-meta">
          <span className="mono-ui suggestion-card-type">{categoryLabels[item.category]}</span>
          <span className="mono-ui suggestion-card-lines">
            Абзаци {formatParagraphLabel(item.paragraphStart)}-{formatParagraphLabel(item.paragraphEnd)}
          </span>
        </div>
        <span className="mono-ui editorial-review-severity">{severityLabels[item.severity]}</span>
      </div>

      <h3 className="editorial-review-title">{item.title}</h3>
      <p className="editorial-review-summary">{item.explanation}</p>

      <div className="button-row editorial-review-card-actions">
        <Button variant="secondary" size="sm" onClick={() => onFocus(item)}>
          Перейти до фрагмента
        </Button>
      </div>
    </article>
  );
}
