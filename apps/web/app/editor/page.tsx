"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BlockEditorSurface } from "../../components/editor/BlockEditorSurface";
import { EditorialReviewCard } from "../../components/editor/EditorialReviewCard";
import { FloatingComposerPanel } from "../../components/editor/FloatingComposerPanel";
import { StructureOutlineTree } from "../../components/editor/StructureOutlineTree";
import { TopBar } from "../../components/layout/TopBar";
import { type RequestHistoryItem } from "../../components/layout/RightOperationsRail";
import { StepReviewWorkspaceShell } from "../../components/layout/StepReviewWorkspaceShell";
import { Button } from "../../components/ui/Button";
import { useProductLocale, useProductLocaleConfig, useProductCopy } from "../../components/providers/ProductLocaleProvider";
import { getEditorDraftStorageKey, type AppLocale } from "../../lib/i18n/product-locale";
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
import {
  clearEditorDraftState,
  readEditorDraftState,
  writeEditorActiveReviewRun,
  writeEditorDraftState,
  type PersistedActiveReviewRun,
  type PersistedWorkflowStepId
} from "../../lib/editor/draft-state";
import {
  createPersistedActiveReviewRun,
  isRunCompatibleWithEditor,
  isRunTerminal,
  isReviewRunPollLeasedByOther,
  releaseReviewRunPollLease,
  tryAcquireReviewRunPollLease,
  withReviewRunStartLock
} from "../../lib/editor/review-run-persistence";
import {
  clearReviewItemsForReplaceRun,
  mergeIncomingReviewItems,
  retainReviewRunProgress
} from "../../lib/editor/review-run-merge";
import {
  isReviewRunProgressFeedback,
  reviewChunkProgressPercent,
  sliceDocumentForFragmentRetry
} from "../../lib/editor/review-run-progress";
import {
  isActiveStepReviewRunning,
  interpretReviewRunPollBody,
  REVIEW_POLL_FETCH_TIMEOUT_MS,
  resolveReviewRunStartIntent,
  sanitizeExposedErrorMessage,
  shouldAbandonReviewRunAfterPollError,
  shouldShowReviewRunChrome
} from "../../lib/editor/review-run-recovery";
import { resolveReviewPollWaitMs } from "../../lib/editor/review-poll-interval";
import { buildDocxFileName, deriveDocxFileNameBase, exportDocumentToDocx } from "../../lib/editor/docx-export";
import { buildImportFeedback } from "../../lib/editor/import-feedback";
import { linkifyExpertiseParagraphRefs, localizeExpertiseMarkdown } from "../../lib/editor/expertise-markdown";
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
import { buildStructureOutlineTree } from "../../lib/editor/structure-outline";
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
  type DiagnosticsMode,
  type VisualStylePreset,
  type EditorialVisualIntent,
  getEditorialCalloutKindTitle,
  getReviewParagraphRangeLabel,
  reconcileReviewItemsWithRevision,
  type GeneratedReviewImageAsset,
  type ChatMessage,
  type EditorialReviewDiagnostics,
  type EditorialReviewRunApiResponse,
  type EditorialReviewItem,
  type EditorialReviewFailedChunk,
  type EditorialReviewChunkScope,
  type CustomRequestPlanAction,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  type RejectedReviewIdea,
  isEditorialReviewRunApiResponse,
  isReplaceReviewType,
  normalizeDiagnosticsMode,
  normalizeRejectedReviewIdeas,
  type ReviewActionRequest,
  type ReviewActionProposal,
  type ReviewActionResponse,
  type WholeTextChangeLevel,
  type VisualImageQuality,
  normalizeEditorialCalloutDepth
} from "../../lib/editor/review-contract";
import {
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_VISUAL_STYLE_PRESET,
  DEFAULT_VISUAL_IMAGE_QUALITY,
  EDITOR_SETTINGS_UPDATED_EVENT,
  normalizeVisualImageQuality,
  normalizeVisualStylePreset,
  resolveReviewImageTargetModel,
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
import { getProductLocaleConfig, getVisualStylePresetStorageKey, getVisualImageQualityStorageKey } from "../../lib/i18n/product-locale";
import { getWorkflowStepLabel, getEditorMessages } from "../../lib/i18n/editor-messages";
import { buildFactCheckActionInstruction } from "../../lib/i18n/server-prompts/review-action";
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
  Square,
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
  imageQuality: VisualImageQuality;
  stepFeedback: EditorialStepFeedbackMap;
  stepRunModeByStep: EditorialStepRunModeMap;
  diagnosticsMode: DiagnosticsMode;
  stepRunHistory: EditorialStepRunHistory;
  factCheckRows: EditorialFactCheckRow[];
  showCompletedCards: boolean;
  reviewRefineInstruction: string;
}

const defaultReviewComposer: { changeLevel: WholeTextChangeLevel; additionalInstructions: string } = {
  changeLevel: 5,
  additionalInstructions: ""
};
const defaultManualCalloutKind: EditorialCalloutKind = "mechanism";
const defaultManualCalloutDepth: EditorialCalloutDepth = "brief";
const defaultManualVisualIntent: EditorialVisualIntent = "infographic";
const defaultVisualStylePreset: VisualStylePreset = DEFAULT_VISUAL_STYLE_PRESET;
const defaultVisualImageQuality: VisualImageQuality = DEFAULT_VISUAL_IMAGE_QUALITY;
const defaultLocalActionMode = "edit" as const;
const defaultLocalTextIntent = "rewrite" as const;

type ComposerMode = "local" | "review" | null;
type ManualGenerationKind = "callout" | "visual" | "list" | "subsection";
type WorkflowStepId = PersistedWorkflowStepId;
type TopActionMenuId = "open" | "save" | null;

const WORKFLOW_STEP_ICONS: Record<WorkflowStepId, typeof Stethoscope> = {
  diagnostics: Stethoscope,
  fact_check: Search,
  structure: LayoutGrid,
  clarity: Sparkles,
  interest: Target,
  visuals: ImageIcon,
  formatting: Table2,
  spellcheck: Languages,
  emphasis: Highlighter,
  final_editing: MessageSquareText
};

const WORKFLOW_STEP_ORDER: WorkflowStepId[] = [
  "diagnostics",
  "fact_check",
  "structure",
  "clarity",
  "interest",
  "formatting",
  "final_editing",
  "emphasis",
  "spellcheck",
  "visuals"
];

function isEditorialReviewStepId(stepId: WorkflowStepId): stepId is EditorialReviewStepId {
  return stepId !== "spellcheck";
}

function isLocalActionRoutePayload(value: LocalActionRouteResponse | { error?: string }): value is LocalActionRouteResponse {
  return "executor" in value;
}

const REVIEW_JOB_SUPERSEDED_ERROR = "review_job_superseded";

class EditorialReviewRunTerminalError extends Error {
  readonly run?: Extract<EditorialReviewRunApiResponse, { kind: "error" }>["run"];

  constructor(message: string, run?: Extract<EditorialReviewRunApiResponse, { kind: "error" }>["run"]) {
    super(message);
    this.name = "EditorialReviewRunTerminalError";
    this.run = run;
  }
}

function createBlankDocument(): EditorDocument {
  return {
    version: 2,
    blocks: [createEmptyParagraphBlock("p-blank")]
  };
}

