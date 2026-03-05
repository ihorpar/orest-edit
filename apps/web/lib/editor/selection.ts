import { getSelectedText, hasSelection, type PatchSelection } from "./patch-contract";

export type SelectionRange = PatchSelection;

export function formatSelection(range: SelectionRange): string {
  return `${range.start}-${range.end}`;
}

export function getSelectionPreview(text: string, range: SelectionRange, maxLength = 120): string {
  const selectedText = getSelectedText(text, range).replace(/\s+/g, " ").trim();

  if (!selectedText) {
    return "";
  }

  return selectedText.length > maxLength ? `${selectedText.slice(0, maxLength - 1)}…` : selectedText;
}

export function getSelectionLineRange(text: string, range: SelectionRange): { startLine: number; endLine: number } {
  const startLine = text.slice(0, range.start).split("\n").length;
  const endLine = text.slice(0, range.end).split("\n").length;

  return { startLine, endLine };
}

export function buildSelectionLabel(text: string, range: SelectionRange): string {
  if (!hasSelection(range)) {
    return "Виділіть фрагмент у Редакторі.";
  }

  const preview = getSelectionPreview(text, range);
  const { startLine, endLine } = getSelectionLineRange(text, range);

  return `Рядки ${String(startLine).padStart(3, "0")}-${String(endLine).padStart(3, "0")} • Символи ${formatSelection(range)} • «${preview}»`;
}
