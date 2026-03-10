"use client";

import { useEffect, useMemo, useState } from "react";
import { BlockEditorSurface } from "../../components/editor/BlockEditorSurface";
import { TopBar } from "../../components/layout/TopBar";
import { RightOperationsRail, type RequestHistoryItem } from "../../components/layout/RightOperationsRail";
import { ThreePaneShell } from "../../components/layout/ThreePaneShell";
import { Button } from "../../components/ui/Button";
import type { EditorDocument, BlockSelection, CalloutBlock, ImageBlock } from "../../lib/editor/document-model";
import { createBlockId, createInlineText, EMPTY_BLOCK_SELECTION, insertBlocksAfter, normalizeBlockSelection } from "../../lib/editor/document-model";
import { DEFAULT_EDITOR_DOCUMENT } from "../../lib/editor/default-manuscript";
import { clearEditorDraftState, readEditorDraftState, writeEditorDraftState } from "../../lib/editor/draft-state";
import { exportDocumentToDocx } from "../../lib/editor/docx-export";
import {
  deriveManuscriptRevisionState,
  resolveReviewItemSelection,
  type ManuscriptRevisionState
} from "../../lib/editor/manuscript-structure";
import {
  applyPatchOperation,
  applyPatchOperations,
  createPatchId,
  rebasePendingOperations,
  type PatchOperation,
  type PatchResponse,
  type PatchResponseDiagnostics,
  type RequestMode
} from "../../lib/editor/patch-contract";
import {
  getEditorialCalloutKindTitle,
  reconcileReviewItemsWithRevision,
  type EditorialReviewDiagnostics,
  type EditorialReviewItem,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  type ReviewActionProposal,
  type ReviewActionResponse
} from "../../lib/editor/review-contract";
import { DEFAULT_EDITOR_SETTINGS, readEditorSettings, type EditorSettings } from "../../lib/editor/settings";
import { storeEditorAssetFromBlob } from "../../lib/editor/asset-store";

interface RequestFeedback {
  message: string;
  tone: "info" | "error";
}

const historyTimeFormatter = new Intl.DateTimeFormat("uk-UA", {
  hour: "2-digit",
  minute: "2-digit"
});

const defaultReviewComposer = {
  changeLevel: 3 as const,
  additionalInstructions: ""
};

