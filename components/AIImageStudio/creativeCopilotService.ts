import type {
  BrandKnowledge,
  ComposerReference,
  CreativeConcept,
  ProductTruth,
  SocialPlatform,
  StrategistBrief,
  StudioAsset,
  TrendResearchResult,
} from './types';
import type { BrandResearchResult } from './brandKnowledgeService';
import type { TrendResearchOutput } from './trendResearchService';
import type { ConceptGenerationResult } from './conceptDirectorService';
import { researchBrand } from './brandKnowledgeService';
import { researchTrends } from './trendResearchService';
import { generateConcepts } from './conceptDirectorService';
import { analyzeProductTruth } from './productTruthService';
import {
  buildStrategistBriefFromResearch,
  formatStrategistBriefForPrompt,
  type StrategistBriefResult,
} from './strategistBriefService';
import { analyzeCreativeReferences } from '../../services/creativeReferenceDirector';

export interface CopilotResearchInput {
  brandUrls: string[];
  campaignGoal: string;
  productName?: string;
  platform: SocialPlatform;
  references: ComposerReference[];
  assets: StudioAsset[];
  aspectRatio?: string;
  existingProductTruth?: ProductTruth;
}

export interface CopilotResearchResult {
  brand?: BrandResearchResult;
  trends: TrendResearchOutput;
  productTruth?: ProductTruth;
  strategistBrief: StrategistBriefResult;
  concepts: ConceptGenerationResult;
  warnings: string[];
}

export function getCopilotWarnings(result: {
  brand?: Pick<BrandResearchResult, 'warnings'>;
  trends: Pick<TrendResearchOutput, 'warnings'>;
  concepts: Pick<ConceptGenerationResult, 'warnings'>;
  strategistBrief?: Pick<StrategistBriefResult, 'warnings'>;
  warnings?: string[];
}): string[] {
  return [
    ...(result.warnings ?? []),
    ...(result.brand?.warnings ?? []),
    ...result.trends.warnings,
    ...result.concepts.warnings,
    ...(result.strategistBrief?.warnings ?? []),
  ];
}

