"use client";

import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
  AlignmentType,
  LevelFormat
} from "docx";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type {
  Blockquote,
  Code,
  Content,
  Heading,
  Image,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph as MdParagraph,
  PhrasingContent,
  Root,
  Table as MdTable,
  TableCell as MdTableCell,
  TableRow as MdTableRow
} from "mdast";
import { parseEditorAssetToken, resolveEditorAssetUrl } from "./asset-store";

const BODY_FONT = "Times New Roman";
const HEADING_FONT = "Cambria";
const CODE_FONT = "Consolas";
const DEFAULT_FILE_NAME_BASE = "Рукопис";
const MAX_IMAGE_WIDTH_PX = 560;
const MAX_IMAGE_HEIGHT_PX = 900;

export interface DocxExportWarning {
  code: "image_unresolved" | "image_unsupported";
  message: string;
  source?: string;
}

export interface ExportDocxInput {
  markdown: string;
  fileNameBase?: string;
}

export interface ExportDocxResult {
  blob: Blob;
  fileName: string;
  warnings: DocxExportWarning[];
}

interface ResolvedImageAsset {
  data: Uint8Array;
  mimeType: string;
  widthPx: number;
  heightPx: number;
}

interface ImageReference {
  alt: string;
  source: string;
  caption?: string;
}

interface DirectiveCalloutSegment {
  type: "directive_callout";
  kind: string;
  title: string;
  bodyLines: string[];
}

interface MarkdownSegment {
  type: "markdown";
  markdown: string;
}

type ExportSegment = DirectiveCalloutSegment | MarkdownSegment;

type ParagraphChild = TextRun | ExternalHyperlink | ImageRun;

interface RenderContext {
  warnings: DocxExportWarning[];
  warningKeys: Set<string>;
  resolvedImages: Map<string, ResolvedImageAsset>;
  imageReferenceBySource: Map<string, ImageReference>;
}

export async function exportMarkdownToDocx(input: ExportDocxInput): Promise<ExportDocxResult> {
  const markdown = normalizeNewlines(input.markdown || "").trim();
  const warnings: DocxExportWarning[] = [];
  const warningKeys = new Set<string>();
  const imageReferences = collectImageReferences(markdown);
  const resolvedImages = await resolveImages(imageReferences, warnings, warningKeys);
  const renderContext: RenderContext = {
    warnings,
    warningKeys,
    resolvedImages,
    imageReferenceBySource: new Map(imageReferences.map((reference) => [reference.source, reference]))
  };

  const children = await renderSegmentsToDocx(splitIntoSegments(markdown), renderContext);
  const document = buildDocument(children);
  const blob = await Packer.toBlob(document);

  return {
    blob,
    fileName: buildDocxFileName(input.fileNameBase || deriveDocxFileNameBase(markdown)),
    warnings
  };
}

export function deriveDocxFileNameBase(markdown: string): string {
  const normalized = normalizeNewlines(markdown);
  const lines = normalized.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const headingMatch = /^(?:#{1,6}\s+)(.+)$/.exec(trimmed);

    if (headingMatch?.[1]) {
      return headingMatch[1].trim();
    }

    return trimmed;
  }

  return DEFAULT_FILE_NAME_BASE;
}

export function buildDocxFileName(fileNameBase: string): string {
  const base = sanitizeFileName(fileNameBase || DEFAULT_FILE_NAME_BASE) || DEFAULT_FILE_NAME_BASE;
  const date = new Date().toISOString().slice(0, 10);
  return `${base}-${date}.docx`;
}

