"use client";

import type { ChangeEvent, KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createEditorAssetToken } from "../../lib/editor/asset-store";
import type {
  Block,
  BlockSelection,
  BulletListBlock,
  CalloutBlock,
  EditorDocument,
  HeadingBlock,
  ImageBlock,
  InlineNode,
  OrderedListBlock,
  ParagraphBlock,
  TableBlock
} from "../../lib/editor/document-model";
import {
  createBlockId,
  createEmptyParagraphBlock,
  createInlineText,
  getBlock,
  getBlockIndex,
  getInlineText,
  hasSelectedBlocks,
  insertBlocksAfter,
  mergeTextBlockIntoPrevious,
  normalizeBlockSelection,
  normalizeInlineNodes,
  removeBlocksByIds,
  type DividerBlock
} from "../../lib/editor/document-model";
import { exitListItemToParagraph } from "../../lib/editor/list-editing";
import {
  type EditorialCalloutKind,
  type EditorialVisualIntent,
  type VisualStylePreset,
  getEditorialCalloutKindOptions,
  getEditorialCalloutKindLabel,
  getEditorialCalloutKindTitle,
  type ReviewActionProposal,
  type EditorialReviewItem
} from "../../lib/editor/review-contract";
import { formatParagraphLabel, type ManuscriptRevisionState } from "../../lib/editor/manuscript-structure";
import type { SpellcheckIssue } from "../../lib/editor/spellcheck-contract";
import type { SpellcheckBlockResult } from "../../lib/editor/spellcheck-view-model";
import { resolveReviewExecutionLaneState } from "../../lib/editor/review-execution-lane";
import { Button } from "../ui/Button";
import { BlockDiffOverlay } from "./BlockDiffOverlay";
import { ReviewRecommendationDetail } from "../layout/ReviewRecommendationDetail";
import { useResolvedEditorAssetUrl } from "./ResolvedEditorImage";
import {
  Bold,
  Columns2,
  Italic,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Plus,
  Quote,
  Minus,
  Table,
  Image as ImageIcon,
  Redo2,
  X,
  Trash2,
  Undo2
} from "lucide-react";
import { getInlineFormatHotkeyCommand, getUndoRedoHotkeyAction } from "../../lib/editor/keyboard-shortcuts";

type BlockFormatAction = "paragraph" | "heading-1" | "heading-2" | "heading-3" | "bullet-list" | "ordered-list" | "divider" | "callout" | "table";
type CaretPlacement = "start" | "end";
type PendingFocusTarget = { key: string; placement: CaretPlacement } | { key: string; offset: number };
type ActiveSpellcheckPopover = { blockId: string; issueId: string; top: number; left: number };
type ActiveEmphasisPopover = { blockId: string; itemId: string; top: number; left: number };
type EmphasisSuggestion = {
  itemId: string;
  blockId: string;
  phrase: string;
  reason: string;
  range: {
    start: number;
    end: number;
  };
};

type RichTextContext = {
  element: HTMLDivElement;
  html: string;
  content: InlineNode[];
  caretOffset: number;
};

