import test from "node:test";
import assert from "node:assert/strict";
import {
  convertBlockToHeadingBlock,
  convertBlockToListBlock,
  convertBlockToParagraphBlock,
  getDocumentTextStats,
  mergeTextBlockIntoPrevious,
  normalizeInlineNodes,
  replaceTextInDocument,
  sanitizeEditorDocumentText,
  sanitizeEditorText,
  sliceDocumentForBlockRange,
  splitCalloutBodyAtOffset,
  mergeCalloutBodyParagraphIntoPrevious,
  splitInlineNodesByNewlines,
  type EditorDocument
} from "../lib/editor/document-model.ts";

test("sanitizeEditorText removes hidden editing hazards while keeping visible prose", () => {
  const dirty =
    "у\u00a0кумулятивному\u202fефекті\u2007текст\u200b\u200c\u200d\u2060\ufeff\u00ad\u200e\u200f\u202aabc\u202c\r\u0007line\u2028next\u2029end\tok";

  assert.equal(sanitizeEditorText(dirty), "у кумулятивному ефекті текстabcline\nnext\nend\tok");
});

test("normalizeInlineNodes sanitizes text and preserves marks", () => {
  const normalized = normalizeInlineNodes([
    { text: "Антропогенні\u00a0", bold: true },
    { text: "\u200bчинники", bold: true },
    { text: "\u2028діють", italic: true }
  ]);

  assert.deepEqual(normalized, [
    { text: "Антропогенні чинники", bold: true, italic: undefined, link: undefined },
    { text: "\nдіють", bold: undefined, italic: true, link: undefined }
  ]);
});

test("splitInlineNodesByNewlines splits across mixed marks and skips empty segments", () => {
  const segments = splitInlineNodesByNewlines([
    { text: "Важливе застереження\n", bold: true },
    { text: "Для більшості описаних методів.\n\nРезультати досліджень на гризунах." }
  ]);

  assert.deepEqual(
    segments.map((segment) => segment.map((node) => ({ text: node.text, ...(node.bold ? { bold: true as const } : {}) }))),
    [
      [{ text: "Важливе застереження", bold: true }],
      [{ text: "Для більшості описаних методів." }],
      [{ text: "Результати досліджень на гризунах." }]
    ]
  );
});

test("splitCalloutBodyAtOffset inserts a new body paragraph without changing the callout id", () => {
  const result = splitCalloutBodyAtOffset(
    {
      id: "c-1",
      type: "callout",
      kind: "mechanism",
      title: [{ text: "Важливе застереження" }],
      body: [[{ text: "Перше речення.Друге речення." }]]
    },
    0,
    "Перше речення.".length
  );

  assert.ok(result);
  assert.equal(result.block.id, "c-1");
  assert.equal(result.nextParagraphIndex, 1);
  assert.equal(result.block.body.length, 2);
  assert.equal(result.block.body[0]?.[0]?.text, "Перше речення.");
  assert.equal(result.block.body[1]?.[0]?.text, "Друге речення.");
});

test("mergeCalloutBodyParagraphIntoPrevious joins adjacent body paragraphs", () => {
  const result = mergeCalloutBodyParagraphIntoPrevious(
    {
      id: "c-1",
      type: "callout",
      kind: "mechanism",
      title: [{ text: "Важливе застереження" }],
      body: [[{ text: "Перше речення." }], [{ text: "Друге речення." }]]
    },
    1
  );

  assert.ok(result);
  assert.equal(result.block.body.length, 1);
  assert.equal(result.block.body[0]?.[0]?.text, "Перше речення.Друге речення.");
  assert.equal(result.focusParagraphIndex, 0);
  assert.equal(result.focusOffset, "Перше речення.".length);
});

