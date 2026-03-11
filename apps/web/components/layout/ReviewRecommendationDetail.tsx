"use client";

import type { EditorialCalloutKind, EditorialReviewItem, ReviewActionProposal } from "../../lib/editor/review-contract";
import {
  getEditorialCalloutKindDescription,
  getEditorialCalloutKindLabel,
  getEditorialCalloutKindOptions,
  getEditorialRecommendationTypeLabel,
  getReviewParagraphRangeLabel,
  resolveReviewImageAssetUrl
} from "../../lib/editor/review-contract";
import { Button } from "../ui/Button";
import { useResolvedEditorAssetUrl } from "../editor/ResolvedEditorImage";
import type { ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";

export function ReviewRecommendationDetail({
  item,
  revision,
  proposal,
  layout = "rail",
  isPreparing,
  reviewImageLoading,
  onPrepare,
  onApplyCallout,
  onApplySubsection,
  onDismiss,
  onUpdateActiveCalloutKind,
  onUpdateActiveCalloutTitle,
  onUpdateActiveCalloutBody,
  onUpdateActiveSubsectionTitle,
  onUpdateActiveSubsectionLead,
  onUpdateActiveImagePrompt,
  onGenerateActiveReviewImage,
  onApplyActiveReviewImage
}: {
  item: EditorialReviewItem | null;
  revision?: ManuscriptRevisionState | null;
  proposal: ReviewActionProposal | null;
  layout?: "rail" | "pendant";
  isPreparing?: boolean;
  reviewImageLoading?: boolean;
  onPrepare: (item: EditorialReviewItem) => void;
  onApplyCallout: (item: EditorialReviewItem) => void;
  onApplySubsection: (item: EditorialReviewItem) => void;
  onDismiss: (item: EditorialReviewItem) => void;
  onUpdateActiveCalloutKind: (item: EditorialReviewItem, kind: EditorialCalloutKind) => void;
  onUpdateActiveCalloutTitle: (item: EditorialReviewItem, title: string) => void;
  onUpdateActiveCalloutBody: (item: EditorialReviewItem, body: string) => void;
  onUpdateActiveSubsectionTitle: (item: EditorialReviewItem, title: string) => void;
  onUpdateActiveSubsectionLead: (item: EditorialReviewItem, lead: string) => void;
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
  const subsectionDraft = proposal?.kind === "subsection_prompt" && proposal.subsectionDraft ? proposal.subsectionDraft : item.subsectionDraft;
  const imageDraft = proposal?.kind === "image_prompt" ? proposal.imageDraft : null;
  const activeCalloutKind = calloutDraft?.calloutKind ?? item.calloutKind ?? "mechanism";
  const canInsertCallout = Boolean(calloutDraft?.previewText?.trim());
  const canInsertSubsection = Boolean(subsectionDraft?.title?.trim());
  const rangeLabel = revision ? getReviewParagraphRangeLabel(item, revision) : null;

  return (
    <article className="editorial-review-detail" data-layout={layout} data-type={item.recommendationType}>
      <div className="editorial-review-detail-head">
        <div>
          <p className="editorial-review-detail-label">
            {rangeLabel
              ? `${rangeLabel} • ${getEditorialRecommendationTypeLabel(item.recommendationType)}`
              : getEditorialRecommendationTypeLabel(item.recommendationType)}
          </p>
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

      {!isPreparing && item.status === "pending" && item.recommendationType !== "callout" && item.recommendationType !== "subsection" ? (
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

      {!isPreparing && item.recommendationType === "callout" ? (
        <div className="editorial-review-proposal">
          <div className="editorial-review-callout-kind-row">
            <p className="editorial-review-detail-label">Тип врізки</p>
            <select
              className="editorial-review-callout-kind-select"
              value={activeCalloutKind}
              onChange={(event) => onUpdateActiveCalloutKind(item, event.target.value as EditorialCalloutKind)}
            >
              {getEditorialCalloutKindOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="editorial-review-callout-kind-copy">
              <strong className="editorial-review-callout-kind-chip">{getEditorialCalloutKindLabel(activeCalloutKind)}</strong>
              {" "}
              {getEditorialCalloutKindDescription(activeCalloutKind)}
            </p>
          </div>
          <div className="editorial-review-proposal-block">
            <p className="editorial-review-detail-label">Заголовок</p>
            <input
              className="editorial-review-callout-title-input"
              value={calloutDraft?.title ?? ""}
              onChange={(event) => onUpdateActiveCalloutTitle(item, event.target.value)}
            />
            <p className="editorial-review-detail-label">Чернетка</p>
            <textarea
              className="editorial-review-callout-body-input"
              value={calloutDraft?.previewText ?? ""}
              onChange={(event) => onUpdateActiveCalloutBody(item, event.target.value)}
            />
          </div>
          {calloutDraft?.prompt ? (
            <details className="editorial-review-prompt-details">
              <summary>Prompt</summary>
              <pre className="editorial-review-prompt-pre">{calloutDraft.prompt}</pre>
            </details>
          ) : null}
          <div className="editorial-review-detail-actions editorial-review-proposal-actions">
            <Button size="sm" variant="secondary" onClick={() => onPrepare(item)}>
              {calloutDraft ? "Перегенерувати" : "Згенерувати"}
            </Button>
            <Button size="sm" variant="primary" onClick={() => onApplyCallout(item)} disabled={!canInsertCallout}>
              Вставити
            </Button>
          </div>
        </div>
      ) : null}

      {!isPreparing && item.recommendationType === "subsection" ? (
        <div className="editorial-review-proposal">
          <div className="editorial-review-proposal-block">
            <p className="editorial-review-detail-label">Підзаголовок</p>
            <input
              className="editorial-review-callout-title-input"
              value={subsectionDraft?.title ?? ""}
              onChange={(event) => onUpdateActiveSubsectionTitle(item, event.target.value)}
            />
            <p className="editorial-review-detail-label">Lead (опційно)</p>
            <textarea
              className="editorial-review-callout-body-input"
              value={subsectionDraft?.lead ?? ""}
              onChange={(event) => onUpdateActiveSubsectionLead(item, event.target.value)}
            />
          </div>
          {subsectionDraft?.prompt ? (
            <details className="editorial-review-prompt-details">
              <summary>Prompt</summary>
              <pre className="editorial-review-prompt-pre">{subsectionDraft.prompt}</pre>
            </details>
          ) : null}
          <div className="editorial-review-detail-actions editorial-review-proposal-actions">
            <Button size="sm" variant="secondary" onClick={() => onPrepare(item)}>
              {subsectionDraft ? "Перегенерувати" : "Згенерувати"}
            </Button>
            <Button size="sm" variant="primary" onClick={() => onApplySubsection(item)} disabled={!canInsertSubsection}>
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