export function buildResearchQuery(input: Pick<CopilotResearchInput, 'campaignGoal' | 'productName' | 'platform'>): string {
  // Short seed for Google Search — product + goal keywords only (no platform fluff dump).
  const goalSnippet = (input.campaignGoal || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return [input.productName, goalSnippet]
    .filter(Boolean)
    .join(' ')
    .trim() || 'product visual market trends';
}

export function buildLockedProductContext(references: ComposerReference[], assets: StudioAsset[]): string {
  return references.map(reference => {
    const asset = assets.find(item => item.id === reference.assetId);
    if (!asset) return '';
    return [
      `${reference.role.toUpperCase()} reference: ${asset.name}`,
      `Dimensions: ${asset.width}x${asset.height}`,
      asset.description && `Description: ${asset.description}`,
      reference.instructions && `Instruction: ${reference.instructions}`,
    ].filter(Boolean).join('. ');
  }).filter(Boolean).join('\n');
}

/**
 * Builds locked-product context by visually analyzing the locked asset images,
 * so research and concept generation are grounded in what the product actually
 * looks like rather than only file names. Falls back to the text-only context
 * when analysis is unavailable.
 */
export async function buildVisualLockedProductContext(
  references: ComposerReference[],
  assets: StudioAsset[],
): Promise<string> {
  const lockedAssets = references
    .map(reference => ({ reference, asset: assets.find(item => item.id === reference.assetId) }))
    .filter((entry): entry is { reference: ComposerReference; asset: StudioAsset } => !!entry.asset)
    .slice(0, 6);
  if (lockedAssets.length === 0) return '';

  try {
    const analyzed = await analyzeCreativeReferences(lockedAssets.map(({ reference, asset }) => ({
      id: asset.id,
      name: asset.name,
      base64: asset.base64,
      mimeType: asset.mimeType,
      note: [asset.description, reference.instructions].filter(Boolean).join('. '),
    })));

    const lines = lockedAssets.map(({ reference, asset }, index) => {
      const analysis = analyzed[index];
      return [
        `${reference.role.toUpperCase()} reference: ${asset.name}`,
        `Dimensions: ${asset.width}x${asset.height}`,
        analysis?.description && `Visual analysis: ${analysis.description}`,
        analysis?.preserve?.length && `Must preserve: ${analysis.preserve.join(', ')}`,
        asset.description && `Description: ${asset.description}`,
        reference.instructions && `Instruction: ${reference.instructions}`,
      ].filter(Boolean).join('. ');
    });
    return lines.join('\n');
  } catch {
    return buildLockedProductContext(references, assets);
  }
}

export function mergeLockedReferences(
  references: ComposerReference[],
  gallerySelectionIds: Set<string>,
): ComposerReference[] {
  const existingIds = new Set(references.map(reference => reference.assetId));
  return [
    ...references,
    ...Array.from(gallerySelectionIds)
      .filter(assetId => !existingIds.has(assetId))
      .map(assetId => ({ assetId, role: 'product' as const })),
  ];
}

/**
 * Scope generation to gallery selection when non-empty.
 * Preserves typed composer roles for selected assets; unreferenced picks default to product.
 */
export function resolveGenerationReferences(
  references: ComposerReference[],
  gallerySelectionIds: Set<string>,
): ComposerReference[] {
  if (gallerySelectionIds.size === 0) return references;

  const byId = new Map(references.map((ref) => [ref.assetId, ref]));
  return Array.from(gallerySelectionIds).map(
    (assetId) => byId.get(assetId) ?? { assetId, role: 'product' as const },
  );
}

export function buildCopilotPrompt(input: {
  campaignGoal: string;
  brandName?: string;
  conceptTitle: string;
  conceptDirection: string;
  trendTitles: string[];
}): string {
  const trendTitles = [...new Set(input.trendTitles)];
  return [
    input.campaignGoal,
    input.brandName && `Brand: ${input.brandName}.`,
    `Selected concept: ${input.conceptTitle}.`,
    `Visual direction: ${input.conceptDirection}.`,
    trendTitles.length > 0 && `Market context: ${trendTitles.join(', ')}.`,
  ].filter(Boolean).join('\n');
}

export function extractCampaignGoal(prompt: string): string {
  return prompt.split(/\n(?=Brand:|Selected concept:|Visual direction:|Market context:)/)[0].trim();
}

/**
 * True when productTruth.protectedAssetIds matches the current locked product set
 * (order-independent). Returns false when productTruth is missing.
 */
export function areProtectedAssetsInSync(
  productTruth: ProductTruth | undefined,
  lockedAssetIds: string[],
): boolean {
  if (!productTruth) return false;
  if (productTruth.protectedAssetIds.length !== lockedAssetIds.length) return false;
  const set = new Set(productTruth.protectedAssetIds);
  return lockedAssetIds.every((id) => set.has(id));
}

/**
 * Build or reuse Product Truth from locked product images.
 */
export async function ensureProductTruthFromLockedReferences(input: {
  references: ComposerReference[];
  assets: StudioAsset[];
  existing?: ProductTruth;
  campaignGoal?: string;
}): Promise<{ productTruth?: ProductTruth; warnings: string[] }> {
  const productRefs = input.references.filter((reference) => reference.role === 'product');
  const refs = productRefs.length > 0 ? productRefs : input.references;
  const productAssets = refs
    .map((reference) => input.assets.find((asset) => asset.id === reference.assetId))
    .filter((asset): asset is StudioAsset => Boolean(asset));

  if (productAssets.length === 0) {
    return {
      productTruth: input.existing,
      warnings: ['No locked product images — preservation rules not established from imagery.'],
    };
  }

  const assetIds = productAssets.map((asset) => asset.id);
  if (areProtectedAssetsInSync(input.existing, assetIds)) {
    return { productTruth: input.existing, warnings: [] };
  }

  try {
    const analyzed = await analyzeProductTruth({
      productAssets,
      signals: input.campaignGoal
        ? { description: input.campaignGoal }
        : undefined,
    });
    return {
      productTruth: {
        ...analyzed,
        userCorrections: input.existing?.userCorrections ?? [],
        productName:
          input.existing?.productName && input.existing.productName !== 'Unknown product'
            ? input.existing.productName
            : analyzed.productName,
      },
      warnings: [],
    };
  } catch (error) {
    return {
      productTruth: input.existing,
      warnings: [
        error instanceof Error
          ? `Product truth analysis failed: ${error.message}`
          : 'Product truth analysis failed.',
      ],
    };
  }
}

export async function runCreativeCopilot(
  input: CopilotResearchInput,
  onStage?: (stage: string) => void,
): Promise<CopilotResearchResult> {
  const pipelineWarnings: string[] = [];

  onStage?.('Analyzing locked product images');
  const lockedProductContext = await buildVisualLockedProductContext(input.references, input.assets);

  onStage?.('Building product truth from locked images');
  const { productTruth, warnings: productWarnings } = await ensureProductTruthFromLockedReferences({
    references: input.references,
    assets: input.assets,
    existing: input.existingProductTruth,
    campaignGoal: input.campaignGoal,
  });
  pipelineWarnings.push(...productWarnings);

  let brand: BrandResearchResult | undefined;
  if (input.brandUrls.length > 0) {
    onStage?.('Researching brand');
    brand = await researchBrand({ sourceUrls: input.brandUrls });
  } else {
    pipelineWarnings.push('Brand URL skipped — researching from product and goal context only.');
  }

  onStage?.('Researching recent market trends');
  // Keep the search query short and focused — do NOT append locked-image visual
  // analysis here (it blows past useful Google Search query length and kills grounding).
  const trends = await researchTrends({
    userQuery: buildResearchQuery({
      campaignGoal: input.campaignGoal,
      productName: productTruth?.productName || input.productName,
      platform: input.platform,
    }),
    brandKnowledge: brand?.knowledge,
    productTruth,
    platform: input.platform,
    objective: 'awareness',
  });

  onStage?.('Writing strategist brief');
  const strategistBrief = buildStrategistBriefFromResearch({
    campaignGoal: input.campaignGoal,
    brandKnowledge: brand?.knowledge,
    trendResearch: trends.result,
    productTruth,
    lockedProductContext,
    platform: input.platform,
  });

  onStage?.('Creating grounded concepts');
  const concepts = await generateConcepts({
    brandKnowledge: brand?.knowledge,
    trendResearch: trends.result,
    productTruth,
    strategistBrief: strategistBrief.brief,
    userDirection: [
      input.campaignGoal,
      formatStrategistBriefForPrompt(strategistBrief.brief),
      lockedProductContext && `LOCKED PRODUCT CONTEXT:\n${lockedProductContext}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    availableReferences: input.references,
    aspectRatio: input.aspectRatio,
  });

  return {
    brand,
    trends,
    productTruth,
    strategistBrief,
    concepts,
    warnings: pipelineWarnings,
  };
}

export interface MoreConceptsInput {
  campaignGoal: string;
  brandKnowledge?: BrandKnowledge;
  trendResearch?: TrendResearchResult;
  productTruth?: ProductTruth;
  strategistBrief?: StrategistBrief;
  references: ComposerReference[];
  assets: StudioAsset[];
  existingConcepts: CreativeConcept[];
  conceptCount?: number;
  aspectRatio?: string;
}

/** Generate additional concepts using already-completed research, avoiding repeats. */
export async function generateMoreConcepts(input: MoreConceptsInput): Promise<ConceptGenerationResult> {
  const lockedProductContext = await buildVisualLockedProductContext(input.references, input.assets);
  const briefBlock = input.strategistBrief
    ? formatStrategistBriefForPrompt(input.strategistBrief)
    : '';
  return generateConcepts({
    brandKnowledge: input.brandKnowledge,
    trendResearch: input.trendResearch,
    productTruth: input.productTruth,
    strategistBrief: input.strategistBrief,
    userDirection: [
      input.campaignGoal,
      briefBlock,
      lockedProductContext && `LOCKED PRODUCT CONTEXT:\n${lockedProductContext}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    availableReferences: input.references,
    aspectRatio: input.aspectRatio,
    conceptCount: input.conceptCount ?? 3,
    avoidConcepts: input.existingConcepts.map(({ title, oneLineIdea, visualDirection }) => ({
      title,
      oneLineIdea,
      visualDirection,
    })),
  });
}

export interface RegenerateConceptsInput {
  campaignGoal: string;
  brandKnowledge?: BrandKnowledge;
  trendResearch?: TrendResearchResult;
  productTruth?: ProductTruth;
  strategistBrief?: StrategistBrief;
  references: ComposerReference[];
  assets: StudioAsset[];
  platform?: SocialPlatform;
  aspectRatio?: string;
  conceptCount?: number;
}

export interface RegenerateConceptsResult {
  strategistBrief: StrategistBriefResult;
  concepts: ConceptGenerationResult;
  warnings: string[];
}

/**
 * Regenerate strategist brief (if needed) + concepts from existing research.
 * Does not call researchBrand or researchTrends.
 */
export async function regenerateConceptsFromBrief(
  input: RegenerateConceptsInput,
): Promise<RegenerateConceptsResult> {
  const campaignGoal = input.campaignGoal.trim();
  if (!campaignGoal) {
    throw new Error('Campaign goal is required to regenerate concepts.');
  }
  if (!input.brandKnowledge && !input.productTruth && !input.strategistBrief) {
    throw new Error(
      'Need brand knowledge, product truth, or an existing strategist brief to regenerate concepts.',
    );
  }

  const pipelineWarnings: string[] = [];
  const lockedProductContext = await buildVisualLockedProductContext(input.references, input.assets);

  const strategistBrief: StrategistBriefResult = input.strategistBrief
    ? { brief: input.strategistBrief, warnings: [] }
    : buildStrategistBriefFromResearch({
        campaignGoal,
        brandKnowledge: input.brandKnowledge,
        trendResearch: input.trendResearch,
        productTruth: input.productTruth,
        lockedProductContext,
        platform: input.platform,
      });
  pipelineWarnings.push(...strategistBrief.warnings);

  const concepts = await generateConcepts({
    brandKnowledge: input.brandKnowledge,
    trendResearch: input.trendResearch,
    productTruth: input.productTruth,
    strategistBrief: strategistBrief.brief,
    userDirection: [
      campaignGoal,
      formatStrategistBriefForPrompt(strategistBrief.brief),
      lockedProductContext && `LOCKED PRODUCT CONTEXT:\n${lockedProductContext}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    availableReferences: input.references,
    aspectRatio: input.aspectRatio,
    conceptCount: input.conceptCount,
  });

  return {
    strategistBrief,
    concepts,
    warnings: pipelineWarnings,
  };
}

export function promptForConcept(
  campaignGoal: string,
  _concept: CreativeConcept,
  _brandName?: string,
  _trendTitles: string[] = [],
): string {
  return campaignGoal.trim();
}
