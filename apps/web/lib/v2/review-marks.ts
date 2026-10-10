import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Command } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Block, CalloutBlock, InlineNode } from "../editor/document-model.ts";
import { findOccurrenceRange } from "./item-kinds.ts";
import { V2_MARK } from "./tiptap-bridge.ts";
import { diffWords, type BlockDiff, type DiffSegment } from "./word-diff.ts";

/**
 * Inline review marks. Suggestions are drawn over the manuscript as ProseMirror decorations: attributes on
 * the anchored blocks, `<del>` wrappers over text that would go, `<ins>` widgets for text that would come,
 * ghost blocks (a heading, a callout) at the place they would be inserted, and inline marks over an exact
 * phrase (an accent, a misspelt word). Nothing here touches the document, so the marks can never reach
 * `getDocument()` or the saved draft.
 */

export type ReviewMarkState = "pending" | "preparing" | "ready" | "stale";

export interface ReviewMark {
  itemId: string;
  /** Pass id, used only to pick the colour. */
  tone: string | null;
  blockIds: string[];
  state: ReviewMarkState;
  focused: boolean;
  hot: boolean;
  /** Prepared change to draw inline; present only for the focused item with a ready proposal. */
  diff?: BlockDiff[];
  /** A block that would be inserted, drawn at its insertion point exactly as it would read. */
  ghost?: ReviewGhost;
  /** A suggestion about an exact phrase inside one text block. */
  inline?: ReviewInlineTarget;
  /** Quiet mode, not the current item: shown only as a faint dotted trace, and not counted as drawn. */
  dim?: boolean;
  /**
   * What the button beside ✕ does for a mark over whole blocks: `accept` applies the change that is drawn,
   * `show` asks to see it (it is not prepared or not open yet), `busy` says it is being prepared. Without
   * it the mark offers only ✕.
   */
  primary?: ReviewPrimaryAction;
}

export type ReviewPrimaryAction = "accept" | "show" | "busy";
export type ReviewDecision = "accept" | "reject" | "show";

export type ReviewGhost =
  | {
      type: "heading";
      /** The heading goes before this block. */
      anchorBlockId: string;
      title: string;
      level: 2 | 3;
      /** The title can be typed over and the level switched (the focused ghost). */
      editable: boolean;
    }
  | {
      type: "callout";
      anchorBlockId: string;
      side: "before" | "after";
      block: CalloutBlock;
      /** "Аналогія · докладно": kind and depth as the editor reads them. */
      label: string;
    }
  | {
      /** An illustration that is not in the text yet, shown where its image would go: after this block. */
      type: "figure";
      anchorBlockId: string;
      /** "Візуал · Інфографіка". */
      label: string;
      title: string;
      /** The caption typed in the studio, when there is one. */
      caption?: string;
      /** Where the illustration is (image ready, being generated, failed), in the editor's words. */
      note?: string;
      /** Text of the button that opens the studio. */
      action: string;
      /** False when the studio cannot be opened right now (AI actions are off). */
      enabled: boolean;
    };

export type ReviewInlineTarget =
  /** The `occurrence`-th (1-based) `text` in the block would become bold. */
  | { type: "accent"; blockId: string; text: string; occurrence: number }
  /** `badText` at `start`..`end` would be replaced with `replacement` (absent when there is nothing to offer). */
  | { type: "spell"; blockId: string; start: number; end: number; badText: string; replacement?: string };

/** Why a prepared change could not be shown in the text. */
export type ReviewDiffFailure =
  /** The manuscript does not read as the text the proposal was written against. */
  | "mismatch"
  /** The proposal changes no text and no block shape, so there is nothing to show. */
  | "empty";

/**
 * Which prepared changes are actually visible in the manuscript right now. A change may be applied only
 * while it is listed in `drawn`: nothing is accepted that the editor cannot see.
 */
export interface ReviewDiffReport {
  drawn: string[];
  failed: Array<{ itemId: string; reason: ReviewDiffFailure }>;
}

export interface ReviewMarkHandlers {
  /** `onDiff` is true when the click landed on drawn del/ins text rather than on plain manuscript text. */
  onItemClick?: (itemId: string, onDiff: boolean) => void;
  onItemHover?: (itemId: string | null) => void;
  onDiffReport?: (report: ReviewDiffReport) => void;
  /** The title was typed over, or the level switched, on the editable ghost heading. */
  onHeadingChange?: (itemId: string, change: { title?: string; headingLevel?: 2 | 3 }) => void;
  /** `Відкрити студію` was pressed on a ghost figure. */
  onStudioOpen?: (itemId: string) => void;
  /** A button of the controls drawn beside a suggestion in the text was pressed. */
  onDecide?: (itemId: string, decision: ReviewDecision) => void;
  decideLabels?: { accept: string; reject: string; show: string; busy: string };
}

