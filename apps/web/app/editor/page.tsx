"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { EditorCanvas, type AppliedDiffMarker } from "../../components/editor/EditorCanvas";
import { FloatingPromptPanel } from "../../components/editor/FloatingPromptPanel";
import { RightOperationsRail, type RequestHistoryItem } from "../../components/layout/RightOperationsRail";
import { ThreePaneShell } from "../../components/layout/ThreePaneShell";
import { TopBar } from "../../components/layout/TopBar";
import { DEFAULT_MANUSCRIPT_TEXT } from "../../lib/editor/default-manuscript";
import {
  clearEditorDraftState,
  readEditorDraftState,
  writeEditorDraftState,
  type PersistedEditorDraftState
} from "../../lib/editor/draft-state";
import {
  deriveManuscriptRevisionState,
  resolveReviewItemSelection,
  type ManuscriptRevisionState
} from "../../lib/editor/manuscript-structure";
import {
  applyPatchOperation,
  applyPatchOperations,
  clampSelection,
  createPatchId,
  getApplicablePatchOperations,
  getOperationReplacementText,
  hasSelection,
  rebasePendingOperations,
  type PatchOperation,
  type PatchRequest,
  type PatchResponse,
  type PatchResponseDiagnostics,
  type PatchSelection,
  type RequestMode
} from "../../lib/editor/patch-contract";
import { insertMarkdownImageBlock } from "../../lib/editor/markdown-editor";
import {
  reconcileReviewItemsWithRevision,
  resolveReviewImageAssetUrl,
  type EditorialReviewDiagnostics,
  type EditorialReviewItem,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  type GeneratedReviewImageAsset,
  type ReviewActionProposal,
  type ReviewActionResponse,
  type ReviewImageGenerationResponse,
  type WholeTextChangeLevel
} from "../../lib/editor/review-contract";
import { DEFAULT_EDITOR_SETTINGS, normalizeModelId, readEditorSettings, type EditorSettings } from "../../lib/editor/settings";
import { storeEditorAssetFromBlob, storeEditorAssetFromDataUrl } from "../../lib/editor/asset-store";
import { insertReviewImageMarkdown } from "../../lib/editor/review-image-insertion";

interface RequestFeedback {
  message: string;
  tone: "info" | "error";
}

const historyTimeFormatter = new Intl.DateTimeFormat("uk-UA", {
  hour: "2-digit",
  minute: "2-digit"
});

const defaultReviewComposer = {
  changeLevel: 3 as WholeTextChangeLevel,
  additionalInstructions: ""
};

