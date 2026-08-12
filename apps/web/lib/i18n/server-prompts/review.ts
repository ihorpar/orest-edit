import {
  EDITORIAL_REVIEW_STEP_IDS,
  type EditorialReviewRecommendationType,
  type EditorialReviewStepId
} from "../../editor/review-contract";
import { getDefaultEditorSettings } from "../../editor/settings";
import { getWorkflowStepLabel } from "../editor-messages";
import type { AppLocale } from "../product-locale";

export type ReviewStepOutputKind = "analysis_markdown" | "fact_check_rows" | "recommendation_cards";

export interface ReviewStepSpec {
  id: EditorialReviewStepId;
  title: string;
  outputKind: ReviewStepOutputKind;
  cardGuidance?: string;
  allowedRecommendationTypes?: EditorialReviewRecommendationType[];
  systemInstruction: string;
}

const STEP_OUTPUT_KINDS: Record<EditorialReviewStepId, ReviewStepOutputKind> = {
  diagnostics: "analysis_markdown",
  fact_check: "fact_check_rows",
  structure: "recommendation_cards",
  clarity: "recommendation_cards",
  interest: "recommendation_cards",
  visuals: "recommendation_cards",
  formatting: "recommendation_cards",
  emphasis: "recommendation_cards",
  final_editing: "recommendation_cards"
};

const ALLOWED_RECOMMENDATION_TYPES: Partial<Record<EditorialReviewStepId, EditorialReviewRecommendationType[]>> = {
  structure: ["subsection"],
  clarity: ["simplify", "rewrite", "expand"],
  interest: ["callout", "expand"],
  visuals: ["visual"],
  formatting: ["list", "callout"],
  emphasis: ["rewrite"],
  final_editing: ["rewrite", "simplify", "expand", "list", "subsection", "callout", "visual"]
};

const CARD_GUIDANCE: Record<AppLocale, Partial<Record<EditorialReviewStepId, string>>> = {
  uk: {
    structure:
      "Фокус: лише нові підзаголовки H2/H3 для сканування розділу. Не пропонуй списки, врізки, візуали чи мовне переписування.",
    clarity:
      "Фокус: пояснити складне просто, прибрати перевантажені формулювання, кальки й зайву категоричність, зберегти точність без академічної перевантаженості та без шаблонних застережень.",
    interest:
      "Фокус: інтерес і застосовність через врізки та локальні розгортання (callout, expand). Не пропонуй візуали чи мовне переписування або спрощення.",
    visuals: "Фокус: де і який візуал дає найбільшу користь. Схема вважається підтипом інфографіки.",
    formatting:
      "Фокус: лише списки та врізки (list, callout) для швидкого сканування. Не пропонуй підзаголовки — вони належать кроку «Структура».",
    emphasis:
      "Фокус: точково виділити жирним головну тезу або ключову фразу в абзаці без переписування змісту й без візуального шуму.",
    final_editing:
      "Фокус: виконай власний промпт редактора, але поверни результат тільки як локальні executable-картки. Якщо промпт просить врізки, підзаголовки, списки, переписування або візуали, використовуй відповідні recommendationType."
  },
  en: {
    structure:
      "Focus: only new H2/H3 subheads for scanning the section. Do not propose lists, callouts, visuals, or language rewrites.",
    clarity:
      "Focus: explain complex material simply, remove overloaded wording, calques, and excess certainty while preserving accuracy without academic heaviness or boilerplate disclaimers.",
    interest:
      "Focus: reader interest and applicability via callouts and local expansions (callout, expand). Do not propose visuals or language rewrite/simplify.",
    visuals: "Focus: where and which visual adds the most value. A diagram counts as an infographic subtype.",
    formatting:
      'Focus: lists and callouts only (list, callout) for scan-friendly reading. Do not propose subheads — those belong to the "Structure" step.',
    emphasis:
      "Focus: selectively bold the main thesis or key phrase in a paragraph without rewriting content or adding visual noise.",
    final_editing:
      "Focus: execute the editor's own prompt, but return the result only as local executable cards. If the prompt asks for callouts, subheads, lists, rewrites, or visuals, use the matching recommendationType."
  }
};

