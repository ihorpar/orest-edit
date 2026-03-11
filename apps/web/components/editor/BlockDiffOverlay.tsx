import { useMemo, useState } from "react";

import type { Block } from "../../lib/editor/document-model";
import { createInlineText, getBlockText } from "../../lib/editor/document-model";
import { Button } from "../ui/Button";

export function BlockDiffOverlay({
  oldBlocks,
  newBlocks,
  reason,
  onAccept,
  onReject
}: {
  oldBlocks: Block[];
  newBlocks: Block[];
  reason: string;
  onAccept: (nextBlocks: Block[]) => void;
  onReject: () => void;
}) {
  const [draftTexts, setDraftTexts] = useState(() => newBlocks.map((block) => getBlockText(block)));

  const editableBlocks = useMemo(
    () =>
      newBlocks.map((block, index) => ({
        block,
        oldText: getBlockText(oldBlocks[index]),
        newText: draftTexts[index] ?? getBlockText(block)
      })),
    [draftTexts, newBlocks, oldBlocks]
  );

  return (
    <div className="block-diff-inline-container">
      <div className="diff-block-stack">
        {editableBlocks.map(({ block, oldText, newText }, index) => (
          <section key={block.id} className="diff-block-card">
            <div className="diff-section">
              <p className="diff-label">Було</p>
              <div className="diff-text-old">{oldText || " "}</div>
            </div>

            <div className="diff-section">
              <p className="diff-label">{getBlockEditorLabel(block, index, editableBlocks.length)}</p>
              <textarea
                className="diff-textarea diff-add-editor"
                value={newText}
                onChange={(event) =>
                  setDraftTexts((current) => current.map((value, valueIndex) => (valueIndex === index ? event.target.value : value)))
                }
              />
            </div>
          </section>
        ))}
      </div>

      <div className="diff-footer button-row" style={{ marginTop: "8px" }}>
        <span className="diff-reason" style={{ marginRight: "auto" }}>
          {reason}
        </span>
        <Button size="sm" variant="ghost" onClick={onReject}>
          Скасувати
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => onAccept(newBlocks.map((block, index) => withEditedBlockText(block, draftTexts[index] ?? "")))}
        >
          Застосувати
        </Button>
      </div>
    </div>
  );
}

function getBlockEditorLabel(block: Block, index: number, total: number): string {
  if (total === 1) {
    return "Стане";
  }

  if (block.type === "heading") {
    return `Підзаголовок ${index + 1}`;
  }

  if (block.type === "bullet_list") {
    return `Список ${index + 1}`;
  }

  if (block.type === "ordered_list") {
    return `Нумерований список ${index + 1}`;
  }

  return `Блок ${index + 1}`;
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
