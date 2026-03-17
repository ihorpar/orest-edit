import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_EDITOR_DOCUMENT } from "../apps/web/lib/editor/default-manuscript.ts";
import { deriveManuscriptRevisionState, computeAnchorFingerprint } from "../apps/web/lib/editor/manuscript-structure.ts";
import { getBlockText, type Block } from "../apps/web/lib/editor/document-model.ts";
import {
  DEFAULT_BASE_PROMPT,
  DEFAULT_CALLOUT_PROMPT_TEMPLATE,
  DEFAULT_CARDS_PROMPT,
  DEFAULT_EXPERTISE_PROMPT,
  DEFAULT_REVIEW_LEVEL_GUIDE,
  getDefaultProviderModelId
} from "../apps/web/lib/editor/settings.ts";
import { generateEditorialReview } from "../apps/web/lib/server/review-service.ts";
import { generateReviewAction } from "../apps/web/lib/server/review-action-service.ts";
import type {
  EditorialCalloutKind,
  EditorialReviewItem,
  EditorialReviewInsertionHint,
  EditorialReviewRecommendationType,
  EditorialReviewStepId,
  EditorialReviewSuggestedAction,
  ReviewActionRequest
} from "../apps/web/lib/editor/review-contract.ts";

const provider = "gemini";
const modelId = getDefaultProviderModelId(provider);
const changeLevel = 3 as const;
const document = DEFAULT_EDITOR_DOCUMENT;
const revision = deriveManuscriptRevisionState(document);
const paragraphBlocks = document.blocks.filter((block) => block.type === "paragraph") as Block[];

const baseReviewRequest = {
  document,
  revision,
  provider,
  modelId,
  changeLevel,
  basePrompt: DEFAULT_BASE_PROMPT,
  reviewPrompt: DEFAULT_CARDS_PROMPT,
  expertisePrompt: DEFAULT_EXPERTISE_PROMPT,
  cardsPrompt: DEFAULT_CARDS_PROMPT,
  reviewLevelGuide: DEFAULT_REVIEW_LEVEL_GUIDE,
  calloutPromptTemplate: DEFAULT_CALLOUT_PROMPT_TEMPLATE
};

const reviewSteps: EditorialReviewStepId[] = ["structure", "clarity", "interest", "formatting"];
const actionTypes: EditorialReviewRecommendationType[] = ["rewrite", "simplify", "expand", "list", "subsection", "callout"];

type ManualBlueprint = {
  title: string;
  reason: string;
  recommendation: string;
  suggestedAction: EditorialReviewSuggestedAction;
  insertionHint: EditorialReviewInsertionHint;
  paragraphIndex: number;
  calloutKind?: EditorialCalloutKind;
};

const manualBlueprints: Record<EditorialReviewRecommendationType, ManualBlueprint> = {
  rewrite: {
    title: "Відшліфувати щільний абзац",
    reason: "Параграф читається важко, тому потребує переписування на живішу українську.",
    recommendation: "Перепиши цей фрагмент коротшими реченнями та яснішою логікою, зберігаючи факти і тон авторки.",
    suggestedAction: "rewrite_text",
    insertionHint: "replace",
    paragraphIndex: 0
  },
  simplify: {
    title: "Спростити складну мову",
    reason: "Фрагмент забагато важких термінів і складних конструкцій.",
    recommendation: "Спростити формулювання, прибрати кальки й зробити ідеї більш доступними без втрати точності.",
    suggestedAction: "rewrite_text",
    insertionHint: "replace",
    paragraphIndex: 2
  },
  expand: {
    title: "Додати коротке пояснення",
    reason: "Читачеві бракує контексту: утримання змін у шкірі згадано без прикладів.",
    recommendation: "Підсилити фрагмент двома реченнями з прикладом, як саме шкіра реагує на стрес.",
    suggestedAction: "rewrite_text",
    insertionHint: "replace",
    paragraphIndex: 4
  },
  list: {
    title: "Перетворити на список",
    reason: "Інформація повторюється, тож список зробить її сканованішою.",
    recommendation: "Відформатуй ключові пункти як ordered list з короткими поясненнями кожного.",
    suggestedAction: "rewrite_text",
    insertionHint: "replace",
    paragraphIndex: 6
  },
  subsection: {
    title: "Додати локальний підрозділ",
    reason: "Логіка змінюється, але нема сигнального підзаголовка.",
    recommendation: "Вставити підзаголовок і 2-3 речення, які пояснюють, чому я маю звернути увагу на цей фрагмент.",
    suggestedAction: "insert_text",
    insertionHint: "before",
    paragraphIndex: 8
  },
  callout: {
    title: "Коротка практична рамка",
    reason: "Текст потребує приближення до життя читача.",
    recommendation: "Підготуй everyday_application callout із прикладом, як застосувати пораду у звичайному дні.",
    suggestedAction: "prepare_callout",
    insertionHint: "after",
    paragraphIndex: 10,
    calloutKind: "everyday_application"
  }
};

