"use client";

import type { ChangeEvent } from "react";
import { useMemo, useRef } from "react";
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
  getInlineText,
  hasSelectedBlocks,
  normalizeBlockSelection
} from "../../lib/editor/document-model";
import { getEditorialCalloutKindLabel, type EditorialCalloutKind } from "../../lib/editor/review-contract";
import { formatParagraphLabel } from "../../lib/editor/manuscript-structure";
import { Button } from "../ui/Button";
import { useResolvedEditorAssetUrl } from "./ResolvedEditorImage";

type BlockFormatAction = "paragraph" | "heading-1" | "heading-2" | "heading-3" | "bullet-list" | "ordered-list" | "divider" | "callout" | "table";

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
  const normalizedSelection = useMemo(() => normalizeBlockSelection(document, selection), [document, selection]);

  function registerEditable(blockId: string, element: HTMLElement | null) {
    if (!element) {
      editableRefs.current.delete(blockId);
      return;
    }

    editableRefs.current.set(blockId, element);
  }

  function updateBlock(blockId: string, updater: (block: Block) => Block) {
    onDocumentChange({
      version: 2,
      blocks: document.blocks.map((block) => (block.id === blockId ? updater(block) : block))
    });
  }

  function handleBlockChromeClick(blockId: string, extend: boolean) {
    const nextSelection = extend && normalizedSelection.anchorBlockId
      ? {
          blockIds: [],
          anchorBlockId: normalizedSelection.anchorBlockId,
          focusBlockId: blockId
        }
      : {
          blockIds: [blockId],
          anchorBlockId: blockId,
          focusBlockId: blockId
        };

    onSelectionChange(normalizeBlockSelection(document, nextSelection));
  }

  function handleFormatCommand(command: "bold" | "italic" | "link") {
    const targetId = focusedBlockId ?? normalizedSelection.focusBlockId;

    if (!targetId || disabled) {
      return;
    }

    const element = editableRefs.current.get(targetId);

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

    syncTextBlockFromDom(targetId);
  }

  function syncTextBlockFromDom(blockId: string) {
    const element = editableRefs.current.get(blockId);

    if (!element) {
      return;
    }

    const nextContent = htmlToInlineNodes(element.innerHTML);
    updateBlock(blockId, (block) => {
      if (block.type === "paragraph" || block.type === "heading") {
        return {
          ...block,
          content: nextContent
        };
      }

      return block;
    });
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

    onDocumentChange({
      version: 2,
      blocks: transformed
    });
  }

  function insertBlockAfterCurrent(factory: () => Block) {
    const anchorId = normalizedSelection.focusBlockId ?? focusedBlockId;
    const anchorIndex = anchorId ? document.blocks.findIndex((block) => block.id === anchorId) : -1;
    const nextBlocks = [...document.blocks];
    const insertionIndex = anchorIndex >= 0 ? anchorIndex + 1 : nextBlocks.length;
    const nextBlock = factory();
    nextBlocks.splice(insertionIndex, 0, nextBlock);
    onDocumentChange({ version: 2, blocks: nextBlocks });
    onSelectionChange({
      blockIds: [nextBlock.id],
      anchorBlockId: nextBlock.id,
      focusBlockId: nextBlock.id
    });
    onFocusedBlockChange(nextBlock.id);
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file || !file.type.startsWith("image/")) {
      event.currentTarget.value = "";
      return;
    }

    await onInsertImage(file, normalizedSelection.focusBlockId ?? focusedBlockId);
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
            ¶
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
          <button type="button" className="block-toolbar-button" onClick={() => insertBlockAfterCurrent(() => ({ id: createBlockId("divider"), type: "divider" }))} disabled={disabled} title="Роздільник">
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
            <div key={block.id} className="block-editor-row" data-selected={isSelected ? "true" : "false"} data-focused={isFocused ? "true" : "false"}>
              <button
                type="button"
                className="block-editor-gutter"
                onClick={(event) => handleBlockChromeClick(block.id, event.shiftKey)}
                title="Виділити блок"
              >
                {formatParagraphLabel(index)}
              </button>

              <div
                className="block-editor-block"
                onClick={(event) => {
                  if (event.currentTarget === event.target) {
                    handleBlockChromeClick(block.id, event.shiftKey);
                  }
                }}
              >
                <BlockRenderer
                  block={block}
                  disabled={disabled}
                  registerEditable={registerEditable}
                  onBlockChange={(nextBlock) => updateBlock(block.id, () => nextBlock)}
                  onFocus={() => onFocusedBlockChange(block.id)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="block-editor-status mono-ui">
        {hasSelectedBlocks(normalizedSelection) ? `AI: ${normalizedSelection.blockIds.length} блок(и)` : "AI: блок не вибрано"}
      </div>
    </div>
  );
}

