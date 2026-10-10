import { getEditorialCalloutDepthLabel, getEditorialCalloutKindTitle } from "../editor/review-contract.ts";
import type { AppLocale } from "../i18n/product-locale.ts";
import {
  buildCalloutBlock,
  getAccentOccurrence,
  getAccentPhrase,
  getHeadingDraft,
  getItemKind,
  getSpellReplacement,
  type V2ReviewItem
} from "./item-kinds.ts";
import type { ReviewMark } from "./review-marks.ts";
import { getItemSource, selectQueue, type V2ReviewState } from "./store.ts";
import type { BlockDiff } from "./word-diff.ts";

/**
 * What the manuscript draws for the visible queue. One mark per item:
 *
 * - a rewrite highlights its anchored blocks and, when focused and prepared, carries the diff;
 * - a heading with a title is a ghost heading before its anchor; a prepared callout is a ghost callout;
 * - an accent and a spelling finding are inline marks over their exact phrase;
 * - anything not yet prepared highlights its anchored blocks, so the editor sees what it is about.
 *
 * In quiet mode every mark but the current one is `dim`: a faint trace that cannot be accepted.
 */
export function buildItemMarks(
  state: V2ReviewState,
  options: { locale: AppLocale; getDiff: (item: V2ReviewItem) => BlockDiff[] | undefined }
): ReviewMark[] {
  const marks: ReviewMark[] = [];

  for (const item of selectQueue(state)) {
    const proposal = state.proposals[item.id];
    const focused = state.focusId === item.id;
    const stale = item.status === "stale";
    const base: ReviewMark = {
      itemId: item.id,
      tone: getItemSource(item),
      blockIds: item.anchor.blockIds,
      state: proposal?.status === "preparing" ? "preparing" : stale ? "stale" : item.status === "ready" ? "ready" : "pending",
      focused,
      hot: state.hoverId === item.id,
      ...(state.quiet && !focused ? { dim: true } : {})
    };

    switch (getItemKind(item)) {
      case "heading": {
        const draft = getHeadingDraft(item);

        if (stale) {
          // The block it would go before is gone; there is nothing in the text to point at.
          break;
        }

        // An emptied title still shows its ghost while focused, so the editor can type a new one.
        if (draft || (focused && item.subsectionDraft)) {
          marks.push({
            ...base,
            blockIds: [],
            ghost: {
              type: "heading",
              anchorBlockId: item.insertionPoint.anchorBlockId,
              title: draft?.title ?? "",
              level: draft?.headingLevel ?? (item.subsectionDraft?.headingLevel === 2 ? 2 : 3),
              editable: focused
            }
          });
          break;
        }

        marks.push(base);
        break;
      }

      case "callout": {
        const block = stale ? null : buildCalloutBlock(item, options.locale, `ghost-${item.id}`);

        if (block) {
          const kind = getEditorialCalloutKindTitle(block.kind, options.locale);
          const depth = getEditorialCalloutDepthLabel(block.depth ?? "brief", options.locale).toLocaleLowerCase();

          marks.push({
            ...base,
            blockIds: [],
            ghost: {
              type: "callout",
              anchorBlockId: item.insertionPoint.anchorBlockId,
              side: item.insertionPoint.mode === "before" ? "before" : "after",
              block,
              label: `${kind} · ${depth}`
            }
          });
          break;
        }

        marks.push(base);
        break;
      }

      case "accent": {
        const text = getAccentPhrase(item);

        if (!stale && text && item.anchor.blockIds[0]) {
          marks.push({
            ...base,
            blockIds: [],
            inline: { type: "accent", blockId: item.anchor.blockIds[0], text, occurrence: getAccentOccurrence(item) }
          });
        }

        break;
      }

      case "spell": {
        const spell = item.spell;

        if (!stale && spell && item.anchor.blockIds[0]) {
          marks.push({
            ...base,
            blockIds: [],
            inline: {
              type: "spell",
              blockId: item.anchor.blockIds[0],
              start: spell.range.start,
              end: spell.range.end,
              badText: spell.badText,
              replacement: getSpellReplacement(item) ?? undefined
            }
          });
        }

        break;
      }

      default: {
        const diff = focused && item.status === "ready" ? options.getDiff(item) : undefined;
        marks.push(diff ? { ...base, diff } : base);
      }
    }
  }

  return marks;
}
