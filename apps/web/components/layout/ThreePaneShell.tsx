import type { ReactNode } from "react";

export function ThreePaneShell({
  left,
  center,
  right,
  rightCollapsed = false
}: {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  rightCollapsed?: boolean;
}) {
  return (
    <div className="editor-layout" data-right-collapsed={rightCollapsed ? "true" : "false"}>
      <aside className="left-pane">{left}</aside>
      <section className="center-pane">
        <div className="mobile-pane mobile-pane-left">
          <div className="mobile-pane-card">{left}</div>
        </div>
        {center}
        {!rightCollapsed ? (
          <div className="mobile-pane mobile-pane-right">
            <div className="mobile-pane-card">{right}</div>
          </div>
        ) : null}
      </section>
      <aside className="right-pane" data-collapsed={rightCollapsed ? "true" : "false"}>
        {right}
      </aside>
    </div>
  );
}