function buildDocument(children: Array<Paragraph | Table>): Document {
  return new Document({
    styles: {
      default: {
        document: {
          run: {
            font: BODY_FONT,
            size: 24,
            language: {
              value: "uk-UA"
            }
          },
          paragraph: {
            spacing: {
              line: 360,
              after: 200
            }
          }
        }
      },
      paragraphStyles: [
        {
          id: "TitleHeading",
          name: "Title Heading",
          basedOn: "Normal",
          next: "Normal",
          run: {
            font: HEADING_FONT,
            size: 46,
            bold: true,
            color: "0F172A"
          },
          paragraph: {
            spacing: {
              before: 120,
              after: 260
            }
          }
        },
        {
          id: "HeadingOne",
          name: "Heading One",
          basedOn: "Normal",
          next: "Normal",
          run: {
            font: HEADING_FONT,
            size: 36,
            bold: true,
            color: "0F172A"
          },
          paragraph: {
            spacing: {
              before: 280,
              after: 180
            }
          }
        },
        {
          id: "HeadingTwo",
          name: "Heading Two",
          basedOn: "Normal",
          next: "Normal",
          run: {
            font: HEADING_FONT,
            size: 32,
            bold: true,
            color: "1E293B"
          },
          paragraph: {
            spacing: {
              before: 240,
              after: 150
            }
          }
        },
        {
          id: "HeadingThree",
          name: "Heading Three",
          basedOn: "Normal",
          next: "Normal",
          run: {
            font: HEADING_FONT,
            size: 28,
            bold: true,
            color: "334155"
          },
          paragraph: {
            spacing: {
              before: 200,
              after: 120
            }
          }
        },
        {
          id: "Quote",
          name: "Quote",
          basedOn: "Normal",
          next: "Normal",
          run: {
            italics: true,
            color: "334155"
          },
          paragraph: {
            indent: {
              left: 420
            },
            border: {
              left: {
                style: BorderStyle.SINGLE,
                color: "94A3B8",
                size: 8,
                space: 10
              }
            },
            spacing: {
              before: 80,
              after: 140
            }
          }
        },
        {
          id: "ImageCaption",
          name: "Image Caption",
          basedOn: "Normal",
          next: "Normal",
          run: {
            color: "64748B",
            size: 20,
            italics: true
          },
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: {
              before: 60,
              after: 180
            }
          }
        },
        {
          id: "CodeBlock",
          name: "Code Block",
          basedOn: "Normal",
          next: "Normal",
          run: {
            font: CODE_FONT,
            size: 20,
            color: "0F172A"
          },
          paragraph: {
            indent: {
              left: 220,
              right: 220
            },
            shading: {
              fill: "F8FAFC",
              type: ShadingType.CLEAR
            },
            border: {
              left: {
                style: BorderStyle.SINGLE,
                color: "CBD5E1",
                size: 6,
                space: 8
              }
            },
            spacing: {
              before: 100,
              after: 160
            }
          }
        }
      ]
    },
    numbering: {
      config: [
        {
          reference: "orest-bullet",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: 720,
                    hanging: 260
                  }
                }
              }
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: "◦",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: 1080,
                    hanging: 260
                  }
                }
              }
            }
          ]
        },
        {
          reference: "orest-number",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: 720,
                    hanging: 260
                  }
                }
              }
            },
            {
              level: 1,
              format: LevelFormat.DECIMAL,
              text: "%2.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: 1080,
                    hanging: 260
                  }
                }
              }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {},
        children
      }
    ]
  });
}

async function renderSegmentsToDocx(segments: ExportSegment[], context: RenderContext): Promise<Array<Paragraph | Table>> {
  const children: Array<Paragraph | Table> = [];

  for (const segment of segments) {
    if (segment.type === "directive_callout") {
      children.push(renderDirectiveCallout(segment));
      continue;
    }

    if (!segment.markdown.trim()) {
      continue;
    }

    const tree = unified().use(remarkParse).use(remarkGfm).parse(segment.markdown) as Root;
    const rendered = await renderContentNodes(tree.children, context, 0);
    children.push(...rendered);
  }

  if (children.length === 0) {
    children.push(new Paragraph(""));
  }

  return children;
}