const REVIEW_PROMPT_SCAFFOLD = {
  uk: {
    workflowStepPrefix: (title: string) => `Крок workflow: ${title}.`,
    stepFocusPrefix: (guidance: string) => `Окремий фокус кроку: ${guidance}`,
    analysisMode: "Режим роботи: повний редакторський діагноз без карток дій.",
    cardsMode:
      "Режим роботи: повний редакторський прохід у межах цього етапу. Поверни всі сильні локальні рекомендації, які справді допоможуть редактору.",
    analysisMarkdownFormat:
      "Формат відповіді: Markdown, українською мовою, з посиланнями на абзаци у вигляді «абз. NNN».",
    diagnosticsMacroMode:
      "Працюй у режимі макродіагностики великого розділу: спочатку карта структури й читацького маршруту, потім абзаци як докази системних проблем.",
    diagnosticsNoMicroStyle:
      "Для діагностики не підміняй структурний аналіз набором точкових стилістичних зауваг. Локальні фрази використовуй лише як докази макропроблем.",
    diagnosticsStartHeading:
      "Починай відповідь відразу з заголовка «## Головний діагноз розділу». Не починай з фраз на кшталт «Ось діагностика», «Нижче аналіз» або загальних ввідних реверансів.",
    diagnosticsNoPraiseOpening:
      "Не відкривай відповідь похвалою. Якщо текст місцями сильний, назви це коротко лише після того, як уже сформулював головний діагноз і ключові ризики.",
    diagnosticsBeStrict:
      "Будь жорсткішим за замовчуванням: шукай слабку архітектуру розділу, дублювання, провисання логіки, втрату читацького маршруту, редакторську млявість, псевдонауковий або рекламний підтекст і зайві бокові блоки.",
    factCheckJsonFormat: (statusOptions: string) =>
      `Формат відповіді: JSON {"rows":[{"claim":"...","status":"${statusOptions}","explanation":"...","sources":[]}]} без markdown. Якщо немає проблемних або сумнівних тверджень, поверни {"rows":[]}. Ніколи не повертай рядки зі статусом ok.`,
    emphasisJsonFormat:
      'Формат відповіді: JSON {"items":[{"blockId":"точний id блока з документа","excerpt":"...","priority":"high|medium|low","emphasisText":"точний підрядок із документа","occurrence":1}]}. Не повертай title, reason, recommendation або будь-які пояснення.',
    recommendationCardsJsonFormat:
      'Формат відповіді: JSON {"items":[...]} за контрактом рекомендацій. Не додавай будь-який текст поза JSON.',
    recommendationCardsBlockIndexing:
      "Для blockStart і blockEnd використовуй нульову нумерацію рядків документа. Не згадуй block id у title/reason/recommendation.",
    recommendationCardsSingleRange: "Одна картка має охоплювати лише один суцільний діапазон абзаців без розривів.",
    recommendationCardsSubsectionOneAction:
      "Для recommendationType='subsection' одна картка означає рівно одну дію: вставити один новий підзаголовок (H2 або H3) перед одним місцем. Не описуй у межах однієї subsection-картки два або більше майбутніх підзаголовків. Для subsection обов'язково вкажи headingLevel: 2 або 3 і headingTitle — готовий короткий текст підзаголовка для вставки в рукопис.",
    recommendationCardsSplitFragments:
      "Якщо одна проблема є в несуміжних місцях (наприклад 2, 10, 15-17), повертай кілька карток: по одній на кожен окремий суцільний фрагмент.",
    recommendationCardsCalloutKindDepth:
      "Для recommendationType='callout' обов'язково обери calloutKind і calloutDepth. calloutDepth може бути 'brief' або 'deep'; обирай профіль, який найкраще підходить до контексту статті та фрагмента.",
    recommendationCardsCalloutBriefDeep:
      "calloutDepth='brief' означає коротку врізку для швидкого пояснення в 1-2 коротких абзацах. calloutDepth='deep' означає глибокий розбір питання у 3-6 докладних абзацах з внутрішньою структурою.",
    recommendationCardsCalloutPreferDeep:
      "Не обирай brief за замовчуванням. Якщо фрагмент щільний, пояснювальний, вводить механізм, причинно-наслідковий ланцюг, практичні наслідки або потребує розгортання контексту, віддавай перевагу deep.",
    recommendationCardsDeepCalloutStructure:
      "Для deep-callout вимагай структуровану подачу: не суцільне полотно, а 3-6 абзаців із активним використанням **жирного**. Перед частиною абзаців мають з'являтися короткі **якорі-підзаголовки** з 1-3 слів окремим рядком, а всередині тексту - **ключові думки**. Якщо є природне перерахування причин, кроків, наслідків або прикладів, передбач один короткий список.",
    recommendationCardsDeepCalloutNoHtmlHeadings:
      "Для deep-callout не використовуй #, ## або HTML-заголовки. Підзаголовки мають бути оформлені тільки як короткі жирні рядки на кшталт **Чому це важливо**.",
    clarityScope:
      "Для кроку «Ясність» пропонуй лише мовні й локально-структурні правки: спрощення, ущільнення, локальне пом'якшення категоричності, пояснення термінів простішими словами, виправлення кальок і незграбних конструкцій.",
    clarityNoStructure:
      "Для «Ясність» не пропонуй підзаголовки, врізки, таблиці або зміни макроструктури. Працюй лише в межах simplify/rewrite/expand.",
    clarityNoDisclaimers:
      "Не пропонуй шаблонних застережень про консультацію з лікарем, самодіагностику, «варто перевірити стан» або інших повторюваних пересторог, якщо цього прямо не просить редактор і цього немає у фрагменті.",
    structureFocus:
      "Для «Структура» дозволений лише recommendationType='subsection'. Не пропонуй list, callout, visual, rewrite, simplify або expand. Не редагуй і не перейменовуй уже наявні заголовки — лише вставки нових.",
    structureHeadingLevels:
      "Обирай headingLevel=2 для нового смислового розділу глави і headingLevel=3 для дроблення всередині поточного H2. У headingTitle повертай готовий короткий підзаголовок для вставки, а не опис дії. Не копіюй дослівно існуючі заголовки.",
    structureSubsectionSplit:
      "Якщо один великий блок треба розбити на кілька майбутніх підрозділів, поверни кілька окремих subsection-карток: одна картка = один конкретний підзаголовок перед одним місцем вставки.",
    formattingFocus:
      "Для «Форматування» дозволені лише recommendationType='list' та 'callout'. Не пропонуй subsection/підзаголовки, visual, rewrite, simplify або expand. Не пропонуй мовне переписування абзаців як окремий тип правки.",
    interestFocus:
      "Для «Інтерес» дозволені лише recommendationType='callout' та 'expand'. Не пропонуй visual, rewrite, simplify, list або subsection.",
    interestNoVisualRewrite:
      "Не пропонуй візуали (вони належать кроку «Візуали») і не роби мовне переписування заради ясності (це крок «Ясність»). Фокус: практичні приклади, застосовність і врізки, що підсилюють інтерес.",
    emphasisNoRewrite:
      "Для кроку «Акценти» не переписуй текст і не генеруй редакторських пояснень. Повертай лише точні підрядки, які варто виділити жирним.",
    emphasisBlockIdExact:
      "Для кожного item поверни blockId рівно в тому вигляді, як він показаний у квадратних дужках біля відповідного рядка документа.",
    emphasisNotRareExceptions:
      "Це не режим рідкісних винятків. Багато змістовних абзаців можуть потребувати акценту; пропускай лише справді службові, тривіальні або вже достатньо добре підсвічені абзаци.",
    emphasisDenseFinalPass:
      "Працюй як щільний фінальний прохід: майже кожен змістовний абзац із самостійною тезою має отримати один короткий акцент, якщо він ще не виділений жирним.",
    emphasisNoWholeSentences:
      "Заборонено виділяти цілі речення, більшу частину абзацу, перші слова абзацу без смислової ваги або декоративні фрази. Мета - короткі смислові вузли, а не форматувальний шум.",
    idsInBracketsRule:
      "IDs у квадратних дужках призначені лише для прив'язки і не мають з'являтися в user-facing тексті.",
    cardDensityEmptyDoc:
      "Орієнтир за кількістю карток: документ майже порожній, тому поверни картки лише якщо є реальна локальна дія.",
    cardDensityTarget: (minCards: number, maxCards: number, meaningfulBlocks: number, totalChars: number) =>
      `М'який орієнтир за кількістю карток: приблизно ${minCards}-${maxCards} на ${meaningfulBlocks} змістовних блоків і ${totalChars} знаків.`,
    cardDensitySoftTargetTail:
      "Це не квота і не максимум. Якщо корисних локальних дій більше, поверни більше карток; якщо сильних дій менше, не добирай слабкі або дубльовані ідеї.",
    cardDensityPreferStrongCards:
      "Краще дати редактору трохи більше сильних карток, ніж промовчати про корисні правки, бо частину карток редактор відхилить.",
    emphasisCoverageTarget: (minItems: number, maxItems: number, eligibleBlocks: number) =>
      `М'який орієнтир для цього документа: приблизно ${minItems}-${maxItems} акцентів на ${eligibleBlocks} змістовних абзаців/заголовків. Це не жорстка квота, але слід покривати значну частину змістовного тексту, а не повертати лише поодинокі акценти. Краще повернути доречний короткий акцент для кожного сильного абзацу, ніж залишити добрі тези без виділення.`,
    blockLinePrefix: (index: number, label: string, blockId: string, text: string) =>
      `${index}. абз. ${label} [${blockId}] ${text}`,
    historyUserRole: "КОРИСТУВАЧ",
    historyAssistantRole: "АСИСТЕНТ",
    diagnosticsContextPrefix: "Контекст діагностики:",
    diagnosticsFeedbackPrefix: "Фідбек користувача до діагностики:",
    stepFeedbackPrefix: (title: string) => `Фідбек користувача для кроку «${title}»:`,
    dialogueContextPrefix: "Релевантний контекст діалогу:",
    additionalInstructionsPrefix: "Додаткові інструкції редактора:",
    finalEditingCustomPromptPrefix: "Власний промпт редактора для цього запуску:",
    finalEditingExecuteAsCards:
      "Виконай саме власний промпт редактора, але не редагуй документ напряму. Поверни результат як набір локальних карток за стандартним recommendation-card контрактом.",
    diagnosticsRubric:
      "Зроби сувору макродіагностику за рубрикою: головний діагноз розділу, карта розділу, ключові структурні проблеми, де потрібні підрозділи, що зайве або дубльоване, показові абзаци і пріоритетний план перебудови.",
    diagnosticsHeadings:
      "Використовуй саме такі markdown-заголовки другого рівня: «## Головний діагноз розділу», «## Карта розділу», «## Ключові структурні проблеми», «## Де потрібні підрозділи», «## Що зайве або дубльоване», «## Показові абзаци», «## Пріоритетний план перебудови».",
    diagnosticsSectionMap:
      "У блоці «Карта розділу» покрий увесь документ великими смисловими зонами без пропусків; кожен абзац має належати рівно одній зоні.",
    diagnosticsExemplarParagraphs:
      "У блоці «Показові абзаци» розбирай 8-15 найпоказовіших абзаців як докази великих проблем. Для кожного абзацу поясни, яку саме системну поломку він доводить.",
    factCheckFocus:
      "Не перевіряй і не перераховуй усе підряд. Твоя задача - знайти тільки твердження, які редактор має поставити під сумнів: застаріла або радянська медична рамка, слабка доказовість, надто категоричний причинно-наслідковий висновок, лікувальна або профілактична обіцянка, конкретні числа, відсотки, дозування, тривалість, ризики, лабораторні пороги або підозрілі одиниці вимірювання. Коректні або несуттєві твердження пропускай мовчки.",
    factCheckEvidenceStandards:
      "Оцінюй за стандартами сучасної доказової медицини: актуальні клінічні настанови, систематичні огляди, баланс користі й шкоди, якість доказів, невизначеність. Не покладайся на авторитетність тону рукопису.",
    factCheckExplanationRules:
      "Для кожного рядка поясни, що саме насторожує і яку перевірку треба зробити. Не вигадуй джерела, DOI, авторів, роки або URL і не вставляй посилання всередину explanation.",
    recommendationCardsFromDiagnostics:
      "На основі діагностики і фідбеку підготуй локальні картки змін саме для цього кроку. Не переписуй документ цілком.",
    recommendationCardsCalloutDepthChoice:
      "Якщо пропонуєш врізку, самостійно обери calloutDepth='brief' або calloutDepth='deep' відповідно до контексту статті та фрагмента.",
    clarityPreserveListStructure:
      "Якщо фрагмент уже подано як перелік або серію коротких пунктів, збережи короткі окремі пункти; не роздувай кожен рядок у довгий абзац.",
    emphasisCheckEachParagraph:
      "Перевір кожен абзац документа по черзі. Якщо акцент справді покращує діагональне читання, повертай item; якщо ні - просто пропускай абзац.",
    emphasisBlockIdRequired:
      "У кожному item обов'язково поверни blockId саме того рядка, де міститься emphasisText. Не використовуй сусідній blockId навіть якщо абзаци тематично схожі.",
    emphasisOneItemPerParagraph:
      "Для кроку «Акценти» створюй не більше одного item на абзац. У emphasisText повертай точний підрядок із документа без перефразування, без нового змісту і без уже наявного жирного виділення.",
    emphasisCoveragePrefix: "Орієнтир покриття:",
    emphasisOccurrenceHint:
      "Якщо той самий exact substring трапляється в абзаці кілька разів, додай occurrence: 1, 2, 3... щоб позначити потрібний збіг.",
    emphasisNotTooSparse:
      "Не будь надто скупим: якщо в абзаці є чітка теза, висновок, причинно-наслідковий вузол, практичний висновок або сильний контраст, який справді варто зчитати за 10-15 секунд, повертай item.",
    emphasisSkipOnlyWhen:
      "Пропускай змістовний абзац лише тоді, коли в ньому немає жодної самостійної тези або він уже має достатньо жирного виділення. Не обмежуйся кількома найочевиднішими місцями.",
    rejectedIdeasHeader: "Ідеї, які редактор уже відхилив:",
    rejectedIdeaLine: (index: number, blockLabels: string, recommendationType: string, recommendation: string) =>
      `${index}. Блоки: ${blockLabels}; тип: ${recommendationType}; рекомендація: ${recommendation}`,
    rejectedIdeasFooter:
      "Не повторюй ці ідеї як нові рекомендації. Не пропонуй той самий зміст іншими словами. Можеш повернутися до цих блоків лише якщо пропозиція має інший recommendationType або вирішує іншу проблему.",
    paragraphLabel: (blockIndex: number) => `абз. ${String(blockIndex + 1).padStart(3, "0")}`,
    documentLabel: "Документ:"
  },
  en: {
    workflowStepPrefix: (title: string) => `Workflow step: ${title}.`,
    stepFocusPrefix: (guidance: string) => `Step-specific focus: ${guidance}`,
    analysisMode: "Work mode: full editorial diagnosis without action cards.",
    cardsMode:
      "Work mode: full editorial pass within this step. Return every strong local recommendation that will genuinely help the editor.",
    analysisMarkdownFormat:
      'Response format: Markdown in English, with paragraph references in the form "para. NNN".',
    diagnosticsMacroMode:
      "Work in macro-diagnostics mode for a long section: first map structure and reader journey, then use paragraphs as evidence of systemic problems.",
    diagnosticsNoMicroStyle:
      "For diagnostics, do not replace structural analysis with a set of pointwise stylistic notes. Use local phrases only as evidence of macro problems.",
    diagnosticsStartHeading:
      'Start the response immediately with the heading "## Main structural diagnosis". Do not start with phrases like "Here is the diagnosis", "Below is the analysis", or other generic openings.',
    diagnosticsNoPraiseOpening:
      "Do not open with praise. If the text is strong in places, mention that briefly only after you have already stated the main diagnosis and key risks.",
    diagnosticsBeStrict:
      "Be stricter by default: look for weak section architecture, duplication, sagging logic, loss of reader route, editorial flatness, pseudo-scientific or promotional subtext, and unnecessary side blocks.",
    factCheckJsonFormat: (statusOptions: string) =>
      `Response format: JSON {"rows":[{"claim":"...","status":"${statusOptions}","explanation":"...","sources":[]}]} without markdown. If there are no problematic or questionable claims, return {"rows":[]}. Never return rows with status ok.`,
    emphasisJsonFormat:
      'Response format: JSON {"items":[{"blockId":"exact block id from the document","excerpt":"...","priority":"high|medium|low","emphasisText":"exact substring from the document","occurrence":1}]}. Do not return title, reason, recommendation, or any explanations.',
    recommendationCardsJsonFormat:
      'Response format: JSON {"items":[...]} per the recommendation contract. Do not add any text outside JSON.',
    recommendationCardsBlockIndexing:
      "For blockStart and blockEnd, use zero-based document row numbering. Do not mention block id in title/reason/recommendation.",
    recommendationCardsSingleRange: "One card must cover only one contiguous paragraph range without gaps.",
    recommendationCardsSubsectionOneAction:
      "For recommendationType='subsection', one card means exactly one action: insert one new subhead (H2 or H3) before one location. Do not describe two or more future subheads within one subsection card. For subsection, always set headingLevel: 2 or 3 and headingTitle — the ready short subhead text to insert into the manuscript.",
    recommendationCardsSplitFragments:
      "If one problem appears in non-adjacent places (for example 2, 10, 15-17), return multiple cards: one per separate contiguous fragment.",
    recommendationCardsCalloutKindDepth:
      "For recommendationType='callout', you must choose calloutKind and calloutDepth. calloutDepth may be 'brief' or 'deep'; choose the profile that best fits the article context and fragment.",
    recommendationCardsCalloutBriefDeep:
      "calloutDepth='brief' means a short callout for a quick explanation in 1-2 short paragraphs. calloutDepth='deep' means a deep dive in 3-6 detailed paragraphs with internal structure.",
    recommendationCardsCalloutPreferDeep:
      "Do not default to brief. If the fragment is dense, explanatory, introduces a mechanism, cause-effect chain, practical consequences, or needs more context, prefer deep.",
    recommendationCardsDeepCalloutStructure:
      "For deep callouts, require structured delivery: not a solid slab, but 3-6 paragraphs with active use of **bold**. Before some paragraphs, add short **anchor subheads** of 1-3 words on their own line, and inside the text highlight **key ideas**. If there is a natural list of causes, steps, effects, or examples, include one short list.",
    recommendationCardsDeepCalloutNoHtmlHeadings:
      'For deep callouts, do not use #, ##, or HTML headings. Subheads must be formatted only as short bold lines such as **Why this matters**.',
    clarityScope:
      'For the "Clarity" step, propose only language and local-structural edits: simplification, tightening, local softening of certainty, explaining terms in simpler words, and fixing calques and awkward constructions.',
    clarityNoStructure:
      'For "Clarity", do not propose subheads, callouts, tables, or macro-structure changes. Work only within simplify/rewrite/expand.',
    clarityNoDisclaimers:
      "Do not propose boilerplate warnings about consulting a doctor, self-diagnosis, 'worth checking your condition', or other repeated cautions unless the editor explicitly asks for them or the fragment already contains them.",
    structureFocus:
      'For "Structure", only recommendationType=\'subsection\' is allowed. Do not propose list, callout, visual, rewrite, simplify, or expand. Do not edit or rename existing headings — insert new ones only.',
    structureHeadingLevels:
      "Choose headingLevel=2 for a new major chapter section and headingLevel=3 for splitting inside the current H2. In headingTitle return a ready short subhead for insertion, not an action description. Do not copy existing headings verbatim.",
    structureSubsectionSplit:
      "If one large block should be split into several future subsections, return several separate subsection cards: one card = one specific subhead before one insertion point.",
    formattingFocus:
      'For "Formatting", only recommendationType=\'list\' and \'callout\' are allowed. Do not propose subsection/subheads, visual, rewrite, simplify, or expand. Do not propose language rewrites of paragraphs as a separate edit type.',
    interestFocus:
      'For "Interest", only recommendationType=\'callout\' and \'expand\' are allowed. Do not propose visual, rewrite, simplify, list, or subsection.',
    interestNoVisualRewrite:
      'Do not propose visuals (they belong to the "Visuals" step) and do not do language rewrites for clarity (that is the "Clarity" step). Focus on practical examples, applicability, and callouts that strengthen interest.',
    emphasisNoRewrite:
      'For the "Emphasis" step, do not rewrite text or generate editorial explanations. Return only exact substrings that should be bolded.',
    emphasisBlockIdExact:
      "For each item, return blockId exactly as shown in square brackets beside the corresponding document row.",
    emphasisNotRareExceptions:
      "This is not a rare-exception mode. Many substantive paragraphs may need emphasis; skip only truly service, trivial, or already well-highlighted paragraphs.",
    emphasisDenseFinalPass:
      "Work as a dense final pass: almost every substantive paragraph with its own thesis should get one short accent if it is not already bolded.",
    emphasisNoWholeSentences:
      "Do not bold whole sentences, most of a paragraph, opening words without semantic weight, or decorative phrases. The goal is short semantic nodes, not formatting noise.",
    idsInBracketsRule:
      "IDs in square brackets are for anchoring only and must not appear in user-facing text.",
    cardDensityEmptyDoc:
      "Card-count guidance: the document is nearly empty, so return cards only if there is a real local action.",
    cardDensityTarget: (minCards: number, maxCards: number, meaningfulBlocks: number, totalChars: number) =>
      `Soft card-count guidance: roughly ${minCards}-${maxCards} for ${meaningfulBlocks} substantive blocks and ${totalChars} characters.`,
    cardDensitySoftTargetTail:
      "This is not a quota or maximum. If there are more useful local actions, return more cards; if there are fewer strong actions, do not pad with weak or duplicate ideas.",
    cardDensityPreferStrongCards:
      "It is better to give the editor a few more strong cards than to stay silent about useful edits, because the editor will reject some cards anyway.",
    emphasisCoverageTarget: (minItems: number, maxItems: number, eligibleBlocks: number) =>
      `Soft guidance for this document: roughly ${minItems}-${maxItems} accents for ${eligibleBlocks} substantive paragraphs/headings. This is not a hard quota, but you should cover a substantial share of substantive text rather than returning only isolated accents. It is better to return a fitting short accent for each strong paragraph than to leave good theses unhighlighted.`,
    blockLinePrefix: (index: number, label: string, blockId: string, text: string) =>
      `${index}. para. ${label} [${blockId}] ${text}`,
    historyUserRole: "USER",
    historyAssistantRole: "ASSISTANT",
    diagnosticsContextPrefix: "Diagnostics context:",
    diagnosticsFeedbackPrefix: "User feedback on diagnostics:",
    stepFeedbackPrefix: (title: string) => `User feedback for step "${title}":`,
    dialogueContextPrefix: "Relevant dialogue context:",
    additionalInstructionsPrefix: "Additional editor instructions:",
    finalEditingCustomPromptPrefix: "Editor custom prompt for this run:",
    finalEditingExecuteAsCards:
      "Execute the editor's own prompt, but do not edit the document directly. Return the result as a set of local cards per the standard recommendation-card contract.",
    diagnosticsRubric:
      "Run a strict macro-diagnosis using this rubric: main structural diagnosis, section map, key structural problems, where subsections are needed, what is redundant or duplicated, exemplar paragraphs, and priority rebuild plan.",
    diagnosticsHeadings:
      'Use exactly these level-2 markdown headings: "## Main structural diagnosis", "## Section map", "## Key structural problems", "## Where subsections are needed", "## What is redundant or duplicated", "## Exemplar paragraphs", "## Priority rebuild plan".',
    diagnosticsSectionMap:
      'In the "Section map" block, cover the whole document with large semantic zones without gaps; each paragraph must belong to exactly one zone.',
    diagnosticsExemplarParagraphs:
      'In the "Exemplar paragraphs" block, analyze 8-15 of the most telling paragraphs as evidence of major problems. For each paragraph, explain which systemic failure it proves.',
    factCheckFocus:
      "Do not check or list everything. Your task is to find only claims the editor should question: outdated or Soviet-era medical framing, weak evidence, overly categorical cause-effect conclusions, treatment or prevention promises, specific numbers, percentages, dosages, durations, risks, lab thresholds, or suspicious units. Skip correct or insignificant claims silently.",
    factCheckEvidenceStandards:
      "Evaluate against modern evidence-based medicine: current clinical guidelines, systematic reviews, benefit-harm balance, evidence quality, and uncertainty. Do not rely on the manuscript's tone of authority.",
    factCheckExplanationRules:
      "For each row, explain what is concerning and what verification is needed. Do not invent sources, DOIs, authors, years, or URLs, and do not insert links inside explanation.",
    recommendationCardsFromDiagnostics:
      "Based on diagnostics and feedback, prepare local change cards for this step only. Do not rewrite the whole document.",
    recommendationCardsCalloutDepthChoice:
      "If you propose a callout, choose calloutDepth='brief' or calloutDepth='deep' yourself according to article context and fragment.",
    clarityPreserveListStructure:
      "If the fragment is already presented as a list or series of short points, keep short separate points; do not inflate each line into a long paragraph.",
    emphasisCheckEachParagraph:
      "Check each document paragraph in order. If emphasis genuinely improves diagonal reading, return an item; otherwise skip the paragraph.",
    emphasisBlockIdRequired:
      "In each item, you must return the blockId of the row that contains emphasisText. Do not use a neighboring blockId even if paragraphs are thematically similar.",
    emphasisOneItemPerParagraph:
      'For the "Emphasis" step, create at most one item per paragraph. In emphasisText, return the exact substring from the document without rephrasing, without new content, and without already-bold text.',
    emphasisCoveragePrefix: "Coverage guidance:",
    emphasisOccurrenceHint:
      "If the same exact substring appears multiple times in a paragraph, add occurrence: 1, 2, 3... to mark the needed match.",
    emphasisNotTooSparse:
      "Do not be too sparse: if a paragraph has a clear thesis, conclusion, cause-effect node, practical takeaway, or strong contrast worth scanning in 10-15 seconds, return an item.",
    emphasisSkipOnlyWhen:
      "Skip a substantive paragraph only when it has no independent thesis or already has enough bold highlighting. Do not limit yourself to a few obvious spots.",
    rejectedIdeasHeader: "Ideas the editor has already rejected:",
    rejectedIdeaLine: (index: number, blockLabels: string, recommendationType: string, recommendation: string) =>
      `${index}. Blocks: ${blockLabels}; type: ${recommendationType}; recommendation: ${recommendation}`,
    rejectedIdeasFooter:
      "Do not repeat these ideas as new recommendations. Do not propose the same content in different words. You may return to these blocks only if the proposal has a different recommendationType or solves a different problem.",
    paragraphLabel: (blockIndex: number) => `para. ${String(blockIndex + 1).padStart(3, "0")}`,
    documentLabel: "Document:"
  }
} as const;

