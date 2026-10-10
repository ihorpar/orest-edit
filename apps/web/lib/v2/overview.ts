import { getBlockText, type EditorDocument } from "../editor/document-model.ts";
import { computeAnchorFingerprint, type ManuscriptRevisionState } from "../editor/manuscript-structure.ts";
import type {
  DiagnosticsMode,
  EditorialFactCheckRow,
  EditorialFactCheckSource,
  FactCheckStatus
} from "../editor/review-contract.ts";
import { getEditorMessages } from "../i18n/editor-messages/index.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import type { V2ReviewItem } from "./item-kinds.ts";

/**
 * The read-only side of the editor (`Огляд`): the diagnostics report, fact-check findings and the list of
 * questions for the author. Pure data and helpers; the store keeps the state, the engine makes the calls.
 */

export interface V2DiagnosticsReport {
  /** The model's markdown, shown verbatim. */
  text: string;
  at: string;
  mode: DiagnosticsMode;
}

/** A claim the fact-check flagged. Rows the model marked `ok` never become findings. */
export interface V2FactFinding {
  id: string;
  claim: string;
  status: Exclude<FactCheckStatus, "ok">;
  explanation: string;
  sources: EditorialFactCheckSource[];
  /** The block the claim was found in, when it could be located in the manuscript. */
  blockId: string | null;
  /** The suggestion in `Правки` made for this claim, when one was made. */
  itemId: string | null;
}

export interface V2FactCheckReport {
  findings: V2FactFinding[];
  at: string;
  /** How many claims the model returned in all, `ok` ones included. */
  checkedCount: number;
}

export interface V2AuthorQuery {
  id: string;
  /** Empty for a question that did not come from a finding. */
  findingId: string | null;
  claim: string;
  explanation: string;
  status: Exclude<FactCheckStatus, "ok">;
  sources: EditorialFactCheckSource[];
  blockId: string | null;
  /** The editor's own remark for the author. */
  note: string;
  at: string;
}

export interface V2OverviewState {
  diagnosticsMode: DiagnosticsMode;
  diagnostics: V2DiagnosticsReport | null;
  factCheck: V2FactCheckReport | null;
  authorQueries: V2AuthorQuery[];
}

export function createInitialOverviewState(): V2OverviewState {
  return { diagnosticsMode: "concise", diagnostics: null, factCheck: null, authorQueries: [] };
}

/** As many linked suggestions as the classic editor makes for one fact-check run. */
export const FACT_CHECK_MAX_LINKED_ITEMS = 12;
export const AUTHOR_QUERY_NOTE_MAX_LENGTH = 600;

/* ---------- fact-check rows ---------- */

/** True for an address that is safe to put into a link: plain http(s) only. */
export function isSafeSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeSource(value: unknown): EditorialFactCheckSource | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : "";

  if (!url || !isSafeSourceUrl(url)) {
    return null;
  }

  let domain = typeof record.domain === "string" ? record.domain.trim() : "";

  if (!domain) {
    domain = new URL(url).hostname.replace(/^www\./, "");
  }

  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : domain;
  return { title, url, domain };
}

/**
 * Reads the rows of a fact-check result. A row without a claim or with an unknown status is left out; a
 * source without a usable http(s) address is left out too, so nothing unsafe can become a link.
 */
export function normalizeFactCheckRows(value: unknown): EditorialFactCheckRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: EditorialFactCheckRow[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const claim = typeof record.claim === "string" ? record.claim.trim() : "";
    const status = record.status;

    if (!claim || (status !== "ok" && status !== "questionable" && status !== "unsupported")) {
      continue;
    }

    const seen = new Set<string>();
    const sources = (Array.isArray(record.sources) ? record.sources : [])
      .map(normalizeSource)
      .filter((source): source is EditorialFactCheckSource => {
        if (!source || seen.has(source.url)) {
          return false;
        }

        seen.add(source.url);
        return true;
      });

    rows.push({ claim, status, explanation: typeof record.explanation === "string" ? record.explanation.trim() : "", sources });
  }

  return rows;
}

