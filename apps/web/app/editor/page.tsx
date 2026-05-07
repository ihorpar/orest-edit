"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BlockEditorSurface } from "../../components/editor/BlockEditorSurface";
import { EditorialReviewCard } from "../../components/editor/EditorialReviewCard";
import { FloatingComposerPanel } from "../../components/editor/FloatingComposerPanel";
import { TopBar } from "../../components/layout/TopBar";
import { type RequestHistoryItem } from "../../components/layout/RightOperationsRail";
import { StepReviewWorkspaceShell } from "../../components/layout/StepReviewWorkspaceShell";
import { Button } from "../../components/ui/Button";
import type { EditorDocument, BlockSelection, CalloutBlock, ImageBlock, Block, InlineNode } from "../../lib/editor/document-model";
import {
  countTextOccurrencesInDocument,
  createBlockId,
  createEmptyParagraphBlock,
  createInlineText,
  cloneBlock,
  cloneEditorDocument,
  documentToPlainText,
  EMPTY_BLOCK_SELECTION,
  getBlockText,
  getDocumentTextStats,
  getInlineText,
  insertBlocksAfter,
  normalizeBlockSelection,
  normalizeInlineNodes,
  replaceTextInDocument,
  sliceDocumentForBlockRange,
  replaceBlocksByIds
} from "../../lib/editor/document-model";
import { clearEditorDraftState, readEditorDraftState, writeEditorDraftState, type PersistedWorkflowStepId } from "../../lib/editor/draft-state";
import { buildDocxFileName, deriveDocxFileNameBase, exportDocumentToDocx } from "../../lib/editor/docx-export";
import { importFileToDocument, importHtmlToDocument, importPlainTextToDocument, type ImportedDocumentResult } from "../../lib/editor/import";
import { parseBoldMarkdownToInlineNodes, serializeInlineNodesToBoldMarkdown } from "../../lib/editor/inline-markup";
import { splitCalloutDraftIntoParagraphs } from "../../lib/editor/callout-preview";
import { getEditorHotkeyAction, getUndoRedoHotkeyAction, type EditorHotkeyAction } from "../../lib/editor/keyboard-shortcuts";
import {
  computeAnchorFingerprint,
  deriveManuscriptRevisionState,
  formatParagraphLabel,
  resolveReviewItemSelection,
  type ManuscriptRevisionState
} from "../../lib/editor/manuscript-structure";
import { buildManualReviewItem, upsertManualReviewItem } from "../../lib/editor/manual-review-items";
import {
  createCompareHistoryEntry,
  createMutationEntry,
  createMutationSnapshot,
  pushMutationEntry,
  type CompareHistoryEntry,
  type EditorMutationEntry,
  type EditorMutationKind,
  type EditorSpellcheckSnapshot
} from "../../lib/editor/change-history";
import {
  inferLocalActionRoute,
  inferSuggestedLocalActionMode,
  type LocalActionMode,
  type LocalActionRouteResponse,
  type SuggestedLocalActionMode,
  type LocalActionTextIntent
} from "../../lib/editor/local-action-router";
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
  type EditorialCalloutDepth,
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
  type RejectedReviewIdea,
  isReplaceReviewType,
  normalizeRejectedReviewIdeas,
  type ReviewActionRequest,
  type ReviewActionProposal,
  type ReviewActionResponse,
  type WholeTextChangeLevel,
  normalizeEditorialCalloutDepth
} from "../../lib/editor/review-contract";
import {
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_VISUAL_STYLE_PRESET,
  EDITOR_SETTINGS_UPDATED_EVENT,
  VISUAL_STYLE_PRESET_STORAGE_KEY,
  normalizeVisualStylePreset,
  readEditorSettings,
  type EditorSettings
} from "../../lib/editor/settings";
import type { SpellcheckResponse } from "../../lib/editor/spellcheck-contract";
import {
  countSpellcheckIssues,
  createSpellcheckBatchChunks,
  getSpellcheckCategoryLabel,
  getSpellcheckableBlocks,
  type SpellcheckBlockResult,
  type SpellcheckSummaryMeta
} from "../../lib/editor/spellcheck-view-model";
import {
  addSpellcheckDictionaryWord,
  createSpellcheckDictionarySet,
  filterSpellcheckIssuesByDictionary,
  readSpellcheckDictionaryWords
} from "../../lib/editor/spellcheck-dictionary";
import { storeEditorAssetFromBlob, storeEditorAssetFromDataUrl } from "../../lib/editor/asset-store";
import {
  getStepPrimaryAction,
  getStepWorkspaceStatus,
  presentRequestFeedback,
  type RequestFeedback
} from "../../lib/editor/workflow-ui";
import {
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  FileText,
  FolderOpen,
  Highlighter,
  Image as ImageIcon,
  LayoutGrid,
  LocateFixed,
  Languages,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  MessageSquareText,
  Stethoscope,
  Table2,
  Target,
  Trash2,
  X,
  Replace,
  Upload
} from "lucide-react";

interface DismissUndoState {
  item: EditorialReviewItem;
  rejectedIdea?: RejectedReviewIdea;
}

interface PendingDestructiveAction {
  kind: "clear_document";
  title: string;
  description: string;
  confirmLabel: string;
}

interface DestructiveRecoveryState {
  kind: PendingDestructiveAction["kind"];
  message: string;
  snapshot: EditorSessionSnapshot;
}

interface CompareEntryDraft {
  label: string;
  kind: EditorMutationKind;
  blockIds: string[];
  beforeBlocks: Block[];
  afterBlocks: Block[];
}

interface StructureOutlineAction {
  item: EditorialReviewItem;
  rangeLabel: string;
  label: string;
  statusLabel: string;
  isHidden: boolean;
}

interface StructureOutlineNode {
  id: string;
  title: string;
  level: number;
  rangeLabel: string;
  startIndex: number;
  endIndex: number;
  anchorBlockId: string | null;
  actions: StructureOutlineAction[];
}

interface EmphasisSuggestionViewModel {
  itemId: string;
  blockId: string;
  paragraphLabel: string;
  phrase: string;
  reason?: string;
  status: EditorialReviewItem["status"];
  range: {
    start: number;
    end: number;
  };
}

interface CommitDocumentOptions {
  preserveSpellcheck?: boolean;
  suppressHistory?: boolean;
  spellcheckState?: EditorSpellcheckSnapshot;
  history?:
    | {
        kind: EditorMutationKind;
        label: string;
        blockIds?: string[];
        mergeKey?: string;
        compare?: CompareEntryDraft | null;
      }
    | null;
}

interface EditorSessionSnapshot {
  document: EditorDocument;
  selection: BlockSelection;
  focusedBlockId: string | null;
  operations: PatchOperation[];
  reviewItems: EditorialReviewItem[];
  rejectedReviewIdeas: RejectedReviewIdea[];
  patchDiagnostics: PatchResponseDiagnostics | null;
  reviewDiagnostics: EditorialReviewDiagnostics | null;
  feedback: RequestFeedback | null;
  history: RequestHistoryItem[];
  mutationHistoryPast: EditorMutationEntry[];
  mutationHistoryFuture: EditorMutationEntry[];
  compareHistory: CompareHistoryEntry[];
  activeCompareEntryId: string | null;
  customPrompt: string;
  activeReviewItemId: string | null;
  activeProposal: ReviewActionProposal | null;
  composerMode: ComposerMode;
  reviewExpertise: string | null;
  activeWorkflowStep: WorkflowStepId;
  manualCalloutKind: EditorialCalloutKind;
  manualCalloutDepth: EditorialCalloutDepth;
  manualVisualIntent: EditorialVisualIntent;
  localActionMode: LocalActionMode;
  localTextIntent: LocalActionTextIntent;
  manualCalloutPrompt: string;
  manualVisualPrompt: string;
  spellcheck: EditorSpellcheckSnapshot;
  visualStylePreset: VisualStylePreset;
  stepFeedback: EditorialStepFeedbackMap;
  stepRunModeByStep: EditorialStepRunModeMap;
  stepRunHistory: EditorialStepRunHistory;
  factCheckRows: EditorialFactCheckRow[];
  showCompletedCards: boolean;
  reviewRefineInstruction: string;
}

const historyTimeFormatter = new Intl.DateTimeFormat("uk-UA", {
  hour: "2-digit",
  minute: "2-digit"
});

const defaultReviewComposer: { changeLevel: WholeTextChangeLevel; additionalInstructions: string } = {
  changeLevel: 5,
  additionalInstructions: ""
};
const defaultManualCalloutKind: EditorialCalloutKind = "mechanism";
const defaultManualCalloutDepth: EditorialCalloutDepth = "brief";
const defaultManualVisualIntent: EditorialVisualIntent = "infographic";
const defaultVisualStylePreset: VisualStylePreset = DEFAULT_VISUAL_STYLE_PRESET;
const defaultLocalActionMode = "edit" as const;
const defaultLocalTextIntent = "rewrite" as const;

type ComposerMode = "local" | "review" | null;
type ManualGenerationKind = "callout" | "visual" | "list" | "subsection";
type WorkflowStepId = PersistedWorkflowStepId;
type TopActionMenuId = "open" | "save" | null;

const WORKFLOW_STEPS: Array<{ id: WorkflowStepId; label: string; icon: typeof Stethoscope }> = [
  { id: "diagnostics", label: "Діагностика", icon: Stethoscope },
  { id: "fact_check", label: "Перевірка фактів", icon: Search },
  { id: "structure", label: "Структура", icon: LayoutGrid },
  { id: "clarity", label: "Ясність", icon: Sparkles },
  { id: "interest", label: "Інтерес і застосовність", icon: Target },
  { id: "visuals", label: "Візуали", icon: ImageIcon },
  { id: "formatting", label: "Форматування", icon: Table2 },
  { id: "spellcheck", label: "Правопис", icon: Languages },
  { id: "emphasis", label: "Акценти", icon: Highlighter },
  { id: "final_editing", label: "Власний запит", icon: MessageSquareText }
];

const WORKFLOW_STEP_SUMMARIES: Record<WorkflowStepId, string> = {
  diagnostics: "Редакторський огляд логіки, щільності й ризикових місць.",
  fact_check: "Перевірка тверджень за доказовою наукою й джерелами.",
  structure: "Архітектура розділу, послідовність думки й дроблення матеріалу.",
  clarity: "Спрощення складних формулювань без втрати точності.",
  interest: "Практична цінність, життєві приклади й читабельність.",
  visuals: "Місця для ілюстрацій, схем та інфографіки.",
  formatting: "Списки, врізки й таблиці для швидкого сканування.",
  spellcheck: "Орфографія, пунктуація, граматика й типографічна чистота.",
  emphasis: "Смислові акценти для швидкого сканування ключових тез.",
  final_editing: "Будь-який редакторський запит, повернений як локальні картки."
};

function isEditorialReviewStepId(stepId: WorkflowStepId): stepId is EditorialReviewStepId {
  return stepId !== "spellcheck";
}

function isLocalActionRoutePayload(value: LocalActionRouteResponse | { error?: string }): value is LocalActionRouteResponse {
  return "executor" in value;
}

function createBlankDocument(): EditorDocument {
  return {
    version: 2,
    blocks: [createEmptyParagraphBlock("p-blank")]
  };
}

