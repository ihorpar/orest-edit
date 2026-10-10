import type { JSONContent } from "@tiptap/core";
import {
  createBlockId,
  sanitizeEditorText,
  type Block,
  type EditorDocument,
  type InlineNode
} from "../editor/document-model.ts";
import type { EditorialCalloutDepth, EditorialCalloutKind } from "../editor/review-contract.ts";

/**
 * Bridge between the persisted `EditorDocument` model and the Tiptap/ProseMirror JSON used by the v2 editor.
 *
 * Every top-level ProseMirror node carries the block id in `attrs.id`. Soft line breaks (`\n` inside an
 * inline node) become `hardBreak` nodes and back.
 */

export const V2_NODE = {
  doc: "doc",
  text: "text",
  hardBreak: "hardBreak",
  paragraph: "paragraph",
  heading: "heading",
  bulletList: "bulletList",
  orderedList: "orderedList",
  listItem: "listItem",
  image: "image",
  callout: "callout",
  calloutTitle: "calloutTitle",
  calloutBody: "calloutBody",
  divider: "divider",
  table: "table"
} as const;

export const V2_MARK = {
  bold: "bold",
  italic: "italic",
  link: "link"
} as const;

/** Id prefixes per top-level node type, matching the prefixes v1 uses for the same block types. */
export const V2_BLOCK_ID_PREFIX: Record<string, string> = {
  [V2_NODE.paragraph]: "p",
  [V2_NODE.heading]: "h",
  [V2_NODE.bulletList]: "list",
  [V2_NODE.orderedList]: "list",
  [V2_NODE.image]: "image",
  [V2_NODE.callout]: "callout",
  [V2_NODE.divider]: "divider",
  [V2_NODE.table]: "table"
};

const BLOCK_NODE_TYPE: Record<Block["type"], string> = {
  paragraph: V2_NODE.paragraph,
  heading: V2_NODE.heading,
  bullet_list: V2_NODE.bulletList,
  ordered_list: V2_NODE.orderedList,
  image: V2_NODE.image,
  callout: V2_NODE.callout,
  divider: V2_NODE.divider,
  table: V2_NODE.table
};

const CALLOUT_KINDS: EditorialCalloutKind[] = ["mechanism", "analogy", "everyday_application", "myths_vs_truth", "top_list"];
export const DEFAULT_CALLOUT_KIND: EditorialCalloutKind = "mechanism";

type TiptapMark = NonNullable<JSONContent["marks"]>[number];

export function createBlockIdForNodeType(nodeType: string): string {
  return createBlockId(V2_BLOCK_ID_PREFIX[nodeType] ?? "block");
}

/**
 * Returns the document with a present, unique id on every block. Blocks keep their ids; a block without an
 * id, or a later block repeating an earlier id, gets a fresh one. The same object comes back when nothing
 * has to change.
 */
export function ensureDocumentBlockIds(document: EditorDocument): EditorDocument {
  const seen = new Set<string>();
  const taken = new Set(document.blocks.map((block) => block.id).filter((id) => typeof id === "string" && id));
  let changed = false;

  const blocks = document.blocks.map((block) => {
    if (typeof block.id === "string" && block.id && !seen.has(block.id)) {
      seen.add(block.id);
      return block;
    }

    let id = createBlockIdForNodeType(BLOCK_NODE_TYPE[block.type]);

    while (taken.has(id)) {
      id = createBlockIdForNodeType(BLOCK_NODE_TYPE[block.type]);
    }

    taken.add(id);
    seen.add(id);
    changed = true;
    return { ...block, id };
  });

  return changed ? { version: 2, blocks } : document;
}

/** Converts a document for the editor. Ids are normalised first, so the editor never starts with a block without one. */
export function documentToTiptap(document: EditorDocument): JSONContent {
  const content = ensureDocumentBlockIds(document).blocks.map((block) => blockToTiptapNode(block));

  return {
    type: V2_NODE.doc,
    content: content.length > 0 ? content : [{ type: V2_NODE.paragraph, attrs: { id: createBlockId("p") } }]
    // An empty document is the one case where a block is created here; it happens once, on entry to the editor.
  };
}

export function tiptapToDocument(doc: JSONContent): EditorDocument {
  const blocks: Block[] = [];

  for (const node of doc.content ?? []) {
    const block = tiptapNodeToBlock(node);

    if (block) {
      blocks.push(block);
    }
  }

  return { version: 2, blocks };
}

