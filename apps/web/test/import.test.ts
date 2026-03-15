import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

import { importDocxArrayBuffer, importPlainTextToDocument } from "../lib/editor/import.ts";

test("importPlainTextToDocument maps headings, paragraphs, and lists into blocks", () => {
  const result = importPlainTextToDocument(`
# Розділ

Перший абзац.
Другий рядок того ж абзацу.

- Пункт один
- Пункт два

1. Крок один
2. Крок два
  `);

  assert.equal(result.document.blocks.length, 4);
  assert.deepEqual(result.document.blocks.map((block) => block.type), ["heading", "paragraph", "bullet_list", "ordered_list"]);
  assert.equal(result.document.blocks[0]?.type === "heading" ? result.document.blocks[0].content[0]?.text : "", "Розділ");
  assert.equal(result.document.blocks[1]?.type === "paragraph" ? result.document.blocks[1].content[0]?.text : "", "Перший абзац. Другий рядок того ж абзацу.");
});

test("importDocxArrayBuffer groups list items and preserves tables", async () => {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:pPr>
            <w:pStyle w:val="Heading2"/>
          </w:pPr>
          <w:r><w:t>Назва секції</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:t>Звичайний абзац.</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr>
            <w:numPr>
              <w:ilvl w:val="0"/>
              <w:numId w:val="7"/>
            </w:numPr>
          </w:pPr>
          <w:r><w:t>Перший пункт</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr>
            <w:numPr>
              <w:ilvl w:val="0"/>
              <w:numId w:val="7"/>
            </w:numPr>
          </w:pPr>
          <w:r><w:t>Другий пункт</w:t></w:r>
        </w:p>
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
      </w:body>
    </w:document>`
  );
  zip.file(
    "word/numbering.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:abstractNum w:abstractNumId="5">
        <w:lvl w:ilvl="0">
          <w:numFmt w:val="bullet"/>
        </w:lvl>
      </w:abstractNum>
      <w:num w:numId="7">
        <w:abstractNumId w:val="5"/>
      </w:num>
    </w:numbering>`
  );

  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const result = await importDocxArrayBuffer(buffer);

  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.document.blocks.map((block) => block.type), ["heading", "paragraph", "bullet_list", "table"]);
  assert.equal(result.document.blocks[0]?.type === "heading" ? result.document.blocks[0].level : 0, 2);
  assert.deepEqual(
    result.document.blocks[2]?.type === "bullet_list" ? result.document.blocks[2].items.map((item) => item[0]?.text) : [],
    ["Перший пункт", "Другий пункт"]
  );
  assert.deepEqual(
    result.document.blocks[3]?.type === "table"
      ? result.document.blocks[3].rows.map((row) => row.map((cell) => cell[0]?.text))
      : [],
    [
      ["A1", "B1"],
      ["A2", "B2"]
    ]
  );
});
