import type {
  EditorialCalloutDepth,
  EditorialCalloutKind,
  EditorialReviewItem,
  EditorialReviewRecommendationType,
  EditorialVisualIntent,
  ReviewActionRequest,
  VisualStylePreset
} from "../../editor/review-contract";
import {
  getCalloutKindGuardrail,
  getEditorialCalloutKindDescription,
  getEditorialCalloutKindLabel,
  isReplaceReviewType
} from "../../editor/review-contract";
import { getBlockText, type Block } from "../../editor/document-model";
import {
  appendBulletListPunctuationRule,
  ENGLISH_BULLET_LIST_PUNCTUATION_RULE,
  BULLET_LIST_PUNCTUATION_RULE,
  getVisualStylePresetGuide,
  getVisualStylePresetLabel,
  normalizeVisualStylePreset
} from "../../editor/settings";
import type { AppLocale } from "../product-locale";

const REVIEW_ACTION_ERRORS = {
  uk: {
    staleAnchorMismatch: "Якір рекомендації вже не збігається з поточним документом.",
    staleAfterEdit: "Після змін документа ця рекомендація застаріла.",
    missingApiKey: (providerName: string) => `Немає API key для ${providerName} у формі або .env.`,
    genericFailure: "Не вдалося підготувати чернетку.",
    providerTimeout: (providerName: string, seconds: number) => `${providerName} перевищив таймаут ${seconds}с.`,
    providerUnavailable: (providerName: string) => `${providerName} недоступний.`
  },
  en: {
    staleAnchorMismatch: "The recommendation anchor no longer matches the current document.",
    staleAfterEdit: "After document changes, this recommendation is stale.",
    missingApiKey: (providerName: string) => `No API key for ${providerName} in the form or .env.`,
    genericFailure: "Failed to prepare the draft.",
    providerTimeout: (providerName: string, seconds: number) => `${providerName} exceeded the ${seconds}s timeout.`,
    providerUnavailable: (providerName: string) => `${providerName} is unavailable.`
  }
} as const;

