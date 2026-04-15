import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

import type { Block, EditorDocument, InlineNode } from "./document-model";
import {
  createBlockId,
  createEmptyParagraphBlock,
  createInlineText,
  ensureDocumentHasBlocks,
  normalizeInlineNodes
} from "./document-model";

export type ImportedDocumentFormat = "txt" | "docx" | "clipboard_text" | "clipboard_html";

export interface ImportedDocumentResult {
  document: EditorDocument;
  warnings: string[];
  format: ImportedDocumentFormat;
  assets?: ImportedDocumentAsset[];
}

export interface ImportedDocumentAsset {
  assetId: string;
  blob: Blob;
  mimeType: string;
}

interface ListContext {
  type: "bullet_list" | "ordered_list";
  items: InlineNode[][];
}

interface DocxImportContext {
  numberingByNumId: Map<string, "bullet_list" | "ordered_list">;
  imagesByRelationshipId: Map<string, ImportedDocxImage>;
  assets: ImportedDocumentAsset[];
  warnings: Set<string>;
}

type XmlOrderedNode = Record<string, unknown>;

type DocxRunPart = InlineNode | ImportedDocxImage;

interface ImportedDocxImage {
  kind: "image";
  assetId: string;
  mimeType: string;
  alt: string;
}

const orderedXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: true,
  trimValues: false
});

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false
});

const LIST_BULLET_PATTERN = /^[-*•]\s+/;
const LIST_ORDERED_PATTERN = /^\d+[.)]\s+/;
const HEADING_PATTERN = /^(#{1,3})\s+(.+)$/;
const HTML_BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "DL",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL"
]);

export function importPlainTextToDocument(text: string): ImportedDocumentResult {
  return {
    document: buildDocumentFromPlainText(text),
    warnings: [],
    format: "txt"
  };
}

export async function importFileToDocument(file: File): Promise<ImportedDocumentResult> {
  const normalizedName = file.name.toLowerCase();

  if (normalizedName.endsWith(".docx")) {
    return importDocxArrayBuffer(await file.arrayBuffer());
  }

  if (normalizedName.endsWith(".txt") || file.type === "text/plain" || !file.type) {
    return importPlainTextToDocument(await file.text());
  }

  throw new Error("Поки що підтримуються лише файли .docx та .txt.");
}

export async function importDocxArrayBuffer(arrayBuffer: ArrayBuffer): Promise<ImportedDocumentResult> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");

  if (!documentXml) {
    throw new Error("Не вдалося прочитати вміст DOCX.");
  }

  const numberingXml = await zip.file("word/numbering.xml")?.async("string");
  const relationshipsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
  const warnings = new Set<string>();
  const { imagesByRelationshipId, assets } = await buildDocxImageMap(zip, relationshipsXml, warnings);
  const context: DocxImportContext = {
    numberingByNumId: buildDocxNumberingMap(numberingXml),
    imagesByRelationshipId,
    assets,
    warnings
  };
  const ordered = orderedXmlParser.parse(documentXml) as XmlOrderedNode[];
  const documentRoot = ordered.find((node) => Boolean(node["w:document"]));
  const documentNode = getOrderedNodeChildren(documentRoot, "w:document");
  const bodyNode = findOrderedChild(documentNode, "w:body");
  const blocks: Block[] = [];
  let pendingList: ListContext | null = null;

  for (const child of bodyNode) {
    if (child["w:p"]) {
      const parsedBlocks = parseDocxParagraph(getOrderedNodeChildren(child, "w:p"), context);

      if (parsedBlocks.length === 0) {
        continue;
      }

      for (const parsed of parsedBlocks) {
        if (parsed.type === "bullet_list" || parsed.type === "ordered_list") {
          if (!pendingList || pendingList.type !== parsed.type) {
            flushPendingList(blocks, pendingList);
            pendingList = { type: parsed.type, items: [] };
          }

          pendingList.items.push(parsed.items[0]);
          continue;
        }

        if (parsed.type === "image") {
          flushPendingList(blocks, pendingList);
          pendingList = null;
          blocks.push(parsed);
          continue;
        }

        flushPendingList(blocks, pendingList);
        pendingList = null;
        blocks.push(parsed);
      }
      continue;
    }

    if (child["w:tbl"]) {
      flushPendingList(blocks, pendingList);
      pendingList = null;
      const tableBlock = parseDocxTable(getOrderedNodeChildren(child, "w:tbl"), context);

      if (tableBlock) {
        blocks.push(tableBlock);
      }
    }
  }

  flushPendingList(blocks, pendingList);

  return {
    document: ensureDocumentHasBlocks({ version: 2, blocks }),
    warnings: Array.from(context.warnings),
    format: "docx",
    assets: context.assets
  };
}

