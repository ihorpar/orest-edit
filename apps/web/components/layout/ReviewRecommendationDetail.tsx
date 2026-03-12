"use client";

import type {
  EditorialCalloutKind,
  EditorialReviewItem,
  EditorialVisualIntent,
  ReviewActionProposal,
  VisualStylePreset
} from "../../lib/editor/review-contract";
import {
  getEditorialCalloutKindDescription,
  getEditorialCalloutKindLabel,
  getEditorialCalloutKindOptions,
  getEditorialRecommendationTypeLabel,
  getEditorialVisualIntentOptions,
  getReviewParagraphRangeLabel,
  resolveReviewImageAssetUrl
} from "../../lib/editor/review-contract";
import { Button } from "../ui/Button";
import { VisualIntentToggle, VisualStyleToggle } from "../editor/VisualSelectionControls";
import { useResolvedEditorAssetUrl } from "../editor/ResolvedEditorImage";
import { formatParagraphLabel, type ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import { getVisualStylePresetOptions, normalizeVisualStylePreset } from "../../lib/editor/settings";
import { ArrowDownToLine, RefreshCcw, Sparkles, X } from "lucide-react";

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
  onUpdateActiveVisualIntent,
  onUpdateActiveImagePrompt,
  onUpdateActiveImageCaption,
  onUpdateActiveVisualStylePreset,
  activeVisualStylePreset,
  onGenerateActiveReviewImage,
  onApplyActiveReviewImage
}: {
  item: EditorialReviewItem | null;
  revision?: ManuscriptRevisionState | null;
  proposal: ReviewActionProposal | null;
  layout?: "rail" | "pendant";
  isPreparing?: boolean;
  reviewImageLoading?: boolean;
  onPrepare: (item: EditorialReviewItem, options?: { visualStylePreset?: VisualStylePreset }) => void;
  onApplyCallout: (item: EditorialReviewItem) => void;
  onApplySubsection: (item: EditorialReviewItem) => void;
  onDismiss: (item: EditorialReviewItem) => void;
  onUpdateActiveCalloutKind: (item: EditorialReviewItem, kind: EditorialCalloutKind) => void;
  onUpdateActiveCalloutTitle: (item: EditorialReviewItem, title: string) => void;
  onUpdateActiveCalloutBody: (item: EditorialReviewItem, body: string) => void;
  onUpdateActiveSubsectionTitle: (item: EditorialReviewItem, title: string) => void;
  onUpdateActiveSubsectionLead: (item: EditorialReviewItem, lead: string) => void;
  onUpdateActiveVisualIntent: (item: EditorialReviewItem, intent: EditorialVisualIntent) => void;
  onUpdateActiveImagePrompt: (prompt: string) => void;
  onUpdateActiveImageCaption: (caption: string) => void;
  onUpdateActiveVisualStylePreset: (preset: VisualStylePreset) => void;
  activeVisualStylePreset?: VisualStylePreset;
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
  const insertionCopy = revision ? getInsertionContextCopy(item, revision) : null;
  const visualStyleOptions = getVisualStylePresetOptions();
  const visualIntentOptions = getEditorialVisualIntentOptions();
  const selectedVisualStylePreset = normalizeVisualStylePreset(activeVisualStylePreset ?? imageDraft?.visualStylePreset);
  const selectedVisualIntent = imageDraft?.visualIntent ?? item.visualIntent ?? "infographic";
  const hasGeneratedAsset = Boolean(imageDraft?.generatedAsset);

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
          <X className="editorial-review-detail-close-icon" aria-hidden="true" />
        </button>
      </div>

      {isPreparing ? (
        <div className="editorial-review-proposal">
          <p className="editorial-review-image-status">ШІ готує цю рекомендацію…</p>
        </div>
      ) : null}

      {!isPreparing && item.status === "pending" && item.recommendationType !== "callout" && item.recommendationType !== "subsection" && item.recommendationType !== "visual" ? (
        <div className="editorial-review-detail-actions">
          <Button size="sm" variant="primary" onClick={() => onPrepare(item)}>
            Підготувати
          </Button>
        </div>
      ) : null}

      {!isPreparing && item.status === "pending" && item.recommendationType === "visual" ? (
        <div className="editorial-review-proposal">
          <div className="editorial-review-callout-kind-row">
            <p className="editorial-review-detail-label">Тип візуалу</p>
            <VisualIntentToggle
              value={selectedVisualIntent}
              options={visualIntentOptions}
              onChange={(nextIntent) => onUpdateActiveVisualIntent(item, nextIntent)}
            />
          </div>
          <div className="editorial-review-callout-kind-row">
            <p className="editorial-review-detail-label">Стиль візуалу</p>
            <VisualStyleToggle
              value={selectedVisualStylePreset}
              options={visualStyleOptions}
              onChange={(nextPreset) => onUpdateActiveVisualStylePreset(nextPreset)}
            />
          </div>
          <div className="editorial-review-detail-actions editorial-review-proposal-actions">
            <Button
              size="sm"
              variant="primary"
              onClick={() => onPrepare(item, { visualStylePreset: selectedVisualStylePreset })}
            >
              Підготувати
            </Button>
          </div>
        </div>
      ) : null}

      {!isPreparing && proposal?.kind === "text_diff" ? (
        <div className="editorial-review-proposal">
          <p className="editorial-review-proposal-summary">Чернетка відкрита в рукописі.</p>
          {proposal.textDiff?.warning ? (
            <div className="editorial-review-proposal-block editorial-review-proposal-warning">
              <p className="editorial-review-proposal-summary">{proposal.textDiff.warning.message}</p>
            </div>
          ) : null}
          <div className="editorial-review-detail-actions editorial-review-proposal-actions">
            <Button size="sm" variant="secondary" onClick={() => onPrepare(item)}>
              Перегенерувати
            </Button>
          </div>
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
          <div className="editorial-review-field-group">
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
          {insertionCopy ? <p className="editorial-review-insertion-note">{insertionCopy}</p> : null}
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
          <div className="editorial-review-field-group">
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
          {insertionCopy ? <p className="editorial-review-insertion-note">{insertionCopy}</p> : null}
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
              <span className="button-content">
                <RefreshCcw className="editorial-review-button-icon" aria-hidden="true" />
                <span>Оновити текст</span>
              </span>
            </Button>
          </div>
          <textarea
            className="editorial-review-image-prompt-input"
            value={imageDraft.prompt}
            onChange={(event) => onUpdateActiveImagePrompt(event.target.value)}
          />
          <div className="editorial-review-callout-kind-row">
            <p className="editorial-review-detail-label">Тип візуалу</p>
            <VisualIntentToggle
              value={selectedVisualIntent}
              options={visualIntentOptions}
              onChange={(nextIntent) => {
                onUpdateActiveVisualIntent(item, nextIntent);
                onPrepare(
                  { ...item, visualIntent: nextIntent },
                  { visualStylePreset: selectedVisualStylePreset }
                );
              }}
            />
          </div>
          <div className="editorial-review-callout-kind-row">
            <p className="editorial-review-detail-label">Стиль візуалу</p>
            <VisualStyleToggle
              value={selectedVisualStylePreset}
              options={visualStyleOptions}
              onChange={(nextPreset) => {
                onUpdateActiveVisualStylePreset(nextPreset);
                onPrepare(item, { visualStylePreset: nextPreset });
              }}
            />
          </div>
          <div className="editorial-review-field-group">
            <p className="editorial-review-detail-label">Підпис</p>
            <input
              className="editorial-review-callout-title-input"
              value={imageDraft.caption ?? ""}
              onChange={(event) => onUpdateActiveImageCaption(event.target.value)}
            />
          </div>
          {insertionCopy ? <p className="editorial-review-insertion-note">{insertionCopy}</p> : null}
          <div className="editorial-review-detail-actions editorial-review-proposal-actions">
            <Button
              size="sm"
              variant={hasGeneratedAsset ? "secondary" : "primary"}
              onClick={onGenerateActiveReviewImage}
              loading={reviewImageLoading}
            >
              <span className="button-content">
                {hasGeneratedAsset ? (
                  <RefreshCcw className="editorial-review-button-icon" aria-hidden="true" />
                ) : (
                  <Sparkles className="editorial-review-button-icon" aria-hidden="true" />
                )}
                <span>{hasGeneratedAsset ? "Згенерувати ще раз" : "Згенерувати"}</span>
              </span>
            </Button>
            <Button
              size="sm"
              variant={hasGeneratedAsset ? "primary" : "secondary"}
              onClick={onApplyActiveReviewImage}
              disabled={!hasGeneratedAsset}
            >
              <span className="button-content">
                <ArrowDownToLine className="editorial-review-button-icon" aria-hidden="true" />
                <span>Вставити в документ</span>
              </span>
            </Button>
          </div>
          {hasGeneratedAsset ? (
            <div className="editorial-review-image-preview">
              {imageUrl ? <img src={imageUrl} alt={imageDraft.alt} /> : null}
              <p className="editorial-review-image-status">Зображення готове до вставки.</p>
            </div>
          ) : (
            <p className="editorial-review-image-status">Промпт готовий до генерації.</p>
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

function getInsertionContextCopy(item: EditorialReviewItem, revision: ManuscriptRevisionState): string | null {
  if (item.insertionPoint.mode !== "before" && item.insertionPoint.mode !== "after") {
    return null;
  }

  const anchorIndex = revision.blockOrder.indexOf(item.insertionPoint.anchorBlockId);

  if (anchorIndex < 0) {
    return null;
  }

  const paragraph = formatParagraphLabel(anchorIndex);
  return item.insertionPoint.mode === "before" ? `Вставка перед Абз. ${paragraph}` : `Вставка після Абз. ${paragraph}`;
}
