"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import { BlockEditorSurface } from "../../components/editor/BlockEditorSurface";
import { EditorialReviewCard } from "../../components/editor/EditorialReviewCard";
import { FloatingComposerPanel } from "../../components/editor/FloatingComposerPanel";
import { TopBar } from "../../components/layout/TopBar";
import { type RequestHistoryItem } from "../../components/layout/RightOperationsRail";
import { StepReviewWorkspaceShell } from "../../components/layout/StepReviewWorkspaceShell";
import { Button } from "../../components/ui/Button";
import type { EditorDocument, BlockSelection, CalloutBlock, ImageBlock, Block } from "../../lib/editor/document-model";
import {
  createBlockId,
  createEmptyParagraphBlock,
  createInlineText,
  documentToPlainText,
  EMPTY_BLOCK_SELECTION,
  getBlockText,
  insertBlocksAfter,
  normalizeBlockSelection,
  replaceBlocksByIds
} from "../../lib/editor/document-model";
import { DEFAULT_EDITOR_DOCUMENT } from "../../lib/editor/default-manuscript";
import { clearEditorDraftState, readEditorDraftState, writeEditorDraftState } from "../../lib/editor/draft-state";
import { buildDocxFileName, deriveDocxFileNameBase, exportDocumentToDocx } from "../../lib/editor/docx-export";
import { importFileToDocument, importHtmlToDocument, importPlainTextToDocument, type ImportedDocumentResult } from "../../lib/editor/import";
import {
  computeAnchorFingerprint,
  deriveManuscriptRevisionState,
  resolveReviewItemSelection,
  type ManuscriptRevisionState
} from "../../lib/editor/manuscript-structure";
import { buildManualReviewItem, upsertManualReviewItem } from "../../lib/editor/manual-review-items";
import { insertBlocksBefore } from "../../lib/editor/review-apply";
import {
  createPatchId,
  type PatchOperation,
  type PatchResponse,
  type PatchResponseDiagnostics,
  type RequestMode
} from "../../lib/editor/patch-contract";
import {
  createDefaultStepFeedbackMap,
  createDefaultStepRunModeMap,
  createEmptyStepRunHistory,
  type EditorialFactCheckRow,
  type EditorialCalloutKind,
  type EditorialReviewStepId,
  type EditorialStepFeedbackMap,
  type EditorialStepRunHistory,
  type EditorialStepRunMode,
  type EditorialStepRunModeMap,
  type VisualStylePreset,
  type EditorialVisualIntent,
  getEditorialCalloutKindTitle,
  getReviewParagraphRangeLabel,
  reconcileReviewItemsWithRevision,
  type GeneratedReviewImageAsset,
  type ChatMessage,
  type EditorialReviewDiagnostics,
  type EditorialReviewItem,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  isReplaceReviewType,
  type ReviewActionRequest,
  type ReviewActionProposal,
  type ReviewActionResponse,
  type WholeTextChangeLevel
} from "../../lib/editor/review-contract";
import {
  CHANGE_LEVEL_GUIDANCE,
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_VISUAL_STYLE_PRESET,
  VISUAL_STYLE_PRESET_STORAGE_KEY,
  normalizeVisualStylePreset,
  readEditorSettings,
  type EditorSettings
} from "../../lib/editor/settings";
import { storeEditorAssetFromBlob, storeEditorAssetFromDataUrl } from "../../lib/editor/asset-store";
import {
  ChevronDown,
  Clipboard,
  Download,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  RefreshCcw,
  Search,
  Sparkles,
  SpellCheck,
  Stethoscope,
  Table2,
  Target,
  Trash2,
  Upload
} from "lucide-react";

interface RequestFeedback {
  message: string;
  tone: "info" | "error";
}

interface DismissUndoState {
  item: EditorialReviewItem;
}

const historyTimeFormatter = new Intl.DateTimeFormat("uk-UA", {
  hour: "2-digit",
  minute: "2-digit"
});

const defaultReviewComposer: { changeLevel: WholeTextChangeLevel; additionalInstructions: string } = {
  changeLevel: 3,
  additionalInstructions: ""
};
const defaultManualCalloutKind: EditorialCalloutKind = "mechanism";
const defaultManualVisualIntent: EditorialVisualIntent = "infographic";
const defaultVisualStylePreset: VisualStylePreset = DEFAULT_VISUAL_STYLE_PRESET;
const defaultLocalActionMode = "patch" as const;

type ComposerMode = "local" | "review" | null;
type ManualGenerationKind = "callout" | "visual";
type LocalActionMode = "patch" | "callout" | "visual";
type WorkflowStepId = EditorialReviewStepId;
type TopActionMenuId = "open" | "save" | null;

