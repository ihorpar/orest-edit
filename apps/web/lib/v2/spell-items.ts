import type { EditorDocument } from "../editor/document-model.ts";
import { computeAnchorFingerprint, deriveManuscriptRevisionState } from "../editor/manuscript-structure.ts";
import { createSpellcheckDictionarySet, normalizeSpellcheckDictionaryWord } from "../editor/spellcheck-dictionary.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import type { SpellFinding } from "./api.ts";
import { getOccurrenceAt, type V2ReviewItem } from "./item-kinds.ts";

/**
 * Spelling findings as queue items. They take the shape of a review item so that the queue, the cards, the
 * filter, the counters and focus linking treat them like any other suggestion; `spell` carries what is
 * specific to them. They have no `stepId`: spellcheck is not a review step.
 */

/** Drops findings whose word the editor added to the personal dictionary. */
export function filterFindingsByDictionary(findings: SpellFinding[], words: Iterable<string>, locale: AppLocale): SpellFinding[] {
  const dictionary = createSpellcheckDictionarySet(words, locale);

  if (dictionary.size === 0) {
    return findings;
  }

  return findings.filter((finding) => !dictionary.has(normalizeSpellcheckDictionaryWord(finding.badText, locale)));
}

/** Ids of the open spelling items whose word is in the personal dictionary. */
export function selectSpellItemsInDictionary(items: V2ReviewItem[], words: Iterable<string>, locale: AppLocale): string[] {
  const dictionary = createSpellcheckDictionarySet(words, locale);

  if (dictionary.size === 0) {
    return [];
  }

  return items
    .filter(
      (item) =>
        item.spell &&
        item.status !== "applied" &&
        item.status !== "dismissed" &&
        dictionary.has(normalizeSpellcheckDictionaryWord(item.spell.badText, locale))
    )
    .map((item) => item.id);
}

export function buildSpellItems(findings: SpellFinding[], document: EditorDocument, runId: string): V2ReviewItem[] {
  const revision = deriveManuscriptRevisionState(document);
  const blockIndex = new Map(document.blocks.map((block, index) => [block.id, index]));

  return findings
    .filter((finding) => blockIndex.has(finding.blockId) && finding.badText.length > 0)
    .map((finding, index): V2ReviewItem => {
      const position = blockIndex.get(finding.blockId)!;

      return {
        id: `spell-${runId}-${index + 1}`,
        reviewSessionId: `spell-${runId}`,
        documentRevisionId: revision.documentRevisionId,
        changeLevel: 1,
        title: finding.badText,
        reason: finding.message,
        recommendation: "",
        recommendationType: "rewrite",
        suggestedAction: "rewrite_text",
        priority: "low",
        anchor: {
          blockIds: [finding.blockId],
          generationBlockRange: { start: position, end: position },
          excerpt: finding.badText,
          fingerprint: computeAnchorFingerprint(document, [finding.blockId])
        },
        insertionPoint: { mode: "replace", anchorBlockId: finding.blockId },
        status: "ready",
        spell: {
          range: { start: finding.range.start, end: finding.range.end },
          badText: finding.badText,
          suggestions: finding.suggestions,
          choice: 0,
          category: finding.category,
          blockText: finding.blockText,
          occurrence: getOccurrenceAt(finding.blockText, finding.badText, finding.range.start)
        }
      };
    });
}