async function renderContentNodes(nodes: Content[], context: RenderContext, listDepth: number): Promise<Array<Paragraph | Table>> {
  const children: Array<Paragraph | Table> = [];

  for (const node of nodes) {
    if (node.type === "heading") {
      children.push(renderHeading(node));
      continue;
    }

    if (node.type === "paragraph") {
      const renderedImage = await renderStandaloneImageParagraph(node, context);

      if (renderedImage.length > 0) {
        children.push(...renderedImage);
      } else {
        children.push(renderParagraph(node));
      }
      continue;
    }

    if (node.type === "code") {
      children.push(renderCodeBlock(node));
      continue;
    }

    if (node.type === "blockquote") {
      children.push(...renderBlockquote(node));
      continue;
    }

    if (node.type === "list") {
      children.push(...(await renderList(node, context, listDepth)));
      continue;
    }

    if (node.type === "table") {
      children.push(renderTable(node));
      continue;
    }

    if (node.type === "thematicBreak") {
      children.push(renderThematicBreak());
    }
  }

  return children;
}

function renderHeading(node: Heading): Paragraph {
  const textRuns = renderInlineNodes(node.children);
  const depth = Math.max(1, Math.min(node.depth, 3));

  if (depth === 1) {
    return new Paragraph({
      children: textRuns,
      heading: HeadingLevel.TITLE,
      style: "TitleHeading"
    });
  }

  if (depth === 2) {
    return new Paragraph({
      children: textRuns,
      heading: HeadingLevel.HEADING_1,
      style: "HeadingOne"
    });
  }

  if (depth === 3) {
    return new Paragraph({
      children: textRuns,
      heading: HeadingLevel.HEADING_2,
      style: "HeadingTwo"
    });
  }

  return new Paragraph({
    children: textRuns,
    heading: HeadingLevel.HEADING_3,
    style: "HeadingThree"
  });
}

function renderParagraph(node: MdParagraph): Paragraph {
  const children = renderInlineNodes(node.children);

  if (children.length === 0) {
    return new Paragraph({ text: "" });
  }

  return new Paragraph({
    children
  });
}

function renderCodeBlock(node: Code): Paragraph {
  const languageHint = node.lang?.trim() ? `${node.lang.trim()}\n` : "";
  const codeText = `${languageHint}${node.value}`;

  return new Paragraph({
    style: "CodeBlock",
    children: [
      new TextRun({
        text: codeText,
        font: CODE_FONT,
        size: 20
      })
    ]
  });
}

function renderBlockquote(node: Blockquote): Paragraph[] {
  const text = collectBlockquoteText(node);

  if (!text.trim()) {
    return [new Paragraph({ text: "", style: "Quote" })];
  }

  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) =>
      new Paragraph({
        style: "Quote",
        children: [new TextRun({ text: paragraph })]
      })
    );
}

async function renderList(node: List, context: RenderContext, listDepth: number): Promise<Paragraph[]> {
  const reference = node.ordered ? "orest-number" : "orest-bullet";
  const paragraphs: Paragraph[] = [];

  for (const item of node.children) {
    const rendered = await renderListItem(item, reference, listDepth, context);
    paragraphs.push(...rendered);
  }

  return paragraphs;
}

async function renderListItem(item: ListItem, reference: string, level: number, context: RenderContext): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];
  let hasNumberedParagraph = false;

  for (const child of item.children) {
    if (child.type === "paragraph") {
      paragraphs.push(
        new Paragraph({
          children: renderInlineNodes(child.children),
          numbering: {
            reference,
            level: Math.min(level, 1)
          }
        })
      );
      hasNumberedParagraph = true;
      continue;
    }

    if (child.type === "list") {
      paragraphs.push(...(await renderList(child, context, level + 1)));
      continue;
    }

    if (child.type === "code") {
      const codeParagraph = renderCodeBlock(child);
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: "", break: 1 })],
          numbering: hasNumberedParagraph
            ? {
                reference,
                level: Math.min(level, 1)
              }
            : undefined
        })
      );
      paragraphs.push(codeParagraph);
      continue;
    }

    if (child.type === "table") {
      const tableMarker = `[Таблиця з ${child.children.length} рядків]`;
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: tableMarker, italics: true, color: "64748B" })],
          numbering: {
            reference,
            level: Math.min(level, 1)
          }
        })
      );
    }
  }

  if (paragraphs.length === 0) {
    paragraphs.push(
      new Paragraph({
        text: "",
        numbering: {
          reference,
          level: Math.min(level, 1)
        }
      })
    );
  }

  return paragraphs;
}