// Same matching as the classic editor (`resolveFactCheckAnchor` in `app/editor/page.tsx`).
const FACT_CHECK_SKIP_TOKENS = new Set([
  "або", "але", "без", "був", "буває", "бути", "вже", "вона", "вони", "для", "дуже", "його", "йому", "йти", "коли",
  "може", "можуть", "навіть", "неї", "після", "про", "при", "також", "тих", "того", "цей", "ця", "ці", "що", "щоб"
]);

function tokenizeForFactMatching(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[`'’"]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !FACT_CHECK_SKIP_TOKENS.has(token));
}

/** The block a claim most likely comes from: the one sharing the most meaningful words with it. */
export function resolveFactCheckBlock(
  document: EditorDocument,
  revision: ManuscriptRevisionState,
  claim: string
): { blockId: string; index: number; excerpt: string } | null {
  const claimTokens = tokenizeForFactMatching(claim);

  if (claimTokens.length === 0) {
    return null;
  }

  const blocks = new Map(document.blocks.map((block) => [block.id, block]));
  let best: { blockId: string; index: number; score: number } | null = null;

  for (let index = 0; index < revision.blockOrder.length; index += 1) {
    const blockId = revision.blockOrder[index]!;
    const block = blocks.get(blockId);

    if (!block) {
      continue;
    }

    const tokenSet = new Set(tokenizeForFactMatching(getBlockText(block)));

    if (tokenSet.size === 0) {
      continue;
    }

    const overlap = claimTokens.filter((token) => tokenSet.has(token)).length;

    if (overlap === 0) {
      continue;
    }

    const score = overlap / Math.max(3, claimTokens.length);

    if (!best || score > best.score) {
      best = { blockId, index, score };
    }
  }

  if (!best || best.score < 0.2) {
    return null;
  }

  return { blockId: best.blockId, index: best.index, excerpt: getBlockText(blocks.get(best.blockId)!).trim() };
}

export interface BuildFactCheckInput {
  rows: EditorialFactCheckRow[];
  document: EditorDocument;
  revision: ManuscriptRevisionState;
  reviewSessionId: string;
  stepRunId: string;
  locale: AppLocale;
  /** Makes the id of a linked suggestion; injected so the result is repeatable in tests. */
  createItemId?: (index: number) => string;
}

/**
 * Turns fact-check rows into what the editor works with: one finding per flagged claim and, where the claim
 * can be located in the text, a linked suggestion for the queue (a careful local rewrite, or a
 * `Міф / Правда` callout when the claim is unsupported or has no source), as the classic editor does.
 * `ok` rows are dropped: the check is a red-flag detector, and an empty result is a valid one.
 */
export function buildFactCheck(input: BuildFactCheckInput): { findings: V2FactFinding[]; items: V2ReviewItem[] } {
  const linkedCards = getEditorMessages(input.locale).factCheck.linkedCards;
  const createItemId =
    input.createItemId ?? ((index: number) => `review-item-fact-${index + 1}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const findings: V2FactFinding[] = [];
  const items: V2ReviewItem[] = [];

  input.rows.forEach((row, index) => {
    const claim = row.claim.trim();

    if (!claim || row.status === "ok") {
      return;
    }

    const anchor = resolveFactCheckBlock(input.document, input.revision, claim);
    let itemId: string | null = null;

    if (anchor && items.length < FACT_CHECK_MAX_LINKED_ITEMS) {
      const needsCallout = row.status === "unsupported" || row.sources.length === 0;
      const titlePrefix = row.status === "questionable" ? linkedCards.questionableTitle : linkedCards.unsupportedTitle;
      const sourceHint =
        row.sources.length > 0
          ? linkedCards.sources(row.sources.map((source) => source.domain).slice(0, 3).join(", "))
          : linkedCards.noReliableExternalSource;

      itemId = createItemId(index);
      items.push({
        id: itemId,
        reviewSessionId: input.reviewSessionId,
        documentRevisionId: input.revision.documentRevisionId,
        changeLevel: 5,
        title: `${titlePrefix}: ${claim.slice(0, 88)}${claim.length > 88 ? "…" : ""}`,
        reason: `${row.explanation} ${sourceHint}`.trim(),
        recommendation: needsCallout ? linkedCards.calloutRecommendation : linkedCards.rewriteRecommendation,
        recommendationType: needsCallout ? "callout" : "rewrite",
        suggestedAction: needsCallout ? "prepare_callout" : "rewrite_text",
        priority: row.status === "unsupported" ? "high" : "medium",
        anchor: {
          blockIds: [anchor.blockId],
          generationBlockRange: { start: anchor.index, end: anchor.index },
          excerpt: anchor.excerpt,
          fingerprint: computeAnchorFingerprint(input.document, [anchor.blockId])
        },
        insertionPoint: { mode: needsCallout ? "after" : "replace", anchorBlockId: anchor.blockId },
        calloutKind: needsCallout ? "myths_vs_truth" : undefined,
        calloutDepth: needsCallout ? "brief" : undefined,
        origin: "review",
        stepId: "fact_check",
        stepRunId: input.stepRunId,
        status: "pending"
      });
    }

    findings.push({
      id: `fact-${input.stepRunId}-${index + 1}`,
      claim,
      status: row.status,
      explanation: row.explanation,
      sources: row.sources,
      blockId: anchor?.blockId ?? null,
      itemId
    });
  });

  return { findings, items };
}

/* ---------- questions for the author ---------- */

function sameClaim(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

export function hasAuthorQuery(queries: V2AuthorQuery[], finding: Pick<V2FactFinding, "id" | "claim">): boolean {
  return queries.some((query) => query.findingId === finding.id || sameClaim(query.claim, finding.claim));
}

export function createAuthorQuery(finding: V2FactFinding, at: string, id: string): V2AuthorQuery {
  return {
    id,
    findingId: finding.id,
    claim: finding.claim,
    explanation: finding.explanation,
    status: finding.status,
    sources: finding.sources,
    blockId: finding.blockId,
    note: "",
    at
  };
}

/** Adds a question; the same claim is never listed twice. */
export function addAuthorQuery(queries: V2AuthorQuery[], query: V2AuthorQuery): V2AuthorQuery[] {
  return hasAuthorQuery(queries, { id: query.findingId ?? "", claim: query.claim }) ? queries : [...queries, query];
}

export function setAuthorQueryNote(queries: V2AuthorQuery[], id: string, note: string): V2AuthorQuery[] {
  const next = note.slice(0, AUTHOR_QUERY_NOTE_MAX_LENGTH);
  return queries.some((query) => query.id === id && query.note !== next)
    ? queries.map((query) => (query.id === id ? { ...query, note: next } : query))
    : queries;
}

export function removeAuthorQuery(queries: V2AuthorQuery[], id: string): V2AuthorQuery[] {
  return queries.some((query) => query.id === id) ? queries.filter((query) => query.id !== id) : queries;
}

export interface AuthorQueriesTextCopy {
  heading: (chapterTitle: string) => string;
  note: string;
  why: string;
  sources: string;
  noSource: string;
}

/**
 * The list as plain text, ready to paste into a letter: a numbered claim with its paragraph, the editor's
 * note, why the claim is in doubt and the sources that were found.
 */
export function formatAuthorQueriesText(
  queries: V2AuthorQuery[],
  options: { chapterTitle: string; where: (query: V2AuthorQuery) => string | null; copy: AuthorQueriesTextCopy }
): string {
  const lines: string[] = [options.copy.heading(options.chapterTitle), ""];

  queries.forEach((query, index) => {
    const where = options.where(query);
    lines.push(`${index + 1}. «${query.claim}»${where ? ` (${where})` : ""}`);

    if (query.note.trim()) {
      lines.push(`   ${options.copy.note}: ${query.note.trim()}`);
    }

    if (query.explanation.trim()) {
      lines.push(`   ${options.copy.why}: ${query.explanation.trim()}`);
    }

    lines.push(
      query.sources.length > 0
        ? `   ${options.copy.sources}: ${query.sources.map((source) => source.url).join("; ")}`
        : `   ${options.copy.noSource}`
    );
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

/* ---------- persistence ---------- */

function isFindingStatus(value: unknown): value is Exclude<FactCheckStatus, "ok"> {
  return value === "questionable" || value === "unsupported";
}

function coerceSources(value: unknown): EditorialFactCheckSource[] {
  return (Array.isArray(value) ? value : []).map(normalizeSource).filter((source): source is EditorialFactCheckSource => source !== null);
}

function coerceFinding(value: unknown): V2FactFinding | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || typeof record.claim !== "string" || !record.claim.trim() || !isFindingStatus(record.status)) {
    return null;
  }

  return {
    id: record.id,
    claim: record.claim,
    status: record.status,
    explanation: typeof record.explanation === "string" ? record.explanation : "",
    sources: coerceSources(record.sources),
    blockId: typeof record.blockId === "string" ? record.blockId : null,
    itemId: typeof record.itemId === "string" ? record.itemId : null
  };
}

function coerceAuthorQuery(value: unknown): V2AuthorQuery | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || typeof record.claim !== "string" || !record.claim.trim()) {
    return null;
  }

  return {
    id: record.id,
    findingId: typeof record.findingId === "string" ? record.findingId : null,
    claim: record.claim,
    explanation: typeof record.explanation === "string" ? record.explanation : "",
    status: isFindingStatus(record.status) ? record.status : "questionable",
    sources: coerceSources(record.sources),
    blockId: typeof record.blockId === "string" ? record.blockId : null,
    note: typeof record.note === "string" ? record.note.slice(0, AUTHOR_QUERY_NOTE_MAX_LENGTH) : "",
    at: typeof record.at === "string" ? record.at : ""
  };
}

/** Reads the overview part of a stored draft; anything unreadable is left out, never guessed. */
export function coerceOverviewState(value: unknown): V2OverviewState {
  const initial = createInitialOverviewState();

  if (!value || typeof value !== "object") {
    return initial;
  }

  const record = value as Record<string, unknown>;
  const diagnostics = record.diagnostics as Partial<V2DiagnosticsReport> | null | undefined;
  const factCheck = record.factCheck as Partial<V2FactCheckReport> | null | undefined;
  const mode = (candidate: unknown): DiagnosticsMode => (candidate === "extended" ? "extended" : "concise");
  const findings = (Array.isArray(factCheck?.findings) ? factCheck.findings : []).map(coerceFinding).filter((entry): entry is V2FactFinding => entry !== null);

  return {
    diagnosticsMode: mode(record.diagnosticsMode),
    diagnostics:
      diagnostics && typeof diagnostics === "object" && typeof diagnostics.text === "string" && diagnostics.text.trim()
        ? { text: diagnostics.text, at: typeof diagnostics.at === "string" ? diagnostics.at : "", mode: mode(diagnostics.mode) }
        : null,
    factCheck:
      factCheck && typeof factCheck === "object" && Array.isArray(factCheck.findings)
        ? {
            findings,
            at: typeof factCheck.at === "string" ? factCheck.at : "",
            checkedCount: typeof factCheck.checkedCount === "number" && factCheck.checkedCount >= findings.length ? factCheck.checkedCount : findings.length
          }
        : null,
    authorQueries: (Array.isArray(record.authorQueries) ? record.authorQueries : [])
      .map(coerceAuthorQuery)
      .filter((entry): entry is V2AuthorQuery => entry !== null)
  };
}
