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
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [isRequestInFlight, setIsRequestInFlight] = useState(false);
  const [feedback, setFeedback] = useState<RequestFeedback | null>(null);
  const [diagnostics, setDiagnostics] = useState<PatchResponseDiagnostics | null>(null);
  const [history, setHistory] = useState<RequestHistoryItem[]>([]);
  const [appliedDiffs, setAppliedDiffs] = useState<AppliedDiffMarker[]>([]);

  useEffect(() => {
    setSettings(readEditorSettings());
  }, []);

  const hasActiveSelection = hasSelection(selection);
  const showRightRail = isRequestInFlight || operations.length > 0 || diagnostics !== null || history.length > 0 || feedback?.tone === "error";

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

    setIsRequestInFlight(true);
    setFeedback(null);
    setAppliedDiffs([]);

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
        setDiagnostics(payload.diagnostics);
        setHistory((current) => [createHistoryEntry(payload, nextFeedback), ...current].slice(0, 5));
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Сталася помилка під час запиту до провайдера.",
        tone: "error"
      });
      setOperations([]);
    } finally {
      setIsRequestInFlight(false);
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

  return (
    <main className="app-shell">
      <TopBar pendingCount={operations.length} activePath="/editor" />
      <ThreePaneShell
        left={<LeftSidebarConfig pendingCount={operations.length} />}
        center={
          <EditorCanvas
            appliedDiffs={appliedDiffs}
            loading={isRequestInFlight}
            onDismissAppliedDiffs={() => setAppliedDiffs([])}
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
              diagnostics={diagnostics}
              history={history}
              loading={isRequestInFlight}
              operations={operations}
              statusMessage={feedback?.message}
              statusTone={feedback?.tone}
              onAccept={handleAccept}
              onAcceptAll={handleAcceptAll}
              onReject={handleReject}
              onRejectAll={handleRejectAll}
            />
          ) : null
        }
      />
      {hasActiveSelection ? (
        <FloatingPromptPanel
          loading={isRequestInFlight}
          onRequestDefault={() => {
            void requestPatches("default");
          }}
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

function createHistoryEntry(payload: PatchResponse, feedback: RequestFeedback): RequestHistoryItem {
  return {
    id: payload.diagnostics.requestId,
    timestampLabel: historyTimeFormatter.format(new Date(payload.diagnostics.generatedAt)),
    providerUsed: payload.providerUsed,
    requestedProvider: payload.diagnostics.requestedProvider,
    requestedModelId: payload.diagnostics.requestedModelId,
    mode: payload.diagnostics.appliedMode,
    operationCount: payload.diagnostics.returnedOperationCount,
    droppedOperationCount: payload.diagnostics.droppedOperationCount,
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
