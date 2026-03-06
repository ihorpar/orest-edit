import type { ReactNode } from "react";

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      className="mono-ui"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        background: "#eff6ff",
        color: "var(--surgical-blue)"
      }}
    >
      {children}
    </span>
  );
}
