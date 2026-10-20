import { describe, expect, it } from 'vitest';
import { buildCreativeProductionPrompt } from '../../components/AIImageStudio/creativeContextService';

describe('buildCreativeProductionPrompt', () => {
  it('composes product truth before advisory creative context without changing user direction', () => {
    const userDirection = 'Create a calm hero image';
    const result = buildCreativeProductionPrompt({
      userDirection,
      productTruth: {
        id: 'pt-1',
        productName: 'Kageha Matcha',
        protectedAssetIds: [],
        preservationRules: ['Keep the label legible'],
        verifiedFacts: ['Ceremonial grade matcha'],
        unresolvedQuestions: [],
        userCorrections: [],
      },
      brandKnowledge: {
        id: 'brand-1',
        sourceUrls: ['https://example.com'],
        sources: [{ id: 'source-brand', url: 'https://example.com', label: 'example.com', capturedAt: '2026-06-08T00:00:00.000Z' }],
        brandName: { value: 'Kageha', status: 'verified', confidence: 1, sourceIds: ['source-brand'] },
        fonts: [],
        colors: [{ value: '#ivory', status: 'verified', confidence: 0.9, sourceIds: ['source-brand'] }],
        logoRules: [],
        visualPrinciples: [{ value: 'minimal editorial', status: 'verified', confidence: 0.9, sourceIds: ['source-brand'] }],
        toneAttributes: [{ value: 'quiet and meditative', status: 'verified', confidence: 0.9, sourceIds: ['source-brand'] }],
        approvedLanguage: [{ value: 'made slowly', status: 'verified', confidence: 0.9, sourceIds: ['source-brand'] }],
        prohibitedLanguage: [],
        imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
        updatedAt: '2026-06-08T00:00:00.000Z',
      },
      trendResearch: {
        id: 'trend-1',
        query: 'matcha trends',
        researchedAt: '2026-06-08T00:00:00.000Z',
        expiresAt: '2026-06-15T00:00:00.000Z',
        sources: [{ id: 'source-1', label: 'Gemini', capturedAt: '2026-06-08T00:00:00.000Z' }],
        insights: [{
          id: 'i-1',
          title: 'Tactile surfaces',
          description: 'Use natural texture',
          applicability: 'High',
          risk: 'None',
          confidence: 0.9,
          sourceIds: ['source-1'],
        }],
      } as import('../../components/AIImageStudio/types').TrendResearchResult,
      selectedConcept: {
        id: 'c-1',
        title: 'Quiet ritual',
        oneLineIdea: 'Morning preparation scene',
        visualDirection: 'Soft morning light, minimal styling',
        hook: 'Find your calm',
        brandFitRationale: 'Matches the brand',
        trendFitRationale: '',
        productTruthNotes: ['Keep the label legible'],
        suggestedReferenceRoles: [],
        sourceTrendInsightIds: [],
        status: 'selected' as const,
      },
      outputIntent: 'social_post',
    });

    expect(userDirection).toBe('Create a calm hero image');
    expect(result.indexOf('PRODUCT TRUTH')).toBeLessThan(result.indexOf('USER DIRECTION'));
    expect(result).toContain('Keep the label legible');
    expect(result).toContain('Create a calm hero image');
    expect(result).toContain('Morning preparation scene');
    expect(result).toContain('Tactile surfaces');
    expect(result).toContain('SOCIAL POST OUTPUT');
  });

  it('keeps publish-only caption and hashtags out of the image prompt', () => {
    const result = buildCreativeProductionPrompt({
      userDirection: 'Create a product post',
      outputIntent: 'social_post',
      socialPostDraft: {
        id: 'draft-1',
        platform: 'instagram_feed',
        objective: 'conversion',
        heroAssetId: 'hero',
        supportingAssetIds: [],
        aspectRatio: '4:5',
        layout: { templateId: 'hero', safeZones: [] },
        typography: {},
        copy: {
          headline: 'A quiet ritual',
          caption: 'Shop our ceremonial matcha today',
          callToAction: 'Link in bio',
          hashtags: ['#matcha'],
        },
        generationBrief: 'Minimal matcha product scene',
      },
    });

    expect(result).toContain('Minimal matcha product scene');
    expect(result).toContain('A quiet ritual');
    expect(result).not.toContain('Shop our ceremonial matcha today');
    expect(result).not.toContain('#matcha');
    expect(result).toContain('Do not render captions');
  });

  it('uses generation brief as primary prompt for social posts without redundant user direction', () => {
    const result = buildCreativeProductionPrompt({
      userDirection: 'Create an advanced educational matcha post',
      outputIntent: 'social_post',
      socialPostDraft: {
        id: 'draft-1',
        platform: 'instagram_feed',
        objective: 'education',
        heroAssetId: 'hero',
        supportingAssetIds: [],
        aspectRatio: '4:5',
        layout: { templateId: 'hero', safeZones: [] },
        typography: {},
        copy: { headline: 'Shade changes flavor', caption: '', hashtags: [] },
        generationBrief: 'Internal description based on locked-image analysis',
      },
    });

    // Generation brief is the primary specification for social posts
    expect(result).toContain('SOCIAL POST PRODUCTION SPECIFICATION\nInternal description based on locked-image analysis');
    // User direction from the prompt box should NOT appear — it's leftover from concept selection
    expect(result).not.toContain('USER DIRECTION');
    // Social post output section should be included for text control
    expect(result).toContain('SOCIAL POST OUTPUT');
  });

  it('handles empty optional concept and social fields without throwing', () => {
    expect(() => buildCreativeProductionPrompt({
      userDirection: 'Create a product image',
      selectedConcept: {
        id: 'concept-1',
        title: 'Simple hero',
        oneLineIdea: 'Clean product image',
        visualDirection: 'Centered composition',
        brandFitRationale: 'On brand',
        productTruthNotes: [],
        suggestedReferenceRoles: [],
        sourceTrendInsightIds: [],
        status: 'selected',
      },
      socialPostDraft: {
        id: 'draft-1',
        platform: 'instagram_feed',
        objective: 'awareness',
        heroAssetId: 'hero',
        supportingAssetIds: [],
        aspectRatio: '4:5',
        layout: { templateId: 'hero', safeZones: [] },
        typography: {},
        copy: { headline: 'Headline', caption: '', hashtags: [] },
        generationBrief: 'Clean product image',
      },
      outputIntent: 'social_post',
    })).not.toThrow();
  });

  it('applies complete non-rejected brand aesthetics to generation', () => {
    const result = buildCreativeProductionPrompt({
      userDirection: 'Create hero',
      brandKnowledge: {
        id: 'brand',
        sourceUrls: [],
        sources: [],
        brandName: { value: 'Kageha', status: 'verified', confidence: 1, sourceIds: [] },
        fonts: [{ value: { family: 'Cormorant Garamond', role: 'heading', weights: [400, 600], source: 'website_css' }, status: 'verified', confidence: 1, sourceIds: [] }],
        colors: [],
        logoRules: [{ value: 'Keep clear space', status: 'verified', confidence: 1, sourceIds: [] }],
        visualPrinciples: [],
        toneAttributes: [],
        approvedLanguage: [],
        prohibitedLanguage: [{ value: 'cheap', status: 'verified', confidence: 1, sourceIds: [] }],
        imageStyle: {
          lighting: [{ value: 'soft daylight', status: 'verified', confidence: 1, sourceIds: [] }],
          composition: [],
          backgrounds: [{ value: 'warm ivory', status: 'verified', confidence: 1, sourceIds: [] }],
          textures: [],
        },
        updatedAt: '',
      },
    });

    expect(result).toContain('Cormorant Garamond');
    expect(result).toContain('Keep clear space');
    expect(result).toContain('Avoid language: cheap');
    expect(result).toContain('soft daylight');
    expect(result).toContain('warm ivory');
  });
});
