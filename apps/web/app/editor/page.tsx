"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BlockEditorSurface } from "../../components/editor/BlockEditorSurface";
import { FloatingComposerPanel } from "../../components/editor/FloatingComposerPanel";
import { TopBar } from "../../components/layout/TopBar";
import { RightOperationsRail, type RequestHistoryItem } from "../../components/layout/RightOperationsRail";
import { EditorialReviewDrawer } from "../../components/layout/EditorialReviewDrawer";
import { ThreePaneShell } from "../../components/layout/ThreePaneShell";
import { Button } from "../../components/ui/Button";
import type { EditorDocument, BlockSelection, CalloutBlock, ImageBlock, Block } from "../../lib/editor/document-model";
import { createBlockId, createInlineText, EMPTY_BLOCK_SELECTION, insertBlocksAfter, normalizeBlockSelection, removeBlocksByIds, replaceBlocksByIds } from "../../lib/editor/document-model";
import { DEFAULT_EDITOR_DOCUMENT } from "../../lib/editor/default-manuscript";
import { clearEditorDraftState, readEditorDraftState, writeEditorDraftState } from "../../lib/editor/draft-state";
import { exportDocumentToDocx } from "../../lib/editor/docx-export";
import {
  deriveManuscriptRevisionState,
  resolveReviewItemSelection,
  type ManuscriptRevisionState
} from "../../lib/editor/manuscript-structure";
import { buildManualReviewItem, upsertManualReviewItem } from "../../lib/editor/manual-review-items";
import { insertBlocksBefore } from "../../lib/editor/review-apply";
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
  type EditorialCalloutKind,
  type EditorialVisualIntent,
  getEditorialCalloutKindTitle,
  reconcileReviewItemsWithRevision,
  type GeneratedReviewImageAsset,
  type ChatMessage,
  type EditorialReviewDiagnostics,
  type EditorialReviewItem,
  type EditorialReviewRequest,
  type EditorialReviewResponse,
  type ReviewActionProposal,
  type ReviewActionResponse,
  type ReviewSessionStatus,
  type WholeTextChangeLevel
} from "../../lib/editor/review-contract";
import { DEFAULT_EDITOR_SETTINGS, readEditorSettings, type EditorSettings } from "../../lib/editor/settings";
import { storeEditorAssetFromBlob, storeEditorAssetFromDataUrl } from "../../lib/editor/asset-store";

interface RequestFeedback {
  message: string;
  tone: "info" | "error";
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
const defaultManualVisualIntent: EditorialVisualIntent = "diagram";
const defaultLocalActionMode = "patch" as const;

type ComposerMode = "local" | "review" | null;
type ManualGenerationKind = "callout" | "visual";
type LocalActionMode = "patch" | "callout" | "visual";

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
  const [reviewChatHistory, setReviewChatHistory] = useState<ChatMessage[]>([]);
  const [reviewStatus, setReviewStatus] = useState<ReviewSessionStatus>("expertise");
  const [isReviewDrawerOpen, setIsReviewDrawerOpen] = useState(false);
  const [manualCalloutKind, setManualCalloutKind] = useState<EditorialCalloutKind>(defaultManualCalloutKind);
  const [manualVisualIntent, setManualVisualIntent] = useState<EditorialVisualIntent>(defaultManualVisualIntent);
  const [manualGenerationInFlight, setManualGenerationInFlight] = useState<{ kind: ManualGenerationKind; key: string } | null>(null);
  const [localActionMode, setLocalActionMode] = useState<LocalActionMode>(defaultLocalActionMode);
  const [manualCalloutPrompt, setManualCalloutPrompt] = useState("");
  const [manualVisualPrompt, setManualVisualPrompt] = useState("");
  const [recentlyChangedBlockIds, setRecentlyChangedBlockIds] = useState<string[]>([]);
  const recentChangeTimeoutRef = useRef<number | null>(null);

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
      setReviewComposer(draft.reviewComposer ?? defaultReviewComposer);
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
      reviewComposer
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
    reviewComposer,
    reviewItems,
    revision
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

  async function requestEditorialReview(overrideStatus?: ReviewSessionStatus, overrideHistory?: ChatMessage[]) {
    setIsReviewRequestInFlight(true);
    setFeedback(null);

    const targetStatus = overrideStatus ?? reviewStatus;
    const targetHistory = overrideHistory ?? reviewChatHistory;

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
        changeLevel: reviewComposer.changeLevel,
        additionalInstructions: reviewComposer.additionalInstructions,
        currentStatus: targetStatus,
        history: targetHistory
      };

