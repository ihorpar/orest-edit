import type { EditorMessages } from "../i18n/editor-messages";
import type { AppLocale } from "../i18n/product-locale";

export function localizeExpertiseMarkdown(
  value: string,
  locale: AppLocale,
  drawer: EditorMessages["reviewDrawer"]
): string {
  let next = value.replace(/\r\n?/g, "\n");
  const fieldLabels = drawer.expertiseFieldLabels;

  next = next
    .replace(/Suggested Action\s*:/gi, fieldLabels.suggestedAction)
    .replace(/Callout Kind\s*:/gi, fieldLabels.calloutKind)
    .replace(/Visual Intent\s*:/gi, fieldLabels.visualIntent)
    .replace(/Recommendation\s*:/gi, fieldLabels.recommendation)
    .replace(/What doesn't work\s*:/gi, fieldLabels.whatDoesntWork);

  for (const [token, label] of Object.entries(drawer.expertiseTokens)) {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "gi");
    next = next.replace(pattern, label);
  }

  return next;
}

export function linkifyExpertiseParagraphRefs(value: string, locale: AppLocale): string {
  const paragraphPattern =
    locale === "en"
      ? /(?:para\.|paragraph|p\.)\s*0*(\d+)(?:\s*-\s*0*(\d+))?/gi
      : /абз\.\s*0*(\d+)(?:\s*-\s*0*(\d+))?/gi;

  return value.replace(paragraphPattern, (match, firstRaw) => {
    const index = Number.parseInt(firstRaw, 10);

    if (Number.isNaN(index) || index < 1) {
      return match;
    }

    return `[${match}](#block-${index - 1})`;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
