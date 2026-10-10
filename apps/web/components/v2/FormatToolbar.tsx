"use client";

import { useRef, type ChangeEvent, type MouseEvent } from "react";
import type { Command } from "@tiptap/pm/state";
import {
  insertCallout,
  setTextBlockType,
  toggleList,
  toggleMarkCommand,
  type ActiveBlockKind,
  type TextBlockTarget
} from "../../lib/v2/editor-commands";
import type { V2Copy } from "../../lib/v2/copy";
import { V2_MARK, V2_NODE } from "../../lib/v2/tiptap-bridge";
import { V2Icon } from "./icons";
import styles from "./v2.module.css";

export interface ToolbarState {
  block: ActiveBlockKind;
  bold: boolean;
  italic: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

interface FormatToolbarProps {
  copy: V2Copy;
  state: ToolbarState | null;
  stats: string;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onRun: (command: Command) => void;
  onInsertImage: (file: File) => void;
}

type BlockLabelKey = "paragraph" | "heading1" | "heading2" | "heading3";

const BLOCK_TARGETS: Array<{ kind: ActiveBlockKind; target: TextBlockTarget; label: BlockLabelKey; hint: string }> = [
  { kind: "paragraph", target: { type: "paragraph" }, label: "paragraph", hint: "Ctrl+Alt+0" },
  { kind: "heading-1", target: { type: "heading", level: 1 }, label: "heading1", hint: "Ctrl+Alt+1" },
  { kind: "heading-2", target: { type: "heading", level: 2 }, label: "heading2", hint: "Ctrl+Alt+2" },
  { kind: "heading-3", target: { type: "heading", level: 3 }, label: "heading3", hint: "Ctrl+Alt+3" }
];

// Toolbar controls must not take the focus (and with it the selection) away from the manuscript.
const keepSelection = (event: MouseEvent) => event.preventDefault();

export function FormatToolbar({ copy, state, stats, isMenuOpen, onToggleMenu, onRun, onInsertImage }: FormatToolbarProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const disabled = !state;
  const block = state?.block ?? "paragraph";
  const textTarget = BLOCK_TARGETS.find((entry) => entry.kind === block);
  const blockLabel = textTarget
    ? copy.toolbar[textTarget.label]
    : block === "bulletList"
      ? copy.toolbar.bulletList
      : block === "orderedList"
        ? copy.toolbar.orderedList
        : block === "callout"
          ? copy.toolbar.callout
          : copy.toolbar.otherBlock;

  function handleImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (file) {
      onInsertImage(file);
    }
  }

  return (
    <div className={styles.fmt} role="toolbar" aria-label={copy.toolbar.label}>
      <span className={styles.menuAnchor} data-v2-menu>
        <button
          type="button"
          className={`${styles.fmtBtn} ${styles.fmtSel}`}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          title={copy.toolbar.blockType}
          disabled={disabled}
          onMouseDown={keepSelection}
          onClick={onToggleMenu}
        >
          {blockLabel}
          <span>▾</span>
        </button>
        {isMenuOpen ? (
          <div className={`${styles.menu} ${styles.menuLeft}`} role="menu">
            {BLOCK_TARGETS.map((entry) => (
              <button
                key={entry.kind}
                type="button"
                role="menuitemradio"
                aria-checked={block === entry.kind}
                className={styles.menuItem}
                onMouseDown={keepSelection}
                onClick={() => onRun(setTextBlockType(entry.target))}
              >
                {copy.toolbar[entry.label]}
                <span className={styles.menuHint}>{entry.hint}</span>
              </button>
            ))}
          </div>
        ) : null}
      </span>
      <span className={styles.vr} />
      <button
        type="button"
        className={styles.fmtBtn}
        title={`${copy.toolbar.bold} (Ctrl+B)`}
        aria-label={copy.toolbar.bold}
        aria-pressed={state?.bold ?? false}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => onRun(toggleMarkCommand(V2_MARK.bold))}
      >
        <V2Icon name="accent" />
      </button>
      <button
        type="button"
        className={styles.fmtBtn}
        title={`${copy.toolbar.italic} (Ctrl+I)`}
        aria-label={copy.toolbar.italic}
        aria-pressed={state?.italic ?? false}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => onRun(toggleMarkCommand(V2_MARK.italic))}
      >
        <V2Icon name="italic" />
      </button>
      <span className={styles.vr} />
      <button
        type="button"
        className={styles.fmtBtn}
        title={copy.toolbar.bulletList}
        aria-label={copy.toolbar.bulletList}
        aria-pressed={block === "bulletList"}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => onRun(toggleList(V2_NODE.bulletList))}
      >
        <V2Icon name="list" />
      </button>
      <button
        type="button"
        className={styles.fmtBtn}
        title={copy.toolbar.orderedList}
        aria-label={copy.toolbar.orderedList}
        aria-pressed={block === "orderedList"}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => onRun(toggleList(V2_NODE.orderedList))}
      >
        <V2Icon name="orderedList" />
      </button>
      <button
        type="button"
        className={styles.fmtBtn}
        title={copy.toolbar.insertCallout}
        aria-label={copy.toolbar.insertCallout}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => onRun(insertCallout())}
      >
        <V2Icon name="box" />
      </button>
      <button
        type="button"
        className={styles.fmtBtn}
        title={copy.toolbar.insertImage}
        aria-label={copy.toolbar.insertImage}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => imageInputRef.current?.click()}
      >
        <V2Icon name="visual" />
      </button>
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={handleImageSelection} />
      <span className={styles.stats}>{stats}</span>
    </div>
  );
}
