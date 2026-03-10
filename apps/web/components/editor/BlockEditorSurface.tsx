"use client";

import type { ChangeEvent, KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
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
  normalizeBlockSelection,
  normalizeInlineNodes,
  removeBlocksByIds,
  type DividerBlock
} from "../../lib/editor/document-model";
import { getEditorialCalloutKindLabel } from "../../lib/editor/review-contract";
import { formatParagraphLabel } from "../../lib/editor/manuscript-structure";
import { Button } from "../ui/Button";
import { useResolvedEditorAssetUrl } from "./ResolvedEditorImage";

type BlockFormatAction = "paragraph" | "heading-1" | "heading-2" | "heading-3" | "bullet-list" | "ordered-list" | "divider" | "callout" | "table";
type CaretPlacement = "start" | "end";
type PendingFocusTarget = { key: string; placement: CaretPlacement };

type RichTextContext = {
  element: HTMLDivElement;
  html: string;
  content: InlineNode[];
  caretOffset: number;
};

export function BlockEditorSurface({
  document,
  selection,
  focusedBlockId,
  disabled,
  onDocumentChange,
  onSelectionChange,
  onFocusedBlockChange,
  onInsertImage
}: {
  document: EditorDocument;
  selection: BlockSelection;
  focusedBlockId: string | null;
  disabled?: boolean;
  onDocumentChange: (document: EditorDocument) => void;
  onSelectionChange: (selection: BlockSelection) => void;
  onFocusedBlockChange: (blockId: string | null) => void;
  onInsertImage: (file: File, anchorBlockId: string | null) => Promise<void>;
}) {
  const editableRefs = useRef(new Map<string, HTMLElement>());
  const dragAnchorBlockId = useRef<string | null>(null);
  const activeEditableKey = useRef<string | null>(null);
  const pendingFocusTarget = useRef<PendingFocusTarget | null>(null);
  const normalizedSelection = useMemo(() => normalizeBlockSelection(document, selection), [document, selection]);

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
    placeCaret(target, pending.placement);
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

  function handleFormatCommand(command: "bold" | "italic" | "link") {
    const targetKey = activeEditableKey.current ?? focusedBlockId;

    if (!targetKey || disabled) {
      return;
    }

    const element = editableRefs.current.get(targetKey);

    if (!element) {
      return;
    }

    element.focus();

    if (command === "link") {
      const href = window.prompt("Посилання", "https://");

      if (!href) {
        return;
      }

      window.document.execCommand("createLink", false, href);
    } else {
      window.document.execCommand(command);
    }
  }

  function handleBlockFormat(action: BlockFormatAction) {
    const targetIds = normalizedSelection.blockIds.length > 0 ? normalizedSelection.blockIds : focusedBlockId ? [focusedBlockId] : [];

    if (targetIds.length === 0) {
      return;
    }

    const targetSet = new Set(targetIds);
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
        transformed.push(toListBlock(block, "bullet_list"));
        continue;
      }

      if (action === "ordered-list") {
        transformed.push(toListBlock(block, "ordered_list"));
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
    window.document.execCommand("insertLineBreak");
    queueMicrotask(() => context.element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertLineBreak" })));
  }

  function handleTextBlockBackspace(block: ParagraphBlock | HeadingBlock, context: RichTextContext): boolean {
    if (getInlineText(context.content).length > 0 || context.caretOffset > 0) {
      return false;
    }

    deleteBlock(block.id);
    return true;
  }

  function handleListItemEnter(block: BulletListBlock | OrderedListBlock, itemIndex: number, context: RichTextContext) {
    const currentText = getInlineText(context.content);

    if (currentText.length === 0) {
      replaceBlock(block.id, createEmptyParagraphBlock(block.id));
      setPendingFocus(makeEditableKey(block.id), "start");
      onFocusedBlockChange(block.id);
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
    if (getInlineText(context.content).length > 0 || context.caretOffset > 0) {
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

  return (
    <div className="block-editor-shell">
      <div className="block-editor-toolbar">
        <div className="block-editor-toolbar-group">
          <button type="button" className="block-toolbar-button" onClick={() => handleFormatCommand("bold")} disabled={disabled} title="Жирний">
            B
          </button>
          <button type="button" className="block-toolbar-button" onClick={() => handleFormatCommand("italic")} disabled={disabled} title="Курсив">
            I
          </button>
          <button type="button" className="block-toolbar-button" onClick={() => handleFormatCommand("link")} disabled={disabled} title="Посилання">
            ⛓
          </button>
        </div>

        <div className="block-editor-toolbar-group">
          <button type="button" className="block-toolbar-button" onClick={() => handleBlockFormat("paragraph")} disabled={disabled} title="Абзац">
            T
          </button>
          <button type="button" className="block-toolbar-button" onClick={() => handleBlockFormat("heading-1")} disabled={disabled} title="H1">
            H1
          </button>
          <button type="button" className="block-toolbar-button" onClick={() => handleBlockFormat("heading-2")} disabled={disabled} title="H2">
            H2
          </button>
          <button type="button" className="block-toolbar-button" onClick={() => handleBlockFormat("heading-3")} disabled={disabled} title="H3">
            H3
          </button>
          <button type="button" className="block-toolbar-button" onClick={() => handleBlockFormat("bullet-list")} disabled={disabled} title="Список">
            •
          </button>
          <button type="button" className="block-toolbar-button" onClick={() => handleBlockFormat("ordered-list")} disabled={disabled} title="Нумерований список">
            1.
          </button>
        </div>

        <div className="block-editor-toolbar-group">
          <button type="button" className="block-toolbar-button" onClick={() => insertBlockAfterCurrent(() => createEmptyParagraphBlock())} disabled={disabled} title="Абзац">
            +
          </button>
          <button type="button" className="block-toolbar-button" onClick={() => insertBlockAfterCurrent(() => ({ id: createBlockId("callout"), type: "callout", kind: "quick_fact", title: [createInlineText("Короткий факт")], body: [[createInlineText("")]] }))} disabled={disabled} title="Врізка">
            ◫
          </button>
          <button type="button" className="block-toolbar-button" onClick={() => insertBlockAfterCurrent(() => ({ id: createBlockId("divider"), type: "divider" as DividerBlock["type"] }))} disabled={disabled} title="Роздільник">
            ─
          </button>
          <button type="button" className="block-toolbar-button" onClick={() => insertBlockAfterCurrent(() => ({ id: createBlockId("table"), type: "table", rows: [[[createInlineText("")], [createInlineText("")]], [[createInlineText("")], [createInlineText("")]]] }))} disabled={disabled} title="Таблиця">
            ▦
          </button>
          <label className="block-toolbar-button block-toolbar-button-file" title="Зображення">
            ⊞
            <input type="file" accept="image/*" onChange={handleFileSelection} disabled={disabled} />
          </label>
        </div>
      </div>

      <div className="block-editor-canvas">
        {document.blocks.map((block, index) => {
          const isSelected = normalizedSelection.blockIds.includes(block.id);
          const isFocused = focusedBlockId === block.id;

          return (
            <div
              key={block.id}
              className="block-editor-row"
              data-block-id={block.id}
              data-selected={isSelected ? "true" : "false"}
              data-focused={isFocused ? "true" : "false"}
            >
              <button
                type="button"
                className="block-editor-gutter"
                onMouseDown={(event) => handleGutterMouseDown(block.id, event)}
                onMouseEnter={(event) => handleGutterMouseEnter(block.id, event)}
                title="Виділити блок або діапазон"
              >
                {formatParagraphLabel(index)}
              </button>

              <div className="block-editor-block">
                <button type="button" className="block-row-action" onClick={() => deleteBlock(block.id)} title="Видалити блок" aria-label="Видалити блок">
                  ×
                </button>
                <BlockRenderer
                  block={block}
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
    </div>
  );
}

function BlockRenderer({
  block,
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
    return <EditableImageBlock block={block} disabled={disabled} onEditFocus={onEditFocus} onBlockChange={onBlockChange} registerEditable={registerEditable} onSoftBreak={onSoftBreak} />;
  }

  return <div className="block-divider" aria-hidden="true" />;
}

function EditableTextBlock({
  block,
  disabled,
  registerEditable,
  onEditFocus,
  onBlockChange,
  onEnter,
  onBackspace,
  onSoftBreak
}: {
  block: ParagraphBlock | HeadingBlock;
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
      html={inlineNodesToHtml(block.content)}
      disabled={disabled}
      registerEditable={registerEditable}
      onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
      onChange={(content) => onBlockChange({ ...block, content })}
      onEnter={(context) => onEnter(block, context)}
      onBackspace={(context) => onBackspace(block, context)}
      onSoftBreak={onSoftBreak}
    />
  );
}

function EditableListBlock({
  block,
  disabled,
  registerEditable,
  onEditFocus,
  onBlockChange,
  onEnter,
  onBackspace,
  onSoftBreak
}: {
  block: BulletListBlock | OrderedListBlock;
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
              html={inlineNodesToHtml(item)}
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
            />
          </li>
        ))}
      </Tag>
    </div>
  );
}

function EditableCalloutBlock({
  block,
  disabled,
  registerEditable,
  onEditFocus,
  onBlockChange,
  onSoftBreak
}: {
  block: CalloutBlock;
  disabled?: boolean;
  registerEditable: (key: string, element: HTMLElement | null) => void;
  onEditFocus: (blockId: string, editableKey: string) => void;
  onBlockChange: (block: CalloutBlock) => void;
  onSoftBreak: (context: RichTextContext) => void;
}) {
  return (
    <div className="block-callout-shell" data-kind={block.kind}>
      <div className="block-callout-chip mono-ui">{getEditorialCalloutKindLabel(block.kind)}</div>
      <EditableRichText
        focusKey={makeEditableKey(block.id, "callout-title")}
        className="block-callout-title"
        html={inlineNodesToHtml(block.title)}
        disabled={disabled}
        registerEditable={registerEditable}
        onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
        onChange={(title) => onBlockChange({ ...block, title })}
        onSoftBreak={onSoftBreak}
      />
      {block.body.map((paragraph, index) => (
        <EditableRichText
          key={`${block.id}-${index}`}
          focusKey={makeEditableKey(block.id, `callout-body-${index}`)}
          className="block-callout-body"
          html={inlineNodesToHtml(paragraph)}
          disabled={disabled}
          registerEditable={registerEditable}
          onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
          onChange={(content) => {
            const nextBody = block.body.slice();
            nextBody[index] = content;
            onBlockChange({ ...block, body: nextBody });
          }}
          onSoftBreak={onSoftBreak}
        />
      ))}
    </div>
  );
}

function EditableTableBlock({
  block,
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
                    html={inlineNodesToHtml(cell)}
                    disabled={disabled}
                    registerEditable={registerEditable}
                    onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
                    onChange={(content) => {
                      const nextRows = block.rows.map((entry) => entry.map((part) => part.slice()));
                      nextRows[rowIndex][cellIndex] = content;
                      onBlockChange({ ...block, rows: nextRows });
                    }}
                    onSoftBreak={onSoftBreak}
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
  disabled,
  registerEditable,
  onEditFocus,
  onBlockChange,
  onSoftBreak
}: {
  block: ImageBlock;
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
        html={inlineNodesToHtml(block.caption ?? [createInlineText("")])}
        disabled={disabled}
        registerEditable={registerEditable}
        onEditFocus={(editableKey) => onEditFocus(block.id, editableKey)}
        onChange={(caption) => onBlockChange({ ...block, caption })}
        onSoftBreak={onSoftBreak}
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
  onSoftBreak
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
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;

    if (!element) {
      return;
    }

    if (element.innerHTML !== html && window.document.activeElement !== element) {
      element.innerHTML = html;
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
      onBlur={(event) => onChange(htmlToInlineNodes(event.currentTarget.innerHTML))}
      onInput={(event) => onChange(htmlToInlineNodes(event.currentTarget.innerHTML))}
      onKeyDown={handleKeyDown}
    />
  );
}

function toParagraphBlock(block: Block): ParagraphBlock {
  return {
    id: block.id,
    type: "paragraph",
    content: [createInlineText(getBlockPreviewText(block))]
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
  const sourceText = getBlockPreviewText(block);
  const items = sourceText
    .split(/\n+|[.;]\s+/)
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
    kind: "quick_fact",
    title: [createInlineText("Короткий факт")],
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

function inlineNodesToHtml(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
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

      return content;
    })
    .join("");
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