type ItemSource = {
  item: EditorialReviewItem;
  origin: EditorialReviewStepId | "manual";
  manual: boolean;
};

type TextDiffRecord = {
  op: string;
  blockIdsCount: number;
  oldBlockCount: number;
  newBlockCount: number;
  reason: string;
  warning: { code: string; message: string; similarity: number } | null;
};

type ActionRecord = {
  type: EditorialReviewRecommendationType;
  manualFallback: boolean;
  sourceStep: string;
  reviewItemId: string;
  title: string;
  reason: string;
  recommendation: string;
  anchorExcerpt: string;
  anchorBlockIds: string[];
  calloutKind: EditorialCalloutKind | null;
  providerUsed: string | null;
  usedFallback: boolean | null;
  error: string | null;
  proposalKind: string | null;
  canApplyDirectly: boolean | null;
  textDiff: TextDiffRecord | null;
  subsectionDraft: { title: string; lead: string | null; prompt: string } | null;
  calloutDraft: { calloutKind: EditorialCalloutKind; title: string; prompt: string; previewText: string | null } | null;
};

function resolveFallbackBlock(paragraphOrdinal: number): { block: Block; blockIndex: number } {
  const sanitizedOrdinal = paragraphBlocks.length > 0 ? Math.min(Math.max(paragraphOrdinal, 0), paragraphBlocks.length - 1) : 0;
  let block = paragraphBlocks[sanitizedOrdinal];
  if (!block) {
    const fallbackIndex = Math.min(Math.max(paragraphOrdinal, 0), document.blocks.length - 1);
    block = document.blocks[fallbackIndex];
  }
  if (!block) {
    throw new Error("Document lacks blocks for manual fallback");
  }
  const blockIndex = document.blocks.findIndex((candidate) => candidate.id === block.id);
  if (blockIndex < 0) {
    throw new Error("Cannot resolve block index for manual fallback");
  }
  return { block, blockIndex };
}

function createManualReviewItem(type: EditorialReviewRecommendationType): EditorialReviewItem {
  const blueprint = manualBlueprints[type];
  const { block, blockIndex } = resolveFallbackBlock(blueprint.paragraphIndex);
  const fingerprint = computeAnchorFingerprint(document, [block.id]);

  const manualItem: EditorialReviewItem = {
    id: `manual-${type}-${block.id}`,
    reviewSessionId: `manual-${type}`,
    documentRevisionId: revision.documentRevisionId,
    changeLevel,
    title: blueprint.title,
    reason: blueprint.reason,
    recommendation: blueprint.recommendation,
    recommendationType: type,
    suggestedAction: blueprint.suggestedAction,
    priority: "medium",
    anchor: {
      blockIds: [block.id],
      generationBlockRange: { start: blockIndex, end: blockIndex },
      excerpt: getBlockText(block),
      fingerprint
    },
    insertionPoint: {
      mode: blueprint.insertionHint,
      anchorBlockId: block.id
    },
    status: "pending",
    origin: "manual"
  } satisfies EditorialReviewItem;

  if (type === "callout" && blueprint.calloutKind) {
    manualItem.calloutKind = blueprint.calloutKind;
  }

  return manualItem;
}

