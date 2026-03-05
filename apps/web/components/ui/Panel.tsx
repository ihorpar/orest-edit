import type { HTMLAttributes } from "react";

export function Panel(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      {...props}
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        ...(props.style ?? {})
      }}
    />
  );
}