export function importHtmlToDocument(html: string, fallbackText = ""): ImportedDocumentResult {
  if (typeof DOMParser === "undefined") {
    return {
      document: buildDocumentFromPlainText(fallbackText || stripHtml(html)),
      warnings: [],
      format: "clipboard_html"
    };
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  const warnings = new Set<string>();
  const blocks = collectHtmlBlocks(parsed.body, warnings);

  return {
    document: ensureDocumentHasBlocks({ version: 2, blocks }),
    warnings: Array.from(warnings),
    format: "clipboard_html"
  };
}

function buildDocumentFromPlainText(text: string): EditorDocument {
  const normalized = text.replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    return { version: 2, blocks: [createEmptyParagraphBlock()] };
  }

  const lines = normalized.split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(HEADING_PATTERN);

    if (headingMatch) {
      blocks.push({
        id: createBlockId("heading"),
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        content: [createInlineText(headingMatch[2].trim())]
      });
      index += 1;
      continue;
    }

    if (LIST_BULLET_PATTERN.test(line)) {
      const items: InlineNode[][] = [];

      while (index < lines.length && LIST_BULLET_PATTERN.test(lines[index].trim())) {
        items.push([createInlineText(lines[index].trim().replace(LIST_BULLET_PATTERN, ""))]);
        index += 1;
      }

      blocks.push({
        id: createBlockId("list"),
        type: "bullet_list",
        items
      });
      continue;
    }

    if (LIST_ORDERED_PATTERN.test(line)) {
      const items: InlineNode[][] = [];

      while (index < lines.length && LIST_ORDERED_PATTERN.test(lines[index].trim())) {
        items.push([createInlineText(lines[index].trim().replace(LIST_ORDERED_PATTERN, ""))]);
        index += 1;
      }

      blocks.push({
        id: createBlockId("olist"),
        type: "ordered_list",
        items
      });
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const currentLine = lines[index].trim();

      if (!currentLine) {
        index += 1;
        break;
      }

      if (HEADING_PATTERN.test(currentLine) || LIST_BULLET_PATTERN.test(currentLine) || LIST_ORDERED_PATTERN.test(currentLine)) {
        break;
      }

      paragraphLines.push(currentLine);
      index += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push({
        id: createBlockId("p"),
        type: "paragraph",
        content: [createInlineText(paragraphLines.join(" "))]
      });
    }
  }

  return ensureDocumentHasBlocks({
    version: 2,
    blocks
  });
}

function buildDocxNumberingMap(numberingXml: string | undefined): Map<string, "bullet_list" | "ordered_list"> {
  if (!numberingXml) {
    return new Map();
  }

  const numberingDocument = xmlParser.parse(numberingXml) as Record<string, unknown>;
  const numberingRoot = asRecord(numberingDocument["w:numbering"]);

  if (!numberingRoot) {
    return new Map();
  }

  const abstractTypeById = new Map<string, "bullet_list" | "ordered_list">();

  for (const entry of asArray(numberingRoot["w:abstractNum"])) {
    const abstractNode = asRecord(entry);
    const abstractId = typeof abstractNode["w:abstractNumId"] === "string" ? abstractNode["w:abstractNumId"] : null;
    const firstLevel = asArray(abstractNode["w:lvl"])[0];
    const levelNode = asRecord(firstLevel);
    const numFmt = asRecord(levelNode["w:numFmt"]);
    const numFmtValue = typeof numFmt["w:val"] === "string" ? numFmt["w:val"].toLowerCase() : "";

    if (!abstractId) {
      continue;
    }

    abstractTypeById.set(abstractId, numFmtValue === "bullet" ? "bullet_list" : "ordered_list");
  }

  const numberingByNumId = new Map<string, "bullet_list" | "ordered_list">();

  for (const entry of asArray(numberingRoot["w:num"])) {
    const numNode = asRecord(entry);
    const numId = typeof numNode["w:numId"] === "string" ? numNode["w:numId"] : null;
    const abstractNumNode = asRecord(numNode["w:abstractNumId"]);
    const abstractId = typeof abstractNumNode["w:val"] === "string" ? abstractNumNode["w:val"] : null;

    if (!numId || !abstractId) {
      continue;
    }

    numberingByNumId.set(numId, abstractTypeById.get(abstractId) ?? "bullet_list");
  }

  return numberingByNumId;
}

