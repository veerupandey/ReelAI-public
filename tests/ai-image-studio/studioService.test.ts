import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildGenerateRequest,
  buildEditRequest,
  buildCompositeRequest,
  buildStudioGenerationRequest,
  generateStudioImage,
  enhanceStudioPrompt,
} from '../../components/AIImageStudio/studioService';
import type { StudioAsset, RoleAssignment, ComposerReference, StudioDocument } from '../../components/AIImageStudio/types';

// Mock the geminiService module
vi.mock('../../services/geminiService', () => ({
  generateImageAsset: vi.fn(),
  enhanceImagePrompt: vi.fn(),
}));

import { generateImageAsset, enhanceImagePrompt } from '../../services/geminiService';

const mockGenerateImageAsset = vi.mocked(generateImageAsset);
const mockEnhanceImagePrompt = vi.mocked(enhanceImagePrompt);

function createMockAsset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: 'asset-1',
    name: 'Test Asset',
    description: 'A test asset',
    base64: 'dGVzdGRhdGE=',
    mimeType: 'image/png',
    width: 1080,
    height: 1920,
    source: 'upload',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildGenerateRequest', () => {
  it('builds a generate request with mode "generate" and no references', () => {
    const request = buildGenerateRequest('A beautiful sunset', '16:9');

    expect(request).toEqual({
      mode: 'generate',
      imagePrompt: 'A beautiful sunset',
      aspectRatio: '16:9',
    });
  });

  it('uses the provided aspect ratio', () => {
    const request = buildGenerateRequest('test prompt', '1:1');
    expect(request.aspectRatio).toBe('1:1');
  });
});

describe('buildEditRequest', () => {
  it('builds an edit request with mode "edit" and primaryReference', () => {
    const asset = createMockAsset({ base64: 'abc123', mimeType: 'image/jpeg' });
    const request = buildEditRequest('Enhance the lighting', '9:16', asset);

    expect(request).toEqual({
      mode: 'edit',
      imagePrompt: 'Enhance the lighting',
      aspectRatio: '9:16',
      primaryReference: {
        data: 'abc123',
        mimeType: 'image/jpeg',
      },
    });
  });
});

describe('buildCompositeRequest', () => {
  it('builds a composite request with references from selection assets', () => {
    const assets = [
      createMockAsset({ id: 'a1', base64: 'data1', mimeType: 'image/png' }),
      createMockAsset({ id: 'a2', base64: 'data2', mimeType: 'image/jpeg' }),
    ];

    const roleAssignments = new Map<string, RoleAssignment>([
      ['a1', { role: 'product', preserve: 'label', modify: 'background' }],
      ['a2', { role: 'environment' }],
    ]);

    const request = buildCompositeRequest('Group shot', '4:5', assets, roleAssignments);

    expect(request.mode).toBe('composite');
    expect(request.imagePrompt).toBe('Group shot');
    expect(request.aspectRatio).toBe('4:5');
    expect(request.references).toHaveLength(2);
    expect(request.references![0]).toEqual({
      input: { data: 'data1', mimeType: 'image/png' },
      role: 'product',
      preserve: ['label'],
      modify: 'background',
    });
    expect(request.references![1]).toEqual({
      input: { data: 'data2', mimeType: 'image/jpeg' },
      role: 'environment',
      preserve: undefined,
      modify: undefined,
    });
  });

  it('defaults to "product" role when no assignment exists', () => {
    const assets = [
      createMockAsset({ id: 'a1', base64: 'data1' }),
      createMockAsset({ id: 'a2', base64: 'data2' }),
    ];

    const roleAssignments = new Map<string, RoleAssignment>();
    const request = buildCompositeRequest('test', '1:1', assets, roleAssignments);

    expect(request.references![0].role).toBe('product');
    expect(request.references![1].role).toBe('product');
  });
});

