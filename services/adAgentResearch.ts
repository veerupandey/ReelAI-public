/**
 * Ad Agent research — reuses Image Studio Creative Copilot services
 * (product truth, brand knowledge, trends, strategist brief, concepts)
 * without requiring the full Studio UI state.
 */

import {
  buildCopilotPrompt,
  getCopilotWarnings,
  runCreativeCopilot,
} from '../components/AIImageStudio/creativeCopilotService';
import { normalizeBrandUrls } from '../components/AIImageStudio/brandKnowledgeService';
import { formatStrategistBriefForPrompt } from '../components/AIImageStudio/strategistBriefService';
import type {
  CreativeConcept,
  SocialPlatform,
  StrategistBrief,
  StudioAsset,
} from '../components/AIImageStudio/types';
import {
  getProductKnowledge,
  importProductPageAssetsRich,
} from './productPageImportService';
import {
  formatVideoTreatmentBlock,
  generateVideoTreatment,
  isVideoAdFormat,
  type AdAgentVideoTreatment,
  type AdAgentVideoVibe,
} from './adAgentVideoTreatment';

export interface AdAgentPackshot {
  base64: string;
  mimeType: string;
  name: string;
}

/** Video-native research context (set when the launch format is a video ad). */
export interface AdAgentVideoContext {
  adFormat: string;
  /** Agent platform id (instagram_reels / tiktok / youtube_shorts) — not the Image Studio mapping. */
  agentPlatform: string;
  durationSec: number;
  vibe: AdAgentVideoVibe;
}

export interface AdAgentResearchInput {
  campaignGoal: string;
  productUrl?: string;
  /** Optional brand site; defaults to product URL origin when available. */
  brandUrl?: string;
  platform?: SocialPlatform;
  packshot?: AdAgentPackshot;
  /** When set (video formats), research adds a video treatment pass. */
  videoContext?: AdAgentVideoContext;
}

export interface AdAgentResearchResult {
  productTitle: string;
  productFacts: string[];
  productBase64?: string;
  productMimeType?: string;
  brandName?: string;
  strategistBrief: StrategistBrief;
  concepts: CreativeConcept[];
  trendTitles: string[];
  warnings: string[];
  /** Default creative brief from strategist + top concept (user can edit / re-pick). */
  creativeBrief: string;
  /** Short-form video DNA (hook / beats / motion / pacing) — video formats only. */
  videoTreatment?: AdAgentVideoTreatment;
  videoContext?: AdAgentVideoContext;
}

const asStudioMime = (mime: string): StudioAsset['mimeType'] => {
  if (mime === 'image/jpeg' || mime === 'image/webp') return mime;
  return 'image/png';
};

const stripDataUrl = (value: string): string =>
  value.startsWith('data:') ? (value.split(',')[1] || '') : value;

/** Map Ad Agent platform → Image Studio SocialPlatform (research context only). */
export function mapAgentPlatformToSocial(platform: string): SocialPlatform {
  if (platform === 'instagram_feed' || platform === 'instagram_carousel') return 'instagram_feed';
  return 'instagram_story';
}

export function buildStudioAssetFromPackshot(packshot: AdAgentPackshot): StudioAsset {
  const base64 = stripDataUrl(packshot.base64);
  return {
    id: `packshot-${Date.now().toString(36)}`,
    name: packshot.name.slice(0, 100) || 'Product packshot',
    description: 'Uploaded product packshot for Ad Agent research',
    base64,
    mimeType: asStudioMime(packshot.mimeType),
    width: 1024,
    height: 1024,
    source: 'upload',
    createdAt: new Date().toISOString(),
  };
}