function renderTable(node: MdTable): Table {
  const rows = node.children.map((row, rowIndex) => renderTableRow(row, rowIndex === 0));

  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE
    },
    layout: TableLayoutType.AUTOFIT,
    rows,
    borders: {
      top: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 4 },
      bottom: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 4 },
      left: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 4 },
      right: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 4 },
      insideHorizontal: { style: BorderStyle.SINGLE, color: "E2E8F0", size: 4 },
      insideVertical: { style: BorderStyle.SINGLE, color: "E2E8F0", size: 4 }
    }
  });
}

function renderTableRow(row: MdTableRow, isHeader: boolean): TableRow {
  return new TableRow({
    children: row.children.map((cell) => renderTableCell(cell, isHeader))
  });
}

function renderTableCell(cell: MdTableCell, isHeader: boolean): TableCell {
  const runs = renderInlineNodes(cell.children as unknown as MdParagraph["children"]);
  const children: Paragraph[] = [
    new Paragraph({
      children: runs.length > 0 ? runs : [new TextRun("")],
      spacing: {
        before: 40,
        after: 40
      }
    })
  ];

  return new TableCell({
    shading: isHeader
      ? {
          fill: "F1F5F9",
          type: ShadingType.CLEAR
        }
      : undefined,
    children,
    margins: {
      top: 80,
      bottom: 80,
      left: 120,
      right: 120
    }
  });
}

function renderThematicBreak(): Paragraph {
  return new Paragraph({
    border: {
      bottom: {
        color: "CBD5E1",
        style: BorderStyle.SINGLE,
        size: 6,
        space: 1
      }
    },
    spacing: {
      before: 120,
      after: 120
    },
    children: [new TextRun({ text: "" })]
  });
}

async function renderStandaloneImageParagraph(node: MdParagraph, context: RenderContext): Promise<Paragraph[]> {
  const imageNode = node.children.find((child): child is Image => child.type === "image");

  if (!imageNode) {
    return [];
  }

  const nonImageNodes = node.children.filter((child) => child !== imageNode);

  if (nonImageNodes.some((child) => child.type !== "text" && child.type !== "break")) {
    return [];
  }

  const source = (imageNode.url || "").trim();

  if (!source) {
    addWarning(context, {
      code: "image_unsupported",
      source,
      message: "Пропущено зображення без source у markdown." 
    });
    return [];
  }

  const captionFromNode = flattenInlineText(nonImageNodes as PhrasingContent[]);
  const reference = context.imageReferenceBySource.get(source);
  const caption = captionFromNode || reference?.caption;
  const alt = (imageNode.alt || reference?.alt || "Зображення").trim() || "Зображення";
  const resolved = context.resolvedImages.get(source);

  if (!resolved) {
    const placeholder = new Paragraph({
      children: [
        new TextRun({
          text: `⚠ Зображення недоступне: ${alt}${source ? ` (${source})` : ""}`,
          color: "B91C1C",
          italics: true
        })
      ],
      spacing: {
        before: 80,
        after: 120
      }
    });

    if (caption) {
      return [
        placeholder,
        new Paragraph({
          style: "ImageCaption",
          children: [new TextRun({ text: caption })]
        })
      ];
    }

    return [placeholder];
  }

  const imageWidth = resolved.widthPx || MAX_IMAGE_WIDTH_PX;
  const imageHeight = resolved.heightPx || Math.round(MAX_IMAGE_WIDTH_PX * 0.62);
  const ratio = imageHeight > 0 ? imageWidth / imageHeight : 1;
  let targetWidth = Math.min(imageWidth, MAX_IMAGE_WIDTH_PX);
  let targetHeight = Math.round(targetWidth / (ratio > 0 ? ratio : 1));

  if (targetHeight > MAX_IMAGE_HEIGHT_PX) {
    targetHeight = MAX_IMAGE_HEIGHT_PX;
    targetWidth = Math.round(targetHeight * (ratio > 0 ? ratio : 1));
  }

  const imageParagraph = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: {
      before: 100,
      after: caption ? 60 : 180
    },
    children: [
      new ImageRun({
        data: resolved.data,
        type: mimeTypeToDocxImageType(resolved.mimeType),
        transformation: {
          width: Math.max(120, targetWidth),
          height: Math.max(80, targetHeight)
        },
        altText: {
          title: alt,
          description: alt,
          name: alt
        }
      })
    ]
  });

  if (!caption) {
    return [imageParagraph];
  }

  return [
    imageParagraph,
    new Paragraph({
      style: "ImageCaption",
      children: [new TextRun({ text: caption })]
    })
  ];
}