async function main() {
  const itemsByType = new Map<EditorialReviewRecommendationType, ItemSource>();

  for (const step of reviewSteps) {
    console.log(`Running review step ${step}...`);
    const response = await generateEditorialReview({
      ...baseReviewRequest,
      stepId: step,
      runMode: "replace"
    });
    console.log(`  ${response.items.length} cards returned for ${step}.`);

    for (const item of response.items) {
      if (actionTypes.includes(item.recommendationType) && !itemsByType.has(item.recommendationType)) {
        itemsByType.set(item.recommendationType, { item, origin: step, manual: false });
      }
    }

    if (itemsByType.size === actionTypes.length) {
      break;
    }
  }

  const missingTypes = actionTypes.filter((type) => !itemsByType.has(type));
  if (missingTypes.length > 0) {
    console.log(`Manual fallback required for: ${missingTypes.join(", ")}`);
    for (const type of missingTypes) {
      itemsByType.set(type, { item: createManualReviewItem(type), origin: "manual", manual: true });
    }
  }

  const actionRecords: ActionRecord[] = [];

  for (const type of actionTypes) {
    const entry = itemsByType.get(type);
    if (!entry) {
      throw new Error(`Missing review item for type ${type}`);
    }

    const { item, origin, manual } = entry;
    const actionRequest: ReviewActionRequest = {
      document,
      currentRevision: revision,
      provider,
      modelId,
      item,
      basePrompt: baseReviewRequest.basePrompt,
      reviewPrompt: baseReviewRequest.reviewPrompt,
      expertisePrompt: baseReviewRequest.expertisePrompt,
      cardsPrompt: baseReviewRequest.cardsPrompt,
      reviewLevelGuide: baseReviewRequest.reviewLevelGuide,
      calloutPromptTemplate: baseReviewRequest.calloutPromptTemplate
    };

    const record: ActionRecord = {
      type,
      manualFallback: manual,
      sourceStep: origin,
      reviewItemId: item.id,
      title: item.title,
      reason: item.reason,
      recommendation: item.recommendation,
      anchorExcerpt: item.anchor.excerpt,
      anchorBlockIds: item.anchor.blockIds,
      calloutKind: item.calloutKind ?? null,
      providerUsed: null,
      usedFallback: null,
      error: null,
      proposalKind: null,
      canApplyDirectly: null,
      textDiff: null,
      subsectionDraft: null,
      calloutDraft: null
    };

    try {
      const response = await generateReviewAction(actionRequest);
      record.providerUsed = response.providerUsed;
      record.usedFallback = response.usedFallback;
      record.error = response.error ?? null;
      record.proposalKind = response.proposal.kind;
      record.canApplyDirectly = response.proposal.canApplyDirectly;

      if (response.proposal.textDiff) {
        record.textDiff = {
          op: response.proposal.textDiff.op,
          blockIdsCount: response.proposal.textDiff.blockIds.length,
          oldBlockCount: response.proposal.textDiff.oldBlocks.length,
          newBlockCount: response.proposal.textDiff.newBlocks.length,
          reason: response.proposal.textDiff.reason,
          warning: response.proposal.textDiff.warning ?? null
        };
      }

      if (response.proposal.subsectionDraft) {
        record.subsectionDraft = {
          title: response.proposal.subsectionDraft.title,
          lead: response.proposal.subsectionDraft.lead ?? null,
          prompt: response.proposal.subsectionDraft.prompt
        };
      }

      if (response.proposal.calloutDraft) {
        record.calloutDraft = {
          calloutKind: response.proposal.calloutDraft.calloutKind,
          title: response.proposal.calloutDraft.title,
          prompt: response.proposal.calloutDraft.prompt,
          previewText: response.proposal.calloutDraft.previewText ?? null
        };
      }
    } catch (error) {
      record.error =
        error instanceof Error ? error.message : Array.isArray(error) ? error.join(", ") : String(error ?? "Unknown error");
    }

    actionRecords.push(record);
  }

  const outputPath = path.resolve("tmp", "usefulness-action-outputs.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        provider,
        modelId,
        changeLevel,
        actions: actionRecords
      },
      null,
      2
    )
  );

  console.log(`Saved ${actionRecords.length} action summaries to ${outputPath}`);
}

main().catch((error) => {
  console.error("Review action run failed:", error);
  process.exit(1);
});
