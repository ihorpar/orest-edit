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

  return (
    <article className="editor-note-card" data-active={isActive ? "true" : "false"}>
      <button type="button" className="editor-note-dismiss" onClick={() => onDismiss(item)} aria-label="Закрити рекомендацію" title="Закрити">
        ×
      </button>
      <div className="editor-note-head">
        <div>
          <p className="editor-note-title">{item.title}</p>
          <p className="mono-ui editor-note-meta">
            {getReviewParagraphLabel(item, revision)} · {typeLabels[item.recommendationType]} · {priorityLabels[item.priority]}
          </p>
        </div>
        <span className="mono-ui editor-note-badge">{item.status}</span>
      </div>
      <p className="editor-note-copy">{item.reason}</p>
      <p className="editor-note-copy">{item.recommendation}</p>
      <div className="button-row">
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
