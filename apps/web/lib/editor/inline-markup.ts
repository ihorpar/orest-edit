import type { InlineNode } from "./document-model.ts";
import { createInlineText, normalizeInlineNodes } from "./document-model.ts";

export function parseBoldMarkdownToInlineNodes(text: string): InlineNode[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const nodes: InlineNode[] = [];
  const pattern = /\*\*([\s\S]+?)\*\*/g;
  let lastIndex = 0;

  for (const match of normalized.matchAll(pattern)) {
    const start = match.index ?? 0;
    const token = match[0] ?? "";
    const boldText = match[1] ?? "";

    if (start > lastIndex) {
      nodes.push(createInlineText(normalized.slice(lastIndex, start)));
    }

    if (boldText) {
      nodes.push(createInlineText(boldText, { bold: true }));
    }

    lastIndex = start + token.length;
  }

  if (lastIndex < normalized.length) {
    nodes.push(createInlineText(normalized.slice(lastIndex)));
  }

  return normalizeInlineNodes(nodes.length > 0 ? nodes : [createInlineText("")]);
}

export function serializeInlineNodesToBoldMarkdown(nodes: InlineNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      const text = node.text ?? "";

      if (!text) {
        return "";
      }

      return node.bold ? `**${text}**` : text;
    })
    .join("");
}