const REPLACE_PROMPT_SCAFFOLD = {
  uk: {
    listTransform: (blockCount: number) =>
      `Перетвори ${blockCount} вибраних блоків на короткий, читабельний список без нових фактів.`,
    listJsonOnly:
      "Поверни лише JSON без іншого markdown, окрім дозволеного **жирного** у items.",
    listSchema: 'Схема: {"items":["..."]}.',
    listItemsRules:
      "items: 2-7 коротких пунктів plain text без маркерів; активно використовуй **жирний** для коротких назв або ключових думок у пунктах; сервер сам збере bullet list.",
    listBoldAccent:
      "У кожному змістовному пункті має бути 1 короткий **жирний** акцент на назві, причині, наслідку або ключовому терміні; у довгому пункті можна 2 акценти.",
    listNoMarkdownHeadings:
      "Не використовуй #, ##, HTML-заголовки або інший markdown. Не виділяй жирним цілий пункт.",
    recommendationIntent:
      "Редакторська рекомендація описує намір правки, а не текст, який треба буквально вставити.",
    rewritePriority:
      "Пріоритет: перепиши саме вибрані блоки. Якщо рекомендація ширша за локальний фрагмент, адаптуй лише локальне формулювання.",
    leadInRule:
      "Якщо вибраний блок є коротким вступом або lead-in фразою, редагуй саме цю lead-in фразу, не вигадуй відсутній сусідній текст.",
    noBoilerplateDisclaimers:
      "Не додавай загальних пересторог, медичних дисклеймерів, порад звернутися до лікаря, фраз про самодіагностику або консультацію, якщо цього немає в оригіналі і це не є прямою метою рекомендації.",
    preserveListStructure:
      "Якщо джерело є переліком, серією коротких тверджень або ритмічним списком, збережи цю scan-friendly структуру; не перетворюй кожен пункт на розлогий абзац.",
    verseLineBreaks:
      "Якщо редактор просить форму вірша, 4 рядки, строфу або короткі рядки, дозволено повертати внутрішні переноси рядка через символ \\n всередині одного replacement string; сервер збереже їх у межах одного блока.",
    editorialBoldTool:
      "Для rewrite/simplify/expand активно використовуй **жирний** як редакторський інструмент: виділяй **ключові думки** короткими фразами і, якщо у replacement є короткий заголовок або label-line, оформлюй його жирним, наприклад **Чому це важливо**.",
    editorialBoldMinimum:
      "Кожен змістовий абзац або replacement block має містити принаймні 1 короткий **жирний** акцент; якщо абзац довгий або містить кілька окремих тез, зроби 2-3 короткі акценти. Не залишай абзац без акценту, якщо в ньому є причина, наслідок, визначення, висновок або важливий термін.",
    editorialBoldNoHeadings:
      "Не використовуй #, ##, HTML-заголовки або інший markdown. Заголовки в replacement оформлюй тільки через короткий рядок із **жирним** текстом.",
    emphasisNoRewrite:
      "Для кроку «Акценти» заборонено переписувати зміст. Поверни той самий текст, але за потреби додай лише 1-2 короткі **жирні** акценти на ключових фразах.",
    emphasisNoNoise:
      "Не виділяй ціле речення, більшу частину абзацу, перший рядок заголовка або випадкові декоративні слова. Акцент має підсвічувати тезу, а не шуміти.",
    replaceJsonOnly:
      "Поверни лише JSON без іншого markdown, окрім дозволеного **жирного** у replacement strings.",
    replaceSchema: (blockCount: number) =>
      `Схема: {"replacements":["..."]}. replacements має містити рівно ${blockCount} рядків plain text у тому самому порядку, що й вибрані блоки.`,
    recommendationLabel: "Редакторська рекомендація:",
    reasonLabel: "Причина:",
    additionalInstructionLabel: "Додаткова вказівка редактора:",
    selectedBlocksLabel: "Вибрані блоки:",
    replaceTextInstruction: {
      emphasis: (blockCount: number) =>
        `Підготуй ${blockCount} вибраних блоків для режиму смислових акцентів: не змінюй зміст і формулювання без потреби, а лише точково додай 1-2 короткі **жирні** акценти там, де це справді допомагає скануванню.`,
      simplify: (blockCount: number) =>
        `Спрости ${blockCount} вибраних блоків для широкого читача без втрати змісту і без нових фактів.`,
      expand: (blockCount: number) =>
        `Локально розгорни ${blockCount} вибраних блоків, додай ясності та зв'язності без нових фактів.`,
      rewrite: (blockCount: number) =>
        `Локально перепиши ${blockCount} вибраних блоків ясніше, природніше і спокійніше без зміни фактичного змісту.`
    },
    systemManuscript:
      "Ти готуєш локальну block-first заміну вибраних блоків українського рукопису.",
    emphasisSystemMode:
      "Єдиний дозволений формат акценту — рідкісне **жирне** виділення коротких фраз. Не використовуй інший markdown і не перетворюй завдання на повне переписування.",
    systemJsonOnly: "Відповідь має бути короткою, редакторською і строго в межах JSON-схеми.",
    replaceModeGuardrail:
      "Не перетворюй локальну редактуру на safety-боілерплейт: не додавай шаблонних медичних застережень, порад звернутися до лікаря, фраз про самодіагностику, «варто перевірити стан» або повторюваних пересторог, якщо цього немає в джерелі і цього прямо не вимагає рекомендація."
  },
  en: {
    listTransform: (blockCount: number) =>
      `Turn ${blockCount} selected blocks into a short, readable list without new facts.`,
    listJsonOnly: "Return JSON only without other markdown, except allowed **bold** in items.",
    listSchema: 'Schema: {"items":["..."]}.',
    listItemsRules:
      "items: 2-7 short plain-text points without markers; actively use **bold** for short names or key ideas in points; the server will assemble the bullet list.",
    listBoldAccent:
      "Each substantive point must have 1 short **bold** accent on a name, cause, effect, or key term; a long point may have 2 accents.",
    listNoMarkdownHeadings:
      "Do not use #, ##, HTML headings, or other markdown. Do not bold an entire point.",
    recommendationIntent:
      "The editorial recommendation describes the intent of the edit, not text to insert literally.",
    rewritePriority:
      "Priority: rewrite the selected blocks themselves. If the recommendation is broader than the local fragment, adapt only the local wording.",
    leadInRule:
      "If the selected block is a short intro or lead-in phrase, edit that lead-in phrase; do not invent missing neighboring text.",
    noBoilerplateDisclaimers:
      "Do not add generic cautions, medical disclaimers, advice to see a doctor, self-diagnosis phrases, or consultation language unless the original already contains them or the recommendation explicitly requires them.",
    preserveListStructure:
      "If the source is a list, series of short statements, or rhythmic list, preserve that scan-friendly structure; do not turn each point into a long paragraph.",
    verseLineBreaks:
      "If the editor asks for verse form, 4 lines, a stanza, or short lines, you may return internal line breaks via \\n inside one replacement string; the server will preserve them within one block.",
    editorialBoldTool:
      "For rewrite/simplify/expand, actively use **bold** as an editorial tool: highlight **key ideas** with short phrases and, if a replacement has a short heading or label line, format it in bold, for example **Why this matters**.",
    editorialBoldMinimum:
      "Each substantive paragraph or replacement block must contain at least 1 short **bold** accent; if a paragraph is long or has several separate theses, use 2-3 short accents. Do not leave a paragraph without an accent when it contains a cause, effect, definition, conclusion, or important term.",
    editorialBoldNoHeadings:
      "Do not use #, ##, HTML headings, or other markdown. Format headings in replacements only as a short line with **bold** text.",
    emphasisNoRewrite:
      'For the "Emphasis" step, rewriting content is forbidden. Return the same text, but if needed add only 1-2 short **bold** accents on key phrases.',
    emphasisNoNoise:
      "Do not bold a whole sentence, most of a paragraph, the first heading line, or random decorative words. An accent should highlight a thesis, not add noise.",
    replaceJsonOnly:
      "Return JSON only without other markdown, except allowed **bold** in replacement strings.",
    replaceSchema: (blockCount: number) =>
      `Schema: {"replacements":["..."]}. replacements must contain exactly ${blockCount} plain-text rows in the same order as the selected blocks.`,
    recommendationLabel: "Editorial recommendation:",
    reasonLabel: "Reason:",
    additionalInstructionLabel: "Additional editor instruction:",
    selectedBlocksLabel: "Selected blocks:",
    replaceTextInstruction: {
      emphasis: (blockCount: number) =>
        `Prepare ${blockCount} selected blocks for semantic emphasis mode: do not change content or wording unless necessary; only add 1-2 short **bold** accents where it genuinely helps scanning.`,
      simplify: (blockCount: number) =>
        `Simplify ${blockCount} selected blocks for a broad reader without losing meaning or adding new facts.`,
      expand: (blockCount: number) =>
        `Locally expand ${blockCount} selected blocks, adding clarity and cohesion without new facts.`,
      rewrite: (blockCount: number) =>
        `Locally rewrite ${blockCount} selected blocks more clearly, naturally, and calmly without changing factual content.`
    },
    systemManuscript:
      "You are preparing a local block-first replacement of selected blocks in an English manuscript.",
    emphasisSystemMode:
      "The only allowed accent format is rare **bold** highlighting of short phrases. Do not use other markdown and do not turn the task into a full rewrite.",
    systemJsonOnly: "The response must be short, editorial, and strictly within the JSON schema.",
    replaceModeGuardrail:
      "Do not turn local editing into safety boilerplate: do not add template medical warnings, advice to see a doctor, self-diagnosis phrases, 'worth checking your condition', or repeated cautions unless the source already contains them or the recommendation explicitly requires them."
  }
} as const;

