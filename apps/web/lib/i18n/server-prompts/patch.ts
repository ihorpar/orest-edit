import type { AppLocale } from "../product-locale";
import { appendBulletListPunctuationRule } from "../../editor/settings";

const PATCH_SYSTEM_PROMPTS = {
  uk: [
    "Ти редагуєш український науково-популярний рукопис.",
    "Працюй тільки в межах виділених блоків.",
    "Поверни JSON з однією операцією replace_blocks.",
    "newBlocks має містити готові rich-text blocks без markdown-синтаксису.",
    "Активно використовуй bold:true як редакторський інструмент: виділяй ключові думки короткими фразами, щоб текст краще сканувався.",
    "Кожен змістовий абзац або replacement block має містити принаймні 1 короткий bold:true акцент; якщо абзац довгий або містить кілька окремих тез, зроби 2-3 короткі акценти.",
    "Не залишай абзац без акценту, якщо в ньому є причина, наслідок, визначення, висновок, контраст або важливий термін.",
    "Якщо replacement містить короткий локальний заголовок або label-line, оформи його через bold:true у рядку з 1-3 слів, без markdown-заголовків або HTML.",
    "Не виділяй жирним цілі речення, абзаци або весь блок.",
    "Якщо редактор просить форму вірша, короткі рядки або строфи, дозволено повертати перенос рядка всередині одного текстового блока через символ \\n; не розбивай такий результат на кілька блоків без окремої вказівки.",
    "Роби відчутне переформулювання: міняй синтаксис і лексику, не повертай майже ідентичний текст."
  ],
  en: [
    "You edit an English science-pop or medical-pop manuscript.",
    "Work only within the selected blocks.",
    "Return JSON with one replace_blocks operation.",
    "newBlocks must contain ready rich-text blocks without markdown syntax.",
    "Actively use bold:true as an editorial tool: highlight key ideas with short phrases so the text scans better.",
    "Each substantive paragraph or replacement block must contain at least 1 short bold:true accent; for long paragraphs or multiple theses, use 2-3 short accents.",
    "Do not leave a paragraph without an accent when it contains a cause, effect, definition, conclusion, contrast, or important term.",
    "If a replacement contains a short local heading or label line, format it with bold:true in a 1-3 word line, without markdown headings or HTML.",
    "Do not bold entire sentences, paragraphs, or the whole block.",
    "If the editor asks for verse form, short lines, or stanzas, you may return line breaks inside one text block via \\n; do not split into multiple blocks unless explicitly asked.",
    "Make a noticeable rewrite: change syntax and vocabulary; do not return nearly identical text."
  ]
} as const;

const GEMINI_PATCH_SYSTEM_PROMPTS = {
  uk: [
    "Ти редагуєш український науково-популярний рукопис.",
    "Працюй тільки в межах виділених блоків.",
    "Поверни JSON з однією операцією replace_blocks у масиві operations.",
    "Не повертай rich-text blocks, newBlocks, HTML або вкладений JSON усередині рядків; окрім дозволеного **жирного**, інший markdown не додавай.",
    "Поле operations[0].replacements має містити по одному plain-text replacement для кожного виділеного блока в тому самому порядку, що й targetBlockIds.",
    "У replacement strings активно використовуй **жирний** для коротких ключових думок, але не для цілих речень або абзаців.",
    "Кожен змістовий абзац або replacement string має містити принаймні 1 короткий **жирний** акцент; якщо абзац довгий або містить кілька окремих тез, зроби 2-3 короткі акценти.",
    "Не залишай абзац без акценту, якщо в ньому є причина, наслідок, визначення, висновок, контраст або важливий термін.",
    "Якщо replacement містить короткий локальний заголовок або label-line, оформи його як **жирний** рядок із 1-3 слів, без #, ## або HTML-заголовків.",
    "Якщо редактор просить форму вірша, короткі рядки або строфи, дозволено повертати перенос рядка всередині одного replacement string через символ \\n; не розбивай такий результат на кілька blocks без окремої вказівки.",
    "Залишай відповідь українською мовою.",
    "Роби відчутне переформулювання: міняй синтаксис і лексику, не повертай майже ідентичний текст."
  ],
  en: [
    "You edit an English science-pop or medical-pop manuscript.",
    "Work only within the selected blocks.",
    "Return JSON with one replace_blocks operation in the operations array.",
    "Do not return rich-text blocks, newBlocks, HTML, or nested JSON inside strings; except allowed **bold**, do not add other markdown.",
    "operations[0].replacements must contain one plain-text replacement per selected block in the same order as targetBlockIds.",
    "In replacement strings, actively use **bold** for short key ideas, but not for whole sentences or paragraphs.",
    "Each substantive paragraph or replacement string must contain at least 1 short **bold** accent; for long paragraphs or multiple theses, use 2-3 short accents.",
    "Do not leave a paragraph without an accent when it contains a cause, effect, definition, conclusion, contrast, or important term.",
    "If a replacement contains a short local heading or label line, format it as a **bold** 1-3 word line, without #, ##, or HTML headings.",
    "If the editor asks for verse form, short lines, or stanzas, you may return line breaks inside one replacement string via \\n; do not split into multiple blocks unless explicitly asked.",
    "Keep the response in English.",
    "Make a noticeable rewrite: change syntax and vocabulary; do not return nearly identical text."
  ]
} as const;

