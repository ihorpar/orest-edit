import { getEditorMessages } from "../i18n/editor-messages";
import type { AppLocale } from "../i18n/product-locale";
import type { ImportWarningCode, ImportedDocumentFormat } from "./import";
import type { RequestFeedback } from "./workflow-ui";

export function buildImportFeedback(
  format: ImportedDocumentFormat,
  warnings: ImportWarningCode[],
  locale: AppLocale
): RequestFeedback {
  const exportImport = getEditorMessages(locale).exportImport;
  const label = formatImportLabel(format, exportImport);
  const warningMessages = warnings.map((code) => exportImport.importWarnings[code]);
  const message =
    warningMessages.length === 0
      ? exportImport.imported(label)
      : `${exportImport.imported(label)} ${warningMessages.join(" ")}`;

  return { tone: "info", message };
}

function formatImportLabel(
  format: ImportedDocumentFormat,
  exportImport: ReturnType<typeof getEditorMessages>["exportImport"]
): string {
  switch (format) {
    case "docx":
      return "DOCX";
    case "clipboard_html":
      return exportImport.clipboardContent;
    case "clipboard_text":
      return exportImport.clipboardText;
    case "txt":
    default:
      return "TXT";
  }
}