export default function EditorPage() {
  const [text, setText] = useState(DEFAULT_MANUSCRIPT_TEXT);
  const [revision, setRevision] = useState<ManuscriptRevisionState>(() => deriveManuscriptRevisionState(DEFAULT_MANUSCRIPT_TEXT));
  const [selection, setSelection] = useState<PatchSelection>({ start: 0, end: 0 });
  const [operations, setOperations] = useState<PatchOperation[]>([]);
  const [reviewItems, setReviewItems] = useState<EditorialReviewItem[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [isPatchRequestInFlight, setIsPatchRequestInFlight] = useState(false);
  const [isReviewRequestInFlight, setIsReviewRequestInFlight] = useState(false);
  const [isReviewProposalInFlight, setIsReviewProposalInFlight] = useState(false);
  const [isReviewImageInFlight, setIsReviewImageInFlight] = useState(false);
  const [feedback, setFeedback] = useState<RequestFeedback | null>(null);
  const [patchDiagnostics, setPatchDiagnostics] = useState<PatchResponseDiagnostics | null>(null);
  const [reviewDiagnostics, setReviewDiagnostics] = useState<EditorialReviewDiagnostics | null>(null);
  const [history, setHistory] = useState<RequestHistoryItem[]>([]);
  const [appliedDiffs, setAppliedDiffs] = useState<AppliedDiffMarker[]>([]);
  const [activeReviewItem, setActiveReviewItem] = useState<EditorialReviewItem | null>(null);
  const [activeProposal, setActiveProposal] = useState<ReviewActionProposal | null>(null);
  const [reviewImageAssets, setReviewImageAssets] = useState<Record<string, GeneratedReviewImageAsset>>({});
  const [isReviewImageInsertionInFlight, setIsReviewImageInsertionInFlight] = useState(false);
  const [selectionRevealKey, setSelectionRevealKey] = useState(0);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [suppressFloatingPrompt, setSuppressFloatingPrompt] = useState(false);
  const [isReviewComposerOpen, setIsReviewComposerOpen] = useState(false);
  const [reviewComposer, setReviewComposer] = useState(defaultReviewComposer);
  const imageInsertionGuardRef = useRef<string | null>(null);

  useEffect(() => {
    setSettings(readEditorSettings());
    const draft = readEditorDraftState();

    if (draft) {
      const nextText = draft.text;
      const nextRevision =
        draft.revision && typeof draft.revision === "object" && typeof draft.revision.documentRevisionId === "string"
          ? draft.revision
          : deriveManuscriptRevisionState(nextText);

      setText(nextText);
      setRevision(nextRevision);
      setSelection(clampSelection(nextText, draft.selection?.start ?? 0, draft.selection?.end ?? 0));
      setOperations(Array.isArray(draft.operations) ? draft.operations : []);
      setReviewItems(Array.isArray(draft.reviewItems) ? draft.reviewItems : []);
      setPatchDiagnostics(draft.patchDiagnostics ?? null);
      setReviewDiagnostics(draft.reviewDiagnostics ?? null);
      setHistory(Array.isArray(draft.history) ? draft.history : []);
      setAppliedDiffs(Array.isArray(draft.appliedDiffs) ? draft.appliedDiffs : []);
      setFeedback(draft.feedback ?? null);
      setActiveProposal(draft.activeProposal ?? null);
      setReviewImageAssets(draft.reviewImageAssets && typeof draft.reviewImageAssets === "object" ? draft.reviewImageAssets : {});
      setReviewComposer(draft.reviewComposer ?? defaultReviewComposer);
      setActiveReviewItem((Array.isArray(draft.reviewItems) ? draft.reviewItems : []).find((item) => item.id === draft.activeReviewItemId) ?? null);
    }

    setHasHydratedDraft(true);
  }, []);

  const hasActiveSelection = hasSelection(selection);
  const isAnyRequestInFlight =
    isPatchRequestInFlight || isReviewRequestInFlight || isReviewProposalInFlight || isReviewImageInFlight || isReviewImageInsertionInFlight;
  const hasRailDetailContent =
    isAnyRequestInFlight ||
    operations.length > 0 ||
    reviewItems.length > 0 ||
    patchDiagnostics !== null ||
    reviewDiagnostics !== null ||
    history.length > 0 ||
    feedback?.tone === "error";
  const canClearDraft =
    text !== DEFAULT_MANUSCRIPT_TEXT ||
    hasSelection(selection) ||
    operations.length > 0 ||
    reviewItems.length > 0 ||
    appliedDiffs.length > 0 ||
    activeReviewItem !== null ||
    activeProposal !== null ||
    patchDiagnostics !== null ||
    reviewDiagnostics !== null ||
    history.length > 0 ||
    feedback !== null;

  useEffect(() => {
    if (!hasHydratedDraft) {
      return;
    }

    const draftState: PersistedEditorDraftState = {
      text,
      revision,
      selection,
      operations,
      reviewItems,
      patchDiagnostics,
      reviewDiagnostics,
      history,
      appliedDiffs,
      feedback,
      activeReviewItemId: activeReviewItem?.id ?? null,
      activeProposal,
      reviewImageAssets,
      reviewComposer
    };

    writeEditorDraftState(draftState);
  }, [
    activeProposal,
    activeReviewItem,
    appliedDiffs,
    feedback,
    hasHydratedDraft,
    history,
    operations,
    patchDiagnostics,
    reviewComposer,
    reviewDiagnostics,
    reviewImageAssets,
    reviewItems,
    revision,
    selection,
    text
  ]);

  async function requestPatches(mode: RequestMode, prompt?: string, requestedSelection?: PatchSelection) {
    const effectiveSelection = requestedSelection ?? selection;

    if (!hasSelection(effectiveSelection)) {
      setFeedback({ message: "Спершу виділіть фрагмент у Редакторі.", tone: "error" });
      return;
    }

    const requestBody: PatchRequest = {
      text,
      selectionStart: effectiveSelection.start,
      selectionEnd: effectiveSelection.end,
      mode,
      prompt,
      provider: settings.provider,
      modelId: normalizeModelId(settings.provider, settings.modelId),
      apiKey: settings.apiKey || undefined,
      basePrompt: settings.basePrompt
    };

    setIsPatchRequestInFlight(true);
    setFeedback(null);
    setAppliedDiffs([]);
    setPatchDiagnostics(null);

    try {
      const response = await fetch("/api/edit/patch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      const payload = (await response.json()) as PatchResponse;
      const nextFeedback = buildFeedbackMessage(payload, response.ok);

      startTransition(() => {
        setSelection(effectiveSelection);
        setOperations(response.ok ? payload.operations : []);
        setFeedback(nextFeedback);
        setPatchDiagnostics(payload.diagnostics);
        setHistory((current) => [createPatchHistoryEntry(payload, nextFeedback), ...current].slice(0, 8));
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Сталася помилка під час запиту до провайдера.",
        tone: "error"
      });
      setOperations([]);
    } finally {
      setIsPatchRequestInFlight(false);
    }
  }

  async function requestEditorialReview() {
    const requestBody: EditorialReviewRequest = {
      text,
      revision,
      provider: settings.provider,
      modelId: normalizeModelId(settings.provider, settings.modelId),
      apiKey: settings.apiKey || undefined,
      basePrompt: settings.basePrompt,
      reviewPrompt: settings.reviewPrompt,
      reviewLevelGuide: settings.reviewLevelGuide,
      calloutPromptTemplate: settings.calloutPromptTemplate,
      changeLevel: reviewComposer.changeLevel,
      additionalInstructions: reviewComposer.additionalInstructions.trim() || undefined
    };

    setIsReviewRequestInFlight(true);
    setFeedback(null);
    setActiveReviewItem(null);
    setActiveProposal(null);
    setReviewDiagnostics(null);

    try {
      const response = await fetch("/api/edit/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      const payload = (await response.json()) as EditorialReviewResponse;
      const nextFeedback = buildReviewFeedbackMessage(payload, response.ok);

      startTransition(() => {
        setReviewItems(response.ok ? payload.items : []);
        setFeedback(nextFeedback);
        setReviewDiagnostics(payload.diagnostics);
        setHistory((current) => [createReviewHistoryEntry(payload, nextFeedback), ...current].slice(0, 8));
        setIsReviewComposerOpen(false);
        setSuppressFloatingPrompt(false);
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Сталася помилка під час редакторського review.",
        tone: "error"
      });
      setReviewItems([]);
    } finally {
      setIsReviewRequestInFlight(false);
    }
  }

  async function requestReviewProposal(item: EditorialReviewItem) {
    const inlineCalloutProposal = createInlineCalloutProposal(item, revision);

    const nextSelection = resolveReviewItemSelection(text, revision, item);

    startTransition(() => {
      setAppliedDiffs([]);
      setActiveReviewItem(item);
      setSelection(clampSelection(text, nextSelection.start, nextSelection.end));
      setSelectionRevealKey((current) => current + 1);
      setSuppressFloatingPrompt(true);
      setReviewItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: inlineCalloutProposal ? "ready" : "preparing"
              }
            : entry
        )
      );
    });

    if (inlineCalloutProposal) {
      setIsReviewImageInsertionInFlight(false);
      imageInsertionGuardRef.current = null;
      setActiveProposal(inlineCalloutProposal);
      setFeedback({ message: "Врізка вже підготовлена. Можна одразу вставляти.", tone: "info" });
      return;
    }

    setIsReviewProposalInFlight(true);
    setIsReviewImageInsertionInFlight(false);
    imageInsertionGuardRef.current = null;
    setFeedback(null);

    try {
      const response = await fetch("/api/edit/review/proposal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          currentRevision: revision,
          item,
          provider: settings.provider,
          modelId: normalizeModelId(settings.provider, settings.modelId),
          apiKey: settings.apiKey || undefined,
          basePrompt: settings.basePrompt,
          reviewLevelGuide: settings.reviewLevelGuide,
          calloutPromptTemplate: settings.calloutPromptTemplate,
          imagePromptTemplate: settings.imagePromptTemplate
        })
      });

      const payload = (await response.json()) as ReviewActionResponse;
      const nextFeedback = buildReviewActionFeedbackMessage(payload, response.ok);

      startTransition(() => {
        setActiveProposal(payload.proposal);
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  status:
                    payload.proposal.kind === "stale_anchor" ? "stale" : payload.proposal.kind === "text_diff" || payload.proposal.kind === "callout_prompt" || payload.proposal.kind === "image_prompt" ? "ready" : entry.status
                }
              : entry
          )
        );
        setFeedback(nextFeedback);
        setHistory((current) => [createProposalHistoryEntry(payload, nextFeedback), ...current].slice(0, 8));
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Сталася помилка під час підготовки чернетки.",
        tone: "error"
      });
      setReviewItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "stale" } : entry)));
    } finally {
      setIsReviewProposalInFlight(false);
    }
  }

  async function generateReviewImageAsset() {
    if (!activeProposal?.imageDraft) {
      return;
    }

    setIsReviewImageInFlight(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/edit/review/image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: activeProposal.imageDraft.prompt,
          apiKey: settings.provider === "gemini" ? settings.apiKey || undefined : undefined
        })
      });

      const payload = (await response.json()) as ReviewImageGenerationResponse;

      if (!response.ok || !payload.asset) {
        throw new Error(payload.error ?? "Не вдалося згенерувати зображення.");
      }

      const asset = await persistGeneratedImageAsset(payload.asset);
      setReviewImageAssets((current) => ({ ...current, [asset.assetId]: asset }));
      setActiveProposal((current) =>
        current && current.kind === "image_prompt" && current.imageDraft
          ? {
              ...current,
              imageDraft: {
                ...current.imageDraft,
                generatedAsset: asset
              }
            }
          : current
      );
      const nextFeedback = {
        message: `Згенеровано чернеткове зображення через ${payload.modelId}.`,
        tone: "info" as const
      };
      setFeedback(nextFeedback);
      setHistory((current) => [createImageHistoryEntry(payload, nextFeedback, activeProposal.reviewItemId), ...current].slice(0, 8));
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Сталася помилка під час генерації зображення.",
        tone: "error"
      });
    } finally {
      setIsReviewImageInFlight(false);
    }
  }

  async function persistGeneratedImageAsset(asset: GeneratedReviewImageAsset): Promise<GeneratedReviewImageAsset> {
    const sourceUrl = resolveReviewImageAssetUrl(asset);

    if (!sourceUrl) {
      throw new Error("Не вдалося прочитати asset згенерованого зображення.");
    }

    if (asset.source.kind === "asset_token" || asset.source.kind === "remote_url") {
      return asset;
    }

    const stored = await storeEditorAssetFromDataUrl({
      dataUrl: sourceUrl,
      assetId: asset.assetId,
      mimeType: asset.mimeType
    });

    return {
      assetId: stored.assetId,
      mimeType: stored.mimeType,
      source: {
        kind: "asset_token",
        token: stored.token
      }
    };
  }

  async function handleInsertLocalImage(input: { blob: Blob; fileName?: string; source: "upload" | "paste" }) {
    try {
      const stored = await storeEditorAssetFromBlob({
        blob: input.blob,
        mimeType: input.blob.type || undefined
      });
      const alt = deriveLocalImageAlt(input.fileName);
      const result = insertMarkdownImageBlock(text, selection, {
        alt,
        source: stored.token
      });

      handleTextChange(result.text, result.selection);
      setFeedback({
        message: input.source === "paste" ? "Зображення вставлено з буфера як markdown-блок." : "Зображення вставлено з файлу як markdown-блок.",
        tone: "info"
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Не вдалося вставити локальне зображення.",
        tone: "error"
      });
    }
  }

  function handleSelectionChange(nextSelection: PatchSelection) {
    if (appliedDiffs.length > 0) {
      setAppliedDiffs([]);
    }

    setSuppressFloatingPrompt(false);
    setSelection(clampSelection(text, nextSelection.start, nextSelection.end));
  }

  function handleTextChange(nextText: string, nextSelection: PatchSelection) {
    const nextRevision = deriveManuscriptRevisionState(nextText, revision);

    setText(nextText);
    setRevision(nextRevision);
    setSelection(clampSelection(nextText, nextSelection.start, nextSelection.end));

    if (!hasSelection(nextSelection)) {
      setSuppressFloatingPrompt(false);
    }

    setAppliedDiffs([]);
    setActiveReviewItem(null);
    setActiveProposal(null);
    setReviewItems([]);
    setReviewDiagnostics(null);

    if (operations.length > 0) {
      setOperations([]);
      setFeedback({ message: "Текст змінено вручну, тому попередні локальні правки скинуто.", tone: "info" });
      return;
    }

    if (reviewItems.length > 0) {
      setFeedback({ message: "Текст змінено вручну, тому попередній whole-text review скинуто.", tone: "info" });
    }
  }

  function handleAccept(id: string) {
    const operation = operations.find((item) => item.id === id);

    if (!operation) {
      return;
    }

    if (text.slice(operation.start, operation.end) !== operation.oldText) {
      setOperations((current) => current.filter((item) => item.id !== id));
      setFeedback({ message: "Ця правка застаріла після зміни тексту і була прибрана.", tone: "error" });
      return;
    }

    const replacementText = getOperationReplacementText(operation);
    const nextCursor = operation.start + replacementText.length;
    const nextAppliedDiffs = createAppliedDiffMarkers([operation]);
    const nextText = applyPatchOperation(text, operation);
    const nextRevision = deriveManuscriptRevisionState(nextText, revision);
    const nextReviewItems = reconcileReviewItemsWithRevision(reviewItems, nextRevision);

    startTransition(() => {
      setText(nextText);
      setRevision(nextRevision);
      setOperations((current) => rebasePendingOperations(current, operation));
      setSelection({ start: nextCursor, end: nextCursor });
      setAppliedDiffs(nextAppliedDiffs);
      setActiveReviewItem(activeReviewItem ? nextReviewItems.find((item) => item.id === activeReviewItem.id) ?? null : null);
      setActiveProposal(null);
      setReviewItems(nextReviewItems);
      setSuppressFloatingPrompt(false);
      setFeedback({ message: "Правку застосовано в редакторі.", tone: "info" });
    });
  }

  function handleReject(id: string) {
    setOperations((current) => current.filter((item) => item.id !== id));
    setFeedback({ message: "Правку відхилено. Текст у Редакторі не змінено.", tone: "info" });
  }

  function handleAppliedDiffChange(id: string, newText: string) {
    const target = appliedDiffs.find((item) => item.id === id);

    if (!target) {
      return;
    }

    const nextText = text.slice(0, target.start) + newText + text.slice(target.end);
    const nextSelection = { start: target.start + newText.length, end: target.start + newText.length };
    const nextRevision = deriveManuscriptRevisionState(nextText, revision);

    setText(nextText);
    setRevision(nextRevision);
    setSelection(nextSelection);
    setAppliedDiffs((current) => rebaseAppliedDiffMarkers(current, id, newText));
    setReviewItems((current) => reconcileReviewItemsWithRevision(current, nextRevision));
  }

  function handleAcceptAll() {
    const applicable = getApplicablePatchOperations(text, operations);
    const skippedCount = operations.length - applicable.length;

    if (applicable.length === 0) {
      setOperations([]);
      setFeedback({ message: "Не залишилося безпечних правок для групового застосування.", tone: "error" });
      return;
    }

    const nextAppliedDiffs = createAppliedDiffMarkers(applicable);
    const anchor = applicable.slice().sort((left, right) => left.start - right.start)[0];
    const nextCursor = anchor.start + getOperationReplacementText(anchor).length;
    const nextText = applyPatchOperations(text, applicable);
    const nextRevision = deriveManuscriptRevisionState(nextText, revision);
    const nextReviewItems = reconcileReviewItemsWithRevision(reviewItems, nextRevision);

    startTransition(() => {
      setText(nextText);
      setRevision(nextRevision);
      setOperations([]);
      setSelection({ start: nextCursor, end: nextCursor });
      setAppliedDiffs(nextAppliedDiffs);
      setActiveReviewItem(activeReviewItem ? nextReviewItems.find((item) => item.id === activeReviewItem.id) ?? null : null);
      setActiveProposal(null);
      setReviewItems(nextReviewItems);
      setSuppressFloatingPrompt(false);
      setFeedback({
        message:
          skippedCount > 0
            ? `Застосовано ${applicable.length} правки. Ще ${skippedCount} пропущено як застарілі.`
            : `Застосовано всі ${applicable.length} локальні правки.`,
        tone: skippedCount > 0 ? "error" : "info"
      });
    });
  }

  function handleRejectAll() {
    const rejectedCount = operations.length;
    setOperations([]);
    setFeedback({ message: rejectedCount > 0 ? `Відхилено всі ${rejectedCount} локальні правки.` : "Немає активних правок для відхилення.", tone: "info" });
  }

  function handleFocusReviewItem(item: EditorialReviewItem) {
    const nextSelection = resolveReviewItemSelection(text, revision, item);

    startTransition(() => {
      setAppliedDiffs([]);
      setActiveReviewItem(item);
      setActiveProposal(null);
      setSelection(clampSelection(text, nextSelection.start, nextSelection.end));
      setSelectionRevealKey((current) => current + 1);
      setSuppressFloatingPrompt(true);
    });
  }

  function handleDismissReviewCard(item: EditorialReviewItem) {
    setReviewItems((current) => current.filter((entry) => entry.id !== item.id));

    if (activeReviewItem?.id === item.id) {
      setActiveReviewItem(null);
      setActiveProposal(null);
      setSuppressFloatingPrompt(false);
    }
  }

  function handleApplyReviewTextProposal() {
    if (!activeProposal?.textDiff) {
      return;
    }

    const nextText =
      text.slice(0, activeProposal.textDiff.selection.start) +
      activeProposal.textDiff.replacement +
      text.slice(activeProposal.textDiff.selection.end);
    const nextCursor = activeProposal.textDiff.selection.start + activeProposal.textDiff.replacement.length;
    const nextRevision = deriveManuscriptRevisionState(nextText, revision);
    const nextReviewItems = reconcileReviewItemsWithRevision(reviewItems, nextRevision, activeProposal.reviewItemId);

    setText(nextText);
    setRevision(nextRevision);
    setSelection({ start: nextCursor, end: nextCursor });
    setActiveProposal(null);
    setReviewItems(nextReviewItems);
    setActiveReviewItem(nextReviewItems.find((item) => item.id === activeProposal.reviewItemId) ?? null);
    setFeedback({ message: "Рекомендацію застосовано як текстовий diff.", tone: "info" });
  }

  function handleApplyCalloutProposal() {
    const fallbackItem = activeProposal ? reviewItems.find((entry) => entry.id === activeProposal.reviewItemId) ?? null : null;
    const sourceItem = fallbackItem ?? activeReviewItem;
    const calloutDraft = activeProposal?.calloutDraft ?? sourceItem?.calloutDraft;

    if (!sourceItem || !calloutDraft?.previewText) {
      return;
    }

    const anchorId = sourceItem.insertionPoint.anchorParagraphId ?? sourceItem.anchor.paragraphIds.at(-1);

    if (!anchorId || !revision.paragraphsById[anchorId]) {
      setFeedback({ message: "Не вдалося знайти місце для вставки врізки.", tone: "error" });
      return;
    }

    const anchorParagraph = revision.paragraphsById[anchorId];
    const insertionPoint = sourceItem.insertionPoint.mode === "before" ? anchorParagraph.start : anchorParagraph.end;
    const insertionText = formatCalloutInsertionMarkdown({
      calloutKind: calloutDraft.calloutKind,
      title: calloutDraft.title,
      body: calloutDraft.previewText
    });
    const nextText = text.slice(0, insertionPoint) + insertionText + text.slice(insertionPoint);
    const firstContentOffset = insertionText.search(/[^\n]/);
    const revealStart = firstContentOffset === -1 ? insertionPoint : insertionPoint + firstContentOffset;
    const revealEnd = revealStart + Math.max(calloutDraft.title.length, 1);
    const nextRevision = deriveManuscriptRevisionState(nextText, revision);
    const nextReviewItems = reconcileReviewItemsWithRevision(reviewItems, nextRevision).filter((item) => item.id !== sourceItem.id);

    setText(nextText);
    setRevision(nextRevision);
    setSelection(clampSelection(nextText, revealStart, revealEnd));
    setSelectionRevealKey((current) => current + 1);
    setActiveProposal(null);
    setActiveReviewItem(null);
    setReviewItems(nextReviewItems);
    setSuppressFloatingPrompt(true);
    setFeedback({ message: "Врізку вставлено. Рекомендацію закрито.", tone: "info" });
  }

  function handleApplyCalloutFromRail(item: EditorialReviewItem) {
    const liveItem = reviewItems.find((entry) => entry.id === item.id) ?? item;

    if (!liveItem.calloutDraft?.previewText) {
      void requestReviewProposal(liveItem);
      return;
    }

    const nextSelection = resolveReviewItemSelection(text, revision, liveItem);

    startTransition(() => {
      setAppliedDiffs([]);
      setActiveReviewItem(liveItem);
      setActiveProposal(null);
      setSelection(clampSelection(text, nextSelection.start, nextSelection.end));
      setSelectionRevealKey((current) => current + 1);
      setSuppressFloatingPrompt(true);
    });

    requestAnimationFrame(() => {
      handleApplyCalloutProposal();
    });
  }

  function handleInsertReviewImageProposal() {
    if (!activeProposal || activeProposal.kind !== "image_prompt" || !activeProposal.imageDraft || !activeReviewItem) {
      return;
    }

    const assetFromProposal = activeProposal.imageDraft.generatedAsset;
    const resolvedAsset = assetFromProposal ? reviewImageAssets[assetFromProposal.assetId] ?? assetFromProposal : null;

    if (!resolvedAsset) {
      setFeedback({ message: "Спершу згенеруйте чернеткове зображення.", tone: "error" });
      return;
    }

    if (imageInsertionGuardRef.current === activeProposal.id) {
      return;
    }

    if (activeProposal.targetRevisionId !== revision.documentRevisionId) {
      setActiveProposal({
        ...activeProposal,
        kind: "stale_anchor",
        summary: "Рекомендація застаріла після змін у тексті.",
        canApplyDirectly: false,
        staleReason: "Рекомендація застаріла після змін у тексті.",
        imageDraft: undefined
      });
      setReviewItems((current) => reconcileReviewItemsWithRevision(current, revision));
      setFeedback({ message: "Рекомендація застаріла після змін у тексті. Підготуйте чернетку ще раз.", tone: "error" });
      return;
    }

    const sourceUrl = resolveReviewImageAssetUrl(resolvedAsset);

    if (!sourceUrl) {
      setFeedback({ message: "Немає джерела зображення для вставки в markdown.", tone: "error" });
      return;
    }

    imageInsertionGuardRef.current = activeProposal.id;
    setIsReviewImageInsertionInFlight(true);

    try {
      const result = insertReviewImageMarkdown({
        text,
        revision,
        item: activeReviewItem,
        alt: activeProposal.imageDraft.alt,
        caption: activeProposal.imageDraft.caption,
        asset: resolvedAsset
      });

      if (!result.ok) {
        imageInsertionGuardRef.current = null;
        setFeedback({ message: result.reason ?? "Не вдалося вставити markdown-зображення.", tone: "error" });
        return;
      }

      if (!result.inserted) {
        setFeedback({ message: "Зображення вже вставлене біля цього фрагмента.", tone: "info" });
        return;
      }

      const nextRevision = deriveManuscriptRevisionState(result.text, revision);
      const nextReviewItems = reconcileReviewItemsWithRevision(reviewItems, nextRevision, activeProposal.reviewItemId);
      const nextCursor = result.cursorOffset;

      setText(result.text);
      setRevision(nextRevision);
      setSelection({ start: nextCursor, end: nextCursor });
      setActiveProposal(null);
      setReviewItems(nextReviewItems);
      setActiveReviewItem(nextReviewItems.find((item) => item.id === activeProposal.reviewItemId) ?? null);
      const nextFeedback = { message: "Зображення вставлено в рукопис як markdown-блок.", tone: "info" as const };
      setFeedback(nextFeedback);
      setHistory((current) => [createImageInsertionHistoryEntry(nextFeedback, activeProposal.reviewItemId), ...current].slice(0, 8));
    } finally {
      setIsReviewImageInsertionInFlight(false);
    }
  }

  function handleClearDraft() {
    startTransition(() => {
      const initialRevision = deriveManuscriptRevisionState(DEFAULT_MANUSCRIPT_TEXT);
      setText(DEFAULT_MANUSCRIPT_TEXT);
      setRevision(initialRevision);
      setSelection({ start: 0, end: 0 });
      setOperations([]);
      setReviewItems([]);
      setPatchDiagnostics(null);
      setReviewDiagnostics(null);
      setHistory([]);
      setAppliedDiffs([]);
      setFeedback({ message: "Чернетку очищено. Редактор повернуто до початкового стану.", tone: "info" });
      setActiveReviewItem(null);
      setActiveProposal(null);
      setReviewImageAssets({});
      setIsReviewImageInsertionInFlight(false);
      setSelectionRevealKey(0);
      setSuppressFloatingPrompt(false);
      setIsReviewComposerOpen(false);
      setReviewComposer(defaultReviewComposer);
      imageInsertionGuardRef.current = null;
    });

    clearEditorDraftState();
  }

  function requestClearDraft() {
    if (!canClearDraft) {
      return;
    }

    if (window.confirm("Очистити всю чернетку й прибрати правки, review і локальну історію?")) {
      handleClearDraft();
    }
  }

  return (
    <main className="app-shell">
      <TopBar activePath="/editor" />
      <ThreePaneShell
        rightState={hasRailDetailContent ? "active" : "idle"}
        center={
          <EditorCanvas
            activeReviewItem={activeReviewItem}
            activeProposal={activeProposal}
            appliedDiffs={appliedDiffs}
            canClearDraft={canClearDraft}
            loading={isAnyRequestInFlight}
            revision={revision}
            reviewPreparing={isReviewProposalInFlight}
            reviewImageGenerating={isReviewImageInFlight}
            reviewImageInserting={isReviewImageInsertionInFlight}
            onClearDraft={requestClearDraft}
            onAppliedDiffChange={handleAppliedDiffChange}
            onApplyReviewCallout={handleApplyCalloutProposal}
            onApplyReviewText={handleApplyReviewTextProposal}
            onDiscardAppliedDiffs={() => setAppliedDiffs([])}
            onDiscardReviewProposal={() => setActiveProposal(null)}
            onDismissAppliedDiffs={() => setAppliedDiffs([])}
            onDismissReviewItem={() => setActiveReviewItem(null)}
            onGenerateReviewImage={() => {
              void generateReviewImageAsset();
            }}
            onInsertReviewImage={handleInsertReviewImageProposal}
            onInsertLocalImage={(input) => handleInsertLocalImage(input)}
            onMarkdownFormat={() => setSuppressFloatingPrompt(true)}
            onPrepareReviewItem={() => {
              if (activeReviewItem) {
                void requestReviewProposal(activeReviewItem);
              }
            }}
            selectionRevealKey={selectionRevealKey}
            selection={selection}
            text={text}
            onSelectionChange={handleSelectionChange}
            onTextChange={handleTextChange}
          />
        }
        right={
          <RightOperationsRail
            canRequestReview={!isAnyRequestInFlight}
            isIdle={!hasRailDetailContent}
            patchDiagnostics={patchDiagnostics}
            reviewDiagnostics={reviewDiagnostics}
            reviewItems={reviewItems}
            reviewRevision={revision}
            activeReviewItemId={activeReviewItem?.id ?? null}
            history={history}
            onRequestReview={() => {
              setIsReviewComposerOpen(true);
              setSuppressFloatingPrompt(true);
            }}
            onFocusReviewItem={handleFocusReviewItem}
            onPrepareReviewItem={(item) => {
              void requestReviewProposal(item);
            }}
            onApplyReviewCallout={handleApplyCalloutFromRail}
            onDismissReviewItem={handleDismissReviewCard}
            patchLoading={isPatchRequestInFlight}
            reviewLoading={isReviewRequestInFlight}
            operations={operations}
            reviewItemCount={reviewItems.length}
            statusMessage={feedback?.message}
            statusTone={feedback?.tone}
            onAccept={handleAccept}
            onAcceptAll={handleAcceptAll}
            onReject={handleReject}
            onRejectAll={handleRejectAll}
          />
        }
      />
      {isReviewComposerOpen ? (
        <FloatingPromptPanel
          mode="review"
          loading={isReviewRequestInFlight}
          onSubmit={() => {
            void requestEditorialReview();
          }}
          onExitReviewMode={() => {
            setIsReviewComposerOpen(false);
            setSuppressFloatingPrompt(false);
          }}
          selectionKey={`review:${reviewComposer.changeLevel}:${reviewComposer.additionalInstructions.length}`}
          reviewChangeLevel={reviewComposer.changeLevel}
          reviewAdditionalInstructions={reviewComposer.additionalInstructions}
          onReviewChangeLevel={(value) => setReviewComposer((current) => ({ ...current, changeLevel: value }))}
          onReviewAdditionalInstructionsChange={(value) => setReviewComposer((current) => ({ ...current, additionalInstructions: value }))}
        />
      ) : null}
      {hasActiveSelection && activeReviewItem === null && !suppressFloatingPrompt && !isReviewComposerOpen ? (
        <FloatingPromptPanel
          mode="selection"
          loading={isPatchRequestInFlight}
          onSubmit={(prompt) => {
            void requestPatches("custom", prompt);
          }}
          selectionKey={`${selection.start}:${selection.end}`}
        />
      ) : null}
    </main>
  );
}

