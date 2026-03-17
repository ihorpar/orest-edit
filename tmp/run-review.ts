import fs from "node:fs/promises";
import path from "node:path";

import type { EditorialReviewRequest, EditorialReviewStepId } from "../apps/web/lib/editor/review-contract.ts";
import { deriveManuscriptRevisionState } from "../apps/web/lib/editor/manuscript-structure.ts";
import { DEFAULT_EDITOR_DOCUMENT } from "../apps/web/lib/editor/default-manuscript.ts";
import { DEFAULT_EDITOR_SETTINGS } from "../apps/web/lib/editor/settings.ts";
import { generateEditorialReview } from "../apps/web/lib/server/review-service.ts";

interface StepOutput {
  stepId: EditorialReviewStepId;
  providerUsed: string;
  usedFallback: boolean;
  error: string | null;
  itemsCount: number;
  factCheckRowsCount: number;
  expertiseLength: number;
  sampleRecommendations: Array<{ title: string; recommendationType: string; reasonExcerpt: string }>;
}

function createReasonExcerpt(reason: string, maxLength = 200): string {
  const normalized = reason.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength).trim();
  return truncated.endsWith("…") ? truncated : `${truncated}…`;
}

async function main() {
  const revision = deriveManuscriptRevisionState(DEFAULT_EDITOR_DOCUMENT);
  const baseRequest = {
    document: DEFAULT_EDITOR_DOCUMENT,
    revision,
    provider: DEFAULT_EDITOR_SETTINGS.provider,
    modelId: DEFAULT_EDITOR_SETTINGS.modelId,
    basePrompt: DEFAULT_EDITOR_SETTINGS.basePrompt,
    reviewPrompt: DEFAULT_EDITOR_SETTINGS.reviewPrompt,
    reviewLevelGuide: DEFAULT_EDITOR_SETTINGS.reviewLevelGuide,
    calloutPromptTemplate: DEFAULT_EDITOR_SETTINGS.calloutPromptTemplate,
    imagePromptTemplate: DEFAULT_EDITOR_SETTINGS.imagePromptTemplate,
    changeLevel: 3 as const
  } satisfies Omit<EditorialReviewRequest, "stepId" | "cardsPrompt" | "expertisePrompt" | "runMode" | "stepContext" | "expertise">;

  const steps: EditorialReviewStepId[] = [
    "diagnostics",
    "fact_check",
    "structure",
    "clarity",
    "interest",
    "visuals",
    "formatting",
    "final_editing"
  ];

  const outputs: StepOutput[] = [];
  let diagnosticsExpertise: string | undefined;

  for (const stepId of steps) {
    const request: EditorialReviewRequest = {
      ...baseRequest,
      stepId,
      runMode: "replace",
      cardsPrompt: stepId === "diagnostics" ? undefined : DEFAULT_EDITOR_SETTINGS.cardsPrompt,
      expertisePrompt: stepId === "diagnostics" ? DEFAULT_EDITOR_SETTINGS.expertisePrompt : undefined,
      expertise: stepId === "diagnostics" ? undefined : diagnosticsExpertise,
      stepContext:
        stepId === "diagnostics"
          ? undefined
          : {
              diagnosticsExpertise
            }
    };

    let response: Awaited<ReturnType<typeof generateEditorialReview>> | null = null;
    let caughtError: string | null = null;

    try {
      response = await generateEditorialReview(request);
    } catch (error) {
      caughtError = error instanceof Error ? error.message : String(error);
    }

    if (stepId === "diagnostics" && response?.expertise?.trim()) {
      diagnosticsExpertise = response.expertise.trim();
    }

    const items = response?.items ?? [];
    const factRows = response?.factCheckRows ?? [];
    const providerUsed = response?.providerUsed ?? "unknown";
    const usedFallback = response?.usedFallback ?? false;
    const errorMessage = response?.error ?? caughtError;
    const expertiseLength = response?.expertise ? response.expertise.length : 0;

    const sampleRecommendations = items.slice(0, 2).map((item) => ({
      title: item.title,
      recommendationType: item.recommendationType,
      reasonExcerpt: createReasonExcerpt(item.reason)
    }));

    outputs.push({
      stepId,
      providerUsed,
      usedFallback,
      error: errorMessage ?? null,
      itemsCount: items.length,
      factCheckRowsCount: factRows.length,
      expertiseLength,
      sampleRecommendations
    });

    console.log(
      `[${stepId}] provider=${providerUsed} fallback=${usedFallback} items=${items.length} facts=${factRows.length} error=${errorMessage ? errorMessage : "none"}`
    );
  }

  const outputDir = path.resolve("tmp");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "usefulness-review-outputs.json");
  await fs.writeFile(outputPath, JSON.stringify(outputs, null, 2), "utf-8");
  console.log(`Saved results to ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to run review steps:", error);
  process.exit(1);
});