export function blockToTiptapNode(block: Block): JSONContent {
  switch (block.type) {
    case "paragraph":
      return withContent({ type: V2_NODE.paragraph, attrs: { id: block.id } }, inlineNodesToTiptap(block.content));
    case "heading":
      return withContent({ type: V2_NODE.heading, attrs: { id: block.id, level: block.level } }, inlineNodesToTiptap(block.content));
    case "bullet_list":
    case "ordered_list":
      return {
        type: block.type === "bullet_list" ? V2_NODE.bulletList : V2_NODE.orderedList,
        attrs: { id: block.id },
        content: (block.items.length > 0 ? block.items : [[]]).map((item) =>
          withContent({ type: V2_NODE.listItem }, inlineNodesToTiptap(item))
        )
      };
    case "image":
      return {
        type: V2_NODE.image,
        attrs: {
          id: block.id,
          assetId: block.assetId,
          alt: block.alt,
          caption: block.caption ? block.caption.map((node) => cleanInlineNode(node)) : null
        }
      };
    case "callout":
      return {
        type: V2_NODE.callout,
        attrs: { id: block.id, kind: block.kind, depth: block.depth ?? null },
        content: [
          withContent({ type: V2_NODE.calloutTitle }, inlineNodesToTiptap(block.title)),
          ...block.body.map((paragraph) => withContent({ type: V2_NODE.calloutBody }, inlineNodesToTiptap(paragraph)))
        ]
      };
    case "divider":
      return { type: V2_NODE.divider, attrs: { id: block.id } };
    case "table":
      return {
        type: V2_NODE.table,
        attrs: {
          id: block.id,
          rows: block.rows.map((row) => row.map((cell) => cell.map((node) => cleanInlineNode(node))))
        }
      };
  }
}

/**
 * Converts one top-level editor node back into a block. Ids are never invented here: a block node without
 * an id is a broken invariant and throws, so two reads of the same editor state cannot disagree.
 */
export function tiptapNodeToBlock(node: JSONContent): Block | null {
  const attrs = node.attrs ?? {};

  if (!node.type || !(node.type in V2_BLOCK_ID_PREFIX)) {
    return null;
  }

  if (typeof attrs.id !== "string" || !attrs.id) {
    throw new Error(`Editor block "${node.type}" has no id.`);
  }

  const id = attrs.id;

  switch (node.type) {
    case V2_NODE.paragraph:
      return { id, type: "paragraph", content: tiptapToInlineNodes(node.content) };
    case V2_NODE.heading:
      return { id, type: "heading", level: normalizeHeadingLevel(attrs.level), content: tiptapToInlineNodes(node.content) };
    case V2_NODE.bulletList:
    case V2_NODE.orderedList: {
      const items = (node.content ?? [])
        .filter((child) => child.type === V2_NODE.listItem)
        .map((child) => tiptapToInlineNodes(child.content));

      return {
        id,
        type: node.type === V2_NODE.bulletList ? "bullet_list" : "ordered_list",
        items: items.length > 0 ? items : [[{ text: "" }]]
      };
    }
    case V2_NODE.image: {
      const caption = Array.isArray(attrs.caption) ? normalizeStoredInlineNodes(attrs.caption) : undefined;

      return {
        id,
        type: "image",
        assetId: typeof attrs.assetId === "string" ? attrs.assetId : "",
        alt: typeof attrs.alt === "string" ? sanitizeEditorText(attrs.alt) : "",
        ...(caption ? { caption } : {})
      };
    }
    case V2_NODE.callout: {
      const children = node.content ?? [];
      const title = children.find((child) => child.type === V2_NODE.calloutTitle);
      const depth = normalizeCalloutDepth(attrs.depth);

      return {
        id,
        type: "callout",
        kind: normalizeCalloutKind(attrs.kind),
        ...(depth ? { depth } : {}),
        title: tiptapToInlineNodes(title?.content),
        body: children.filter((child) => child.type === V2_NODE.calloutBody).map((child) => tiptapToInlineNodes(child.content))
      };
    }
    case V2_NODE.divider:
      return { id, type: "divider" };
    case V2_NODE.table: {
      const rows = Array.isArray(attrs.rows) ? (attrs.rows as unknown[]) : [];

      return {
        id,
        type: "table",
        rows: rows.map((row) => (Array.isArray(row) ? row : []).map((cell) => normalizeStoredInlineNodes(cell)))
      };
    }
    default:
      return null;
  }
}

