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
  const activeImageDraft = isActiveProposal?.kind === "image_prompt" ? isActiveProposal.imageDraft : undefined;
  const activeImagePrompt = activeImageDraft?.prompt ?? "";
  const normalizedAlt = normalizeInlineText(isActiveProposal?.kind === "image_prompt" ? isActiveProposal.imageDraft?.alt : "");
  const normalizedCaption = normalizeInlineText(isActiveProposal?.kind === "image_prompt" ? isActiveProposal.imageDraft?.caption : "");
  const showCaption = Boolean(normalizedCaption && normalizedCaption !== normalizedAlt);
  const textApplyLabel = item.recommendationType === "list" ? "Застосувати список" : "Застосувати текст";
  const actionButtonStyle = { textTransform: "none", letterSpacing: "0.02em" } as const;

  return (
    <aside className="editorial-review-detail" data-type={item.recommendationType} data-priority={item.priority}>
      <div className="editorial-review-detail-head">
        <div className="editorial-review-detail-meta">
          <span className="tag-pill tag-type">{typeLabels[item.recommendationType]}</span>
          <span className={`tag-pill tag-severity-${item.priority}`}>{priorityLabels[item.priority]}</span>
          <span className="tag-lines">
            Абзаци {getReviewParagraphLabel(item, revision)}
          </span>
        </div>
        <button type="button" className="editorial-review-detail-close" onClick={onClose} aria-label="Закрити">
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

      </div>

      <div className="editorial-review-detail-actions">
        <Button
          variant="primary"
          size="sm"
          onClick={canApplyPrefilledCallout ? onApplyCallout : onPrepare}
          loading={canApplyPrefilledCallout || hasCalloutDraftError ? false : preparing}
          loadingLabel="Готую чернетку…"
          disabled={hasCalloutDraftError}
          style={actionButtonStyle}
        >
          {canApplyPrefilledCallout ? "Вставити врізку" : hasCalloutDraftError ? "Помилка врізки" : "Працюй!"}
        </Button>
        {isActiveProposal && !canApplyPrefilledCallout ? (
          <Button variant="secondary" size="sm" onClick={onDiscardProposal} style={actionButtonStyle}>
            Скасувати
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onClose} style={actionButtonStyle}>
          Закрити
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
                <Button variant="primary" size="sm" onClick={onApplyText} style={actionButtonStyle}>
                  {textApplyLabel}
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
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onApplyCallout}
                  disabled={!isActiveProposal.calloutDraft.previewText}
                  style={actionButtonStyle}
                >
                  Вставити врізку
                </Button>
              </div>
            </div>
          ) : null}

          {isActiveProposal.kind === "image_prompt" && isActiveProposal.imageDraft ? (
            <div className="editorial-review-proposal-block">
              <div className="editorial-review-image-prompt-head">
                <p className="mono-ui editorial-review-detail-label">Промпт</p>
              </div>
              <textarea
                className="editorial-review-image-prompt-input"
                value={activeImagePrompt}
                onChange={(event) => onImagePromptChange?.(event.currentTarget.value)}
                rows={6}
                readOnly={!onImagePromptChange}
              />
              <p className="editorial-review-detail-copy">
                <strong>Alt:</strong> {isActiveProposal.imageDraft.alt}
              </p>
              {showCaption ? (
                <p className="editorial-review-detail-copy">
                  <strong>Підпис:</strong> {isActiveProposal.imageDraft.caption}
                </p>
              ) : null}
              <div className="button-row editorial-review-proposal-actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onGenerateImage}
                  loading={imageGenerating}
                  loadingLabel={imageJobStatus === "queued" ? "У черзі…" : "Генерую…"}
                  disabled={isImageJobInProgress || !activeImagePrompt.trim()}
                  style={actionButtonStyle}
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
                  style={actionButtonStyle}
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

function normalizeInlineText(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}
