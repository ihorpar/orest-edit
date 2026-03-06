export function DiffInlineMark({
  oldText,
  newText,
  variant = "card"
}: {
  oldText: string;
  newText?: string;
  variant?: "card" | "canvas";
}) {
  return (
    <span className={`diff-inline-mark diff-inline-mark-${variant}`}>
      {oldText ? <span className="diff-remove">{oldText}</span> : null}
      {newText ? <span className="diff-add">{newText}</span> : null}
    </span>
  );
}
