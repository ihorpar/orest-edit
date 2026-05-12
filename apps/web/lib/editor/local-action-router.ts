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

export type LocalActionMode = "auto" | "edit" | "spellcheck" | "callout" | "visual";
export type LocalActionTextIntent = "rewrite" | "shorten" | "list" | "subsection";
export type LocalActionExecutor = "patch" | "review" | "spellcheck" | "callout" | "visual" | "clarify";
export type LocalActionClarifyChoice = "patch" | "spellcheck" | "callout" | "visual";
export type SuggestedLocalActionMode = Exclude<LocalActionMode, "auto" | "edit">;

export interface LocalActionRouteRequest {
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

const TEXT_INTENT_LABELS: Record<LocalActionTextIntent, string> = {
  rewrite: "Переписати",
  shorten: "Скоротити",
  list: "Список",
  subsection: "Підзаголовок"
};

const CLARIFY_PATTERNS = /\b(щось|якось|як[- ]?небудь|на твій розсуд|сам виріши|обери сам)\b/i;
const SPELLCHECK_PATTERNS = /(правопис|орфограф|помилк|описк|grammar|spell)/i;
const CALLOUT_PATTERNS = /(врізк|врезк|бокс|сайдбар|виноск)/i;
const VISUAL_PATTERNS = /(візуал|зображ|картин|ілюстрац|схем|інфограф)/i;
const SUBSECTION_PATTERNS = /(підзаголов|підрозділ|заголовк|h3|h 3)/i;
const LIST_PATTERNS = /(спис(ок|ком)?|перел(ік|іч)|bullets?)/i;
const SHORTEN_PATTERNS = /(скорот|стисл|ущільн|коротш)/i;

export function inferLocalActionRoute(input: LocalActionRouteRequest): LocalActionRouteResponse {
  const trimmedPrompt = input.prompt.trim();
  const explicitMode = input.explicitMode ?? null;
  const preferredTextIntent = input.preferredTextIntent ?? null;
  const calloutKind = input.calloutKind ?? "mechanism";
  const calloutDepth = normalizeEditorialCalloutDepth(input.calloutDepth);
  const visualIntent = input.visualIntent ?? "infographic";
  const visualStylePreset = input.visualStylePreset;
  const suggestedMode = inferSuggestedLocalActionMode(trimmedPrompt);

  if (explicitMode === "spellcheck") {
    return { executor: "spellcheck", actionLabel: "Перевірити правопис" };
  }

  if (explicitMode === "callout") {
    return {
      executor: "callout",
      calloutKind,
      calloutDepth,
      prompt: trimmedPrompt || undefined,
      actionLabel: "Підготувати врізку"
    };
  }

  if (explicitMode === "visual") {
    return {
      executor: "visual",
      visualIntent,
      visualStylePreset,
      prompt: trimmedPrompt || undefined,
      actionLabel: "Підготувати візуал"
    };
  }

  if (explicitMode !== "edit" && suggestedMode === "spellcheck") {
    return { executor: "spellcheck", actionLabel: "Перевірити правопис" };
  }

  if (explicitMode !== "edit" && suggestedMode === "callout") {
    return {
      executor: "callout",
      calloutKind,
      calloutDepth,
      prompt: trimmedPrompt,
      actionLabel: "Підготувати врізку"
    };
  }

  if (explicitMode !== "edit" && suggestedMode === "visual") {
    return {
      executor: "visual",
      visualIntent,
      visualStylePreset,
      prompt: trimmedPrompt,
      actionLabel: "Підготувати візуал"
    };
  }

  if (trimmedPrompt && CLARIFY_PATTERNS.test(trimmedPrompt) && !preferredTextIntent) {
    return {
      executor: "clarify",
      actionLabel: "Уточніть дію",
      choices: ["patch", "callout", "visual"]
    };
  }

  const inferredTextIntent =
    preferredTextIntent ??
    (trimmedPrompt && SUBSECTION_PATTERNS.test(trimmedPrompt)
      ? "subsection"
      : trimmedPrompt && LIST_PATTERNS.test(trimmedPrompt)
        ? "list"
        : trimmedPrompt && SHORTEN_PATTERNS.test(trimmedPrompt)
          ? "shorten"
          : "rewrite");

  const normalizedPrompt = buildPatchPromptForTextIntent(inferredTextIntent, trimmedPrompt);

  if (inferredTextIntent === "list" || inferredTextIntent === "subsection") {
    return {
      executor: "review",
      recommendationType: inferredTextIntent,
      prompt: trimmedPrompt || undefined,
      actionLabel: TEXT_INTENT_LABELS[inferredTextIntent]
    };
  }

  return {
    executor: "patch",
    textIntent: inferredTextIntent,
    requestMode: normalizedPrompt ? "custom" : "default",
    prompt: normalizedPrompt ?? undefined,
    actionLabel: TEXT_INTENT_LABELS[inferredTextIntent]
  };
}

export function inferSuggestedLocalActionMode(prompt: string): SuggestedLocalActionMode | null {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    return null;
  }

  if (SPELLCHECK_PATTERNS.test(trimmedPrompt)) {
    return "spellcheck";
  }

  if (CALLOUT_PATTERNS.test(trimmedPrompt)) {
    return "callout";
  }

  if (VISUAL_PATTERNS.test(trimmedPrompt)) {
    return "visual";
  }

  return null;
}

export function buildPatchPromptForTextIntent(intent: LocalActionTextIntent, prompt: string): string | null {
  const trimmedPrompt = prompt.trim();

  if (intent === "rewrite") {
    return trimmedPrompt || null;
  }

  const baseInstruction =
    intent === "shorten"
      ? "Скороти виділений фрагмент, збережи зміст, логіку й тон."
      : intent === "subsection"
        ? "Запропонуй один короткий H3-підзаголовок для виділеного фрагмента українською без зміни змісту."
        : "Перетвори виділений фрагмент на компактний список українською без втрати змісту.";

  return trimmedPrompt ? `${baseInstruction}\n\nДодаткова інструкція: ${trimmedPrompt}` : baseInstruction;
}

export function getLocalActionTextIntentOptions(): Array<{ value: LocalActionTextIntent; label: string }> {
  return (Object.keys(TEXT_INTENT_LABELS) as LocalActionTextIntent[]).map((value) => ({
    value,
    label: TEXT_INTENT_LABELS[value]
  }));
}

export function getLocalActionTextIntentLabel(intent: LocalActionTextIntent): string {
  return TEXT_INTENT_LABELS[intent];
}

export function getLocalActionCalloutDescription(kind: EditorialCalloutKind): string {
  return `${getEditorialCalloutKindLabel(kind)}: ${getEditorialCalloutKindDescription(kind)}`;
}

export function getLocalActionCalloutDepthDescription(depth: EditorialCalloutDepth): string {
  return `${getEditorialCalloutDepthLabel(depth)}`;
}

export function getLocalActionVisualDescription(intent: EditorialVisualIntent): string {
  return intent === "illustration"
    ? `${getEditorialVisualIntentLabel(intent)}: одна виразна пояснювальна сцена без жорсткої сітки чи табличної композиції.`
    : `${getEditorialVisualIntentLabel(intent)}: структурований візуал із чіткою композицією, який пояснює фрагмент через порівняння, процес або схему.`;
}