test("sanitizeEditorDocumentText repairs all text-bearing block surfaces without changing ids", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p-1", type: "paragraph", content: [{ text: "A\u00a0B" }] },
      { id: "h-1", type: "heading", level: 2, content: [{ text: "H\u200b1" }] },
      { id: "l-1", type: "bullet_list", items: [[{ text: "L\u202f1" }]] },
      {
        id: "c-1",
        type: "callout",
        kind: "mechanism",
        title: [{ text: "T\ufeffitle" }],
        body: [[{ text: "Body\u2028line" }]]
      },
      { id: "i-1", type: "image", assetId: "asset-1", alt: "Alt\u00adtext", caption: [{ text: "Cap\u2007tion" }] },
      { id: "t-1", type: "table", rows: [[[{ text: "Cell\u2060text" }]]] }
    ]
  };

  const repaired = sanitizeEditorDocumentText(document);

  assert.deepEqual(
    repaired.blocks.map((block) => block.id),
    ["p-1", "h-1", "l-1", "c-1", "i-1", "t-1"]
  );
  assert.equal(repaired.blocks[0]?.type === "paragraph" ? repaired.blocks[0].content[0]?.text : "", "A B");
  assert.equal(repaired.blocks[1]?.type === "heading" ? repaired.blocks[1].content[0]?.text : "", "H1");
  assert.equal(repaired.blocks[2]?.type === "bullet_list" ? repaired.blocks[2].items[0]?.[0]?.text : "", "L 1");
  assert.equal(repaired.blocks[3]?.type === "callout" ? repaired.blocks[3].title[0]?.text : "", "Title");
  assert.equal(repaired.blocks[3]?.type === "callout" ? repaired.blocks[3].body[0]?.[0]?.text : "", "Body\nline");
  assert.equal(repaired.blocks[4]?.type === "image" ? repaired.blocks[4].alt : "", "Alttext");
  assert.equal(repaired.blocks[4]?.type === "image" ? repaired.blocks[4].caption?.[0]?.text : "", "Cap tion");
  assert.equal(repaired.blocks[5]?.type === "table" ? repaired.blocks[5].rows[0]?.[0]?.[0]?.text : "", "Celltext");
});

test("sanitizeEditorDocumentText persists structural repairs for malformed inline arrays", () => {
  const malformedDocument = {
    version: 2,
    blocks: [
      { id: "p-1", type: "paragraph" },
      { id: "h-1", type: "heading", level: 2 },
      { id: "c-1", type: "callout", kind: "mechanism", body: [[]] },
      { id: "t-1", type: "table", rows: [[[undefined]]] }
    ]
  } as unknown as EditorDocument;

  const repaired = sanitizeEditorDocumentText(malformedDocument);

  assert.notEqual(repaired, malformedDocument);
  assert.equal(repaired.blocks[0]?.type === "paragraph" ? repaired.blocks[0].content[0]?.text : "missing", "");
  assert.equal(repaired.blocks[1]?.type === "heading" ? repaired.blocks[1].content[0]?.text : "missing", "");
  assert.equal(repaired.blocks[2]?.type === "callout" ? repaired.blocks[2].title[0]?.text : "missing", "");
  assert.equal(repaired.blocks[3]?.type === "table" ? repaired.blocks[3].rows[0]?.[0]?.[0]?.text : "missing", "");
});

test("mergeTextBlockIntoPrevious merges paragraph text into the previous text block and returns the join offset", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p-1",
        type: "paragraph",
        content: [{ text: "Перше речення. " }]
      },
      {
        id: "p-2",
        type: "paragraph",
        content: [{ text: "Друге речення." }]
      }
    ]
  };

  const result = mergeTextBlockIntoPrevious(document, "p-2");

  assert.ok(result);
  assert.equal(result.focusBlockId, "p-1");
  assert.equal(result.focusOffset, "Перше речення. ".length);
  assert.equal(result.document.blocks.length, 1);

  const mergedBlock = result.document.blocks[0];
  if (mergedBlock?.type !== "paragraph") {
    assert.fail("Expected merged paragraph block.");
  }

  assert.equal(mergedBlock.content.map((node) => node.text).join(""), "Перше речення. Друге речення.");
});