interface ReviewMarksPluginState {
  marks: ReviewMark[];
  decorations: DecorationSet;
  report: ReviewDiffReport;
}

const EMPTY_REPORT: ReviewDiffReport = { drawn: [], failed: [] };
const DRAWN_DIFF_SELECTOR =
  'del[data-sg-del], ins[data-sg-ins], [data-sg-ins-block], [data-sg-diff="block"], [data-sg-ghost], [data-sg-inline]';

/** What a decoration stands for; kept in `spec` so it can be inspected without a DOM. */
export type ReviewDecorationSpec =
  | { review: "block"; blockId: string; itemIds: string[] }
  | { review: "del"; itemId: string; text: string }
  | { review: "ins"; itemId: string; text: string; nodes: InlineNode[] }
  | { review: "ins-block"; itemId: string; block: Block }
  | { review: "ghost"; itemId: string; ghost: ReviewGhost }
  | { review: "inline"; itemId: string; inline: ReviewInlineTarget; dim: boolean }
  | { review: "controls"; itemId: string; primary?: ReviewPrimaryAction };

export const reviewMarksKey = new PluginKey<ReviewMarksPluginState>("v2ReviewMarks");

export const REVIEW_ITEMS_ATTRIBUTE = "data-sg-items";

/** Replaces the set of marks. The transaction carries no steps, so history and autosave are not involved. */
export function setReviewMarks(marks: ReviewMark[]): Command {
  return (state, dispatch) => {
    if (dispatch) {
      dispatch(state.tr.setMeta(reviewMarksKey, marks).setMeta("addToHistory", false));
    }

    return true;
  };
}

export function getReviewDecorations(state: Parameters<Command>[0]): DecorationSet {
  return reviewMarksKey.getState(state)?.decorations ?? DecorationSet.empty;
}

export function getReviewDiffReport(state: Parameters<Command>[0]): ReviewDiffReport {
  return reviewMarksKey.getState(state)?.report ?? EMPTY_REPORT;
}

/** True when the prepared change of this item is visible in the manuscript in this editor state. */
export function isReviewDiffDrawn(state: Parameters<Command>[0], itemId: string): boolean {
  return getReviewDiffReport(state).drawn.includes(itemId);
}

export function createReviewMarksPlugin(handlers: ReviewMarkHandlers = {}): Plugin<ReviewMarksPluginState> {
  let hovered: string | null = null;

  const hover = (itemId: string | null) => {
    if (itemId !== hovered) {
      hovered = itemId;
      handlers.onItemHover?.(itemId);
    }
  };

  return new Plugin<ReviewMarksPluginState>({
    key: reviewMarksKey,
    state: {
      init: () => ({ marks: [], decorations: DecorationSet.empty, report: EMPTY_REPORT }),
      apply(transaction, value) {
        const marks = transaction.getMeta(reviewMarksKey) as ReviewMark[] | undefined;

        if (marks) {
          return { marks, ...buildReviewMarkState(transaction.doc, marks, handlers) };
        }

        if (transaction.docChanged) {
          // Rebuilt rather than mapped: a mark belongs to block ids, and a diff is only valid for exact text.
          return { marks: value.marks, ...buildReviewMarkState(transaction.doc, value.marks, handlers) };
        }

        return value;
      }
    },
    view() {
      let reported = JSON.stringify(EMPTY_REPORT);

      return {
        update(view) {
          const report = getReviewDiffReport(view.state);
          const next = JSON.stringify(report);

          if (next !== reported) {
            reported = next;
            handlers.onDiffReport?.(report);
          }
        }
      };
    },
    props: {
      decorations(state) {
        return reviewMarksKey.getState(state)?.decorations ?? null;
      },
      handleClick(view, _pos, event) {
        if (event.button !== 0 || !view.state.selection.empty) {
          return false;
        }

        const itemId = readItemId(event.target, reviewMarksKey.getState(view.state)?.marks ?? []);

        if (itemId) {
          const target = event.target as Element | null;
          handlers.onItemClick?.(itemId, Boolean(target && typeof target.closest === "function" && target.closest(DRAWN_DIFF_SELECTOR)));
        }

        // The click still places the caret: the text stays editable under a mark.
        return false;
      },
      handleDOMEvents: {
        mouseover(view, event) {
          // Not while a button is held: redrawing the marks in the middle of a drag would put the selection
          // back where it was before the drag began.
          if (event.buttons !== 0) {
            return false;
          }

          hover(readItemId(event.target, reviewMarksKey.getState(view.state)?.marks ?? []));
          return false;
        },
        mouseleave() {
          hover(null);
          return false;
        }
      }
    }
  });
}