function BlockRenderer({
  block,
  disabled,
  registerEditable,
  onBlockChange,
  onFocus
}: {
  block: Block;
  disabled?: boolean;
  registerEditable: (blockId: string, element: HTMLElement | null) => void;
  onBlockChange: (block: Block) => void;
  onFocus: () => void;
}) {
  if (block.type === "paragraph" || block.type === "heading") {
    return (
      <EditableTextBlock
        block={block}
        disabled={disabled}
        registerEditable={registerEditable}
        onBlockChange={onBlockChange}
        onFocus={onFocus}
      />
    );
  }

  if (block.type === "bullet_list" || block.type === "ordered_list") {
    return (
      <EditableListBlock
        block={block}
        disabled={disabled}
        onBlockChange={onBlockChange}
        onFocus={onFocus}
      />
    );
  }

  if (block.type === "callout") {
    return (
      <EditableCalloutBlock
        block={block}
        disabled={disabled}
        onBlockChange={onBlockChange}
        onFocus={onFocus}
      />
    );
  }

  if (block.type === "table") {
    return <EditableTableBlock block={block} disabled={disabled} onBlockChange={onBlockChange} onFocus={onFocus} />;
  }

  if (block.type === "image") {
    return <EditableImageBlock block={block} disabled={disabled} onBlockChange={onBlockChange} onFocus={onFocus} />;
  }

  return <div className="block-divider" aria-hidden="true" />;
}

function EditableTextBlock({
  block,
  disabled,
  registerEditable,
  onBlockChange,
  onFocus
}: {
  block: ParagraphBlock | HeadingBlock;
  disabled?: boolean;
  registerEditable: (blockId: string, element: HTMLElement | null) => void;
  onBlockChange: (block: ParagraphBlock | HeadingBlock) => void;
  onFocus: () => void;
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
    <div
      ref={(element) => registerEditable(block.id, element)}
      className={className}
      contentEditable={!disabled}
      suppressContentEditableWarning
      onFocus={onFocus}
      onInput={(event) =>
        onBlockChange({
          ...block,
          content: htmlToInlineNodes(event.currentTarget.innerHTML)
        })
      }
      dangerouslySetInnerHTML={{ __html: inlineNodesToHtml(block.content) }}
    />
  );
}

function EditableListBlock({
  block,
  disabled,
  onBlockChange,
  onFocus
}: {
  block: BulletListBlock | OrderedListBlock;
  disabled?: boolean;
  onBlockChange: (block: BulletListBlock | OrderedListBlock) => void;
  onFocus: () => void;
}) {
  const Tag = block.type === "bullet_list" ? "ul" : "ol";

  return (
    <div className="block-list-shell">
      <Tag className="block-list">
        {block.items.map((item, index) => (
          <li key={`${block.id}-${index}`}>
            <div
              className="block-list-item"
              contentEditable={!disabled}
              suppressContentEditableWarning
              onFocus={onFocus}
              onInput={(event) => {
                const nextItems = block.items.slice();
                nextItems[index] = htmlToInlineNodes(event.currentTarget.innerHTML);
                onBlockChange({ ...block, items: nextItems });
              }}
              dangerouslySetInnerHTML={{ __html: inlineNodesToHtml(item) }}
            />
          </li>
        ))}
      </Tag>

      <div className="block-inline-actions">
        <Button
          type="button"
          size="sm"
          onClick={() => onBlockChange({ ...block, items: [...block.items, [createInlineText("")]] })}
          disabled={disabled}
        >
          +
        </Button>
      </div>
    </div>
  );
}

