import type { Brand, BrandAsset, StoryboardSceneState } from '../types/brand';
import type { BrandKnowledge, ComposerReference, StudioAsset, ProductTruth, EvidenceValue, BrandFont, EvidenceSource } from '../components/AIImageStudio/types';
import { writePrompts, type PromptWriterResult, type PromptWriterSlide } from '../components/AIImageStudio/promptWriterService';
import { resolveFontFamily } from './geminiService';

function ev<T>(value: T, status: 'verified' | 'inferred' = 'inferred'): EvidenceValue<T> {
  return { value, status, confidence: 0.8, sourceIds: [] };
}

export function brandToBrandKnowledge(brand: Brand): BrandKnowledge {
  const dna = brand.dna;
  const fonts: BrandFont[] = [];
  const resolvedFonts = resolveFontFamily(dna?.typography);

  if (dna?.typography?.headingStyle) {
    fonts.push({
      family: resolvedFonts.heading,
      role: 'heading',
      weights: [700, 800],
      source: 'visual_inference',
    });
  }
  if (dna?.typography?.bodyStyle) {
    fonts.push({
      family: resolvedFonts.body,
      role: 'body',
      weights: [400, 500],
      source: 'visual_inference',
    });
  }

  const sources: EvidenceSource[] = [{
    id: 'brand-dna',
    url: brand.websiteUrl,
    label: brand.name,
    capturedAt: brand.updatedAt,
  }];

  return {
    id: brand.id,
    brandName: ev(brand.name, 'verified'),
    sourceUrls: brand.websiteUrl ? [brand.websiteUrl] : [],
    sources,
    fonts: fonts.map(f => ev(f)),
    colors: (dna?.colors?.palette || [dna?.colors?.primary].filter(Boolean) as string[]).map(c => ev(c)),
    logoRules: [],
    visualPrinciples: (dna?.aesthetic || []).map(a => ev(a)),
    toneAttributes: dna?.brandVoice?.tone ? [ev(dna.brandVoice.tone)] : [],
    approvedLanguage: (dna?.brandVoice?.vocabulary || []).map(v => ev(v)),
    prohibitedLanguage: [],
    imageStyle: {
      lighting: [],
      composition: [],
      backgrounds: [],
      textures: dna?.visualSignature ? [ev(dna.visualSignature)] : [],
    },
    updatedAt: brand.updatedAt,
  };
}

export function brandAssetsToStudioAssets(assets: BrandAsset[]): StudioAsset[] {
  return assets
    .filter(a => a.base64 || a.previewUrl)
    .map(a => ({
      id: a.id,
      name: a.sourceProductTitle || a.description?.slice(0, 100) || 'asset',
      description: a.description || '',
      // If base64 is not cached, use previewUrl as a fallback — the prompt writer
      // will send it as inlineData. If neither is available, the asset is skipped.
      base64: a.base64 || (a.previewUrl?.startsWith('data:') ? a.previewUrl.split(',')[1] : '') || '',
      mimeType: (a.mimeType as 'image/png' | 'image/jpeg' | 'image/webp') || 'image/jpeg',
      width: 1080,
      height: 1080,
      source: 'upload' as const,
      createdAt: new Date().toISOString(),
    }));
}

/**
 * Fetch previewUrl images as base64 so they can be sent to the prompt writer.
 * This is needed because brandAssetsToStudioAssets only uses cached base64.
 */
export async function fetchAssetsAsBase64(assets: BrandAsset[]): Promise<BrandAsset[]> {
  const results: BrandAsset[] = [];
  for (const asset of assets) {
    if (asset.base64) {
      results.push(asset);
      continue;
    }
    if (!asset.previewUrl) {
      results.push(asset);
      continue;
    }
    // If previewUrl is already a data URL, extract base64
    if (asset.previewUrl.startsWith('data:')) {
      const base64 = asset.previewUrl.split(',')[1];
      results.push({ ...asset, base64 });
      continue;
    }
    // Try direct fetch
    try {
      const resp = await fetch(asset.previewUrl, { mode: 'cors' });
      if (resp.ok) {
        const blob = await resp.blob();
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.includes(',') ? result.split(',')[1] : result);
          };
          reader.onerror = () => resolve('');
          reader.readAsDataURL(blob);
        });
        if (base64) {
          results.push({ ...asset, base64, mimeType: blob.type || asset.mimeType || 'image/jpeg' });
          continue;
        }
      }
    } catch { /* try proxy */ }
    // Try Jina proxy
    try {
      const proxyUrl = `https://i.jina.ai/${asset.previewUrl}`;
      const resp = await fetch(proxyUrl, { mode: 'cors' });
      if (resp.ok) {
        const blob = await resp.blob();
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.includes(',') ? result.split(',')[1] : result);
          };
          reader.onerror = () => resolve('');
          reader.readAsDataURL(blob);
        });
        if (base64) {
          results.push({ ...asset, base64, mimeType: blob.type || asset.mimeType || 'image/jpeg' });
          continue;
        }
      }
    } catch { /* skip */ }
    results.push(asset);
  }
  return results;
}

export function buildProductTruth(productTitle: string, assets: BrandAsset[]): ProductTruth {
  return {
    id: 'carousel-product-truth',
    productName: productTitle,
    protectedAssetIds: assets.filter(a => a.type === 'product').map(a => a.id),
    preservationRules: ['Preserve exact product packaging, label, logo, and proportions'],
    verifiedFacts: [],
    unresolvedQuestions: [],
    userCorrections: [],
  };
}

export interface CarouselPromptResult {
  slides: PromptWriterSlide[];
  creativeDirection: string;
}

export async function writeCarouselPrompts(
  scenes: StoryboardSceneState[],
  brand: Brand,
  productAssets: BrandAsset[],
  productTitle: string,
): Promise<CarouselPromptResult> {
  // Fetch previewUrl images as base64 so they can be sent to the prompt writer
  const assetsWithBase64 = await fetchAssetsAsBase64(productAssets);
  const studioAssets = brandAssetsToStudioAssets(assetsWithBase64);
  const productRefs: ComposerReference[] = assetsWithBase64
    .filter(a => a.type === 'product' || a.type === 'lifestyle')
    .slice(0, 3)
    .map(a => ({
      assetId: a.id,
      role: 'product' as const,
      strength: 0.8,
      instructions: 'Preserve product identity, packaging, label, and proportions',
    }));

  const brandKnowledge = brandToBrandKnowledge(brand);
  const productTruth = buildProductTruth(productTitle, productAssets);

  const sceneText = scenes.map((s, i) =>
    `Slide ${i + 1}: ${s.text || s.visualDescription || ''}`
  ).join('\n');

  const result: PromptWriterResult = await writePrompts({
    userInstruction: `Create a ${scenes.length}-slide Instagram carousel for ${productTitle}. ${brand.dna?.tagline ? `Brand tagline: "${brand.dna.tagline}".` : ''} Scene guidance:\n${sceneText}`,
    brandKnowledge,
    productTruth,
    composerReferences: productRefs,
    assets: studioAssets,
    aspectRatio: '1:1',
    slideCount: scenes.length,
    useWebSearch: false,
    brandUrl: brand.websiteUrl,
  });

  return {
    slides: result.slides,
    creativeDirection: result.creativeDirection,
  };
}
