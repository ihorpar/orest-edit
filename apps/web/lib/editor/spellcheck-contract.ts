export type SpellcheckLanguage = "uk-UA";

export type SpellcheckProvider = "languagetool_public" | "languagetool_self_hosted";

export type SpellcheckTrigger = "manual";

export type SpellcheckIssueCategory = "misspelling" | "typography" | "grammar" | "style" | "unknown";

export type SpellcheckIssueSeverity = "error" | "warning" | "suggestion";

export interface SpellcheckRange {
  start: number;
  end: number;
}

export interface SpellcheckFragmentSelection {
  blockId: string;
  text: string;
  range: SpellcheckRange;
}

export interface SpellcheckRequest {
  documentRevisionId: string;
  language: SpellcheckLanguage;
  provider: SpellcheckProvider;
  trigger: SpellcheckTrigger;
  selection: SpellcheckFragmentSelection;
}

export interface SpellcheckSuggestion {
  value: string;
}

export interface SpellcheckIssue {
  id: string;
  ruleId: string;
  category: SpellcheckIssueCategory;
  severity: SpellcheckIssueSeverity;
  message: string;
  shortMessage?: string;
  range: SpellcheckRange;
  badText: string;
  suggestions: SpellcheckSuggestion[];
}

export interface SpellcheckResponseDiagnostics {
  requestId: string;
  requestedProvider: SpellcheckProvider;
  providerUsed: SpellcheckProvider;
  language: SpellcheckLanguage;
  trigger: SpellcheckTrigger;
  selectionBlockId: string;
  selectedTextLength: number;
  issueCount: number;
  truncated: boolean;
  generatedAt: string;
  upstreamLatencyMs?: number;
  rawError?: string;
}

export interface SpellcheckResponse {
  documentRevisionId: string;
  providerUsed: SpellcheckProvider;
  language: SpellcheckLanguage;
  selection: SpellcheckFragmentSelection;
  issues: SpellcheckIssue[];
  error?: string;
  diagnostics: SpellcheckResponseDiagnostics;
}

export function createSpellcheckIssueId(prefix = "spell"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isValidSpellcheckRange(range: SpellcheckRange, text: string): boolean {
  return Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end >= range.start && range.end <= text.length;
}

export function getSpellcheckSelectedText(selection: SpellcheckFragmentSelection): string {
  if (!isValidSpellcheckRange(selection.range, selection.text)) {
    return "";
  }

  return selection.text.slice(selection.range.start, selection.range.end);
}
