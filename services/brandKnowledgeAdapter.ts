/**
 * Shared Brand DNA adapters between Image Studio BrandKnowledge and Brand entity shapes.
 */

import type { Brand, BrandDNA } from '../types/brand';
import type { BrandKnowledge } from '../components/AIImageStudio/types';
import { updateBrandDNA } from './brandService';

function unwrapStrings(
  values: Array<{ value: string }> | undefined,
): string[] {
  return (values ?? []).map((v) => v.value).filter(Boolean);
}

/** Persist BrandKnowledge into Brand DNA when a Brand entity id is known. */
export function persistBrandKnowledge(
  brand: Brand | null | undefined,
  brandKnowledge: BrandKnowledge | null | undefined,
): string | undefined {
  if (!brand?.id || !brandKnowledge) return undefined;
  const merged = mergeBrandKnowledgeIntoBrandDNA(brand.dna ?? null, brandKnowledge);
  updateBrandDNA(brand.id, merged);
  return brand.id;
}

/**
 * Partial overlay: merge BrandKnowledge into existing BrandDNA without wiping
 * fields Knowledge cannot represent (products, audience, market, etc.).
 */
export function mergeBrandKnowledgeIntoBrandDNA(
  existing: BrandDNA | null,
  knowledge: BrandKnowledge,
): BrandDNA {
  const colors = unwrapStrings(knowledge.colors);
  const principles = unwrapStrings(knowledge.visualPrinciples);
  const tone = unwrapStrings(knowledge.toneAttributes);
  const vocabulary = unwrapStrings(knowledge.approvedLanguage);
  const headingFont = knowledge.fonts.find((f) => f.value.role === 'heading' || f.value.role === 'display');
  const bodyFont = knowledge.fonts.find((f) => f.value.role === 'body');
  const textures = unwrapStrings(knowledge.imageStyle.textures);

  const base: BrandDNA = existing ?? {
    colors: {
      primary: colors[0] || '#000000',
      secondary: colors[1] || '#FFFFFF',
      accent: colors[2] || '#6B7280',
      palette: colors.length > 0 ? colors : ['#000000', '#FFFFFF'],
      reasoning: 'Merged from Image Studio Brand Knowledge',
    },
    typography: {
      headingStyle: headingFont?.value.family || 'Sans-serif',
      bodyStyle: bodyFont?.value.family || headingFont?.value.family || 'Sans-serif',
      characterTraits: '',
    },
    visualSignature: textures[0] || principles[0] || '',
    aesthetic: principles,
    brandVoice: {
      tone: tone[0] || 'Professional',
      personality: '',
      vocabulary,
    },
    tagline: '',
    valuePropositions: [],
    targetAudience: {
      demographics: '',
      psychographics: '',
      painPoints: [],
    },
    products: [],
    keyIngredients: [],
    instagramAesthetic: '',
    contentPillars: [],
    topPerformingPatterns: [],
    postingFrequency: '',
    competitorInsights: '',
    differentiators: [],
    marketPosition: '',
  };

  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors[0] || base.colors.primary,
      secondary: colors[1] || base.colors.secondary,
      accent: colors[2] || base.colors.accent,
      palette: colors.length > 0 ? colors : base.colors.palette,
      reasoning:
        colors.length > 0
          ? 'Updated from Image Studio Brand Knowledge'
          : base.colors.reasoning,
    },
    typography: {
      ...base.typography,
      headingStyle: headingFont?.value.family || base.typography.headingStyle,
      bodyStyle:
        bodyFont?.value.family ||
        headingFont?.value.family ||
        base.typography.bodyStyle,
    },
    visualSignature: textures[0] || base.visualSignature,
    aesthetic: principles.length > 0 ? principles : base.aesthetic,
    brandVoice: {
      ...base.brandVoice,
      tone: tone[0] || base.brandVoice.tone,
      vocabulary: vocabulary.length > 0 ? vocabulary : base.brandVoice.vocabulary,
    },
  };
}
