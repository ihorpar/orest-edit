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

  return (
    <span className={`diff-inline-mark diff-inline-mark-${variant}`}>
      {oldText ? <span className="diff-remove">{oldText}</span> : null}
      {shouldRenderEditableNewText ? (
        <textarea
          className={`diff-add diff-add-editor diff-add-editor-${variant}`}
          value={newText ?? ""}
          onChange={(event) => onNewTextChange(event.currentTarget.value)}
          spellCheck={false}
          rows={Math.max(1, (newText ?? "").split("\n").length)}
          aria-label="Запропонований текст правки"
        />
      ) : typeof newText === "string" && newText.length > 0 ? (
        <span className="diff-add">{newText}</span>
      ) : null}
    </span>
  );
}
