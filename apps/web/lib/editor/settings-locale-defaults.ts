import type { EditorialReviewStepId, VisualStylePreset } from "./review-contract";
import type { AppLocale } from "../i18n/product-locale";
import type { ProviderId, ProviderModelPreset } from "./settings";

export interface LocaleEditorDefaults {
  basePrompt: string;
  reviewPrompt: string;
  expertisePrompt: string;
  cardsPrompt: string;
  reviewLevelGuide: string;
  workflowStepPrompts: Record<EditorialReviewStepId, string>;
  calloutPromptTemplate: string;
  imagePromptTemplate: string;
}

export const ENGLISH_EDITOR_DEFAULTS: LocaleEditorDefaults = {
  basePrompt:
    "You are editing an English science-pop or medical-pop manuscript. Rewrite dense scientific language into clear, natural English without changing meaning or author intent. Work locally inside the selected fragment only. Priorities: explain terms for a broad reader without distorting facts, simplify overloaded sentences without losing logic, and keep the tone precise, calm, and editorial. Do not add new facts, marketing claims, generic medical disclaimers, self-diagnosis advice, or instructions to consult a doctor unless the editor explicitly asks for them or the source already contains them.",
  reviewPrompt:
    "Generate concrete, local, executable editorial recommendations in English. Keep every recommendation tied to a contiguous paragraph range and prefer patch-first, diff-first changes over broad rewrites.",
  expertisePrompt:
    "Work in macro-diagnostics mode for a long section as a strict book editor. Do not reassure the author or open with praise. Anchor critical notes to paragraph references (para. NNN). Focus on section architecture, reader route, duplication, sagging logic, and unnecessary side blocks—not micro-style nits. Write natural English markdown. Follow the required headings and rubric from this run's system instructions (diagnostics depth mode). Start immediately with '## Main structural diagnosis'. Do not invent facts, medical advice, disclaimers, JSON, or action cards.",
  cardsPrompt:
    "Generate concrete local editorial recommendation cards in English from the diagnostics context. Keep one card focused on one contiguous paragraph range. For callouts, propose both global frames not yet in this text (put the new value in recommendation) and local lifts of dense fragments. Use stable internal enums for recommendationType, suggestedAction, insertionHint, calloutKind, calloutDepth, and visualIntent. Prefer deep callouts for dense explanatory fragments and avoid generic medical disclaimer language.",
  reviewLevelGuide:
    "Level 1: light cleanup. Level 2: modest tightening. Level 3: strong local editing. Level 4: deep restructuring of weak areas. Level 5: radical local redesign when it clearly improves readability.",
  workflowStepPrompts: {
    diagnostics:
      "Diagnose the chapter as a whole: structure, reader flow, redundancy, and missing subheads. Output markdown only; depth mode controls section length.",
    fact_check:
      "Return only red-flag fact-check rows. Surface questionable or unsupported claims, weak numbers, or missing support. Do not return reassuring OK rows.",
    structure:
      "Add only new H2/H3 subheads to improve section scanning. Do not propose lists, callouts, or rewrites. Do not edit existing headings.",
    clarity:
      "Focus on clarity, simpler phrasing, cleaner syntax, and removing overloaded scientific wording while preserving accuracy.",
    interest:
      "Focus on reader interest: both global callouts with a frame this text still lacks, and local callouts that lift a dense fragment into a box, plus expansions. Do not propose visuals or language rewrites.",
    visuals:
      "Focus only on useful visuals. Recommend infographics or illustrations only where they materially improve understanding.",
    formatting:
      "Focus on lists and callouts. Callouts may restructure a fragment or add a reader frame this text still lacks. Do not propose subheads — those belong to Structure.",
    emphasis:
      "Focus only on inline emphasis. Suggest short bold accents for the key idea inside a paragraph without rewriting the paragraph.",
    final_editing:
      "Execute the editor's own request, but return the result only as local executable recommendation cards (rewrites, lists, subheads, callouts, or visuals). Do not generate emphasis accents."
  },
  calloutPromptTemplate:
    "Create a callout draft for an English science-pop or medical-pop manuscript. Callout kind: {{calloutKindLabel}}. Depth: {{calloutDepthLabel}}. Execute the card recommendation. The fragment is the insert point or local source, not text to paraphrase if the card already carries a new reader frame. Two modes, set by the recommendation: (1) turn this fragment into a callout — restructure its content; (2) add a callout beside it — write the value from recommendation that is not already in this paragraph. Do not invent ungrounded medical claims (studies, doses, percentages, brands, diagnoses) unless the editor explicitly asks for that extra content. A one-sentence paraphrase of a dense fragment is a failure. Return JSON {\"title\":\"...\",\"body\":\"...\"} only. Context: {{fragment}}. Recommendation: {{recommendation}}.",
  imagePromptTemplate:
    "Write one ready-to-send English image-generation prompt. Use only these inputs: visualIntent={{visualIntent}}, visualStyleGuide={{visualStyleGuide}}, fragment={{fragment}}, recommendation={{recommendation}}. Return one plain-text prompt only. If the image needs labels, write them in English."
};