describe('generateStudioImage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('generates a fresh image with no references', async () => {
    mockGenerateImageAsset.mockResolvedValue('generatedBase64Data');

    const resultPromise = generateStudioImage({
      prompt: 'A cat on a couch',
      creativeRoute: 'generate_fresh',
      aspectRatio: '9:16',
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ base64: 'generatedBase64Data', mimeType: 'image/png' });
    expect(mockGenerateImageAsset).toHaveBeenCalledWith({
      mode: 'generate',
      imagePrompt: 'A cat on a couch',
      aspectRatio: '9:16',
    });
  });

  it('generates an AI upgrade with base asset as primaryReference', async () => {
    const baseAsset = createMockAsset({ base64: 'baseData', mimeType: 'image/png' });
    mockGenerateImageAsset.mockResolvedValue('upgradedBase64');

    const resultPromise = generateStudioImage({
      prompt: 'Enhance quality',
      creativeRoute: 'ai_upgrade',
      aspectRatio: '1:1',
      baseAsset,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.base64).toBe('upgradedBase64');
    expect(mockGenerateImageAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'edit',
        primaryReference: { data: 'baseData', mimeType: 'image/png' },
      })
    );
  });

  it('generates a composite with selection assets and role assignments', async () => {
    const assets = [
      createMockAsset({ id: 'a1', base64: 'd1' }),
      createMockAsset({ id: 'a2', base64: 'd2' }),
    ];
    const roles = new Map<string, RoleAssignment>([
      ['a1', { role: 'product' }],
      ['a2', { role: 'person', preserve: 'face' }],
    ]);

    mockGenerateImageAsset.mockResolvedValue('compositeBase64');

    const resultPromise = generateStudioImage({
      prompt: 'Group shot',
      creativeRoute: 'composite',
      aspectRatio: '16:9',
      selectionAssets: assets,
      roleAssignments: roles,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.base64).toBe('compositeBase64');
    expect(mockGenerateImageAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'composite',
        references: expect.arrayContaining([
          expect.objectContaining({ role: 'product' }),
          expect.objectContaining({ role: 'person', preserve: ['face'] }),
        ]),
      })
    );
  });

  it('throws when ai_upgrade is called without a base asset', async () => {
    await expect(
      generateStudioImage({
        prompt: 'Enhance',
        creativeRoute: 'ai_upgrade',
        aspectRatio: '9:16',
      })
    ).rejects.toThrow('requires a base asset');
  });

  it('throws when composite is called with fewer than 2 assets', async () => {
    await expect(
      generateStudioImage({
        prompt: 'Composite',
        creativeRoute: 'composite',
        aspectRatio: '9:16',
        selectionAssets: [createMockAsset()],
      })
    ).rejects.toThrow('requires at least 2 selection assets');
  });

  it('times out after 60 seconds', async () => {
    mockGenerateImageAsset.mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    const resultPromise = generateStudioImage({
      prompt: 'Slow generation',
      creativeRoute: 'generate_fresh',
      aspectRatio: '9:16',
    });

    vi.advanceTimersByTime(60_000);

    await expect(resultPromise).rejects.toThrow('Generation timed out after 60 seconds');
  });
});

