import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Command } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Block, InlineNode } from "../editor/document-model.ts";
import { diffWords, type BlockDiff, type DiffSegment } from "./word-diff.ts";

/**
 * Inline review marks. Suggestions are drawn over the manuscript as ProseMirror decorations: attributes on
 * the anchored blocks, `<del>` wrappers over text that would go, and `<ins>` widgets for text that would
 * come. Nothing here touches the document, so the marks can never reach `getDocument()` or the saved draft.
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
}

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
}

interface ReviewMarksPluginState {
  marks: ReviewMark[];
  decorations: DecorationSet;
  report: ReviewDiffReport;
}

const EMPTY_REPORT: ReviewDiffReport = { drawn: [], failed: [] };
const DRAWN_DIFF_SELECTOR = 'del[data-sg-del], ins[data-sg-ins], [data-sg-ins-block], [data-sg-diff="block"]';

/** What a decoration stands for; kept in `spec` so it can be inspected without a DOM. */
export type ReviewDecorationSpec =
  | { review: "block"; blockId: string; itemIds: string[] }
  | { review: "del"; itemId: string; text: string }
  | { review: "ins"; itemId: string; text: string; nodes: InlineNode[] }
  | { review: "ins-block"; itemId: string; block: Block };

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
          return { marks, ...buildReviewMarkState(transaction.doc, marks) };
        }

        if (transaction.docChanged) {
          // Rebuilt rather than mapped: a mark belongs to block ids, and a diff is only valid for exact text.
          return { marks: value.marks, ...buildReviewMarkState(transaction.doc, value.marks) };
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

export function buildReviewDecorations(doc: ProseMirrorNode, marks: ReviewMark[]): DecorationSet {
  return buildReviewMarkState(doc, marks).decorations;
}

export function buildReviewMarkState(
  doc: ProseMirrorNode,
  marks: ReviewMark[]
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

function createInsertedText(nodes: InlineNode[]): HTMLElement {
  const element = document.createElement("ins");
  element.setAttribute("data-sg-ins", "");
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