const REVIEW_SERVICE_ERRORS = {
  uk: {
    emptyDocument: "Документ порожній. Немає що аналізувати.",
    missingApiKey: (providerName: string) => `Немає API key для ${providerName} у формі або .env.`,
    providerUnavailable: (providerName: string) => `${providerName} недоступний.`,
    unknownProviderError: "Невідома помилка провайдера.",
    invalidProviderJson: (providerName: string) => `${providerName} не повернув коректний JSON.`,
    geminiGroundingUnavailable: "Gemini grounding недоступний.",
    geminiGroundedFactCheckEmpty: "Gemini не повернув текст для grounded fact-check."
  },
  en: {
    emptyDocument: "The document is empty. There is nothing to analyze.",
    missingApiKey: (providerName: string) => `No API key for ${providerName} in the form or .env.`,
    providerUnavailable: (providerName: string) => `${providerName} is unavailable.`,
    unknownProviderError: "Unknown provider error.",
    invalidProviderJson: (providerName: string) => `${providerName} did not return valid JSON.`,
    geminiGroundingUnavailable: "Gemini grounding is unavailable.",
    geminiGroundedFactCheckEmpty: "Gemini returned no text for grounded fact-check."
  }
} as const;

const OPENAI_FACT_CHECK_STATUS_ENUM = {
  uk: ["сумнівно", "не підтверджено"] as const,
  en: ["questionable", "unsupported"] as const
} as const;

