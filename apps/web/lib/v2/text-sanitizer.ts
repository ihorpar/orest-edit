import { Plugin, PluginKey } from "@tiptap/pm/state";
import { sanitizeEditorText } from "../editor/document-model.ts";

export const textSanitizerPluginKey = new PluginKey("v2TextSanitizer");

/**
 * Keeps the text in the editor identical to what the document model stores.
 *
 * `tiptapToDocument` passes every text through `sanitizeEditorText` (no-break and other odd spaces become a
 * plain space; soft hyphens, zero-width and direction marks are removed). Text pasted from Word or the web
 * is full of those characters. If they stayed in the editor, the manuscript on screen and the manuscript
 * sent to the model would differ by invisible characters, and a prepared change could not be laid over the
 * text it was written for. So every transaction that changes the document (typing, paste, drop, import) is
 * followed by a fix that rewrites the affected text nodes, keeping their marks. The fix is appended to the
 * same transaction group: one undo takes back the paste and its clean-up together, block ids are untouched,
 * and the selection is mapped through the change.
 */
export function createTextSanitizerPlugin(): Plugin {
  return new Plugin({
    key: textSanitizerPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const fixes: Array<{ from: number; to: number; text: string; marks: readonly import("@tiptap/pm/model").Mark[] }> = [];

      newState.doc.descendants((node, pos) => {
        if (node.isText && node.text) {
          const clean = sanitizeEditorText(node.text);

          if (clean !== node.text) {
            fixes.push({ from: pos, to: pos + node.nodeSize, text: clean, marks: node.marks });
          }
        }
      });

      if (fixes.length === 0) {
        return null;
      }

      const transaction = newState.tr;

      // From the end, so earlier positions stay valid.
      for (const fix of fixes.reverse()) {
        if (fix.text) {
          transaction.replaceWith(fix.from, fix.to, newState.schema.text(fix.text, fix.marks));
        } else {
          transaction.delete(fix.from, fix.to);
        }
      }

      return transaction;
    }
  });
}