      const response = await fetch("/api/edit/review", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = (await response.json()) as EditorialReviewResponse;
      const nextFeedback = buildReviewFeedbackMessage(payload, response.ok);

      if (payload.expertise) {
        setReviewExpertise(payload.expertise);
        setReviewStatus("expertise");
      }

      if (payload.items.length > 0 || targetStatus === "cards") {
        setReviewItems(payload.items);
        setReviewStatus("cards");
      }

      setReviewDiagnostics(payload.diagnostics);
      setFeedback(nextFeedback);
      pushHistoryEntry(createHistoryEntry("review", payload.providerUsed, settings.provider, settings.modelId, payload.items.length, payload.diagnostics.droppedItemCount, payload.usedFallback, nextFeedback));

      if (targetStatus === "expertise" && !payload.error) {
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

  function handleReviewChat(message: string) {
    const newUserMsg: ChatMessage = {
      id: createPatchId("chat"),
      role: "user",
      content: message,
      timestamp: new Date().toISOString()
    };
    const nextHistory = [...reviewChatHistory, newUserMsg];
    setReviewChatHistory(nextHistory);
    void requestEditorialReview("expertise", nextHistory);
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

  function handleGenerateCards(feedbackText: string) {
    let nextHistory = reviewChatHistory;
    if (feedbackText && feedbackText.trim()) {
      const newUserMsg: ChatMessage = {
        id: createPatchId("chat"),
        role: "user",
        content: feedbackText.trim(),
        timestamp: new Date().toISOString()
      };
      nextHistory = [...reviewChatHistory, newUserMsg];
      setReviewChatHistory(nextHistory);
    }
    void requestEditorialReview("cards", nextHistory);
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
    setReviewItems((current) =>
      current.map((entry) => (entry.id === activeProposal?.reviewItemId ? { ...entry, status: "pending", activeProposalId: undefined } : entry))
    );
    setActiveProposal(null);
    setActiveReviewItemId(null);
  }

  function acceptOperation(operationId: string) {
    const operation = operations.find((entry) => entry.id === operationId);

    if (!operation) {
      return;
    }

    const nextDocument = applyPatchOperation(document, operation);
    commitDocument(nextDocument);
    focusAndHighlightChangedBlocks(operation.blockIds);
    setOperations((current) => rebasePendingOperations(current, operation));
    setReviewItems((current) =>
      current.map((entry) => (entry.activeProposalId === operationId ? { ...entry, status: "applied", activeProposalId: undefined } : entry))
    );
    setFeedback({ tone: "info", message: "Правку застосовано." });
  }

  function acceptAllOperations() {
    if (operations.length === 0) {
      return;
    }

    const nextDocument = applyPatchOperations(document, operations);
    commitDocument(nextDocument);
    focusAndHighlightChangedBlocks(operations.flatMap((operation) => operation.blockIds));
    setOperations([]);
    setFeedback({ tone: "info", message: "Усі правки застосовано." });
  }

  function rejectOperation(operationId: string) {
    setOperations((current) => current.filter((operation) => operation.id !== operationId));
    setReviewItems((current) =>
      current.map((entry) => (entry.activeProposalId === operationId ? { ...entry, status: "pending", activeProposalId: undefined } : entry))
    );
  }

  function rejectAllOperations() {
    setOperations([]);
  }

  async function prepareReviewItem(item: EditorialReviewItem) {
    setReviewItems((current) => (current.some((entry) => entry.id === item.id) ? current : [item, ...current]));
    setActiveReviewItemId(item.id);
    setPreparingReviewItemId(item.id);

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
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, status: "ready", activeProposalId: payload.proposal.id } : entry
          )
        );
        setFeedback({ tone: "info", message: "Чернетку правки додано на розгляд." });
        return;
      }