export function resolveReviewLocale(request: { locale?: AppLocale }): AppLocale {
  return request.locale ?? "uk";
}

export function isEditorialReviewStepId(stepId: string): stepId is EditorialReviewStepId {
  return EDITORIAL_REVIEW_STEP_IDS.includes(stepId as EditorialReviewStepId);
}

export function getReviewStepSpec(stepId: EditorialReviewStepId, locale: AppLocale): ReviewStepSpec {
  const settings = getDefaultEditorSettings(locale);

  return {
    id: stepId,
    title: getWorkflowStepLabel(locale, stepId),
    outputKind: STEP_OUTPUT_KINDS[stepId],
    cardGuidance: CARD_GUIDANCE[locale][stepId],
    allowedRecommendationTypes: ALLOWED_RECOMMENDATION_TYPES[stepId],
    systemInstruction: settings.workflowStepPrompts[stepId]
  };
}

export function getReviewServiceErrors(locale: AppLocale) {
  return REVIEW_SERVICE_ERRORS[locale];
}

export function getReviewPromptScaffold(locale: AppLocale) {
  return REVIEW_PROMPT_SCAFFOLD[locale];
}

export function getOpenAiFactCheckStatusEnum(locale: AppLocale): readonly string[] {
  return OPENAI_FACT_CHECK_STATUS_ENUM[locale];
}

