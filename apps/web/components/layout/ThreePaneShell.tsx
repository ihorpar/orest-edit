import type { ReactNode } from "react";

export function ThreePaneShell({
  left,
  center,
  right,
  rightState = "active",
  rightCollapsed = false
}: {
  left?: ReactNode;
  center: ReactNode;
  right: ReactNode;
  rightState?: "idle" | "active";
  rightCollapsed?: boolean;
}) {
  return (
    <div
      className="editor-layout"
      data-has-left={left ? "true" : "false"}
      data-right-collapsed={rightCollapsed ? "true" : "false"}
      data-right-state={rightState}
    >
      {left ? <aside className="left-pane">{left}</aside> : null}
      <section className="center-pane">
        {left ? (
          <div className="mobile-pane mobile-pane-left">
            <div className="mobile-pane-card">{left}</div>
          </div>
        ) : null}
        {center}
        {!rightCollapsed ? (
          <div className="mobile-pane mobile-pane-right">
            <div className="mobile-pane-card">{right}</div>
          </div>
        ) : null}
      </section>
      <aside className="right-pane" data-collapsed={rightCollapsed ? "true" : "false"} data-state={rightState}>
        {right}
      </aside>
    </div>
  );
}