function readItemId(target: EventTarget | null, marks: ReviewMark[]): string | null {
  if (!target || typeof (target as Element).closest !== "function") {
    return null;
  }

  const element = (target as Element).closest(`[${REVIEW_ITEMS_ATTRIBUTE}]`);
  const ids = element?.getAttribute(REVIEW_ITEMS_ATTRIBUTE)?.split(" ").filter(Boolean) ?? [];

  if (ids.length === 0) {
    return null;
  }

  const focused = marks.find((mark) => mark.focused && ids.includes(mark.itemId));
  return focused?.itemId ?? ids[0] ?? null;
}

interface BlockEntry {
  node: ProseMirrorNode;
  pos: number;
}

type GhostHandlers = Pick<ReviewMarkHandlers, "onHeadingChange" | "onStudioOpen" | "onDecide" | "decideLabels">;

export function buildReviewDecorations(doc: ProseMirrorNode, marks: ReviewMark[]): DecorationSet {
  return buildReviewMarkState(doc, marks).decorations;
}

export function buildReviewMarkState(
  doc: ProseMirrorNode,
  marks: ReviewMark[],
  handlers: GhostHandlers = {}
): { decorations: DecorationSet; report: ReviewDiffReport } {
  if (marks.length === 0) {
    return { decorations: DecorationSet.empty, report: EMPTY_REPORT };
  }

  const report: ReviewDiffReport = { drawn: [], failed: [] };

  const blocks = new Map<string, BlockEntry>();

  doc.forEach((node, pos) => {
    if (typeof node.attrs.id === "string" && node.attrs.id) {
      blocks.set(node.attrs.id, { node, pos });
    }
  });

  const decorations: Decoration[] = [];
  const marksByBlock = new Map<string, ReviewMark[]>();
  const struckBlocks = new Set<string>();
  const diffBlocks = new Set<string>();

  for (const mark of marks) {
    for (const blockId of mark.blockIds) {
      if (!blocks.has(blockId)) {
        continue;
      }

      const list = marksByBlock.get(blockId);

      if (list) {
        list.push(mark);
      } else {
        marksByBlock.set(blockId, [mark]);
      }
    }
  }

  for (const mark of marks) {
    if (!mark.diff || !mark.focused) {
      continue;
    }

    const built = buildDiffDecorations(mark, mark.diff, blocks);

    if (!built) {
      report.failed.push({ itemId: mark.itemId, reason: "mismatch" });
      continue;
    }

    if (built.decorations.length === 0 && built.struck.length === 0) {
      report.failed.push({ itemId: mark.itemId, reason: "empty" });
      continue;
    }

    report.drawn.push(mark.itemId);
    decorations.push(...built.decorations);
    built.struck.forEach((blockId) => struckBlocks.add(blockId));
    built.touched.forEach((blockId) => diffBlocks.add(blockId));
  }

  for (const mark of marks) {
    const built = mark.ghost
      ? buildGhostDecoration(mark, mark.ghost, blocks, handlers)
      : mark.inline
        ? buildInlineDecorations(mark, mark.inline, blocks, handlers)
        : null;

    if (!built) {
      continue;
    }

    decorations.push(...built.decorations);

    // The result counts as visible only when it is drawn in full: not a dimmed trace, not a word without a fix.
    if (built.complete) {
      report.drawn.push(mark.itemId);
    }
  }

  // Every suggestion over whole blocks has its buttons beside its first block. Where several start at the
  // same block, the buttons belong to the one the block is showing: the current, else the hovered, else the first.
  const claimed = new Set<string>();
  const rank = (mark: ReviewMark) => (mark.focused ? 0 : mark.hot ? 1 : 2);

  for (const mark of [...marks].sort((a, b) => rank(a) - rank(b))) {
    const firstId = mark.dim ? undefined : mark.blockIds.find((blockId) => blocks.has(blockId));

    if (!firstId || claimed.has(firstId)) {
      continue;
    }

    claimed.add(firstId);
    // A prepared change that could not be drawn is not offered for acceptance here either.
    const primary = mark.primary === "accept" && !report.drawn.includes(mark.itemId) ? undefined : mark.primary;
    decorations.push(controlsWidget(blocks.get(firstId)!.pos, mark.itemId, handlers, "block", primary));
  }

  for (const [blockId, blockMarks] of marksByBlock) {
    const entry = blocks.get(blockId)!;
    const primary = blockMarks.find((mark) => mark.focused) ?? blockMarks.find((mark) => mark.hot) ?? blockMarks[0]!;
    const attributes: Record<string, string> = {
      "data-sg": primary.state,
      [REVIEW_ITEMS_ATTRIBUTE]: blockMarks.map((mark) => mark.itemId).join(" ")
    };

    if (primary.tone) {
      attributes["data-sg-tone"] = primary.tone;
    }

    if (blockMarks.some((mark) => mark.focused)) {
      attributes["data-sg-focus"] = "";
    }

    if (blockMarks.some((mark) => mark.hot)) {
      attributes["data-sg-hot"] = "";
    }

    if (primary.dim) {
      attributes["data-sg-dim"] = "";
    }

    if (diffBlocks.has(blockId)) {
      attributes["data-sg-diff"] = struckBlocks.has(blockId) ? "block" : "text";
    }

    decorations.push(
      Decoration.node(entry.pos, entry.pos + entry.node.nodeSize, attributes, {
        review: "block",
        blockId,
        itemIds: blockMarks.map((mark) => mark.itemId)
      } satisfies ReviewDecorationSpec)
    );
  }

  return { decorations: DecorationSet.create(doc, decorations), report };
}

