import { Extension, Mark, Node, type Extensions } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import type { DOMOutputSpec, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { InlineNode } from "../editor/document-model.ts";
import { getEditorialCalloutKindTitle, type EditorialCalloutKind } from "../editor/review-contract.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import { createBlockIdPlugin } from "./block-ids.ts";
import {
  handleBackspace,
  handleEnter,
  insertHardBreak,
  setTextBlockType,
  toggleList,
  toggleMarkCommand
} from "./editor-commands.ts";
import { createPlaceholderPlugin } from "./placeholder.ts";
import { createReviewMarksPlugin, type ReviewMarkHandlers } from "./review-marks.ts";
import { createTextSanitizerPlugin } from "./text-sanitizer.ts";
import { DEFAULT_CALLOUT_KIND, V2_MARK, V2_NODE } from "./tiptap-bridge.ts";

export interface V2ExtensionOptions {
  /** Resolves an image block's `assetId` to a displayable URL. Omitted in headless use (tests). */
  resolveAssetUrl?: (assetId: string) => Promise<string | null>;
  placeholder?: string;
  locale?: AppLocale;
  imageMissingLabel?: string;
  /** Called when a review mark in the manuscript is clicked or hovered. */
  review?: ReviewMarkHandlers;
}

const blockIdAttribute = {
  id: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute("data-block-id"),
    renderHTML: (attributes: Record<string, unknown>) => (attributes.id ? { "data-block-id": attributes.id } : {})
  }
};

const DocumentNode = Node.create({ name: V2_NODE.doc, topNode: true, content: "block+" });

const TextNode = Node.create({ name: V2_NODE.text, group: "inline" });

const HardBreakNode = Node.create({
  name: V2_NODE.hardBreak,
  group: "inline",
  inline: true,
  selectable: false,
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
  renderText: () => "\n"
});

const ParagraphNode = Node.create({
  name: V2_NODE.paragraph,
  // Declared first among blocks so ProseMirror treats it as the default block type.
  priority: 1000,
  group: "block",
  content: "inline*",
  addAttributes: () => blockIdAttribute,
  parseHTML: () => [{ tag: "p" }],
  renderHTML: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0]
});

const HeadingNode = Node.create({
  name: V2_NODE.heading,
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes: () => ({
    ...blockIdAttribute,
    level: { default: 1, rendered: false }
  }),
  parseHTML: () => [
    { tag: "h1", attrs: { level: 1 } },
    { tag: "h2", attrs: { level: 2 } },
    { tag: "h3", attrs: { level: 3 } },
    { tag: "h4", attrs: { level: 3 } },
    { tag: "h5", attrs: { level: 3 } },
    { tag: "h6", attrs: { level: 3 } }
  ],
  renderHTML: ({ node, HTMLAttributes }) => [`h${node.attrs.level === 2 || node.attrs.level === 3 ? node.attrs.level : 1}`, HTMLAttributes, 0]
});

const ListItemNode = Node.create({
  name: V2_NODE.listItem,
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: "li" }],
  renderHTML: () => ["li", 0]
});

const BulletListNode = Node.create({
  name: V2_NODE.bulletList,
  group: "block",
  content: `${V2_NODE.listItem}+`,
  addAttributes: () => blockIdAttribute,
  parseHTML: () => [{ tag: "ul" }],
  renderHTML: ({ HTMLAttributes }) => ["ul", HTMLAttributes, 0]
});

const OrderedListNode = Node.create({
  name: V2_NODE.orderedList,
  group: "block",
  content: `${V2_NODE.listItem}+`,
  addAttributes: () => blockIdAttribute,
  parseHTML: () => [{ tag: "ol" }],
  renderHTML: ({ HTMLAttributes }) => ["ol", HTMLAttributes, 0]
});

const CalloutTitleNode = Node.create({
  name: V2_NODE.calloutTitle,
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: "div[data-callout-title]" }],
  renderHTML: () => ["div", { "data-callout-title": "" }, 0]
});

const CalloutBodyNode = Node.create({
  name: V2_NODE.calloutBody,
  content: "inline*",
  parseHTML: () => [{ tag: "p[data-callout-body]", priority: 60 }],
  renderHTML: () => ["p", { "data-callout-body": "" }, 0]
});

