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

test("importDocxArrayBuffer normalizes hidden Word characters in imported text", async () => {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:r><w:t>Антропогенні\u00a0чинники\u200b діють\u2028системно</w:t></w:r>
          <w:proofErr w:type="spellStart"/>
          <w:r><w:t>\u00adрідко</w:t></w:r>
          <w:proofErr w:type="spellEnd"/>
        </w:p>
      </w:body>
    </w:document>`
  );

  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const result = await importDocxArrayBuffer(buffer);
  const block = result.document.blocks[0];

  assert.equal(block?.type, "paragraph");
  assert.equal(
    block?.type === "paragraph" ? block.content.map((node) => node.text).join("") : "",
    "Антропогенні чинники діють\nсистемнорідко"
  );
});

test("importDocxArrayBuffer promotes full-bold heading-like paragraphs to h2", async () => {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:r>
            <w:rPr><w:b/></w:rPr>
            <w:t>Архітектура кісткового ремоделювання: баланс як основа довголіття</w:t>
          </w:r>
        </w:p>
        <w:p>
          <w:r><w:t>Звичайний абзац із </w:t></w:r>
          <w:r>
            <w:rPr><w:b/></w:rPr>
            <w:t>частковим виділенням</w:t>
          </w:r>
          <w:r><w:t>.</w:t></w:r>
        </w:p>
      </w:body>
    </w:document>`
  );

  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const result = await importDocxArrayBuffer(buffer);
  const heading = result.document.blocks[0];
  const paragraph = result.document.blocks[1];

  assert.deepEqual(result.document.blocks.map((block) => block.type), ["heading", "paragraph"]);
  assert.equal(heading?.type === "heading" ? heading.level : 0, 2);
  assert.equal(
    heading?.type === "heading" ? heading.content[0]?.text : "",
    "Архітектура кісткового ремоделювання: баланс як основа довголіття"
  );
  assert.equal(heading?.type === "heading" ? heading.content[0]?.bold : undefined, undefined);
  assert.equal(paragraph?.type === "paragraph" ? paragraph.content[1]?.bold : undefined, true);
});

test("importDocxArrayBuffer keeps long full-bold paragraphs as paragraphs", async () => {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:r>
            <w:rPr><w:b/></w:rPr>
            <w:t>Цей довгий абзац спеціально залишається жирним, бо він схожий на змістове виділення всередині рукопису, а не на короткий підзаголовок для структури розділу.</w:t>
          </w:r>
        </w:p>
      </w:body>
    </w:document>`
  );

  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const result = await importDocxArrayBuffer(buffer);
  const block = result.document.blocks[0];

  assert.equal(block?.type, "paragraph");
  assert.equal(block?.type === "paragraph" ? block.content[0]?.bold : undefined, true);
});

test("importDocxArrayBuffer preserves embedded images as image blocks with assets", async () => {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document
      xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <w:body>
        <w:p>
          <w:r><w:t>Before image.</w:t></w:r>
        </w:p>
        <w:p>
          <w:r>
            <w:drawing>
              <a:graphic>
                <a:graphicData>
                  <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:blipFill>
                      <a:blip r:embed="rId5"/>
                    </pic:blipFill>
                  </pic:pic>
                </a:graphicData>
              </a:graphic>
            </w:drawing>
          </w:r>
        </w:p>
        <w:p>
          <w:r><w:t>After image.</w:t></w:r>
        </w:p>
      </w:body>
    </w:document>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship
        Id="rId5"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
        Target="media/image1.png"/>
    </Relationships>`
  );
  zip.file("word/media/image1.png", Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const result = await importDocxArrayBuffer(buffer);
  const imageBlock = result.document.blocks[1];

  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.document.blocks.map((block) => block.type), ["paragraph", "image", "paragraph"]);
  assert.equal(imageBlock?.type, "image");
  assert.equal(imageBlock?.type === "image" ? imageBlock.alt : "", "image1");
  assert.equal(result.assets?.length, 1);
  assert.equal(result.assets?.[0]?.assetId, imageBlock?.type === "image" ? imageBlock.assetId : "");
  assert.equal(result.assets?.[0]?.mimeType, "image/png");
  assert.equal(result.assets?.[0]?.blob.size, 8);
});