/**
 * Decorations for one prepared change, or null when the manuscript no longer reads as the proposal expects
 * (then nothing is drawn; the item is about to be marked stale).
 */
function buildDiffDecorations(
  mark: ReviewMark,
  diffs: BlockDiff[],
  blocks: Map<string, BlockEntry>
): { decorations: Decoration[]; struck: string[]; touched: string[] } | null {
  const decorations: Decoration[] = [];
  const struck: string[] = [];
  const touched: string[] = [];
  let widgetIndex = 0;
  const key = (suffix: string) => `sg-${mark.itemId}-${(widgetIndex += 1)}-${suffix}`;

  // The anchored blocks are replaced as one run. With another block between them now, the change cannot be
  // applied as drawn, so it is not drawn.
  for (let index = 1; index < mark.blockIds.length; index += 1) {
    const previous = blocks.get(mark.blockIds[index - 1]!);
    const current = blocks.get(mark.blockIds[index]!);

    if (!previous || !current || previous.pos + previous.node.nodeSize !== current.pos) {
      return null;
    }
  }

  for (const diff of diffs) {
    const blockId = diff.kind === "add" ? diff.afterBlockId : diff.blockId;
    const entry = blocks.get(blockId);

    if (!entry) {
      return null;
    }

    const end = entry.pos + entry.node.nodeSize;

    if (diff.kind === "text") {
      if (!entry.node.isTextblock) {
        return null;
      }

      const currentText = readBlockText(entry.node);
      let segments: DiffSegment[];

      if (currentText === diff.oldText) {
        segments = diff.segments;
      } else if (currentText.trim() === diff.oldText.trim()) {
        segments = diffWords(currentText, diff.newText);
      } else {
        return null;
      }

      let position = entry.pos + 1;
      let newOffset = 0;
      const countBefore = decorations.length;

      for (const segment of segments) {
        if (segment.kind === "equal") {
          position += segment.text.length;
          newOffset += segment.text.length;
        } else if (segment.kind === "delete") {
          decorations.push(
            Decoration.inline(
              position,
              position + segment.text.length,
              { nodeName: "del", "data-sg-del": "" },
              { review: "del", itemId: mark.itemId, text: segment.text } satisfies ReviewDecorationSpec
            )
          );
          position += segment.text.length;
        } else {
          const text = segment.text;
          const nodes = sliceInlineNodes(diff.newContent, newOffset, newOffset + text.length, text);
          newOffset += text.length;
          decorations.push(
            Decoration.widget(position, () => createInsertedText(nodes), {
              side: -1,
              key: key(JSON.stringify(nodes)),
              ignoreSelection: true,
              review: "ins",
              itemId: mark.itemId,
              text,
              nodes
            })
          );
        }
      }

      if (decorations.length > countBefore) {
        touched.push(blockId);
      }

      continue;
    }

    touched.push(blockId);

    if (diff.kind === "replace" || diff.kind === "remove") {
      struck.push(blockId);
    }

    if (diff.kind === "replace" || diff.kind === "add") {
      const block = diff.newBlock;
      decorations.push(
        Decoration.widget(end, () => createInsertedBlock(block), {
          side: -1,
          key: key(`block-${JSON.stringify(block).length}`),
          ignoreSelection: true,
          review: "ins-block",
          itemId: mark.itemId,
          block
        })
      );
    }
  }

  return { decorations, struck, touched };
}

