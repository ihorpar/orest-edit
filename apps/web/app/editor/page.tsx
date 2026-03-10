"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { CodeMirrorCanvas } from "../../components/editor/CodeMirrorCanvas";
import { DraftResetDialog } from "../../components/editor/DraftResetDialog";
import { FloatingPromptPanel } from "../../components/editor/FloatingPromptPanel";
import { useAiActivity } from "../../components/providers/AiActivityProvider";
import { RightOperationsRail, type RequestHistoryItem } from "../../components/layout/RightOperationsRail";
import { ThreePaneShell } from "../../components/layout/ThreePaneShell";
import { TopBar } from "../../components/layout/TopBar";
import type { AppliedDiffMarker } from "../../lib/editor/applied-diff";
import type {
  AiActivityTask,
  AiPatchTaskFailureResult,
  AiPatchTaskSuccessResult,
  AiReviewTaskFailureResult,
  AiReviewTaskSuccessResult
} from "../../lib/editor/ai-activity";
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
import { exportMarkdownToDocx } from "../../lib/editor/docx-export";
import {
  getEditorialCalloutKindLabel,
  getEditorialCalloutKindTitle,
  reconcileReviewItemsWithRevision,
  resolveReviewImageAssetUrl,
  type EditorialCalloutKind,
  type EditorialReviewDiagnostics,
  type EditorialReviewItem,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  type GeneratedReviewImageAsset,
  type ReviewImageGenerationJobStatus,
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

interface ActiveReviewImageJobState {
  proposalId: string;
  reviewItemId: string;
  jobId: string;
  status: ReviewImageGenerationJobStatus;
  error?: string;
}

const historyTimeFormatter = new Intl.DateTimeFormat("uk-UA", {
  hour: "2-digit",
  minute: "2-digit"
});

const defaultReviewComposer = {
  changeLevel: 3 as WholeTextChangeLevel,
  additionalInstructions: ""
};

async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;

  if (!payload) {
    return fallback;
  }

  const parts = [payload.error, payload.code].filter((value): value is string => typeof value === "string" && value.length > 0);
  return parts.length > 0 ? parts.join(" ") : fallback;
}

