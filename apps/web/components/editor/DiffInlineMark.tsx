export function DiffInlineMark({ oldText, newText }: { oldText: string; newText?: string }) {
  return (
    <span>
      <span style={{ background: "#fdecec", color: "#b42318", textDecoration: "line-through", padding: "0 2px" }}>{oldText}</span>
      {newText ? <span style={{ background: "#e9f8ef", color: "#138a5a", padding: "0 2px", marginLeft: 4 }}>{newText}</span> : null}
    </span>
  );
}