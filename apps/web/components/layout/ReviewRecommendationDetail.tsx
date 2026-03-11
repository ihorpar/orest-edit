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

function VisualIntentToggle({
  value,
  options,
  onChange
}: {
  value: EditorialVisualIntent;
  options: Array<{ value: EditorialVisualIntent; label: string }>;
  onChange: (value: EditorialVisualIntent) => void;
}) {
  return (
    <div className="editorial-review-visual-intent-toggle" role="tablist" aria-label="Тип візуалу">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className="editorial-review-visual-intent-button"
          data-active={value === option.value ? "true" : "false"}
          onClick={() => onChange(option.value)}
        >
          <span className="editorial-review-visual-intent-icon" aria-hidden="true">
            <VisualIntentIcon intent={option.value} />
          </span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function VisualStyleToggle({
  value,
  options,
  onChange
}: {
  value: VisualStylePreset;
  options: Array<{ value: VisualStylePreset; label: string }>;
  onChange: (value: VisualStylePreset) => void;
}) {
  return (
    <div className="editorial-review-visual-style-grid" role="radiogroup" aria-label="Стиль візуалу">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className="editorial-review-visual-style-button"
          data-active={value === option.value ? "true" : "false"}
          onClick={() => onChange(option.value)}
        >
          <span className="editorial-review-visual-style-icon" aria-hidden="true">
            <VisualStyleIcon preset={option.value} />
          </span>
          <span className="editorial-review-visual-style-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function VisualIntentIcon({ intent }: { intent: EditorialVisualIntent }) {
  if (intent === "illustration") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 16L11 12L14 15L17 11L19 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="9" cy="9" r="1.2" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 9H17M7 12H14M7 15H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M16.5 15.5L18 14L19.5 15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VisualStyleIcon({ preset }: { preset: VisualStylePreset }) {
  switch (preset) {
    case "minimal":
      return (
        <svg viewBox="0 0 84 56" fill="none">
          <rect x="4" y="6" width="76" height="44" rx="8" fill="#F8FAFC" stroke="#CBD5E1" />
          <path d="M14 19H70" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
          <path d="M14 29H58" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" />
          <rect x="14" y="35" width="22" height="8" rx="4" fill="#E2E8F0" />
        </svg>
      );
    case "neo_brutal":
      return (
        <svg viewBox="0 0 84 56" fill="none">
          <rect x="5" y="7" width="74" height="42" rx="8" fill="#F8FAFC" stroke="#0F172A" strokeWidth="2.5" />
          <rect x="14" y="14" width="20" height="28" fill="#FDE047" stroke="#0F172A" strokeWidth="2.5" />
          <rect x="38" y="14" width="32" height="12" fill="#60A5FA" stroke="#0F172A" strokeWidth="2.5" />
          <rect x="38" y="30" width="18" height="12" fill="#FB7185" stroke="#0F172A" strokeWidth="2.5" />
        </svg>
      );
    case "modern_glass":
      return (
        <svg viewBox="0 0 84 56" fill="none">
          <rect x="4" y="6" width="76" height="44" rx="10" fill="#E2E8F0" />
          <rect x="13" y="12" width="34" height="28" rx="8" fill="#FFFFFF" fillOpacity="0.55" stroke="#CBD5E1" />
          <rect x="32" y="18" width="38" height="24" rx="9" fill="#F8FAFC" fillOpacity="0.6" stroke="#C4D3E7" />
          <path d="M21 20H40" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M39 27H61" stroke="#A5B4FC" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "calm_gradient":
    default:
      return (
        <svg viewBox="0 0 84 56" fill="none">
          <rect x="4" y="6" width="76" height="44" rx="10" fill="#E0E7FF" />
          <circle cx="30" cy="22" r="18" fill="#BAE6FD" fillOpacity="0.8" />
          <circle cx="52" cy="32" r="18" fill="#C4B5FD" fillOpacity="0.8" />
          <rect x="18" y="20" width="48" height="18" rx="7" fill="#FFFFFF" fillOpacity="0.7" stroke="#BFDBFE" />
        </svg>
      );
  }
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