export function buildChunkedEmphasisFailureMessage(
  locale: AppLocale,
  input: {
    error: unknown;
    chunkIndex: number;
    totalChunks: number;
    attemptCount: number;
  }
): string {
  const errors = REVIEW_SERVICE_ERRORS[locale];
  const detail =
    input.error instanceof Error && input.error.message.trim()
      ? input.error.message.trim()
      : errors.unknownProviderError;

  if (locale === "en") {
    return `Emphasis: failure on chunk ${input.chunkIndex + 1}/${input.totalChunks} after ${input.attemptCount} attempts. ${detail}`;
  }

  return `Акценти: збій на chunk ${input.chunkIndex + 1}/${input.totalChunks} після ${input.attemptCount} спроб. ${detail}`;
}

export function getOpenAiFactCheckSchema(locale: AppLocale) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claim: { type: "string" },
            status: { type: "string", enum: [...getOpenAiFactCheckStatusEnum(locale)] },
            explanation: { type: "string" },
            sources: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  domain: { type: "string" }
                },
                required: ["title", "url", "domain"]
              }
            }
          },
          required: ["claim", "status", "explanation", "sources"]
        }
      }
    },
    required: ["rows"]
  } as const;
}

const ANTHROPIC_SYSTEM_SUFFIX = {
  uk: {
    analysisMarkdown: "Дай розлогий критичний аналіз тексту.",
    emphasisJson:
      "Поверни лише JSON-об'єкт без markdown, без reason/title/recommendation і без будь-яких пояснень поза JSON.",
    defaultJson: "Поверни лише JSON-об'єкт без markdown і без пояснень поза JSON."
  },
  en: {
    analysisMarkdown: "Give a thorough critical analysis of the text.",
    emphasisJson:
      "Return only a JSON object without markdown, without reason/title/recommendation, and without any explanation outside JSON.",
    defaultJson: "Return only a JSON object without markdown and without any explanation outside JSON."
  }
} as const;