const createCalloutNode = (locale: AppLocale) => Node.create({
  name: V2_NODE.callout,
  group: "block",
  content: `${V2_NODE.calloutTitle} ${V2_NODE.calloutBody}*`,
  isolating: true,
  defining: true,
  addAttributes: () => ({
    ...blockIdAttribute,
    kind: {
      default: DEFAULT_CALLOUT_KIND,
      parseHTML: (element: HTMLElement) => element.getAttribute("data-callout-kind") || DEFAULT_CALLOUT_KIND,
      renderHTML: (attributes: Record<string, unknown>) => ({
        "data-callout-kind": attributes.kind,
        "data-callout-label": getEditorialCalloutKindTitle(attributes.kind as EditorialCalloutKind, locale)
      })
    },
    depth: {
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute("data-callout-depth"),
      renderHTML: (attributes: Record<string, unknown>) => (attributes.depth ? { "data-callout-depth": attributes.depth } : {})
    }
  }),
  parseHTML: () => [{ tag: "aside[data-callout-kind]" }],
  renderHTML: ({ HTMLAttributes }) => ["aside", HTMLAttributes, 0]
});

const DividerNode = Node.create({
  name: V2_NODE.divider,
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => blockIdAttribute,
  parseHTML: () => [{ tag: "hr" }],
  renderHTML: ({ HTMLAttributes }) => ["hr", HTMLAttributes]
});

const TableNode = Node.create({
  name: V2_NODE.table,
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({
    ...blockIdAttribute,
    rows: {
      default: [],
      parseHTML: (element: HTMLElement) => parseJsonAttribute(element.getAttribute("data-rows"), []),
      renderHTML: (attributes: Record<string, unknown>) => ({ "data-rows": JSON.stringify(attributes.rows ?? []) })
    }
  }),
  parseHTML: () => [{ tag: "table[data-rows]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "table",
    HTMLAttributes,
    ["tbody", ...(node.attrs.rows as InlineNode[][][]).map((row) => ["tr", ...row.map((cell) => ["td", ...renderInlineNodes(cell)])])]
  ] as unknown as DOMOutputSpec
});

function createImageNode(options: V2ExtensionOptions) {
  return Node.create({
    name: V2_NODE.image,
    group: "block",
    atom: true,
    selectable: true,
    addAttributes: () => ({
      ...blockIdAttribute,
      assetId: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-asset-id") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-asset-id": attributes.assetId })
      },
      alt: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-alt") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-alt": attributes.alt })
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) => parseJsonAttribute(element.getAttribute("data-caption"), null),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.caption ? { "data-caption": JSON.stringify(attributes.caption) } : {})
      }
    }),
    parseHTML: () => [{ tag: "figure[data-asset-id]" }],
    renderHTML: ({ HTMLAttributes }) => ["figure", HTMLAttributes],
    addNodeView: () => ({ node, HTMLAttributes }) => {
      const dom = document.createElement("figure");

      for (const [name, value] of Object.entries(HTMLAttributes)) {
        if (value != null) {
          dom.setAttribute(name, String(value));
        }
      }

      renderImageFigure(dom, node, options);
      return { dom };
    }
  });
}

function renderImageFigure(dom: HTMLElement, node: ProseMirrorNode, options: V2ExtensionOptions) {
  const frame = document.createElement("div");
  frame.setAttribute("data-image-frame", "loading");
  dom.append(frame);

  const captionText = ((node.attrs.caption as InlineNode[] | null) ?? []).map((part) => part.text).join("");

  if (captionText.trim()) {
    const caption = document.createElement("figcaption");
    caption.textContent = captionText;
    dom.append(caption);
  }

  const showMissing = () => {
    frame.setAttribute("data-image-frame", "missing");
    frame.textContent = options.imageMissingLabel ?? "";
  };

  const assetId = String(node.attrs.assetId ?? "");

  if (!assetId || !options.resolveAssetUrl) {
    showMissing();
    return;
  }

  options.resolveAssetUrl(assetId).then(
    (url) => {
      if (!url) {
        showMissing();
        return;
      }

      const image = document.createElement("img");
      image.src = url;
      image.alt = String(node.attrs.alt ?? "");
      image.draggable = false;
      frame.setAttribute("data-image-frame", "ready");
      frame.replaceChildren(image);
    },
    () => showMissing()
  );
}

