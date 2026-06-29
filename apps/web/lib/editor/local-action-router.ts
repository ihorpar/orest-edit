import {
  getEditorialCalloutKindDescription,
  getEditorialCalloutKindLabel,
  getEditorialCalloutDepthLabel,
  normalizeEditorialCalloutDepth,
  type EditorialCalloutDepth,
  getEditorialVisualIntentLabel,
  type EditorialCalloutKind,
  type EditorialVisualIntent,
  type VisualStylePreset
} from "./review-contract";
import type { AppLocale } from "../i18n/product-locale";

export type LocalActionMode = "auto" | "edit" | "spellcheck" | "callout" | "visual";
export type LocalActionTextIntent = "rewrite" | "shorten" | "list" | "subsection";
export type LocalActionExecutor = "patch" | "review" | "spellcheck" | "callout" | "visual" | "clarify";
export type LocalActionClarifyChoice = "patch" | "spellcheck" | "callout" | "visual";
export type SuggestedLocalActionMode = Exclude<LocalActionMode, "auto" | "edit">;

export interface LocalActionRouteRequest {
  locale?: AppLocale;
  prompt: string;
  explicitMode?: Exclude<LocalActionMode, "auto"> | null;
  preferredTextIntent?: LocalActionTextIntent | null;
  calloutKind?: EditorialCalloutKind;
  calloutDepth?: EditorialCalloutDepth;
  visualIntent?: EditorialVisualIntent;
  visualStylePreset?: VisualStylePreset;
}

export type LocalActionRouteResponse =
  | {
      executor: "patch";
      textIntent: LocalActionTextIntent;
      requestMode: "default" | "custom";
      prompt?: string;
      actionLabel: string;
    }
  | {
      executor: "review";
      recommendationType: "list" | "subsection";
      prompt?: string;
      actionLabel: string;
    }
  | {
      executor: "spellcheck";
      actionLabel: string;
    }
  | {
      executor: "callout";
      calloutKind: EditorialCalloutKind;
      calloutDepth: EditorialCalloutDepth;
      prompt?: string;
      actionLabel: string;
    }
  | {
      executor: "visual";
      visualIntent: EditorialVisualIntent;
      visualStylePreset?: VisualStylePreset;
      prompt?: string;
      actionLabel: string;
    }
  | {
      executor: "clarify";
      actionLabel: string;
      choices: LocalActionClarifyChoice[];
    };

const TEXT_INTENT_LABELS: Record<AppLocale, Record<LocalActionTextIntent, string>> = {
  uk: {
    rewrite: "Переписати",
    shorten: "Скоротити",
    list: "Список",
    subsection: "Підзаголовок"
  },
  en: {
    rewrite: "Rewrite",
    shorten: "Shorten",
    list: "List",
    subsection: "Subheading"
  }
};

const REGEXES = {
  uk: {
    clarify: /\b(щось|якось|як[- ]?небудь|на твій розсуд|сам виріши|обери сам)\b/i,
    spellcheck: /(правопис|орфограф|помилк|описк|grammar|spell)/i,
    callout: /(врізк|врезк|бокс|сайдбар|виноск)/i,
    visual: /(візуал|зображ|картин|ілюстрац|схем|інфограф)/i,
    subsection: /(підзаголов|підрозділ|заголовк|h3|h 3)/i,
    list: /(спис(ок|ком)?|перел(ік|іч)|bullets?)/i,
    shorten: /(скорот|стисл|ущільн|коротш)/i
  },
  en: {
    clarify: /\b(something|anything|you decide|pick for me|your call)\b/i,
    spellcheck: /(spell|grammar|typo|proofread)/i,
    callout: /(callout|sidebar|boxout)/i,
    visual: /(visual|image|illustration|diagram|infographic|graphic)/i,
    subsection: /(subhead|subheading|heading|h3)/i,
    list: /(list|bullets?|bullet points?)/i,
    shorten: /(shorten|trim|tighten|compress|make shorter)/i
  }
} as const;

