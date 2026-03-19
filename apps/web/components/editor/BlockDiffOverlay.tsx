import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Block } from "../../lib/editor/document-model";
import type { EditorialReviewItem } from "../../lib/editor/review-contract";
import { createInlineText, getBlockText } from "../../lib/editor/document-model";
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
  const [draftTexts, setDraftTexts] = useState(() => newBlocks.map((block) => getBlockText(block)));
  const [isRefineOpen, setIsRefineOpen] = useState(false);
  const textareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const normalizedRefineInstruction = refineInstruction.trim();
  const hasPendingRefineInstruction = normalizedRefineInstruction.length > 0;

  const editableBlocks = useMemo(
    () =>
      newBlocks.map((block, index) => ({
        block,
        newText: draftTexts[index] ?? getBlockText(block)
      })),
    [draftTexts, newBlocks]
  );

  useLayoutEffect(() => {
    for (const { block } of editableBlocks) {
      const textarea = textareaRefs.current.get(block.id);

      if (textarea) {
        autosizeTextarea(textarea);
      }
    }
  }, [editableBlocks]);

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
            <p className="editorial-review-detail-label">Що змінити в рекомендації</p>
            <textarea
              className="editorial-review-callout-body-input editorial-review-refine-input"
              value={refineInstruction}
              placeholder="Наприклад: спростити тон, зберегти структуру списку, прибрати канцеляризми"
              onChange={(event) => onRefineInstructionChange(event.target.value)}
            />
          </div>
        ) : null}

        <div className="diff-footer button-row" style={{ marginTop: "8px" }}>
          <Button size="sm" variant="ghost" onClick={onReject}>
            Відхилити
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={isRefineOpen}
            onClick={() => setIsRefineOpen((current) => !current)}
          >
            Уточнити
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onRegenerate(normalizedRefineInstruction || undefined)}
            disabled={item == null}
          >
            Перегенерувати
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={hasPendingRefineInstruction}
            title={hasPendingRefineInstruction ? "Спершу перегенеруйте варіант або очистіть уточнення." : undefined}
            onClick={() => onAccept(newBlocks.map((block, index) => withEditedBlockText(block, draftTexts[index] ?? "")))}
          >
            Застосувати
          </Button>
        </div>
      </div>

    </div>
  );
}

function withEditedBlockText(block: Block, editedText: string): Block {
  const text = editedText.replace(/\r\n?/g, "\n");

  if (block.type === "paragraph") {
    return { ...block, content: [createInlineText(text)] };
  }

  if (block.type === "heading") {
    return { ...block, content: [createInlineText(text)] };
  }

  if (block.type === "bullet_list") {
    return {
      ...block,
      items: splitListItems(text).map((item) => [createInlineText(item)])
    };
  }

  if (block.type === "ordered_list") {
    return {
      ...block,
      items: splitListItems(text).map((item) => [createInlineText(item)])
    };
  }

  if (block.type === "callout") {
    const [title, ...body] = text.split(/\n\s*\n+/).map((part) => part.trim());
    return {
      ...block,
      title: [createInlineText(title ?? "")],
      body: (body.length > 0 ? body : [""]).map((part) => [createInlineText(part)])
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

function autosizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "0px";
  textarea.style.height = `${Math.max(textarea.scrollHeight, 56)}px`;
}