function renderInlineNodes(nodes: InlineNode[]): unknown[] {
  return nodes.flatMap((node) => {
    const parts: unknown[] = [];

    for (const [index, text] of node.text.split("\n").entries()) {
      if (index > 0) {
        parts.push(["br"]);
      }

      if (!text) {
        continue;
      }

      let spec: unknown = text;

      if (node.italic) {
        spec = ["em", spec];
      }

      if (node.bold) {
        spec = ["strong", spec];
      }

      parts.push(spec);
    }

    return parts;
  });
}

function parseJsonAttribute<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const BoldMark = Mark.create({
  name: V2_MARK.bold,
  parseHTML: () => [
    { tag: "strong" },
    { tag: "b", getAttrs: (element) => (element as HTMLElement).style.fontWeight !== "normal" && null },
    { style: "font-weight", getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null }
  ],
  renderHTML: () => ["strong", 0]
});

const ItalicMark = Mark.create({
  name: V2_MARK.italic,
  parseHTML: () => [
    { tag: "em" },
    { tag: "i", getAttrs: (element) => (element as HTMLElement).style.fontStyle !== "normal" && null },
    { style: "font-style=italic" }
  ],
  renderHTML: () => ["em", 0]
});

const LinkMark = Mark.create({
  name: V2_MARK.link,
  inclusive: false,
  addAttributes: () => ({
    href: {
      default: "",
      parseHTML: (element: HTMLElement) => element.getAttribute("href") ?? "",
      renderHTML: (attributes: Record<string, unknown>) => ({ href: attributes.href, rel: "noopener noreferrer nofollow" })
    }
  }),
  parseHTML: () => [{ tag: "a[href]" }],
  renderHTML: ({ HTMLAttributes }) => ["a", HTMLAttributes, 0]
});

function createEditingExtension(options: V2ExtensionOptions) {
  return Extension.create({
    name: "v2Editing",
    // Above Tiptap's built-in keymap, so block-specific Enter/Backspace rules run first.
    priority: 1000,
    addProseMirrorPlugins: () => [
      history(),
      createBlockIdPlugin(),
      createTextSanitizerPlugin(),
      createReviewMarksPlugin(options.review),
      ...(options.placeholder ? [createPlaceholderPlugin(options.placeholder)] : [])
    ],
    addKeyboardShortcuts() {
      const run = (command: Parameters<typeof runCommand>[1]) => () => runCommand(this.editor, command);

      return {
        Enter: run(handleEnter),
        Backspace: run(handleBackspace),
        "Shift-Enter": run(insertHardBreak),
        "Mod-Enter": run(insertHardBreak),
        "Mod-z": run(undo),
        "Shift-Mod-z": run(redo),
        "Mod-y": run(redo),
        "Mod-b": run(toggleMarkCommand(V2_MARK.bold)),
        "Mod-i": run(toggleMarkCommand(V2_MARK.italic)),
        "Mod-Alt-0": run(setTextBlockType({ type: "paragraph" })),
        "Mod-Alt-1": run(setTextBlockType({ type: "heading", level: 1 })),
        "Mod-Alt-2": run(setTextBlockType({ type: "heading", level: 2 })),
        "Mod-Alt-3": run(setTextBlockType({ type: "heading", level: 3 })),
        "Mod-Shift-8": run(toggleList(V2_NODE.bulletList)),
        "Mod-Shift-7": run(toggleList(V2_NODE.orderedList))
      };
    }
  });
}

function runCommand(
  editor: { state: import("@tiptap/pm/state").EditorState; view: import("@tiptap/pm/view").EditorView },
  command: import("@tiptap/pm/state").Command
): boolean {
  return command(editor.state, editor.view.dispatch, editor.view);
}

export function createV2Extensions(options: V2ExtensionOptions = {}): Extensions {
  return [
    DocumentNode,
    ParagraphNode,
    HeadingNode,
    BulletListNode,
    OrderedListNode,
    ListItemNode,
    createImageNode(options),
    createCalloutNode(options.locale ?? "uk"),
    CalloutTitleNode,
    CalloutBodyNode,
    DividerNode,
    TableNode,
    TextNode,
    HardBreakNode,
    BoldMark,
    ItalicMark,
    LinkMark,
    createEditingExtension(options)
  ];
}
