"use client";

import type { EditorialReviewItem, ReviewActionProposal } from "../../lib/editor/review-contract";
import {
  getEditorialCalloutKindDescription,
  getEditorialCalloutKindLabel,
  resolveReviewImageAssetUrl
} from "../../lib/editor/review-contract";
import { Button } from "../ui/Button";
import { useResolvedEditorAssetUrl } from "../editor/ResolvedEditorImage";

export function ReviewRecommendationDetail({
  item,
  proposal,
  isPreparing,
  reviewImageLoading,
  onPrepare,
  onApplyCallout,
  onDismiss,
  onUpdateActiveImagePrompt,
  onGenerateActiveReviewImage,
  onApplyActiveReviewImage
}: {
  item: EditorialReviewItem | null;
  proposal: ReviewActionProposal | null;
  isPreparing?: boolean;
  reviewImageLoading?: boolean;
  onPrepare: (item: EditorialReviewItem) => void;
  onApplyCallout: (item: EditorialReviewItem) => void;
  onDismiss: (item: EditorialReviewItem) => void;
  onUpdateActiveImagePrompt: (prompt: string) => void;
  onGenerateActiveReviewImage: () => void;
  onApplyActiveReviewImage: () => void;
}) {
  const imageAssetSource = proposal?.kind === "image_prompt" && proposal.imageDraft?.generatedAsset
    ? resolveReviewImageAssetUrl(proposal.imageDraft.generatedAsset)
    : null;
  const { resolvedUrl: imageUrl } = useResolvedEditorAssetUrl(imageAssetSource);

  if (!item) {
    return null;
  }

  const calloutDraft = proposal?.kind === "callout_prompt" && proposal.calloutDraft ? proposal.calloutDraft : item.calloutDraft;
  const imageDraft = proposal?.kind === "image_prompt" ? proposal.imageDraft : null;

  return (
    <article className="editorial-review-detail" data-type={item.recommendationType}>
      <div className="editorial-review-detail-head">
        <div>
          <p className="editorial-review-detail-label">{item.recommendationType}</p>
          <h3 className="editorial-review-detail-title">{item.title}</h3>
        </div>
        <button type="button" className="editorial-review-detail-close" onClick={() => onDismiss(item)} aria-label="Закрити">
          <span className="editorial-review-detail-close-icon">×</span>
        </button>
      </div>

      <p className="editorial-review-detail-copy">{item.recommendation}</p>
      <p className="editorial-review-detail-action">{item.reason}</p>
      <blockquote className="editorial-review-detail-excerpt">{item.anchor.excerpt}</blockquote>

      {isPreparing ? (
        <div className="editorial-review-proposal">
          <p className="editorial-review-image-status">ШІ готує цю рекомендацію…</p>
        </div>
      ) : null}

      {!isPreparing && item.status === "pending" ? (
        <div className="editorial-review-detail-actions">
          <Button size="sm" variant="primary" onClick={() => onPrepare(item)}>
            Підготувати
          </Button>
        </div>
      ) : null}

      {!isPreparing && proposal?.kind === "text_diff" ? (
        <div className="editorial-review-proposal">
          <p className="editorial-review-proposal-summary">Чернетка відкрита прямо в рукописі. Перегляньте й застосуйте її в центрі сторінки.</p>
        </div>
      ) : null}

      {!isPreparing && calloutDraft ? (
        <div className="editorial-review-proposal">
          <div className="editorial-review-callout-kind-row">
            <p className="editorial-review-detail-label">Тип врізки</p>
            <div className="editorial-review-callout-kind-copy">
              <strong className="editorial-review-callout-kind-chip">{getEditorialCalloutKindLabel(calloutDraft.calloutKind)}</strong>
              {" "}
              {getEditorialCalloutKindDescription(calloutDraft.calloutKind)}
            </div>
          </div>
          <div className="editorial-review-proposal-block">
            <p className="editorial-review-detail-label">Заголовок</p>
            <p className="editorial-review-proposal-summary">{calloutDraft.title}</p>
            <p className="editorial-review-detail-label">Чернетка</p>
            <p className="editorial-review-callout-preview">{calloutDraft.previewText}</p>
          </div>
          <details className="editorial-review-prompt-details">
            <summary>Prompt</summary>
            <pre className="editorial-review-prompt-pre">{calloutDraft.prompt}</pre>
          </details>
          <div className="editorial-review-detail-actions editorial-review-proposal-actions">
            <Button size="sm" variant="secondary" onClick={() => onPrepare(item)}>
              Перегенерувати
            </Button>
            <Button size="sm" variant="primary" onClick={() => onApplyCallout(item)}>
              Вставити
            </Button>
          </div>
        </div>
      ) : null}

      {!isPreparing && imageDraft ? (
        <div className="editorial-review-proposal">
          <div className="editorial-review-image-prompt-head">
            <p className="editorial-review-detail-label">Prompt для візуалу</p>
            <Button size="sm" variant="secondary" onClick={() => onPrepare(item)}>
              Оновити prompt
            </Button>
          </div>
          <textarea
            className="editorial-review-image-prompt-input"
            value={imageDraft.prompt}
            onChange={(event) => onUpdateActiveImagePrompt(event.target.value)}
          />
          <div className="editorial-review-detail-actions editorial-review-proposal-actions">
            <Button size="sm" variant="secondary" onClick={onGenerateActiveReviewImage} loading={reviewImageLoading}>
              {imageDraft.generatedAsset ? "Згенерувати ще раз" : "Згенерувати"}
            </Button>
            <Button size="sm" variant="primary" onClick={onApplyActiveReviewImage} disabled={!imageDraft.generatedAsset}>
              Вставити в документ
            </Button>
          </div>
          {imageDraft.generatedAsset ? (
            <div className="editorial-review-image-preview">
              {imageUrl ? <img src={imageUrl} alt={imageDraft.alt} /> : null}
              <p className="editorial-review-image-status">Зображення готове. Після вставки воно з’явиться нижче виділеного фрагмента.</p>
            </div>
          ) : (
            <p className="editorial-review-image-status">Промпт готовий. Запустіть генерацію, щоб побачити preview.</p>
          )}
        </div>
      ) : null}

      {!isPreparing && proposal?.kind === "stale_anchor" ? (
        <div className="editorial-review-proposal">
          <div className="editorial-review-proposal-block editorial-review-proposal-warning">
            <p className="editorial-review-proposal-summary">{proposal.summary}</p>
          </div>
        </div>
      ) : null}
    </article>
  );
}
