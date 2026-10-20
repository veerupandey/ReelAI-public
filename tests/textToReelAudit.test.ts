import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
  Modality: {
    AUDIO: 'AUDIO',
  },
  Type: {
    ARRAY: 'ARRAY',
    BOOLEAN: 'BOOLEAN',
    NUMBER: 'NUMBER',
    OBJECT: 'OBJECT',
    STRING: 'STRING',
  },
}));

import { generateReelPlan, analyzeMediaAndCreateScript } from '../services/geminiService';
import { mapBrandAssetsToVisuals } from '../services/campaignBlueprintService';
import { BrandMemory, Brand } from '../types/brand';

describe('Text-to-Reel Audit Refactor Tests', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  describe('geminiService (Eco Mode / skipQA)', () => {
    it('generateReelPlan skips reviewAndRefineReelPlan when skipQA is true', async () => {
      // Mock the initial plan generation to return a valid plan
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
            topic: 'Test Topic',
            vibe: 'Test Vibe',
            strategicReasoning: 'Test',
            scenes: Array.from({ length: 7 }, (_, i) => ({
                sceneNumber: i + 1,
                visualDescription: 'Test',
                durationSec: 4,
            })),
            suggestedSpeed: 1,
        }),
        usageMetadata: {},
      });

      // skipQA is the 9th parameter.
      // (topic, trendReport, researchReport, viralReport, brandContext, musicContext, durationOverride, context, skipQA)
      const plan = await generateReelPlan(
        'Test Topic',
        { viralHooks: [], visualStyle: '', trendingAudio: '', optimalDuration: 30 },
        { keyFacts: [], commonMyths: [], depthScore: 0 },
        { winningFormat: '', visualHooks: [], audioSignature: '', mistakesToAvoid: [] },
        undefined,
        undefined,
        undefined,
        undefined,
        true // skipQA = true
      );

      expect(plan.scenes.length).toBe(7);
      // It should only be called once for the initial plan.
      // If skipQA was false, it would be called twice (initial + review).
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('generateReelPlan calls reviewAndRefineReelPlan when skipQA is false', async () => {
        // Mock the initial plan generation
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
              topic: 'Test Topic',
              vibe: 'Test Vibe',
              scenes: Array.from({ length: 7 }, (_, i) => ({ sceneNumber: i + 1, visualDescription: 'Test', durationSec: 4 })),
          }),
          usageMetadata: {},
        });
        
        // Mock the reviewAndRefineReelPlan generation
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
              topic: 'Test Topic',
              vibe: 'Test Vibe',
              scenes: Array.from({ length: 7 }, (_, i) => ({ sceneNumber: i + 1, visualDescription: 'Reviewed Test', durationSec: 4 })),
          }),
          usageMetadata: {},
        });
  
        const plan = await generateReelPlan(
          'Test Topic',
          { viralHooks: [], visualStyle: '', trendingAudio: '', optimalDuration: 30 },
          { keyFacts: [], commonMyths: [], depthScore: 0 },
          { winningFormat: '', visualHooks: [], audioSignature: '', mistakesToAvoid: [] },
          undefined,
          undefined,
          undefined,
          undefined,
          false // skipQA = false
        );
  
        expect(plan.scenes.length).toBe(7);
        expect(plan.scenes[0].visualDescription).toBe('Reviewed Test');
        // Initial + review
        expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('analyzeMediaAndCreateScript skips reviewAndRefineReelScript when skipQA is true', async () => {
        // Mock the initial script generation
        mockGenerateContent.mockResolvedValueOnce({
          text: JSON.stringify({
              fullText: 'Test',
              segments: ['Test'],
              segmentPlans: [{ index: 0, onScreenText: 'Test', voiceoverText: 'Test', visualBeat: 'Test', durationSec: 4 }]
          }),
          usageMetadata: {},
        });
  
        // skipQA is 5th param
        // (mediaItems, userPrompt, style, userMusicVibe, skipQA)
        await analyzeMediaAndCreateScript(
          [{ file: new File([], 'test'), base64: 'test', mimeType: 'image/jpeg', id: '1', previewUrl: 'test' }],
          'Test Prompt',
          'Professional' as any,
          undefined,
          true // skipQA = true
        );
  
        // It should only be called once for the initial script.
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('campaignBlueprintService (mapBrandAssetsToVisuals)', () => {
    it('maps brand memory assets to MappedVisualAsset correctly', () => {
        const brandMemory: BrandMemory = {
            brandId: 'b1',
            name: 'Test Brand',
            assets: [
                {
                    assetId: 'a1',
                    brandAssetId: 'a1',
                    type: 'logo',
                    origin: 'uploaded',
                    mimeType: 'image/png',
                    description: 'Test Logo',
                    productIdentity: 'Identity 1',
                    previewUrl: 'http://test.com/logo.png',
                }
            ],
            approvedClaims: [],
            evidenceSummary: [],
        };

        const brand: Brand = {
            id: 'b1',
            name: 'Test Brand',
            assets: [
                {
                    id: 'a1',
                    type: 'logo',
                    mimeType: 'image/png',
                    base64: 'mockbase64',
                    description: 'Test Logo',
                    previewUrl: 'http://test.com/logo.png',
                }
            ],
        };

        const result = mapBrandAssetsToVisuals(brandMemory, brand);

        expect(result.length).toBe(1);
        expect(result[0].assetId).toBe('a1');
        expect(result[0].base64).toBe('mockbase64');
        expect(result[0].mimeType).toBe('image/png');
        expect(result[0].previewUrl).toBe('http://test.com/logo.png');
        expect(result[0].productIdentity).toBe('Identity 1');
        expect(result[0].shotType).toBe('logo');
    });

    it('returns an empty array if brandMemory has no assets', () => {
        const brandMemory: BrandMemory = {
            brandId: 'b1',
            name: 'Test Brand',
            assets: [],
            approvedClaims: [],
            evidenceSummary: [],
        };
        const result = mapBrandAssetsToVisuals(brandMemory, null);
        expect(result).toEqual([]);
    });
  });
});
