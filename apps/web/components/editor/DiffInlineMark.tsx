import { useLayoutEffect, useRef } from "react";

export function DiffInlineMark({
  oldText,
  newText,
  variant = "card",
  editableNewText = false,
  onNewTextChange
}: {
  oldText: string;
  newText?: string;
  variant?: "card" | "canvas";
  editableNewText?: boolean;
  onNewTextChange?: (value: string) => void;
}) {
  const shouldRenderEditableNewText = editableNewText && typeof onNewTextChange === "function";
  const editableTextareaRef = useRef<HTMLTextAreaElement>(null);

  function resizeEditableTextarea(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, 44)}px`;
  }

  useLayoutEffect(() => {
    if (!shouldRenderEditableNewText) {
      return;
    }

    const element = editableTextareaRef.current;
    if (!element) {
      return;
    }

    resizeEditableTextarea(element);
  }, [newText, shouldRenderEditableNewText]);

  return (
    <span className={`diff-inline-mark diff-inline-mark-${variant}`}>
      {oldText ? <span className="diff-remove">{oldText}</span> : null}
      {shouldRenderEditableNewText ? (
        <textarea
          ref={editableTextareaRef}
          className={`diff-add diff-add-editor diff-add-editor-${variant}`}
          value={newText ?? ""}
          onChange={(event) => onNewTextChange(event.currentTarget.value)}
          spellCheck={false}
          rows={1}
          aria-label="Запропонований текст правки"
        />
      ) : typeof newText === "string" && newText.length > 0 ? (
        <span className="diff-add">{newText}</span>
      ) : null}
    </span>
  );
}