      if (payload.proposal.kind === "subsection_prompt" && payload.proposal.subsectionDraft) {
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                ...entry,
                subsectionDraft: {
                  title: payload.proposal.subsectionDraft!.title,
                  lead: payload.proposal.subsectionDraft!.lead,
                  prompt: payload.proposal.subsectionDraft!.prompt,
                  summary: payload.proposal.subsectionDraft!.summary ?? payload.proposal.summary
                },
                status: "ready"
              }
              : entry
          )
        );
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
        setReviewItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, status: "ready", activeProposalId: payload.proposal.id } : entry
          )
        );
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
      body: splitCalloutDraftIntoParagraphs(item.calloutDraft.previewText)
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
      blocks.push({
        id: createBlockId("paragraph"),
        type: "paragraph",
        content: [createInlineText(lead)]
      });
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
          previewText: "",
          summary: entry.reason
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
            previewText: entry.calloutDraft?.previewText ?? "",
            summary: entry.calloutDraft?.summary ?? entry.reason
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
            previewText: body,
            summary: entry.calloutDraft?.summary ?? entry.reason
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
            prompt: entry.subsectionDraft?.prompt ?? "",
            summary: entry.subsectionDraft?.summary ?? entry.reason
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
            prompt: entry.subsectionDraft?.prompt ?? "",
            summary: entry.subsectionDraft?.summary ?? entry.reason
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

  async function generateActiveReviewImage() {
    if (!activeProposal || activeProposal.kind !== "image_prompt" || !activeProposal.imageDraft) {
      return;
    }

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
    setReviewItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "dismissed" } : entry)));
    if (activeReviewItemId === item.id) {
      setActiveReviewItemId(null);
      setActiveProposal((current) => (current?.reviewItemId === item.id ? null : current));
    }
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
    if (recentChangeTimeoutRef.current) {
      window.clearTimeout(recentChangeTimeoutRef.current);
      recentChangeTimeoutRef.current = null;
    }

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
    setReviewComposer(defaultReviewComposer);
    setComposerMode(null);
    setCustomPrompt("");
    setManualCalloutKind(defaultManualCalloutKind);
    setManualVisualIntent(defaultManualVisualIntent);
    setManualGenerationInFlight(null);
    setLocalActionMode(defaultLocalActionMode);
    setManualCalloutPrompt("");
    setManualVisualPrompt("");
    setRecentlyChangedBlockIds([]);
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
              onPrepareReviewItem={(item) => void prepareReviewItem(item)}
              onApplyReviewCallout={applyReviewCallout}
              onApplyReviewSubsection={applyReviewSubsection}
              onDismissReviewItem={dismissReviewItem}
              onUpdateActiveCalloutKind={updateActiveCalloutKind}
              onUpdateActiveCalloutTitle={updateActiveCalloutTitle}
              onUpdateActiveCalloutBody={updateActiveCalloutBody}
              onUpdateActiveSubsectionTitle={updateActiveSubsectionTitle}
              onUpdateActiveSubsectionLead={updateActiveSubsectionLead}
              onUpdateActiveImagePrompt={updateActiveImagePrompt}
              onUpdateActiveImageCaption={updateActiveImageCaption}
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
                onRequestReview={() => void requestEditorialReview()}
                patchLoading={isPatchRequestInFlight}
                reviewLoading={isReviewRequestInFlight}
                localActionMode={localActionMode}
                onLocalActionModeChange={setLocalActionMode}
                manualCalloutKind={manualCalloutKind}
                manualVisualIntent={manualVisualIntent}
                onManualCalloutKindChange={setManualCalloutKind}
                onManualVisualIntentChange={setManualVisualIntent}
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
        right={
          <RightOperationsRail
            aiTasks={[]}
            canRequestReview={canRequestReview}
            canOpenLocalComposer={normalizedSelection.blockIds.length > 0}
            isIdle={!feedback && operations.length === 0 && reviewItems.length === 0}
            patchDiagnostics={patchDiagnostics}
            reviewDiagnostics={reviewDiagnostics}
            reviewItems={reviewItems}
            reviewRevision={revision}
            activeReviewItemId={activeReviewItemId}
            history={history}
            isReviewDrawerOpen={isReviewDrawerOpen}
            onOpenReviewDrawer={() => {
              setReviewStatus("expertise");
              setReviewExpertise(null);
              setIsReviewDrawerOpen(true);
            }}
            onCloseReviewDrawer={() => setIsReviewDrawerOpen(false)}
            onOpenLocalComposer={() => {
              setLocalActionMode(defaultLocalActionMode);
              setComposerMode("local");
            }}
            onFocusReviewItem={focusReviewItem}
            onPrepareReviewItem={(item) => void prepareReviewItem(item)}
            onApplyReviewCallout={applyReviewCallout}
            preparingReviewItemId={preparingReviewItemId}
            onDismissReviewItem={(item: EditorialReviewItem) => dismissReviewItem(item)}
            reviewLoading={isReviewRequestInFlight}
            onAccept={acceptOperation}
            onAcceptAll={acceptAllOperations}
            onReject={rejectOperation}
            onRejectAll={rejectAllOperations}
            operations={operations}
            reviewItemCount={reviewItems.filter((item) => item.status !== "dismissed").length}
            statusMessage={feedback?.message}
            statusTone={feedback?.tone}
            onOpenAiTask={() => { }}
            onDismissAiTask={() => { }}
          />
        }
      />

      <EditorialReviewDrawer
        isOpen={isReviewDrawerOpen}
        status={reviewStatus}
        expertise={reviewExpertise}
        reviewItemsCount={reviewItems.length}
        reviewLoading={isReviewRequestInFlight}
        reviewChangeLevel={reviewComposer.changeLevel}
        reviewAdditionalInstructions={reviewComposer.additionalInstructions}
        onReviewChangeLevel={(level: WholeTextChangeLevel) => setReviewComposer((current) => ({ ...current, changeLevel: level }))}
        onReviewAdditionalInstructionsChange={(value) => setReviewComposer((current) => ({ ...current, additionalInstructions: value }))}
        onAnalyze={() => void requestEditorialReview("expertise")}
        onGenerateCards={handleGenerateCards}
        onClose={() => setIsReviewDrawerOpen(false)}
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

  if (payload.expertise && payload.items.length === 0) {
    return {
      tone: "info",
      message: "Експертний аналіз готовий."
    };
  }

  return {
    tone: "info",
    message: `Підготовлено ${payload.items.length} карток з рекомендаціями.`
  };
}

function splitCalloutDraftIntoParagraphs(text: string) {
  const parts = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (parts.length > 0 ? parts : [""]).map((part) => [createInlineText(part)]);
}