function markAttributes(mark: ReviewMark): Record<string, string> {
  const attributes: Record<string, string> = { [REVIEW_ITEMS_ATTRIBUTE]: mark.itemId };

  if (mark.tone) {
    attributes["data-sg-tone"] = mark.tone;
  }

  if (mark.focused) {
    attributes["data-sg-focus"] = "";
  }

  if (mark.hot) {
    attributes["data-sg-hot"] = "";
  }

  if (mark.dim) {
    attributes["data-sg-dim"] = "";
  }

  if (mark.state === "preparing") {
    attributes["data-sg-busy"] = "";
  }

  return attributes;
}

function hashText(text: string): string {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

/** True when every character between the two positions is bold. */
function isRangeBold(doc: ProseMirrorNode, from: number, to: number): boolean {
  let bold = true;

  doc.nodesBetween(from, to, (node) => {
    if (node.isInline && !node.marks.some((entry) => entry.type.name === V2_MARK.bold)) {
      bold = false;
    }

    return bold;
  });

  return bold;
}

/**
 * A ghost block at its insertion point, or null when the block it belongs next to is gone. A dimmed ghost
 * is not drawn at all: in quiet mode only the current item is expanded in the text.
 */
function buildGhostDecoration(
  mark: ReviewMark,
  ghost: ReviewGhost,
  blocks: Map<string, BlockEntry>,
  handlers: GhostHandlers
): { decorations: Decoration[]; complete: boolean } | null {
  const entry = blocks.get(ghost.anchorBlockId);

  if (!entry || mark.dim) {
    return null;
  }

  if (ghost.type === "figure") {
    const flags = `${mark.focused ? "f" : ""}${mark.hot ? "h" : ""}${mark.state}`;

    return {
      // A ghost figure is a place and a button, not a result: there is no image in it to accept.
      complete: false,
      decorations: [
        Decoration.widget(entry.pos + entry.node.nodeSize, () => createGhostFigure(mark.itemId, ghost, markAttributes(mark), handlers), {
          side: -1,
          key: `sg-ghost-${mark.itemId}-fig-${flags}-${hashText(JSON.stringify(ghost))}`,
          ignoreSelection: true,
          stopEvent: (event: Event) => isGhostControl(event.target),
          review: "ghost",
          itemId: mark.itemId,
          ghost
        })
      ]
    };
  }

  const before = ghost.type === "heading" || ghost.side === "before";
  const position = before ? entry.pos : entry.pos + entry.node.nodeSize;
  const flags = `${mark.focused ? "f" : ""}${mark.hot ? "h" : ""}${mark.state}`;
  // The ghost being typed in must stay the same DOM node whatever else changes (the pointer moving over
  // it, its title becoming empty), or the input would lose its caret. So it is keyed by item and level
  // only, and wears no attribute that changes while it is edited.
  const editing = ghost.type === "heading" && ghost.editable;
  const attributes = editing ? markAttributes({ ...mark, hot: false, state: "ready" }) : markAttributes(mark);

  if (ghost.type === "heading") {
    const key = editing
      ? `sg-ghost-${mark.itemId}-h${ghost.level}-edit`
      : `sg-ghost-${mark.itemId}-h${ghost.level}-${flags}-${hashText(ghost.title)}`;

    return {
      complete: ghost.title.trim().length > 0,
      decorations: [
        Decoration.widget(position, () => createGhostHeading(mark.itemId, ghost, attributes, handlers), {
          side: 0,
          key,
          ignoreSelection: true,
          stopEvent: (event: Event) => isGhostControl(event.target),
          review: "ghost",
          itemId: mark.itemId,
          ghost
        })
      ]
    };
  }

  return {
    complete: true,
    decorations: [
      Decoration.widget(position, () => createGhostCallout(mark.itemId, ghost, attributes, handlers), {
        side: -1,
        stopEvent: (event: Event) => isGhostControl(event.target),
        key: `sg-ghost-${mark.itemId}-${flags}-${hashText(JSON.stringify(ghost.block) + ghost.label)}`,
        ignoreSelection: true,
        review: "ghost",
        itemId: mark.itemId,
        ghost
      })
    ]
  };
}

function isGhostControl(target: EventTarget | null): boolean {
  return Boolean(target && typeof (target as Element).closest === "function" && (target as Element).closest("[data-sg-ghost-control]"));
}

function createGhostHeading(
  itemId: string,
  ghost: Extract<ReviewGhost, { type: "heading" }>,
  attributes: Record<string, string>,
  handlers: GhostHandlers
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-sg-ghost", "heading");
  wrapper.setAttribute("data-sg-level", String(ghost.level));
  wrapper.setAttribute("role", "heading");
  wrapper.setAttribute("aria-level", String(ghost.level));
  wrapper.contentEditable = "false";

  for (const [name, value] of Object.entries(attributes)) {
    wrapper.setAttribute(name, value);
  }

  const label = `H${ghost.level}`;

  if (ghost.editable) {
    const level = document.createElement("button");
    level.type = "button";
    level.setAttribute("data-sg-lvl", "");
    level.setAttribute("data-sg-ghost-control", "");
    level.textContent = label;
    level.addEventListener("click", (event) => {
      event.preventDefault();
      handlers.onHeadingChange?.(itemId, { headingLevel: ghost.level === 2 ? 3 : 2 });
    });
    wrapper.append(level);

    const input = document.createElement("input");
    input.type = "text";
    input.value = ghost.title;
    input.setAttribute("data-sg-ghost-title", "");
    input.setAttribute("data-sg-ghost-control", "");
    input.setAttribute("spellcheck", "false");
    input.addEventListener("input", () => handlers.onHeadingChange?.(itemId, { title: input.value }));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        input.blur();
      }
    });
    wrapper.append(input);
  } else {
    const level = document.createElement("span");
    level.setAttribute("data-sg-lvl", "");
    level.textContent = label;
    wrapper.append(level);

    const title = document.createElement("span");
    title.setAttribute("data-sg-ghost-title", "");
    title.textContent = ghost.title;
    wrapper.append(title);
  }

  wrapper.append(createDecisionControls(itemId, handlers, "ghost", "accept"));
  return wrapper;
}