function EditableCalloutBlock({
  block,
  disabled,
  onBlockChange,
  onFocus
}: {
  block: CalloutBlock;
  disabled?: boolean;
  onBlockChange: (block: CalloutBlock) => void;
  onFocus: () => void;
}) {
  return (
    <div className="block-callout-shell" data-kind={block.kind}>
      <div className="block-callout-chip mono-ui">{getEditorialCalloutKindLabel(block.kind)}</div>
      <div
        className="block-callout-title"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onFocus={onFocus}
        onInput={(event) => onBlockChange({ ...block, title: htmlToInlineNodes(event.currentTarget.innerHTML) })}
        dangerouslySetInnerHTML={{ __html: inlineNodesToHtml(block.title) }}
      />
      {block.body.map((paragraph, index) => (
        <div
          key={`${block.id}-${index}`}
          className="block-callout-body"
          contentEditable={!disabled}
          suppressContentEditableWarning
          onFocus={onFocus}
          onInput={(event) => {
            const nextBody = block.body.slice();
            nextBody[index] = htmlToInlineNodes(event.currentTarget.innerHTML);
            onBlockChange({ ...block, body: nextBody });
          }}
          dangerouslySetInnerHTML={{ __html: inlineNodesToHtml(paragraph) }}
        />
      ))}

      <div className="block-inline-actions">
        <Button type="button" size="sm" onClick={() => onBlockChange({ ...block, body: [...block.body, [createInlineText("")]] })} disabled={disabled}>
          +
        </Button>
      </div>
    </div>
  );
}

function EditableTableBlock({
  block,
  disabled,
  onBlockChange,
  onFocus
}: {
  block: TableBlock;
  disabled?: boolean;
  onBlockChange: (block: TableBlock) => void;
  onFocus: () => void;
}) {
  return (
    <div className="block-table-shell">
      <table className="block-table">
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`${block.id}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${block.id}-${rowIndex}-${cellIndex}`}>
                  <div
                    className="block-table-cell"
                    contentEditable={!disabled}
                    suppressContentEditableWarning
                    onFocus={onFocus}
                    onInput={(event) => {
                      const nextRows = block.rows.map((entry) => entry.map((part) => part.slice()));
                      nextRows[rowIndex][cellIndex] = htmlToInlineNodes(event.currentTarget.innerHTML);
                      onBlockChange({ ...block, rows: nextRows });
                    }}
                    dangerouslySetInnerHTML={{ __html: inlineNodesToHtml(cell) }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="block-inline-actions">
        <Button
          type="button"
          size="sm"
          onClick={() =>
            onBlockChange({
              ...block,
              rows: [...block.rows, block.rows[0].map(() => [createInlineText("")])]
            })
          }
          disabled={disabled}
        >
          +
        </Button>
      </div>
    </div>
  );
}

function EditableImageBlock({
  block,
  disabled,
  onBlockChange,
  onFocus
}: {
  block: ImageBlock;
  disabled?: boolean;
  onBlockChange: (block: ImageBlock) => void;
  onFocus: () => void;
}) {
  const { resolvedUrl } = useResolvedEditorAssetUrl(createEditorAssetToken(block.assetId));

  return (
    <div className="block-image-shell">
      {resolvedUrl ? <img src={resolvedUrl} alt={block.alt} className="block-image" /> : <div className="block-image-placeholder">image</div>}
      <input
        className="block-image-alt mono-ui"
        value={block.alt}
        onFocus={onFocus}
        onChange={(event) => onBlockChange({ ...block, alt: event.currentTarget.value })}
        disabled={disabled}
      />
      <div
        className="block-image-caption"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onFocus={onFocus}
        onInput={(event) => onBlockChange({ ...block, caption: htmlToInlineNodes(event.currentTarget.innerHTML) })}
        dangerouslySetInnerHTML={{ __html: inlineNodesToHtml(block.caption ?? [createInlineText("")]) }}
      />
    </div>
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
    return [block.alt, getInlineText(block.caption)].filter(Boolean).join(". ");
  }

  return "";
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
  const merged: InlineNode[] = [];

  for (const node of nodes) {
    const previous = merged[merged.length - 1];

    if (
      previous &&
      previous.bold === node.bold &&
      previous.italic === node.italic &&
      previous.link === node.link
    ) {
      previous.text += node.text;
    } else {
      merged.push(node);
    }
  }

  return merged.length > 0 ? merged : [createInlineText("")];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
