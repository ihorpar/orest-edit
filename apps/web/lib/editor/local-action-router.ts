import {
  getEditorialCalloutKindDescription,
  getEditorialCalloutKindLabel,
  getEditorialVisualIntentLabel,
  type EditorialCalloutKind,
  type EditorialVisualIntent,
  type VisualStylePreset
} from "./review-contract";

export type LocalActionMode = "auto" | "spellcheck" | "callout" | "visual";
export type LocalActionTextIntent = "rewrite" | "shorten" | "list" | "table";
export type LocalActionExecutor = "patch" | "spellcheck" | "callout" | "visual" | "clarify";
export type LocalActionClarifyChoice = "patch" | "spellcheck" | "callout" | "visual";

export interface LocalActionRouteRequest {
  prompt: string;
  explicitMode?: Exclude<LocalActionMode, "auto"> | null;
  preferredTextIntent?: LocalActionTextIntent | null;
  calloutKind?: EditorialCalloutKind;
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
      executor: "spellcheck";
      actionLabel: string;
    }
  | {
      executor: "callout";
      calloutKind: EditorialCalloutKind;
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
  list: "Зробити списком",
  table: "Зробити таблицею"
};

const CLARIFY_PATTERNS = /\b(щось|якось|як[- ]?небудь|на твій розсуд|сам виріши|обери сам)\b/i;
const SPELLCHECK_PATTERNS = /(правопис|орфограф|помилк|описк|grammar|spell)/i;
const CALLOUT_PATTERNS = /(врізк|врезк|бокс|сайдбар|виноск)/i;
const VISUAL_PATTERNS = /(візуал|зображ|картин|ілюстрац|схем|інфограф)/i;
const TABLE_PATTERNS = /(таблиц|таблич|порівняльну таблиц)/i;
const LIST_PATTERNS = /(спис(ок|ком)?|перел(ік|іч)|bullets?)/i;
const SHORTEN_PATTERNS = /(скорот|стисл|ущільн|коротш)/i;

export function inferLocalActionRoute(input: LocalActionRouteRequest): LocalActionRouteResponse {
  const trimmedPrompt = input.prompt.trim();
  const explicitMode = input.explicitMode ?? null;
  const preferredTextIntent = input.preferredTextIntent ?? null;
  const calloutKind = input.calloutKind ?? "mechanism";
  const visualIntent = input.visualIntent ?? "infographic";
  const visualStylePreset = input.visualStylePreset;

  if (explicitMode === "spellcheck") {
    return { executor: "spellcheck", actionLabel: "Перевірити правопис" };
  }

  if (explicitMode === "callout") {
    return {
      executor: "callout",
      calloutKind,
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

  if (trimmedPrompt && SPELLCHECK_PATTERNS.test(trimmedPrompt)) {
    return { executor: "spellcheck", actionLabel: "Перевірити правопис" };
  }

  if (trimmedPrompt && CALLOUT_PATTERNS.test(trimmedPrompt)) {
    return {
      executor: "callout",
      calloutKind,
      prompt: trimmedPrompt,
      actionLabel: "Підготувати врізку"
    };
  }

  if (trimmedPrompt && VISUAL_PATTERNS.test(trimmedPrompt)) {
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
    (trimmedPrompt && TABLE_PATTERNS.test(trimmedPrompt)
      ? "table"
      : trimmedPrompt && LIST_PATTERNS.test(trimmedPrompt)
        ? "list"
        : trimmedPrompt && SHORTEN_PATTERNS.test(trimmedPrompt)
          ? "shorten"
          : "rewrite");

  const normalizedPrompt = buildPatchPromptForTextIntent(inferredTextIntent, trimmedPrompt);

  return {
    executor: "patch",
    textIntent: inferredTextIntent,
    requestMode: normalizedPrompt ? "custom" : "default",
    prompt: normalizedPrompt ?? undefined,
    actionLabel: TEXT_INTENT_LABELS[inferredTextIntent]
  };
}

export function buildPatchPromptForTextIntent(intent: LocalActionTextIntent, prompt: string): string | null {
  const trimmedPrompt = prompt.trim();

  if (intent === "rewrite") {
    return trimmedPrompt || null;
  }

  const baseInstruction =
    intent === "shorten"
      ? "Скороти виділений фрагмент, збережи зміст, логіку й тон."
      : intent === "list"
        ? "Перетвори виділений фрагмент на компактний список українською без втрати змісту."
        : "Перетвори виділений фрагмент на компактну таблицю українською без вигадування нових фактів.";

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

export function getLocalActionVisualDescription(intent: EditorialVisualIntent): string {
  return intent === "illustration"
    ? `${getEditorialVisualIntentLabel(intent)}: одна виразна пояснювальна сцена без жорсткої сітки чи табличної композиції.`
    : `${getEditorialVisualIntentLabel(intent)}: структурований візуал із чіткою композицією, який пояснює фрагмент через порівняння, процес або схему.`;
}