function createGhostFigure(
  itemId: string,
  ghost: Extract<ReviewGhost, { type: "figure" }>,
  attributes: Record<string, string>,
  handlers: GhostHandlers
): HTMLElement {
  const wrapper = document.createElement("figure");
  wrapper.setAttribute("data-sg-ghost", "figure");
  wrapper.contentEditable = "false";

  for (const [name, value] of Object.entries(attributes)) {
    wrapper.setAttribute(name, value);
  }

  const kind = document.createElement("span");
  kind.setAttribute("data-sg-ghost-kind", "");
  kind.textContent = ghost.label;
  wrapper.append(kind);

  const title = document.createElement("b");
  title.setAttribute("data-sg-ghost-title", "");
  title.textContent = ghost.title;
  wrapper.append(title);

  if (ghost.caption?.trim()) {
    const caption = document.createElement("figcaption");
    caption.textContent = ghost.caption;
    wrapper.append(caption);
  }

  if (ghost.note) {
    const note = document.createElement("span");
    note.setAttribute("data-sg-ghost-note", "");
    note.textContent = ghost.note;
    wrapper.append(note);
  }

  const open = document.createElement("button");
  open.type = "button";
  open.setAttribute("data-sg-ghost-control", "");
  open.setAttribute("data-sg-studio", itemId);
  open.textContent = ghost.action;
  open.disabled = !ghost.enabled;
  open.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.onStudioOpen?.(itemId);
  });
  // An illustration is accepted in its studio, where the image is seen; here it can only be declined.
  const actions = document.createElement("div");
  actions.setAttribute("data-sg-ghost-actions", "");
  actions.append(open, createDecisionControls(itemId, handlers, "ghost"));
  wrapper.append(actions);

  return wrapper;
}

function createGhostCallout(
  itemId: string,
  ghost: Extract<ReviewGhost, { type: "callout" }>,
  attributes: Record<string, string>,
  handlers: GhostHandlers
): HTMLElement {
  const wrapper = document.createElement("aside");
  wrapper.setAttribute("data-sg-ghost", "callout");
  wrapper.contentEditable = "false";

  for (const [name, value] of Object.entries(attributes)) {
    wrapper.setAttribute(name, value);
  }

  const kind = document.createElement("span");
  kind.setAttribute("data-sg-ghost-kind", "");
  kind.textContent = ghost.label;
  wrapper.append(kind);

  const title = document.createElement("p");
  title.setAttribute("data-sg-ghost-title", "");
  appendInline(title, ghost.block.title);
  wrapper.append(title);

  for (const paragraph of ghost.block.body) {
    const line = document.createElement("p");
    appendInline(line, paragraph);
    wrapper.append(line);
  }

  wrapper.append(createDecisionControls(itemId, handlers, "ghost", "accept"));
  return wrapper;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function createControlIcon(paths: string[]): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }

  return svg;
}