function buildFeedbackMessage(payload: PatchResponse, responseOk: boolean): RequestFeedback {
  if (!responseOk) {
    return { message: payload.error ?? "Не вдалося побудувати локальні правки.", tone: "error" };
  }

  if (payload.error) {
    return {
      message: `${payload.error}${payload.usedFallback ? " Показано локальну fallback-правку." : ""}`,
      tone: payload.usedFallback || payload.diagnostics.droppedOperationCount > 0 ? "error" : "info"
    };
  }

  if (payload.operations.length === 0) {
    return { message: "Для цього фрагмента не знайдено локальних правок.", tone: "info" };
  }

  return {
    message: payload.usedFallback
      ? `Показано локальну fallback-правку замість ${payload.providerUsed}.`
      : `Отримано ${payload.operations.length} локальні правки від ${payload.providerUsed}.`,
    tone: payload.usedFallback || payload.diagnostics.droppedOperationCount > 0 ? "error" : "info"
  };
}

function buildReviewFeedbackMessage(payload: EditorialReviewResponse, responseOk: boolean): RequestFeedback {
  if (!responseOk) {
    return { message: payload.error ?? "Не вдалося побудувати редакторський review.", tone: "error" };
  }

  if (payload.error) {
    return {
      message:
        payload.usedFallback && !payload.error.includes("локальний редакторський огляд")
          ? `${payload.error} Показано локальний редакторський огляд.`
          : payload.error,
      tone: payload.usedFallback || payload.diagnostics.droppedItemCount > 0 ? "error" : "info"
    };
  }

  if (payload.items.length === 0) {
    return { message: "Для цього тексту не знайдено суттєвих редакторських рекомендацій.", tone: "info" };
  }

  return {
    message: payload.usedFallback
      ? `Показано локальний редакторський review замість ${payload.providerUsed}.`
      : `Отримано ${payload.items.length} редакторських рекомендацій від ${payload.providerUsed}.`,
    tone: payload.usedFallback || payload.diagnostics.droppedItemCount > 0 ? "error" : "info"
  };
}

