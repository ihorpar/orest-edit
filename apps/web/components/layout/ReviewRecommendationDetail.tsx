"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type {
  EditorialCalloutDepth,
  EditorialCalloutKind,
  EditorialReviewItem,
  EditorialVisualIntent,
  ReviewActionProposal,
  VisualStylePreset
} from "../../lib/editor/review-contract";
import {
  getEditorialCalloutKindDescription,
  getEditorialCalloutDepthDescription,
  getEditorialCalloutDepthLabel,
  getEditorialCalloutDepthOptions,
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
import { ArrowDownToLine, Expand, RefreshCcw, Sparkles, X } from "lucide-react";

export function ReviewRecommendationDetail({
  item,
  revision,
  proposal,
  layout = "rail",
  isPreparing,
  reviewImageLoading,
  onPrepare,
  refineInstruction,
  onRefineInstructionChange,
  onApplyCallout,
  onApplySubsection,
  onDismiss,
  onUpdateActiveCalloutKind,
  onUpdateActiveCalloutDepth,
  onUpdateActiveCalloutTitle,
  onUpdateActiveCalloutBody,
  onUpdateActiveSubsectionTitle,
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
  onPrepare: (
    item: EditorialReviewItem,
    options?: { visualStylePreset?: VisualStylePreset; editorialInstruction?: string }
  ) => void;
  refineInstruction: string;
  onRefineInstructionChange: (value: string) => void;
  onApplyCallout: (item: EditorialReviewItem) => void;
  onApplySubsection: (item: EditorialReviewItem) => void;
  onDismiss: (item: EditorialReviewItem) => void;
  onUpdateActiveCalloutKind: (item: EditorialReviewItem, kind: EditorialCalloutKind) => void;
  onUpdateActiveCalloutDepth: (item: EditorialReviewItem, depth: EditorialCalloutDepth) => void;
  onUpdateActiveCalloutTitle: (item: EditorialReviewItem, title: string) => void;
  onUpdateActiveCalloutBody: (item: EditorialReviewItem, body: string) => void;
  onUpdateActiveSubsectionTitle: (item: EditorialReviewItem, title: string) => void;
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

  const currentItem = item;
  const calloutDraft = proposal?.kind === "callout_prompt" && proposal.calloutDraft ? proposal.calloutDraft : currentItem.calloutDraft;
  const subsectionDraft = proposal?.kind === "subsection_prompt" && proposal.subsectionDraft ? proposal.subsectionDraft : currentItem.subsectionDraft;
  const imageDraft = proposal?.kind === "image_prompt" ? proposal.imageDraft : null;
  const activeCalloutKind = calloutDraft?.calloutKind ?? currentItem.calloutKind ?? "mechanism";
  const activeCalloutDepth = calloutDraft?.calloutDepth ?? currentItem.calloutDepth ?? "brief";
  const canInsertCallout = Boolean(calloutDraft?.previewText?.trim());
  const canInsertSubsection = Boolean(subsectionDraft?.title?.trim());
  const rangeLabel = revision ? getReviewParagraphRangeLabel(currentItem, revision) : null;
  const insertionCopy = revision ? getInsertionContextCopy(currentItem, revision) : null;
  const visualStyleOptions = getVisualStylePresetOptions();
  const visualIntentOptions = getEditorialVisualIntentOptions();
  const selectedVisualStylePreset = normalizeVisualStylePreset(activeVisualStylePreset ?? imageDraft?.visualStylePreset);
  const selectedVisualIntent = imageDraft?.visualIntent ?? currentItem.visualIntent ?? "infographic";
  const hasGeneratedAsset = Boolean(imageDraft?.generatedAsset);
  const [isRefineOpen, setIsRefineOpen] = useState(false);
  const [isVisualWorkspaceOpen, setIsVisualWorkspaceOpen] = useState(false);
  const refineTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const visualWorkspacePromptRef = useRef<HTMLTextAreaElement | null>(null);
  const normalizedRefineInstruction = refineInstruction.trim();
  const hasPendingRefineInstruction = normalizedRefineInstruction.length > 0;
  const pendingRefineTitle = hasPendingRefineInstruction ? "Спершу перегенеруйте варіант або очистіть уточнення." : undefined;
  const canPrepareFromCard = currentItem.status === "pending" || currentItem.status === "dismissed";
  const prepareButtonLabel = currentItem.status === "dismissed" ? "Підготувати знову" : "Підготувати";
  const textDiffRegenerateLabel = hasPendingRefineInstruction ? "Перегенерувати з уточненням" : "Перегенерувати";

  const calloutInsertDisabledReason = !canInsertCallout
    ? "Спочатку підготуйте чернетку врізки."
    : pendingRefineTitle;
  const subsectionInsertDisabledReason = !canInsertSubsection
    ? "Спочатку додайте підзаголовок."
    : pendingRefineTitle;
  const imageGenerateDisabledReason = hasPendingRefineInstruction ? pendingRefineTitle : undefined;
  const imageApplyDisabledReason = !hasGeneratedAsset
    ? "Спочатку згенеруйте зображення."
    : pendingRefineTitle;

  useEffect(() => {
    if (isRefineOpen) {
      refineTextareaRef.current?.focus();
    }
  }, [isRefineOpen]);

  useEffect(() => {
    if (!isVisualWorkspaceOpen) {
      return;
    }

    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    visualWorkspacePromptRef.current?.focus();

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsVisualWorkspaceOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isVisualWorkspaceOpen]);

  function handlePrepare(nextOptions?: { visualStylePreset?: VisualStylePreset }) {
    onPrepare(currentItem, {
      ...nextOptions,
      editorialInstruction: normalizedRefineInstruction || undefined
    });
  }

  function handleRefineKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handlePrepare();
    }
  }

  return (
    <>
      <article className="editorial-review-detail" data-layout={layout} data-type={currentItem.recommendationType}>
        <div className="editorial-review-detail-head">
          <div>
            <p className="editorial-review-detail-label">
              {rangeLabel
                ? `${rangeLabel} • ${getEditorialRecommendationTypeLabel(currentItem.recommendationType)}`
                : getEditorialRecommendationTypeLabel(currentItem.recommendationType)}
            </p>
            <h3 className="editorial-review-detail-title">{currentItem.title}</h3>
          </div>
          <button type="button" className="editorial-review-detail-close" onClick={() => onDismiss(currentItem)} aria-label="Відхилити рекомендацію" title="Відхилити рекомендацію">
            <X className="editorial-review-detail-close-icon" aria-hidden="true" />
          </button>
        </div>

      {currentItem.recommendation.trim() && currentItem.recommendation.trim() !== currentItem.title.trim() ? (
        <div className="editorial-review-detail-recommendation">
          <p className="editorial-review-detail-label">Рекомендація</p>
          <p className="editorial-review-detail-explanation-copy">{currentItem.recommendation}</p>
        </div>
      ) : null}

      {currentItem.status === "ready" || proposal != null ? (
        <div className="editorial-review-refine">
          {isRefineOpen ? (
            <div className="editorial-review-field-group">
              <p className="editorial-review-detail-label">Що змінити в рекомендації</p>
              <textarea
                ref={refineTextareaRef}
                className="editorial-review-callout-body-input editorial-review-refine-input"
                value={refineInstruction}
                placeholder="Наприклад: спростити тон, зберегти локальність правки, переписати коротше"
                onChange={(event) => onRefineInstructionChange(event.target.value)}
                onKeyDown={handleRefineKeyDown}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {isPreparing ? (
        <div className="editorial-review-proposal">
          <p className="editorial-review-image-status">ШІ готує цю рекомендацію…</p>
        </div>
      ) : null}

      {!isPreparing && canPrepareFromCard && currentItem.recommendationType !== "callout" && currentItem.recommendationType !== "subsection" && currentItem.recommendationType !== "visual" ? (
        <div className="editorial-review-detail-actions">
          <Button size="sm" variant="primary" onClick={() => onPrepare(currentItem)}>
            {prepareButtonLabel}
          </Button>
        </div>
      ) : null}

      {!isPreparing && canPrepareFromCard && currentItem.recommendationType === "visual" ? (
        <div className="editorial-review-proposal">
          <div className="editorial-review-callout-kind-row">
            <p className="editorial-review-detail-label">Тип візуалу</p>
            <VisualIntentToggle
              value={selectedVisualIntent}
              options={visualIntentOptions}
              onChange={(nextIntent) => onUpdateActiveVisualIntent(currentItem, nextIntent)}
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
              onClick={() => onPrepare(currentItem, { visualStylePreset: selectedVisualStylePreset })}
            >
              {prepareButtonLabel}
            </Button>
          </div>
        </div>
      ) : null}

      {!isPreparing && proposal?.kind === "text_diff" ? (
        <div className="editorial-review-proposal">
          {proposal.textDiff?.warning ? (
            <div className="editorial-review-proposal-block editorial-review-proposal-warning">
              <p className="editorial-review-proposal-summary">{proposal.textDiff.warning.message}</p>
            </div>
          ) : null}
          <div className="editorial-review-detail-actions editorial-review-proposal-actions">
            <Button size="sm" variant="secondary" aria-pressed={isRefineOpen} onClick={() => setIsRefineOpen((current) => !current)}>
              Уточнити
            </Button>
            <Button
              size="sm"
              variant={hasPendingRefineInstruction ? "primary" : "secondary"}
              onClick={() => handlePrepare()}
              title={hasPendingRefineInstruction ? "Уточнення буде використано під час перегенерації." : "Перегенерувати поточний варіант."}
            >
              {textDiffRegenerateLabel}
            </Button>
          </div>
        </div>
      ) : null}

      {!isPreparing && currentItem.recommendationType === "callout" ? (
        <div className="editorial-review-proposal">
          <div className="editorial-review-callout-kind-row">
            <p className="editorial-review-detail-label">Тип врізки</p>
            <select
              className="editorial-review-callout-kind-select"
              value={activeCalloutKind}
              onChange={(event) => onUpdateActiveCalloutKind(currentItem, event.target.value as EditorialCalloutKind)}
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
          <div className="editorial-review-callout-kind-row">
            <p className="editorial-review-detail-label">Глибина врізки</p>
            <select
              className="editorial-review-callout-kind-select"
              value={activeCalloutDepth}
              onChange={(event) => onUpdateActiveCalloutDepth(currentItem, event.target.value as EditorialCalloutDepth)}
            >
              {getEditorialCalloutDepthOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="editorial-review-callout-kind-copy">
              <strong className="editorial-review-callout-kind-chip">{getEditorialCalloutDepthLabel(activeCalloutDepth)}</strong>
              {" "}
              {getEditorialCalloutDepthDescription(activeCalloutDepth)}
            </p>
          </div>
          <div className="editorial-review-field-group">
            <p className="editorial-review-detail-label">Заголовок</p>
            <input
              className="editorial-review-callout-title-input"
              value={calloutDraft?.title ?? ""}
              onChange={(event) => onUpdateActiveCalloutTitle(currentItem, event.target.value)}
            />
            <p className="editorial-review-detail-label">Чернетка</p>
            <textarea
              className="editorial-review-callout-body-input"
              value={calloutDraft?.previewText ?? ""}
              onChange={(event) => onUpdateActiveCalloutBody(currentItem, event.target.value)}
            />
          </div>
          {insertionCopy ? <p className="editorial-review-insertion-note">{insertionCopy}</p> : null}
          <div className="editorial-review-detail-actions editorial-review-proposal-actions">
            <Button size="sm" variant="secondary" aria-pressed={isRefineOpen} onClick={() => setIsRefineOpen((current) => !current)}>
              Уточнити
            </Button>
            <Button
              size="sm"
              variant={hasPendingRefineInstruction ? "primary" : "secondary"}
              onClick={() => handlePrepare()}
              title={hasPendingRefineInstruction ? "Уточнення буде використано під час перегенерації." : undefined}
            >
              {hasPendingRefineInstruction ? "Перегенерувати з уточненням" : calloutDraft ? "Перегенерувати" : "Згенерувати"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onApplyCallout(currentItem)}
              disabled={!canInsertCallout || hasPendingRefineInstruction}
              disabledReason={calloutInsertDisabledReason}
              title={!canInsertCallout ? undefined : pendingRefineTitle}
            >
              Вставити
            </Button>
          </div>
        </div>
      ) : null}

      {!isPreparing && currentItem.recommendationType === "subsection" ? (
        <div className="editorial-review-proposal">
          <div className="editorial-review-field-group">
            <p className="editorial-review-detail-label">Підзаголовок</p>
            <input
              className="editorial-review-callout-title-input"
              value={subsectionDraft?.title ?? ""}
              onChange={(event) => onUpdateActiveSubsectionTitle(currentItem, event.target.value)}
            />
          </div>
          {insertionCopy ? <p className="editorial-review-insertion-note">{insertionCopy}</p> : null}
          <div className="editorial-review-detail-actions editorial-review-proposal-actions">
            <Button size="sm" variant="secondary" aria-pressed={isRefineOpen} onClick={() => setIsRefineOpen((current) => !current)}>
              Уточнити
            </Button>
            <Button
              size="sm"
              variant={hasPendingRefineInstruction ? "primary" : "secondary"}
              onClick={() => handlePrepare()}
              title={hasPendingRefineInstruction ? "Уточнення буде використано під час перегенерації." : undefined}
            >
              {hasPendingRefineInstruction ? "Перегенерувати з уточненням" : subsectionDraft ? "Перегенерувати" : "Згенерувати"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onApplySubsection(currentItem)}
              disabled={!canInsertSubsection || hasPendingRefineInstruction}
              disabledReason={subsectionInsertDisabledReason}
              title={!canInsertSubsection ? undefined : pendingRefineTitle}
            >
              Вставити
            </Button>
          </div>
        </div>
      ) : null}

      {!isPreparing && imageDraft ? (
        <div className="editorial-review-proposal">
          <div className="editorial-review-image-prompt-head">
            <p className="editorial-review-detail-label">Опис для візуалу</p>
            <button
              type="button"
              className="editorial-review-focus-button"
              onClick={() => setIsVisualWorkspaceOpen(true)}
              aria-label="Відкрити фокусний режим для візуалу"
              title="Відкрити фокусний режим"
            >
              <Expand size={16} aria-hidden="true" />
            </button>
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
              onChange={(nextIntent) => onUpdateActiveVisualIntent(currentItem, nextIntent)}
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
            <Button size="sm" variant="secondary" aria-pressed={isRefineOpen} onClick={() => setIsRefineOpen((current) => !current)}>
              Уточнити
            </Button>
            <Button
              size="sm"
              variant={hasPendingRefineInstruction ? "primary" : "secondary"}
              onClick={() => handlePrepare({ visualStylePreset: selectedVisualStylePreset })}
              title={hasPendingRefineInstruction ? "Уточнення буде використано під час перегенерації." : "Перегенерувати prompt для візуалу."}
            >
              {hasPendingRefineInstruction ? "Перегенерувати з уточненням" : "Перегенерувати"}
            </Button>
            <Button
              size="sm"
              variant={hasGeneratedAsset ? "secondary" : "primary"}
              onClick={onGenerateActiveReviewImage}
              loading={reviewImageLoading}
              disabled={hasPendingRefineInstruction}
              disabledReason={imageGenerateDisabledReason}
              title={pendingRefineTitle}
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
              disabled={!hasGeneratedAsset || hasPendingRefineInstruction}
              disabledReason={imageApplyDisabledReason}
              title={!hasGeneratedAsset ? undefined : pendingRefineTitle}
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
      {imageDraft && isVisualWorkspaceOpen ? (
        <div
          className="visual-workspace-backdrop"
          role="presentation"
          onClick={() => setIsVisualWorkspaceOpen(false)}
        >
          <section
            className="visual-workspace-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Фокусний режим візуалу"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="visual-workspace-head">
              <div className="visual-workspace-head-copy">
                <p className="mono-ui visual-workspace-kicker">Фокусний режим</p>
                <h3 className="visual-workspace-title">Візуал: опис і результат</h3>
              </div>
              <button
                type="button"
                className="visual-workspace-close"
                aria-label="Закрити фокусний режим"
                title="Закрити"
                onClick={() => setIsVisualWorkspaceOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="visual-workspace-grid">
              <section className="visual-workspace-panel visual-workspace-panel-form">
                <div className="visual-workspace-panel-head">
                  <p className="mono-ui visual-workspace-panel-title">Опис</p>
                </div>
                <textarea
                  ref={visualWorkspacePromptRef}
                  className="visual-workspace-prompt"
                  value={imageDraft.prompt}
                  onChange={(event) => onUpdateActiveImagePrompt(event.target.value)}
                />
                <div className="visual-workspace-controls">
                  <div className="visual-workspace-field">
                    <p className="editorial-review-detail-label">Тип візуалу</p>
                    <VisualIntentToggle
                      value={selectedVisualIntent}
                      options={visualIntentOptions}
                      onChange={(nextIntent) => onUpdateActiveVisualIntent(currentItem, nextIntent)}
                    />
                  </div>
                  <div className="visual-workspace-field">
                    <p className="editorial-review-detail-label">Стиль візуалу</p>
                    <VisualStyleToggle
                      value={selectedVisualStylePreset}
                      options={visualStyleOptions}
                      onChange={(nextPreset) => onUpdateActiveVisualStylePreset(nextPreset)}
                    />
                  </div>
                  <div className="visual-workspace-field">
                    <p className="editorial-review-detail-label">Підпис</p>
                    <input
                      className="editorial-review-callout-title-input"
                      value={imageDraft.caption ?? ""}
                      onChange={(event) => onUpdateActiveImageCaption(event.target.value)}
                    />
                  </div>
                </div>
                <div className="visual-workspace-actions">
                  <Button
                    size="sm"
                    variant={hasPendingRefineInstruction ? "primary" : "secondary"}
                    onClick={() => handlePrepare({ visualStylePreset: selectedVisualStylePreset })}
                    title={hasPendingRefineInstruction ? "Уточнення буде використано під час перегенерації." : "Перегенерувати опис для візуалу."}
                  >
                    {hasPendingRefineInstruction ? "Перегенерувати з уточненням" : "Перегенерувати опис"}
                  </Button>
                  <Button
                    size="sm"
                    variant={hasGeneratedAsset ? "secondary" : "primary"}
                    onClick={onGenerateActiveReviewImage}
                    loading={reviewImageLoading}
                    disabled={hasPendingRefineInstruction}
                    disabledReason={imageGenerateDisabledReason}
                    title={pendingRefineTitle}
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
                    disabled={!hasGeneratedAsset || hasPendingRefineInstruction}
                    disabledReason={imageApplyDisabledReason}
                    title={!hasGeneratedAsset ? undefined : pendingRefineTitle}
                  >
                    <span className="button-content">
                      <ArrowDownToLine className="editorial-review-button-icon" aria-hidden="true" />
                      <span>Вставити в документ</span>
                    </span>
                  </Button>
                </div>
              </section>

              <section className="visual-workspace-panel visual-workspace-panel-preview">
                <div className="visual-workspace-panel-head">
                  <p className="mono-ui visual-workspace-panel-title">Результат</p>
                  <p className="visual-workspace-status">
                    {hasGeneratedAsset ? "Згенеровано за поточним описом." : "Ще не згенеровано."}
                  </p>
                </div>
                {hasGeneratedAsset && imageUrl ? (
                  <div className="visual-workspace-preview-frame">
                    <img src={imageUrl} alt={imageDraft.alt} className="visual-workspace-preview-image" />
                  </div>
                ) : (
                  <div className="visual-workspace-preview-empty">
                    <p>Підготуйте або відредагуйте опис і запустіть генерацію.</p>
                  </div>
                )}
                <div className="visual-workspace-meta">
                  <div className="visual-workspace-meta-row">
                    <span className="mono-ui visual-workspace-meta-label">Alt-текст</span>
                    <span className="visual-workspace-meta-value">{imageDraft.alt}</span>
                  </div>
                  {imageDraft.caption ? (
                    <div className="visual-workspace-meta-row">
                      <span className="mono-ui visual-workspace-meta-label">Підпис</span>
                      <span className="visual-workspace-meta-value">{imageDraft.caption}</span>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </>
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