export function inferLocalActionRoute(input: LocalActionRouteRequest): LocalActionRouteResponse {
  const locale = input.locale ?? "uk";
  const trimmedPrompt = input.prompt.trim();
  const explicitMode = input.explicitMode ?? null;
  const preferredTextIntent = input.preferredTextIntent ?? null;
  const calloutKind = input.calloutKind ?? "mechanism";
  const calloutDepth = normalizeEditorialCalloutDepth(input.calloutDepth);
  const visualIntent = input.visualIntent ?? "infographic";
  const visualStylePreset = input.visualStylePreset;
  const suggestedMode = inferSuggestedLocalActionMode(trimmedPrompt, locale);

  if (explicitMode === "spellcheck") {
    return { executor: "spellcheck", actionLabel: locale === "en" ? "Check spelling" : "Перевірити правопис" };
  }

  if (explicitMode === "callout") {
    return {
      executor: "callout",
      calloutKind,
      calloutDepth,
      prompt: trimmedPrompt || undefined,
      actionLabel: locale === "en" ? "Prepare callout" : "Підготувати врізку"
    };
  }

  if (explicitMode === "visual") {
    return {
      executor: "visual",
      visualIntent,
      visualStylePreset,
      prompt: trimmedPrompt || undefined,
      actionLabel: locale === "en" ? "Prepare visual" : "Підготувати візуал"
    };
  }

  if (explicitMode !== "edit" && suggestedMode === "spellcheck") {
    return { executor: "spellcheck", actionLabel: locale === "en" ? "Check spelling" : "Перевірити правопис" };
  }

  if (explicitMode !== "edit" && suggestedMode === "callout") {
    return {
      executor: "callout",
      calloutKind,
      calloutDepth,
      prompt: trimmedPrompt,
      actionLabel: locale === "en" ? "Prepare callout" : "Підготувати врізку"
    };
  }

  if (explicitMode !== "edit" && suggestedMode === "visual") {
    return {
      executor: "visual",
      visualIntent,
      visualStylePreset,
      prompt: trimmedPrompt,
      actionLabel: locale === "en" ? "Prepare visual" : "Підготувати візуал"
    };
  }

  if (trimmedPrompt && REGEXES[locale].clarify.test(trimmedPrompt) && !preferredTextIntent) {
    return {
      executor: "clarify",
      actionLabel: locale === "en" ? "Clarify action" : "Уточніть дію",
      choices: ["patch", "callout", "visual"]
    };
  }

  const inferredTextIntent =
    preferredTextIntent ??
    (trimmedPrompt && REGEXES[locale].subsection.test(trimmedPrompt)
      ? "subsection"
      : trimmedPrompt && REGEXES[locale].list.test(trimmedPrompt)
        ? "list"
        : trimmedPrompt && REGEXES[locale].shorten.test(trimmedPrompt)
          ? "shorten"
          : "rewrite");

  const normalizedPrompt = buildPatchPromptForTextIntent(inferredTextIntent, trimmedPrompt, locale);

  if (inferredTextIntent === "list" || inferredTextIntent === "subsection") {
    return {
      executor: "review",
      recommendationType: inferredTextIntent,
      prompt: trimmedPrompt || undefined,
      actionLabel: TEXT_INTENT_LABELS[locale][inferredTextIntent]
    };
  }

  return {
    executor: "patch",
    textIntent: inferredTextIntent,
    requestMode: normalizedPrompt ? "custom" : "default",
    prompt: normalizedPrompt ?? undefined,
    actionLabel: TEXT_INTENT_LABELS[locale][inferredTextIntent]
  };
}

export function inferSuggestedLocalActionMode(prompt: string, locale: AppLocale = "uk"): SuggestedLocalActionMode | null {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    return null;
  }

  if (REGEXES[locale].spellcheck.test(trimmedPrompt)) {
    return "spellcheck";
  }

  if (REGEXES[locale].callout.test(trimmedPrompt)) {
    return "callout";
  }

  if (REGEXES[locale].visual.test(trimmedPrompt)) {
    return "visual";
  }

  return null;
}

export function buildPatchPromptForTextIntent(intent: LocalActionTextIntent, prompt: string, locale: AppLocale = "uk"): string | null {
  const trimmedPrompt = prompt.trim();

  if (intent === "rewrite") {
    return trimmedPrompt || null;
  }

  const baseInstruction =
    locale === "en"
      ? intent === "shorten"
        ? "Shorten the selected fragment while preserving meaning, logic, and tone."
        : intent === "subsection"
          ? "Suggest one short H3 subheading for the selected fragment in English without changing its meaning."
          : "Turn the selected fragment into a compact English list without losing meaning."
      : intent === "shorten"
        ? "Скороти виділений фрагмент, збережи зміст, логіку й тон."
        : intent === "subsection"
          ? "Запропонуй один короткий H3-підзаголовок для виділеного фрагмента українською без зміни змісту."
          : "Перетвори виділений фрагмент на компактний список українською без втрати змісту.";

  return trimmedPrompt
    ? `${baseInstruction}\n\n${locale === "en" ? "Additional instruction" : "Додаткова інструкція"}: ${trimmedPrompt}`
    : baseInstruction;
}

export function getLocalActionTextIntentOptions(locale: AppLocale = "uk"): Array<{ value: LocalActionTextIntent; label: string }> {
  return (Object.keys(TEXT_INTENT_LABELS[locale]) as LocalActionTextIntent[]).map((value) => ({
    value,
    label: TEXT_INTENT_LABELS[locale][value]
  }));
}

export function getLocalActionTextIntentLabel(intent: LocalActionTextIntent, locale: AppLocale = "uk"): string {
  return TEXT_INTENT_LABELS[locale][intent];
}

export function getLocalActionCalloutDescription(kind: EditorialCalloutKind, locale: AppLocale = "uk"): string {
  return `${getEditorialCalloutKindLabel(kind, locale)}: ${getEditorialCalloutKindDescription(kind)}`;
}

export function getLocalActionCalloutDepthDescription(depth: EditorialCalloutDepth, locale: AppLocale = "uk"): string {
  return getEditorialCalloutDepthLabel(depth, locale);
}

export function getLocalActionVisualDescription(intent: EditorialVisualIntent, locale: AppLocale = "uk"): string {
  if (locale === "en") {
    return intent === "illustration"
      ? `${getEditorialVisualIntentLabel(intent, locale)}: one clear explanatory scene without a rigid grid or tabular composition.`
      : `${getEditorialVisualIntentLabel(intent, locale)}: a structured visual with a clear composition that explains the fragment through comparison, process, or schema.`;
  }

  return intent === "illustration"
    ? `${getEditorialVisualIntentLabel(intent, locale)}: одна виразна пояснювальна сцена без жорсткої сітки чи табличної композиції.`
    : `${getEditorialVisualIntentLabel(intent, locale)}: структурований візуал із чіткою композицією, який пояснює фрагмент через порівняння, процес або схему.`;
}