test("mergeTextBlockIntoPrevious does not merge a paragraph into a heading", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "h-1",
        type: "heading",
        level: 2,
        content: [{ text: "Розділ" }]
      },
      {
        id: "p-2",
        type: "paragraph",
        content: [{ text: "" }]
      }
    ]
  };

  assert.equal(mergeTextBlockIntoPrevious(document, "p-2"), null);
});

test("mergeTextBlockIntoPrevious returns null for the first block or when the previous block is not text", () => {
  const firstBlockDocument: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "p-1",
        type: "paragraph",
        content: [{ text: "Початок" }]
      }
    ]
  };

  assert.equal(mergeTextBlockIntoPrevious(firstBlockDocument, "p-1"), null);

  const nonTextPreviousDocument: EditorDocument = {
    version: 2,
    blocks: [
      {
        id: "divider-1",
        type: "divider"
      },
      {
        id: "p-2",
        type: "paragraph",
        content: [{ text: "Абзац" }]
      }
    ]
  };

  assert.equal(mergeTextBlockIntoPrevious(nonTextPreviousDocument, "p-2"), null);
});

test("sliceDocumentForBlockRange keeps selected blocks with one-block neighbor context", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p-1", type: "paragraph", content: [{ text: "one" }] },
      { id: "p-2", type: "paragraph", content: [{ text: "two" }] },
      { id: "p-3", type: "paragraph", content: [{ text: "three" }] },
      { id: "p-4", type: "paragraph", content: [{ text: "four" }] },
      { id: "p-5", type: "paragraph", content: [{ text: "five" }] }
    ]
  };

  const sliced = sliceDocumentForBlockRange(document, ["p-2", "p-3", "p-4"], {
    before: 1,
    after: 1
  });

  assert.deepEqual(
    sliced.blocks.map((block) => block.id),
    ["p-1", "p-2", "p-3", "p-4", "p-5"]
  );
  assert.notEqual(sliced.blocks[1], document.blocks[1]);
});

test("replaceTextInDocument replaces repeated literal matches across text-bearing blocks", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "p-1", type: "paragraph", content: [{ text: "skin skin", bold: true }] },
      { id: "h-1", type: "heading", level: 2, content: [{ text: "skin heading" }] },
      { id: "l-1", type: "bullet_list", items: [[{ text: "skin list" }]] },
      { id: "i-1", type: "image", assetId: "asset-1", alt: "skin alt", caption: [{ text: "skin caption" }] }
    ]
  };

  const result = replaceTextInDocument(document, "skin", "barrier");

  assert.equal(result.replacementCount, 6);
  assert.deepEqual(result.changedBlockIds, ["p-1", "h-1", "l-1", "i-1"]);

  const paragraph = result.document.blocks[0];
  const heading = result.document.blocks[1];
  const list = result.document.blocks[2];
  const image = result.document.blocks[3];

  if (paragraph?.type !== "paragraph" || heading?.type !== "heading" || list?.type !== "bullet_list" || image?.type !== "image") {
    assert.fail("Expected all updated block types to stay stable.");
  }

  assert.equal(paragraph.content[0]?.text, "barrier barrier");
  assert.equal(paragraph.content[0]?.bold, true);
  assert.equal(heading.content[0]?.text, "barrier heading");
  assert.equal(list.items[0]?.[0]?.text, "barrier list");
  assert.equal(image.alt, "barrier alt");
  assert.equal(image.caption?.[0]?.text, "barrier caption");
});