const GEMINI_GROUNDED_FACT_CHECK_SUFFIX = {
  uk: (domains: readonly string[]) =>
    [
      "Працюй лише як фактчекер. Не вставляй URL, DOI або назви джерел у поле explanation.",
      "Формуй web search queries англійською мовою, навіть якщо вхідний текст українською.",
      `Використовуй лише надійні медичні джерела: ${domains.join(", ")}.`,
      "Якщо для твердження не знайдено надійного джерела з цього списку, залишай sources порожнім масивом.",
      "Поверни лише JSON за схемою rows[]."
    ].join("\n\n"),
  en: (domains: readonly string[]) =>
    [
      "Work only as a fact-checker. Do not put URLs, DOIs, or source titles into the explanation field.",
      "Form web search queries in English, even when the input text is Ukrainian.",
      `Use only trusted medical sources: ${domains.join(", ")}.`,
      "If no trusted source from this list is found for a claim, leave sources as an empty array.",
      "Return only JSON matching the rows[] schema."
    ].join("\n\n")
} as const;

export function getAnthropicSystemPromptSuffix(stepSpec: ReviewStepSpec, locale: AppLocale): string {
  const suffix = ANTHROPIC_SYSTEM_SUFFIX[locale];

  if (stepSpec.outputKind === "analysis_markdown") {
    return suffix.analysisMarkdown;
  }

  if (stepSpec.id === "emphasis") {
    return suffix.emphasisJson;
  }

  return suffix.defaultJson;
}

export function getGeminiGroundedFactCheckSystemSuffix(locale: AppLocale, trustedDomains: readonly string[]): string {
  return GEMINI_GROUNDED_FACT_CHECK_SUFFIX[locale](trustedDomains);
}
