import { getBlockText, type Block } from "../editor/document-model.ts";

export interface ReviewChunkPlannerOptions {
  minSourceChars?: number;
  targetSourceChars?: number;
  maxSourceChars?: number;
  maxEligibleBlocks?: number;
  isEligibleBlock?: (block: Block) => boolean;
}

export interface ReviewChunkPlan {
  index: number;
  startBlockIndex: number;
  endBlockIndex: number;
  sourceChars: number;
  coreBlockIds: string[];
  contextBlockIds: string[];
  blocks: Block[];
}

/** @deprecated Use ReviewChunkPlannerOptions. Kept so emphasis call sites stay stable. */
export type EmphasisChunkPlannerOptions = ReviewChunkPlannerOptions;
/** @deprecated Use ReviewChunkPlan. Kept so emphasis call sites stay stable. */
export type EmphasisChunkPlan = ReviewChunkPlan;

const defaultOptions = {
  minSourceChars: 12_000,
  targetSourceChars: 14_000,
  maxSourceChars: 16_000,
  // Character budget is the real limit. This cap only stops pathological tiny-block imports.
  maxEligibleBlocks: 400
} as const;

export function planReviewChunks(
  blocks: Block[],
  options: ReviewChunkPlannerOptions = {}
): ReviewChunkPlan[] {
  const config = { ...defaultOptions, ...options };
  const isEligible = options.isEligibleBlock ?? isReviewEligibleBlock;
  const eligible = blocks
    .map((block, blockIndex) => ({
      block,
      blockIndex,
      sourceChars: getBlockText(block).trim().length
    }))
    .filter(({ block, sourceChars }) => isEligible(block) && sourceChars > 0);

  if (eligible.length === 0) {
    return [];
  }

  const groups: typeof eligible[] = [];
  let current: typeof eligible = [];
  let currentChars = 0;

  const commit = () => {
    if (current.length > 0) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
  };

  for (let index = 0; index < eligible.length; index += 1) {
    const candidate = eligible[index];
    const previous = current.at(-1);
    const startsNewSection = previous
      ? hasHeadingBetween(blocks, previous.blockIndex, candidate.blockIndex)
      : false;
    const exceedsHardLimit = current.length > 0 && (
      currentChars + candidate.sourceChars > config.maxSourceChars ||
      current.length >= config.maxEligibleBlocks
    );

    if ((startsNewSection && currentChars >= config.minSourceChars) || exceedsHardLimit) {
      commit();
    }

    current.push(candidate);
    currentChars += candidate.sourceChars;

    const next = eligible[index + 1];
    const nextStartsSection = next
      ? hasHeadingBetween(blocks, candidate.blockIndex, next.blockIndex)
      : false;

    if (
      current.length >= config.maxEligibleBlocks ||
      currentChars >= config.maxSourceChars ||
      (currentChars >= config.targetSourceChars && nextStartsSection)
    ) {
      commit();
    }
  }

  commit();

  return groups.map((group, index) => {
    const firstCoreIndex = group[0].blockIndex;
    const lastCoreIndex = group[group.length - 1].blockIndex;
    const startBlockIndex = Math.max(0, firstCoreIndex - 1);
    const endBlockIndex = Math.min(blocks.length, lastCoreIndex + 2);
    const chunkBlocks = blocks.slice(startBlockIndex, endBlockIndex);
    const coreBlockIds = group.map(({ block }) => block.id);
    const coreBlockIdSet = new Set(coreBlockIds);

    return {
      index,
      startBlockIndex,
      endBlockIndex,
      sourceChars: group.reduce((total, entry) => total + entry.sourceChars, 0),
      coreBlockIds,
      contextBlockIds: chunkBlocks.filter((block) => !coreBlockIdSet.has(block.id)).map((block) => block.id),
      blocks: chunkBlocks
    };
  });
}

export function planEmphasisChunks(
  blocks: Block[],
  options: ReviewChunkPlannerOptions = {}
): ReviewChunkPlan[] {
  return planReviewChunks(blocks, options);
}

export function isReviewEligibleBlock(block: Block): boolean {
  return block.type === "paragraph" ||
    block.type === "bullet_list" ||
    block.type === "ordered_list" ||
    block.type === "callout" ||
    block.type === "table";
}

export function isEmphasisEligibleBlock(block: Block): boolean {
  return isReviewEligibleBlock(block);
}

function hasHeadingBetween(blocks: Block[], leftIndex: number, rightIndex: number): boolean {
  for (let index = leftIndex + 1; index <= rightIndex; index += 1) {
    if (blocks[index]?.type === "heading") {
      return true;
    }
  }

  return false;
}