test("getDocumentTextStats counts visible words and symbols with spaces", () => {
  const document: EditorDocument = {
    version: 2,
    blocks: [
      { id: "h-1", type: "heading", level: 2, content: [{ text: "Назва розділу" }] },
      { id: "p-1", type: "paragraph", content: [{ text: "Перше речення." }] },
      { id: "l-1", type: "bullet_list", items: [[{ text: "пункт один" }], [{ text: "пункт два" }]] },
      {
        id: "c-1",
        type: "callout",
        kind: "mechanism",
        title: [{ text: "Врізка" }],
        body: [[{ text: "короткий текст" }]]
      },
      {
        id: "i-1",
        type: "image",
        assetId: "asset-1",
        alt: "схема",
        caption: [{ text: "підпис" }]
      },
      {
        id: "t-1",
        type: "table",
        rows: [
          [[{ text: "A1" }], [{ text: "B1" }]],
          [[{ text: "A2" }], [{ text: "B2" }]]
        ]
      },
      { id: "d-1", type: "divider" }
    ]
  };

  const stats = getDocumentTextStats(document);

  assert.equal(stats.words, 17);
  assert.equal(stats.charactersWithSpaces, "Назва розділу Перше речення. пункт один пункт два Врізка короткий текст схема підпис A1 B1 A2 B2".length);
});

test("convertBlockToListBlock preserves inline formatting and terminal punctuation", () => {
  const block: EditorDocument["blocks"][number] = {
    id: "p-1",
    type: "paragraph",
    content: [
      { text: "Перший", bold: true },
      { text: " пункт. " },
      { text: "Другий", italic: true },
      { text: " пункт." }
    ]
  };

  const list = convertBlockToListBlock(block, "bullet_list");

  assert.equal(list.type, "bullet_list");
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0]?.[0]?.text, "Перший");
  assert.equal(list.items[0]?.[0]?.bold, true);
  assert.equal(list.items[0]?.[1]?.text, " пункт.");
  assert.equal(list.items[1]?.[0]?.text, "Другий");
  assert.equal(list.items[1]?.[0]?.italic, true);
  assert.equal(list.items[1]?.[1]?.text, " пункт.");
});

test("convertBlockToListBlock strips list markers without stripping formatting", () => {
  const block: EditorDocument["blocks"][number] = {
    id: "p-1",
    type: "paragraph",
    content: [
      { text: "- " },
      { text: "Жирний пункт", bold: true },
      { text: "\n2. " },
      { text: "Курсивний пункт", italic: true }
    ]
  };

  const list = convertBlockToListBlock(block, "ordered_list");

  assert.equal(list.type, "ordered_list");
  assert.equal(list.items[0]?.[0]?.text, "Жирний пункт");
  assert.equal(list.items[0]?.[0]?.bold, true);
  assert.equal(list.items[1]?.[0]?.text, "Курсивний пункт");
  assert.equal(list.items[1]?.[0]?.italic, true);
});

test("convertBlockToParagraphBlock preserves inline formatting when flattening a list", () => {
  const block: EditorDocument["blocks"][number] = {
    id: "l-1",
    type: "bullet_list",
    items: [
      [{ text: "Жирний", bold: true }, { text: " пункт." }],
      [{ text: "Курсивний", italic: true }, { text: " пункт." }]
    ]
  };

  const paragraph = convertBlockToParagraphBlock(block);

  assert.equal(paragraph.type, "paragraph");
  assert.equal(paragraph.content[0]?.text, "Жирний");
  assert.equal(paragraph.content[0]?.bold, true);
  assert.equal(paragraph.content[1]?.text, " пункт.\n");
  assert.equal(paragraph.content[2]?.text, "Курсивний");
  assert.equal(paragraph.content[2]?.italic, true);
  assert.equal(paragraph.content[3]?.text, " пункт.");
});

test("convertBlockToHeadingBlock preserves inline formatting when flattening a list", () => {
  const block: EditorDocument["blocks"][number] = {
    id: "l-1",
    type: "ordered_list",
    items: [
      [{ text: "Перший", bold: true }],
      [{ text: "Другий", italic: true }]
    ]
  };

  const heading = convertBlockToHeadingBlock(block, 2);

  assert.equal(heading.type, "heading");
  assert.equal(heading.level, 2);
  assert.equal(heading.content[0]?.text, "Перший");
  assert.equal(heading.content[0]?.bold, true);
  assert.equal(heading.content[1]?.text, "\n");
  assert.equal(heading.content[2]?.text, "Другий");
  assert.equal(heading.content[2]?.italic, true);
});
