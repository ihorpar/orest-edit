import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { exportDocumentToDocx } from "../lib/editor/docx-export.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";

async function readDocumentXml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const entry = zip.file("word/document.xml");

  if (!entry) {
    throw new Error("word/document.xml is missing from the exported DOCX.");
  }

  return entry.async("string");
}

test("exportDocumentToDocx builds a docx from block document", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "h1", type: "heading", level: 2, content: [{ text: "Назва розділу" }] },
      { id: "p1", type: "paragraph", content: [{ text: "Текст абзацу." }] },
      { id: "l1", type: "bullet_list", items: [[{ text: "Пункт 1" }], [{ text: "Пункт 2" }]] },
      { id: "c1", type: "callout", kind: "mechanism", title: [{ text: "Як це працює" }], body: [[{ text: "Коротке пояснення." }]] },
      { id: "t1", type: "table", rows: [[[{"text":"A1"}],[{"text":"B1"}]], [[{"text":"A2"}],[{"text":"B2"}]]] }
    ]
  };

  const result = await exportDocumentToDocx({ document });

  assert.match(result.fileName, /^Назва розділу-\d{4}-\d{2}-\d{2}\.docx$/);
  assert.equal(result.warnings.length, 0);
  assert.ok(result.blob.size > 0);
});

test("exportDocumentToDocx turns inline newlines into Word paragraphs instead of line breaks", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [
          { text: "Важливе застереження\n", bold: true },
          { text: "Для більшості описаних методів епігенетичний вік лишається оцінкою.\nРезультати досліджень на гризунах не можна прямо переносити на людей." }
        ]
      }
    ]
  };

  const result = await exportDocumentToDocx({ document });
  const xml = await readDocumentXml(result.blob);

  assert.equal((xml.match(/<w:br\b/g) ?? []).length, 0);
  assert.ok((xml.match(/<w:p[\s>]/g) ?? []).length >= 3);
  assert.ok(xml.includes("Важливе застереження"));
  assert.ok(xml.includes("Для більшості описаних"));
  assert.ok(xml.includes("<w:b/>") || xml.includes("<w:b w:val=\"true\"/>"));
});

test("exportDocumentToDocx splits inline metadata across Word paragraphs and keeps hyperlinks", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p1",
        type: "paragraph",
        content: [
          { text: "Жирний рядок\n\nТретій рядок", bold: true },
          { text: "Посилання\nще", link: "https://example.com" }
        ]
      }
    ]
  };

  const result = await exportDocumentToDocx({ document });
  const xml = await readDocumentXml(result.blob);

  assert.equal((xml.match(/<w:br\b/g) ?? []).length, 0);
  assert.ok((xml.match(/<w:p[\s>]/g) ?? []).length >= 3);
  assert.equal((xml.match(/<w:hyperlink\b/g) ?? []).length, 2);
  assert.ok(xml.includes("<w:b/>") || xml.includes("<w:b w:val=\"true\"/>"));
});

test("exportDocumentToDocx keeps heading style on the first newline segment only", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "h1",
        type: "heading",
        level: 2,
        content: [{ text: "Заголовок\nХвіст як звичайний абзац." }]
      }
    ]
  };

  const result = await exportDocumentToDocx({ document });
  const xml = await readDocumentXml(result.blob);

  assert.equal((xml.match(/<w:br\b/g) ?? []).length, 0);
  assert.match(xml, /w:val="Heading2"|w:val="Heading Two"/);
  assert.ok(xml.includes("Заголовок"));
  assert.ok(xml.includes("Хвіст як звичайний абзац."));
});

test("exportDocumentToDocx keeps list item newlines inside one bullet via soft breaks", async () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "l1",
        type: "bullet_list",
        items: [[{ text: "Перший рядок\nДругий рядок" }]]
      }
    ]
  };

  const result = await exportDocumentToDocx({ document });
  const xml = await readDocumentXml(result.blob);

  assert.equal((xml.match(/<w:br\b/g) ?? []).length, 1);
  assert.ok(xml.includes("Перший рядок"));
  assert.ok(xml.includes("Другий рядок"));
  assert.equal((xml.match(/<w:numPr>/g) ?? []).length, 1);
});