function buildReviewActionFeedbackMessage(payload: ReviewActionResponse, responseOk: boolean): RequestFeedback {
  if (!responseOk && payload.proposal.kind === "stale_anchor") {
    return {
      message: payload.error ?? payload.proposal.staleReason ?? "Рекомендація застаріла після змін у тексті.",
      tone: "error"
    };
  }

  if (payload.error) {
    return {
      message: payload.usedFallback ? `${payload.error} Показано локальну чернетку.` : payload.error,
      tone: payload.usedFallback ? "error" : "info"
    };
  }

  return {
    message: payload.usedFallback ? "Показано fallback-чернетку для цієї рекомендації." : "Чернетку дії підготовлено.",
    tone: payload.usedFallback ? "error" : "info"
  };
}

function createPatchHistoryEntry(payload: PatchResponse, feedback: RequestFeedback): RequestHistoryItem {
  return {
    id: payload.diagnostics.requestId,
    timestampLabel: historyTimeFormatter.format(new Date(payload.diagnostics.generatedAt)),
    providerUsed: payload.providerUsed,
    requestedProvider: payload.diagnostics.requestedProvider,
    requestedModelId: payload.diagnostics.requestedModelId,
    mode: payload.diagnostics.appliedMode,
    resultCount: payload.diagnostics.returnedOperationCount,
    droppedCount: payload.diagnostics.droppedOperationCount,
    usedFallback: payload.usedFallback,
    tone: feedback.tone,
    message: feedback.message
  };
}

