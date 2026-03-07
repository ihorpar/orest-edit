import { DiffInlineMark } from "./DiffInlineMark";
import {
  getReviewParagraphLabel,
  resolveReviewImageAssetUrl,
  type EditorialReviewItem,
  type ReviewActionProposal
} from "../../lib/editor/review-contract";
import type { ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import { Button } from "../ui/Button";
import { useResolvedEditorAssetUrl } from "./ResolvedEditorImage";

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

export function EditorialReviewDetail({
  item,
  revision,
  proposal,
  preparing,
  imageGenerating,
  onClose,
  onPrepare,
  onApplyText,
  onApplyCallout,
  onGenerateImage,
  onInsertImage,
  imageInserting,
  onDiscardProposal
}: {
  item: EditorialReviewItem;
  revision: ManuscriptRevisionState;
  proposal: ReviewActionProposal | null;
  preparing?: boolean;
  imageGenerating?: boolean;
  onClose: () => void;
  onPrepare: () => void;
  onApplyText: () => void;
  onApplyCallout: () => void;
  onGenerateImage: () => void;
  onInsertImage: () => void;
  imageInserting?: boolean;
  onDiscardProposal: () => void;
}) {
  const isActiveProposal = proposal?.reviewItemId === item.id ? proposal : null;
  const canApplyPrefilledCallout = item.recommendationType === "callout" && Boolean(item.calloutDraft?.previewText);
  const hasCalloutDraftError = item.recommendationType === "callout" && !item.calloutDraft?.previewText;
  const generatedImageAsset =
    isActiveProposal?.kind === "image_prompt" && isActiveProposal.imageDraft?.generatedAsset
      ? isActiveProposal.imageDraft.generatedAsset
      : null;
  const generatedImageSource = generatedImageAsset ? resolveReviewImageAssetUrl(generatedImageAsset) : null;
  const { resolvedUrl: generatedImageUrl, isLoading: isGeneratedImageLoading } = useResolvedEditorAssetUrl(generatedImageSource);

  return (
    <aside className="editorial-review-detail" data-type={item.recommendationType} data-priority={item.priority}>
      <div className="editorial-review-detail-head">
        <div className="editorial-review-detail-meta">
          <span className="mono-ui suggestion-card-type">{typeLabels[item.recommendationType]}</span>
          <span className="mono-ui editorial-review-severity">{priorityLabels[item.priority]}</span>
          <span className="mono-ui suggestion-card-lines">
            Абзаци {getReviewParagraphLabel(item, revision)}
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
          <p className="editorial-review-detail-copy">{item.reason}</p>
        </div>

        <div className="editorial-review-detail-block">
          <p className="mono-ui editorial-review-detail-label">Що зробити</p>
          <p className="editorial-review-detail-copy editorial-review-detail-action">{item.recommendation}</p>
        </div>

        <div className="editorial-review-detail-block">
          <p className="mono-ui editorial-review-detail-label">Фрагмент</p>
          <p className="editorial-review-detail-excerpt">{item.anchor.excerpt}</p>
        </div>
      </div>

      <div className="editorial-review-detail-actions">
        <Button
          variant="primary"
          size="sm"
          onClick={canApplyPrefilledCallout ? onApplyCallout : onPrepare}
          loading={canApplyPrefilledCallout || hasCalloutDraftError ? false : preparing}
          loadingLabel="Готую чернетку…"
          disabled={hasCalloutDraftError}
        >
          {canApplyPrefilledCallout ? "Вставити врізку" : hasCalloutDraftError ? "Помилка врізки" : "Працюй!"}
        </Button>
        {isActiveProposal && !canApplyPrefilledCallout ? (
          <Button variant="secondary" size="sm" onClick={onDiscardProposal}>
            Прибрати чернетку
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onClose}>
          Закрити розбір
        </Button>
      </div>

      {hasCalloutDraftError ? (
        <p className="editorial-review-detail-copy" style={{ color: "#b42318" }}>
          Чернетку врізки не згенеровано. Запусти `Перевірити весь текст` ще раз.
        </p>
      ) : null}

      {isActiveProposal ? (
        <div className="editorial-review-proposal">
          <p className="mono-ui editorial-review-detail-label">Чернетка дії</p>
          <p className="editorial-review-detail-copy editorial-review-proposal-summary">{isActiveProposal.summary}</p>

          {isActiveProposal.kind === "text_diff" && isActiveProposal.textDiff ? (
            <div className="editorial-review-proposal-block">
              <DiffInlineMark
                oldText={isActiveProposal.textDiff.oldText}
                newText={isActiveProposal.textDiff.replacement}
                variant="card"
              />
              <div className="button-row editorial-review-proposal-actions">
                <Button variant="primary" size="sm" onClick={onApplyText}>
                  Застосувати текст
                </Button>
              </div>
            </div>
          ) : null}

          {isActiveProposal.kind === "callout_prompt" && isActiveProposal.calloutDraft ? (
            <div className="editorial-review-proposal-block">
              <p className="editorial-review-detail-copy">
                <strong>{isActiveProposal.calloutDraft.title}</strong>
              </p>
              {isActiveProposal.calloutDraft.previewText ? (
                <blockquote className="editorial-review-callout-preview">{isActiveProposal.calloutDraft.previewText}</blockquote>
              ) : null}
              <div className="button-row editorial-review-proposal-actions">
                <Button variant="primary" size="sm" onClick={onApplyCallout} disabled={!isActiveProposal.calloutDraft.previewText}>
                  Вставити врізку
                </Button>
              </div>
            </div>
          ) : null}

          {isActiveProposal.kind === "image_prompt" && isActiveProposal.imageDraft ? (
            <div className="editorial-review-proposal-block">
              <details className="editorial-review-prompt-details" open>
                <summary className="mono-ui">Prompt для зображення</summary>
                <pre className="editorial-review-prompt-pre">{isActiveProposal.imageDraft.prompt}</pre>
              </details>
              <p className="editorial-review-detail-copy">
                <strong>Alt:</strong> {isActiveProposal.imageDraft.alt}
              </p>
              {isActiveProposal.imageDraft.caption ? <p className="editorial-review-detail-copy">{isActiveProposal.imageDraft.caption}</p> : null}
              <div className="button-row editorial-review-proposal-actions">
                <Button variant="primary" size="sm" onClick={onGenerateImage} loading={imageGenerating} loadingLabel="Генерую…">
                  Згенерувати чернетку
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onInsertImage}
                  disabled={!generatedImageUrl || imageInserting}
                  loading={imageInserting}
                  loadingLabel="Вставляю…"
                >
                  Вставити зображення
                </Button>
              </div>
              {isGeneratedImageLoading ? <p className="mono-ui editorial-review-image-status">Завантажую прев'ю…</p> : null}
              {generatedImageUrl ? (
                <div className="editorial-review-image-preview">
                  <img src={generatedImageUrl} alt={isActiveProposal.imageDraft.alt || "Чернеткова ілюстрація"} />
                  <a className="mono-ui editorial-review-image-download" href={generatedImageUrl} download="review-draft-image">
                    Завантажити
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}

          {isActiveProposal.kind === "stale_anchor" ? (
            <div className="editorial-review-proposal-block editorial-review-proposal-warning">
              <p className="editorial-review-detail-copy">{isActiveProposal.staleReason}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
