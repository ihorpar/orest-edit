"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import type { V2Copy } from "../../lib/v2/copy";
import { FRAGMENT_QUICK_ACTIONS, type FragmentScope } from "../../lib/v2/fragment-actions";
import { getSelectionScope } from "../../lib/v2/selection-scope";
import { V2Icon } from "./icons";
import type { ReviewEngine } from "./useReviewEngine";
import styles from "./v2.module.css";

/** As in the prototype: the bar appears a moment after the selection settles, not while it is being dragged. */
const SETTLE_MS = 150;
const GAP_PX = 10;
const EDGE_PX = 12;

interface SelectionComposerProps {
  editor: Editor | null;
  copy: V2Copy;
  review: ReviewEngine;
  /** The positioned element the bar is placed in (the manuscript column). */
  containerRef: RefObject<HTMLElement | null>;
  /** `Свій запит`: the scope moves to the `Запит` tab. */
  onOwnRequest: (scope: FragmentScope) => void;
}

interface Placement {
  scope: FragmentScope;
  /** Bottom edge of the selection and its left edge, relative to the container. */
  top: number;
  left: number;
}

const keepSelection = (event: MouseEvent) => event.preventDefault();

/** Where the selected text ends on screen: the lowest line of the selection, and where its first line starts. */
function measureSelection(editor: Editor, from: number, to: number): { bottom: number; left: number } | null {
  const selection = window.getSelection();

  if (selection && selection.rangeCount > 0 && !selection.isCollapsed && editor.view.dom.contains(selection.anchorNode)) {
    const rects = Array.from(selection.getRangeAt(0).getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);

    if (rects.length > 0) {
      return { bottom: Math.max(...rects.map((rect) => rect.bottom)), left: rects[0]!.left };
    }
  }

  try {
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    return { bottom: Math.max(start.bottom, end.bottom), left: Math.min(start.left, end.left) };
  } catch {
    return null;
  }
}

/**
 * The bar under selected text. It is rendered only while the manuscript has focus and a non-empty text
 * selection; with the selection gone (collapsed, or focus moved elsewhere) it is not in the page at all.
 * It sits below the last selected line, so it never covers what is selected, and scrolls with the text.
 */
export function SelectionComposer({ editor, copy, review, containerRef, onOwnRequest }: SelectionComposerProps) {
  const text = copy.ask;
  const barRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      setPlacement(null);
      return;
    }

    let timer: number | null = null;
    let pointerDown = false;

    const read = (): Placement | null => {
      const container = containerRef.current;

      if (editor.isDestroyed || !editor.isEditable || !container || !editor.view.hasFocus()) {
        return null;
      }

      const { doc, selection } = editor.state;
      const scope = getSelectionScope(doc, selection);

      if (!scope) {
        return null;
      }

      const measured = measureSelection(editor, scope.from, scope.to);

      if (!measured) {
        return null;
      }

      const box = container.getBoundingClientRect();
      return {
        scope: { blockIds: scope.blockIds, quote: scope.quote },
        top: measured.bottom - box.top + GAP_PX,
        left: measured.left - box.left
      };
    };

    const cancel = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const update = () => {
      cancel();

      // Gone at once when there is nothing selected; shown only after the selection has settled.
      if (editor.isDestroyed || !editor.view.hasFocus() || editor.state.selection.empty) {
        setPlacement(null);
        return;
      }

      if (pointerDown) {
        return;
      }

      timer = window.setTimeout(() => {
        timer = null;
        setPlacement(read());
      }, SETTLE_MS);
    };

    const handlePointerDown = () => {
      pointerDown = true;
      cancel();
    };
    const handlePointerUp = () => {
      if (pointerDown) {
        pointerDown = false;
        update();
      }
    };
    const handleBlur = () => {
      cancel();
      setPlacement(null);
    };

    const dom = editor.view.dom;
    dom.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("resize", update);
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", handleBlur);

    return () => {
      cancel();
      dom.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("resize", update);
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", handleBlur);
    };
  }, [containerRef, editor]);

  // The bar keeps inside the manuscript column whatever its width is.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const container = containerRef.current;

    if (!placement || !bar || !container) {
      setLeft(null);
      return;
    }

    const max = container.clientWidth - bar.offsetWidth - EDGE_PX;
    setLeft(Math.max(EDGE_PX, Math.min(placement.left, max)));
  }, [containerRef, placement, review.state.request.fragment]);

  if (!placement) {
    return null;
  }

  const running = review.state.request.fragment;

  return (
    <div
      ref={barRef}
      className={styles.selbar}
      role="toolbar"
      aria-label={text.composerLabel}
      data-selbar
      style={{ top: placement.top, left: left ?? Math.max(EDGE_PX, placement.left), visibility: left === null ? "hidden" : undefined }}
      // Pressing a button must not take the selection away from the manuscript.
      onMouseDown={keepSelection}
    >
      {running ? (
        <>
          <span className={styles.selbarBusy} role="status">
            <span className={styles.spin} />
            {text.fragmentRunning(running.label)}
          </span>
          <button type="button" className={styles.selbarOwn} onClick={() => review.cancelFragment()}>
            {text.cancel}
          </button>
        </>
      ) : (
        <>
          {FRAGMENT_QUICK_ACTIONS.map((action) => (
            <button key={action} type="button" data-quick={action} onClick={() => review.runFragmentAction(action, placement.scope)}>
              {text.quick[action]}
            </button>
          ))}
          <button type="button" className={styles.selbarOwn} data-quick="own" onClick={() => onOwnRequest(placement.scope)}>
            <V2Icon name="chat" />
            {text.own}
          </button>
        </>
      )}
    </div>
  );
}