function renderInlineNodes(
  nodes: MdParagraph["children"],
  style: { bold?: boolean; italics?: boolean; isLink?: boolean } = {}
): ParagraphChild[] {
  const runs: ParagraphChild[] = [];

  for (const node of nodes) {
    if (node.type === "text") {
      runs.push(
        new TextRun({
          text: node.value,
          bold: style.bold,
          italics: style.italics,
          color: style.isLink ? "2563EB" : undefined,
          underline: style.isLink
            ? {
                color: "2563EB",
                type: "single"
              }
            : undefined
        })
      );
      continue;
    }

    if (node.type === "strong") {
      runs.push(...renderInlineNodes(node.children as MdParagraph["children"], { ...style, bold: true }));
      continue;
    }

    if (node.type === "emphasis") {
      runs.push(...renderInlineNodes(node.children as MdParagraph["children"], { ...style, italics: true }));
      continue;
    }

    if (node.type === "inlineCode") {
      runs.push(
        new TextRun({
          text: node.value,
          font: CODE_FONT,
          size: 21,
          color: "0F172A",
          bold: style.bold,
          italics: style.italics,
          shading: {
            fill: "EEF2F7",
            type: ShadingType.CLEAR
          }
        })
      );
      continue;
    }

    if (node.type === "break") {
      runs.push(new TextRun({ text: "", break: 1 }));
      continue;
    }

    if (node.type === "link") {
      const linkChildren = renderInlineNodes(node.children as MdParagraph["children"], { ...style, isLink: true });
      runs.push(
        new ExternalHyperlink({
          link: node.url,
          children: linkChildren
        })
      );
      continue;
    }

    if (node.type === "image") {
      const alt = node.alt?.trim() || "Зображення";
      runs.push(new TextRun({ text: `[${alt}]`, color: "64748B" }));
    }
  }

  return runs;
}

function collectBlockquoteText(blockquote: Blockquote): string {
  return blockquote.children
    .map((child) => {
      if (child.type !== "paragraph") {
        return "";
      }

      return flattenInlineText(child.children as PhrasingContent[]);
    })
    .filter(Boolean)
    .join("\n\n");
}

function flattenInlineText(nodes: PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.value;
      }

      if (node.type === "inlineCode") {
        return node.value;
      }

      if (node.type === "break") {
        return "\n";
      }

      if (node.type === "link") {
        return flattenInlineText(node.children as PhrasingContent[]);
      }

      if (node.type === "strong" || node.type === "emphasis") {
        return flattenInlineText(node.children as PhrasingContent[]);
      }

      return "";
    })
    .join("")
    .trim();
}

