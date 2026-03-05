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
      <section className="center-pane">{center}</section>
      <aside className="right-pane" data-collapsed={rightCollapsed ? "true" : "false"}>
        {right}
      </aside>
    </div>
  );
}