export function inlineNodesToTiptap(nodes: InlineNode[] | undefined): JSONContent[] {
  const content: JSONContent[] = [];

  for (const node of nodes ?? []) {
    const marks = inlineMarksToTiptap(node);
    const parts = sanitizeEditorText(typeof node?.text === "string" ? node.text : "").split("\n");

    for (const [index, part] of parts.entries()) {
      if (index > 0) {
        content.push(marks.length > 0 ? { type: V2_NODE.hardBreak, marks } : { type: V2_NODE.hardBreak });
      }

      if (part) {
        content.push(marks.length > 0 ? { type: V2_NODE.text, text: part, marks } : { type: V2_NODE.text, text: part });
      }
    }
  }

  return content;
}

export function tiptapToInlineNodes(content: JSONContent[] | undefined): InlineNode[] {
  const nodes: InlineNode[] = [];

  for (const child of content ?? []) {
    const text = child.type === V2_NODE.hardBreak ? "\n" : child.type === V2_NODE.text ? sanitizeEditorText(child.text ?? "") : "";

    if (!text) {
      continue;
    }

    const next = applyTiptapMarks({ text }, child.marks);
    const previous = nodes[nodes.length - 1];

    if (previous && hasSameMarks(previous, next)) {
      previous.text += next.text;
    } else {
      nodes.push(next);
    }
  }

  return nodes.length > 0 ? nodes : [{ text: "" }];
}

function withContent(node: JSONContent, content: JSONContent[]): JSONContent {
  return content.length > 0 ? { ...node, content } : node;
}

function inlineMarksToTiptap(node: InlineNode): TiptapMark[] {
  const marks: TiptapMark[] = [];

  if (node.bold) {
    marks.push({ type: V2_MARK.bold });
  }

  if (node.italic) {
    marks.push({ type: V2_MARK.italic });
  }

  if (typeof node.link === "string" && node.link.trim()) {
    marks.push({ type: V2_MARK.link, attrs: { href: node.link.trim() } });
  }

  return marks;
}

function applyTiptapMarks(node: InlineNode, marks: JSONContent["marks"]): InlineNode {
  for (const mark of marks ?? []) {
    if (mark.type === V2_MARK.bold) {
      node.bold = true;
    } else if (mark.type === V2_MARK.italic) {
      node.italic = true;
    } else if (mark.type === V2_MARK.link) {
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href.trim() : "";

      if (href) {
        node.link = href;
      }
    }
  }

  return node;
}

function hasSameMarks(left: InlineNode, right: InlineNode): boolean {
  return Boolean(left.bold) === Boolean(right.bold) && Boolean(left.italic) === Boolean(right.italic) && (left.link ?? "") === (right.link ?? "");
}

function cleanInlineNode(node: InlineNode): InlineNode {
  const clean: InlineNode = { text: sanitizeEditorText(typeof node?.text === "string" ? node.text : "") };

  if (node?.bold) {
    clean.bold = true;
  }

  if (node?.italic) {
    clean.italic = true;
  }

  if (typeof node?.link === "string" && node.link.trim()) {
    clean.link = node.link.trim();
  }

  return clean;
}

function normalizeStoredInlineNodes(value: unknown): InlineNode[] {
  if (!Array.isArray(value)) {
    return [{ text: "" }];
  }

  const nodes: InlineNode[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const next = cleanInlineNode(entry as InlineNode);
    const previous = nodes[nodes.length - 1];

    if (!next.text && nodes.length > 0) {
      continue;
    }

    if (previous && hasSameMarks(previous, next)) {
      previous.text += next.text;
    } else {
      nodes.push(next);
    }
  }

  return nodes.length > 0 ? nodes : [{ text: "" }];
}

function normalizeHeadingLevel(value: unknown): 1 | 2 | 3 {
  return value === 2 || value === 3 ? value : 1;
}

function normalizeCalloutKind(value: unknown): EditorialCalloutKind {
  return CALLOUT_KINDS.includes(value as EditorialCalloutKind) ? (value as EditorialCalloutKind) : DEFAULT_CALLOUT_KIND;
}

function normalizeCalloutDepth(value: unknown): EditorialCalloutDepth | undefined {
  return value === "brief" || value === "deep" ? value : undefined;
}