export function getReviewActionErrors(locale: AppLocale) {
  return REVIEW_ACTION_ERRORS[locale];
}

export function getReplaceTextInstruction(
  locale: AppLocale,
  type: EditorialReviewRecommendationType,
  blockCount: number,
  stepId?: ReviewActionRequest["item"]["stepId"]
): string {
  const scaffold = REPLACE_PROMPT_SCAFFOLD[locale].replaceTextInstruction;

  if (stepId === "emphasis") {
    return scaffold.emphasis(blockCount);
  }

  if (type === "simplify") {
    return scaffold.simplify(blockCount);
  }

  if (type === "expand") {
    return scaffold.expand(blockCount);
  }

  return scaffold.rewrite(blockCount);
}

function getReplaceModeGuardrail(locale: AppLocale, type: EditorialReviewRecommendationType): string | null {
  if (type !== "rewrite" && type !== "simplify" && type !== "expand") {
    return null;
  }

  return REPLACE_PROMPT_SCAFFOLD[locale].replaceModeGuardrail;
}

export function buildReplaceSystemPrompt(locale: AppLocale, request: ReviewActionRequest): string {
  const scaffold = REPLACE_PROMPT_SCAFFOLD[locale];

  return [
    appendBulletListPunctuationRule(request.basePrompt, locale),
    request.reviewLevelGuide?.trim(),
    scaffold.systemManuscript,
    getReplaceModeGuardrail(locale, request.item.recommendationType),
    request.item.stepId === "emphasis" ? scaffold.emphasisSystemMode : null,
    scaffold.systemJsonOnly
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildReplaceProviderPrompt(locale: AppLocale, request: ReviewActionRequest): string {
  const scaffold = REPLACE_PROMPT_SCAFFOLD[locale];
  const selectedBlocks = request.item.anchor.blockIds
    .map((blockId) => request.document.blocks.find((block) => block.id === blockId))
    .filter((block): block is Block => Boolean(block));
  const blockCount = selectedBlocks.length;
  const emphasisStep = request.item.stepId === "emphasis";
  const shouldUseEditorialBold =
    !emphasisStep &&
    (request.item.recommendationType === "rewrite" ||
      request.item.recommendationType === "simplify" ||
      request.item.recommendationType === "expand");

  if (request.item.recommendationType === "list") {
    return [
      scaffold.listTransform(blockCount),
      scaffold.listJsonOnly,
      scaffold.listSchema,
      scaffold.listItemsRules,
      scaffold.listBoldAccent,
      scaffold.listNoMarkdownHeadings,
      scaffold.recommendationIntent,
      `${scaffold.recommendationLabel} ${request.item.recommendation}`,
      `${scaffold.reasonLabel} ${request.item.reason}`,
      request.editorialInstruction?.trim()
        ? `${scaffold.additionalInstructionLabel} ${request.editorialInstruction.trim()}`
        : null,
      scaffold.selectedBlocksLabel,
      selectedBlocks.map((block, index) => `[${index + 1}] (${block.type}) ${getBlockText(block)}`).join("\n")
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    getReplaceTextInstruction(locale, request.item.recommendationType, blockCount, request.item.stepId),
    scaffold.recommendationIntent,
    scaffold.rewritePriority,
    scaffold.leadInRule,
    scaffold.noBoilerplateDisclaimers,
    scaffold.preserveListStructure,
    scaffold.verseLineBreaks,
    shouldUseEditorialBold ? scaffold.editorialBoldTool : null,
    shouldUseEditorialBold ? scaffold.editorialBoldMinimum : null,
    shouldUseEditorialBold ? scaffold.editorialBoldNoHeadings : null,
    emphasisStep ? scaffold.emphasisNoRewrite : null,
    emphasisStep ? scaffold.emphasisNoNoise : null,
    scaffold.replaceJsonOnly,
    scaffold.replaceSchema(blockCount),
    `${scaffold.recommendationLabel} ${request.item.recommendation}`,
    `${scaffold.reasonLabel} ${request.item.reason}`,
    request.editorialInstruction?.trim()
      ? `${scaffold.additionalInstructionLabel} ${request.editorialInstruction.trim()}`
      : null,
    scaffold.selectedBlocksLabel,
    selectedBlocks.map((block, index) => `[${index + 1}] (${block.type}) ${getBlockText(block)}`).join("\n")
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type InfographicLayout = "comparison" | "process" | "timeline" | "cause_effect" | "layers" | "diagram";

const CALLOUT_DEPTH_PROMPT_GUIDANCE: Record<EditorialCalloutDepth, Record<AppLocale, string>> = {
  brief: {
    uk: "Профіль brief / стисло: створи коротку врізку в поточному стилі.",
    en: "Profile brief / concise: create a short callout in the current style."
  },
  deep: {
    uk: "Профіль deep / докладно: зроби глибокий розбір питання у 3-6 докладних абзацах. Активно використовуй **жирний** як інструмент структури: став короткі **якорі-підзаголовки** з 1-3 слів над окремими абзацами та виділяй **ключові думки** всередині тексту. Це не має бути суцільне полотно; якщо матеріал містить перелік кроків, причин, наслідків або прикладів, оформи одну частину як короткий список.",
    en: "Profile deep / detailed: produce a deep dive in 3-6 substantive paragraphs. Actively use **bold** as a structure tool: place short **anchor subheads** of 1-3 words above separate paragraphs and highlight **key ideas** inside the text. This should not be a solid slab; if the material contains steps, causes, effects, or examples, format one section as a short list."
  }
};

const CALLOUT_PROVIDER_SCAFFOLD = {
  uk: {
    calloutKindLabel: (label: string) => `Тип врізки: ${label}`,
    calloutDepthLine: (depth: EditorialCalloutDepth) => `Глибина врізки: ${depth}.`,
    calloutDepthProfileLine: (depth: EditorialCalloutDepth) =>
      `Профіль глибини: ${depth === "deep" ? "Докладно" : "Стисло"}.`,
    calloutDepthLabel: (depth: EditorialCalloutDepth) => (depth === "deep" ? "Докладно" : "Стисло"),
    calloutKindDescriptionLine: (description: string) => `Що означає цей тип: ${description}`,
    calloutKindGuardrailLine: (guardrail: string) => `Додаткове правило для типу: ${guardrail}`,
    topListBodyFormat:
      "Для top_list: body має містити 3-5 рядків; кожен рядок у форматі «Назва (1-2 слова): пояснення (1 речення)».",
    topListMultilineStructure:
      "Зберігай multi-line структуру: один пункт = один рядок, не склеюй усе в один абзац.",
    fragmentLine: (excerpt: string) => `Фрагмент: ${excerpt}`,
    recommendationLine: (recommendation: string) => `Рекомендація: ${recommendation}`,
    additionalInstructionLine: (instruction: string) => `Додаткова вказівка редактора: ${instruction}`,
    jsonResponseFormat:
      "Формат відповіді: поверни лише JSON-об'єкт без іншого markdown, окрім дозволеного **жирного** і простих списків у body.",
    jsonSchema: 'Схема JSON: {"title":"...","body":"..."}.',
    titleRule: "title: короткий заголовок врізки (1 рядок, plain text).",
    bodyRuleDeep:
      "body: глибокий розбір у 3-6 докладних абзацах; не роби його суцільним полотном. Для deep активно використовуй **жирний**: став короткі **якорі-підзаголовки** з 1-3 слів окремим рядком перед частиною абзаців і виділяй **ключові думки** всередині тексту.",
    bodyRuleBrief: "body: короткий основний текст врізки для block editor.",
    boldAccentRuleDeep:
      "У кожному змістовному абзаці body має бути принаймні 1 короткий **жирний** акцент; у довгих абзацах або абзацах із кількома тезами зроби 2-3 акценти.",
    boldAccentRuleBrief: "Якщо body містить більше одного речення, виділи 1 коротку ключову думку через **жирний**.",
    deepListRule:
      "Якщо у фрагменті є природне перерахування причин, наслідків, кроків або проявів, обов'язково оформи одну частину body як короткий список на 3-5 пунктів, кожен в один рядок, без вкладених списків.",
    deepSubheadRule:
      "Не використовуй #, ## або HTML-заголовки. Підзаголовок у deep-callout - це окремий короткий рядок у форматі **Чому це важливо** або **Що змінюється**.",
    bodyMarkdownRule:
      "У body використовуй лише контрольований **жирний** для коротких змістових акцентів і прості bullet/numbered списки; інший markdown не додавай."
  },
  en: {
    calloutKindLabel: (label: string) => `Callout type: ${label}`,
    calloutDepthLine: (depth: EditorialCalloutDepth) => `Callout depth: ${depth}.`,
    calloutDepthProfileLine: (depth: EditorialCalloutDepth) =>
      `Depth profile: ${depth === "deep" ? "Detailed" : "Brief"}.`,
    calloutDepthLabel: (depth: EditorialCalloutDepth) => (depth === "deep" ? "Detailed" : "Brief"),
    calloutKindDescriptionLine: (description: string) => `What this type means: ${description}`,
    calloutKindGuardrailLine: (guardrail: string) => `Additional rule for this type: ${guardrail}`,
    topListBodyFormat:
      'For top_list: body must contain 3-5 lines; each line in the format "Name (1-2 words): explanation (1 sentence)".',
    topListMultilineStructure:
      "Preserve multi-line structure: one point = one line; do not merge everything into one paragraph.",
    fragmentLine: (excerpt: string) => `Fragment: ${excerpt}`,
    recommendationLine: (recommendation: string) => `Recommendation: ${recommendation}`,
    additionalInstructionLine: (instruction: string) => `Additional editor instruction: ${instruction}`,
    jsonResponseFormat:
      "Response format: return only a JSON object without other markdown, except allowed **bold** and simple lists in body.",
    jsonSchema: 'JSON schema: {"title":"...","body":"..."}.',
    titleRule: "title: short callout heading (1 line, plain text).",
    bodyRuleDeep:
      "body: a deep dive in 3-6 detailed paragraphs; do not make it a solid slab. For deep, actively use **bold**: place short **anchor subheads** of 1-3 words on their own line before some paragraphs and highlight **key ideas** inside the text.",
    bodyRuleBrief: "body: short main callout text for the block editor.",
    boldAccentRuleDeep:
      "Each substantive body paragraph must have at least 1 short **bold** accent; in long paragraphs or paragraphs with several theses, use 2-3 accents.",
    boldAccentRuleBrief:
      "If body contains more than one sentence, highlight 1 short key idea with **bold**.",
    deepListRule:
      "If the fragment has a natural list of causes, effects, steps, or manifestations, format one body section as a short 3-5 point list, one point per line, without nested lists.",
    deepSubheadRule:
      "Do not use #, ##, or HTML headings. A subhead in a deep callout is a short line such as **Why this matters** or **What changes**.",
    bodyMarkdownRule:
      "In body, use only controlled **bold** for short substantive accents and simple bullet/numbered lists; do not add other markdown."
  }
} as const;

const SUBSECTION_PROVIDER_SCAFFOLD = {
  uk: {
    intro:
      "Ти готуєш вставку підзаголовка перед вибраним фрагментом українського науково-популярного рукопису.",
    bulletListRule: BULLET_LIST_PUNCTUATION_RULE,
    jsonResponseFormat: 'Поверни лише JSON-об\'єкт без іншого markdown: {"title":"..."}.',
    titleRule:
      "title: готовий короткий і точний H3-підзаголовок для вставки в рукопис (plain text, один рядок).",
    noLead:
      "Не повертай lead, вступ, пояснення, редакторський коментар або опис ролі фрагмента.",
    noRewrite: "Не переписуй сам фрагмент і не додавай нових фактів поза контекстом.",
    recommendationLine: (recommendation: string) => `Рекомендація: ${recommendation}`,
    additionalInstructionLine: (instruction: string) => `Додаткова вказівка редактора: ${instruction}`,
    fragmentLine: (excerpt: string) => `Фрагмент: ${excerpt}`
  },
  en: {
    intro: "You are preparing a subhead insertion before the selected fragment in an English popular-science manuscript.",
    bulletListRule: ENGLISH_BULLET_LIST_PUNCTUATION_RULE,
    jsonResponseFormat: 'Return only a JSON object without other markdown: {"title":"..."}.',
    titleRule:
      "title: a ready short, precise H3 subhead for insertion in the manuscript (plain text, one line).",
    noLead: "Do not return lead, intro, explanation, editorial comment, or a description of the fragment's role.",
    noRewrite: "Do not rewrite the fragment itself or add new facts beyond the context.",
    recommendationLine: (recommendation: string) => `Recommendation: ${recommendation}`,
    additionalInstructionLine: (instruction: string) => `Additional editor instruction: ${instruction}`,
    fragmentLine: (excerpt: string) => `Fragment: ${excerpt}`
  }
} as const;

const IMAGE_PROVIDER_SCAFFOLD = {
  uk: {
    fragmentLine: (excerpt: string) => `Фрагмент: ${excerpt}`,
    recommendationLine: (recommendation: string) => `Рекомендація: ${recommendation}`,
    additionalInstructionLine: (instruction: string) => `Додаткова вказівка редактора: ${instruction}`,
    visualIntentLine: (visualIntent: EditorialVisualIntent) => `Тип візуалу: ${visualIntent}`,
    inferredLayoutLine: (label: string) => `Автовибраний формат інфографіки: ${label}.`,
    visualStyleLine: (presetLabel: string, guide: string) => `Обраний стиль (${presetLabel}): ${guide}`,
    visualIntentGuidanceLine: (guidance: string) => `Додаткова вказівка щодо типу візуалу: ${guidance}`,
    responseFormat:
      "Формат відповіді: поверни рівно один готовий image prompt у plain text (один цілісний блок).",
    noJsonMarkdown: "Не повертай JSON, markdown, нумерацію, секції або службові пояснення.",
    languageRule: "Поверни текст тільки українською мовою."
  },
  en: {
    fragmentLine: (excerpt: string) => `Fragment: ${excerpt}`,
    recommendationLine: (recommendation: string) => `Recommendation: ${recommendation}`,
    additionalInstructionLine: (instruction: string) => `Additional editor instruction: ${instruction}`,
    visualIntentLine: (visualIntent: EditorialVisualIntent) => `Visual type: ${visualIntent}`,
    inferredLayoutLine: (label: string) => `Auto-selected infographic format: ${label}.`,
    visualStyleLine: (presetLabel: string, guide: string) => `Selected style (${presetLabel}): ${guide}`,
    visualIntentGuidanceLine: (guidance: string) => `Additional guidance for visual type: ${guidance}`,
    responseFormat:
      "Response format: return exactly one ready image prompt in plain text (one cohesive block).",
    noJsonMarkdown: "Do not return JSON, markdown, numbering, sections, or service explanations.",
    languageRule: "Return text in English only."
  }
} as const;

const INFOGRAPHIC_LAYOUT_LABELS: Record<AppLocale, Record<InfographicLayout, string>> = {
  uk: {
    comparison: "порівняння",
    process: "процес",
    timeline: "таймлайн",
    cause_effect: "причина → наслідок",
    layers: "шари / зріз",
    diagram: "схема зв'язків"
  },
  en: {
    comparison: "comparison",
    process: "process",
    timeline: "timeline",
    cause_effect: "cause → effect",
    layers: "layers / cross-section",
    diagram: "relationship diagram"
  }
};

const INFOGRAPHIC_LAYOUT_GUIDANCE: Record<AppLocale, Record<InfographicLayout, string>> = {
  uk: {
    comparison:
      "Побудуй симетричне порівняння 2 або більше станів в одному масштабі з узгодженими ракурсами та одразу видимою відмінністю.",
    process:
      "Покажи послідовність кроків або фаз у правильному напрямку; перехід між етапами має читатися з першого погляду.",
    timeline: "Побудуй лінію часу з чітким напрямком і короткими етапами без сюжетного шуму.",
    cause_effect:
      "Покажи причинно-наслідковий ланцюг із явними зв'язками між тригером, передачею сигналу й результатом.",
    layers:
      "Покажи шари або зріз структури з чітким розмежуванням рівнів і мінімумом декоративних деталей.",
    diagram:
      "Покажи схему з чіткими відношеннями між елементами; головне має зчитуватися через форму, розташування і підписи."
  },
  en: {
    comparison:
      "Build a symmetric comparison of 2 or more states at one scale with aligned viewpoints and immediately visible difference.",
    process:
      "Show a sequence of steps or phases in the correct direction; transitions between stages should read at a glance.",
    timeline: "Build a timeline with a clear direction and short stages without narrative noise.",
    cause_effect:
      "Show a cause-effect chain with explicit links between trigger, signal transfer, and outcome.",
    layers:
      "Show layers or a structural cross-section with clear level separation and minimal decorative detail.",
    diagram:
      "Show a diagram with clear relationships between elements; the main idea should read through shape, placement, and labels."
  }
};

const VISUAL_INTENT_PROMPT_GUIDANCE = {
  uk: {
    illustration:
      "Побудуй одну цілісну пояснювальну ілюстрацію або сцену без табличної сітки; головну ідею передай через композиційний центр, 1-2 ключові об'єкти й чіткий візуальний акцент.",
    infographicPrefix: (label: string, guidance: string) =>
      `Це інфографіка. Автовибраний формат: ${label}. ${guidance}`
  },
  en: {
    illustration:
      "Build one cohesive explanatory illustration or scene without a table grid; convey the main idea through compositional center, 1-2 key objects, and a clear visual accent.",
    infographicPrefix: (label: string, guidance: string) =>
      `This is an infographic. Auto-selected format: ${label}. ${guidance}`
  }
} as const;

const FALLBACK_CALLOUT_PROMPT = {
  uk: {
    calloutKindLabel: (label: string) => `Тип врізки: ${label}.`,
    calloutDepthLine: (depth: EditorialCalloutDepth) =>
      `Глибина врізки: ${depth === "deep" ? "deep / докладно" : "brief / стисло"}.`,
    fragmentLine: (fragment: string) => `Фрагмент: ${fragment}`,
    recommendationLine: (recommendation: string) => `Рекомендація: ${recommendation}`,
    plainTextRule:
      "Поверни plain text для block editor; можна використовувати контрольований **жирний** для коротких змістових акцентів, а для deep також прості списки."
  },
  en: {
    calloutKindLabel: (label: string) => `Callout type: ${label}.`,
    calloutDepthLine: (depth: EditorialCalloutDepth) =>
      `Callout depth: ${depth === "deep" ? "deep / detailed" : "brief / concise"}.`,
    fragmentLine: (fragment: string) => `Fragment: ${fragment}`,
    recommendationLine: (recommendation: string) => `Recommendation: ${recommendation}`,
    plainTextRule:
      "Return plain text for the block editor; you may use controlled **bold** for short substantive accents, and for deep also simple lists."
  }
} as const;

const FALLBACK_IMAGE_PROMPT = {
  uk: {
    intro: "Створи простий навчальний візуал українською мовою.",
    styleLine: (guide: string) => `Стиль: ${guide}`,
    fragmentLine: (fragment: string) => `Спирайся тільки на цей фрагмент: ${fragment}`,
    editorialGoalLine: (recommendation: string) => `Редакторська ціль: ${recommendation}`,
    constraints: "Без фотореалізму, зайвого декору, медичних кліше та вигаданих фактів."
  },
  en: {
    intro: "Create a simple educational visual in English.",
    styleLine: (guide: string) => `Style: ${guide}`,
    fragmentLine: (fragment: string) => `Rely only on this fragment: ${fragment}`,
    editorialGoalLine: (recommendation: string) => `Editorial goal: ${recommendation}`,
    constraints: "No photorealism, excess decoration, medical clichés, or invented facts."
  }
} as const;

const FACT_CHECK_ACTION_INSTRUCTION = {
  uk: {
    callout: [
      "Це картка, згенерована саме з факт-чеку.",
      "Мета: не дисклеймер і не розмиття тексту, а коротке і предметне пояснення статусу твердження на основі наявних джерел.",
      "Не додавай фрази типу «усе неоднозначно», «не можна робити висновки», «порадьтеся з лікарем», якщо цього немає у вихідному фрагменті.",
      "Формулюй нейтрально і редакторськи: що саме перевірено, чого бракує, як обережно подати це твердження без зайвого страхування."
    ],
    replace: [
      "Це картка, згенерована саме з факт-чеку.",
      "Перепиши локально й конкретно: прибери категоричність або уточни формулювання, але не перетворюй текст на дисклеймер.",
      "Заборонено шаблони на кшталт «потребує обережного тлумачення», «усе неоднозначно», «не можна робити висновки», якщо це прямо не випливає з фактичного рядка.",
      "Ціль: максимально зберегти авторський тон книги, виправивши лише фактологічний ризик у цьому фрагменті."
    ]
  },
  en: {
    callout: [
      "This card was generated specifically from fact-checking.",
      "Goal: not a disclaimer or text blur, but a short, concrete explanation of the claim status based on available sources.",
      'Do not add phrases like "everything is ambiguous", "no conclusions can be drawn", or "consult a doctor" unless the source fragment already contains them.',
      "Write neutrally and editorially: what was checked, what is missing, and how to present the claim cautiously without excess hedging."
    ],
    replace: [
      "This card was generated specifically from fact-checking.",
      "Rewrite locally and concretely: remove certainty or clarify wording, but do not turn the text into a disclaimer.",
      'Forbidden templates include "requires careful interpretation", "everything is ambiguous", or "no conclusions can be drawn" unless they follow directly from the fact-check row.',
      "Goal: preserve the book's authorial tone as much as possible while fixing only the factual risk in this fragment."
    ]
  }
} as const;

function interpolatePromptTemplate(template: string | undefined, replacements: Record<string, string>): string {
  if (!template?.trim()) {
    return "";
  }

  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value.trim()),
    template.trim()
  );
}

function templateContainsPlaceholder(template: string | null | undefined, key: string): boolean {
  return template?.includes(`{{${key}}}`) ?? false;
}

export function inferInfographicLayout(fragment: string, recommendation: string): InfographicLayout {
  const source = `${fragment} ${recommendation}`.toLowerCase();

  if (/(порівня|відмін|різниц|vs|versus|до\/після|before\/after|проти|compar)/i.test(source)) {
    return "comparison";
  }

  if (/(таймлайн|хронолог|у часі|по роках|рок[ауів]?|місяц|тижд|дн(і|я)|фаза|timeline|chronolog)/i.test(source)) {
    return "timeline";
  }

  if (/(крок|послідов|процес|етап|спочатку|далі|потім|шлях|step|sequence|process)/i.test(source)) {
    return "process";
  }

  if (/(причин|наслід|вплив|веде до|виклика|залеж|вісь|cause|effect)/i.test(source)) {
    return "cause_effect";
  }

  if (/(шар|зріз|рівень|епідерм|дерм|бар[’']?єр|мембран|структур|layer|cross-section)/i.test(source)) {
    return "layers";
  }

  return "diagram";
}

export function getInfographicLayoutLabel(locale: AppLocale, layout: InfographicLayout): string {
  return INFOGRAPHIC_LAYOUT_LABELS[locale][layout];
}

export function getInfographicLayoutGuidance(locale: AppLocale, layout: InfographicLayout): string {
  return INFOGRAPHIC_LAYOUT_GUIDANCE[locale][layout];
}

export function getVisualIntentPromptGuidance(
  locale: AppLocale,
  visualIntent: EditorialVisualIntent,
  fragment: string,
  recommendation: string
): string {
  const scaffold = VISUAL_INTENT_PROMPT_GUIDANCE[locale];

  if (visualIntent === "illustration") {
    return scaffold.illustration;
  }

  const layout = inferInfographicLayout(fragment, recommendation);
  return scaffold.infographicPrefix(getInfographicLayoutLabel(locale, layout), getInfographicLayoutGuidance(locale, layout));
}

export interface CalloutProviderPromptParams {
  excerpt: string;
  calloutKind: EditorialCalloutKind;
  calloutDepth: EditorialCalloutDepth;
  recommendation: string;
  editorialInstruction?: string | null;
  calloutPromptTemplate?: string | null;
}

export function buildCalloutProviderPrompt(locale: AppLocale, params: CalloutProviderPromptParams): string {
  const scaffold = CALLOUT_PROVIDER_SCAFFOLD[locale];
  const { excerpt, calloutKind, calloutDepth, recommendation, editorialInstruction, calloutPromptTemplate } = params;
  const template = appendBulletListPunctuationRule(
    interpolatePromptTemplate(calloutPromptTemplate?.trim(), {
      calloutKindLabel: getEditorialCalloutKindLabel(calloutKind, locale),
      calloutDepth,
      calloutDepthLabel: scaffold.calloutDepthLabel(calloutDepth),
      fragment: excerpt,
      recommendation
    }),
    locale
  );

  return [
    template,
    templateContainsPlaceholder(calloutPromptTemplate, "calloutKindLabel")
      ? null
      : scaffold.calloutKindLabel(getEditorialCalloutKindLabel(calloutKind, locale)),
    templateContainsPlaceholder(calloutPromptTemplate, "calloutDepth") ? null : scaffold.calloutDepthLine(calloutDepth),
    templateContainsPlaceholder(calloutPromptTemplate, "calloutDepthLabel")
      ? null
      : scaffold.calloutDepthProfileLine(calloutDepth),
    CALLOUT_DEPTH_PROMPT_GUIDANCE[calloutDepth][locale],
    scaffold.calloutKindDescriptionLine(getEditorialCalloutKindDescription(calloutKind, locale)),
    scaffold.calloutKindGuardrailLine(getCalloutKindGuardrail(calloutKind, locale)),
    calloutKind === "top_list" ? scaffold.topListBodyFormat : null,
    calloutKind === "top_list" ? scaffold.topListMultilineStructure : null,
    templateContainsPlaceholder(calloutPromptTemplate, "fragment") ? null : scaffold.fragmentLine(excerpt),
    templateContainsPlaceholder(calloutPromptTemplate, "recommendation") ? null : scaffold.recommendationLine(recommendation),
    editorialInstruction?.trim() ? scaffold.additionalInstructionLine(editorialInstruction.trim()) : null,
    scaffold.jsonResponseFormat,
    scaffold.jsonSchema,
    scaffold.titleRule,
    calloutDepth === "deep" ? scaffold.bodyRuleDeep : scaffold.bodyRuleBrief,
    calloutDepth === "deep" ? scaffold.boldAccentRuleDeep : scaffold.boldAccentRuleBrief,
    calloutDepth === "deep" ? scaffold.deepListRule : null,
    calloutDepth === "deep" ? scaffold.deepSubheadRule : null,
    scaffold.bodyMarkdownRule
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface SubsectionProviderPromptParams {
  excerpt: string;
  recommendation: string;
  editorialInstruction?: string | null;
}

export function buildSubsectionProviderPrompt(locale: AppLocale, params: SubsectionProviderPromptParams): string {
  const scaffold = SUBSECTION_PROVIDER_SCAFFOLD[locale];
  const { excerpt, recommendation, editorialInstruction } = params;

  return [
    scaffold.intro,
    scaffold.bulletListRule,
    scaffold.jsonResponseFormat,
    scaffold.titleRule,
    scaffold.noLead,
    scaffold.noRewrite,
    scaffold.recommendationLine(recommendation),
    editorialInstruction?.trim() ? scaffold.additionalInstructionLine(editorialInstruction.trim()) : null,
    scaffold.fragmentLine(excerpt)
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface ImageProviderPromptParams {
  excerpt: string;
  recommendation: string;
  visualIntent: EditorialVisualIntent;
  visualStylePreset: VisualStylePreset;
  editorialInstruction?: string | null;
  imagePromptTemplate?: string | null;
}

export function buildImageProviderPrompt(locale: AppLocale, params: ImageProviderPromptParams): string {
  const scaffold = IMAGE_PROVIDER_SCAFFOLD[locale];
  const { excerpt, recommendation, visualIntent, editorialInstruction, imagePromptTemplate } = params;
  const visualStylePreset = normalizeVisualStylePreset(params.visualStylePreset);
  const visualStyleGuide = getVisualStylePresetGuide(visualStylePreset, locale);
  const inferredInfographicLayout =
    visualIntent === "infographic" ? inferInfographicLayout(excerpt, recommendation) : null;
  const template = interpolatePromptTemplate(imagePromptTemplate?.trim(), {
    visualIntent,
    visualStyleGuide,
    fragment: excerpt,
    recommendation
  });

  return [
    template,
    templateContainsPlaceholder(imagePromptTemplate, "fragment") ? null : scaffold.fragmentLine(excerpt),
    templateContainsPlaceholder(imagePromptTemplate, "recommendation") ? null : scaffold.recommendationLine(recommendation),
    editorialInstruction?.trim() ? scaffold.additionalInstructionLine(editorialInstruction.trim()) : null,
    templateContainsPlaceholder(imagePromptTemplate, "visualIntent") ? null : scaffold.visualIntentLine(visualIntent),
    inferredInfographicLayout
      ? scaffold.inferredLayoutLine(getInfographicLayoutLabel(locale, inferredInfographicLayout))
      : null,
    templateContainsPlaceholder(imagePromptTemplate, "visualStyleGuide")
      ? null
      : scaffold.visualStyleLine(getVisualStylePresetLabel(visualStylePreset, locale), visualStyleGuide),
    scaffold.visualIntentGuidanceLine(getVisualIntentPromptGuidance(locale, visualIntent, excerpt, recommendation)),
    scaffold.responseFormat,
    scaffold.noJsonMarkdown,
    scaffold.languageRule
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildFallbackCalloutPrompt(
  locale: AppLocale,
  kind: EditorialCalloutKind,
  depth: EditorialCalloutDepth,
  fragment: string,
  recommendation: string
): string {
  const scaffold = FALLBACK_CALLOUT_PROMPT[locale];

  return [
    scaffold.calloutKindLabel(getEditorialCalloutKindLabel(kind, locale)),
    scaffold.calloutDepthLine(depth),
    CALLOUT_DEPTH_PROMPT_GUIDANCE[depth][locale],
    scaffold.fragmentLine(fragment),
    scaffold.recommendationLine(recommendation),
    scaffold.plainTextRule
  ].join("\n");
}

export function buildFallbackImagePrompt(
  locale: AppLocale,
  fragment: string,
  recommendation: string,
  visualIntent: EditorialVisualIntent,
  visualStyleGuide: string
): string {
  const scaffold = FALLBACK_IMAGE_PROMPT[locale];

  return [
    scaffold.intro,
    getVisualIntentPromptGuidance(locale, visualIntent, fragment, recommendation),
    scaffold.styleLine(visualStyleGuide),
    scaffold.fragmentLine(fragment),
    scaffold.editorialGoalLine(recommendation),
    scaffold.constraints
  ].join(" ");
}

export function buildFactCheckActionInstruction(locale: AppLocale, item: EditorialReviewItem): string | null {
  if (item.stepId !== "fact_check") {
    return null;
  }

  if (item.recommendationType === "callout") {
    return FACT_CHECK_ACTION_INSTRUCTION[locale].callout.join("\n");
  }

  if (isReplaceReviewType(item.recommendationType)) {
    return FACT_CHECK_ACTION_INSTRUCTION[locale].replace.join("\n");
  }

  return null;
}