export function formatAdAgentCreativeBrief(input: {
  campaignGoal: string;
  strategistBrief: StrategistBrief;
  concept?: CreativeConcept | null;
  productTitle?: string;
  productFacts?: string[];
  brandName?: string;
  trendTitles?: string[];
  videoTreatment?: AdAgentVideoTreatment;
  videoContext?: AdAgentVideoContext;
}): string {
  const conceptBlock = input.concept
    ? buildCopilotPrompt({
        campaignGoal: input.campaignGoal,
        brandName: input.brandName,
        conceptTitle: input.concept.title,
        conceptDirection: [
          input.concept.oneLineIdea,
          input.concept.visualDirection,
          input.concept.hook && `Hook: ${input.concept.hook}`,
        ].filter(Boolean).join(' '),
        trendTitles: input.trendTitles || [],
      })
    : input.campaignGoal;

  const factLines = (input.productFacts || []).slice(0, 8).map((f) => `- ${f}`);

  const videoBlock = input.videoTreatment && input.videoContext
    ? formatVideoTreatmentBlock(input.videoTreatment, {
        platform: input.videoContext.agentPlatform,
        durationSec: input.videoContext.durationSec,
        vibe: input.videoContext.vibe,
      })
    : '';

  return [
    conceptBlock,
    '',
    videoBlock,
    formatStrategistBriefForPrompt(input.strategistBrief),
    input.productTitle && `Product: ${input.productTitle}`,
    factLines.length ? `Verified product facts:\n${factLines.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Research product + brand + trends, then produce an editable strategist brief
 * and concept options for Ad Creator launch.
 */
export async function researchForAdAgent(
  input: AdAgentResearchInput,
  onStage?: (stage: string) => void,
): Promise<AdAgentResearchResult> {
  const goal = input.campaignGoal.trim();
  if (!goal) throw new Error('Enter a campaign goal / creative direction before researching.');
  if (!input.productUrl?.trim() && !input.packshot?.base64) {
    throw new Error('Add a Product URL or upload a product packshot before researching.');
  }

  const platform: SocialPlatform = input.platform || 'instagram_story';
  const assets: StudioAsset[] = [];
  let productTitle = input.packshot?.name.replace(/\.[^.]+$/, '') || 'Product';
  let productFacts: string[] = [];
  let productBase64: string | undefined;
  let productMimeType: string | undefined;

  if (input.packshot?.base64) {
    onStage?.('Using uploaded product packshot');
    const asset = buildStudioAssetFromPackshot(input.packshot);
    assets.push(asset);
    productBase64 = asset.base64;
    productMimeType = asset.mimeType;
  }

  if (input.productUrl?.trim()) {
    onStage?.('Importing product page');
    const imported = await importProductPageAssetsRich(input.productUrl.trim(), '', {
      executionMode: 'balanced',
      analyzeAssets: true,
    });
    productTitle = imported.productTitle || productTitle;
    const knowledge = getProductKnowledge(input.productUrl.trim());
    productFacts = knowledge?.facts?.length
      ? [...knowledge.facts]
      : imported.assets
          .slice(0, 6)
          .map((a) => a.semanticDescription || a.description || '')
          .filter(Boolean);

    if (!assets.length) {
      const hero =
        imported.assets.find((a) => a.quality === 'hero' && a.shotType === 'packshot')
        || imported.assets.find((a) => a.verdict === 'use_as_is' && a.shotType === 'packshot')
        || imported.assets.find((a) => a.quality === 'hero')
        || imported.assets.find((a) => a.verdict === 'use_as_is')
        || imported.assets[0];
      if (hero?.base64) {
        const raw = stripDataUrl(hero.base64);
        const mime = asStudioMime(hero.mimeType || 'image/png');
        assets.push({
          id: `import-${Date.now().toString(36)}`,
          name: (hero.semanticDescription || productTitle).slice(0, 100),
          description: hero.semanticDescription || hero.description || productTitle,
          base64: raw,
          mimeType: mime,
          width: 1024,
          height: 1024,
          source: 'url_import',
          createdAt: new Date().toISOString(),
        });
        productBase64 = raw;
        productMimeType = mime;
      }
    }
  }

  let brandUrls: string[] = [];
  const brandSeed = input.brandUrl?.trim() || input.productUrl?.trim();
  if (brandSeed) {
    try {
      const origin = brandSeed.startsWith('http')
        ? new URL(brandSeed).origin
        : brandSeed;
      brandUrls = normalizeBrandUrls([origin]);
    } catch {
      // Brand research optional when URL is malformed
    }
  }

  onStage?.('Running brand, trend & concept research');
  const copilot = await runCreativeCopilot(
    {
      brandUrls,
      campaignGoal: goal,
      productName: productTitle,
      platform,
      references: assets.map((asset) => ({ assetId: asset.id, role: 'product' as const })),
      assets,
      aspectRatio: platform === 'instagram_feed' ? '1:1' : '9:16',
    },
    onStage,
  );

  const warnings = getCopilotWarnings(copilot);
  const brandName = copilot.brand?.knowledge?.brandName?.value;
  const truthFacts = copilot.productTruth?.verifiedFacts || [];
  if (truthFacts.length) {
    const merged = [...truthFacts, ...productFacts.filter((f) => !truthFacts.includes(f))];
    productFacts = merged.slice(0, 12);
  }
  if (copilot.productTruth?.productName && copilot.productTruth.productName !== 'Unknown product') {
    productTitle = copilot.productTruth.productName;
  }

  const trendTitles = (copilot.trends.result?.insights || [])
    .slice(0, 5)
    .map((insight) => insight.title);
  const topConcept = copilot.concepts.concepts[0] || null;

  // Video formats: convert the still-image concept into short-form video DNA.
  let videoTreatment: AdAgentVideoTreatment | undefined;
  const videoContext = input.videoContext && isVideoAdFormat(input.videoContext.adFormat)
    ? input.videoContext
    : undefined;
  if (videoContext) {
    onStage?.('Directing video treatment (hook · beats · motion)');
    videoTreatment = await generateVideoTreatment({
      campaignGoal: goal,
      productTitle,
      platform: videoContext.agentPlatform,
      durationSec: videoContext.durationSec,
      vibe: videoContext.vibe,
      conceptTitle: topConcept?.title,
      conceptIdea: topConcept?.oneLineIdea,
      conceptHook: topConcept?.hook,
      trendTitles,
      productFacts,
    });
  }

  return {
    productTitle,
    productFacts,
    productBase64,
    productMimeType,
    brandName,
    strategistBrief: copilot.strategistBrief.brief,
    concepts: copilot.concepts.concepts,
    trendTitles,
    warnings,
    videoTreatment,
    videoContext,
    creativeBrief: formatAdAgentCreativeBrief({
      campaignGoal: goal,
      strategistBrief: copilot.strategistBrief.brief,
      concept: topConcept,
      productTitle,
      productFacts,
      brandName,
      trendTitles,
      videoTreatment,
      videoContext,
    }),
  };
}
