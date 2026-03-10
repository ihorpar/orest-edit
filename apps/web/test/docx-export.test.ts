import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { indexedDB } from "fake-indexeddb";

import { exportMarkdownToDocx } from "../lib/editor/docx-export.ts";
import { storeEditorAssetFromBlob } from "../lib/editor/asset-store.ts";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5x8YsAAAAASUVORK5CYII=";
const ONE_PIXEL_PNG_DATA_URL = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;

function decodeBase64(base64: string): ArrayBuffer {
  const buffer = Buffer.from(base64, "base64");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function readDocumentXml(blob: Blob): Promise<{ xml: string; mediaFiles: string[] }> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xmlFile = zip.file("word/document.xml");
  assert.ok(xmlFile, "DOCX must contain word/document.xml");

  const xml = await xmlFile.async("string");
  const mediaFiles = Object.keys(zip.files).filter((entry) => entry.startsWith("word/media/"));

  return { xml, mediaFiles };
}

test("exportMarkdownToDocx keeps Ukrainian text and code styling", async () => {
  const markdown = [
    "## Розділ українською",
    "",
    "Текст із **жирним** акцентом і `inline кодом`.",
    "",
    "```ts",
    "const значення = 1;",
    "```"
  ].join("\n");

  const result = await exportMarkdownToDocx({ markdown, fileNameBase: "Тестовий файл" });
  const { xml } = await readDocumentXml(result.blob);

  assert.equal(result.warnings.length, 0);
  assert.match(result.fileName, /^Тестовий файл-\d{4}-\d{2}-\d{2}\.docx$/);
  assert.match(xml, /Розділ українською/);
  assert.match(xml, /inline кодом/);
  assert.match(xml, /const значення = 1;/);
  assert.match(xml, /w:val="CodeBlock"/);
});

test("exportMarkdownToDocx embeds data and asset images", async () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  Object.defineProperty(globalThis, "window", {
    value: { indexedDB },
    configurable: true,
    writable: true
  });

  const stored = await storeEditorAssetFromBlob({
    blob: new Blob([decodeBase64(ONE_PIXEL_PNG_BASE64)], { type: "image/png" })
  });

  const markdown = [
    `![Дані](${ONE_PIXEL_PNG_DATA_URL})`,
    "Підпис даних",
    "",
    `![Локальне](${stored.token})`,
    "Підпис локального"
  ].join("\n");

  const result = await exportMarkdownToDocx({ markdown, fileNameBase: "Тест/зображення" });
  const { mediaFiles, xml } = await readDocumentXml(result.blob);

  assert.equal(result.warnings.length, 0);
  assert.ok(mediaFiles.length >= 2, `Expected at least 2 embedded images, got ${mediaFiles.length}`);
  assert.match(xml, /Підпис даних/);
  assert.match(xml, /Підпис локального/);
  assert.match(result.fileName, /^Тест зображення-\d{4}-\d{2}-\d{2}\.docx$/);

  if (previousWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, "window", {
      value: previousWindow,
      configurable: true,
      writable: true
    });
  }
});

test("exportMarkdownToDocx adds placeholder and warning for missing image", async () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  Object.defineProperty(globalThis, "window", {
    value: { indexedDB },
    configurable: true,
    writable: true
  });

  const markdown = "![Зникле](asset:missing-image)";
  const result = await exportMarkdownToDocx({ markdown });
  const { xml } = await readDocumentXml(result.blob);

  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]?.code, "image_unresolved");
  assert.match(xml, /Зображення недоступне/);

  if (previousWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, "window", {
      value: previousWindow,
      configurable: true,
      writable: true
    });
  }
});

test("exportMarkdownToDocx renders directive callout block", async () => {
  const markdown = [
    "::: врізка: quick_fact",
    "# Ключовий факт",
    "Це пояснювальний блок для читача.",
    ":::"
  ].join("\n");

  const result = await exportMarkdownToDocx({ markdown, fileNameBase: "Врізка" });
  const { xml } = await readDocumentXml(result.blob);

  assert.equal(result.warnings.length, 0);
  assert.match(xml, /ВРІЗКА: короткий факт/);
  assert.match(xml, /Ключовий факт/);
  assert.match(xml, /Це пояснювальний блок для читача/);
});

test("exportMarkdownToDocx aggregates duplicate unresolved image warnings", async () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  Object.defineProperty(globalThis, "window", {
    value: { indexedDB },
    configurable: true,
    writable: true
  });

  const markdown = ["![Зникле](asset:missing-image)", "", "![Зникле 2](asset:missing-image)"].join("\n");
  const result = await exportMarkdownToDocx({ markdown, fileNameBase: "Попередження" });

  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]?.code, "image_unresolved");
  assert.match(result.fileName, /^Попередження-\d{4}-\d{2}-\d{2}\.docx$/);

  if (previousWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, "window", {
      value: previousWindow,
      configurable: true,
      writable: true
    });
  }
});