function createReviewHistoryEntry(payload: EditorialReviewResponse, feedback: RequestFeedback): RequestHistoryItem {
  return {
    id: payload.diagnostics.requestId,
    timestampLabel: historyTimeFormatter.format(new Date(payload.diagnostics.generatedAt)),
    providerUsed: payload.providerUsed,
    requestedProvider: payload.diagnostics.requestedProvider,
    requestedModelId: payload.diagnostics.requestedModelId,
    mode: "review",
    resultCount: payload.diagnostics.returnedItemCount,
    droppedCount: payload.diagnostics.droppedItemCount,
    usedFallback: payload.usedFallback,
    tone: feedback.tone,
    message: feedback.message
  };
}

function createProposalHistoryEntry(payload: ReviewActionResponse, feedback: RequestFeedback): RequestHistoryItem {
  return {
    id: payload.diagnostics.requestId,
    timestampLabel: historyTimeFormatter.format(new Date(payload.diagnostics.generatedAt)),
    providerUsed: payload.providerUsed,
    requestedProvider: payload.diagnostics.requestedProvider,
    requestedModelId: payload.diagnostics.requestedModelId,
    mode: "proposal",
    resultCount: 1,
    droppedCount: payload.proposal.kind === "stale_anchor" ? 1 : 0,
    usedFallback: payload.usedFallback,
    tone: feedback.tone,
    message: feedback.message
  };
}