export default function EditorPage() {
  const { locale } = useProductLocale();
  const copy = useProductCopy();
  const editorCopy = copy.editor;
  const fb = editorCopy.feedback;
  const hl = editorCopy.historyLabels;
  const fc = editorCopy.factCheck;
  const sc = editorCopy.spellcheckUi;
  const cs = editorCopy.cardStats;
  const ss = editorCopy.spellcheckStats;
  const es = editorCopy.emphasisStats;
  const st = editorCopy.structure;
  const cd = editorCopy.cards;
  const localeConfig = useProductLocaleConfig();
  const baseWorkflowSteps = useMemo(
    () =>
      WORKFLOW_STEP_ORDER.map((id) => ({
        id,
        label: editorCopy.workflowSteps[id],
        icon: WORKFLOW_STEP_ICONS[id]
      })),
    [editorCopy]
  );
  const workflowStepSummaries = editorCopy.workflowSummaries;
  const historyTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(localeConfig.displayLocale, {
        hour: "2-digit",
        minute: "2-digit"
      }),
    [localeConfig.displayLocale]
  );
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
  const [reviewFlightStepId, setReviewFlightStepId] = useState<EditorialReviewStepId | null>(null);
  const [activeReviewRun, setActiveReviewRun] = useState<PersistedActiveReviewRun | null>(null);
  const [failedReviewChunks, setFailedReviewChunks] = useState<EditorialReviewFailedChunk[]>([]);
  const [reviewLeaseRetryNonce, setReviewLeaseRetryNonce] = useState(0);
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
  const [imageQuality, setImageQuality] = useState<VisualImageQuality>(defaultVisualImageQuality);
  const [stepFeedback, setStepFeedback] = useState<EditorialStepFeedbackMap>(() => createDefaultStepFeedbackMap());
  const [stepRunModeByStep, setStepRunModeByStep] = useState<EditorialStepRunModeMap>(() => createDefaultStepRunModeMap("replace"));
  const [diagnosticsMode, setDiagnosticsMode] = useState<DiagnosticsMode>("concise");
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
  const activeReviewJobRunRef = useRef<string | null>(null);
  const reviewPollAbortRef = useRef<AbortController | null>(null);
  const reviewPollTabIdRef = useRef(createPatchId("review-tab"));
  const consumedReviewRunIdsRef = useRef(new Set<string>());
  const fragmentRetryInFlightRef = useRef(false);
  const customRequestPlanActionsRef = useRef<CustomRequestPlanAction[] | null>(null);
  const pendingFragmentRetryRef = useRef<EditorialReviewFailedChunk | null>(null);
  const reviewLeaseRetryTimeoutRef = useRef<number | null>(null);
  const pendingReviewRunCleanupRef = useRef<{
    runId: string;
    stepId: EditorialReviewStepId;
    stepRunId: string;
  } | null>(null);
  const activeLocaleRef = useRef(locale);
  const currentDocumentRef = useRef(document);
  const currentRevisionRef = useRef(revision);
  const currentReviewItemsRef = useRef(reviewItems);
  const localeEpochRef = useRef(0);
  const hydratedLocaleRef = useRef<string | null>(null);
  const skipNextDraftPersistRef = useRef(false);

  currentDocumentRef.current = document;
  currentRevisionRef.current = revision;
  currentReviewItemsRef.current = reviewItems;

  const normalizedSelection = useMemo(() => normalizeBlockSelection(document, selection), [document, selection]);
  const spellcheckDictionarySet = useMemo(() => createSpellcheckDictionarySet(spellcheckDictionaryWords, locale), [locale, spellcheckDictionaryWords]);
  const globalReplaceMatchCount = useMemo(
    () => countTextOccurrencesInDocument(document, globalReplaceSearch),
    [document, globalReplaceSearch]
  );
  const localActionRoute = useMemo<LocalActionRouteResponse>(
    () =>
      inferLocalActionRoute({
        locale,
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
    [customPrompt, localActionMode, localTextIntent, locale, manualCalloutDepth, manualCalloutKind, manualCalloutPrompt, manualVisualIntent, manualVisualPrompt, visualStylePreset]
  );
  const localModeSuggestion = useMemo<{ mode: SuggestedLocalActionMode; label: string } | null>(() => {
    if (localActionMode !== "edit" && localActionMode !== "auto") {
      return null;
    }

    const suggestedMode = inferSuggestedLocalActionMode(customPrompt, locale);

    if (!suggestedMode) {
      return null;
    }

    return {
      mode: suggestedMode,
      label: suggestedMode === "spellcheck" ? editorCopy.localModes.spellcheck : suggestedMode === "callout" ? editorCopy.localModes.callout : editorCopy.localModes.visual
    };
  }, [customPrompt, localActionMode, locale, editorCopy]);
  const stepItems = useMemo(() => mapReviewItemsByStep(reviewItems), [reviewItems]);
  const expertiseForDisplay = useMemo(() => {
    if (!reviewExpertise) {
      return null;
    }

    const drawer = getEditorMessages(locale).reviewDrawer;
    return linkifyExpertiseParagraphRefs(localizeExpertiseMarkdown(reviewExpertise, locale, drawer), locale);
  }, [locale, reviewExpertise]);
  const canRunDownstreamStep = Boolean(reviewExpertise?.trim()) && !isReviewRequestInFlight;
  const workflowSteps = useMemo(
    () =>
      baseWorkflowSteps.map((step) => ({
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
    [baseWorkflowSteps, factCheckRows.length, reviewExpertise, spellcheckResults.length, spellcheckSummary, stepItems]
  );

  useEffect(() => {
    const isLocaleSwitch = hydratedLocaleRef.current !== null && hydratedLocaleRef.current !== locale;

    if (isLocaleSwitch) {
      localeEpochRef.current += 1;
    }

    activeLocaleRef.current = locale;
    setSettings(readEditorSettings(locale));
    const lastVisualStyle = normalizeVisualStylePreset(window.localStorage.getItem(getVisualStylePresetStorageKey(locale)), defaultVisualStylePreset);
    setVisualStylePreset(lastVisualStyle);
    const lastImageQuality = normalizeVisualImageQuality(
      window.localStorage.getItem(getVisualImageQualityStorageKey(locale)),
      defaultVisualImageQuality
    );
    setImageQuality(lastImageQuality);
    const draft = readEditorDraftState(locale);

    if (!hasHydratedDraft && draft) {
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
      setDiagnosticsMode(normalizeDiagnosticsMode(draft.diagnosticsMode, "concise"));
      setFeedback(
        draft.feedback && isReviewRunProgressFeedback(draft.feedback.message, editorCopy.reviewFeedback)
          ? null
          : draft.feedback
      );
      setHistory(draft.history);
      setCompareHistory(draft.compareHistory ?? []);
      setActiveReviewItemId(draft.activeReviewItemId);
      setActiveProposal(draft.activeProposal);
      setReviewComposer(draft.reviewComposer ?? defaultReviewComposer);
      setActiveReviewRun(draft.activeReviewRun ?? null);
      setFailedReviewChunks(draft.activeReviewRun?.run.progress?.failedChunks ?? []);
      setFocusedBlockId(draft.selection.focusBlockId ?? draft.document.blocks[0]?.id ?? null);
    }

    if (isLocaleSwitch) {
      skipNextDraftPersistRef.current = true;
      activeReviewJobRunRef.current = null;
      setActiveReviewRun(draft?.activeReviewRun ?? null);
      setFailedReviewChunks([]);
      setOperations([]);
      setReviewItems([]);
      setRejectedReviewIdeas([]);
      setPatchDiagnostics(null);
      setReviewDiagnostics(null);
      setReviewExpertise(null);
      setFactCheckRows([]);
      setActiveWorkflowStep("diagnostics");
      setStepRunHistory(createEmptyStepRunHistory());
      setStepFeedback(createDefaultStepFeedbackMap());
      setStepRunModeByStep(createDefaultStepRunModeMap("replace"));
      setDiagnosticsMode("concise");
      setFeedback(null);
      setHistory([]);
      setMutationHistoryPast([]);
      setMutationHistoryFuture([]);
      setCompareHistory([]);
      setActiveCompareEntryId(null);
      setExpandedCompareEntryId(null);
      setActiveReviewItemId(null);
      setActiveProposal(null);
      setReviewRefineInstruction("");
      clearSpellcheckResults();
      setIsReviewRequestInFlight(false);
      setIsPatchRequestInFlight(false);
      setIsSpellcheckRequestInFlight(false);
      setIsReviewImageRequestInFlight(false);
    }

    hydratedLocaleRef.current = locale;
    setHasHydratedDraft(true);
  }, [locale]);

  useEffect(() => {
    return () => {
      activeReviewJobRunRef.current = null;
      if (reviewLeaseRetryTimeoutRef.current) {
        window.clearTimeout(reviewLeaseRetryTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function handleSettingsUpdated(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setSettings(detail ?? readEditorSettings(locale));
    }

    window.addEventListener(EDITOR_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
    window.addEventListener("storage", handleSettingsUpdated);

    return () => {
      window.removeEventListener(EDITOR_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
      window.removeEventListener("storage", handleSettingsUpdated);
    };
  }, [locale]);

  useEffect(() => {
    function handleActiveReviewRunStorage(event: StorageEvent) {
      if (event.key !== getEditorDraftStorageKey(locale)) {
        return;
      }

      if (activeReviewJobRunRef.current) {
        return;
      }

      const nextDraft = readEditorDraftState(locale);
      const nextRun = nextDraft?.activeReviewRun ?? null;
      setActiveReviewRun(nextRun);
      setIsReviewRequestInFlight(Boolean(nextRun && !nextRun.stale && !isRunTerminal(nextRun.run)));

      if (!nextRun && nextDraft?.revision.documentRevisionId === currentRevisionRef.current.documentRevisionId) {
        setReviewItems(nextDraft.reviewItems);
        setReviewDiagnostics(nextDraft.reviewDiagnostics);
        setReviewExpertise(nextDraft.reviewExpertise);
        setFactCheckRows(nextDraft.factCheckRows);
        setStepRunHistory(nextDraft.stepRunHistory);
        setHistory(nextDraft.history);
        setFeedback(nextDraft.feedback);
        setDiagnosticsMode(normalizeDiagnosticsMode(nextDraft.diagnosticsMode, "concise"));
      }
    }

    window.addEventListener("storage", handleActiveReviewRunStorage);
    return () => window.removeEventListener("storage", handleActiveReviewRunStorage);
  }, [locale]);

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
    setFeedback({ tone: "info", message: fb.undone(entry.label) });
  }

  function redoLastMutation() {
    const entry = mutationHistoryFuture.at(-1);

    if (!entry) {
      return;
    }

    applySnapshot(entry.after);
    setMutationHistoryFuture((current) => current.slice(0, -1));
    setMutationHistoryPast((current) => [...current.slice(Math.max(0, current.length - 49)), entry]);
    setFeedback({ tone: "info", message: fb.redone(entry.label) });
  }

  function handleManualDocumentChange(nextDocument: EditorDocument) {
    const changedBlockIds = deriveChangedBlockIds(document, nextDocument);

    commitDocument(nextDocument, {
      history: {
        kind: "manual_edit",
        label: hl.manualEdit,
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
    const dictionary = createSpellcheckDictionarySet(dictionaryWords, locale);

    if (dictionary.size === 0) {
      return results;
    }

    return results.map((result) => ({
      ...result,
      issues: filterSpellcheckIssuesByDictionary(result.issues, dictionary, locale)
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
        ? fb.spellcheckIssuesFound(meta.issueCount, results.filter((result) => result.issues.length > 0).length)
        : fb.spellcheckNoIssues(meta.checkedBlockCount);
    const secondaryParts: string[] = [];

    if (meta.skippedCount > 0) {
      secondaryParts.push(fb.skippedBlocks(meta.skippedCount));
    }

    if (meta.errorCount > 0) {
      secondaryParts.push(fb.requestErrors(meta.errorCount));
    }

    if (invalidatedCount > 0) {
      secondaryParts.push(fb.changedParasRecheck(invalidatedCount));
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
      summary: fb.checkedParagraphsChanged,
      secondarySummary: fb.changedParasRecheck(invalidatedCount),
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
      window.localStorage.setItem(getVisualStylePresetStorageKey(locale), preset);
    }
  }

  function persistImageQuality(quality: VisualImageQuality) {
    const normalized = normalizeVisualImageQuality(quality, defaultVisualImageQuality);
    setImageQuality(normalized);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(getVisualImageQualityStorageKey(locale), normalized);
    }
  }

  function isCurrentLocaleRequest(expectedLocale: typeof locale, expectedEpoch: number): boolean {
    return activeLocaleRef.current === expectedLocale && localeEpochRef.current === expectedEpoch;
  }

  useEffect(() => {
    if (!hasHydratedDraft) {
      return;
    }

    if (skipNextDraftPersistRef.current) {
      skipNextDraftPersistRef.current = false;
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
      diagnosticsMode,
      history,
      appliedDiffs: [],
      compareHistory,
      feedback,
      activeReviewItemId,
      activeProposal,
      reviewImageAssets: {},
      activeReviewRun,
      reviewComposer
    }, locale);
  }, [
    activeProposal,
    activeReviewRun,
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
    stepRunModeByStep,
    diagnosticsMode,
    locale
  ]);

  useEffect(() => {
    const pending = pendingReviewRunCleanupRef.current;

    if (
      !pending ||
      activeReviewRun?.run.runId !== pending.runId ||
      !isRunTerminal(activeReviewRun.run) ||
      !stepRunHistory[pending.stepId].some((entry) => entry.id === pending.stepRunId)
    ) {
      return;
    }

    pendingReviewRunCleanupRef.current = null;
    setActiveReviewRun(null);
    writeEditorActiveReviewRun(null, locale);
  }, [activeReviewRun, locale, stepRunHistory]);

  useEffect(() => {
    if (
      !hasHydratedDraft ||
      !activeReviewRun ||
      activeReviewRun.stale ||
      consumedReviewRunIdsRef.current.has(activeReviewRun.run.runId) ||
      activeReviewJobRunRef.current
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void resumePersistedReviewRun(activeReviewRun);
    }, isRunTerminal(activeReviewRun.run) ? 0 : 500);

    return () => window.clearTimeout(timer);
  }, [
    activeReviewRun,
    hasHydratedDraft,
    locale,
    reviewLeaseRetryNonce,
    revision.documentRevisionId
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

    void readSpellcheckDictionaryWords(locale)
      .then((words) => {
        if (!cancelled) {
          setSpellcheckDictionaryWords(Array.from(createSpellcheckDictionarySet(words, locale)));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [locale]);

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
      setFeedback({ tone: "error", message: fb.enterReplaceText });
      return;
    }

    const result = replaceTextInDocument(document, searchText, globalReplaceReplacement);

    if (result.replacementCount === 0) {
      setFeedback({ tone: "info", message: fb.noMatches });
      return;
    }

    commitDocument(result.document, {
      history: {
        kind: "manual_edit",
        label: editorCopy.globalReplace.label,
        blockIds: result.changedBlockIds
      }
    });
    focusAndHighlightChangedBlocks(result.changedBlockIds);
    setFeedback({
      tone: "info",
      message: fb.globalReplaceDone(result.replacementCount, result.changedBlockIds.length)
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
      imageQuality,
      stepFeedback,
      stepRunModeByStep,
      diagnosticsMode,
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
    setImageQuality(normalizeVisualImageQuality(snapshot.imageQuality, defaultVisualImageQuality));
    setStepFeedback(snapshot.stepFeedback);
    setStepRunModeByStep(snapshot.stepRunModeByStep);
    setDiagnosticsMode(normalizeDiagnosticsMode(snapshot.diagnosticsMode, "concise"));
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
    setDiagnosticsMode("concise");
    setStepRunHistory(createEmptyStepRunHistory());
    setActiveWorkflowStep("diagnostics");
    setRecentlyChangedBlockIds([]);
    setDismissUndoState(null);
    setPendingDestructiveAction(null);
    reviewNoOpStreakRef.current = {};
    patchNoOpStreakRef.current = {};
    clearSpellcheckResults();
    activeReviewJobRunRef.current = null;
    setActiveReviewRun(null);
    writeEditorActiveReviewRun(null, locale);
    setIsReviewRequestInFlight(false);
    setFailedReviewChunks([]);
    fragmentRetryInFlightRef.current = false;
    pendingFragmentRetryRef.current = null;
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
        label: hl.manualEditCompare,
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
    const requestLocale = locale;
    const requestLocaleEpoch = localeEpochRef.current;

    if (targetBlockIds.length === 0) {
      setFeedback({ tone: "error", message: fb.selectBlocksLocalEdit });
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
        basePrompt: settings.basePrompt,
        locale
      };

      const response = await fetch("/api/edit/patch", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = (await response.json()) as PatchResponse;

      if (!isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        return false;
      }

      let nextFeedback = buildPatchFeedbackMessage(payload, response.ok, locale);
      const noOpAssessment = assessPatchNoOp(payload.operations);
      const patchStreakKey = `${mode}:${targetBlockIds.join("|")}`;

      if (response.ok && !payload.error && noOpAssessment.isNoOp) {
        const nextStreak = (patchNoOpStreakRef.current[patchStreakKey] ?? 0) + 1;
        patchNoOpStreakRef.current[patchStreakKey] = nextStreak;
        nextFeedback = {
          tone: "info",
          message:
            nextStreak >= 2
              ? fb.localEditNoOpRepeat
              : fb.localEditNoOp
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
        createHistoryEntry(mode, payload.providerUsed, settings.provider, settings.modelId, payload.operations.length, payload.diagnostics.droppedOperationCount, payload.usedFallback, nextFeedback, historyTimeFormatter)
      );
      return response.ok && !payload.error && payload.operations.length > 0;
    } catch (error) {
      if (!isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        return false;
      }

      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : fb.localEditFailed
      });
      return false;
    } finally {
      if (isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        setIsPatchRequestInFlight(false);
      }
    }
  }

  async function requestSpellcheck(targetBlockIds = document.blocks.map((block) => block.id)): Promise<boolean> {
    const requestLocale = locale;
    const requestLocaleEpoch = localeEpochRef.current;

    if (targetBlockIds.length === 0) {
      setFeedback({ tone: "error", message: fb.selectParagraphsSpellcheck });
      return false;
    }

    const spellcheckTargets = getSpellcheckableBlocks(document, revision, targetBlockIds);
    const skippedCount = targetBlockIds.length - spellcheckTargets.length;

    if (spellcheckTargets.length === 0) {
      setFeedback({ tone: "error", message: fb.spellcheckTextBlocksOnly });
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
            locale,
            documentRevisionId: revision.documentRevisionId,
            language: localeConfig.spellcheckLanguage,
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

      if (!isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        return false;
      }

      const filteredRunResults = filterSpellcheckResultsWithDictionary(runResults);
      const mergedResults = mergeSpellcheckBlockResults(spellcheckResults, filteredRunResults);
      const issueCount = countSpellcheckIssues(filteredRunResults);
      const errorCount = filteredRunResults.filter((result) => Boolean(result.error)).length;
      const summary = buildSpellcheckSummaryMeta(mergedResults, skippedCount);
      setActiveWorkflowStep("spellcheck");
      updateSpellcheckSummary(mergedResults, summary, 0);
      const nextSummary =
        issueCount > 0
          ? fb.spellcheckIssuesFound(issueCount, filteredRunResults.filter((result) => result.issues.length > 0).length)
          : fb.spellcheckNoIssues(filteredRunResults.length);
      setFeedback({
        tone: errorCount > 0 ? "error" : "info",
        message: nextSummary
      });
      pushHistoryEntry(
        createHistoryEntry(
          "spellcheck",
          "languagetool_public",
          "languagetool_public",
          localeConfig.spellcheckLanguage,
          issueCount,
          skippedCount,
          false,
          {
            tone: errorCount > 0 ? "error" : "info",
            message: nextSummary
          },
          historyTimeFormatter
        )
      );
      return true;
    } catch (error) {
      if (!isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        return false;
      }

      clearSpellcheckResults();
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : fb.spellcheckFailed
      });
      return false;
    } finally {
      if (isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        setIsSpellcheckRequestInFlight(false);
      }
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
        label: hl.spellingFix,
        blockIds: [input.blockId],
        compare:
          previousChangedBlock && nextChangedBlock
            ? {
                kind: "spellcheck_apply",
                label: hl.spellingFix,
                blockIds: [input.blockId],
                beforeBlocks: [previousChangedBlock],
                afterBlocks: [nextChangedBlock]
              }
            : null
      }
    });
    updateSpellcheckSummary(filteredSpellcheckResults, summaryMeta, 0);
    setFeedback({ tone: "info", message: input.suggestion.length === 0 ? fb.fragmentRemoved : fb.spellingFixed });
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
    setFeedback({ tone: "info", message: fb.leftUnchanged });
  }

  async function addSpellcheckWordToDictionary(input: { blockId: string; issueId: string; word: string }) {
    const blockResult = spellcheckResults.find((entry) => entry.blockId === input.blockId);
    const issue = blockResult?.issues.find((entry) => entry.id === input.issueId);
    const word = (issue?.badText ?? input.word).trim();

    if (!word) {
      return;
    }

    const requestLocale = locale;
    const requestLocaleEpoch = localeEpochRef.current;

    try {
      await addSpellcheckDictionaryWord(word, locale);
      const nextDictionaryWords = Array.from(createSpellcheckDictionarySet([...spellcheckDictionaryWords, word], locale));
      const nextSpellcheckResults = filterSpellcheckResultsWithDictionary(spellcheckResults, nextDictionaryWords);
      const summaryMeta = buildSpellcheckSummaryMeta(nextSpellcheckResults, spellcheckMeta?.skippedCount ?? 0);

      setSpellcheckDictionaryWords(nextDictionaryWords);
      updateSpellcheckSummary(nextSpellcheckResults, summaryMeta, spellcheckInvalidatedCount);
      setFeedback({ tone: "info", message: fb.wordAddedToDictionary(word) });
    } catch (error) {
      if (!isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        return false;
      }

      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : fb.dictionaryAddFailed
      });
    }
  }

  function applyEmphasisSuggestion(input: { itemId: string }) {
    const suggestion = deriveEmphasisSuggestions(reviewItems, document, revision, locale).find((entry) => entry.itemId === input.itemId);

    if (!suggestion) {
      setFeedback({ tone: "error", message: fb.emphasisStale });
      return;
    }

    const result = applyEmphasisSuggestionsToDocument(document, [suggestion]);

    if (result.changedBlockIds.length === 0) {
      setFeedback({ tone: "error", message: fb.emphasisApplyFailed });
      return;
    }

    commitDocument(result.document, {
      history: {
        kind: "ai_apply",
        label: hl.semanticEmphasis,
        blockIds: result.changedBlockIds,
        compare:
          result.beforeBlocks.length > 0 && result.afterBlocks.length > 0
            ? {
                kind: "ai_apply",
                label: editorCopy.emphasisLabel(suggestion.phrase),
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
    setFeedback({ tone: "info", message: fb.emphasisApplied });
  }

  function applyAllEmphasisSuggestions() {
    const actionableSuggestions = deriveEmphasisSuggestions(reviewItems, document, revision, locale).filter(
      (entry) => entry.status !== "applied" && entry.status !== "dismissed"
    );

    if (actionableSuggestions.length === 0) {
      setFeedback({ tone: "info", message: fb.noActiveEmphasis });
      return;
    }

    const result = applyEmphasisSuggestionsToDocument(document, actionableSuggestions);

    if (result.changedBlockIds.length === 0) {
      setFeedback({ tone: "error", message: fb.emphasisBulkFailed });
      return;
    }

    const appliedItemIds = new Set(result.appliedItemIds);

    commitDocument(result.document, {
      history: {
        kind: "ai_apply",
        label: hl.acceptAllEmphasis,
        blockIds: result.changedBlockIds,
        compare:
          result.beforeBlocks.length > 0 && result.afterBlocks.length > 0
            ? {
                kind: "ai_apply",
                label: editorCopy.emphasisBulkLabel(appliedItemIds.size),
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
      message: fb.emphasisBulkApplied(appliedItemIds.size, result.changedBlockIds.length)
    });
  }

  function handleLocalActionModeChange(mode: LocalActionMode) {
    setLocalActionMode(mode);
  }

  async function requestResolvedLocalAction(): Promise<boolean> {
    const targetBlockIds = resolveTargetBlockIds();
    const requestLocale = locale;
    const requestLocaleEpoch = localeEpochRef.current;

    if (targetBlockIds.length === 0) {
      setFeedback({ tone: "error", message: fb.selectBlocksLocalAction });
      return false;
    }

    try {
      const response = await fetch("/api/edit/local-action", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
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
          message: "error" in payload && payload.error ? payload.error : fb.localActionFailed
        });
        return false;
      }

      if (payload.executor === "clarify") {
        setFeedback({ tone: "info", message: fb.clarifyLocalAction });
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
        imageQuality,
        editorialInstruction: payload.prompt
      });
    } catch (error) {
      if (!isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        return false;
      }

      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : fb.localActionRunFailed
      });
      return false;
    }
  }

  async function requestWorkflowStep(
    stepId: EditorialReviewStepId,
    options?: {
      runMode?: EditorialStepRunMode;
      revision?: ManuscriptRevisionState;
      reviewChunk?: EditorialReviewChunkScope;
      customRequestPlanAction?: NonNullable<EditorialReviewRequest["customRequestPlanAction"]>;
    }
  ) {
    const requiresDiagnosticsContext =
      stepId !== "diagnostics" && stepId !== "emphasis" && stepId !== "final_editing";

    if (requiresDiagnosticsContext && !reviewExpertise?.trim()) {
      setFeedback({ tone: "error", message: fb.runDiagnosticsFirst });
      return;
    }

    const persistedRun = readEditorDraftState(locale)?.activeReviewRun;
    const startIntent = resolveReviewRunStartIntent({
      requestedStepId: stepId,
      existingStepId: persistedRun?.run.stepId,
      existingStale: persistedRun?.stale,
      existingTerminal: persistedRun ? isRunTerminal(persistedRun.run) : true,
      thisTabOwnsPoll: Boolean(activeReviewJobRunRef.current),
      otherTabOwnsPoll: persistedRun
        ? isReviewRunPollLeasedByOther({
            runId: persistedRun.run.runId,
            ownerId: reviewPollTabIdRef.current
          })
        : false
    });

    if (startIntent === "resume" && persistedRun) {
      setActiveReviewRun(persistedRun);
      setReviewFlightStepId(persistedRun.run.stepId);
      setIsReviewRequestInFlight(true);
      setFeedback({ tone: "info", message: editorCopy.reviewFeedback.reviewRunResuming });
      void resumePersistedReviewRun(persistedRun);
      return;
    }

    if (startIntent === "block_other_step" && persistedRun) {
      setFeedback({
        tone: "error",
        message: editorCopy.reviewFeedback.reviewRunOtherStepActive(
          getWorkflowStepLabel(locale, persistedRun.run.stepId)
        )
      });
      return;
    }

    if (startIntent === "replace_zombie" && persistedRun) {
      buryActiveReviewRun(persistedRun.run.runId, locale);
    }

    if (stepId === "final_editing" && !stepFeedback.final_editing?.trim()) {
      setFeedback({ tone: "error", message: editorCopy.disabledReasons.writeCustomPrompt });
      return;
    }

    const reviewRunToken = createPatchId("review-job-run");
    activeReviewJobRunRef.current = reviewRunToken;
    setReviewFlightStepId(stepId);
    setIsReviewRequestInFlight(true);
    setFeedback(null);
    let startedRunId: string | undefined;
    let startedCapability: string | undefined;
    const runMode: EditorialStepRunMode =
      stepId === "final_editing" && !options?.customRequestPlanAction
        ? "replace"
        : options?.runMode ?? (stepRunModeByStep[stepId] ?? "replace");
    const currentStepFeedback = stepFeedback[stepId]?.trim();
    const diagnosticsFeedback = stepFeedback.diagnostics?.trim();
    const historyMessages: ChatMessage[] = [];

    if (diagnosticsFeedback && stepId !== "emphasis") {
      historyMessages.push({
        id: createPatchId("chat"),
        role: "user",
        content: editorCopy.diagnosticsContentPrefix(diagnosticsFeedback),
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
      const reviewDocument = document;
      const reviewRevision = options?.revision ?? compactReviewRevision;
      if (runMode === "replace") {
        setFailedReviewChunks([]);
      }
      const isEmphasisStep = stepId === "emphasis";
      const diagnosticsPrompt = settings.expertisePrompt.trim() || settings.reviewPrompt.trim() || undefined;
      const downstreamPrompt = settings.cardsPrompt.trim() || settings.reviewPrompt.trim() || undefined;
      const requestBody: EditorialReviewRequest = isEmphasisStep
        ? {
            document: reviewDocument,
            revision: reviewRevision,
            provider: settings.provider,
            modelId: settings.modelId,
            locale,
            async: true,
            basePrompt: settings.basePrompt,
            cardsPrompt: settings.cardsPrompt.trim() || settings.reviewPrompt.trim() || undefined,
            workflowStepPrompts: settings.workflowStepPrompts,
            changeLevel: reviewComposer.changeLevel,
            additionalInstructions: reviewComposer.additionalInstructions,
            stepId,
            runMode,
            stepFeedback: currentStepFeedback || undefined,
            rejectedIdeas: rejectedReviewIdeas,
            reviewChunk: options?.reviewChunk,
            customRequestPlanAction: options?.customRequestPlanAction
          }
        : {
            document: reviewDocument,
            revision: reviewRevision,
            provider: settings.provider,
            modelId: settings.modelId,
            locale,
            async: true,
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
                ? {
                  diagnosticsMode
                }
                : {
                  diagnosticsExpertise: reviewExpertise ?? undefined,
                  diagnosticsFeedback: diagnosticsFeedback || undefined,
                  currentStepFeedback: currentStepFeedback || undefined
                },
            expertise: stepId === "diagnostics" ? undefined : reviewExpertise ?? undefined,
            rejectedIdeas: rejectedReviewIdeas,
            reviewChunk: options?.reviewChunk,
            customRequestPlanAction: options?.customRequestPlanAction
          };

      const startOutcome = await withReviewRunStartLock(locale, async () => {
        const existing = readEditorDraftState(locale)?.activeReviewRun;

        if (existing && !existing.stale && !isRunTerminal(existing.run)) {
          if (existing.run.stepId === stepId) {
            return { kind: "existing" as const, record: existing };
          }

          buryActiveReviewRun(existing.run.runId, locale);
        }

        const response = await fetch("/api/edit/review", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });
        const startText = await response.text();
        const parsedStart = interpretReviewRunPollBody(startText, {
          invalid: editorCopy.reviewFeedback.reviewJobInvalid,
          platformTimeout: editorCopy.reviewFeedback.reviewJobPlatformTimeout
        });
        if (!parsedStart.ok) {
          throw new Error(parsedStart.message);
        }
        const candidate: unknown = parsedStart.payload;

        if (!isEditorialReviewRunApiResponse(candidate)) {
          throw new Error(editorCopy.reviewFeedback.reviewJobInvalid);
        }

        if (candidate.kind === "error") {
          throw new Error(candidate.error.message);
        }

        startedRunId = candidate.run.runId;
        if (candidate.kind === "run") {
          startedCapability = candidate.capability;
          if (runMode === "replace") {
            if (stepId === "final_editing") {
              customRequestPlanActionsRef.current = null;
            }
            setReviewItems((current) => clearReviewItemsForReplaceRun(current, stepId));
            setActiveReviewItemId((current) => {
              const currentItem = currentReviewItemsRef.current.find((item) => item.id === current);
              return currentItem && currentItem.stepId === stepId ? null : current;
            });
            setActiveProposal((current) => {
              if (!current) {
                return null;
              }

              const proposalItem = currentReviewItemsRef.current.find((item) => item.id === current.reviewItemId);
              return proposalItem?.stepId === stepId ? null : current;
            });
          }
          updateActiveReviewRun(
            createPersistedActiveReviewRun(
              candidate.run,
              candidate.capability,
              false,
              currentDocumentRef.current.blocks.map((block) => block.id)
            ),
            locale
          );
          if (candidate.items?.length) {
            applyPartialReviewItems(candidate.items, candidate.run.stepId);
          }
        }

        return { kind: "started" as const, payload: candidate };
      });

      if (startOutcome.kind === "existing") {
        activeReviewJobRunRef.current = null;
        setActiveReviewRun(startOutcome.record);
        setReviewFlightStepId(startOutcome.record.run.stepId);
        setIsReviewRequestInFlight(true);
        setFeedback({ tone: "info", message: editorCopy.reviewFeedback.reviewRunResuming });
        void resumePersistedReviewRun(startOutcome.record);
        return;
      }

      const initialPayload = startOutcome.payload;
      startedRunId = initialPayload.run.runId;
      startedCapability = initialPayload.kind === "run" ? initialPayload.capability : undefined;

      let terminalRun = initialPayload.run;
      let payload: EditorialReviewResponse;

      if (initialPayload.kind === "result") {
        payload = initialPayload.result;
        if (runMode === "replace") {
          setReviewItems((current) => clearReviewItemsForReplaceRun(current, stepId));
        }
      } else {
        const completed = await pollEditorialReviewRun(
          initialPayload.run,
          initialPayload.capability,
          reviewRunToken,
          locale,
          (run, capability, items, planActions) => {
            const existing = readEditorDraftState(locale)?.activeReviewRun;
            updateActiveReviewRun(
              createPersistedActiveReviewRun(
                retainReviewRunProgress(run, existing?.run),
                capability,
                false,
                existing?.snapshotBlockIds
              ),
              locale
            );
            if (planActions && planActions.length > 0) {
              customRequestPlanActionsRef.current = planActions;
            }
            if (items?.length) {
              applyPartialReviewItems(items, run.stepId);
            }
          }
        );
        payload = completed.result;
        terminalRun = completed.run;
      }

      if (activeReviewJobRunRef.current !== reviewRunToken) {
        return;
      }

      if (initialPayload.kind === "run") {
        const existing = readEditorDraftState(locale)?.activeReviewRun;
        updateActiveReviewRun(
          createPersistedActiveReviewRun(terminalRun, initialPayload.capability, false, existing?.snapshotBlockIds),
          locale
        );
      }
      applyEditorialReviewResult(payload, {
        expectedStepId: stepId,
        runMode,
        sourceRevisionId: terminalRun.documentRevisionId,
        currentStepFeedback,
        requestedProvider: terminalRun.provider,
        requestedModelId: terminalRun.modelId,
        runId: terminalRun.runId
      });
    } catch (error) {
      if (!shouldAbandonReviewRunAfterPollError(error, REVIEW_JOB_SUPERSEDED_ERROR)) {
        return;
      }

      if (startedRunId) {
        abandonInFlightReviewRun({
          runId: startedRunId,
          capability: startedCapability,
          locale,
          cancelRemote: true
        });
      } else {
        clearTerminalReviewRunError(error, locale);
      }

      setFeedback({
        tone: "error",
        message: sanitizeExposedErrorMessage(
          error instanceof Error ? error.message : "",
          editorCopy.reviewFeedback.reviewRunResultInvalid
        )
      });
    } finally {
      if (activeReviewJobRunRef.current === reviewRunToken) {
        activeReviewJobRunRef.current = null;
        setReviewFlightStepId(null);
        setIsReviewRequestInFlight(false);
      }
    }
  }

  function updateActiveReviewRun(record: PersistedActiveReviewRun, expectedLocale: AppLocale) {
    if (activeLocaleRef.current !== expectedLocale) {
      return;
    }

    setActiveReviewRun(record);
    writeEditorActiveReviewRun(record, expectedLocale);

    const progress = record.run.progress;
    if (!fragmentRetryInFlightRef.current && progress?.failedChunks !== undefined) {
      setFailedReviewChunks(progress.failedChunks);
    }
  }

  async function resumePersistedReviewRun(record: PersistedActiveReviewRun) {
    if (activeReviewJobRunRef.current || consumedReviewRunIdsRef.current.has(record.run.runId)) {
      return;
    }

    if (!isRunCompatibleWithEditor({
      record,
      locale,
      liveBlockIds: currentDocumentRef.current.blocks.map((block) => block.id)
    })) {
      const staleRecord = { ...record, stale: true, updatedAt: new Date().toISOString() };
      updateActiveReviewRun(staleRecord, locale);
      consumedReviewRunIdsRef.current.add(record.run.runId);
      setIsReviewRequestInFlight(false);
      setFeedback({ tone: "error", message: editorCopy.reviewFeedback.reviewRunStale });
      return;
    }

    const ownerId = reviewPollTabIdRef.current;
    if (!tryAcquireReviewRunPollLease({ runId: record.run.runId, ownerId })) {
      setIsReviewRequestInFlight(!isRunTerminal(record.run));
      if (reviewLeaseRetryTimeoutRef.current) {
        window.clearTimeout(reviewLeaseRetryTimeoutRef.current);
      }
      reviewLeaseRetryTimeoutRef.current = window.setTimeout(() => {
        reviewLeaseRetryTimeoutRef.current = null;
        setReviewLeaseRetryNonce((current) => current + 1);
      }, 2_000);
      return;
    }

    if (reviewLeaseRetryTimeoutRef.current) {
      window.clearTimeout(reviewLeaseRetryTimeoutRef.current);
      reviewLeaseRetryTimeoutRef.current = null;
    }

    const reviewRunToken = createPatchId("review-resume");
    activeReviewJobRunRef.current = reviewRunToken;
    setReviewFlightStepId(record.run.stepId);
    setIsReviewRequestInFlight(true);
    setFeedback({ tone: "info", message: editorCopy.reviewFeedback.reviewRunResuming });

    try {
      const completed = await pollEditorialReviewRun(
        record.run,
        record.capability,
        reviewRunToken,
        locale,
        (run, capability, items, planActions) => {
          updateActiveReviewRun(
            createPersistedActiveReviewRun(
              retainReviewRunProgress(run, record.run),
              capability,
              false,
              record.snapshotBlockIds
            ),
            locale
          );
          if (planActions && planActions.length > 0) {
            customRequestPlanActionsRef.current = planActions;
          }
          if (items?.length) {
            applyPartialReviewItems(items, run.stepId);
          }
        },
        ownerId
      );
      const terminalRecord = createPersistedActiveReviewRun(completed.run, record.capability, false, record.snapshotBlockIds);
      updateActiveReviewRun(terminalRecord, locale);
      applyEditorialReviewResult(completed.result, {
        expectedStepId: record.run.stepId,
        runMode: record.run.runMode,
        sourceRevisionId: record.run.documentRevisionId,
        requestedProvider: record.run.provider,
        requestedModelId: record.run.modelId,
        runId: record.run.runId
      });
    } catch (error) {
      if (!shouldAbandonReviewRunAfterPollError(error, REVIEW_JOB_SUPERSEDED_ERROR)) {
        return;
      }

      abandonInFlightReviewRun({
        runId: record.run.runId,
        capability: record.capability,
        locale,
        cancelRemote: true
      });
      setFeedback({
        tone: "error",
        message: sanitizeExposedErrorMessage(
          error instanceof Error ? error.message : "",
          editorCopy.reviewFeedback.reviewRunResultInvalid
        )
      });
    } finally {
      releaseReviewRunPollLease(record.run.runId, ownerId);
      if (activeReviewJobRunRef.current === reviewRunToken) {
        activeReviewJobRunRef.current = null;
        setReviewFlightStepId(null);
        setIsReviewRequestInFlight(false);
      }
    }
  }

  function applyPartialReviewItems(incoming: EditorialReviewItem[], stepId: EditorialReviewStepId) {
    if (stepId === "diagnostics" || stepId === "fact_check") {
      return;
    }

    setReviewItems((current) => mergeIncomingReviewItems({
      current,
      incoming,
      document: currentDocumentRef.current,
      revision: currentRevisionRef.current,
      stepId
    }));
  }

  function retryFailedReviewChunk(failedChunk: EditorialReviewFailedChunk) {
    const stepId = activeEditorialStepId;
    if (!stepId || isReviewRequestInFlight) {
      return;
    }

    if (activeReviewRun && activeReviewRun.run.stepId !== stepId) {
      return;
    }

    const planAction = stepId === "final_editing"
      ? customRequestPlanActionsRef.current?.[failedChunk.index]
        ?? stepRunHistory.final_editing[0]?.planActions?.[failedChunk.index]
      : undefined;

    if (stepId === "final_editing") {
      if (!planAction) {
        setFeedback({ tone: "error", message: editorCopy.reviewFeedback.retryFragmentUnavailable });
        return;
      }
    } else if (!sliceDocumentForFragmentRetry(currentDocumentRef.current, failedChunk)) {
      setFeedback({ tone: "error", message: editorCopy.reviewFeedback.retryFragmentUnavailable });
      return;
    }

    const frozenRevisionId = activeReviewRun?.run.documentRevisionId;
    const progress = activeReviewRun?.run.progress;

    fragmentRetryInFlightRef.current = true;
    pendingFragmentRetryRef.current = failedChunk;
    setFailedReviewChunks((current) => current.filter((chunk) => chunk.index !== failedChunk.index));
    void requestWorkflowStep(stepId, {
      runMode: "preserve",
      revision: frozenRevisionId
        ? {
            documentRevisionId: frozenRevisionId,
            blockOrder: revision.blockOrder,
            blockFingerprints: {}
          }
        : undefined,
      ...(planAction
        ? {
            customRequestPlanAction: {
              ...planAction,
              index: failedChunk.index
            }
          }
        : {
            reviewChunk: {
              index: failedChunk.index,
              total: progress?.totalChunks ?? 1,
              coreBlockIds: failedChunk.coreBlockIds,
              contextBlockIds: []
            }
          })
    });
  }

  function applyEditorialReviewResult(
    payload: EditorialReviewResponse,
    input: {
      expectedStepId: EditorialReviewStepId;
      runMode: EditorialStepRunMode;
      sourceRevisionId: string;
      currentStepFeedback?: string;
      requestedProvider: string;
      requestedModelId: string;
      runId: string;
    }
  ) {
    if (payload.stepId !== input.expectedStepId) {
      throw new Error(editorCopy.reviewStepMismatch(input.expectedStepId, payload.stepId));
    }

    if (payload.diagnostics.failedChunks !== undefined && !fragmentRetryInFlightRef.current) {
      setFailedReviewChunks(payload.diagnostics.failedChunks);
    } else if (fragmentRetryInFlightRef.current) {
      const pending = pendingFragmentRetryRef.current;
      fragmentRetryInFlightRef.current = false;
      pendingFragmentRetryRef.current = null;
      if (payload.error && pending) {
        setFailedReviewChunks((current) => current.some((chunk) => chunk.index === pending.index)
          ? current
          : [...current, pending]);
      }
    }

    if (
      payload.runMode !== input.runMode ||
      payload.diagnostics.requestedProvider !== input.requestedProvider ||
      payload.diagnostics.requestedModelId !== input.requestedModelId ||
      payload.diagnostics.stepId !== payload.stepId ||
      payload.diagnostics.stepRunId !== payload.stepRunId ||
      payload.items.some((item) => item.documentRevisionId !== input.sourceRevisionId)
    ) {
      throw new Error(editorCopy.reviewFeedback.reviewJobInvalid);
    }

    const liveDocument = currentDocumentRef.current;
    const liveRevision = currentRevisionRef.current;
    const liveReviewItems = currentReviewItemsRef.current;
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
        document: liveDocument,
        revision: liveRevision,
        changeLevel: reviewComposer.changeLevel,
        reviewSessionId: payload.reviewSessionId,
        stepRunId: payload.stepRunId,
        locale
      });
      sectionItemCount = factCheckLinkedItems.length;

      setReviewItems((current) => {
        const existingNonFactItems = current.filter((item) => item.stepId !== "fact_check");
        const existingFactItems = current.filter((item) => item.stepId === "fact_check");
        const mergedFactItems = input.runMode === "replace" ? factCheckLinkedItems : [...factCheckLinkedItems, ...existingFactItems];
        return [...mergedFactItems, ...existingNonFactItems];
      });
    }

    if (payload.stepId !== "diagnostics" && payload.stepId !== "fact_check") {
      const nextItems = mergeIncomingReviewItems({
        current: liveReviewItems,
        incoming: payload.items.map((item) => ({ ...item, stepId: payload.stepId, stepRunId: payload.stepRunId })),
        document: liveDocument,
        revision: liveRevision,
        stepId: payload.stepId
      });
      sectionItemCount = mapReviewItemsByStep(nextItems)[payload.stepId].length;
      setReviewItems(nextItems);
    }

    const nextFeedback = buildReviewFeedbackMessage(payload, true, locale, sectionItemCount);
    const planOnlyFinalEditing =
      payload.stepId === "final_editing" &&
      (payload.plan?.actions.length ?? 0) > 0 &&
      payload.items.length === 0;
    const isRecommendationStepRun =
      !payload.error &&
      !planOnlyFinalEditing &&
      payload.stepId !== "diagnostics" &&
      payload.stepId !== "fact_check" &&
      payload.stepId !== "emphasis";

    if (isRecommendationStepRun) {
      setShowRecommendationStatusStrip(true);
    }

    const runSnapshot = {
      id: payload.stepRunId,
      stepId: payload.stepId,
      runMode: payload.runMode,
      createdAt: payload.diagnostics.generatedAt,
      documentRevisionId: liveRevision.documentRevisionId,
      feedback: input.currentStepFeedback || undefined,
      expertise: payload.stepId === "diagnostics" ? payload.expertise ?? null : undefined,
      factCheckRows: payload.stepId === "fact_check" ? payload.factCheckRows ?? [] : undefined,
      itemIds: payload.stepId === "fact_check"
        ? factCheckLinkedItems.map((item) => item.id)
        : payload.stepId !== "diagnostics"
          ? payload.items.map((item) => item.id)
          : undefined,
      planActionCount: payload.plan?.actions.length && payload.plan.actions.length > 1
        ? payload.plan.actions.length
        : payload.runMode === "preserve"
          ? (stepRunHistory[payload.stepId]?.[0]?.planActionCount ?? payload.plan?.actions.length)
          : payload.plan?.actions.length,
      planActions: payload.plan?.actions && payload.plan.actions.length > 1
        ? payload.plan.actions
        : payload.runMode === "preserve"
          ? (customRequestPlanActionsRef.current
            ?? stepRunHistory[payload.stepId]?.[0]?.planActions
            ?? payload.plan?.actions)
          : payload.plan?.actions
    };

    if (payload.plan?.actions && payload.plan.actions.length > 1) {
      customRequestPlanActionsRef.current = payload.plan.actions;
    }

    setStepRunHistory((current) => {
      const currentStepRuns = current[payload.stepId] ?? [];
      return {
        ...current,
        [payload.stepId]: payload.runMode === "replace"
          ? [runSnapshot]
          : [runSnapshot, ...currentStepRuns.filter((entry) => entry.id !== runSnapshot.id)].slice(0, 10)
      };
    });

    if (input.runMode === "replace" && payload.stepId !== "diagnostics") {
      const retainedIds = payload.stepId === "fact_check"
        ? new Set(factCheckLinkedItems.map((item) => item.id))
        : new Set(payload.items.map((item) => item.id));
      setActiveReviewItemId((current) => current && !retainedIds.has(current) ? null : current);
    }

    setReviewDiagnostics(payload.diagnostics);
    setFeedback(isRecommendationStepRun ? null : nextFeedback);
    pushHistoryEntry(createHistoryEntry(
      "review",
      payload.providerUsed,
      input.requestedProvider,
      input.requestedModelId,
      payload.stepId === "fact_check" ? factCheckLinkedItems.length : payload.items.length,
      payload.diagnostics.droppedItemCount,
      payload.usedFallback,
      nextFeedback,
      historyTimeFormatter
    ));
    consumedReviewRunIdsRef.current.add(input.runId);
    pendingReviewRunCleanupRef.current = {
      runId: input.runId,
      stepId: payload.stepId,
      stepRunId: payload.stepRunId
    };

    if (payload.stepId === "diagnostics" && !payload.error) {
      closeComposer();
    }
  }

  function buryActiveReviewRun(runId: string, expectedLocale: AppLocale) {
    consumedReviewRunIdsRef.current.add(runId);
    if (activeLocaleRef.current !== expectedLocale) {
      return;
    }

    setActiveReviewRun((current) => (current?.run.runId === runId ? null : current));
    const persisted = readEditorDraftState(expectedLocale)?.activeReviewRun;
    if (!persisted || persisted.run.runId === runId) {
      writeEditorActiveReviewRun(null, expectedLocale);
    }
    setFailedReviewChunks((current) => (persisted?.run.runId === runId || !persisted ? [] : current));
  }

  function cancelRemoteReviewRun(runId: string, capability?: string) {
    if (!capability) {
      return;
    }

    void fetch(`/api/edit/review?runId=${encodeURIComponent(runId)}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: {
        "x-review-run-capability": capability
      }
    }).catch(() => undefined);
  }

  function abandonInFlightReviewRun(input: {
    runId: string;
    capability?: string;
    locale: AppLocale;
    cancelRemote: boolean;
  }) {
    buryActiveReviewRun(input.runId, input.locale);
    releaseReviewRunPollLease(input.runId, reviewPollTabIdRef.current);
    if (input.cancelRemote) {
      cancelRemoteReviewRun(input.runId, input.capability);
    }
  }

  function stopActiveReviewRun() {
    const record = activeReviewRun ?? readEditorDraftState(locale)?.activeReviewRun;
    reviewPollAbortRef.current?.abort();
    activeReviewJobRunRef.current = null;
    setReviewFlightStepId(null);
    setIsReviewRequestInFlight(false);
    if (record?.run.runId) {
      abandonInFlightReviewRun({
        runId: record.run.runId,
        capability: record.capability,
        locale,
        cancelRemote: true
      });
    }
    setFeedback({ tone: "info", message: editorCopy.reviewFeedback.reviewRunStopped });
  }

  function clearTerminalReviewRunError(error: unknown, expectedLocale: AppLocale) {
    if (error instanceof Error && error.message === REVIEW_JOB_SUPERSEDED_ERROR) {
      return;
    }

    if (!(error instanceof EditorialReviewRunTerminalError) || !error.run || !isRunTerminal(error.run)) {
      return;
    }

    buryActiveReviewRun(error.run.runId, expectedLocale);
  }

  async function pollEditorialReviewRun(
    initialRun: Extract<EditorialReviewRunApiResponse, { kind: "run" }>["run"],
    initialCapability: string,
    reviewRunToken: string,
    expectedLocale = locale,
    onSnapshot?: (
      run: Extract<EditorialReviewRunApiResponse, { kind: "run" }>["run"],
      capability: string,
      items?: EditorialReviewItem[],
      planActions?: CustomRequestPlanAction[]
    ) => void,
    pollOwnerId = reviewPollTabIdRef.current
  ): Promise<{ result: EditorialReviewResponse; run: Extract<EditorialReviewRunApiResponse, { kind: "result" }>["run"] }> {
    let currentRun = initialRun;
    let capability = initialCapability;

    while (true) {
      if (activeReviewJobRunRef.current !== reviewRunToken) {
        throw new Error(REVIEW_JOB_SUPERSEDED_ERROR);
      }

      if (currentRun.locale !== expectedLocale) {
        throw new Error(editorCopy.reviewFeedback.reviewJobWrongLocale);
      }

      if (!tryAcquireReviewRunPollLease({ runId: currentRun.runId, ownerId: pollOwnerId })) {
        throw new Error(REVIEW_JOB_SUPERSEDED_ERROR);
      }

      const pollAfterMs = resolveReviewPollWaitMs(
        currentRun.pollAfterMs,
        getDocumentTextStats(currentDocumentRef.current).charactersWithSpaces
      );
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, pollAfterMs);
      });

      if (activeReviewJobRunRef.current !== reviewRunToken) {
        throw new Error(REVIEW_JOB_SUPERSEDED_ERROR);
      }

      const controller = new AbortController();
      reviewPollAbortRef.current = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), REVIEW_POLL_FETCH_TIMEOUT_MS);
      let payload: unknown;
      let response: Response;

      try {
        response = await fetch(
          `/api/edit/review?runId=${encodeURIComponent(currentRun.runId)}&locale=${encodeURIComponent(expectedLocale)}`,
          {
            method: "GET",
            credentials: "same-origin",
            signal: controller.signal,
            headers: {
              "Cache-Control": "no-store",
              "x-review-run-capability": capability
            }
          }
        );
        const responseText = await response.text();
        if (activeReviewJobRunRef.current !== reviewRunToken) {
          throw new Error(REVIEW_JOB_SUPERSEDED_ERROR);
        }

        const parsed = interpretReviewRunPollBody(responseText, {
          invalid: editorCopy.reviewFeedback.reviewJobInvalid,
          platformTimeout: editorCopy.reviewFeedback.reviewJobPlatformTimeout
        });
        if (!parsed.ok) {
          throw new Error(parsed.message);
        }
        payload = parsed.payload;
      } catch (error) {
        if (activeReviewJobRunRef.current !== reviewRunToken) {
          throw new Error(REVIEW_JOB_SUPERSEDED_ERROR);
        }
        if (error instanceof Error && error.message === REVIEW_JOB_SUPERSEDED_ERROR) {
          throw error;
        }
        if ((error instanceof DOMException || error instanceof Error) && error.name === "AbortError") {
          throw new Error(editorCopy.reviewFeedback.reviewJobPollTimeout);
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
        if (reviewPollAbortRef.current === controller) {
          reviewPollAbortRef.current = null;
        }
      }

      if (!isEditorialReviewRunApiResponse(payload)) {
        throw new Error(editorCopy.reviewFeedback.reviewJobInvalid);
      }

      if (payload.kind === "error") {
        if (payload.items?.length && payload.run) {
          onSnapshot?.(payload.run, capability, payload.items, payload.plan?.actions);
        } else if (payload.run) {
          onSnapshot?.(payload.run, capability, undefined, payload.plan?.actions);
        }
        throw new EditorialReviewRunTerminalError(payload.error.message, payload.run);
      }

      if (payload.run.locale !== expectedLocale) {
        throw new Error(editorCopy.reviewFeedback.reviewJobWrongLocale);
      }

      if (payload.kind === "result") {
        onSnapshot?.(payload.run, capability, undefined, payload.result.plan?.actions);
        return { result: payload.result, run: payload.run };
      }

      if (!response.ok) {
        throw new Error(editorCopy.reviewFeedback.reviewJobReadFailed);
      }

      currentRun = payload.run;
      capability = payload.capability;
      onSnapshot?.(currentRun, capability, payload.items, payload.plan?.actions);
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
    const scrollBlockId =
      item.recommendationType === "subsection"
        ? item.insertionPoint.anchorBlockId || nextSelection.anchorBlockId
        : nextSelection.focusBlockId ?? nextSelection.anchorBlockId;
    setFocusedBlockId(scrollBlockId);
    setActiveReviewItemId(item.id);

    if (scrollBlockId) {
      window.requestAnimationFrame(() => {
        const element = window.document.querySelector<HTMLElement>(`[data-block-id="${scrollBlockId}"]`);
        element?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }

    if (item.stepId === "emphasis") {
      return;
    }

    const openSubsectionPreview = (draft: NonNullable<EditorialReviewItem["subsectionDraft"]>) => {
      if (activeProposal?.reviewItemId === item.id && activeProposal.kind === "subsection_prompt") {
        return;
      }

      setActiveProposal({
        id: item.activeProposalId ?? createPatchId("proposal-subsection"),
        reviewItemId: item.id,
        sourceRevisionId: item.documentRevisionId,
        targetRevisionId: revision.documentRevisionId,
        kind: "subsection_prompt",
        summary: item.reason,
        canApplyDirectly: true,
        subsectionDraft: {
          title: draft.title,
          headingLevel: draft.headingLevel ?? item.headingLevel ?? 3,
          lead: "",
          prompt: draft.prompt
        }
      });
      setReviewItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                headingLevel: draft.headingLevel ?? entry.headingLevel ?? 3,
                subsectionDraft: {
                  title: draft.title,
                  headingLevel: draft.headingLevel ?? entry.headingLevel ?? 3,
                  lead: "",
                  prompt: draft.prompt
                },
                status: entry.status === "pending" || entry.status === "preparing" ? "ready" : entry.status
              }
            : entry
        )
      );
    };

    if (item.recommendationType === "subsection" && item.subsectionDraft?.title?.trim()) {
      openSubsectionPreview(item.subsectionDraft);
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

  function focusStructureOutlineExisting(blockId: string) {
    setShowRecommendationStatusStrip(false);
    setSelection(EMPTY_BLOCK_SELECTION);
    setFocusedBlockId(blockId);
    setActiveReviewItemId(null);
    if (activeProposal?.kind === "subsection_prompt") {
      setActiveProposal(null);
    }
    window.requestAnimationFrame(() => {
      const element = window.document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function focusStructureOutlineProposed(reviewItemId: string) {
    const item = reviewItems.find((entry) => entry.id === reviewItemId);
    if (!item) {
      return;
    }
    focusReviewItem(item);
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
      imageQuality?: VisualImageQuality;
      editorialInstruction?: string;
    }
  ): Promise<boolean> {
    const blockIds = resolveTargetBlockIds();

    if (blockIds.length === 0) {
      setFeedback({ tone: "error", message: fb.selectParagraphsManual });
      return false;
    }

    resetActiveExecutionLane();
    setActiveWorkflowStep(getWorkflowStepForManualKind(kind));

    const recommendationType =
      kind === "callout" ? "callout" : kind === "visual" ? "visual" : kind === "subsection" ? "subsection" : "list";
    if (kind === "visual") {
      persistVisualStylePreset(overrides?.visualStylePreset ?? visualStylePreset);
      persistImageQuality(overrides?.imageQuality ?? imageQuality);
    }
    const draftItem = buildManualReviewItem({
      document,
      revision,
      blockIds,
      changeLevel: reviewComposer.changeLevel,
      recommendationType,
      stepId: getWorkflowStepForManualKind(kind),
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
        imageQuality: overrides?.imageQuality,
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
          label: hl.aiEdit,
          blockIds: activeProposal.textDiff.blockIds,
          compare: {
            kind: "ai_apply",
            label: activeProposal.summary || activeProposal.textDiff.reason || hl.aiEdit,
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
      setFeedback({ tone: "info", message: fb.editApplied });
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
    editorialInstruction?: string,
    requestImageQuality: VisualImageQuality = imageQuality
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
      locale
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
        visualStylePreset: requestVisualStylePreset,
        imageQuality: requestImageQuality
      };
    }

    return baseRequest;
  }

  async function prepareReviewItem(
    item: EditorialReviewItem,
    options?: { visualStylePreset?: VisualStylePreset; imageQuality?: VisualImageQuality; editorialInstruction?: string }
  ): Promise<boolean> {
    const requestLocale = locale;
    const requestLocaleEpoch = localeEpochRef.current;

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
      setFeedback({ tone: "error", message: fb.recommendationStale });
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
    const requestImageQuality = normalizeVisualImageQuality(
      options?.imageQuality ?? imageQuality,
      defaultVisualImageQuality
    );

    if (item.recommendationType === "visual") {
      persistVisualStylePreset(requestVisualStylePreset);
      persistImageQuality(requestImageQuality);
    }

    try {
      const factCheckInstruction = buildFactCheckActionInstruction(locale, requestItem);
      const mergedInstruction = [factCheckInstruction, options?.editorialInstruction?.trim()]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join("\n\n");
      const requestBody = buildReviewActionRequestBody(
        requestItem,
        requestVisualStylePreset,
        mergedInstruction || undefined,
        requestImageQuality
      );
      const response = await fetch("/api/edit/review/proposal", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = (await response.json()) as ReviewActionResponse;

      if (!isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        return false;
      }

      if (payload.proposal.kind === "text_diff" && payload.proposal.textDiff) {
        const proposal = maybeEscalateReviewNoOpWarning(payload.proposal, item.id, reviewNoOpStreakRef.current, locale);
        const textDiff = proposal.textDiff!;
        const paragraphLabel = getReviewParagraphRangeLabel(item, revision, locale);
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
                headingLevel: payload.proposal.subsectionDraft!.headingLevel,
                subsectionDraft: {
                  title: payload.proposal.subsectionDraft!.title,
                  headingLevel: payload.proposal.subsectionDraft!.headingLevel,
                  lead: "",
                  prompt: payload.proposal.subsectionDraft!.prompt
                },
                status: "ready",
                activeProposalId: payload.proposal.id
              }
              : entry
          )
        );
        setReviewRefineInstruction("");
        setFeedback({ tone: "info", message: fb.subheadingPrepared });
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
        setFeedback({ tone: "info", message: fb.calloutPrepared });
        return true;
      }

      if (payload.proposal.kind === "image_prompt" && payload.proposal.imageDraft) {
        persistVisualStylePreset(
          normalizeVisualStylePreset(payload.proposal.imageDraft.visualStylePreset, requestVisualStylePreset)
        );
        persistImageQuality(
          normalizeVisualImageQuality(payload.proposal.imageDraft.imageQuality, requestImageQuality)
        );
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, status: "ready", activeProposalId: payload.proposal.id } : entry
          )
        );
        setReviewRefineInstruction("");
        setFeedback({ tone: "info", message: fb.visualPromptPrepared });
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
        message: error instanceof Error ? error.message : fb.recommendationPrepareFailed
      });
      return false;
    } finally {
      if (isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        setPreparingReviewItemId(null);
      }
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
      title: parseBoldMarkdownToInlineNodes(item.calloutDraft.title || getEditorialCalloutKindTitle(item.calloutDraft.calloutKind, locale)),
      body: splitCalloutDraftIntoParagraphs(item.calloutDraft.previewText, item.calloutDraft.calloutKind)
    };

    commitDocument(insertBlocksAfter(document, item.insertionPoint.anchorBlockId, [block]), {
      history: {
        kind: "insert_block",
        label: hl.insertCallout,
        blockIds: [block.id]
      }
    });
    focusAndHighlightChangedBlocks([block.id]);
    setReviewItems((current) =>
      current.map((entry) => (entry.id === item.id ? { ...entry, status: "applied", activeProposalId: undefined } : entry))
    );
    setActiveProposal((current) => (current?.reviewItemId === item.id ? null : current));
    setActiveReviewItemId((current) => (current === item.id ? null : current));
    setFeedback({ tone: "info", message: fb.calloutInserted });
  }

  function applyReviewSubsection(item: EditorialReviewItem) {
    if (!item.subsectionDraft) {
      return;
    }

    const title = item.subsectionDraft.title.trim();

    if (!title) {
      return;
    }

    const blocks: Block[] = [
      {
        id: createBlockId("heading"),
        type: "heading",
        level: item.subsectionDraft.headingLevel ?? item.headingLevel ?? 3,
        content: parseBoldMarkdownToInlineNodes(title)
      }
    ];

    commitDocument(insertBlocksBefore(document, item.insertionPoint.anchorBlockId, blocks), {
      history: {
        kind: "insert_block",
        label: hl.insertSubheading,
        blockIds: blocks.map((entry) => entry.id)
      }
    });
    focusAndHighlightChangedBlocks(blocks.map((entry) => entry.id));
    setReviewItems((current) =>
      current.map((entry) => (entry.id === item.id ? { ...entry, status: "applied", activeProposalId: undefined } : entry))
    );
    setActiveProposal((current) => (current?.reviewItemId === item.id ? null : current));
    setActiveReviewItemId((current) => (current === item.id ? null : current));
    setFeedback({ tone: "info", message: fb.subheadingInserted });
  }

  function updateActiveCalloutKind(item: EditorialReviewItem, kind: EditorialCalloutKind) {
    setReviewItems((current) =>
      current.map((entry) => {
        if (entry.id !== item.id) {
          return entry;
        }

        const fallbackTitle = getEditorialCalloutKindTitle(kind, locale);
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

      const fallbackTitle = getEditorialCalloutKindTitle(kind, locale);
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
            title: entry.calloutDraft?.title ?? getEditorialCalloutKindTitle(kind, locale),
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
            title: entry.calloutDraft?.title ?? getEditorialCalloutKindTitle(kind, locale),
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

        const headingLevel = entry.subsectionDraft?.headingLevel ?? entry.headingLevel ?? 3;

        return {
          ...entry,
          headingLevel,
          subsectionDraft: {
            title,
            headingLevel,
            lead: "",
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

  function updateActiveImageQuality(quality: VisualImageQuality) {
    const normalizedQuality = normalizeVisualImageQuality(quality, defaultVisualImageQuality);
    persistImageQuality(normalizedQuality);
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
          imageQuality: normalizedQuality,
          targetModel: resolveReviewImageTargetModel(normalizedQuality),
          generatedAsset: undefined
        }
      };
    });
  }

  async function generateActiveReviewImage() {
    if (!activeProposal || activeProposal.kind !== "image_prompt" || !activeProposal.imageDraft) {
      return;
    }
    const requestLocale = locale;
    const requestLocaleEpoch = localeEpochRef.current;
    const requestImageQuality = normalizeVisualImageQuality(
      activeProposal.imageDraft.imageQuality ?? imageQuality,
      defaultVisualImageQuality
    );

    persistVisualStylePreset(
      normalizeVisualStylePreset(activeProposal.imageDraft.visualStylePreset ?? visualStylePreset, defaultVisualStylePreset)
    );
    persistImageQuality(requestImageQuality);
    setIsReviewImageRequestInFlight(true);

    try {
      const response = await fetch("/api/edit/review/image", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          prompt: activeProposal.imageDraft.prompt,
          imageQuality: requestImageQuality
        })
      });
      const payload = (await response.json()) as { asset?: GeneratedReviewImageAsset; error?: string };

      if (!isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        return;
      }

      if (!response.ok || !payload.asset) {
        setFeedback({ tone: response.ok ? "info" : "error", message: payload.error || fb.visualGenerateFailed });
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
      setFeedback({ tone: "info", message: fb.visualGenerated });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : fb.visualGenerateFailed
      });
    } finally {
      if (isCurrentLocaleRequest(requestLocale, requestLocaleEpoch)) {
        setIsReviewImageRequestInFlight(false);
      }
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
        label: hl.insertVisual,
        blockIds: [block.id]
      }
    });
    focusAndHighlightChangedBlocks([block.id]);
    setReviewItems((current) =>
      current.map((entry) => (entry.id === proposal.reviewItemId ? { ...entry, status: "applied", activeProposalId: undefined } : entry))
    );
    setActiveProposal(null);
    setActiveReviewItemId(null);
    setFeedback({ tone: "info", message: fb.visualInserted });
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
        label: hl.insertImage,
        blockIds: [block.id]
      }
    });
  }

  async function handleExportDocx() {
    setActiveTopActionMenu(null);
    setIsDocxExportInFlight(true);

    try {
      const result = await exportDocumentToDocx({ document, locale });
      const url = URL.createObjectURL(result.blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setFeedback({
        tone: "info",
        message:
          result.warnings.length > 0
            ? editorCopy.exportImport.docxExportedWarnings(result.warnings.length)
            : editorCopy.exportImport.docxExported
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : fb.docxExportFailed
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
      anchor.download = buildDocxFileName(deriveDocxFileNameBase(document, locale), locale).replace(/\.docx$/i, ".txt");
      anchor.click();
      URL.revokeObjectURL(url);
      setFeedback({ tone: "info", message: editorCopy.exportImport.txtExported });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : fb.txtExportFailed
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
      replaceEditorSession(imported.document, buildImportFeedback(imported.format, imported.warnings, locale));
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : editorCopy.exportImport.clipboardReadFailed
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
      replaceEditorSession(imported.document, buildImportFeedback(imported.format, imported.warnings, locale));
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : editorCopy.exportImport.importFailed
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
      title: editorCopy.destructive.clearTitle,
      description: editorCopy.destructive.clearDescription,
      confirmLabel: editorCopy.destructive.clearConfirm
    });
  }

  function confirmDestructiveAction() {
    if (!pendingDestructiveAction) {
      return;
    }

    const snapshot = captureEditorSessionSnapshot();

    clearEditorDraftState(locale);
    replaceEditorSession(createBlankDocument(), { tone: "info", message: editorCopy.destructive.cleared });
    setDestructiveRecoveryState({
      kind: "clear_document",
      message: editorCopy.destructive.cleared,
      snapshot
    });
  }

  function undoDestructiveAction() {
    if (!destructiveRecoveryState) {
      return;
    }

    restoreEditorSessionSnapshot(destructiveRecoveryState.snapshot);
    setFeedback({ tone: "info", message: editorCopy.destructive.restored });
  }

  const canRequestReview = document.blocks.length > 0;
  const activeStepMeta = workflowSteps.find((step) => step.id === activeWorkflowStep) ?? workflowSteps[0];
  const ActiveStepIcon = activeStepMeta.icon;
  const activeStepSummary = workflowStepSummaries[activeWorkflowStep];
  const activeEditorialStepId = isEditorialReviewStepId(activeWorkflowStep) ? activeWorkflowStep : null;
  const activeStepFeedbackValue = activeEditorialStepId ? stepFeedback[activeEditorialStepId].trim() : "";
  const activeStepIndex = Math.max(
    1,
    workflowSteps.findIndex((step) => step.id === activeWorkflowStep) + 1
  );
  const activeStepItems = activeEditorialStepId ? stepItems[activeEditorialStepId] : [];
  const visibleActiveStepItems = activeStepItems.filter(
    (item) => showCompletedCards || (item.status !== "applied" && item.status !== "dismissed")
  );
  const structureOutlineModel = useMemo(
    () =>
      buildStructureOutlineTree({
        document,
        items: activeWorkflowStep === "structure" ? activeStepItems : [],
        showCompleted: showCompletedCards,
        untitledLabel: st.untitled,
        emptyRootLabel: st.sectionOutline
      }),
    [activeStepItems, activeWorkflowStep, document, showCompletedCards, st.sectionOutline, st.untitled]
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
    () => deriveEmphasisSuggestions(reviewItems, document, revision, locale),
    [document, locale, reviewItems, revision]
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
  const isCurrentStepReviewRunning = isActiveStepReviewRunning({
    viewingStepId: activeWorkflowStep,
    runStepId: activeReviewRun?.run.stepId,
    startingStepId: reviewFlightStepId,
    inFlight: isReviewRequestInFlight
  });
  const spellcheckProblemParagraphCount = useMemo(
    () => spellcheckResults.filter((result) => result.issues.length > 0).length,
    [spellcheckResults]
  );
  const emphasisStatusTone = isCurrentStepReviewRunning && activeWorkflowStep === "emphasis"
    ? "active"
    : emphasisStepItems.length === 0
      ? "idle"
      : emphasisStepItems.some((item) => item.status !== "applied" && item.status !== "dismissed")
        ? "warning"
        : "success";
  const emphasisStatusLabel = isCurrentStepReviewRunning && activeWorkflowStep === "emphasis"
    ? editorCopy.status.inProgress
    : emphasisStepItems.length === 0
      ? editorCopy.status.notRun
      : emphasisStepItems.some((item) => item.status !== "applied" && item.status !== "dismissed")
        ? editorCopy.status.emphasisPending
        : editorCopy.status.complete;
  const spellcheckStatusTone = isSpellcheckRequestInFlight
    ? "active"
    : !hasSpellcheckRun
      ? "idle"
      : (spellcheckMeta?.issueCount ?? 0) > 0 || spellcheckInvalidatedCount > 0
        ? "warning"
        : "success";
  const spellcheckStatusLabel = isSpellcheckRequestInFlight
    ? editorCopy.status.inProgress
    : !hasSpellcheckRun
      ? editorCopy.status.notRun
      : spellcheckInvalidatedCount > 0
        ? editorCopy.status.recheckNeeded
        : (spellcheckMeta?.issueCount ?? 0) > 0
          ? editorCopy.status.issuesFound
          : editorCopy.status.clean;
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
  const visibleFailedReviewChunks =
    activeReviewRun?.run.stepId === activeWorkflowStep ? failedReviewChunks : [];
  const showChunkProgressChrome = shouldShowReviewRunChrome({
    viewingStepId: activeWorkflowStep,
    runStepId: activeReviewRun?.run.stepId,
    startingStepId: reviewFlightStepId,
    inFlight: isCurrentStepReviewRunning,
    failedChunkCount: visibleFailedReviewChunks.length
  });
  const hasGlobalReviewInstructions = Boolean(reviewComposer.additionalInstructions.trim());
  const shouldSuppressRecommendationFeedback =
    feedback?.tone === "info"
    && (
      isReviewRunProgressFeedback(feedback.message, editorCopy.reviewFeedback)
      || (isRecommendationStep && (showRecommendationStatusStrip || isReviewRequestInFlight))
      || showChunkProgressChrome
    );
  const feedbackPresentation = presentRequestFeedback(
    shouldSuppressRecommendationFeedback ? null : feedback,
    locale
  );
  const globalContextHelpText = editorCopy.globalContextHelp;
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
            ? canRequestReview && Boolean(activeStepFeedbackValue)
            : canRunDownstreamStep;
  const activeStepRunDisabledReason = getActiveStepRunDisabledReason({
    stepId: activeWorkflowStep,
    canRun: activeStepCanRun,
    canRequestReview,
    canRunSpellcheck,
    reviewExpertise,
    stepFeedback: activeStepFeedbackValue,
    isReviewRequestInFlight,
    otherStepRunLabel:
      isReviewRequestInFlight &&
      activeReviewRun &&
      activeReviewRun.run.stepId !== activeWorkflowStep
        ? getWorkflowStepLabel(locale, activeReviewRun.run.stepId)
        : undefined,
    isSpellcheckRequestInFlight,
    disabledReasons: editorCopy.disabledReasons
  });
  const activeStepHasPrerequisite =
    activeWorkflowStep === "diagnostics" ||
    activeWorkflowStep === "spellcheck" ||
    activeWorkflowStep === "emphasis" ||
    activeWorkflowStep === "final_editing"
      ? true
      : Boolean(reviewExpertise);
  const activeStepHasSettings = activeWorkflowStep !== "spellcheck" && activeWorkflowStep !== "final_editing";
  const shouldShowFinalPromptInput = activeWorkflowStep === "final_editing";
  const activeStepPrimaryAction = getStepPrimaryAction(activeWorkflowStep, { hasExistingResult: activeStepHasExistingResult }, locale);
  const activeStepRunButtonLabel = activeStepHasExistingResult ? editorCopy.status.rerun : editorCopy.status.run;
  const activeStepRunButtonLoadingLabel = activeStepHasExistingResult ? editorCopy.status.rerunning : editorCopy.status.running;
  const activeStepWorkspaceStatus =
    activeWorkflowStep === "diagnostics"
      ? getStepWorkspaceStatus("diagnostics", {
          canRun: canRequestReview,
          isInFlight: isCurrentStepReviewRunning,
          hasExistingResult: Boolean(reviewExpertise),
          activeMessage: editorCopy.stepWorkspace.diagnostics.active,
          idleMessage: editorCopy.stepWorkspace.diagnostics.idle,
          waitingMessage: editorCopy.stepWorkspace.diagnostics.waiting,
          successMessage: editorCopy.stepWorkspace.diagnostics.success
        }, locale)
      : activeWorkflowStep === "fact_check"
        ? getStepWorkspaceStatus("fact_check", {
            canRun: canRunDownstreamStep,
            hasPrerequisite: Boolean(reviewExpertise),
            isInFlight: isCurrentStepReviewRunning,
            hasExistingResult: activeStepRunCount > 0 || factCheckRows.length > 0,
            zeroResult: activeStepRunCount > 0 && factCheckRows.length === 0 && activeStepItems.length === 0,
            activeMessage: editorCopy.stepWorkspace.factCheck.active,
            idleMessage: editorCopy.stepWorkspace.factCheck.idle,
            waitingMessage: editorCopy.stepWorkspace.factCheck.waiting,
            successMessage: editorCopy.stepWorkspace.factCheck.success,
            zeroResultMessage: editorCopy.stepWorkspace.factCheck.zeroResult
          }, locale)
      : activeWorkflowStep === "spellcheck"
          ? getStepWorkspaceStatus("spellcheck", {
              canRun: canRunSpellcheck,
              isInFlight: isSpellcheckRequestInFlight,
              hasExistingResult: hasSpellcheckRun,
              zeroResult: hasSpellcheckRun && (spellcheckMeta?.issueCount ?? 0) === 0 && spellcheckInvalidatedCount === 0,
              activeMessage: editorCopy.stepWorkspace.spellcheck.active,
              idleMessage: editorCopy.stepWorkspace.spellcheck.idle,
              successMessage:
                spellcheckSummary ??
                editorCopy.stepWorkspace.spellcheck.successReady,
              zeroResultMessage: editorCopy.stepWorkspace.spellcheck.successNoIssues
            }, locale)
          : activeWorkflowStep === "emphasis"
            ? getStepWorkspaceStatus("emphasis", {
                canRun: canRequestReview,
                hasPrerequisite: true,
                isInFlight: isCurrentStepReviewRunning,
                hasExistingResult: activeStepRunCount > 0 || activeStepItems.length > 0,
                zeroResult: activeStepRunCount > 0 && activeStepItems.length === 0,
                activeMessage: editorCopy.stepWorkspace.emphasis.active,
                idleMessage: editorCopy.stepWorkspace.emphasis.idle,
                waitingMessage: editorCopy.stepWorkspace.emphasis.waiting,
                successMessage: editorCopy.stepWorkspace.emphasis.success,
                zeroResultMessage: editorCopy.stepWorkspace.emphasis.zeroResult
              }, locale)
          : activeWorkflowStep === "final_editing"
            ? getStepWorkspaceStatus("final_editing", {
                canRun: activeStepCanRun,
                hasPrerequisite: true,
                isInFlight: isCurrentStepReviewRunning,
                hasExistingResult: activeStepRunCount > 0 || activeStepItems.length > 0,
                zeroResult:
                  activeStepRunCount > 0 &&
                  activeStepItems.length === 0 &&
                  (stepRunHistory.final_editing[0]?.planActionCount ?? 0) === 0,
                activeMessage: editorCopy.stepWorkspace.finalEditing.active,
                idleMessage: editorCopy.stepWorkspace.finalEditing.idle,
                waitingMessage: editorCopy.stepWorkspace.finalEditing.waiting,
                successMessage:
                  activeStepItems.length === 0 && (stepRunHistory.final_editing[0]?.planActionCount ?? 0) > 0
                    ? editorCopy.stepWorkspace.finalEditing.planReady
                    : editorCopy.stepWorkspace.finalEditing.success,
                zeroResultMessage: editorCopy.stepWorkspace.finalEditing.zeroResult
              }, locale)
          : getStepWorkspaceStatus(activeWorkflowStep, {
              canRun: canRunDownstreamStep,
              hasPrerequisite: Boolean(reviewExpertise),
              isInFlight: isCurrentStepReviewRunning,
              hasExistingResult: activeStepRunCount > 0 || activeStepItems.length > 0,
              zeroResult: activeStepRunCount > 0 && activeStepItems.length === 0,
              activeMessage: editorCopy.stepWorkspace.recommendations.active,
              idleMessage: editorCopy.stepWorkspace.recommendations.idle,
              waitingMessage: editorCopy.stepWorkspace.recommendations.waiting,
              successMessage: editorCopy.stepWorkspace.recommendations.success,
              zeroResultMessage: editorCopy.stepWorkspace.recommendations.zeroResult
            }, locale);
  const shouldShowPrototypeStatusStrip =
    activeWorkflowStep !== "spellcheck" &&
    activeWorkflowStep !== "diagnostics" &&
    (
      activeWorkflowStep === "fact_check"
      || showRecommendationStatusStrip
    );
  const prototypeStatusMessage =
    isRecommendationStep
      ? editorCopy.reviewFeedback.recommendationsReady
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
            <label htmlFor="prototype-diagnostics-run-mode">{editorCopy.stepSettings.updateMode}</label>
            <select
              id="prototype-diagnostics-run-mode"
              className="step-review-prototype-input"
              value={stepRunModeByStep.diagnostics}
              onChange={(event) => updateStepRunMode("diagnostics", event.target.value as EditorialStepRunMode)}
            >
              <option value="replace">{editorCopy.stepSettings.replacePrevious}</option>
              <option value="preserve">{editorCopy.stepSettings.keepSeparate}</option>
            </select>
          </div>
          <div className="step-review-prototype-settings-field">
            <label htmlFor="prototype-diagnostics-focus">{editorCopy.stepSettings.contextNextRun}</label>
            <textarea
              id="prototype-diagnostics-focus"
              className="step-review-prototype-input"
              rows={3}
              placeholder={editorCopy.stepPlaceholders.diagnosticsFocus}
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
            <label htmlFor="prototype-factcheck-run-mode">{editorCopy.stepSettings.updateMode}</label>
            <select
              id="prototype-factcheck-run-mode"
              className="step-review-prototype-input"
              value={stepRunModeByStep.fact_check}
              onChange={(event) => updateStepRunMode("fact_check", event.target.value as EditorialStepRunMode)}
            >
              <option value="replace">{editorCopy.stepSettings.replacePrevious}</option>
              <option value="preserve">{editorCopy.stepSettings.keepSeparate}</option>
            </select>
          </div>
          <div className="step-review-prototype-settings-field">
            <label htmlFor="prototype-factcheck-focus">{editorCopy.stepSettings.focusNextRun}</label>
            <textarea
              id="prototype-factcheck-focus"
              className="step-review-prototype-input"
              rows={3}
              placeholder={editorCopy.stepPlaceholders.factCheckFocus}
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
          <label htmlFor="prototype-step-run-mode">{editorCopy.stepSettings.updateMode}</label>
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
            <option value="replace">{editorCopy.stepSettings.replacePrevious}</option>
            <option value="preserve">{editorCopy.stepSettings.keepSeparate}</option>
          </select>
        </div>
        <div className="step-review-prototype-settings-field">
          <label htmlFor="prototype-step-focus">{editorCopy.stepSettings.focusNextRun}</label>
          <textarea
            id="prototype-step-focus"
            className="step-review-prototype-input"
            rows={3}
            placeholder={
              activeWorkflowStep === "emphasis"
                ? editorCopy.stepPlaceholders.emphasisFocus
                : activeWorkflowStep === "final_editing"
                  ? editorCopy.stepPlaceholders.customPromptFocus
                  : editorCopy.stepPlaceholders.structureFocus
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

  function renderFinalPromptInput() {
    if (!shouldShowFinalPromptInput) {
      return null;
    }

    return (
      <section className="step-review-prototype-final-prompt" aria-label={editorCopy.stepSettings.customPrompt}>
        <div className="step-review-prototype-settings-field">
          <label htmlFor="prototype-final-prompt">{editorCopy.stepSettings.customPrompt}</label>
          <textarea
            id="prototype-final-prompt"
            className="step-review-prototype-input"
            rows={4}
            placeholder={editorCopy.stepPlaceholders.customPromptFocus}
            value={stepFeedback.final_editing}
            onChange={(event) => updateStepFeedbackValue("final_editing", event.target.value)}
            disabled={isCurrentStepReviewRunning}
          />
        </div>
      </section>
    );
  }

  function renderPrototypeStepContent() {
    if (activeWorkflowStep === "diagnostics") {
      return (
        <div className="step-review-prototype-content step-review-prototype-content-diagnostics">
          {reviewExpertise ? (
            <div className="button-row">
              <Button variant="secondary" size="sm" onClick={() => selectWorkflowStep("fact_check")}>
                {fc.goToFactCheck}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={editorCopy.factCheck.resetHelp}
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
                {fc.reset}
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
                {fc.runDiagnosticsHint}
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
                  <th>{fc.claim}</th>
                  <th>{fc.status}</th>
                  <th>{fc.explanation}</th>
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
                          <span className="step-review-fact-source-empty">{fc.noReliableSource}</span>
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
                  <span>{cs.active(activeStepCardStats.actionable)}</span>
                  <span>{cs.accepted(activeStepCardStats.applied)}</span>
                  <span>{cs.dismissed(activeStepCardStats.dismissed)}</span>
                </div>
                <button
                  type="button"
                  className="step-review-prototype-utility-toggle"
                  onClick={() => setShowCompletedCards((current) => !current)}
                >
                  {showCompletedCards ? editorCopy.cards.hideCompleted : editorCopy.cards.showCompleted}
                </button>
              </div>
              <section className="step-review-prototype-suggestions-list" aria-label={editorCopy.factCheck.factCheckCards}>
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
              {fc.factCheckCardsEmpty}
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
                <span>{ss.issues(spellcheckMeta?.issueCount ?? 0)}</span>
                <span>{ss.parasWithErrors(spellcheckProblemParagraphCount)}</span>
                <span>{ss.changedAfterCheck(spellcheckInvalidatedCount)}</span>
              </div>
              <button
                type="button"
                className="step-review-prototype-utility-toggle"
                onClick={clearSpellcheckResults}
                disabled={isSpellcheckRequestInFlight || (!spellcheckSummary && spellcheckResults.length === 0)}
              >
                {sc.clear}
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
                    aria-label={ss.spellingParagraph(result.paragraphLabel)}
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
                        <h3 className="step-review-prototype-spellcheck-card-title">{getSpellcheckIssueHeadline(result, locale)}</h3>
                        <div className="step-review-prototype-spellcheck-card-meta">
                          <span className="step-review-prototype-spellcheck-card-paragraph-label">{ss.paragraph(result.paragraphLabel)}</span>
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
                        aria-label={isExpanded ? editorCopy.spellcheckUi.collapseDetails : editorCopy.spellcheckUi.showDetails}
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
                                {shouldShowSpellcheckMessage(issue.message, locale) ? (
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
                                      {sc.delete}
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
                                    {sc.addToDictionary}
                                  </button>
                                  <button
                                    type="button"
                                    className="err-compact-action-button err-compact-action-button-primary step-review-prototype-spellcheck-action-primary"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      dismissSpellcheckIssue({ blockId: result.blockId, issueId: issue.id });
                                    }}
                                  >
                                    {sc.leaveAsIs}
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
            <p className="step-review-empty-copy">{editorCopy.stepWorkspace.spellcheck.successNoIssues}</p>
          ) : !isSpellcheckRequestInFlight ? (
            <p className="step-review-empty-copy">{editorCopy.stepWorkspace.spellcheck.idle}</p>
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
                <span>{showCompletedCards ? es.count(emphasisStepItems.length) : es.remaining(visibleEmphasisStepItems.length)}</span>
              </div>
              <div className="step-review-prototype-utility-actions">
                {actionableEmphasisSuggestionCount > 0 ? (
                  <button
                    type="button"
                    className="step-review-prototype-utility-toggle"
                    onClick={applyAllEmphasisSuggestions}
                  >
                    {sc.acceptAll}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="step-review-prototype-utility-toggle"
                  onClick={() => setShowCompletedCards((current) => !current)}
                >
                  {showCompletedCards ? editorCopy.cards.hideCompleted : editorCopy.cards.showCompleted}
                </button>
              </div>
            </div>
          ) : null}

          {visibleEmphasisStepItems.length > 0 ? (
            <section className="step-review-prototype-suggestions-list" aria-label={editorCopy.spellcheckUi.emphasisList}>
              {visibleEmphasisStepItems.map((item) => {
                const suggestion = emphasisSuggestionByItemId.get(item.id);
                const phrase = getEmphasisCardPhrase(item, suggestion?.phrase);
                const rangeLabel = suggestion?.paragraphLabel
                  ? ss.paragraph(suggestion.paragraphLabel)
                  : getReviewParagraphRangeLabel(item, revision, locale);

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
          ) : activeStepRunCount > 0 && !isCurrentStepReviewRunning ? (
            <p className="step-review-empty-copy">{sc.noEmphasis}</p>
          ) : !isCurrentStepReviewRunning ? (
            <p className="step-review-empty-copy">{sc.runEmphasisHint}</p>
          ) : null}
        </div>
      );
    }

    if (activeWorkflowStep === "structure") {
      const structureEmptyCopy =
        structureOutlineModel.proposedCount === 0 && activeStepCardStats.actionable === 0
          && (activeStepCardStats.applied > 0 || activeStepCardStats.dismissed > 0)
          ? editorCopy.structureOutline.allStructureCardsDone
          : structureOutlineModel.nodes.length === 0
            ? st.noSubheadings
            : structureOutlineModel.proposedCount === 0
              ? st.noStructureActions
              : null;

      return (
        <div className="step-review-prototype-content step-review-prototype-content-structure">
          <div className="step-review-prototype-meta-line step-review-prototype-meta-line-inline">
            <div className="step-review-prototype-utility-meta">
              <span>{cs.active(activeStepCardStats.actionable)}</span>
              <span>{cs.accepted(activeStepCardStats.applied)}</span>
              <span>{cs.dismissed(activeStepCardStats.dismissed)}</span>
            </div>
            <button
              type="button"
              className="step-review-prototype-utility-toggle"
              onClick={() => setShowCompletedCards((current) => !current)}
            >
              {showCompletedCards ? editorCopy.cards.hideCompleted : editorCopy.cards.showCompleted}
            </button>
          </div>

          <section className="step-review-structure-outline" aria-label={st.sectionOutline}>
            <div className="step-review-structure-outline-head step-review-structure-section-head-stack">
              <div>
                <h3>{st.sectionOutline}</h3>
                <p className="step-review-structure-section-copy">{workflowStepSummaries.structure}</p>
              </div>
            </div>
            <StructureOutlineTree
              model={structureOutlineModel}
              activeReviewItemId={activeReviewItemId}
              preparingReviewItemId={preparingReviewItemId}
              emptyLabel={structureEmptyCopy ?? st.noSubheadings}
              onFocusExisting={focusStructureOutlineExisting}
              onFocusProposed={focusStructureOutlineProposed}
            />
            {structureEmptyCopy && structureOutlineModel.nodes.length > 0 ? (
              <p className="step-review-empty-copy step-review-prototype-empty-copy">{structureEmptyCopy}</p>
            ) : null}
          </section>
        </div>
      );
    }

    return (
      <>
        <div className="step-review-prototype-meta-line">
          <div className="step-review-prototype-utility-meta">
            <span>{cs.active(activeStepCardStats.actionable)}</span>
            <span>{cs.accepted(activeStepCardStats.applied)}</span>
            <span>{cs.dismissed(activeStepCardStats.dismissed)}</span>
          </div>
          <button
            type="button"
            className="step-review-prototype-utility-toggle"
            onClick={() => setShowCompletedCards((current) => !current)}
          >
            {showCompletedCards ? editorCopy.cards.hideCompleted : editorCopy.cards.showCompleted}
          </button>
        </div>

        <section className="step-review-prototype-suggestions-list" aria-label={editorCopy.cards.recommendationsList}>
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
          {visibleActiveStepItems.length === 0 && !isCurrentStepReviewRunning ? (
            <p className="step-review-empty-copy step-review-prototype-empty-copy">
              {activeStepCardStats.actionable === 0 && (activeStepCardStats.applied > 0 || activeStepCardStats.dismissed > 0)
                ? editorCopy.structureOutline.allStepCardsDone
                : editorCopy.cards.noStepCards}
            </p>
          ) : null}
        </section>
      </>
    );
  }

  function renderStopReviewButton(className: string) {
    return (
      <Button
        variant="primary"
        size="sm"
        className={`${className} is-running`.trim()}
        onClick={stopActiveReviewRun}
        aria-label={editorCopy.reviewFeedback.stopReview}
        aria-busy="true"
      >
        <span className="button-content">
          <Square size={14} aria-hidden="true" />
          <span>{editorCopy.reviewFeedback.stopReview}</span>
        </span>
      </Button>
    );
  }

  const runStepButton = isCurrentStepReviewRunning && activeWorkflowStep !== "spellcheck"
    ? renderStopReviewButton(
        `step-review-head-action-button step-review-head-action-button-primary`.trim()
      )
    : (
    <Button
      variant={activeStepPrimaryAction.emphasis === "primary" ? "primary" : "secondary"}
      className={`step-review-head-action-button ${activeStepPrimaryAction.emphasis === "primary" ? "step-review-head-action-button-primary" : ""}`.trim()}
      size="sm"
      onClick={handleRunActiveStep}
      loading={activeWorkflowStep === "spellcheck" ? isSpellcheckRequestInFlight : isCurrentStepReviewRunning}
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
              <span className="editor-toast-label">{editorCopy.toast.done}</span>
              <p className="editor-toast-message">{destructiveRecoveryState.message}</p>
            </div>
            <div className="editor-toast-actions">
              <Button variant="ghost" size="sm" onClick={undoDestructiveAction}>
                {editorCopy.toast.undo}
              </Button>
              <button
                type="button"
                className="editor-toast-dismiss"
                aria-label={editorCopy.stepActions.dismissMessage}
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
                  label={editorCopy.toolbar.open}
                  icon={FolderOpen}
                  open={activeTopActionMenu === "open"}
                  busy={isImportInFlight}
                  onToggle={() => setActiveTopActionMenu((current) => (current === "open" ? null : "open"))}
                  items={[
                    { label: editorCopy.toolbar.file, icon: Upload, onClick: handleImportFileClick },
                    { label: editorCopy.toolbar.fromClipboard, icon: Clipboard, onClick: () => void handleImportFromClipboard() }
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
                  label={editorCopy.toolbar.save}
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
                    <span>{editorCopy.toolbar.clear}</span>
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
                    {editorCopy.toolbar.cancel}
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
              onFocusReviewItem={focusReviewItem}
              showAllSubsectionManuscriptPreviews={activeWorkflowStep === "structure"}
              onUpdateActiveCalloutKind={updateActiveCalloutKind}
              onUpdateActiveCalloutDepth={updateActiveCalloutDepth}
              onUpdateActiveCalloutTitle={updateActiveCalloutTitle}
              onUpdateActiveCalloutBody={updateActiveCalloutBody}
              onUpdateActiveSubsectionTitle={updateActiveSubsectionTitle}
              onUpdateActiveVisualIntent={updateActiveVisualIntent}
              onUpdateActiveImagePrompt={updateActiveImagePrompt}
              onUpdateActiveImageCaption={updateActiveImageCaption}
              onUpdateActiveVisualStylePreset={updateActiveVisualStylePreset}
              activeVisualStylePreset={visualStylePreset}
              onUpdateActiveImageQuality={updateActiveImageQuality}
              activeImageQuality={imageQuality}
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
                manualImageQuality={imageQuality}
                onManualCalloutKindChange={setManualCalloutKind}
                onManualCalloutDepthChange={setManualCalloutDepth}
                onManualVisualIntentChange={setManualVisualIntent}
                onManualVisualStylePresetChange={persistVisualStylePreset}
                onManualImageQualityChange={persistImageQuality}
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
                    const didCreate = await requestManualInsert("visual", {
                      imageQuality
                    });

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
                    {showChunkProgressChrome ? (
                      <div className="step-review-chunk-progress">
                        {activeReviewRun?.run.progress ? (
                          <>
                            <div
                              className="step-review-chunk-progress-track"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={reviewChunkProgressPercent(activeReviewRun.run.progress)}
                              aria-label={
                                activeReviewRun.run.progress.phase === "planning"
                                  ? editorCopy.reviewFeedback.reviewRunPlanningProgress
                                  : activeReviewRun.run.progress.phase === "generating"
                                    ? editorCopy.reviewFeedback.reviewRunGeneratingProgress(
                                      activeReviewRun.run.progress.completedChunks,
                                      activeReviewRun.run.progress.totalChunks
                                    )
                                  : editorCopy.reviewFeedback.reviewRunProgress(
                                activeReviewRun.run.progress.completedChunks,
                                activeReviewRun.run.progress.totalChunks
                              )
                              }
                            >
                              <div
                                className="step-review-chunk-progress-fill"
                                style={{ width: `${reviewChunkProgressPercent(activeReviewRun.run.progress)}%` }}
                              />
                            </div>
                            <p className="step-review-chunk-progress-copy">
                              {activeReviewRun.run.progress.phase === "planning"
                                ? editorCopy.reviewFeedback.reviewRunPlanningProgress
                                : activeReviewRun.run.progress.phase === "generating"
                                  ? editorCopy.reviewFeedback.reviewRunGeneratingProgress(
                                    activeReviewRun.run.progress.completedChunks,
                                    activeReviewRun.run.progress.totalChunks
                                  )
                                : editorCopy.reviewFeedback.reviewRunProgress(
                                activeReviewRun.run.progress.completedChunks,
                                activeReviewRun.run.progress.totalChunks,
                                activeReviewRun.run.progress.attempt,
                                Boolean(activeReviewRun.run.progress.retryAt)
                              )}
                            </p>
                          </>
                        ) : isCurrentStepReviewRunning ? (
                          <>
                            <div
                              className="step-review-chunk-progress-track"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={editorCopy.reviewFeedback.reviewRunProgressPending}
                            >
                              <div className="step-review-chunk-progress-fill" data-pending="true" />
                            </div>
                            <p className="step-review-chunk-progress-copy">
                              {editorCopy.reviewFeedback.reviewRunProgressPending}
                            </p>
                          </>
                        ) : null}
                        {visibleFailedReviewChunks.length > 0 ? (
                          <div className="step-review-chunk-progress-holes">
                                {visibleFailedReviewChunks.map((chunk) => (
                              <button
                                key={`${chunk.index}:${chunk.coreBlockIds.join("|")}`}
                                type="button"
                                className="step-review-chunk-progress-retry"
                                onClick={() => retryFailedReviewChunk(chunk)}
                                disabled={isReviewRequestInFlight}
                              >
                                {editorCopy.reviewFeedback.retryFragment} · {chunk.index + 1}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="step-review-prototype-head-actions">
                    {activeWorkflowStep === "diagnostics" ? (
                      <label className="step-review-prototype-diagnostics-mode" htmlFor="prototype-diagnostics-mode">
                        <span className="step-review-prototype-diagnostics-mode-label">{editorCopy.diagnosticsMode.label}</span>
                        <select
                          id="prototype-diagnostics-mode"
                          className="step-review-prototype-input step-review-prototype-diagnostics-mode-select"
                          value={diagnosticsMode}
                          title={
                            diagnosticsMode === "extended"
                              ? editorCopy.diagnosticsMode.extendedHint
                              : editorCopy.diagnosticsMode.conciseHint
                          }
                          onChange={(event) => setDiagnosticsMode(normalizeDiagnosticsMode(event.target.value, "concise"))}
                          disabled={isCurrentStepReviewRunning}
                          aria-label={editorCopy.diagnosticsMode.label}
                        >
                          <option value="concise">{editorCopy.diagnosticsMode.concise}</option>
                          <option value="extended">{editorCopy.diagnosticsMode.extended}</option>
                        </select>
                      </label>
                    ) : null}
                    {activeWorkflowStep === "emphasis" && actionableEmphasisSuggestionCount > 0 ? (
                      <Button
                        variant="primary"
                        size="sm"
                        className="step-review-prototype-accept-all-button"
                        onClick={applyAllEmphasisSuggestions}
                        aria-label={editorCopy.stepActions.acceptAllEmphasis}
                      >
                        <span className="button-content">
                          <span>{editorCopy.stepActions.acceptAllEmphasis}</span>
                        </span>
                      </Button>
                    ) : null}
                    {isCurrentStepReviewRunning && activeWorkflowStep !== "spellcheck"
                      ? renderStopReviewButton("step-review-prototype-run-button")
                      : (
                    <Button
                      variant="primary"
                      size="sm"
                      className="step-review-prototype-run-button"
                      onClick={handleRunActiveStep}
                      loading={activeWorkflowStep === "spellcheck" ? isSpellcheckRequestInFlight : isCurrentStepReviewRunning}
                      loadingLabel={activeStepRunButtonLoadingLabel}
                      disabled={!activeStepCanRun}
                      disabledReason={activeStepRunDisabledReason}
                      aria-label={activeStepHasExistingResult ? editorCopy.stepActions.rerunStep : editorCopy.stepActions.runStep}
                    >
                      <span className="button-content">
                        <span>{activeStepRunButtonLabel}</span>
                      </span>
                    </Button>
                      )}
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
                          aria-label={editorCopy.stepActions.stepSettings}
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

                  {renderFinalPromptInput()}

                  {shouldShowPrototypeStatusStrip ? (
                    <section className="step-review-prototype-status-strip" data-tone={activeStepWorkspaceStatus.tone} aria-live="polite">
                      <p>{prototypeStatusMessage}</p>
                      <span className="step-review-prototype-status-number">{prototypeStatusCount}</span>
                    </section>
                  ) : null}

                  {feedbackPresentation ? (
                    <div className="step-review-feedback" data-tone={feedbackPresentation.tone} role="status" aria-live="polite">
                      <span className="step-review-feedback-label">{feedbackPresentation.label}</span>
                      <p className="step-review-feedback-copy">{feedbackPresentation.message}</p>
                    </div>
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
                <span>{cd.dismissedMessage}</span>
                <Button size="sm" variant="ghost" onClick={undoDismissReviewItem}>
                  {cd.dismissedUndo}
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
                            aria-label={editorCopy.stepActions.clearSpellcheckAnalysis}
                            title={editorCopy.stepActions.clearSpellcheckAnalysis}
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
                          <span className="step-review-spellcheck-metric-label">{ss.issuesLabel}</span>
                        </div>
                        <div className="step-review-spellcheck-metric">
                          <span className="step-review-spellcheck-metric-value">{spellcheckProblemParagraphCount}</span>
                          <span className="step-review-spellcheck-metric-label">{ss.parasWithErrorsLabel}</span>
                        </div>
                        <div className="step-review-spellcheck-metric">
                          <span className="step-review-spellcheck-metric-value">{spellcheckInvalidatedCount}</span>
                          <span className="step-review-spellcheck-metric-label">{ss.changedAfterCheckLabel}</span>
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
                                  <h3 className="step-review-spellcheck-card-title">{getSpellcheckIssueHeadline(result, locale)}</h3>
                                  <p className="step-review-spellcheck-card-meta">{ss.paragraph(result.paragraphLabel)}</p>
                                </div>
                                <span className="step-review-spellcheck-badge">{result.error ? "!" : result.issues.length}</span>
                              </div>
                              <button
                                type="button"
                                className="step-review-spellcheck-focus"
                                aria-label={editorCopy.reviewCard.goToLabel(ss.paragraph(result.paragraphLabel))}
                                title={editorCopy.reviewCard.goToLabel(ss.paragraph(result.paragraphLabel))}
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
                                    {shouldShowSpellcheckMessage(issue.message, locale) ? (
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
                                            {sc.delete}
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
                                          {sc.delete}
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
                        <p className="step-review-empty-copy">{editorCopy.stepWorkspace.spellcheck.successNoIssues}</p>
                      </div>
                    ) : !isSpellcheckRequestInFlight ? (
                      <div className="step-review-empty-state step-review-spellcheck-empty">
                        <p className="step-review-empty-copy">{editorCopy.stepWorkspace.spellcheck.idle}</p>
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
                          <p className="step-review-cards-counter" aria-label={editorCopy.stepActions.emphasisCounter}>
                            {showCompletedCards
                              ? es.count(emphasisStepItems.length)
                              : es.remaining(visibleEmphasisStepItems.length)}
                          </p>
                          <div className="step-review-prototype-utility-actions">
                            {actionableEmphasisSuggestionCount > 0 ? (
                              <button
                                type="button"
                                className="step-review-completed-toggle"
                                data-active="true"
                                onClick={applyAllEmphasisSuggestions}
                              >
                                {sc.acceptAll}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="step-review-completed-toggle"
                              data-active={showCompletedCards ? "true" : "false"}
                              onClick={() => setShowCompletedCards((current) => !current)}
                            >
                              {showCompletedCards ? editorCopy.cards.hideCompleted : editorCopy.cards.showCompleted}
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
                            ? ss.paragraph(suggestion.paragraphLabel)
                            : getReviewParagraphRangeLabel(item, revision, locale);

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
                    ) : activeStepRunCount > 0 && !isCurrentStepReviewRunning ? (
                      <div className="step-review-empty-state step-review-spellcheck-empty">
                        <p className="step-review-empty-copy">{sc.noEmphasis}</p>
                      </div>
                    ) : !isCurrentStepReviewRunning ? (
                      <div className="step-review-empty-state step-review-spellcheck-empty">
                        <p className="step-review-empty-copy">{sc.runEmphasisHint}</p>
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
          <section className="global-replace-dialog" role="dialog" aria-modal="true" aria-label={editorCopy.globalReplace.title}>
            <header className="global-replace-head">
              <div className="global-replace-head-copy">
                <p className="global-replace-kicker mono-ui">Ctrl/Cmd+H</p>
                <h3 className="global-replace-title">{editorCopy.globalReplace.title}</h3>
              </div>
              <button
                type="button"
                className="draft-reset-dialog-close"
                onClick={closeGlobalReplace}
                aria-label={editorCopy.globalReplace.close}
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
                <span className="mono-ui global-replace-label">{editorCopy.globalReplace.find}</span>
                <input
                  ref={globalReplaceSearchInputRef}
                  className="global-replace-input"
                  value={globalReplaceSearch}
                  onChange={(event) => setGlobalReplaceSearch(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="global-replace-field">
                <span className="mono-ui global-replace-label">{editorCopy.globalReplace.replaceWith}</span>
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
                  <span>{editorCopy.globalReplace.matchCount(globalReplaceMatchCount)}</span>
                </p>
                <div className="global-replace-actions">
                  <Button type="button" variant="ghost" size="sm" onClick={closeGlobalReplace}>
                    {editorCopy.toolbar.cancel}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!globalReplaceSearch || globalReplaceMatchCount === 0}
                  >
                    {editorCopy.globalReplace.replaceAll}
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
          <section className="change-compare-dialog" role="dialog" aria-modal="true" aria-label={editorCopy.compare.title}>
            <header className="change-compare-head">
              <div className="change-compare-head-copy">
                <p className="change-compare-kicker mono-ui">{editorCopy.compare.title}</p>
                <h3 className="change-compare-title">{editorCopy.compare.before} / {editorCopy.compare.after}</h3>
              </div>
              <button
                type="button"
                className="draft-reset-dialog-close"
                onClick={() => {
                  setActiveCompareEntryId(null);
                  setExpandedCompareEntryId(null);
                }}
                aria-label={editorCopy.compare.close}
              >
                <X className="draft-reset-dialog-close-icon" aria-hidden="true" />
              </button>
            </header>
            <div className="change-compare-accordion" role="list" aria-label={editorCopy.compare.historyTitle}>
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
                        <span className="mono-ui change-compare-item-kicker">{editorCopy.compare.edit}</span>
                        <span className="change-compare-item-title">{entry.label}</span>
                      </span>
                      <ChevronDown className="change-compare-item-chevron" aria-hidden="true" />
                    </button>

                    {isExpanded ? (
                      <div className="change-compare-item-body">
                        <div className="change-compare-item-summary">
                          <p className="mono-ui change-compare-item-summary-label">{editorCopy.compare.whatChanged}</p>
                          <p className="change-compare-item-summary-copy">{entry.label}</p>
                        </div>
                        <div className="change-compare-grid">
                          <section className="change-compare-panel">
                            <div className="change-compare-panel-title-row">
                              <p className="mono-ui change-compare-panel-title">{editorCopy.compare.before}</p>
                              <button
                                type="button"
                                className="change-compare-panel-anchor mono-ui"
                                onClick={() => handleCompareParagraphFocus(entry)}
                                title={editorCopy.reviewCard.goToLabel(getCompareEntryParagraphRangeLabel(entry, revision, locale))}
                                aria-label={editorCopy.reviewCard.goToLabel(getCompareEntryParagraphRangeLabel(entry, revision, locale))}
                              >
                                {getCompareEntryParagraphRangeLabel(entry, revision, locale)}
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
                              <p className="mono-ui change-compare-panel-title">{editorCopy.compare.after}</p>
                              <button
                                type="button"
                                className="change-compare-panel-anchor mono-ui"
                                onClick={() => handleCompareParagraphFocus(entry)}
                                title={editorCopy.reviewCard.goToLabel(getCompareEntryParagraphRangeLabel(entry, revision, locale))}
                                aria-label={editorCopy.reviewCard.goToLabel(getCompareEntryParagraphRangeLabel(entry, revision, locale))}
                              >
                                {getCompareEntryParagraphRangeLabel(entry, revision, locale)}
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
                                      aria-label={editorCopy.reviewCard.paragraphAfterEdit(index + 1)}
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

function getCompareEntryKindLabel(kind: EditorMutationKind, locale: import("../../lib/i18n/product-locale").AppLocale): string {
  const labels = getEditorMessages(locale).compareKinds;
  switch (kind) {
    case "manual_edit":
      return labels.manual;
    case "spellcheck_apply":
      return labels.spellcheck;
    case "ai_apply":
      return labels.ai;
    case "insert_block":
      return labels.insert;
    default:
      return labels.edit;
  }
}

function formatCompareEntryBlockCount(entry: CompareHistoryEntry): number {
  return Math.max(entry.blockIds.length, entry.beforeBlocks.length, entry.afterBlocks.length, 1);
}

function getCompareEntryParagraphRangeLabel(
  entry: CompareHistoryEntry,
  revision: ManuscriptRevisionState,
  locale: AppLocale
): string {
  const ss = getEditorMessages(locale).spellcheckStats;
  const indexes = entry.blockIds
    .map((blockId) => revision.blockOrder.indexOf(blockId))
    .filter((index) => index >= 0);

  if (indexes.length === 0) {
    return ss.unknownParagraph;
  }

  const start = formatParagraphLabel(Math.min(...indexes));
  const end = formatParagraphLabel(Math.max(...indexes));

  return ss.paragraphRange(start, end);
}

function shouldShowSpellcheckMessage(message: string, locale: AppLocale): boolean {
  const normalized = message.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  const hiddenMessages =
    locale === "en"
      ? [
          "possible spelling mistake found.",
          "possible spelling mistake.",
          "possible typo."
        ]
      : [
          "знайдено потенційну орфографічну помилку.",
          "можлива орфографічна помилка.",
          "ймовірна орфографічна помилка."
        ];

  return !hiddenMessages.includes(normalized);
}

function getSpellcheckIssueHeadline(result: SpellcheckBlockResult, locale: AppLocale): string {
  const primaryIssue = result.issues[0]?.badText.trim();

  if (primaryIssue) {
    return primaryIssue;
  }

  return getEditorMessages(locale).spellcheckStats.paragraph(result.paragraphLabel);
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
  revision: ManuscriptRevisionState,
  locale: AppLocale
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

    const rangeLabel = getReviewParagraphRangeLabel(item, revision, locale);
    const paragraphPrefix = getProductLocaleConfig(locale).paragraphShortLabel;
    suggestions.push({
      itemId: item.id,
      blockId,
      paragraphLabel: rangeLabel.startsWith(paragraphPrefix) ? rangeLabel.slice(paragraphPrefix.length).trimStart() : rangeLabel,
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
  feedback: RequestFeedback,
  timestampFormatter: Intl.DateTimeFormat
): RequestHistoryItem {
  return {
    id: createPatchId("history"),
    timestampLabel: timestampFormatter.format(new Date()),
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

function withReviewRequestId(message: string, requestId: string | null | undefined): string {
  const trimmed = message.trim();

  if (!requestId) {
    return trimmed;
  }

  return `${trimmed} (requestId: ${requestId})`;
}

function buildPatchFeedbackMessage(
  payload: PatchResponse,
  responseOk: boolean,
  locale: import("../../lib/i18n/product-locale").AppLocale
): RequestFeedback {
  const patchFeedback = getEditorMessages(locale).patchFeedback;

  if (payload.usedFallback && payload.operations.length > 0) {
    if (payload.diagnostics.appliedMode === "default") {
      return {
        tone: "info",
        message: patchFeedback.safeModeDraft
      };
    }

    return {
      tone: "info",
      message: payload.error || patchFeedback.providerInvalidDiff
    };
  }

  if (!responseOk || payload.error) {
    return {
      tone: responseOk ? "info" : "error",
      message: payload.error || patchFeedback.fetchFailed
    };
  }

  if (payload.operations.length === 0) {
    return {
      tone: "info",
      message: patchFeedback.noOperations
    };
  }

  return {
    tone: "info",
    message: patchFeedback.operationsPrepared(payload.operations.length)
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

function buildReviewFeedbackMessage(
  payload: EditorialReviewResponse,
  responseOk: boolean,
  locale: import("../../lib/i18n/product-locale").AppLocale,
  sectionItemCount?: number
): RequestFeedback {
  const reviewFeedback = getEditorMessages(locale).reviewFeedback;

  if (payload.error) {
    return {
      tone: "error",
      message: withReviewRequestId(payload.error, payload.diagnostics.requestId)
    };
  }

  if (!responseOk) {
    return {
      tone: "error",
      message: withReviewRequestId(reviewFeedback.reviewFetchFailed, payload.diagnostics.requestId)
    };
  }

  if (payload.stepId === "diagnostics") {
    return {
      tone: "info",
      message: payload.expertise?.trim() ? reviewFeedback.diagnosticsUpdated : reviewFeedback.diagnosticsDone
    };
  }

  if (payload.stepId === "fact_check") {
    const count = payload.factCheckRows?.length ?? 0;
    const linkedCardsCount = sectionItemCount ?? 0;
    return {
      tone: "info",
      message: count > 0 ? reviewFeedback.factCheckRows(count, linkedCardsCount) : reviewFeedback.factCheckClean
    };
  }

  if (payload.stepId === "emphasis") {
    const count = sectionItemCount ?? payload.items.length;

    return {
      tone: "info",
      message: count > 0 ? reviewFeedback.emphasisPrepared(count) : reviewFeedback.noEmphasisFound
    };
  }

  const planActionCount = payload.plan?.actions.length ?? 0;
  if (payload.stepId === "final_editing" && planActionCount > 0 && payload.items.length === 0) {
    return {
      tone: "info",
      message: reviewFeedback.customRequestPlanReady(planActionCount)
    };
  }

  if (payload.items.length === 0) {
    return {
      tone: "info",
      message: reviewFeedback.noStrongRecommendations
    };
  }

  const count = sectionItemCount ?? payload.items.length;
  const stepLabel = getWorkflowStepLabel(locale, payload.stepId).toLowerCase();

  return {
    tone: "info",
    message: stepLabel ? reviewFeedback.stepCardsPrepared(stepLabel, count) : reviewFeedback.cardsPrepared(count)
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

    if (item.recommendationType === "subsection") {
      groups.structure.push(item);
      continue;
    }

    if (item.recommendationType === "list" || item.recommendationType === "callout") {
      groups.formatting.push(item);
      continue;
    }

    if (item.recommendationType === "visual") {
      groups.visuals.push(item);
      continue;
    }

    if (
      item.recommendationType === "rewrite" ||
      item.recommendationType === "simplify" ||
      item.recommendationType === "expand"
    ) {
      groups.clarity.push(item);
    }
  }

  return groups;
}

function getWorkflowStepForManualKind(kind: ManualGenerationKind): EditorialReviewStepId {
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
  locale: AppLocale;
}): EditorialReviewItem[] {
  const linkedCards = getEditorMessages(input.locale).factCheck.linkedCards;
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

    const needsCallout = row.status === "unsupported" || row.sources.length === 0;
    const titlePrefix =
      row.status === "questionable" ? linkedCards.questionableTitle : linkedCards.unsupportedTitle;
    const sourceHint =
      row.sources.length > 0
        ? linkedCards.sources(row.sources.map((source) => source.domain).slice(0, 3).join(", "))
        : linkedCards.noReliableExternalSource;

    const recommendation = needsCallout ? linkedCards.calloutRecommendation : linkedCards.rewriteRecommendation;
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
      priority: row.status === "unsupported" ? "high" : "medium",
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

function itemBelongsToStep(item: EditorialReviewItem, stepId: WorkflowStepId): boolean {
  if (item.stepId) {
    return item.stepId === stepId;
  }

  if (stepId === "structure") {
    return item.recommendationType === "subsection";
  }

  if (stepId === "clarity") {
    return (
      item.recommendationType === "rewrite" ||
      item.recommendationType === "simplify" ||
      item.recommendationType === "expand"
    );
  }

  if (stepId === "interest") {
    // Without stepId, callout→formatting and expand→clarity (single-owner fallbacks).
    return false;
  }

  if (stepId === "visuals") {
    return item.recommendationType === "visual";
  }

  if (stepId === "formatting") {
    return item.recommendationType === "list" || item.recommendationType === "callout";
  }

  if (stepId === "emphasis") {
    // Without stepId, rewrite→clarity; emphasis cards always carry stepId from the emphasis run.
    return false;
  }

  if (stepId === "final_editing") {
    // Without stepId, primary owners are structure/clarity/formatting/visuals.
    return false;
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
  otherStepRunLabel?: string;
  isSpellcheckRequestInFlight: boolean;
  disabledReasons: import("../../lib/i18n/editor-messages").EditorMessages["disabledReasons"];
}): string | undefined {
  if (input.canRun) {
    return undefined;
  }

  if (input.isReviewRequestInFlight && input.otherStepRunLabel) {
    return input.disabledReasons.waitOtherStepRun(input.otherStepRunLabel);
  }

  if (input.stepId === "diagnostics" || input.stepId === "emphasis" || input.stepId === "final_editing") {
    if (input.isReviewRequestInFlight) {
      return input.disabledReasons.waitCurrentRun;
    }

    if (input.stepId === "final_editing" && !input.stepFeedback?.trim()) {
      return input.disabledReasons.writeCustomPrompt;
    }

    if (!input.canRequestReview) {
      return input.disabledReasons.addManuscriptText;
    }
  }

  if (input.stepId === "spellcheck") {
    if (input.isSpellcheckRequestInFlight) {
      return input.disabledReasons.waitSpellcheck;
    }

    if (!input.canRunSpellcheck) {
      return input.disabledReasons.addTextBlocks;
    }
  }

  if (!input.reviewExpertise?.trim()) {
    return input.disabledReasons.runDiagnosticsContext;
  }

  if (input.isReviewRequestInFlight) {
    return input.disabledReasons.waitCurrentRun;
  }

  return input.disabledReasons.temporarilyUnavailable;
}

function toFactStatusClassName(status: EditorialFactCheckRow["status"]): "ok" | "warning" | "unknown" {
  if (status === "ok") {
    return "ok";
  }

  if (status === "questionable") {
    return "warning";
  }

  return "unknown";
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

function maybeEscalateReviewNoOpWarning(
  proposal: ReviewActionProposal,
  itemId: string,
  streakState: Record<string, number>,
  locale: AppLocale
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
        message: getEditorMessages(locale).feedback.localEditNoOpRepeat
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