const PATCH_USER_PROMPTS = {
  uk: {
    intro: "Ось вибрані блоки для локальної правки.",
    defaultTask: "Завдання: зроби текст яснішим і природнішим.",
    customTaskPrefix: "Додаткова інструкція:",
    critical: "Критично: результат має помітно відрізнятися від оригіналу на рівні формулювань, але без вигаданих фактів.",
    contextLabel: "Контекст поруч:",
    selectedLabel: "Вибрані блоки:",
    jsonFormat: 'Поверни JSON: {"operations":[{"blockIds":[...],"newBlocks":[...],"reason":"...","type":"clarity"}]}',
    emptySelection: "Виділення порожнє. Оберіть один або кілька абзаців.",
    invalidProvider: "Провайдер повернув невалідний diff.",
    droppedOps: "Частину відповіді провайдера відкинуто як невалідну."
  },
  en: {
    intro: "Here are the selected blocks for a local edit.",
    defaultTask: "Task: make the text clearer and more natural.",
    customTaskPrefix: "Additional instruction:",
    critical: "Critical: the result must differ noticeably in wording from the original, without invented facts.",
    contextLabel: "Neighboring context:",
    selectedLabel: "Selected blocks:",
    jsonFormat: 'Return JSON: {"operations":[{"blockIds":[...],"newBlocks":[...],"reason":"...","type":"clarity"}]}',
    emptySelection: "Selection is empty. Select one or more paragraphs.",
    invalidProvider: "Provider returned an invalid diff.",
    droppedOps: "Part of the provider response was rejected as invalid."
  }
} as const;

export function buildPatchSystemPrompt(locale: AppLocale, basePrompt?: string): string {
  return [appendBulletListPunctuationRule(basePrompt), ...PATCH_SYSTEM_PROMPTS[locale]].filter(Boolean).join("\n\n");
}

export function buildGeminiPatchSystemPrompt(locale: AppLocale, basePrompt?: string): string {
  return [appendBulletListPunctuationRule(basePrompt), ...GEMINI_PATCH_SYSTEM_PROMPTS[locale]].filter(Boolean).join("\n\n");
}

export function getPatchUserPromptLabels(locale: AppLocale) {
  return PATCH_USER_PROMPTS[locale];
}

export function buildPatchUserPrompt(
  locale: AppLocale,
  input: {
    mode: string;
    prompt?: string;
    targetBlockIds: string[];
    context: string;
    targetText: string;
  }
): string {
  const labels = PATCH_USER_PROMPTS[locale];
  return [
    labels.intro,
    input.mode === "custom" && input.prompt?.trim()
      ? `${labels.customTaskPrefix} ${input.prompt.trim()}`
      : labels.defaultTask,
    labels.critical,
    `targetBlockIds: ${JSON.stringify(input.targetBlockIds)}`,
    labels.contextLabel,
    input.context,
    labels.selectedLabel,
    input.targetText,
    labels.jsonFormat
  ].join("\n\n");
}

export function buildGeminiPatchUserPrompt(
  locale: AppLocale,
  input: {
    mode: string;
    prompt?: string;
    targetBlockIds: string[];
    context: string;
    targetText: string;
  }
): string {
  const labels = PATCH_USER_PROMPTS[locale];
  const exampleReason = locale === "en" ? "Briefly explain the editorial change." : "Коротко поясни редакторську зміну.";
  const exampleText = locale === "en" ? "Rewritten text for block p1." : "Переписаний текст для блока p1.";

  return [
    labels.intro,
    input.mode === "custom" && input.prompt?.trim()
      ? `${labels.customTaskPrefix} ${input.prompt.trim()}`
      : labels.defaultTask,
    labels.critical,
    `targetBlockIds: ${JSON.stringify(input.targetBlockIds)}`,
    labels.contextLabel,
    input.context,
    labels.selectedLabel,
    input.targetText,
    locale === "en" ? "Response format:" : "Формат відповіді:",
    `{"operations":[{"blockIds":["p1"],"replacements":["${exampleText}"],"reason":"${exampleReason}","type":"clarity"}]}`,
    locale === "en" ? "Rules:" : "Правила:",
    "- operations must contain exactly one operation.",
    locale === "en"
      ? "- replacements.length must equal the number of targetBlockIds."
      : "- replacements.length має дорівнювати кількості targetBlockIds.",
    locale === "en"
      ? "- Each replacements item is plain text for the corresponding block; actively use **bold** for short key ideas."
      : "- Кожен елемент replacements є plain text для відповідного блока; активно використовуй **жирний** для коротких ключових думок.",
    locale === "en"
      ? "- Do not return the newBlocks key."
      : "- Не повертай ключ newBlocks."
  ].join("\n\n");
}
