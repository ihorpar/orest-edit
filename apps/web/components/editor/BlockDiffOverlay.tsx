"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { Block } from "../../lib/editor/document-model";
import type { EditorialReviewItem } from "../../lib/editor/review-contract";
import { getBlockText } from "../../lib/editor/document-model";
import { parseBoldMarkdownToInlineNodes, serializeInlineNodesToBoldMarkdown } from "../../lib/editor/inline-markup";
import { useProductCopy } from "../providers/ProductLocaleProvider";
import { Button } from "../ui/Button";

export function BlockDiffOverlay({
  item,
  oldBlocks: _oldBlocks,
  newBlocks,
  warning,
  onAccept,
  onReject,
  refineInstruction,
  onRefineInstructionChange,
  onRegenerate
}: {
  item?: EditorialReviewItem | null;
  oldBlocks: Block[];
  newBlocks: Block[];
  warning?: { code: "no_op"; message: string; similarity: number };
  onAccept: (nextBlocks: Block[]) => void;
  onReject: () => void;
  refineInstruction: string;
  onRefineInstructionChange: (value: string) => void;
  onRegenerate: (instruction?: string) => void;
}) {
  const rd = useProductCopy().editor.reviewDetail;
  const [draftTexts, setDraftTexts] = useState(() => newBlocks.map((block) => formatDiffBlockText(block)));
  const [isRefineOpen, setIsRefineOpen] = useState(false);
  const textareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const refineTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const normalizedRefineInstruction = refineInstruction.trim();
  const hasPendingRefineInstruction = normalizedRefineInstruction.length > 0;
  const regenerateLabel = hasPendingRefineInstruction ? rd.regenerateWithRefine : rd.regenerate;

  useEffect(() => {
    if (isRefineOpen) {
      refineTextareaRef.current?.focus();
    }
  }, [isRefineOpen]);

  const editableBlocks = useMemo(
    () =>
      newBlocks.map((block, index) => ({
        block,
        newText: draftTexts[index] ?? formatDiffBlockText(block)
      })),
    [draftTexts, newBlocks]
  );

  useEffect(() => {
    setDraftTexts(newBlocks.map((block) => formatDiffBlockText(block)));
  }, [newBlocks]);

  useLayoutEffect(() => {
    for (const { block } of editableBlocks) {
      const textarea = textareaRefs.current.get(block.id);

      if (textarea) {
        autosizeTextarea(textarea);
      }
    }
  }, [editableBlocks]);

  function handleRefineKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onRegenerate(normalizedRefineInstruction || undefined);
    }
  }

  return (
    <div className="block-diff-inline-container">
      {warning ? <p className="diff-warning">{warning.message}</p> : null}
      <div className="diff-proposed-stack">
        {editableBlocks.map(({ block, newText }, index) => (
          <section key={block.id} className="diff-proposed-block">
            <textarea
              className="diff-proposed-editor"
              value={newText}
              ref={(element) => {
                if (!element) {
                  textareaRefs.current.delete(block.id);
                  return;
                }

                textareaRefs.current.set(block.id, element);
              }}
              onChange={(event) =>
                setDraftTexts((current) => current.map((value, valueIndex) => (valueIndex === index ? event.target.value : value)))
              }
              onInput={(event) => autosizeTextarea(event.currentTarget)}
            />
          </section>
        ))}
      </div>

      <div className="editorial-review-refine">
        {isRefineOpen ? (
          <div className="editorial-review-field-group">
            <p className="editorial-review-detail-label">{rd.refineLabel}</p>
            <textarea
              ref={refineTextareaRef}
              className="editorial-review-callout-body-input editorial-review-refine-input"
              value={refineInstruction}
              placeholder={rd.refinePlaceholder}
              onChange={(event) => onRefineInstructionChange(event.target.value)}
              onKeyDown={handleRefineKeyDown}
            />
          </div>
        ) : null}

        <div className="diff-footer button-row" style={{ marginTop: "8px" }}>
          <Button size="sm" variant="ghost" onClick={onReject}>
            {rd.reject}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={isRefineOpen}
            onClick={() => setIsRefineOpen((current) => !current)}
          >
            {rd.refine}
          </Button>
          <Button
            size="sm"
            variant={hasPendingRefineInstruction ? "primary" : "secondary"}
            onClick={() => onRegenerate(normalizedRefineInstruction || undefined)}
            disabled={item == null}
            title={hasPendingRefineInstruction ? rd.refineUsedOnRegenerate : rd.regenerateCurrentVariant}
          >
            {regenerateLabel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={hasPendingRefineInstruction}
            title={hasPendingRefineInstruction ? rd.refinePendingTitle : undefined}
            onClick={() => onAccept(newBlocks.map((block, index) => withEditedBlockText(block, draftTexts[index] ?? "")))}
          >
            {rd.apply}
          </Button>
        </div>
      </div>

    </div>
  );
}

function withEditedBlockText(block: Block, editedText: string): Block {
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
      items: splitListItems(text).map((item) => parseBoldMarkdownToInlineNodes(item))
    };
  }

  if (block.type === "ordered_list") {
    return {
      ...block,
      items: splitListItems(text).map((item) => parseBoldMarkdownToInlineNodes(item))
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

function splitListItems(text: string): string[] {
  const items = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  return items.length > 0 ? items : [""];
}

function formatDiffBlockText(block: Block): string {
  if (block.type === "paragraph" || block.type === "heading") {
    return serializeInlineNodesToBoldMarkdown(block.content);
  }

  if (block.type === "bullet_list") {
    return block.items.map((item) => `• ${serializeInlineNodesToBoldMarkdown(item)}`).join("\n");
  }

  if (block.type === "ordered_list") {
    return block.items
      .map((item, index) => `${index + 1}. ${serializeInlineNodesToBoldMarkdown(item)}`)
      .join("\n");
  }

  if (block.type === "callout") {
    return [serializeInlineNodesToBoldMarkdown(block.title), ...block.body.map((part) => serializeInlineNodesToBoldMarkdown(part))]
      .filter(Boolean)
      .join("\n\n");
  }

  return getBlockText(block);
}

function autosizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "0px";
  textarea.style.height = `${Math.max(textarea.scrollHeight, 56)}px`;
}