async function buildDocxImageMap(
  zip: JSZip,
  relationshipsXml: string | undefined,
  warnings: Set<string>
): Promise<{ imagesByRelationshipId: Map<string, ImportedDocxImage>; assets: ImportedDocumentAsset[] }> {
  const imagesByRelationshipId = new Map<string, ImportedDocxImage>();
  const assets: ImportedDocumentAsset[] = [];

  if (!relationshipsXml) {
    return { imagesByRelationshipId, assets };
  }

  const relationshipsDocument = xmlParser.parse(relationshipsXml) as Record<string, unknown>;
  const relationshipsRoot = asRecord(relationshipsDocument.Relationships);

  for (const entry of asArray(relationshipsRoot.Relationship)) {
    const relationship = asRecord(entry);
    const id = typeof relationship.Id === "string" ? relationship.Id : "";
    const target = typeof relationship.Target === "string" ? relationship.Target : "";
    const type = typeof relationship.Type === "string" ? relationship.Type : "";
    const targetMode = typeof relationship.TargetMode === "string" ? relationship.TargetMode : "";

    if (!id || !target || !type.endsWith("/image")) {
      continue;
    }

    if (targetMode.toLowerCase() === "external") {
      warnings.add("Зовнішні зображення з DOCX поки що не імпортуються.");
      continue;
    }

    const imagePath = resolveDocxRelationshipTarget("word/document.xml", target);
    const imageFile = zip.file(imagePath);

    if (!imageFile) {
      warnings.add("Не вдалося знайти зображення всередині DOCX.");
      continue;
    }

    const mimeType = mimeTypeFromPath(imagePath);
    const bytes = await imageFile.async("uint8array");
    const imageBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(imageBuffer).set(bytes);
    const assetId = createBlockId("asset");
    const blob = new Blob([imageBuffer], { type: mimeType });

    assets.push({ assetId, blob, mimeType });
    imagesByRelationshipId.set(id, {
      kind: "image",
      assetId,
      mimeType,
      alt: imagePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "image"
    });
  }

  return { imagesByRelationshipId, assets };
}

function parseDocxParagraph(nodes: XmlOrderedNode[], context: DocxImportContext): Block[] {
  let styleValue = "";
  let listType: "bullet_list" | "ordered_list" | null = null;
  const parts: DocxRunPart[] = [];

  for (const node of nodes) {
    if (node["w:pPr"]) {
      const props = parseDocxParagraphProps(getOrderedNodeChildren(node, "w:pPr"), context);
      styleValue = props.styleValue;
      listType = props.listType;
      continue;
    }

    if (node["w:r"]) {
      parts.push(...parseDocxRunWithImages(getOrderedNodeChildren(node, "w:r"), context, {}));
      continue;
    }

    if (node["w:hyperlink"]) {
      parts.push(...parseDocxHyperlink(getOrderedNodeChildren(node, "w:hyperlink"), context));
      continue;
    }
  }

  return buildParagraphBlocksFromParts(parts, {
    styleValue,
    listType
  });
}