function renderDirectiveCallout(segment: DirectiveCalloutSegment): Table {
  const kind = normalizeCalloutKind(segment.kind);
  const title = segment.title.trim() || "Врізка";
  const bodyParagraphs = segment.bodyLines.join("\n").split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);

  const rows = [
    new TableRow({
      children: [
        new TableCell({
          shading: {
            fill: "F8FAFC",
            type: ShadingType.CLEAR
          },
          borders: {
            top: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 4 },
            bottom: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 4 },
            left: { style: BorderStyle.SINGLE, color: "2563EB", size: 12 },
            right: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 4 }
          },
          margins: {
            top: 120,
            bottom: 120,
            left: 180,
            right: 180
          },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `ВРІЗКА: ${kind}`,
                  bold: true,
                  size: 18,
                  color: "475569"
                })
              ],
              spacing: {
                after: 100
              }
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: title,
                  bold: true,
                  size: 28,
                  color: "0F172A",
                  font: HEADING_FONT
                })
              ],
              spacing: {
                after: 110
              }
            }),
            ...bodyParagraphs.map(
              (paragraph) =>
                new Paragraph({
                  children: [new TextRun({ text: paragraph })],
                  spacing: {
                    after: 90
                  }
                })
            )
          ]
        })
      ]
    })
  ];

  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE
    },
    layout: TableLayoutType.FIXED,
    rows,
    margins: {
      top: convertInchesToTwip(0.06),
      bottom: convertInchesToTwip(0.06)
    }
  });
}

function normalizeCalloutKind(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "короткий факт";
  }

  if (/quick\s*fact/i.test(normalized)) {
    return "короткий факт";
  }

  if (/mini\s*story/i.test(normalized)) {
    return "мініісторія";
  }

  if (/mechanism/i.test(normalized)) {
    return "пояснення механізму";
  }

  if (/step/i.test(normalized)) {
    return "покроково";
  }

  if (/myth/i.test(normalized)) {
    return "міф і факт";
  }

  return normalized;
}

async function resolveImages(
  references: ImageReference[],
  warnings: DocxExportWarning[],
  warningKeys: Set<string>
): Promise<Map<string, ResolvedImageAsset>> {
  const resolved = new Map<string, ResolvedImageAsset>();
  const uniqueSources = [...new Set(references.map((reference) => reference.source).filter(Boolean))];

  await Promise.all(
    uniqueSources.map(async (source) => {
      const result = await resolveImageSource(source, warnings, warningKeys);

      if (result) {
        resolved.set(source, result);
      }
    })
  );

  return resolved;
}

async function resolveImageSource(
  source: string,
  warnings: DocxExportWarning[],
  warningKeys: Set<string>
): Promise<ResolvedImageAsset | null> {
  const normalized = source.trim();

  if (!normalized) {
    addWarningWithState(warnings, warningKeys, {
      code: "image_unsupported",
      source,
      message: "Пропущено порожнє джерело зображення у markdown." 
    });
    return null;
  }

  let targetUrl = normalized;
  const isAssetToken = parseEditorAssetToken(normalized) !== null;

  if (isAssetToken) {
    try {
      const resolved = await resolveEditorAssetUrl(normalized);

      if (!resolved) {
        addWarningWithState(warnings, warningKeys, {
          code: "image_unresolved",
          source: normalized,
          message: `Не вдалося знайти локальне зображення ${normalized} для експорту.`
        });
        return null;
      }

      targetUrl = resolved;
    } catch {
      addWarningWithState(warnings, warningKeys, {
        code: "image_unresolved",
        source: normalized,
        message: `Не вдалося прочитати локальне зображення ${normalized} для експорту.`
      });
      return null;
    }
  }

  if (!canFetchImageSource(targetUrl)) {
    addWarningWithState(warnings, warningKeys, {
      code: "image_unsupported",
      source: normalized,
      message: `Непідтримуване джерело зображення: ${normalized}.`
    });
    return null;
  }

  try {
    const response = await fetch(targetUrl);

    if (!response.ok) {
      addWarningWithState(warnings, warningKeys, {
        code: "image_unresolved",
        source: normalized,
        message: `Не вдалося завантажити зображення (${response.status}) для ${normalized}.`
      });
      return null;
    }

    const blob = await response.blob();

    if (!blob.size) {
      addWarningWithState(warnings, warningKeys, {
        code: "image_unresolved",
        source: normalized,
        message: `Зображення ${normalized} не містить даних.`
      });
      return null;
    }

    const data = new Uint8Array(await blob.arrayBuffer());
    const dimensions = await readImageDimensions(blob);

    return {
      data,
      mimeType: blob.type || "image/png",
      widthPx: dimensions?.width ?? MAX_IMAGE_WIDTH_PX,
      heightPx: dimensions?.height ?? Math.round(MAX_IMAGE_WIDTH_PX * 0.62)
    };
  } catch {
    addWarningWithState(warnings, warningKeys, {
      code: "image_unresolved",
      source: normalized,
      message: `Не вдалося завантажити зображення ${normalized} (можливо, CORS або мережа).`
    });
    return null;
  }
}

