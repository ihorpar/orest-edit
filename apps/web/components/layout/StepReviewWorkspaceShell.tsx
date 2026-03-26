"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface ReviewWorkspaceStep {
  id: string;
  label: string;
  icon: LucideIcon;
  completed?: boolean;
}

export function StepReviewWorkspaceShell({
  manuscript,
  drawer,
  steps,
  activeStepId,
  onStepSelect,
  initialDrawerWidth = 520,
  minDrawerWidth = 340,
  maxDrawerWidth = 900,
  minManuscriptWidth = 420
}: {
  manuscript: ReactNode;
  drawer: ReactNode;
  steps: ReviewWorkspaceStep[];
  activeStepId: string;
  onStepSelect: (stepId: string) => void;
  initialDrawerWidth?: number;
  minDrawerWidth?: number;
  maxDrawerWidth?: number;
  minManuscriptWidth?: number;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(initialDrawerWidth);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    setDrawerWidth(initialDrawerWidth);
  }, [initialDrawerWidth]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current;
      const shell = shellRef.current;

      if (!dragState || !shell) {
        return;
      }

      const shellWidth = shell.getBoundingClientRect().width;
      const staticWidth = 56 + 4;
      const dynamicMax = Math.max(minDrawerWidth, shellWidth - minManuscriptWidth - staticWidth);
      const allowedMax = Math.max(minDrawerWidth, Math.min(maxDrawerWidth, dynamicMax));
      const next = dragState.startWidth + (dragState.startX - event.clientX);
      const clamped = Math.max(minDrawerWidth, Math.min(allowedMax, next));

      setDrawerWidth(clamped);
    }

    function handlePointerUp() {
      dragStateRef.current = null;
      setIsResizing(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizing, maxDrawerWidth, minDrawerWidth, minManuscriptWidth]);

  function beginResize(clientX: number) {
    dragStateRef.current = {
      startX: clientX,
      startWidth: drawerWidth
    };
    setIsResizing(true);
  }

  return (
    <div className="step-review-shell" ref={shellRef}>
      <section className="step-review-manuscript">{manuscript}</section>

      <button
        type="button"
        className="step-review-resizer"
        aria-label="Змінити ширину панелі аналізу"
        title="Змінити ширину панелі аналізу"
        data-active={isResizing ? "true" : "false"}
        onPointerDown={(event) => {
          event.preventDefault();
          beginResize(event.clientX);
        }}
      />

      <aside className="step-review-drawer" style={{ width: `${drawerWidth}px` }}>
        {drawer}
      </aside>

      <nav className="step-review-mini-hub" aria-label="Кроки перевірки">
        {steps.map((step) => {
          const isActive = step.id === activeStepId;
          const Icon = step.icon;

          return (
            <div className="step-review-mini-hub-item" key={step.id} data-active={isActive ? "true" : "false"}>
              <button
                type="button"
                className="step-review-mini-hub-button"
                data-active={isActive ? "true" : "false"}
                data-completed={step.completed ? "true" : "false"}
                onClick={() => onStepSelect(step.id)}
                aria-label={step.label}
                aria-current={isActive ? "step" : undefined}
              >
                <Icon className="step-review-mini-hub-icon" aria-hidden="true" />
              </button>
              <div className="step-review-mini-hub-tooltip" aria-hidden="true">
                {step.label}
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