function buildParagraphBlocksFromParts(
  parts: DocxRunPart[],
  props: { styleValue: string; listType: "bullet_list" | "ordered_list" | null }
): Block[] {
  const blocks: Block[] = [];
  let pendingInlineNodes: InlineNode[] = [];

  const flushText = () => {
    const normalizedInlineNodes = normalizeInlineNodes(pendingInlineNodes);
    pendingInlineNodes = [];
    const textContent = normalizedInlineNodes.map((entry) => entry.text).join("").trim();

    if (!textContent) {
      return;
    }

    if (props.listType) {
      blocks.push({
        id: createBlockId(props.listType === "bullet_list" ? "list" : "olist"),
        type: props.listType,
        items: [normalizedInlineNodes]
      });
      return;
    }

    const headingLevel = resolveHeadingLevel(props.styleValue);

    if (headingLevel) {
      blocks.push({
        id: createBlockId("heading"),
        type: "heading",
        level: headingLevel,
        content: normalizedInlineNodes
      });
      return;
    }

    blocks.push({
      id: createBlockId("p"),
      type: "paragraph",
      content: normalizedInlineNodes
    });
  };

  for (const part of parts) {
    if (isImportedDocxImage(part)) {
      flushText();
      blocks.push({
        id: createBlockId("image"),
        type: "image",
        assetId: part.assetId,
        alt: part.alt,
        caption: [createInlineText("")]
      });
      continue;
    }

    pendingInlineNodes.push(part);
  }

  flushText();
  return blocks;
}

function isImportedDocxImage(part: DocxRunPart): part is ImportedDocxImage {
  return "kind" in part && part.kind === "image";
}

function resolveDocxRunImage(node: XmlOrderedNode, context: DocxImportContext): ImportedDocxImage | null {
  const relationshipId = findOrderedNodeAttribute(node, ["r:embed", "r:id", "r:link"]);

  if (!relationshipId) {
    return null;
  }

  return context.imagesByRelationshipId.get(relationshipId) ?? null;
}

function parseDocxParagraphProps(nodes: XmlOrderedNode[], context: DocxImportContext): {
  styleValue: string;
  listType: "bullet_list" | "ordered_list" | null;
} {
  let styleValue = "";
  let listType: "bullet_list" | "ordered_list" | null = null;

  for (const node of nodes) {
    if (node["w:pStyle"]) {
      styleValue = getOrderedNodeAttribute(node, "w:val");
      continue;
    }

    if (node["w:numPr"]) {
      const numberingChildren = getOrderedNodeChildren(node, "w:numPr");
      let numId = "";

      for (const numberingNode of numberingChildren) {
        if (numberingNode["w:numId"]) {
          numId = getOrderedNodeAttribute(numberingNode, "w:val");
        }
      }

      if (numId) {
        listType = context.numberingByNumId.get(numId) ?? "bullet_list";
      }
    }
  }

  return { styleValue, listType };
}

function parseDocxRunWithImages(
  nodes: XmlOrderedNode[],
  context: DocxImportContext,
  marks: Omit<InlineNode, "text">
): DocxRunPart[] {
  const runMarks = { ...marks };
  const parts: DocxRunPart[] = [];

  for (const node of nodes) {
    if (node["w:rPr"]) {
      Object.assign(runMarks, parseDocxRunMarks(getOrderedNodeChildren(node, "w:rPr")));
      continue;
    }

    if (node["w:t"]) {
      const text = getOrderedNodeText(getOrderedNodeChildren(node, "w:t"));

      if (text) {
        parts.push({ text, ...runMarks });
      }

      continue;
    }

    if (node["w:tab"]) {
      parts.push({ text: "\t", ...runMarks });
      continue;
    }

    if (node["w:br"] || node["w:cr"]) {
      parts.push({ text: "\n", ...runMarks });
      continue;
    }

    const image = node["w:drawing"] || node["w:pict"] ? resolveDocxRunImage(node, context) : null;

    if (image) {
      parts.push(image);
      continue;
    }

    if ((node["w:drawing"] || node["w:pict"]) && !image) {
      context.warnings.add("Зображення з DOCX поки що не імпортуються.");
    }
  }

  return parts;
}

function parseDocxRunMarks(nodes: XmlOrderedNode[]): Omit<InlineNode, "text"> {
  const nextMarks: Omit<InlineNode, "text"> = {};

  for (const node of nodes) {
    if (node["w:b"]) {
      nextMarks.bold = true;
    }

    if (node["w:i"]) {
      nextMarks.italic = true;
    }
  }

  return nextMarks;
}

function parseDocxHyperlink(nodes: XmlOrderedNode[], context: DocxImportContext): DocxRunPart[] {
  const parts: DocxRunPart[] = [];

  for (const node of nodes) {
    if (node["w:r"]) {
      parts.push(...parseDocxRunWithImages(getOrderedNodeChildren(node, "w:r"), context, {}));
    }
  }

  return parts;
}

