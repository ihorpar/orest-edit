"use client";

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip
} from "docx";
import type { Block, EditorDocument, InlineNode } from "./document-model";
import { getInlineText } from "./document-model";
import { createEditorAssetToken, resolveEditorAssetUrl } from "./asset-store";

const BODY_FONT = "Times New Roman";
const HEADING_FONT = "Cambria";
const DEFAULT_FILE_NAME_BASE = "Рукопис";
const MAX_IMAGE_WIDTH_PX = 560;
const MAX_IMAGE_HEIGHT_PX = 900;

export interface DocxExportWarning {
  code: "image_unresolved" | "image_unsupported";
  message: string;
  source?: string;
}

export interface ExportDocxInput {
  document: EditorDocument;
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

interface RenderContext {
  warnings: DocxExportWarning[];
  warningKeys: Set<string>;
  resolvedImages: Map<string, ResolvedImageAsset>;
}

type ParagraphChild = TextRun | ExternalHyperlink | ImageRun;

export async function exportDocumentToDocx(input: ExportDocxInput): Promise<ExportDocxResult> {
  const warnings: DocxExportWarning[] = [];
  const warningKeys = new Set<string>();
  const resolvedImages = await resolveImages(input.document.blocks, warnings, warningKeys);
  const renderContext: RenderContext = { warnings, warningKeys, resolvedImages };
  const children = await renderBlocksToDocx(input.document.blocks, renderContext);
  const document = buildDocument(children);
  const blob = await Packer.toBlob(document);

  return {
    blob,
    fileName: buildDocxFileName(input.fileNameBase || deriveDocxFileNameBase(input.document)),
    warnings
  };
}

export function deriveDocxFileNameBase(document: EditorDocument): string {
  const firstMeaningfulBlock = document.blocks.find((block) => {
    if (block.type === "divider") {
      return false;
    }

    return getBlockTextPreview(block).trim().length > 0;
  });

  if (!firstMeaningfulBlock) {
    return DEFAULT_FILE_NAME_BASE;
  }

  return getBlockTextPreview(firstMeaningfulBlock) || DEFAULT_FILE_NAME_BASE;
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
            spacing: { before: 280, after: 180 }
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
            spacing: { before: 220, after: 150 }
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
            spacing: { before: 200, after: 120 }
          }
        },
        {
          id: "CalloutTitle",
          name: "Callout Title",
          basedOn: "Normal",
          next: "Normal",
          run: {
            bold: true,
            color: "0F172A"
          },
          paragraph: {
            spacing: { after: 120 }
          }
        }
      ]
    },
    numbering: {
      config: [
        {
          reference: "ordered-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.75),
              right: convertInchesToTwip(0.85),
              bottom: convertInchesToTwip(0.85),
              left: convertInchesToTwip(0.9)
            }
          }
        },
        children
      }
    ]
  });
}

async function renderBlocksToDocx(blocks: Block[], context: RenderContext): Promise<Array<Paragraph | Table>> {
  const children: Array<Paragraph | Table> = [];

  for (const block of blocks) {
    const rendered = await renderBlock(block, context);
    children.push(...rendered);
  }

  return children;
}

async function renderBlock(block: Block, context: RenderContext): Promise<Array<Paragraph | Table>> {
  switch (block.type) {
    case "paragraph":
      return [new Paragraph({ children: renderInlineNodes(block.content) })];
    case "heading":
      return [
        new Paragraph({
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          style: block.level === 1 ? "HeadingOne" : block.level === 2 ? "HeadingTwo" : "HeadingThree",
          children: renderInlineNodes(block.content)
        })
      ];
    case "bullet_list":
      return block.items.map(
        (item) =>
          new Paragraph({
            bullet: { level: 0 },
            children: renderInlineNodes(item)
          })
      );
    case "ordered_list":
      return block.items.map(
        (item) =>
          new Paragraph({
            numbering: { reference: "ordered-list", level: 0 },
            children: renderInlineNodes(item)
          })
      );
    case "image":
      return renderImageBlock(block, context);
    case "callout":
      return renderCalloutBlock(block);
    case "divider":
      return [
        new Paragraph({
          border: {
            bottom: {
              color: "CBD5E1",
              style: BorderStyle.SINGLE,
              size: 6
            }
          },
          spacing: { before: 180, after: 180 }
        })
      ];
    case "table":
      return [renderTableBlock(block)];
  }
}

function renderInlineNodes(nodes: InlineNode[]): ParagraphChild[] {
  const children: ParagraphChild[] = [];

  for (const node of nodes) {
    const segments = node.text.split("\n");

    for (const [segmentIndex, segment] of segments.entries()) {
      if (segmentIndex > 0) {
        children.push(new TextRun({ break: 1 }));
      }

      if (!segment) {
        continue;
      }

      const run = new TextRun({
        text: segment,
        bold: node.bold,
        italics: node.italic,
        color: node.link ? "1D4ED8" : undefined,
        underline: node.link ? {} : undefined
      });

      if (!node.link) {
        children.push(run);
        continue;
      }

      children.push(
        new ExternalHyperlink({
          link: node.link,
          children: [run]
        })
      );
    }
  }

  return children;
}