const WORKFLOW_STEPS: Array<{ id: WorkflowStepId; label: string; icon: typeof Stethoscope }> = [
  { id: "diagnostics", label: "Діагностика", icon: Stethoscope },
  { id: "fact_check", label: "Перевірка фактів", icon: Search },
  { id: "structure", label: "Структура", icon: LayoutGrid },
  { id: "clarity", label: "Ясність", icon: Sparkles },
  { id: "interest", label: "Інтерес і застосовність", icon: Target },
  { id: "visuals", label: "Візуали", icon: ImageIcon },
  { id: "formatting", label: "Форматування", icon: Table2 },
  { id: "final_editing", label: "Фінальна редактура", icon: SpellCheck }
];

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
  const [reviewComposer, setReviewComposer] = useState(defaultReviewComposer);
  const [composerMode, setComposerMode] = useState<ComposerMode>(null);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [isPatchRequestInFlight, setIsPatchRequestInFlight] = useState(false);
  const [isReviewRequestInFlight, setIsReviewRequestInFlight] = useState(false);
  const [isDocxExportInFlight, setIsDocxExportInFlight] = useState(false);
  const [preparingReviewItemId, setPreparingReviewItemId] = useState<string | null>(null);
  const [isReviewImageRequestInFlight, setIsReviewImageRequestInFlight] = useState(false);
  const [reviewExpertise, setReviewExpertise] = useState<string | null>(null);
  const [activeWorkflowStep, setActiveWorkflowStep] = useState<WorkflowStepId>("diagnostics");
  const [manualCalloutKind, setManualCalloutKind] = useState<EditorialCalloutKind>(defaultManualCalloutKind);
  const [manualVisualIntent, setManualVisualIntent] = useState<EditorialVisualIntent>(defaultManualVisualIntent);
  const [manualGenerationInFlight, setManualGenerationInFlight] = useState<{ kind: ManualGenerationKind; key: string } | null>(null);
  const [localActionMode, setLocalActionMode] = useState<LocalActionMode>(defaultLocalActionMode);
  const [manualCalloutPrompt, setManualCalloutPrompt] = useState("");
  const [manualVisualPrompt, setManualVisualPrompt] = useState("");
  const [visualStylePreset, setVisualStylePreset] = useState<VisualStylePreset>(defaultVisualStylePreset);
  const [stepFeedback, setStepFeedback] = useState<EditorialStepFeedbackMap>(() => createDefaultStepFeedbackMap());
  const [stepRunModeByStep, setStepRunModeByStep] = useState<EditorialStepRunModeMap>(() => createDefaultStepRunModeMap("replace"));
  const [stepRunHistory, setStepRunHistory] = useState<EditorialStepRunHistory>(() => createEmptyStepRunHistory());
  const [factCheckRows, setFactCheckRows] = useState<EditorialFactCheckRow[]>([]);
  const [recentlyChangedBlockIds, setRecentlyChangedBlockIds] = useState<string[]>([]);
  const [dismissUndoState, setDismissUndoState] = useState<DismissUndoState | null>(null);
  const [showCompletedCards, setShowCompletedCards] = useState(false);
  const [activeTopActionMenu, setActiveTopActionMenu] = useState<TopActionMenuId>(null);
  const [isImportInFlight, setIsImportInFlight] = useState(false);
  const [reviewRefineInstruction, setReviewRefineInstruction] = useState("");
  const recentChangeTimeoutRef = useRef<number | null>(null);
  const dismissUndoTimeoutRef = useRef<number | null>(null);
  const reviewNoOpStreakRef = useRef<Record<string, number>>({});
  const patchNoOpStreakRef = useRef<Record<string, number>>({});
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedSelection = useMemo(() => normalizeBlockSelection(document, selection), [document, selection]);
  const stepItems = useMemo(() => mapReviewItemsByStep(reviewItems), [reviewItems]);
  const expertiseForDisplay = useMemo(() => {
    if (!reviewExpertise) {
      return null;
    }

    return linkifyParagraphRefs(localizeExpertiseMarkdown(reviewExpertise));
  }, [reviewExpertise]);
  const canRunDownstreamStep = Boolean(reviewExpertise?.trim()) && !isReviewRequestInFlight;
  const workflowSteps = useMemo(
    () =>
      WORKFLOW_STEPS.map((step) => ({
        ...step,
        completed:
          step.id === "diagnostics"
            ? Boolean(reviewExpertise?.trim())
            : step.id === "fact_check"
              ? factCheckRows.length > 0
              : stepItems[step.id].length > 0
      })),
    [factCheckRows.length, reviewExpertise, stepItems]
  );

  useEffect(() => {
    setSettings(readEditorSettings());
    const lastVisualStyle = normalizeVisualStylePreset(window.localStorage.getItem(VISUAL_STYLE_PRESET_STORAGE_KEY), defaultVisualStylePreset);
    setVisualStylePreset(lastVisualStyle);
    const draft = readEditorDraftState();

    if (draft) {
      setDocument(draft.document);
      setRevision(draft.revision);
      setSelection(draft.selection);
      setOperations(draft.operations);
      setReviewItems(draft.reviewItems);
      setPatchDiagnostics(draft.patchDiagnostics);
      setReviewDiagnostics(draft.reviewDiagnostics);
      setReviewExpertise(draft.reviewExpertise ?? null);
      setFactCheckRows(draft.factCheckRows ?? []);
      setActiveWorkflowStep(draft.activeWorkflowStep ?? "diagnostics");
      setStepRunHistory(draft.stepRunHistory ?? createEmptyStepRunHistory());
      setStepFeedback(draft.stepFeedback ?? createDefaultStepFeedbackMap());
      setStepRunModeByStep(draft.stepRunModeByStep ?? createDefaultStepRunModeMap("replace"));
      setFeedback(draft.feedback);
      setHistory(draft.history);
      setActiveReviewItemId(draft.activeReviewItemId);
      setActiveProposal(draft.activeProposal);
      setReviewComposer(draft.reviewComposer ?? defaultReviewComposer);
      setFocusedBlockId(draft.selection.focusBlockId ?? draft.document.blocks[0]?.id ?? null);
    }

    setHasHydratedDraft(true);
  }, []);

  useEffect(() => {
    setReviewRefineInstruction("");
  }, [activeReviewItemId]);

  function persistVisualStylePreset(preset: VisualStylePreset) {
    setVisualStylePreset(preset);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VISUAL_STYLE_PRESET_STORAGE_KEY, preset);
    }
  }

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
      reviewExpertise,
      factCheckRows,
      activeWorkflowStep,
      stepRunHistory,
      stepFeedback,
      stepRunModeByStep,
      history,
      appliedDiffs: [],
      feedback,
      activeReviewItemId,
      activeProposal,
      reviewImageAssets: {},
      reviewComposer
    });
  }, [
    activeProposal,
    activeReviewItemId,
    document,
    factCheckRows,
    feedback,
    hasHydratedDraft,
    history,
    normalizedSelection,
    operations,
    patchDiagnostics,
    reviewExpertise,
    reviewDiagnostics,
    reviewComposer,
    reviewItems,
    revision,
    activeWorkflowStep,
    stepRunHistory,
    stepFeedback,
    stepRunModeByStep
  ]);

  useEffect(() => {
    if (normalizedSelection.blockIds.length > 0) {
      setComposerMode((current) => (current === "review" ? current : "local"));
      return;
    }

    setComposerMode((current) => (current === "local" ? null : current));
  }, [normalizedSelection.blockIds]);

  useEffect(
    () => () => {
      if (recentChangeTimeoutRef.current) {
        window.clearTimeout(recentChangeTimeoutRef.current);
      }
      if (dismissUndoTimeoutRef.current) {
        window.clearTimeout(dismissUndoTimeoutRef.current);
      }
    },
    []
  );

  function commitDocument(nextDocument: EditorDocument) {
    const nextRevision = deriveManuscriptRevisionState(nextDocument);
    setDocument(nextDocument);
    setRevision(nextRevision);
    setSelection((current) => normalizeBlockSelection(nextDocument, current));
    setReviewItems((current) => reconcileReviewItemsWithRevision(current, nextDocument, nextRevision));
  }

  function createBlankDocument(): EditorDocument {
    return {
      version: 2,
      blocks: [createEmptyParagraphBlock()]
    };
  }

  function replaceEditorSession(nextDocument: EditorDocument, nextFeedback: RequestFeedback | null = null) {
    if (recentChangeTimeoutRef.current) {
      window.clearTimeout(recentChangeTimeoutRef.current);
      recentChangeTimeoutRef.current = null;
    }

    if (dismissUndoTimeoutRef.current) {
      window.clearTimeout(dismissUndoTimeoutRef.current);
      dismissUndoTimeoutRef.current = null;
    }

    const nextRevision = deriveManuscriptRevisionState(nextDocument);
    setDocument(nextDocument);
    setRevision(nextRevision);
    setSelection(EMPTY_BLOCK_SELECTION);
    setFocusedBlockId(nextDocument.blocks[0]?.id ?? null);
    setOperations([]);
    setReviewItems([]);
    setPatchDiagnostics(null);
    setReviewDiagnostics(null);
    setReviewExpertise(null);
    setFactCheckRows([]);
    setFeedback(nextFeedback);
    setHistory([]);
    setActiveReviewItemId(null);
    setActiveProposal(null);
    setReviewComposer(defaultReviewComposer);
    setComposerMode(null);
    setCustomPrompt("");
    setManualCalloutKind(defaultManualCalloutKind);
    setManualVisualIntent(defaultManualVisualIntent);
    setManualGenerationInFlight(null);
    setLocalActionMode(defaultLocalActionMode);
    setManualCalloutPrompt("");
    setManualVisualPrompt("");
    setStepFeedback(createDefaultStepFeedbackMap());
    setStepRunModeByStep(createDefaultStepRunModeMap("replace"));
    setStepRunHistory(createEmptyStepRunHistory());
    setActiveWorkflowStep("diagnostics");
    setRecentlyChangedBlockIds([]);
    setDismissUndoState(null);
    reviewNoOpStreakRef.current = {};
    patchNoOpStreakRef.current = {};
  }

  function focusAndHighlightChangedBlocks(blockIds: string[]) {
    const nextIds = Array.from(new Set(blockIds.filter(Boolean)));

    if (nextIds.length === 0) {
      return;
    }

    setRecentlyChangedBlockIds(nextIds);

    if (recentChangeTimeoutRef.current) {
      window.clearTimeout(recentChangeTimeoutRef.current);
    }

    recentChangeTimeoutRef.current = window.setTimeout(() => {
      setRecentlyChangedBlockIds([]);
      recentChangeTimeoutRef.current = null;
    }, 30_000);

    window.requestAnimationFrame(() => {
      const anchor = window.document.querySelector<HTMLElement>(`[data-block-id="${nextIds[0]}"]`);
      anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function handleScrollToBlockIndex(index: number) {
    const blockId = document?.blocks[index]?.id;
    if (!blockId) return;
    const anchor = window.document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Keep focus unchanged
  }

  function pushHistoryEntry(entry: RequestHistoryItem) {
    setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 8));
  }

  function updateStepFeedbackValue(stepId: WorkflowStepId, value: string) {
    setStepFeedback((current) => ({ ...current, [stepId]: value }));
  }

  function updateStepRunMode(stepId: WorkflowStepId, mode: EditorialStepRunMode) {
    setStepRunModeByStep((current) => ({ ...current, [stepId]: mode }));
  }

  function selectWorkflowStep(stepId: WorkflowStepId) {
    setActiveWorkflowStep(stepId);
    setShowCompletedCards(false);
    setFeedback(null);
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
      let nextFeedback = buildPatchFeedbackMessage(payload, response.ok);
      const noOpAssessment = assessPatchNoOp(payload.operations);
      const patchStreakKey = `${mode}:${targetBlockIds.join("|")}`;

      if (response.ok && !payload.error && noOpAssessment.isNoOp) {
        const nextStreak = (patchNoOpStreakRef.current[patchStreakKey] ?? 0) + 1;
        patchNoOpStreakRef.current[patchStreakKey] = nextStreak;
        nextFeedback = {
          tone: "info",
          message:
            nextStreak >= 2
              ? "Повторна локальна чернетка майже без змін. Уточніть інструкцію: що саме спростити або переписати і в якому форматі очікуєте результат."
              : "Локальна чернетка майже не змінює текст. Уточніть запит або перегенеруйте."
        };
      } else if (response.ok && !payload.error) {
        patchNoOpStreakRef.current[patchStreakKey] = 0;
      }

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

  async function requestWorkflowStep(stepId: WorkflowStepId) {
    if (stepId !== "diagnostics" && !reviewExpertise?.trim()) {
      setFeedback({ tone: "error", message: "Спочатку запустіть діагностику, щоб дати контекст для наступних кроків." });
      return;
    }

    setIsReviewRequestInFlight(true);
    setFeedback(null);
    const runMode = stepRunModeByStep[stepId] ?? "replace";
    const currentStepFeedback = stepFeedback[stepId]?.trim();
    const diagnosticsFeedback = stepFeedback.diagnostics?.trim();
    const historyMessages: ChatMessage[] = [];

    if (diagnosticsFeedback) {
      historyMessages.push({
        id: createPatchId("chat"),
        role: "user",
        content: `[Діагностика] ${diagnosticsFeedback}`,
        timestamp: new Date().toISOString()
      });
    }

    if (currentStepFeedback && (stepId !== "diagnostics" || currentStepFeedback !== diagnosticsFeedback)) {
      historyMessages.push({
        id: createPatchId("chat"),
        role: "user",
        content: `[${stepId}] ${currentStepFeedback}`,
        timestamp: new Date().toISOString()
      });
    }

    try {
      const compactReviewRevision: ManuscriptRevisionState = {
        documentRevisionId: revision.documentRevisionId,
        blockOrder: revision.blockOrder,
        // For step review we only need stable order and revision id; fingerprints are recomputed server-side when absent.
        blockFingerprints: {}
      };
      const diagnosticsPrompt = settings.expertisePrompt.trim() || settings.reviewPrompt.trim() || undefined;
      const downstreamPrompt = settings.cardsPrompt.trim() || settings.reviewPrompt.trim() || undefined;
      const requestBody: EditorialReviewRequest = {
        document,
        revision: compactReviewRevision,
        provider: settings.provider,
        modelId: settings.modelId,
        apiKey: settings.apiKey || undefined,
        basePrompt: settings.basePrompt,
        expertisePrompt: stepId === "diagnostics" ? diagnosticsPrompt : undefined,
        cardsPrompt: stepId === "diagnostics" ? undefined : downstreamPrompt,
        reviewLevelGuide: settings.reviewLevelGuide,
        changeLevel: reviewComposer.changeLevel,
        additionalInstructions: reviewComposer.additionalInstructions,
        stepId,
        runMode,
        history: historyMessages.length > 0 ? historyMessages : undefined,
        stepFeedback: currentStepFeedback || undefined,
        stepContext:
          stepId === "diagnostics"
            ? undefined
            : {
              diagnosticsExpertise: reviewExpertise ?? undefined,
              diagnosticsFeedback: diagnosticsFeedback || undefined,
              currentStepFeedback: currentStepFeedback || undefined
            },
        expertise: stepId === "diagnostics" ? undefined : reviewExpertise ?? undefined
      };

      const response = await fetch("/api/edit/review", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = (await response.json()) as EditorialReviewResponse;
      let sectionItemCount: number | undefined;

      if (payload.stepId === "diagnostics") {
        setReviewExpertise(payload.expertise?.trim() ? payload.expertise : null);
      }

      if (payload.stepId === "fact_check") {
        setFactCheckRows(payload.factCheckRows ?? []);
      }

      if (payload.stepId !== "diagnostics" && payload.stepId !== "fact_check") {
        const normalizedItems = payload.items.map((item) => ({
          ...item,
          stepId: payload.stepId,
          stepRunId: payload.stepRunId
        }));
        const baseItems =
          runMode === "replace"
            ? reviewItems.filter((item) => item.stepId && item.stepId !== payload.stepId)
            : reviewItems;
        const nextItems = [...normalizedItems, ...baseItems];
        sectionItemCount = mapReviewItemsByStep(nextItems)[payload.stepId].length;

        setReviewItems(nextItems);
      }

      const nextFeedback = buildReviewFeedbackMessage(payload, response.ok, sectionItemCount);

      const runSnapshot = {
        id: payload.stepRunId,
        stepId: payload.stepId,
        runMode: payload.runMode,
        createdAt: payload.diagnostics.generatedAt,
        documentRevisionId: revision.documentRevisionId,
        feedback: currentStepFeedback || undefined,
        expertise: payload.stepId === "diagnostics" ? payload.expertise ?? null : undefined,
        factCheckRows: payload.stepId === "fact_check" ? payload.factCheckRows ?? [] : undefined,
        itemIds: payload.stepId !== "diagnostics" && payload.stepId !== "fact_check" ? payload.items.map((item) => item.id) : undefined
      };

      setStepRunHistory((current) => {
        const currentStepRuns = current[payload.stepId] ?? [];
        return {
          ...current,
          [payload.stepId]:
            payload.runMode === "replace"
              ? [runSnapshot]
              : [runSnapshot, ...currentStepRuns.filter((entry) => entry.id !== runSnapshot.id)].slice(0, 10)
        };
      });

      if (runMode === "replace" && payload.stepId !== "diagnostics" && payload.stepId !== "fact_check") {
        setActiveReviewItemId((current) => {
          if (!current) {
            return current;
          }

          const nextItems = payload.items;
          return nextItems.some((item) => item.id === current) ? current : null;
        });
      }

      setReviewDiagnostics(payload.diagnostics);
      setFeedback(nextFeedback);
      pushHistoryEntry(
        createHistoryEntry(
          "review",
          payload.providerUsed,
          settings.provider,
          settings.modelId,
          payload.stepId === "fact_check" ? (payload.factCheckRows?.length ?? 0) : payload.items.length,
          payload.diagnostics.droppedItemCount,
          payload.usedFallback,
          nextFeedback
        )
      );

      if (payload.stepId === "diagnostics" && !payload.error) {
        setComposerMode(null); // Keep sidebar open if it's already open by other means
      }
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося запустити review."
      });
    } finally {
      setIsReviewRequestInFlight(false);
    }
  }

  function focusReviewItem(item: EditorialReviewItem) {
    const nextSelection = resolveReviewItemSelection(document, revision, item);
    // User requested to not select the paragraph to avoid triggering the local patch toolbar
    setSelection(EMPTY_BLOCK_SELECTION);
    setFocusedBlockId(nextSelection.focusBlockId ?? nextSelection.anchorBlockId);
    setActiveReviewItemId(item.id);

    const anchorBlockId = nextSelection.anchorBlockId;

    if (anchorBlockId) {
      window.requestAnimationFrame(() => {
        const element = window.document.querySelector<HTMLElement>(`[data-block-id="${anchorBlockId}"]`);
        element?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }

    // Automatically prepare the item (e.g., generate diff) when focused in compact mode
    if (item.status === "pending") {
      void prepareReviewItem(item);
    } else if (item.status === "stale") {
      void prepareReviewItem(item);
    } else if (item.status === "ready" && item.activeProposalId) {
      const existingOp = operations.find((op) => op.id === item.activeProposalId);
      if (existingOp && existingOp.op === "replace_blocks") {
        setActiveProposal({
          id: existingOp.id,
          reviewItemId: item.id,
          sourceRevisionId: revision.documentRevisionId,
          targetRevisionId: revision.documentRevisionId,
          canApplyDirectly: true,
          kind: "text_diff",
          summary: existingOp.reason,
          textDiff: {
            op: "replace_blocks",
            blockIds: existingOp.blockIds,
            oldBlocks: existingOp.oldBlocks,
            newBlocks: existingOp.newBlocks,
            reason: existingOp.reason
          }
        });
      } else if (activeProposal?.reviewItemId !== item.id && item.suggestedAction === "prepare_visual") {
        void prepareReviewItem(item);
      }
    } else if (item.status === "ready" && activeProposal?.reviewItemId !== item.id && item.suggestedAction === "prepare_visual") {
      void prepareReviewItem(item);
    }
  }

  function resetActiveExecutionLane() {
    setActiveReviewItemId(null);
    setActiveProposal(null);
    setPreparingReviewItemId(null);
    setComposerMode(null);
  }

  async function requestManualInsert(kind: ManualGenerationKind) {
    const blockIds = normalizedSelection.blockIds;

    if (blockIds.length === 0) {
      setFeedback({ tone: "error", message: "Оберіть один або кілька абзаців для ручної генерації." });
      return;
    }

    resetActiveExecutionLane();

    const recommendationType = kind === "callout" ? "callout" : "visual";
    if (kind === "visual") {
      persistVisualStylePreset(visualStylePreset);
    }
    const draftItem = buildManualReviewItem({
      document,
      revision,
      blockIds,
      changeLevel: reviewComposer.changeLevel,
      recommendationType,
      calloutKind: manualCalloutKind,
      visualIntent: manualVisualIntent,
      manualInstruction: kind === "callout" ? manualCalloutPrompt : manualVisualPrompt
    });
    const upserted = upsertManualReviewItem(reviewItems, draftItem);

    setReviewItems(upserted.items);
    setActiveReviewItemId(upserted.item.id);
    setManualGenerationInFlight({ kind, key: upserted.dedupeKey });

    try {
      await prepareReviewItem(upserted.item);
    } finally {
      setManualGenerationInFlight((current) =>
        current && current.kind === kind && current.key === upserted.dedupeKey ? null : current
      );
    }
  }

  function handleAcceptProposal(proposalId: string, nextBlocks: Block[]) {
    if (!activeProposal) return;

    if (activeProposal.kind === "text_diff" && activeProposal.textDiff) {
      const nextDocument = replaceBlocksByIds(document, activeProposal.textDiff.blockIds, nextBlocks);
      commitDocument(nextDocument);
      focusAndHighlightChangedBlocks(activeProposal.textDiff.blockIds);
      reviewNoOpStreakRef.current[activeProposal.reviewItemId] = 0;
      setOperations((current) => current.filter((op) => op.id !== proposalId));
      setReviewItems((current) =>
        current.map((entry) => (entry.id === activeProposal.reviewItemId ? { ...entry, status: "applied", activeProposalId: undefined } : entry))
      );
      setFeedback({ tone: "info", message: "Правку застосовано." });
    }

    setActiveProposal(null);
    setActiveReviewItemId(null);
  }

  function handleRejectProposal(proposalId: string) {
    setOperations((current) => current.filter((op) => op.id !== proposalId));
    const item = reviewItems.find((entry) => entry.id === activeProposal?.reviewItemId);

    if (item) {
      dismissReviewItem(item);
      return;
    }

    setActiveProposal(null);
    setActiveReviewItemId(null);
  }

  function buildReviewActionRequestBody(
    item: EditorialReviewItem,
    requestVisualStylePreset: VisualStylePreset,
    editorialInstruction?: string
  ): ReviewActionRequest {
    const isReplaceProposal = isReplaceReviewType(item.recommendationType);
    const compactItem: ReviewActionRequest["item"] = {
      id: item.id,
      reviewSessionId: item.reviewSessionId,
      documentRevisionId: item.documentRevisionId,
      changeLevel: item.changeLevel,
      title: item.title,
      reason: item.reason,
      recommendation: item.recommendation,
      recommendationType: item.recommendationType,
      suggestedAction: item.suggestedAction,
      priority: item.priority,
      anchor: item.anchor,
      insertionPoint: item.insertionPoint,
      status: item.status
    };

    if (item.calloutKind) {
      compactItem.calloutKind = item.calloutKind;
    }

    if (item.visualIntent) {
      compactItem.visualIntent = item.visualIntent;
    }

    const relatedBlockIds = Array.from(
      new Set(
        (
          isReplaceProposal
            ? [...item.anchor.blockIds]
            : [
                ...item.anchor.blockIds,
                item.insertionPoint.anchorBlockId
              ]
        ).filter((value): value is string => Boolean(value))
      )
    );
    const relatedBlocks = relatedBlockIds
      .map((blockId) => document.blocks.find((block) => block.id === blockId))
      .filter((block): block is Block => Boolean(block));

    const compactDocument = {
      version: 2 as const,
      blocks: relatedBlocks
    };

    const compactRevision = {
      documentRevisionId: revision.documentRevisionId,
      blockOrder: relatedBlockIds,
      blockFingerprints: Object.fromEntries(
        relatedBlockIds.map((blockId) => [blockId, revision.blockFingerprints[blockId] ?? ""])
      )
    } as typeof revision;

    const baseRequest: ReviewActionRequest = {
      document: compactDocument,
      currentRevision: compactRevision,
      item: compactItem,
      editorialInstruction: editorialInstruction?.trim() || undefined,
      provider: settings.provider,
      modelId: settings.modelId,
      apiKey: settings.apiKey || undefined
    };

    if (isReplaceProposal) {
      return {
        ...baseRequest,
        basePrompt: settings.basePrompt,
        reviewLevelGuide: settings.reviewLevelGuide
      };
    }

    if (item.suggestedAction === "prepare_callout") {
      return {
        ...baseRequest,
        calloutPromptTemplate: settings.calloutPromptTemplate
      };
    }

    if (item.suggestedAction === "prepare_visual") {
      return {
        ...baseRequest,
        imagePromptTemplate: settings.imagePromptTemplate,
        visualStylePreset: requestVisualStylePreset
      };
    }

    return baseRequest;
  }

  async function prepareReviewItem(
    item: EditorialReviewItem,
    options?: { visualStylePreset?: VisualStylePreset; editorialInstruction?: string }
  ) {
    const canRefreshStale =
      item.status === "stale" && item.anchor.blockIds.every((blockId) => revision.blockOrder.includes(blockId));
    const refreshFingerprint = canRefreshStale ? computeAnchorFingerprint(document, item.anchor.blockIds) : null;
    const requestItem = canRefreshStale
      ? {
        ...item,
        status: "pending" as const,
        activeProposalId: undefined,
        anchor: {
          ...item.anchor,
          fingerprint: refreshFingerprint ?? item.anchor.fingerprint
        }
      }
      : item;

    if (item.status === "stale" && !canRefreshStale) {
      setFeedback({ tone: "error", message: "Ця рекомендація застаріла після змін структури. Запустіть аналіз кроку повторно." });
      return;
    }

    setReviewItems((current) => {
      if (current.some((entry) => entry.id === requestItem.id)) {
        return current.map((entry) => (entry.id === requestItem.id ? requestItem : entry));
      }
      return [requestItem, ...current];
    });
    setActiveReviewItemId(item.id);
    setPreparingReviewItemId(item.id);
    const requestVisualStylePreset = normalizeVisualStylePreset(
      options?.visualStylePreset ?? visualStylePreset,
      defaultVisualStylePreset
    );

    if (item.recommendationType === "visual") {
      persistVisualStylePreset(requestVisualStylePreset);
    }

    try {
      const requestBody = buildReviewActionRequestBody(requestItem, requestVisualStylePreset, options?.editorialInstruction);
      const response = await fetch("/api/edit/review/proposal", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = (await response.json()) as ReviewActionResponse;

      if (payload.proposal.kind === "text_diff" && payload.proposal.textDiff) {
        const proposal = maybeEscalateReviewNoOpWarning(payload.proposal, item.id, reviewNoOpStreakRef.current);
        const textDiff = proposal.textDiff!;
        const paragraphLabel = getReviewParagraphRangeLabel(item, revision);
        setActiveProposal(proposal);
        setOperations((current) => [
          ...current,
          {
            id: proposal.id,
            op: "replace_blocks",
            blockIds: textDiff.blockIds,
            oldBlocks: textDiff.oldBlocks,
            newBlocks: textDiff.newBlocks,
            reason: textDiff.reason,
            type: "clarity",
            reviewContext: {
              recommendation: item.recommendation,
              reason: item.reason,
              paragraphLabel,
              sourceReviewItemId: item.id
            }
          }
        ]);
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, status: "ready", activeProposalId: proposal.id } : entry
          )
        );
        setReviewRefineInstruction("");
        setFeedback(null);
        return;
      }

      reviewNoOpStreakRef.current[item.id] = 0;
      setActiveProposal(payload.proposal);

      if (payload.proposal.kind === "subsection_prompt" && payload.proposal.subsectionDraft) {
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                ...entry,
                subsectionDraft: {
                  title: payload.proposal.subsectionDraft!.title,
                  lead: payload.proposal.subsectionDraft!.lead,
                  prompt: payload.proposal.subsectionDraft!.prompt
                },
                status: "ready"
              }
              : entry
          )
        );
        setReviewRefineInstruction("");
        setFeedback({ tone: "info", message: "Підзаголовок підготовлено." });
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
                  previewText: payload.proposal.calloutDraft!.previewText ?? ""
                },
                status: "ready"
              }
              : entry
          )
        );
        setReviewRefineInstruction("");
        setFeedback({ tone: "info", message: "Врізку підготовлено." });
        return;
      }

      if (payload.proposal.kind === "image_prompt" && payload.proposal.imageDraft) {
        persistVisualStylePreset(
          normalizeVisualStylePreset(payload.proposal.imageDraft.visualStylePreset, requestVisualStylePreset)
        );
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, status: "ready", activeProposalId: payload.proposal.id } : entry
          )
        );
        setReviewRefineInstruction("");
        setFeedback({ tone: "info", message: "Промпт для візуалу підготовлено." });
        return;
      }

      if (payload.error) {
        setReviewItems((current) =>
          current.map((entry) => (entry.id === item.id ? { ...entry, status: response.ok ? entry.status : "stale" } : entry))
        );
        setFeedback({ tone: response.ok ? "info" : "error", message: payload.error });
      }
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося підготувати рекомендацію."
      });
    } finally {
      setPreparingReviewItemId(null);
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
      body: splitCalloutDraftIntoParagraphs(item.calloutDraft.previewText, item.calloutDraft.calloutKind)
    };

    commitDocument(insertBlocksAfter(document, item.insertionPoint.anchorBlockId, [block]));
    focusAndHighlightChangedBlocks([block.id]);
    setReviewItems((current) =>
      current.map((entry) => (entry.id === item.id ? { ...entry, status: "applied", activeProposalId: undefined } : entry))
    );
    setActiveProposal((current) => (current?.reviewItemId === item.id ? null : current));
    setActiveReviewItemId((current) => (current === item.id ? null : current));
    setFeedback({ tone: "info", message: "Врізку вставлено." });
  }

  function applyReviewSubsection(item: EditorialReviewItem) {
    if (!item.subsectionDraft) {
      return;
    }

    const title = item.subsectionDraft.title.trim();
    const lead = item.subsectionDraft.lead?.trim() ?? "";

    if (!title) {
      return;
    }

    const blocks: Block[] = [
      {
        id: createBlockId("heading"),
        type: "heading",
        level: 3,
        content: [createInlineText(title)]
      }
    ];

    if (lead) {
      blocks.push(
        ...splitTextIntoParagraphBlocks(lead).map((part) => ({
          id: createBlockId("paragraph"),
          type: "paragraph" as const,
          content: [createInlineText(part)]
        }))
      );
    }

    commitDocument(insertBlocksBefore(document, item.insertionPoint.anchorBlockId, blocks));
    focusAndHighlightChangedBlocks(blocks.map((entry) => entry.id));
    setReviewItems((current) =>
      current.map((entry) => (entry.id === item.id ? { ...entry, status: "applied", activeProposalId: undefined } : entry))
    );
    setActiveProposal((current) => (current?.reviewItemId === item.id ? null : current));
    setActiveReviewItemId((current) => (current === item.id ? null : current));
    setFeedback({ tone: "info", message: "Підзаголовок вставлено." });
  }

  function updateActiveCalloutKind(item: EditorialReviewItem, kind: EditorialCalloutKind) {
    setReviewItems((current) =>
      current.map((entry) => {
        if (entry.id !== item.id) {
          return entry;
        }

        const fallbackTitle = getEditorialCalloutKindTitle(kind);
        const draft = entry.calloutDraft ?? {
          calloutKind: kind,
          title: fallbackTitle,
          prompt: "",
          previewText: ""
        };

        return {
          ...entry,
          calloutKind: kind,
          calloutDraft: {
            ...draft,
            calloutKind: kind,
            title: draft.title.trim() ? draft.title : fallbackTitle
          }
        };
      })
    );

    setActiveProposal((current) => {
      if (!current || current.kind !== "callout_prompt" || current.reviewItemId !== item.id) {
        return current;
      }

      const fallbackTitle = getEditorialCalloutKindTitle(kind);
      const draft = current.calloutDraft ?? {
        calloutKind: kind,
        title: fallbackTitle,
        prompt: "",
        previewText: ""
      };

      return {
        ...current,
        calloutDraft: {
          ...draft,
          calloutKind: kind,
          title: draft.title.trim() ? draft.title : fallbackTitle
        }
      };
    });
  }

  function updateActiveCalloutTitle(item: EditorialReviewItem, title: string) {
    setReviewItems((current) =>
      current.map((entry) => {
        if (entry.id !== item.id) {
          return entry;
        }

        const kind = entry.calloutDraft?.calloutKind ?? entry.calloutKind ?? "mechanism";
        return {
          ...entry,
          calloutDraft: {
            calloutKind: kind,
            title,
            prompt: entry.calloutDraft?.prompt ?? "",
            previewText: entry.calloutDraft?.previewText ?? ""
          }
        };
      })
    );

    setActiveProposal((current) => {
      if (!current || current.kind !== "callout_prompt" || current.reviewItemId !== item.id || !current.calloutDraft) {
        return current;
      }

      return {
        ...current,
        calloutDraft: {
          ...current.calloutDraft,
          title
        }
      };
    });
  }

  function updateActiveCalloutBody(item: EditorialReviewItem, body: string) {
    setReviewItems((current) =>
      current.map((entry) => {
        if (entry.id !== item.id) {
          return entry;
        }

        const kind = entry.calloutDraft?.calloutKind ?? entry.calloutKind ?? "mechanism";
        return {
          ...entry,
          calloutDraft: {
            calloutKind: kind,
            title: entry.calloutDraft?.title ?? getEditorialCalloutKindTitle(kind),
            prompt: entry.calloutDraft?.prompt ?? "",
            previewText: body
          }
        };
      })
    );

    setActiveProposal((current) => {
      if (!current || current.kind !== "callout_prompt" || current.reviewItemId !== item.id || !current.calloutDraft) {
        return current;
      }

      return {
        ...current,
        calloutDraft: {
          ...current.calloutDraft,
          previewText: body
        }
      };
    });
  }

  function updateActiveSubsectionTitle(item: EditorialReviewItem, title: string) {
    setReviewItems((current) =>
      current.map((entry) => {
        if (entry.id !== item.id) {
          return entry;
        }

        return {
          ...entry,
          subsectionDraft: {
            title,
            lead: entry.subsectionDraft?.lead ?? "",
            prompt: entry.subsectionDraft?.prompt ?? ""
          }
        };
      })
    );

    setActiveProposal((current) => {
      if (!current || current.kind !== "subsection_prompt" || current.reviewItemId !== item.id || !current.subsectionDraft) {
        return current;
      }

      return {
        ...current,
        subsectionDraft: {
          ...current.subsectionDraft,
          title
        }
      };
    });
  }

  function updateActiveSubsectionLead(item: EditorialReviewItem, lead: string) {
    setReviewItems((current) =>
      current.map((entry) => {
        if (entry.id !== item.id) {
          return entry;
        }

        return {
          ...entry,
          subsectionDraft: {
            title: entry.subsectionDraft?.title ?? entry.title,
            lead,
            prompt: entry.subsectionDraft?.prompt ?? ""
          }
        };
      })
    );

    setActiveProposal((current) => {
      if (!current || current.kind !== "subsection_prompt" || current.reviewItemId !== item.id || !current.subsectionDraft) {
        return current;
      }

      return {
        ...current,
        subsectionDraft: {
          ...current.subsectionDraft,
          lead
        }
      };
    });
  }

  function updateActiveImagePrompt(prompt: string) {
    setActiveProposal((current) => {
      if (!current || current.kind !== "image_prompt" || !current.imageDraft) {
        return current;
      }

      return {
        ...current,
        imageDraft: {
          ...current.imageDraft,
          prompt
        }
      };
    });
  }

  function updateActiveImageCaption(caption: string) {
    setActiveProposal((current) => {
      if (!current || current.kind !== "image_prompt" || !current.imageDraft) {
        return current;
      }

      return {
        ...current,
        imageDraft: {
          ...current.imageDraft,
          caption
        }
      };
    });
  }

  function updateActiveVisualIntent(item: EditorialReviewItem, intent: EditorialVisualIntent) {
    setReviewItems((current) =>
      current.map((entry) => (entry.id === item.id ? { ...entry, visualIntent: intent } : entry))
    );

    setActiveProposal((current) => {
      if (!current || current.kind !== "image_prompt" || current.reviewItemId !== item.id || !current.imageDraft) {
        return current;
      }

      return {
        ...current,
        imageDraft: {
          ...current.imageDraft,
          visualIntent: intent,
          generatedAsset: undefined
        }
      };
    });
  }

  function updateActiveVisualStylePreset(preset: VisualStylePreset) {
    const normalizedPreset = normalizeVisualStylePreset(preset, defaultVisualStylePreset);
    persistVisualStylePreset(normalizedPreset);
    setActiveProposal((current) => {
      if (
        !current ||
        current.kind !== "image_prompt" ||
        !current.imageDraft ||
        current.reviewItemId !== activeReviewItemId
      ) {
        return current;
      }

      return {
        ...current,
        imageDraft: {
          ...current.imageDraft,
          visualStylePreset: normalizedPreset,
          generatedAsset: undefined
        }
      };
    });
  }

  async function generateActiveReviewImage() {
    if (!activeProposal || activeProposal.kind !== "image_prompt" || !activeProposal.imageDraft) {
      return;
    }

    persistVisualStylePreset(
      normalizeVisualStylePreset(activeProposal.imageDraft.visualStylePreset ?? visualStylePreset, defaultVisualStylePreset)
    );
    setIsReviewImageRequestInFlight(true);

    try {
      const response = await fetch("/api/edit/review/image", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: activeProposal.imageDraft.prompt,
          apiKey: settings.apiKey || undefined
        })
      });
      const payload = (await response.json()) as { asset?: GeneratedReviewImageAsset; error?: string };

      if (!response.ok || !payload.asset) {
        setFeedback({ tone: response.ok ? "info" : "error", message: payload.error || "Не вдалося згенерувати візуал." });
        return;
      }

      setActiveProposal((current) => {
        if (!current || current.kind !== "image_prompt" || !current.imageDraft) {
          return current;
        }

        return {
          ...current,
          imageDraft: {
            ...current.imageDraft,
            generatedAsset: payload.asset
          }
        };
      });
      setFeedback({ tone: "info", message: "Візуал згенеровано." });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося згенерувати візуал."
      });
    } finally {
      setIsReviewImageRequestInFlight(false);
    }
  }

  async function applyActiveReviewImage() {
    const proposal = activeProposal;

    if (!proposal || proposal.kind !== "image_prompt" || !proposal.imageDraft?.generatedAsset) {
      return;
    }

    const asset = proposal.imageDraft.generatedAsset;
    const stored =
      asset.source.kind === "data_url"
        ? await storeEditorAssetFromDataUrl({ dataUrl: asset.source.dataUrl, assetId: asset.assetId, mimeType: asset.mimeType })
        : asset.source.kind === "asset_token"
          ? { assetId: asset.assetId, token: asset.source.token, mimeType: asset.mimeType }
          : { assetId: asset.assetId, token: asset.source.url, mimeType: asset.mimeType };

    const block: ImageBlock = {
      id: createBlockId("image"),
      type: "image",
      assetId: stored.assetId,
      alt: proposal.imageDraft.alt,
      caption: proposal.imageDraft.caption ? [createInlineText(proposal.imageDraft.caption)] : [createInlineText("")]
    };

    const item = reviewItems.find((entry) => entry.id === proposal.reviewItemId);
    commitDocument(insertBlocksAfter(document, item?.insertionPoint.anchorBlockId ?? null, [block]));
    focusAndHighlightChangedBlocks([block.id]);
    setReviewItems((current) =>
      current.map((entry) => (entry.id === proposal.reviewItemId ? { ...entry, status: "applied", activeProposalId: undefined } : entry))
    );
    setActiveProposal(null);
    setActiveReviewItemId(null);
    setFeedback({ tone: "info", message: "Візуал вставлено." });
  }

  function dismissReviewItem(item: EditorialReviewItem) {
    if (dismissUndoTimeoutRef.current) {
      window.clearTimeout(dismissUndoTimeoutRef.current);
      dismissUndoTimeoutRef.current = null;
    }

    setReviewItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "dismissed" } : entry)));
    if (activeReviewItemId === item.id) {
      setActiveReviewItemId(null);
      setActiveProposal((current) => (current?.reviewItemId === item.id ? null : current));
    }

    setDismissUndoState({ item });
    dismissUndoTimeoutRef.current = window.setTimeout(() => {
      setDismissUndoState(null);
      dismissUndoTimeoutRef.current = null;
    }, 5_000);
  }

  function undoDismissReviewItem() {
    if (!dismissUndoState) {
      return;
    }

    if (dismissUndoTimeoutRef.current) {
      window.clearTimeout(dismissUndoTimeoutRef.current);
      dismissUndoTimeoutRef.current = null;
    }

    const restoreItem = dismissUndoState.item;
    setReviewItems((current) => current.map((entry) => (entry.id === restoreItem.id ? restoreItem : entry)));
    setDismissUndoState(null);
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
    setActiveTopActionMenu(null);
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

  function handleExportTxt() {
    setActiveTopActionMenu(null);

    try {
      const plainText = documentToPlainText(document);
      const blob = new Blob([plainText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = buildDocxFileName(deriveDocxFileNameBase(document)).replace(/\.docx$/i, ".txt");
      anchor.click();
      URL.revokeObjectURL(url);
      setFeedback({ tone: "info", message: "TXT експортовано." });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося експортувати TXT."
      });
    }
  }

  async function handleImportFromClipboard() {
    setActiveTopActionMenu(null);
    setIsImportInFlight(true);

    try {
      let imported: ImportedDocumentResult | null = null;

      if (typeof navigator.clipboard.read === "function") {
        try {
          const items = await navigator.clipboard.read();

          for (const item of items) {
            if (item.types.includes("text/html")) {
              const html = await (await item.getType("text/html")).text();
              const fallbackText = item.types.includes("text/plain") ? await (await item.getType("text/plain")).text() : "";
              imported = importHtmlToDocument(html, fallbackText);
              break;
            }

            if (item.types.includes("text/plain")) {
              const text = await (await item.getType("text/plain")).text();
              imported = {
                ...importPlainTextToDocument(text),
                format: "clipboard_text"
              };
              break;
            }
          }
        } catch {
          imported = null;
        }
      }

      if (!imported) {
        const text = await navigator.clipboard.readText();
        imported = {
          ...importPlainTextToDocument(text),
          format: "clipboard_text"
        };
      }

      replaceEditorSession(imported.document, buildImportFeedback(imported));
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося прочитати буфер обміну."
      });
    } finally {
      setIsImportInFlight(false);
    }
  }

  function handleImportFileClick() {
    setActiveTopActionMenu(null);
    importFileInputRef.current?.click();
  }

  async function handleImportFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    setIsImportInFlight(true);

    try {
      const imported = await importFileToDocument(file);
      replaceEditorSession(imported.document, buildImportFeedback(imported));
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося імпортувати файл."
      });
    } finally {
      setIsImportInFlight(false);
    }
  }

  function handleClearDocument() {
    setActiveTopActionMenu(null);
    replaceEditorSession(createBlankDocument(), { tone: "info", message: "Документ очищено." });
  }

  function handleResetDraft() {
    setActiveTopActionMenu(null);
    setShowCompletedCards(false);
    clearEditorDraftState();
    replaceEditorSession(DEFAULT_EDITOR_DOCUMENT);
  }

  const canRequestReview = document.blocks.length > 0;
  const activeStepMeta = WORKFLOW_STEPS.find((step) => step.id === activeWorkflowStep) ?? WORKFLOW_STEPS[0];
  const ActiveStepIcon = activeStepMeta.icon;
  const activeStepIndex = Math.max(
    1,
    WORKFLOW_STEPS.findIndex((step) => step.id === activeWorkflowStep) + 1
  );
  const activeStepItems = stepItems[activeWorkflowStep];
  const visibleActiveStepItems = activeStepItems.filter(
    (item) => showCompletedCards || (item.status !== "applied" && item.status !== "dismissed")
  );
  const activeStepRunCount = stepRunHistory[activeWorkflowStep].length;
  const isUnstartedRecommendationStep =
    activeWorkflowStep !== "diagnostics" &&
    activeWorkflowStep !== "fact_check" &&
    activeStepRunCount === 0 &&
    activeStepItems.length === 0;
  const activeStepCardStats = useMemo(
    () => getStepCardStats(reviewItems, activeWorkflowStep),
    [activeWorkflowStep, reviewItems]
  );
  const reviewModeSummary = useMemo(
    () => buildReviewModeSummary(reviewComposer.changeLevel, document.blocks.length),
    [reviewComposer.changeLevel, document.blocks.length]
  );
  const runStepButton = activeWorkflowStep === "diagnostics"
    ? (
      <Button
        variant="secondary"
        className="step-review-head-action-button"
        size="sm"
        onClick={() => void requestWorkflowStep("diagnostics")}
        loading={isReviewRequestInFlight}
        disabled={!canRequestReview}
        style={{ paddingInline: "10px" }}
        aria-label={reviewExpertise ? "Повторити аналіз" : "Запустити діагностику"}
        title={reviewExpertise ? "Повторити аналіз" : "Запустити діагностику"}
      >
        <RefreshCcw size={14} aria-hidden="true" />
      </Button>
    )
    : activeWorkflowStep === "fact_check"
      ? (
        <Button
          variant="secondary"
          className="step-review-head-action-button"
          size="sm"
          onClick={() => void requestWorkflowStep("fact_check")}
          loading={isReviewRequestInFlight}
          disabled={!canRunDownstreamStep}
          style={{ paddingInline: "10px" }}
          aria-label={factCheckRows.length > 0 ? "Повторити аналіз" : "Запустити факт-чек"}
          title={factCheckRows.length > 0 ? "Повторити аналіз" : "Запустити факт-чек"}
        >
          <RefreshCcw size={14} aria-hidden="true" />
        </Button>
      )
      : (
        <Button
          variant="secondary"
          className="step-review-head-action-button"
          size="sm"
          onClick={() => void requestWorkflowStep(activeWorkflowStep)}
          loading={isReviewRequestInFlight}
          disabled={!canRunDownstreamStep}
          style={{ paddingInline: "10px" }}
          aria-label={activeStepRunCount > 0 || activeStepItems.length > 0 ? "Повторити аналіз" : "Згенерувати картки"}
          title={activeStepRunCount > 0 || activeStepItems.length > 0 ? "Повторити аналіз" : "Згенерувати картки"}
        >
          {activeStepRunCount > 0 || activeStepItems.length > 0 ? (
            <RefreshCcw size={14} aria-hidden="true" />
          ) : (
            <Sparkles size={14} aria-hidden="true" />
          )}
        </Button>
      );

  return (
    <>
      <TopBar activePath="/editor" />
      <StepReviewWorkspaceShell
        manuscript={
          <main className="editor-page-shell">
            <div className="editor-page-actions">
              <div className="editor-page-actions-group">
                <EditorActionMenu
                  label="Відкрити"
                  icon={FolderOpen}
                  open={activeTopActionMenu === "open"}
                  busy={isImportInFlight}
                  onToggle={() => setActiveTopActionMenu((current) => (current === "open" ? null : "open"))}
                  items={[
                    { label: "Файл", icon: Upload, onClick: handleImportFileClick },
                    { label: "З буфера обміну", icon: Clipboard, onClick: () => void handleImportFromClipboard() }
                  ]}
                />
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="editor-hidden-input"
                  onChange={handleImportFileSelection}
                />
              </div>

              <div className="editor-page-actions-group editor-page-actions-group-end">
                <EditorActionMenu
                  label="Зберегти"
                  icon={Download}
                  open={activeTopActionMenu === "save"}
                  busy={isDocxExportInFlight}
                  onToggle={() => setActiveTopActionMenu((current) => (current === "save" ? null : "save"))}
                  items={[
                    { label: "DOCX", icon: Download, onClick: () => void handleExportDocx(), disabled: isDocxExportInFlight },
                    { label: "TXT", icon: FileText, onClick: handleExportTxt }
                  ]}
                />
                <button
                  type="button"
                  className="editor-danger-icon-button"
                  onClick={handleClearDocument}
                  title="Очистити документ"
                  aria-label="Очистити документ"
                >
                  <Trash2 size={15} />
                </button>
                <Button variant="ghost" size="sm" onClick={handleResetDraft}>
                  Скинути
                </Button>
              </div>
            </div>

            <BlockEditorSurface
              document={document}
              revision={revision}
              selection={normalizedSelection}
              focusedBlockId={focusedBlockId}
              onDocumentChange={commitDocument}
              onSelectionChange={setSelection}
              onFocusedBlockChange={setFocusedBlockId}
              onInsertImage={handleInsertImage}
              activeProposal={activeProposal}
              activeReviewItem={reviewItems.find((item) => item.id === activeReviewItemId) ?? null}
              preparingReviewItemId={preparingReviewItemId}
              recentlyChangedBlockIds={recentlyChangedBlockIds}
              reviewItems={reviewItems}
              onAcceptProposal={handleAcceptProposal}
              onRejectProposal={handleRejectProposal}
              onPrepareReviewItem={(item, options) => void prepareReviewItem(item, options)}
              reviewRefineInstruction={reviewRefineInstruction}
              onReviewRefineInstructionChange={setReviewRefineInstruction}
              onApplyReviewCallout={applyReviewCallout}
              onApplyReviewSubsection={applyReviewSubsection}
              onDismissReviewItem={dismissReviewItem}
              onUpdateActiveCalloutKind={updateActiveCalloutKind}
              onUpdateActiveCalloutTitle={updateActiveCalloutTitle}
              onUpdateActiveCalloutBody={updateActiveCalloutBody}
              onUpdateActiveSubsectionTitle={updateActiveSubsectionTitle}
              onUpdateActiveSubsectionLead={updateActiveSubsectionLead}
              onUpdateActiveVisualIntent={updateActiveVisualIntent}
              onUpdateActiveImagePrompt={updateActiveImagePrompt}
              onUpdateActiveImageCaption={updateActiveImageCaption}
              onUpdateActiveVisualStylePreset={updateActiveVisualStylePreset}
              activeVisualStylePreset={visualStylePreset}
              onGenerateActiveReviewImage={() => void generateActiveReviewImage()}
              onApplyActiveReviewImage={() => void applyActiveReviewImage()}
              reviewImageLoading={isReviewImageRequestInFlight}
            />

            {composerMode ? (
              <FloatingComposerPanel
                mode={composerMode}
                selectedBlockCount={normalizedSelection.blockIds.length}
                customPrompt={customPrompt}
                onCustomPromptChange={setCustomPrompt}
                onRequestDefaultPatch={() => {
                  void requestPatch("default");
                  setComposerMode(null);
                }}
                onRequestCustomPatch={() => {
                  void requestPatch("custom");
                  setComposerMode(null);
                }}
                reviewChangeLevel={reviewComposer.changeLevel}
                reviewAdditionalInstructions={reviewComposer.additionalInstructions}
                onReviewChangeLevel={(level: WholeTextChangeLevel) => setReviewComposer((current) => ({ ...current, changeLevel: level }))}
                onReviewAdditionalInstructionsChange={(value) => setReviewComposer((current) => ({ ...current, additionalInstructions: value }))}
                onRequestReview={() => void requestWorkflowStep(activeWorkflowStep)}
                patchLoading={isPatchRequestInFlight}
                reviewLoading={isReviewRequestInFlight}
                localActionMode={localActionMode}
                onLocalActionModeChange={setLocalActionMode}
                manualCalloutKind={manualCalloutKind}
                manualVisualIntent={manualVisualIntent}
                manualVisualStylePreset={visualStylePreset}
                onManualCalloutKindChange={setManualCalloutKind}
                onManualVisualIntentChange={setManualVisualIntent}
                onManualVisualStylePresetChange={persistVisualStylePreset}
                manualCalloutPrompt={manualCalloutPrompt}
                manualVisualPrompt={manualVisualPrompt}
                onManualCalloutPromptChange={setManualCalloutPrompt}
                onManualVisualPromptChange={setManualVisualPrompt}
                onRequestManualCallout={() => void requestManualInsert("callout")}
                onRequestManualVisual={() => void requestManualInsert("visual")}
                manualLoadingKind={manualGenerationInFlight?.kind ?? null}
                onClose={() => setComposerMode(null)}
              />
            ) : null}
          </main>
        }
        drawer={
          <section className="step-review-workspace">
            <header className="step-review-workspace-head">
              <div className="step-review-workspace-title-stack">
                <h3 className="step-review-workspace-title">
                  <ActiveStepIcon className="step-review-workspace-title-icon" aria-hidden="true" />
                  <span>{activeStepMeta.label}</span>
                </h3>
                <p className="step-review-workspace-counter mono-ui">
                  Етап {activeStepIndex} / {WORKFLOW_STEPS.length}
                </p>
              </div>
              <div className="step-review-workspace-head-meta">
                <div className="step-review-workspace-head-action">
                  {runStepButton}
                </div>
              </div>
            </header>

            {dismissUndoState ? (
              <div className="step-review-undo-toast" role="status" aria-live="polite">
                <span>Рекомендацію відхилено.</span>
                <Button size="sm" variant="ghost" onClick={undoDismissReviewItem}>
                  Повернути
                </Button>
              </div>
            ) : null}

            <div className="step-review-workspace-scroll">
              {activeWorkflowStep === "diagnostics" ? (
                <div className="step-review-section-stack">
                  <details className="step-review-config-details">
                    <summary className="step-review-config-summary">
                      <div className="step-review-config-summary-left">
                        <svg className="step-review-config-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        <span>Налаштування запуску</span>
                      </div>
                      <span className="step-review-config-badge">{stepRunHistory.diagnostics.length}</span>
                    </summary>
                    <div className="step-review-config-body">
                      <select
                        id="diagnostics-run-mode"
                        className="step-review-inline-select"
                        value={stepRunModeByStep.diagnostics}
                        onChange={(event) => updateStepRunMode("diagnostics", event.target.value as EditorialStepRunMode)}
                      >
                        <option value="replace">Замінити попередній</option>
                        <option value="preserve">Зберегти окремим запуском</option>
                      </select>
                      <div className="step-review-inline-levels">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <button
                            key={level}
                            type="button"
                            className="step-review-inline-level-button"
                            data-active={reviewComposer.changeLevel === level ? "true" : "false"}
                            onClick={() => setReviewComposer((current) => ({ ...current, changeLevel: level as WholeTextChangeLevel }))}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                      <p className="step-review-mode-summary">{reviewModeSummary}</p>
                      <textarea
                        className="step-review-inline-textarea"
                        rows={2}
                        placeholder="Додаткові інструкції (опціонально)"
                        value={reviewComposer.additionalInstructions}
                        onChange={(event) =>
                          setReviewComposer((current) => ({ ...current, additionalInstructions: event.target.value }))
                        }
                      />
                    </div>
                  </details>
                  {reviewExpertise ? (
                    <div className="button-row">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => selectWorkflowStep("fact_check")}
                      >
                        До факт-чеку
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setReviewExpertise(null);
                          setFactCheckRows([]);
                          setStepRunHistory((current) => ({
                            ...current,
                            diagnostics: [],
                            fact_check: []
                          }));
                        }}
                      >
                        Скинути
                      </Button>
                    </div>
                  ) : null}

                  <div className="step-review-analysis-card">
                    {expertiseForDisplay ? (
                      <ReactMarkdown
                        components={{
                          a: ({ href, children }) => {
                            if (href?.startsWith("#block-")) {
                              const index = Number.parseInt(href.replace("#block-", ""), 10);
                              return (
                                <button
                                  type="button"
                                  className="step-review-analysis-link"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    if (!Number.isNaN(index)) {
                                      handleScrollToBlockIndex(index);
                                    }
                                  }}
                                >
                                  {children}
                                </button>
                              );
                            }

                            return (
                              <a href={href} target="_blank" rel="noopener noreferrer">
                                {children}
                              </a>
                            );
                          }
                        }}
                      >
                        {expertiseForDisplay}
                      </ReactMarkdown>
                    ) : (
                      <p className="step-review-empty-copy">
                        Запустіть діагностику, щоб отримати детальний огляд.
                      </p>
                    )}
                  </div>

                  {reviewExpertise ? (
                    <>
                      <textarea
                        className="step-review-inline-textarea"
                        rows={3}
                        placeholder="Ваш фідбек до діагностики (збережеться для наступних кроків)"
                        value={stepFeedback.diagnostics}
                        onChange={(event) => updateStepFeedbackValue("diagnostics", event.target.value)}
                      />
                    </>
                  ) : null}
                </div>
              ) : null}

              {activeWorkflowStep === "fact_check" ? (
                <div className="step-review-section-stack">
                  <details className="step-review-config-details">
                    <summary className="step-review-config-summary">
                      <div className="step-review-config-summary-left">
                        <svg className="step-review-config-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        <span>Налаштування запуску</span>
                      </div>
                      <span className="step-review-config-badge">{stepRunHistory.fact_check.length}</span>
                    </summary>
                    <div className="step-review-config-body">
                      <select
                        id="factcheck-run-mode"
                        className="step-review-inline-select"
                        value={stepRunModeByStep.fact_check}
                        onChange={(event) => updateStepRunMode("fact_check", event.target.value as EditorialStepRunMode)}
                      >
                        <option value="replace">Замінити попередній</option>
                        <option value="preserve">Зберегти окремим запуском</option>
                      </select>
                      <div className="step-review-inline-levels">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <button
                            key={level}
                            type="button"
                            className="step-review-inline-level-button"
                            data-active={reviewComposer.changeLevel === level ? "true" : "false"}
                            onClick={() => setReviewComposer((current) => ({ ...current, changeLevel: level as WholeTextChangeLevel }))}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                      <p className="step-review-mode-summary">{reviewModeSummary}</p>
                      <textarea
                        className="step-review-inline-textarea"
                        rows={2}
                        placeholder="Додаткові інструкції (глобально для всіх кроків)"
                        value={reviewComposer.additionalInstructions}
                        onChange={(event) =>
                          setReviewComposer((current) => ({ ...current, additionalInstructions: event.target.value }))
                        }
                      />
                      <textarea
                        className="step-review-inline-textarea"
                        rows={2}
                        placeholder="Фокус факт-чеку (опціонально)"
                        value={stepFeedback.fact_check}
                        onChange={(event) => updateStepFeedbackValue("fact_check", event.target.value)}
                      />
                    </div>
                  </details>
                  <div className="step-review-fact-table-wrapper">
                    <table className="step-review-fact-table">
                      <thead>
                        <tr>
                          <th>Твердження</th>
                          <th>Статус</th>
                          <th>Пояснення та джерела</th>
                        </tr>
                      </thead>
                      <tbody>
                        {factCheckRows.map((row, index) => (
                          <tr key={`${row.claim}-${index}`}>
                            <td>{row.claim}</td>
                            <td>
                              <span className={`step-review-fact-status step-review-fact-status-${toFactStatusClassName(row.status)}`}>
                                {row.status}
                              </span>
                            </td>
                            <td>
                              <div className="step-review-fact-evidence">
                                <p className="step-review-fact-explanation">{row.explanation}</p>
                                {row.sources.length > 0 ? (
                                  <div className="step-review-fact-sources">
                                    {row.sources.map((source) => (
                                      <a
                                        key={`${source.url}-${source.title}`}
                                        className="step-review-fact-source-link"
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={source.title}
                                      >
                                        {source.domain}
                                      </a>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="step-review-fact-source-empty">Немає надійного джерела</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {factCheckRows.length === 0 ? (
                    <p className="step-review-empty-copy">
                      Після діагностики тут з’явиться таблиця перевірки фактів.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {activeWorkflowStep !== "diagnostics" && activeWorkflowStep !== "fact_check" ? (
                <div className="step-review-section-stack">
                  <details className="step-review-config-details">
                    <summary className="step-review-config-summary">
                      <div className="step-review-config-summary-left">
                        <svg className="step-review-config-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        <span>Налаштування запуску</span>
                      </div>
                      <span className="step-review-config-badge">{stepRunHistory[activeWorkflowStep].length}</span>
                    </summary>
                    <div className="step-review-config-body">
                      <select
                        id="generic-step-run-mode"
                        className="step-review-inline-select"
                        value={stepRunModeByStep[activeWorkflowStep]}
                        onChange={(event) => updateStepRunMode(activeWorkflowStep, event.target.value as EditorialStepRunMode)}
                      >
                        <option value="replace">Замінити попередній</option>
                        <option value="preserve">Зберегти окремим запуском</option>
                      </select>
                      <div className="step-review-inline-levels">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <button
                            key={level}
                            type="button"
                            className="step-review-inline-level-button"
                            data-active={reviewComposer.changeLevel === level ? "true" : "false"}
                            onClick={() => setReviewComposer((current) => ({ ...current, changeLevel: level as WholeTextChangeLevel }))}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                      <p className="step-review-mode-summary">{reviewModeSummary}</p>
                      <textarea
                        className="step-review-inline-textarea"
                        rows={2}
                        placeholder="Додаткові інструкції (глобально для всіх кроків)"
                        value={reviewComposer.additionalInstructions}
                        onChange={(event) =>
                          setReviewComposer((current) => ({ ...current, additionalInstructions: event.target.value }))
                        }
                      />
                      <textarea
                        className="step-review-inline-textarea"
                        rows={2}
                        placeholder="Ваш фідбек для цього кроку (опціонально)"
                        value={stepFeedback[activeWorkflowStep]}
                        onChange={(event) => updateStepFeedbackValue(activeWorkflowStep, event.target.value)}
                      />
                    </div>
                  </details>

                  {feedback?.message && feedback.tone === "error" ? (
                    <p className="step-review-status-copy" data-tone={feedback.tone}>
                      {feedback.message}
                    </p>
                  ) : null}

                  <section className="step-review-subsection">
                    <div className="step-review-subsection-head">
                      <p className="mono-ui operations-title">Рекомендації</p>
                      <div className="step-review-subsection-meta">
                        <p className="step-review-cards-counter" aria-label="Лічильник карток">
                          <span className="step-review-cards-counter-value step-review-cards-counter-total">
                            {activeStepCardStats.actionable} в роботі
                          </span>
                          <span className="step-review-cards-counter-separator">·</span>
                          <span className="step-review-cards-counter-value step-review-cards-counter-applied">
                            {activeStepCardStats.applied} погоджено
                          </span>
                          <span className="step-review-cards-counter-separator">·</span>
                          <span className="step-review-cards-counter-value step-review-cards-counter-dismissed">
                            {activeStepCardStats.dismissed} відхилено
                          </span>
                        </p>
                        <button
                          type="button"
                          className="step-review-completed-toggle"
                          data-active={showCompletedCards ? "true" : "false"}
                          onClick={() => setShowCompletedCards((current) => !current)}
                        >
                          {showCompletedCards ? "Сховати завершені" : "Показати завершені"}
                        </button>
                      </div>
                    </div>
                    <div className="operations-stack operations-stack-compact">
                      {visibleActiveStepItems.map((item) => (
                        <EditorialReviewCard
                          key={item.id}
                          item={item}
                          revision={revision}
                          isActive={item.id === activeReviewItemId}
                          onFocus={focusReviewItem}
                          onPrepare={(entry) => void prepareReviewItem(entry)}
                          onApplyCallout={applyReviewCallout}
                          onDismiss={dismissReviewItem}
                          isLoading={item.id === preparingReviewItemId}
                        />
                      ))}
                    </div>
                    {visibleActiveStepItems.length === 0 ? (
                      isUnstartedRecommendationStep ? (
                        <div className="step-review-empty-state">
                          <p className="step-review-empty-copy">Для цього етапу ще немає карток.</p>
                          <Button
                            variant="secondary"
                            className="step-review-empty-cta"
                            size="sm"
                            onClick={() => void requestWorkflowStep(activeWorkflowStep)}
                            loading={isReviewRequestInFlight}
                            disabled={!canRunDownstreamStep}
                          >
                            <span className="button-content">
                              <Sparkles size={14} aria-hidden="true" />
                              <span>Згенерувати картки</span>
                            </span>
                          </Button>
                        </div>
                      ) : (
                        <p className="step-review-empty-copy">
                          {activeStepCardStats.actionable === 0 && (activeStepCardStats.applied > 0 || activeStepCardStats.dismissed > 0)
                            ? "Усі картки для цього етапу вже завершено. Увімкніть показ завершених, щоб переглянути їх."
                            : "Для цього етапу ще немає карток."}
                        </p>
                      )
                    ) : null}
                  </section>
                </div>
              ) : null}
            </div>
          </section>
        }
        steps={workflowSteps}
        activeStepId={activeWorkflowStep}
        onStepSelect={(stepId) => selectWorkflowStep(stepId as WorkflowStepId)}
        initialDrawerWidth={560}
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
    if (payload.diagnostics.appliedMode === "default") {
      return {
        tone: "info",
        message: "Швидку правку підготовлено в безпечному режимі. Перевірте зміни перед застосуванням."
      };
    }

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

function buildReviewFeedbackMessage(payload: EditorialReviewResponse, responseOk: boolean, sectionItemCount?: number): RequestFeedback {
  if (!responseOk || payload.error) {
    return {
      tone: responseOk ? "info" : "error",
      message: payload.error || "Не вдалося отримати review."
    };
  }

  if (payload.stepId === "diagnostics") {
    return {
      tone: "info",
      message: payload.expertise?.trim() ? "Діагностику оновлено." : "Діагностику виконано."
    };
  }

  if (payload.stepId === "fact_check") {
    const count = payload.factCheckRows?.length ?? 0;
    return {
      tone: "info",
      message: count > 0 ? `Підготовлено ${count} рядків факт-чеку.` : "Факт-чек не виявив окремих спірних тверджень."
    };
  }

  if (payload.items.length === 0) {
    return {
      tone: "info",
      message: "ШІ не знайшов сильних локальних рекомендацій."
    };
  }

  const count = sectionItemCount ?? payload.items.length;
  const stepLabel = WORKFLOW_STEPS.find((step) => step.id === payload.stepId)?.label?.toLowerCase();

  return {
    tone: "info",
    message: stepLabel
      ? `У кроці «${stepLabel}» підготовлено ${count} карток з рекомендаціями.`
      : `Підготовлено ${count} карток з рекомендаціями для цього кроку.`
  };
}

function mapReviewItemsByStep(items: EditorialReviewItem[]): Record<WorkflowStepId, EditorialReviewItem[]> {
  const groups: Record<WorkflowStepId, EditorialReviewItem[]> = {
    diagnostics: [],
    fact_check: [],
    structure: [],
    clarity: [],
    interest: [],
    visuals: [],
    formatting: [],
    final_editing: []
  };

  for (const item of items) {
    if (item.stepId && item.stepId in groups) {
      groups[item.stepId].push(item);
      continue;
    }

    if (item.recommendationType === "subsection" || item.recommendationType === "list") {
      groups.structure.push(item);
    }

    if (item.recommendationType === "rewrite" || item.recommendationType === "simplify" || item.recommendationType === "expand") {
      groups.clarity.push(item);
    }

    if (item.recommendationType === "callout" || item.recommendationType === "expand") {
      groups.interest.push(item);
    }

    if (item.recommendationType === "visual") {
      groups.visuals.push(item);
    }

    if (item.recommendationType === "list" || item.recommendationType === "callout" || item.recommendationType === "subsection") {
      groups.formatting.push(item);
    }

    if (item.recommendationType === "rewrite" || item.recommendationType === "simplify") {
      groups.final_editing.push(item);
    }
  }

  return groups;
}

function itemBelongsToStep(item: EditorialReviewItem, stepId: WorkflowStepId): boolean {
  if (item.stepId) {
    return item.stepId === stepId;
  }

  if (stepId === "structure") {
    return item.recommendationType === "subsection" || item.recommendationType === "list";
  }

  if (stepId === "clarity") {
    return (
      item.recommendationType === "rewrite" ||
      item.recommendationType === "simplify" ||
      item.recommendationType === "expand"
    );
  }

  if (stepId === "interest") {
    return item.recommendationType === "callout" || item.recommendationType === "expand";
  }

  if (stepId === "visuals") {
    return item.recommendationType === "visual";
  }

  if (stepId === "formatting") {
    return (
      item.recommendationType === "list" ||
      item.recommendationType === "callout" ||
      item.recommendationType === "subsection"
    );
  }

  if (stepId === "final_editing") {
    return item.recommendationType === "rewrite" || item.recommendationType === "simplify";
  }

  return false;
}

function getStepCardStats(items: EditorialReviewItem[], stepId: WorkflowStepId): { actionable: number; applied: number; dismissed: number } {
  let actionable = 0;
  let applied = 0;
  let dismissed = 0;

  for (const item of items) {
    if (!itemBelongsToStep(item, stepId)) {
      continue;
    }

    if (item.status === "applied") {
      applied += 1;
      continue;
    }

    if (item.status === "dismissed") {
      dismissed += 1;
      continue;
    }

    actionable += 1;
  }

  return { actionable, applied, dismissed };
}

function buildReviewModeSummary(level: WholeTextChangeLevel, blockCount: number): string {
  if (blockCount <= 0) {
    return "Орієнтовно: 0 карток · Втручання: мінімальне · Переписування: локальне";
  }

  const blocksPerCard = CHANGE_LEVEL_GUIDANCE[level].blocksPerCard;
  const targetCards = Math.max(2, Math.round(blockCount / blocksPerCard));
  const minCards = Math.max(2, Math.floor(targetCards * 0.75));
  const maxCards = Math.max(minCards, Math.ceil(targetCards * 1.25));
  const intervention = getInterventionLabel(level);

  return `Орієнтовно: ${minCards}–${maxCards} карток · Втручання: ${intervention} · Переписування: локальне`;
}

function getInterventionLabel(level: WholeTextChangeLevel): string {
  if (level === 1) {
    return "мінімальне";
  }

  if (level === 2) {
    return "помірне";
  }

  if (level === 3) {
    return "відчутне";
  }

  if (level === 4) {
    return "високе";
  }

  return "максимальне";
}

function toFactStatusClassName(status: EditorialFactCheckRow["status"]): "ok" | "warning" | "unknown" {
  if (status === "ok") {
    return "ok";
  }

  if (status === "сумнівно") {
    return "warning";
  }

  return "unknown";
}

function buildImportFeedback(result: ImportedDocumentResult): RequestFeedback {
  const label = formatImportedDocumentLabel(result.format);

  if (result.warnings.length === 0) {
    return {
      tone: "info",
      message: `${label} імпортовано.`
    };
  }

  return {
    tone: "info",
    message: `${label} імпортовано. ${result.warnings.join(" ")}`
  };
}

function formatImportedDocumentLabel(format: ImportedDocumentResult["format"]): string {
  switch (format) {
    case "docx":
      return "DOCX";
    case "clipboard_html":
      return "Вміст із буфера";
    case "clipboard_text":
      return "Текст із буфера";
    case "txt":
    default:
      return "TXT";
  }
}

function EditorActionMenu({
  label,
  icon: Icon,
  open,
  busy,
  onToggle,
  items
}: {
  label: string;
  icon: LucideIcon;
  open: boolean;
  busy?: boolean;
  onToggle: () => void;
  items: Array<{ label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean }>;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        onToggle();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onToggle();
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onToggle, open]);

  return (
    <div ref={rootRef} className="editor-action-menu">
      <button
        type="button"
        className="editor-action-menu-trigger mono-ui"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        disabled={busy}
      >
        <span className="editor-action-menu-trigger-content">
          <Icon size={14} />
          <span>{label}</span>
          <ChevronDown size={13} className="editor-action-menu-chevron" />
        </span>
      </button>

      {open ? (
        <div className="editor-action-menu-panel mono-ui" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="editor-action-menu-item"
              onClick={item.onClick}
              disabled={item.disabled}
              role="menuitem"
            >
              <span className="editor-action-menu-item-icon">
                <item.icon size={14} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const expertiseTokenMap: Record<string, string> = {
  rewrite_text: "переписати фрагмент",
  insert_text: "додати вставку",
  prepare_callout: "підготувати врізку",
  prepare_visual: "підготувати візуал",
  rewrite: "переписати",
  simplify: "спростити",
  expand: "розширити",
  list: "оформити списком",
  subsection: "додати підзаголовок",
  callout: "врізка",
  visual: "візуал",
  mechanism: "механізм",
  analogy: "аналогія",
  everyday_application: "практичне застосування",
  myths_vs_truth: "міфи та правда",
  top_list: "топ-список",
  infographic: "інфографіка",
  illustration: "ілюстрація"
};

function localizeExpertiseMarkdown(value: string): string {
  let next = value.replace(/\r\n?/g, "\n");

  next = next
    .replace(/Suggested Action\s*:/gi, "Рекомендована дія:")
    .replace(/Callout Kind\s*:/gi, "Тип врізки:")
    .replace(/Visual Intent\s*:/gi, "Тип візуалу:")
    .replace(/Recommendation\s*:/gi, "Рекомендація:")
    .replace(/What doesn't work\s*:/gi, "Що не працює:");

  for (const [token, label] of Object.entries(expertiseTokenMap)) {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "gi");
    next = next.replace(pattern, label);
  }

  return next;
}

function linkifyParagraphRefs(value: string): string {
  return value.replace(/абз\.\s*0*(\d+)(?:\s*-\s*0*(\d+))?/gi, (match, firstRaw) => {
    const index = Number.parseInt(firstRaw, 10);

    if (Number.isNaN(index) || index < 1) {
      return match;
    }

    return `[${match}](#block-${index - 1})`;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitCalloutDraftIntoParagraphs(text: string, kind: EditorialCalloutKind) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const parts =
    kind === "top_list" || kind === "myths_vs_truth"
      ? normalized.split("\n").map((part) => part.trim()).filter(Boolean)
      : normalized.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);

  return (parts.length > 0 ? parts : [""]).map((part) => [createInlineText(part)]);
}

function splitTextIntoParagraphBlocks(text: string): string[] {
  const parts = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [text.trim()];
}

function maybeEscalateReviewNoOpWarning(
  proposal: ReviewActionProposal,
  itemId: string,
  streakState: Record<string, number>
): ReviewActionProposal {
  if (proposal.kind !== "text_diff" || !proposal.textDiff?.warning || proposal.textDiff.warning.code !== "no_op") {
    streakState[itemId] = 0;
    return proposal;
  }

  const nextStreak = (streakState[itemId] ?? 0) + 1;
  streakState[itemId] = nextStreak;

  if (nextStreak < 2) {
    return proposal;
  }

  return {
    ...proposal,
    textDiff: {
      ...proposal.textDiff,
      warning: {
        ...proposal.textDiff.warning,
        message:
          "Друга no-op чернетка поспіль. Поточна інструкція занадто розмита: уточніть, що саме переписати/спростити, для кого і який формат результату очікуєте."
      }
    }
  };
}

function assessPatchNoOp(operations: PatchOperation[]): { isNoOp: boolean; maxSimilarity: number } {
  if (operations.length === 0) {
    return { isNoOp: false, maxSimilarity: 0 };
  }

  let maxSimilarity = 0;
  let allNearNoOp = true;

  for (const operation of operations) {
    const source = canonicalizeNoOpText(operation.oldBlocks);
    const candidate = canonicalizeNoOpText(operation.newBlocks);

    if (!source || !candidate) {
      allNearNoOp = false;
      continue;
    }

    const similarity = computeNoOpDiceSimilarity(source, candidate);
    maxSimilarity = Math.max(maxSimilarity, similarity);

    if (similarity < 0.94) {
      allNearNoOp = false;
    }
  }

  return { isNoOp: allNearNoOp, maxSimilarity };
}

function canonicalizeNoOpText(blocks: Block[]): string {
  return blocks
    .map((block) => sanitizeNoOpText(getBlockText(block)).toLowerCase())
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeNoOpText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function computeNoOpDiceSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  if (left.length < 2 || right.length < 2) {
    return 0;
  }

  const leftPairs = createNoOpBigramCounts(left);
  const rightPairs = createNoOpBigramCounts(right);
  let overlap = 0;
  let leftCount = 0;
  let rightCount = 0;

  for (const value of leftPairs.values()) {
    leftCount += value;
  }

  for (const value of rightPairs.values()) {
    rightCount += value;
  }

  for (const [pair, leftValue] of leftPairs.entries()) {
    overlap += Math.min(leftValue, rightPairs.get(pair) ?? 0);
  }

  if (leftCount === 0 || rightCount === 0) {
    return 0;
  }

  return (2 * overlap) / (leftCount + rightCount);
}

function createNoOpBigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();

  for (let index = 0; index < value.length - 1; index += 1) {
    const pair = value.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }

  return counts;
}