/**
 * ✕ and ✓ beside a suggestion in the text, so it can be decided where it is read. They only report the
 * press: whether the item may be accepted right now is still decided by the engine.
 */
function createDecisionControls(
  itemId: string,
  handlers: GhostHandlers,
  variant: "inline" | "block" | "ghost",
  primary?: ReviewPrimaryAction
): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.setAttribute("data-sg-controls", variant);
  wrapper.setAttribute(REVIEW_ITEMS_ATTRIBUTE, itemId);
  wrapper.contentEditable = "false";

  const add = (decision: ReviewDecision, label: string | undefined, paths: string[]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-sg-decide", decision);
    button.setAttribute("data-sg-ghost-control", "");

    if (label) {
      button.title = label;
      button.setAttribute("aria-label", label);
    }

    button.append(createControlIcon(paths));
    // The caret and the selection in the manuscript stay where they are.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onDecide?.(itemId, decision);
    });
    wrapper.append(button);
  };

  add("reject", handlers.decideLabels?.reject, ["m6 6 12 12", "M18 6 6 18"]);

  if (primary === "accept") {
    add("accept", handlers.decideLabels?.accept, ["m5 12.5 4.5 4.5L19 7.5"]);
  } else if (primary === "show") {
    add("show", handlers.decideLabels?.show, [
      "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z",
      "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"
    ]);
  } else if (primary === "busy") {
    const busy = document.createElement("span");
    busy.setAttribute("data-sg-busy-dot", "");
    busy.setAttribute("role", "status");

    if (handlers.decideLabels?.busy) {
      busy.title = handlers.decideLabels.busy;
      busy.setAttribute("aria-label", handlers.decideLabels.busy);
    }

    wrapper.append(busy);
  }

  if (variant === "ghost") {
    return wrapper;
  }

  // Beside the text, not in it: a zero-size anchor, so the buttons never move a line or a paragraph.
  const anchor = document.createElement(variant === "block" ? "div" : "span");
  anchor.setAttribute("data-sg-controls-anchor", variant);
  anchor.contentEditable = "false";
  anchor.append(wrapper);
  return anchor;
}

function controlsWidget(
  position: number,
  itemId: string,
  handlers: GhostHandlers,
  variant: "inline" | "block",
  primary?: ReviewPrimaryAction
): Decoration {
  return Decoration.widget(position, () => createDecisionControls(itemId, handlers, variant, primary), {
    side: variant === "inline" ? 1 : -1,
    key: `sg-controls-${itemId}-${variant}-${primary ?? "none"}`,
    ignoreSelection: true,
    stopEvent: (event: Event) => isGhostControl(event.target),
    review: "controls",
    itemId,
    ...(primary ? { primary } : {})
  } satisfies { review: "controls"; itemId: string } & Record<string, unknown>);
}

/**
 * An inline mark over an exact phrase, or null when the phrase is not where the mark expects it (the text
 * was edited; the store re-reads the item on the next save and moves or retires it).
 */
function buildInlineDecorations(
  mark: ReviewMark,
  target: ReviewInlineTarget,
  blocks: Map<string, BlockEntry>,
  handlers: GhostHandlers = {}
): { decorations: Decoration[]; complete: boolean } | null {
  const entry = blocks.get(target.blockId);

  if (!entry || !entry.node.isTextblock) {
    return null;
  }

  const text = readBlockText(entry.node);
  const range = target.type === "accent" ? findOccurrenceRange(text, target.text, target.occurrence) : { start: target.start, end: target.end };

  if (!range || range.end <= range.start) {
    return null;
  }

  if (target.type === "spell" && text.slice(range.start, range.end) !== target.badText) {
    return null;
  }

  const from = entry.pos + 1 + range.start;
  const to = entry.pos + 1 + range.end;

  // An accent over text that is bold already has nothing to show.
  if (target.type === "accent" && isRangeBold(entry.node, range.start, range.end)) {
    return null;
  }

  const dim = Boolean(mark.dim);
  const decorations: Decoration[] = [
    // Its own wrapper element: overlapping marks (a misspelt word inside an accent phrase) must not share
    // one element, where the attributes of one would overwrite the other's.
    Decoration.inline(from, to, { nodeName: "span", ...markAttributes(mark), "data-sg-inline": target.type }, {
      review: "inline",
      itemId: mark.itemId,
      inline: target,
      dim
    } satisfies ReviewDecorationSpec)
  ];

  // Beside the phrase only while it is the current or the hovered one: dozens of marks stay quiet.
  const withControls = !dim && (mark.focused || mark.hot);

  if (target.type === "accent") {
    if (withControls) {
      decorations.push(controlsWidget(to, mark.itemId, handlers, "inline", "accept"));
    }

    return { decorations, complete: !dim };
  }

  const replacement = target.replacement;

  if (!replacement || dim) {
    // A word with nothing to offer in its place can still be dismissed where it stands.
    if (withControls) {
      decorations.push(controlsWidget(to, mark.itemId, handlers, "inline"));
    }

    return { decorations, complete: false };
  }

  const nodes: InlineNode[] = [{ text: replacement }];
  decorations.push(
    Decoration.widget(to, () => createInsertedText(nodes, mark.itemId), {
      side: -1,
      key: `sg-spell-${mark.itemId}-${hashText(replacement)}`,
      ignoreSelection: true,
      review: "ins",
      itemId: mark.itemId,
      text: replacement,
      nodes
    })
  );

  if (withControls) {
    decorations.push(controlsWidget(to, mark.itemId, handlers, "inline", "accept"));
  }

  return { decorations, complete: true };
}

