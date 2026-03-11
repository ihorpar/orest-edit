import test from "node:test";
import assert from "node:assert/strict";
import { exportDocumentToDocx } from "../lib/editor/docx-export.ts";
import type { EditorDocument } from "../lib/editor/document-model.ts";

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

  assert.match(result.fileName, /Назва розділу-2026-03-10\.docx$/);
  assert.equal(result.warnings.length, 0);
  assert.ok(result.blob.size > 0);
});
