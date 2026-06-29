import type { AppLocale } from "../product-locale";
import editorEn from "./en";
import editorUk from "./uk";

export const EDITOR_MESSAGES = {
  uk: editorUk,
  en: editorEn
} as const;

export type EditorMessages = (typeof EDITOR_MESSAGES)[AppLocale];

export function getEditorMessages(locale: AppLocale): EditorMessages {
  return EDITOR_MESSAGES[locale];
}

export type WorkflowStepId =
  | "diagnostics"
  | "fact_check"
  | "structure"
  | "clarity"
  | "interest"
  | "visuals"
  | "formatting"
  | "spellcheck"
  | "emphasis"
  | "final_editing";

export function getWorkflowStepLabel(locale: AppLocale, stepId: WorkflowStepId): string {
  return getEditorMessages(locale).workflowSteps[stepId];
}

export function getWorkflowStepSummary(locale: AppLocale, stepId: WorkflowStepId): string {
  return getEditorMessages(locale).workflowSummaries[stepId];
}