async function renderImageBlock(block: Extract<Block, { type: "image" }>, context: RenderContext): Promise<Array<Paragraph>> {
  const resolved = context.resolvedImages.get(block.assetId);

  if (!resolved) {
    pushWarning(context, {
      code: "image_unresolved",
      message: `Не вдалося завантажити зображення для asset ${block.assetId}.`,
      source: block.assetId
    });

    return [new Paragraph({ children: [new TextRun({ text: `[Зображення: ${block.alt}]`, italics: true })] })];
  }

  const imageRun = new ImageRun({
    data: resolved.data,
    type: resolved.mimeType.includes("png") ? "png" : resolved.mimeType.includes("gif") ? "gif" : "jpg",
    transformation: fitImageIntoBounds(resolved.widthPx, resolved.heightPx)
  });

  const paragraphs = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [imageRun]
    })
  ];

  if (block.caption && getInlineText(block.caption).trim()) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: renderInlineNodes(block.caption)
      })
    );
  }

  return paragraphs;
}

function renderCalloutBlock(block: Extract<Block, { type: "callout" }>): Paragraph[] {
  const paragraphs = [
    new Paragraph({
      style: "CalloutTitle",
      shading: {
        type: ShadingType.CLEAR,
        fill: "E2E8F0"
      },
      border: {
        left: {
          color: "0F172A",
          style: BorderStyle.SINGLE,
          size: 12
        }
      },
      children: renderInlineNodes(block.title)
    })
  ];

  for (const paragraph of block.body) {
    paragraphs.push(
      new Paragraph({
        border: {
          left: {
            color: "0F172A",
            style: BorderStyle.SINGLE,
            size: 12
          }
        },
        shading: {
          type: ShadingType.CLEAR,
          fill: "F8FAFC"
        },
        children: renderInlineNodes(paragraph)
      })
    );
  }

  return paragraphs;
}

function renderTableBlock(block: Extract<Block, { type: "table" }>): Table {
  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE
    },
    layout: TableLayoutType.FIXED,
    rows: block.rows.map(
      (row, rowIndex) =>
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                shading:
                  rowIndex === 0
                    ? {
                        type: ShadingType.CLEAR,
                        fill: "E2E8F0"
                      }
                    : undefined,
                children: [new Paragraph({ children: renderInlineNodes(cell) })]
              })
          )
        })
    )
  });
}

async function resolveImages(blocks: Block[], warnings: DocxExportWarning[], warningKeys: Set<string>): Promise<Map<string, ResolvedImageAsset>> {
  const assets = new Map<string, ResolvedImageAsset>();

  for (const block of blocks) {
    if (block.type !== "image") {
      continue;
    }

    try {
      const resolvedUrl = await resolveEditorAssetUrl(createEditorAssetToken(block.assetId));

      if (!resolvedUrl) {
        pushWarning({ warnings, warningKeys, resolvedImages: assets }, {
          code: "image_unresolved",
          message: `Не вдалося знайти зображення ${block.assetId}.`,
          source: block.assetId
        });
        continue;
      }

      const asset = await fetchImageAsset(resolvedUrl);

      if (asset) {
        assets.set(block.assetId, asset);
      }
    } catch {
      pushWarning({ warnings, warningKeys, resolvedImages: assets }, {
        code: "image_unresolved",
        message: `Не вдалося підготувати зображення ${block.assetId}.`,
        source: block.assetId
      });
    }
  }

  return assets;
}

async function fetchImageAsset(source: string): Promise<ResolvedImageAsset | null> {
  const response = await fetch(source);

  if (!response.ok) {
    return null;
  }

  const mimeType = response.headers.get("content-type") ?? "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const dimensions = getImageDimensions(bytes, mimeType);

  if (!dimensions) {
    return null;
  }

  return {
    data: bytes,
    mimeType,
    widthPx: dimensions.width,
    heightPx: dimensions.height
  };
}

function fitImageIntoBounds(widthPx: number, heightPx: number): { width: number; height: number } {
  const widthRatio = MAX_IMAGE_WIDTH_PX / widthPx;
  const heightRatio = MAX_IMAGE_HEIGHT_PX / heightPx;
  const ratio = Math.min(1, widthRatio, heightRatio);

  return {
    width: Math.round(widthPx * ratio),
    height: Math.round(heightPx * ratio)
  };
}

function getImageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | null {
  if (mimeType.includes("png")) {
    return {
      width: readUint32(bytes, 16),
      height: readUint32(bytes, 20)
    };
  }

  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    for (let index = 2; index < bytes.length - 8; index += 1) {
      if (bytes[index] !== 0xff) {
        continue;
      }

      const marker = bytes[index + 1];

      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: readUint16(bytes, index + 5),
          width: readUint16(bytes, index + 7)
        };
      }

      const segmentLength = readUint16(bytes, index + 2);

      if (!segmentLength) {
        break;
      }

      index += segmentLength + 1;
    }
  }

  return null;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function pushWarning(context: RenderContext, warning: DocxExportWarning) {
  const key = `${warning.code}:${warning.source ?? warning.message}`;

  if (context.warningKeys.has(key)) {
    return;
  }

  context.warningKeys.add(key);
  context.warnings.push(warning);
}

function getBlockTextPreview(block: Block): string {
  if (block.type === "heading") {
    return getInlineText(block.content);
  }

  if (block.type === "paragraph") {
    return getInlineText(block.content);
  }

  if (block.type === "callout") {
    return getInlineText(block.title);
  }

  if (block.type === "bullet_list" || block.type === "ordered_list") {
    return getInlineText(block.items[0] ?? []);
  }

  if (block.type === "image") {
    return block.alt;
  }

  if (block.type === "table") {
    return getInlineText(block.rows[0]?.[0] ?? []);
  }

  return DEFAULT_FILE_NAME_BASE;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim();
}