function canFetchImageSource(source: string): boolean {
  return /^data:/i.test(source) || /^https?:\/\//i.test(source) || /^blob:/i.test(source);
}

async function readImageDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      const width = image.naturalWidth || 0;
      const height = image.naturalHeight || 0;
      URL.revokeObjectURL(objectUrl);
      resolve(width > 0 && height > 0 ? { width, height } : null);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    image.src = objectUrl;
  });
}

function collectImageReferences(markdown: string): ImageReference[] {
  const references: ImageReference[] = [];
  const imageBlockPattern = /!\[([^\]]*)\]\(([^)\n]+)\)(?:\n([^\n]+))?/g;

  for (const match of markdown.matchAll(imageBlockPattern)) {
    const alt = (match[1] || "").trim() || "Зображення";
    const source = (match[2] || "").trim();
    const caption = match[3]?.trim() || undefined;

    if (!source) {
      continue;
    }

    references.push({
      alt,
      source,
      caption
    });
  }

  return references;
}

function splitIntoSegments(markdown: string): ExportSegment[] {
  const segments: ExportSegment[] = [];
  const lines = normalizeNewlines(markdown).split("\n");
  const buffer: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const calloutStart = /^\s*:::\s*врізка:\s*(.+)\s*$/i.exec(line.trim());

    if (!calloutStart) {
      buffer.push(line);
      index += 1;
      continue;
    }

    if (buffer.length > 0) {
      segments.push({
        type: "markdown",
        markdown: buffer.join("\n")
      });
      buffer.length = 0;
    }

    const kind = calloutStart[1]?.trim() || "короткий факт";
    const calloutLines: string[] = [line];
    let cursor = index + 1;
    let hasClosingToken = false;

    while (cursor < lines.length) {
      const nextLine = lines[cursor] ?? "";
      calloutLines.push(nextLine);

      if (nextLine.trim() === ":::") {
        hasClosingToken = true;
        break;
      }

      cursor += 1;
    }

    if (!hasClosingToken) {
      buffer.push(...calloutLines);
      index = cursor + 1;
      continue;
    }

    const interior = calloutLines.slice(1, -1);
    const titleLine = interior.find((entry) => entry.trim().startsWith("#")) || "";
    const title = titleLine.replace(/^\s*#+\s*/, "").trim() || "Врізка";

    const bodyLines = interior
      .filter((entry) => entry !== titleLine)
      .map((entry) => entry.trimEnd())
      .filter((entry) => Boolean(entry.trim()));

    segments.push({
      type: "directive_callout",
      kind,
      title,
      bodyLines
    });

    index = cursor + 1;
  }

  if (buffer.length > 0) {
    segments.push({
      type: "markdown",
      markdown: buffer.join("\n")
    });
  }

  return segments;
}

function mimeTypeToDocxImageType(mimeType: string): "png" | "jpg" | "gif" | "bmp" {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes("png")) {
    return "png";
  }

  if (normalized.includes("gif")) {
    return "gif";
  }

  if (normalized.includes("bmp")) {
    return "bmp";
  }

  return "jpg";
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function addWarning(context: RenderContext, warning: DocxExportWarning) {
  addWarningWithState(context.warnings, context.warningKeys, warning);
}

function addWarningWithState(warnings: DocxExportWarning[], warningKeys: Set<string>, warning: DocxExportWarning) {
  const key = `${warning.code}:${warning.source || ""}:${warning.message}`;

  if (warningKeys.has(key)) {
    return;
  }

  warningKeys.add(key);
  warnings.push(warning);
}
