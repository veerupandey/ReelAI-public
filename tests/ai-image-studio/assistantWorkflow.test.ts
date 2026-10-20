/**
 * End-to-End Assistant Workflow Tests
 *
 * Tests the complete flow from brand research → trend research → concept generation → social post
 * with state transitions and invalidation rules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { researchBrand } from '../../components/AIImageStudio/brandKnowledgeService';
import { researchTrends } from '../../components/AIImageStudio/trendResearchService';
import { generateConcepts } from '../../components/AIImageStudio/conceptDirectorService';
import { createSocialPostDraft } from '../../components/AIImageStudio/socialPostDirectorService';
import { studioReducer, initialState } from '../../components/AIImageStudio/useStudioReducer';
import type {
  BrandKnowledge,
  TrendResearchResult,
  CreativeConcept,
  SocialPostDraft,
  StudioState,
} from '../../components/AIImageStudio/types';

// Mock Gemini services with dynamic responses
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockImplementation((request: any) => {
        const prompt = request.contents?.parts?.[0]?.text || '';

        // Brand research response
        if (prompt.includes('brand research expert')) {
          return Promise.resolve({
            text: JSON.stringify({
              colors: ['#1a1a1a', '#ffffff', '#ff6b6b'],
              fonts: [{ family: 'Inter', role: 'heading', source: 'google_fonts' }],
              visualStyle: ['minimal', 'modern', 'clean'],
              toneAttributes: ['professional', 'friendly', 'approachable'],
              keyPhrases: ['Quality products', 'Customer first'],
              logoDescription: 'Simple geometric logo',
            }),
          });
        }

        // Brand name/logo rules response
        if (prompt.includes('BRAND NAME')) {
          return Promise.resolve({
            text: JSON.stringify({
              brandName: 'Test Brand',
              approvedLanguage: ['Quality first', 'Customer centric', 'Innovative solutions'],
              prohibitedLanguage: ['Cheap', 'Discount'],
              logoRules: ['Maintain clear space', 'Use on light backgrounds'],
            }),
          });
        }

        // Trend research response
        if (prompt.includes('trend research expert')) {
          return Promise.resolve({
            text: JSON.stringify({
              insights: [
                {
                  title: 'Minimal Skincare Aesthetic',
                  description: 'Clean, simple product photography with natural lighting',
                  brandFit: 'High',
                  risk: 'None',
                },
                {
                  title: 'Glow Up Transformation',
                  description: 'Before/after style content showing product results',
                  brandFit: 'Medium',
                  risk: 'Requires testimonials',
                },
              ],
            }),
          });
        }

        // Concept generation response
        if (prompt.includes('creative director')) {
          return Promise.resolve({
            text: JSON.stringify({
              concepts: [
                {
                  title: 'The Minimal Glow',
                  oneLineIdea: 'Show your natural radiance with clean, simple styling',
                  visualDirection: 'Flat lay product shot on marble with soft shadows',
                  brandFitRationale: 'Aligns with minimal aesthetic and professional tone',
                  trendFitRationale: 'Leverages minimal skincare trend',
                  productTruthNotes: ['Show actual product packaging', 'Natural lighting only'],
                },
                {
                  title: 'Morning Ritual',
                  oneLineIdea: 'Start your day with a moment of self-care',
                  visualDirection: 'Lifestyle shot with product in bathroom setting',
                  brandFitRationale: 'Friendly tone resonates with morning routine',
                  trendFitRationale: 'Uses lifestyle trend',
                  productTruthNotes: ['Show product in use context'],
                },
              ],
            }),
          });
        }

        // Social post copy response
        if (prompt.includes('social media copywriter')) {
          return Promise.resolve({
            text: JSON.stringify({
              headline: 'Discover Your Glow',
              supportingText: 'Natural radiance starts here',
              caption: 'Ready to transform your skincare routine? Our products are designed with you in mind. Tap the link in bio to shop now! ✨',
              callToAction: 'Shop Now',
              hashtags: ['skincare', 'glowup', 'minimalbeauty', 'testbrand'],
            }),
          });
        }

        // Default fallback
        return Promise.resolve({ text: '{}' });
      }),
    },
  })),
}));

// Mock crypto.randomUUID
const mockUUID = vi.fn().mockReturnValue('test-uuid-123');
Object.defineProperty(global, 'crypto', {
  value: { randomUUID: mockUUID },
});

describe('Assistant Workflow E2E', () => {
  let state: StudioState;

  beforeEach(() => {
    state = JSON.parse(JSON.stringify(initialState));
    mockUUID.mockClear();
  });

  describe('Brand Research Flow', () => {
    it('should complete full brand research workflow', async () => {
      const progressStages: string[] = [];
      const onProgress = (p: { stage: string; message: string }) => {
        progressStages.push(p.stage);
      };

      const result = await researchBrand(
        { sourceUrls: ['https://example-brand.com'] },
        onProgress,
      );

      // Verify progress stages
      expect(progressStages).toContain('fetching');
      expect(progressStages).toContain('analyzing');
      expect(progressStages).toContain('extracting');
      expect(progressStages).toContain('resolving');
      expect(progressStages).toContain('complete');

      // Verify result structure
      expect(result.knowledge).toBeDefined();
      expect(result.knowledge.brandName.value).toBeDefined();
      expect(result.knowledge.colors.length).toBeGreaterThan(0);
      expect(result.knowledge.fonts.length).toBeGreaterThan(0);
      expect(result.knowledge.toneAttributes.length).toBeGreaterThan(0);
      expect(result.knowledge.visualPrinciples.length).toBeGreaterThan(0);
    });

    it('should dispatch SET_BRAND_KNOWLEDGE action correctly', () => {
      const mockBrandKnowledge: BrandKnowledge = {
        id: 'brand-123',
        sourceUrls: ['https://example.com'],
        sources: [{
          id: 'source-1',
          url: 'https://example.com',
          label: 'example.com',
          capturedAt: new Date().toISOString(),
        }],
        brandName: { value: 'Test Brand', status: 'verified', confidence: 1, sourceIds: ['source-1'] },
        fonts: [],
        colors: [],
        logoRules: [],
        visualPrinciples: [],
        toneAttributes: [],
        approvedLanguage: [],
        prohibitedLanguage: [],
        imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
        updatedAt: new Date().toISOString(),
      };

      const nextState = studioReducer(state, {
        type: 'SET_BRAND_KNOWLEDGE',
        brandKnowledge: mockBrandKnowledge,
      });

      expect(nextState.brandKnowledge).toEqual(mockBrandKnowledge);
    });
  });

  describe('Trend Research Flow', () => {
    it('should complete trend research with brand context', async () => {
      const mockBrand: BrandKnowledge = {
        id: 'brand-123',
        sourceUrls: ['https://example.com'],
        sources: [],
        brandName: { value: 'Test Brand', status: 'verified', confidence: 1, sourceIds: [] },
        fonts: [],
        colors: [],
        logoRules: [],
        visualPrinciples: [{ value: 'minimal', status: 'verified', confidence: 1, sourceIds: [] }],
        toneAttributes: [{ value: 'professional', status: 'verified', confidence: 1, sourceIds: [] }],
        approvedLanguage: [],
        prohibitedLanguage: [],
        imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
        updatedAt: new Date().toISOString(),
      };

      const result = await researchTrends({
        userQuery: 'skincare minimal aesthetic',
        brandKnowledge: mockBrand,
        platform: 'instagram_feed',
      });

      expect(result.result).toBeDefined();
      expect(result.result.query).toBe('skincare minimal aesthetic');
      expect(result.result.insights.length).toBeGreaterThan(0);
      expect(result.result.sources.length).toBeGreaterThan(0);
    });

    it('should dispatch SET_TREND_RESEARCH action correctly', () => {
      const mockTrendResearch: TrendResearchResult = {
        id: 'trend-123',
        query: 'test query',
        insights: [{
          id: 'insight-1',
          title: 'Minimal Skincare',
          description: 'Clean, simple product photography',
          applicability: 'High',
          risk: 'None',
          confidence: 0.8,
          sourceIds: ['source-1'],
        }],
        sources: [{
          id: 'source-1',
          label: 'Gemini Search',
          capturedAt: new Date().toISOString(),
        }],
        researchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const nextState = studioReducer(state, {
        type: 'SET_TREND_RESEARCH',
        trendResearch: mockTrendResearch,
      });

      expect(nextState.trendResearch).toEqual(mockTrendResearch);
    });
  });

  describe('Concept Generation Flow', () => {
    it('should generate concepts with brand and trend context', async () => {
      const mockBrand: BrandKnowledge = {
        id: 'brand-123',
        sourceUrls: ['https://example.com'],
        sources: [],
        brandName: { value: 'Test Brand', status: 'verified', confidence: 1, sourceIds: [] },
        fonts: [],
        colors: [],
        logoRules: [],
        visualPrinciples: [{ value: 'minimal', status: 'verified', confidence: 1, sourceIds: [] }],
        toneAttributes: [{ value: 'professional', status: 'verified', confidence: 1, sourceIds: [] }],
        approvedLanguage: [],
        prohibitedLanguage: [],
        imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
        updatedAt: new Date().toISOString(),
      };

      const mockTrends: TrendResearchResult = {
        id: 'trend-456',
        query: 'skincare trends',
        insights: [{
          id: 'trend-1',
          title: 'Glow Aesthetic',
          description: 'Dewy skin product shots',
          applicability: 'High',
          risk: 'None',
          confidence: 0.8,
          sourceIds: ['source-1'],
        }],
        sources: [],
        researchedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      };

      const result = await generateConcepts({
        brandKnowledge: mockBrand,
        trendResearch: mockTrends,
        userDirection: 'Create an elegant product showcase',
        availableReferences: [],
      });

      expect(result.concepts.length).toBeGreaterThan(0);
      expect(result.concepts[0].title).toBeDefined();
      expect(result.concepts[0].oneLineIdea).toBeDefined();
      expect(result.concepts[0].status).toBe('candidate');
      expect(result.concepts.every(concept => !['Product Hero', 'Lifestyle Moment', 'Trend Forward', 'Proof Point'].some(title => concept.title.startsWith(title)))).toBe(true);
    });

    it('should dispatch SET_CONCEPT_CANDIDATES and clear dependent state', () => {
      // First set up some existing state
      state.conceptCandidates = [
        { id: 'old-1', title: 'Old Concept', oneLineIdea: '', visualDirection: '', hook: '', brandFitRationale: '', trendFitRationale: '', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' },
      ];
      state.selectedConceptId = 'old-1';
      state.socialPostDraft = { id: 'draft-1' } as SocialPostDraft;

      const newConcepts: CreativeConcept[] = [
        { id: 'new-1', title: 'New Concept', oneLineIdea: '', visualDirection: '', hook: '', brandFitRationale: '', trendFitRationale: '', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' },
      ];

      const nextState = studioReducer(state, {
        type: 'SET_CONCEPT_CANDIDATES',
        concepts: newConcepts,
      });

      expect(nextState.conceptCandidates).toEqual(newConcepts);
      expect(nextState.selectedConceptId).toBeUndefined();
      expect(nextState.socialPostDraft).toBeUndefined();
    });

    it('should unselect previous concept when selecting new one', () => {
      state.conceptCandidates = [
        { id: 'concept-1', title: 'Concept 1', oneLineIdea: '', visualDirection: 'Visual 1', hook: '', brandFitRationale: '', trendFitRationale: '', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'selected' },
        { id: 'concept-2', title: 'Concept 2', oneLineIdea: '', visualDirection: 'Visual 2', hook: '', brandFitRationale: '', trendFitRationale: '', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' },
      ];
      state.selectedConceptId = 'concept-1';

      const nextState = studioReducer(state, {
        type: 'SELECT_CONCEPT',
        conceptId: 'concept-2',
      });

      // Previous concept should be unselected
      const prevConcept = nextState.conceptCandidates.find(c => c.id === 'concept-1');
      expect(prevConcept?.status).toBe('candidate');

      // New concept should be selected
      const newConcept = nextState.conceptCandidates.find(c => c.id === 'concept-2');
      expect(newConcept?.status).toBe('selected');
      expect(nextState.selectedConceptId).toBe('concept-2');
    });
  });

  describe('Social Post Flow', () => {
    it('should create social post draft with concept context', async () => {
      const mockBrand: BrandKnowledge = {
        id: 'brand-123',
        sourceUrls: ['https://example.com'],
        sources: [],
        brandName: { value: 'Test Brand', status: 'verified', confidence: 1, sourceIds: [] },
        fonts: [],
        colors: [],
        logoRules: [],
        visualPrinciples: [],
        toneAttributes: [{ value: 'friendly', status: 'verified', confidence: 1, sourceIds: [] }],
        approvedLanguage: [],
        prohibitedLanguage: [],
        imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
        updatedAt: new Date().toISOString(),
      };

      const mockConcept: CreativeConcept = {
        id: 'concept-1',
        title: 'Glow Up Moment',
        oneLineIdea: 'Show the transformation',
        visualDirection: 'Before/after split',
        hook: 'See the difference',
        brandFitRationale: 'Fits brand',
        trendFitRationale: 'Uses glow trend',
        productTruthNotes: [],
        suggestedReferenceRoles: [],
        sourceTrendInsightIds: [],
        status: 'selected',
      };

      const result = await createSocialPostDraft({
        platform: 'instagram_feed',
        objective: 'conversion',
        heroAssetId: 'asset-123',
        supportingAssetIds: [],
        brandKnowledge: mockBrand,
        selectedConcept: mockConcept,
        availableReferences: [],
      });

      expect(result.draft).toBeDefined();
      expect(result.draft.platform).toBe('instagram_feed');
      expect(result.draft.copy.headline).toBeDefined();
      expect(result.draft.copy.caption).toBeDefined();
      expect(result.draft.copy.hashtags.length).toBeGreaterThan(0);
    });

    it('should dispatch SET_SOCIAL_POST_DRAFT action correctly', () => {
      const mockDraft: SocialPostDraft = {
        id: 'draft-123',
        platform: 'instagram_feed',
        objective: 'awareness',
        heroAssetId: 'asset-1',
        supportingAssetIds: [],
        selectedConceptId: 'concept-1',
        copy: {
          headline: 'Test Headline',
          supportingText: 'Test body text',
          caption: 'Test caption',
          callToAction: 'Shop Now',
          hashtags: ['test', 'brand'],
        },
        typography: {
          headingFont: { family: 'Inter', role: 'heading', weights: [400, 700], source: 'google_fonts' },
          bodyFont: { family: 'Inter', role: 'body', weights: [400], source: 'google_fonts' },
        },
        layout: {
          templateId: 'template-1',
          safeZones: ['safe-top', 'safe-bottom'],
        },
        aspectRatio: '1:1',
        generationBrief: 'Create a social post',
      };

      const nextState = studioReducer(state, {
        type: 'SET_SOCIAL_POST_DRAFT',
        draft: mockDraft,
      });

      expect(nextState.socialPostDraft).toEqual(mockDraft);
    });
  });

  describe('Invalidation Rules', () => {
    it('should clear a social draft whenever trend research changes', () => {
      state.socialPostDraft = { id: 'draft-1' } as SocialPostDraft;

      const nextState = studioReducer(state, {
        type: 'SET_TREND_RESEARCH',
        trendResearch: {
          id: 'trend-new',
          query: 'new',
          insights: [],
          sources: [],
          researchedAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
        },
      });

      expect(nextState.socialPostDraft).toBeUndefined();
    });

    it('should invalidate trend-backed concepts when clearing trend research', () => {
      // Setup state with trend-backed concept
      state.trendResearch = {
        id: 'trend-test',
        query: 'test',
        insights: [{ id: 'trend-1', title: 'Trend', description: '', applicability: '', risk: '', confidence: 0.8, sourceIds: [] }],
        sources: [],
        researchedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      };
      state.conceptCandidates = [
        { id: 'concept-1', title: 'Trend Concept', oneLineIdea: '', visualDirection: '', hook: '', brandFitRationale: '', trendFitRationale: '', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: ['trend-1'], status: 'candidate' },
        { id: 'concept-2', title: 'Brand Concept', oneLineIdea: '', visualDirection: '', hook: '', brandFitRationale: '', trendFitRationale: '', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' },
      ];
      state.selectedConceptId = 'concept-1';
      state.socialPostDraft = { id: 'draft-1' } as SocialPostDraft;

      const nextState = studioReducer(state, {
        type: 'CLEAR_TREND_RESEARCH',
      });

      // Trend-backed concept should be stale
      const trendConcept = nextState.conceptCandidates.find(c => c.id === 'concept-1');
      expect(trendConcept?.status).toBe('stale');

      // Non-trend concept should remain
      const brandConcept = nextState.conceptCandidates.find(c => c.id === 'concept-2');
      expect(brandConcept?.status).toBe('candidate');

      // Selection should be cleared (was trend-backed)
      expect(nextState.selectedConceptId).toBeUndefined();

      // Social draft should be cleared
      expect(nextState.socialPostDraft).toBeUndefined();
    });

    it('should preserve non-trend-backed concepts when clearing trends', () => {
      state.trendResearch = {
        id: 'trend-empty',
        query: 'test',
        insights: [],
        sources: [],
        researchedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      };
      state.conceptCandidates = [
        { id: 'concept-1', title: 'Brand Only', oneLineIdea: '', visualDirection: '', hook: '', brandFitRationale: '', trendFitRationale: '', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'selected' },
      ];
      state.selectedConceptId = 'concept-1';

      const nextState = studioReducer(state, {
        type: 'CLEAR_TREND_RESEARCH',
      });

      // Concept without trend backing should remain selected
      const concept = nextState.conceptCandidates.find(c => c.id === 'concept-1');
      expect(concept?.status).toBe('selected');
      expect(nextState.selectedConceptId).toBe('concept-1');
    });
  });

  describe('Full Integration Flow', () => {
    it('should complete full workflow: brand → trends → concepts → social post', async () => {
      // Step 1: Brand Research
      const brandResult = await researchBrand({
        sourceUrls: ['https://test-brand.com'],
      });

      let currentState = studioReducer(state, {
        type: 'SET_BRAND_KNOWLEDGE',
        brandKnowledge: brandResult.knowledge,
      });

      expect(currentState.brandKnowledge).toBeDefined();

      // Step 2: Trend Research
      const trendResult = await researchTrends({
        userQuery: 'minimal product photography',
        brandKnowledge: currentState.brandKnowledge,
        platform: 'instagram_feed',
      });

      currentState = studioReducer(currentState, {
        type: 'SET_TREND_RESEARCH',
        trendResearch: trendResult.result,
      });

      expect(currentState.trendResearch).toBeDefined();

      // Step 3: Concept Generation
      const conceptResult = await generateConcepts({
        brandKnowledge: currentState.brandKnowledge,
        trendResearch: currentState.trendResearch,
        userDirection: 'Create elegant product shots',
        availableReferences: [],
      });

      currentState = studioReducer(currentState, {
        type: 'SET_CONCEPT_CANDIDATES',
        concepts: conceptResult.concepts,
      });

      expect(currentState.conceptCandidates.length).toBeGreaterThan(0);
      expect(currentState.selectedConceptId).toBeUndefined(); // Cleared by SET_CONCEPT_CANDIDATES

      // Step 4: Select a concept
      const firstConceptId = currentState.conceptCandidates[0].id;
      currentState = studioReducer(currentState, {
        type: 'SELECT_CONCEPT',
        conceptId: firstConceptId,
      });

      expect(currentState.selectedConceptId).toBe(firstConceptId);

      // Step 5: Create Social Post
      const socialResult = await createSocialPostDraft({
        platform: 'instagram_feed',
        objective: 'conversion',
        heroAssetId: 'hero-asset-1',
        supportingAssetIds: [],
        brandKnowledge: currentState.brandKnowledge,
        selectedConcept: currentState.conceptCandidates.find(c => c.id === firstConceptId),
        availableReferences: [],
      });

      currentState = studioReducer(currentState, {
        type: 'SET_SOCIAL_POST_DRAFT',
        draft: socialResult.draft,
      });

      expect(currentState.socialPostDraft).toBeDefined();
      expect(currentState.socialPostDraft.platform).toBe('instagram_feed');

      // Verify final state has all components
      expect(currentState.brandKnowledge).toBeDefined();
      expect(currentState.trendResearch).toBeDefined();
      expect(currentState.conceptCandidates.length).toBeGreaterThan(0);
      expect(currentState.selectedConceptId).toBeDefined();
      expect(currentState.socialPostDraft).toBeDefined();
    });

    it('should handle workflow interruption and resumption', async () => {
      // Start workflow
      let currentState = studioReducer(state, {
        type: 'SET_BRAND_KNOWLEDGE',
        brandKnowledge: {
          id: 'brand-1',
          sourceUrls: ['https://example.com'],
          sources: [],
          brandName: { value: 'Brand', status: 'verified', confidence: 1, sourceIds: [] },
          fonts: [],
          colors: [],
          logoRules: [],
          visualPrinciples: [],
          toneAttributes: [],
          approvedLanguage: [],
          prohibitedLanguage: [],
          imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
          updatedAt: new Date().toISOString(),
        },
      });

      currentState = studioReducer(currentState, {
        type: 'SET_TREND_RESEARCH',
        trendResearch: {
          id: 'trend-flow',
          query: 'test',
          insights: [],
          sources: [],
          researchedAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
        },
      });

      // Interrupt: Clear trends
      currentState = studioReducer(currentState, {
        type: 'CLEAR_TREND_RESEARCH',
      });

      // Should still have brand
      expect(currentState.brandKnowledge).toBeDefined();

      // Should not have trends
      expect(currentState.trendResearch).toBeUndefined();

      // Resume: New trend research
      currentState = studioReducer(currentState, {
        type: 'SET_TREND_RESEARCH',
        trendResearch: {
          id: 'trend-resume',
          query: 'new trends',
          insights: [{ id: 'new-trend', title: 'New', description: '', applicability: '', risk: '', confidence: 0.8, sourceIds: [] }],
          sources: [],
          researchedAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
        },
      });

      expect(currentState.trendResearch.query).toBe('new trends');
    });
  });
});
