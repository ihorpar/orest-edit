"use client";

import { startTransition, useEffect, useState } from "react";
import { EditorCanvas, type AppliedDiffMarker } from "../../components/editor/EditorCanvas";
import { FloatingPromptPanel } from "../../components/editor/FloatingPromptPanel";
import { LeftSidebarConfig } from "../../components/layout/LeftSidebarConfig";
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
import { resolveReviewSelection } from "../../lib/editor/manuscript-structure";
import {
  applyPatchOperation,
  applyPatchOperations,
  clampSelection,
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
import type { EditorialReviewDiagnostics, EditorialReviewItem, EditorialReviewRequest, EditorialReviewResponse } from "../../lib/editor/review-contract";
import { DEFAULT_EDITOR_SETTINGS, normalizeModelId, readEditorSettings, type EditorSettings } from "../../lib/editor/settings";

interface RequestFeedback {
  message: string;
  tone: "info" | "error";
}

const historyTimeFormatter = new Intl.DateTimeFormat("uk-UA", {
  hour: "2-digit",
  minute: "2-digit"
});

export default function EditorPage() {
  const [text, setText] = useState(DEFAULT_MANUSCRIPT_TEXT);
  const [selection, setSelection] = useState<PatchSelection>({ start: 0, end: 0 });
  const [operations, setOperations] = useState<PatchOperation[]>([]);
  const [reviewItems, setReviewItems] = useState<EditorialReviewItem[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [isPatchRequestInFlight, setIsPatchRequestInFlight] = useState(false);
  const [isReviewRequestInFlight, setIsReviewRequestInFlight] = useState(false);
  const [feedback, setFeedback] = useState<RequestFeedback | null>(null);
  const [patchDiagnostics, setPatchDiagnostics] = useState<PatchResponseDiagnostics | null>(null);
  const [reviewDiagnostics, setReviewDiagnostics] = useState<EditorialReviewDiagnostics | null>(null);
  const [history, setHistory] = useState<RequestHistoryItem[]>([]);
  const [appliedDiffs, setAppliedDiffs] = useState<AppliedDiffMarker[]>([]);
  const [activeReviewItem, setActiveReviewItem] = useState<EditorialReviewItem | null>(null);
  const [selectionRevealKey, setSelectionRevealKey] = useState(0);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);

  useEffect(() => {
    setSettings(readEditorSettings());
    const draft = readEditorDraftState();

    if (draft) {
      setText(draft.text);
      setSelection(clampSelection(draft.text, draft.selection?.start ?? 0, draft.selection?.end ?? 0));
      setOperations(Array.isArray(draft.operations) ? draft.operations : []);
      setReviewItems(Array.isArray(draft.reviewItems) ? draft.reviewItems : []);
      setPatchDiagnostics(draft.patchDiagnostics ?? null);
      setReviewDiagnostics(draft.reviewDiagnostics ?? null);
      setHistory(Array.isArray(draft.history) ? draft.history : []);
      setAppliedDiffs(Array.isArray(draft.appliedDiffs) ? draft.appliedDiffs : []);
      setFeedback(draft.feedback ?? null);
      setActiveReviewItem(
        (Array.isArray(draft.reviewItems) ? draft.reviewItems : []).find((item) => item.id === draft.activeReviewItemId) ?? null
      );
    }

    setHasHydratedDraft(true);
  }, []);

  const hasActiveSelection = hasSelection(selection);
  const isAnyRequestInFlight = isPatchRequestInFlight || isReviewRequestInFlight;
  const showRightRail =
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
      selection,
      operations,
      reviewItems,
      patchDiagnostics,
      reviewDiagnostics,
      history,
      appliedDiffs,
      feedback,
      activeReviewItemId: activeReviewItem?.id ?? null
    };

    writeEditorDraftState(draftState);
  }, [activeReviewItem, appliedDiffs, feedback, hasHydratedDraft, history, operations, patchDiagnostics, reviewDiagnostics, reviewItems, selection, text]);

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
    setActiveReviewItem(null);
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
        setHistory((current) => [createPatchHistoryEntry(payload, nextFeedback), ...current].slice(0, 5));
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
      provider: settings.provider,
      modelId: normalizeModelId(settings.provider, settings.modelId),
      apiKey: settings.apiKey || undefined,
      basePrompt: settings.basePrompt
    };

    setIsReviewRequestInFlight(true);
    setFeedback(null);
    setActiveReviewItem(null);
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
        setHistory((current) => [createReviewHistoryEntry(payload, nextFeedback), ...current].slice(0, 5));
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Сталася помилка під час редакторського огляду.",
        tone: "error"
      });
      setReviewItems([]);
    } finally {
      setIsReviewRequestInFlight(false);
    }
  }

  function handleSelectionChange(nextSelection: PatchSelection) {
    if (appliedDiffs.length > 0) {
      setAppliedDiffs([]);
    }

    setSelection(clampSelection(text, nextSelection.start, nextSelection.end));
  }

  function handleTextChange(nextText: string, nextSelection: PatchSelection) {
    setText(nextText);
    setSelection(clampSelection(nextText, nextSelection.start, nextSelection.end));
    setAppliedDiffs([]);
    setActiveReviewItem(null);
    setReviewItems([]);
    setReviewDiagnostics(null);

    if (operations.length > 0) {
      setOperations([]);
      setFeedback({ message: "Текст змінено вручну, тому попередні правки скинуто.", tone: "info" });
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

    startTransition(() => {
      setText((current) => applyPatchOperation(current, operation));
      setOperations((current) => rebasePendingOperations(current, operation));
      setSelection({ start: nextCursor, end: nextCursor });
      setAppliedDiffs(nextAppliedDiffs);
      setActiveReviewItem(null);
      setReviewItems([]);
      setReviewDiagnostics(null);
      setFeedback({ message: "Правку застосовано до Редактору.", tone: "info" });
    });
  }

  function handleReject(id: string) {
    setOperations((current) => current.filter((item) => item.id !== id));
    setFeedback({ message: "Правку відхилено. Текст у Редакторі не змінено.", tone: "info" });
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

    startTransition(() => {
      setText((current) => applyPatchOperations(current, applicable));
      setOperations([]);
      setSelection({ start: nextCursor, end: nextCursor });
      setAppliedDiffs(nextAppliedDiffs);
      setActiveReviewItem(null);
      setReviewItems([]);
      setReviewDiagnostics(null);
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
    const nextSelection = resolveReviewSelection(text, item.paragraphStart, item.paragraphEnd, item.excerpt);

    startTransition(() => {
      setAppliedDiffs([]);
      setActiveReviewItem(item);
      setSelection(clampSelection(text, nextSelection.start, nextSelection.end));
      setSelectionRevealKey((current) => current + 1);
    });
  }

  function handleClearDraft() {
    startTransition(() => {
      setText(DEFAULT_MANUSCRIPT_TEXT);
      setSelection({ start: 0, end: 0 });
      setOperations([]);
      setReviewItems([]);
      setPatchDiagnostics(null);
      setReviewDiagnostics(null);
      setHistory([]);
      setAppliedDiffs([]);
      setFeedback({ message: "Чернетку очищено. Редактор повернуто до початкового стану.", tone: "info" });
      setActiveReviewItem(null);
      setSelectionRevealKey(0);
    });

    clearEditorDraftState();
  }

  return (
    <main className="app-shell">
      <TopBar pendingCount={operations.length} activePath="/editor" />
      <ThreePaneShell
        left={
          <LeftSidebarConfig
            canClear={canClearDraft}
            pendingCount={operations.length}
            reviewCount={reviewItems.length}
            reviewLoading={isReviewRequestInFlight}
            onClear={handleClearDraft}
            onRequestReview={() => {
              void requestEditorialReview();
            }}
          />
        }
        center={
          <EditorCanvas
            activeReviewItem={activeReviewItem}
            appliedDiffs={appliedDiffs}
            loading={isAnyRequestInFlight}
            onDiscardAppliedDiffs={() => setAppliedDiffs([])}
            onDismissAppliedDiffs={() => setAppliedDiffs([])}
            onDismissReviewItem={() => setActiveReviewItem(null)}
            selectionRevealKey={selectionRevealKey}
            selection={selection}
            text={text}
            onSelectionChange={handleSelectionChange}
            onTextChange={handleTextChange}
          />
        }
        rightCollapsed={!showRightRail}
        right={
          showRightRail ? (
            <RightOperationsRail
              patchDiagnostics={patchDiagnostics}
              reviewDiagnostics={reviewDiagnostics}
              history={history}
              patchLoading={isPatchRequestInFlight}
              reviewLoading={isReviewRequestInFlight}
              operations={operations}
              reviewItems={reviewItems}
              statusMessage={feedback?.message}
              statusTone={feedback?.tone}
              onAccept={handleAccept}
              onAcceptAll={handleAcceptAll}
              onFocusReviewItem={handleFocusReviewItem}
              onReject={handleReject}
              onRejectAll={handleRejectAll}
            />
          ) : null
        }
      />
      {hasActiveSelection && activeReviewItem === null ? (
        <FloatingPromptPanel
          loading={isAnyRequestInFlight}
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
    return { message: payload.error ?? "Не вдалося побудувати редакторський огляд.", tone: "error" };
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
    return { message: "Для цього тексту не знайдено суттєвих редакторських зауваг.", tone: "info" };
  }

  return {
    message: payload.usedFallback
      ? `Показано локальний редакторський огляд замість ${payload.providerUsed}.`
      : `Отримано ${payload.items.length} редакторські рекомендації від ${payload.providerUsed}.`,
    tone: payload.usedFallback || payload.diagnostics.droppedItemCount > 0 ? "error" : "info"
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