/** Text of a text block as the document model sees it: soft breaks are `\n`. */
export function readBlockText(node: ProseMirrorNode): string {
  return node.textBetween(0, node.content.size, "\n", "\n");
}

/**
 * The part of the proposed block's inline nodes that an inserted segment covers, with its bold and italic.
 * Falls back to plain text when the nodes do not spell the expected text (they always should).
 */
export function sliceInlineNodes(nodes: InlineNode[], from: number, to: number, expected: string): InlineNode[] {
  const slice: InlineNode[] = [];
  let offset = 0;

  for (const node of nodes) {
    const start = Math.max(from, offset);
    const end = Math.min(to, offset + node.text.length);

    if (start < end) {
      slice.push({ ...node, text: node.text.slice(start - offset, end - offset) });
    }

    offset += node.text.length;
  }

  return slice.map((node) => node.text).join("") === expected ? slice : [{ text: expected }];
}

function createInsertedText(nodes: InlineNode[], itemId?: string): HTMLElement {
  const element = document.createElement("ins");
  element.setAttribute("data-sg-ins", "");

  if (itemId) {
    // A spelling fix stands outside its word's mark; this ties a click on it to the same item.
    element.setAttribute(REVIEW_ITEMS_ATTRIBUTE, itemId);
    element.setAttribute("data-sg-inline-ins", "");
  }

  appendInline(element, nodes);
  return element;
}

function appendInline(parent: HTMLElement, nodes: InlineNode[] | undefined) {
  for (const node of nodes ?? []) {
    if (!node.text) {
      continue;
    }

    let element: HTMLElement | Text = document.createTextNode(node.text);

    if (node.italic) {
      const wrapper = document.createElement("em");
      wrapper.append(element);
      element = wrapper;
    }

    if (node.bold) {
      const wrapper = document.createElement("strong");
      wrapper.append(element);
      element = wrapper;
    }

    parent.append(element);
  }
}

function createInsertedBlock(block: Block): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-sg-ins-block", "");
  wrapper.contentEditable = "false";

  const addLine = (tag: string, nodes: InlineNode[] | undefined) => {
    const line = document.createElement(tag);
    appendInline(line, nodes);
    wrapper.append(line);
    return line;
  };

  switch (block.type) {
    case "paragraph":
      addLine("p", block.content);
      break;
    case "heading":
      addLine(block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3", block.content);
      break;
    case "bullet_list":
    case "ordered_list": {
      const list = document.createElement(block.type === "bullet_list" ? "ul" : "ol");

      for (const item of block.items) {
        const entry = document.createElement("li");
        appendInline(entry, item);
        list.append(entry);
      }

      wrapper.append(list);
      break;
    }
    case "callout":
      addLine("p", block.title).setAttribute("data-sg-ins-title", "");
      block.body.forEach((paragraph) => addLine("p", paragraph));
      break;
    case "table":
      block.rows.forEach((row) => addLine("p", row.flatMap((cell, index) => (index > 0 ? [{ text: " | " }, ...cell] : cell))));
      break;
    case "image":
      addLine("p", block.caption ?? [{ text: block.alt }]);
      break;
    case "divider":
      wrapper.append(document.createElement("hr"));
      break;
  }

  return wrapper;
}