function parseDocxTable(nodes: XmlOrderedNode[], context: DocxImportContext): Block | null {
  const rows: InlineNode[][][] = [];

  for (const node of nodes) {
    if (!node["w:tr"]) {
      continue;
    }

    const rowCells: InlineNode[][] = [];

    for (const rowNode of getOrderedNodeChildren(node, "w:tr")) {
      if (!rowNode["w:tc"]) {
        continue;
      }

      const cellParagraphs: string[] = [];

      for (const child of getOrderedNodeChildren(rowNode, "w:tc")) {
        if (!child["w:p"]) {
          continue;
        }

        const paragraphBlocks = parseDocxParagraph(getOrderedNodeChildren(child, "w:p"), context);
        const paragraphText =
          paragraphBlocks
            .map((paragraph) =>
              paragraph.type === "paragraph"
                ? paragraph.content.map((entry) => entry.text).join("")
                : paragraph.type === "heading"
                  ? paragraph.content.map((entry) => entry.text).join("")
                  : paragraph.type === "bullet_list" || paragraph.type === "ordered_list"
                    ? paragraph.items.map((entry) => entry.map((part) => part.text).join("")).join("\n")
                    : paragraph.type === "image"
                      ? `[image: ${paragraph.alt}]`
                      : ""
            )
            .filter(Boolean)
            .join("\n");

        if (paragraphText.trim()) {
          cellParagraphs.push(paragraphText);
        }
      }

      rowCells.push([createInlineText(cellParagraphs.join("\n"))]);
    }

    if (rowCells.length > 0) {
      rows.push(rowCells);
    }
  }

  if (rows.length === 0) {
    return null;
  }

  return {
    id: createBlockId("table"),
    type: "table",
    rows
  };
}

function collectHtmlBlocks(root: ParentNode, warnings: Set<string>): Block[] {
  const blocks: Block[] = [];

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();

      if (text) {
        blocks.push({
          id: createBlockId("p"),
          type: "paragraph",
          content: [createInlineText(text)]
        });
      }

      continue;
    }

    if (!(child instanceof HTMLElement)) {
      continue;
    }

    const tagName = child.tagName.toUpperCase();

    if (tagName === "H1" || tagName === "H2" || tagName === "H3") {
      const level = Number(tagName.slice(1)) as 1 | 2 | 3;
      const content = htmlNodeToInlineNodes(child);

      if (content.some((entry) => entry.text.trim())) {
        blocks.push({
          id: createBlockId("heading"),
          type: "heading",
          level,
          content
        });
      }

      continue;
    }

    if (tagName === "P" || tagName === "BLOCKQUOTE" || tagName === "PRE") {
      const content = htmlNodeToInlineNodes(child);

      if (content.some((entry) => entry.text.trim())) {
        blocks.push({
          id: createBlockId("p"),
          type: "paragraph",
          content
        });
      }

      continue;
    }

    if (tagName === "UL" || tagName === "OL") {
      const items = Array.from(child.children)
        .filter((entry): entry is HTMLLIElement => entry instanceof HTMLLIElement)
        .map((entry) => htmlNodeToInlineNodes(entry))
        .filter((entry) => entry.some((part) => part.text.trim()));

      if (items.length > 0) {
        blocks.push({
          id: createBlockId(tagName === "UL" ? "list" : "olist"),
          type: tagName === "UL" ? "bullet_list" : "ordered_list",
          items
        });
      }

      continue;
    }

    if (tagName === "TABLE") {
      const rows = Array.from(child.querySelectorAll(":scope > tbody > tr, :scope > tr"))
        .map((row) =>
          Array.from(row.querySelectorAll(":scope > th, :scope > td"))
            .map((cell) => htmlNodeToInlineNodes(cell))
            .filter((entry) => entry.length > 0)
        )
        .filter((row) => row.length > 0);

      if (rows.length > 0) {
        blocks.push({
          id: createBlockId("table"),
          type: "table",
          rows
        });
      }

      continue;
    }

    if (tagName === "HR") {
      blocks.push({
        id: createBlockId("divider"),
        type: "divider"
      });
      continue;
    }

    if (tagName === "IMG") {
      warnings.add("Зображення з буфера обміну поки що не імпортуються.");
      continue;
    }

    if (hasDirectHtmlBlockChildren(child)) {
      blocks.push(...collectHtmlBlocks(child, warnings));
      continue;
    }

    const content = htmlNodeToInlineNodes(child);

    if (content.some((entry) => entry.text.trim())) {
      blocks.push({
        id: createBlockId("p"),
        type: "paragraph",
        content
      });
    }
  }

  return blocks;
}