function createImageHistoryEntry(
  payload: ReviewImageGenerationResponse,
  feedback: RequestFeedback,
  reviewItemId: string
): RequestHistoryItem {
  return {
    id: `image-${reviewItemId}-${Date.now()}`,
    timestampLabel: historyTimeFormatter.format(new Date()),
    providerUsed: payload.providerUsed,
    requestedProvider: payload.providerUsed,
    requestedModelId: payload.modelId,
    mode: "image",
    resultCount: payload.asset ? 1 : 0,
    droppedCount: payload.asset ? 0 : 1,
    usedFallback: false,
    tone: feedback.tone,
    message: feedback.message
  };
}

function createImageInsertionHistoryEntry(feedback: RequestFeedback, reviewItemId: string): RequestHistoryItem {
  return {
    id: `image-insert-${reviewItemId}-${Date.now()}`,
    timestampLabel: historyTimeFormatter.format(new Date()),
    providerUsed: "local-editor",
    requestedProvider: "local-editor",
    requestedModelId: "markdown-image-insert",
    mode: "image",
    resultCount: 1,
    droppedCount: 0,
    usedFallback: false,
    tone: feedback.tone,
    message: feedback.message
  };
}

function deriveLocalImageAlt(fileName?: string): string {
  const normalized = (fileName ?? "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || "Вставлене зображення";
}

function createAppliedDiffMarkers(operations: PatchOperation[]): AppliedDiffMarker[] {
  const sorted = operations.slice().sort((left, right) => left.start - right.start || left.end - right.end);
  let offset = 0;

  return sorted.map((operation) => {
    const replacementText = getOperationReplacementText(operation);
    const start = operation.start + offset;
    const end = start + replacementText.length;
    offset += replacementText.length - (operation.end - operation.start);

    return {
      id: operation.id,
      start,
      end,
      oldText: operation.oldText,
      newText: operation.newText,
      reason: operation.reason
    };
  });
}

function rebaseAppliedDiffMarkers(markers: AppliedDiffMarker[], updatedId: string, newText: string): AppliedDiffMarker[] {
  const target = markers.find((marker) => marker.id === updatedId);

  if (!target) {
    return markers;
  }

  const currentLength = target.end - target.start;
  const delta = newText.length - currentLength;
  let hasReachedTarget = false;

  return markers.map((marker) => {
    if (marker.id === updatedId) {
      hasReachedTarget = true;
      return {
        ...marker,
        end: marker.start + newText.length,
        newText
      };
    }

    if (!hasReachedTarget || delta === 0) {
      return marker;
    }

    return {
      ...marker,
      start: marker.start + delta,
      end: marker.end + delta
    };
  });
}

function formatCalloutInsertionMarkdown(input: { calloutKind: string; title: string; body: string }): string {
  const normalizedKind = input.calloutKind.trim().toLowerCase().replace(/[^a-z_]/g, "") || "quick_fact";
  const normalizedTitle = input.title.trim() || "Врізка";
  const bodyLines = input.body
    .trim()
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const markdownLines = [`> [!CALLOUT: ${normalizedKind}] ${normalizedTitle}`, ...bodyLines.map((line) => `> ${line}`)];

  return `\n\n${markdownLines.join("\n")}`;
}

function createInlineCalloutProposal(item: EditorialReviewItem, revision: ManuscriptRevisionState): ReviewActionProposal | null {
  if ((item.recommendationType !== "callout" && item.suggestedAction !== "prepare_callout") || !item.calloutDraft?.previewText) {
    return null;
  }

  const calloutKind = item.calloutDraft.calloutKind ?? item.calloutKind ?? "quick_fact";
  const fragment = item.anchor.paragraphIds
    .map((id) => revision.paragraphsById[id]?.text ?? "")
    .filter(Boolean)
    .join(" ")
    .trim();
  const fallbackPrompt = [
    `Тип врізки: ${calloutKind}.`,
    fragment ? `Фрагмент: ${fragment}` : "",
    `Рекомендація: ${item.recommendation}`
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: createPatchId("proposal-callout-inline"),
    reviewItemId: item.id,
    sourceRevisionId: item.documentRevisionId,
    targetRevisionId: revision.documentRevisionId,
    kind: "callout_prompt",
    summary: item.calloutDraft.summary ?? "Врізка підготовлена під час первинного огляду.",
    canApplyDirectly: true,
    calloutDraft: {
      calloutKind,
      title: item.calloutDraft.title.trim() || "Врізка",
      prompt: item.calloutDraft.prompt.trim() || fallbackPrompt,
      previewText: item.calloutDraft.previewText.trim()
    }
  };
}