export default function EditorPage() {
  const [document, setDocument] = useState<EditorDocument>(DEFAULT_EDITOR_DOCUMENT);
  const [revision, setRevision] = useState<ManuscriptRevisionState>(() => deriveManuscriptRevisionState(DEFAULT_EDITOR_DOCUMENT));
  const [selection, setSelection] = useState<BlockSelection>(EMPTY_BLOCK_SELECTION);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(DEFAULT_EDITOR_DOCUMENT.blocks[0]?.id ?? null);
  const [operations, setOperations] = useState<PatchOperation[]>([]);
  const [reviewItems, setReviewItems] = useState<EditorialReviewItem[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [patchDiagnostics, setPatchDiagnostics] = useState<PatchResponseDiagnostics | null>(null);
  const [reviewDiagnostics, setReviewDiagnostics] = useState<EditorialReviewDiagnostics | null>(null);
  const [feedback, setFeedback] = useState<RequestFeedback | null>(null);
  const [history, setHistory] = useState<RequestHistoryItem[]>([]);
  const [customPrompt, setCustomPrompt] = useState("");
  const [activeReviewItemId, setActiveReviewItemId] = useState<string | null>(null);
  const [activeProposal, setActiveProposal] = useState<ReviewActionProposal | null>(null);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [isPatchRequestInFlight, setIsPatchRequestInFlight] = useState(false);
  const [isReviewRequestInFlight, setIsReviewRequestInFlight] = useState(false);
  const [isDocxExportInFlight, setIsDocxExportInFlight] = useState(false);

  const normalizedSelection = useMemo(() => normalizeBlockSelection(document, selection), [document, selection]);

  useEffect(() => {
    setSettings(readEditorSettings());
    const draft = readEditorDraftState();

    if (draft) {
      setDocument(draft.document);
      setRevision(draft.revision);
      setSelection(draft.selection);
      setOperations(draft.operations);
      setReviewItems(draft.reviewItems);
      setPatchDiagnostics(draft.patchDiagnostics);
      setReviewDiagnostics(draft.reviewDiagnostics);
      setFeedback(draft.feedback);
      setHistory(draft.history);
      setActiveReviewItemId(draft.activeReviewItemId);
      setActiveProposal(draft.activeProposal);
      setFocusedBlockId(draft.selection.focusBlockId ?? draft.document.blocks[0]?.id ?? null);
    }

    setHasHydratedDraft(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedDraft) {
      return;
    }

    writeEditorDraftState({
      document,
      revision,
      selection: normalizedSelection,
      operations,
      reviewItems,
      patchDiagnostics,
      reviewDiagnostics,
      history,
      appliedDiffs: [],
      feedback,
      activeReviewItemId,
      activeProposal,
      reviewImageAssets: {},
      reviewComposer: defaultReviewComposer
    });
  }, [
    activeProposal,
    activeReviewItemId,
    document,
    feedback,
    hasHydratedDraft,
    history,
    normalizedSelection,
    operations,
    patchDiagnostics,
    reviewDiagnostics,
    reviewItems,
    revision
  ]);

  function commitDocument(nextDocument: EditorDocument) {
    const nextRevision = deriveManuscriptRevisionState(nextDocument);
    setDocument(nextDocument);
    setRevision(nextRevision);
    setSelection((current) => normalizeBlockSelection(nextDocument, current));
    setReviewItems((current) => reconcileReviewItemsWithRevision(current, nextDocument, nextRevision));
  }

  function pushHistoryEntry(entry: RequestHistoryItem) {
    setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 8));
  }

  function resolveTargetBlockIds() {
    if (normalizedSelection.blockIds.length > 0) {
      return normalizedSelection.blockIds;
    }

    return focusedBlockId ? [focusedBlockId] : [];
  }

  async function requestPatch(mode: RequestMode) {
    const targetBlockIds = resolveTargetBlockIds();

    if (targetBlockIds.length === 0) {
      setFeedback({ tone: "error", message: "Оберіть блоки для локальної правки." });
      return;
    }

    setIsPatchRequestInFlight(true);
    setFeedback(null);

    try {
      const requestBody = {
        document,
        targetBlockIds,
        mode,
        prompt: mode === "custom" ? customPrompt.trim() : undefined,
        provider: settings.provider,
        modelId: settings.modelId,
        apiKey: settings.apiKey || undefined,
        basePrompt: settings.basePrompt
      };

      const response = await fetch("/api/edit/patch", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = (await response.json()) as PatchResponse;
      const nextFeedback = buildPatchFeedbackMessage(payload, response.ok);

      setOperations(payload.operations);
      setPatchDiagnostics(payload.diagnostics);
      setFeedback(nextFeedback);
      pushHistoryEntry(
        createHistoryEntry(mode, payload.providerUsed, settings.provider, settings.modelId, payload.operations.length, payload.diagnostics.droppedOperationCount, payload.usedFallback, nextFeedback)
      );
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося виконати локальну правку."
      });
    } finally {
      setIsPatchRequestInFlight(false);
    }
  }

  async function requestEditorialReview() {
    setIsReviewRequestInFlight(true);
    setFeedback(null);

    try {
      const requestBody: EditorialReviewRequest = {
        document,
        revision,
        provider: settings.provider,
        modelId: settings.modelId,
        apiKey: settings.apiKey || undefined,
        basePrompt: settings.basePrompt,
        reviewPrompt: settings.reviewPrompt,
        reviewLevelGuide: settings.reviewLevelGuide,
        calloutPromptTemplate: settings.calloutPromptTemplate,
        changeLevel: defaultReviewComposer.changeLevel,
        additionalInstructions: defaultReviewComposer.additionalInstructions
      };

      const response = await fetch("/api/edit/review", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = (await response.json()) as EditorialReviewResponse;
      const nextFeedback = buildReviewFeedbackMessage(payload, response.ok);

      setReviewItems(payload.items);
      setReviewDiagnostics(payload.diagnostics);
      setFeedback(nextFeedback);
      pushHistoryEntry(createHistoryEntry("review", payload.providerUsed, settings.provider, settings.modelId, payload.items.length, payload.diagnostics.droppedItemCount, payload.usedFallback, nextFeedback));
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося запустити review."
      });
    } finally {
      setIsReviewRequestInFlight(false);
    }
  }

  function acceptOperation(operationId: string) {
    const operation = operations.find((entry) => entry.id === operationId);

    if (!operation) {
      return;
    }

    const nextDocument = applyPatchOperation(document, operation);
    commitDocument(nextDocument);
    setOperations((current) => rebasePendingOperations(current, operation));
    setFeedback({ tone: "info", message: "Правку застосовано." });
  }

  function acceptAllOperations() {
    if (operations.length === 0) {
      return;
    }

    const nextDocument = applyPatchOperations(document, operations);
    commitDocument(nextDocument);
    setOperations([]);
    setFeedback({ tone: "info", message: "Усі правки застосовано." });
  }

  function rejectOperation(operationId: string) {
    setOperations((current) => current.filter((operation) => operation.id !== operationId));
  }

  function rejectAllOperations() {
    setOperations([]);
  }

  function focusReviewItem(item: EditorialReviewItem) {
    const nextSelection = resolveReviewItemSelection(document, revision, item);
    setSelection(nextSelection);
    setFocusedBlockId(nextSelection.focusBlockId ?? nextSelection.anchorBlockId);
    setActiveReviewItemId(item.id);

    const anchorBlockId = nextSelection.anchorBlockId;

    if (anchorBlockId) {
      window.requestAnimationFrame(() => {
        const element = window.document.querySelector<HTMLElement>(`[data-block-id="${anchorBlockId}"]`);
        element?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    }
  }

  async function prepareReviewItem(item: EditorialReviewItem) {
    setActiveReviewItemId(item.id);

    try {
      const response = await fetch("/api/edit/review/proposal", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document,
          currentRevision: revision,
          item,
          provider: settings.provider,
          modelId: settings.modelId,
          apiKey: settings.apiKey || undefined,
          basePrompt: settings.basePrompt,
          reviewPrompt: settings.reviewPrompt,
          reviewLevelGuide: settings.reviewLevelGuide,
          calloutPromptTemplate: settings.calloutPromptTemplate,
          imagePromptTemplate: settings.imagePromptTemplate
        })
      });
      const payload = (await response.json()) as ReviewActionResponse;

      setActiveProposal(payload.proposal);

      if (payload.proposal.kind === "text_diff" && payload.proposal.textDiff) {
        const textDiff = payload.proposal.textDiff;
        setOperations((current) => [
          ...current,
          {
            id: payload.proposal.id,
            op: "replace_blocks",
            blockIds: textDiff.blockIds,
            oldBlocks: textDiff.oldBlocks,
            newBlocks: textDiff.newBlocks,
            reason: textDiff.reason,
            type: "clarity"
          }
        ]);
        setFeedback({ tone: "info", message: "Чернетку правки додано на розгляд." });
        return;
      }

      if (payload.proposal.kind === "callout_prompt" && payload.proposal.calloutDraft) {
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  calloutDraft: {
                    calloutKind: payload.proposal.calloutDraft!.calloutKind,
                    title: payload.proposal.calloutDraft!.title,
                    prompt: payload.proposal.calloutDraft!.prompt,
                    previewText: payload.proposal.calloutDraft!.previewText ?? "",
                    summary: payload.proposal.summary
                  },
                  status: "ready"
                }
              : entry
          )
        );
        setFeedback({ tone: "info", message: "Врізку підготовлено." });
        return;
      }

      if (payload.proposal.kind === "image_prompt" && payload.proposal.imageDraft) {
        setFeedback({ tone: "info", message: "Промпт для зображення підготовлено." });
        return;
      }

      if (payload.error) {
        setFeedback({ tone: response.ok ? "info" : "error", message: payload.error });
      }
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося підготувати рекомендацію."
      });
    }
  }

  function applyReviewCallout(item: EditorialReviewItem) {
    if (!item.calloutDraft) {
      return;
    }

    const block: CalloutBlock = {
      id: createBlockId("callout"),
      type: "callout",
      kind: item.calloutDraft.calloutKind,
      title: [createInlineText(item.calloutDraft.title || getEditorialCalloutKindTitle(item.calloutDraft.calloutKind))],
      body: [[createInlineText(item.calloutDraft.previewText)]]
    };

    commitDocument(insertBlocksAfter(document, item.insertionPoint.anchorBlockId, [block]));
    setReviewItems((current) =>
      current.map((entry) => (entry.id === item.id ? { ...entry, status: "applied" } : entry))
    );
    setFeedback({ tone: "info", message: "Врізку вставлено." });
  }

  function dismissReviewItem(item: EditorialReviewItem) {
    setReviewItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "dismissed" } : entry)));
  }

  async function handleInsertImage(file: File, anchorBlockId: string | null) {
    const stored = await storeEditorAssetFromBlob({ blob: file, mimeType: file.type });
    const block: ImageBlock = {
      id: createBlockId("image"),
      type: "image",
      assetId: stored.assetId,
      alt: file.name.replace(/\.[^.]+$/, ""),
      caption: [createInlineText("")]
    };

    commitDocument(insertBlocksAfter(document, anchorBlockId, [block]));
  }

  async function handleExportDocx() {
    setIsDocxExportInFlight(true);

    try {
      const result = await exportDocumentToDocx({ document });
      const url = URL.createObjectURL(result.blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setFeedback({ tone: "info", message: result.warnings.length > 0 ? "DOCX експортовано з попередженнями." : "DOCX експортовано." });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося експортувати DOCX."
      });
    } finally {
      setIsDocxExportInFlight(false);
    }
  }

  function handleResetDraft() {
    clearEditorDraftState();
    setDocument(DEFAULT_EDITOR_DOCUMENT);
    setRevision(deriveManuscriptRevisionState(DEFAULT_EDITOR_DOCUMENT));
    setSelection(EMPTY_BLOCK_SELECTION);
    setFocusedBlockId(DEFAULT_EDITOR_DOCUMENT.blocks[0]?.id ?? null);
    setOperations([]);
    setReviewItems([]);
    setPatchDiagnostics(null);
    setReviewDiagnostics(null);
    setFeedback(null);
    setHistory([]);
    setActiveReviewItemId(null);
    setActiveProposal(null);
    setCustomPrompt("");
  }

  const canRequestReview = document.blocks.length > 0;

  return (
    <>
      <TopBar activePath="/editor" />
      <ThreePaneShell
        center={
          <main className="editor-page-shell">
            <div className="editor-page-actions">
              <Button variant="secondary" size="sm" onClick={handleExportDocx} loading={isDocxExportInFlight}>
                DOCX
              </Button>
              <Button variant="ghost" size="sm" onClick={handleResetDraft}>
                Скинути
              </Button>
            </div>

            <BlockEditorSurface
              document={document}
              selection={normalizedSelection}
              focusedBlockId={focusedBlockId}
              onDocumentChange={commitDocument}
              onSelectionChange={setSelection}
              onFocusedBlockChange={setFocusedBlockId}
              onInsertImage={handleInsertImage}
            />
          </main>
        }
        right={
          <RightOperationsRail
            aiTasks={[]}
            canRequestReview={canRequestReview}
            customPrompt={customPrompt}
            isIdle={!feedback && operations.length === 0 && reviewItems.length === 0}
            patchDiagnostics={patchDiagnostics}
            reviewDiagnostics={reviewDiagnostics}
            reviewItems={reviewItems}
            reviewRevision={revision}
            activeReviewItemId={activeReviewItemId}
            history={history}
            onRequestReview={() => void requestEditorialReview()}
            onFocusReviewItem={focusReviewItem}
            onPrepareReviewItem={(item) => void prepareReviewItem(item)}
            onApplyReviewCallout={applyReviewCallout}
            onDismissReviewItem={dismissReviewItem}
            onPromptChange={setCustomPrompt}
            patchLoading={isPatchRequestInFlight}
            reviewLoading={isReviewRequestInFlight}
            onRequestPatch={(mode) => void requestPatch(mode)}
            onAccept={acceptOperation}
            onAcceptAll={acceptAllOperations}
            onReject={rejectOperation}
            onRejectAll={rejectAllOperations}
            operations={operations}
            reviewItemCount={reviewItems.filter((item) => item.status !== "dismissed").length}
            statusMessage={feedback?.message}
            statusTone={feedback?.tone}
            onOpenAiTask={() => {}}
            onDismissAiTask={() => {}}
          />
        }
      />
    </>
  );
}