function htmlNodeToInlineNodes(node: Node, marks: Omit<InlineNode, "text"> = {}): InlineNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [{ text: node.textContent ?? "", ...marks }];
  }

  if (!(node instanceof HTMLElement)) {
    return [];
  }

  if (node.tagName === "BR") {
    return [{ text: "\n", ...marks }];
  }

  const nextMarks: Omit<InlineNode, "text"> = {
    bold: marks.bold || node.tagName === "B" || node.tagName === "STRONG" ? true : undefined,
    italic: marks.italic || node.tagName === "I" || node.tagName === "EM" ? true : undefined,
    link: node.tagName === "A" ? node.getAttribute("href") || marks.link : marks.link
  };

  const collected = Array.from(node.childNodes).flatMap((child) => htmlNodeToInlineNodes(child, nextMarks));
  return normalizeInlineNodes(collected);
}

function hasDirectHtmlBlockChildren(element: HTMLElement): boolean {
  return Array.from(element.children).some((child) => HTML_BLOCK_TAGS.has(child.tagName.toUpperCase()));
}

function flushPendingList(blocks: Block[], pendingList: ListContext | null) {
  if (!pendingList || pendingList.items.length === 0) {
    return;
  }

  blocks.push({
    id: createBlockId(pendingList.type === "bullet_list" ? "list" : "olist"),
    type: pendingList.type,
    items: pendingList.items
  });
}

function getOrderedNodeChildren(node: XmlOrderedNode | undefined, key: string): XmlOrderedNode[] {
  const children = node?.[key];
  return Array.isArray(children) ? (children as XmlOrderedNode[]) : [];
}

function getOrderedNodeAttribute(node: XmlOrderedNode, attributeName: string): string {
  const attributes = asRecord(node[":@"]);
  return typeof attributes[attributeName] === "string" ? attributes[attributeName] : "";
}

function findOrderedNodeAttribute(node: XmlOrderedNode, attributeNames: string[]): string {
  const attributes = asRecord(node[":@"]);

  for (const attributeName of attributeNames) {
    const value = attributes[attributeName];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === "object") {
          const match = findOrderedNodeAttribute(child as XmlOrderedNode, attributeNames);

          if (match) {
            return match;
          }
        }
      }
    }
  }

  return "";
}

function getOrderedNodeText(nodes: XmlOrderedNode[]): string {
  return nodes
    .map((node) => (typeof node["#text"] === "string" ? node["#text"] : ""))
    .join("");
}

function findOrderedChild(nodes: XmlOrderedNode[], key: string): XmlOrderedNode[] {
  for (const node of nodes) {
    if (node[key]) {
      return getOrderedNodeChildren(node, key);
    }
  }

  return [];
}

function resolveHeadingLevel(styleValue: string): 1 | 2 | 3 | null {
  const normalized = styleValue.trim().toLowerCase();

  if (normalized.endsWith("heading1") || normalized === "h1") {
    return 1;
  }

  if (normalized.endsWith("heading2") || normalized === "h2") {
    return 2;
  }

  if (normalized.endsWith("heading3") || normalized === "h3") {
    return 3;
  }

  return null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function resolveDocxRelationshipTarget(sourcePath: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, "/");

  if (normalizedTarget.startsWith("/")) {
    return normalizedTarget.replace(/^\/+/, "");
  }

  const sourceDirectory = sourcePath.split("/").slice(0, -1);
  const segments = [...sourceDirectory, ...normalizedTarget.split("/")];
  const resolved: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      resolved.pop();
      continue;
    }

    resolved.push(segment);
  }

  return resolved.join("/");
}

function mimeTypeFromPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined ? [] : [value];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
