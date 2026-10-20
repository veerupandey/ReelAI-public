import { describe, expect, it } from 'vitest';
import { buildSocialPostGrounding, buildSocialPostLockedImageContext, sanitizeSocialCopy } from '../../components/AIImageStudio/socialPostDirectorService';

describe('socialPostDirectorService', () => {
  it('grounds social generation in brand, product truth, concept, and relevant trends', () => {
    const grounding = buildSocialPostGrounding({
      platform: 'instagram_feed',
      objective: 'education',
      heroAssetId: 'matcha',
      supportingAssetIds: [],
      availableReferences: [],
      brandKnowledge: {
        id: 'brand',
        sourceUrls: ['https://kageha.ca'],
        sources: [],
        brandName: { value: 'Kageha', status: 'verified', confidence: 1, sourceIds: [] },
        fonts: [{ value: { family: 'Cormorant Garamond', role: 'heading', weights: [600], source: 'website_css' }, status: 'verified', confidence: 1, sourceIds: [] }],
        colors: [{ value: 'deep matcha green', status: 'verified', confidence: 1, sourceIds: [] }],
        logoRules: [],
        visualPrinciples: [{ value: 'quiet Japanese editorial restraint', status: 'verified', confidence: 1, sourceIds: [] }],
        toneAttributes: [{ value: 'expert and precise', status: 'verified', confidence: 1, sourceIds: [] }],
        approvedLanguage: [{ value: 'shade-grown', status: 'verified', confidence: 1, sourceIds: [] }],
        prohibitedLanguage: [{ value: 'detox miracle', status: 'verified', confidence: 1, sourceIds: [] }],
        imageStyle: {
          lighting: [{ value: 'soft directional daylight', status: 'verified', confidence: 1, sourceIds: [] }],
          composition: [{ value: 'architectural geometry', status: 'verified', confidence: 1, sourceIds: [] }],
          backgrounds: [],
          textures: [],
        },
        updatedAt: '2026-06-09T00:00:00.000Z',
      },
      productTruth: {
        id: 'truth',
        productName: 'Signature Ceremonial Matcha',
        protectedAssetIds: [],
        preservationRules: ['Keep the tin label recognizable'],
        verifiedFacts: ['Stone-milled ceremonial matcha'],
        unresolvedQuestions: [],
        userCorrections: [],
      },
      selectedConcept: {
        id: 'concept',
        title: 'Tana Architecture & Geometry',
        oneLineIdea: 'Explain shade cultivation through layered geometry',
        visualDirection: 'Overhead educational composition with precise green planes',
        hook: 'The structure behind umami',
        brandFitRationale: 'Matches Kageha restraint',
        productTruthNotes: [],
        suggestedReferenceRoles: [],
        sourceTrendInsightIds: ['trend-1'],
        status: 'selected',
      },
      trendResearch: {
        id: 'trends',
        query: 'advanced matcha education',
        insights: [{
          id: 'trend-1',
          title: 'Diagrammatic education',
          description: 'Use visual systems to teach advanced details',
          applicability: 'High',
          risk: 'Low',
          confidence: 1,
          sourceIds: [],
        }],
        sources: [],
        researchedAt: '2026-06-09T00:00:00.000Z',
        expiresAt: '2026-06-16T00:00:00.000Z',
      },
    });

    expect(grounding).toContain('Signature Ceremonial Matcha');
    expect(grounding).toContain('Stone-milled ceremonial matcha');
    expect(grounding).toContain('quiet Japanese editorial restraint');
    expect(grounding).toContain('architectural geometry');
    expect(grounding).toContain('Brand typography');
    expect(grounding).toContain('detox miracle');
    expect(grounding).toContain('Diagrammatic education');
  });

  it('includes locked image analysis in social post grounding', async () => {
    const context = await buildSocialPostLockedImageContext({
      platform: 'instagram_feed',
      objective: 'education',
      heroAssetId: 'matcha',
      supportingAssetIds: [],
      availableReferences: [{ assetId: 'matcha', role: 'product', instructions: 'Preserve the label' }],
      assets: [{
        id: 'matcha',
        name: 'matcha-tin.jpg',
        description: 'Centered tin with open negative space above',
        base64: 'not-a-real-image',
        mimeType: 'image/jpeg',
        width: 1080,
        height: 1350,
        source: 'upload',
        createdAt: '2026-06-09T00:00:00.000Z',
      }],
    });

    expect(context).toContain('matcha-tin.jpg');
    expect(context).toContain('Centered tin with open negative space above');
    expect(context).toContain('Preserve the label');
    expect(context).toContain('1080x1350');
  });

  it('uses only locked product references for social image analysis', async () => {
    const context = await buildSocialPostLockedImageContext({
      platform: 'instagram_feed',
      objective: 'education',
      heroAssetId: 'product',
      supportingAssetIds: ['style'],
      availableReferences: [
        { assetId: 'product', role: 'product' },
        { assetId: 'style', role: 'style' },
      ],
      assets: [
        { id: 'product', name: 'product.jpg', description: 'Product image', base64: '', mimeType: 'image/jpeg', width: 1, height: 1, source: 'upload', createdAt: '' },
        { id: 'style', name: 'style.jpg', description: 'Style image', base64: '', mimeType: 'image/jpeg', width: 1, height: 1, source: 'upload', createdAt: '' },
      ],
    });

    expect(context).toContain('product.jpg');
    expect(context).not.toContain('style.jpg');
  });

  it('removes internal rationale and inappropriate CTA from visible educational copy', () => {
    expect(sanitizeSocialCopy({
      headline: 'Deconstructing the label’s geometric circles',
      supportingText: 'Leans into the Education and Authentic tone by visually celebrating the unique brand identity',
      caption: 'Learn about shade-grown matcha',
      callToAction: 'Shop Now',
      hashtags: ['matcha'],
    }, 'education')).toEqual({
      headline: 'Deconstructing the label’s geometric circles',
      supportingText: undefined,
      caption: 'Learn about shade-grown matcha',
      callToAction: undefined,
      hashtags: ['matcha'],
    });
  });
});