export default function EditorPage() {
  const { tasks: aiTasks, trackTask, markTaskSeen, dismissTask } = useAiActivity();
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
  const [isDocxExportInFlight, setIsDocxExportInFlight] = useState(false);
  const [feedback, setFeedback] = useState<RequestFeedback | null>(null);
  const [patchDiagnostics, setPatchDiagnostics] = useState<PatchResponseDiagnostics | null>(null);
  const [reviewDiagnostics, setReviewDiagnostics] = useState<EditorialReviewDiagnostics | null>(null);
  const [history, setHistory] = useState<RequestHistoryItem[]>([]);
  const [appliedDiffs, setAppliedDiffs] = useState<AppliedDiffMarker[]>([]);
  const [activeReviewItem, setActiveReviewItem] = useState<EditorialReviewItem | null>(null);
  const [activeProposal, setActiveProposal] = useState<ReviewActionProposal | null>(null);
  const [reviewImageAssets, setReviewImageAssets] = useState<Record<string, GeneratedReviewImageAsset>>({});
  const [calloutKindOverrides, setCalloutKindOverrides] = useState<Record<string, EditorialCalloutKind>>({});
  const [isReviewImageInsertionInFlight, setIsReviewImageInsertionInFlight] = useState(false);
  const [activeReviewImageJob, setActiveReviewImageJob] = useState<ActiveReviewImageJobState | null>(null);
  const [selectionRevealKey, setSelectionRevealKey] = useState(0);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [suppressFloatingPrompt, setSuppressFloatingPrompt] = useState(false);
  const [isReviewComposerOpen, setIsReviewComposerOpen] = useState(false);
  const [isClearDraftDialogOpen, setIsClearDraftDialogOpen] = useState(false);
  const [reviewComposer, setReviewComposer] = useState(defaultReviewComposer);
  const imageInsertionGuardRef = useRef<string | null>(null);
  const reviewImagePollControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

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

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      reviewImagePollControllerRef.current?.abort();
    };
  }, []);

  const hasActiveSelection = hasSelection(selection);
  const shouldShowSelectionPrompt = hasActiveSelection && activeReviewItem === null && !suppressFloatingPrompt && !isReviewComposerOpen;
  const shouldShowFloatingPrompt = isReviewComposerOpen || shouldShowSelectionPrompt;
  const floatingPromptMode = isReviewComposerOpen ? "review" : "selection";
  const proposalImageGeneration = activeProposal?.kind === "image_prompt" ? activeProposal.imageDraft?.generation : undefined;
  const reviewImageJobStatus =
    activeReviewImageJob && activeProposal?.id === activeReviewImageJob.proposalId ? activeReviewImageJob.status : proposalImageGeneration?.status;
  const reviewImageJobError =
    activeReviewImageJob && activeProposal?.id === activeReviewImageJob.proposalId ? activeReviewImageJob.error : proposalImageGeneration?.error;
  const isAnyRequestInFlight =
    isPatchRequestInFlight ||
    isReviewRequestInFlight ||
    isReviewProposalInFlight ||
    isReviewImageInFlight ||
    isReviewImageInsertionInFlight ||
    isDocxExportInFlight;
  const backgroundAiTasks = aiTasks.filter((task) => task.status === "running" || task.unread);
  const hasRailDetailContent =
    isAnyRequestInFlight ||
    backgroundAiTasks.length > 0 ||
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

  function clearActiveReviewImageJob() {
    reviewImagePollControllerRef.current?.abort();
    reviewImagePollControllerRef.current = null;
    setActiveReviewImageJob(null);
  }

  function updateActiveProposalImageJobState(input: {
    proposalId: string;
    jobId: string;
    status: ReviewImageGenerationJobStatus;
    updatedAt: string;
    error?: string;
  }) {
    setActiveProposal((current) =>
      current && current.id === input.proposalId && current.kind === "image_prompt" && current.imageDraft
        ? {
            ...current,
            imageDraft: {
              ...current.imageDraft,
              generation: {
                jobId: input.jobId,
                status: input.status,
                requestedAt:
                  current.imageDraft.generation && current.imageDraft.generation.jobId === input.jobId
                    ? current.imageDraft.generation.requestedAt
                    : input.updatedAt,
                updatedAt: input.updatedAt,
                error: input.error
              }
            }
          }
        : current
    );
  }

  function pushHistoryEntry(entry: RequestHistoryItem) {
    setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 8));
  }

  function applyPatchTaskResult(result: AiPatchTaskSuccessResult, taskId?: string) {
    startTransition(() => {
      setSelection(result.selection);
      setOperations(result.payload.operations);
      setFeedback(result.feedback);
      setPatchDiagnostics(result.payload.diagnostics);
      setAppliedDiffs([]);
      pushHistoryEntry(result.historyEntry);
    });

    if (taskId) {
      markTaskSeen(taskId);
    }
  }

  function applyReviewTaskResult(result: AiReviewTaskSuccessResult, taskId?: string) {
    startTransition(() => {
      setReviewItems(result.payload.items);
      setCalloutKindOverrides({});
      setFeedback(result.feedback);
      setReviewDiagnostics(result.payload.diagnostics);
      setActiveReviewItem(null);
      clearActiveReviewImageJob();
      setActiveProposal(null);
      setIsReviewComposerOpen(false);
      setSuppressFloatingPrompt(false);
      pushHistoryEntry(result.historyEntry);
    });

    if (taskId) {
      markTaskSeen(taskId);
    }
  }

  function applyPatchTaskFailure(result: AiPatchTaskFailureResult, taskId?: string) {
    setFeedback({ message: result.message, tone: "error" });
    setOperations([]);
    setPatchDiagnostics(result.diagnostics ?? null);

    if (taskId) {
      markTaskSeen(taskId);
    }
  }

  function applyReviewTaskFailure(result: AiReviewTaskFailureResult, taskId?: string) {
    setFeedback({ message: result.message, tone: "error" });
    setReviewItems([]);
    setReviewDiagnostics(result.diagnostics ?? null);

    if (taskId) {
      markTaskSeen(taskId);
    }
  }

  function handleOpenAiTask(task: AiActivityTask) {
    if (!task.result || task.status === "running") {
      return;
    }

    if (task.result.sourceRevisionId !== revision.documentRevisionId) {
      setFeedback({
        message: "Результат готовий, але рукопис уже змінився. Запустіть запит ще раз.",
        tone: "error"
      });
      markTaskSeen(task.id);
      return;
    }

    if (task.result.kind === "patch") {
      if (task.result.status === "failed") {
        applyPatchTaskFailure(task.result, task.id);
        return;
      }

      applyPatchTaskResult(task.result, task.id);
      return;
    }

    if (task.result.status === "failed") {
      applyReviewTaskFailure(task.result, task.id);
      return;
    }

    applyReviewTaskResult(task.result, task.id);
  }
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
      const taskPromise = (async (): Promise<AiPatchTaskSuccessResult | AiPatchTaskFailureResult> => {
        const response = await fetch("/api/edit/patch", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });

        if (response.status === 401) {
          const authError = await readApiErrorMessage(
            response,
            "API відхилив сесію. Оновіть сторінку. Якщо не допоможе, увійдіть знову."
          );
          return {
            kind: "patch",
            status: "failed",
            sourceRevisionId: revision.documentRevisionId,
            selection: effectiveSelection,
            message: authError,
            diagnostics: null
          };
        }

        const payload = (await response.json().catch(() => null)) as PatchResponse | null;

        if (!payload) {
          return {
            kind: "patch",
            status: "failed",
            sourceRevisionId: revision.documentRevisionId,
            selection: effectiveSelection,
            message: "Сервер повернув некоректну відповідь.",
            diagnostics: null
          };
        }

        if (!response.ok) {
          return {
            kind: "patch",
            status: "failed",
            sourceRevisionId: revision.documentRevisionId,
            selection: effectiveSelection,
            message: payload.error ?? "Не вдалося побудувати локальні правки.",
            diagnostics: "diagnostics" in payload ? payload.diagnostics : null
          };
        }

        const nextFeedback = buildFeedbackMessage(payload, response.ok);
        return {
          kind: "patch",
          status: "completed",
          sourceRevisionId: revision.documentRevisionId,
          selection: effectiveSelection,
          payload,
          feedback: nextFeedback,
          historyEntry: createPatchHistoryEntry(payload, nextFeedback)
        };
      })();
      const taskId = trackTask(
        {
          kind: "patch",
          sourceRevisionId: revision.documentRevisionId,
          title: mode === "custom" ? "Локальні правки" : "Базові правки"
        },
        taskPromise
      );
      const result = await taskPromise;

      if (!isMountedRef.current) {
        return;
      }

      if (result.status === "failed") {
        applyPatchTaskFailure(result, taskId);
        return;
      }

      applyPatchTaskResult(result, taskId);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setFeedback({
        message: error instanceof Error ? error.message : "Сталася помилка під час запиту до провайдера.",
        tone: "error"
      });
      setOperations([]);
    } finally {
      if (isMountedRef.current) {
        setIsPatchRequestInFlight(false);
      }
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
    clearActiveReviewImageJob();
    setActiveProposal(null);
    setReviewDiagnostics(null);

    try {
      const taskPromise = (async (): Promise<AiReviewTaskSuccessResult | AiReviewTaskFailureResult> => {
        const response = await fetch("/api/edit/review", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });

        if (response.status === 401) {
          const authError = await readApiErrorMessage(
            response,
            "API відхилив сесію. Оновіть сторінку. Якщо не допоможе, увійдіть знову."
          );
          return {
            kind: "review",
            status: "failed",
            sourceRevisionId: revision.documentRevisionId,
            message: authError,
            diagnostics: null
          };
        }

        const payload = (await response.json().catch(() => null)) as EditorialReviewResponse | null;

        if (!payload) {
          return {
            kind: "review",
            status: "failed",
            sourceRevisionId: revision.documentRevisionId,
            message: "Сервер повернув некоректну відповідь.",
            diagnostics: null
          };
        }

        if (!response.ok) {
          return {
            kind: "review",
            status: "failed",
            sourceRevisionId: revision.documentRevisionId,
            message: payload.error ?? "Не вдалося побудувати редакторський review.",
            diagnostics: "diagnostics" in payload ? payload.diagnostics : null
          };
        }

        const nextFeedback = buildReviewFeedbackMessage(payload, response.ok);
        return {
          kind: "review",
          status: "completed",
          sourceRevisionId: revision.documentRevisionId,
          payload,
          feedback: nextFeedback,
          historyEntry: createReviewHistoryEntry(payload, nextFeedback)
        };
      })();
      const taskId = trackTask(
        {
          kind: "review",
          sourceRevisionId: revision.documentRevisionId,
          title: "Огляд рукопису"
        },
        taskPromise
      );
      const result = await taskPromise;

      if (!isMountedRef.current) {
        return;
      }

      if (result.status === "failed") {
        applyReviewTaskFailure(result, taskId);
        return;
      }

      applyReviewTaskResult(result, taskId);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setFeedback({
        message: error instanceof Error ? error.message : "Сталася помилка під час редакторського review.",
        tone: "error"
      });
      setReviewItems([]);
    } finally {
      if (isMountedRef.current) {
        setIsReviewRequestInFlight(false);
      }
    }
  }

  async function requestReviewProposal(
    item: EditorialReviewItem,
    options?: {
      forcedCalloutKind?: EditorialCalloutKind;
      forceRegenerateCallout?: boolean;
    }
  ) {
    const effectiveCalloutKind = options?.forcedCalloutKind ?? item.calloutKind ?? item.calloutDraft?.calloutKind;
    const effectiveItem =
      effectiveCalloutKind || options?.forceRegenerateCallout
        ? {
            ...item,
            calloutKind: effectiveCalloutKind ?? item.calloutKind,
            calloutDraft:
              options?.forceRegenerateCallout && effectiveCalloutKind
                ? undefined
                : item.calloutDraft
                  ? {
                      ...item.calloutDraft,
                      calloutKind: effectiveCalloutKind ?? item.calloutDraft.calloutKind
                    }
                  : item.calloutDraft
          }
        : item;
    const inlineCalloutProposal =
      options?.forceRegenerateCallout && options.forcedCalloutKind
        ? null
        : createInlineCalloutProposal(effectiveItem, revision);

    const nextSelection = resolveReviewItemSelection(text, revision, item);

    startTransition(() => {
      setAppliedDiffs([]);
      setActiveReviewItem(effectiveItem);
      clearActiveReviewImageJob();
      setActiveProposal(null);
      setSelection(clampSelection(text, nextSelection.start, nextSelection.end));
      setSelectionRevealKey((current) => current + 1);
      setSuppressFloatingPrompt(true);
      setReviewItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                calloutKind: effectiveCalloutKind ?? entry.calloutKind,
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
      setActiveReviewItem({
        ...effectiveItem,
        calloutKind: inlineCalloutProposal.calloutDraft?.calloutKind ?? effectiveItem.calloutKind,
        calloutDraft: inlineCalloutProposal.calloutDraft
          ? {
              calloutKind: inlineCalloutProposal.calloutDraft.calloutKind,
              title: inlineCalloutProposal.calloutDraft.title,
              prompt: inlineCalloutProposal.calloutDraft.prompt,
              previewText: inlineCalloutProposal.calloutDraft.previewText ?? "",
              summary: inlineCalloutProposal.summary
            }
          : effectiveItem.calloutDraft,
        status: "ready"
      });
      setReviewItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                calloutKind: inlineCalloutProposal.calloutDraft?.calloutKind ?? entry.calloutKind,
                calloutDraft: inlineCalloutProposal.calloutDraft
                  ? {
                      calloutKind: inlineCalloutProposal.calloutDraft.calloutKind,
                      title: inlineCalloutProposal.calloutDraft.title,
                      prompt: inlineCalloutProposal.calloutDraft.prompt,
                      previewText: inlineCalloutProposal.calloutDraft.previewText ?? "",
                      summary: inlineCalloutProposal.summary
                    }
                  : entry.calloutDraft
              }
            : entry
        )
      );
      setFeedback({ message: "Врізка вже підготовлена. Можна одразу вставляти.", tone: "info" });
      return;
    }

    setIsReviewProposalInFlight(true);
    setIsReviewImageInsertionInFlight(false);
    imageInsertionGuardRef.current = null;
    clearActiveReviewImageJob();
    setFeedback(null);

    try {
      const response = await fetch("/api/edit/review/proposal", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          currentRevision: revision,
          item: effectiveItem,
          provider: settings.provider,
          modelId: normalizeModelId(settings.provider, settings.modelId),
          apiKey: settings.apiKey || undefined,
          basePrompt: settings.basePrompt,
          reviewLevelGuide: settings.reviewLevelGuide,
          calloutPromptTemplate: settings.calloutPromptTemplate,
          imagePromptTemplate: settings.imagePromptTemplate
        })
      });

      if (response.status === 401) {
        const authError = await readApiErrorMessage(
          response,
          "API відхилив сесію. Оновіть сторінку. Якщо не допоможе, увійдіть знову."
        );
        setFeedback({ message: authError, tone: "error" });
        setReviewItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "stale" } : entry)));
        return;
      }

      const payload = (await response.json().catch(() => null)) as ReviewActionResponse | null;

      if (!payload) {
        setFeedback({ message: "Сервер повернув некоректну відповідь.", tone: "error" });
        setReviewItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "stale" } : entry)));
        return;
      }

      if (!response.ok) {
        setFeedback({ message: payload.error ?? "Не вдалося підготувати чернетку дії.", tone: "error" });
        setReviewItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "stale" } : entry)));
        return;
      }

      const nextFeedback = buildReviewActionFeedbackMessage(payload, response.ok);

      startTransition(() => {
        setActiveProposal(payload.proposal);
        setActiveReviewItem({
          ...effectiveItem,
          calloutKind:
            payload.proposal.kind === "callout_prompt"
              ? payload.proposal.calloutDraft?.calloutKind ?? effectiveCalloutKind ?? effectiveItem.calloutKind
              : effectiveCalloutKind ?? effectiveItem.calloutKind,
          calloutDraft:
            payload.proposal.kind === "callout_prompt" && payload.proposal.calloutDraft
              ? {
                  calloutKind: payload.proposal.calloutDraft.calloutKind,
                  title: payload.proposal.calloutDraft.title,
                  prompt: payload.proposal.calloutDraft.prompt,
                  previewText: payload.proposal.calloutDraft.previewText ?? "",
                  summary: payload.proposal.summary
                }
              : effectiveItem.calloutDraft,
          status:
            payload.proposal.kind === "stale_anchor"
              ? "stale"
              : payload.proposal.kind === "text_diff" || payload.proposal.kind === "callout_prompt" || payload.proposal.kind === "image_prompt"
                ? "ready"
                : effectiveItem.status
        });
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  calloutKind:
                    payload.proposal.kind === "callout_prompt"
                      ? payload.proposal.calloutDraft?.calloutKind ?? effectiveCalloutKind ?? entry.calloutKind
                      : effectiveCalloutKind ?? entry.calloutKind,
                  calloutDraft:
                    payload.proposal.kind === "callout_prompt" && payload.proposal.calloutDraft
                      ? {
                          calloutKind: payload.proposal.calloutDraft.calloutKind,
                          title: payload.proposal.calloutDraft.title,
                          prompt: payload.proposal.calloutDraft.prompt,
                          previewText: payload.proposal.calloutDraft.previewText ?? "",
                          summary: payload.proposal.summary
                        }
                      : entry.calloutDraft,
                  status:
                    payload.proposal.kind === "stale_anchor" ? "stale" : payload.proposal.kind === "text_diff" || payload.proposal.kind === "callout_prompt" || payload.proposal.kind === "image_prompt" ? "ready" : entry.status
                }
              : entry
          )
        );
        setFeedback(nextFeedback);
        setHistory((current) => [createProposalHistoryEntry(payload, nextFeedback), ...current].slice(0, 8));
      });
      if (payload.proposal.kind === "callout_prompt" && payload.proposal.calloutDraft) {
        setCalloutKindOverrides((current) => {
          if (!current[item.id]) {
            return current;
          }

          const next = { ...current };
          delete next[item.id];
          return next;
        });
      }
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

    const proposalId = activeProposal.id;
    const reviewItemId = activeProposal.reviewItemId;
    let queuedJobId: string | null = null;

    clearActiveReviewImageJob();
    setIsReviewImageInFlight(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/edit/review/image", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: activeProposal.imageDraft.prompt,
          apiKey: settings.provider === "gemini" ? settings.apiKey || undefined : undefined,
          async: true
        })
      });

      if (response.status === 401) {
        const authError = await readApiErrorMessage(
          response,
          "API відхилив сесію. Оновіть сторінку. Якщо не допоможе, увійдіть знову."
        );
        setFeedback({ message: authError, tone: "error" });
        return;
      }

      const payload = (await response.json().catch(() => null)) as ReviewImageGenerationResponse | null;

      if (!payload) {
        throw new Error("Сервер повернув некоректну відповідь.");
      }

      if (payload.asset) {
        await finalizeGeneratedReviewImage(payload, proposalId, reviewItemId);
        return;
      }

      if (!response.ok || !payload.job) {
        throw new Error(payload.error ?? "Не вдалося поставити генерацію в чергу.");
      }

      setActiveReviewImageJob({
        proposalId,
        reviewItemId,
        jobId: payload.job.id,
        status: payload.job.status
      });
      queuedJobId = payload.job.id;
      updateActiveProposalImageJobState({
        proposalId,
        jobId: payload.job.id,
        status: payload.job.status,
        updatedAt: payload.job.updatedAt
      });
      setFeedback({ message: "Зображення в черзі. Чекаю результат…", tone: "info" });

      const pollResult = await pollReviewImageJob({
        proposalId,
        reviewItemId,
        jobId: payload.job.id,
        initialPollAfterMs: payload.job.pollAfterMs
      });

      if (pollResult.aborted) {
        return;
      }

      if (!pollResult.payload) {
        throw new Error("Не вдалося отримати статус генерації зображення.");
      }

      if (pollResult.payload.asset) {
        await finalizeGeneratedReviewImage(pollResult.payload, proposalId, reviewItemId);
        return;
      }

      const failureMessage = pollResult.payload.error ?? "Генерація зображення завершилась помилкою.";
      setFeedback({ message: failureMessage, tone: "error" });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      const message = error instanceof Error ? error.message : "Сталася помилка під час генерації зображення.";

      if (queuedJobId) {
        updateActiveProposalImageJobState({
          proposalId,
          jobId: queuedJobId,
          status: "failed",
          updatedAt: new Date().toISOString(),
          error: message
        });
      }

      setFeedback({
        message,
        tone: "error"
      });
    } finally {
      setIsReviewImageInFlight(false);
      clearActiveReviewImageJob();
    }
  }

  async function finalizeGeneratedReviewImage(payload: ReviewImageGenerationResponse, proposalId: string, reviewItemId: string) {
    if (!payload.asset) {
      throw new Error(payload.error ?? "Не вдалося отримати asset згенерованого зображення.");
    }

    const asset = await persistGeneratedImageAsset(payload.asset);
    setReviewImageAssets((current) => ({ ...current, [asset.assetId]: asset }));
    setActiveProposal((current) =>
      current && current.id === proposalId && current.kind === "image_prompt" && current.imageDraft
        ? {
            ...current,
            imageDraft: {
              ...current.imageDraft,
              generatedAsset: asset,
              generation: current.imageDraft.generation
                ? {
                    ...current.imageDraft.generation,
                    status: "completed",
                    updatedAt: new Date().toISOString(),
                    error: undefined
                  }
                : undefined
            }
          }
        : current
    );

    const nextFeedback = {
      message: `Згенеровано чернеткове зображення через ${payload.modelId}.`,
      tone: "info" as const
    };
    setFeedback(nextFeedback);
    setHistory((current) => [createImageHistoryEntry(payload, nextFeedback, reviewItemId), ...current].slice(0, 8));
  }

  async function pollReviewImageJob(input: {
    proposalId: string;
    reviewItemId: string;
    jobId: string;
    initialPollAfterMs: number;
  }): Promise<{ aborted: boolean; payload?: ReviewImageGenerationResponse }> {
    const controller = new AbortController();
    reviewImagePollControllerRef.current?.abort();
    reviewImagePollControllerRef.current = controller;
    let nextPollAfterMs = Math.max(300, input.initialPollAfterMs || 1200);

    try {
      while (true) {
        await waitForReviewImagePoll(nextPollAfterMs, controller.signal);

        const response = await fetch(`/api/edit/review/image?jobId=${encodeURIComponent(input.jobId)}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal
        });
        if (response.status === 401) {
          const authError = await readApiErrorMessage(
            response,
            "API відхилив сесію. Оновіть сторінку. Якщо не допоможе, увійдіть знову."
          );
          setFeedback({ message: authError, tone: "error" });
          return { aborted: true };
        }

        const payload = (await response.json().catch(() => null)) as ReviewImageGenerationResponse | null;

        if (!payload) {
          throw new Error("Сервер повернув некоректну відповідь статусу генерації.");
        }

        if (!response.ok) {
          throw new Error(payload.error ?? "Не вдалося перевірити статус генерації зображення.");
        }

        if (!payload.job) {
          throw new Error("Сервер не повернув статус черги генерації.");
        }

        setActiveReviewImageJob({
          proposalId: input.proposalId,
          reviewItemId: input.reviewItemId,
          jobId: input.jobId,
          status: payload.job.status,
          error: payload.error
        });
        updateActiveProposalImageJobState({
          proposalId: input.proposalId,
          jobId: input.jobId,
          status: payload.job.status,
          updatedAt: payload.job.updatedAt,
          error: payload.error
        });

        if (payload.job.status === "completed" || payload.job.status === "failed") {
          return { aborted: false, payload };
        }

        nextPollAfterMs = Math.max(300, payload.job.pollAfterMs || 1200);
      }
    } catch (error) {
      if (isAbortError(error)) {
        return { aborted: true };
      }

      throw error;
    } finally {
      if (reviewImagePollControllerRef.current === controller) {
        reviewImagePollControllerRef.current = null;
      }
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

  async function handleExportDocx() {
    if (isDocxExportInFlight) {
      return;
    }

    setIsDocxExportInFlight(true);

    try {
      const result = await exportMarkdownToDocx({
        markdown: text
      });
      downloadBlob(result.blob, result.fileName);

      setFeedback({
        message:
          result.warnings.length > 0
            ? `DOCX експортовано з попередженнями: ${result.warnings.length}.`
            : "DOCX успішно експортовано.",
        tone: result.warnings.length > 0 ? "error" : "info"
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Не вдалося експортувати DOCX.",
        tone: "error"
      });
    } finally {
      setIsDocxExportInFlight(false);
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
    clearActiveReviewImageJob();
    setActiveProposal(null);
    setReviewItems([]);
    setCalloutKindOverrides({});
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
      clearActiveReviewImageJob();
      setActiveProposal(null);
      setReviewItems(nextReviewItems);
      setCalloutKindOverrides({});
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
      clearActiveReviewImageJob();
      setActiveProposal(null);
      setReviewItems(nextReviewItems);
      setCalloutKindOverrides({});
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
      clearActiveReviewImageJob();
      setActiveProposal(null);
      setSelection(clampSelection(text, nextSelection.start, nextSelection.end));
      setSelectionRevealKey((current) => current + 1);
      setSuppressFloatingPrompt(true);
    });
  }

  function handleDismissReviewCard(item: EditorialReviewItem) {
    setReviewItems((current) => current.filter((entry) => entry.id !== item.id));
    setCalloutKindOverrides((current) => {
      if (!current[item.id]) {
        return current;
      }

      const next = { ...current };
      delete next[item.id];
      return next;
    });

    if (activeReviewItem?.id === item.id) {
      setActiveReviewItem(null);
      clearActiveReviewImageJob();
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
    clearActiveReviewImageJob();
    setActiveProposal(null);
    setReviewItems(nextReviewItems);
    setCalloutKindOverrides((current) => {
      if (!current[activeProposal.reviewItemId]) {
        return current;
      }

      const next = { ...current };
      delete next[activeProposal.reviewItemId];
      return next;
    });
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
    const titleToken = `# ${calloutDraft.title.trim() || getEditorialCalloutKindTitle(calloutDraft.calloutKind)}`;
    const titleOffset = insertionText.indexOf(titleToken);
    const revealStart = titleOffset === -1 ? insertionPoint : insertionPoint + titleOffset + 2;
    const revealEnd = revealStart + Math.max(calloutDraft.title.length, 1);
    const nextRevision = deriveManuscriptRevisionState(nextText, revision);
    const nextReviewItems = reconcileReviewItemsWithRevision(reviewItems, nextRevision).filter((item) => item.id !== sourceItem.id);

    setText(nextText);
    setRevision(nextRevision);
    setSelection(clampSelection(nextText, revealStart, revealEnd));
    setSelectionRevealKey((current) => current + 1);
    clearActiveReviewImageJob();
    setActiveProposal(null);
    setActiveReviewItem(null);
    setReviewItems(nextReviewItems);
    setCalloutKindOverrides((current) => {
      if (!current[sourceItem.id]) {
        return current;
      }

      const next = { ...current };
      delete next[sourceItem.id];
      return next;
    });
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
      clearActiveReviewImageJob();
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
      clearActiveReviewImageJob();
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
      clearActiveReviewImageJob();
      setActiveProposal(null);
      setReviewItems(nextReviewItems);
      setCalloutKindOverrides((current) => {
        if (!current[activeProposal.reviewItemId]) {
          return current;
        }

        const next = { ...current };
        delete next[activeProposal.reviewItemId];
        return next;
      });
      setActiveReviewItem(nextReviewItems.find((item) => item.id === activeProposal.reviewItemId) ?? null);
      const nextFeedback = { message: "Зображення вставлено.", tone: "info" as const };
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
      clearActiveReviewImageJob();
      setActiveProposal(null);
      setCalloutKindOverrides({});
      setReviewImageAssets({});
      setIsReviewImageInsertionInFlight(false);
      setSelectionRevealKey(0);
      setSuppressFloatingPrompt(false);
      setIsReviewComposerOpen(false);
      setIsClearDraftDialogOpen(false);
      setReviewComposer(defaultReviewComposer);
      imageInsertionGuardRef.current = null;
    });

    clearEditorDraftState();
  }

  function requestClearDraft() {
    if (!canClearDraft) {
      return;
    }

    setIsClearDraftDialogOpen(true);
  }

  function handleReviewCalloutKindChange(nextKind: EditorialCalloutKind) {
    if (!activeReviewItem) {
      return;
    }

    const liveItem = reviewItems.find((entry) => entry.id === activeReviewItem.id) ?? activeReviewItem;

    setCalloutKindOverrides((current) => ({
      ...current,
      [liveItem.id]: nextKind
    }));

    void requestReviewProposal(liveItem, {
      forcedCalloutKind: nextKind,
      forceRegenerateCallout: true
    });
  }

  function handleReviewImagePromptChange(nextPrompt: string) {
    setActiveProposal((current) =>
      current && current.kind === "image_prompt" && current.imageDraft
        ? {
            ...current,
            imageDraft: {
              ...current.imageDraft,
              prompt: nextPrompt.slice(0, 2400)
            }
          }
        : current
    );
  }

  return (
    <main className="app-shell">
      <TopBar activePath="/editor" />
      <ThreePaneShell
        rightState={hasRailDetailContent ? "active" : "idle"}
        center={
          <CodeMirrorCanvas
            activeReviewItem={activeReviewItem}
            activeProposal={activeProposal}
            appliedDiffs={appliedDiffs}
            canClearDraft={canClearDraft}
            exportingDocx={isDocxExportInFlight}
            loading={isAnyRequestInFlight}
            revision={revision}
            reviewItems={reviewItems}
            reviewPreparing={isReviewProposalInFlight}
            reviewImageGenerating={isReviewImageInFlight}
            reviewImageInserting={isReviewImageInsertionInFlight}
            reviewImageJobStatus={reviewImageJobStatus}
            reviewImageJobError={reviewImageJobError}
            onClearDraft={requestClearDraft}
            onAppliedDiffChange={handleAppliedDiffChange}
            onApplyReviewCallout={handleApplyCalloutProposal}
            onApplyReviewText={handleApplyReviewTextProposal}
            onDiscardAppliedDiffs={() => setAppliedDiffs([])}
            onDiscardReviewProposal={() => {
              clearActiveReviewImageJob();
              setActiveProposal(null);
            }}
            onDismissAppliedDiffs={() => setAppliedDiffs([])}
            onDismissReviewItem={() => setActiveReviewItem(null)}
            onExportDocx={() => {
              void handleExportDocx();
            }}
            onGenerateReviewImage={() => {
              void generateReviewImageAsset();
            }}
            onReviewImagePromptChange={handleReviewImagePromptChange}
            onInsertReviewImage={handleInsertReviewImageProposal}
            onInsertLocalImage={(input) => handleInsertLocalImage(input)}
            onMarkdownFormat={() => setSuppressFloatingPrompt(true)}
            onPrepareReviewItem={() => {
              if (activeReviewItem) {
                void requestReviewProposal(activeReviewItem);
              }
            }}
            selectedCalloutKind={
              activeReviewItem
                ? calloutKindOverrides[activeReviewItem.id] ??
                  activeProposal?.calloutDraft?.calloutKind ??
                  activeReviewItem.calloutDraft?.calloutKind ??
                  activeReviewItem.calloutKind
                : undefined
            }
            onCalloutKindChange={handleReviewCalloutKindChange}
            selectionRevealKey={selectionRevealKey}
            selection={selection}
            text={text}
            onSelectionChange={handleSelectionChange}
            onTextChange={handleTextChange}
          />
        }
        right={
          <RightOperationsRail
            aiTasks={backgroundAiTasks}
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
            onOpenAiTask={handleOpenAiTask}
            onDismissAiTask={dismissTask}
            onAccept={handleAccept}
            onAcceptAll={handleAcceptAll}
            onReject={handleReject}
            onRejectAll={handleRejectAll}
          />
        }
      />
      {shouldShowFloatingPrompt ? (
        <FloatingPromptPanel
          mode={floatingPromptMode}
          loading={floatingPromptMode === "review" ? isReviewRequestInFlight : isPatchRequestInFlight}
          onSubmit={(prompt) => {
            if (floatingPromptMode === "review") {
              void requestEditorialReview();
              return;
            }

            void requestPatches("custom", prompt);
          }}
          onExitReviewMode={
            floatingPromptMode === "review"
              ? () => {
                  setIsReviewComposerOpen(false);
                  setSuppressFloatingPrompt(false);
                }
              : undefined
          }
          selectionKey={
            floatingPromptMode === "review"
              ? `review:${reviewComposer.changeLevel}:${reviewComposer.additionalInstructions.length}`
              : `${selection.start}:${selection.end}`
          }
          reviewChangeLevel={reviewComposer.changeLevel}
          reviewAdditionalInstructions={reviewComposer.additionalInstructions}
          onReviewChangeLevel={(value) => setReviewComposer((current) => ({ ...current, changeLevel: value }))}
          onReviewAdditionalInstructionsChange={(value) => setReviewComposer((current) => ({ ...current, additionalInstructions: value }))}
        />
      ) : null}
      <DraftResetDialog
        open={isClearDraftDialogOpen}
        onCancel={() => setIsClearDraftDialogOpen(false)}
        onConfirm={handleClearDraft}
      />
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

function waitForReviewImagePoll(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    function onAbort() {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
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
  const normalizedKind = normalizeCalloutKindForInsertion(input.calloutKind);
  const normalizedTitle = input.title.trim() || getEditorialCalloutKindTitle(normalizedKind);
  const normalizedBody = input.body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  const markdownLines = [`::: врізка: ${getEditorialCalloutKindLabel(normalizedKind)}`, `# ${normalizedTitle}`];

  if (normalizedBody) {
    markdownLines.push(normalizedBody);
  }

  markdownLines.push(":::");

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
    `Тип врізки: ${getEditorialCalloutKindLabel(calloutKind)}.`,
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

function normalizeCalloutKindForInsertion(value: string): EditorialCalloutKind {
  return value === "mini_story" ||
    value === "mechanism_explained" ||
    value === "step_by_step" ||
    value === "myth_vs_fact" ||
    value === "quick_fact"
    ? value
    : "quick_fact";
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