const ENGLISH_VISUAL_STYLE_PRESET_LABELS: Record<VisualStylePreset, string> = {
  minimal: "Minimal",
  calm_gradient: "Calm gradient",
  neo_brutal: "Neo-brutal",
  modern_glass: "Modern glass"
};

const ENGLISH_VISUAL_STYLE_PRESET_GUIDES: Record<VisualStylePreset, string> = {
  minimal:
    "Strict editorial minimalism: generous whitespace, clear grid, flat shapes, thin outlines, two to three restrained colors, high readability, no decorative effects.",
  calm_gradient:
    "Calm modern presentation: soft controlled gradients, clean background, smooth tonal transitions, clear hierarchy, low visual noise.",
  neo_brutal:
    "Neo-brutal infographic style: high-contrast flat color blocks, bold geometry, strong edges, hard composition, minimal detail, strong content focus.",
  modern_glass:
    "Minimal liquid-glass aesthetic: translucent layers, soft blur, delicate lit gradients, readable glass panels, clarity first."
};

const ENGLISH_PROVIDER_MODEL_DESCRIPTIONS: Record<ProviderId, Record<string, string>> = {
  openai: {
    "gpt-5.6-sol": "Strongest OpenAI profile (medium reasoning) for demanding editorial review and precise local revisions.",
    "gpt-5.6-luna": "Fast, high-quality OpenAI profile with high reasoning for complex local revisions and editorial review.",
    "gpt-5.6-luna-low": "Cheapest OpenAI profile with low reasoning for lighter edits and rougher drafting passes."
  },
  anthropic: {
    "claude-opus-4-6": "Best Anthropic option for deep editorial analysis and careful rewriting of dense fragments.",
    "claude-sonnet-4-6": "Balanced quality, speed, and cost for everyday editorial work.",
    "claude-haiku-4-5": "Fastest option for rough passes and larger batches of local checks."
  },
  gemini: {
    "gemini-3.7-flash": "Latest fast Google model with high thinking for editorial review and harder edits.",
    "gemini-3.5-flash-lite": "Cheaper production-oriented option with high thinking for everyday patch requests."
  }
};

export function getLocaleEditorDefaults(locale: AppLocale): LocaleEditorDefaults | null {
  return locale === "en" ? ENGLISH_EDITOR_DEFAULTS : null;
}

export function getLocalizedVisualStylePresetLabels(locale: AppLocale): Record<VisualStylePreset, string> | null {
  return locale === "en" ? ENGLISH_VISUAL_STYLE_PRESET_LABELS : null;
}

export function getLocalizedVisualStylePresetGuides(locale: AppLocale): Record<VisualStylePreset, string> | null {
  return locale === "en" ? ENGLISH_VISUAL_STYLE_PRESET_GUIDES : null;
}

export function localizeProviderModelPresets(
  presets: ProviderModelPreset[],
  provider: ProviderId,
  locale: AppLocale
): ProviderModelPreset[] {
  if (locale !== "en") {
    return presets;
  }

  const localizedDescriptions = ENGLISH_PROVIDER_MODEL_DESCRIPTIONS[provider];

  return presets.map((preset) => ({
    ...preset,
    description: localizedDescriptions[preset.id] ?? preset.description
  }));
}
