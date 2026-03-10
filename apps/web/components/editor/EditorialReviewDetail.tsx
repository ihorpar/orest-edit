import { useEffect, useState } from "react";
import { DiffInlineMark } from "./DiffInlineMark";
import {
  getEditorialCalloutKindLabel,
  getEditorialCalloutKindOptions,
  getReviewParagraphLabel,
  resolveReviewImageAssetUrl,
  type EditorialCalloutKind,
  type EditorialReviewItem,
  type ReviewImageGenerationJobStatus,
  type ReviewActionProposal
} from "../../lib/editor/review-contract";
import type { ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
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
  imageJobStatus,
  imageJobError,
  selectedCalloutKind,
  onClose,
  onPrepare,
  onCalloutKindChange,
  onApplyText,
  onApplyCallout,
  onGenerateImage,
  onInsertImage,
  onImagePromptChange,
  imageInserting,
  onDiscardProposal
}: {
  item: EditorialReviewItem;
  revision: ManuscriptRevisionState;
  proposal: ReviewActionProposal | null;
  preparing?: boolean;
  imageGenerating?: boolean;
  imageJobStatus?: ReviewImageGenerationJobStatus;
  imageJobError?: string;
  selectedCalloutKind?: EditorialCalloutKind;
  onClose: () => void;
  onPrepare: () => void;
  onCalloutKindChange?: (kind: EditorialCalloutKind) => void;
  onApplyText: () => void;
  onApplyCallout: () => void;
  onGenerateImage: () => void;
  onInsertImage: () => void;
  onImagePromptChange?: (prompt: string) => void;
  imageInserting?: boolean;
  onDiscardProposal: () => void;
}) {
  const [isImagePromptExpanded, setIsImagePromptExpanded] = useState(false);
  const isActiveProposal = proposal?.reviewItemId === item.id ? proposal : null;
  const activeCalloutKind = selectedCalloutKind ?? isActiveProposal?.calloutDraft?.calloutKind ?? item.calloutDraft?.calloutKind ?? item.calloutKind;
  const canApplyPrefilledCallout =
    item.recommendationType === "callout" &&
    Boolean(item.calloutDraft?.previewText) &&
    activeCalloutKind === item.calloutDraft?.calloutKind &&
    !isActiveProposal;
  const hasCalloutDraftError = item.recommendationType === "callout" && !item.calloutDraft?.previewText;
  const generatedImageAsset =
    isActiveProposal?.kind === "image_prompt" && isActiveProposal.imageDraft?.generatedAsset
      ? isActiveProposal.imageDraft.generatedAsset
      : null;
  const generatedImageSource = generatedImageAsset ? resolveReviewImageAssetUrl(generatedImageAsset) : null;
  const { resolvedUrl: generatedImageUrl, isLoading: isGeneratedImageLoading } = useResolvedEditorAssetUrl(generatedImageSource);
  const isImageJobInProgress = imageJobStatus === "queued" || imageJobStatus === "processing";
  const showImageJobError = Boolean(imageJobError) && imageJobStatus === "failed";
  const imageJobStatusCopy =
    imageJobStatus === "queued" ? "У черзі генерації…" : imageJobStatus === "processing" ? "Генерую зображення…" : null;
  const isImageProposal = isActiveProposal?.kind === "image_prompt" && isActiveProposal.imageDraft;
  const activeImagePrompt = isImageProposal ? isActiveProposal.imageDraft.prompt : "";

  useEffect(() => {
    setIsImagePromptExpanded(false);
  }, [item.id, isActiveProposal?.id]);

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

        {item.recommendationType === "callout" || item.suggestedAction === "prepare_callout" ? (
          <div className="editorial-review-detail-block">
            <div className="editorial-review-callout-kind-row">
              <p className="mono-ui editorial-review-detail-label">Тип врізки</p>
              <Select
                aria-label="Тип врізки"
                value={activeCalloutKind ?? item.calloutKind ?? item.calloutDraft?.calloutKind ?? "quick_fact"}
                onChange={(event) => onCalloutKindChange?.(event.currentTarget.value as EditorialCalloutKind)}
                disabled={preparing || !onCalloutKindChange}
                className="editorial-review-callout-kind-select"
              >
                {getEditorialCalloutKindOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <p className="editorial-review-detail-copy editorial-review-callout-kind-copy">
              Вставка піде як <strong>врізка: {getEditorialCalloutKindLabel(activeCalloutKind ?? item.calloutKind ?? "quick_fact")}</strong>.
            </p>
          </div>
        ) : null}

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
            Скасувати
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
              <p className="mono-ui editorial-review-detail-label editorial-review-callout-kind-chip">
                Врізка: {getEditorialCalloutKindLabel(isActiveProposal.calloutDraft.calloutKind)}
              </p>
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
              <div className="editorial-review-image-prompt-head">
                <p className="mono-ui editorial-review-detail-label">Промпт</p>
                <button
                  type="button"
                  className="editorial-review-image-prompt-toggle"
                  onClick={() => setIsImagePromptExpanded((current) => !current)}
                  aria-label={isImagePromptExpanded ? "Згорнути промпт" : "Редагувати промпт"}
                  aria-expanded={isImagePromptExpanded ? "true" : "false"}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    {isImagePromptExpanded ? (
                      <path d="M4 10.2 8 6.2l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    ) : (
                      <>
                        <path d="M3 11.8V13h1.2l6.5-6.5-1.2-1.2L3 11.8Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                        <path d="m9.8 4.9 1.2 1.2.8-.8a.85.85 0 0 0 0-1.2l-.1-.1a.85.85 0 0 0-1.2 0l-.7.9Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
              {isImagePromptExpanded ? (
                <textarea
                  className="editorial-review-image-prompt-input"
                  value={activeImagePrompt}
                  onChange={(event) => onImagePromptChange?.(event.currentTarget.value)}
                  rows={5}
                />
              ) : null}
              <p className="editorial-review-detail-copy">
                <strong>Alt:</strong> {isActiveProposal.imageDraft.alt}
              </p>
              {isActiveProposal.imageDraft.caption ? <p className="editorial-review-detail-copy">{isActiveProposal.imageDraft.caption}</p> : null}
              <div className="button-row editorial-review-proposal-actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onGenerateImage}
                  loading={imageGenerating}
                  loadingLabel={imageJobStatus === "queued" ? "У черзі…" : "Генерую…"}
                  disabled={isImageJobInProgress || !activeImagePrompt.trim()}
                >
                  Згенерувати
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onInsertImage}
                  disabled={!generatedImageUrl || imageInserting || isImageJobInProgress}
                  loading={imageInserting}
                  loadingLabel="Вставляю…"
                >
                  Вставити зображення
                </Button>
              </div>
              {imageJobStatusCopy ? <p className="mono-ui editorial-review-image-status">{imageJobStatusCopy}</p> : null}
              {showImageJobError ? <p className="mono-ui editorial-review-image-status editorial-review-image-status-error">{imageJobError}</p> : null}
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
