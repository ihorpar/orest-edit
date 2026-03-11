import { useMemo, useState } from "react";

import type { Block } from "../../lib/editor/document-model";
import { createInlineText, getBlockText } from "../../lib/editor/document-model";
import { Button } from "../ui/Button";

export function BlockDiffOverlay({
  oldBlocks,
  newBlocks,
  reason,
  warning,
  onAccept,
  onReject
}: {
  oldBlocks: Block[];
  newBlocks: Block[];
  reason: string;
  warning?: { code: "no_op"; message: string; similarity: number };
  onAccept: (nextBlocks: Block[]) => void;
  onReject: () => void;
}) {
  const [draftTexts, setDraftTexts] = useState(() => newBlocks.map((block) => getBlockText(block)));

  const editableBlocks = useMemo(
    () =>
      newBlocks.map((block, index) => ({
        block,
        newText: draftTexts[index] ?? getBlockText(block)
      })),
    [draftTexts, newBlocks]
  );

  return (
    <div className="block-diff-inline-container">
      {warning ? <p className="diff-warning">{warning.message}</p> : null}
      <div className="diff-proposed-stack">
        {editableBlocks.map(({ block, newText }, index) => (
          <section key={block.id} className="diff-proposed-block">
            {editableBlocks.length > 1 ? <p className="diff-label">Блок {index + 1}</p> : null}
            <textarea
              className="diff-proposed-editor"
              value={newText}
              onChange={(event) =>
                setDraftTexts((current) => current.map((value, valueIndex) => (valueIndex === index ? event.target.value : value)))
              }
            />
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