export default function EditorPage() {
  const initialDocumentRef = useRef<EditorDocument | null>(null);
  if (initialDocumentRef.current === null) {
    initialDocumentRef.current = createBlankDocument();
  }
  const initialDocument = initialDocumentRef.current;

  const [document, setDocument] = useState<EditorDocument>(initialDocument);
  const [revision, setRevision] = useState<ManuscriptRevisionState>(() => deriveManuscriptRevisionState(initialDocument));
  const documentStats = useMemo(() => getDocumentTextStats(document), [document]);
  const [selection, setSelection] = useState<BlockSelection>(EMPTY_BLOCK_SELECTION);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(initialDocument.blocks[0]?.id ?? null);
  const [operations, setOperations] = useState<PatchOperation[]>([]);
  const [reviewItems, setReviewItems] = useState<EditorialReviewItem[]>([]);
  const [rejectedReviewIdeas, setRejectedReviewIdeas] = useState<RejectedReviewIdea[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
  const [patchDiagnostics, setPatchDiagnostics] = useState<PatchResponseDiagnostics | null>(null);
  const [reviewDiagnostics, setReviewDiagnostics] = useState<EditorialReviewDiagnostics | null>(null);
  const [feedback, setFeedback] = useState<RequestFeedback | null>(null);
  const [history, setHistory] = useState<RequestHistoryItem[]>([]);
  const [mutationHistoryPast, setMutationHistoryPast] = useState<EditorMutationEntry[]>([]);
  const [mutationHistoryFuture, setMutationHistoryFuture] = useState<EditorMutationEntry[]>([]);
  const [compareHistory, setCompareHistory] = useState<CompareHistoryEntry[]>([]);
  const [activeCompareEntryId, setActiveCompareEntryId] = useState<string | null>(null);
  const [expandedCompareEntryId, setExpandedCompareEntryId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [activeReviewItemId, setActiveReviewItemId] = useState<string | null>(null);
  const [activeProposal, setActiveProposal] = useState<ReviewActionProposal | null>(null);
  const [reviewComposer, setReviewComposer] = useState(defaultReviewComposer);
  const [composerMode, setComposerMode] = useState<ComposerMode>(null);
  const [isComposerClosing, setIsComposerClosing] = useState(false);
  const [selectionChangeNonce, setSelectionChangeNonce] = useState(0);
  const [suppressedLocalComposerSelectionNonce, setSuppressedLocalComposerSelectionNonce] = useState<number | null>(null);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [isPatchRequestInFlight, setIsPatchRequestInFlight] = useState(false);
  const [isReviewRequestInFlight, setIsReviewRequestInFlight] = useState(false);
  const [isDocxExportInFlight, setIsDocxExportInFlight] = useState(false);
  const [preparingReviewItemId, setPreparingReviewItemId] = useState<string | null>(null);
  const [isReviewImageRequestInFlight, setIsReviewImageRequestInFlight] = useState(false);
  const [reviewExpertise, setReviewExpertise] = useState<string | null>(null);
  const [activeWorkflowStep, setActiveWorkflowStep] = useState<WorkflowStepId>("diagnostics");
  const [manualCalloutKind, setManualCalloutKind] = useState<EditorialCalloutKind>(defaultManualCalloutKind);
  const [manualCalloutDepth, setManualCalloutDepth] = useState<EditorialCalloutDepth>(defaultManualCalloutDepth);
  const [manualVisualIntent, setManualVisualIntent] = useState<EditorialVisualIntent>(defaultManualVisualIntent);
  const [manualGenerationInFlight, setManualGenerationInFlight] = useState<{ kind: ManualGenerationKind; key: string } | null>(null);
  const [localActionMode, setLocalActionMode] = useState<LocalActionMode>(defaultLocalActionMode);
  const [localTextIntent, setLocalTextIntent] = useState<LocalActionTextIntent>(defaultLocalTextIntent);
  const [manualCalloutPrompt, setManualCalloutPrompt] = useState("");
  const [manualVisualPrompt, setManualVisualPrompt] = useState("");
  const [spellcheckResults, setSpellcheckResults] = useState<SpellcheckBlockResult[]>([]);
  const [spellcheckMeta, setSpellcheckMeta] = useState<SpellcheckSummaryMeta | null>(null);
  const [spellcheckSummary, setSpellcheckSummary] = useState<string | null>(null);
  const [spellcheckSecondarySummary, setSpellcheckSecondarySummary] = useState<string | null>(null);
  const [spellcheckInvalidatedCount, setSpellcheckInvalidatedCount] = useState(0);
  const [isSpellcheckRequestInFlight, setIsSpellcheckRequestInFlight] = useState(false);
  const [spellcheckDictionaryWords, setSpellcheckDictionaryWords] = useState<string[]>([]);
  const [expandedSpellcheckBlockId, setExpandedSpellcheckBlockId] = useState<string | null>(null);
  const [visualStylePreset, setVisualStylePreset] = useState<VisualStylePreset>(defaultVisualStylePreset);
  const [stepFeedback, setStepFeedback] = useState<EditorialStepFeedbackMap>(() => createDefaultStepFeedbackMap());
  const [stepRunModeByStep, setStepRunModeByStep] = useState<EditorialStepRunModeMap>(() => createDefaultStepRunModeMap("replace"));
  const [stepRunHistory, setStepRunHistory] = useState<EditorialStepRunHistory>(() => createEmptyStepRunHistory());
  const [factCheckRows, setFactCheckRows] = useState<EditorialFactCheckRow[]>([]);
  const [recentlyChangedBlockIds, setRecentlyChangedBlockIds] = useState<string[]>([]);
  const [dismissUndoState, setDismissUndoState] = useState<DismissUndoState | null>(null);
  const [showCompletedCards, setShowCompletedCards] = useState(false);
  const [showRecommendationStatusStrip, setShowRecommendationStatusStrip] = useState(false);
  const [stepSettingsOpen, setStepSettingsOpen] = useState(false);
  const [activeTopActionMenu, setActiveTopActionMenu] = useState<TopActionMenuId>(null);
  const [isImportInFlight, setIsImportInFlight] = useState(false);
  const [isGlobalReplaceOpen, setIsGlobalReplaceOpen] = useState(false);
  const [globalReplaceSearch, setGlobalReplaceSearch] = useState("");
  const [globalReplaceReplacement, setGlobalReplaceReplacement] = useState("");
  const [reviewRefineInstruction, setReviewRefineInstruction] = useState("");
  const [editorHotkeyCommand, setEditorHotkeyCommand] = useState<Extract<EditorHotkeyAction, "toggle_bullet_list"> | null>(null);
  const [editorHotkeyCommandNonce, setEditorHotkeyCommandNonce] = useState(0);
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<PendingDestructiveAction | null>(null);
  const [destructiveRecoveryState, setDestructiveRecoveryState] = useState<DestructiveRecoveryState | null>(null);
  const recentChangeTimeoutRef = useRef<number | null>(null);
  const dismissUndoTimeoutRef = useRef<number | null>(null);
  const destructiveRecoveryTimeoutRef = useRef<number | null>(null);
  const composerCloseTimeoutRef = useRef<number | null>(null);
  const selectionChangeNonceRef = useRef(0);
  const globalReplaceSearchInputRef = useRef<HTMLInputElement | null>(null);
  const reviewNoOpStreakRef = useRef<Record<string, number>>({});
  const patchNoOpStreakRef = useRef<Record<string, number>>({});
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedSelection = useMemo(() => normalizeBlockSelection(document, selection), [document, selection]);
  const spellcheckDictionarySet = useMemo(() => createSpellcheckDictionarySet(spellcheckDictionaryWords), [spellcheckDictionaryWords]);
  const globalReplaceMatchCount = useMemo(
    () => countTextOccurrencesInDocument(document, globalReplaceSearch),
    [document, globalReplaceSearch]
  );
  const localActionRoute = useMemo<LocalActionRouteResponse>(
    () =>
      inferLocalActionRoute({
        prompt:
          localActionMode === "callout"
            ? manualCalloutPrompt
            : localActionMode === "visual"
              ? manualVisualPrompt
              : customPrompt,
        explicitMode: localActionMode === "auto" ? null : localActionMode,
        preferredTextIntent: localTextIntent,
        calloutKind: manualCalloutKind,
        calloutDepth: manualCalloutDepth,
        visualIntent: manualVisualIntent,
        visualStylePreset: visualStylePreset
      }),
    [customPrompt, localActionMode, localTextIntent, manualCalloutDepth, manualCalloutKind, manualCalloutPrompt, manualVisualIntent, manualVisualPrompt, visualStylePreset]
  );
  const localModeSuggestion = useMemo<{ mode: SuggestedLocalActionMode; label: string } | null>(() => {
    if (localActionMode !== "edit" && localActionMode !== "auto") {
      return null;
    }

    const suggestedMode = inferSuggestedLocalActionMode(customPrompt);

    if (!suggestedMode) {
      return null;
    }

    return {
      mode: suggestedMode,
      label: suggestedMode === "spellcheck" ? "Правопис" : suggestedMode === "callout" ? "Врізка" : "Візуал"
    };
  }, [customPrompt, localActionMode]);
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
              : step.id === "spellcheck"
                ? Boolean(spellcheckSummary || spellcheckResults.length > 0)
                : stepItems[step.id].length > 0
      })),
    [factCheckRows.length, reviewExpertise, spellcheckResults.length, spellcheckSummary, stepItems]
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
      setRejectedReviewIdeas(normalizeRejectedReviewIdeas(draft.rejectedReviewIdeas));
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
      setCompareHistory(draft.compareHistory ?? []);
      setActiveReviewItemId(draft.activeReviewItemId);
      setActiveProposal(draft.activeProposal);
      setReviewComposer(draft.reviewComposer ?? defaultReviewComposer);
      setFocusedBlockId(draft.selection.focusBlockId ?? draft.document.blocks[0]?.id ?? null);
    }

    setHasHydratedDraft(true);
  }, []);

  useEffect(() => {
    function handleSettingsUpdated(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setSettings(detail ?? readEditorSettings());
    }

    window.addEventListener(EDITOR_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
    window.addEventListener("storage", handleSettingsUpdated);

    return () => {
      window.removeEventListener(EDITOR_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
      window.removeEventListener("storage", handleSettingsUpdated);
    };
  }, []);

  useEffect(() => {
    setReviewRefineInstruction("");
  }, [activeReviewItemId]);

  useEffect(() => {
    if (activeCompareEntryId && compareHistory.some((entry) => entry.id === activeCompareEntryId)) {
      setExpandedCompareEntryId(activeCompareEntryId);
      return;
    }

    if (compareHistory.length === 0) {
      setExpandedCompareEntryId(null);
    }
  }, [activeCompareEntryId, compareHistory]);

  const activeCompareEntry = useMemo(
    () => (activeCompareEntryId ? compareHistory.find((entry) => entry.id === activeCompareEntryId) ?? null : null),
    [activeCompareEntryId, compareHistory]
  );
  const activeCompareLiveBlocks = useMemo(() => {
    if (!activeCompareEntry) {
      return [];
    }

    const blockMap = new Map(document.blocks.map((block) => [block.id, block]));
    return activeCompareEntry.blockIds.map((blockId) => blockMap.get(blockId) ?? null);
  }, [activeCompareEntry, document]);
  const canEditActiveCompare =
    activeCompareEntry != null &&
    activeCompareLiveBlocks.length === activeCompareEntry.blockIds.length &&
    activeCompareLiveBlocks.every((block): block is Block => {
      if (!block) {
        return false;
      }

      return isCompareBlockTextEditable(block);
    });
  const activeCompareEditableBlocks = useMemo(
    () =>
      canEditActiveCompare
        ? (activeCompareLiveBlocks.filter((block): block is Block => Boolean(block)) as Block[])
        : (activeCompareEntry?.afterBlocks ?? []),
    [activeCompareEntry?.afterBlocks, activeCompareLiveBlocks, canEditActiveCompare]
  );
  const [compareDraftTexts, setCompareDraftTexts] = useState<string[]>([]);
  const compareTextareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const canUndo = mutationHistoryPast.length > 0;
  const canRedo = mutationHistoryFuture.length > 0;

  useEffect(() => {
    if (!activeCompareEntry) {
      setCompareDraftTexts([]);
      return;
    }

    setCompareDraftTexts(activeCompareEditableBlocks.map((block) => formatCompareBlockText(block)));
  }, [activeCompareEntry?.id, canEditActiveCompare]);

  useEffect(() => {
    for (const block of activeCompareEditableBlocks) {
      const textarea = compareTextareaRefs.current.get(block.id);

      if (textarea) {
        autosizeCompareTextarea(textarea);
      }
    }
  }, [activeCompareEditableBlocks, compareDraftTexts]);

  function registerMutation(
    nextDocument: EditorDocument,
    nextSelection: BlockSelection,
    nextFocusedBlockId: string | null,
    historyOptions: NonNullable<CommitDocumentOptions["history"]>,
    nextSpellcheckState: EditorSpellcheckSnapshot
  ) {
    const timestamp = Date.now();
    const entryId = createPatchId("mutation");
    const blockIds = historyOptions.blockIds ?? deriveChangedBlockIds(document, nextDocument);

    if (blockIds.length === 0 && !historyOptions.compare) {
      return;
    }

    const entry = createMutationEntry({
      id: entryId,
      kind: historyOptions.kind,
      label: historyOptions.label,
      timestamp,
      timestampLabel: historyTimeFormatter.format(new Date(timestamp)),
      blockIds,
      mergeKey: historyOptions.mergeKey,
      before: createMutationSnapshot({
        document,
        selection: normalizedSelection,
        focusedBlockId,
        spellcheck: captureCurrentSpellcheckState()
      }),
      after: createMutationSnapshot({
        document: nextDocument,
        selection: nextSelection,
        focusedBlockId: nextFocusedBlockId,
        spellcheck: nextSpellcheckState
      })
    });

    setMutationHistoryPast((current) => pushMutationEntry(current, entry));
    setMutationHistoryFuture([]);

    if (historyOptions.compare && historyOptions.compare.beforeBlocks.length > 0 && historyOptions.compare.afterBlocks.length > 0) {
      const compareEntry = createCompareHistoryEntry({
        id: entryId,
        kind: historyOptions.compare.kind,
        label: historyOptions.compare.label,
        timestampLabel: historyTimeFormatter.format(new Date(timestamp)),
        blockIds: historyOptions.compare.blockIds,
        beforeBlocks: historyOptions.compare.beforeBlocks,
        afterBlocks: historyOptions.compare.afterBlocks
      });

      setCompareHistory((current) => [compareEntry, ...current.filter((candidate) => candidate.id !== compareEntry.id)].slice(0, 20));
    }
  }

  function applySnapshot(snapshot: {
    document: EditorDocument;
    selection: BlockSelection;
    focusedBlockId: string | null;
    spellcheck?: EditorSpellcheckSnapshot;
  }) {
    const nextDocument = cloneEditorDocument(snapshot.document);
    const nextRevision = deriveManuscriptRevisionState(nextDocument);

    setDocument(nextDocument);
    setRevision(nextRevision);
    setSelection(normalizeBlockSelection(nextDocument, snapshot.selection));
    setFocusedBlockId(snapshot.focusedBlockId ?? snapshot.selection.focusBlockId ?? snapshot.selection.anchorBlockId ?? nextDocument.blocks[0]?.id ?? null);
    setReviewItems((current) => reconcileReviewItemsWithRevision(current, nextDocument, nextRevision));
    setOperations([]);
    setPatchDiagnostics(null);
    setActiveProposal(null);
    setActiveReviewItemId(null);
    applySpellcheckState(snapshot.spellcheck ?? createEmptySpellcheckState());
  }

  function undoLastMutation() {
    const entry = mutationHistoryPast.at(-1);

    if (!entry) {
      return;
    }

    applySnapshot(entry.before);
    setMutationHistoryPast((current) => current.slice(0, -1));
    setMutationHistoryFuture((current) => [...current, entry]);
    setFeedback({ tone: "info", message: `Скасовано: ${entry.label.toLowerCase()}.` });
  }

  function redoLastMutation() {
    const entry = mutationHistoryFuture.at(-1);

    if (!entry) {
      return;
    }

    applySnapshot(entry.after);
    setMutationHistoryFuture((current) => current.slice(0, -1));
    setMutationHistoryPast((current) => [...current.slice(Math.max(0, current.length - 49)), entry]);
    setFeedback({ tone: "info", message: `Повторено: ${entry.label.toLowerCase()}.` });
  }

  function handleManualDocumentChange(nextDocument: EditorDocument) {
    const changedBlockIds = deriveChangedBlockIds(document, nextDocument);

    commitDocument(nextDocument, {
      history: {
        kind: "manual_edit",
        label: "Ручне редагування",
        blockIds: changedBlockIds,
        mergeKey: changedBlockIds.length > 0 ? `manual:${changedBlockIds.join("|")}` : "manual"
      }
    });
  }

  function clearSpellcheckResults() {
    applySpellcheckState(createEmptySpellcheckState());
  }

  function mergeSpellcheckBlockResults(
    currentResults: SpellcheckBlockResult[],
    nextResults: SpellcheckBlockResult[]
  ): SpellcheckBlockResult[] {
    const nextByBlockId = new Map(nextResults.map((result) => [result.blockId, result]));
    const currentByBlockId = new Map(currentResults.map((result) => [result.blockId, result]));

    return document.blocks
      .map((block) => nextByBlockId.get(block.id) ?? currentByBlockId.get(block.id) ?? null)
      .filter((result): result is SpellcheckBlockResult => Boolean(result));
  }

  function buildSpellcheckSummaryMeta(results: SpellcheckBlockResult[], skippedCount: number): SpellcheckSummaryMeta {
    return {
      checkedBlockCount: results.length,
      issueCount: countSpellcheckIssues(results),
      skippedCount,
      errorCount: results.filter((entry) => Boolean(entry.error)).length
    };
  }

  function filterSpellcheckResultsWithDictionary(
    results: SpellcheckBlockResult[],
    dictionaryWords = spellcheckDictionaryWords
  ): SpellcheckBlockResult[] {
    const dictionary = createSpellcheckDictionarySet(dictionaryWords);

    if (dictionary.size === 0) {
      return results;
    }

    return results.map((result) => ({
      ...result,
      issues: filterSpellcheckIssuesByDictionary(result.issues, dictionary)
    }));
  }

  function createEmptySpellcheckState(): EditorSpellcheckSnapshot {
    return {
      results: [],
      meta: null,
      summary: null,
      secondarySummary: null,
      invalidatedCount: 0
    };
  }

  function createSpellcheckState(
    results: SpellcheckBlockResult[],
    meta: SpellcheckSummaryMeta,
    invalidatedCount = spellcheckInvalidatedCount
  ): EditorSpellcheckSnapshot {
    const nextSummary =
      meta.issueCount > 0
        ? `Знайдено ${meta.issueCount} проблем у ${results.filter((result) => result.issues.length > 0).length} абз.`
        : `Помилок не знайдено у ${meta.checkedBlockCount} абз.`;
    const secondaryParts: string[] = [];

    if (meta.skippedCount > 0) {
      secondaryParts.push(`Пропущено блоків: ${meta.skippedCount}`);
    }

    if (meta.errorCount > 0) {
      secondaryParts.push(`З помилкою запиту: ${meta.errorCount}`);
    }

    if (invalidatedCount > 0) {
      secondaryParts.push(`Змінено абз.: ${invalidatedCount} · перевірте їх ще раз`);
    }

    return {
      results,
      meta,
      summary: nextSummary,
      secondarySummary: secondaryParts.length > 0 ? secondaryParts.join(" · ") : null,
      invalidatedCount
    };
  }

  function createInvalidatedSpellcheckState(invalidatedCount: number): EditorSpellcheckSnapshot {
    return {
      results: [],
      meta: null,
      summary: "У перевірених абзацах є зміни.",
      secondarySummary: `Змінено абз.: ${invalidatedCount} · перевірте їх ще раз`,
      invalidatedCount
    };
  }

  function captureCurrentSpellcheckState(): EditorSpellcheckSnapshot {
    if (!spellcheckMeta) {
      return {
        results: spellcheckResults,
        meta: null,
        summary: spellcheckSummary,
        secondarySummary: spellcheckSecondarySummary,
        invalidatedCount: spellcheckInvalidatedCount
      };
    }

    return createSpellcheckState(spellcheckResults, spellcheckMeta, spellcheckInvalidatedCount);
  }

  function applySpellcheckState(state: EditorSpellcheckSnapshot) {
    setSpellcheckResults(state.results);
    setSpellcheckMeta(state.meta);
    setSpellcheckSummary(state.summary);
    setSpellcheckSecondarySummary(state.secondarySummary);
    setSpellcheckInvalidatedCount(state.invalidatedCount);
  }

  function resolveSpellcheckStateAfterDocumentCommit(
    nextDocument: EditorDocument,
    options?: CommitDocumentOptions
  ): EditorSpellcheckSnapshot {
    if (options?.spellcheckState) {
      return options.spellcheckState;
    }

    if (options?.preserveSpellcheck) {
      return captureCurrentSpellcheckState();
    }

    if (spellcheckResults.length === 0) {
      return createEmptySpellcheckState();
    }

    const nextSpellcheckResults = invalidateSpellcheckResultsForChangedBlocks(document, nextDocument, spellcheckResults);
    const invalidatedCount = Math.max(0, spellcheckResults.length - nextSpellcheckResults.length);

    if (nextSpellcheckResults.length === 0) {
      return spellcheckResults.length > 0 && invalidatedCount > 0
        ? createInvalidatedSpellcheckState(invalidatedCount)
        : createEmptySpellcheckState();
    }

    const nextInvalidatedCount = spellcheckInvalidatedCount + invalidatedCount;

    return createSpellcheckState(
      nextSpellcheckResults,
      {
        checkedBlockCount: nextSpellcheckResults.length,
        issueCount: countSpellcheckIssues(nextSpellcheckResults),
        skippedCount: spellcheckMeta?.skippedCount ?? 0,
        errorCount: nextSpellcheckResults.filter((entry) => Boolean(entry.error)).length
      },
      nextInvalidatedCount
    );
  }

  function updateSpellcheckSummary(results: SpellcheckBlockResult[], meta: SpellcheckSummaryMeta, invalidatedCount = spellcheckInvalidatedCount) {
    applySpellcheckState(createSpellcheckState(results, meta, invalidatedCount));
  }

  useEffect(() => {
    if (spellcheckDictionaryWords.length === 0 || spellcheckResults.length === 0) {
      return;
    }

    const filteredResults = filterSpellcheckResultsWithDictionary(spellcheckResults);

    if (countSpellcheckIssues(filteredResults) === countSpellcheckIssues(spellcheckResults)) {
      return;
    }

    updateSpellcheckSummary(
      filteredResults,
      buildSpellcheckSummaryMeta(filteredResults, spellcheckMeta?.skippedCount ?? 0),
      spellcheckInvalidatedCount
    );
  }, [spellcheckDictionaryWords, spellcheckResults, spellcheckMeta?.skippedCount, spellcheckInvalidatedCount]);

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
      rejectedReviewIdeas,
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
      compareHistory,
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
    compareHistory,
    normalizedSelection,
    operations,
    patchDiagnostics,
    reviewExpertise,
    reviewDiagnostics,
    reviewComposer,
    reviewItems,
    rejectedReviewIdeas,
    revision,
    activeWorkflowStep,
    stepRunHistory,
    stepFeedback,
    stepRunModeByStep
  ]);

  function openComposer(nextMode: ComposerMode) {
    if (composerCloseTimeoutRef.current) {
      window.clearTimeout(composerCloseTimeoutRef.current);
      composerCloseTimeoutRef.current = null;
    }

    setIsComposerClosing(false);
    if (nextMode === "local") {
      setSuppressedLocalComposerSelectionNonce(null);
    }
    setComposerMode(nextMode);
  }

  function closeComposer(options?: { immediate?: boolean; suppressAutoOpenForSelection?: number | null }) {
    if (composerCloseTimeoutRef.current) {
      window.clearTimeout(composerCloseTimeoutRef.current);
      composerCloseTimeoutRef.current = null;
    }

    if (typeof options?.suppressAutoOpenForSelection !== "undefined") {
      setSuppressedLocalComposerSelectionNonce(options.suppressAutoOpenForSelection);
    }

    if (options?.immediate || !composerMode) {
      setIsComposerClosing(false);
      setComposerMode(null);
      return;
    }

    setIsComposerClosing(true);
    composerCloseTimeoutRef.current = window.setTimeout(() => {
      composerCloseTimeoutRef.current = null;
      setComposerMode(null);
      setIsComposerClosing(false);
    }, 170);
  }

  function closeComposerForCurrentSelection(options?: { immediate?: boolean }) {
    closeComposer({
      immediate: options?.immediate,
      suppressAutoOpenForSelection: selectionChangeNonceRef.current
    });
  }

  useEffect(() => {
    setSelectionChangeNonce((current) => current + 1);
  }, [selection]);

  useEffect(() => {
    selectionChangeNonceRef.current = selectionChangeNonce;
  }, [selectionChangeNonce]);

  useEffect(() => {
    if (normalizedSelection.blockIds.length > 0) {
      if (composerMode !== "review" && suppressedLocalComposerSelectionNonce !== selectionChangeNonce) {
        openComposer("local");
      }
      return;
    }

    if (suppressedLocalComposerSelectionNonce !== null) {
      setSuppressedLocalComposerSelectionNonce(null);
    }

    if (composerMode === "local") {
      closeComposer();
    }
  }, [composerMode, normalizedSelection.blockIds, selectionChangeNonce, suppressedLocalComposerSelectionNonce]);

  useEffect(
    () => () => {
      if (recentChangeTimeoutRef.current) {
        window.clearTimeout(recentChangeTimeoutRef.current);
      }
      if (dismissUndoTimeoutRef.current) {
        window.clearTimeout(dismissUndoTimeoutRef.current);
      }
      if (destructiveRecoveryTimeoutRef.current) {
        window.clearTimeout(destructiveRecoveryTimeoutRef.current);
      }
      if (composerCloseTimeoutRef.current) {
        window.clearTimeout(composerCloseTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!destructiveRecoveryState) {
      if (destructiveRecoveryTimeoutRef.current) {
        window.clearTimeout(destructiveRecoveryTimeoutRef.current);
        destructiveRecoveryTimeoutRef.current = null;
      }
      return;
    }

    destructiveRecoveryTimeoutRef.current = window.setTimeout(() => {
      setDestructiveRecoveryState(null);
      destructiveRecoveryTimeoutRef.current = null;
    }, 5000);

    return () => {
      if (destructiveRecoveryTimeoutRef.current) {
        window.clearTimeout(destructiveRecoveryTimeoutRef.current);
        destructiveRecoveryTimeoutRef.current = null;
      }
    };
  }, [destructiveRecoveryState]);

  useEffect(() => {
    let cancelled = false;

    void readSpellcheckDictionaryWords()
      .then((words) => {
        if (!cancelled) {
          setSpellcheckDictionaryWords(Array.from(createSpellcheckDictionarySet(words)));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleUndoRedoHotkeys(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;

      if (target && (target.closest("input, textarea, select") || target.closest('[contenteditable="true"]'))) {
        return;
      }

      const action = getUndoRedoHotkeyAction(event);

      if (action === "redo") {
        event.preventDefault();
        redoLastMutation();
        return;
      }

      if (action === "undo") {
        event.preventDefault();
        undoLastMutation();
      }
    }

    window.addEventListener("keydown", handleUndoRedoHotkeys);
    return () => window.removeEventListener("keydown", handleUndoRedoHotkeys);
  }, [mutationHistoryFuture.length, mutationHistoryPast.length]);

  useEffect(() => {
    function handleEditorHotkeys(event: KeyboardEvent) {
      const action = getEditorHotkeyAction(event);

      if (!action) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isPlainFormField = Boolean(target?.closest("input, textarea, select")) && !Boolean(target?.closest('[contenteditable="true"]'));

      if (action === "open_global_replace") {
        if (isPlainFormField && !target?.closest(".global-replace-dialog")) {
          return;
        }

        event.preventDefault();
        setIsGlobalReplaceOpen(true);
        return;
      }

      if (isPlainFormField) {
        return;
      }

      event.preventDefault();
      setEditorHotkeyCommand("toggle_bullet_list");
      setEditorHotkeyCommandNonce((current) => current + 1);
    }

    window.addEventListener("keydown", handleEditorHotkeys);
    return () => window.removeEventListener("keydown", handleEditorHotkeys);
  }, []);

  useEffect(() => {
    if (!isGlobalReplaceOpen) {
      return;
    }

    window.requestAnimationFrame(() => {
      globalReplaceSearchInputRef.current?.focus();
      globalReplaceSearchInputRef.current?.select();
    });
  }, [isGlobalReplaceOpen]);

  useEffect(() => {
    if (!isGlobalReplaceOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeGlobalReplace();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isGlobalReplaceOpen]);

  function closeGlobalReplace() {
    setIsGlobalReplaceOpen(false);
  }

  function applyGlobalReplace() {
    const searchText = globalReplaceSearch;

    if (!searchText) {
      setFeedback({ tone: "error", message: "Вкажіть текст для заміни." });
      return;
    }

    const result = replaceTextInDocument(document, searchText, globalReplaceReplacement);

    if (result.replacementCount === 0) {
      setFeedback({ tone: "info", message: "Збігів не знайдено." });
      return;
    }

    commitDocument(result.document, {
      history: {
        kind: "manual_edit",
        label: "Глобальна заміна",
        blockIds: result.changedBlockIds
      }
    });
    focusAndHighlightChangedBlocks(result.changedBlockIds);
    setFeedback({
      tone: "info",
      message: `Замінено: ${result.replacementCount} · Абз. зі змінами: ${result.changedBlockIds.length}.`
    });
    setIsGlobalReplaceOpen(false);
  }

  function commitDocument(nextDocument: EditorDocument, options?: CommitDocumentOptions) {
    const nextRevision = deriveManuscriptRevisionState(nextDocument);
    const nextSpellcheckState = resolveSpellcheckStateAfterDocumentCommit(nextDocument, options);
    const nextSelection = normalizeBlockSelection(nextDocument, normalizedSelection);
    const nextFocusedBlockId =
      focusedBlockId && nextDocument.blocks.some((block) => block.id === focusedBlockId)
        ? focusedBlockId
        : nextSelection.focusBlockId ?? nextSelection.anchorBlockId ?? nextDocument.blocks[0]?.id ?? null;

    if (!options?.suppressHistory && options?.history) {
      registerMutation(nextDocument, nextSelection, nextFocusedBlockId, options.history, nextSpellcheckState);
    }

    setDocument(nextDocument);
    setRevision(nextRevision);
    setSelection(nextSelection);
    setFocusedBlockId(nextFocusedBlockId);
    setReviewItems((current) => reconcileReviewItemsWithRevision(current, nextDocument, nextRevision));
    applySpellcheckState(nextSpellcheckState);
  }

  function captureEditorSessionSnapshot(): EditorSessionSnapshot {
    return structuredClone({
      document,
      selection: normalizedSelection,
      focusedBlockId,
      operations,
      reviewItems,
      rejectedReviewIdeas,
      patchDiagnostics,
      reviewDiagnostics,
      feedback,
      history,
      mutationHistoryPast,
      mutationHistoryFuture,
      compareHistory,
      activeCompareEntryId,
      customPrompt,
      activeReviewItemId,
      activeProposal,
      composerMode,
      reviewExpertise,
      activeWorkflowStep,
      manualCalloutKind,
      manualCalloutDepth,
      manualVisualIntent,
      localActionMode,
      localTextIntent,
      manualCalloutPrompt,
      manualVisualPrompt,
      spellcheck: captureCurrentSpellcheckState(),
      visualStylePreset,
      stepFeedback,
      stepRunModeByStep,
      stepRunHistory,
      factCheckRows,
      showCompletedCards,
      reviewRefineInstruction
    });
  }

  function restoreEditorSessionSnapshot(snapshot: EditorSessionSnapshot) {
    const nextDocument = cloneEditorDocument(snapshot.document);
    const nextRevision = deriveManuscriptRevisionState(nextDocument);

    setDocument(nextDocument);
    setRevision(nextRevision);
    setSelection(normalizeBlockSelection(nextDocument, snapshot.selection));
    setFocusedBlockId(snapshot.focusedBlockId ?? snapshot.selection.focusBlockId ?? snapshot.selection.anchorBlockId ?? nextDocument.blocks[0]?.id ?? null);
    setOperations(snapshot.operations);
    setReviewItems(snapshot.reviewItems);
    setRejectedReviewIdeas(snapshot.rejectedReviewIdeas);
    setPatchDiagnostics(snapshot.patchDiagnostics);
    setReviewDiagnostics(snapshot.reviewDiagnostics);
    setFeedback(snapshot.feedback);
    setHistory(snapshot.history);
    setMutationHistoryPast(snapshot.mutationHistoryPast);
    setMutationHistoryFuture(snapshot.mutationHistoryFuture);
    setCompareHistory(snapshot.compareHistory);
    setActiveCompareEntryId(snapshot.activeCompareEntryId);
    setExpandedCompareEntryId(snapshot.activeCompareEntryId);
    setCustomPrompt(snapshot.customPrompt);
    setActiveReviewItemId(snapshot.activeReviewItemId);
    setActiveProposal(snapshot.activeProposal);
    setComposerMode(snapshot.composerMode);
    setReviewExpertise(snapshot.reviewExpertise);
    setActiveWorkflowStep(snapshot.activeWorkflowStep);
    setManualCalloutKind(snapshot.manualCalloutKind);
    setManualCalloutDepth(normalizeEditorialCalloutDepth(snapshot.manualCalloutDepth));
    setManualVisualIntent(snapshot.manualVisualIntent);
    setLocalActionMode(snapshot.localActionMode === "auto" ? "edit" : snapshot.localActionMode);
    setLocalTextIntent(snapshot.localTextIntent);
    setManualCalloutPrompt(snapshot.manualCalloutPrompt);
    setManualVisualPrompt(snapshot.manualVisualPrompt);
    applySpellcheckState(snapshot.spellcheck);
    setVisualStylePreset(snapshot.visualStylePreset);
    setStepFeedback(snapshot.stepFeedback);
    setStepRunModeByStep(snapshot.stepRunModeByStep);
    setStepRunHistory(snapshot.stepRunHistory);
    setFactCheckRows(snapshot.factCheckRows);
    setShowCompletedCards(snapshot.showCompletedCards);
    setReviewRefineInstruction(snapshot.reviewRefineInstruction);
    setPendingDestructiveAction(null);
    setDestructiveRecoveryState(null);
    setRecentlyChangedBlockIds([]);
    setDismissUndoState(null);
    setActiveTopActionMenu(null);
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
    setRejectedReviewIdeas([]);
    setPatchDiagnostics(null);
    setReviewDiagnostics(null);
    setReviewExpertise(null);
    setFactCheckRows([]);
    setFeedback(nextFeedback);
    setHistory([]);
    setMutationHistoryPast([]);
    setMutationHistoryFuture([]);
    setCompareHistory([]);
    setActiveCompareEntryId(null);
    setExpandedCompareEntryId(null);
    setActiveReviewItemId(null);
    setActiveProposal(null);
    setReviewComposer(defaultReviewComposer);
    closeComposer({ immediate: true });
    setCustomPrompt("");
    setManualCalloutKind(defaultManualCalloutKind);
    setManualCalloutDepth(defaultManualCalloutDepth);
    setManualVisualIntent(defaultManualVisualIntent);
    setManualGenerationInFlight(null);
    setLocalActionMode(defaultLocalActionMode);
    setLocalTextIntent(defaultLocalTextIntent);
    setManualCalloutPrompt("");
    setManualVisualPrompt("");
    setStepFeedback(createDefaultStepFeedbackMap());
    setStepRunModeByStep(createDefaultStepRunModeMap("replace"));
    setStepRunHistory(createEmptyStepRunHistory());
    setActiveWorkflowStep("diagnostics");
    setRecentlyChangedBlockIds([]);
    setDismissUndoState(null);
    setPendingDestructiveAction(null);
    reviewNoOpStreakRef.current = {};
    patchNoOpStreakRef.current = {};
    clearSpellcheckResults();
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

  function focusBlockById(blockId: string, options?: { select?: boolean }) {
    const blockIndex = revision.blockOrder.indexOf(blockId);

    if (blockIndex < 0) {
      return;
    }

    const shouldSelect = options?.select ?? true;

    if (shouldSelect) {
      setSelection(
        normalizeBlockSelection(document, {
          blockIds: [blockId],
          anchorBlockId: blockId,
          focusBlockId: blockId
        })
      );
    } else {
      setSelection(EMPTY_BLOCK_SELECTION);
    }
    setFocusedBlockId(blockId);

    const anchor = window.document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleCompareParagraphFocus(entry: CompareHistoryEntry) {
    const targetBlockId = entry.blockIds.find((blockId) => revision.blockOrder.includes(blockId));

    if (!targetBlockId) {
      return;
    }

    setActiveCompareEntryId(null);
    setExpandedCompareEntryId(null);

    window.requestAnimationFrame(() => {
      focusBlockById(targetBlockId);
    });
  }

  function handleCompareDraftChange(index: number, value: string) {
    if (!activeCompareEntry || !canEditActiveCompare) {
      return;
    }

    const nextDraftTexts = activeCompareEditableBlocks.map((block, blockIndex) =>
      blockIndex === index ? value : (compareDraftTexts[blockIndex] ?? formatCompareBlockText(block))
    );
    setCompareDraftTexts(nextDraftTexts);

    const nextBlocks = activeCompareEditableBlocks.map((block, blockIndex) =>
      withEditedCompareBlockText(block, nextDraftTexts[blockIndex] ?? formatCompareBlockText(block))
    );
    const nextDocument = replaceBlocksByIds(document, activeCompareEntry.blockIds, nextBlocks);

    commitDocument(nextDocument, {
      history: {
        kind: "manual_edit",
        label: "Ручне редагування з порівняння",
        blockIds: activeCompareEntry.blockIds,
        mergeKey: `compare-edit:${activeCompareEntry.blockIds.join("|")}`
      }
    });
  }

  function pushHistoryEntry(entry: RequestHistoryItem) {
    setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 8));
  }

  function updateStepFeedbackValue(stepId: EditorialReviewStepId, value: string) {
    setStepFeedback((current) => ({ ...current, [stepId]: value }));
  }

  function updateStepRunMode(stepId: EditorialReviewStepId, mode: EditorialStepRunMode) {
    setStepRunModeByStep((current) => ({ ...current, [stepId]: mode }));
  }

  function selectWorkflowStep(stepId: WorkflowStepId) {
    setActiveWorkflowStep(stepId);
    setShowCompletedCards(false);
    setShowRecommendationStatusStrip(false);
    setFeedback(null);
    setPendingDestructiveAction(null);
  }

  function resolveTargetBlockIds() {
    if (normalizedSelection.blockIds.length > 0) {
      return normalizedSelection.blockIds;
    }

    return focusedBlockId ? [focusedBlockId] : [];
  }

  async function requestPatch(mode: RequestMode, promptOverride?: string): Promise<boolean> {
    const targetBlockIds = resolveTargetBlockIds();

    if (targetBlockIds.length === 0) {
      setFeedback({ tone: "error", message: "Оберіть блоки для локальної правки." });
      return false;
    }

    setIsPatchRequestInFlight(true);
    setFeedback(null);
    setActiveProposal(null);
    setActiveReviewItemId(null);

    try {
      const patchRequestDocument = sliceDocumentForBlockRange(document, targetBlockIds, {
        before: 1,
        after: 1
      });
      const requestBody = {
        document: patchRequestDocument,
        targetBlockIds,
        mode,
        prompt: mode === "custom" ? (promptOverride ?? customPrompt).trim() : undefined,
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
      const primaryOperation = payload.operations.find((operation) => operation.op === "replace_blocks");

      if (primaryOperation) {
        setActiveProposal(
          buildLocalPatchProposal(
            primaryOperation,
            revision.documentRevisionId,
            noOpAssessment.isNoOp
              ? {
                  code: "no_op",
                  message: nextFeedback.message,
                  similarity: noOpAssessment.maxSimilarity
                }
              : undefined
          )
        );
        setFocusedBlockId(primaryOperation.blockIds.at(-1) ?? primaryOperation.blockIds[0] ?? null);

        const anchorBlockId = primaryOperation.blockIds[0];

        if (anchorBlockId) {
          window.requestAnimationFrame(() => {
            const element = window.document.querySelector<HTMLElement>(`[data-block-id="${anchorBlockId}"]`);
            element?.scrollIntoView({ block: "center", behavior: "smooth" });
          });
        }
      }

      setPatchDiagnostics(payload.diagnostics);
      setFeedback(nextFeedback);
      pushHistoryEntry(
        createHistoryEntry(mode, payload.providerUsed, settings.provider, settings.modelId, payload.operations.length, payload.diagnostics.droppedOperationCount, payload.usedFallback, nextFeedback)
      );
      return response.ok && !payload.error && payload.operations.length > 0;
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося виконати локальну правку."
      });
      return false;
    } finally {
      setIsPatchRequestInFlight(false);
    }
  }

  async function requestSpellcheck(targetBlockIds = document.blocks.map((block) => block.id)): Promise<boolean> {

    if (targetBlockIds.length === 0) {
      setFeedback({ tone: "error", message: "Оберіть один або кілька абзаців для перевірки правопису." });
      return false;
    }

    const spellcheckTargets = getSpellcheckableBlocks(document, revision, targetBlockIds);
    const skippedCount = targetBlockIds.length - spellcheckTargets.length;

    if (spellcheckTargets.length === 0) {
      setFeedback({ tone: "error", message: "Для перевірки правопису наразі доступні лише текстові абзаци та заголовки." });
      clearSpellcheckResults();
      return false;
    }

    setIsSpellcheckRequestInFlight(true);
    setFeedback(null);
    setSpellcheckInvalidatedCount(0);
    setSpellcheckSummary(null);
    setSpellcheckSecondarySummary(null);

    try {
      const chunks = createSpellcheckBatchChunks(spellcheckTargets);
      const resultsMap = new Map<string, SpellcheckBlockResult>(
        spellcheckTargets.map((target) => [
          target.blockId,
          {
            blockId: target.blockId,
            paragraphLabel: target.paragraphLabel,
            text: target.text,
            issues: []
          }
        ])
      );

      for (const chunk of chunks) {
        const response = await fetch("/api/edit/spellcheck", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentRevisionId: revision.documentRevisionId,
            language: "uk-UA",
            provider: "languagetool_public",
            trigger: "manual",
            selection: {
              blockId: chunk.chunkId,
              text: chunk.text,
              range: { start: 0, end: chunk.text.length }
            }
          })
        });

        const payload = (await response.json()) as SpellcheckResponse;

        if (payload.error && (payload.issues?.length ?? 0) === 0) {
          for (const part of chunk.parts) {
            const current = resultsMap.get(part.blockId);

            if (current) {
              current.error = payload.error;
            }
          }
          continue;
        }

        for (const issue of payload.issues ?? []) {
          const owner = chunk.parts.find((part) => issue.range.start >= part.textStart && issue.range.end <= part.textEnd);

          if (!owner) {
            continue;
          }

          const current = resultsMap.get(owner.blockId);

          if (!current) {
            continue;
          }

          current.issues.push({
            ...issue,
            range: {
              start: issue.range.start - owner.textStart,
              end: issue.range.end - owner.textStart
            },
            badText: owner.text.slice(issue.range.start - owner.textStart, issue.range.end - owner.textStart)
          });
        }
      }

      const runResults = spellcheckTargets
        .map((target) => resultsMap.get(target.blockId))
        .filter((result): result is SpellcheckBlockResult => Boolean(result));
      const filteredRunResults = filterSpellcheckResultsWithDictionary(runResults);
      const mergedResults = mergeSpellcheckBlockResults(spellcheckResults, filteredRunResults);
      const issueCount = countSpellcheckIssues(filteredRunResults);
      const errorCount = filteredRunResults.filter((result) => Boolean(result.error)).length;
      const summary = buildSpellcheckSummaryMeta(mergedResults, skippedCount);
      setActiveWorkflowStep("spellcheck");
      updateSpellcheckSummary(mergedResults, summary, 0);
      const nextSummary =
        issueCount > 0
          ? `Знайдено ${issueCount} проблем у ${filteredRunResults.filter((result) => result.issues.length > 0).length} абз.`
          : `Помилок не знайдено у ${filteredRunResults.length} абз.`;
      setFeedback({
        tone: errorCount > 0 ? "error" : "info",
        message: nextSummary
      });
      pushHistoryEntry(
        createHistoryEntry(
          "spellcheck",
          "languagetool_public",
          "languagetool_public",
          "uk-UA",
          issueCount,
          skippedCount,
          false,
          {
            tone: errorCount > 0 ? "error" : "info",
            message: nextSummary
          }
        )
      );
      return true;
    } catch (error) {
      clearSpellcheckResults();
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося перевірити правопис."
      });
      return false;
    } finally {
      setIsSpellcheckRequestInFlight(false);
    }
  }

  function applySpellcheckSuggestion(input: { blockId: string; issueId: string; suggestion: string }) {
    const block = document.blocks.find((entry) => entry.id === input.blockId);

    if (!block || (block.type !== "paragraph" && block.type !== "heading")) {
      return;
    }

    const blockResult = spellcheckResults.find((entry) => entry.blockId === input.blockId);
    const issue = blockResult?.issues.find((entry) => entry.id === input.issueId);

    if (!issue) {
      return;
    }

    const nextContent = replaceInlineRangeWithText(block.content, issue.range.start, issue.range.end, input.suggestion);
    const nextDocument: EditorDocument = {
      version: 2,
      blocks: document.blocks.map((entry) =>
        entry.id === input.blockId
          ? {
              ...entry,
              content: nextContent
            }
          : entry
      )
    };
    const delta = input.suggestion.length - (issue.range.end - issue.range.start);
    const nextSpellcheckResults = spellcheckResults.map((entry) => {
      if (entry.blockId !== input.blockId) {
        return entry;
      }

      const shiftedIssues = entry.issues
        .filter((candidate) => {
          if (candidate.id === issue.id) {
            return false;
          }

          return candidate.range.end <= issue.range.start || candidate.range.start >= issue.range.end;
        })
        .map((candidate) => {
          if (candidate.range.start >= issue.range.end) {
            return {
              ...candidate,
              range: {
                start: candidate.range.start + delta,
                end: candidate.range.end + delta
              }
            };
          }

          return candidate;
        });

      return {
        ...entry,
        text: replaceTextRange(entry.text, issue.range.start, issue.range.end, input.suggestion),
        issues: shiftedIssues
      };
    });
    const filteredSpellcheckResults = filterSpellcheckResultsWithDictionary(nextSpellcheckResults);
    const summaryMeta: SpellcheckSummaryMeta = {
      checkedBlockCount: filteredSpellcheckResults.length,
      issueCount: countSpellcheckIssues(filteredSpellcheckResults),
      skippedCount: spellcheckMeta?.skippedCount ?? 0,
      errorCount: filteredSpellcheckResults.filter((entry) => Boolean(entry.error)).length
    };

    setSpellcheckInvalidatedCount(0);
    const previousChangedBlock = document.blocks.find((entry) => entry.id === input.blockId);
    const nextChangedBlock = nextDocument.blocks.find((entry) => entry.id === input.blockId);
    commitDocument(nextDocument, {
      preserveSpellcheck: true,
      spellcheckState: createSpellcheckState(filteredSpellcheckResults, summaryMeta, 0),
      history: {
        kind: "spellcheck_apply",
        label: "Виправлення правопису",
        blockIds: [input.blockId],
        compare:
          previousChangedBlock && nextChangedBlock
            ? {
                kind: "spellcheck_apply",
                label: "Виправлення правопису",
                blockIds: [input.blockId],
                beforeBlocks: [previousChangedBlock],
                afterBlocks: [nextChangedBlock]
              }
            : null
      }
    });
    updateSpellcheckSummary(filteredSpellcheckResults, summaryMeta, 0);
    setFeedback({ tone: "info", message: input.suggestion.length === 0 ? "Фрагмент видалено." : "Правопис виправлено." });
  }

  function dismissSpellcheckIssue(input: { blockId: string; issueId: string }) {
    const nextSpellcheckResults = spellcheckResults.map((entry) =>
      entry.blockId === input.blockId
        ? {
            ...entry,
            issues: entry.issues.filter((issue) => issue.id !== input.issueId)
          }
        : entry
    );

    const filteredSpellcheckResults = filterSpellcheckResultsWithDictionary(nextSpellcheckResults);
    const summaryMeta: SpellcheckSummaryMeta = {
      checkedBlockCount: spellcheckMeta?.checkedBlockCount ?? filteredSpellcheckResults.length,
      issueCount: countSpellcheckIssues(filteredSpellcheckResults),
      skippedCount: spellcheckMeta?.skippedCount ?? 0,
      errorCount: filteredSpellcheckResults.filter((entry) => Boolean(entry.error)).length
    };

    setSpellcheckInvalidatedCount(0);
    updateSpellcheckSummary(filteredSpellcheckResults, summaryMeta, 0);
    setFeedback({ tone: "info", message: "Варіант залишено без змін." });
  }

  async function addSpellcheckWordToDictionary(input: { blockId: string; issueId: string; word: string }) {
    const blockResult = spellcheckResults.find((entry) => entry.blockId === input.blockId);
    const issue = blockResult?.issues.find((entry) => entry.id === input.issueId);
    const word = (issue?.badText ?? input.word).trim();

    if (!word) {
      return;
    }

    try {
      await addSpellcheckDictionaryWord(word);
      const nextDictionaryWords = Array.from(createSpellcheckDictionarySet([...spellcheckDictionaryWords, word]));
      const nextSpellcheckResults = filterSpellcheckResultsWithDictionary(spellcheckResults, nextDictionaryWords);
      const summaryMeta = buildSpellcheckSummaryMeta(nextSpellcheckResults, spellcheckMeta?.skippedCount ?? 0);

      setSpellcheckDictionaryWords(nextDictionaryWords);
      updateSpellcheckSummary(nextSpellcheckResults, summaryMeta, spellcheckInvalidatedCount);
      setFeedback({ tone: "info", message: `Слово «${word}» додано до словника.` });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося додати слово до словника."
      });
    }
  }

  function applyEmphasisSuggestion(input: { itemId: string }) {
    const suggestion = deriveEmphasisSuggestions(reviewItems, document, revision).find((entry) => entry.itemId === input.itemId);

    if (!suggestion) {
      setFeedback({ tone: "error", message: "Акцент більше не прив'язується до поточного тексту." });
      return;
    }

    const result = applyEmphasisSuggestionsToDocument(document, [suggestion]);

    if (result.changedBlockIds.length === 0) {
      setFeedback({ tone: "error", message: "Акцент не вдалося застосувати." });
      return;
    }

    commitDocument(result.document, {
      history: {
        kind: "ai_apply",
        label: "Смисловий акцент",
        blockIds: result.changedBlockIds,
        compare:
          result.beforeBlocks.length > 0 && result.afterBlocks.length > 0
            ? {
                kind: "ai_apply",
                label: `Акцент: ${suggestion.phrase}`,
                blockIds: result.changedBlockIds,
                beforeBlocks: result.beforeBlocks,
                afterBlocks: result.afterBlocks
              }
            : null
      }
    });
    setReviewItems((current) =>
      current.map((entry) => (entry.id === input.itemId ? { ...entry, status: "applied", activeProposalId: undefined } : entry))
    );
    setActiveProposal((current) => (current?.reviewItemId === input.itemId ? null : current));
    setActiveReviewItemId((current) => (current === input.itemId ? null : current));
    focusAndHighlightChangedBlocks(result.changedBlockIds);
    setFeedback({ tone: "info", message: "Акцент застосовано." });
  }

  function applyAllEmphasisSuggestions() {
    const actionableSuggestions = deriveEmphasisSuggestions(reviewItems, document, revision).filter(
      (entry) => entry.status !== "applied" && entry.status !== "dismissed"
    );

    if (actionableSuggestions.length === 0) {
      setFeedback({ tone: "info", message: "Немає активних акцентів для застосування." });
      return;
    }

    const result = applyEmphasisSuggestionsToDocument(document, actionableSuggestions);

    if (result.changedBlockIds.length === 0) {
      setFeedback({ tone: "error", message: "Акценти не вдалося застосувати." });
      return;
    }

    const appliedItemIds = new Set(result.appliedItemIds);

    commitDocument(result.document, {
      history: {
        kind: "ai_apply",
        label: "Прийняти всі акценти",
        blockIds: result.changedBlockIds,
        compare:
          result.beforeBlocks.length > 0 && result.afterBlocks.length > 0
            ? {
                kind: "ai_apply",
                label: `Акценти: ${appliedItemIds.size}`,
                blockIds: result.changedBlockIds,
                beforeBlocks: result.beforeBlocks,
                afterBlocks: result.afterBlocks
              }
            : null
      }
    });
    focusAndHighlightChangedBlocks(result.changedBlockIds);
    setReviewItems((current) =>
      current.map((entry) =>
        appliedItemIds.has(entry.id)
          ? { ...entry, status: "applied", activeProposalId: undefined }
          : entry
      )
    );
    setActiveProposal((current) => (current && appliedItemIds.has(current.reviewItemId) ? null : current));
    setActiveReviewItemId((current) => (current && appliedItemIds.has(current) ? null : current));
    setFeedback({
      tone: "info",
      message: `Застосовано ${appliedItemIds.size} акцентів у ${result.changedBlockIds.length} абз.`
    });
  }

  function handleLocalActionModeChange(mode: LocalActionMode) {
    setLocalActionMode(mode);
  }

  async function requestResolvedLocalAction(): Promise<boolean> {
    const targetBlockIds = resolveTargetBlockIds();

    if (targetBlockIds.length === 0) {
      setFeedback({ tone: "error", message: "Оберіть блоки для локальної дії." });
      return false;
    }

    try {
      const response = await fetch("/api/edit/local-action", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:
            localActionMode === "callout"
              ? manualCalloutPrompt
              : localActionMode === "visual"
                ? manualVisualPrompt
                : customPrompt,
          explicitMode: localActionMode === "auto" ? null : localActionMode,
          preferredTextIntent: localTextIntent,
          calloutKind: manualCalloutKind,
          calloutDepth: manualCalloutDepth,
          visualIntent: manualVisualIntent,
          visualStylePreset
        })
      });

      const payload = (await response.json()) as LocalActionRouteResponse | { error?: string };

      if (!response.ok || !isLocalActionRoutePayload(payload)) {
        setFeedback({
          tone: "error",
          message: "error" in payload && payload.error ? payload.error : "Не вдалося визначити локальну дію."
        });
        return false;
      }

      if (payload.executor === "clarify") {
        setFeedback({ tone: "info", message: "Уточніть, що саме зробити: правка, врізка чи візуал." });
        return false;
      }

      if (payload.executor === "spellcheck") {
        setActiveWorkflowStep("spellcheck");
        return await requestSpellcheck(targetBlockIds);
      }

      if (payload.executor === "patch") {
        return await requestPatch(payload.requestMode, payload.prompt);
      }

      if (payload.executor === "review") {
        return await requestManualInsert(payload.recommendationType, {
          editorialInstruction: payload.prompt
        });
      }

      if (payload.executor === "callout") {
        return await requestManualInsert("callout", {
          calloutKind: payload.calloutKind,
          calloutDepth: payload.calloutDepth,
          editorialInstruction: payload.prompt
        });
      }

      return await requestManualInsert("visual", {
        visualIntent: payload.visualIntent,
        visualStylePreset: payload.visualStylePreset,
        editorialInstruction: payload.prompt
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося виконати локальну дію."
      });
      return false;
    }
  }

  async function requestWorkflowStep(stepId: EditorialReviewStepId) {
    const requiresDiagnosticsContext = stepId !== "diagnostics" && stepId !== "emphasis";

    if (requiresDiagnosticsContext && !reviewExpertise?.trim()) {
      setFeedback({ tone: "error", message: "Спочатку запустіть діагностику, щоб дати контекст для наступних кроків." });
      return;
    }

    setIsReviewRequestInFlight(true);
    setFeedback(null);
    const runMode = stepRunModeByStep[stepId] ?? "replace";
    const currentStepFeedback = stepFeedback[stepId]?.trim();
    const diagnosticsFeedback = stepFeedback.diagnostics?.trim();
    const historyMessages: ChatMessage[] = [];

    if (diagnosticsFeedback && stepId !== "emphasis") {
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
      const isEmphasisStep = stepId === "emphasis";
      const diagnosticsPrompt = settings.expertisePrompt.trim() || settings.reviewPrompt.trim() || undefined;
      const downstreamPrompt = settings.cardsPrompt.trim() || settings.reviewPrompt.trim() || undefined;
      const requestBody: EditorialReviewRequest = isEmphasisStep
        ? {
            document,
            revision: compactReviewRevision,
            provider: settings.provider,
            modelId: settings.modelId,
            apiKey: settings.apiKey || undefined,
            basePrompt: settings.basePrompt,
            cardsPrompt: settings.cardsPrompt.trim() || settings.reviewPrompt.trim() || undefined,
            workflowStepPrompts: settings.workflowStepPrompts,
            changeLevel: reviewComposer.changeLevel,
            additionalInstructions: reviewComposer.additionalInstructions,
            stepId,
            runMode,
            stepFeedback: currentStepFeedback || undefined,
            rejectedIdeas: rejectedReviewIdeas
          }
        : {
            document,
            revision: compactReviewRevision,
            provider: settings.provider,
            modelId: settings.modelId,
            apiKey: settings.apiKey || undefined,
            basePrompt: settings.basePrompt,
            expertisePrompt: stepId === "diagnostics" ? diagnosticsPrompt : undefined,
            cardsPrompt: stepId === "diagnostics" ? undefined : downstreamPrompt,
            workflowStepPrompts: settings.workflowStepPrompts,
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
            expertise: stepId === "diagnostics" ? undefined : reviewExpertise ?? undefined,
            rejectedIdeas: rejectedReviewIdeas
          };

      const response = await fetch("/api/edit/review", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = (await response.json()) as EditorialReviewResponse;

      if (payload.stepId !== stepId) {
        throw new Error(`Очікували відповідь для кроку «${stepId}», але сервер повернув «${payload.stepId}».`);
      }

      let sectionItemCount: number | undefined;
      let factCheckLinkedItems: EditorialReviewItem[] = [];

      if (payload.stepId === "diagnostics") {
        setReviewExpertise(payload.expertise?.trim() ? payload.expertise : null);
      }

      if (payload.stepId === "fact_check") {
        const nextFactCheckRows = payload.factCheckRows ?? [];
        setFactCheckRows(nextFactCheckRows);
        factCheckLinkedItems = createFactCheckLinkedReviewItems({
          rows: nextFactCheckRows,
          document,
          revision,
          changeLevel: reviewComposer.changeLevel,
          reviewSessionId: payload.reviewSessionId,
          stepRunId: payload.stepRunId
        });
        sectionItemCount = factCheckLinkedItems.length;

        setReviewItems((current) => {
          const existingNonFactItems = current.filter((item) => item.stepId !== "fact_check");
          const existingFactItems = current.filter((item) => item.stepId === "fact_check");
          const mergedFactItems = runMode === "replace" ? factCheckLinkedItems : [...factCheckLinkedItems, ...existingFactItems];
          return [...mergedFactItems, ...existingNonFactItems];
        });
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

      if (
        !payload.error
        && response.ok
        && payload.stepId !== "diagnostics"
        && payload.stepId !== "fact_check"
        && payload.stepId !== "emphasis"
      ) {
        setShowRecommendationStatusStrip(true);
      }

      const runSnapshot = {
        id: payload.stepRunId,
        stepId: payload.stepId,
        runMode: payload.runMode,
        createdAt: payload.diagnostics.generatedAt,
        documentRevisionId: revision.documentRevisionId,
        feedback: currentStepFeedback || undefined,
        expertise: payload.stepId === "diagnostics" ? payload.expertise ?? null : undefined,
        factCheckRows: payload.stepId === "fact_check" ? payload.factCheckRows ?? [] : undefined,
        itemIds:
          payload.stepId === "fact_check"
            ? factCheckLinkedItems.map((item) => item.id)
            : payload.stepId !== "diagnostics"
              ? payload.items.map((item) => item.id)
              : undefined
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
      if (runMode === "replace" && payload.stepId === "fact_check") {
        setActiveReviewItemId((current) => {
          if (!current) {
            return current;
          }

          return factCheckLinkedItems.some((item) => item.id === current) ? current : null;
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
          payload.stepId === "fact_check" ? factCheckLinkedItems.length : payload.items.length,
          payload.diagnostics.droppedItemCount,
          payload.usedFallback,
          nextFeedback
        )
      );

      if (payload.stepId === "diagnostics" && !payload.error) {
        closeComposer(); // Keep sidebar open if it's already open by other means
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
    if (
      item.stepId !== "diagnostics"
      && item.stepId !== "fact_check"
      && item.stepId !== "emphasis"
    ) {
      setShowRecommendationStatusStrip(false);
    }

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

    if (item.stepId === "emphasis") {
      return;
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
  }

  async function requestManualInsert(
    kind: ManualGenerationKind,
    overrides?: {
      calloutKind?: EditorialCalloutKind;
      calloutDepth?: EditorialCalloutDepth;
      visualIntent?: EditorialVisualIntent;
      visualStylePreset?: VisualStylePreset;
      editorialInstruction?: string;
    }
  ): Promise<boolean> {
    const blockIds = resolveTargetBlockIds();

    if (blockIds.length === 0) {
      setFeedback({ tone: "error", message: "Оберіть один або кілька абзаців для ручної генерації." });
      return false;
    }

    resetActiveExecutionLane();
    setActiveWorkflowStep(getWorkflowStepForManualKind(kind));

    const recommendationType =
      kind === "callout" ? "callout" : kind === "visual" ? "visual" : kind === "subsection" ? "subsection" : "list";
    if (kind === "visual") {
      persistVisualStylePreset(overrides?.visualStylePreset ?? visualStylePreset);
    }
    const draftItem = buildManualReviewItem({
      document,
      revision,
      blockIds,
      changeLevel: reviewComposer.changeLevel,
      recommendationType,
      calloutKind: overrides?.calloutKind ?? manualCalloutKind,
      calloutDepth: overrides?.calloutDepth ?? manualCalloutDepth,
      visualIntent: overrides?.visualIntent ?? manualVisualIntent,
      manualInstruction:
        overrides?.editorialInstruction ??
        (kind === "callout" ? manualCalloutPrompt : kind === "visual" ? manualVisualPrompt : customPrompt)
    });
    const upserted = upsertManualReviewItem(reviewItems, draftItem);

    setReviewItems(upserted.items);
    setActiveReviewItemId(upserted.item.id);
    setManualGenerationInFlight({ kind, key: upserted.dedupeKey });

    try {
      return await prepareReviewItem(upserted.item, {
        visualStylePreset: overrides?.visualStylePreset,
        editorialInstruction: overrides?.editorialInstruction
      });
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
      commitDocument(nextDocument, {
        history: {
          kind: "ai_apply",
          label: "ШІ правка",
          blockIds: activeProposal.textDiff.blockIds,
          compare: {
            kind: "ai_apply",
            label: activeProposal.summary || activeProposal.textDiff.reason || "ШІ правка",
            blockIds: activeProposal.textDiff.blockIds,
            beforeBlocks: activeProposal.textDiff.oldBlocks,
            afterBlocks: nextBlocks
          }
        }
      });
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
      compactItem.calloutDepth = normalizeEditorialCalloutDepth(item.calloutDepth);
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
        basePrompt: settings.basePrompt
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
  ): Promise<boolean> {
    if (
      item.stepId !== "diagnostics"
      && item.stepId !== "fact_check"
      && item.stepId !== "emphasis"
    ) {
      setShowRecommendationStatusStrip(false);
    }

    if (item.stepId === "emphasis") {
      focusReviewItem(item);
      return true;
    }

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
      return false;
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
      const factCheckInstruction = buildFactCheckActionInstruction(requestItem);
      const mergedInstruction = [factCheckInstruction, options?.editorialInstruction?.trim()]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join("\n\n");
      const requestBody = buildReviewActionRequestBody(
        requestItem,
        requestVisualStylePreset,
        mergedInstruction || undefined
      );
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
        return true;
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
        return true;
      }

      if (payload.proposal.kind === "callout_prompt" && payload.proposal.calloutDraft) {
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                ...entry,
                calloutDepth: payload.proposal.calloutDraft!.calloutDepth,
                calloutDraft: {
                  calloutKind: payload.proposal.calloutDraft!.calloutKind,
                  calloutDepth: payload.proposal.calloutDraft!.calloutDepth,
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
        return true;
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
        return true;
      }

      if (payload.error) {
        setReviewItems((current) =>
          current.map((entry) => (entry.id === item.id ? { ...entry, status: response.ok ? entry.status : "stale" } : entry))
        );
        setFeedback({ tone: response.ok ? "info" : "error", message: payload.error });
        return false;
      }

      return false;
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Не вдалося підготувати рекомендацію."
      });
      return false;
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
      depth: item.calloutDraft.calloutDepth,
      title: parseBoldMarkdownToInlineNodes(item.calloutDraft.title || getEditorialCalloutKindTitle(item.calloutDraft.calloutKind)),
      body: splitCalloutDraftIntoParagraphs(item.calloutDraft.previewText, item.calloutDraft.calloutKind)
    };

    commitDocument(insertBlocksAfter(document, item.insertionPoint.anchorBlockId, [block]), {
      history: {
        kind: "insert_block",
        label: "Вставка врізки",
        blockIds: [block.id]
      }
    });
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
        content: parseBoldMarkdownToInlineNodes(title)
      }
    ];

    if (lead) {
      blocks.push(
        ...splitTextIntoParagraphBlocks(lead).map((part) => ({
          id: createBlockId("paragraph"),
          type: "paragraph" as const,
          content: parseBoldMarkdownToInlineNodes(part)
        }))
      );
    }

    commitDocument(insertBlocksBefore(document, item.insertionPoint.anchorBlockId, blocks), {
      history: {
        kind: "insert_block",
        label: "Вставка підзаголовка",
        blockIds: blocks.map((entry) => entry.id)
      }
    });
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
        const depth = normalizeEditorialCalloutDepth(entry.calloutDraft?.calloutDepth ?? entry.calloutDepth);
        const draft = entry.calloutDraft ?? {
          calloutKind: kind,
          calloutDepth: depth,
          title: fallbackTitle,
          prompt: "",
          previewText: ""
        };

        return {
          ...entry,
          calloutKind: kind,
          calloutDepth: depth,
          calloutDraft: {
            ...draft,
            calloutKind: kind,
            calloutDepth: depth,
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
      const depth = normalizeEditorialCalloutDepth(current.calloutDraft?.calloutDepth);
      const draft = current.calloutDraft ?? {
        calloutKind: kind,
        calloutDepth: depth,
        title: fallbackTitle,
        prompt: "",
        previewText: ""
      };

      return {
        ...current,
        calloutDraft: {
          ...draft,
          calloutKind: kind,
          calloutDepth: depth,
          title: draft.title.trim() ? draft.title : fallbackTitle
        }
      };
    });
  }

  function updateActiveCalloutDepth(item: EditorialReviewItem, depth: EditorialCalloutDepth) {
    setReviewItems((current) =>
      current.map((entry) => {
        if (entry.id !== item.id) {
          return entry;
        }

        const kind = entry.calloutDraft?.calloutKind ?? entry.calloutKind ?? "mechanism";
        return {
          ...entry,
          calloutDepth: depth,
          calloutDraft: {
            calloutKind: kind,
            calloutDepth: depth,
            title: entry.calloutDraft?.title ?? getEditorialCalloutKindTitle(kind),
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
          calloutDepth: depth
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
        const depth = normalizeEditorialCalloutDepth(entry.calloutDraft?.calloutDepth ?? entry.calloutDepth);
        return {
          ...entry,
          calloutDraft: {
            calloutKind: kind,
            calloutDepth: depth,
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
        const depth = normalizeEditorialCalloutDepth(entry.calloutDraft?.calloutDepth ?? entry.calloutDepth);
        return {
          ...entry,
          calloutDraft: {
            calloutKind: kind,
            calloutDepth: depth,
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

      const nextPrompt = prompt;
      const shouldClearGeneratedAsset = nextPrompt.trim() !== current.imageDraft.prompt.trim();

      return {
        ...current,
        imageDraft: {
          ...current.imageDraft,
          prompt: nextPrompt,
          generatedAsset: shouldClearGeneratedAsset ? undefined : current.imageDraft.generatedAsset
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
    commitDocument(insertBlocksAfter(document, item?.insertionPoint.anchorBlockId ?? null, [block]), {
      history: {
        kind: "insert_block",
        label: "Вставка візуалу",
        blockIds: [block.id]
      }
    });
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

    const rejectedIdea = buildRejectedReviewIdea(item);
    const shouldStoreRejectedIdea = !rejectedReviewIdeas.some((idea) => getRejectedReviewIdeaKey(idea) === getRejectedReviewIdeaKey(rejectedIdea));

    if (shouldStoreRejectedIdea) {
      setRejectedReviewIdeas((current) => normalizeRejectedReviewIdeas([...current, rejectedIdea]));
    }

    setReviewItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "dismissed" } : entry)));
    if (activeReviewItemId === item.id) {
      setActiveReviewItemId(null);
      setActiveProposal((current) => (current?.reviewItemId === item.id ? null : current));
    }

    setDismissUndoState({ item, rejectedIdea: shouldStoreRejectedIdea ? rejectedIdea : undefined });
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
    if (dismissUndoState.rejectedIdea) {
      const rejectedIdeaKey = getRejectedReviewIdeaKey(dismissUndoState.rejectedIdea);
      setRejectedReviewIdeas((current) => current.filter((idea) => getRejectedReviewIdeaKey(idea) !== rejectedIdeaKey));
    }
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

    commitDocument(insertBlocksAfter(document, anchorBlockId, [block]), {
      history: {
        kind: "insert_block",
        label: "Вставка зображення",
        blockIds: [block.id]
      }
    });
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

      await persistImportedAssets(imported);
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
      await persistImportedAssets(imported);
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

  async function persistImportedAssets(imported: ImportedDocumentResult) {
    if (!imported.assets?.length) {
      return;
    }

    await Promise.all(
      imported.assets.map((asset) =>
        storeEditorAssetFromBlob({
          blob: asset.blob,
          assetId: asset.assetId,
          mimeType: asset.mimeType
        })
      )
    );
  }

  function handleClearDocument() {
    setActiveTopActionMenu(null);
    setDestructiveRecoveryState(null);
    setPendingDestructiveAction({
      kind: "clear_document",
      title: "Очистити весь вміст?",
      description: "Буде очищено текст і всі результати аналізів у цій локальній сесії.",
      confirmLabel: "Очистити"
    });
  }

  function confirmDestructiveAction() {
    if (!pendingDestructiveAction) {
      return;
    }

    const snapshot = captureEditorSessionSnapshot();

    clearEditorDraftState();
    replaceEditorSession(createBlankDocument(), { tone: "info", message: "Текст і результати аналізів очищено." });
    setDestructiveRecoveryState({
      kind: "clear_document",
      message: "Текст і результати аналізів очищено.",
      snapshot
    });
  }

  function undoDestructiveAction() {
    if (!destructiveRecoveryState) {
      return;
    }

    restoreEditorSessionSnapshot(destructiveRecoveryState.snapshot);
    setFeedback({ tone: "info", message: "Попередній стан відновлено." });
  }

  const canRequestReview = document.blocks.length > 0;
  const activeStepMeta = WORKFLOW_STEPS.find((step) => step.id === activeWorkflowStep) ?? WORKFLOW_STEPS[0];
  const ActiveStepIcon = activeStepMeta.icon;
  const activeStepSummary = WORKFLOW_STEP_SUMMARIES[activeWorkflowStep];
  const activeEditorialStepId = isEditorialReviewStepId(activeWorkflowStep) ? activeWorkflowStep : null;
  const activeStepFeedbackValue = activeEditorialStepId ? stepFeedback[activeEditorialStepId].trim() : "";
  const activeStepIndex = Math.max(
    1,
    WORKFLOW_STEPS.findIndex((step) => step.id === activeWorkflowStep) + 1
  );
  const activeStepItems = activeEditorialStepId ? stepItems[activeEditorialStepId] : [];
  const visibleActiveStepItems = activeStepItems.filter(
    (item) => showCompletedCards || (item.status !== "applied" && item.status !== "dismissed")
  );
  const structureOutline = useMemo(
    () => buildStructureOutline(document, activeStepItems, revision, showCompletedCards),
    [document, activeStepItems, revision, showCompletedCards]
  );
  const activeStepRunCount = activeEditorialStepId ? stepRunHistory[activeEditorialStepId].length : 0;
  const spellcheckIssueResults = useMemo(
    () => spellcheckResults.filter((result) => result.error || result.issues.length > 0),
    [spellcheckResults]
  );
  useEffect(() => {
    if (spellcheckIssueResults.length === 0) {
      setExpandedSpellcheckBlockId(null);
      return;
    }

    if (!expandedSpellcheckBlockId) {
      return;
    }

    if (!spellcheckIssueResults.some((result) => result.blockId === expandedSpellcheckBlockId)) {
      setExpandedSpellcheckBlockId(null);
    }
  }, [expandedSpellcheckBlockId, spellcheckIssueResults]);
  const emphasisSuggestions = useMemo(
    () => deriveEmphasisSuggestions(reviewItems, document, revision),
    [document, reviewItems, revision]
  );
  const emphasisStepItems = useMemo(
    () => reviewItems.filter((item) => item.stepId === "emphasis"),
    [reviewItems]
  );
  const emphasisSuggestionByItemId = useMemo(
    () => new Map(emphasisSuggestions.map((suggestion) => [suggestion.itemId, suggestion])),
    [emphasisSuggestions]
  );
  const visibleEmphasisStepItems = useMemo(
    () =>
      emphasisStepItems.filter((item) =>
        showCompletedCards ? true : item.status !== "applied" && item.status !== "dismissed"
      ),
    [emphasisStepItems, showCompletedCards]
  );
  const actionableEmphasisSuggestionCount = useMemo(
    () => emphasisSuggestions.filter((suggestion) => suggestion.status !== "applied" && suggestion.status !== "dismissed").length,
    [emphasisSuggestions]
  );
  const spellcheckDocumentBlockIds = useMemo(() => document.blocks.map((block) => block.id), [document.blocks]);
  const canRunSpellcheck = getSpellcheckableBlocks(document, revision, spellcheckDocumentBlockIds).length > 0;
  const hasSpellcheckRun = Boolean(spellcheckMeta || spellcheckSummary || spellcheckResults.length > 0);
  const spellcheckProblemParagraphCount = useMemo(
    () => spellcheckResults.filter((result) => result.issues.length > 0).length,
    [spellcheckResults]
  );
  const emphasisStatusTone = isReviewRequestInFlight && activeWorkflowStep === "emphasis"
    ? "active"
    : emphasisStepItems.length === 0
      ? "idle"
      : emphasisStepItems.some((item) => item.status !== "applied" && item.status !== "dismissed")
        ? "warning"
        : "success";
  const emphasisStatusLabel = isReviewRequestInFlight && activeWorkflowStep === "emphasis"
    ? "У процесі"
    : emphasisStepItems.length === 0
      ? "Не запускалось"
      : emphasisStepItems.some((item) => item.status !== "applied" && item.status !== "dismissed")
        ? "Є акценти"
        : "Завершено";
  const spellcheckStatusTone = isSpellcheckRequestInFlight
    ? "active"
    : !hasSpellcheckRun
      ? "idle"
      : (spellcheckMeta?.issueCount ?? 0) > 0 || spellcheckInvalidatedCount > 0
        ? "warning"
        : "success";
  const spellcheckStatusLabel = isSpellcheckRequestInFlight
    ? "У процесі"
    : !hasSpellcheckRun
      ? "Не запускалось"
      : spellcheckInvalidatedCount > 0
        ? "Потрібна перевірка"
        : (spellcheckMeta?.issueCount ?? 0) > 0
          ? "Є зауваги"
          : "Чисто";
  const activeStepCardStats = useMemo(
    () => (activeEditorialStepId ? getStepCardStats(reviewItems, activeEditorialStepId) : { actionable: 0, applied: 0, dismissed: 0 }),
    [activeEditorialStepId, reviewItems]
  );
  const isRecommendationStep =
    activeWorkflowStep !== "diagnostics"
    && activeWorkflowStep !== "fact_check"
    && activeWorkflowStep !== "spellcheck"
    && activeWorkflowStep !== "emphasis";
  const usesPrototypeShell = true;
  const hasGlobalReviewInstructions = Boolean(reviewComposer.additionalInstructions.trim());
  const feedbackPresentation = presentRequestFeedback(feedback);
  const globalContextHelpText =
    "Глобальний контекст — це ваші загальні вимоги до всіх наступних етапів (тон, стиль, пріоритети). Він не змінює текст напряму, а впливає на те, які рекомендації пропонує ШІ.";
  const activeStepHasExistingResult =
    activeWorkflowStep === "diagnostics"
      ? Boolean(reviewExpertise)
      : activeWorkflowStep === "fact_check"
        ? activeStepRunCount > 0 || factCheckRows.length > 0
        : activeWorkflowStep === "spellcheck"
          ? hasSpellcheckRun
          : activeStepRunCount > 0 || activeStepItems.length > 0;
  const activeStepCanRun =
    activeWorkflowStep === "diagnostics"
      ? canRequestReview
      : activeWorkflowStep === "spellcheck"
        ? canRunSpellcheck
        : activeWorkflowStep === "emphasis"
          ? canRequestReview
          : activeWorkflowStep === "final_editing"
            ? canRunDownstreamStep && Boolean(activeStepFeedbackValue)
            : canRunDownstreamStep;
  const activeStepRunDisabledReason = getActiveStepRunDisabledReason({
    stepId: activeWorkflowStep,
    canRun: activeStepCanRun,
    canRequestReview,
    canRunSpellcheck,
    reviewExpertise,
    stepFeedback: activeStepFeedbackValue,
    isReviewRequestInFlight,
    isSpellcheckRequestInFlight
  });
  const activeStepHasPrerequisite =
    activeWorkflowStep === "diagnostics" || activeWorkflowStep === "spellcheck" || activeWorkflowStep === "emphasis"
      ? true
      : Boolean(reviewExpertise);
  const activeStepHasSettings = activeWorkflowStep !== "spellcheck";
  const activeStepPrimaryAction = getStepPrimaryAction(activeWorkflowStep, { hasExistingResult: activeStepHasExistingResult });
  const activeStepRunButtonLabel = activeStepHasExistingResult ? "Перезапуск" : "Запустити";
  const activeStepRunButtonLoadingLabel = activeStepHasExistingResult ? "Перезапускаємо…" : "Запускаємо…";
  const activeStepWorkspaceStatus =
    activeWorkflowStep === "diagnostics"
      ? getStepWorkspaceStatus("diagnostics", {
          canRun: canRequestReview,
          isInFlight: isReviewRequestInFlight,
          hasExistingResult: Boolean(reviewExpertise),
          activeMessage: "Аналізуємо рукопис і готуємо редакторський огляд.",
          idleMessage: "Запустіть діагностику, щоб отримати редакторський огляд документа.",
          waitingMessage: "Додайте текст рукопису, щоб запустити діагностику.",
          successMessage: "Діагностику завершено"
        })
      : activeWorkflowStep === "fact_check"
        ? getStepWorkspaceStatus("fact_check", {
            canRun: canRunDownstreamStep,
            hasPrerequisite: Boolean(reviewExpertise),
            isInFlight: isReviewRequestInFlight,
            hasExistingResult: activeStepRunCount > 0 || factCheckRows.length > 0,
            zeroResult: activeStepRunCount > 0 && factCheckRows.length === 0 && activeStepItems.length === 0,
            activeMessage: "Перевіряємо твердження, пояснення і джерела для цього документа.",
            idleMessage: "Запустіть факт-чек, щоб перевірити твердження і джерела.",
            waitingMessage: "Спочатку запустіть діагностику, щоб дати факт-чеку контекст рукопису.",
            successMessage: "Таблиця факт-чеку готова",
            zeroResultMessage: "Факт-чек завершився без окремих рядків для перевірки."
          })
      : activeWorkflowStep === "spellcheck"
          ? getStepWorkspaceStatus("spellcheck", {
              canRun: canRunSpellcheck,
              isInFlight: isSpellcheckRequestInFlight,
              hasExistingResult: hasSpellcheckRun,
              zeroResult: hasSpellcheckRun && (spellcheckMeta?.issueCount ?? 0) === 0 && spellcheckInvalidatedCount === 0,
              activeMessage: "Аналізуємо правопис у всьому тексті.",
              idleMessage: "Запустіть аналіз правопису для всього тексту.",
              successMessage:
                spellcheckSummary ??
                "Аналіз правопису готовий. Можна переглядати проблемні абзаци та підказки.",
              zeroResultMessage: "Помилки не знайдено."
            })
          : activeWorkflowStep === "emphasis"
            ? getStepWorkspaceStatus("emphasis", {
                canRun: canRequestReview,
                hasPrerequisite: true,
                isInFlight: isReviewRequestInFlight,
                hasExistingResult: activeStepRunCount > 0 || activeStepItems.length > 0,
                zeroResult: activeStepRunCount > 0 && activeStepItems.length === 0,
                activeMessage: "Шукаємо доречні смислові акценти по всьому тексту.",
                idleMessage: "Запустіть етап, щоб отримати inline-акценти без переписування тексту.",
                waitingMessage: "Додайте текст рукопису, щоб запустити акценти.",
                successMessage: "Акценти готові. Їх можна погоджувати або відхиляти прямо в рукописі.",
                zeroResultMessage: "Етап завершено без нових акцентів."
              })
          : getStepWorkspaceStatus(activeWorkflowStep, {
              canRun: activeWorkflowStep === "final_editing" ? activeStepCanRun : canRunDownstreamStep,
              hasPrerequisite: Boolean(reviewExpertise),
              isInFlight: isReviewRequestInFlight,
              hasExistingResult: activeStepRunCount > 0 || activeStepItems.length > 0,
              zeroResult: activeStepRunCount > 0 && activeStepItems.length === 0,
              activeMessage: activeWorkflowStep === "final_editing" ? "Готуємо картки за власним запитом." : "Готуємо рекомендації для поточного етапу.",
              idleMessage: activeWorkflowStep === "final_editing" ? "Опишіть власний запит, щоб отримати локальні картки до рукопису." : "Запустіть цей етап, щоб отримати рекомендації до рукопису.",
              waitingMessage: activeWorkflowStep === "final_editing" && reviewExpertise ? "Напишіть власний запит для цього етапу." : "Спочатку запустіть діагностику, щоб дати наступним етапам контекст рукопису.",
              successMessage: "Рекомендації готові. Можна переглядати та застосовувати картки.",
              zeroResultMessage: "Етап завершено без нових карток."
            });
  const shouldShowPrototypeStatusStrip =
    activeWorkflowStep !== "spellcheck" &&
    (
      activeWorkflowStep === "diagnostics"
      || activeWorkflowStep === "fact_check"
      || showRecommendationStatusStrip
    );
  const prototypeStatusMessage =
    isRecommendationStep
      ? "Підготовлено рекомендації для поточного етапу"
      : activeStepWorkspaceStatus.message;
  const prototypeStatusCount =
    activeWorkflowStep === "diagnostics"
      ? (reviewExpertise ? 1 : 0)
      : activeWorkflowStep === "fact_check"
        ? factCheckRows.length
        : activeWorkflowStep === "spellcheck"
          ? (spellcheckMeta?.issueCount ?? 0)
          : activeStepItems.length;

  useEffect(() => {
    setStepSettingsOpen(false);
  }, [activeWorkflowStep]);

  function handleRunActiveStep() {
    setShowRecommendationStatusStrip(false);

    if (activeWorkflowStep === "spellcheck") {
      void requestSpellcheck(spellcheckDocumentBlockIds);
      return;
    }

    if (activeWorkflowStep === "diagnostics" || activeWorkflowStep === "fact_check" || activeEditorialStepId) {
      void requestWorkflowStep((activeWorkflowStep === "diagnostics" || activeWorkflowStep === "fact_check"
        ? activeWorkflowStep
        : activeEditorialStepId) as EditorialReviewStepId);
    }
  }

  function renderActiveStepActionIcon() {
    if (activeStepHasExistingResult) {
      return <RefreshCcw size={14} aria-hidden="true" />;
    }

    switch (activeWorkflowStep) {
      case "diagnostics":
        return <Stethoscope size={14} aria-hidden="true" />;
      case "fact_check":
        return <Search size={14} aria-hidden="true" />;
      case "spellcheck":
        return <Languages size={14} aria-hidden="true" />;
      case "emphasis":
        return <Highlighter size={14} aria-hidden="true" />;
      default:
        return <Sparkles size={14} aria-hidden="true" />;
    }
  }

  function renderPrototypeSettingsContent() {
    if (activeWorkflowStep === "diagnostics") {
      return (
        <div className="step-review-prototype-settings-grid">
          <div className="step-review-prototype-settings-field">
            <label htmlFor="prototype-diagnostics-run-mode">Режим оновлення</label>
            <select
              id="prototype-diagnostics-run-mode"
              className="step-review-prototype-input"
              value={stepRunModeByStep.diagnostics}
              onChange={(event) => updateStepRunMode("diagnostics", event.target.value as EditorialStepRunMode)}
            >
              <option value="replace">Замінити попередній запуск</option>
              <option value="preserve">Зберегти окремим запуском</option>
            </select>
          </div>
          <div className="step-review-prototype-settings-field">
            <label htmlFor="prototype-diagnostics-focus">Контекст для наступного запуску</label>
            <textarea
              id="prototype-diagnostics-focus"
              className="step-review-prototype-input"
              rows={3}
              placeholder="Наприклад: більше уваги до структури аргументації й логіки переходів."
              value={reviewComposer.additionalInstructions}
              onChange={(event) =>
                setReviewComposer((current) => ({ ...current, additionalInstructions: event.target.value }))
              }
            />
          </div>
        </div>
      );
    }

    if (activeWorkflowStep === "fact_check") {
      return (
        <div className="step-review-prototype-settings-grid">
          <div className="step-review-prototype-settings-field">
            <label htmlFor="prototype-factcheck-run-mode">Режим оновлення</label>
            <select
              id="prototype-factcheck-run-mode"
              className="step-review-prototype-input"
              value={stepRunModeByStep.fact_check}
              onChange={(event) => updateStepRunMode("fact_check", event.target.value as EditorialStepRunMode)}
            >
              <option value="replace">Замінити попередній запуск</option>
              <option value="preserve">Зберегти окремим запуском</option>
            </select>
          </div>
          <div className="step-review-prototype-settings-field">
            <label htmlFor="prototype-factcheck-focus">Фокус для наступного запуску</label>
            <textarea
              id="prototype-factcheck-focus"
              className="step-review-prototype-input"
              rows={3}
              placeholder="Наприклад: перевірити сумнівні твердження про біомаркери, гормони та клінічні рекомендації."
              value={stepFeedback.fact_check}
              onChange={(event) => updateStepFeedbackValue("fact_check", event.target.value)}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="step-review-prototype-settings-grid">
        <div className="step-review-prototype-settings-field">
          <label htmlFor="prototype-step-run-mode">Режим оновлення</label>
          <select
            id="prototype-step-run-mode"
            className="step-review-prototype-input"
            value={activeEditorialStepId ? stepRunModeByStep[activeEditorialStepId] : "replace"}
            onChange={(event) => {
              if (activeEditorialStepId) {
                updateStepRunMode(activeEditorialStepId, event.target.value as EditorialStepRunMode);
              }
            }}
          >
            <option value="replace">Замінити попередній запуск</option>
            <option value="preserve">Зберегти окремим запуском</option>
          </select>
        </div>
        <div className="step-review-prototype-settings-field">
          <label htmlFor="prototype-step-focus">Фокус для наступного запуску</label>
          <textarea
            id="prototype-step-focus"
            className="step-review-prototype-input"
            rows={3}
            placeholder={
              activeWorkflowStep === "emphasis"
                ? "Наприклад: лише ключові тези, без декоративних виділень і без суцільного жирного."
                : activeWorkflowStep === "final_editing"
                  ? "Наприклад: додай глибокі врізки, списки й візуали там, де вони допоможуть читачеві."
                  : "Наприклад: менше дроблення на підзаголовки, більше уваги до ритму секцій."
            }
            value={activeEditorialStepId ? stepFeedback[activeEditorialStepId] : ""}
            onChange={(event) => {
              if (activeEditorialStepId) {
                updateStepFeedbackValue(activeEditorialStepId, event.target.value);
              }
            }}
          />
        </div>
      </div>
    );
  }

  function renderPrototypeStepContent() {
    if (activeWorkflowStep === "diagnostics") {
      return (
        <div className="step-review-prototype-content step-review-prototype-content-diagnostics">
          {reviewExpertise ? (
            <div className="button-row">
              <Button variant="secondary" size="sm" onClick={() => selectWorkflowStep("fact_check")}>
                До факт-чеку
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title="Скинути результат діагностики і таблицю факт-чеку для повторного старту"
                onClick={() => {
                  setReviewExpertise(null);
                  setFactCheckRows([]);
                  setReviewItems((current) => current.filter((item) => item.stepId !== "fact_check"));
                  setActiveReviewItemId((current) => {
                    if (!current) {
                      return current;
                    }

                    const activeItem = reviewItems.find((item) => item.id === current);
                    return activeItem?.stepId === "fact_check" ? null : current;
                  });
                  setPreparingReviewItemId((current) => {
                    if (!current) {
                      return current;
                    }

                    const preparingItem = reviewItems.find((item) => item.id === current);
                    return preparingItem?.stepId === "fact_check" ? null : current;
                  });
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
              <div className="step-review-analysis-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
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
              </div>
            ) : (
              <p className="step-review-empty-copy">
                Запустіть діагностику, щоб отримати детальний огляд.
              </p>
            )}
          </div>
        </div>
      );
    }

    if (activeWorkflowStep === "fact_check") {
      return (
        <div className="step-review-prototype-content step-review-prototype-content-factcheck">
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

          {activeStepItems.length > 0 ? (
            <>
              <div className="step-review-prototype-meta-line step-review-prototype-meta-line-inline">
                <div className="step-review-prototype-utility-meta">
                  <span>{activeStepCardStats.actionable} активних</span>
                  <span>{activeStepCardStats.applied} погоджено</span>
                  <span>{activeStepCardStats.dismissed} відхилено</span>
                </div>
                <button
                  type="button"
                  className="step-review-prototype-utility-toggle"
                  onClick={() => setShowCompletedCards((current) => !current)}
                >
                  {showCompletedCards ? "Сховати завершені" : "Показати завершені"}
                </button>
              </div>
              <section className="step-review-prototype-suggestions-list" aria-label="Картки за факт-чеком">
                {activeStepItems.map((item) => {
                  const isHidden = !showCompletedCards && (item.status === "applied" || item.status === "dismissed");
                  return (
                    <EditorialReviewCard
                      key={item.id}
                      item={item}
                      revision={revision}
                      isActive={item.id === activeReviewItemId}
                      isHidden={isHidden}
                      onFocus={focusReviewItem}
                      onPrepare={(entry) => void prepareReviewItem(entry)}
                      onApplyCallout={applyReviewCallout}
                      onDismiss={dismissReviewItem}
                      isLoading={item.id === preparingReviewItemId}
                    />
                  );
                })}
              </section>
            </>
          ) : null}

          {factCheckRows.length === 0 ? (
            <p className="step-review-empty-copy">
              Тут з’являться лише твердження, які варто поставити під сумнів або перевірити за джерелами.
            </p>
          ) : null}
        </div>
      );
    }

    if (activeWorkflowStep === "spellcheck") {
      return (
        <div className="step-review-prototype-content step-review-prototype-content-spellcheck">
          {hasSpellcheckRun ? (
            <div className="step-review-prototype-meta-line step-review-prototype-meta-line-inline">
              <div className="step-review-prototype-utility-meta">
                <span>{spellcheckMeta?.issueCount ?? 0} проблем</span>
                <span>{spellcheckProblemParagraphCount} абз. з помилками</span>
                <span>{spellcheckInvalidatedCount} змінено після перевірки</span>
              </div>
              <button
                type="button"
                className="step-review-prototype-utility-toggle"
                onClick={clearSpellcheckResults}
                disabled={isSpellcheckRequestInFlight || (!spellcheckSummary && spellcheckResults.length === 0)}
              >
                Очистити
              </button>
            </div>
          ) : null}

          {spellcheckIssueResults.length > 0 ? (
            <div className="step-review-prototype-spellcheck-list">
              {spellcheckIssueResults.map((result) => {
                const isExpanded = expandedSpellcheckBlockId === result.blockId;
                return (
                  <article
                    key={result.blockId}
                    className="step-review-prototype-spellcheck-card"
                    data-tone={result.error ? "error" : "default"}
                    data-active={isExpanded ? "true" : "false"}
                    data-expanded={isExpanded ? "true" : "false"}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-label={`Правопис: абз. ${result.paragraphLabel}`}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("button")) {
                        return;
                      }
                      focusBlockById(result.blockId, { select: false });

                      if (!isExpanded) {
                        setExpandedSpellcheckBlockId(result.blockId);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        focusBlockById(result.blockId, { select: false });

                        if (!isExpanded) {
                          setExpandedSpellcheckBlockId(result.blockId);
                        }
                      }
                    }}
                  >
                    <div className="step-review-prototype-spellcheck-card-head">
                      <div className="step-review-prototype-spellcheck-card-copy">
                        <h3 className="step-review-prototype-spellcheck-card-title">{getSpellcheckIssueHeadline(result)}</h3>
                        <div className="step-review-prototype-spellcheck-card-meta">
                          <span className="step-review-prototype-spellcheck-card-paragraph-label">Абз. {result.paragraphLabel}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="editorial-review-card-expand step-review-prototype-spellcheck-expand"
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setExpandedSpellcheckBlockId((current) => (current === result.blockId ? null : result.blockId));
                        }}
                        aria-label={isExpanded ? "Згорнути деталі" : "Показати деталі"}
                      >
                        {isExpanded ? (
                          <ChevronUp aria-hidden="true" width={16} height={16} />
                        ) : (
                          <ChevronDown aria-hidden="true" width={16} height={16} />
                        )}
                      </button>
                    </div>
                    <div className="step-review-prototype-spellcheck-card-body">
                      <div className="step-review-prototype-spellcheck-card-body-inner">
                        {result.error ? (
                          <p className="step-review-status-copy step-review-prototype-spellcheck-error-copy" data-tone="error">{result.error}</p>
                        ) : (
                          <div className="step-review-prototype-spellcheck-issues">
                            {result.issues.map((issue) => (
                              <div key={issue.id} className="step-review-prototype-spellcheck-issue">
                                <div className="step-review-prototype-spellcheck-issue-head">
                                  <span className="step-review-prototype-spellcheck-issue-meta">{getSpellcheckCategoryLabel(issue.category)}</span>
                                </div>
                                {shouldShowSpellcheckMessage(issue.message) ? (
                                  <p className="err-compact-description step-review-prototype-spellcheck-issue-copy">{issue.message}</p>
                                ) : null}
                                {issue.suggestions.length > 0 ? (
                                  <div className="step-review-prototype-spellcheck-chips">
                                    {issue.suggestions.map((suggestion) => (
                                      <button
                                        key={`${issue.id}-${suggestion.value}`}
                                        type="button"
                                        className="step-review-prototype-spellcheck-chip"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          applySpellcheckSuggestion({
                                            blockId: result.blockId,
                                            issueId: issue.id,
                                            suggestion: suggestion.value
                                          });
                                        }}
                                      >
                                        {suggestion.value}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                                <div className="err-compact-actions step-review-prototype-spellcheck-actions">
                                  {issue.suggestions.length === 0 && issue.range.end > issue.range.start ? (
                                    <button
                                      type="button"
                                      className="err-compact-action-button step-review-prototype-spellcheck-action"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        applySpellcheckSuggestion({
                                          blockId: result.blockId,
                                          issueId: issue.id,
                                          suggestion: ""
                                        });
                                      }}
                                    >
                                      Видалити
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="err-compact-action-button step-review-prototype-spellcheck-action"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void addSpellcheckWordToDictionary({ blockId: result.blockId, issueId: issue.id, word: issue.badText });
                                    }}
                                  >
                                    Додати у словник
                                  </button>
                                  <button
                                    type="button"
                                    className="err-compact-action-button err-compact-action-button-primary step-review-prototype-spellcheck-action-primary"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      dismissSpellcheckIssue({ blockId: result.blockId, issueId: issue.id });
                                    }}
                                  >
                                    Залишити як є
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : spellcheckSummary && !isSpellcheckRequestInFlight ? (
            <p className="step-review-empty-copy">Помилки не знайдено.</p>
          ) : !isSpellcheckRequestInFlight ? (
            <p className="step-review-empty-copy">Запустіть аналіз правопису для всього тексту.</p>
          ) : null}
        </div>
      );
    }

    if (activeWorkflowStep === "emphasis") {
      return (
        <div className="step-review-prototype-content step-review-prototype-content-emphasis">
          {emphasisStepItems.length > 0 ? (
            <div className="step-review-prototype-meta-line step-review-prototype-meta-line-inline">
              <div className="step-review-prototype-utility-meta">
                <span>{showCompletedCards ? `${emphasisStepItems.length} акцентів` : `Залишилось ${visibleEmphasisStepItems.length} акцентів`}</span>
              </div>
              <div className="step-review-prototype-utility-actions">
                {actionableEmphasisSuggestionCount > 0 ? (
                  <button
                    type="button"
                    className="step-review-prototype-utility-toggle"
                    onClick={applyAllEmphasisSuggestions}
                  >
                    Прийняти всі
                  </button>
                ) : null}
                <button
                  type="button"
                  className="step-review-prototype-utility-toggle"
                  onClick={() => setShowCompletedCards((current) => !current)}
                >
                  {showCompletedCards ? "Сховати завершені" : "Показати завершені"}
                </button>
              </div>
            </div>
          ) : null}

          {visibleEmphasisStepItems.length > 0 ? (
            <section className="step-review-prototype-suggestions-list" aria-label="Список акцентів">
              {visibleEmphasisStepItems.map((item) => {
                const suggestion = emphasisSuggestionByItemId.get(item.id);
                const phrase = getEmphasisCardPhrase(item, suggestion?.phrase);
                const rangeLabel = suggestion?.paragraphLabel
                  ? `Абз. ${suggestion.paragraphLabel}`
                  : getReviewParagraphRangeLabel(item, revision);

                return (
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
                    variant="emphasis"
                    hideMeta
                    rangeLabelOverride={rangeLabel}
                    title={<span className="emphasis-card-title">"{phrase}"</span>}
                    description={undefined}
                  />
                );
              })}
            </section>
          ) : activeStepRunCount > 0 && !isReviewRequestInFlight ? (
            <p className="step-review-empty-copy">Доречних акцентів не знайдено.</p>
          ) : !isReviewRequestInFlight ? (
            <p className="step-review-empty-copy">Запустіть етап, щоб побачити inline-акценти в рукописі.</p>
          ) : null}
        </div>
      );
    }

    if (activeWorkflowStep === "structure") {
      const visibleStructureActionCount = structureOutline.reduce(
        (count, node) => count + node.actions.filter((action) => !action.isHidden).length,
        0
      );

      return (
        <div className="step-review-prototype-content step-review-prototype-content-structure">
          <div className="step-review-prototype-meta-line step-review-prototype-meta-line-inline">
            <div className="step-review-prototype-utility-meta">
              <span>{activeStepCardStats.actionable} активних</span>
              <span>{activeStepCardStats.applied} погоджено</span>
              <span>{activeStepCardStats.dismissed} відхилено</span>
            </div>
            <button
              type="button"
              className="step-review-prototype-utility-toggle"
              onClick={() => setShowCompletedCards((current) => !current)}
            >
              {showCompletedCards ? "Сховати завершені" : "Показати завершені"}
            </button>
          </div>

          <section className="step-review-structure-outline" aria-label="План розділу">
            <div className="step-review-structure-outline-head">
              <div>
                <h3>План розділу</h3>
                <p>{visibleStructureActionCount > 0 ? `${visibleStructureActionCount} дій у структурі` : "Поточна карта рукопису"}</p>
              </div>
              <LayoutGrid aria-hidden="true" width={18} height={18} />
            </div>

            <div className="step-review-structure-outline-list">
              {structureOutline.map((node, nodeIndex) => {
                const visibleActions = node.actions.filter((action) => !action.isHidden);

                return (
                  <article
                    key={node.id}
                    className="step-review-structure-node"
                    data-depth={Math.min(node.level, 3)}
                    data-has-actions={visibleActions.length > 0 ? "true" : "false"}
                  >
                    <button
                      type="button"
                      className="step-review-structure-node-head"
                      onClick={() => {
                        if (node.anchorBlockId) {
                          focusBlockById(node.anchorBlockId, { select: false });
                        }
                      }}
                      disabled={!node.anchorBlockId}
                    >
                      <span className="step-review-structure-node-index">{String(nodeIndex + 1).padStart(2, "0")}</span>
                      <span className="step-review-structure-node-copy">
                        <span className="step-review-structure-node-title">{node.title}</span>
                        <span className="step-review-structure-node-range">{node.rangeLabel}</span>
                      </span>
                      <LocateFixed aria-hidden="true" width={15} height={15} />
                    </button>

                    {visibleActions.length > 0 ? (
                      <div className="step-review-structure-actions">
                        {visibleActions.map((action) => (
                          <button
                            key={action.item.id}
                            type="button"
                            className="step-review-structure-action"
                            data-active={action.item.id === activeReviewItemId ? "true" : "false"}
                            data-status={action.item.status}
                            onClick={() => focusReviewItem(action.item)}
                          >
                            <span className="step-review-structure-action-main">
                              <span className="step-review-structure-action-title">{action.item.title}</span>
                              <span className="step-review-structure-action-meta">{action.rangeLabel} · {action.label}</span>
                            </span>
                            <span className="step-review-structure-action-status">{action.statusLabel}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="step-review-structure-node-empty">Без структурних дій.</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="step-review-structure-cards" aria-label="Картки дій">
            <div className="step-review-structure-section-head">
              <h3>Картки дій</h3>
            </div>
            <div className="step-review-prototype-suggestions-list step-review-structure-card-list">
              {activeStepItems.map((item) => {
                const isHidden = !showCompletedCards && (item.status === "applied" || item.status === "dismissed");
                return (
                  <EditorialReviewCard
                    key={item.id}
                    item={item}
                    revision={revision}
                    isActive={item.id === activeReviewItemId}
                    isHidden={isHidden}
                    onFocus={focusReviewItem}
                    onPrepare={(entry) => void prepareReviewItem(entry)}
                    onApplyCallout={applyReviewCallout}
                    onDismiss={dismissReviewItem}
                    isLoading={item.id === preparingReviewItemId}
                  />
                );
              })}
              {visibleActiveStepItems.length === 0 ? (
                <p className="step-review-empty-copy step-review-prototype-empty-copy">
                  {activeStepCardStats.actionable === 0 && (activeStepCardStats.applied > 0 || activeStepCardStats.dismissed > 0)
                    ? "Усі структурні картки вже завершено. Увімкніть показ завершених, щоб переглянути їх."
                    : "Для структури ще немає карток."}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      );
    }

    return (
      <>
        <div className="step-review-prototype-meta-line">
          <div className="step-review-prototype-utility-meta">
            <span>{activeStepCardStats.actionable} активних</span>
            <span>{activeStepCardStats.applied} погоджено</span>
            <span>{activeStepCardStats.dismissed} відхилено</span>
          </div>
          <button
            type="button"
            className="step-review-prototype-utility-toggle"
            onClick={() => setShowCompletedCards((current) => !current)}
          >
            {showCompletedCards ? "Сховати завершені" : "Показати завершені"}
          </button>
        </div>

        <section className="step-review-prototype-suggestions-list" aria-label="Список рекомендацій">
          {activeStepItems.map((item) => {
            const isHidden = !showCompletedCards && (item.status === "applied" || item.status === "dismissed");
            return (
              <EditorialReviewCard
                key={item.id}
                item={item}
                revision={revision}
                isActive={item.id === activeReviewItemId}
                isHidden={isHidden}
                onFocus={focusReviewItem}
                onPrepare={(entry) => void prepareReviewItem(entry)}
                onApplyCallout={applyReviewCallout}
                onDismiss={dismissReviewItem}
                isLoading={item.id === preparingReviewItemId}
              />
            );
          })}
          {visibleActiveStepItems.length === 0 ? (
            <p className="step-review-empty-copy step-review-prototype-empty-copy">
              {activeStepCardStats.actionable === 0 && (activeStepCardStats.applied > 0 || activeStepCardStats.dismissed > 0)
                ? "Усі картки для цього етапу вже завершено. Увімкніть показ завершених, щоб переглянути їх."
                : "Для цього етапу ще немає карток."}
            </p>
          ) : null}
        </section>
      </>
    );
  }

  const runStepButton = (
    <Button
      variant={activeStepPrimaryAction.emphasis === "primary" ? "primary" : "secondary"}
      className={`step-review-head-action-button ${activeStepPrimaryAction.emphasis === "primary" ? "step-review-head-action-button-primary" : ""}`.trim()}
      size="sm"
      onClick={handleRunActiveStep}
      loading={activeWorkflowStep === "spellcheck" ? isSpellcheckRequestInFlight : isReviewRequestInFlight}
      loadingLabel={activeStepPrimaryAction.loadingLabel}
      disabled={!activeStepCanRun}
      aria-label={activeStepPrimaryAction.ariaLabel}
    >
      <span className="button-content">
        {renderActiveStepActionIcon()}
        <span>{activeStepPrimaryAction.label}</span>
      </span>
    </Button>
  );

  return (
    <>
      <TopBar
        activePath="/editor"
        documentStats={documentStats}
      />
      {destructiveRecoveryState ? (
        <div className="editor-toast-stack" aria-live="polite">
          <div className="editor-toast editor-toast-success" role="status">
            <div className="editor-toast-copy">
              <span className="editor-toast-label">Готово</span>
              <p className="editor-toast-message">{destructiveRecoveryState.message}</p>
            </div>
            <div className="editor-toast-actions">
              <Button variant="ghost" size="sm" onClick={undoDestructiveAction}>
                Повернути
              </Button>
              <button
                type="button"
                className="editor-toast-dismiss"
                aria-label="Сховати повідомлення"
                onClick={() => setDestructiveRecoveryState(null)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <StepReviewWorkspaceShell
        manuscript={
          <main className={`editor-page-shell ${composerMode ? "editor-page-shell--composer-open" : ""}`.trim()}>
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
                <Button
                  variant="danger"
                  size="sm"
                  className="editor-danger-button"
                  onClick={handleClearDocument}
                >
                  <span className="button-content">
                    <Trash2 size={14} aria-hidden="true" />
                    <span>Очистити</span>
                  </span>
                </Button>
              </div>
            </div>

            {pendingDestructiveAction ? (
              <div className="editor-danger-panel" role="alert" aria-live="polite">
                <div className="editor-danger-panel-copy">
                  <p className="editor-danger-panel-title">{pendingDestructiveAction.title}</p>
                  <p className="editor-danger-panel-description">{pendingDestructiveAction.description}</p>
                </div>
                <div className="editor-danger-panel-actions">
                  <Button variant="ghost" size="sm" onClick={() => setPendingDestructiveAction(null)}>
                    Скасувати
                  </Button>
                  <Button variant="danger" size="sm" onClick={confirmDestructiveAction}>
                    {pendingDestructiveAction.confirmLabel}
                  </Button>
                </div>
              </div>
            ) : null}

            <BlockEditorSurface
              document={document}
              revision={revision}
              selection={normalizedSelection}
              focusedBlockId={focusedBlockId}
              historyControls={{
                canUndo,
                canRedo,
                canCompare: compareHistory.length > 0,
                onUndo: undoLastMutation,
                onRedo: redoLastMutation,
                onCompare: () => {
                  const nextId = compareHistory[0]?.id ?? null;
                  setActiveCompareEntryId(nextId);
                  setExpandedCompareEntryId(nextId);
                }
              }}
              onDocumentChange={handleManualDocumentChange}
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
              onUpdateActiveCalloutDepth={updateActiveCalloutDepth}
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
              spellcheckResults={spellcheckResults}
              onApplySpellcheckSuggestion={applySpellcheckSuggestion}
              onDismissSpellcheckIssue={dismissSpellcheckIssue}
              onAddSpellcheckWordToDictionary={(input) => void addSpellcheckWordToDictionary(input)}
              emphasisSuggestions={emphasisSuggestions
                .filter((suggestion) => suggestion.status !== "applied" && suggestion.status !== "dismissed")
                .map(({ itemId, blockId, phrase, reason, range }) => ({ itemId, blockId, phrase, reason, range }))}
              onApplyEmphasisSuggestion={applyEmphasisSuggestion}
              onDismissEmphasisSuggestion={({ itemId }) => {
                const item = reviewItems.find((entry) => entry.id === itemId);

                if (item) {
                  dismissReviewItem(item);
                }
              }}
              editorHotkeyCommand={editorHotkeyCommand === "toggle_bullet_list" ? "toggle-bullet-list" : null}
              editorHotkeyCommandNonce={editorHotkeyCommandNonce}
            />

            {composerMode ? (
              <FloatingComposerPanel
                mode={composerMode}
                customPrompt={customPrompt}
                onCustomPromptChange={setCustomPrompt}
                localTextIntent={localTextIntent}
                localActionRoute={localActionRoute}
                onLocalTextIntentChange={setLocalTextIntent}
                onRequestAutoAction={() => {
                  void (async () => {
                    const didCreate = await requestResolvedLocalAction();

                    if (didCreate) {
                      closeComposerForCurrentSelection();
                    }
                  })();
                }}
                reviewAdditionalInstructions={reviewComposer.additionalInstructions}
                onReviewAdditionalInstructionsChange={(value) => setReviewComposer((current) => ({ ...current, additionalInstructions: value }))}
                onRequestReview={() => void requestWorkflowStep(isEditorialReviewStepId(activeWorkflowStep) ? activeWorkflowStep : "final_editing")}
                patchLoading={isPatchRequestInFlight}
                reviewLoading={isReviewRequestInFlight}
                localActionMode={localActionMode}
                onLocalActionModeChange={handleLocalActionModeChange}
                manualCalloutKind={manualCalloutKind}
                manualCalloutDepth={manualCalloutDepth}
                manualVisualIntent={manualVisualIntent}
                manualVisualStylePreset={visualStylePreset}
                onManualCalloutKindChange={setManualCalloutKind}
                onManualCalloutDepthChange={setManualCalloutDepth}
                onManualVisualIntentChange={setManualVisualIntent}
                onManualVisualStylePresetChange={persistVisualStylePreset}
                manualCalloutPrompt={manualCalloutPrompt}
                manualVisualPrompt={manualVisualPrompt}
                spellcheckResults={spellcheckResults}
                spellcheckLoading={isSpellcheckRequestInFlight}
                spellcheckSummary={spellcheckSummary}
                spellcheckSecondarySummary={spellcheckSecondarySummary}
                localModeSuggestion={localModeSuggestion}
                onManualCalloutPromptChange={setManualCalloutPrompt}
                onManualVisualPromptChange={setManualVisualPrompt}
                onRequestManualCallout={() => {
                  void (async () => {
                    const didCreate = await requestManualInsert("callout");

                    if (didCreate) {
                      closeComposerForCurrentSelection();
                    }
                  })();
                }}
                onRequestManualVisual={() => {
                  void (async () => {
                    const didCreate = await requestManualInsert("visual");

                    if (didCreate) {
                      closeComposerForCurrentSelection();
                    }
                  })();
                }}
                onRequestSpellcheck={() => {
                  void (async () => {
                    const didCreate = await requestSpellcheck(resolveTargetBlockIds());

                    if (didCreate) {
                      closeComposerForCurrentSelection();
                    }
                  })();
                }}
                manualLoadingKind={manualGenerationInFlight?.kind ?? null}
                isClosing={isComposerClosing}
                onClose={() => closeComposerForCurrentSelection()}
              />
            ) : null}
          </main>
        }
        drawer={
          <section className="step-review-workspace">
            {usesPrototypeShell ? (
              <div className="step-review-prototype-shell">
                <header className="step-review-prototype-head">
                  <div className="step-review-prototype-head-copy">
                    <h1 className="step-review-prototype-title">{activeStepMeta.label}</h1>
                  </div>
                  <div className="step-review-prototype-head-actions">
                    {activeWorkflowStep === "emphasis" && actionableEmphasisSuggestionCount > 0 ? (
                      <Button
                        variant="primary"
                        size="sm"
                        className="step-review-prototype-accept-all-button"
                        onClick={applyAllEmphasisSuggestions}
                        disabled={isReviewRequestInFlight}
                        aria-label="Прийняти всі акценти"
                      >
                        <span className="button-content">
                          <span>Прийняти всі</span>
                        </span>
                      </Button>
                    ) : null}
                    <Button
                      variant="primary"
                      size="sm"
                      className="step-review-prototype-run-button"
                      onClick={handleRunActiveStep}
                      loading={activeWorkflowStep === "spellcheck" ? isSpellcheckRequestInFlight : isReviewRequestInFlight}
                      loadingLabel={activeStepRunButtonLoadingLabel}
                      disabled={!activeStepCanRun}
                      disabledReason={activeStepRunDisabledReason}
                      aria-label={activeStepHasExistingResult ? "Перезапустити етап" : "Запустити етап"}
                    >
                      <span className="button-content">
                        <span>{activeStepRunButtonLabel}</span>
                      </span>
                    </Button>
                  </div>
                </header>

                <div className="step-review-prototype-body">
                  <section className="step-review-prototype-stage-strip">
                    <div className="step-review-prototype-stage-row">
                      <div className="step-review-prototype-stage-label">
                        <LayoutGrid className="step-review-prototype-stage-icon" aria-hidden="true" />
                        <p className="step-review-prototype-stage-name">{activeStepSummary}</p>
                      </div>
                      {activeStepHasSettings ? (
                        <button
                          type="button"
                          className="step-review-prototype-settings-button"
                          aria-expanded={stepSettingsOpen}
                          aria-controls="step-review-prototype-settings"
                          aria-label="Налаштування етапу"
                          onClick={() => setStepSettingsOpen((current) => !current)}
                        >
                          <SlidersHorizontal className="step-review-prototype-settings-icon" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>

                    {activeStepHasSettings ? (
                      <section
                        id="step-review-prototype-settings"
                        className="step-review-prototype-settings-panel"
                        data-open={stepSettingsOpen ? "true" : "false"}
                      >
                        <div className="step-review-prototype-settings-panel-inner">
                          {renderPrototypeSettingsContent()}
                        </div>
                      </section>
                    ) : null}
                  </section>

                  {shouldShowPrototypeStatusStrip ? (
                    <section className="step-review-prototype-status-strip" data-tone={activeStepWorkspaceStatus.tone} aria-live="polite">
                      <p>{prototypeStatusMessage}</p>
                      <span className="step-review-prototype-status-number">{prototypeStatusCount}</span>
                    </section>
                  ) : null}

                  {renderPrototypeStepContent()}
                </div>
              </div>
            ) : (
            <>
            <header className="step-review-workspace-head">
              <div className="step-review-workspace-title-stack">
                <h3 className="step-review-workspace-title">
                  <ActiveStepIcon className="step-review-workspace-title-icon" aria-hidden="true" />
                  <span>{activeStepMeta.label}</span>
                </h3>
                <p className="step-review-workspace-stage-copy">
                  {activeStepSummary}
                </p>
                <div className="step-review-workspace-status-row">
                  <span className="step-review-workspace-status-pill" data-tone={activeStepWorkspaceStatus.tone}>
                    {activeStepWorkspaceStatus.label}
                  </span>
                  <p className="step-review-workspace-status-copy">
                    {activeStepWorkspaceStatus.message}
                  </p>
                </div>
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

            {feedbackPresentation ? (
              <div className="step-review-feedback" data-tone={feedbackPresentation.tone} role="status" aria-live="polite">
                <span className="step-review-feedback-label">{feedbackPresentation.label}</span>
                <p className="step-review-feedback-copy">{feedbackPresentation.message}</p>
              </div>
            ) : null}

            <div className="step-review-workspace-scroll">
              {activeWorkflowStep === "spellcheck" ? (
                <div className="step-review-section-stack">
                  <section className="step-review-subsection step-review-spellcheck-module">
                    <div className="step-review-subsection-head">
                      {!isSpellcheckRequestInFlight && hasSpellcheckRun ? (
                        <div className="step-review-spellcheck-actions">
                          <button
                            type="button"
                            className="step-review-spellcheck-clear"
                            onClick={clearSpellcheckResults}
                            disabled={isSpellcheckRequestInFlight || (!spellcheckSummary && spellcheckResults.length === 0)}
                            aria-label="Очистити аналіз правопису"
                            title="Очистити аналіз правопису"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {hasSpellcheckRun || isSpellcheckRequestInFlight ? (
                      <div className="step-review-spellcheck-metrics">
                        <div className="step-review-spellcheck-metric">
                          <span className="step-review-spellcheck-metric-value">{spellcheckMeta?.issueCount ?? 0}</span>
                          <span className="step-review-spellcheck-metric-label">проблем</span>
                        </div>
                        <div className="step-review-spellcheck-metric">
                          <span className="step-review-spellcheck-metric-value">{spellcheckProblemParagraphCount}</span>
                          <span className="step-review-spellcheck-metric-label">абз. з помилками</span>
                        </div>
                        <div className="step-review-spellcheck-metric">
                          <span className="step-review-spellcheck-metric-value">{spellcheckInvalidatedCount}</span>
                          <span className="step-review-spellcheck-metric-label">змінено після перевірки</span>
                        </div>
                      </div>
                    ) : null}

                    {spellcheckIssueResults.length > 0 ? (
                      <div className="step-review-spellcheck-list">
                        {spellcheckIssueResults.map((result) => (
                          <article
                            key={result.blockId}
                            className="step-review-spellcheck-card"
                            data-tone={result.error ? "error" : "default"}
                          >
                            <div className="step-review-spellcheck-card-head">
                              <div className="step-review-spellcheck-card-head-main">
                                <div className="step-review-spellcheck-card-copy">
                                  <h3 className="step-review-spellcheck-card-title">{getSpellcheckIssueHeadline(result)}</h3>
                                  <p className="step-review-spellcheck-card-meta">Абз. {result.paragraphLabel}</p>
                                </div>
                                <span className="step-review-spellcheck-badge">{result.error ? "!" : result.issues.length}</span>
                              </div>
                              <button
                                type="button"
                                className="step-review-spellcheck-focus"
                                aria-label={`Перейти до абзацу ${result.paragraphLabel}`}
                                title={`Перейти до абзацу ${result.paragraphLabel}`}
                                onClick={() => focusBlockById(result.blockId, { select: false })}
                              >
                                <LocateFixed size={14} aria-hidden="true" />
                              </button>
                            </div>
                            {result.error ? (
                              <p className="step-review-status-copy" data-tone="error">{result.error}</p>
                            ) : (
                              <div className="step-review-spellcheck-issues">
                                {result.issues.map((issue) => (
                                  <div key={issue.id} className="step-review-spellcheck-issue">
                                    <div className="step-review-spellcheck-issue-head">
                                      <span className="step-review-spellcheck-issue-meta">
                                        {getSpellcheckCategoryLabel(issue.category)}
                                      </span>
                                    </div>
                                    {shouldShowSpellcheckMessage(issue.message) ? (
                                      <p className="step-review-status-copy step-review-spellcheck-issue-copy">{issue.message}</p>
                                    ) : null}
                                    {issue.suggestions.length > 0 ? (
                                      <div className="step-review-spellcheck-suggestions">
                                        {issue.suggestions.map((suggestion) => (
                                          <button
                                            key={`${issue.id}-${suggestion.value}`}
                                            type="button"
                                            className="step-review-spellcheck-chip"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              applySpellcheckSuggestion({
                                                blockId: result.blockId,
                                                issueId: issue.id,
                                                suggestion: suggestion.value
                                              });
                                            }}
                                          >
                                            {suggestion.value}
                                          </button>
                                        ))}
                                        {issue.range.end > issue.range.start ? (
                                          <button
                                            type="button"
                                            className="step-review-spellcheck-chip"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              applySpellcheckSuggestion({
                                                blockId: result.blockId,
                                                issueId: issue.id,
                                                suggestion: ""
                                              });
                                            }}
                                          >
                                            Видалити
                                          </button>
                                        ) : null}
                                      </div>
                                    ) : issue.range.end > issue.range.start ? (
                                      <div className="step-review-spellcheck-suggestions">
                                        <button
                                          type="button"
                                          className="step-review-spellcheck-chip"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            applySpellcheckSuggestion({
                                              blockId: result.blockId,
                                              issueId: issue.id,
                                              suggestion: ""
                                            });
                                          }}
                                        >
                                          Видалити
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : spellcheckSummary && !isSpellcheckRequestInFlight ? (
                      <div className="step-review-empty-state step-review-spellcheck-empty">
                        <p className="step-review-empty-copy">Помилки не знайдено.</p>
                      </div>
                    ) : !isSpellcheckRequestInFlight ? (
                      <div className="step-review-empty-state step-review-spellcheck-empty">
                        <p className="step-review-empty-copy">Запустіть аналіз правопису для всього тексту.</p>
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : null}

              {activeWorkflowStep === "emphasis" ? (
                <div className="step-review-section-stack">
                  <section className="step-review-subsection step-review-emphasis-module">
                    <div className="step-review-subsection-head">
                      {emphasisStepItems.length > 0 ? (
                        <div className="step-review-subsection-meta">
                          <p className="step-review-cards-counter" aria-label="Лічильник акцентів">
                            {showCompletedCards
                              ? `${emphasisStepItems.length} акцентів`
                              : `Залишилось ${visibleEmphasisStepItems.length} акцентів`}
                          </p>
                          <div className="step-review-prototype-utility-actions">
                            {actionableEmphasisSuggestionCount > 0 ? (
                              <button
                                type="button"
                                className="step-review-completed-toggle"
                                data-active="true"
                                onClick={applyAllEmphasisSuggestions}
                              >
                                Прийняти всі
                              </button>
                            ) : null}
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
                      ) : null}
                    </div>

                    {visibleEmphasisStepItems.length > 0 ? (
                      <div className="operations-stack operations-stack-compact step-review-emphasis-list">
                        {visibleEmphasisStepItems.map((item) => {
                          const suggestion = emphasisSuggestionByItemId.get(item.id);
                          const phrase = getEmphasisCardPhrase(item, suggestion?.phrase);
                          const rangeLabel = suggestion?.paragraphLabel
                            ? `Абз. ${suggestion.paragraphLabel}`
                            : getReviewParagraphRangeLabel(item, revision);

                          return (
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
                              variant="emphasis"
                              hideMeta
                              rangeLabelOverride={rangeLabel}
                              title={<span className="emphasis-card-title">"{phrase}"</span>}
                              description={undefined}
                            />
                          );
                        })}
                      </div>
                    ) : activeStepRunCount > 0 && !isReviewRequestInFlight ? (
                      <div className="step-review-empty-state step-review-spellcheck-empty">
                        <p className="step-review-empty-copy">Доречних акцентів не знайдено.</p>
                      </div>
                    ) : !isReviewRequestInFlight ? (
                      <div className="step-review-empty-state step-review-spellcheck-empty">
                        <p className="step-review-empty-copy">Запустіть етап, щоб побачити inline-акценти в рукописі.</p>
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : null}

            </div>
            </>
            )}
          </section>
        }
        steps={workflowSteps}
        activeStepId={activeWorkflowStep}
        onStepSelect={(stepId) => selectWorkflowStep(stepId as WorkflowStepId)}
        initialDrawerWidth={560}
      />
      {isGlobalReplaceOpen ? (
        <div
          className="global-replace-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeGlobalReplace();
            }
          }}
        >
          <section className="global-replace-dialog" role="dialog" aria-modal="true" aria-label="Глобальна заміна">
            <header className="global-replace-head">
              <div className="global-replace-head-copy">
                <p className="global-replace-kicker mono-ui">Ctrl/Cmd+H</p>
                <h3 className="global-replace-title">Глобальна заміна</h3>
              </div>
              <button
                type="button"
                className="draft-reset-dialog-close"
                onClick={closeGlobalReplace}
                aria-label="Закрити глобальну заміну"
              >
                <X className="draft-reset-dialog-close-icon" aria-hidden="true" />
              </button>
            </header>
            <form
              className="global-replace-form"
              onSubmit={(event) => {
                event.preventDefault();
                applyGlobalReplace();
              }}
            >
              <label className="global-replace-field">
                <span className="mono-ui global-replace-label">Знайти</span>
                <input
                  ref={globalReplaceSearchInputRef}
                  className="global-replace-input"
                  value={globalReplaceSearch}
                  onChange={(event) => setGlobalReplaceSearch(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="global-replace-field">
                <span className="mono-ui global-replace-label">Замінити на</span>
                <input
                  className="global-replace-input"
                  value={globalReplaceReplacement}
                  onChange={(event) => setGlobalReplaceReplacement(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <div className="global-replace-foot">
                <p className="global-replace-meta mono-ui">
                  <Replace aria-hidden="true" />
                  <span>Збігів: {globalReplaceMatchCount}</span>
                </p>
                <div className="global-replace-actions">
                  <Button type="button" variant="ghost" size="sm" onClick={closeGlobalReplace}>
                    Скасувати
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!globalReplaceSearch || globalReplaceMatchCount === 0}
                  >
                    Замінити всюди
                  </Button>
                </div>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {activeCompareEntry ? (
        <div
          className="change-compare-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setActiveCompareEntryId(null);
              setExpandedCompareEntryId(null);
            }
          }}
        >
          <section className="change-compare-dialog" role="dialog" aria-modal="true" aria-label="Порівняння правки">
            <header className="change-compare-head">
              <div className="change-compare-head-copy">
                <p className="change-compare-kicker mono-ui">Порівняння правки</p>
                <h3 className="change-compare-title">Було / Стало</h3>
              </div>
              <button
                type="button"
                className="draft-reset-dialog-close"
                onClick={() => {
                  setActiveCompareEntryId(null);
                  setExpandedCompareEntryId(null);
                }}
                aria-label="Закрити порівняння"
              >
                <X className="draft-reset-dialog-close-icon" aria-hidden="true" />
              </button>
            </header>
            <div className="change-compare-accordion" role="list" aria-label="Історія правок">
              {compareHistory.map((entry) => {
                const isExpanded = entry.id === expandedCompareEntryId;

                return (
                  <section
                    key={entry.id}
                    className="change-compare-item"
                    data-expanded={isExpanded ? "true" : "false"}
                    role="listitem"
                  >
                    <button
                      type="button"
                      className="change-compare-item-toggle"
                      aria-expanded={isExpanded}
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedCompareEntryId(null);
                          return;
                        }

                        setActiveCompareEntryId(entry.id);
                        setExpandedCompareEntryId(entry.id);
                      }}
                    >
                      <span className="change-compare-item-copy">
                        <span className="mono-ui change-compare-item-kicker">Правка</span>
                        <span className="change-compare-item-title">{entry.label}</span>
                      </span>
                      <ChevronDown className="change-compare-item-chevron" aria-hidden="true" />
                    </button>

                    {isExpanded ? (
                      <div className="change-compare-item-body">
                        <div className="change-compare-item-summary">
                          <p className="mono-ui change-compare-item-summary-label">Що зроблено</p>
                          <p className="change-compare-item-summary-copy">{entry.label}</p>
                        </div>
                        <div className="change-compare-grid">
                          <section className="change-compare-panel">
                            <div className="change-compare-panel-title-row">
                              <p className="mono-ui change-compare-panel-title">Було</p>
                              <button
                                type="button"
                                className="change-compare-panel-anchor mono-ui"
                                onClick={() => handleCompareParagraphFocus(entry)}
                                title={`Перейти до ${getCompareEntryParagraphRangeLabel(entry, revision)}`}
                                aria-label={`Перейти до ${getCompareEntryParagraphRangeLabel(entry, revision)}`}
                              >
                                {getCompareEntryParagraphRangeLabel(entry, revision)}
                              </button>
                            </div>
                            <div className="change-compare-text change-compare-block-stack">
                              {entry.beforeBlocks.map((block, index) => (
                                <article key={`${entry.id}:before:${block.id}:${index}`} className="change-compare-block">
                                  <p className="change-compare-block-copy">{formatCompareBlockText(block) || " "}</p>
                                </article>
                              ))}
                            </div>
                          </section>
                          <section className="change-compare-panel">
                            <div className="change-compare-panel-title-row">
                              <p className="mono-ui change-compare-panel-title">Стало</p>
                              <button
                                type="button"
                                className="change-compare-panel-anchor mono-ui"
                                onClick={() => handleCompareParagraphFocus(entry)}
                                title={`Перейти до ${getCompareEntryParagraphRangeLabel(entry, revision)}`}
                                aria-label={`Перейти до ${getCompareEntryParagraphRangeLabel(entry, revision)}`}
                              >
                                {getCompareEntryParagraphRangeLabel(entry, revision)}
                              </button>
                            </div>
                            {activeCompareEntry?.id === entry.id && canEditActiveCompare ? (
                              <div className="change-compare-text change-compare-block-stack">
                                {activeCompareEditableBlocks.map((block, index) => (
                                  <label key={`${entry.id}:after:${block.id}:${index}`} className="change-compare-block">
                                    <textarea
                                      className="change-compare-editor"
                                      value={compareDraftTexts[index] ?? formatCompareBlockText(block)}
                                      ref={(element) => {
                                        if (!element) {
                                          compareTextareaRefs.current.delete(block.id);
                                          return;
                                        }

                                        compareTextareaRefs.current.set(block.id, element);
                                      }}
                                      onChange={(event) => handleCompareDraftChange(index, event.target.value)}
                                      onInput={(event) => autosizeCompareTextarea(event.currentTarget)}
                                      aria-label={`Абзац ${index + 1} після правки`}
                                    />
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <pre className="change-compare-text">{formatCompareBlocks(entry.afterBlocks)}</pre>
                            )}
                          </section>
                        </div>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function replaceTextRange(text: string, start: number, end: number, replacement: string): string {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function deriveChangedBlockIds(previousDocument: EditorDocument, nextDocument: EditorDocument): string[] {
  const previousBlocks = new Map(previousDocument.blocks.map((block) => [block.id, block]));
  const nextBlocks = new Map(nextDocument.blocks.map((block) => [block.id, block]));
  const orderedIds = Array.from(new Set([...previousDocument.blocks.map((block) => block.id), ...nextDocument.blocks.map((block) => block.id)]));

  return orderedIds.filter((blockId) => {
    const previousBlock = previousBlocks.get(blockId);
    const nextBlock = nextBlocks.get(blockId);

    if (!previousBlock || !nextBlock) {
      return true;
    }

    return JSON.stringify(previousBlock) !== JSON.stringify(nextBlock);
  });
}

function formatCompareBlocks(blocks: Block[]): string {
  return blocks.map((block) => formatCompareBlockText(block)).join("\n\n");
}

function formatCompareBlockText(block: Block): string {
  if (block.type === "paragraph" || block.type === "heading") {
    return serializeInlineNodesToBoldMarkdown(block.content);
  }

  if (block.type === "bullet_list") {
    return block.items.map((item) => `• ${serializeInlineNodesToBoldMarkdown(item)}`).join("\n");
  }

  if (block.type === "ordered_list") {
    return block.items.map((item, index) => `${index + 1}. ${serializeInlineNodesToBoldMarkdown(item)}`).join("\n");
  }

  if (block.type === "callout") {
    return [serializeInlineNodesToBoldMarkdown(block.title), ...block.body.map((part) => serializeInlineNodesToBoldMarkdown(part))]
      .filter(Boolean)
      .join("\n\n");
  }

  if (block.type === "image") {
    return [block.alt, serializeInlineNodesToBoldMarkdown(block.caption)].filter(Boolean).join("\n");
  }

  if (block.type === "table") {
    return block.rows.map((row) => row.map((cell) => serializeInlineNodesToBoldMarkdown(cell)).join(" | ")).join("\n");
  }

  if (block.type === "divider") {
    return "────────";
  }

  return getBlockText(block);
}

function isCompareBlockTextEditable(block: Block): boolean {
  return (
    block.type === "paragraph" ||
    block.type === "heading" ||
    block.type === "bullet_list" ||
    block.type === "ordered_list" ||
    block.type === "callout"
  );
}

function withEditedCompareBlockText(block: Block, editedText: string): Block {
  const text = editedText.replace(/\r\n?/g, "\n");

  if (block.type === "paragraph") {
    return { ...block, content: parseBoldMarkdownToInlineNodes(text) };
  }

  if (block.type === "heading") {
    return { ...block, content: parseBoldMarkdownToInlineNodes(text) };
  }

  if (block.type === "bullet_list") {
    return {
      ...block,
      items: splitCompareListItems(text).map((item) => parseBoldMarkdownToInlineNodes(item))
    };
  }

  if (block.type === "ordered_list") {
    return {
      ...block,
      items: splitCompareListItems(text).map((item) => parseBoldMarkdownToInlineNodes(item))
    };
  }

  if (block.type === "callout") {
    const [title, ...body] = text.split(/\n\s*\n+/).map((part) => part.trim());

    return {
      ...block,
      title: parseBoldMarkdownToInlineNodes(title ?? ""),
      body: (body.length > 0 ? body : [""]).map((part) => parseBoldMarkdownToInlineNodes(part))
    };
  }

  return block;
}

function splitCompareListItems(text: string): string[] {
  const items = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  return items.length > 0 ? items : [""];
}

function autosizeCompareTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "0px";
  textarea.style.height = `${Math.max(textarea.scrollHeight, 56)}px`;
}

function getCompareEntryKindLabel(kind: EditorMutationKind): string {
  switch (kind) {
    case "manual_edit":
      return "Ручне";
    case "spellcheck_apply":
      return "Правопис";
    case "ai_apply":
      return "ШІ";
    case "insert_block":
      return "Вставка";
    default:
      return "Правка";
  }
}

function formatCompareEntryBlockCount(entry: CompareHistoryEntry): number {
  return Math.max(entry.blockIds.length, entry.beforeBlocks.length, entry.afterBlocks.length, 1);
}

function getCompareEntryParagraphRangeLabel(entry: CompareHistoryEntry, revision: ManuscriptRevisionState): string {
  const indexes = entry.blockIds
    .map((blockId) => revision.blockOrder.indexOf(blockId))
    .filter((index) => index >= 0);

  if (indexes.length === 0) {
    return "Абз. ?";
  }

  const start = formatParagraphLabel(Math.min(...indexes));
  const end = formatParagraphLabel(Math.max(...indexes));

  return start === end ? `Абз. ${start}` : `Абз. ${start}-${end}`;
}

function shouldShowSpellcheckMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return !(
    normalized === "знайдено потенційну орфографічну помилку." ||
    normalized === "можлива орфографічна помилка." ||
    normalized === "ймовірна орфографічна помилка."
  );
}

function getSpellcheckIssueHeadline(result: SpellcheckBlockResult): string {
  const primaryIssue = result.issues[0]?.badText.trim();

  if (primaryIssue) {
    return primaryIssue;
  }

  return `Абз. ${result.paragraphLabel}`;
}

function invalidateSpellcheckResultsForChangedBlocks(
  previousDocument: EditorDocument,
  nextDocument: EditorDocument,
  results: SpellcheckBlockResult[]
): SpellcheckBlockResult[] {
  const previousBlocks = new Map(previousDocument.blocks.map((block) => [block.id, block]));
  const nextBlocks = new Map(nextDocument.blocks.map((block) => [block.id, block]));

  return results
    .map((result) => {
      const previousBlock = previousBlocks.get(result.blockId);
      const nextBlock = nextBlocks.get(result.blockId);

      if (!previousBlock || !nextBlock) {
        return null;
      }

      const previousText = getBlockText(previousBlock);
      const nextText = getBlockText(nextBlock);

      if (previousText === nextText) {
        return result;
      }

      // Rebase untouched issue ranges for a single contiguous text edit.
      // If the edit shape is ambiguous, we still invalidate this block.
      if (result.text !== previousText) {
        return null;
      }

      return reconcileSpellcheckBlockResultAfterTextEdit(result, nextText);
    })
    .filter((result): result is SpellcheckBlockResult => Boolean(result));
}

function reconcileSpellcheckBlockResultAfterTextEdit(result: SpellcheckBlockResult, nextText: string): SpellcheckBlockResult | null {
  const replacement = detectSingleTextReplacement(result.text, nextText);

  if (!replacement) {
    return null;
  }

  const delta = replacement.text.length - (replacement.end - replacement.start);
  const nextIssues = result.issues.flatMap((issue) => {
    if (issue.range.end <= replacement.start) {
      return [issue];
    }

    if (issue.range.start >= replacement.end) {
      return [
        {
          ...issue,
          range: {
            start: issue.range.start + delta,
            end: issue.range.end + delta
          }
        }
      ];
    }

    return [];
  });

  return {
    ...result,
    text: nextText,
    issues: nextIssues
  };
}

function detectSingleTextReplacement(previousText: string, nextText: string): { start: number; end: number; text: string } | null {
  if (previousText === nextText) {
    return {
      start: previousText.length,
      end: previousText.length,
      text: ""
    };
  }

  let prefixLength = 0;
  const prefixMax = Math.min(previousText.length, nextText.length);

  while (prefixLength < prefixMax && previousText.charAt(prefixLength) === nextText.charAt(prefixLength)) {
    prefixLength += 1;
  }

  let previousSuffixIndex = previousText.length;
  let nextSuffixIndex = nextText.length;

  while (
    previousSuffixIndex > prefixLength &&
    nextSuffixIndex > prefixLength &&
    previousText.charAt(previousSuffixIndex - 1) === nextText.charAt(nextSuffixIndex - 1)
  ) {
    previousSuffixIndex -= 1;
    nextSuffixIndex -= 1;
  }

  return {
    start: prefixLength,
    end: previousSuffixIndex,
    text: nextText.slice(prefixLength, nextSuffixIndex)
  };
}

function deriveEmphasisSuggestions(
  reviewItems: EditorialReviewItem[],
  document: EditorDocument,
  revision: ManuscriptRevisionState
): EmphasisSuggestionViewModel[] {
  const suggestions: EmphasisSuggestionViewModel[] = [];

  for (const item of reviewItems) {
    if (item.stepId !== "emphasis" || item.anchor.blockIds.length !== 1) {
      continue;
    }

    const phrase = trimWrappedQuotes(
      (
        item.emphasisTarget?.text ??
        extractEmphasisPhrase(item.recommendation) ??
        extractEmphasisPhrase(item.title) ??
        ""
      ).trim()
    );

    if (!phrase) {
      continue;
    }

    const blockId = item.anchor.blockIds[0];
    const block = document.blocks.find((entry) => entry.id === blockId);

    if (!block || (block.type !== "paragraph" && block.type !== "heading")) {
      continue;
    }

    const blockText = getInlineText(block.content);
    const occurrence = Math.max(1, item.emphasisTarget?.occurrence ?? 1);
    const range = findInlineOccurrenceRange(blockText, phrase, occurrence);

    if (!range) {
      continue;
    }

    if (item.status !== "applied" && isInlineRangeBold(block.content, range.start, range.end)) {
      continue;
    }

    suggestions.push({
      itemId: item.id,
      blockId,
      paragraphLabel: getReviewParagraphRangeLabel(item, revision).replace(/^Абз\.\s*/u, ""),
      phrase,
      reason: item.reason || undefined,
      status: item.status,
      range
    });
  }

  return suggestions;
}

function findInlineOccurrenceRange(
  blockText: string,
  phrase: string,
  occurrence: number
): { start: number; end: number } | null {
  if (!phrase) {
    return null;
  }

  let searchFrom = 0;

  for (let current = 1; current <= occurrence; current += 1) {
    const start = blockText.indexOf(phrase, searchFrom);

    if (start < 0) {
      return null;
    }

    if (current === occurrence) {
      return { start, end: start + phrase.length };
    }

    searchFrom = start + 1;
  }

  return null;
}

function extractEmphasisPhrase(recommendation: string): string | null {
  const quoteMatch = recommendation.match(/["«“](.+?)["»”]/u);

  if (quoteMatch?.[1]?.trim()) {
    return quoteMatch[1].trim();
  }

  const markdownMatch = recommendation.match(/\*\*(.+?)\*\*/u);

  if (markdownMatch?.[1]?.trim()) {
    return markdownMatch[1].trim();
  }

  return null;
}

function getEmphasisCardPhrase(item: EditorialReviewItem, resolvedPhrase?: string): string {
  const directPhrase = trimWrappedQuotes((resolvedPhrase ?? "").trim());

  if (directPhrase) {
    return directPhrase;
  }

  const targetPhrase = trimWrappedQuotes(item.emphasisTarget?.text?.trim() ?? "");

  if (targetPhrase) {
    return targetPhrase;
  }

  const extractedPhrase = trimWrappedQuotes(extractEmphasisPhrase(item.recommendation) ?? extractEmphasisPhrase(item.title) ?? "");

  if (extractedPhrase) {
    return extractedPhrase;
  }

  return trimWrappedQuotes(item.title.trim() || item.recommendation.trim());
}

function trimWrappedQuotes(value: string): string {
  return value
    .replace(/^["'`«“”„]+/u, "")
    .replace(/["'`»“”„]+$/u, "")
    .trim();
}

function replaceInlineRangeWithText(nodes: Array<{ text: string; bold?: true; italic?: true; link?: string }>, start: number, end: number, replacement: string) {
  const nextNodes: Array<{ text: string; bold?: true; italic?: true; link?: string }> = [];
  const replacementMarks = getInlineMarksAtOffset(nodes, start);
  let consumed = 0;
  let inserted = false;

  for (const node of nodes) {
    const nodeStart = consumed;
    const nodeEnd = nodeStart + node.text.length;
    consumed = nodeEnd;

    if (nodeEnd <= start || nodeStart >= end) {
      nextNodes.push({ ...node });
      continue;
    }

    const beforeText = node.text.slice(0, Math.max(0, start - nodeStart));
    const afterText = node.text.slice(Math.max(0, end - nodeStart));

    if (beforeText) {
      nextNodes.push({ ...node, text: beforeText });
    }

    if (!inserted && replacement) {
      nextNodes.push(createInlineText(replacement, replacementMarks));
      inserted = true;
    }

    if (afterText) {
      nextNodes.push({ ...node, text: afterText });
    }
  }

  if (!inserted && replacement) {
    nextNodes.push(createInlineText(replacement, replacementMarks));
  }

  return normalizeInlineNodes(nextNodes);
}

function applyEmphasisSuggestionsToDocument(
  document: EditorDocument,
  suggestions: EmphasisSuggestionViewModel[]
): {
  document: EditorDocument;
  changedBlockIds: string[];
  beforeBlocks: Block[];
  afterBlocks: Block[];
  appliedItemIds: string[];
} {
  const suggestionsByBlockId = new Map<string, EmphasisSuggestionViewModel[]>();

  for (const suggestion of suggestions) {
    const current = suggestionsByBlockId.get(suggestion.blockId) ?? [];
    current.push(suggestion);
    suggestionsByBlockId.set(suggestion.blockId, current);
  }

  const beforeBlocks: Block[] = [];
  const afterBlocks: Block[] = [];
  const changedBlockIds: string[] = [];
  const appliedItemIds = new Set<string>();

  const nextDocument: EditorDocument = {
    version: 2,
    blocks: document.blocks.map((block) => {
      const blockSuggestions = suggestionsByBlockId.get(block.id);

      if (!blockSuggestions || (block.type !== "paragraph" && block.type !== "heading")) {
        return block;
      }

      let nextContent = block.content;

      for (const suggestion of blockSuggestions.slice().sort((left, right) => left.range.start - right.range.start)) {
        if (isInlineRangeBold(nextContent, suggestion.range.start, suggestion.range.end)) {
          continue;
        }

        nextContent = applyBoldToInlineRange(nextContent, suggestion.range.start, suggestion.range.end);
        appliedItemIds.add(suggestion.itemId);
      }

      if (JSON.stringify(nextContent) === JSON.stringify(block.content)) {
        return block;
      }

      const nextBlock = {
        ...block,
        content: nextContent
      };

      beforeBlocks.push(block);
      afterBlocks.push(nextBlock);
      changedBlockIds.push(block.id);

      return nextBlock;
    })
  };

  return {
    document: nextDocument,
    changedBlockIds,
    beforeBlocks,
    afterBlocks,
    appliedItemIds: Array.from(appliedItemIds)
  };
}

function applyBoldToInlineRange(nodes: InlineNode[], start: number, end: number): InlineNode[] {
  const nextNodes: InlineNode[] = [];
  let consumed = 0;

  for (const node of nodes) {
    const nodeStart = consumed;
    const nodeEnd = nodeStart + node.text.length;
    consumed = nodeEnd;

    if (nodeEnd <= start || nodeStart >= end) {
      nextNodes.push({ ...node });
      continue;
    }

    const beforeText = node.text.slice(0, Math.max(0, start - nodeStart));
    const activeText = node.text.slice(Math.max(0, start - nodeStart), Math.max(0, end - nodeStart));
    const afterText = node.text.slice(Math.max(0, end - nodeStart));

    if (beforeText) {
      nextNodes.push({ ...node, text: beforeText });
    }

    if (activeText) {
      nextNodes.push({ ...node, text: activeText, bold: true });
    }

    if (afterText) {
      nextNodes.push({ ...node, text: afterText });
    }
  }

  return normalizeInlineNodes(nextNodes);
}

function isInlineRangeBold(nodes: InlineNode[], start: number, end: number): boolean {
  let consumed = 0;

  for (const node of nodes) {
    const nodeStart = consumed;
    const nodeEnd = nodeStart + node.text.length;
    consumed = nodeEnd;

    if (nodeEnd <= start || nodeStart >= end) {
      continue;
    }

    if (!node.bold) {
      return false;
    }
  }

  return true;
}

function getInlineMarksAtOffset(
  nodes: Array<{ text: string; bold?: true; italic?: true; link?: string }>,
  offset: number
): Omit<{ text: string; bold?: true; italic?: true; link?: string }, "text"> {
  let consumed = 0;

  for (const node of nodes) {
    const nodeStart = consumed;
    const nodeEnd = nodeStart + node.text.length;

    if (offset <= nodeEnd) {
      return {
        bold: node.bold,
        italic: node.italic,
        link: node.link
      };
    }

    consumed = nodeEnd;
  }

  const lastNode = nodes[nodes.length - 1];
  return {
    bold: lastNode?.bold,
    italic: lastNode?.italic,
    link: lastNode?.link
  };
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

function buildLocalPatchProposal(
  operation: PatchOperation,
  revisionId: string,
  warning?: {
    code: "no_op";
    message: string;
    similarity: number;
  }
): ReviewActionProposal {
  return {
    id: operation.id,
    reviewItemId: operation.id,
    sourceRevisionId: revisionId,
    targetRevisionId: revisionId,
    kind: "text_diff",
    summary: operation.reason,
    canApplyDirectly: true,
    textDiff: {
      op: "replace_blocks",
      blockIds: operation.blockIds,
      oldBlocks: operation.oldBlocks,
      newBlocks: operation.newBlocks,
      reason: operation.reason,
      warning
    }
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
    const linkedCardsCount = sectionItemCount ?? 0;
    return {
      tone: "info",
      message:
        count > 0
          ? linkedCardsCount > 0
            ? `Підготовлено ${count} рядків факт-чеку та ${linkedCardsCount} карт${linkedCardsCount === 1 ? "ку" : linkedCardsCount < 5 ? "ки" : "ок"} для правок.`
            : `Підготовлено ${count} рядків факт-чеку.`
          : "Факт-чек не виявив окремих спірних тверджень."
    };
  }

  if (payload.stepId === "emphasis") {
    const count = sectionItemCount ?? payload.items.length;

    return {
      tone: "info",
      message: count > 0 ? `Підготовлено ${count} акцент${count === 1 ? "" : count < 5 ? "и" : "ів"} для inline-погодження.` : "ШІ не знайшов доречних акцентів."
    };
  }

  if (payload.items.length === 0) {
    return {
      tone: "info",
      message:
        payload.diagnostics.droppedItemCount > 0
          ? `ШІ не повернув валідних карток для цього кроку. Відхилено під час нормалізації/фільтрації: ${payload.diagnostics.droppedItemCount}.`
          : "ШІ не знайшов сильних локальних рекомендацій."
    };
  }

  const count = sectionItemCount ?? payload.items.length;
  const stepLabel = WORKFLOW_STEPS.find((step) => step.id === payload.stepId)?.label?.toLowerCase();

  return {
    tone: "info",
    message: stepLabel
      ? payload.diagnostics.droppedItemCount > 0
        ? `У кроці «${stepLabel}» підготовлено ${count} карток, відхилено: ${payload.diagnostics.droppedItemCount}.`
        : `У кроці «${stepLabel}» підготовлено ${count} карток з рекомендаціями.`
      : payload.diagnostics.droppedItemCount > 0
        ? `Підготовлено ${count} карток для цього кроку, відхилено: ${payload.diagnostics.droppedItemCount}.`
        : `Підготовлено ${count} карток з рекомендаціями для цього кроку.`
  };
}

function mapReviewItemsByStep(items: EditorialReviewItem[]): Record<EditorialReviewStepId, EditorialReviewItem[]> {
  const groups: Record<EditorialReviewStepId, EditorialReviewItem[]> = {
    diagnostics: [],
    fact_check: [],
    structure: [],
    clarity: [],
    interest: [],
    visuals: [],
    formatting: [],
    emphasis: [],
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

function getWorkflowStepForManualKind(kind: ManualGenerationKind): WorkflowStepId {
  if (kind === "visual") {
    return "visuals";
  }

  if (kind === "callout") {
    return "interest";
  }

  if (kind === "subsection") {
    return "structure";
  }

  return "formatting";
}

function buildFactCheckActionInstruction(item: EditorialReviewItem): string | null {
  if (item.stepId !== "fact_check") {
    return null;
  }

  if (item.recommendationType === "callout") {
    return [
      "Це картка, згенерована саме з факт-чеку.",
      "Мета: не дисклеймер і не розмиття тексту, а коротке і предметне пояснення статусу твердження на основі наявних джерел.",
      "Не додавай фрази типу «усе неоднозначно», «не можна робити висновки», «порадьтеся з лікарем», якщо цього немає у вихідному фрагменті.",
      "Формулюй нейтрально і редакторськи: що саме перевірено, чого бракує, як обережно подати це твердження без зайвого страхування."
    ].join("\n");
  }

  if (isReplaceReviewType(item.recommendationType)) {
    return [
      "Це картка, згенерована саме з факт-чеку.",
      "Перепиши локально й конкретно: прибери категоричність або уточни формулювання, але не перетворюй текст на дисклеймер.",
      "Заборонено шаблони на кшталт «потребує обережного тлумачення», «усе неоднозначно», «не можна робити висновки», якщо це прямо не випливає з фактичного рядка.",
      "Ціль: максимально зберегти авторський тон книги, виправивши лише фактологічний ризик у цьому фрагменті."
    ].join("\n");
  }

  return null;
}

const FACT_CHECK_SKIP_TOKENS = new Set([
  "або",
  "але",
  "без",
  "був",
  "буває",
  "бути",
  "вже",
  "вона",
  "вони",
  "для",
  "дуже",
  "його",
  "йому",
  "йти",
  "коли",
  "може",
  "можуть",
  "навіть",
  "неї",
  "після",
  "про",
  "при",
  "також",
  "тих",
  "того",
  "цей",
  "ця",
  "ці",
  "що",
  "щоб"
]);

function createFactCheckLinkedReviewItems(input: {
  rows: EditorialFactCheckRow[];
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  changeLevel: WholeTextChangeLevel;
  reviewSessionId: string;
  stepRunId: string;
}): EditorialReviewItem[] {
  const items: EditorialReviewItem[] = [];

  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index];
    const claim = row.claim.trim();

    if (!claim || row.status === "ok") {
      continue;
    }

    const anchor = resolveFactCheckAnchor(input.document, input.revision, claim);

    if (!anchor) {
      continue;
    }

    const needsCallout = row.status === "не підтверджено" || row.sources.length === 0;
    const titlePrefix = row.status === "сумнівно" ? "Уточнити твердження" : "Маркувати непідтверджене";
    const sourceHint =
      row.sources.length > 0
        ? `Джерела: ${row.sources.map((source) => source.domain).slice(0, 3).join(", ")}.`
        : "Надійне зовнішнє джерело не знайдено.";

    const recommendation = needsCallout
      ? "Додати коротку врізку «Міф / Правда», яка обережно пояснює статус твердження і не подає його як встановлений факт."
      : "Локально переформулювати це місце: зняти категоричність і явно позначити, що твердження потребує обережного тлумачення.";
    const reason = `${row.explanation} ${sourceHint}`.trim();
    const common: Omit<EditorialReviewItem, "recommendationType" | "suggestedAction" | "insertionPoint" | "priority" | "id" | "status"> = {
      reviewSessionId: input.reviewSessionId,
      documentRevisionId: input.revision.documentRevisionId,
      changeLevel: input.changeLevel,
      title: `${titlePrefix}: ${claim.slice(0, 88)}${claim.length > 88 ? "…" : ""}`,
      reason,
      recommendation,
      anchor: {
        blockIds: anchor.blockIds,
        generationBlockRange: {
          start: anchor.startIndex,
          end: anchor.endIndex
        },
        excerpt: anchor.excerpt,
        fingerprint: computeAnchorFingerprint(input.document, anchor.blockIds)
      },
      origin: "review",
      stepId: "fact_check",
      stepRunId: input.stepRunId
    };

    items.push({
      ...common,
      id: createPatchId(`review-item-fact-${index + 1}`),
      recommendationType: needsCallout ? "callout" : "rewrite",
      suggestedAction: needsCallout ? "prepare_callout" : "rewrite_text",
      insertionPoint: {
        mode: needsCallout ? "after" : "replace",
        anchorBlockId: anchor.anchorBlockId
      },
      calloutKind: needsCallout ? "myths_vs_truth" : undefined,
      calloutDepth: needsCallout ? "brief" : undefined,
      priority: row.status === "не підтверджено" ? "high" : "medium",
      status: "pending"
    });
  }

  return items.slice(0, 12);
}

function resolveFactCheckAnchor(
  document: EditorDocument,
  revision: ManuscriptRevisionState,
  claim: string
): { blockIds: string[]; startIndex: number; endIndex: number; anchorBlockId: string; excerpt: string } | null {
  const claimTokens = tokenizeForFactMatching(claim);

  if (claimTokens.length === 0) {
    return null;
  }

  let bestBlockId: string | null = null;
  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < revision.blockOrder.length; index += 1) {
    const blockId = revision.blockOrder[index];
    const block = document.blocks.find((entry) => entry.id === blockId);

    if (!block) {
      continue;
    }

    const blockTokens = tokenizeForFactMatching(getBlockText(block));

    if (blockTokens.length === 0) {
      continue;
    }

    const tokenSet = new Set(blockTokens);
    let overlap = 0;

    for (const token of claimTokens) {
      if (tokenSet.has(token)) {
        overlap += 1;
      }
    }

    if (overlap === 0) {
      continue;
    }

    const score = overlap / Math.max(3, claimTokens.length);

    if (score > bestScore) {
      bestScore = score;
      bestBlockId = blockId;
      bestIndex = index;
    }
  }

  if (!bestBlockId || bestIndex < 0 || bestScore < 0.2) {
    return null;
  }

  const block = document.blocks.find((entry) => entry.id === bestBlockId);

  if (!block) {
    return null;
  }

  return {
    blockIds: [bestBlockId],
    startIndex: bestIndex,
    endIndex: bestIndex,
    anchorBlockId: bestBlockId,
    excerpt: getBlockText(block).trim()
  };
}

function tokenizeForFactMatching(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[`'’"]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !FACT_CHECK_SKIP_TOKENS.has(token));
}

function buildStructureOutline(
  document: EditorDocument,
  items: EditorialReviewItem[],
  revision: ManuscriptRevisionState,
  showCompletedCards: boolean
): StructureOutlineNode[] {
  if (document.blocks.length === 0) {
    return [];
  }

  const blockIndexById = new Map(document.blocks.map((block, index) => [block.id, index]));
  const nodes: StructureOutlineNode[] = [];

  document.blocks.forEach((block, index) => {
    if (block.type !== "heading") {
      return;
    }

    const title = getBlockText(block).trim() || "Без назви";
    nodes.push({
      id: `heading-${block.id}`,
      title,
      level: block.level,
      rangeLabel: "",
      startIndex: index,
      endIndex: index,
      anchorBlockId: block.id,
      actions: []
    });
  });

  if (nodes.length === 0) {
    nodes.push({
      id: "structure-outline-root",
      title: "Рукопис без підзаголовків",
      level: 1,
      rangeLabel: "",
      startIndex: 0,
      endIndex: document.blocks.length - 1,
      anchorBlockId: document.blocks[0]?.id ?? null,
      actions: []
    });
  } else if (nodes[0] && nodes[0].startIndex > 0) {
    nodes.unshift({
      id: "structure-outline-prefix",
      title: "Початок без підзаголовка",
      level: 1,
      rangeLabel: "",
      startIndex: 0,
      endIndex: nodes[0].startIndex - 1,
      anchorBlockId: document.blocks[0]?.id ?? null,
      actions: []
    });
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const next = nodes[index + 1];
    nodes[index].endIndex = next ? Math.max(nodes[index].startIndex, next.startIndex - 1) : document.blocks.length - 1;
    nodes[index].rangeLabel = formatStructureRangeLabel(nodes[index].startIndex, nodes[index].endIndex);
  }

  const sortedItems = [...items].sort(
    (left, right) => getItemStartIndex(left, blockIndexById) - getItemStartIndex(right, blockIndexById)
  );

  for (const item of sortedItems) {
    const startIndex = getItemStartIndex(item, blockIndexById);
    const targetNode = nodes.find((node) => startIndex >= node.startIndex && startIndex <= node.endIndex) ?? nodes[nodes.length - 1];

    if (!targetNode) {
      continue;
    }

    targetNode.actions.push({
      item,
      rangeLabel: getReviewParagraphRangeLabel(item, revision),
      label: getStructureActionLabel(item),
      statusLabel: getStructureActionStatusLabel(item.status),
      isHidden: !showCompletedCards && (item.status === "applied" || item.status === "dismissed")
    });
  }

  return nodes;
}

function getItemStartIndex(item: EditorialReviewItem, blockIndexById: Map<string, number>): number {
  const anchorId = item.anchor.blockIds[0] ?? item.insertionPoint.anchorBlockId;
  return blockIndexById.get(anchorId) ?? Number.MAX_SAFE_INTEGER;
}

function formatStructureRangeLabel(start: number, end: number): string {
  return start === end
    ? `Абз. ${formatParagraphLabel(start)}`
    : `Абз. ${formatParagraphLabel(start)}-${formatParagraphLabel(end)}`;
}

function getStructureActionLabel(item: EditorialReviewItem): string {
  if (item.status === "ready") {
    return "відкрити чернетку";
  }

  if (item.status === "applied") {
    return "вже застосовано";
  }

  if (item.status === "dismissed") {
    return "відхилено";
  }

  if (item.recommendationType === "subsection") {
    return "підготувати підзаголовок";
  }

  if (item.recommendationType === "list") {
    return "оформити списком";
  }

  if (item.recommendationType === "callout") {
    return "підготувати врізку";
  }

  return "підготувати дію";
}

function getStructureActionStatusLabel(status: EditorialReviewItem["status"]): string {
  if (status === "applied") {
    return "погоджено";
  }

  if (status === "dismissed") {
    return "відхилено";
  }

  if (status === "ready") {
    return "готово";
  }

  if (status === "preparing") {
    return "готується";
  }

  if (status === "stale") {
    return "застаріло";
  }

  return "очікує";
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

  if (stepId === "emphasis") {
    return item.recommendationType === "rewrite" && item.stepId === "emphasis";
  }

  if (stepId === "final_editing") {
    return (
      item.recommendationType === "rewrite" ||
      item.recommendationType === "simplify" ||
      item.recommendationType === "expand" ||
      item.recommendationType === "list" ||
      item.recommendationType === "subsection" ||
      item.recommendationType === "callout" ||
      item.recommendationType === "visual"
    );
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

function buildRejectedReviewIdea(item: EditorialReviewItem): RejectedReviewIdea {
  return normalizeRejectedReviewIdeas([
    {
      blockIds: item.anchor.blockIds,
      recommendationType: item.recommendationType,
      recommendation: item.recommendation
    }
  ])[0] ?? {
    blockIds: item.anchor.blockIds.filter(Boolean),
    recommendationType: item.recommendationType,
    recommendation: item.recommendation.replace(/\s+/g, " ").trim().slice(0, 300)
  };
}

function getRejectedReviewIdeaKey(idea: RejectedReviewIdea): string {
  return `${idea.recommendationType}:${idea.blockIds.join("|")}`;
}

function getActiveStepRunDisabledReason(input: {
  stepId: WorkflowStepId;
  canRun: boolean;
  canRequestReview: boolean;
  canRunSpellcheck: boolean;
  reviewExpertise: string | null;
  stepFeedback?: string;
  isReviewRequestInFlight: boolean;
  isSpellcheckRequestInFlight: boolean;
}): string | undefined {
  if (input.canRun) {
    return undefined;
  }

  if (input.stepId === "diagnostics" || input.stepId === "emphasis") {
    if (input.isReviewRequestInFlight) {
      return "Дочекайтеся завершення поточного запуску.";
    }

    if (!input.canRequestReview) {
      return "Додайте текст рукопису, щоб запустити етап.";
    }
  }

  if (input.stepId === "spellcheck") {
    if (input.isSpellcheckRequestInFlight) {
      return "Дочекайтеся завершення перевірки правопису.";
    }

    if (!input.canRunSpellcheck) {
      return "Додайте текстові абзаци або заголовки, щоб запустити перевірку.";
    }
  }

  if (!input.reviewExpertise?.trim()) {
    return "Спочатку запустіть діагностику, щоб дати етапу контекст.";
  }

  if (input.stepId === "final_editing" && !input.stepFeedback?.trim()) {
    return "Напишіть власний запит для цього етапу.";
  }

  if (input.isReviewRequestInFlight) {
    return "Дочекайтеся завершення поточного запуску.";
  }

  return "Ця дія тимчасово недоступна.";
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