function createHistoryEntry(
  mode: RequestHistoryItem["mode"],
  providerUsed: string,
  requestedProvider: string,
  requestedModelId: string,
  resultCount: number,
  droppedCount: number,
  usedFallback: boolean,
  feedback: RequestFeedback
): RequestHistoryItem {
  return {
    id: createPatchId("history"),
    timestampLabel: historyTimeFormatter.format(new Date()),
    providerUsed,
    requestedProvider,
    requestedModelId,
    mode,
    resultCount,
    droppedCount,
    usedFallback,
    tone: feedback.tone,
    message: feedback.message
  };
}

function buildPatchFeedbackMessage(payload: PatchResponse, responseOk: boolean): RequestFeedback {
  if (payload.usedFallback && payload.operations.length > 0) {
    return {
      tone: "info",
      message: payload.error || "Провайдер не повернув придатний diff, тому показано локальну fallback-правку."
    };
  }

  if (!responseOk || payload.error) {
    return {
      tone: responseOk ? "info" : "error",
      message: payload.error || "Не вдалося отримати правки."
    };
  }

  if (payload.operations.length === 0) {
    return {
      tone: "info",
      message: "Модель не запропонувала локальних правок."
    };
  }

  return {
    tone: "info",
    message: `Підготовлено ${payload.operations.length} правк${payload.operations.length === 1 ? "у" : payload.operations.length < 5 ? "и" : "ок"}.`
  };
}

function buildReviewFeedbackMessage(payload: EditorialReviewResponse, responseOk: boolean): RequestFeedback {
  if (!responseOk || payload.error) {
    return {
      tone: responseOk ? "info" : "error",
      message: payload.error || "Не вдалося отримати review."
    };
  }

  if (payload.items.length === 0) {
    return {
      tone: "info",
      message: "ШІ не знайшов сильних локальних рекомендацій."
    };
  }

  return {
    tone: "info",
    message: `Підготовлено ${payload.items.length} рекомендац${payload.items.length === 1 ? "ію" : "ії"}.`
  };
}