describe('enhanceStudioPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('enhances a prompt and returns the result', async () => {
    mockEnhanceImagePrompt.mockResolvedValue({ enhancedPrompt: 'Enhanced: professional lighting, bokeh background' });

    const resultPromise = enhanceStudioPrompt({
      rawPrompt: 'A product photo',
      creativeRoute: 'generate_fresh',
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.enhancedPrompt).toBe('Enhanced: professional lighting, bokeh background');
    expect(mockEnhanceImagePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        rawPrompt: 'A product photo',
        route: 'generate_fresh',
        baseImageBase64: undefined,
        baseImageMimeType: undefined,
      })
    );
  });

  it('passes base asset data for edit/upgrade routes', async () => {
    const baseAsset = createMockAsset({ base64: 'imgData', mimeType: 'image/jpeg' });
    mockEnhanceImagePrompt.mockResolvedValue({ enhancedPrompt: 'Enhanced prompt' });

    const resultPromise = enhanceStudioPrompt({
      rawPrompt: 'Improve this',
      creativeRoute: 'ai_upgrade',
      baseAsset,
    });

    await vi.runAllTimersAsync();
    await resultPromise;

    expect(mockEnhanceImagePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'upgrade_existing',
        baseImageBase64: 'imgData',
        baseImageMimeType: 'image/jpeg',
      })
    );
  });

  it('maps creative routes correctly to enhancement routes', async () => {
    mockEnhanceImagePrompt.mockResolvedValue({ enhancedPrompt: 'enhanced' });

    // Test composite mapping
    const p1 = enhanceStudioPrompt({ rawPrompt: 'test', creativeRoute: 'composite' });
    await vi.runAllTimersAsync();
    await p1;
    expect(mockEnhanceImagePrompt).toHaveBeenLastCalledWith(
      expect.objectContaining({ route: 'composite_product' })
    );

    // Test edit mapping
    const p2 = enhanceStudioPrompt({ rawPrompt: 'test', creativeRoute: 'edit' });
    await vi.runAllTimersAsync();
    await p2;
    expect(mockEnhanceImagePrompt).toHaveBeenLastCalledWith(
      expect.objectContaining({ route: 'use_existing' })
    );
  });

  it('times out after 45 seconds', async () => {
    mockEnhanceImagePrompt.mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    const resultPromise = enhanceStudioPrompt({
      rawPrompt: 'Slow enhancement',
      creativeRoute: 'generate_fresh',
    });

    vi.advanceTimersByTime(45_000);

    await expect(resultPromise).rejects.toThrow('Enhancement timed out after 45 seconds');
  });

  it('forwards brand aesthetics brief, intent, and reference images', async () => {
    mockEnhanceImagePrompt.mockResolvedValue({ enhancedPrompt: 'On-brand enhanced' });

    const resultPromise = enhanceStudioPrompt({
      rawPrompt: 'Recreate this carousel',
      creativeRoute: 'generate_fresh',
      brandName: 'Kageha',
      brandAestheticsBrief: 'Palette: #4a7c59\nLighting: soft window light',
      intent: 'recreate_reference',
      intentRationale: 'Prompt asks to recreate',
      intentDirectives: ['Preserve structure; adapt look'],
      referenceImages: [
        { base64: 'abc123', mimeType: 'image/jpeg', role: 'product', label: 'Tin' },
      ],
      referenceRoles: ['product'],
      referenceImageCount: 1,
    });

    await vi.runAllTimersAsync();
    await resultPromise;

    expect(mockEnhanceImagePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        brandName: 'Kageha',
        brandAestheticsBrief: 'Palette: #4a7c59\nLighting: soft window light',
        intent: 'recreate_reference',
        referenceImages: [
          expect.objectContaining({ role: 'product', base64: 'abc123' }),
        ],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 1.2: buildStudioGenerationRequest
// ---------------------------------------------------------------------------

describe('buildStudioGenerationRequest', () => {
  function makeAsset(id: string, overrides: Partial<StudioAsset> = {}): StudioAsset {
    return {
      id,
      name: `Asset ${id}`,
      description: '',
      base64: `data-${id}`,
      mimeType: 'image/png',
      width: 100,
      height: 100,
      source: 'upload',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  const baseState = {
    prompt: 'test prompt',
    aspectRatio: '9:16' as const,
    composerReferences: [] as ComposerReference[],
    activeDocument: undefined as StudioDocument | undefined,
    assets: [] as StudioAsset[],
    productTruth: undefined,
    brandKnowledge: undefined,
    trendResearch: undefined,
    conceptCandidates: [],
    selectedConceptId: undefined,
    socialPostDraft: undefined,
    outputIntent: 'image' as const,
  };

  describe('generate operation', () => {
    it('builds a plain generate request when no references and no active document', () => {
      const request = buildStudioGenerationRequest(baseState);
      expect(request.mode).toBe('generate');
      expect(request.imagePrompt).toBe('test prompt');
      expect(request.aspectRatio).toBe('9:16');
    });

    it('builds a composite request with product references in generate mode', () => {
      const asset = makeAsset('a1');
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [asset],
        composerReferences: [{ assetId: 'a1', role: 'product' }],
      });
      expect(request.mode).toBe('composite');
      expect(request.references).toHaveLength(1);
      expect(request.references![0].role).toBe('product');
      expect(request.references![0].modify).toContain('visual identity');
    });

    it('treats include references as locked products that must appear', () => {
      const asset = makeAsset('a1');
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [asset],
        composerReferences: [{ assetId: 'a1', role: 'include' }],
      });
      expect(request.references![0].role).toBe('product');
      expect(request.references![0].preserve).toContain('product_identity');
      expect(request.references![0].modify).toContain('should appear naturally');
    });

    it('includes product preservation rules for product references', () => {
      const asset = makeAsset('a1');
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [asset],
        composerReferences: [{ assetId: 'a1', role: 'product' }],
      });
      expect(request.references![0].preserve).toContain('product_identity');
    });

    it('does not add preserve rules for style references', () => {
      const asset = makeAsset('a1');
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [asset],
        composerReferences: [{ assetId: 'a1', role: 'style' }],
      });
      expect(request.mode).toBe('composite');
      expect(request.references![0].preserve).toBeUndefined();
    });

    it('keeps include and composition references in ordinary generation', () => {
      const include = makeAsset('include');
      const composition = makeAsset('composition');
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [include, composition],
        composerReferences: [
          { assetId: 'include', role: 'include' },
          { assetId: 'composition', role: 'composition' },
        ],
      });

      expect(request.mode).toBe('composite');
      expect(request.references).toHaveLength(2);
    });

    it('uses actual Product Truth rules and composes brand context into the request prompt', () => {
      const product = makeAsset('product');
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [product],
        composerReferences: [{ assetId: 'product', role: 'product' }],
        productTruth: {
          id: 'pt-1',
          productName: 'Test Product',
          protectedAssetIds: ['product'],
          preservationRules: ['Keep exact gold label'],
          verifiedFacts: ['Contains green tea'],
          unresolvedQuestions: [],
          userCorrections: [],
        },
        brandKnowledge: {
          id: 'brand-1',
          sourceUrls: [],
          sources: [],
          brandName: { value: 'Test Brand', status: 'verified' as const, confidence: 1, sourceIds: [] },
          fonts: [],
          colors: [{ value: 'green', status: 'inferred' as const, confidence: 0.8, sourceIds: [] }],
          logoRules: [],
          visualPrinciples: [{ value: 'minimal', status: 'verified' as const, confidence: 1, sourceIds: [] }],
          toneAttributes: [{ value: 'calm', status: 'verified' as const, confidence: 1, sourceIds: [] }],
          approvedLanguage: [],
          prohibitedLanguage: [],
          imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
          updatedAt: '2026-06-08T00:00:00.000Z',
        },
      });

      expect(request.references![0].preserve).toContain('Keep exact gold label');
      expect(request.imagePrompt).toContain('Contains green tea');
      expect(request.imagePrompt).toContain('Test Brand');
    });

    it('ignores references whose assetId has no matching asset', () => {
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [],
        composerReferences: [{ assetId: 'missing', role: 'product' }],
      });
      expect(request.mode).toBe('generate');
    });
  });

  describe('edit operation', () => {
    it('builds an edit request when an active document is present', () => {
      const asset = makeAsset('a1');
      const doc: StudioDocument = {
        id: 'doc-1',
        rootAssetId: 'a1',
        activeVersionId: 'v1',
        versionIds: ['v1'],
      };
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [asset],
        activeDocument: doc,
      });
      expect(request.mode).toBe('edit');
      expect(request.primaryReference?.data).toBe('data-a1');
    });

    it('throws when active document root asset is not in session', () => {
      const doc: StudioDocument = {
        id: 'doc-1',
        rootAssetId: 'missing',
        activeVersionId: 'v1',
        versionIds: ['v1'],
      };
      expect(() =>
        buildStudioGenerationRequest({
          ...baseState,
          assets: [],
          activeDocument: doc,
        }),
      ).toThrow('Active document root asset not found');
    });
  });

  describe('composite operation', () => {
    it('builds a composite request when two or more include references are present', () => {
      const assets = [makeAsset('a1'), makeAsset('a2')];
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets,
        composerReferences: [
          { assetId: 'a1', role: 'include' },
          { assetId: 'a2', role: 'include' },
        ],
      });
      expect(request.mode).toBe('composite');
      expect(request.references).toHaveLength(2);
    });

    it('throws when composite references resolve to fewer than 2 matched assets', () => {
      const assets = [makeAsset('a1')];
      expect(() =>
        buildStudioGenerationRequest({
          ...baseState,
          assets,
          composerReferences: [
            { assetId: 'a1', role: 'include' },
            { assetId: 'missing', role: 'include' },
          ],
        }),
      ).toThrow('Composite requires at least 2 references');
    });

    it('includes all reference roles in composite mode', () => {
      const assets = [makeAsset('a1'), makeAsset('a2'), makeAsset('a3')];
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets,
        composerReferences: [
          { assetId: 'a1', role: 'include' },
          { assetId: 'a2', role: 'include' },
          { assetId: 'a3', role: 'product' },
        ],
      });
      expect(request.references).toHaveLength(3);
    });
  });

  describe('social post operation', () => {
    function makeDraft(overrides: Partial<import('../../components/AIImageStudio/types').SocialPostDraft> = {}) {
      return {
        id: 'draft-1',
        platform: 'instagram_feed' as const,
        objective: 'conversion' as const,
        heroAssetId: 'hero',
        supportingAssetIds: ['support'],
        aspectRatio: '1:1' as const,
        layout: { templateId: 'feed_centered', safeZones: [] },
        typography: {},
        copy: { headline: 'Headline', caption: 'Caption', hashtags: [] },
        generationBrief: 'SOCIAL POST GENERATION BRIEF',
        ...overrides,
      };
    }

    it('uses the social draft aspect ratio when output intent is social_post', () => {
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [makeAsset('hero'), makeAsset('support')],
        socialPostDraft: makeDraft(),
        outputIntent: 'social_post',
      });
      expect(request.aspectRatio).toBe('1:1');
    });

    it('attaches the draft hero and supporting assets as locked product references even with no composer references', () => {
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [makeAsset('hero'), makeAsset('support')],
        socialPostDraft: makeDraft(),
        outputIntent: 'social_post',
      });
      expect(request.mode).toBe('composite');
      expect(request.references).toHaveLength(2);
      expect(request.references!.every(r => r.role === 'product')).toBe(true);
      expect(request.references![0].preserve).toContain('product_identity');
    });

    it('does not duplicate draft assets already present as composer references', () => {
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [makeAsset('hero'), makeAsset('support')],
        composerReferences: [{ assetId: 'hero', role: 'product' }],
        socialPostDraft: makeDraft(),
        outputIntent: 'social_post',
      });
      expect(request.references).toHaveLength(2);
    });

    it('allows the draft headline and CTA copy to be rendered on-image', () => {
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [makeAsset('hero'), makeAsset('support')],
        socialPostDraft: makeDraft({
          copy: { headline: 'A quiet ritual', supportingText: 'Slow mornings', caption: 'publish-only caption', callToAction: 'Shop Now', hashtags: ['#matcha'] },
        }),
        outputIntent: 'social_post',
      });
      expect(request.allowedOnImageText).toEqual(['A quiet ritual', 'Slow mornings', 'Shop Now']);
    });

    it('does not allow on-image text for plain image generation', () => {
      const request = buildStudioGenerationRequest(baseState);
      expect(request.allowedOnImageText).toBeUndefined();
    });

    it('keeps the user aspect ratio and ignores draft assets when output intent is image', () => {
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [makeAsset('hero'), makeAsset('support')],
        socialPostDraft: makeDraft(),
        outputIntent: 'image',
      });
      expect(request.aspectRatio).toBe('9:16');
      expect(request.mode).toBe('generate');
    });

    it('enforces text-free when artDirectionPlan has textDecision: none', () => {
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [makeAsset('hero'), makeAsset('support')],
        socialPostDraft: makeDraft({
          copy: { headline: 'Should Not Appear', caption: 'caption', hashtags: [] },
          artDirectionPlan: {
            visualStrategy: 'product-hero',
            rationale: 'Full-bleed product image with no space for text',
            composition: 'centered product',
            lockedImageTreatment: 'scale to fill',
            textDecision: 'none',
            visibleText: [],
            typography: { headingFont: 'Inter', bodyFont: 'Inter' },
            ctaPlacement: 'caption_only',
            confidence: 0.9,
            warnings: [],
          },
        }),
        outputIntent: 'social_post',
      });
      expect(request.allowedOnImageText).toBeUndefined();
      expect(request.imagePrompt).toContain('DO NOT include any text, typography, letters, words, or watermarks in the generated image.');
    });

    it('allows only exact validated strings when artDirectionPlan has visible text', () => {
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [makeAsset('hero'), makeAsset('support')],
        socialPostDraft: makeDraft({
          copy: { headline: 'Legacy headline', supportingText: 'Legacy supporting', caption: 'caption', callToAction: 'Legacy CTA', hashtags: [] },
          artDirectionPlan: {
            visualStrategy: 'text-on-image',
            rationale: 'Good negative space for headline',
            composition: 'rule of thirds',
            lockedImageTreatment: 'crop to safe zone',
            textDecision: 'headline',
            visibleText: [
              { content: 'Validated Headline', role: 'headline', placement: 'top-center', maxChars: 30 },
            ],
            typography: { headingFont: 'Inter', bodyFont: 'Inter' },
            ctaPlacement: 'caption_only',
            confidence: 0.85,
            warnings: [],
          },
        }),
        outputIntent: 'social_post',
      });
      expect(request.allowedOnImageText).toEqual(['Validated Headline']);
      expect(request.imagePrompt).not.toContain('DO NOT include any text');
    });

    it('uses legacy copy fields when artDirectionPlan is not present (backward compat)', () => {
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [makeAsset('hero'), makeAsset('support')],
        socialPostDraft: makeDraft({
          copy: { headline: 'A quiet ritual', supportingText: 'Slow mornings', caption: 'caption', callToAction: 'Shop Now', hashtags: [] },
        }),
        outputIntent: 'social_post',
      });
      expect(request.allowedOnImageText).toEqual(['A quiet ritual', 'Slow mornings', 'Shop Now']);
      expect(request.imagePrompt).not.toContain('DO NOT include any text');
    });

    it('allows headline_supporting text with multiple visible text entries', () => {
      const request = buildStudioGenerationRequest({
        ...baseState,
        assets: [makeAsset('hero'), makeAsset('support')],
        socialPostDraft: makeDraft({
          artDirectionPlan: {
            visualStrategy: 'text-on-image',
            rationale: 'Sufficient space for headline and supporting',
            composition: 'left-aligned text area',
            lockedImageTreatment: 'offset right',
            textDecision: 'headline_supporting',
            visibleText: [
              { content: 'Bold Headline', role: 'headline', placement: 'top-left', maxChars: 30 },
              { content: 'Supporting detail', role: 'supporting', placement: 'below-headline', maxChars: 60 },
            ],
            typography: { headingFont: 'Inter', bodyFont: 'Inter' },
            ctaPlacement: 'on_image',
            confidence: 0.8,
            warnings: [],
          },
        }),
        outputIntent: 'social_post',
      });
      expect(request.allowedOnImageText).toEqual(['Bold Headline', 'Supporting detail']);
    });
  });
});