export function BlockEditorSurface({
  document,
  revision,
  selection,
  focusedBlockId,
  disabled,
  onDocumentChange,
  onSelectionChange,
  onFocusedBlockChange,
  onInsertImage,
  activeProposal,
  activeReviewItem,
  preparingReviewItemId,
  recentlyChangedBlockIds,
  reviewItems = [],
  onAcceptProposal,
  onRejectProposal,
  onPrepareReviewItem,
  reviewRefineInstruction,
  onReviewRefineInstructionChange,
  onApplyReviewCallout,
  onApplyReviewSubsection,
  onDismissReviewItem,
  onUpdateActiveCalloutKind,
  onUpdateActiveCalloutTitle,
  onUpdateActiveCalloutBody,
  onUpdateActiveSubsectionTitle,
  onUpdateActiveSubsectionLead,
  onUpdateActiveVisualIntent,
  onUpdateActiveImagePrompt,
  onUpdateActiveImageCaption,
  onUpdateActiveVisualStylePreset,
  activeVisualStylePreset,
  onGenerateActiveReviewImage,
  onApplyActiveReviewImage,
  reviewImageLoading,
  spellcheckResults = [],
  onApplySpellcheckSuggestion,
  onDismissSpellcheckIssue,
  emphasisSuggestions = [],
  onApplyEmphasisSuggestion,
  onDismissEmphasisSuggestion,
  canUndo = false,
  canRedo = false,
  canCompare = false,
  onUndo,
  onRedo,
  onCompare
}: {
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  selection: BlockSelection;
  focusedBlockId: string | null;
  disabled?: boolean;
  onDocumentChange: (document: EditorDocument) => void;
  onSelectionChange: (selection: BlockSelection) => void;
  onFocusedBlockChange: (blockId: string | null) => void;
  onInsertImage: (file: File, anchorBlockId: string | null) => Promise<void>;
  activeProposal?: ReviewActionProposal | null;
  activeReviewItem?: EditorialReviewItem | null;
  preparingReviewItemId?: string | null;
  recentlyChangedBlockIds?: string[];
  reviewItems?: EditorialReviewItem[];
  onAcceptProposal?: (proposalId: string, nextBlocks: Block[]) => void;
  onRejectProposal?: (proposalId: string) => void;
  onPrepareReviewItem?: (
    item: EditorialReviewItem,
    options?: { visualStylePreset?: VisualStylePreset; editorialInstruction?: string }
  ) => void;
  reviewRefineInstruction?: string;
  onReviewRefineInstructionChange?: (value: string) => void;
  onApplyReviewCallout?: (item: EditorialReviewItem) => void;
  onApplyReviewSubsection?: (item: EditorialReviewItem) => void;
  onDismissReviewItem?: (item: EditorialReviewItem) => void;
  onUpdateActiveCalloutKind?: (item: EditorialReviewItem, kind: EditorialCalloutKind) => void;
  onUpdateActiveCalloutTitle?: (item: EditorialReviewItem, title: string) => void;
  onUpdateActiveCalloutBody?: (item: EditorialReviewItem, body: string) => void;
  onUpdateActiveSubsectionTitle?: (item: EditorialReviewItem, title: string) => void;
  onUpdateActiveSubsectionLead?: (item: EditorialReviewItem, lead: string) => void;
  onUpdateActiveVisualIntent?: (item: EditorialReviewItem, intent: EditorialVisualIntent) => void;
  onUpdateActiveImagePrompt?: (prompt: string) => void;
  onUpdateActiveImageCaption?: (caption: string) => void;
  onUpdateActiveVisualStylePreset?: (preset: VisualStylePreset) => void;
  activeVisualStylePreset?: VisualStylePreset;
  onGenerateActiveReviewImage?: () => void;
  onApplyActiveReviewImage?: () => void;
  reviewImageLoading?: boolean;
  spellcheckResults?: SpellcheckBlockResult[];
  onApplySpellcheckSuggestion?: (input: { blockId: string; issueId: string; suggestion: string }) => void;
  onDismissSpellcheckIssue?: (input: { blockId: string; issueId: string }) => void;
  emphasisSuggestions?: EmphasisSuggestion[];
  onApplyEmphasisSuggestion?: (input: { itemId: string }) => void;
  onDismissEmphasisSuggestion?: (input: { itemId: string }) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  canCompare?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onCompare?: () => void;
}) {
  const editableRefs = useRef(new Map<string, HTMLElement>());
  const dragAnchorBlockId = useRef<string | null>(null);
  const activeEditableKey = useRef<string | null>(null);
  const savedSelectionOffsets = useRef(new Map<string, { start: number; end: number }>());
  const pendingFocusTarget = useRef<PendingFocusTarget | null>(null);
  const [activeSpellcheckPopover, setActiveSpellcheckPopover] = useState<ActiveSpellcheckPopover | null>(null);
  const [activeEmphasisPopover, setActiveEmphasisPopover] = useState<ActiveEmphasisPopover | null>(null);
  const normalizedSelection = useMemo(() => normalizeBlockSelection(document, selection), [document, selection]);
  const spellcheckIssueMap = useMemo(() => {
    const map = new Map<string, SpellcheckIssue>();

    for (const result of spellcheckResults) {
      for (const issue of result.issues) {
        map.set(`${result.blockId}:${issue.id}`, issue);
      }
    }

    return map;
  }, [spellcheckResults]);
  const emphasisSuggestionMap = useMemo(() => new Map(emphasisSuggestions.map((suggestion) => [suggestion.itemId, suggestion])), [emphasisSuggestions]);

  useEffect(() => {
    function handlePointerRelease() {
      dragAnchorBlockId.current = null;
    }

    window.addEventListener("mouseup", handlePointerRelease);
    window.addEventListener("blur", handlePointerRelease);

    return () => {
      window.removeEventListener("mouseup", handlePointerRelease);
      window.removeEventListener("blur", handlePointerRelease);
    };
  }, []);

  useEffect(() => {
    function handleSelectionChange() {
      const activeKey = activeEditableKey.current;

      if (!activeKey) {
        return;
      }

      const element = editableRefs.current.get(activeKey);

      if (!element) {
        return;
      }

      const offsets = getSelectionOffsets(element);

      if (offsets) {
        savedSelectionOffsets.current.set(activeKey, offsets);
        return;
      }

      if (window.document.activeElement === element) {
        const caretOffset = getCaretOffset(element);

        if (caretOffset !== null) {
          savedSelectionOffsets.current.set(activeKey, { start: caretOffset, end: caretOffset });
        }
      }
    }

    window.document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      window.document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  useEffect(() => {
    if (!activeSpellcheckPopover) {
      return;
    }

    function handleDismiss(event: MouseEvent) {
      const target = event.target;

      if (target instanceof HTMLElement && target.closest(".spellcheck-popover")) {
        return;
      }

      if (target instanceof HTMLElement && target.closest(".spellcheck-underline")) {
        return;
      }

      setActiveSpellcheckPopover(null);
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveSpellcheckPopover(null);
      }
    }

    function handleViewportChange() {
      setActiveSpellcheckPopover(null);
    }

    window.addEventListener("mousedown", handleDismiss);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      window.removeEventListener("mousedown", handleDismiss);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [activeSpellcheckPopover]);

  useEffect(() => {
    if (!activeSpellcheckPopover) {
      return;
    }

    if (!spellcheckIssueMap.has(`${activeSpellcheckPopover.blockId}:${activeSpellcheckPopover.issueId}`)) {
      setActiveSpellcheckPopover(null);
    }
  }, [activeSpellcheckPopover, spellcheckIssueMap]);

  useEffect(() => {
    if (!activeEmphasisPopover) {
      return;
    }

    function handleDismiss(event: MouseEvent) {
      const target = event.target;

      if (target instanceof HTMLElement && target.closest(".emphasis-popover")) {
        return;
      }

      if (target instanceof HTMLElement && target.closest(".emphasis-suggestion")) {
        return;
      }

      setActiveEmphasisPopover(null);
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveEmphasisPopover(null);
      }
    }

    function handleViewportChange() {
      setActiveEmphasisPopover(null);
    }

    window.addEventListener("mousedown", handleDismiss);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      window.removeEventListener("mousedown", handleDismiss);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [activeEmphasisPopover]);

  useEffect(() => {
    if (!activeEmphasisPopover) {
      return;
    }

    if (!emphasisSuggestionMap.has(activeEmphasisPopover.itemId)) {
      setActiveEmphasisPopover(null);
    }
  }, [activeEmphasisPopover, emphasisSuggestionMap]);

  useLayoutEffect(() => {
    const pending = pendingFocusTarget.current;

    if (!pending) {
      return;
    }

    const target = editableRefs.current.get(pending.key);

    if (!target) {
      return;
    }

    target.focus();
    if ("offset" in pending) {
      placeCaretAtOffset(target, pending.offset);
    } else {
      placeCaret(target, pending.placement);
    }
    pendingFocusTarget.current = null;
  }, [document]);

  function registerEditable(key: string, element: HTMLElement | null) {
    if (!element) {
      editableRefs.current.delete(key);
      return;
    }

    editableRefs.current.set(key, element);
  }

  function commit(nextDocument: EditorDocument) {
    onDocumentChange(nextDocument);
  }

  function setPendingFocus(key: string, placement: CaretPlacement) {
    pendingFocusTarget.current = { key, placement };
  }

  function setPendingFocusOffset(key: string, offset: number) {
    pendingFocusTarget.current = { key, offset };
  }

  function clearAiSelection() {
    if (normalizedSelection.blockIds.length > 0) {
      onSelectionChange({ blockIds: [], anchorBlockId: null, focusBlockId: null });
    }
  }

  function handleEditableFocus(blockId: string, editableKey: string) {
    activeEditableKey.current = editableKey;
    onFocusedBlockChange(blockId);
    clearAiSelection();
  }

  function handleSpellcheckIssueClick(blockId: string, issueId: string, rect: DOMRect) {
    setActiveEmphasisPopover(null);
    setActiveSpellcheckPopover({
      blockId,
      issueId,
      top: rect.bottom + 10,
      left: Math.min(rect.left, window.innerWidth - 340)
    });
  }

  function handleEmphasisSuggestionClick(blockId: string, itemId: string, rect: DOMRect) {
    setActiveSpellcheckPopover(null);
    setActiveEmphasisPopover({
      blockId,
      itemId,
      top: rect.bottom + 10,
      left: Math.min(rect.left, window.innerWidth - 340)
    });
  }

  function selectBlockRange(anchorBlockId: string, focusBlockId: string) {
    onSelectionChange(
      normalizeBlockSelection(document, {
        blockIds: [],
        anchorBlockId,
        focusBlockId
      })
    );
    onFocusedBlockChange(focusBlockId);
  }

  function handleGutterMouseDown(blockId: string, event: ReactMouseEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0) {
      return;
    }

    event.preventDefault();
    const anchorBlockId = event.shiftKey && normalizedSelection.anchorBlockId ? normalizedSelection.anchorBlockId : blockId;
    dragAnchorBlockId.current = anchorBlockId;
    selectBlockRange(anchorBlockId, blockId);
  }

  function handleGutterMouseEnter(blockId: string, event: ReactMouseEvent<HTMLButtonElement>) {
    if (disabled || !dragAnchorBlockId.current || (event.buttons & 1) !== 1) {
      return;
    }

    selectBlockRange(dragAnchorBlockId.current, blockId);
  }

  function handleFormatCommand(command: "bold" | "italic") {
    const targetKey = activeEditableKey.current ?? focusedBlockId;

    if (!targetKey || disabled) {
      return;
    }

    const element = editableRefs.current.get(targetKey);

    if (!element) {
      return;
    }

    const selectionOffsets = savedSelectionOffsets.current.get(targetKey) ?? getSelectionOffsets(element);

    element.focus({ preventScroll: true });
    restoreSelectionOffsets(selectionOffsets, element);

    restoreSelectionOffsets(selectionOffsets, element);
    window.document.execCommand(command);
    restoreSelectionOffsets(selectionOffsets, element);
    scheduleSelectionRestore(selectionOffsets, element);
  }

  function handleBlockFormat(action: BlockFormatAction) {
    const targetIds = normalizedSelection.blockIds.length > 0 ? normalizedSelection.blockIds : focusedBlockId ? [focusedBlockId] : [];

    if (targetIds.length === 0) {
      return;
    }

    const targetSet = new Set(targetIds);
    const selectedBlocks = targetIds
      .map((blockId) => getBlock(document, blockId))
      .filter((block): block is Block => Boolean(block));
    const shouldToggleToParagraph =
      (action === "bullet-list" && selectedBlocks.length > 0 && selectedBlocks.every((block) => block.type === "bullet_list")) ||
      (action === "ordered-list" && selectedBlocks.length > 0 && selectedBlocks.every((block) => block.type === "ordered_list"));
    const transformed: Block[] = [];

    for (const block of document.blocks) {
      if (!targetSet.has(block.id)) {
        transformed.push(block);
        continue;
      }

      if (action === "paragraph") {
        transformed.push(toParagraphBlock(block));
        continue;
      }

      if (action === "heading-1" || action === "heading-2" || action === "heading-3") {
        const level = action === "heading-1" ? 1 : action === "heading-2" ? 2 : 3;
        transformed.push(toHeadingBlock(block, level));
        continue;
      }

      if (action === "bullet-list") {
        transformed.push(shouldToggleToParagraph ? toParagraphBlock(block) : toListBlock(block, "bullet_list"));
        continue;
      }

      if (action === "ordered-list") {
        transformed.push(shouldToggleToParagraph ? toParagraphBlock(block) : toListBlock(block, "ordered_list"));
        continue;
      }

      if (action === "divider") {
        transformed.push({ id: block.id, type: "divider" });
        continue;
      }

      if (action === "callout") {
        transformed.push(toCalloutBlock(block));
        continue;
      }

      if (action === "table") {
        transformed.push(toTableBlock(block));
        continue;
      }
    }

    commit({ version: 2, blocks: transformed });
  }

  function handleToolbarMouseDown(event: ReactMouseEvent<HTMLButtonElement | HTMLLabelElement>) {
    event.preventDefault();
  }

  function handleInlineFormatMouseDown(
    event: ReactMouseEvent<HTMLButtonElement>,
    command: "bold" | "italic"
  ) {
    event.preventDefault();
    handleFormatCommand(command);
  }

  function insertBlockAfterCurrent(factory: () => Block) {
    const anchorId = focusedBlockId ?? normalizedSelection.focusBlockId;
    const nextBlock = factory();
    const nextDocument = insertBlocksAfter(document, anchorId, [nextBlock]);
    setPendingFocus(makeEditableKey(nextBlock.id), "start");
    commit(nextDocument);
    onFocusedBlockChange(nextBlock.id);
    onSelectionChange({ blockIds: [], anchorBlockId: null, focusBlockId: null });
  }

  function updateBlock(blockId: string, updater: (block: Block) => Block) {
    commit({
      version: 2,
      blocks: document.blocks.map((block) => (block.id === blockId ? updater(block) : block))
    });
  }

  function replaceBlock(blockId: string, nextBlock: Block) {
    updateBlock(blockId, () => nextBlock);
  }

  function deleteBlock(blockId: string) {
    const index = getBlockIndex(document, blockId);
    const nextFocusBlock = document.blocks[index + 1] ?? document.blocks[index - 1] ?? null;
    const nextDocument = removeBlocksByIds(document, [blockId]);
    commit(nextDocument);
    onSelectionChange({ blockIds: [], anchorBlockId: null, focusBlockId: null });
    onFocusedBlockChange(nextFocusBlock?.id ?? nextDocument.blocks[0]?.id ?? null);

    if (nextFocusBlock) {
      setPendingFocus(makeEditableKey(nextFocusBlock.id), "start");
    }
  }

  function splitTextBlock(block: ParagraphBlock | HeadingBlock, context: RichTextContext) {
    const [left, right] = splitInlineNodes(context.content, context.caretOffset);
    const currentBlock: ParagraphBlock | HeadingBlock = {
      ...block,
      content: left
    };
    const nextBlock = createEmptyParagraphBlock();
    nextBlock.content = right;

    const nextBlocks = document.blocks.map((entry) => (entry.id === block.id ? currentBlock : entry));
    const currentIndex = getBlockIndex(document, block.id);
    nextBlocks.splice(currentIndex + 1, 0, nextBlock);
    setPendingFocus(makeEditableKey(nextBlock.id), "start");
    commit({ version: 2, blocks: nextBlocks });
    onFocusedBlockChange(nextBlock.id);
    onSelectionChange({ blockIds: [], anchorBlockId: null, focusBlockId: null });
  }

  function insertLineBreak(context: RichTextContext) {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const br = window.document.createElement("br");
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    queueMicrotask(() => {
      context.element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function handleTextBlockBackspace(block: ParagraphBlock | HeadingBlock, context: RichTextContext): boolean {
    if (context.caretOffset > 0) {
      return false;
    }

    const mergeResult = mergeTextBlockIntoPrevious(document, block.id);

    if (mergeResult) {
      commit(mergeResult.document);
      setPendingFocusOffset(makeEditableKey(mergeResult.focusBlockId), mergeResult.focusOffset);
      onFocusedBlockChange(mergeResult.focusBlockId);
      onSelectionChange({ blockIds: [], anchorBlockId: null, focusBlockId: null });
      return true;
    }

    if (isInlineContentEmpty(context.content)) {
      deleteBlock(block.id);
      return true;
    }

    return false;
  }

  function handleListItemEnter(block: BulletListBlock | OrderedListBlock, itemIndex: number, context: RichTextContext) {
    const currentText = getInlineText(context.content);

    if (currentText.length === 0) {
      const exitResult = exitListItemToParagraph(document, block.id, itemIndex);

      if (!exitResult) {
        return;
      }

      commit(exitResult.document);
      setPendingFocus(makeEditableKey(exitResult.focusBlockId), "start");
      onFocusedBlockChange(exitResult.focusBlockId);
      onSelectionChange({ blockIds: [], anchorBlockId: null, focusBlockId: null });
      return;
    }

    const [left, right] = splitInlineNodes(context.content, context.caretOffset);
    const nextItems = block.items.slice();
    nextItems[itemIndex] = left;
    nextItems.splice(itemIndex + 1, 0, right);
    replaceBlock(block.id, { ...block, items: nextItems });
    setPendingFocus(makeEditableKey(block.id, `item-${itemIndex + 1}`), "start");
    onFocusedBlockChange(block.id);
  }

  function handleListItemBackspace(block: BulletListBlock | OrderedListBlock, itemIndex: number, context: RichTextContext): boolean {
    if (!isInlineContentEmpty(context.content) || context.caretOffset > 0) {
      return false;
    }

    if (block.items.length === 1) {
      replaceBlock(block.id, createEmptyParagraphBlock(block.id));
      setPendingFocus(makeEditableKey(block.id), "start");
      onFocusedBlockChange(block.id);
      return true;
    }

    const nextItems = block.items.filter((_, index) => index !== itemIndex);
    replaceBlock(block.id, { ...block, items: nextItems });
    const nextIndex = Math.max(0, itemIndex - 1);
    setPendingFocus(makeEditableKey(block.id, `item-${nextIndex}`), "end");
    onFocusedBlockChange(block.id);
    return true;
  }

  function addTableRow(block: TableBlock) {
    replaceBlock(block.id, {
      ...block,
      rows: [...block.rows, block.rows[0].map(() => [createInlineText("")])]
    });
  }

  function removeTableRow(block: TableBlock) {
    if (block.rows.length <= 1) {
      return;
    }

    replaceBlock(block.id, {
      ...block,
      rows: block.rows.slice(0, -1)
    });
  }

  function addTableColumn(block: TableBlock) {
    replaceBlock(block.id, {
      ...block,
      rows: block.rows.map((row) => [...row, [createInlineText("")]])
    });
  }

  function removeTableColumn(block: TableBlock) {
    if (block.rows[0]?.length <= 1) {
      return;
    }

    replaceBlock(block.id, {
      ...block,
      rows: block.rows.map((row) => row.slice(0, -1))
    });
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file || !file.type.startsWith("image/")) {
      event.currentTarget.value = "";
      return;
    }

    await onInsertImage(file, focusedBlockId ?? normalizedSelection.focusBlockId);
    event.currentTarget.value = "";
  }

  const laneState = resolveReviewExecutionLaneState({
    reviewItems,
    activeReviewItem,
    activeProposal,
    preparingReviewItemId
  });
  const preparingItem = laneState.preparingItem;
  const proposalItem = laneState.proposalItem;
  const highlightedItem = laneState.highlightedItem;
  const highlightedBlockIds = laneState.highlightedBlockIds;
  const highlightedSet = useMemo(() => new Set(highlightedBlockIds), [highlightedBlockIds]);
  const recentChangeSet = useMemo(() => new Set(recentlyChangedBlockIds ?? []), [recentlyChangedBlockIds]);
  const highlightedStartBlockId = laneState.highlightedStartBlockId;
  const highlightedEndBlockId = laneState.highlightedEndBlockId;
  const shouldShowInlineDetail = laneState.shouldShowInlineDetail && highlightedItem?.stepId !== "emphasis";
  const isReplaceDiffActive = laneState.isReplaceDiffActive && highlightedItem?.stepId !== "emphasis";
  const spellcheckIssuesByBlockId = useMemo(
    () => new Map(spellcheckResults.map((result) => [result.blockId, result.issues])),
    [spellcheckResults]
  );
  const emphasisSuggestionsByBlockId = useMemo(() => {
    const map = new Map<string, EmphasisSuggestion[]>();

    for (const suggestion of emphasisSuggestions) {
      const current = map.get(suggestion.blockId) ?? [];
      current.push(suggestion);
      map.set(suggestion.blockId, current);
    }

    return map;
  }, [emphasisSuggestions]);

  return (
    <div className="block-editor-shell">
      <div className="block-editor-toolbar">
        <div className="block-editor-toolbar-group" aria-label="Історія змін">
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={onUndo}
            disabled={disabled || !canUndo}
            title="Назад (Ctrl/Cmd+Z)"
            aria-label="Назад"
          >
            <Undo2 />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={onRedo}
            disabled={disabled || !canRedo}
            title="Вперед (Ctrl/Cmd+Shift+Z)"
            aria-label="Вперед"
          >
            <Redo2 />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={onCompare}
            disabled={disabled || !canCompare}
            title="Порівняти прийняту правку"
            aria-label="Порівняти"
          >
            <Columns2 />
          </button>
        </div>

        <div className="block-editor-toolbar-group">
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={(event) => handleInlineFormatMouseDown(event, "bold")}
            disabled={disabled}
            title="Жирний"
            aria-label="Жирний"
          >
            <Bold />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={(event) => handleInlineFormatMouseDown(event, "italic")}
            disabled={disabled}
            title="Курсив"
            aria-label="Курсив"
          >
            <Italic />
          </button>
        </div>

        <div className="block-editor-toolbar-group">
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={() => handleBlockFormat("paragraph")}
            disabled={disabled}
            title="Абзац"
            aria-label="Абзац"
            data-active={getBlock(document, focusedBlockId)?.type === "paragraph"}
          >
            <Type />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={() => handleBlockFormat("heading-1")}
            disabled={disabled}
            title="H1"
            aria-label="Заголовок 1"
            data-active={getBlock(document, focusedBlockId)?.type === "heading" && (getBlock(document, focusedBlockId) as HeadingBlock).level === 1}
          >
            <Heading1 />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={() => handleBlockFormat("heading-2")}
            disabled={disabled}
            title="H2"
            aria-label="Заголовок 2"
            data-active={getBlock(document, focusedBlockId)?.type === "heading" && (getBlock(document, focusedBlockId) as HeadingBlock).level === 2}
          >
            <Heading2 />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={() => handleBlockFormat("heading-3")}
            disabled={disabled}
            title="H3"
            aria-label="Заголовок 3"
            data-active={getBlock(document, focusedBlockId)?.type === "heading" && (getBlock(document, focusedBlockId) as HeadingBlock).level === 3}
          >
            <Heading3 />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={() => handleBlockFormat("bullet-list")}
            disabled={disabled}
            title="Список"
            aria-label="Маркований список"
            data-active={getBlock(document, focusedBlockId)?.type === "bullet_list"}
          >
            <List />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={() => handleBlockFormat("ordered-list")}
            disabled={disabled}
            title="Нумерований список"
            aria-label="Нумерований список"
            data-active={getBlock(document, focusedBlockId)?.type === "ordered_list"}
          >
            <ListOrdered />
          </button>
        </div>

        <div className="block-editor-toolbar-group">
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={() => insertBlockAfterCurrent(() => createEmptyParagraphBlock())}
            disabled={disabled}
            title="Додати абзац"
            aria-label="Додати абзац"
          >
            <Plus />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={() =>
              insertBlockAfterCurrent(() => ({
                id: createBlockId("callout"),
                type: "callout",
                kind: "mechanism",
                title: [createInlineText(getEditorialCalloutKindTitle("mechanism"))],
                body: [[createInlineText("")]]
              }))
            }
            disabled={disabled}
            title="Врізка"
            aria-label="Додати врізку"
          >
            <Quote />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={() => insertBlockAfterCurrent(() => ({ id: createBlockId("divider"), type: "divider" as DividerBlock["type"] }))}
            disabled={disabled}
            title="Роздільник"
            aria-label="Додати роздільник"
          >
            <Minus />
          </button>
          <button
            type="button"
            className="block-toolbar-button"
            onMouseDown={handleToolbarMouseDown}
            onClick={() => insertBlockAfterCurrent(() => ({ id: createBlockId("table"), type: "table", rows: [[[createInlineText("")], [createInlineText("")]], [[createInlineText("")], [createInlineText("")]]] }))}
            disabled={disabled}
            title="Таблиця"
            aria-label="Додати таблицю"
          >
            <Table />
          </button>
          <label className="block-toolbar-button block-toolbar-button-file" title="Зображення" aria-label="Додати зображення">
            <ImageIcon />
            <span className="sr-only">Додати зображення</span>
            <input type="file" accept="image/*" onChange={handleFileSelection} disabled={disabled} />
          </label>
        </div>

      </div>

      <div className="block-editor-canvas">
        {document.blocks.map((block, index) => {
          const isSelected = normalizedSelection.blockIds.includes(block.id);
          const isFocused = focusedBlockId === block.id;
          const isReviewAnchor = highlightedSet.has(block.id);
          const reviewAnchorState = preparingItem?.id === highlightedItem?.id ? "preparing" : highlightedItem ? "active" : "idle";
          const reviewAnchorEdge =
            highlightedStartBlockId === block.id && highlightedEndBlockId === block.id
              ? "single"
              : highlightedStartBlockId === block.id
                ? "start"
                : highlightedEndBlockId === block.id
                  ? "end"
                  : isReviewAnchor
                    ? "middle"
                    : "none";
          const isDiffAnchorEnd = activeProposal?.kind === "text_diff" && activeProposal.textDiff?.blockIds.at(-1) === block.id;
          const isInlineDetailAnchor = shouldShowInlineDetail && highlightedEndBlockId === block.id;
          const isReplaceAnchorBlock = isReplaceDiffActive && highlightedSet.has(block.id);

          return (
            <div
              key={block.id}
              className="block-editor-row"
              data-block-id={block.id}
              data-selected={isSelected ? "true" : "false"}
              data-focused={isFocused ? "true" : "false"}
              data-review-anchor={isReviewAnchor ? "true" : "false"}
              data-review-anchor-state={isReviewAnchor ? reviewAnchorState : "idle"}
              data-review-anchor-edge={reviewAnchorEdge}
              data-review-replace={isReplaceAnchorBlock ? "old" : "none"}
              data-recent-change={recentChangeSet.has(block.id) ? "true" : "false"}
              style={{ position: "relative" }}
            >

              <button
                type="button"
                className="block-editor-gutter"
                onMouseDown={(event) => handleGutterMouseDown(block.id, event)}
                onMouseEnter={(event) => handleGutterMouseEnter(block.id, event)}
                title="Виділити блок або діапазон"
                aria-label={`Виділити абзац ${formatParagraphLabel(index)}`}
              >
                {formatParagraphLabel(index)}
              </button>

              <div className="block-editor-block">
                <button type="button" className="block-row-action" onClick={() => deleteBlock(block.id)} title="Видалити блок" aria-label="Видалити блок">
                  <Trash2 size={14} />
                </button>
                <BlockRenderer
                  block={block}
                  spellcheckIssues={spellcheckIssuesByBlockId.get(block.id) ?? []}
                  emphasisSuggestions={emphasisSuggestionsByBlockId.get(block.id) ?? []}
                  onSpellcheckIssueClick={handleSpellcheckIssueClick}
                  onEmphasisSuggestionClick={handleEmphasisSuggestionClick}
                  disabled={disabled}
                  registerEditable={registerEditable}
                  onEditFocus={handleEditableFocus}
                  onTextBlockEnter={splitTextBlock}
                  onTextBlockBackspace={handleTextBlockBackspace}
                  onSoftBreak={insertLineBreak}
                  onListItemEnter={handleListItemEnter}
                  onListItemBackspace={handleListItemBackspace}
                  onBlockChange={(nextBlock) => replaceBlock(block.id, nextBlock)}
                  onAddTableRow={addTableRow}
                  onRemoveTableRow={removeTableRow}
                  onAddTableColumn={addTableColumn}
                  onRemoveTableColumn={removeTableColumn}
                />

                {isDiffAnchorEnd && activeProposal?.kind === "text_diff" && activeProposal.textDiff ? (
                  <div className="manuscript-review-detail-anchor">
                    <BlockDiffOverlay
                      item={highlightedItem ?? proposalItem ?? activeReviewItem ?? null}
                      oldBlocks={activeProposal.textDiff.oldBlocks}
                      newBlocks={activeProposal.textDiff.newBlocks}
                      warning={activeProposal.textDiff.warning}
                      onAccept={(nextBlocks) => onAcceptProposal?.(activeProposal.id, nextBlocks)}
                      onReject={() => onRejectProposal?.(activeProposal.id)}
                      refineInstruction={reviewRefineInstruction ?? ""}
                      onRefineInstructionChange={(value) => onReviewRefineInstructionChange?.(value)}
                      onRegenerate={(instruction) => {
                        const item = highlightedItem ?? proposalItem ?? activeReviewItem;

                        if (item) {
                          onPrepareReviewItem?.(item, { editorialInstruction: instruction });
                        }
                      }}
                    />
                  </div>
                ) : null}

                {isInlineDetailAnchor && highlightedItem ? (
                  <div className="manuscript-review-detail-anchor">
                    <ReviewRecommendationDetail
                      item={highlightedItem}
                      revision={revision}
                      proposal={proposalItem?.id === highlightedItem.id ? activeProposal ?? null : null}
                      layout="pendant"
                      isPreparing={preparingItem?.id === highlightedItem.id}
                      reviewImageLoading={reviewImageLoading}
                      onPrepare={(item, options) => onPrepareReviewItem?.(item, options)}
                      refineInstruction={reviewRefineInstruction ?? ""}
                      onRefineInstructionChange={(value) => onReviewRefineInstructionChange?.(value)}
                      onApplyCallout={(item) => onApplyReviewCallout?.(item)}
                      onApplySubsection={(item) => onApplyReviewSubsection?.(item)}
                      onDismiss={(item) => onDismissReviewItem?.(item)}
                      onUpdateActiveCalloutKind={(item, kind) => onUpdateActiveCalloutKind?.(item, kind)}
                      onUpdateActiveCalloutTitle={(item, title) => onUpdateActiveCalloutTitle?.(item, title)}
                      onUpdateActiveCalloutBody={(item, body) => onUpdateActiveCalloutBody?.(item, body)}
                      onUpdateActiveSubsectionTitle={(item, title) => onUpdateActiveSubsectionTitle?.(item, title)}
                      onUpdateActiveSubsectionLead={(item, lead) => onUpdateActiveSubsectionLead?.(item, lead)}
                      onUpdateActiveVisualIntent={(item, intent) => onUpdateActiveVisualIntent?.(item, intent)}
                      onUpdateActiveImagePrompt={(prompt) => onUpdateActiveImagePrompt?.(prompt)}
                      onUpdateActiveImageCaption={(caption) => onUpdateActiveImageCaption?.(caption)}
                      onUpdateActiveVisualStylePreset={(preset) => onUpdateActiveVisualStylePreset?.(preset)}
                      activeVisualStylePreset={activeVisualStylePreset}
                      onGenerateActiveReviewImage={() => onGenerateActiveReviewImage?.()}
                      onApplyActiveReviewImage={() => onApplyActiveReviewImage?.()}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="block-editor-status mono-ui">
        {hasSelectedBlocks(normalizedSelection)
          ? `AI: ${normalizedSelection.blockIds.length} блок(и)`
          : focusedBlockId
            ? `Фокус: ${formatParagraphLabel(getBlockIndex(document, focusedBlockId))}`
            : "AI: блок не вибрано"}
      </div>

      {activeSpellcheckPopover ? (
        (() => {
          const issue = spellcheckIssueMap.get(`${activeSpellcheckPopover.blockId}:${activeSpellcheckPopover.issueId}`);

          if (!issue) {
            return null;
          }

          return (
            <div
              className="spellcheck-popover"
              style={{
                top: `${Math.max(16, activeSpellcheckPopover.top)}px`,
                left: `${Math.max(16, activeSpellcheckPopover.left)}px`
              }}
            >
              <div className="spellcheck-popover-head">
                <div className="spellcheck-popover-title-stack">
                  <code>{issue.badText}</code>
                  <p className="spellcheck-popover-copy">{issue.message}</p>
                </div>
                <button
                  type="button"
                  className="spellcheck-popover-close"
                  aria-label="Закрити підказки"
                  onClick={() => setActiveSpellcheckPopover(null)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              {issue.suggestions.length > 0 ? (
                <div className="spellcheck-popover-suggestions">
                  {issue.suggestions.map((suggestion) => (
                    <button
                      key={`${issue.id}-${suggestion.value}`}
                      type="button"
                      className="spellcheck-popover-suggestion"
                      onClick={() => {
                        onApplySpellcheckSuggestion?.({
                          blockId: activeSpellcheckPopover.blockId,
                          issueId: issue.id,
                          suggestion: suggestion.value
                        });
                        setActiveSpellcheckPopover(null);
                      }}
                    >
                      {suggestion.value}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="spellcheck-popover-suggestion spellcheck-popover-suggestion-muted"
                    onClick={() => {
                      onDismissSpellcheckIssue?.({
                        blockId: activeSpellcheckPopover.blockId,
                        issueId: issue.id
                      });
                      setActiveSpellcheckPopover(null);
                    }}
                  >
                    × Залишити як є
                  </button>
                </div>
              ) : (
                <div className="spellcheck-popover-suggestions">
                  <button
                    type="button"
                    className="spellcheck-popover-suggestion spellcheck-popover-suggestion-muted"
                    onClick={() => {
                      onDismissSpellcheckIssue?.({
                        blockId: activeSpellcheckPopover.blockId,
                        issueId: issue.id
                      });
                      setActiveSpellcheckPopover(null);
                    }}
                  >
                    × Залишити як є
                  </button>
                </div>
              )}
            </div>
          );
        })()
      ) : null}

      {activeEmphasisPopover ? (
        (() => {
          const suggestion = emphasisSuggestionMap.get(activeEmphasisPopover.itemId);

          if (!suggestion) {
            return null;
          }

          return (
            <div
              className="emphasis-popover"
              style={{
                top: `${Math.max(16, activeEmphasisPopover.top)}px`,
                left: `${Math.max(16, activeEmphasisPopover.left)}px`
              }}
            >
              <div className="emphasis-popover-head">
                <div className="emphasis-popover-title-stack">
                  <strong>{suggestion.phrase}</strong>
                  <p className="emphasis-popover-copy">{suggestion.reason}</p>
                </div>
                <button
                  type="button"
                  className="spellcheck-popover-close"
                  aria-label="Закрити підказки"
                  onClick={() => setActiveEmphasisPopover(null)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <div className="emphasis-popover-actions">
                <button
                  type="button"
                  className="emphasis-popover-action"
                  onClick={() => {
                    onApplyEmphasisSuggestion?.({ itemId: suggestion.itemId });
                    setActiveEmphasisPopover(null);
                  }}
                >
                  Погодити
                </button>
                <button
                  type="button"
                  className="emphasis-popover-action emphasis-popover-action-muted"
                  onClick={() => {
                    onDismissEmphasisSuggestion?.({ itemId: suggestion.itemId });
                    setActiveEmphasisPopover(null);
                  }}
                >
                  Відхилити
                </button>
              </div>
            </div>
          );
        })()
      ) : null}
    </div>
  );
}

function BlockRenderer({
  block,
  spellcheckIssues,
  emphasisSuggestions,
  onSpellcheckIssueClick,
  onEmphasisSuggestionClick,
  disabled,
  registerEditable,
  onEditFocus,
  onTextBlockEnter,
  onTextBlockBackspace,
  onSoftBreak,
  onListItemEnter,
  onListItemBackspace,
  onBlockChange,
  onAddTableRow,
  onRemoveTableRow,
  onAddTableColumn,
  onRemoveTableColumn
}: {
  block: Block;
  spellcheckIssues?: SpellcheckIssue[];
  emphasisSuggestions?: EmphasisSuggestion[];
  onSpellcheckIssueClick?: (blockId: string, issueId: string, rect: DOMRect) => void;
  onEmphasisSuggestionClick?: (blockId: string, itemId: string, rect: DOMRect) => void;
  disabled?: boolean;
  registerEditable: (key: string, element: HTMLElement | null) => void;
  onEditFocus: (blockId: string, editableKey: string) => void;
  onTextBlockEnter: (block: ParagraphBlock | HeadingBlock, context: RichTextContext) => void;
  onTextBlockBackspace: (block: ParagraphBlock | HeadingBlock, context: RichTextContext) => boolean;
  onSoftBreak: (context: RichTextContext) => void;
  onListItemEnter: (block: BulletListBlock | OrderedListBlock, itemIndex: number, context: RichTextContext) => void;
  onListItemBackspace: (block: BulletListBlock | OrderedListBlock, itemIndex: number, context: RichTextContext) => boolean;
  onBlockChange: (block: Block) => void;
  onAddTableRow: (block: TableBlock) => void;
  onRemoveTableRow: (block: TableBlock) => void;
  onAddTableColumn: (block: TableBlock) => void;
  onRemoveTableColumn: (block: TableBlock) => void;
}) {
  if (block.type === "paragraph" || block.type === "heading") {
    return (
      <EditableTextBlock
        block={block}
        spellcheckIssues={spellcheckIssues}
        emphasisSuggestions={emphasisSuggestions}
        onSpellcheckIssueClick={onSpellcheckIssueClick}
        onEmphasisSuggestionClick={onEmphasisSuggestionClick}
        disabled={disabled}
        registerEditable={registerEditable}
        onEditFocus={onEditFocus}
        onBlockChange={onBlockChange}
        onEnter={onTextBlockEnter}
        onBackspace={onTextBlockBackspace}
        onSoftBreak={onSoftBreak}
      />
    );
  }

  if (block.type === "bullet_list" || block.type === "ordered_list") {
    return (
      <EditableListBlock
        block={block}
        emphasisSuggestions={emphasisSuggestions}
        onEmphasisSuggestionClick={onEmphasisSuggestionClick}
        disabled={disabled}
        registerEditable={registerEditable}
        onEditFocus={onEditFocus}
        onBlockChange={onBlockChange}
        onEnter={onListItemEnter}
        onBackspace={onListItemBackspace}
        onSoftBreak={onSoftBreak}
      />
    );
  }

  if (block.type === "callout") {
    return (
      <EditableCalloutBlock
        block={block}
        emphasisSuggestions={emphasisSuggestions}
        onEmphasisSuggestionClick={onEmphasisSuggestionClick}
        disabled={disabled}
        registerEditable={registerEditable}
        onEditFocus={onEditFocus}
        onBlockChange={onBlockChange}
        onSoftBreak={onSoftBreak}
      />
    );
  }

  if (block.type === "table") {
    return (
      <EditableTableBlock
        block={block}
        emphasisSuggestions={emphasisSuggestions}
        onEmphasisSuggestionClick={onEmphasisSuggestionClick}
        disabled={disabled}
        registerEditable={registerEditable}
        onEditFocus={onEditFocus}
        onBlockChange={onBlockChange}
        onSoftBreak={onSoftBreak}
        onAddRow={onAddTableRow}
        onRemoveRow={onRemoveTableRow}
        onAddColumn={onAddTableColumn}
        onRemoveColumn={onRemoveTableColumn}
      />
    );
  }

  if (block.type === "image") {
    return <EditableImageBlock block={block} emphasisSuggestions={emphasisSuggestions} onEmphasisSuggestionClick={onEmphasisSuggestionClick} disabled={disabled} onEditFocus={onEditFocus} onBlockChange={onBlockChange} registerEditable={registerEditable} onSoftBreak={onSoftBreak} />;
  }

  return <div className="block-divider" aria-hidden="true" />;
}

function EditableTextBlock({
  block,
  spellcheckIssues,
  emphasisSuggestions,
  onSpellcheckIssueClick,
  onEmphasisSuggestionClick,
  disabled,
  registerEditable,
  onEditFocus,
  onBlockChange,
  onEnter,
  onBackspace,
  onSoftBreak
}: {
  block: ParagraphBlock | HeadingBlock;
  spellcheckIssues?: SpellcheckIssue[];
  emphasisSuggestions?: EmphasisSuggestion[];
  onSpellcheckIssueClick?: (blockId: string, issueId: string, rect: DOMRect) => void;
  onEmphasisSuggestionClick?: (blockId: string, itemId: string, rect: DOMRect) => void;
  disabled?: boolean;
  registerEditable: (key: string, element: HTMLElement | null) => void;
  onEditFocus: (blockId: string, editableKey: string) => void;
  onBlockChange: (block: ParagraphBlock | HeadingBlock) => void;
  onEnter: (block: ParagraphBlock | HeadingBlock, context: RichTextContext) => void;
  onBackspace: (block: ParagraphBlock | HeadingBlock, context: RichTextContext) => boolean;
  onSoftBreak: (context: RichTextContext) => void;
}) {
  const className =
    block.type === "heading"
      ? block.level === 1
        ? "block-text block-text-heading-1"
        : block.level === 2
          ? "block-text block-text-heading-2"
          : "block-text block-text-heading-3"
      : "block-text block-text-paragraph";

  return (
    <EditableRichText
      focusKey={makeEditableKey(block.id)}
      className={className}
      html={inlineNodesToHtml(block.id, block.content, spellcheckIssues, emphasisSuggestions)}
      disabled={disabled}
      registerEditable={registerEditable}
      onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
      onChange={(content) => onBlockChange({ ...block, content })}
      onEnter={(context) => onEnter(block, context)}
      onBackspace={(context) => onBackspace(block, context)}
      onSoftBreak={onSoftBreak}
      onSpellcheckIssueClick={(issueId, rect) => onSpellcheckIssueClick?.(block.id, issueId, rect)}
      onEmphasisSuggestionClick={(itemId, rect) => onEmphasisSuggestionClick?.(block.id, itemId, rect)}
    />
  );
}

function EditableListBlock({
  block,
  emphasisSuggestions,
  onEmphasisSuggestionClick,
  disabled,
  registerEditable,
  onEditFocus,
  onBlockChange,
  onEnter,
  onBackspace,
  onSoftBreak
}: {
  block: BulletListBlock | OrderedListBlock;
  emphasisSuggestions?: EmphasisSuggestion[];
  onEmphasisSuggestionClick?: (blockId: string, itemId: string, rect: DOMRect) => void;
  disabled?: boolean;
  registerEditable: (key: string, element: HTMLElement | null) => void;
  onEditFocus: (blockId: string, editableKey: string) => void;
  onBlockChange: (block: BulletListBlock | OrderedListBlock) => void;
  onEnter: (block: BulletListBlock | OrderedListBlock, itemIndex: number, context: RichTextContext) => void;
  onBackspace: (block: BulletListBlock | OrderedListBlock, itemIndex: number, context: RichTextContext) => boolean;
  onSoftBreak: (context: RichTextContext) => void;
}) {
  const Tag = block.type === "bullet_list" ? "ul" : "ol";

  return (
    <div className="block-list-shell">
      <Tag className="block-list">
        {block.items.map((item, index) => (
          <li key={`${block.id}-${index}`}>
            <EditableRichText
              focusKey={makeEditableKey(block.id, `item-${index}`)}
              className="block-list-item"
              html={inlineNodesToHtml(block.id, item, [], emphasisSuggestions)}
              disabled={disabled}
              registerEditable={registerEditable}
              onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
              onChange={(content) => {
                const nextItems = block.items.slice();
                nextItems[index] = content;
                onBlockChange({ ...block, items: nextItems });
              }}
              onEnter={(context) => onEnter(block, index, context)}
              onBackspace={(context) => onBackspace(block, index, context)}
              onSoftBreak={onSoftBreak}
              onEmphasisSuggestionClick={(itemId, rect) => onEmphasisSuggestionClick?.(block.id, itemId, rect)}
            />
          </li>
        ))}
      </Tag>
    </div>
  );
}

function EditableCalloutBlock({
  block,
  emphasisSuggestions,
  onEmphasisSuggestionClick,
  disabled,
  registerEditable,
  onEditFocus,
  onBlockChange,
  onSoftBreak
}: {
  block: CalloutBlock;
  emphasisSuggestions?: EmphasisSuggestion[];
  onEmphasisSuggestionClick?: (blockId: string, itemId: string, rect: DOMRect) => void;
  disabled?: boolean;
  registerEditable: (key: string, element: HTMLElement | null) => void;
  onEditFocus: (blockId: string, editableKey: string) => void;
  onBlockChange: (block: CalloutBlock) => void;
  onSoftBreak: (context: RichTextContext) => void;
}) {
  return (
    <div className="block-callout-shell" data-kind={block.kind}>
      <div className="block-callout-head">
        <label className="block-callout-kind-field">
          <select
            className="block-callout-kind-select"
            value={block.kind}
            onChange={(event) => {
              const nextKind = event.target.value as EditorialCalloutKind;
              const currentTitle = getInlineText(block.title).trim();
              const currentDefaultTitle = getEditorialCalloutKindTitle(block.kind);
              const nextDefaultTitle = getEditorialCalloutKindTitle(nextKind);
              const shouldReplaceTitle = currentTitle.length === 0 || currentTitle === currentDefaultTitle;

              onBlockChange({
                ...block,
                kind: nextKind,
                title: shouldReplaceTitle ? [createInlineText(nextDefaultTitle)] : block.title
              });
            }}
            disabled={disabled}
            aria-label="Тип врізки"
            title={getEditorialCalloutKindLabel(block.kind)}
          >
            {getEditorialCalloutKindOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <EditableRichText
        focusKey={makeEditableKey(block.id, "callout-title")}
        className="block-callout-title"
        html={inlineNodesToHtml(block.id, block.title, [], emphasisSuggestions)}
        disabled={disabled}
        registerEditable={registerEditable}
        onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
        onChange={(title) => onBlockChange({ ...block, title })}
        onSoftBreak={onSoftBreak}
        onEmphasisSuggestionClick={(itemId, rect) => onEmphasisSuggestionClick?.(block.id, itemId, rect)}
      />
      {block.body.map((paragraph, index) => (
        <EditableRichText
          key={`${block.id}-${index}`}
          focusKey={makeEditableKey(block.id, `callout-body-${index}`)}
          className="block-callout-body"
          html={inlineNodesToHtml(block.id, paragraph, [], emphasisSuggestions)}
          disabled={disabled}
          registerEditable={registerEditable}
          onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
          onChange={(content) => {
            const nextBody = block.body.slice();
            nextBody[index] = content;
            onBlockChange({ ...block, body: nextBody });
          }}
          onSoftBreak={onSoftBreak}
          onEmphasisSuggestionClick={(itemId, rect) => onEmphasisSuggestionClick?.(block.id, itemId, rect)}
        />
      ))}
    </div>
  );
}

function EditableTableBlock({
  block,
  emphasisSuggestions,
  onEmphasisSuggestionClick,
  disabled,
  registerEditable,
  onEditFocus,
  onBlockChange,
  onSoftBreak,
  onAddRow,
  onRemoveRow,
  onAddColumn,
  onRemoveColumn
}: {
  block: TableBlock;
  emphasisSuggestions?: EmphasisSuggestion[];
  onEmphasisSuggestionClick?: (blockId: string, itemId: string, rect: DOMRect) => void;
  disabled?: boolean;
  registerEditable: (key: string, element: HTMLElement | null) => void;
  onEditFocus: (blockId: string, editableKey: string) => void;
  onBlockChange: (block: TableBlock) => void;
  onSoftBreak: (context: RichTextContext) => void;
  onAddRow: (block: TableBlock) => void;
  onRemoveRow: (block: TableBlock) => void;
  onAddColumn: (block: TableBlock) => void;
  onRemoveColumn: (block: TableBlock) => void;
}) {
  return (
    <div className="block-table-shell">
      <table className="block-table">
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`${block.id}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${block.id}-${rowIndex}-${cellIndex}`}>
                  <EditableRichText
                    focusKey={makeEditableKey(block.id, `cell-${rowIndex}-${cellIndex}`)}
                    className="block-table-cell"
                    html={inlineNodesToHtml(block.id, cell, [], emphasisSuggestions)}
                    disabled={disabled}
                    registerEditable={registerEditable}
                    onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
                    onChange={(content) => {
                      const nextRows = block.rows.map((entry) => entry.map((part) => part.slice()));
                      nextRows[rowIndex][cellIndex] = content;
                      onBlockChange({ ...block, rows: nextRows });
                    }}
                    onSoftBreak={onSoftBreak}
                    onEmphasisSuggestionClick={(itemId, rect) => onEmphasisSuggestionClick?.(block.id, itemId, rect)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="block-inline-actions">
        <button type="button" className="block-mini-action" onClick={() => onAddRow(block)} title="Додати рядок">+↕</button>
        <button type="button" className="block-mini-action" onClick={() => onRemoveRow(block)} title="Видалити рядок">−↕</button>
        <button type="button" className="block-mini-action" onClick={() => onAddColumn(block)} title="Додати колонку">+↔</button>
        <button type="button" className="block-mini-action" onClick={() => onRemoveColumn(block)} title="Видалити колонку">−↔</button>
      </div>
    </div>
  );
}

function EditableImageBlock({
  block,
  emphasisSuggestions,
  onEmphasisSuggestionClick,
  disabled,
  registerEditable,
  onEditFocus,
  onBlockChange,
  onSoftBreak
}: {
  block: ImageBlock;
  emphasisSuggestions?: EmphasisSuggestion[];
  onEmphasisSuggestionClick?: (blockId: string, itemId: string, rect: DOMRect) => void;
  disabled?: boolean;
  registerEditable: (key: string, element: HTMLElement | null) => void;
  onEditFocus: (blockId: string, editableKey: string) => void;
  onBlockChange: (block: ImageBlock) => void;
  onSoftBreak: (context: RichTextContext) => void;
}) {
  const { resolvedUrl } = useResolvedEditorAssetUrl(createEditorAssetToken(block.assetId));

  return (
    <div className="block-image-shell">
      {resolvedUrl ? <img src={resolvedUrl} alt={block.alt} className="block-image" /> : <div className="block-image-placeholder">image</div>}
      <input
        className="block-image-alt mono-ui"
        value={block.alt}
        onFocus={() => onEditFocus(block.id, makeEditableKey(block.id, "image-alt"))}
        onChange={(event) => onBlockChange({ ...block, alt: event.currentTarget.value })}
        disabled={disabled}
      />
      <EditableRichText
        focusKey={makeEditableKey(block.id, "image-caption")}
        className="block-image-caption"
        html={inlineNodesToHtml(block.id, block.caption ?? [createInlineText("")], [], emphasisSuggestions)}
        disabled={disabled}
        registerEditable={registerEditable}
        onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
        onChange={(caption) => onBlockChange({ ...block, caption })}
        onSoftBreak={onSoftBreak}
        onEmphasisSuggestionClick={(itemId, rect) => onEmphasisSuggestionClick?.(block.id, itemId, rect)}
      />
    </div>
  );
}

function EditableRichText({
  focusKey,
  className,
  html,
  disabled,
  registerEditable,
  onEditFocus,
  onChange,
  onEnter,
  onBackspace,
  onSoftBreak,
  onSpellcheckIssueClick,
  onEmphasisSuggestionClick
}: {
  focusKey: string;
  className: string;
  html: string;
  disabled?: boolean;
  registerEditable: (key: string, element: HTMLElement | null) => void;
  onEditFocus: (editableKey: string) => void;
  onChange: (content: InlineNode[]) => void;
  onEnter?: (context: RichTextContext) => void;
  onBackspace?: (context: RichTextContext) => boolean;
  onSoftBreak?: (context: RichTextContext) => void;
  onSpellcheckIssueClick?: (issueId: string, rect: DOMRect) => void;
  onEmphasisSuggestionClick?: (itemId: string, rect: DOMRect) => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const baselineContent = useMemo(() => htmlToInlineNodes(html), [html]);

  useLayoutEffect(() => {
    const element = elementRef.current;

    if (!element) {
      return;
    }

    if (element.innerHTML !== html) {
      const isActive = window.document.activeElement === element;
      const matchesCurrentContent = areInlineNodesEqual(htmlToInlineNodes(element.innerHTML), baselineContent);
      const hasInteractiveMarkup =
        html.includes("spellcheck-underline") ||
        element.innerHTML.includes("spellcheck-underline") ||
        html.includes("emphasis-suggestion") ||
        element.innerHTML.includes("emphasis-suggestion");

      if (isActive && matchesCurrentContent && !hasInteractiveMarkup) {
        return;
      }

      const caretOffset = isActive ? getCaretOffset(element) : null;

      element.innerHTML = html;

      if (isActive) {
        placeCaretAtOffset(element, Math.min(caretOffset ?? getNodeTextLength(element), getNodeTextLength(element)));
      }
    }
  }, [html]);

  function buildContext(element: HTMLDivElement): RichTextContext | null {
    const caretOffset = getCaretOffset(element);

    if (caretOffset === null) {
      return null;
    }

    return {
      element,
      html: element.innerHTML,
      content: htmlToInlineNodes(element.innerHTML),
      caretOffset
    };
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const inlineFormatCommand = getInlineFormatHotkeyCommand(event);

    if (inlineFormatCommand) {
      event.preventDefault();
      applyEditingCommand(event.currentTarget, inlineFormatCommand);
      return;
    }

    const undoRedoAction = getUndoRedoHotkeyAction(event);

    if (undoRedoAction) {
      event.preventDefault();
      applyEditingCommand(event.currentTarget, undoRedoAction);
      return;
    }

    const context = buildContext(event.currentTarget);

    if (!context) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      if (event.shiftKey) {
        onSoftBreak?.(context);
        return;
      }

      onEnter?.(context);
      return;
    }

    if (event.key === "Backspace" && onBackspace?.(context)) {
      event.preventDefault();
    }
  }

  function emitChangeIfNeeded(nextHtml: string) {
    const nextContent = htmlToInlineNodes(nextHtml);

    if (areInlineNodesEqual(nextContent, baselineContent)) {
      return;
    }

    onChange(nextContent);
  }

  function applyEditingCommand(element: HTMLDivElement, command: "bold" | "italic" | "undo" | "redo") {
    const selectionOffsets = getSelectionOffsets(element);

    element.focus({ preventScroll: true });
    restoreSelectionOffsets(selectionOffsets, element);
    window.document.execCommand(command);
    restoreSelectionOffsets(selectionOffsets, element);
    emitChangeIfNeeded(element.innerHTML);

    if (command === "bold" || command === "italic") {
      scheduleSelectionRestore(selectionOffsets, element);
    }
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const underline = target.closest<HTMLElement>(".spellcheck-underline[data-spellcheck-issue-id]");

    if (underline) {
      const issueId = underline.dataset.spellcheckIssueId;

      if (!issueId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onSpellcheckIssueClick?.(issueId, underline.getBoundingClientRect());
      return;
    }

    const emphasis = target.closest<HTMLElement>(".emphasis-suggestion[data-emphasis-item-id]");

    if (!emphasis) {
      return;
    }

    const itemId = emphasis.dataset.emphasisItemId;

    if (!itemId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onEmphasisSuggestionClick?.(itemId, emphasis.getBoundingClientRect());
  }

  return (
    <div
      ref={(element) => {
        elementRef.current = element;
        registerEditable(focusKey, element);

        if (element && element.innerHTML !== html) {
          element.innerHTML = html;
        }
      }}
      className={className}
      contentEditable={!disabled}
      suppressContentEditableWarning
      onFocus={() => onEditFocus(focusKey)}
      onBlur={(event) => emitChangeIfNeeded(event.currentTarget.innerHTML)}
      onInput={(event) => emitChangeIfNeeded(event.currentTarget.innerHTML)}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    />
  );
}

function toParagraphBlock(block: Block): ParagraphBlock {
  return {
    id: block.id,
    type: "paragraph",
    content: [createInlineText(getBlockTextForParagraph(block))]
  };
}

function toHeadingBlock(block: Block, level: 1 | 2 | 3): HeadingBlock {
  return {
    id: block.id,
    type: "heading",
    level,
    content: [createInlineText(getBlockPreviewText(block))]
  };
}

function toListBlock(block: Block, type: "bullet_list" | "ordered_list"): BulletListBlock | OrderedListBlock {
  const sourceText = getBlockTextForParagraph(block);
  const items = sourceText
    .split(/\n+|[•*-]\s+|\d+[.)]\s+|[.;]\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => [createInlineText(item)]);

  return {
    id: block.id,
    type,
    items: items.length > 0 ? items : [[createInlineText("")]]
  };
}

function toCalloutBlock(block: Block): CalloutBlock {
  return {
    id: block.id,
    type: "callout",
    kind: "mechanism",
    title: [createInlineText(getEditorialCalloutKindTitle("mechanism"))],
    body: [[createInlineText(getBlockPreviewText(block))]]
  };
}

function toTableBlock(block: Block): TableBlock {
  return {
    id: block.id,
    type: "table",
    rows: [[[createInlineText("Колонка 1")], [createInlineText("Колонка 2")]], [[createInlineText(getBlockPreviewText(block))], [createInlineText("")]]]
  };
}

function getBlockPreviewText(block: Block): string {
  if (block.type === "paragraph" || block.type === "heading") {
    return getInlineText(block.content);
  }

  if (block.type === "bullet_list" || block.type === "ordered_list") {
    return block.items.map((item) => getInlineText(item)).join(". ");
  }

  if (block.type === "callout") {
    return [getInlineText(block.title), ...block.body.map((part) => getInlineText(part))].filter(Boolean).join(". ");
  }

  if (block.type === "table") {
    return block.rows.map((row) => row.map((cell) => getInlineText(cell)).join(" ")).join(". ");
  }

  if (block.type === "image") {
    return [block.alt, getInlineText(block.caption ?? [])].filter(Boolean).join(". ");
  }

  return "";
}

function getBlockTextForParagraph(block: Block): string {
  if (block.type === "bullet_list" || block.type === "ordered_list") {
    return block.items.map((item) => getInlineText(item)).join("\n");
  }

  return getBlockPreviewText(block);
}

function makeEditableKey(blockId: string, slot = "main"): string {
  return `${blockId}:${slot}`;
}

function splitInlineNodes(nodes: InlineNode[], offset: number): [InlineNode[], InlineNode[]] {
  const left: InlineNode[] = [];
  const right: InlineNode[] = [];
  let consumed = 0;

  for (const node of nodes) {
    const text = node.text ?? "";
    const start = consumed;
    const end = start + text.length;

    if (offset <= start) {
      right.push({ ...node });
    } else if (offset >= end) {
      left.push({ ...node });
    } else {
      const splitPoint = offset - start;
      const leftText = text.slice(0, splitPoint);
      const rightText = text.slice(splitPoint);

      if (leftText) {
        left.push({ ...node, text: leftText });
      }

      if (rightText) {
        right.push({ ...node, text: rightText });
      }
    }

    consumed = end;
  }

  return [normalizeInlineNodes(left), normalizeInlineNodes(right)];
}

function isInlineContentEmpty(nodes: InlineNode[]): boolean {
  return nodes.every((node) => node.text.replace(/\n/g, "").trim().length === 0);
}

function inlineNodesToHtml(
  blockId: string,
  nodes: InlineNode[],
  spellcheckIssues: SpellcheckIssue[] = [],
  emphasisSuggestions: EmphasisSuggestion[] = []
): string {
  const boundaries = new Set<number>([0]);
  const textLength = nodes.reduce((sum, node) => sum + (node.text?.length ?? 0), 0);
  boundaries.add(textLength);

  for (const issue of spellcheckIssues) {
    boundaries.add(Math.max(0, Math.min(textLength, issue.range.start)));
    boundaries.add(Math.max(0, Math.min(textLength, issue.range.end)));
  }

  for (const suggestion of emphasisSuggestions) {
    boundaries.add(Math.max(0, Math.min(textLength, suggestion.range.start)));
    boundaries.add(Math.max(0, Math.min(textLength, suggestion.range.end)));
  }

  const sortedBoundaries = Array.from(boundaries).sort((left, right) => left - right);
  const segments = splitInlineNodesAtBoundaries(nodes, sortedBoundaries);
  let consumed = 0;

  return segments
    .map((node) => {
      const start = consumed;
      const end = start + node.text.length;
      consumed = end;

      let content = escapeHtml(node.text).replace(/\n/g, "<br>");

      if (node.link) {
        content = `<a href="${escapeAttribute(node.link)}">${content}</a>`;
      }

      if (node.italic) {
        content = `<em>${content}</em>`;
      }

      if (node.bold) {
        content = `<strong>${content}</strong>`;
      }

      const activeIssue = spellcheckIssues.find((issue) => issue.range.start <= start && issue.range.end >= end && start < end);
      const activeEmphasis = emphasisSuggestions.find(
        (suggestion) => suggestion.range.start <= start && suggestion.range.end >= end && start < end
      );

      if (activeIssue) {
        content = `<span class="spellcheck-underline" data-spellcheck-block-id="${escapeAttribute(blockId)}" data-spellcheck-issue-id="${escapeAttribute(activeIssue.id)}" data-spellcheck-category="${escapeAttribute(activeIssue.category)}" title="${escapeAttribute(activeIssue.message)}">${content}</span>`;
      }

      if (activeEmphasis) {
        content = `<span class="emphasis-suggestion" data-emphasis-block-id="${escapeAttribute(blockId)}" data-emphasis-item-id="${escapeAttribute(activeEmphasis.itemId)}" title="${escapeAttribute(activeEmphasis.reason)}">${content}</span>`;
      }

      return content;
    })
    .join("");
}

function splitInlineNodesAtBoundaries(nodes: InlineNode[], boundaries: number[]): InlineNode[] {
  const result: InlineNode[] = [];
  let consumed = 0;

  for (const node of nodes) {
    const text = node.text ?? "";
    const nodeStart = consumed;
    const nodeEnd = nodeStart + text.length;
    const innerBoundaries = boundaries.filter((boundary) => boundary > nodeStart && boundary < nodeEnd);

    if (innerBoundaries.length === 0) {
      if (text.length > 0) {
        result.push({ ...node });
      }
      consumed = nodeEnd;
      continue;
    }

    let sliceStart = nodeStart;

    for (const boundary of [...innerBoundaries, nodeEnd]) {
      const localStart = sliceStart - nodeStart;
      const localEnd = boundary - nodeStart;
      const part = text.slice(localStart, localEnd);

      if (part) {
        result.push({ ...node, text: part });
      }

      sliceStart = boundary;
    }

    consumed = nodeEnd;
  }

  return result;
}

function htmlToInlineNodes(html: string): InlineNode[] {
  if (typeof window === "undefined") {
    return [createInlineText(html.replace(/<[^>]+>/g, ""))];
  }

  const root = window.document.createElement("div");
  root.innerHTML = html;
  const nodes: InlineNode[] = [];

  function walk(node: Node, marks: Omit<InlineNode, "text"> = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      nodes.push({
        text: node.textContent ?? "",
        ...marks
      });
      return;
    }

    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (node.tagName === "BR") {
      nodes.push({ text: "\n", ...marks });
      return;
    }

    const nextMarks = {
      bold: marks.bold || node.tagName === "B" || node.tagName === "STRONG" ? true : undefined,
      italic: marks.italic || node.tagName === "I" || node.tagName === "EM" ? true : undefined,
      link: node.tagName === "A" ? node.getAttribute("href") || marks.link : marks.link
    } satisfies Omit<InlineNode, "text">;

    Array.from(node.childNodes).forEach((child) => walk(child, nextMarks));
  }

  Array.from(root.childNodes).forEach((child) => walk(child));
  return normalizeInlineNodes(nodes);
}

function areInlineNodesEqual(left: InlineNode[], right: InlineNode[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((node, index) => {
    const other = right[index];
    return (
      node.text === other?.text &&
      node.bold === other?.bold &&
      node.italic === other?.italic &&
      node.link === other?.link
    );
  });
}

function getSelectionOffsets(element: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!isRangeInsideElement(range, element)) {
    return null;
  }

  return {
    start: getTextOffsetWithin(element, range.startContainer, range.startOffset),
    end: getTextOffsetWithin(element, range.endContainer, range.endOffset)
  };
}

function restoreSelectionOffsets(offsets: { start: number; end: number } | null, element: HTMLElement) {
  if (!offsets) {
    return;
  }

  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const startPosition = resolveDomPosition(element, offsets.start);
  const endPosition = resolveDomPosition(element, offsets.end);
  const range = window.document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function scheduleSelectionRestore(offsets: { start: number; end: number } | null, element: HTMLElement) {
  if (!offsets) {
    return;
  }

  window.setTimeout(() => {
    if (!window.document.body.contains(element)) {
      return;
    }

    restoreSelectionOffsets(offsets, element);
  }, 0);
}

function isRangeInsideElement(range: Range, element: HTMLElement): boolean {
  return element.contains(range.commonAncestorContainer);
}

function getCaretOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);

  if (!range.collapsed || !root.contains(range.startContainer)) {
    return null;
  }

  return getTextOffsetWithin(root, range.startContainer, range.startOffset);
}

function getTextOffsetWithin(root: Node, container: Node, offset: number): number {
  if (root === container) {
    if (root.nodeType === Node.TEXT_NODE) {
      return offset;
    }

    let total = 0;

    for (let index = 0; index < offset; index += 1) {
      const child = root.childNodes[index];
      if (child) {
        total += getNodeTextLength(child);
      }
    }

    return total;
  }

  let total = 0;

  for (const child of Array.from(root.childNodes)) {
    if (child === container || child.contains(container)) {
      return total + getTextOffsetWithin(child, container, offset);
    }

    total += getNodeTextLength(child);
  }

  return total;
}

function getNodeTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }

  if (node instanceof HTMLElement && node.tagName === "BR") {
    return 1;
  }

  return Array.from(node.childNodes).reduce((sum, child) => sum + getNodeTextLength(child), 0);
}

function placeCaret(root: HTMLElement, placement: CaretPlacement) {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const offset = placement === "start" ? 0 : getNodeTextLength(root);
  const position = resolveDomPosition(root, offset);
  const range = window.document.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtOffset(root: HTMLElement, targetOffset: number) {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const position = resolveDomPosition(root, targetOffset);
  const range = window.document.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function resolveDomPosition(root: Node, targetOffset: number): { node: Node; offset: number } {
  if (root.nodeType === Node.TEXT_NODE) {
    return { node: root, offset: Math.min(targetOffset, root.textContent?.length ?? 0) };
  }

  if (root instanceof HTMLElement && root.tagName === "BR") {
    const parent = root.parentNode ?? root;
    const index = parent.childNodes ? Array.from(parent.childNodes).indexOf(root) : 0;
    return { node: parent, offset: Math.max(0, index) };
  }

  let remaining = targetOffset;
  const children = Array.from(root.childNodes);

  for (const child of children) {
    const length = getNodeTextLength(child);

    if (remaining <= length) {
      return resolveDomPosition(child, remaining);
    }

    remaining -= length;
  }

  return { node: root, offset: children.length };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
