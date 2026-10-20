import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

import {
  buildCaptionGrounding,
  buildFallbackCaptionPack,
  formatCaptionForClipboard,
  generateStudioCaption,
  getCaptionCarouselSlides,
  getPostQueueSlides,
  isEvidenceBasedHashtag,
  sanitizeCaptionContext,
  sanitizeCaptionPack,
  shouldUseCaptionWebResearch,
} from '../../components/AIImageStudio/captionService';
import type { StudioAsset } from '../../components/AIImageStudio/types';

process.env.GEMINI_API_KEY = 'test-key-for-caption-service';

function makeAsset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: 'asset-1',
    name: 'Hero',
    description: '',
    base64: 'abc',
    mimeType: 'image/png',
    width: 100,
    height: 100,
    source: 'generated',
    createdAt: '2026-07-12T00:00:00.000Z',
    generationPrompt: 'soft lifestyle product shot',
    ...overrides,
  };
}

describe('captionService', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('uses web research only when brand context is missing', () => {
    expect(shouldUseCaptionWebResearch({})).toBe(true);
    expect(
      shouldUseCaptionWebResearch({
        brandKnowledge: {
          id: 'b1',
          brandName: { value: 'Kageha', status: 'confirmed', confidence: 1, sourceIds: [] },
          sources: [],
          colors: [],
          fonts: [],
          toneAttributes: [],
          visualPrinciples: [],
          approvedLanguage: [],
          prohibitedLanguage: [],
          logoRules: [],
          imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
          researchedAt: '2026-07-12T00:00:00.000Z',
        } as any,
      }),
    ).toBe(false);
    expect(
      shouldUseCaptionWebResearch({
        brandKnowledge: { brandName: { value: 'Kageha' } } as any,
        forceWebResearch: true,
      }),
    ).toBe(true);
  });

  it('builds grounding from brand, product, and prompt hint', () => {
    const grounding = buildCaptionGrounding({
      brandKnowledge: {
        brandName: { value: 'Kageha', status: 'confirmed', confidence: 1, sourceIds: [] },
        toneAttributes: [{ value: 'calm', status: 'confirmed', confidence: 1, sourceIds: [] }],
      } as any,
      productTruth: {
        id: 'p1',
        productName: 'Matcha tin',
        verifiedFacts: ['ceremonial grade'],
        preservationRules: [],
        openQuestions: [],
        createdAt: '2026-07-12T00:00:00.000Z',
      } as any,
      assetPromptHint: 'soft lifestyle product shot',
    });

    expect(grounding).toContain('Kageha');
    expect(grounding).toContain('Matcha tin');
    expect(grounding).toContain('ceremonial grade');
    expect(grounding).toContain('soft lifestyle product shot');
  });

  it('includes carousel slide notes in grounding', () => {
    const grounding = buildCaptionGrounding({
      slideCount: 3,
      carouselNotes: 'Slide 1 (active / primary grounding image): Cover\nSlide 2: Detail',
      assetPromptHint: 'cover shot',
    });

    expect(grounding).toContain('3-slide Instagram carousel');
    expect(grounding).toContain('Slide 1 (active / primary grounding image): Cover');
    expect(grounding).toContain('ONE caption for the full set');
  });

  it('omits unknown products, filenames, and asset IDs from grounding', () => {
    const grounding = buildCaptionGrounding({
      productTruth: {
        productName: 'Unknown product',
        verifiedFacts: ['Source image: secret-launch-image.png'],
      } as any,
      siblingAssets: [
        makeAsset({
          id: 'asset-secret-42',
          name: 'secret-launch-image.png',
        }),
      ],
      assetPromptHint:
        'Use asset-secret-42 from secret-launch-image.png in a premium composition',
    });

    expect(grounding).not.toContain('Unknown product');
    expect(grounding).not.toContain('secret-launch-image.png');
    expect(grounding).not.toContain('asset-secret-42');
    expect(sanitizeCaptionContext('Unknown product')).toBeUndefined();
  });

  it('orders carousel siblings by variationIndex', () => {
    const active = makeAsset({
      id: 'v2',
      variationSetId: 'set-1',
      variationIndex: 2,
      name: 'Middle',
    });
    const slides = getCaptionCarouselSlides(
      [
        makeAsset({ id: 'other', variationSetId: 'set-2', variationIndex: 1 }),
        makeAsset({ id: 'v3', variationSetId: 'set-1', variationIndex: 3, name: 'End' }),
        active,
        makeAsset({ id: 'v1', variationSetId: 'set-1', variationIndex: 1, name: 'Start' }),
      ],
      active,
    );

    expect(slides.map((slide) => slide.id)).toEqual(['v1', 'v2', 'v3']);
  });

  it('sanitizes hashtags and truncates caption', () => {
    const pack = sanitizeCaptionPack(
      {
        caption: 'Hello world',
        hashtags: ['#Matcha', ' wellness ', ''],
        callToAction: 'Shop now',
        altText: 'Green tin on marble',
      },
      {
        sourceAssetId: 'asset-1',
        usedWebResearch: false,
        researchSummary: 'Used brand context',
      },
    );

    expect(pack.caption).toBe('Hello world');
    expect(pack.hashtags).toEqual(['matcha', 'wellness']);
    expect(pack.callToAction).toBe('Shop now');
    expect(pack.usedWebResearch).toBe(false);
    expect(pack.generationStatus).toBe('ok');
  });

  it('keeps only hashtags supported by supplied evidence', () => {
    const pack = sanitizeCaptionPack(
      {
        caption: 'A calm matcha ritual.',
        hashtags: ['matcha', 'wellness', 'fyp'],
      },
      {
        sourceAssetId: 'asset-1',
        usedWebResearch: false,
        researchSummary: 'Used product facts',
        hashtagEvidence: 'Kageha ceremonial matcha ritual',
      },
    );

    expect(pack.hashtags).toEqual(['matcha']);
    expect(isEvidenceBasedHashtag('ceremonialmatcha', 'ceremonial matcha ritual')).toBe(true);
  });

  it('keeps timely web-research hashtags even when they are outside studio evidence', () => {
    const pack = sanitizeCaptionPack(
      {
        caption: 'POV: your morning finally tastes expensive.',
        hashtags: ['matcha', 'matchatok', 'slowmornings'],
      },
      {
        sourceAssetId: 'asset-1',
        usedWebResearch: true,
        researchSummary: 'Used timely trend research for viral strategy.',
        hashtagEvidence: 'Kageha ceremonial matcha',
        tone: 'viral',
      },
    );

    expect(pack.hashtags).toEqual(['matcha', 'matchatok', 'slowmornings']);
  });

  it('truncates short-tone captions and formats clipboard text', () => {
    const long = 'x'.repeat(400);
    const pack = sanitizeCaptionPack(
      { caption: long, hashtags: ['matcha', 'calm'] },
      {
        sourceAssetId: 'asset-1',
        usedWebResearch: false,
        researchSummary: 'short tone',
        tone: 'short',
      },
    );

    expect(pack.tone).toBe('short');
    expect(pack.caption.length).toBe(280);
    expect(formatCaptionForClipboard(pack)).toBe(`${pack.caption}\n\n#matcha #calm`);
  });

  it('builds a usable fallback caption pack', () => {
    const pack = buildFallbackCaptionPack({
      asset: makeAsset(),
      brandKnowledge: {
        brandName: { value: 'Kageha', status: 'confirmed', confidence: 1, sourceIds: [] },
      } as any,
      productTruth: {
        productName: 'Matcha tin',
        verifiedFacts: [],
        preservationRules: [],
      } as any,
    });

    expect(pack.caption.length).toBeGreaterThan(10);
    expect(pack.hashtags.length).toBeGreaterThan(0);
    expect(pack.hashtags.join(' ')).not.toMatch(/instagram/i);
    expect(pack.sourceAssetId).toBe('asset-1');
    expect(pack.altText).toContain('Matcha tin');
    expect(pack.variationSetId).toBeUndefined();
    expect(pack.slideCount).toBeUndefined();
    expect(pack.generationStatus).toBe('fallback');
  });

  it('never uses upload filenames in fallback captions or hashtags', () => {
    const pack = buildFallbackCaptionPack({
      asset: makeAsset({ name: 'editorial-uji-roasted-matcha.jpg' }),
      brandKnowledge: {
        brandName: { value: 'Kageha', status: 'confirmed', confidence: 1, sourceIds: [] },
      } as any,
      productTruth: {
        productName: 'editorial-uji-roasted-matcha.jpg',
        verifiedFacts: [],
        preservationRules: [],
      } as any,
      tone: 'viral',
    });

    expect(pack.caption.toLowerCase()).not.toContain('.jpg');
    expect(pack.caption.toLowerCase()).not.toContain('editorial-uji');
    expect(pack.hashtags.join(' ').toLowerCase()).not.toContain('editorial');
    expect(pack.hashtags.join(' ').toLowerCase()).not.toContain('instagram');
    expect(pack.researchSummary.toLowerCase()).toContain('fallback');
  });

  it('records carousel meta on fallback caption packs', () => {
    const active = makeAsset({
      id: 'v2',
      variationSetId: 'set-1',
      variationIndex: 2,
      name: 'Slide 2',
    });
    const siblings = [
      makeAsset({
        id: 'v1',
        variationSetId: 'set-1',
        variationIndex: 1,
        name: 'Slide 1',
        generationPrompt: 'opening hook',
      }),
      active,
      makeAsset({
        id: 'v3',
        variationSetId: 'set-1',
        variationIndex: 3,
        name: 'Slide 3',
      }),
    ];

    const pack = buildFallbackCaptionPack({
      asset: active,
      siblingAssets: siblings,
      brandKnowledge: {
        brandName: { value: 'Kageha', status: 'confirmed', confidence: 1, sourceIds: [] },
      } as any,
    });

    expect(pack.sourceAssetId).toBe('v2');
    expect(pack.variationSetId).toBe('set-1');
    expect(pack.slideCount).toBe(3);
    expect(pack.caption).toContain('3 slides');
  });

  it('preserves carousel fields through sanitize', () => {
    const pack = sanitizeCaptionPack(
      { caption: 'Swipe for the ritual.', hashtags: ['matcha'] },
      {
        sourceAssetId: 'v1',
        variationSetId: 'set-9',
        slideCount: 4,
        usedWebResearch: false,
        researchSummary: '4-slide set',
        tone: 'promo',
      },
    );

    expect(pack.sourceAssetId).toBe('v1');
    expect(pack.variationSetId).toBe('set-9');
    expect(pack.slideCount).toBe(4);
    expect(pack.tone).toBe('promo');
  });

  it('forces web research for viral tone', () => {
    expect(
      shouldUseCaptionWebResearch({
        brandKnowledge: { brandName: { value: 'Kageha' } } as any,
        tone: 'viral',
      }),
    ).toBe(true);
  });

  it('includes revise direction in grounding path via previous caption fields', () => {
    const pack = buildFallbackCaptionPack({
      asset: makeAsset(),
      tone: 'viral',
      previousCaption: {
        caption: 'Old hook',
        hashtags: ['old'],
      },
      reviseInstruction: 'Make it shorter',
    });
    expect(pack.tone).toBe('viral');
    expect(pack.caption.length).toBeGreaterThan(0);
  });

  it('resolves post queue slides in selection order (not generation order)', () => {
    const assets = [
      makeAsset({ id: 'gen-first', variationIndex: 1, name: 'Generated first' }),
      makeAsset({ id: 'gen-second', variationIndex: 2, name: 'Generated second' }),
      makeAsset({ id: 'gen-third', variationIndex: 3, name: 'Generated third' }),
    ];
    // User selected third, then first — that is the Instagram swipe order
    const slides = getPostQueueSlides(assets, ['gen-third', 'gen-first']);
    expect(slides.map((s) => s.id)).toEqual(['gen-third', 'gen-first']);
  });

  it('fallback caption keeps postQueueIds for selection-order carousels', () => {
    const slides = [
      makeAsset({ id: 's1', name: 'Cover' }),
      makeAsset({ id: 's2', name: 'Detail' }),
    ];
    const pack = buildFallbackCaptionPack({
      asset: slides[0],
      siblingAssets: slides,
      postQueueOrdered: true,
      tone: 'viral',
    });
    expect(pack.postQueueIds).toEqual(['s1', 's2']);
    expect(pack.slideCount).toBe(2);
    expect(pack.variationSetId).toBeUndefined();
  });

  it('attaches every queued image to Gemini in exact selection order', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        caption: 'Three moments, one ritual.',
        hashtags: ['matcha', 'unsupportedtag'],
        altText: 'Three product images in a carousel',
        researchSummary: 'Used product and concept context.',
      }),
    });
    const slides = [
      makeAsset({
        id: 'third-selected',
        name: 'campaign-cover.png',
        base64: 'IMAGE_THREE',
        generationPrompt: 'ceremonial matcha cover',
      }),
      makeAsset({
        id: 'first-selected',
        name: 'internal-asset-id.jpg',
        base64: 'IMAGE_ONE',
        generationPrompt: 'matcha preparation detail',
      }),
      makeAsset({
        id: 'second-selected',
        name: 'final-frame.webp',
        base64: 'IMAGE_TWO',
        generationPrompt: 'calm matcha serving moment',
      }),
    ];

    const pack = await generateStudioCaption({
      asset: slides[0],
      siblingAssets: slides,
      postQueueOrdered: true,
      tone: 'short',
      brandKnowledge: {
        brandName: { value: 'Kageha', status: 'confirmed' },
      } as any,
      productTruth: {
        productName: 'Ceremonial matcha',
        verifiedFacts: ['Stone-ground green tea'],
      } as any,
      selectedConcept: {
        title: 'Quiet ritual',
        oneLineIdea: 'Show a calm preparation sequence',
      } as any,
      trendResearch: {
        insights: [{ title: 'Slow mornings', description: 'Mindful morning routines' }],
      } as any,
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const request = mockGenerateContent.mock.calls[0][0];
    const parts = request.contents.parts;
    expect(parts.slice(0, 3).map((part: any) => part.inlineData.data)).toEqual([
      'IMAGE_THREE',
      'IMAGE_ONE',
      'IMAGE_TWO',
    ]);
    const prompt = parts[3].text as string;
    expect(prompt).toContain('Brand: Kageha');
    expect(prompt).toContain('Product: Ceremonial matcha');
    expect(prompt).toContain('Concept: Quiet ritual');
    expect(prompt).toContain('Trend cues: Slow mornings');
    expect(prompt).not.toContain('campaign-cover.png');
    expect(prompt).not.toContain('third-selected');
    expect(pack.hashtags).toEqual(['matcha']);
    expect(pack.postQueueIds).toEqual([
      'third-selected',
      'first-selected',
      'second-selected',
    ]);
  });

  it('loads previewUrl-only assets before caption generation', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        caption: 'A grounded product moment.',
        hashtags: ['kageha'],
      }),
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );

    await generateStudioCaption({
      asset: makeAsset({
        base64: '',
        previewUrl: 'https://cdn.example.com/render',
      }),
      tone: 'short',
      brandKnowledge: {
        brandName: { value: 'Kageha', status: 'confirmed' },
      } as any,
    });

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/render');
    const imagePart = mockGenerateContent.mock.calls[0][0].contents.parts[0];
    expect(imagePart.inlineData).toEqual({
      mimeType: 'image/png',
      data: 'AQID',
    });
    fetchMock.mockRestore();
  });

  it('recovers viral captions when grounded search hits MAX_TOKENS mid-JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      text: `{
  "caption": "POV: you found the quiet flex.",
  "hashtags": ["matcha", "matchatok", "slowmornings"],
  "callToAction": "Save this for tomorrow",
  "altText": "Matcha tin in soft morning light",
  "researchSummary": "Used a timely slow-morning angle`,
    });

    const pack = await generateStudioCaption({
      asset: makeAsset({
        base64: 'IMAGE_ONE',
        generationPrompt: 'ceremonial matcha lifestyle',
      }),
      tone: 'viral',
      brandKnowledge: {
        brandName: { value: 'Kageha', status: 'confirmed' },
      } as any,
      productTruth: {
        productName: 'Ceremonial matcha',
        verifiedFacts: ['Stone-ground green tea'],
      } as any,
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent.mock.calls[0][0].config.maxOutputTokens).toBe(4096);
    expect(mockGenerateContent.mock.calls[0][0].tools).toEqual([{ googleSearch: {} }]);
    expect(pack.generationStatus).toBe('ok');
    expect(pack.caption).toContain('quiet flex');
    expect(pack.hashtags).toEqual(['matcha', 'matchatok', 'slowmornings']);
  });

  it('retries without inline images when a carousel image request is rejected', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error('Request payload size exceeds the limit'))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          caption: 'Six slides, one considered matcha ritual.',
          hashtags: ['matcha'],
          researchSummary: 'Used verified studio context.',
        }),
      });
    const slides = Array.from({ length: 6 }, (_, index) =>
      makeAsset({
        id: `slide-${index + 1}`,
        base64: `IMAGE_${index + 1}`,
        generationPrompt: `Matcha carousel scene ${index + 1}`,
      }),
    );

    const pack = await generateStudioCaption({
      asset: slides[0],
      siblingAssets: slides,
      postQueueOrdered: true,
      tone: 'short',
      brandKnowledge: {
        brandName: { value: 'Kageha', status: 'confirmed' },
      } as any,
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[0][0].contents.parts).toHaveLength(7);
    expect(mockGenerateContent.mock.calls[1][0].contents.parts).toHaveLength(1);
    expect(mockGenerateContent.mock.calls[1][0].contents.parts[0].text).toContain(
      '6-slide Instagram carousel',
    );
    expect(pack.generationStatus).toBe('ok');
    expect(pack.caption).toContain('Six slides');
  });
});
